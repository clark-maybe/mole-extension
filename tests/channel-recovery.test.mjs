import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { build } from 'esbuild';
import { Buffer } from 'node:buffer';
import { fileURLToPath, URL } from 'node:url';
const { structuredClone } = globalThis;
import { setTimeout } from 'node:timers/promises';

const originalChrome = globalThis.chrome;
let receive;
const stored = {};
const injections = [];
globalThis.chrome = {
  runtime: { onMessage: { addListener: (handler) => { receive = handler; } } },
  tabs: { onUpdated: { addListener: () => {} } },
  storage: { local: {
    get: (key, callback) => callback({ [key]: structuredClone(stored[key]) }),
    set: (data, callback) => { Object.assign(stored, structuredClone(data)); callback(); },
  } },
  scripting: { executeScript: async (data) => { injections.push(data); return []; } },
};
after(() => { globalThis.chrome = originalChrome; });

const bundle = await build({
  stdin: { contents: `export { restoreChannelRecovery } from './src/background/channel-recovery';
    export { channelAccess } from './src/lib/channel-access';
    export { default as Channel } from './src/lib/channel';
    export * from 'test-sessions'; export * from 'test-registry';`,
    resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
  bundle: true, format: 'esm', platform: 'node', write: false,
  plugins: [{ name: 'recovery-fixtures', setup(build) {
    build.onResolve({ filter: /^(test-sessions|\.\/session-manager)$/ }, () => ({ path: 'sessions', namespace: 'fixture' }));
    build.onResolve({ filter: /^(test-registry|\.\.\/functions\/registry)$/ }, () => ({ path: 'registry', namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path === 'registry'
      ? `export const requests = []; export let response = { success: true, data: { items: [{uid:'7542423044858446906'}], cursor: 24 } };
        export const setResponse = (next) => { response = next; };
        export const getBuiltinFunction = () => ({ channel:'douyin', permissionLevel:'read', validate:()=>null,
          execute:async (args) => { requests.push(args); return response; } });`
      : `export const sessions = new Map(); export const resumes = []; export const commits = [];
        let busy = false; let queue = Promise.resolve(); let failStart = false; let failPersist = false;
        export const errors = [];
        export const setStartFailure = (value) => { failStart = value; };
        export const setPersistFailure = (value) => { failPersist = value; };
        export const setBusy = (value) => { busy = value; };
        export const hasRunningTasks = () => busy;
        export const createSessionPushEvent = (session) => (event) => { session.eventLog.push(event);
          if(event.type==='turn_completed') session.status=JSON.parse(event.content).status; };
        export const dispatchSessionOp = (_label, operation) => { queue = queue.then(operation).catch(error=>errors.push(error)); return queue; };
        export const flush = () => queue;
        export const persistRuntimeSessionsImmediate = async () => {
          if(failPersist) throw new Error('存储空间不足'); commits.push(structuredClone([...sessions.values()])); };
        export const buildSessionSyncPayload = (session) => session;
        export const runSessionNow = async (session, query, tabId, options) => {
          if(failStart) throw new Error('后台在交接时终止');
          resumes.push({session:structuredClone(session),query,tabId,options}); session.status='running'; busy=true;
        };`,
    }));
  } }],
});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
api.Channel.listen();
const sender = { tab: { id: 7 }, frameId: 0, url: 'https://www.douyin.com/' };
const blocked = { success: false, code: 'E_VERIFICATION_REQUIRED', data: { tab_id: 7, verification_watch_id: 'original' } };
async function prepare(id) {
  api.setBusy(false);
  api.setStartFailure(false); api.setPersistFailure(false); api.errors.length = 0;
  api.sessions.clear(); api.requests.length = 0; api.resumes.length = 0; api.commits.length = 0;
  const session = { id, summary: '搜索餐饮线索', status: 'waiting', context: [], eventLog: [],
    channelResumeQuery: '继续搜索三个关键词', channelResumeOptions: { disallowTools: ['webhook'], maxToolCalls: 20 } };
  api.sessions.set(id, session);
  await api.channelAccess.execute('douyin', 'douyin_search_users',
    { keyword: '武汉 餐饮', cursor: 12, search_id: 'search-original' }, { sessionId: id }, async () => blocked);
  await api.flush();
  return session;
}
async function waitForResume() {
  for (let i = 0; i < 250 && api.resumes.length === 0; i++) await setTimeout(10);
  assert.equal(api.resumes.length, 1);
  await api.flush();
}

test('真实页面消息触发检查，保存原页结果后自动接续，并保留原任务权限和预算', async () => {
  const session = await prepare('auto-resume');
  let accepted;
  receive({ type: '__channel_access_ready', data: { watchId: 'original' } }, sender,
    (reply) => { accepted = reply.accepted; });
  assert.equal(accepted, true);
  await waitForResume();
  assert.deepEqual(api.requests, [{ keyword: '武汉 餐饮', cursor: 12, search_id: 'search-original', tab_id: 7 }]);
  assert.equal(api.resumes[0].query, '继续搜索三个关键词');
  assert.deepEqual(api.resumes[0].options.disallowTools, ['webhook']);
  assert.equal(api.resumes[0].options.maxToolCalls, 20);
  assert.equal(api.resumes[0].options.appendUserQuery, false);
  const pair = api.resumes[0].session.context.slice(0, 2);
  assert.equal(pair[0].call_id, pair[1].call_id);
  assert.equal(JSON.parse(pair[1].output).data.items[0].uid, '7542423044858446906');
  assert.ok(api.commits[0][0].context.some((item) => item.type === 'function_call_output'));
  assert.equal(api.channelAccess.hasPending(session.id), false);
  api.channelAccess.notify(); await api.flush();
  assert.equal(api.resumes.length, 1);
  await api.channelAccess.cancelSession(session.id);
});

test('其他工作仍在运行时不抢占任务，进入等待后只接续一次', async () => {
  const session = await prepare('busy-resume');
  api.setBusy(true); session.status = 'running';
  await api.channelAccess.check('douyin', 7, 'original');
  await api.flush();
  assert.equal(api.resumes.length, 0);
  session.status = 'waiting'; api.setBusy(false); api.channelAccess.notify();
  await api.flush();
  assert.equal(api.resumes.length, 1);
  await api.channelAccess.cancelSession(session.id);
});

test('错误来源、子 iframe 和过期查询信号不会恢复任务；取消后清理页面观察器', async () => {
  const session = await prepare('cancel-resume');
  for (const source of [{ ...sender, url: 'https://example.com/' }, { ...sender, frameId: 1 }]) {
    let reply;
    receive({ type: '__channel_access_ready', data: { watchId: 'original' } }, source, (value) => { reply = value; });
    assert.equal(reply.accepted, false);
  }
  await api.channelAccess.check('douyin', 7, 'old');
  await api.channelAccess.cancelSession(session.id);
  await api.channelAccess.check('douyin', 7, 'original');
  await api.flush();
  assert.equal(api.requests.length, 0);
  assert.equal(api.resumes.length, 0);
  assert.ok(injections.some((injection) => injection.args[1] === 'stop'));
});

test('恢复结果交接时会话写盘失败，不消费结果；重试不重复插入上下文', async () => {
  const session = await prepare('persist-failure');
  api.setPersistFailure(true);
  await api.channelAccess.check('douyin', 7, 'original'); await api.flush();
  assert.equal(api.resumes.length, 0);
  assert.equal(api.channelAccess.completed(session.id).length, 1);
  assert.equal(api.errors.length, 1);
  api.setPersistFailure(false); api.channelAccess.notify(); await api.flush();
  assert.equal(api.resumes.length, 1);
  assert.equal(session.context.filter(item => item.type === 'function_call_output').length, 1);
  assert.equal(session.context.filter(item => item.role === 'user').length, 1);
  await api.channelAccess.cancelSession(session.id);
});

test('结果已消费但 Agent 尚未启动时重启，凭持久化接续标记自动恢复', async () => {
  const session = await prepare('handoff-restart');
  api.setStartFailure(true);
  await api.channelAccess.check('douyin', 7, 'original'); await api.flush();
  assert.equal(api.channelAccess.hasPending(session.id), false);
  assert.equal(api.resumes.length, 0);
  const restored = structuredClone(api.commits.at(-1)[0]);
  assert.equal(restored.channelResumePending, true);
  restored.status = 'error'; restored.failureCode = 'E_SESSION_RUNTIME';
  api.sessions.set(session.id, restored);
  api.setStartFailure(false);
  await api.restoreChannelRecovery(); await api.flush();
  assert.equal(api.resumes.length, 1);
  assert.equal(api.requests.length, 1);
  assert.equal(restored.context.filter(item => item.type === 'function_call_output').length, 1);
  assert.equal(restored.context.filter(item => item.role === 'user').length, 1);
  await api.channelAccess.cancelSession(session.id);
});
