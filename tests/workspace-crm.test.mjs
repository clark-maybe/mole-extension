import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundle = buildSync({ stdin: { contents: `export * from './src/platforms/mantis-crm'; export {workspaceRepository as repo} from './src/lib/workspace-db/repository';`, resolveDir: fileURLToPath(new URL('../', import.meta.url)) }, bundle: true, format: 'esm', platform: 'node', write: false });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const originalChrome = globalThis.chrome;
const config = { targetHost: 'bdtg.n4.bjmantis.cn', targetIdentity: 'fixture-identity', version: 3, productId: 'product-3', provinceId: 'province-3', areaId: 'area-3', mscCode: 'msc-3' };
let wrongIdentity = false, lostReceipt = false, sent = [], created = 0, preview;
globalThis.chrome = { runtime: {}, storage: { local: { get: (key, cb) => cb({ [key]: 'fixture-verification' }), set: (_data, cb) => cb?.() } },
  tabs: { query: async () => [{ id: 7, url: `https://${config.targetHost}/mantis/` }], create: async () => { created++; return { id: 8 }; }, get: async () => ({ status: 'complete' }), remove: async () => {} },
  scripting: { executeScript: async request => {
    if (request.func?.name === 'inspectCrmPage') return [{ result: { ...config, valid: true, targetIdentity: wrongIdentity ? 'other-account' : config.targetIdentity } }];
    if (request.files || request.world === 'ISOLATED') return [];
    if (String(request.func).includes('__mole_crm_preview__')) {
      preview = { customerCompanyName: request.args[0].name, phone1: request.args[0].contact, productId: request.args[1].productId, provinceId: request.args[1].provinceId, areaId: request.args[1].areaId };
      return [{ result: preview }];
    }
    sent.push(request.args);
    if (lostReceipt) throw new Error('worker connection lost after send');
    return [{ result: { items: [{ status: 'recorded', message: '成功', debug: { response: { flag: 1, id: 'crm-id' } } }] } }];
  } } };
after(async () => { await api.repo.database.close(); globalThis.chrome = originalChrome; });
async function fixture(id) {
  wrongIdentity = false; lostReceipt = false; sent = []; created = 0;
  await api.repo.saveSession({ id, summary: id, status: 'done', context: [], eventLog: [], createdAt: 1, agentState: { phase: 'idle', round: 0, reason: '', updatedAt: 1 } });
  const source = await api.repo.createTask({ id: `source-${id}`, sessionId: id, kind: 'company_search', provider: 'lixiaoyun', title: id, input: { criteria: '贴膜企业' } });
  const attempt = await api.repo.claimTask(source.id), evidenceId = crypto.randomUUID();
  await api.repo.commitBatch(attempt, { evidence: [{ id: evidenceId, taskId: source.id, stepId: attempt.step.id, provider: 'lixiaoyun', sourceUrl: 'https://example.com/company', collectedAt: 1, extractorVersion: 'fixture', payload: { name: id, contact: '13800000000' } }], leads: [{ sourceKey: id, kind: 'company', name: id, provider: 'lixiaoyun', sourceUrl: 'https://example.com/company', fields: { contact: '13800000000' }, evidenceIds: [evidenceId] }], checkpoint: {}, done: true });
  const [lead] = await api.repo.listLeads(source.id), detail = await api.repo.readLead(lead.id);
  await api.repo.assess({ taskId: source.id, leadId: lead.id, goalRevision: 1, status: 'qualified', reason: '已核验业务', factIds: detail.facts.map(f => f.id), evidenceIds: [evidenceId], model: 'fixture', promptVersion: '1', author: 'agent' });
  const deliveryTask = await api.repo.createTask({ id: `delivery-${id}`, sessionId: id, kind: 'crm_delivery', provider: 'mantis_crm', title: id, input: { leadIds: [lead.id], targetConfig: config, intent: '将该企业录入目标 CRM' } });
  return { lead, source, attempt: await api.repo.claimTask(deliveryTask.id), operationId: `${deliveryTask.id}:${lead.id}` };
}

test('CRM 环境切换前置阻止发送和录入意图创建', async () => {
  const f = await fixture('wrong-target'); wrongIdentity = true;
  await assert.rejects(api.recordCrm(f.attempt), /账号与任务目标不一致/);
  assert.equal(sent.length, 0); assert.equal(created, 0);
  assert.equal((await api.repo.readLead(f.lead.id)).deliveries.length, 0);
});

test('CRM 字段快照与发送配置一致，重复回执幂等且不被晚到失败覆盖', async () => {
  const f = await fixture('success'); const batch = await api.recordCrm(f.attempt);
  await api.repo.commitBatch(f.attempt, batch);
  let delivery = (await api.repo.readLead(f.lead.id)).deliveries[0];
  assert.deepEqual(delivery.fields, preview); assert.equal(delivery.configVersion, 3);
  assert.equal(sent[0][2].productId, delivery.fields.productId);
  await api.saveCrmReceipt(f.operationId, { items: [{ status: 'recorded' }] });
  await api.saveCrmReceipt(f.operationId, { items: [{ status: 'failed' }] });
  delivery = (await api.repo.readLead(f.lead.id)).deliveries[0];
  assert.equal(delivery.status, 'recorded'); assert.equal(sent.length, 1);
});

test('发送后连接丢失进入 unknown；人工核对后继续复用原回执而不重发', async () => {
  const f = await fixture('unknown'); lostReceipt = true;
  await assert.rejects(api.recordCrm(f.attempt), /connection lost/);
  assert.equal((await api.repo.readLead(f.lead.id)).deliveries[0].status, 'unknown');
  await api.repo.failAttempt(f.attempt, '提交结果待核对', 'waiting');
  await assert.rejects(api.repo.controlTask(f.attempt.task.id, 'resume'), /待核对/);
  await api.repo.updateDelivery(f.operationId, 'recorded', { manual: true, checkedId: 'crm-123' });
  await api.repo.controlTask(f.attempt.task.id, 'resume');
  const retry = await api.repo.claimTask(f.attempt.task.id);
  const batch = await api.recordCrm(retry); await api.repo.commitBatch(retry, batch);
  assert.equal(sent.length, 1); assert.equal((await api.repo.getTask(retry.task.id)).status, 'completed');
});

test('筛选条件变化使旧 qualified 失效，不能继续交付', async () => {
  const f = await fixture('stale-assessment');
  await api.repo.reviseCriteria(f.source.id, '只要上海企业且核实主营业务');
  await assert.rejects(api.recordCrm(f.attempt), /当前条件/);
  assert.equal(sent.length, 0);
});

test('prepared 意图恢复继续发送原字段快照，不采用后来变化的企业字段', async () => {
  const f = await fixture('frozen-prepared');
  const fields = { customerCompanyName: '旧版确认企业名', phone1: '13900000000', productId: 'frozen-product' };
  await api.repo.prepareDelivery({ id: f.operationId, taskId: f.attempt.task.id, leadId: f.lead.id, targetHost: config.targetHost, targetIdentity: config.targetIdentity, configVersion: 3, fields });
  await api.recordCrm(f.attempt);
  assert.deepEqual(sent[0][2].preparedFields, fields);
  assert.deepEqual((await api.repo.readLead(f.lead.id)).deliveries[0].fields, fields);
});

test('同毫秒内后来的 rejected 判断优先，旧 qualified 不得授权交付', async () => {
  const f = await fixture('latest-rejected');
  const detail = await api.repo.readLead(f.lead.id);
  const originalNow = Date.now;
  try {
    Date.now = () => detail.assessments[0].createdAt;
    await api.repo.assess({ taskId: f.source.id, leadId: f.lead.id, goalRevision: 1, status: 'rejected', reason: '后续证据不满足主营标准', factIds: detail.facts.map(row => row.id), evidenceIds: f.lead.evidenceIds, model: 'fixture', promptVersion: '1', author: 'agent' });
  } finally { Date.now = originalNow; }
  await assert.rejects(api.recordCrm(f.attempt), /当前条件/);
  assert.equal(sent.length, 0);
});
