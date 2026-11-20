import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundle = buildSync({ stdin: { contents: `export * from './src/lib/workspace-db/repository';
  export * from './src/lib/workspace-db/database';`, resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
  bundle: true, format: 'esm', platform: 'node', write: false });
const { WorkspaceRepository, WorkspaceDatabase } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const session = id => ({ id, summary: '汽车贴膜线索', status: 'done', context: [], eventLog: [],
  createdAt: 1, startedAt: 1, agentState: { phase: 'idle', round: 0, reason: '', updatedAt: 1 } });
async function fixture(kind = 'douyin_collect') {
  const db = new WorkspaceDatabase(`test-${crypto.randomUUID()}`);
  const repo = new WorkspaceRepository(db);
  await repo.saveSession(session('s'));
  const task = await repo.createTask({ id: 't', sessionId: 's', kind, provider: 'douyin', title: '找客', input: { keyword: '贴膜' } });
  const attempt = await repo.claimTask(task.id);
  return { repo, db, task, attempt };
}
function batch(attempt, key = 'douyin:1') {
  const evidence = { id: crypto.randomUUID(), taskId: 't', stepId: attempt.step.id, provider: 'douyin', sourceUrl: 'https://www.douyin.com/user/1', collectedAt: 1, extractorVersion: '1', payload: { nickname: '贴膜门店' } };
  return { evidence: [evidence], leads: [{ sourceKey: key, kind: 'account', name: '贴膜门店', provider: 'douyin', sourceUrl: evidence.sourceUrl,
    fields: { nickname: '贴膜门店' }, evidenceIds: [evidence.id] }], checkpoint: { cursor: 20 }, done: false };
}

test('批次结果、字段事实、事件和游标原子提交；重复回执不重复计数', async () => {
  const { repo, db, attempt } = await fixture();
  const data = batch(attempt);
  await repo.commitBatch(attempt, data);
  await repo.commitBatch(attempt, data);
  const saved = await repo.getTask('t');
  assert.equal(saved.savedCount, 1); assert.equal(saved.batches, 1); assert.equal(saved.checkpoint.cursor, 20);
  const [lead] = await repo.listLeads('t');
  const detail = await repo.readLead(lead.id);
  assert.equal(detail.facts[0].rawValue, '贴膜门店');
  assert.ok(await repo.readEvidence(detail.facts[0].evidenceId));
  await db.close();
});

test('批次中途失败整体回滚；重启后可重新读取同一页', async () => {
  const { repo, db, attempt } = await fixture();
  const data = batch(attempt);
  data.leads.push({ ...data.leads[0], sourceKey: 'invalid', evidenceIds: ['missing'] });
  await assert.rejects(repo.commitBatch(attempt, data), /证据/);
  assert.equal((await repo.getTask('t')).checkpoint.cursor, undefined);
  assert.equal((await repo.listLeads()).length, 0);
  assert.equal(await repo.readEvidence(data.evidence[0].id), undefined);
  await repo.recover();
  const retry = await repo.claimTask('t');
  await assert.rejects(repo.commitBatch(attempt, batch(attempt)), /代次/);
  await repo.commitBatch(retry, batch(retry));
  assert.equal((await repo.getTask('t')).savedCount, 1);
  assert.equal((await repo.getTask('t')).attempts, 2);
  await db.close();
});

test('同一步并发领取一次；暂停后收到批次仍保存，但不继续调度', async () => {
  const { repo, db, attempt } = await fixture();
  assert.equal(await repo.claimTask('t'), undefined);
  await repo.controlTask('t', 'pause');
  await repo.commitBatch(attempt, batch(attempt));
  await repo.recover();
  assert.equal((await repo.getTask('t')).status, 'paused');
  assert.equal((await repo.getTask('t')).savedCount, 1);
  assert.equal(await repo.claimTask('t'), undefined);
  await db.close();
});

test('移除旧 CRM 查询门槛只接续受此门槛阻塞的查询，不改变暂停、取消或平台登录等待', async () => {
  const db = new WorkspaceDatabase(`crm-gate-${crypto.randomUUID()}`), repo = new WorkspaceRepository(db);
  const oldGate = '请先打开指定公司的螳螂 CRM 并登录工作台，再继续渠道任务';
  await repo.saveSession(session('s'));
  const rows = [
    ['search', 'company_search', 'waiting', oldGate],
    ['contacts', 'company_contacts', 'waiting', oldGate],
    ['paused', 'company_search', 'paused', oldGate],
    ['cancelled', 'company_contacts', 'cancelled', oldGate],
    ['provider-login', 'company_search', 'waiting', '励销云需要登录（任务页签 7）'],
    ['crm', 'crm_delivery', 'waiting', oldGate],
  ];
  try {
    for (const [id, kind, status, reason] of rows) {
      const task = await repo.createTask({ id, kind, sessionId: 's', provider: 'lixiaoyun', title: id, input: {} });
      await db.transaction(['tasks'], 'readwrite', tx => { tx.objectStore('tasks').put({ ...task, status, reason }); });
    }
    await repo.recover();
    for (const [id, , status, reason] of rows) {
      const task = await repo.getTask(id), released = id === 'search' || id === 'contacts';
      assert.equal(task.status, released ? 'queued' : status);
      assert.equal(task.reason, released ? undefined : reason);
      if (released) assert.ok(await repo.claimTask(id));
    }
    const notifications = () => repo.readSession('s').then(page => page.events.filter(event => event.type === 'workspace:notification'));
    assert.equal((await notifications()).length, 2);
    await repo.recover();
    assert.equal((await notifications()).length, 2);
  } finally { await db.close(); }
});

test('长期完整档案不受运行缓存限制，事件标识重复时幂等', async () => {
  const { repo, db } = await fixture();
  const events = Array.from({ length: 650 }, (_, i) => ({ sessionId: 's', eventId: `event-${i}`, type: 'text', content: String(i), timestamp: i + 1 }));
  await repo.saveSession(session('s'), events);
  await repo.saveSession(session('s'), events);
  const first = await repo.readSession('s', 0, 400);
  const second = await repo.readSession('s', first.lastSeq, 400);
  assert.equal(first.hasMore, true);
  assert.equal([...first.events, ...second.events].filter(e => e.type === 'text').length, 650);
  await db.close();
});

test('指令去重和显式会话目标，requestId 不能换内容复用', async () => {
  const { repo, db } = await fixture();
  const command = { requestId: 'r', sessionId: 's', kind: 'send_message', text: '找贴膜企业' };
  const accepted = await repo.acceptCommand(command);
  assert.equal(accepted.duplicate, false);
  assert.equal((await repo.acceptCommand(command)).duplicate, true);
  assert.ok(await repo.claimCommand('r'));
  assert.equal(await repo.claimCommand('r'), undefined);
  await assert.rejects(repo.acceptCommand({ ...command, text: '其他内容' }), /不同操作/);
  await db.close();
});

test('CRM sending 重启进入 unknown，禁止自动重提；取消后晚到成功仍可保存', async () => {
  const { repo, db, attempt } = await fixture('crm_delivery');
  await repo.commitBatch(attempt, batch(attempt));
  const [lead] = await repo.listLeads();
  await repo.prepareDelivery({ id: 'op', taskId: 't', leadId: lead.id, targetHost: 'example.com', targetIdentity: 'company:user', configVersion: 1, fields: {} });
  await repo.updateDelivery('op', 'sending');
  await repo.controlTask('t', 'cancel');
  await repo.recover();
  await assert.rejects(repo.controlTask('t', 'resume'), /待核对/);
  await repo.updateDelivery('op', 'recorded', { flag: 1 });
  await repo.updateDelivery('op', 'unknown');
  const detail = await repo.readLead(lead.id);
  assert.equal(detail.deliveries[0].status, 'recorded');
  assert.equal((await repo.getTask('t')).status, 'cancelled');
  await db.close();
});

test('完整备份幂等导入、任务暂停、证据引用保留；损坏引用整体拒绝', async () => {
  const { repo, db, attempt } = await fixture();
  await repo.commitBatch(attempt, batch(attempt));
  const backup = await repo.backup();
  const targetDb = new WorkspaceDatabase(`target-${crypto.randomUUID()}`), target = new WorkspaceRepository(targetDb);
  await target.importBackup(backup); await target.importBackup(backup);
  assert.equal((await target.getTask('t')).status, 'paused');
  assert.equal((await target.listLeads()).length, 1);
  const [lead] = await target.listLeads();
  assert.ok(await target.readEvidence(lead.evidenceIds[0]));
  const invalid = structuredClone(backup); invalid.records.evidence = [];
  await assert.rejects(target.importBackup(invalid), /引用不存在/);
  await db.close(); await targetDb.close();
});

test('同毫秒的 130 个历史会话可完整分页，列表不传模型上下文', async () => {
  const db = new WorkspaceDatabase(`sessions-${crypto.randomUUID()}`), repo = new WorkspaceRepository(db);
  const originalNow = Date.now;
  try {
    Date.now = () => 1000;
    for (let i = 0; i < 130; i++) await repo.saveSession({ ...session(`s-${String(i).padStart(3, '0')}`), context: [{ role: 'user', content: 'private-context' }] });
  } finally { Date.now = originalNow; }
  const rows = []; let before;
  for (;;) {
    const page = await repo.listSessions(before, 50);
    rows.push(...page);
    if (page.length < 50) break;
    before = { updatedAt: page.at(-1).updatedAt, id: page.at(-1).id };
  }
  assert.equal(new Set(rows.map(row => row.id)).size, 130);
  assert.ok(rows.every(row => !('snapshot' in row)));
  await db.close();
});

test('旧会话仍在执行时独立置顶，模型 done 不掩盖后台作业；结束后可刷新旧状态', async () => {
  const db = new WorkspaceDatabase(`active-${crypto.randomUUID()}`), repo = new WorkspaceRepository(db);
  try {
    await repo.saveSession(session('old-active'));
    await db.transaction(['sessions'], 'readwrite', async tx => {
      const read = tx.objectStore('sessions').get('old-active');
      const row = await new Promise(resolve => { read.onsuccess = () => resolve(read.result); });
      tx.objectStore('sessions').put({ ...row, updatedAt: 1 });
    });
    for (let i = 0; i < 55; i++) await repo.saveSession(session(`recent-${i}`));
    await repo.createTask({ id: 'active-job', sessionId: 'old-active', kind: 'douyin_collect', provider: 'douyin', title: '上海贴膜企业', input: {} });
    await repo.claimTask('active-job');
    const recent = await repo.listSessions();
    assert.equal(recent.some(row => row.id === 'old-active'), false);
    const [active] = await repo.listActiveSessions();
    assert.equal(active.id, 'old-active'); assert.equal(active.status, 'done'); assert.equal(active.activity.state, 'running');
    assert.ok(!('snapshot' in active));
    await repo.controlTask('active-job', 'pause');
    assert.equal((await repo.listActiveSessions())[0].activity.state, 'paused');
    await repo.controlTask('active-job', 'cancel');
    assert.equal((await repo.listActiveSessions()).length, 0);
    assert.equal((await repo.listActiveSessions('', ['old-active']))[0].activity.state, 'done');
  } finally { await db.close(); }
});

test('待回复状态可从持久交互复原，结算后会话恢复真实执行态', async () => {
  const db = new WorkspaceDatabase(`reply-state-${crypto.randomUUID()}`), repo = new WorkspaceRepository(db);
  try {
    await repo.saveSession({ ...session('reply'), status: 'running' });
    const interaction = { sessionId: 'reply', requestId: 'question', kind: 'question', question: '具体是哪家企业？', state: 'pending' };
    await repo.setMeta('interaction:question', interaction);
    assert.equal((await repo.listSessions())[0].activity.label, '等待你的回复');
    assert.equal((await repo.listActiveSessions())[0].activity.needsReply, true);
    await repo.setMeta('interaction:question', { ...interaction, state: 'settled', answer: '上海示例公司' });
    assert.equal((await repo.listSessions())[0].activity.state, 'running');
    assert.equal((await repo.listActiveSessions())[0].activity.needsReply, undefined);
  } finally { await db.close(); }
});

test('重启打断排队模型和人机请求，保留待处理输入与只读作业的恢复边界', async () => {
  const { repo, db } = await fixture('tool_read');
  await repo.saveSession({ ...session('s'), status: 'waiting', context: [{ role: 'user', content: '已接收的新请求' }], pendingUserInputs: [{ id: 'input-1', text: '追加地区条件' }] });
  await repo.setMeta('interaction:q', { state: 'pending', sessionId: 's' });
  await repo.recover();
  assert.equal((await repo.getTask('t')).status, 'failed');
  const restored = await repo.loadRuntimeSession('s');
  assert.equal(restored.status, 'error');
  assert.equal(restored.context[0].content, '已接收的新请求');
  assert.equal(restored.pendingUserInputs[0].text, '追加地区条件');
  assert.equal((await repo.getMeta('interaction:q')).state, 'interrupted');
  await db.close();
});

test('判断版本变更后保留旧判断；事实追加不覆盖，来源路径必须真实存在', async () => {
  const { repo, db, attempt } = await fixture();
  const data = batch(attempt); data.evidence[0].payload.alternate = '另一个原始字段';
  await repo.commitBatch(attempt, data);
  const [lead] = await repo.listLeads('t');
  const original = (await repo.readLead(lead.id)).facts[0];
  await repo.assess({ taskId: 't', leadId: lead.id, goalRevision: 1, status: 'qualified', reason: '简介包含贴膜', factIds: [original.id], evidenceIds: [original.evidenceId], model: 'fixture', promptVersion: 'v1', author: 'agent' });
  assert.equal((await repo.listLeadSummaries('t'))[0].assessment.current, true);
  await repo.reviseCriteria('t', '必须在上海且提供主营贴膜的来源证据');
  assert.equal((await repo.listLeadSummaries('t'))[0].assessment.current, false);
  await assert.rejects(repo.assess({ taskId: 't', leadId: lead.id, goalRevision: 1, status: 'unconfirmed', reason: '旧条件', factIds: [], evidenceIds: [], model: 'fixture', promptVersion: 'v1', author: 'agent' }), /版本/);
  await repo.attachFact(lead.id, original.evidenceId, 'nickname', 'alternate');
  const detail = await repo.readLead(lead.id);
  assert.equal(detail.assessments.length, 1); assert.equal(detail.facts.length, 2);
  assert.equal(detail.facts.find(row => row.id === original.id).rawValue, '贴膜门店');
  await assert.rejects(repo.attachFact(lead.id, original.evidenceId, 'nickname', '__proto__.x'), /路径/);
  await db.close();
});

test('线索库超过 5000 条仍能分页和跨页检索，历史事件可向前分页', async () => {
  const { repo, db } = await fixture();
  await db.transaction(['leads'], 'readwrite', async tx => {
    for (let i = 0; i < 5105; i++) tx.objectStore('leads').add({ id: String(i).padStart(6, '0'), sourceKey: `k:${i}`, name: i % 2 ? '目标公司' : '其他', fields: {}, evidenceIds: [], kind: 'company', provider: 'web', sourceUrl: '', createdAt: 1, updatedAt: 1 });
  });
  assert.equal((await repo.listLeads(undefined, 5000, 100)).length, 100);
  assert.equal((await repo.listLeads(undefined, 5100, 100)).length, 5);
  assert.equal((await repo.listLeads(undefined, 100, 100, '目标')).length, 100);
  const events = Array.from({ length: 650 }, (_, i) => ({ sessionId: 's', eventId: `history-${i}`, type: 'text', content: String(i), timestamp: 1 }));
  await repo.saveSession(session('s'), events);
  const recent = await repo.readSessionHistory('s');
  assert.equal(recent.events.length, 300); assert.equal(recent.hasMore, true);
  assert.equal(recent.events.at(-1).content, '649');
  const older = await repo.readSessionHistory('s', recent.events[0].seq);
  assert.equal(older.events.at(-1).content, '349');
  await db.close();
});

test('导入重建本机事件游标，禁止跨任务伪造事实或不存在的采集步骤', async () => {
  const { repo, db, attempt } = await fixture(); await repo.commitBatch(attempt, batch(attempt));
  const backup = await repo.backup();
  backup.records.events.forEach(row => row.seq += 10000);
  backup.records.sessions[0].lastSeq = 20000;
  const targetDb = new WorkspaceDatabase(`import-${crypto.randomUUID()}`), target = new WorkspaceRepository(targetDb);
  await target.importBackup(backup);
  const page = await target.readSession('s');
  assert.equal(page.session.lastSeq, page.events.at(-1).seq);
  const bad = structuredClone(backup); bad.records.evidence[0].stepId = 'missing';
  await assert.rejects(target.importBackup(bad), /步骤引用/);
  await db.close(); await targetDb.close();
});
