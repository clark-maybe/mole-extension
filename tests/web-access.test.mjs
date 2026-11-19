import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Buffer } from 'node:buffer';
import { buildSync } from 'esbuild';
import { fileURLToPath, URL } from 'node:url';

const bundle = buildSync({ stdin: { contents: `
  export * from './src/lib/web-access';
  export * from './src/lib/web-navigation';
  export { guardWebTool } from './src/functions/web-access';
  export { fetchUrlFunction } from './src/functions/fetch-url';
  export { pageViewerFunction } from './src/functions/page-viewer';
  export { tabNavigateFunction } from './src/functions/tab-navigate';
  export { initPageParser } from './src/content/page-parser';
  export { waitForTabComplete } from './src/functions/tab-utils';
  export { sendToTabWithRetry } from './src/functions/tab-message';
  export { default as Channel } from './src/lib/channel';
  export { MCPServer } from './src/mcp/server';`,
  resolveDir: fileURLToPath(new URL('../', import.meta.url)) }, bundle: true,
  format: 'esm', platform: 'node', write: false });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const { WebAccessGuard, classifyWebPage, webFailureResult } = api;
const { AbortController } = globalThis;
const url = 'https://example.com/article';
const denied = (target = url) => webFailureResult(classifyWebPage({ status: 403 }), target);
const temporary = (target = url, delay) => webFailureResult({ code: 'E_WEB_TEMPORARY', message: '超时', retryable: true, retryAfterMs: delay }, target);
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('HTTP 状态和 200 拒绝页被分类，正常讨论错误码的文章不被误拦', () => {
  for (const status of [401, 403, 404, 410, 451]) assert.equal(classifyWebPage({ status }).retryable, false);
  for (const status of [429, 500, 503]) assert.equal(classifyWebPage({ status }).retryable, true);
  assert.equal(classifyWebPage({ title: '403 Forbidden', content: 'nginx' }).code, 'E_WEB_ACCESS_DENIED');
  assert.equal(classifyWebPage({ content: '拒绝访问' }).code, 'E_WEB_ACCESS_DENIED');
  assert.equal(classifyWebPage({ title: '正常文章', content: '访问正常，正文讨论 403 Forbidden 的解决方法。' }), undefined);
  assert.equal(classifyWebPage({ title: 'Access Denied 排查指南', content: '正常的技术文章。'.repeat(200) }), undefined);
  assert.equal(classifyWebPage({ title: '技术说明', content: '拒绝访问的常见原因包括权限配置错误。' }), undefined);
  assert.equal(classifyWebPage({ title: 'HTTP 说明', content: 'Access Denied is a common response to missing permissions.' }), undefined);
  assert.equal(classifyWebPage({ content: '' }).code, 'E_WEB_EMPTY');
});

test('同 URL 不同展示参数与追踪参数共用封禁，其他页面和业务查询仍能访问', async () => {
  const guard = new WebAccessGuard();
  let requests = 0;
  await guard.execute(`${url}?utm_source=baidu#intro`, async () => { requests++; return denied(); });
  const result = await guard.execute(url, async () => { requests++; return { success: true }; });
  assert.equal(result.code, 'E_WEB_ACCESS_BLOCKED');
  await guard.execute(`${url}?page=2`, async () => { requests++; return { success: true }; });
  await guard.execute('https://example.com/other', async () => { requests++; return { success: true }; });
  assert.equal(requests, 3);
});

test('并发排队的同目标只发起一次失败请求，跳转后的真实 URL 也被阻断', async () => {
  const guard = new WebAccessGuard();
  const response = defer();
  const source = 'https://www.baidu.com/link?url=opaque';
  let requests = 0;
  const run = async () => { requests++; await response.promise; return denied(); };
  const first = guard.execute(source, run);
  const second = guard.execute(source, run);
  response.resolve();
  assert.deepEqual((await Promise.all([first, second])).map(result => result.code), ['E_WEB_ACCESS_DENIED', 'E_WEB_ACCESS_BLOCKED']);
  assert.equal((await guard.execute(url, run)).code, 'E_WEB_ACCESS_BLOCKED');
  assert.equal(requests, 1);
});

test('临时失败按指数退避且最多三次，遵守 Retry-After；成功清除旧失败', async () => {
  let now = 100;
  const guard = new WebAccessGuard([], () => now);
  let requests = 0;
  const run = async () => { requests++; return temporary(); };
  await guard.execute(url, run);
  assert.equal((await guard.execute(url, run)).code, 'E_WEB_BACKOFF');
  now += 1000; await guard.execute(url, run);
  now += 1999; assert.equal((await guard.execute(url, run)).code, 'E_WEB_BACKOFF');
  now++; await guard.execute(url, run);
  now += 100_000; assert.equal((await guard.execute(url, run)).code, 'E_WEB_ACCESS_BLOCKED');
  assert.equal(requests, 3);
  const recovered = new WebAccessGuard([], () => now);
  await recovered.execute(url, async () => temporary(url, 60_000));
  now += 59_999;
  assert.equal(recovered.blocked(url).code, 'E_WEB_BACKOFF');
  now++;
  await recovered.execute(url, async () => ({ success: true }));
  assert.equal(recovered.snapshot().length, 0);
});

test('检查点恢复保留封禁和冷却；新任务可重新尝试；取消不计入失败', async () => {
  const guard = new WebAccessGuard();
  await guard.execute(url, async () => denied());
  const restored = new WebAccessGuard(JSON.parse(JSON.stringify(guard.snapshot())));
  let requests = 0;
  assert.equal((await restored.execute(url, async () => { requests++; return denied(); })).code, 'E_WEB_ACCESS_BLOCKED');
  await new WebAccessGuard().execute(url, async () => { requests++; return { success: true }; });
  assert.equal(requests, 1);
  const controller = new AbortController(); controller.abort();
  const fresh = new WebAccessGuard();
  await fresh.execute(url, async () => { requests++; return denied(); }, controller.signal);
  assert.equal(requests, 1); assert.equal(fresh.snapshot().length, 0);
});

test('MCP 跨 fetch/open/page 共用访问限制，拒绝后不新开标签页', async () => {
  const originalChrome = globalThis.chrome;
  const guard = new WebAccessGuard();
  let opened = 0; let read = 0;
  globalThis.chrome = { tabs: { get: async () => ({ url }), create: async () => { opened++; return { id: 9 }; } } };
  try {
    const server = new api.MCPServer();
    server.registerTool({ name: 'fetch_url', supportsParallel: true, parameters: { type: 'object' },
      execute: async () => { read++; return denied(); } });
    server.registerTool(api.tabNavigateFunction);
    server.registerTool({ name: 'page', supportsParallel: true, parameters: { type: 'object' }, execute: async () => { read++; return { success: true }; } });
    const call = async (name, args) => JSON.parse((await server.handleRequest('tools/call', {
      name, arguments: args, _meta: { tabId: 9, webAccess: guard },
    })).content[0].text);
    await call('fetch_url', { url });
    assert.equal((await call('tab_navigate', { action: 'open', url: `${url}#again` })).code, 'E_WEB_ACCESS_BLOCKED');
    assert.equal((await call('page', { action: 'snapshot' })).code, 'E_WEB_ACCESS_BLOCKED');
    assert.equal(opened, 0); assert.equal(read, 1);
  } finally { globalThis.chrome = originalChrome; }
});

test('真实内容解析器把拒绝页返回为结构化失败，读取工具保留错误码', async () => {
  const oldDocument = globalThis.document, oldWindow = globalThis.window, oldChrome = globalThis.chrome;
  const oldOn = api.Channel.on, oldSend = api.Channel.sendToTab;
  let handler;
  api.Channel.on = (_type, listener) => { handler = listener; };
  globalThis.document = { title: '403 Forbidden', body: { innerText: '拒绝访问' }, querySelector: () => null };
  globalThis.window = { location: { href: url, origin: 'https://example.com' } };
  globalThis.chrome = { runtime: {} };
  try {
    api.initPageParser();
    api.Channel.sendToTab = (_tab, _type, data, callback) => handler(data, {}, callback);
    const result = await api.pageViewerFunction.execute({}, { tabId: 1 });
    assert.equal(result.success, false); assert.equal(result.code, 'E_WEB_ACCESS_DENIED');
    assert.equal(result.retryable, false); assert.equal(result.data.url, url);
  } finally {
    api.Channel.on = oldOn; api.Channel.sendToTab = oldSend;
    globalThis.document = oldDocument; globalThis.window = oldWindow; globalThis.chrome = oldChrome;
  }
});

test('已完成的导航不再等超时，等待器移除监听', async () => {
  const oldChrome = globalThis.chrome;
  const listeners = new Set();
  globalThis.chrome = { tabs: { get: async () => ({ status: 'complete' }), onUpdated: {
    addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener),
  } } };
  try { await api.waitForTabComplete(1, 500, '不应超时'); assert.equal(listeners.size, 0); }
  finally { globalThis.chrome = oldChrome; }
});

test('真实 fetch_url 遇到主文档 403 直接失败并关闭临时页，不再尝试解析', async () => {
  const oldChrome = globalThis.chrome;
  let created = 0, removed = 0;
  globalThis.chrome = { tabs: { create: async () => { created++; return { id: 99 }; },
    get: async () => ({ status: 'complete' }), remove: async () => { removed++; },
    onUpdated: { addListener: () => {}, removeListener: () => {} } } };
  try {
    const result = await api.fetchUrlFunction.execute({ url }, {
      webNavigation: { get: () => ({ url, status: 403 }) },
    });
    assert.equal(result.code, 'E_WEB_ACCESS_DENIED');
    assert.equal(created, 1); assert.equal(removed, 1);
  } finally { globalThis.chrome = oldChrome; }
});

test('等待导航不会把仍有 pendingUrl 的旧文档 complete 当作新页完成', async () => {
  const oldChrome = globalThis.chrome;
  let listener;
  globalThis.chrome = { tabs: { get: async () => ({ status: 'complete', pendingUrl: url }), onUpdated: {
    addListener: callback => { listener = callback; }, removeListener: () => {},
  } } };
  try {
    let completed = false;
    const task = api.waitForTabComplete(1, 500, '不应超时').then(() => { completed = true; });
    await Promise.resolve(); await Promise.resolve(); assert.equal(completed, false);
    listener(1, { status: 'complete' }, { url, status: 'complete' });
    await task; assert.equal(completed, true);
  } finally { globalThis.chrome = oldChrome; }
});

test('页面通信取消后，不会在迟到的注入结果之后重新发送', async t => {
  const oldChrome = globalThis.chrome, oldSend = api.Channel.sendToTab;
  const injection = defer(); let sends = 0;
  globalThis.chrome = { runtime: { lastError: { message: 'Could not establish connection. Receiving end does not exist.' } },
    tabs: { get: async () => ({ url }) }, scripting: { executeScript: () => injection.promise } };
  api.Channel.sendToTab = (_tab, _type, _data, callback) => { sends++; callback(); };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const controller = new AbortController();
    const task = api.sendToTabWithRetry(1, 'read', {}, { signal: controller.signal });
    await Promise.resolve(); await Promise.resolve();
    controller.abort(); await assert.rejects(task, { name: 'AbortError' });
    injection.resolve(); await Promise.resolve(); await Promise.resolve();
    t.mock.timers.tick(20_000); await Promise.resolve();
    assert.equal(sends, 1);
  } finally { api.Channel.sendToTab = oldSend; globalThis.chrome = oldChrome; t.mock.timers.reset(); }
});

test('页面通信截止后，不会被迟到的注入结果重新启动', async t => {
  const oldChrome = globalThis.chrome, oldSend = api.Channel.sendToTab;
  const injection = defer(); let sends = 0;
  globalThis.chrome = { runtime: { lastError: { message: 'Receiving end does not exist' } },
    tabs: { get: async () => ({ url }) }, scripting: { executeScript: () => injection.promise } };
  api.Channel.sendToTab = (_tab, _type, _data, callback) => { sends++; callback(); };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const task = api.sendToTabWithRetry(1, 'read', {}, { deadlineMs: 1000 });
    await Promise.resolve(); await Promise.resolve();
    t.mock.timers.tick(1000); await assert.rejects(task, /连接超时/);
    injection.resolve(); await Promise.resolve(); await Promise.resolve();
    t.mock.timers.tick(20_000); await Promise.resolve(); assert.equal(sends, 1);
  } finally { api.Channel.sendToTab = oldSend; globalThis.chrome = oldChrome; t.mock.timers.reset(); }
});

test('主文档 HTTP 状态含 Retry-After，迟到的拒绝能阻止再次打开搜索跳转链接', async () => {
  const oldChrome = globalThis.chrome;
  const event = () => { const callbacks = new Set(); return { callbacks,
    addListener: callback => callbacks.add(callback), removeListener: callback => callbacks.delete(callback),
    emit: details => { for (const callback of callbacks) callback(details); } }; };
  const before = event(), headers = event(), errors = event(), removed = event();
  globalThis.chrome = { webRequest: { onBeforeRequest: before, onHeadersReceived: headers, onErrorOccurred: errors },
    tabs: { onRemoved: removed, get: async () => ({ status: 'complete' }),
      onUpdated: { addListener: () => {}, removeListener: () => {} } } };
  const observer = new api.WebNavigationObserver();
  try {
    observer.start(); headers.emit({ tabId: 7, url, statusCode: 429, responseHeaders: [{ name: 'Retry-After', value: '30' }] });
    assert.equal(observer.get(7).retryAfterMs, 30_000);
    assert.equal(observer.reportOnce(observer.get(7)), true);
    assert.equal(observer.reportOnce(observer.get(7)), false);
    const source = 'https://www.baidu.com/link?url=opaque', guard = new WebAccessGuard();
    let requests = 0;
    await api.guardWebTool('tab_navigate', { action: 'open', url: source }, { webAccess: guard, webNavigation: observer },
      async () => { requests++; before.emit({ tabId: 7 }); return { success: true, data: { tab_id: 7 } }; });
    headers.emit({ tabId: 7, url, statusCode: 403 });
    const blocked = await api.guardWebTool('fetch_url', { url: source }, { webAccess: guard, webNavigation: observer },
      async () => { requests++; return { success: true }; });
    assert.equal(blocked.code, 'E_WEB_ACCESS_DENIED'); assert.equal(requests, 1);
    before.emit({ tabId: 7 }); assert.equal(observer.get(7), undefined);
    errors.emit({ tabId: 7, url, error: 'net::ERR_CONNECTION_REFUSED' });
    assert.equal(observer.get(7).error, 'net::ERR_CONNECTION_REFUSED');
    removed.emit(7); assert.equal(observer.get(7), undefined);
    let now = 0;
    const slow = 'https://example.com/slow', transientGuard = new WebAccessGuard([], () => now);
    const access = { webAccess: transientGuard, webNavigation: observer };
    const open = () => api.guardWebTool('tab_navigate', { action: 'open', url: slow }, access,
      async () => { requests++; headers.emit({ tabId: 8, url: slow, statusCode: 200 }); return { success: true, data: { tab_id: 8 } }; });
    headers.emit({ tabId: 8, url: slow, statusCode: 429, responseHeaders: [{ name: 'Retry-After', value: '30' }] });
    assert.equal((await open()).code, 'E_WEB_TEMPORARY');
    assert.equal((await open()).code, 'E_WEB_BACKOFF');
    now = 30_000;
    assert.equal((await open()).success, true);
    assert.equal(requests, 2);
    const always = 'https://example.com/always-429', limited = new WebAccessGuard([], () => now);
    const openLimited = () => api.guardWebTool('tab_navigate', { action: 'open', url: always },
      { webAccess: limited, webNavigation: observer }, async () => {
        requests++; headers.emit({ tabId: 9, url: always, statusCode: 429 });
        return { success: true, data: { tab_id: 9 } };
      });
    assert.equal((await openLimited()).code, 'E_WEB_TEMPORARY');
    now += 1000; assert.equal((await openLimited()).code, 'E_WEB_TEMPORARY');
    now += 2000; assert.equal((await openLimited()).code, 'E_WEB_TEMPORARY');
    now += 100_000; assert.equal((await openLimited()).code, 'E_WEB_ACCESS_BLOCKED');
    assert.equal(requests, 5);
    observer.stop();
    for (const item of [before, headers, errors, removed]) assert.equal(item.callbacks.size, 0);
  } finally { observer.stop(); globalThis.chrome = oldChrome; }
});
