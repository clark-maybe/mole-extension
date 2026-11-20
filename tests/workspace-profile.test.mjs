import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({ stdin: { contents: `export * from './src/lib/workspace-db/repository'; export * from './src/lib/workspace-db/database';
  export * from './src/workspace/lead-contacts'; export * from './src/functions/lead-workspace'; export {notifications} from 'test-channel';`, resolveDir: root },
  bundle: true, format: 'esm', platform: 'node', write: false,
  plugins: [{ name: 'profile-runtime-fixture', setup(builder) {
    builder.onResolve({ filter: /background\/workspace-storage$/ }, () => ({ path: 'storage', namespace: 'fixture' }));
    builder.onResolve({ filter: /background\/lead-task-runner$/ }, () => ({ path: 'runner', namespace: 'fixture' }));
    builder.onResolve({ filter: /lib\/channel$|^test-channel$/ }, () => ({ path: 'channel', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'channel'
      ? 'export const notifications=[]; export default {broadcast:(type,data)=>notifications.push({type,data})};'
      : args.path === 'storage' ? 'export async function workspaceStorageReady(){}' : 'export async function wakeLeadTasks(){}' }));
  } }] });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
after(async () => api.workspaceRepository.database.close());

async function fixture(repo = new api.WorkspaceRepository(new api.WorkspaceDatabase(`profile-${crypto.randomUUID()}`))) {
  const id = crypto.randomUUID();
  await repo.saveSession({ id, summary: '企业档案', status: 'done', context: [], eventLog: [], createdAt: 1, agentState: { phase: 'idle', round: 0, reason: '', updatedAt: 1 } });
  const task = await repo.createTask({ id, sessionId: id, kind: 'company_search', provider: 'lixiaoyun', title: '精确企业信息', input: {} });
  const attempt = await repo.claimTask(id), evidenceId = crypto.randomUUID();
  const batch = { evidence: [{ id: evidenceId, taskId: id, stepId: attempt.step.id, provider: 'lixiaoyun', sourceUrl: 'https://example.com/company', collectedAt: 1, extractorVersion: 'fixture', payload: { name: '天津大福商贸有限公司', phone: '13302012559' } }],
    leads: [{ sourceKey: id, kind: 'company', name: '天津大福商贸有限公司', provider: 'lixiaoyun', sourceUrl: 'https://example.com/company', fields: { legalPerson: '刘晖', contact: '13302012559' }, evidenceIds: [evidenceId] }], checkpoint: {}, done: false };
  await repo.commitBatch(attempt, batch);
  const [lead] = await repo.listLeads(id), detail = await repo.readLead(lead.id);
  const input = { taskId: id, leadId: lead.id, expectedRevision: 0, profile: { summary: '天津商贸企业，可使用励销云联系方式跟进。', region: '天津', nextStep: '联系企业了解业务需求', tags: ['商贸', '商贸'] },
    factIds: detail.facts.map(fact => fact.id), evidenceIds: [evidenceId], model: 'fixture', promptVersion: 'lead-profile-v1' };
  return { repo, lead, task, input, batch };
}

test('旧励销云数据中的掩码联系人和 valid=false 默认可信，电话邮箱去重并保留来源角色', () => {
  const contacts = api.getLeadContacts({ provider: 'lixiaoyun', fields: { legalPerson: '刘晖', contact: '13302012559',
    contactDetails: [
      { content: '+86 13302012559', contactName: '刘*', department: '管理部', position: '高管', valid: false, sources: ['钉钉企典'] },
      { content: '13302012559', contactName: '刘*', sources: ['工商年报 2025', '钉钉企典'] },
      { content: '13302012559@126.com', type: '4', sources: ['工商年报 2024'] },
      { content: '13302012559@126.COM', type: '4' },
      { content: null }, { content: 'not a phone' },
    ] } });
  assert.equal(contacts.length, 2);
  assert.ok(contacts.every(contact => contact.trusted));
  assert.equal(contacts[0].kind, 'phone'); assert.equal(contacts[0].legalRepresentative, false);
  assert.deepEqual(contacts[0].names, ['刘*']); assert.deepEqual(contacts[0].roles, ['管理部 · 高管']);
  assert.deepEqual(contacts[0].sources, ['钉钉企典', '工商年报 2025']);
  assert.equal(contacts[1].kind, 'email');
});

test('联系方式兼容旧单字段、多号码和法人标签，其他平台不冒用励销云可信标记', () => {
  const base = { fields: { contact: '13800000000;02188888888', legalPersonPhone: '13800000000', legalPerson: '张三', email: 'sales@example.com' } };
  const contacts = api.getLeadContacts({ ...base, provider: 'lixiaoyun' });
  assert.equal(contacts.length, 3); assert.equal(contacts[0].legalRepresentative, true); assert.deepEqual(contacts[0].names, ['张三']);
  assert.equal(api.getLeadContacts({ ...base, provider: 'douyin' }).some(contact => contact.trusted), false);
  assert.deepEqual(api.getLeadContacts({ provider: 'lixiaoyun', fields: {} }), []);
});

test('Agent 通过工具填写档案，事务提交后返回持久版本并通知详情刷新', async () => {
  const f = await fixture(api.workspaceRepository), before = api.notifications.length;
  const response = await api.leadWorkspaceFunction.execute({ action: 'save_profile', task_id: f.task.id, lead_id: f.lead.id, profile_revision: 0,
    profile: f.input.profile, fact_ids: f.input.factIds, evidence_ids: f.input.evidenceIds }, { sessionId: f.task.sessionId });
  assert.equal(response.success, true); assert.equal(response.data.revision, 1);
  const detail = await f.repo.readLead(f.lead.id);
  assert.equal(detail.lead.profile.id, response.data.id); assert.equal(detail.profileHistory.length, 1);
  assert.deepEqual(detail.lead.profile.tags, ['商贸']); assert.equal(detail.contacts[0].trusted, true);
  assert.deepEqual(detail.lead.fields, f.lead.fields); assert.equal(detail.facts.length, f.input.factIds.length);
  assert.equal(api.notifications.length, before + 1); assert.equal(api.notifications.at(-1).data.leadId, f.lead.id);
  assert.ok((await f.repo.readSession(f.task.sessionId)).events.some(event => event.type === 'workspace:profile_saved'));
});

test('整理历史只追加，过期版本和并发写入不会静默覆盖；平台更新保留 Agent 档案', async () => {
  const f = await fixture();
  try {
    const first = await f.repo.saveLeadProfile(f.input);
    const changes = await Promise.allSettled(['新增业务摘要', '另一个摘要'].map(summary => f.repo.saveLeadProfile({ ...f.input, expectedRevision: 1, profile: { summary } })));
    assert.equal(changes.filter(result => result.status === 'fulfilled').length, 1);
    assert.match(changes.find(result => result.status === 'rejected').reason.message, /版本/);
    const detail = await f.repo.readLead(f.lead.id);
    assert.deepEqual(detail.profileHistory.map(profile => profile.revision), [2, 1]);
    assert.equal(detail.profileHistory[1].id, first.id); assert.ok(detail.profileHistory[0].createdAt > first.createdAt);
    const attempt = await f.repo.claimTask(f.task.id, Date.now() + 5000), evidenceId = crypto.randomUUID();
    await f.repo.commitBatch(attempt, { ...f.batch, evidence: [{ ...f.batch.evidence[0], id: evidenceId, stepId: attempt.step.id }],
      leads: [{ ...f.batch.leads[0], fields: { contact: '18512235553' }, evidenceIds: [evidenceId] }], done: true });
    const updated = await f.repo.readLead(f.lead.id);
    assert.equal(updated.lead.fields.contact, '18512235553'); assert.equal(updated.lead.profile.id, detail.lead.profile.id);
  } finally { await f.repo.database.close(); }
});

test('档案拒绝无依据、跨线索证据、伪造事实和任务，失败时历史与当前值均回滚', async () => {
  const f = await fixture(), other = await fixture(f.repo);
  try {
    await f.repo.saveLeadProfile(f.input);
    for (const patch of [
      { evidenceIds: [] }, { evidenceIds: other.input.evidenceIds }, { factIds: other.input.factIds },
      { factIds: ['missing'] }, { taskId: other.task.id }, { expectedRevision: 0 },
      { profile: { summary: '' } }, { profile: { summary: 'x', tags: [123] } },
    ]) await assert.rejects(f.repo.saveLeadProfile({ ...f.input, expectedRevision: 1, ...patch }));
    const detail = await f.repo.readLead(f.lead.id);
    assert.equal(detail.profileHistory.length, 1); assert.equal(detail.lead.profile.revision, 1);
    const events = (await f.repo.readSession(f.task.sessionId)).events.filter(event => event.type === 'workspace:profile_saved');
    assert.equal(events.length, 1);
  } finally { await f.repo.database.close(); }
});

test('完整备份恢复所有档案修订与证据，损坏档案引用整体拒绝', async () => {
  const f = await fixture(), target = new api.WorkspaceRepository(new api.WorkspaceDatabase(`profile-import-${crypto.randomUUID()}`));
  try {
    await f.repo.saveLeadProfile(f.input);
    await f.repo.saveLeadProfile({ ...f.input, expectedRevision: 1, profile: { summary: '更新后的销售摘要' } });
    const backup = await f.repo.backup(); await target.importBackup(backup); await target.importBackup(backup);
    const restored = await target.readLead(f.lead.id);
    assert.equal(restored.lead.profile.summary, '更新后的销售摘要'); assert.deepEqual(restored.profileHistory.map(profile => profile.revision), [2, 1]);
    assert.ok(await target.readEvidence(restored.lead.profile.evidenceIds[0]));
    const invalid = structuredClone(backup); invalid.records.meta.find(row => row.id.startsWith('lead-profile:')).value.evidenceIds = ['missing'];
    await assert.rejects(target.importBackup(invalid), /引用不存在/);
    const mismatch = structuredClone(backup); mismatch.records.leads[0].profile.summary = '无历史的改写';
    await assert.rejects(target.importBackup(mismatch), /历史不一致/);
  } finally { await f.repo.database.close(); await target.database.close(); }
});

test('联系方式可信不自动等于业务符合，业务条件变更在详情中可识别', async () => {
  const f = await fixture();
  try {
    const before = await f.repo.readLead(f.lead.id);
    assert.equal(before.contacts[0].trusted, true); assert.equal(before.assessments.length, 0);
    await f.repo.assess({ taskId: f.task.id, leadId: f.lead.id, factIds: f.input.factIds, evidenceIds: f.input.evidenceIds,
      model: 'fixture', promptVersion: 'v1', goalRevision: 1, status: 'qualified', reason: '符合当前条件', author: 'agent' });
    assert.equal((await f.repo.readLead(f.lead.id)).assessments[0].current, true);
    await f.repo.reviseCriteria(f.task.id, '需要近期发布贴膜内容');
    const after = await f.repo.readLead(f.lead.id);
    assert.equal(after.assessments[0].current, false); assert.equal(after.contacts[0].trusted, true);
  } finally { await f.repo.database.close(); }
});

test('合并备份补入新历史但保留本机当前档案，后续整理不会覆盖导入版本', async () => {
  const f = await fixture(), target = new api.WorkspaceRepository(new api.WorkspaceDatabase(`profile-merge-${crypto.randomUUID()}`));
  try {
    await f.repo.saveLeadProfile(f.input);
    await target.importBackup(await f.repo.backup());
    const attempt = await f.repo.claimTask(f.task.id, Date.now() + 5000), evidenceId = crypto.randomUUID();
    await f.repo.commitBatch(attempt, { ...f.batch, evidence: [{ ...f.batch.evidence[0], id: evidenceId, stepId: attempt.step.id }],
      leads: [{ ...f.batch.leads[0], fields: { contact: '18512235553' }, evidenceIds: [evidenceId] }], done: true });
    await f.repo.saveLeadProfile({ ...f.input, expectedRevision: 1, profile: { summary: '备份中的新版本' }, factIds: [], evidenceIds: [evidenceId] });
    await target.importBackup(await f.repo.backup());
    const merged = await target.readLead(f.lead.id);
    assert.equal(merged.lead.profile.revision, 1); assert.equal(merged.lead.fields.contact, '13302012559');
    assert.ok(merged.lead.evidenceIds.includes(evidenceId));
    const saved = await target.saveLeadProfile({ ...f.input, expectedRevision: 1, profile: { summary: '本机继续整理' } });
    assert.equal(saved.revision, 3);
    const detail = await target.readLead(f.lead.id);
    assert.deepEqual(detail.profileHistory.map(profile => profile.revision), [3, 2, 1]);
    assert.equal(detail.profileHistory[1].summary, '备份中的新版本');
    const restored = new api.WorkspaceRepository(new api.WorkspaceDatabase(`profile-merged-restore-${crypto.randomUUID()}`));
    try { await restored.importBackup(await target.backup()); assert.equal((await restored.readLead(f.lead.id)).profileHistory.length, 3); }
    finally { await restored.database.close(); }
  } finally { await f.repo.database.close(); await target.database.close(); }
});

test('详情有界读取最近 30 版，完整备份保留更早的整理内容', async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 32; i++) await f.repo.saveLeadProfile({ ...f.input, expectedRevision: i, profile: { summary: `第 ${i + 1} 版` } });
    const detail = await f.repo.readLead(f.lead.id);
    assert.equal(detail.profileHistory.length, 30); assert.equal(detail.profileHistory[0].revision, 32); assert.equal(detail.profileHistory.at(-1).revision, 3);
    assert.equal((await f.repo.backup()).records.meta.filter(row => row.id.startsWith('lead-profile:')).length, 32);
  } finally { await f.repo.database.close(); }
});
