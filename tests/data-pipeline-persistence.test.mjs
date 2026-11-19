import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSync } from 'esbuild';
import { Buffer } from 'node:buffer';
import { fileURLToPath, URL } from 'node:url';
const { structuredClone } = globalThis;

const bundle = buildSync({ entryPoints: [fileURLToPath(new URL('../src/functions/data-pipeline.ts', import.meta.url))],
  bundle: true, format: 'esm', platform: 'node', write: false });
let generation = 0;
const load = async () => (await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text + `\n// restart-${generation++}`).toString('base64')}`)).dataPipelineFunction;

test('数据缓冲区在后台重启后保留，可继续追加、去重及删除', async () => {
  const originalChrome = globalThis.chrome;
  const stored = {};
  globalThis.chrome = { runtime: {}, storage: { local: {
    get: (key, done) => done({ [key]: structuredClone(stored[key]) }),
    set: (data, done) => { Object.assign(stored, structuredClone(data)); done(); },
  } } };
  try {
    const first = await load();
    const created = await first.execute({ action: 'create', name: '线索' });
    const buffer_id = created.data.buffer_id;
    await first.execute({ action: 'append', buffer_id, data: [{ uid: '7542423044858446906', name: '门店' }] });
    const restarted = await load();
    const preview = await restarted.execute({ action: 'preview', buffer_id });
    assert.equal(preview.data.items[0].uid, '7542423044858446906');
    await restarted.execute({ action: 'append', buffer_id, data: [{ uid: 'new', name: '另一门店' }] });
    const third = await load();
    assert.equal((await third.execute({ action: 'stats', buffer_id })).data.count, 2);
    await third.execute({ action: 'clear', buffer_id });
    assert.equal((await (await load()).execute({ action: 'preview', buffer_id })).success, false);
  } finally { globalThis.chrome = originalChrome; }
});

test('持久化失败不会报告数据已经安全保存', async () => {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = { runtime: {}, storage: { local: {
    get: (_key, done) => done({}),
    set: (_data, done) => {
      globalThis.chrome.runtime.lastError = { message: '存储空间不足' };
      done(); delete globalThis.chrome.runtime.lastError;
    },
  } } };
  try {
    const result = await (await load()).execute({ action: 'create', name: '线索' });
    assert.equal(result.success, false);
    assert.match(result.error, /存储空间不足/);
  } finally { globalThis.chrome = originalChrome; }
});
