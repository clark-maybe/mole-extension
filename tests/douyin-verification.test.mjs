import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { build, buildSync } from 'esbuild';

const bundle = buildSync({
  entryPoints: [fileURLToPath(new URL('../src/background/douyin-verification.ts', import.meta.url))],
  bundle: true, format: 'esm', platform: 'node', write: false,
});
const { matchDouyinVerification } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);

// 保留真实 Channel 协议与处理器，隔离无关的会话执行和浏览器工具注册。
const channelBundle = await build({
  stdin: { contents: `import './src/background/session-channel-handlers';
    export { default as Channel } from './src/lib/channel';
    export { sessions, activate } from 'test-sessions';`,
    resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
  bundle: true, format: 'esm', platform: 'node', write: false,
  plugins: [{ name: 'session-fixture', setup(build) {
    build.onResolve({ filter: /^(test-sessions|\.\/session-manager)$/ }, () => ({ path: 'sessions', namespace: 'fixture' }));
    build.onResolve({ filter: /^\.\.\/functions\/registry$/ }, () => ({ path: 'registry', namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path === 'registry'
      ? 'export const mcpClient = {};'
      : `export const sessions = new Map(); let active = '';
        export const activate = (id) => { active = id; };
        export const getActiveSessionId = () => active;
        export const createSessionPushEvent = (session) => (event) => session.eventLog.push(event);
        export const ${[
          'setActiveSessionId', 'activeControllers', 'sessionTaskKinds', 'activeCoalescedTasks',
          'parseRollbackCommand', 'respondSessionOp', 'resolveSessionTaskRequest', 'createSession',
          'buildSessionSyncPayload', 'buildSessionReplayPayload', 'buildSessionOpQueueSnapshot',
          'buildErrorContent', 'runSessionNow', 'abortSessionTask', 'rollbackSessionTurns',
          'extractLatestStartedRunId', 'extractExecuteSessionOptions', 'getPrimaryRunningTask',
          'findRunningTask', 'getRunningTasks', 'hasRunningTasks', 'getSessionTaskKind',
          'dispatchSessionOp', 'persistRuntimeSessions', 'persistSessionHistory', 'RuntimeResourceManager',
        ].map((name) => `${name} = () => {}`).join(', ')};`,
    }));
  } }],
});
const { Channel, sessions, activate } = await import(
  `data:text/javascript;base64,${Buffer.from(channelBundle.outputFiles[0].text).toString('base64')}`
);
const event = (type, data) => ({ type, content: JSON.stringify(data) });
const started = event('turn_started', {});
const call = event('function_call', { name: 'douyin_search_users' });
const result = (watchId, tabId = 7, extra = {}) => event('function_result', {
  name: 'douyin_search_users', tabId, verificationWatchId: watchId, ...extra,
});

test('延迟验证码只关联当前轮最近一次查询，结果落日志前可重报', () => {
  const events = [started, call];
  assert.equal(matchDouyinVerification(events, 7, 'new').related, false);
  events.push(result('new', 7, { success: true }), event('turn_completed', {}));
  assert.deepEqual(matchDouyinVerification(events, 7, 'new'), { related: true, notified: false });
  assert.equal(matchDouyinVerification(events, 8, 'new').related, false);
  assert.equal(matchDouyinVerification(events, 7, 'old').related, false);
  events.push(call);
  assert.equal(matchDouyinVerification(events, 7, 'new').related, false);
  events.push(result('next'));
  assert.equal(matchDouyinVerification(events, 7, 'new').related, false);
  assert.equal(matchDouyinVerification(events, 7, 'next').related, true);
  events.push(started);
  assert.equal(matchDouyinVerification(events, 7, 'next').related, false);
});

test('已经通知过的查询不重复生成卡片，兼容无关工具和旧日志', () => {
  const events = [started, call, result('new', 7, { code: 'E_AUTH_REQUIRED' }),
    { type: 'function_result', content: '旧格式' },
    event('function_result', { name: 'page', success: true })];
  assert.deepEqual(matchDouyinVerification(events, 7, 'new'), { related: true, notified: false });
  events.push(event('platform_action_required', {
    name: 'douyin_search_users', tabId: 7, verificationWatchId: 'new', code: 'E_VERIFICATION_REQUIRED',
  }));
  assert.deepEqual(matchDouyinVerification(events, 7, 'new'), { related: true, notified: true });
  assert.deepEqual(matchDouyinVerification([started, result('new', 7, {
    code: 'E_VERIFICATION_REQUIRED',
  })], 7, 'new'), { related: true, notified: true });
});

test('真实 Channel 处理器校验来源，延迟结果到达后向原会话发验证事件', () => {
  const originalChrome = globalThis.chrome;
  let receive;
  globalThis.chrome = { runtime: { onMessage: { addListener: (listener) => { receive = listener; } } } };
  try {
    Channel.listen();
    const session = { id: 'session-1', eventLog: [started, call] };
    sessions.set(session.id, session);
    activate(session.id);
    const sender = { tab: { id: 7 }, url: 'https://www.douyin.com/', frameId: 0 };
    const report = (source = sender, watchId = 'new') => {
      let response;
      receive({ type: '__douyin_verification_detected', data: { watchId } }, source,
        (value) => { response = value; });
      return response;
    };
    assert.equal(report().accepted, false);
    session.eventLog.push(result('new', 7, { code: 'E_AUTH_REQUIRED' }));
    for (const source of [{ ...sender, frameId: 1 }, { ...sender, url: 'https://example.com/' },
      { ...sender, tab: { id: 8 } }]) assert.equal(report(source).accepted, false);
    assert.equal(report(sender, 'old').accepted, false);
    assert.equal(report().accepted, true);
    const notice = session.eventLog.at(-1);
    assert.equal(notice.type, 'platform_action_required');
    assert.equal(JSON.parse(notice.content).code, 'E_VERIFICATION_REQUIRED');
    assert.equal(JSON.parse(notice.content).tabId, 7);
    const count = session.eventLog.length;
    assert.equal(report().accepted, true);
    assert.equal(session.eventLog.length, count);
    activate('another-session');
    assert.equal(report().accepted, false);
    assert.equal(session.eventLog.length, count);
  } finally { globalThis.chrome = originalChrome; }
});
