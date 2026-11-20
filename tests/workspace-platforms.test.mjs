import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundle = buildSync({ stdin: { contents: `export {parseCompanySearchPayload} from './src/platforms/company-parser'; export {businessJson, runReadPageJob} from './src/platforms/page-job'; export {CDPSessionManager} from './src/lib/cdp-session'; export {workspaceRepository} from './src/lib/workspace-db/repository';`, resolveDir: fileURLToPath(new URL('../', import.meta.url)) }, bundle: true, format: 'esm', platform: 'node', write: false });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('企业解析区分正常空结果和格式变化，保留法人和可用联系方式', () => {
  assert.deepEqual(api.parseCompanySearchPayload({ success: true, data: { items: [], total: 0 } }, 'lixiaoyun').items, []);
  assert.throws(() => api.parseCompanySearchPayload({ success: true, data: { total: 0 } }, 'lixiaoyun'), /items/);
  const data = api.parseCompanySearchPayload({ success: true, code: 20000, data: { list: [{ entid: 'c1', entName: '贴膜企业', faren: '张某', uniscid: 'credit-1', tels: ['13800000000'] }], total: 1 } }, 'fengniaoyun');
  assert.equal(data.items[0].legalPerson, '张某'); assert.equal(data.items[0].contact, '13800000000');
});

test('证据保留抖音简介，移除平台鉴权与调试请求字段', () => {
  assert.deepEqual(api.businessJson({ signature: '主营汽车贴膜', authorization: 'private', app_token: 'private', sign: 'private', nested: { headers: { token: 'private' }, companyName: '贴膜企业' } }), { signature: '主营汽车贴膜', nested: { companyName: '贴膜企业' } });
});

test('企业与联系人查询无 CRM 也可执行，平台自身登录失败仍保留任务页签', async () => {
  const originalChrome = globalThis.chrome, originalFetch = globalThis.fetch;
  const originalSend = api.CDPSessionManager.sendCommand, originalDetach = api.CDPSessionManager.detachTab;
  const originalMeta = api.workspaceRepository.setMeta;
  const url = 'https://lxcrm.weiwenjia.com/soukebox/advanced_search';
  const attempt = { task: { id: 'independent-query' }, step: { attemptId: 'attempt-1' } };
  let response, creates = 0, removed = [], metadata = [];
  globalThis.chrome = {
    runtime: { getURL: file => `chrome-extension://fixture/${file}` },
    tabs: {
      query: async () => { throw new Error('查询不能依赖 CRM 页签'); },
      create: async () => ({ id: ++creates }), update: async () => {},
      get: async () => ({ url }), remove: async id => { removed.push(id); },
    },
    scripting: { executeScript: async () => [{ result: response }] },
  };
  globalThis.fetch = async () => ({ text: async () => '/* fixture provider hook */' });
  api.CDPSessionManager.sendCommand = async () => ({ success: true });
  api.CDPSessionManager.detachTab = async () => {};
  api.workspaceRepository.setMeta = async (key, value) => { metadata.push({ key, value }); };
  try {
    for (const file of ['workspace-lixiaoyun.js', 'workspace-contacts.js']) {
      response = { success: true, items: [] };
      assert.deepEqual(await api.runReadPageJob(attempt, url, file, 'fixture-source', '汽车贴膜'), response);
      assert.equal(metadata.at(-1).value, null);
    }
    response = { error: '励销云需要登录' };
    await assert.rejects(api.runReadPageJob(attempt, url, 'workspace-contacts.js', 'fixture-source', '汽车贴膜'), error => error.disposition === 'waiting' && /励销云需要登录/.test(error.message));
    assert.equal(creates, 3);
    assert.deepEqual(removed, [1, 2]);
    assert.equal(metadata.at(-1).value.retained, true);
  } finally {
    globalThis.chrome = originalChrome; globalThis.fetch = originalFetch;
    api.CDPSessionManager.sendCommand = originalSend; api.CDPSessionManager.detachTab = originalDetach;
    api.workspaceRepository.setMeta = originalMeta;
  }
});

test('平台页面 hook 只改目标接口，不改第三方请求体；可在独立 MAIN 环境运行', async () => {
  for (const [file, suffix] of [['workspace-lixiaoyun.js', '?keyword=汽车贴膜'], ['workspace-contacts.js', '?mode=contact&pid=c1&entName=贴膜企业']]) {
    const sent = [], fetched = [], posted = [];
    class XHR {
      open(method, url) { this.url = url; }
      setRequestHeader() {}
      send(body) { sent.push({ url: this.url, body }); }
      addEventListener() {}
    }
    const location = { href: `https://lxcrm.weiwenjia.com/soukebox/advanced_search${suffix}` };
    const window = { location, addEventListener() {}, postMessage(data) { posted.push(data); }, fetch: async (url, init) => { fetched.push({ url, init }); return { ok: true, status: 200, clone: () => ({ json: async () => ({ success: true, data: { items: [] } }) }) }; } };
    const context = vm.createContext({ window, location, URL, XMLHttpRequest: XHR, setTimeout, clearTimeout });
    vm.runInContext(await readFile(new URL(`../public/${file}`, import.meta.url), 'utf8'), context);
    const other = new XHR(); other.open('POST', 'https://other.example/api'); other.send('{"untouched":true}');
    assert.equal(sent[0].body, '{"untouched":true}');
    await window.fetch('https://other.example/api', { method: 'POST', body: '{"untouched":true}' });
    assert.equal(fetched[0].init.body, '{"untouched":true}');
    const target = new XHR(); target.open('POST', 'https://skb.weiwenjia.com/api_skb/v1/advanced_search'); target.send('{"keyword":"贴膜企业"}');
    assert.equal(JSON.parse(sent[1].body).pagesize, 10);
  }
});

test('CRM 页面实际请求使用 prepared 字段，账号变化后不发请求', async () => {
  const listeners = [], requests = [], posted = [], values = { enterprise_id: 'fixture-company', username: 'fixture-user' };
  class XHR {
    constructor() { this.events = {}; this.status = 200; this.responseText = '{"flag":1}'; }
    open() {} setRequestHeader() {}
    addEventListener(type, listener) { this.events[type] = listener; }
    send(body) { requests.push(JSON.parse(body)); this.events.load(); }
  }
  const location = { href: 'https://bdtg.n4.bjmantis.cn/mantis/tmk/myCustomer/first', hostname: 'bdtg.n4.bjmantis.cn', pathname: '/mantis/tmk/myCustomer/first' };
  const window = { location, localStorage: { getItem: key => values[key] || null }, addEventListener: (_type, listener) => listeners.push(listener), postMessage: value => posted.push(value), setTimeout: fn => fn() };
  const context = vm.createContext({ window, location, URL, XMLHttpRequest: XHR, document: { readyState: 'complete' } });
  vm.runInContext(await readFile(new URL('../public/workspace-crm.js', import.meta.url), 'utf8'), context);
  const fields = { customerCompanyName: '已确认企业', phone1: '13900000000', productId: 'frozen-product' };
  const targetIdentity = JSON.stringify({ host: location.hostname, enterpriseId: values.enterprise_id, username: values.username, serverName: '' });
  const execute = async () => {
    listeners[0]({ source: window, data: { source: '__mantis_customer_record_hook__', type: 'execute', jobId: crypto.randomUUID(), companies: [{ name: '后来修改的企业', contact: '13800000000' }], config: { targetIdentity, preparedFields: fields, verification: 'fixture-verification' } } });
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  await execute();
  assert.equal(requests[0].customerCompanyName, fields.customerCompanyName);
  assert.equal(requests[0].phone1, fields.phone1); assert.equal(requests[0].productId, fields.productId);
  values.username = 'other-user'; await execute();
  assert.equal(requests.length, 1); assert.match(posted.at(-1).error, /不匹配/);
});
