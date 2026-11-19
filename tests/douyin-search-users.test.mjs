import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { setTimeout, clearTimeout } from 'node:timers';
import { test } from 'node:test';
import { fileURLToPath, URL, URLSearchParams } from 'node:url';
import vm from 'node:vm';
import { buildSync } from 'esbuild';

// 打包后再跨执行环境运行，覆盖 MAIN world 注入时闭包依赖丢失的边界。
const bundle = buildSync({
  stdin: {
    contents: `export { douyinSearchUsersFunction as tool } from './src/functions/douyin-search-users';
      export { ALWAYS_ON_TOOLS } from './src/functions/tool-tiers';
      export { EXPLORE_ALLOWED_TOOLS } from './src/ai/loop-config';`,
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
});
const { tool, ALWAYS_ON_TOOLS, EXPLORE_ALLOWED_TOOLS } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);

const user = {
  uid: '7542423044858446906',
  sec_uid: 'MS4w.example',
  unique_id: 'restaurant123',
  nickname: '武汉餐饮店',
  signature: '武汉门店，欢迎咨询',
  custom_verify: '',
  enterprise_verify_reason: '',
  follower_count: 123,
  total_favorited: 456,
};

function browser({ tabs = [{ id: 7, active: true }], response, httpStatus = 200, fetchError,
  timeout = false, captcha, searchReady = true, captchaType = 'container',
  iframeSrc = 'https://rmc.bytedance.com/verifycenter/captcha/v2?from=iframe&fp=example' } = {}) {
  const requests = [];
  const created = [];
  const removed = [];
  const injectedTabs = [];
  const pageNotices = [];
  const observers = [];
  const watcherInstalls = [];
  let captchaVisible = captcha === 'before';
  let currentIframeSrc = captcha === 'src-change' ? 'about:blank' : iframeSrc;
  const matchesCaptcha = (selector) => selector.split(',').some((part) => {
    const candidate = part.trim();
    if (captchaType === 'container') return candidate === '#captcha_container';
    const prefix = candidate.match(/^iframe\[src\^="([^"]+)"\]$/)?.[1];
    return prefix && currentIframeSrc.startsWith(prefix);
  });
  const originalChrome = globalThis.chrome;
  globalThis.chrome = {
    tabs: {
      query: async () => tabs,
      create: async (options) => { created.push(options); return { id: 99 }; },
      remove: async (id) => { removed.push(id); },
    },
    scripting: {
      executeScript: async ({ target, world, func, args = [] }) => {
        if (world === 'ISOLATED') {
          (args[1] === 'watch' ? watcherInstalls : pageNotices)
            .push({ tabId: target.tabId, state: args[1], keyword: args[0],
              ...(args[1] === 'watch' ? { watchId: args[3] } : {}) });
          return [{ result: undefined }];
        }
        assert.equal(world, 'MAIN');
        injectedTabs.push(target.tabId);
        const page = vm.createContext({
          location: { origin: 'https://www.douyin.com' },
          document: { body: {}, documentElement: {}, querySelector: (selector) =>
            selector === 'input[placeholder*="搜索"]' ? (searchReady ? {} : null)
              : (captchaVisible && matchesCaptcha(selector) ? {} : null),
            querySelectorAll: (selector) => captchaVisible && matchesCaptcha(selector) ? [{ getClientRects: () => [{}] }] : [] },
          MutationObserver: class {
            constructor(callback) { this.callback = callback; observers.push(this); }
            observe(_target, options) { this.connected = true; this.options = options; }
            disconnect() { this.connected = false; }
          },
          URL, URLSearchParams, setTimeout: timeout ? (fn) => setTimeout(fn, 0) : setTimeout, clearTimeout,
          AbortController: globalThis.AbortController,
          fetch: async (url, options) => {
            requests.push({ url: new URL(url), options });
            if (captcha === 'during' || captcha === 'src-change') await new Promise((resolve, reject) => {
              options.signal.addEventListener('abort', () => reject(new Error('request aborted')), { once: true });
              captchaVisible = true;
              if (captcha === 'src-change') currentIframeSrc = iframeSrc;
              for (const observer of observers) if (observer.connected
                && (captcha !== 'src-change' || observer.options.attributeFilter.includes('src'))) observer.callback();
              if (!options.signal.aborted) resolve();
            });
            if (captcha === 'response') captchaVisible = true;
            if (fetchError) throw fetchError;
            if (timeout) await new Promise((_, reject) => {
              options.signal.addEventListener('abort', () => reject(new Error('request aborted')), { once: true });
            });
            const cursor = Number(new URL(url).searchParams.get('offset'));
            const data = typeof response === 'function' ? response(cursor) : response ?? {
              status_code: 0,
              user_list: [{ user_info: user }],
              input_keyword: new URL(url).searchParams.get('keyword'),
              cursor: cursor + 1,
              has_more: 1,
              rid: 'search-123',
            };
            return { ok: httpStatus < 400, status: httpStatus, text: async () => {
              if (captcha === 'body') captchaVisible = true;
              return typeof data === 'string' ? data : JSON.stringify(data);
            } };
          },
        });
        const injected = vm.runInContext(`(${func.toString()})`, page);
        return [{ result: await injected(...args) }];
      },
    },
  };
  return { requests, created, removed, injectedTabs, pageNotices, observers, watcherInstalls,
    clearCaptcha: () => { captchaVisible = false; }, restore: () => { globalThis.chrome = originalChrome; } };
}

test('用户搜索默认可见，探索 Agent 可用', () => {
  assert.ok(ALWAYS_ON_TOOLS.has(tool.name));
  assert.ok(EXPLORE_ALLOWED_TOOLS.has(tool.name));
});

test('搜索在 MAIN world 执行，保留大整数 ID 和原始资料，并可继续翻页', async () => {
  const fixture = browser({ response: (cursor) => ({
    status_code: 0, user_list: [{ user_info: user }],
    cursor: cursor + 1, has_more: 1,
    rid: `request-${cursor}`,
    log_pb: { impr_id: cursor === 0 ? 'search-123' : 'later-request-id' },
  }) });
  try {
    const first = await tool.execute({ keyword: ' 武汉 餐饮 ', count: 1 });
    assert.equal(first.success, true);
    assert.equal(first.data.tab_id, 7);
    assert.equal(first.data.verification_watch_id, fixture.watcherInstalls[0].watchId);
    assert.equal(first.data.items[0].uid, user.uid);
    assert.equal(first.data.items[0].signature, user.signature);
    assert.equal(first.data.items[0].enterprise_verify_reason, '');
    assert.equal(first.data.items[0].profile_url, `https://www.douyin.com/user/${user.sec_uid}`);
    assert.equal(first.data.cursor, 1);
    const second = await tool.execute({ keyword: '武汉 餐饮', count: 1,
      cursor: first.data.cursor, search_id: first.data.search_id });
    assert.equal(second.data.cursor, 2);
    assert.notEqual(second.data.verification_watch_id, first.data.verification_watch_id);
    assert.equal(second.data.search_id, first.data.search_id);
    assert.equal(fixture.requests[0].url.searchParams.get('keyword'), '武汉 餐饮');
    assert.equal(fixture.requests[1].url.searchParams.get('offset'), '1');
    assert.equal(fixture.requests[1].url.searchParams.get('search_id'), 'search-123');
    assert.equal(fixture.requests[0].options.credentials, 'include');
    assert.deepEqual(Object.keys(fixture.requests[0].options.headers), ['accept']);
    for (const key of ['a_bogus', 'msToken', 'uifid', 'webid', 'verifyFp', 'fp']) {
      assert.equal(fixture.requests[0].url.searchParams.has(key), false);
    }
    assert.deepEqual(fixture.created, []);
    assert.deepEqual(fixture.removed, []);
  } finally { fixture.restore(); }
});

test('参数错误和预先取消不会触发浏览器请求', async () => {
  const fixture = browser();
  try {
    for (const params of [{ keyword: ' ' }, { keyword: 'x', count: 21 },
      { keyword: 'x', count: 1.2 }, { keyword: 'x', cursor: -1 },
      { keyword: 'x', cursor: Number.MAX_SAFE_INTEGER + 1 }, { keyword: 'x', tab_id: 0 }]) {
      assert.equal((await tool.execute(params)).success, false);
    }
    const controller = new globalThis.AbortController();
    controller.abort();
    assert.equal((await tool.execute({ keyword: 'x' }, { signal: controller.signal })).error, '操作已取消');
    assert.equal(fixture.injectedTabs.length, 0);
  } finally { fixture.restore(); }
});

test('明确区分空结果、无效响应、业务错误和无进展的游标', async () => {
  const cases = [
    { response: { status_code: 0, user_list: [], cursor: 0, has_more: 0 }, success: true },
    { response: { status_code: 0, user_list: null, cursor: 0, has_more: 0 }, success: true },
    { response: '<html>请登录</html>', success: false },
    { response: { status_code: 8 }, success: false },
    { response: { status_code: 0 }, success: false },
    { response: { status_code: 0, user_list: [{}], cursor: 1, has_more: 0 }, success: false },
    { response: { status_code: 0, user_list: [], cursor: 0, has_more: 1 }, success: false },
    { httpStatus: 403, success: false },
    { fetchError: new Error('network error'), success: false },
  ];
  for (const item of cases) {
    const fixture = browser(item);
    try {
      const result = await tool.execute({ keyword: 'x' });
      assert.equal(result.success, item.success);
      if (item.success) {
        assert.equal(result.data.count, 0);
        assert.equal(result.data.has_more, false);
      } else { assert.ok(result.error); }
    } finally { fixture.restore(); }
  }
});

test('查询拒绝和登录失效返回明确登录状态及快捷链接', async () => {
  const cases = [
    { httpStatus: 401 },
    { httpStatus: 403 },
    { response: { status_code: 8 } },
    { response: { status_code: 4, status_msg: '查询被拒绝' } },
    { response: { status_code: 100, message: '请先登录' } },
    { response: { status_code: 100, status_message: 'Login required' } },
    { response: { status_code: 100, data: { description: '登录已失效' } } },
    { response: '<html>请登录后重试</html>' },
  ];
  for (const item of cases) {
    const fixture = browser(item);
    try {
      const result = await tool.execute({ keyword: '武汉 餐饮' });
      assert.equal(result.success, false);
      assert.equal(result.code, 'E_AUTH_REQUIRED');
      assert.equal(result.data.login_required, true);
      assert.equal(result.data.login_url, 'https://www.douyin.com/');
      assert.match(result.error, /查询被拒绝.*登录/);
    } finally { fixture.restore(); }
  }
});

test('网络异常、限流、服务错误和正常空结果不误报未登录', async () => {
  const cases = [
    { httpStatus: 429 },
    { httpStatus: 500 },
    { fetchError: new Error('network error') },
    { timeout: true },
    { response: { status_code: 100, status_msg: '系统繁忙' } },
    { response: '<html>服务维护</html>' },
    { response: '' },
    { response: { status_code: 0, user_list: [], cursor: 0, has_more: 0 } },
    { response: { status_code: 0, user_list: null, cursor: 0, has_more: 0 } },
  ];
  for (const item of cases) {
    const fixture = browser(item);
    try {
      const result = await tool.execute({ keyword: '武汉 餐饮' });
      assert.notEqual(result.code, 'E_AUTH_REQUIRED');
      if (item.timeout) assert.match(result.error, /超时/);
    } finally { fixture.restore(); }
  }
});

test('优先使用显式或上下文标签页，错误标签页不会被导航', async () => {
  const fixture = browser({ tabs: [{ id: 7, active: true }, { id: 8, active: false }] });
  try {
    assert.equal((await tool.execute({ keyword: 'x' }, { tabId: 8 })).success, true);
    assert.equal(fixture.injectedTabs[0], 8);
    assert.equal((await tool.execute({ keyword: 'x', tab_id: 7 }, { tabId: 8 })).success, true);
    assert.equal(fixture.injectedTabs[2], 7);
    assert.equal((await tool.execute({ keyword: 'x', tab_id: 10 })).success, false);
    assert.equal(fixture.requests.length, 2);
    assert.equal(fixture.created.length, 0);
  } finally { fixture.restore(); }
});

test('没有抖音标签页时临时打开后台页面，成功或失败后均清理', async () => {
  for (const httpStatus of [200, 500]) {
    const fixture = browser({ tabs: [], httpStatus });
    try {
      const result = await tool.execute({ keyword: 'x' }, { tabId: 1 });
      assert.equal(result.success, httpStatus === 200);
      assert.deepEqual(fixture.created, [{ url: 'https://www.douyin.com/', active: false }]);
      assert.deepEqual(fixture.removed, [99]);
    } finally { fixture.restore(); }
  }
});

test('验证出现在搜索前、请求期间或读取响应时，均返回人工验证状态', async () => {
  for (const captcha of ['before', 'during', 'response', 'body']) {
    const fixture = browser({ captcha, searchReady: captcha !== 'before' });
    try {
      const result = await tool.execute({ keyword: '武汉 餐饮' });
      assert.equal(result.code, 'E_VERIFICATION_REQUIRED');
      assert.equal(result.data.verification_required, true);
      assert.equal(result.data.tab_id, 7);
      assert.match(result.error, /手动完成验证/);
      assert.equal(fixture.requests.length, captcha === 'before' ? 0 : 1);
      assert.deepEqual(fixture.pageNotices, [{ tabId: 7, state: 'verification', keyword: '武汉 餐饮' }]);
      assert.ok(fixture.observers.every((observer) => !observer.connected));
    } finally { fixture.restore(); }
  }
});

test('需要登录或验证的临时标签页保留，便于用户处理当前页面', async () => {
  for (const scenario of [{ httpStatus: 403 }, { captcha: 'before' }]) {
    const fixture = browser({ tabs: [], ...scenario });
    try {
      const result = await tool.execute({ keyword: '武汉 餐饮' });
      assert.equal(result.success, false);
      assert.equal(result.data.tab_id, 99);
      assert.deepEqual(fixture.removed, []);
      assert.equal(fixture.pageNotices[0].state, scenario.captcha ? 'verification' : 'login');
    } finally { fixture.restore(); }
  }
});

test('完成验证后可重新查询，成功时清除页面顶部提醒', async () => {
  const fixture = browser({ captcha: 'before' });
  try {
    assert.equal((await tool.execute({ keyword: '武汉 餐饮' })).code, 'E_VERIFICATION_REQUIRED');
    fixture.clearCaptcha();
    assert.equal((await tool.execute({ keyword: '武汉 餐饮' })).success, true);
    assert.deepEqual(fixture.pageNotices.map((notice) => notice.state), ['verification', null]);
  } finally { fixture.restore(); }
});

test('无需访问跨域内容，通过外层 iframe 地址识别验证码和 src 变化', async () => {
  for (const captcha of ['before', 'during', 'response', 'body', 'src-change']) {
    const fixture = browser({ captcha, captchaType: 'iframe', searchReady: captcha !== 'before' });
    try {
      const result = await tool.execute({ keyword: '汽车贴膜' });
      assert.equal(result.code, 'E_VERIFICATION_REQUIRED');
      assert.equal(result.data.tab_id, 7);
      assert.equal(fixture.requests.length, captcha === 'before' ? 0 : 1);
      assert.equal(fixture.pageNotices[0].state, 'verification');
      if (captcha === 'during' || captcha === 'src-change') {
        assert.equal(fixture.requests[0].options.signal.aborted, true);
      }
      assert.ok(fixture.observers.every((observer) => !observer.connected));
    } finally { fixture.restore(); }
  }
});

test('验证码匹配限定域名和路径，普通 iframe 不影响查询', async () => {
  for (const iframeSrc of [
    'https://example.com/verifycenter/captcha/v2',
    'https://rmc.bytedance.com.example.com/verifycenter/captcha/v2',
    'https://rmc.bytedance.com/other?next=/verifycenter/captcha/v2',
  ]) {
    const fixture = browser({ captcha: 'before', captchaType: 'iframe', iframeSrc });
    try { assert.equal((await tool.execute({ keyword: '汽车贴膜' })).success, true); }
    finally { fixture.restore(); }
  }
  const fixture = browser({ captcha: 'before', captchaType: 'iframe',
    iframeSrc: '//rmc.bytedance.com/verifycenter/captcha/v2?from=iframe' });
  try { assert.equal((await tool.execute({ keyword: '汽车贴膜' })).code, 'E_VERIFICATION_REQUIRED'); }
  finally { fixture.restore(); }
});
