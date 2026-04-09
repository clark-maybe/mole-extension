/**
 * session-replay.ts — 会话回放与同步负载构建
 * 从 session-manager.ts 提取，负责构建回放负载和 session_sync 负载。
 */

import type { Session, SessionEventLogItem, SessionReplayPayload, SessionOpQueueSnapshot, SessionTaskKind } from './session-types';
import { getActiveTurnRuntime, buildSessionOpQueueSnapshot, sessionTaskKinds } from './session-state';
import { reconcileSessionStateFromEventLog } from './session-event';

// ============ 内部工具函数 ============

/** 获取回放元数据 */
function getSessionReplayMeta(session: Session): { eventCount: number; lastTimestamp: number } {
    const eventCount = Array.isArray(session.eventLog) ? session.eventLog.length : 0;
    const lastTimestamp = eventCount > 0
        ? Number(session.eventLog[eventCount - 1]?.timestamp || Date.now())
        : 0;
    return {
        eventCount,
        lastTimestamp,
    };
}

/** 定位最新轮次的回放起始索引 */
function resolveLatestTurnReplayStartIndex(events: SessionEventLogItem[]): number {
    if (!Array.isArray(events) || events.length === 0) return 0;
    for (let index = events.length - 1; index >= 0; index--) {
        if (events[index]?.type === 'turn_started') {
            return index;
        }
    }
    for (let index = events.length - 1; index >= 0; index--) {
        const type = String(events[index]?.type || '');
        if (type === 'turn_completed' || type === 'turn_aborted') {
            return Math.min(events.length - 1, index + 1);
        }
    }
    return 0;
}

/** 在活跃轮次运行时中查找指定会话的运行任务（内联 findRunningTask） */
function findRunningTaskForSession(sessionId: string): { runId: string } | undefined {
    const runtime = getActiveTurnRuntime();
    if (!runtime) return undefined;
    return runtime.tasks.get(sessionId);
}

/** 获取会话任务类型（内联 getSessionTaskKind） */
function getSessionTaskKind(sessionId: string): SessionTaskKind {
    const runtime = getActiveTurnRuntime();
    if (runtime) {
        const task = runtime.tasks.get(sessionId);
        if (task) return task.kind;
    }
    return sessionTaskKinds.get(sessionId) || 'regular';
}

// ============ 导出函数 ============

/** 构建回放负载 */
export function buildSessionReplayPayload(
    session: Session,
    scope: SessionReplayPayload['scope'] = 'latest_turn',
    fromEventCount?: number,
): SessionReplayPayload {
    const allEvents = Array.isArray(session.eventLog) ? session.eventLog : [];
    const totalCount = allEvents.length;
    const normalizedScope: SessionReplayPayload['scope'] = scope === 'delta' || scope === 'full'
        ? scope
        : 'latest_turn';
    let startIndex = 0;

    if (normalizedScope === 'delta') {
        const requested = Number.isFinite(Number(fromEventCount)) ? Number(fromEventCount) : 0;
        startIndex = Math.max(0, Math.min(totalCount, Math.floor(requested)));
    } else if (normalizedScope === 'latest_turn') {
        startIndex = resolveLatestTurnReplayStartIndex(allEvents);
    }

    const events = allEvents.slice(startIndex);
    const lastTimestamp = totalCount > 0
        ? Number(allEvents[totalCount - 1]?.timestamp || Date.now())
        : 0;

    return {
        sessionId: session.id,
        scope: normalizedScope,
        events,
        fromEventCount: startIndex,
        eventCount: totalCount,
        lastTimestamp,
    };
}

/** 标准化 session_sync 负载，避免多处拼接字段 */
export function buildSessionSyncPayload(session: Session) {
    reconcileSessionStateFromEventLog(session);
    const now = Date.now();
    const activeRunId = findRunningTaskForSession(session.id)?.runId || null;
    const replayMeta = getSessionReplayMeta(session);
    return {
        sessionId: session.id,
        activeRunId,
        status: session.status,
        summary: session.summary,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        durationMs: session.durationMs,
        agentState: session.agentState,
        failureCode: session.failureCode,
        lastError: session.lastError,
        taskKind: getSessionTaskKind(session.id),
        opQueue: buildSessionOpQueueSnapshot(now),
        replayEventCount: replayMeta.eventCount,
        replayLastTimestamp: replayMeta.lastTimestamp,
        originTabId: session.originTabId,
        hasContext: Array.isArray(session.context) && session.context.length > 0,
    };
}
