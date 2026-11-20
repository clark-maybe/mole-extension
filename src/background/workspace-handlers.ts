/** 工作台协议：持久指令、分页读取、任务控制和专用 CRM 配置。 */
import Channel from '../lib/channel';
import Storage from '../lib/storage';
import _console from '../lib/console';
import { workspaceRepository as repository } from '../lib/workspace-db/repository';
import { archiveEvent } from '../workspace/types';
import type { SessionCursor, WorkspaceBackup, WorkspaceCommand } from '../workspace/types';
import { flushSessionArchive, queueArchiveEvent, workspaceStorageReady } from './workspace-storage';
import { abortSessionTask, createSession, isSessionScheduled, loadArchivedSession, runSessionNow, setWorkspaceIdleHandler, sessions, findRunningTask } from './session-manager';
import { registerTaskAdapter, setTaskUpdateHandler, wakeLeadTasks } from './lead-task-runner';
import { bindCrm, recordCrm, saveCrmReceipt } from '../platforms/mantis-crm';
import type { CrmConfig } from '../platforms/mantis-crm';
import { repairInterruptedContext } from './workspace-runtime-context';

registerTaskAdapter('crm_delivery', recordCrm);
Channel.on('__workspace_channel_ready', (raw: unknown, sender, respond) => {
  void (async () => {
    await workspaceStorageReady();
    const data = record(raw);
    if (typeof data.watchId !== 'string' || !data.watchId.startsWith('workspace:') || sender?.frameId !== 0
      || !sender.url?.startsWith('https://www.douyin.com/')) return false;
    const owner = await repository.getMeta<{ taskId: string; tabId: number; epoch: number }>(`douyin-watch:${data.watchId}`);
    if (!owner || owner.tabId !== sender.tab?.id) return false;
    const task = await repository.getTask(owner.taskId);
    if (!task || task.epoch !== owner.epoch) return false;
    if (task.status !== 'waiting') return task.status === 'queued';
    await repository.controlTask(task.id, 'resume', task.revision);
    void wakeLeadTasks();
    return true;
  })().then(accepted => respond?.({ accepted })).catch(() => respond?.({ accepted: false }));
  return true;
});
let pumping: Promise<void> | undefined;
let pumpRequested = false;

async function processCommand(command: WorkspaceCommand): Promise<void> {
  if (command.kind === 'archive_session') { await repository.archiveSession(command.sessionId); return; }
  if (command.taskId && ['pause_task', 'resume_task', 'cancel_task'].includes(command.kind)) {
    await repository.controlTask(command.taskId, command.kind === 'pause_task' ? 'pause' : command.kind === 'resume_task' ? 'resume' : 'cancel');
    void wakeLeadTasks();
    return;
  }
  const internal = command.kind === 'task_update';
  let session = await loadArchivedSession(command.sessionId);
  if (!session && !internal) session = createSession(String(command.text || ''), command.tabId, command.sessionId);
  if (!session) throw new Error('会话不存在');
  if (internal && session.failureCode === 'E_CANCELLED') return;
  const text = String(command.text || '').trim();
  if (!text) throw new Error('消息不能为空');
  queueArchiveEvent(session, archiveEvent(session.id, { type: internal ? 'workspace:notification' : 'workspace:user_message', content: text }));
  if (isSessionScheduled(session.id)) {
    session.pendingUserInputs = [...(session.pendingUserInputs || []), { id: command.requestId, text }];
    await flushSessionArchive(session);
    return;
  }
  await repairInterruptedContext(session);
  if (internal) { session.context.push({ role: 'user', content: text }); session.budgetSnapshot = undefined; }
  await flushSessionArchive(session);
  await runSessionNow(session, text, command.tabId || session.originTabId, { appendUserQuery: !internal });
}

export function pumpWorkspaceCommands(): Promise<void> {
  if (pumping) { pumpRequested = true; return pumping; }
  pumping = (async () => {
    await workspaceStorageReady();
    do {
    pumpRequested = false;
    for (const receipt of await repository.pendingCommands()) {
      if (!await repository.claimCommand(receipt.id)) continue;
      try {
        await processCommand(receipt.command); await repository.finishCommand(receipt.id);
        Channel.broadcast('__workspace_changed', { sessionId: receipt.command.sessionId, taskId: receipt.command.taskId });
      }
      catch (error) {
        await repository.finishCommand(receipt.id, 'interrupted');
        Channel.broadcast('__workspace_command_error', { sessionId: receipt.command.sessionId, requestId: receipt.id, message: error instanceof Error ? error.message : String(error) });
      }
    }
    } while (pumpRequested);
  })().catch(error => _console.error('[Workspace] 指令处理失败', error)).finally(() => { pumping = undefined; });
  return pumping;
}

async function notifyTaskResults(): Promise<void> {
  for (const task of await repository.listTasks()) {
    if (task.kind === 'tool_read' || !['completed', 'partial', 'failed'].includes(task.status)) continue;
    const requestId = `task-update:${task.id}:${task.goalRevision}:${task.batches}:${task.status}`;
    await repository.acceptCommand({ requestId, sessionId: task.sessionId, kind: 'task_update', taskId: task.id,
      text: `[系统作业通知] ${task.title}：${task.status}，已保存 ${task.savedCount} 条。task_id=${task.id}，goal_revision=${task.goalRevision}。${task.reason || ''}\n请用 lead_workspace 分页查看结果，继续必要的画像、主体核验和交付；资料不足保留待确认。` });
  }
  await pumpWorkspaceCommands();
}

setTaskUpdateHandler(notifyTaskResults);
setWorkspaceIdleHandler(() => {
  void (async () => {
    await pumpWorkspaceCommands();
    // 输入恰好在最后一轮到达时，也要开启后续回合，不依赖页面再次发送。
    for (const session of sessions.values()) {
      if (session.status !== 'done' || !session.pendingUserInputs?.length || isSessionScheduled(session.id)) continue;
      session.budgetSnapshot = undefined;
      await runSessionNow(session, session.summary, session.originTabId, { appendUserQuery: false });
    }
  })().catch(error => _console.error('[Workspace] 待处理输入接续失败', error));
});

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('消息格式无效');
  return value as Record<string, unknown>;
}

function extensionPage(sender?: chrome.runtime.MessageSender): boolean {
  return Boolean(sender?.url?.startsWith(chrome.runtime.getURL('')));
}

Channel.on('__workspace_query', (raw: unknown, sender, respond) => {
  void (async () => {
    await workspaceStorageReady();
    const data = record(raw);
    let value: unknown;
    switch (data.kind) {
      case 'sessions': {
        const before = data.before && typeof data.before === 'object' ? data.before as SessionCursor : undefined;
        if (before && (typeof before.updatedAt !== 'number' || typeof before.id !== 'string')) throw new Error('会话分页标识无效');
        value = await repository.listSessions(before, 50, typeof data.search === 'string' ? data.search : ''); break;
      }
      case 'session_history': value = await repository.readSessionHistory(String(data.sessionId), typeof data.beforeSeq === 'number' ? data.beforeSeq : undefined); break;
      case 'session': value = await repository.readSession(String(data.sessionId), Math.max(0, Number(data.afterSeq) || 0)); break;
      case 'tasks': value = await repository.listTasks(typeof data.sessionId === 'string' ? data.sessionId : undefined); break;
      case 'leads': value = await repository.listLeadSummaries(typeof data.taskId === 'string' ? data.taskId : undefined, Math.max(0, Number(data.offset) || 0), 100, typeof data.search === 'string' ? data.search : ''); break;
      case 'lead': value = await repository.readLead(String(data.leadId)); break;
      case 'evidence': value = await repository.readEvidence(String(data.evidenceId)); break;
      case 'config': value = { crm: await repository.getMeta<CrmConfig>('crm-config'), hasVerification: Boolean(await Storage.get('mole_sales_crm_verification')) }; break;
      case 'interactions': value = await repository.listInteractions(typeof data.sessionId === 'string' ? data.sessionId : undefined); break;
      case 'capacity': value = await navigator.storage.estimate(); break;
      case 'backup': if (!extensionPage(sender)) throw new Error('请在工作台备份数据'); value = await repository.backup(); break;
      default: throw new Error('不支持的工作台查询');
    }
    respond?.({ success: true, data: value });
  })().catch(error => respond?.({ success: false, error: error instanceof Error ? error.message : String(error) }));
  return true;
});

Channel.on('__workspace_command', (raw: unknown, _sender, respond) => {
  void (async () => {
    await workspaceStorageReady();
    const data = record(raw);
    if (!['send_message', 'pause_task', 'resume_task', 'cancel_task', 'archive_session'].includes(String(data.kind))
      || typeof data.requestId !== 'string' || !data.requestId || typeof data.sessionId !== 'string' || !data.sessionId) throw new Error('工作台指令无效');
    if (data.kind === 'send_message' && (typeof data.text !== 'string' || !data.text.trim() || data.text.length > 40_000)) throw new Error('请输入 1–40000 字的消息');
    const command: WorkspaceCommand = { requestId: data.requestId, sessionId: data.sessionId, kind: data.kind as WorkspaceCommand['kind'],
      ...(typeof data.taskId === 'string' ? { taskId: data.taskId } : {}), ...(typeof data.text === 'string' ? { text: data.text.trim() } : {}),
      ...(typeof data.tabId === 'number' && Number.isInteger(data.tabId) && data.tabId > 0 ? { tabId: data.tabId } : {}),
      ...(typeof data.expectedRevision === 'number' ? { expectedRevision: data.expectedRevision } : {}) };
    if (command.tabId) {
      const tab = await chrome.tabs.get(command.tabId);
      if (!/^https?:/.test(tab.url || '')) delete command.tabId;
    }
    const result = await repository.acceptCommand(command);
    respond?.({ success: true, data: { accepted: true, duplicate: result.duplicate, sessionId: command.sessionId, requestId: command.requestId } });
    void pumpWorkspaceCommands();
  })().catch(error => respond?.({ success: false, error: error instanceof Error ? error.message : String(error) }));
  return true;
});

Channel.on('__workspace_action', (raw: unknown, sender, respond) => {
  void (async () => {
    if (!extensionPage(sender)) throw new Error('请在工作台操作');
    await workspaceStorageReady();
    const data = record(raw);
    let value: unknown;
    switch (data.action) {
      case 'bind_crm': value = await bindCrm(Number(data.tabId)); break;
      case 'set_verification':
        if (typeof data.value !== 'string' || data.value.length > 500) throw new Error('验证配置无效');
        await Storage.save('mole_sales_crm_verification', data.value); value = true; break;
      case 'import': await repository.importBackup(data.backup as WorkspaceBackup); value = true; break;
      case 'confirm_company': {
        const link = record(data.link);
        value = await repository.linkCompany({ sourceLeadId: String(link.sourceLeadId), companyLeadId: String(link.companyLeadId), status: 'confirmed', reason: String(data.reason || ''),
          evidenceIds: Array.isArray(link.evidenceIds) ? link.evidenceIds.map(String) : [], author: 'human' }); break;
      }
      case 'reconcile': {
        const message = String(data.message || '').trim();
        if (!message || !['recorded', 'duplicate', 'failed'].includes(String(data.status))) throw new Error('请提供核对结果和依据');
        value = await repository.updateDelivery(String(data.operationId), data.status as 'recorded' | 'duplicate' | 'failed', { manual: true, note: message, checkedAt: Date.now() }, message); break;
      }
      case 'stop_session': {
        const id = String(data.sessionId);
        if (findRunningTask(id)) await abortSessionTask(id, 'interrupted', '用户停止当前回合', 'E_CANCELLED');
        const session = sessions.get(id);
        if (session) { session.status = 'error'; session.failureCode = 'E_CANCELLED'; await flushSessionArchive(session); }
        value = true; break;
      }
      case 'resume_session': {
        const session = await loadArchivedSession(String(data.sessionId));
        if (!session || isSessionScheduled(session.id)) throw new Error('会话不存在或正在执行');
        await repairInterruptedContext(session);
        await runSessionNow(session, session.summary, session.originTabId, { appendUserQuery: session.context.length === 0 });
        value = true; break;
      }
      default: throw new Error('不支持的工作台操作');
    }
    respond?.({ success: true, data: value });
    Channel.broadcast('__workspace_changed', { sessionId: data.sessionId });
  })().catch(error => respond?.({ success: false, error: error instanceof Error ? error.message : String(error) }));
  return true;
});

Channel.on('__workspace_crm_receipt', (raw: unknown, sender, respond) => {
  void (async () => {
    await workspaceStorageReady();
    const data = record(raw);
    const owner = await repository.getMeta<{ tabId: number; targetHost: string }>(`crm-tab:${String(data.operationId)}`);
    if (!owner || owner.tabId !== sender?.tab?.id || !sender.url || new URL(sender.url).hostname !== owner.targetHost || sender.frameId !== 0) throw new Error('CRM 回执页签不匹配');
    await saveCrmReceipt(String(data.operationId), data.payload);
    Channel.broadcast('__workspace_changed', {});
    respond?.({ success: true });
  })().catch(error => respond?.({ success: false, error: error instanceof Error ? error.message : String(error) }));
  return true;
});

export async function startWorkspace(): Promise<void> {
  await workspaceStorageReady();
  await pumpWorkspaceCommands();
  await notifyTaskResults();
  void wakeLeadTasks();
}
