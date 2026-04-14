/**
 * session-event.ts — 事件解析与错误工具函数
 * 从 session-manager.ts 提取，负责解析 eventLog 中的各类事件、重建会话状态、构建错误内容。
 */

import type {
    AIErrorPayload,
    AgentStateTransition,
    Session,
    SessionEventLogItem,
    SessionFailureCode,
    SessionStatus,
    SessionTaskKind,
    TurnLifecycleEventPayload,
} from './session-types';
import { sessionTaskKinds, normalizeTaskKind } from './session-state';

// ============ 事件解析函数 ============

/** 解析 JSON 事件内容，返回对象或 null */
export function parseEventObject(content: string): Record<string, unknown> | null {
    if (!content) return null;
    try {
        const parsed = JSON.parse(content) as Record<string, unknown>;
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

/** 从 eventLog 中逆序查找最新的 turn_started 事件，提取 runId */
export function extractLatestStartedRunId(eventLog: SessionEventLogItem[] | undefined): string | null {
    if (!Array.isArray(eventLog) || eventLog.length === 0) return null;
    for (let index = eventLog.length - 1; index >= 0; index--) {
        const event = eventLog[index];
        if (event.type !== 'turn_started') continue;
        const payload = parseEventObject(event.content || '');
        const runId = typeof payload?.runId === 'string' && payload.runId.trim() ? payload.runId.trim() : '';
        if (runId) return runId;
    }
    return null;
}

/** 解析轮次生命周期事件（turn_completed / turn_aborted）的 payload */
export function parseTurnLifecycleEventPayload(content: string): TurnLifecycleEventPayload | null {
    const parsed = parseEventObject(content);
    if (!parsed) return null;
    const hasErrorHint = typeof parsed.failureCode === 'string'
        || typeof parsed.reason === 'string'
        || parsed.abortReason === 'interrupted'
        || parsed.abortReason === 'replaced';
    const status = parsed.status === 'running' || parsed.status === 'done' || parsed.status === 'error'
        ? parsed.status
        : (hasErrorHint ? 'error' : 'done');
    return {
        sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : undefined,
        runId: typeof parsed.runId === 'string' && parsed.runId.trim() ? parsed.runId : null,
        endedAt: typeof parsed.endedAt === 'number' ? parsed.endedAt : Date.now(),
        durationMs: typeof parsed.durationMs === 'number' ? parsed.durationMs : 0,
        taskKind: typeof parsed.taskKind === 'string' ? parsed.taskKind : undefined,
        status,
        failureCode: typeof parsed.failureCode === 'string' && parsed.failureCode.trim()
            ? parsed.failureCode as SessionFailureCode
            : undefined,
        reason: typeof parsed.reason === 'string' && parsed.reason.trim() ? parsed.reason : undefined,
        lastAgentMessage: typeof parsed.lastAgentMessage === 'string' ? parsed.lastAgentMessage : undefined,
        abortReason: parsed.abortReason === 'interrupted' || parsed.abortReason === 'replaced'
            ? parsed.abortReason
            : undefined,
    };
}

/** 解析任务生命周期状态（entered_review_mode / exited_review_mode / context_compacted） */
function parseTaskLifecycleStatus(content: string): SessionStatus | null {
    const parsed = parseEventObject(content);
    if (!parsed) return null;
    const status = String(parsed.status || '').trim();
    if (status === 'running' || status === 'done' || status === 'error') {
        return status;
    }
    return null;
}

/** 从 eventLog 重建会话状态（用于恢复、重放等场景） */
export function reconcileSessionStateFromEventLog(session: Session) {
    const events = Array.isArray(session.eventLog) ? session.eventLog : [];
    if (events.length === 0) return;

    let startedAt = session.startedAt || session.createdAt || Date.now();
    let status: SessionStatus = session.status || 'done';
    let endedAt: number | undefined = session.endedAt;
    let durationMs: number | undefined = session.durationMs ?? undefined;
    let failureCode: SessionFailureCode | undefined = session.failureCode;
    let lastError: string | undefined = session.lastError;
    let taskKindFromEvents: SessionTaskKind | null = null;
    let latestRound = session.agentState?.round || 0;
    let latestPhase = session.agentState?.phase || 'idle';
    let latestReason = session.agentState?.reason || '';
    let latestAgentStateAt = session.agentState?.updatedAt || session.createdAt || Date.now();

    for (const event of events) {
        if (event.type === 'turn_started') {
            const payload = parseEventObject(event.content || '');
            const nextStartedAt = typeof payload?.startedAt === 'number'
                ? payload.startedAt
                : (event.timestamp || Date.now());
            const taskKind = normalizeTaskKind(typeof payload?.taskKind === 'string' ? payload.taskKind : undefined);
            startedAt = nextStartedAt;
            status = 'running';
            endedAt = undefined;
            durationMs = undefined;
            failureCode = undefined;
            lastError = undefined;
            if (taskKind !== 'regular') {
                taskKindFromEvents = taskKind;
            }
            continue;
        }

        if (event.type === 'agent_state') {
            try {
                const transition = JSON.parse(event.content || '{}') as AgentStateTransition;
                latestRound = typeof transition.round === 'number' ? transition.round : latestRound;
                latestPhase = transition.to || latestPhase;
                latestReason = transition.reason || latestReason;
                latestAgentStateAt = transition.timestamp || event.timestamp || Date.now();
            } catch {
                // 忽略格式异常的 payload
            }
            continue;
        }

        if (event.type === 'error') {
            const parsedError = parseErrorContent(event.content || '');
            const timestamp = event.timestamp || Date.now();
            status = 'error';
            failureCode = parsedError.code || failureCode || 'E_UNKNOWN';
            lastError = parsedError.message || lastError || '会话异常终止';
            endedAt = timestamp;
            durationMs = Math.max(0, timestamp - startedAt);
            latestPhase = 'finalize';
            latestReason = `异常结束：${lastError}`;
            latestAgentStateAt = timestamp;
            continue;
        }

        if (event.type === 'turn_completed' || event.type === 'turn_aborted') {
            const payload = parseTurnLifecycleEventPayload(event.content || '');
            const timestamp = event.timestamp || Date.now();
            const resolvedEndedAt = payload?.endedAt || timestamp;
            const resolvedDurationMs = payload && payload.durationMs > 0
                ? payload.durationMs
                : Math.max(0, resolvedEndedAt - startedAt);
            const resolvedStatus: SessionStatus = event.type === 'turn_aborted'
                ? 'error'
                : (payload?.status === 'error' ? 'error' : 'done');
            const taskKind = normalizeTaskKind(payload?.taskKind);

            if (taskKind !== 'regular') {
                taskKindFromEvents = taskKind;
            }
            status = resolvedStatus;
            endedAt = resolvedEndedAt;
            durationMs = resolvedDurationMs;

            if (resolvedStatus === 'error') {
                const reason = payload?.reason || lastError || (event.type === 'turn_aborted' ? '任务已中断' : '会话异常终止');
                const fallbackCode: SessionFailureCode = event.type === 'turn_aborted'
                    ? 'E_CANCELLED'
                    : resolveFailureCode(reason);
                failureCode = payload?.failureCode || failureCode || fallbackCode;
                lastError = reason;
                latestReason = `${event.type === 'turn_aborted' ? '已中断' : '异常结束'}：${reason}`;
            } else {
                failureCode = undefined;
                lastError = undefined;
                latestReason = '任务完成';
            }
            latestPhase = 'finalize';
            latestAgentStateAt = resolvedEndedAt;
            continue;
        }

        if (event.type === 'entered_review_mode' || event.type === 'exited_review_mode' || event.type === 'context_compacted') {
            const lifecycleStatus = parseTaskLifecycleStatus(event.content || '');
            if (lifecycleStatus) {
                status = lifecycleStatus;
                if (status === 'error') {
                    const parsed = parseEventObject(event.content || '');
                    const lifecycleReason = typeof parsed?.reason === 'string' && parsed.reason.trim()
                        ? parsed.reason.trim()
                        : (typeof parsed?.message === 'string' ? parsed.message.trim() : '');
                    if (lifecycleReason) {
                        lastError = lifecycleReason;
                        failureCode = typeof parsed?.failureCode === 'string' && parsed.failureCode.trim()
                            ? parsed.failureCode as SessionFailureCode
                            : (failureCode || resolveFailureCode(lifecycleReason));
                        latestReason = `异常结束：${lifecycleReason}`;
                    }
                    latestPhase = 'finalize';
                }
            }
        }
    }

    session.startedAt = startedAt;
    session.status = status;
    session.endedAt = status === 'running' ? undefined : endedAt;
    session.durationMs = status === 'running' ? undefined : durationMs;
    session.failureCode = status === 'error' ? (failureCode || 'E_UNKNOWN') : undefined;
    session.lastError = status === 'error' ? (lastError || session.lastError || '会话异常终止') : undefined;
    session.agentState = {
        phase: latestPhase,
        round: latestRound,
        reason: latestReason || session.agentState?.reason || '',
        updatedAt: latestAgentStateAt,
    };

    if (taskKindFromEvents) {
        sessionTaskKinds.set(session.id, taskKindFromEvents);
    }
}

/** 将轮次生命周期事件（turn_completed / turn_aborted）应用到会话 */
export function applyTurnLifecycleEventToSession(
    session: Session,
    eventType: 'turn_completed' | 'turn_aborted',
    payload: TurnLifecycleEventPayload | null,
) {
    const endedAt = payload?.endedAt ?? Date.now();
    const durationMs = payload && payload.durationMs > 0
        ? payload.durationMs
        : Math.max(0, endedAt - session.startedAt);
    const resolvedStatus: SessionStatus = eventType === 'turn_aborted'
        ? 'error'
        : (payload?.status === 'error' ? 'error' : 'done');

    session.endedAt = endedAt;
    session.durationMs = durationMs;

    if (resolvedStatus === 'error') {
        const fallbackReason = eventType === 'turn_aborted'
            ? '任务已中断'
            : '会话异常终止';
        const reason = typeof payload?.reason === 'string' && payload.reason.trim()
            ? payload.reason
            : (session.lastError || fallbackReason);
        const fallbackFailureCode: SessionFailureCode = eventType === 'turn_aborted'
            ? 'E_CANCELLED'
            : resolveFailureCode(reason);
        const failureCode = payload?.failureCode || session.failureCode || fallbackFailureCode;
        session.status = 'error';
        session.failureCode = failureCode;
        session.lastError = reason;
        session.agentState = {
            phase: 'finalize',
            round: session.agentState.round,
            reason: `${eventType === 'turn_aborted' ? '已中断' : '异常结束'}：${reason}`,
            updatedAt: Date.now(),
        };
        return;
    }

    session.status = 'done';
    session.failureCode = undefined;
    session.lastError = undefined;
    session.agentState = {
        phase: 'finalize',
        round: session.agentState.round,
        reason: '任务完成',
        updatedAt: Date.now(),
    };
}

// ============ 错误工具函数 ============

/** 从错误文案推导失败码，便于快速定位问题 */
export function resolveFailureCode(message: string): SessionFailureCode {
    const text = message || '';
    if (text.includes('API Key') || text.includes('请先登录')) return 'E_LLM_API';
    if (text.includes('取消')) return 'E_CANCELLED';
    if (text.includes('回合不匹配') || (text.includes('expected') && text.includes('actual'))) return 'E_TURN_MISMATCH';
    if (text.includes('LLM API')) return 'E_LLM_API';
    if (text.includes('参数解析失败')) return 'E_PARAM_RESOLVE';
    if (text.includes('工具') && text.includes('出错')) return 'E_TOOL_EXEC';
    if (text.includes('未能实际执行工具')) return 'E_NO_TOOL_EXEC';
    if (text.includes('会话处理异常') || text.includes('AI 处理异常')) return 'E_SESSION_RUNTIME';
    return 'E_UNKNOWN';
}

/** 解析 error 事件内容，兼容结构化 JSON 与纯文本 */
export function parseErrorContent(content: string): { code: SessionFailureCode; message: string } {
    try {
        const parsed = JSON.parse(content) as AIErrorPayload;
        if (parsed && parsed.code && parsed.message) {
            return {
                code: parsed.code,
                message: parsed.message,
            };
        }
    } catch {
        // 非 JSON，走文本回退
    }
    return {
        code: resolveFailureCode(content),
        message: content,
    };
}

/** 生成结构化错误内容（统一 error 事件协议） */
export function buildErrorContent(
    code: SessionFailureCode,
    message: string,
    origin: AIErrorPayload['origin'] = 'background',
    retriable?: boolean,
): string {
    const payload: AIErrorPayload = {
        code,
        message,
        origin,
        ...(retriable !== undefined ? { retriable } : {}),
    };
    return JSON.stringify(payload);
}

/** 构建轮次生命周期事件的 payload（纯数据构建，无副作用） */
export function buildTurnLifecycleEventPayload(
    status: SessionStatus,
    session: Session,
    runId: string | null,
    extra?: Partial<TurnLifecycleEventPayload>,
): TurnLifecycleEventPayload {
    const endedAt = typeof extra?.endedAt === 'number' ? extra.endedAt : Date.now();
    const durationMs = typeof extra?.durationMs === 'number'
        ? extra.durationMs
        : Math.max(0, endedAt - session.startedAt);
    return {
        sessionId: session.id,
        runId,
        endedAt,
        durationMs,
        status,
        ...extra,
    };
}
