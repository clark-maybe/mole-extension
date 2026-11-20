import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundle = await build({ stdin: { contents: `export * from './src/background/lead-task-runner';
  export {workspaceRepository as repo} from './src/lib/workspace-db/repository';
  export {PlatformError} from './src/platforms/page-job';`, resolveDir: fileURLToPath(new URL('../', import.meta.url)) }, bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'read-only-runner-fixture', setup(builder) {
    builder.onResolve({ filter: /\/workspace-storage$/ }, () => ({ path: 'storage', namespace: 'fixture' }));
    builder.onResolve({ filter: /\/read-adapters$/ }, () => ({ path: 'adapters', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path === 'storage'
      ? 'export const workspaceStorageReady = async () => {};'
      : 'export const collectDouyin = async () => {}; export const getContacts = collectDouyin; export const searchCompanies = collectDouyin;' }));
  } }] });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const originalChrome = globalThis.chrome;
globalThis.chrome = { runtime: {}, tabs: {}, alarms: { create: async () => {}, clear: async () => {} }, storage: { local: { get: (key, cb) => cb({}), set: (_data, cb) => cb?.() } } };
after(async () => { await api.repo.database.close(); globalThis.chrome = originalChrome; });
const session = id => ({ id, summary: id, status: 'done', context: [], eventLog: [], createdAt: 1, agentState: { phase: 'idle', round: 0, reason: '', updatedAt: 1 } });
async function prepare(id, kind = 'douyin_collect') {
  await api.repo.saveSession(session(id));
  return api.repo.createTask({ id, sessionId: id, kind, provider: 'douyin', title: id, input: {} });
}
const result = attempt => ({ evidence: [{ id: crypto.randomUUID(), taskId: attempt.task.id, stepId: attempt.step.id, provider: 'douyin', sourceUrl: 'https://www.douyin.com/', collectedAt: 1, extractorVersion: 'fixture', payload: { raw: true } }], leads: [], checkpoint: { cursor: 20 }, done: true });

test('多次同时唤醒只执行一批；暂停期间晚到的批次保存后不继续', async () => {
  await prepare('concurrent'); let release, calls = 0, entered;
  const started = new Promise(resolve => { entered = resolve; });
  api.registerTaskAdapter('douyin_collect', async attempt => { calls++; entered(); await new Promise(resolve => { release = resolve; }); return result(attempt); });
  const work = api.wakeLeadTasks(); await started;
  const second = api.wakeLeadTasks();
  await api.repo.controlTask('concurrent', 'pause'); release();
  await work; await second;
  assert.equal(calls, 1);
  assert.equal((await api.repo.getTask('concurrent')).status, 'paused');
  assert.equal((await api.repo.getTask('concurrent')).checkpoint.cursor, 20);
});

test('重启恢复只读作业，但旧 epoch 回包不能推进检查点', async () => {
  await prepare('restart'); const old = await api.repo.claimTask('restart');
  await api.repo.recover();
  api.registerTaskAdapter('douyin_collect', async attempt => result(attempt));
  await api.wakeLeadTasks();
  await assert.rejects(api.repo.commitBatch(old, result(old)), /代次/);
  assert.equal((await api.repo.getTask('restart')).batches, 1);
  assert.equal((await api.repo.getTask('restart')).status, 'completed');
});

test('验证受阻进入 waiting，重复唤醒不继续触发平台读取', async () => {
  await prepare('verification'); let calls = 0;
  api.registerTaskAdapter('douyin_collect', async () => { calls++; throw new api.PlatformError('请完成验证', 'waiting'); });
  await api.wakeLeadTasks(); await api.wakeLeadTasks();
  assert.equal(calls, 1); assert.equal((await api.repo.getTask('verification')).status, 'waiting');
});

test('配额失败保持未提交游标并停止，不虚报完成', async () => {
  await prepare('quota'); const commit = api.repo.commitBatch;
  api.registerTaskAdapter('douyin_collect', async attempt => result(attempt));
  api.repo.commitBatch = async () => { throw new DOMException('full', 'QuotaExceededError'); };
  try { await api.wakeLeadTasks(); } finally { api.repo.commitBatch = commit; }
  assert.equal((await api.repo.getTask('quota')).status, 'running');
  assert.deepEqual((await api.repo.getTask('quota')).checkpoint, {});
});
