/** 完整会话档案与运行缓存分离；关键检查点必须等待落盘。 */
import _console from '../lib/console';
import Channel from '../lib/channel';
import Storage from '../lib/storage';
import { workspaceRepository as repository } from '../lib/workspace-db/repository';
import type { Session } from '../ai/types';
import { archiveEvent } from '../workspace/types';
import type { WorkspaceEvent } from '../workspace/types';

const pending = new Map<string, WorkspaceEvent[]>();
const snapshots = new Map<string, Session>();
let queue: Promise<void> = Promise.resolve();
let timer: ReturnType<typeof setTimeout> | undefined;
let ready: Promise<void> | undefined;

export function workspaceStorageReady(): Promise<void> {
  if (!ready) ready = (async () => {
    await repository.database.open();
    if (!await repository.getMeta('legacy-import-v1')) {
      const runtime = await Storage.get<{ sessions?: Session[] }>('mole_session_runtime_v1');
      for (const session of runtime?.sessions || []) {
        if (typeof session.id !== 'string' || !Array.isArray(session.eventLog)) continue;
        if (await repository.loadRuntimeSession(session.id)) continue;
        await repository.saveSession(session, session.eventLog.map(event => archiveEvent(session.id, event)), 'legacy_partial');
      }
      const history = await Storage.get<Array<{ sessionId?: string; id?: string; summary?: string; startedAt?: number; updatedAt?: number }>>('mole_session_history_v1');
      for (const item of Array.isArray(history) ? history : []) {
        const id = item.sessionId || item.id;
        if (!id || await repository.loadRuntimeSession(id)) continue;
        const at = item.startedAt || item.updatedAt || Date.now();
        const session: Session = { id, summary: item.summary || '旧版会话记录', status: 'done', context: [], eventLog: [], createdAt: at, startedAt: at,
          agentState: { phase: 'idle', round: 0, reason: '旧版摘要，完整对话未保存', updatedAt: at } };
        await repository.saveSession(session, [{ eventId: `legacy:${id}`, sessionId: id, type: 'workspace:legacy_summary', content: JSON.stringify(item), timestamp: at }], 'legacy_partial');
      }
      await repository.setMeta('legacy-import-v1', { completedAt: Date.now() });
    }
    await repository.recover();
  })().catch(error => { ready = undefined; throw error; });
  return ready;
}

export function queueArchiveEvent(session: Session, event: WorkspaceEvent): void {
  const events = pending.get(session.id) || [];
  // 流式文本是累计快照；同一保存窗口只保留连续文本的最新值。
  if (event.type === 'text' && events.at(-1)?.type === 'text') events[events.length - 1] = event;
  else events.push(event);
  pending.set(session.id, events);
  snapshots.set(session.id, session);
  if (timer) return;
  timer = setTimeout(() => {
    timer = undefined;
    for (const snapshot of snapshots.values()) {
      void flushSessionArchive(snapshot).catch(error => {
        _console.error('[Workspace] 会话保存失败', error);
        Channel.broadcast('__workspace_storage_error', { sessionId: snapshot.id, message: '本地保存失败，执行将在检查点停止' });
      });
    }
  }, 1000);
}

export function flushSessionArchive(session: Session): Promise<void> {
  let events: WorkspaceEvent[] = [];
  const write = queue.then(async () => {
    const snapshot = structuredClone(session);
    events = pending.get(session.id) || [];
    pending.delete(session.id);
    snapshots.delete(session.id);
    await workspaceStorageReady();
    await repository.saveSession(snapshot, events);
    Channel.broadcast('__workspace_changed', { sessionId: session.id });
  });
  queue = write.catch(() => {
    const newer = pending.get(session.id) || [];
    pending.set(session.id, [...events, ...newer]);
    snapshots.set(session.id, session);
  });
  return write;
}
