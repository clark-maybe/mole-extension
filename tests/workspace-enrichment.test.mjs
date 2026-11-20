import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({ stdin: { contents: `export * from './src/platforms/read-adapters'; export * from './src/platforms/company-enrichment'; export {workspaceRepository as repo} from './src/lib/workspace-db/repository'; export {calls, setReplies} from 'test-page-job';`, resolveDir: root }, bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'provider-page-fixture', setup(builder) {
    builder.onResolve({ filter: /\/page-job$|^test-page-job$/ }, () => ({ path: 'page', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ resolveDir: root, contents: `
      export {businessJson, PlatformError} from ${JSON.stringify(`${root}src/platforms/page-job.ts`)};
      export const calls = []; let replies = [];
      export function setReplies(values) { replies = values; calls.length = 0; }
      export async function runReadPageJob(attempt, url, file) { calls.push({url,file}); if (!replies.length) throw new Error('Unexpected provider request'); return replies.shift(); }
    ` }));
  } }] });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
after(async () => { await api.repo.database.close(); });
const company = (id, name) => ({ id, companyName: name, legalperson: '张三', socialCreditCode: `credit-${id}`, address: '上海' });
async function prepare(id, keyword, provider = 'lixiaoyun') {
  await api.repo.saveSession({ id, summary: id, status: 'done', context: [], eventLog: [], createdAt: 1, startedAt: 1, agentState: { phase: 'idle', round: 0, reason: '', updatedAt: 1 } });
  await api.repo.createTask({ id, sessionId: id, kind: 'company_search', provider, title: keyword, input: { keyword, enrichContacts: true }, maxBatches: 2 });
  return api.repo.claimTask(id);
}

test('精确企业查询先落档再补全法人手机号，重启从联系人检查点接续不重复搜索', async () => {
  const name = '上海示例贴膜有限公司';
  const first = await prepare('precise', name);
  api.setReplies([{ payload: { success: true, data: { total: 2, items: [company('one', name), company('two', '相似企业有限公司')] } } },
    { phone: '02188888888', details: [{ content: '02188888888', contactName: '前台', type: '2' }, { content: '+86 138-0000-0000', contactName: '张三', position: '经理', type: '1', valid: true }] }]);
  const batch = await api.searchCompanies(first);
  assert.equal(batch.done, false); assert.equal(batch.leads.length, 1); assert.equal(batch.checkpoint.stage, 'contacts');
  await api.repo.commitBatch(first, batch);
  await api.repo.claimTask('precise', Date.now() + 5000);
  await api.repo.recover();
  const second = await api.repo.claimTask('precise');
  await api.repo.commitBatch(second, await api.searchCompanies(second));
  const task = await api.repo.getTask('precise'), [lead] = await api.repo.listLeads('precise');
  assert.equal(task.status, 'completed'); assert.equal(task.savedCount, 1); assert.equal(task.batches, 2);
  assert.equal(lead.fields.legalPersonPhone, '13800000000'); assert.equal(lead.fields.contact, '13800000000');
  const detail = await api.repo.readLead(lead.id), fact = detail.facts.find(row => row.field === 'legalPersonPhone');
  assert.equal(fact.sourcePath, 'details[1].content'); assert.equal(fact.rawValue, '+86 138-0000-0000');
  assert.ok(await api.repo.readEvidence(fact.evidenceId));
  assert.deepEqual(api.calls.map(call => call.file), ['workspace-lixiaoyun.js', 'workspace-contacts.js']);
});

test('相似名和重复同名不会自动获取联系方式，候选与缺口保留', async () => {
  for (const [id, items] of [['similar', [company('sim', '上海另一家贴膜有限公司')]], ['ambiguous', [company('a', '同名企业有限公司'), company('b', '同名企业有限公司')]]]) {
    const attempt = await prepare(id, '同名企业有限公司');
    api.setReplies([{ payload: { success: true, data: { total: items.length, items } } }]);
    const result = await api.searchCompanies(attempt);
    assert.equal(result.done, true); assert.equal(result.partial, true); assert.match(result.reason, /未获得唯一/);
    await api.repo.commitBatch(attempt, result);
    assert.equal(api.calls.length, 1);
    assert.ok((await api.repo.listLeads(id)).every(row => !row.fields.legalPersonPhone));
  }
});

test('来源标签决定法人手机归属，励销云内部有效标记不构成额外门槛', () => {
  const detail = (extra = {}) => ({ content: '13800000000', type: '1', ...extra });
  assert.equal(api.findLegalRepresentativeMobile([detail()], '张三'), undefined);
  assert.equal(api.findLegalRepresentativeMobile([detail({ contactName: '张三', valid: false })], '张三').phone, '13800000000');
  assert.equal(api.findLegalRepresentativeMobile([detail({ contactName: '李四', position: '法人' })], '张三'), undefined);
  assert.equal(api.findLegalRepresentativeMobile([detail({ content: '02188888888', contactName: '张三' })], '张三'), undefined);
  assert.equal(api.findLegalRepresentativeMobile([detail({ position: '法定代表人' })], '').phone, '13800000000');
});

test('刷新后缺少法人手机归属时清除当前投影，旧号码事实仍可追溯', async () => {
  const first = await prepare('refresh-source', '刷新示例有限公司');
  api.setReplies([{ payload: { success: true, data: { items: [company('refresh', '刷新示例有限公司')], total: 1 } } }, { phone: '13800000000', details: [{ content: '13800000000', contactName: '张三', type: '1' }] }]);
  await api.repo.commitBatch(first, await api.searchCompanies(first));
  const second = await api.repo.claimTask('refresh-source', Date.now() + 5000);
  await api.repo.commitBatch(second, await api.searchCompanies(second));
  const [lead] = await api.repo.listLeads('refresh-source');
  const task = await api.repo.createTask({ id: 'refresh-contact', sessionId: 'refresh-source', kind: 'company_contacts', provider: 'lixiaoyun', title: '刷新联系方式', input: { leadId: lead.id } });
  const attempt = await api.repo.claimTask(task.id);
  api.setReplies([{ phone: '13900000000', details: [{ content: '13900000000', contactName: '李四', type: '1' }] }]);
  await api.repo.commitBatch(attempt, await api.getContacts(attempt));
  const detail = await api.repo.readLead(lead.id);
  assert.equal(detail.lead.fields.contact, '13900000000');
  assert.equal(detail.lead.fields.legalPersonPhone, '');
  assert.equal(detail.facts.find(row => row.field === 'legalPersonPhone').value, '13800000000');
});

test('风鸟云旧作业不发起平台请求，等待改用励销云', async () => {
  const attempt = await prepare('disabled', '上海示例公司', 'riskbird'); api.setReplies([]);
  await assert.rejects(api.searchCompanies(attempt), error => error.disposition === 'waiting' && /暂未启用/.test(error.message));
  assert.equal(api.calls.length, 0);
});
