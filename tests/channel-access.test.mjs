import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSync } from 'esbuild';
import { Buffer } from 'node:buffer';
import { fileURLToPath, URL } from 'node:url';
const { structuredClone, AbortController } = globalThis;

const bundle = buildSync({ entryPoints: [fileURLToPath(new URL('../src/lib/channel-access.ts', import.meta.url))],
  bundle: true, format: 'esm', platform: 'node', write: false });
const { ChannelAccessCoordinator } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const blocked = (code = 'E_VERIFICATION_REQUIRED', watch = 'watch-1') => ({
  success: false, code, data: { tab_id: 7, verification_watch_id: watch },
});
const success = { success: true, data: { items: [{ uid: '7542423044858446906' }], cursor: 24, has_more: true } };
const context = { sessionId: 'session-1' };
const args = { keyword: '武汉 餐饮', cursor: 12, search_id: 'first-search' };
function fixture(run = async () => success) {
  let saved;
  const changes = [];
  const dependencies = { load: async () => structuredClone(saved), save: async (states) => { saved = structuredClone(states); },
    run, changed: (state) => changes.push(state), intervalMs: 0 };
  return { manager: new ChannelAccessCoordinator(dependencies), changes,
    restart: () => new ChannelAccessCoordinator(dependencies), saved: () => saved };
}
const defer = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

test('跨 Agent 的同渠道查询统一串行，首次受阻后其他调用不再发请求', async () => {
  const { manager } = fixture();
  const first = defer();
  let requests = 0;
  const run = async () => { requests++; await first.promise; return blocked(); };
  const a = manager.execute('douyin', 'douyin_search_users', args, context, run);
  const b = manager.execute('douyin', 'douyin_search_users', { keyword: '另一个词' }, { sessionId: 'session-2' }, run);
  first.resolve();
  const results = await Promise.all([a, b]);
  assert.equal(requests, 1);
  assert.ok(results.every((result) => result.data.auto_resume));
  assert.equal(manager.forSession('session-1')[0].calls.length, 2);
});

test('恢复精确重放受阻页，旧信号和重复信号不会重复请求', async () => {
  const requests = [];
  const { manager } = fixture(async (name, params) => { requests.push({ name, params }); return success; });
  await manager.execute('douyin', 'douyin_search_users', args, context, async () => blocked());
  assert.equal(await manager.check('douyin', 8, 'watch-1'), false);
  assert.equal(await manager.check('douyin', 7, 'old'), false);
  await Promise.all([manager.check('douyin', 7, 'watch-1'), manager.check('douyin', 7, 'watch-1')]);
  assert.deepEqual(requests, [{ name: 'douyin_search_users', params: { ...args, tab_id: 7 } }]);
  assert.equal(manager.completed(context.sessionId)[0].result.data.items[0].uid, '7542423044858446906');
  assert.equal(await manager.check('douyin', 7, 'watch-1'), false);
});

test('同一受阻查询去重；其他已授权关键词分别保存', async () => {
  const { manager } = fixture();
  for (const params of [args, args, { ...args, keyword: '上海 餐饮' }]) {
    await manager.execute('douyin', 'douyin_search_users', params, context, async () => blocked());
  }
  assert.equal(manager.forSession(context.sessionId)[0].calls.length, 2);
});

test('检查未通过继续等待新信号，登录变验证后仍保留原始分页', async () => {
  let requests = 0;
  const { manager } = fixture(async () => { requests++; return blocked('E_VERIFICATION_REQUIRED', 'watch-2'); });
  await manager.execute('douyin', 'douyin_search_users', args, context, async () => blocked('E_AUTH_REQUIRED'));
  assert.equal(await manager.check('douyin', 7, 'watch-1'), false);
  assert.equal(manager.snapshot()[0].status, 'waiting');
  assert.equal(manager.snapshot()[0].kind, 'verification');
  assert.deepEqual(manager.snapshot()[0].calls[0].args, args);
  assert.equal(await manager.check('douyin', 7, 'watch-1'), false);
  assert.equal(requests, 1);
});

test('后台重启保留原查询和待交付结果，不主动发请求', async () => {
  let requests = 0;
  const f = fixture(async () => { requests++; return success; });
  await f.manager.execute('douyin', 'douyin_search_users', args, context, async () => blocked());
  const restarted = f.restart();
  await restarted.restore();
  assert.equal(requests, 0);
  assert.equal(restarted.hasPending(context.sessionId), true);
  await restarted.check('douyin', 7, 'watch-1');
  const afterSuccess = f.restart();
  await afterSuccess.restore();
  assert.equal(afterSuccess.completed(context.sessionId).length, 1);
  await afterSuccess.acknowledge(afterSuccess.completed(context.sessionId).map((call) => call.id));
  assert.equal(afterSuccess.hasPending(context.sessionId), false);
});

test('检查中取消任务，不交付晚到的结果，也不重新创建待恢复任务', async () => {
  const response = defer();
  const started = defer();
  const { manager } = fixture(async () => { started.resolve(); return response.promise; });
  await manager.execute('douyin', 'douyin_search_users', args, context, async () => blocked());
  const checking = manager.check('douyin', 7, 'watch-1');
  await started.promise;
  await manager.cancelSession(context.sessionId);
  response.resolve(success);
  await checking;
  assert.equal(manager.hasPending(context.sessionId), false);
  assert.equal(manager.completed(context.sessionId).length, 0);
  assert.equal(manager.snapshot().length, 0);
});

test('取消其中一个会话不会取消其他会话的受阻查询', async () => {
  const { manager } = fixture();
  await manager.execute('douyin', 'douyin_search_users', args, context, async () => blocked());
  await manager.execute('douyin', 'douyin_search_users', args, { sessionId: 'session-2' }, async () => blocked());
  await manager.cancelSession(context.sessionId);
  await manager.check('douyin', 7, 'watch-1');
  assert.equal(manager.completed('session-1').length, 0);
  assert.equal(manager.completed('session-2').length, 1);
});

test('查询成功后才出现验证码，也会阻止接下来的同渠道请求', async () => {
  const { manager } = fixture();
  await manager.execute('douyin', 'douyin_search_users', args, context,
    async () => ({ ...success, data: { ...success.data, tab_id: 7, verification_watch_id: 'late' } }));
  assert.equal(await manager.verificationDetected(7, 'late'), true);
  let requests = 0;
  const result = await manager.execute('douyin', 'douyin_search_users', { ...args, cursor: 24 }, context,
    async () => { requests++; return success; });
  assert.equal(result.code, 'E_VERIFICATION_REQUIRED');
  assert.equal(requests, 0);
});

test('排队时取消的查询不会发出网络请求', async () => {
  const { manager } = fixture();
  const controller = new AbortController();
  controller.abort();
  let requests = 0;
  const result = await manager.execute('douyin', 'douyin_search_users', args,
    { ...context, signal: controller.signal }, async () => { requests++; return success; });
  assert.equal(result.code, 'E_CANCELLED');
  assert.equal(requests, 0);
});

test('检查状态写盘失败仍可再次手动检查，不会锁死在 checking', async () => {
  let fail = false;
  let requests = 0;
  const manager = new ChannelAccessCoordinator({ load: async () => [],
    save: async () => { if (fail) throw new Error('存储空间不足'); },
    run: async () => { requests++; return success; } });
  await manager.execute('douyin', 'douyin_search_users', args, context, async () => blocked());
  fail = true;
  await assert.rejects(manager.check('douyin', 7, 'watch-1'), /存储空间不足/);
  assert.equal(manager.snapshot()[0].status, 'waiting');
  assert.equal(requests, 0);
  fail = false;
  assert.equal(await manager.check('douyin', 7, 'watch-1'), true);
  assert.equal(requests, 1);
});

test('后台重启后的调试调用也遵守已持久化的渠道暂停状态', async () => {
  const f = fixture();
  await f.manager.execute('douyin', 'douyin_search_users', args, context, async () => blocked());
  const restarted = f.restart();
  let requests = 0;
  const result = await restarted.execute('douyin', 'douyin_search_users', args, {}, async () => { requests++; return success; });
  assert.equal(result.code, 'E_VERIFICATION_REQUIRED');
  assert.equal(requests, 0);
});
