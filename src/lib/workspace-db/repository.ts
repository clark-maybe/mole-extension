/** 工作台唯一业务写入口；所有成功响应均发生在事务提交之后。 */
import type { Session } from '../../ai/types';
import type { Assessment, BatchResult, CommandReceipt, Delivery, EntityLink, Evidence, Json, Lead, LeadDetail, LeadFact, LeadProfile, LeadTask, SessionArchive, SessionPage, TaskAttempt, TaskLead, TaskStep, WorkspaceBackup, WorkspaceCommand, WorkspaceEvent } from '../../workspace/types';
import { cursorPage, request, STORE_NAMES, WorkspaceDatabase } from './database';
import type { LeadSummary, SessionCursor, SessionSummary } from '../../workspace/types';
import { getSessionActivity } from '../../workspace/session-activity';
import { getLeadContacts } from '../../workspace/lead-contacts';
import { leadProfileHistoryKey, parseLeadProfileContent } from '../../workspace/lead-profile';

const now = () => Date.now();
const uuid = () => crypto.randomUUID();
const TERMINAL = new Set(['completed', 'partial', 'failed', 'cancelled']);

export class WorkspaceConflict extends Error {
  readonly code = 'E_WORKSPACE_CONFLICT';
}

async function emit(tx: IDBTransaction, event: Omit<WorkspaceEvent, 'seq' | 'eventId' | 'timestamp'>): Promise<number> {
  const item: WorkspaceEvent = { ...event, eventId: uuid(), timestamp: now() };
  return Number(await request(tx.objectStore('events').add(item)));
}

interface PendingInteraction { sessionId: string; state: string; kind?: string; question?: string; message?: string }
async function pendingInteractions(tx: IDBTransaction): Promise<Map<string, PendingInteraction>> {
  const rows = await cursorPage<{ value: PendingInteraction }>(tx.objectStore('meta'), IDBKeyRange.bound('interaction:', 'interaction:\uffff'), 200, 'next', 0,
    row => row.value?.state === 'pending' && Boolean(row.value.sessionId));
  return new Map(rows.map(row => [row.value.sessionId, row.value]));
}

export class WorkspaceRepository {
  readonly database: WorkspaceDatabase;
  constructor(database = new WorkspaceDatabase()) { this.database = database; }

  async saveSession(session: Session, events: WorkspaceEvent[] = [], completeness: SessionArchive['completeness'] = 'full'): Promise<void> {
    const { eventLog: _eventLog, ...snapshot } = structuredClone(session);
    await this.database.transaction(['sessions', 'events'], 'readwrite', async tx => {
      const store = tx.objectStore('sessions');
      const existing = await request<SessionArchive | undefined>(store.get(session.id));
      let lastSeq = existing?.lastSeq || 0;
      for (const event of events) {
        if (event.sessionId !== session.id) throw new Error('会话事件关联不一致');
        if (await request(tx.objectStore('events').index('eventId').getKey(event.eventId))) continue;
        lastSeq = Number(await request(tx.objectStore('events').add(event)));
      }
      await request(store.put({
        id: session.id, title: existing?.title || session.summary || '新对话', createdAt: session.createdAt,
        updatedAt: now(), archived: existing?.archived || false, completeness: existing?.completeness || completeness,
        revision: (existing?.revision || 0) + 1, lastSeq, snapshot,
      } satisfies SessionArchive));
    });
  }

  listSessions(before?: SessionCursor, limit = 50, search = ''): Promise<SessionSummary[]> {
    return this.database.transaction(['sessions', 'tasks', 'meta'], 'readonly', async tx => {
      const interactions = await pendingInteractions(tx);
      const rows = await cursorPage<SessionArchive>(tx.objectStore('sessions').index('updatedAt'),
        before ? IDBKeyRange.upperBound(before.updatedAt) : undefined, Math.max(1, Math.min(200, limit)), 'prev', 0,
        row => (!before || row.updatedAt < before.updatedAt || row.id < before.id) && row.title.toLowerCase().includes(search.toLowerCase()));
      return Promise.all(rows.map(async ({ snapshot, ...row }) => ({ ...row, status: snapshot.status,
        activity: getSessionActivity(snapshot, await request<LeadTask[]>(tx.objectStore('tasks').index('sessionId').getAll(row.id)), interactions.get(row.id)) })));
    });
  }

  /** 独立读取进行中的会话，避免旧会话的后台作业被历史分页隐藏。 */
  listActiveSessions(search = '', includeIds: string[] = []): Promise<SessionSummary[]> {
    return this.database.transaction(['sessions', 'tasks', 'meta'], 'readonly', async tx => {
      const interactions = await pendingInteractions(tx);
      const tasks = await cursorPage<LeadTask>(tx.objectStore('tasks'), undefined, Number.MAX_SAFE_INTEGER, 'next', 0,
        task => ['running', 'queued', 'waiting', 'paused'].includes(task.status));
      const ids = new Set([...tasks.map(task => task.sessionId), ...interactions.keys(), ...includeIds.slice(0, 200)]);
      const rows = await cursorPage<SessionArchive>(tx.objectStore('sessions').index('updatedAt'), undefined, 200, 'prev', 0,
        row => (ids.has(row.id) || ['running', 'waiting'].includes(row.snapshot.status)) && row.title.toLowerCase().includes(search.toLowerCase()));
      return Promise.all(rows.map(async ({ snapshot, ...row }) => ({ ...row, status: snapshot.status,
        activity: getSessionActivity(snapshot, await request<LeadTask[]>(tx.objectStore('tasks').index('sessionId').getAll(row.id)), interactions.get(row.id)) })));
    });
  }

  async readSessionHistory(id: string, beforeSeq = Number.MAX_SAFE_INTEGER, limit = 300): Promise<SessionPage> {
    return this.database.transaction(['sessions', 'events'], 'readonly', async tx => {
      const session = await request<SessionArchive | undefined>(tx.objectStore('sessions').get(id));
      if (!session) throw new Error('会话不存在');
      const count = Math.max(1, Math.min(1000, limit));
      const rows = await cursorPage<WorkspaceEvent>(tx.objectStore('events').index('sessionSeq'),
        IDBKeyRange.bound([id, 0], [id, beforeSeq], false, true), count + 1, 'prev');
      const hasMore = rows.length > count;
      if (hasMore) rows.pop();
      const events = rows.reverse();
      return { session, events, hasMore, lastSeq: events.at(-1)?.seq || 0 };
    });
  }

  async readSession(id: string, afterSeq = 0, limit = 300): Promise<SessionPage> {
    return this.database.transaction(['sessions', 'events'], 'readonly', async tx => {
      const session = await request<SessionArchive | undefined>(tx.objectStore('sessions').get(id));
      if (!session) throw new Error('会话不存在');
      const events = await cursorPage<WorkspaceEvent>(tx.objectStore('events').index('sessionSeq'),
        IDBKeyRange.bound([id, afterSeq], [id, Number.MAX_SAFE_INTEGER], true, false), Math.min(1000, limit) + 1);
      const hasMore = events.length > limit;
      if (hasMore) events.pop();
      return { session, events, hasMore, lastSeq: events.at(-1)?.seq || afterSeq };
    });
  }

  async loadRuntimeSession(id: string): Promise<Session | undefined> {
    const record = await this.database.transaction(['sessions'], 'readonly', tx => request<SessionArchive | undefined>(tx.objectStore('sessions').get(id)));
    if (!record) return undefined;
    // 运行缓存只保留最近事件；完整档案始终由查询接口分页读取。
    const events = await this.database.transaction(['events'], 'readonly', tx => cursorPage<WorkspaceEvent>(tx.objectStore('events').index('sessionSeq'),
      IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]), 500, 'prev'));
    return { ...record.snapshot, eventLog: events.reverse().filter(event => !event.type.startsWith('workspace:')) };
  }

  async acceptCommand(command: WorkspaceCommand): Promise<{ receipt: CommandReceipt; duplicate: boolean }> {
    if (!command.requestId || !command.sessionId) throw new Error('缺少指令标识');
    const fingerprint = JSON.stringify(command);
    return this.database.transaction(['commands', 'sessions', 'tasks'], 'readwrite', async tx => {
      const commands = tx.objectStore('commands');
      const existing = await request<CommandReceipt | undefined>(commands.get(command.requestId));
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new WorkspaceConflict('同一指令标识不能用于不同操作');
        return { receipt: existing, duplicate: true };
      }
      const session = await request<SessionArchive | undefined>(tx.objectStore('sessions').get(command.sessionId));
      if (session && command.expectedRevision !== undefined && session.revision !== command.expectedRevision) throw new WorkspaceConflict('会话已有更新，请刷新后重试');
      if (command.taskId) {
        const task = await request<LeadTask | undefined>(tx.objectStore('tasks').get(command.taskId));
        if (!task || task.sessionId !== command.sessionId) throw new WorkspaceConflict('任务不属于目标会话');
      }
      const receipt: CommandReceipt = { id: command.requestId, fingerprint, command, status: 'pending', createdAt: now(), updatedAt: now() };
      await request(commands.add(receipt));
      return { receipt, duplicate: false };
    });
  }

  async claimCommand(id: string): Promise<CommandReceipt | undefined> {
    return this.database.transaction(['commands'], 'readwrite', async tx => {
      const store = tx.objectStore('commands');
      const receipt = await request<CommandReceipt | undefined>(store.get(id));
      if (!receipt || receipt.status !== 'pending') return undefined;
      receipt.status = 'running'; receipt.updatedAt = now();
      await request(store.put(receipt));
      return receipt;
    });
  }

  async finishCommand(id: string, status: CommandReceipt['status'] = 'done'): Promise<void> {
    await this.database.transaction(['commands'], 'readwrite', async tx => {
      const store = tx.objectStore('commands');
      const receipt = await request<CommandReceipt | undefined>(store.get(id));
      if (receipt) await request(store.put({ ...receipt, status, updatedAt: now() }));
    });
  }

  pendingCommands(): Promise<CommandReceipt[]> {
    return this.database.transaction(['commands'], 'readonly', async tx => (await request<CommandReceipt[]>(tx.objectStore('commands').getAll())).filter(row => row.status === 'pending'));
  }

  async archiveSession(id: string, archived = true): Promise<void> {
    await this.database.transaction(['sessions'], 'readwrite', async tx => {
      const store = tx.objectStore('sessions');
      const item = await request<SessionArchive | undefined>(store.get(id));
      if (!item) throw new Error('会话不存在');
      await request(store.put({ ...item, archived, revision: item.revision + 1, updatedAt: now() }));
    });
  }

  async createTask(input: Pick<LeadTask, 'id' | 'sessionId' | 'kind' | 'provider' | 'title' | 'input'> & Partial<Pick<LeadTask, 'maxAttempts' | 'maxBatches'>>): Promise<LeadTask> {
    return this.database.transaction(['tasks', 'events', 'sessions'], 'readwrite', async tx => {
      const store = tx.objectStore('tasks');
      const existing = await request<LeadTask | undefined>(store.get(input.id));
      if (existing) {
        if (existing.sessionId !== input.sessionId || existing.kind !== input.kind || JSON.stringify(existing.input) !== JSON.stringify(input.input)) throw new WorkspaceConflict('作业标识已被另一任务使用');
        return existing;
      }
      if (!await request(tx.objectStore('sessions').getKey(input.sessionId))) throw new Error('请先保存会话再启动作业');
      const task: LeadTask = { ...input, checkpoint: {}, status: 'queued', goalRevision: 1, revision: 1, epoch: 0, batches: 0,
        savedCount: 0, attempts: 0, maxAttempts: input.maxAttempts || 300, maxBatches: input.maxBatches || 100,
        nextRunAt: now(), createdAt: now(), updatedAt: now() };
      await request(store.add(task));
      await emit(tx, { sessionId: task.sessionId, taskId: task.id, type: 'workspace:task_created', content: JSON.stringify({ taskId: task.id, kind: task.kind }) });
      return task;
    });
  }

  listTasks(sessionId?: string): Promise<LeadTask[]> {
    return this.database.transaction(['tasks'], 'readonly', tx => request<LeadTask[]>(sessionId
      ? tx.objectStore('tasks').index('sessionId').getAll(sessionId) : tx.objectStore('tasks').getAll()));
  }

  getTask(id: string): Promise<LeadTask | undefined> {
    return this.database.transaction(['tasks'], 'readonly', tx => request(tx.objectStore('tasks').get(id)));
  }

  async claimTask(id: string, at = now()): Promise<TaskAttempt | undefined> {
    return this.database.transaction(['tasks', 'steps'], 'readwrite', async tx => {
      const store = tx.objectStore('tasks');
      const task = await request<LeadTask | undefined>(store.get(id));
      if (!task || task.status !== 'queued' || task.nextRunAt > at) return undefined;
      if (task.attempts >= task.maxAttempts || task.batches >= task.maxBatches) {
        await request(store.put({ ...task, status: 'partial', reason: '达到作业预算', updatedAt: at, revision: task.revision + 1 }));
        return undefined;
      }
      task.status = 'running'; task.epoch++; task.attempts++; task.revision++; task.updatedAt = at;
      const step: TaskStep = { id: `${task.id}:${task.goalRevision}:${task.batches}`, taskId: id, attemptId: uuid(), epoch: task.epoch,
        status: 'running', startedAt: at, evidenceIds: [] };
      await request(store.put(task));
      // 每次实际尝试独立留档，逻辑步骤 ID 在重试时不变。
      await request(tx.objectStore('steps').put({ ...step, id: step.attemptId, stepId: step.id }));
      return { task, step };
    });
  }

  async commitBatch(attempt: TaskAttempt, batch: BatchResult): Promise<LeadTask> {
    return this.database.transaction(['tasks', 'steps', 'evidence', 'leads', 'taskLeads', 'facts', 'events'], 'readwrite', async tx => {
      const tasks = tx.objectStore('tasks');
      const task = await request<LeadTask | undefined>(tasks.get(attempt.task.id));
      const prior = await request<TaskStep | undefined>(tx.objectStore('steps').get(attempt.step.attemptId));
      if (task && prior?.status === 'succeeded') return task;
      if (!task || task.epoch !== attempt.step.epoch || task.batches !== attempt.task.batches) throw new WorkspaceConflict('执行代次已过期');
      for (const evidence of batch.evidence) {
        if (evidence.taskId !== task.id || evidence.stepId !== attempt.step.id) throw new Error('证据关联错误');
        await request(tx.objectStore('evidence').add(evidence));
      }
      let added = 0;
      for (const incoming of batch.leads) {
        if (!incoming.sourceKey || incoming.evidenceIds.some(id => !batch.evidence.some(e => e.id === id))) throw new Error('线索缺少当前批次证据');
        const existing = await request<Lead | undefined>(tx.objectStore('leads').index('sourceKey').get(incoming.sourceKey));
        const { fieldOrigins, ...incomingLead } = incoming;
        const lead: Lead = { ...existing, ...incomingLead, fields: { ...existing?.fields, ...incoming.fields }, id: existing?.id || uuid(), companyId: existing?.companyId,
          evidenceIds: [...new Set([...(existing?.evidenceIds || []), ...incoming.evidenceIds])], createdAt: existing?.createdAt || now(), updatedAt: now() };
        await request(tx.objectStore('leads').put(lead));
        const relationId = `${task.id}:${lead.id}`;
        if (!await request(tx.objectStore('taskLeads').getKey(relationId))) {
          await request(tx.objectStore('taskLeads').add({ id: relationId, taskId: task.id, leadId: lead.id, discoveredAt: now() } satisfies TaskLead));
          added++;
        }
        for (const [field, value] of Object.entries(incoming.fields)) {
          if (fieldOrigins && !fieldOrigins[field]) continue;
          const evidenceId = incoming.evidenceIds[0];
          if (!evidenceId) throw new Error('字段缺少原始证据');
          await request(tx.objectStore('facts').put({ id: `${lead.id}:${evidenceId}:${field}`, leadId: lead.id, taskId: task.id,
            field, rawValue: fieldOrigins?.[field] ? fieldOrigins[field].rawValue : value, value, evidenceId, sourcePath: fieldOrigins?.[field]?.sourcePath, createdAt: now() } satisfies LeadFact));
        }
      }
      await request(tx.objectStore('steps').put({ ...attempt.step, id: attempt.step.attemptId, stepId: attempt.step.id,
        status: 'succeeded', endedAt: now(), evidenceIds: batch.evidence.map(row => row.id) }));
      const status = task.status === 'paused' || task.status === 'cancelled' ? task.status
        : batch.done ? (batch.partial ? 'partial' : 'completed') : 'queued';
      const updated: LeadTask = { ...task, status, checkpoint: batch.checkpoint, batches: task.batches + 1,
        savedCount: task.savedCount + added, revision: task.revision + 1, updatedAt: now(), nextRunAt: now() + (batch.delayMs || 0), reason: batch.reason };
      await request(tasks.put(updated));
      await emit(tx, { sessionId: task.sessionId, taskId: task.id, type: 'workspace:batch_committed', content: JSON.stringify({ stepId: attempt.step.id, savedCount: updated.savedCount, status }) });
      return updated;
    });
  }

  async failAttempt(attempt: TaskAttempt, message: string, disposition: 'retry' | 'waiting' | 'failed', delayMs = 30_000): Promise<void> {
    await this.database.transaction(['tasks', 'steps', 'events'], 'readwrite', async tx => {
      const task = await request<LeadTask | undefined>(tx.objectStore('tasks').get(attempt.task.id));
      if (!task || task.epoch !== attempt.step.epoch) return;
      const keep = task.status === 'paused' || task.status === 'cancelled';
      await request(tx.objectStore('steps').put({ ...attempt.step, id: attempt.step.attemptId, stepId: attempt.step.id, status: 'failed', endedAt: now(), error: message }));
      await request(tx.objectStore('tasks').put({ ...task, status: keep ? task.status : disposition === 'retry' ? 'queued' : disposition,
        reason: message, revision: task.revision + 1, updatedAt: now(), nextRunAt: now() + delayMs }));
      await emit(tx, { sessionId: task.sessionId, taskId: task.id, type: 'workspace:step_failed', content: JSON.stringify({ message, disposition }) });
    });
  }

  async controlTask(id: string, action: 'pause' | 'resume' | 'cancel', expectedRevision?: number): Promise<LeadTask> {
    return this.database.transaction(['tasks', 'events', 'deliveries'], 'readwrite', async tx => {
      const store = tx.objectStore('tasks');
      const task = await request<LeadTask | undefined>(store.get(id));
      if (!task) throw new Error('任务不存在');
      if (expectedRevision !== undefined && task.revision !== expectedRevision) throw new WorkspaceConflict('任务已有更新');
      if (TERMINAL.has(task.status) && task.status !== 'cancelled') throw new WorkspaceConflict('任务已结束');
      if (action === 'resume') {
        if (TERMINAL.has(task.status) && task.status !== 'cancelled') throw new WorkspaceConflict('已结束任务请新建关联作业');
        const deliveries = await request<Delivery[]>(tx.objectStore('deliveries').index('taskId').getAll(id));
        if (deliveries.some(row => row.status === 'unknown' || row.status === 'sending')) throw new WorkspaceConflict('CRM 提交结果待核对，不能重新提交');
      }
      const updated: LeadTask = { ...task, status: action === 'pause' ? 'paused' : action === 'cancel' ? 'cancelled' : 'queued',
        nextRunAt: now(), updatedAt: now(), revision: task.revision + 1, reason: action === 'resume' ? undefined : '用户操作' };
      await request(store.put(updated));
      await emit(tx, { sessionId: task.sessionId, taskId: id, type: `workspace:task_${action}`, content: JSON.stringify({ status: updated.status }) });
      return updated;
    });
  }

  async reviseCriteria(id: string, criteria: string): Promise<LeadTask> {
    if (!criteria.trim() || criteria.length > 20_000) throw new Error('筛选条件无效');
    return this.database.transaction(['tasks', 'events'], 'readwrite', async tx => {
      const store = tx.objectStore('tasks');
      const task = await request<LeadTask | undefined>(store.get(id));
      if (!task) throw new Error('任务不存在');
      if (task.input.criteria === criteria) return task;
      const updated = { ...task, input: { ...task.input, criteria }, goalRevision: task.goalRevision + 1, revision: task.revision + 1, updatedAt: now() };
      await request(store.put(updated));
      await emit(tx, { sessionId: task.sessionId, taskId: id, type: 'workspace:criteria_changed', content: JSON.stringify({ criteria, goalRevision: updated.goalRevision }) });
      return updated;
    });
  }

  async recover(): Promise<void> {
    await this.database.transaction(['tasks', 'steps', 'deliveries', 'commands', 'sessions', 'meta', 'events'], 'readwrite', async tx => {
      for (const task of await request<LeadTask[]>(tx.objectStore('tasks').getAll())) {
        // 兼容旧版误加的 CRM 查询门槛；仅释放因此等待的读取任务。
        if (task.status === 'waiting' && ['company_search', 'company_contacts'].includes(task.kind)
          && task.reason === '请先打开指定公司的螳螂 CRM 并登录工作台，再继续渠道任务') {
          await request(tx.objectStore('tasks').put({ ...task, status: 'queued', reason: undefined, nextRunAt: now(), updatedAt: now(), revision: task.revision + 1 }));
          await emit(tx, { sessionId: task.sessionId, taskId: task.id, type: 'workspace:notification', content: '企业查询不再依赖 CRM 登录，正在继续原任务。' });
          continue;
        }
        if (task.status !== 'running') continue;
        const status = task.kind === 'tool_read' ? 'failed' : task.kind === 'crm_delivery' ? 'waiting' : 'queued';
        await request(tx.objectStore('tasks').put({ ...task, status, epoch: task.epoch + 1, revision: task.revision + 1, nextRunAt: now(),
          reason: task.kind === 'crm_delivery' ? '后台重启，请核对提交结果' : '从已提交检查点接续', updatedAt: now() }));
      }
      for (const item of await request<Array<TaskStep & { stepId: string }>>(tx.objectStore('steps').getAll())) {
        if (item.status === 'running') await request(tx.objectStore('steps').put({ ...item, status: 'unknown', endedAt: now() }));
      }
      for (const row of await request<Delivery[]>(tx.objectStore('deliveries').getAll())) {
        if (row.status === 'sending') await request(tx.objectStore('deliveries').put({ ...row, status: 'unknown', updatedAt: now(), message: '请求可能已提交，需核对后登记结果' }));
      }
      for (const receipt of await request<CommandReceipt[]>(tx.objectStore('commands').getAll())) {
        if (receipt.status === 'running') await request(tx.objectStore('commands').put({ ...receipt, status: 'interrupted', updatedAt: now() }));
      }
      for (const session of await request<SessionArchive[]>(tx.objectStore('sessions').getAll())) {
        if (['running', 'waiting'].includes(session.snapshot.status)) await request(tx.objectStore('sessions').put({ ...session,
          snapshot: { ...session.snapshot, status: 'error', failureCode: 'E_SESSION_RUNTIME', lastError: '后台已重启，可查看已保存内容并继续对话' } }));
      }
      for (const row of await request<Array<{ id: string; value: { state?: string } }>>(tx.objectStore('meta').getAll())) {
        if (row.id.startsWith('interaction:') && row.value?.state === 'pending') await request(tx.objectStore('meta').put({ ...row, value: { ...row.value, state: 'interrupted' } }));
      }
    });
  }

  async listLeads(taskId?: string, offset = 0, limit = 100, search = ''): Promise<Lead[]> {
    return this.database.transaction(['leads', 'taskLeads'], 'readonly', async tx => {
      const count = Math.max(1, Math.min(5000, limit));
      if (!taskId) return cursorPage<Lead>(tx.objectStore('leads'), undefined, count, 'next', offset,
        search ? lead => `${lead.name} ${Object.values(lead.fields).join(' ')}`.toLowerCase().includes(search.toLowerCase()) : undefined);
      const relations = await cursorPage<TaskLead>(tx.objectStore('taskLeads').index('taskId'), IDBKeyRange.only(taskId), count, 'next', offset);
      const leads = await Promise.all(relations.map(row => request<Lead | undefined>(tx.objectStore('leads').get(row.leadId))));
      return leads.filter((row): row is Lead => Boolean(row));
    });
  }

  async readLead(id: string): Promise<LeadDetail> {
    return this.database.transaction(['leads', 'facts', 'assessments', 'deliveries', 'entityLinks', 'meta', 'tasks'], 'readonly', async tx => {
      const lead = await request<Lead | undefined>(tx.objectStore('leads').get(id));
      if (!lead) throw new Error('线索不存在');
      const history = await cursorPage<{ value: LeadProfile }>(tx.objectStore('meta'), IDBKeyRange.bound(`lead-profile:${id}:`, `lead-profile:${id}:\uffff`), 30, 'prev', 0, row => row.value.leadId === id);
      const assessments = await request<Assessment[]>(tx.objectStore('assessments').index('leadId').getAll(id));
      const assessed = await Promise.all(assessments.map(async item => ({ ...item, current: item.goalRevision === (await request<LeadTask | undefined>(tx.objectStore('tasks').get(item.taskId)))?.goalRevision })));
      return { lead, contacts: getLeadContacts(lead), profileHistory: history.map(row => row.value), facts: await request(tx.objectStore('facts').index('leadId').getAll(id)),
        assessments: assessed, deliveries: await request(tx.objectStore('deliveries').index('leadId').getAll(id)),
        links: await request(tx.objectStore('entityLinks').index('sourceLeadId').getAll(id)) };
    });
  }

  async saveLeadProfile(input: { leadId: string; taskId: string; expectedRevision: number; profile: unknown; factIds: string[]; evidenceIds: string[]; model: string; promptVersion: string }): Promise<LeadProfile> {
    const content = parseLeadProfileContent(input.profile);
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) throw new Error('请提供当前档案版本，首次为 0');
    if (!input.evidenceIds.length) throw new Error('企业档案需要引用来源证据');
    return this.database.transaction(['tasks', 'taskLeads', 'leads', 'facts', 'evidence', 'meta', 'events'], 'readwrite', async tx => {
      const task = await request<LeadTask | undefined>(tx.objectStore('tasks').get(input.taskId));
      const lead = await request<Lead | undefined>(tx.objectStore('leads').get(input.leadId));
      if (!task || !lead || !await request(tx.objectStore('taskLeads').getKey(`${task.id}:${lead.id}`))) throw new Error('档案线索不属于此任务');
      if ((lead.profile?.revision || 0) !== input.expectedRevision) throw new WorkspaceConflict('档案版本已更新，请重新读取后整理');
      for (const id of input.evidenceIds) {
        if (!lead.evidenceIds.includes(id) || !await request(tx.objectStore('evidence').getKey(id))) throw new Error('档案证据不存在或不属于该线索');
      }
      for (const id of input.factIds) {
        const fact = await request<LeadFact | undefined>(tx.objectStore('facts').get(id));
        if (!fact || fact.leadId !== lead.id || !input.evidenceIds.includes(fact.evidenceId)) throw new Error('档案事实不属于该线索或缺少证据');
      }
      // 合并备份可能补入比本机当前档案更新的历史；继续整理不覆盖这些历史版本。
      const [latest] = await cursorPage<{ value: LeadProfile }>(tx.objectStore('meta'), IDBKeyRange.bound(`lead-profile:${lead.id}:`, `lead-profile:${lead.id}:\uffff`), 1, 'prev', 0, row => row.value.leadId === lead.id);
      const profile: LeadProfile = { ...content, id: uuid(), leadId: lead.id, taskId: task.id, revision: Math.max(input.expectedRevision, latest?.value.revision || 0) + 1,
        factIds: [...new Set(input.factIds)], evidenceIds: [...new Set(input.evidenceIds)], model: input.model, promptVersion: input.promptVersion,
        author: 'agent', createdAt: Math.max(now(), (lead.profile?.createdAt || 0) + 1) };
      await request(tx.objectStore('meta').add({ id: leadProfileHistoryKey(lead.id, profile.revision), value: profile }));
      await request(tx.objectStore('leads').put({ ...lead, profile, updatedAt: profile.createdAt }));
      await emit(tx, { sessionId: task.sessionId, taskId: task.id, type: 'workspace:profile_saved', content: JSON.stringify({ leadId: lead.id, profileId: profile.id, revision: profile.revision }) });
      return profile;
    });
  }

  async listLeadSummaries(taskId?: string, offset = 0, limit = 100, search = ''): Promise<LeadSummary[]> {
    const leads = await this.listLeads(taskId, offset, limit, search);
    return this.database.transaction(['assessments', 'tasks'], 'readonly', async tx => {
      const rows: LeadSummary[] = [];
      for (const lead of leads) {
        const assessments = await request<Assessment[]>(tx.objectStore('assessments').index('leadId').getAll(lead.id));
        const latest = assessments.filter(item => !taskId || item.taskId === taskId).sort((a, b) => b.createdAt - a.createdAt).at(0);
        const task = latest ? await request<LeadTask | undefined>(tx.objectStore('tasks').get(latest.taskId)) : undefined;
        rows.push({ ...lead, ...(latest ? { assessment: { status: latest.status, reason: latest.reason, goalRevision: latest.goalRevision, taskId: latest.taskId, current: latest.goalRevision === task?.goalRevision } } : {}) });
      }
      return rows;
    });
  }

  readEvidence(id: string): Promise<Evidence | undefined> {
    return this.database.transaction(['evidence'], 'readonly', tx => request(tx.objectStore('evidence').get(id)));
  }

  async attachFact(leadId: string, evidenceId: string, field: string, sourcePath: string): Promise<LeadFact> {
    if (!field.trim() || field.length > 100 || !sourcePath || sourcePath.length > 500) throw new Error('字段或来源路径无效');
    return this.database.transaction(['leads', 'evidence', 'facts'], 'readwrite', async tx => {
      const lead = await request<Lead | undefined>(tx.objectStore('leads').get(leadId));
      const evidence = await request<Evidence | undefined>(tx.objectStore('evidence').get(evidenceId));
      if (!lead || !evidence) throw new Error('线索或证据不存在');
      const keys = sourcePath.replace(/\[(\d+)\]/g, '.$1').split('.');
      let value: Json | undefined = evidence.payload;
      for (const key of keys) {
        if (!key || ['__proto__', 'constructor', 'prototype'].includes(key) || !value || typeof value !== 'object' || !Object.hasOwn(value, key)) throw new Error('证据字段路径不存在');
        value = (value as { [key: string]: Json })[key];
      }
      if (value === undefined) throw new Error('来源字段不存在');
      const fact: LeadFact = { id: uuid(), leadId, taskId: evidence.taskId, field, rawValue: value, value, sourcePath, evidenceId, createdAt: now() };
      await request(tx.objectStore('facts').add(fact));
      await request(tx.objectStore('leads').put({ ...lead, fields: { ...lead.fields, [field]: value }, evidenceIds: [...new Set([...lead.evidenceIds, evidenceId])], updatedAt: now() }));
      return fact;
    });
  }

  async linkCompany(input: Omit<EntityLink, 'id' | 'createdAt'>): Promise<EntityLink> {
    return this.database.transaction(['leads', 'evidence', 'entityLinks'], 'readwrite', async tx => {
      const source = await request<Lead | undefined>(tx.objectStore('leads').get(input.sourceLeadId));
      const company = await request<Lead | undefined>(tx.objectStore('leads').get(input.companyLeadId));
      if (!source || !company || source.id === company.id || company.kind !== 'company' || !input.reason.trim() || !input.evidenceIds.length) throw new Error('主体关联需要企业候选、理由和证据');
      for (const id of input.evidenceIds) if (!await request(tx.objectStore('evidence').getKey(id))) throw new Error('主体关联证据不存在');
      if (!input.evidenceIds.some(id => source.evidenceIds.includes(id)) || !input.evidenceIds.some(id => company.evidenceIds.includes(id))) throw new Error('主体关联必须引用双方来源证据');
      const sameCreditCode = Boolean(source.fields.socialCreditCode && source.fields.socialCreditCode === company.fields.socialCreditCode);
      const status = input.author === 'human' || sameCreditCode ? input.status : 'candidate';
      const link: EntityLink = { ...input, id: uuid(), status, createdAt: now() };
      await request(tx.objectStore('entityLinks').add(link));
      if (status === 'confirmed') await request(tx.objectStore('leads').put({ ...source, companyId: company.id, updatedAt: now() }));
      return link;
    });
  }

  async assess(input: Omit<Assessment, 'id' | 'createdAt'>): Promise<Assessment> {
    return this.database.transaction(['tasks', 'leads', 'taskLeads', 'facts', 'evidence', 'assessments', 'events'], 'readwrite', async tx => {
      const task = await request<LeadTask | undefined>(tx.objectStore('tasks').get(input.taskId));
      if (!task || task.goalRevision !== input.goalRevision) throw new WorkspaceConflict('筛选条件版本已变更');
      if (!await request(tx.objectStore('taskLeads').getKey(`${task.id}:${input.leadId}`))) throw new Error('线索不属于此任务');
      if (!input.reason.trim() || (input.status !== 'unconfirmed' && (!input.factIds.length || !input.evidenceIds.length))) throw new Error('结论必须提供事实和证据依据');
      for (const id of input.factIds) {
        const fact = await request<LeadFact | undefined>(tx.objectStore('facts').get(id));
        if (!fact || fact.leadId !== input.leadId || !input.evidenceIds.includes(fact.evidenceId)) throw new Error('判断引用的事实不属于该线索或缺少证据');
      }
      const lead = await request<Lead | undefined>(tx.objectStore('leads').get(input.leadId));
      for (const id of input.evidenceIds) {
        if (!lead?.evidenceIds.includes(id) || !await request(tx.objectStore('evidence').getKey(id))) throw new Error('判断引用的证据不存在或不属于该线索');
      }
      let createdAt = now();
      for (const previous of await request<Assessment[]>(tx.objectStore('assessments').index('leadId').getAll(input.leadId))) {
        createdAt = Math.max(createdAt, previous.createdAt + 1);
      }
      const assessment: Assessment = { ...input, id: uuid(), createdAt };
      await request(tx.objectStore('assessments').add(assessment));
      await emit(tx, { sessionId: task.sessionId, taskId: task.id, type: 'workspace:assessment', content: JSON.stringify({ assessmentId: assessment.id, leadId: assessment.leadId }) });
      return assessment;
    });
  }

  async prepareDelivery(input: Omit<Delivery, 'createdAt' | 'updatedAt' | 'status'>): Promise<Delivery> {
    return this.database.transaction(['deliveries', 'leads', 'tasks'], 'readwrite', async tx => {
      const store = tx.objectStore('deliveries');
      const previous = await request<Delivery | undefined>(store.get(input.id));
      if (previous) {
        if (previous.targetIdentity !== input.targetIdentity || previous.leadId !== input.leadId || previous.taskId !== input.taskId) throw new WorkspaceConflict('录入意图不一致');
        return previous;
      }
      if (!await request(tx.objectStore('leads').getKey(input.leadId)) || !await request(tx.objectStore('tasks').getKey(input.taskId))) throw new Error('交付引用不存在');
      const delivery: Delivery = { ...input, status: 'prepared', createdAt: now(), updatedAt: now() };
      await request(store.add(delivery));
      return delivery;
    });
  }

  async updateDelivery(id: string, status: Delivery['status'], receipt?: Delivery['receipt'], message?: string): Promise<Delivery> {
    return this.database.transaction(['deliveries'], 'readwrite', async tx => {
      const store = tx.objectStore('deliveries');
      const delivery = await request<Delivery | undefined>(store.get(id));
      if (!delivery) throw new Error('录入意图不存在');
      if (['recorded', 'duplicate'].includes(delivery.status)) return delivery;
      if (delivery.status === 'failed' && ['prepared', 'sending', 'unknown'].includes(status)) return delivery;
      if (status === 'sending' && delivery.status !== 'prepared') throw new WorkspaceConflict('已发送的 CRM 请求不能再次发送');
      const updated = { ...delivery, status, receipt, message, updatedAt: now() };
      await request(store.put(updated));
      return updated;
    });
  }

  async setMeta(id: string, value: unknown): Promise<void> {
    await this.database.transaction(['meta', 'events'], 'readwrite', async tx => {
      await request(tx.objectStore('meta').put({ id, value }));
      const interaction = value as { sessionId?: string } | null;
      if (id.startsWith('interaction:') && interaction?.sessionId) await emit(tx, {
        sessionId: interaction.sessionId, type: 'workspace:interaction', content: JSON.stringify(value),
      });
    });
  }

  async getMeta<T>(id: string): Promise<T | undefined> {
    return this.database.transaction(['meta'], 'readonly', async tx => (await request<{ value: T } | undefined>(tx.objectStore('meta').get(id)))?.value);
  }

  async listMeta<T>(prefix: string): Promise<T[]> {
    return this.database.transaction(['meta'], 'readonly', async tx => {
      const rows = await cursorPage<{ id: string; value: T }>(tx.objectStore('meta'), IDBKeyRange.bound(prefix, prefix + '\uffff'), 1000);
      return rows.map(row => row.value);
    });
  }

  async listInteractions(sessionId?: string): Promise<unknown[]> {
    if (!sessionId) return [];
    return this.database.transaction(['meta'], 'readonly', async tx => {
      const rows = await cursorPage<{ id: string; value: { state?: string; sessionId?: string } }>(tx.objectStore('meta'),
        IDBKeyRange.bound('interaction:', 'interaction:\uffff'), 100,
        'prev', 0, row => row.value?.state === 'pending' && row.value.sessionId === sessionId);
      return rows.map(row => row.value);
    });
  }

  async backup(): Promise<WorkspaceBackup> {
    return this.database.transaction(STORE_NAMES, 'readonly', async tx => {
      const records: Record<string, unknown[]> = {};
      for (const name of STORE_NAMES) records[name] = await request(tx.objectStore(name).getAll());
      return { format: 'mole-workspace', version: 1, exportedAt: now(), records };
    });
  }

  async importBackup(backup: WorkspaceBackup): Promise<void> {
    if (backup.format !== 'mole-workspace' || backup.version !== 1 || !backup.records) throw new Error('不支持的备份格式');
    // 完整校验在独立模块执行；整个导入采用一个事务，失败不会留下半份关联。
    const { validateBackup } = await import('./validate-backup');
    validateBackup(backup);
    await this.database.transaction(STORE_NAMES, 'readwrite', async tx => {
      for (const name of STORE_NAMES) {
        for (const raw of backup.records[name] || []) {
          const record = structuredClone(raw) as Record<string, unknown>;
          if (name === 'events') {
            if (await request(tx.objectStore(name).index('eventId').getKey(record.eventId as string))) continue;
            delete record.seq;
            await request(tx.objectStore(name).add(record));
            continue;
          }
          // 补齐历史的来源指针，但不覆盖本机当前字段、Agent 档案或交付回执。
          if (name === 'leads') {
            const existing = await request<Lead | undefined>(tx.objectStore(name).get(record.id as string));
            if (existing) {
              if (existing.sourceKey !== record.sourceKey) throw new WorkspaceConflict('备份线索标识与本机来源不一致');
              await request(tx.objectStore(name).put({ ...existing, evidenceIds: [...new Set([...existing.evidenceIds, ...(record.evidenceIds as string[])])] }));
              continue;
            }
          } else if (await request(tx.objectStore(name).getKey(record.id as string))) continue;
          if (name === 'tasks' && ['queued', 'running', 'waiting'].includes(String(record.status))) { record.status = 'paused'; record.reason = '从备份导入，等待明确继续'; }
          if (name === 'commands') record.status = 'interrupted';
          if (name === 'sessions') {
            record.archived = true;
            const snapshot = record.snapshot as Record<string, unknown>;
            if (['running', 'waiting'].includes(String(snapshot.status))) record.snapshot = { ...snapshot, status: 'error', failureCode: 'E_SESSION_RUNTIME', lastError: '从备份导入，等待明确继续' };
          }
          if (name === 'meta' && /^(crm-tab:|platform-tab:|douyin-page:|douyin-watch:|legacy-import-)/.test(String(record.id))) continue;
          if (name === 'meta' && String(record.id).startsWith('interaction:')) record.value = { ...(record.value as object), state: 'interrupted' };
          if (name === 'deliveries' && record.status === 'sending') record.status = 'unknown';
          await request(tx.objectStore(name).add(record));
        }
      }
      // 导入事件会重新分配本机序号，档案游标必须取本机最后事件。
      for (const raw of backup.records.sessions) {
        const id = (raw as SessionArchive).id;
        const session = await request<SessionArchive>(tx.objectStore('sessions').get(id));
        const [last] = await cursorPage<WorkspaceEvent>(tx.objectStore('events').index('sessionSeq'),
          IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]), 1, 'prev');
        await request(tx.objectStore('sessions').put({ ...session, lastSeq: last?.seq || 0 }));
      }
    });
  }
}

export const workspaceRepository = new WorkspaceRepository();
