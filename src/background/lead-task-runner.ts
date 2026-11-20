/** 有界批次调度；Alarm 和页面事件仅唤醒，数据库才是执行状态来源。 */
import Channel from '../lib/channel';
import _console from '../lib/console';
import { workspaceRepository as repository, WorkspaceConflict } from '../lib/workspace-db/repository';
import { workspaceStorageReady } from './workspace-storage';
import { collectDouyin, getContacts, searchCompanies } from '../platforms/read-adapters';
import { PlatformError } from '../platforms/page-job';
import type { BatchResult, TaskAttempt } from '../workspace/types';
import { WorkspacePersistenceError } from '../workspace/errors';

export const WORKSPACE_ALARM = 'mole_workspace_wake';
type Adapter = (attempt: TaskAttempt) => Promise<BatchResult>;
const adapters: Partial<Record<TaskAttempt['task']['kind'], Adapter>> = {
  douyin_collect: collectDouyin, company_search: searchCompanies, company_contacts: getContacts,
};
let running: Promise<void> | undefined;
let requested = false;
let storageBlocked = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let onTaskUpdate: (() => Promise<void>) | undefined;
export function setTaskUpdateHandler(handler: () => Promise<void>): void { onTaskUpdate = handler; }

export function registerTaskAdapter(kind: TaskAttempt['task']['kind'], adapter: Adapter): void { adapters[kind] = adapter; }

async function dispatch(): Promise<void> {
  await workspaceStorageReady();
  // 一次唤醒只执行一个有界批次，平台之间轮转，不让等待占用模型。
  const tasks = await repository.listTasks();
  const next = tasks.filter(task => task.kind !== 'tool_read' && task.status === 'queued' && task.nextRunAt <= Date.now()).sort((a, b) => a.nextRunAt - b.nextRunAt)[0];
  if (next) {
    const attempt = await repository.claimTask(next.id);
    if (attempt) {
      try {
        const adapter = adapters[next.kind];
        if (!adapter) throw new PlatformError('此平台作业尚未配置执行适配器');
        const batch = await adapter(attempt);
        await repository.commitBatch(attempt, batch);
      } catch (error) {
        if (error instanceof WorkspaceConflict) { await schedule(); return; }
        const message = error instanceof Error ? error.message : String(error);
        // IDB 不可写时不再开始后续动作；持久 running 由下次恢复处理。
        if (error instanceof WorkspacePersistenceError || (error instanceof DOMException && ['QuotaExceededError', 'UnknownError', 'AbortError'].includes(error.name))) {
          storageBlocked = true;
          if (timer) clearTimeout(timer);
          timer = undefined;
          await chrome.alarms.clear(WORKSPACE_ALARM);
          Channel.broadcast('__workspace_storage_error', { sessionId: next.sessionId, message: '本地保存失败，作业已停止推进；处理存储问题后重新加载扩展以恢复' });
          throw error;
        }
        const disposition = error instanceof PlatformError ? error.disposition : 'failed';
        const retry = disposition === 'retry' && attempt.task.attempts < Math.min(attempt.task.maxAttempts, (attempt.task.batches + 1) * 3);
        await repository.failAttempt(attempt, message, disposition === 'retry' ? retry ? 'retry' : 'failed' : disposition,
          Math.min(300_000, 30_000 * Math.max(1, attempt.task.attempts - attempt.task.batches)));
      }
      Channel.broadcast('__workspace_changed', { sessionId: next.sessionId, taskId: next.id });
      await onTaskUpdate?.();
    } else {
      Channel.broadcast('__workspace_changed', { sessionId: next.sessionId, taskId: next.id });
      await onTaskUpdate?.();
    }
  }
  await schedule();
}

async function schedule(): Promise<void> {
  const queued = (await repository.listTasks()).filter(task => task.kind !== 'tool_read' && task.status === 'queued');
  if (timer) clearTimeout(timer);
  timer = undefined;
  if (!queued.length) { await chrome.alarms.clear(WORKSPACE_ALARM); return; }
  const when = Math.max(Date.now() + 100, Math.min(...queued.map(task => task.nextRunAt)));
  await chrome.alarms.create(WORKSPACE_ALARM, { when });
  if (when - Date.now() < 30_000) timer = setTimeout(() => { timer = undefined; void wakeLeadTasks(); }, Math.max(100, when - Date.now()));
}

export function wakeLeadTasks(): Promise<void> {
  if (storageBlocked) return Promise.resolve();
  if (running) { requested = true; return running; }
  requested = false;
  running = dispatch().catch(error => _console.error('[Workspace] 作业调度失败，保留持久检查点', error)).finally(() => {
    running = undefined;
    if (requested) void wakeLeadTasks();
  });
  return running;
}

export function installLeadTaskWakeups(): void {
  chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === WORKSPACE_ALARM) void wakeLeadTasks(); });
  chrome.runtime.onStartup.addListener(() => { void wakeLeadTasks(); });
}
