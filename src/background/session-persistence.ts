/**
 * session-persistence.ts — 会话持久化与恢复
 * 从 session-manager.ts 提取，负责 chrome.storage 读写、运行态快照持久化与恢复。
 */

import type { Session, SessionFailureCode } from './session-types';
import { SESSION_RUNTIME_STORAGE_KEY, MAX_RUNTIME_EVENT_LOG, MAX_RUNTIME_CONTEXT } from './session-types';
import { sessions, sessionTaskKinds, getActiveSessionId, setActiveSessionId } from './session-state';
import { reconcileSessionStateFromEventLog, extractLatestStartedRunId, buildErrorContent, buildTurnLifecycleEventPayload } from './session-event';

// ============ chrome.storage 工具 ============

/** 读取 chrome.storage.local */
export function getLocalStorage<T>(key: string): Promise<T | undefined> {
    return new Promise((resolve) => {
        chrome.storage.local.get(key, (result) => {
            resolve(result[key] as T | undefined);
        });
    });
}

/** 写入 chrome.storage.local */
export function setLocalStorage(data: Record<string, unknown>): Promise<void> {
    return new Promise((resolve) => {
        chrome.storage.local.set(data, () => resolve());
    });
}

// ============ 运行态持久化 ============

const RUNTIME_PERSIST_DEBOUNCE_MS = 220;

let runtimeSessionPersistQueue: Promise<void> = Promise.resolve();
let runtimePersistTimer: number | null = null;
let runtimePersistPending = false;

/** 截断 context/eventLog 的快照，避免持久化数据过大 */
const snapshotSessionForRuntime = (session: Session): Session => ({
    ...session,
    context: session.context.slice(-MAX_RUNTIME_CONTEXT),
    eventLog: session.eventLog.slice(-MAX_RUNTIME_EVENT_LOG),
});

/** 队列化持久化，避免并发写入冲突 */
function queueRuntimeSessionsPersist(): Promise<void> {
    runtimeSessionPersistQueue = runtimeSessionPersistQueue
        .then(async () => {
            const payload = {
                activeSessionId: getActiveSessionId(),
                sessions: Array.from(sessions.values()).map(snapshotSessionForRuntime),
                updatedAt: Date.now(),
            };
            await chrome.storage.local.set({
                [SESSION_RUNTIME_STORAGE_KEY]: payload,
            });
        })
        .catch((err) => {
            console.error('[Mole] 持久化会话运行态失败:', err);
        });
    return runtimeSessionPersistQueue;
}

/** 立刻触发持久化队列 */
function flushRuntimeSessions() {
    void queueRuntimeSessionsPersist();
}

/** debounce 持久化运行态会话 */
export function persistRuntimeSessions() {
    runtimePersistPending = true;
    if (runtimePersistTimer !== null) return;

    runtimePersistTimer = globalThis.setTimeout(() => {
        runtimePersistTimer = null;
        if (!runtimePersistPending) return;
        runtimePersistPending = false;
        flushRuntimeSessions();
    }, RUNTIME_PERSIST_DEBOUNCE_MS);
}

/** 立刻持久化运行态会话（跳过 debounce） */
export async function persistRuntimeSessionsImmediate() {
    runtimePersistPending = false;
    if (runtimePersistTimer !== null) {
        clearTimeout(runtimePersistTimer);
        runtimePersistTimer = null;
    }
    await queueRuntimeSessionsPersist();
}

/** 从 storage 恢复会话运行态 */
export async function restoreRuntimeSessions() {
    try {
        const result = await chrome.storage.local.get(SESSION_RUNTIME_STORAGE_KEY);
        const raw = result[SESSION_RUNTIME_STORAGE_KEY];
        if (!raw || !Array.isArray(raw.sessions)) return;

        sessions.clear();
        sessionTaskKinds.clear();
        let patchedAfterRestore = false;
        for (const item of raw.sessions as Session[]) {
            if (!item?.id || typeof item.id !== 'string') continue;
            reconcileSessionStateFromEventLog(item);
            if (item.status === 'running') {
                const endedAt = Date.now();
                const latestRunId = extractLatestStartedRunId(item.eventLog);
                const reason = '后台服务已重启，上一轮任务已中断。';
                // 内联 getSessionTaskKind：直接从 sessionTaskKinds 查找
                const taskKind = sessionTaskKinds.get(item.id) || 'regular';
                const abortedPayload = buildTurnLifecycleEventPayload('error', item, latestRunId, {
                    endedAt,
                    durationMs: Math.max(0, endedAt - (item.startedAt || endedAt)),
                    taskKind,
                    failureCode: 'E_SESSION_RUNTIME' as SessionFailureCode,
                    reason,
                    abortReason: 'interrupted',
                });
                item.status = 'error';
                item.endedAt = endedAt;
                item.durationMs = abortedPayload.durationMs;
                item.failureCode = 'E_SESSION_RUNTIME';
                item.lastError = reason;
                item.agentState = {
                    phase: 'finalize',
                    round: item.agentState?.round || 0,
                    reason: `异常结束：${reason}`,
                    updatedAt: endedAt,
                };
                item.eventLog = [...(item.eventLog || []), {
                    type: 'turn_aborted',
                    content: JSON.stringify(abortedPayload),
                    timestamp: endedAt,
                }];
                patchedAfterRestore = true;
            }
            sessions.set(item.id, item);
        }

        const restoredActiveId = typeof raw.activeSessionId === 'string' ? raw.activeSessionId : null;
        setActiveSessionId(restoredActiveId && sessions.has(restoredActiveId) ? restoredActiveId : null);
        if (patchedAfterRestore) {
            await queueRuntimeSessionsPersist();
        }
    } catch (err) {
        console.error('[Mole] 恢复会话运行态失败:', err);
    }
}
