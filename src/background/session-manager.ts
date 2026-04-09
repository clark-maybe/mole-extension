/**
 * SessionManager Hub：会话集中管理
 * 负责生命周期、Task Runner 引擎、pushEvent、工具函数
 * 具体的状态、事件、资源、持久化、历史、回放、审查/压缩 逻辑已拆分到 spoke 模块
 */
import Channel from '../lib/channel';
import { handleChat } from '../ai/orchestrator';
import { getTextContent } from '../ai/context-manager';
import { mcpClient } from '../functions/registry';
import type { HandleChatOptions } from '../ai/orchestrator';
import type {
    AIStreamEvent,
    AIErrorPayload,
    AgentStateTransition,
    InputItem,
    OutputItem,
    Session,
    SessionEventLogItem,
    SessionFailureCode,
    SessionStatus,
    TaskLifecycleEventPayload,
    TurnLifecycleEventPayload,
} from '../ai/types';

// ============ 从 spoke 模块导入 ============

// 类型与常量
import type {
    SessionTaskKind,
    TurnAbortReason,
    ExecuteSessionOptions,
    RunningSessionTask,
    SessionTaskRunner,
    SessionTaskRunContext,
    ActiveTurnRuntime,
} from './session-types';
import {
    MAX_SESSIONS,
    MAX_MODEL_CONTEXT_ITEMS,
    TURN_ABORTED_INTERRUPTED_GUIDANCE,
    DEFAULT_REVIEW_TASK_QUERY,
    DEFAULT_COMPACT_TASK_QUERY,
    SESSION_CONTEXT_COMPRESSION_TAG,
    GRACEFUL_ABORT_TIMEOUT_MS,
    SESSION_SYNC_EVENT_TYPES,
    SESSION_IMMEDIATE_PERSIST_EVENT_TYPES,
    SESSION_PRE_EMIT_PERSIST_EVENT_TYPES,
} from './session-types';

// 状态
import {
    sessions,
    getActiveSessionId,
    setActiveSessionId,
    activeControllers,
    sessionTaskKinds,
    activeCoalescedTasks,
    getActiveTurnRuntime,
    setActiveTurnRuntime,
    ensureActiveTurnRuntime,
    dispatchSessionOp,
    respondSessionOp,
    buildSessionOpQueueSnapshot,
    delayMs,
    normalizeTaskKind,
} from './session-state';

// 事件
import {
    reconcileSessionStateFromEventLog,
    extractLatestStartedRunId,
    parseTurnLifecycleEventPayload,
    applyTurnLifecycleEventToSession,
    resolveFailureCode,
    parseErrorContent,
    buildErrorContent,
    buildTurnLifecycleEventPayload,
} from './session-event';

// 资源
import { RuntimeResourceManager, trackRuntimeResourceFromEvent } from './session-resource';

// 持久化
import { persistRuntimeSessions, persistRuntimeSessionsImmediate, restoreRuntimeSessions } from './session-persistence';

// 历史
import { persistSessionHistory } from './session-history';

// 回放
import { buildSessionReplayPayload, buildSessionSyncPayload } from './session-replay';

// 审查+压缩
import { runReviewTaskStandalone, runCompactTaskStandalone, compactSessionContext } from './session-context-tasks';


// ============ Re-export spoke 模块的公共 API，保持向后兼容 ============

// 状态
export {
    sessions,
    getActiveSessionId,
    setActiveSessionId,
    activeControllers,
    sessionTaskKinds,
    activeCoalescedTasks,
    dispatchSessionOp,
    respondSessionOp,
    buildSessionOpQueueSnapshot,
} from './session-state';

// 事件
export {
    extractLatestStartedRunId,
    reconcileSessionStateFromEventLog,
    applyTurnLifecycleEventToSession,
    buildErrorContent,
    parseErrorContent,
    buildTurnLifecycleEventPayload,
} from './session-event';

// 资源
export { RuntimeResourceManager, trackRuntimeResourceFromEvent } from './session-resource';

// 持久化
export { persistRuntimeSessions, persistRuntimeSessionsImmediate, restoreRuntimeSessions } from './session-persistence';

// 历史
export { persistSessionHistory } from './session-history';

// 回放
export { buildSessionReplayPayload, buildSessionSyncPayload } from './session-replay';

// 审查+压缩
export { runReviewTaskStandalone, runCompactTaskStandalone, compactSessionContext } from './session-context-tasks';

// Re-export 类型（供消费者使用）
export type {
    SessionTaskKind,
    TurnAbortReason,
    ExecuteSessionOptions,
    SessionChannelResponder,
    SessionTaskKindRequest,
    SessionCreateOp,
    SessionContinueOp,
    SessionRollbackOp,
    SessionClearOp,
    SessionCancelOp,
    SessionGetActiveOp,
    SessionReplayRequestOp,
    SessionResumeOp,
    SessionOp,
    RunningSessionTask,
    SessionTaskRunner,
    SessionTaskRunContext,
    SessionTaskAbortContext,
    SessionTaskStartContext,
    SessionTaskFinishContext,
    ActiveTurnRuntime,
    RuntimeResourceKind,
    RuntimeResourceEntry,
} from './session-types';
export type {
    Session,
    AIStreamEvent,
    InputItem,
    OutputItem,
    SessionEventLogItem,
    SessionFailureCode,
    SessionStatus,
    SessionOpQueueSnapshot,
    SessionReplayPayload,
    HandleChatOptions,
    SessionSyncPayload,
    AgentStateTransition,
    AIErrorPayload,
    TaskLifecycleEventPayload,
    TurnLifecycleEventPayload,
} from './session-types';


// ============ Task Done Notifier ============

function createTaskDoneNotifier(): { done: Promise<void>; markDone: () => void } {
    let resolved = false;
    let resolver: (() => void) | null = null;
    const done = new Promise<void>((resolve) => {
        resolver = resolve;
    });
    return {
        done,
        markDone: () => {
            if (resolved) return;
            resolved = true;
            resolver?.();
        },
    };
}

// ============ Task Runner 引擎 ============

function registerActiveTask(
    sessionId: string,
    controller: AbortController,
    runner: SessionTaskRunner,
    runId: string,
): RunningSessionTask {
    const runtime = ensureActiveTurnRuntime();
    if (runtime.tasks.size > 0) {
        for (const oldTask of runtime.tasks.values()) {
            if (!oldTask.controller.signal.aborted) {
                oldTask.controller.abort();
            }
            oldTask.markDone();
            activeControllers.delete(oldTask.sessionId);
        }
        runtime.tasks.clear();
    }
    const notifier = createTaskDoneNotifier();
    const task: RunningSessionTask = {
        runId,
        sessionId,
        kind: runner.kind,
        runner,
        controller,
        createdAt: Date.now(),
        done: notifier.done,
        markDone: notifier.markDone,
    };
    runtime.tasks.set(sessionId, task);
    sessionTaskKinds.set(sessionId, runner.kind);
    activeControllers.set(sessionId, controller);
    return task;
}

function finishActiveTask(sessionId: string) {
    activeControllers.delete(sessionId);
    const activeTurnRuntime = getActiveTurnRuntime();
    if (!activeTurnRuntime) return;
    activeTurnRuntime.tasks.delete(sessionId);
    if (activeTurnRuntime.tasks.size === 0) {
        setActiveTurnRuntime(null);
    }
}

export function getRunningTasks(): RunningSessionTask[] {
    const activeTurnRuntime = getActiveTurnRuntime();
    if (!activeTurnRuntime) return [];
    return Array.from(activeTurnRuntime.tasks.values());
}

export function findRunningTask(sessionId: string): RunningSessionTask | undefined {
    const activeTurnRuntime = getActiveTurnRuntime();
    if (!activeTurnRuntime) return undefined;
    return activeTurnRuntime.tasks.get(sessionId);
}

export function hasRunningTasks(): boolean {
    return getRunningTasks().length > 0;
}

export function getPrimaryRunningTask(): RunningSessionTask | null {
    const tasks = getRunningTasks();
    return tasks.length > 0 ? tasks[0] : null;
}

function completeActiveTask(sessionId: string, runId?: string) {
    const task = findRunningTask(sessionId);
    if (!task) return;
    if (runId && task.runId !== runId) return;
    task?.markDone();
    finishActiveTask(sessionId);
}

// ============ 任务类型解析 ============

export function resolveSessionTaskRequest(
    query: string,
    preferredTaskKind?: SessionTaskKind | string,
): { taskKind: SessionTaskKind; query: string } {
    const defaultQuery = query.trim();
    const normalizedPreferred = normalizeTaskKind(typeof preferredTaskKind === 'string' ? preferredTaskKind : undefined);
    if (normalizedPreferred !== 'regular') {
        return {
            taskKind: normalizedPreferred,
            query: defaultQuery || query,
        };
    }

    if (/^\/review(?:\s+|$)/i.test(defaultQuery)) {
        const nextQuery = defaultQuery.replace(/^\/review\b/i, '').trim();
        return {
            taskKind: 'review',
            query: nextQuery || DEFAULT_REVIEW_TASK_QUERY,
        };
    }

    if (/^\/compact(?:\s+|$)/i.test(defaultQuery)) {
        const nextQuery = defaultQuery.replace(/^\/compact\b/i, '').trim();
        return {
            taskKind: 'compact',
            query: nextQuery || DEFAULT_COMPACT_TASK_QUERY,
        };
    }

    return {
        taskKind: 'regular',
        query: defaultQuery || query,
    };
}

export function getSessionTaskKind(sessionId: string): SessionTaskKind {
    const task = getRunningTasks().find(item => item.sessionId === sessionId);
    if (task) return task.kind;
    return sessionTaskKinds.get(sessionId) || 'regular';
}

// ============ 选项提取 ============

function normalizeExecuteNumberOption(raw: unknown, min: number, max: number): number | undefined {
    const value = Number(raw);
    if (!Number.isFinite(value)) return undefined;
    return Math.max(min, Math.min(max, Math.floor(value)));
}

export function extractExecuteSessionOptions(raw: any): Partial<ExecuteSessionOptions> {
    if (!raw || typeof raw !== 'object') return {};
    const disallowTools = Array.isArray(raw.disallowTools)
        ? Array.from(new Set(raw.disallowTools.map((item: any) => String(item || '').trim()).filter(Boolean)))
        : [];
    return {
        disallowTools: disallowTools.length > 0 ? disallowTools : undefined,
        maxRounds: normalizeExecuteNumberOption(raw.maxRounds, 1, 120),
        maxToolCalls: normalizeExecuteNumberOption(raw.maxToolCalls, 1, 300),
        maxSameToolCalls: normalizeExecuteNumberOption(raw.maxSameToolCalls, 1, 20),
        appendUserQuery: raw.appendUserQuery === false ? false : undefined,
        suppressNextStepHint: raw.suppressNextStepHint === true ? true : undefined,
    };
}

// ============ 命令解析 ============

export function parseRollbackCommand(query: string): { turns: number; source: 'rollback' | 'undo' } | null {
    const text = String(query || '').trim();
    if (!text) return null;
    const undoMatch = text.match(/^\/undo(?:\s+|$)/i);
    if (undoMatch) {
        return { turns: 1, source: 'undo' };
    }
    const rollbackMatch = text.match(/^\/rollback(?:\s+(\d+))?\s*$/i);
    if (!rollbackMatch) return null;
    const turnsRaw = rollbackMatch[1] ? Number(rollbackMatch[1]) : 1;
    const turns = Number.isFinite(turnsRaw) ? Math.max(1, Math.min(50, Math.floor(turnsRaw))) : 1;
    return { turns, source: 'rollback' };
}

export async function parseShortcut(input: string): Promise<{ funcName: string; arg: string } | null> {
    const match = input.match(/^(\w+):(.+)$/);
    if (!match) return null;
    const funcName = match[1];
    const arg = match[2].trim();
    if (!arg) return null;
    // 通过 MCP Client 获取工具列表，确认函数已注册
    const tools = await mcpClient.listTools();
    const exists = tools.some(t => t.name === funcName);
    if (!exists) return null;
    return { funcName, arg };
}

// ============ Context 辅助 ============

function dropLastNUserTurnsFromContext(context: InputItem[], turns: number): {
    nextContext: InputItem[];
    droppedTurns: number;
} {
    if (!Array.isArray(context) || context.length === 0 || turns <= 0) {
        return {
            nextContext: Array.isArray(context) ? context : [],
            droppedTurns: 0,
        };
    }
    const userIndexes: number[] = [];
    for (let index = 0; index < context.length; index++) {
        const item = context[index];
        if ('role' in item && item.role === 'user') {
            userIndexes.push(index);
        }
    }
    if (userIndexes.length === 0) {
        return {
            nextContext: context,
            droppedTurns: 0,
        };
    }
    const dropCount = Math.min(turns, userIndexes.length);
    const keepTurns = userIndexes.length - dropCount;
    if (keepTurns <= 0) {
        return {
            nextContext: [],
            droppedTurns: dropCount,
        };
    }
    const cutIndex = userIndexes[keepTurns];
    return {
        nextContext: context.slice(0, cutIndex),
        droppedTurns: dropCount,
    };
}

function dropLastNTurnsFromEventLog(eventLog: SessionEventLogItem[], turns: number): {
    nextEventLog: SessionEventLogItem[];
    droppedTurns: number;
} {
    if (!Array.isArray(eventLog) || eventLog.length === 0 || turns <= 0) {
        return {
            nextEventLog: Array.isArray(eventLog) ? eventLog : [],
            droppedTurns: 0,
        };
    }
    const turnStartIndexes: number[] = [];
    for (let index = 0; index < eventLog.length; index++) {
        if (eventLog[index]?.type === 'turn_started') {
            turnStartIndexes.push(index);
        }
    }
    if (turnStartIndexes.length === 0) {
        return {
            nextEventLog: eventLog,
            droppedTurns: 0,
        };
    }
    const dropCount = Math.min(turns, turnStartIndexes.length);
    const keepTurns = turnStartIndexes.length - dropCount;
    if (keepTurns <= 0) {
        return {
            nextEventLog: [],
            droppedTurns: dropCount,
        };
    }
    const cutIndex = turnStartIndexes[keepTurns];
    return {
        nextEventLog: eventLog.slice(0, cutIndex),
        droppedTurns: dropCount,
    };
}

function appendInterruptedTurnMarker(session: Session) {
    const marker: InputItem = {
        role: 'user',
        content: `<turn_aborted>\n${TURN_ABORTED_INTERRUPTED_GUIDANCE}\n</turn_aborted>`,
    };
    session.context = compactSessionContext([...(session.context || []), marker]);
}

// ============ 合并键 ============

function tryAcquireCoalesceKey(coalesceKey?: string): boolean {
    if (!coalesceKey) return true;
    if (activeCoalescedTasks.has(coalesceKey)) return false;
    activeCoalescedTasks.add(coalesceKey);
    return true;
}

function releaseCoalesceKey(coalesceKey?: string) {
    if (!coalesceKey) return;
    activeCoalescedTasks.delete(coalesceKey);
}

// ============ 生命周期事件 ============

function buildTaskLifecycleEventPayload(
    taskKind: SessionTaskKind,
    phase: 'entered' | 'exited',
    message: string,
    status: SessionStatus,
    runId?: string | null,
    extra?: Partial<TaskLifecycleEventPayload>,
): TaskLifecycleEventPayload {
    return {
        taskKind,
        phase,
        status,
        message,
        runId: typeof runId === 'string' && runId.trim() ? runId : null,
        timestamp: Date.now(),
        ...extra,
    };
}

function resolveTaskLifecycleEventType(
    taskKind: SessionTaskKind,
    phase: 'entered' | 'exited',
): AIStreamEvent['type'] {
    if (taskKind === 'review') {
        return phase === 'entered' ? 'entered_review_mode' : 'exited_review_mode';
    }
    return 'context_compacted';
}

function emitTaskLifecycleEvent(
    pushEvent: (event: { type: string; content: string }) => void,
    taskKind: SessionTaskKind,
    phase: 'entered' | 'exited',
    message: string,
    status: SessionStatus,
    runId?: string | null,
    extra?: Partial<TaskLifecycleEventPayload>,
) {
    const payload = buildTaskLifecycleEventPayload(taskKind, phase, message, status, runId, extra);
    pushEvent({
        type: resolveTaskLifecycleEventType(taskKind, phase),
        content: JSON.stringify(payload),
    });
}

// ============ 会话级 pushEvent ============

/**
 * 创建会话级 pushEvent 函数
 * 同时广播到所有标签页并追加到会话事件日志
 */
export function createSessionPushEvent(session: Session) {
    return (event: { type: string; content: string }) => {
        // 追加到事件日志
        session.eventLog.push({
            ...event,
            timestamp: Date.now(),
        } as SessionEventLogItem);
        trackRuntimeResourceFromEvent(session.id, event);

        // 维护会话级状态快照与失败码
        if (event.type === 'agent_state') {
            try {
                const transition = JSON.parse(event.content) as AgentStateTransition;
                session.agentState = {
                    phase: transition.to,
                    round: transition.round || 0,
                    reason: transition.reason || '',
                    updatedAt: transition.timestamp || Date.now(),
                };
            } catch {
                // 忽略 agent_state 解析失败
            }
        } else if (event.type === 'error') {
            session.status = 'error';
            const parsed = parseErrorContent(event.content);
            session.failureCode = parsed.code;
            session.lastError = parsed.message;
            session.endedAt = Date.now();
            session.durationMs = Math.max(0, session.endedAt - session.startedAt);
            session.agentState = {
                phase: 'finalize',
                round: session.agentState.round,
                reason: `异常结束：${parsed.message}`,
                updatedAt: Date.now(),
            };
        } else if (event.type === 'turn_aborted') {
            const payload = parseTurnLifecycleEventPayload(event.content);
            applyTurnLifecycleEventToSession(session, 'turn_aborted', payload);
        } else if (event.type === 'turn_completed') {
            const payload = parseTurnLifecycleEventPayload(event.content);
            applyTurnLifecycleEventToSession(session, 'turn_completed', payload);
        }

        const streamPayload = { ...event, sessionId: session.id, taskId: session.id };
        const shouldSync = SESSION_SYNC_EVENT_TYPES.has(event.type);
        const syncPayload = shouldSync ? buildSessionSyncPayload(session) : null;
        const shouldPersistImmediate = SESSION_IMMEDIATE_PERSIST_EVENT_TYPES.has(event.type);
        const shouldPersistBeforeEmit = SESSION_PRE_EMIT_PERSIST_EVENT_TYPES.has(event.type);
        const shouldPersistDebounced = !shouldPersistImmediate && event.type !== 'text';
        const shouldPersistHistory = event.type === 'error'
            || event.type === 'turn_aborted'
            || event.type === 'turn_completed';

        void dispatchSessionOp(`session_event:${session.id}:${event.type}`, async () => {
            if (shouldPersistBeforeEmit) {
                await persistRuntimeSessionsImmediate();
            } else if (shouldPersistDebounced) {
                persistRuntimeSessions();
            }
            Channel.broadcast('__ai_stream', streamPayload);
            if (shouldSync && syncPayload) {
                Channel.broadcast('__session_sync', syncPayload);
            }
            if (shouldPersistImmediate && !shouldPersistBeforeEmit) {
                await persistRuntimeSessionsImmediate();
            }
            if (shouldPersistHistory) {
                persistSessionHistory(session);
            }
        });
    };
}

// ============ Checkpoint ============

export function createSessionCheckpointHandler(session: Session): NonNullable<HandleChatOptions['onCheckpoint']> {
    return (checkpoint) => {
        if (session.status !== 'running') return;
        if (Array.isArray(checkpoint.contextSnapshot) && checkpoint.contextSnapshot.length > 0) {
            session.context = compactSessionContext(checkpoint.contextSnapshot);
        }
        const normalizedPhase = checkpoint.phase === 'execute'
            ? 'act'
            : checkpoint.phase;
        session.agentState = {
            phase: normalizedPhase,
            round: checkpoint.round,
            reason: checkpoint.summary || session.agentState.reason,
            updatedAt: checkpoint.updatedAt || Date.now(),
        };
        persistRuntimeSessions();
    };
}

// ============ 任务执行内部函数 ============

type TaskScopedHandleChatOptions = Pick<
    HandleChatOptions,
    | 'disallowTools'
    | 'maxRounds'
    | 'maxToolCalls'
    | 'maxSameToolCalls'
    | 'appendUserQuery'
    | 'suppressNextStepHint'
>;

async function runSessionTaskChat(
    session: Session,
    taskScopedQuery: string,
    tabId: number | undefined,
    signal: AbortSignal,
    pushEvent: (event: AIStreamEvent) => void,
    taskScopedOptions: TaskScopedHandleChatOptions,
) {
    const finalInput = await handleChat(taskScopedQuery, (event: AIStreamEvent) => {
        pushEvent(event);
    }, tabId, signal, session.context.length > 0 ? session.context : undefined, {
        disallowTools: taskScopedOptions.disallowTools,
        maxRounds: taskScopedOptions.maxRounds,
        maxToolCalls: taskScopedOptions.maxToolCalls,
        maxSameToolCalls: taskScopedOptions.maxSameToolCalls,
        appendUserQuery: taskScopedOptions.appendUserQuery,
        suppressNextStepHint: taskScopedOptions.suppressNextStepHint,
        maxInputItems: MAX_MODEL_CONTEXT_ITEMS,
        onCheckpoint: createSessionCheckpointHandler(session),
    });

    if (finalInput) {
        session.context = compactSessionContext(finalInput);
        persistRuntimeSessions();
    }
    if (session.status === 'running') {
        session.status = 'done';
    }
}

function buildRegularTaskScopedOptions(options: ExecuteSessionOptions | undefined): TaskScopedHandleChatOptions {
    return {
        disallowTools: [...(options?.disallowTools || [])],
        maxRounds: options?.maxRounds,
        maxToolCalls: options?.maxToolCalls,
        maxSameToolCalls: options?.maxSameToolCalls,
        appendUserQuery: options?.appendUserQuery,
        suppressNextStepHint: options?.suppressNextStepHint,
    };
}

// ============ 快捷指令执行 ============

async function runSessionShortcutTask(
    session: Session,
    normalizedQuery: string,
    signal: AbortSignal,
    pushEvent: (event: { type: string; content: string }) => void,
): Promise<boolean> {
    const shortcut = await parseShortcut(normalizedQuery);
    if (!shortcut) return false;

    const { funcName, arg } = shortcut;
    console.log(`[Mole] 快捷指令(session), func: ${funcName}, arg: ${arg}`);
    pushEvent({ type: 'thinking', content: `正在执行 ${funcName}...` });

    const tools = await mcpClient.listTools();
    const toolDef = tools.find(t => t.name === funcName);
    const requiredParam = toolDef?.inputSchema?.required?.[0] || 'keyword';
    const params = { [requiredParam]: arg };

    const emitShortcutDone = (text: string) => {
        const message = text.trim() || '已完成处理。';
        const assistantItemId = `assistant-shortcut-${Date.now()}`;
        pushEvent({
            type: 'turn_item_started',
            content: JSON.stringify({
                itemType: 'assistant_message',
                itemId: assistantItemId,
            }),
        });
        pushEvent({
            type: 'turn_item_completed',
            content: JSON.stringify({
                itemType: 'assistant_message',
                itemId: assistantItemId,
                status: 'completed',
            }),
        });
        pushEvent({ type: 'text', content: message });
    };

    try {
        if (signal.aborted) return true;
        const mcpResult = await mcpClient.callTool(funcName, params, undefined, { signal });
        if (signal.aborted) return true;
        const resultText = mcpResult.content[0]?.text || '{}';
        const result = JSON.parse(resultText);

        if (result.success && result.data) {
            pushEvent({ type: 'search_results', content: JSON.stringify(result.data) });
            session.status = 'done';
            const count = Number(result.data?.total ?? result.data?.count);
            const countText = Number.isFinite(count) && count >= 0
                ? `，共 ${count} 条`
                : '';
            const shortcutDoneText = `已完成「${funcName}」操作${countText}。`;
            emitShortcutDone(shortcutDoneText);
        } else {
            session.status = 'error';
            pushEvent({
                type: 'error',
                content: buildErrorContent('E_TOOL_EXEC', result.error || '执行失败', 'tool', true),
            });
        }
    } catch (err: any) {
        if (signal.aborted || err?.name === 'AbortError') return true;
        session.status = 'error';
        pushEvent({
            type: 'error',
            content: buildErrorContent('E_TOOL_EXEC', err.message || '执行异常', 'tool', true),
        });
    }
    return true;
}

// ============ Task Runners ============

async function runRegularTask(ctx: SessionTaskRunContext) {
    const handled = await runSessionShortcutTask(ctx.session, ctx.normalizedQuery, ctx.signal, ctx.pushEvent);
    if (handled) return;
    await runSessionTaskChat(
        ctx.session,
        ctx.normalizedQuery,
        ctx.tabId,
        ctx.signal,
        ctx.pushEvent,
        buildRegularTaskScopedOptions(ctx.options),
    );
}

async function runAuxTask(ctx: SessionTaskRunContext) {
    const handled = await runSessionShortcutTask(ctx.session, ctx.normalizedQuery, ctx.signal, ctx.pushEvent);
    if (handled) return;
    await runSessionTaskChat(
        ctx.session,
        ctx.normalizedQuery,
        ctx.tabId,
        ctx.signal,
        ctx.pushEvent,
        buildRegularTaskScopedOptions(ctx.options),
    );
}

async function runReviewTask(ctx: SessionTaskRunContext) {
    void ctx.options;
    await runReviewTaskStandalone(ctx);
}

async function runCompactTask(ctx: SessionTaskRunContext) {
    void ctx.options;
    await runCompactTaskStandalone(ctx);
}

const SESSION_TASK_RUNNERS: Record<SessionTaskKind, SessionTaskRunner> = {
    regular: {
        kind: 'regular',
        run: runRegularTask,
    },
    aux: {
        kind: 'aux',
        run: runAuxTask,
    },
    review: {
        kind: 'review',
        emitTurnStarted: false,
        start: ({ pushEvent, taskKind, runId }) => {
            emitTaskLifecycleEvent(
                pushEvent,
                taskKind,
                'entered',
                '已进入审查模式，正在整理问题与建议。',
                'running',
                runId,
            );
        },
        run: runReviewTask,
        abort: ({ session, message, reason, task }) => {
            const pushEvent = createSessionPushEvent(session);
            emitTaskLifecycleEvent(
                pushEvent,
                'review',
                'exited',
                reason === 'interrupted'
                    ? '审查已中断，如需完整结论可重新发起审查。'
                    : `审查已结束：${message}`,
                'error',
                task.runId,
                {
                    reason,
                    failureCode: reason === 'interrupted' ? 'E_CANCELLED' : 'E_SUPERSEDED',
                },
            );
        },
    },
    compact: {
        kind: 'compact',
        start: ({ pushEvent, taskKind, runId }) => {
            void taskKind;
            void runId;
            pushEvent({
                type: 'planning',
                content: '正在整理上下文，请稍候。',
            });
        },
        run: runCompactTask,
        abort: ({ session, message, reason, task }) => {
            const pushEvent = createSessionPushEvent(session);
            emitTaskLifecycleEvent(
                pushEvent,
                'compact',
                'exited',
                reason === 'interrupted'
                    ? '上下文整理已中断，可稍后重新发起。'
                    : `上下文整理已结束：${message}`,
                'error',
                task.runId,
                {
                    reason,
                    failureCode: reason === 'interrupted' ? 'E_CANCELLED' : 'E_SUPERSEDED',
                },
            );
        },
    },
};

function resolveSessionTaskRunner(taskKind: SessionTaskKind): SessionTaskRunner {
    return SESSION_TASK_RUNNERS[taskKind] || SESSION_TASK_RUNNERS.regular;
}

// ============ Run-scoped 事件过滤 ============

function createRunScopedPushEvent(
    session: Session,
    runId: string,
    pushEvent: (event: AIStreamEvent) => void,
) {
    return (event: AIStreamEvent) => {
        const activeTask = findRunningTask(session.id);
        if (!activeTask || activeTask.runId !== runId) {
            return;
        }
        pushEvent(event);
    };
}

function hasCurrentRunTurnAborted(session: Session): boolean {
    const startedAt = session.startedAt || 0;
    for (let index = session.eventLog.length - 1; index >= 0; index--) {
        const event = session.eventLog[index];
        const timestamp = event.timestamp || 0;
        if (timestamp < startedAt) break;
        if (event.type === 'turn_aborted') return true;
    }
    return false;
}

// ============ 历史提取辅助（executeSessionChat 内部使用） ============

/** 提取最新 run 的消息 */
function extractLatestRunAgentMessage(eventLog: SessionEventLogItem[], startedAt: number): string | undefined {
    for (let index = eventLog.length - 1; index >= 0; index--) {
        const event = eventLog[index];
        const timestamp = event.timestamp || 0;
        if (timestamp < startedAt) break;
        if (event.type === 'text') {
            const text = String(event.content || '').trim();
            if (text) return text;
        }
    }
    return undefined;
}

/** 从 context 提取助手消息 */
function extractLatestAssistantMessageFromContext(context: InputItem[] | undefined): string | undefined {
    if (!Array.isArray(context) || context.length === 0) return undefined;
    for (let index = context.length - 1; index >= 0; index--) {
        const item = context[index];
        if (!('role' in item) || item.role !== 'assistant') continue;
        const text = getTextContent(item.content).trim();
        if (!text || text.startsWith(SESSION_CONTEXT_COMPRESSION_TAG)) continue;
        return text;
    }
    return undefined;
}

// ============ 核心执行引擎 ============

/**
 * 执行会话 AI 对话
 * 统一处理快捷指令和 AI 编排模式
 */
async function executeSessionChat(session: Session, query: string, tabId?: number, options?: ExecuteSessionOptions) {
    const sessionPushEvent = createSessionPushEvent(session);
    const { taskKind, query: normalizedQuery } = resolveSessionTaskRequest(query, options?.taskKind);
    const taskRunner = resolveSessionTaskRunner(taskKind);
    sessionTaskKinds.set(session.id, taskKind);
    const runId = `${session.id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const runningTask = registerActiveTask(session.id, new AbortController(), taskRunner, runId);
    const controller = runningTask.controller;
    const pushEvent = createRunScopedPushEvent(session, runId, sessionPushEvent);

    session.startedAt = Date.now();
    session.endedAt = undefined;
    session.durationMs = undefined;
    session.failureCode = undefined;
    session.lastError = undefined;
    session.agentState = {
        phase: 'plan',
        round: 0,
        reason: `开始处理：${normalizedQuery.slice(0, 30)}`,
        updatedAt: Date.now(),
    };
    await persistRuntimeSessionsImmediate();
    if (taskRunner.emitTurnStarted !== false) {
        pushEvent({
            type: 'turn_started',
            content: JSON.stringify({
                sessionId: session.id,
                runId,
                query: normalizedQuery,
                startedAt: session.startedAt,
                taskKind,
            }),
        });
    }
    if (taskRunner.start) {
        try {
            await taskRunner.start({
                session,
                pushEvent,
                taskKind,
                query: normalizedQuery,
                runId,
            });
        } catch (err) {
            console.warn('[Mole] 执行任务 start hook 失败:', err);
        }
    }

    try {
        console.log(`[Mole] AI 对话请求(session: ${session.id}, kind: ${taskKind}), query: ${normalizedQuery}`);
        try {
            await taskRunner.run({
                session,
                runId,
                taskKind,
                normalizedQuery,
                tabId,
                signal: controller.signal,
                options,
                pushEvent,
            });
        } catch (err: any) {
            if (controller.signal.aborted || err?.name === 'AbortError') {
                return;
            }
            const errMsg = err.message || 'AI 处理异常';
            const failCode = resolveFailureCode(errMsg);
            session.status = 'error';
            pushEvent({
                type: 'error',
                content: buildErrorContent(failCode, errMsg, 'background', true),
            });
        }
        if (!controller.signal.aborted && taskRunner.finish) {
            try {
                await taskRunner.finish({
                    session,
                    pushEvent,
                    taskKind,
                    status: session.status,
                    runId,
                });
            } catch (err) {
                console.warn('[Mole] 执行任务 finish hook 失败:', err);
            }
        }

        const endedAt = Date.now();
        const durationMs = Math.max(0, endedAt - session.startedAt);
        const lastAgentMessage = session.status === 'done'
            ? (
                extractLatestRunAgentMessage(session.eventLog, session.startedAt)
                || extractLatestAssistantMessageFromContext(session.context)
            )
            : undefined;
        await persistRuntimeSessionsImmediate();
        if ((session.status === 'done' || session.status === 'error') && !hasCurrentRunTurnAborted(session)) {
            const completedPayload = buildTurnLifecycleEventPayload(
                session.status,
                session,
                runId,
                {
                    endedAt,
                    durationMs,
                    taskKind,
                    failureCode: session.failureCode || undefined,
                    reason: session.status === 'error'
                        ? (session.lastError || '会话异常终止')
                        : undefined,
                    lastAgentMessage: lastAgentMessage || undefined,
                },
            );
            pushEvent({
                type: 'turn_completed',
                content: JSON.stringify(completedPayload),
            });
        }

        // 广播会话状态同步
        Channel.broadcast('__session_sync', buildSessionSyncPayload(session));
        persistSessionHistory(session);
        persistRuntimeSessions();
    } catch (err: any) {
        console.error('[Mole] 会话处理异常:', err);
        session.status = 'error';
        pushEvent({
            type: 'error',
            content: buildErrorContent('E_SESSION_RUNTIME', err.message || '会话处理异常', 'background', true),
        });
        Channel.broadcast('__session_sync', buildSessionSyncPayload(session));
        persistSessionHistory(session);
        persistRuntimeSessions();
    } finally {
        completeActiveTask(session.id, runId);
    }
}

// ============ 会话生命周期 ============

/**
 * 创建新会话
 * @param summary 首次查询文本
 * @param originTabId 发起任务的标签页 ID
 * @returns 新会话对象
 */
export function createSession(summary: string, originTabId?: number): Session {
    const id = Date.now().toString();
    const session: Session = {
        id,
        status: 'running',
        context: [],
        eventLog: [],
        createdAt: Date.now(),
        startedAt: Date.now(),
        endedAt: undefined,
        durationMs: undefined,
        summary,
        agentState: {
            phase: 'plan',
            round: 0,
            reason: '会话创建，等待规划',
            updatedAt: Date.now(),
        },
        taskRuntime: undefined,
        failureCode: undefined,
        lastError: undefined,
        originTabId,
    };
    sessions.set(id, session);

    // 超过容量上限时清理最早的非活跃会话
    if (sessions.size > MAX_SESSIONS) {
        for (const [sid] of sessions) {
            if (sid !== id) {
                // 如果旧会话还有活跃 controller，先取消
                const oldController = activeControllers.get(sid);
                if (oldController) {
                    oldController.abort();
                    completeActiveTask(sid);
                }
                void RuntimeResourceManager.closeAll(sid);
                sessionTaskKinds.delete(sid);
                sessions.delete(sid);
                break;
            }
        }
    }

    setActiveSessionId(id);
    persistRuntimeSessions();
    return session;
}

export async function abortSessionTask(
    sessionId: string,
    reason: TurnAbortReason,
    message: string,
    failureCode: SessionFailureCode,
) {
    const task = findRunningTask(sessionId);
    const taskKind = task?.runner.kind || task?.kind || getSessionTaskKind(sessionId);
    const runningSession = sessions.get(sessionId);
    if (task) {
        task.controller.abort();
        await Promise.race([task.done, delayMs(GRACEFUL_ABORT_TIMEOUT_MS)]);
        task.markDone();
        if (reason === 'interrupted') {
            await RuntimeResourceManager.closeByRun(sessionId, task.runId);
        }
        if (runningSession && task.runner.abort) {
            try {
                await task.runner.abort({
                    session: runningSession,
                    reason,
                    message,
                    failureCode,
                    task,
                });
            } catch (err) {
                console.warn('[Mole] 执行任务 abort hook 失败:', err);
            }
        }
    }
    if (reason === 'interrupted' && !task) {
        await RuntimeResourceManager.closeAll(sessionId);
    }
    completeActiveTask(sessionId, task?.runId);
    if (!runningSession || runningSession.status !== 'running') return;

    runningSession.status = 'error';
    runningSession.endedAt = Date.now();
    runningSession.durationMs = Math.max(0, runningSession.endedAt - runningSession.startedAt);
    runningSession.failureCode = failureCode;
    runningSession.lastError = message;
    runningSession.agentState = {
        phase: 'finalize',
        round: runningSession.agentState.round,
        reason: reason === 'replaced' ? '被新任务替换' : '用户中断任务',
        updatedAt: Date.now(),
    };
    if (reason === 'interrupted') {
        appendInterruptedTurnMarker(runningSession);
    }

    const pushEvent = createSessionPushEvent(runningSession);
    await persistRuntimeSessionsImmediate();
    const abortedPayload = buildTurnLifecycleEventPayload(
        'error',
        runningSession,
        task?.runId || null,
        {
            endedAt: runningSession.endedAt,
            durationMs: runningSession.durationMs,
            taskKind,
            failureCode,
            reason: message,
            abortReason: reason,
        },
    );
    pushEvent({
        type: 'turn_aborted',
        content: JSON.stringify(abortedPayload),
    });
}

async function stopOtherRunningSessions(reason: string, exceptSessionId?: string) {
    for (const task of getRunningTasks()) {
        if (task.sessionId === exceptSessionId) continue;
        await abortSessionTask(task.sessionId, 'replaced', reason, 'E_SUPERSEDED');
    }
}

export async function runSessionNow(session: Session, query: string, tabId?: number, options?: ExecuteSessionOptions) {
    if (!tryAcquireCoalesceKey(options?.coalesceKey)) return;
    await stopOtherRunningSessions('新任务已启动，当前任务被替换', session.id);
    const resolvedRequest = resolveSessionTaskRequest(query, options?.taskKind);
    sessionTaskKinds.set(session.id, resolvedRequest.taskKind);

    setActiveSessionId(session.id);
    session.status = 'running';

    session.agentState = {
        phase: 'plan',
        round: session.agentState.round || 0,
        reason: `开始执行(${resolvedRequest.taskKind})`,
        updatedAt: Date.now(),
    };
    Channel.broadcast('__session_sync', buildSessionSyncPayload(session));
    persistRuntimeSessions();

    void executeSessionChat(session, resolvedRequest.query, tabId, {
        ...options,
        taskKind: resolvedRequest.taskKind,
    }).finally(() => {
        releaseCoalesceKey(options?.coalesceKey);
    });
}

export async function rollbackSessionTurns(session: Session, turns: number, source: 'rollback' | 'undo'): Promise<{
    droppedTurns: number;
    reason: string;
}> {
    const normalizedTurns = Math.max(1, Math.min(50, Math.floor(Number(turns) || 1)));
    const contextTrimmed = dropLastNUserTurnsFromContext(session.context || [], normalizedTurns);
    const eventLogTrimmed = dropLastNTurnsFromEventLog(session.eventLog || [], normalizedTurns);
    const droppedTurns = Math.max(contextTrimmed.droppedTurns, eventLogTrimmed.droppedTurns);

    if (droppedTurns <= 0) {
        return {
            droppedTurns: 0,
            reason: '没有可回滚的历史轮次',
        };
    }

    session.context = compactSessionContext(contextTrimmed.nextContext);
    session.eventLog = eventLogTrimmed.nextEventLog;
    session.failureCode = undefined;
    session.lastError = undefined;
    session.endedAt = undefined;
    session.durationMs = undefined;

    reconcileSessionStateFromEventLog(session);
    session.status = 'done';
    session.endedAt = Date.now();
    session.durationMs = Math.max(0, (session.endedAt || Date.now()) - (session.startedAt || session.createdAt));
    session.agentState = {
        phase: 'finalize',
        round: session.agentState?.round || 0,
        reason: `已回滚 ${droppedTurns} 轮${source === 'undo' ? '（撤销）' : ''}`,
        updatedAt: Date.now(),
    };

    const pushEvent = createSessionPushEvent(session);
    pushEvent({
        type: 'thread_rolled_back',
        content: JSON.stringify({
            sessionId: session.id,
            numTurns: droppedTurns,
            source,
            timestamp: Date.now(),
        }),
    });

    await persistRuntimeSessionsImmediate();
    persistSessionHistory(session);
    Channel.broadcast('__session_sync', buildSessionSyncPayload(session));
    Channel.broadcast('__session_replay', buildSessionReplayPayload(session, 'full'));

    return {
        droppedTurns,
        reason: `已回滚最近 ${droppedTurns} 轮`,
    };
}
