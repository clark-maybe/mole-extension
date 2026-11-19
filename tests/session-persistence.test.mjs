import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSync } from 'esbuild';
import { Buffer } from 'node:buffer';
import { fileURLToPath, URL } from 'node:url';
import { setTimeout } from 'node:timers/promises';
const { structuredClone } = globalThis;

const bundle = buildSync({
  stdin: { contents: `export * from './src/background/session-persistence';
    export * from './src/background/session-event';
    export { sessions } from './src/background/session-state';`,
    resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
  bundle: true, format: 'esm', platform: 'node', write: false,
});

const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('等待渠道的生命周期回放保持 waiting，不写入结束时间或把待办标为完成', () => {
  const session = { id: 'waiting', status: 'running', createdAt: 1, startedAt: 2,
    context: [], eventLog: [], agentState: { phase: 'act', round: 3 },
    todoSnapshot: { items: [{ id: 'page-2', status: 'pending' }] } };
  const completed = { type: 'turn_completed', content: JSON.stringify({ status: 'waiting', endedAt: 8, durationMs: 6 }) };
  api.applyTurnLifecycleEventToSession(session, completed.type, api.parseTurnLifecycleEventPayload(completed.content));
  assert.equal(session.status, 'waiting');
  session.eventLog.push({ type: 'turn_started', content: JSON.stringify({ startedAt: 2 }) }, completed);
  api.reconcileSessionStateFromEventLog(session);
  assert.equal(session.status, 'waiting');
  assert.equal(session.endedAt, undefined);
  assert.equal(session.durationMs, undefined);
  assert.equal(session.todoSnapshot.items[0].status, 'pending');
});

test('立即持久化向调用方报告失败，后续写入和 debounce 写入仍可继续', async () => {
  const originalChrome = globalThis.chrome;
  const stored = {};
  let fail = true;
  globalThis.chrome = { storage: { local: { set: async (data) => {
    if (fail) throw new Error('磁盘不可写');
    Object.assign(stored, structuredClone(data));
  } } } };
  try {
    api.sessions.set('recover', { id: 'recover', status: 'waiting', channelResumePending: true,
      context: [{ role: 'user', content: '继续任务' }], eventLog: [] });
    await assert.rejects(api.persistRuntimeSessionsImmediate(), /磁盘不可写/);
    assert.deepEqual(stored, {});
    fail = false;
    await api.persistRuntimeSessionsImmediate();
    assert.equal(stored.mole_session_runtime_v1.sessions[0].channelResumePending, true);
    fail = true;
    api.persistRuntimeSessions(); await setTimeout(260);
    fail = false;
    api.sessions.get('recover').channelResumePending = false;
    api.persistRuntimeSessions(); await setTimeout(260);
    assert.equal(stored.mole_session_runtime_v1.sessions[0].channelResumePending, false);
  } finally { globalThis.chrome = originalChrome; api.sessions.clear(); }
});
