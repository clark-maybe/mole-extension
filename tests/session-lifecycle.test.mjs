import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { Buffer } from 'node:buffer';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
const { structuredClone } = globalThis;

// 保留真实会话执行、持久化、事件队列及同步，仅隔离模型与浏览器工具。
const bundle = await build({
  stdin: { contents: `export * from './src/background/session-manager';
    export { default as Channel } from './src/lib/channel';`,
    resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
  bundle: true, format: 'esm', platform: 'node', write: false,
  plugins: [{ name: 'lifecycle-fixtures', setup(build) {
    build.onResolve({ filter: /^\.\.\/ai\/orchestrator$/ }, () => ({ path: 'model', namespace: 'fixture' }));
    build.onResolve({ filter: /^\.\.\/functions\/registry$/ }, () => ({ path: 'registry', namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path === 'registry'
      ? `export const mcpClient = { listTools: async () => [] };
        export const getBuiltinFunction = () => undefined;
        export const ensureToolRegistryReady = async () => {};`
      : `export const handleChat = async (query, emit, _tabId, _signal, previous, options) => {
          const context = [...(previous || []), {role:'assistant',content:'查询已完成，结果已整理。'}];
          emit({type:'text',content:'查询已完成，结果已整理。'});
          options.onCheckpoint({phase:'finalize',round:1,contextSnapshot:context});
          return context;
        };`,
    }));
  } }],
});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const originalChrome = globalThis.chrome;
const broadcasts = [];
const stored = {};
let onWrite;
globalThis.chrome = { runtime: {}, storage: { local: {
  get: (key, callback) => {
    const result = { [key]: structuredClone(stored[key]) };
    if (callback) { callback(result); return; }
    return Promise.resolve(result);
  },
  set: (data, callback) => {
    Object.assign(stored, structuredClone(data));
    onWrite?.(data);
    if (callback) { callback(); return; }
    return Promise.resolve();
  },
} } };
api.Channel.broadcast = (type, data) => broadcasts.push({ type, data: structuredClone(data) });
after(() => { globalThis.chrome = originalChrome; });

test('网页访问限制随检查点持久化，独立于模型上下文', async () => {
  const session = api.createSession('收集网页资料');
  session.status = 'running';
  const snapshot = [{ url: 'https://example.com/denied', aliases: [], code: 'E_WEB_ACCESS_DENIED',
    message: '拒绝访问', retryable: false, failures: 1, nextRetryAt: 1000 }];
  api.createSessionCheckpointHandler(session)({ phase: 'act', round: 1, summary: '网页不可用', updatedAt: 1,
    contextSnapshot: [{ role: 'user', content: '压缩后的任务目标' }], meta: { webAccessSnapshot: snapshot } });
  await api.persistRuntimeSessionsImmediate();
  const saved = stored.mole_session_runtime_v1.sessions.find(item => item.id === session.id);
  assert.deepEqual(saved.webAccessSnapshot, snapshot);
  assert.equal(saved.context.length, 1);
  api.sessions.clear();
});

test('读取同步快照不改变刚结束但尚未发完成事件的会话状态', () => {
  const session = api.createSession('搜索账号');
  session.eventLog.push({ type: 'turn_started', content: JSON.stringify({ runId: 'run-1', startedAt: 1 }) });
  session.status = 'done'; session.endedAt = 10; session.durationMs = 9;
  const snapshot = api.buildSessionSyncPayload(session);
  assert.equal(snapshot.status, 'done');
  assert.equal(session.status, 'done');
  assert.equal(session.endedAt, 10);
  api.sessions.clear();
});

test('最终结果写盘期间发生状态查询，仍会发送完成事件并停止运行态', async () => {
  api.sessions.clear(); broadcasts.length = 0;
  const session = api.createSession('搜索武汉餐饮账号');
  let interleaved = false;
  onWrite = () => {
    if (session.status === 'done' && !session.eventLog.some(event => event.type === 'turn_completed')) {
      interleaved = true;
      api.buildSessionSyncPayload(session);
    }
  };
  try {
    await api.runSessionNow(session, session.summary);
    const task = api.findRunningTask(session.id);
    if (task) await task.done;
    await api.dispatchSessionOp('test_flush', () => {});
    assert.equal(interleaved, true);
    assert.equal(session.status, 'done');
    assert.equal(api.hasRunningTasks(), false);
    const completed = broadcasts.filter(item => item.type === '__ai_stream' && item.data.type === 'turn_completed');
    assert.equal(completed.length, 1);
    assert.equal(JSON.parse(completed[0].data.content).status, 'done');
    assert.equal(broadcasts.filter(item => item.type === '__session_sync').at(-1).data.status, 'done');
  } finally {
    onWrite = undefined;
    await api.persistRuntimeSessionsImmediate();
    api.sessions.clear();
  }
});

test('发送队列积压时，旧事件附带的同步状态不能把已完成任务改回运行中', async () => {
  api.sessions.clear(); broadcasts.length = 0;
  let release;
  const held = api.dispatchSessionOp('test_hold', () => new Promise(resolve => { release = resolve; }));
  const session = api.createSession('整理已有线索');
  try {
    await api.runSessionNow(session, session.summary);
    const task = api.findRunningTask(session.id);
    if (task) await task.done;
    const beforeFlush = broadcasts.length;
    release(); await held;
    await api.dispatchSessionOp('test_flush', () => {});
    const queuedSync = broadcasts.slice(beforeFlush).filter(item => item.type === '__session_sync');
    assert.ok(queuedSync.length > 0);
    assert.ok(queuedSync.every(item => item.data.status === 'done'));
  } finally {
    release?.();
    await api.persistRuntimeSessionsImmediate();
    api.sessions.clear();
  }
});
