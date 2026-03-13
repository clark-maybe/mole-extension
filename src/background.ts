/**
 * Mole Background Service Worker
 * 处理扩展核心逻辑和跨组件通信
 */
import { VERSION } from './config';
import Channel from './lib/channel';
import _console from './lib/console';
import Storage from './lib/storage';
import dayjs from 'dayjs';
import {
    ensureToolRegistryReady,
    importDynamicToolsFromManifest,
    listDynamicTools,
    mcpClient,
    removeDynamicTool,
    upsertDynamicTool,
} from './functions/registry';
import {
    executeDebugRemotePlan,
    getSupportedRemotePlanActions,
} from './functions/remote-workflow';
import { listSiteWorkflows, reloadRegistryFromStore } from './functions/site-workflow-registry';
import { matchWorkflows } from './functions/site-workflow-matcher';
import { handleChat } from './ai/orchestrator';
import { chatComplete } from './ai/llm-client';
import type { HandleChatOptions } from './ai/orchestrator';
import { injectAIResponseRunner } from './functions/resident-runtime';
import type {
    AIStreamEvent,
    AIErrorPayload,
    AgentStateTransition,
    InputItem,
    OutputItem,
    Session,
    SessionEventLogItem,
    SessionFailureCode,
    SessionOpQueueSnapshot,
    SessionReplayPayload,
    SessionStatus,
    TaskLifecycleEventPayload,
    TurnLifecycleEventPayload,
} from './ai/types';
import { TimerStore } from './lib/timer-store';
import { TimerScheduler } from './lib/timer-scheduler';
import { NetworkMonitorStore } from './lib/network-monitor';
import { CDPSessionManager } from './lib/cdp-session';
import { MAX_SESSION_HISTORY, SESSION_HISTORY_STORAGE_KEY } from './session-history/constants';
import type {
    SessionAgentTransitionItem,
    SessionHistoryRecord,
    SessionToolCallChainItem,
} from './session-history/types';

// ============ 初始化 ============

// 启动 Channel 监听（background 侧不传 tabId）
Channel.listen();

console.log(`[Mole] Background Service Worker 已启动, V${VERSION}`);
void ensureToolRegistryReady().catch((err) => {
    console.warn('[Mole] 初始化动态工具失败:', err);
});

// ============ SessionManager：会话集中管理 ============

/** 会话存储 */
const sessions = new Map<string, Session>();

/** 当前活跃会话 ID */
let activeSessionId: string | null = null;

/** 活跃任务的 AbortController 映射 */
const activeControllers = new Map<string, AbortController>();

type SessionTaskKind = 'regular' | 'review' | 'compact' | 'aux';
type TurnAbortReason = 'replaced' | 'interrupted';

interface RunningSessionTask {
    runId: string;
    sessionId: string;
    kind: SessionTaskKind;
    runner: SessionTaskRunner;
    controller: AbortController;
    createdAt: number;
    done: Promise<void>;
    markDone: () => void;
}

interface SessionTaskRunContext {
    session: Session;
    runId: string;
    taskKind: SessionTaskKind;
    normalizedQuery: string;
    tabId: number | undefined;
    signal: AbortSignal;
    options: ExecuteSessionOptions | undefined;
    pushEvent: (event: AIStreamEvent) => void;
}

interface SessionTaskAbortContext {
    session: Session;
    reason: TurnAbortReason;
    message: string;
    failureCode: SessionFailureCode;
    task: RunningSessionTask;
}

interface SessionTaskStartContext {
    session: Session;
    pushEvent: (event: AIStreamEvent) => void;
    taskKind: SessionTaskKind;
    query: string;
    runId: string;
}

interface SessionTaskFinishContext {
    session: Session;
    pushEvent: (event: AIStreamEvent) => void;
    taskKind: SessionTaskKind;
    status: SessionStatus;
    runId: string;
}

interface SessionTaskRunner {
    kind: SessionTaskKind;
    emitTurnStarted?: boolean;
    run: (ctx: SessionTaskRunContext) => Promise<void>;
    start?: (ctx: SessionTaskStartContext) => Promise<void> | void;
    finish?: (ctx: SessionTaskFinishContext) => Promise<void> | void;
    abort?: (ctx: SessionTaskAbortContext) => Promise<void> | void;
}

interface ActiveTurnRuntime {
    tasks: Map<string, RunningSessionTask>;
}

type RuntimeResourceKind = 'network_monitor' | 'timer';

interface RuntimeResourceEntry {
    key: string;
    kind: RuntimeResourceKind;
    resourceId: string;
    sessionId: string;
    runId: string | null;
    createdAt: number;
}

let activeTurnRuntime: ActiveTurnRuntime | null = null;
const sessionTaskKinds = new Map<string, SessionTaskKind>();

/** 会话容量上限 */
const MAX_SESSIONS = 10;
const SESSION_RUNTIME_STORAGE_KEY = 'mole_session_runtime_v1';
const MAX_RUNTIME_EVENT_LOG = 500;
const MAX_RUNTIME_CONTEXT = 280;
const MAX_MODEL_CONTEXT_ITEMS = 180;
const COMPACT_USER_CONTEXT_LIMIT = 10;
const COMPACT_USER_CONTEXT_CHAR_LIMIT = 6000;
const SESSION_CONTEXT_COMPRESSION_TAG = '[mole-context-compressed]';
const TURN_ABORTED_INTERRUPTED_GUIDANCE = '用户主动中断了上一轮任务；若部分工具已执行，请先核对当前状态再继续。';
const DEFAULT_REVIEW_TASK_QUERY = '请审阅当前任务结果，指出关键问题并给出修复建议。';
const DEFAULT_COMPACT_TASK_QUERY = '请压缩当前会话上下文，保留事实、结论和下一步。';
const REVIEW_TASK_INSTRUCTIONS = [
    '你是一名严格且务实的代码审查助手。',
    '只基于提供的上下文给结论，不得编造未执行事实。',
    '输出结构：先给总体判断，再按“问题-影响-建议”分点列出。',
    '问题按风险从高到低排序，必要时注明优先级（P0/P1/P2）。',
    '语言面向普通用户，避免调度、轮次、状态机等内部术语。',
].join('\n');
const COMPACT_TASK_INSTRUCTIONS = [
    '你是上下文压缩助手。',
    '只提炼已发生的事实：已完成动作、关键证据、当前结论、后续建议。',
    '删除重复描述，不新增推测信息，不编造未执行结果。',
    '输出简短明确，最多 8 行。',
].join('\n');
const GRACEFUL_ABORT_TIMEOUT_MS = 120;
const sessionRuntimeResources = new Map<string, Map<string, RuntimeResourceEntry>>();
const activeCoalescedTasks = new Set<string>();
let sessionDispatchQueue: Promise<void> = Promise.resolve();
let sessionOpQueueDepth = 0;
let sessionOpQueuePeakDepth = 0;
let sessionOpRunningLabel = '';
let sessionOpRunningStartedAt = 0;
let sessionOpLastLabel = '';
let sessionOpLastLatencyMs = 0;
let sessionOpUpdatedAt = Date.now();
const SESSION_SYNC_EVENT_TYPES = new Set<string>([
    'agent_state',
    'turn_started',
    'turn_completed',
    'turn_aborted',
    'thread_rolled_back',
    'error',
    'entered_review_mode',
    'exited_review_mode',
    'context_compacted',
    'queue_updated',
]);
const SESSION_IMMEDIATE_PERSIST_EVENT_TYPES = new Set<string>([
    'turn_started',
    'turn_item_started',
    'turn_item_completed',
    'function_result',
    'approval_request',
    'approval_resolved',
    'user_input_request',
    'user_input_resolved',
    'dynamic_tool_request',
    'dynamic_tool_resolved',
    'queue_updated',
    'thread_rolled_back',
    'entered_review_mode',
    'exited_review_mode',
    'context_compacted',
    'turn_completed',
    'turn_aborted',
    'error',
]);
const SESSION_PRE_EMIT_PERSIST_EVENT_TYPES = new Set<string>([
    'turn_started',
    'turn_item_started',
    'turn_item_completed',
    'function_result',
    'approval_request',
    'approval_resolved',
    'user_input_request',
    'user_input_resolved',
    'dynamic_tool_request',
    'dynamic_tool_resolved',
    'queue_updated',
    'entered_review_mode',
    'exited_review_mode',
    'context_compacted',
    'turn_completed',
    'turn_aborted',
    'error',
]);

interface ExecuteSessionOptions {
    disallowTools?: string[];
    maxRounds?: number;
    maxToolCalls?: number;
    maxSameToolCalls?: number;
    coalesceKey?: string;
    appendUserQuery?: boolean;
    suppressNextStepHint?: boolean;
    taskKind?: SessionTaskKind;
}

type SessionChannelResponder = ((response?: any) => void) | undefined;
type SessionTaskKindRequest = SessionTaskKind | string | undefined;

interface SessionCreateOp {
    type: 'create';
    label: string;
    query: string;
    requestedTaskKind: SessionTaskKindRequest;
    taskOptions: Partial<ExecuteSessionOptions>;
    tabId: number | undefined;
    sendResponse: SessionChannelResponder;
}

interface SessionContinueOp {
    type: 'continue';
    label: string;
    sessionId: string;
    query: string;
    requestedTaskKind: SessionTaskKindRequest;
    expectedSessionId: string | null;
    expectedRunId: string | null;
    taskOptions: Partial<ExecuteSessionOptions>;
    tabId: number | undefined;
    sendResponse: SessionChannelResponder;
}

interface SessionRollbackOp {
    type: 'rollback';
    label: string;
    sessionId: string;
    turns: number;
    source: 'rollback' | 'undo';
    sendResponse: SessionChannelResponder;
}

interface SessionClearOp {
    type: 'clear';
    label: string;
    sessionId: string;
}

interface SessionCancelOp {
    type: 'cancel';
    label: string;
    sessionId: string;
}

interface SessionGetActiveOp {
    type: 'get_active';
    label: string;
    senderTabId: number | undefined;
    sendResponse: SessionChannelResponder;
}

interface SessionReplayRequestOp {
    type: 'replay_request';
    label: string;
    sessionId: string | null;
    scopeRaw: string;
    fromEventCountRaw: unknown;
    senderTabId: number | undefined;
    sendResponse: SessionChannelResponder;
}

type SessionOp =
    | SessionCreateOp
    | SessionContinueOp
    | SessionRollbackOp
    | SessionClearOp
    | SessionCancelOp
    | SessionGetActiveOp
    | SessionReplayRequestOp;

function buildSessionOpQueueSnapshot(now: number = Date.now()): SessionOpQueueSnapshot {
    return {
        depth: sessionOpQueueDepth,
        peakDepth: sessionOpQueuePeakDepth,
        runningLabel: sessionOpRunningLabel || undefined,
        runningSince: sessionOpRunningStartedAt > 0 ? sessionOpRunningStartedAt : undefined,
        lastLabel: sessionOpLastLabel || undefined,
        lastLatencyMs: sessionOpLastLatencyMs > 0 ? sessionOpLastLatencyMs : undefined,
        updatedAt: sessionOpUpdatedAt || now,
    };
}

function dispatchSessionOp(label: string, op: () => Promise<void> | void): Promise<void> {
    sessionOpQueueDepth += 1;
    sessionOpQueuePeakDepth = Math.max(sessionOpQueuePeakDepth, sessionOpQueueDepth);
    sessionOpUpdatedAt = Date.now();

    const run = async () => {
        const startedAt = Date.now();
        sessionOpRunningLabel = label;
        sessionOpRunningStartedAt = startedAt;
        sessionOpUpdatedAt = startedAt;
        try {
            await op();
        } catch (err) {
            console.error(`[Mole] 会话操作失败 (${label}):`, err);
        } finally {
            const finishedAt = Date.now();
            sessionOpLastLabel = label;
            sessionOpLastLatencyMs = Math.max(0, finishedAt - startedAt);
            sessionOpRunningLabel = '';
            sessionOpRunningStartedAt = 0;
            sessionOpQueueDepth = Math.max(0, sessionOpQueueDepth - 1);
            sessionOpUpdatedAt = finishedAt;
        }
    };

    sessionDispatchQueue = sessionDispatchQueue.then(run, run);
    return sessionDispatchQueue;
}

function respondSessionOp(sendResponse: SessionChannelResponder, payload: unknown, label: string) {
    if (!sendResponse) return;
    try {
        sendResponse(payload);
    } catch (err) {
        console.warn(`[Mole] ${label} sendResponse 失败:`, err);
    }
}

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

function ensureActiveTurnRuntime(): ActiveTurnRuntime {
    if (!activeTurnRuntime) {
        activeTurnRuntime = {
            tasks: new Map(),
        };
    }
    return activeTurnRuntime;
}

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
    if (!activeTurnRuntime) return;
    activeTurnRuntime.tasks.delete(sessionId);
    if (activeTurnRuntime.tasks.size === 0) {
        activeTurnRuntime = null;
    }
}

function getRunningTasks(): RunningSessionTask[] {
    if (!activeTurnRuntime) return [];
    return Array.from(activeTurnRuntime.tasks.values());
}

function findRunningTask(sessionId: string): RunningSessionTask | undefined {
    if (!activeTurnRuntime) return undefined;
    return activeTurnRuntime.tasks.get(sessionId);
}

function hasRunningTasks(): boolean {
    return getRunningTasks().length > 0;
}

function getPrimaryRunningTask(): RunningSessionTask | null {
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

function delayMs(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeTaskKind(raw?: string): SessionTaskKind {
    if (raw === 'review' || raw === 'compact' || raw === 'aux') return raw;
    return 'regular';
}

function resolveSessionTaskRequest(
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

function normalizeExecuteNumberOption(raw: unknown, min: number, max: number): number | undefined {
    const value = Number(raw);
    if (!Number.isFinite(value)) return undefined;
    return Math.max(min, Math.min(max, Math.floor(value)));
}

function extractExecuteSessionOptions(raw: any): Partial<ExecuteSessionOptions> {
    if (!raw || typeof raw !== 'object') return {};
    const disallowTools = Array.isArray(raw.disallowTools)
        ? Array.from(new Set(raw.disallowTools.map((item: any) => String(item || '').trim()).filter(Boolean)))
        : [];
    return {
        disallowTools: disallowTools.length > 0 ? disallowTools : undefined,
        maxRounds: normalizeExecuteNumberOption(raw.maxRounds, 1, 80),
        maxToolCalls: normalizeExecuteNumberOption(raw.maxToolCalls, 1, 200),
        maxSameToolCalls: normalizeExecuteNumberOption(raw.maxSameToolCalls, 1, 20),
        appendUserQuery: raw.appendUserQuery === false ? false : undefined,
        suppressNextStepHint: raw.suppressNextStepHint === true ? true : undefined,
    };
}

function parseRollbackCommand(query: string): { turns: number; source: 'rollback' | 'undo' } | null {
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

async function rollbackSessionTurns(session: Session, turns: number, source: 'rollback' | 'undo'): Promise<{
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

function getSessionTaskKind(sessionId: string): SessionTaskKind {
    const task = getRunningTasks().find(item => item.sessionId === sessionId);
    if (task) return task.kind;
    return sessionTaskKinds.get(sessionId) || 'regular';
}

function appendInterruptedTurnMarker(session: Session) {
    const marker: InputItem = {
        role: 'user',
        content: `<turn_aborted>\n${TURN_ABORTED_INTERRUPTED_GUIDANCE}\n</turn_aborted>`,
    };
    session.context = compactSessionContext([...(session.context || []), marker]);
}

function parseEventObject(content: string): Record<string, any> | null {
    if (!content) return null;
    try {
        const parsed = JSON.parse(content) as Record<string, any>;
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

function extractLatestStartedRunId(eventLog: SessionEventLogItem[] | undefined): string | null {
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

function parseTurnLifecycleEventPayload(content: string): TurnLifecycleEventPayload | null {
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

function parseTaskLifecycleStatus(content: string): SessionStatus | null {
    const parsed = parseEventObject(content);
    if (!parsed) return null;
    const status = String(parsed.status || '').trim();
    if (status === 'running' || status === 'done' || status === 'error') {
        return status;
    }
    return null;
}

function reconcileSessionStateFromEventLog(session: Session) {
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
                // ignore malformed payload
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

function applyTurnLifecycleEventToSession(
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

interface RuntimeResourceEventPayload {
    kind: RuntimeResourceKind;
    action: 'opened' | 'closed';
    resourceIds: string[];
}

interface RuntimeResourceHandler {
    close: (resourceId: string) => Promise<void>;
}

const RUNTIME_RESOURCE_HANDLERS: Record<RuntimeResourceKind, RuntimeResourceHandler> = {
    network_monitor: {
        close: async (resourceId: string) => {
            try {
                NetworkMonitorStore.stop(resourceId);
            } catch (err) {
                console.warn('[Mole] 关闭 network_monitor 资源失败:', resourceId, err);
            }
        },
    },
    timer: {
        close: async (resourceId: string) => {
            try {
                TimerScheduler.clear(resourceId);
                await chrome.alarms.clear(`mole_timer_${resourceId}`);
                await TimerStore.remove(resourceId);
            } catch (err) {
                console.warn('[Mole] 关闭 timer 资源失败:', resourceId, err);
            }
        },
    },
};

const RuntimeResourceManager = {
    buildKey(kind: RuntimeResourceKind, resourceId: string): string {
        return `${kind}:${resourceId}`;
    },

    getSessionMap(sessionId: string, createIfMissing: boolean = false): Map<string, RuntimeResourceEntry> | null {
        const existed = sessionRuntimeResources.get(sessionId);
        if (existed) return existed;
        if (!createIfMissing) return null;
        const created = new Map<string, RuntimeResourceEntry>();
        sessionRuntimeResources.set(sessionId, created);
        return created;
    },

    register(sessionId: string, kind: RuntimeResourceKind, resourceId: string, runId?: string | null) {
        const normalizedId = String(resourceId || '').trim();
        if (!normalizedId) return;
        const key = RuntimeResourceManager.buildKey(kind, normalizedId);
        const map = RuntimeResourceManager.getSessionMap(sessionId, true);
        if (!map) return;
        const resolvedRunId = runId ?? findRunningTask(sessionId)?.runId ?? null;
        map.set(key, {
            key,
            kind,
            resourceId: normalizedId,
            sessionId,
            runId: resolvedRunId,
            createdAt: Date.now(),
        });
    },

    unregister(sessionId: string, kind: RuntimeResourceKind, resourceId: string) {
        const normalizedId = String(resourceId || '').trim();
        if (!normalizedId) return;
        const key = RuntimeResourceManager.buildKey(kind, normalizedId);
        const map = RuntimeResourceManager.getSessionMap(sessionId, false);
        if (!map) return;
        map.delete(key);
        if (map.size === 0) {
            sessionRuntimeResources.delete(sessionId);
        }
    },

    unregisterFromAllSessions(kind: RuntimeResourceKind, resourceId: string) {
        const normalizedId = String(resourceId || '').trim();
        if (!normalizedId) return;
        for (const [sessionId] of sessionRuntimeResources.entries()) {
            RuntimeResourceManager.unregister(sessionId, kind, normalizedId);
        }
    },

    unregisterManyFromAllSessions(kind: RuntimeResourceKind, resourceIds: string[]) {
        for (const resourceId of resourceIds) {
            RuntimeResourceManager.unregisterFromAllSessions(kind, resourceId);
        }
    },

    parseEvent(payload: Record<string, any>): RuntimeResourceEventPayload | null {
        const resource = payload?.resource;
        if (!resource || typeof resource !== 'object') return null;
        if (resource.kind !== 'network_monitor' && resource.kind !== 'timer') return null;
        const action = resource.action === 'closed' ? 'closed' : resource.action === 'opened' ? 'opened' : null;
        if (!action) return null;
        const ids = Array.isArray(resource.resourceIds)
            ? resource.resourceIds.map((item: any) => String(item || '').trim()).filter(Boolean)
            : [];
        if (ids.length === 0) return null;
        return {
            kind: resource.kind,
            action,
            resourceIds: Array.from(new Set(ids)),
        };
    },

    applyEvent(sessionId: string, payload: Record<string, any>) {
        const resourceEvent = RuntimeResourceManager.parseEvent(payload);
        if (!resourceEvent) return;
        for (const resourceId of resourceEvent.resourceIds) {
            if (resourceEvent.action === 'opened') {
                RuntimeResourceManager.register(sessionId, resourceEvent.kind, resourceId);
            } else {
                RuntimeResourceManager.unregister(sessionId, resourceEvent.kind, resourceId);
            }
        }
    },

    async closeEntry(entry: RuntimeResourceEntry) {
        const handler = RUNTIME_RESOURCE_HANDLERS[entry.kind];
        if (!handler) return;
        await handler.close(entry.resourceId);
    },

    async closeByRun(sessionId: string, runId: string | null | undefined) {
        const map = RuntimeResourceManager.getSessionMap(sessionId, false);
        if (!map || map.size === 0) return;
        const normalizedRunId = typeof runId === 'string' && runId.trim() ? runId : null;
        for (const [key, entry] of map.entries()) {
            if (normalizedRunId && entry.runId !== normalizedRunId) continue;
            await RuntimeResourceManager.closeEntry(entry);
            map.delete(key);
        }
        if (map.size === 0) {
            sessionRuntimeResources.delete(sessionId);
        }
    },

    async closeAll(sessionId: string) {
        const map = RuntimeResourceManager.getSessionMap(sessionId, false);
        if (!map || map.size === 0) return;
        for (const entry of map.values()) {
            await RuntimeResourceManager.closeEntry(entry);
        }
        sessionRuntimeResources.delete(sessionId);
    },
};

/** 从事件中跟踪运行时资源（网络监控、定时器等） */
function trackRuntimeResourceFromEvent(sessionId: string, event: { type: string; content: string }) {
    if (event.type === 'function_result') {
        const payload = parseEventObject(event.content);
        if (payload) {
            RuntimeResourceManager.applyEvent(sessionId, payload);
        }
    }
}

type TaskScopedHandleChatOptions = Pick<
    HandleChatOptions,
    | 'disallowTools'
    | 'maxRounds'
    | 'maxToolCalls'
    | 'maxSameToolCalls'
    | 'appendUserQuery'
    | 'suppressNextStepHint'
>;

function createSessionCheckpointHandler(session: Session): NonNullable<HandleChatOptions['onCheckpoint']> {
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

function extractAssistantOutputText(output: OutputItem[]): string {
    const lines: string[] = [];
    for (const item of output) {
        if (item.type !== 'message' || !Array.isArray(item.content)) continue;
        for (const contentItem of item.content) {
            if (contentItem.type !== 'output_text') continue;
            const text = String(contentItem.text || '').trim();
            if (text) {
                lines.push(text);
            }
        }
    }
    return lines.join('\n').trim();
}

interface ReviewFindingItem {
    issue: string;
    impact: string;
    suggestion: string;
    priority?: 'P0' | 'P1' | 'P2';
}

interface ReviewOutputPayload {
    summary: string;
    findings: ReviewFindingItem[];
}

function normalizeReviewPriority(raw: unknown): ReviewFindingItem['priority'] | undefined {
    const text = String(raw || '').trim().toUpperCase();
    if (text === 'P0' || text === 'P1' || text === 'P2') return text;
    return undefined;
}

function parseReviewOutputPayload(text: string): ReviewOutputPayload {
    const normalizedText = String(text || '').trim();
    if (!normalizedText) {
        return {
            summary: '已完成审查，当前未识别到明确高风险问题。',
            findings: [],
        };
    }

    try {
        const parsed = JSON.parse(normalizedText) as any;
        const summary = typeof parsed?.summary === 'string'
            ? parsed.summary.trim()
            : typeof parsed?.overall_explanation === 'string'
                ? parsed.overall_explanation.trim()
                : '';
        const findings = Array.isArray(parsed?.findings)
            ? parsed.findings
                .map((item: any): ReviewFindingItem | null => {
                    if (!item || typeof item !== 'object') return null;
                    const issue = String(item.issue || item.problem || item.title || '').trim();
                    const impact = String(item.impact || item.risk || '').trim();
                    const suggestion = String(item.suggestion || item.fix || item.recommendation || '').trim();
                    if (!issue && !impact && !suggestion) return null;
                    return {
                        issue: issue || '未命名问题',
                        impact: impact || '影响待补充',
                        suggestion: suggestion || '建议待补充',
                        priority: normalizeReviewPriority(item.priority),
                    };
                })
                .filter(Boolean) as ReviewFindingItem[]
            : [];

        if (summary || findings.length > 0) {
            return {
                summary: summary || normalizedText,
                findings,
            };
        }
    } catch {
        // ignore and fallback
    }

    return {
        summary: normalizedText,
        findings: [],
    };
}

function buildReviewReplyText(output: ReviewOutputPayload): string {
    const summary = output.summary.trim() || '已完成审查。';
    if (!output.findings.length) return summary;
    const detailLines = output.findings.map((finding, index) => {
        const prefix = finding.priority ? `[${finding.priority}] ` : '';
        return `${index + 1}. ${prefix}${finding.issue}：${finding.impact}；建议：${finding.suggestion}`;
    });
    return [summary, ...detailLines].join('\n');
}

function buildTaskOneShotInput(session: Session, prompt: string): InputItem[] {
    const base = compactSessionContext([...(session.context || [])]).slice(-MAX_MODEL_CONTEXT_ITEMS);
    return [...base, { role: 'user', content: prompt }];
}

function appendTaskResultToContext(session: Session, taskPrompt: string, assistantText: string) {
    const nextContext = [
        ...(session.context || []),
        { role: 'user', content: taskPrompt } as InputItem,
        { role: 'assistant', content: assistantText } as InputItem,
    ];
    session.context = compactSessionContext(nextContext);
    persistRuntimeSessions();
}

async function runReviewTaskStandalone(ctx: SessionTaskRunContext) {
    const reviewPrompt = buildReviewTaskQuery(ctx.normalizedQuery || DEFAULT_REVIEW_TASK_QUERY);
    const input = buildTaskOneShotInput(ctx.session, reviewPrompt);
    ctx.pushEvent({
        type: 'planning',
        content: '正在审查当前结果并整理关键问题...',
    });

    try {
        const response = await chatComplete(input, undefined, REVIEW_TASK_INSTRUCTIONS, ctx.signal);
        const reviewText = extractAssistantOutputText(response.output) || '已完成审查，当前未识别到明确高风险问题。';
        const reviewOutput = parseReviewOutputPayload(reviewText);
        const replyText = buildReviewReplyText(reviewOutput);
        appendTaskResultToContext(ctx.session, reviewPrompt, replyText);
        ctx.session.status = 'done';
        ctx.session.failureCode = undefined;
        ctx.session.lastError = undefined;
        const assistantItemId = `assistant-review-${Date.now()}`;
        ctx.pushEvent({
            type: 'turn_item_started',
            content: JSON.stringify({
                itemType: 'assistant_message',
                itemId: assistantItemId,
                status: 'running',
            }),
        });
        ctx.pushEvent({
            type: 'turn_item_completed',
            content: JSON.stringify({
                itemType: 'assistant_message',
                itemId: assistantItemId,
                status: 'completed',
            }),
        });
        ctx.pushEvent({
            type: 'text',
            content: replyText,
        });
        emitTaskLifecycleEvent(
            ctx.pushEvent,
            'review',
            'exited',
            '审查模式已结束，已返回结果。',
            'done',
            ctx.runId,
            {
                reviewOutput,
                assistantReply: replyText,
            },
        );
    } catch (err) {
        const aborted = ctx.signal.aborted || (err as any)?.name === 'AbortError';
        if (aborted) throw err;
        emitTaskLifecycleEvent(
            ctx.pushEvent,
            'review',
            'exited',
            '审查模式已结束。',
            'error',
            ctx.runId,
            {
                failureCode: 'E_SESSION_RUNTIME',
                reason: 'review_task_failed',
            },
        );
        throw err;
    }
}

async function runCompactTaskStandalone(ctx: SessionTaskRunContext) {
    const beforeContext = ctx.session.context || [];
    const beforeDigest = buildCompactContextDigest(beforeContext);
    const compactPrompt = buildCompactTaskQuery(
        ctx.normalizedQuery || DEFAULT_COMPACT_TASK_QUERY,
        beforeContext,
    );
    const input = buildTaskOneShotInput(ctx.session, compactPrompt);
    const compactItemId = `context-compaction-${Date.now()}`;
    ctx.pushEvent({
        type: 'turn_item_started',
        content: JSON.stringify({
            itemType: 'context_compaction',
            itemId: compactItemId,
            status: 'running',
        }),
    });
    ctx.pushEvent({
        type: 'planning',
        content: '正在提炼已完成动作与关键结论...',
    });

    try {
        const response = await chatComplete(input, undefined, COMPACT_TASK_INSTRUCTIONS, ctx.signal);
        const compactSummary = extractAssistantOutputText(response.output) || '已完成上下文整理。';
        const nextContext = buildCompactedReplacementContext(beforeContext, compactSummary);
        const afterDigest = buildCompactContextDigest(nextContext);
        ctx.session.context = nextContext;
        ctx.session.status = 'done';
        ctx.session.failureCode = undefined;
        ctx.session.lastError = undefined;
        persistRuntimeSessions();
        ctx.pushEvent({
            type: 'planning',
            content: `上下文压缩完成：${beforeContext.length} -> ${nextContext.length}，已保留任务主线。`,
        });
        ctx.pushEvent({
            type: 'turn_item_completed',
            content: JSON.stringify({
                itemType: 'context_compaction',
                itemId: compactItemId,
                status: 'completed',
            }),
        });
        const assistantItemId = `assistant-compact-${Date.now()}`;
        ctx.pushEvent({
            type: 'turn_item_started',
            content: JSON.stringify({
                itemType: 'assistant_message',
                itemId: assistantItemId,
                status: 'running',
            }),
        });
        ctx.pushEvent({
            type: 'turn_item_completed',
            content: JSON.stringify({
                itemType: 'assistant_message',
                itemId: assistantItemId,
                status: 'completed',
            }),
        });
        ctx.pushEvent({
            type: 'text',
            content: compactSummary,
        });
        ctx.pushEvent({
            type: 'warning',
            content: '上下文已压缩。若后续结果不完整，建议重新开启一个新会话继续。',
        });
        emitTaskLifecycleEvent(
            ctx.pushEvent,
            'compact',
            'exited',
            '上下文整理已完成。',
            'done',
            ctx.runId,
            {
                compactSummary,
                assistantReply: compactSummary,
                beforeContextItems: beforeContext.length,
                afterContextItems: nextContext.length,
                compressionStateBefore: beforeDigest,
                compressionStateAfter: afterDigest,
            },
        );
    } catch (err) {
        const aborted = ctx.signal.aborted || (err as any)?.name === 'AbortError';
        if (aborted) throw err;
        ctx.pushEvent({
            type: 'turn_item_completed',
            content: JSON.stringify({
                itemType: 'context_compaction',
                itemId: compactItemId,
                status: 'error',
            }),
        });
        emitTaskLifecycleEvent(
            ctx.pushEvent,
            'compact',
            'exited',
            '上下文整理已结束。',
            'error',
            ctx.runId,
            {
                failureCode: 'E_SESSION_RUNTIME',
                reason: 'compact_task_failed',
            },
        );
        throw err;
    }
}

function buildReviewTaskQuery(normalizedQuery: string): string {
    return [
        '请进入审查子任务，只基于现有上下文做结论：',
        '- 先给一段总体判断，再列“问题-影响-建议”。',
        '- 问题按优先级从高到低排序，优先指出真实风险与回归点。',
        '- 不要编造未发生的执行结果，不要要求用户理解内部调度术语。',
        `用户需求：${normalizedQuery}`,
    ].join('\n');
}

function isSessionCompressionMessage(item: InputItem): boolean {
    return 'role' in item && item.role === 'assistant' && item.content.startsWith(SESSION_CONTEXT_COMPRESSION_TAG);
}

function clipCompactText(raw: unknown, max: number = 48): string {
    const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return text.length > max ? `${text.slice(0, max)}...` : text;
}

function pickCompactPrimaryGoal(context: InputItem[]): string {
    for (let index = context.length - 1; index >= 0; index--) {
        const item = context[index];
        if (!('role' in item) || item.role !== 'user') continue;
        const content = clipCompactText(item.content, 72);
        if (content) return content;
    }
    return '延续当前任务';
}

function collectCompactToolFacts(context: InputItem[], maxCount: number = 18): Array<{ toolName: string; success: boolean; detail: string }> {
    const callIdToTool = new Map<string, string>();
    const facts: Array<{ toolName: string; success: boolean; detail: string }> = [];

    for (const item of context) {
        if ('type' in item && item.type === 'function_call') {
            callIdToTool.set(item.call_id, item.name);
            continue;
        }
        if (!('type' in item) || item.type !== 'function_call_output') continue;
        const toolName = callIdToTool.get(item.call_id);
        if (!toolName) continue;
        let parsed: any = {};
        try {
            parsed = JSON.parse(item.output || '{}');
        } catch {
            parsed = {};
        }
        const detail = clipCompactText(
            parsed?.data?.message || parsed?.error || parsed?.data?.summary || parsed?.data?.title || '',
            42,
        );
        facts.push({
            toolName,
            success: Boolean(parsed?.success),
            detail,
        });
        if (facts.length > maxCount) {
            facts.splice(0, facts.length - maxCount);
        }
    }

    return facts;
}

function buildCompactContextDigest(context: InputItem[]): string[] {
    const normalized = [...(context || [])]
        .slice(-MAX_MODEL_CONTEXT_ITEMS)
        .filter((item) => !isSessionCompressionMessage(item));
    const facts = collectCompactToolFacts(normalized, 18);
    const goal = pickCompactPrimaryGoal(normalized);
    const done = facts
        .filter((item) => item.success)
        .map((item) => item.detail ? `${item.toolName}：${item.detail}` : item.toolName)
        .filter((item, index, list) => Boolean(item) && list.indexOf(item) === index)
        .slice(-3);
    const latestFailure = [...facts].reverse().find((item) => !item.success || /未找到|没找到|失败|超时|error|异常|无结果|没有结果/i.test(item.detail));
    const open = latestFailure
        ? `${latestFailure.toolName} 未闭环${latestFailure.detail ? `：${latestFailure.detail}` : ''}`
        : done.length > 0
            ? '暂无明确阻塞，优先补齐验证并收口答案。'
            : '暂无稳定完成项，需要继续观察页面与目标。';
    const next = latestFailure
        ? '围绕最近失败点继续修复，优先观察页面、重定位目标、完成验证。'
        : done.length > 0
            ? '沿最近有效结果继续推进，并保留最终证据与结论。'
            : '先锁定目标页面或元素，再执行动作并验证结果。';

    return [
        `Goal: ${goal}`,
        `Done: ${done.length > 0 ? done.join('；') : '暂无稳定完成项'}`,
        `Open: ${clipCompactText(open, 96)}`,
        `Next: ${next}`,
    ];
}

function buildSessionCompressionSummary(
    context: InputItem[],
    droppedCount: number,
    droppedUsers: number,
    droppedAssistants: number,
    droppedTools: number,
): string {
    return [
        `${SESSION_CONTEXT_COMPRESSION_TAG} 历史上下文已压缩。`,
        ...buildCompactContextDigest(context),
        `Dropped: ${droppedCount} 条（用户 ${droppedUsers}、助手 ${droppedAssistants}、工具链 ${droppedTools}）`,
    ].join('\n');
}

function buildCompactTaskQuery(normalizedQuery: string, context: InputItem[]): string {
    return [
        '请执行上下文压缩子任务：',
        '- 只保留已发生的事实、关键证据、当前结论和下一步。',
        '- 删除重复表述，不要新增未执行事实。',
        '- 输出优先围绕 Goal / Done / Open / Next 组织。',
        '当前上下文摘要：',
        ...buildCompactContextDigest(context),
        `附加要求：${normalizedQuery}`,
    ].join('\n');
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

function buildTurnLifecycleEventPayload(
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

function compactSessionContext(context: InputItem[]): InputItem[] {
    if (!Array.isArray(context) || context.length <= MAX_MODEL_CONTEXT_ITEMS) return context;

    const keepTail = Math.max(90, Math.floor(MAX_MODEL_CONTEXT_ITEMS * 0.78));
    const dropCount = Math.max(0, context.length - keepTail);
    const dropped = context.slice(0, dropCount);
    const tail = context.slice(dropCount).filter((item) => !isSessionCompressionMessage(item));

    const droppedUsers = dropped.filter((item) => 'role' in item && item.role === 'user').length;
    const droppedAssistants = dropped.filter((item) => 'role' in item && item.role === 'assistant').length;
    const droppedTools = dropped.filter((item) => 'type' in item).length;

    const summary: InputItem = {
        role: 'assistant',
        content: buildSessionCompressionSummary(tail, dropCount, droppedUsers, droppedAssistants, droppedTools),
    };

    const merged = [summary, ...tail];
    return merged.slice(-MAX_MODEL_CONTEXT_ITEMS);
}

function buildCompactedReplacementContext(context: InputItem[], compactSummary: string): InputItem[] {
    const normalized = compactSessionContext([...(context || [])]).filter((item) => {
        return !('role' in item && item.role === 'assistant' && item.content.startsWith(SESSION_CONTEXT_COMPRESSION_TAG));
    });

    const selectedUsers: InputItem[] = [];
    let remainingChars = COMPACT_USER_CONTEXT_CHAR_LIMIT;
    for (let index = normalized.length - 1; index >= 0; index--) {
        const item = normalized[index];
        if (!('role' in item) || item.role !== 'user') continue;
        const content = String(item.content || '').trim();
        if (!content) continue;
        const effectiveLen = content.length;
        if (effectiveLen > remainingChars && selectedUsers.length > 0) break;
        selectedUsers.push({ role: 'user', content });
        remainingChars = Math.max(0, remainingChars - effectiveLen);
        if (selectedUsers.length >= COMPACT_USER_CONTEXT_LIMIT || remainingChars === 0) break;
    }
    selectedUsers.reverse();

    const summaryItem: InputItem = {
        role: 'assistant',
        content: `${SESSION_CONTEXT_COMPRESSION_TAG} ${compactSummary}`,
    };

    return compactSessionContext([...selectedUsers, summaryItem]);
}

let runtimeSessionPersistQueue: Promise<void> = Promise.resolve();
let runtimePersistTimer: number | null = null;
let runtimePersistPending = false;
const RUNTIME_PERSIST_DEBOUNCE_MS = 220;

const snapshotSessionForRuntime = (session: Session): Session => ({
    ...session,
    context: session.context.slice(-MAX_RUNTIME_CONTEXT),
    eventLog: session.eventLog.slice(-MAX_RUNTIME_EVENT_LOG),
});

function queueRuntimeSessionsPersist(): Promise<void> {
    runtimeSessionPersistQueue = runtimeSessionPersistQueue
        .then(async () => {
            const payload = {
                activeSessionId,
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

function flushRuntimeSessions() {
    void queueRuntimeSessionsPersist();
}

function persistRuntimeSessions() {
    runtimePersistPending = true;
    if (runtimePersistTimer !== null) return;

    runtimePersistTimer = globalThis.setTimeout(() => {
        runtimePersistTimer = null;
        if (!runtimePersistPending) return;
        runtimePersistPending = false;
        flushRuntimeSessions();
    }, RUNTIME_PERSIST_DEBOUNCE_MS);
}

async function persistRuntimeSessionsImmediate() {
    runtimePersistPending = false;
    if (runtimePersistTimer !== null) {
        clearTimeout(runtimePersistTimer);
        runtimePersistTimer = null;
    }
    await queueRuntimeSessionsPersist();
}

async function restoreRuntimeSessions() {
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
                const abortedPayload = buildTurnLifecycleEventPayload('error', item, latestRunId, {
                    endedAt,
                    durationMs: Math.max(0, endedAt - (item.startedAt || endedAt)),
                    taskKind: getSessionTaskKind(item.id),
                    failureCode: 'E_SESSION_RUNTIME',
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
        activeSessionId = restoredActiveId && sessions.has(restoredActiveId) ? restoredActiveId : null;
        if (patchedAfterRestore) {
            await queueRuntimeSessionsPersist();
        }
    } catch (err) {
        console.error('[Mole] 恢复会话运行态失败:', err);
    }
}

/** 从错误文案推导失败码，便于快速定位问题 */
function resolveFailureCode(message: string): SessionFailureCode {
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
function parseErrorContent(content: string): { code: SessionFailureCode; message: string } {
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
function buildErrorContent(
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

function buildSessionReplayPayload(
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
function buildSessionSyncPayload(session: Session) {
    reconcileSessionStateFromEventLog(session);
    const now = Date.now();
    const activeRunId = findRunningTask(session.id)?.runId || null;
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
    };
}

/** 读取 chrome.storage.local */
function getLocalStorage<T>(key: string): Promise<T | undefined> {
    return new Promise((resolve) => {
        chrome.storage.local.get(key, (result) => {
            resolve(result[key] as T | undefined);
        });
    });
}

/** 写入 chrome.storage.local */
function setLocalStorage(data: Record<string, unknown>): Promise<void> {
    return new Promise((resolve) => {
        chrome.storage.local.set(data, () => resolve());
    });
}

/** 提取最新助手回复文本 */
function extractAssistantReply(eventLog: SessionEventLogItem[]): string | undefined {
    for (let index = eventLog.length - 1; index >= 0; index--) {
        const event = eventLog[index];
        if (event.type === 'text') {
            const text = event.content?.trim();
            if (text) return text;
        }
    }
    return undefined;
}

function extractTurnCompletedReply(eventLog: SessionEventLogItem[]): string | undefined {
    for (let index = eventLog.length - 1; index >= 0; index--) {
        const event = eventLog[index];
        if (event.type !== 'turn_completed') continue;
        const payload = parseTurnLifecycleEventPayload(event.content || '');
        const text = typeof payload?.lastAgentMessage === 'string'
            ? payload.lastAgentMessage.trim()
            : '';
        if (text) return text;
    }
    return undefined;
}

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

function extractLatestAssistantMessageFromContext(context: InputItem[] | undefined): string | undefined {
    if (!Array.isArray(context) || context.length === 0) return undefined;
    for (let index = context.length - 1; index >= 0; index--) {
        const item = context[index];
        if (!('role' in item) || item.role !== 'assistant') continue;
        const text = String(item.content || '').trim();
        if (!text || text.startsWith(SESSION_CONTEXT_COMPRESSION_TAG)) continue;
        return text;
    }
    return undefined;
}

/** 从 function_call 文案中解析工具名 */
function parseToolName(rawContent: string): string {
    const raw = (rawContent || '').trim();
    if (!raw) return '';

    try {
        const parsed = JSON.parse(raw) as { name?: string };
        if (parsed?.name) return parsed.name;
    } catch {
        // 非 JSON，走文本回退
    }

    const matched = raw.match(/正在调用\s+([a-zA-Z0-9_:-]+)\.\.\./);
    if (matched?.[1]) return matched[1];

    return raw.replace(/^正在调用\s+/, '').replace(/\.\.\.$/, '').trim();
}

/** 提取工具调用名称列表（去重） */
function extractToolCalls(eventLog: SessionEventLogItem[]): string[] {
    const toolCalls: string[] = [];
    const seen = new Set<string>();

    for (const event of eventLog) {
        if (event.type !== 'function_call') continue;

        const toolName = parseToolName(event.content || '');

        if (!toolName || seen.has(toolName)) continue;
        seen.add(toolName);
        toolCalls.push(toolName);
    }

    return toolCalls;
}

/** 提取工具调用链（含执行结果） */
function extractToolCallChain(eventLog: SessionEventLogItem[]): SessionToolCallChainItem[] {
    const chain: SessionToolCallChainItem[] = [];
    const pendingIndexes: number[] = [];
    const pendingByCallId = new Map<string, number>();
    const pendingByItemId = new Map<string, number>();
    const removePendingIndex = (index: number) => {
        const pos = pendingIndexes.indexOf(index);
        if (pos >= 0) pendingIndexes.splice(pos, 1);
    };

    const markCompleted = (index: number, status: SessionToolCallChainItem['status'], message: string | undefined, endedAt: number | undefined) => {
        const item = chain[index];
        if (!item) return;
        item.status = status;
        if (message && !item.message) {
            item.message = message;
        } else if (message) {
            item.message = message;
        }
        item.endedAt = endedAt;
    };

    for (const event of eventLog) {
        if (event.type === 'turn_item_started') {
            const payload = parseEventObject(event.content || '');
            if (!payload) continue;
            const itemType = String(payload.itemType || '');
            if (itemType !== 'function_call') continue;
            const callId = typeof payload.callId === 'string' ? payload.callId : '';
            const itemId = typeof payload.itemId === 'string' ? payload.itemId : '';
            const funcName = typeof payload.name === 'string' && payload.name.trim()
                ? payload.name.trim()
                : parseToolName(event.content || '');
            if (!funcName) continue;
            if (callId && pendingByCallId.has(callId)) continue;
            if (itemId && pendingByItemId.has(itemId)) continue;

            const index = chain.length;
            chain.push({
                funcName,
                status: 'running',
                startedAt: event.timestamp,
            });
            pendingIndexes.push(index);
            if (callId) pendingByCallId.set(callId, index);
            if (itemId) pendingByItemId.set(itemId, index);
            continue;
        }

        if (event.type === 'turn_item_completed') {
            const payload = parseEventObject(event.content || '');
            if (!payload) continue;
            const itemType = String(payload.itemType || '');
            if (itemType !== 'function_call') continue;
            const callId = typeof payload.callId === 'string' ? payload.callId : '';
            const itemId = typeof payload.itemId === 'string' ? payload.itemId : '';
            const statusRaw = String(payload.status || '').toLowerCase();
            const status: SessionToolCallChainItem['status'] = statusRaw === 'error' || statusRaw === 'cancelled'
                ? 'error'
                : 'done';
            const index = (callId && pendingByCallId.get(callId) !== undefined)
                ? pendingByCallId.get(callId)!
                : (itemId && pendingByItemId.get(itemId) !== undefined)
                    ? pendingByItemId.get(itemId)!
                    : undefined;
            if (index === undefined) continue;
            markCompleted(index, status, undefined, event.timestamp);
            removePendingIndex(index);
            if (callId) pendingByCallId.delete(callId);
            if (itemId) pendingByItemId.delete(itemId);
            continue;
        }

        if (event.type === 'function_call') {
            const funcName = parseToolName(event.content || '');
            if (!funcName) continue;

            const payload = parseEventObject(event.content || '');
            const callId = typeof payload?.callId === 'string' ? payload.callId : '';
            if (callId && pendingByCallId.has(callId)) continue;

            chain.push({
                funcName,
                status: 'running',
                startedAt: event.timestamp,
            });
            const index = chain.length - 1;
            pendingIndexes.push(index);
            if (callId) pendingByCallId.set(callId, index);
            continue;
        }

        if (event.type === 'function_result') {
            const payload = parseEventObject(event.content || '');
            const callId = typeof payload?.callId === 'string' ? payload.callId : '';
            const resultText = typeof payload?.message === 'string'
                ? payload.message.trim()
                : (event.content || '').trim();
            const isError = typeof payload?.success === 'boolean'
                ? payload.success === false
                : /出错|失败|异常/i.test(resultText);
            const targetIndex = (callId && pendingByCallId.get(callId) !== undefined)
                ? pendingByCallId.get(callId)!
                : pendingIndexes.shift();
            if (targetIndex === undefined) continue;

            markCompleted(targetIndex, isError ? 'error' : 'done', resultText || undefined, event.timestamp);
            removePendingIndex(targetIndex);
            if (callId) pendingByCallId.delete(callId);
            continue;
        }

        if (event.type === 'error' && pendingIndexes.length > 0) {
            for (const index of pendingIndexes) {
                markCompleted(index, 'error', '会话异常终止', event.timestamp);
            }
            pendingIndexes.length = 0;
            pendingByCallId.clear();
            pendingByItemId.clear();
        }
    }

    return chain;
}

/** 提取调度状态变化日志 */
function extractAgentTransitions(eventLog: SessionEventLogItem[]): SessionAgentTransitionItem[] {
    const transitions: SessionAgentTransitionItem[] = [];

    for (const event of eventLog) {
        if (event.type !== 'agent_state') continue;

        try {
            const parsed = JSON.parse(event.content) as AgentStateTransition;
            transitions.push({
                phase: parsed.to,
                round: parsed.round || 0,
                reason: parsed.reason || '',
                updatedAt: parsed.timestamp || event.timestamp || Date.now(),
            });
        } catch {
            // 忽略异常格式的 agent_state
        }
    }

    return transitions;
}

/** 构建会话历史记录 */
function buildSessionHistoryRecord(session: Session): SessionHistoryRecord {
    const updatedAt = Date.now();
    const startedAt = session.startedAt || session.createdAt || updatedAt;
    const endedAt = session.endedAt ?? (session.status === 'running' ? undefined : updatedAt);
    const durationMs = session.durationMs ?? (endedAt ? Math.max(0, endedAt - startedAt) : undefined);

    return {
        sessionId: session.id,
        summary: session.summary,
        status: session.status,
        startedAt,
        endedAt,
        durationMs,
        failureCode: session.failureCode,
        lastError: session.lastError,
        assistantReply: extractTurnCompletedReply(session.eventLog) || extractAssistantReply(session.eventLog),
        toolCalls: extractToolCalls(session.eventLog),
        toolCallChain: extractToolCallChain(session.eventLog),
        agentTransitions: extractAgentTransitions(session.eventLog),
        updatedAt,
    };
}

/** 会话历史写入队列，避免并发覆盖 */
let sessionHistoryPersistQueue: Promise<void> = Promise.resolve();

/** 写入/更新会话历史 */
function persistSessionHistory(session: Session) {
    if (session.status === 'running') return;

    const record = buildSessionHistoryRecord(session);

    sessionHistoryPersistQueue = sessionHistoryPersistQueue
        .then(async () => {
            const history = (await getLocalStorage<SessionHistoryRecord[]>(SESSION_HISTORY_STORAGE_KEY)) || [];
            const nextHistory = [record, ...history.filter(item => item.sessionId !== record.sessionId)]
                .sort((left, right) => right.updatedAt - left.updatedAt)
                .slice(0, MAX_SESSION_HISTORY);

            await setLocalStorage({
                [SESSION_HISTORY_STORAGE_KEY]: nextHistory,
            });
        })
        .catch((err) => {
            console.error('[Mole] 保存会话历史失败:', err);
        });
}

/**
 * 创建新会话
 * @param summary 首次查询文本
 * @param originTabId 发起任务的标签页 ID
 * @returns 新会话对象
 */
function createSession(summary: string, originTabId?: number): Session {
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

    activeSessionId = id;
    persistRuntimeSessions();
    return session;
}

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

async function abortSessionTask(
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

async function runSessionNow(session: Session, query: string, tabId?: number, options?: ExecuteSessionOptions) {
    if (!tryAcquireCoalesceKey(options?.coalesceKey)) return;
    await stopOtherRunningSessions('新任务已启动，当前任务被替换', session.id);
    const resolvedRequest = resolveSessionTaskRequest(query, options?.taskKind);
    sessionTaskKinds.set(session.id, resolvedRequest.taskKind);

    activeSessionId = session.id;
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

/**
 * 创建会话级 pushEvent 函数
 * 同时广播到所有标签页并追加到会话事件日志
 */
function createSessionPushEvent(session: Session) {
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

// ============ 内置消息处理 ============

/**
 * 获取 tab 信息
 * content script 请求自身的 tab 信息
 */
Channel.on('__get_tab_info', (_data, sender, sendResponse) => {
    if (sender?.tab && sendResponse) {
        sendResponse({
            id: sender.tab.id,
            url: sender.tab.url,
            title: sender.tab.title,
        });
    }
    return true;
});

/**
 * 显示桌面通知
 */
Channel.on('__show_notification', (data, _sender, sendResponse) => {
    const { title, message } = data || {};
    if (title && message) {
        showNotification(title, message);
    }
    if (sendResponse) sendResponse({ success: true });
    return true;
});

/**
 * 打开扩展设置页（options.html）
 */
Channel.on('__open_options_page', (_data, _sender, sendResponse) => {
    chrome.runtime.openOptionsPage(() => {
        const lastError = chrome.runtime.lastError;
        if (sendResponse) {
            sendResponse({
                success: !lastError,
                error: lastError?.message,
            });
        }
    });
    return true;
});

/**
 * 日志上报（content script → background 汇总日志）
 */
Channel.on('__log_report', (data, sender) => {
    if (!data) return;

    const timeStamp = data.timeStamp;
    const type = data.type || 'LOG';
    const text = data.text || '';
    const tabId = sender?.tab?.id || 'unknown';

    const tempText = `[${dayjs(timeStamp).format('HH:mm:ss.SSS')}][Tab:${tabId}] ${text}`;
    const textTitle = `%c Mole %c V${VERSION} `;
    const titleStyle = 'padding: 2px 1px; border-radius: 3px 0 0 3px; color: #fff; background: #606060; font-weight: bold;';
    const versionStyle = 'padding: 2px 1px; border-radius: 0 3px 3px 0; color: #fff; background: #42c02e; font-weight: bold;';

    const logData = data.error || data.logObj;

    switch (type) {
        case 'LOG':
            console.log(textTitle, titleStyle, versionStyle, tempText, logData);
            break;
        case 'WARN':
            console.warn(textTitle, titleStyle, versionStyle, tempText, logData);
            break;
        case 'ERROR':
            console.error(textTitle, titleStyle, versionStyle, tempText, logData);
            break;
    }
});

// ============ Tab 管理 ============

// tab 关闭时清理注册
chrome.tabs.onRemoved.addListener((tabId) => {
    Channel.unregisterTab(tabId);
    const activeMonitorIds = NetworkMonitorStore
        .list({ includeInactive: false })
        .filter(session => session.tabId === tabId)
        .map(session => session.id);
    NetworkMonitorStore.stopByTab(tabId);
    RuntimeResourceManager.unregisterManyFromAllSessions('network_monitor', activeMonitorIds);
    // CDP debugger 会话清理
    CDPSessionManager.detachTab(tabId).catch(() => {});
});

// ============ 网络请求监听（network_monitor 工具能力） ============

if (NetworkMonitorStore.isSupported()) {
    const webRequestFilter: chrome.webRequest.RequestFilter = { urls: ['<all_urls>'] };

    chrome.webRequest.onBeforeRequest.addListener((details) => {
        NetworkMonitorStore.recordBeforeRequest(details);
    }, webRequestFilter);

    chrome.webRequest.onCompleted.addListener((details) => {
        NetworkMonitorStore.recordCompleted(details);
    }, webRequestFilter);

    chrome.webRequest.onErrorOccurred.addListener((details) => {
        NetworkMonitorStore.recordError(details);
    }, webRequestFilter);
}

// ============ 定时器到期处理 ============

const activeTimerDispatch = new Set<string>();

/**
 * 定时任务触发处理（支持 alarm + runtime）
 */
async function handleTimerTrigger(timerId: string, source: 'alarm' | 'runtime_timeout' | 'runtime_interval') {
    if (activeTimerDispatch.has(timerId)) {
        console.log(`[Mole] 定时器触发忽略（仍在处理上一轮）: ${timerId}, 来源: ${source}`);
        return;
    }

    activeTimerDispatch.add(timerId);
    try {
        const task = await TimerStore.get(timerId);
        if (!task) return;

        const coalesceKey = `timer:${timerId}`;
        const hasInFlightTimerRun = activeCoalescedTasks.has(coalesceKey);
        const hasActiveSessionRun = hasRunningTasks();
        if (hasInFlightTimerRun || hasActiveSessionRun) {
            if (task.type === 'interval') {
                const intervalMs = task.intervalMs || Math.max(1, Math.round((task.intervalMinutes || 1) * 60 * 1000));
                await TimerStore.update(timerId, {
                    nextRunAt: Date.now() + intervalMs,
                });
            }
            console.log(`[Mole] 定时器触发已合并（已有活跃执行）: ${timerId}`);
            return;
        }

        console.log(`[Mole] 定时器触发: ${timerId}, 来源: ${source}, 操作: ${task.action}`);

        // 更新计数或清理
        if (task.type === 'interval') {
            task.currentCount++;
            if (task.maxCount && task.currentCount >= task.maxCount) {
                // 达到最大次数，清理
                TimerScheduler.clear(timerId);
                await chrome.alarms.clear(`mole_timer_${timerId}`);
                await TimerStore.remove(timerId);
                RuntimeResourceManager.unregisterFromAllSessions('timer', timerId);
                console.log(`[Mole] 周期任务已达最大次数，已清理: ${timerId}`);
            } else {
                const intervalMs = task.intervalMs || Math.max(1, Math.round((task.intervalMinutes || 1) * 60 * 1000));
                await TimerStore.update(timerId, {
                    currentCount: task.currentCount,
                    nextRunAt: Date.now() + intervalMs,
                });
            }
        } else {
            // timeout：执行后清理
            TimerScheduler.clear(timerId);
            await TimerStore.remove(timerId);
            RuntimeResourceManager.unregisterFromAllSessions('timer', timerId);
        }

        // 检查标签页是否存在
        let tabExists = false;
        if (task.tabId) {
            try {
                await chrome.tabs.get(task.tabId);
                tabExists = true;
            } catch {
                tabExists = false;
            }
        }

        if (tabExists) {
            await dispatchSessionOp(`timer:${timerId}`, async () => {
                // 标签页存在：通过 session 体系执行定时任务
                const session = createSession(task.action, task.tabId);
                const taskId = session.id;

                // 先发送 __ai_timer_trigger 让悬浮球创建任务
                Channel.sendToTab(task.tabId, '__ai_timer_trigger', {
                    taskId,
                    sessionId: taskId,
                    action: task.action,
                    timerId,
                    timerType: task.type,
                });

                // 稍等一下让悬浮球创建任务
                await new Promise(r => setTimeout(r, 200));

                // 直接执行（定时触发禁止再创建定时任务）
                await runSessionNow(session, task.action, task.tabId, {
                    coalesceKey,
                    disallowTools: ['set_timeout', 'set_interval'],
                    maxRounds: 12,
                    maxToolCalls: 30,
                    maxSameToolCalls: 3,
                    taskKind: 'aux',
                });
            });
        } else {
            // 标签页不存在：显示通知
            showNotification(
                '定时任务触发',
                `${task.action}\n（原标签页已关闭，无法推送结果）`,
            );
        }
    } finally {
        activeTimerDispatch.delete(timerId);
    }
}

/**
 * Chrome Alarms 监听器（分钟级持久调度）
 */
chrome.alarms.onAlarm.addListener((alarm) => {
    if (!alarm.name.startsWith('mole_timer_')) return;
    const timerId = alarm.name.replace('mole_timer_', '');
    void handleTimerTrigger(timerId, 'alarm').catch(err => {
        console.error(`[Mole] alarm 定时器处理异常: ${timerId}`, err);
    });
});

/**
 * 运行时定时器触发处理（毫秒级）
 */
TimerScheduler.setTriggerHandler((timerId, source) => {
    return handleTimerTrigger(timerId, source);
});

/**
 * Service Worker 启动时恢复运行时定时器
 */
void (async () => {
    const tasks = await TimerStore.getAll();
    const now = Date.now();

    for (const task of tasks) {
        if (task.scheduleMode !== 'runtime') continue;

        if (task.type === 'timeout') {
            const nextRunAt = task.nextRunAt || now;
            const delayMs = Math.max(1, nextRunAt - now);
            TimerScheduler.scheduleTimeout(task.id, delayMs);
            continue;
        }

        if (task.type === 'interval') {
            const intervalMs = task.intervalMs || Math.max(1, Math.round((task.intervalMinutes || 1) * 60 * 1000));
            TimerScheduler.scheduleInterval(task.id, intervalMs);
            // 恢复时同步下一次执行时间，便于 UI 展示
            await TimerStore.update(task.id, { nextRunAt: now + intervalMs });
        }
    }
})().catch((err) => {
    console.error('[Mole] 恢复运行时定时器失败:', err);
});

// Service Worker 启动时恢复会话运行态
void (async () => {
    await restoreRuntimeSessions();
})().catch((err) => {
    console.error('[Mole] 恢复会话状态失败:', err);
});

// ============ 会话管理消息处理 ============

async function handleSessionCreateOp(op: SessionCreateOp) {
    const rollbackCommand = parseRollbackCommand(String(op.query || ''));
    if (rollbackCommand) {
        respondSessionOp(op.sendResponse, {
            accepted: false,
            code: 'E_PARAM_RESOLVE',
            message: '当前没有可回滚的活跃会话，请在已有会话中使用 /rollback 或 /undo',
        }, op.label);
        return;
    }

    const resolvedRequest = resolveSessionTaskRequest(op.query, op.requestedTaskKind);
    const session = createSession(resolvedRequest.query, op.tabId);
    sessionTaskKinds.set(session.id, resolvedRequest.taskKind);

    console.log(`[Mole] 创建会话: ${session.id}, kind: ${resolvedRequest.taskKind}, query: ${resolvedRequest.query}`);

    respondSessionOp(op.sendResponse, buildSessionSyncPayload(session), op.label);
    Channel.broadcast('__session_sync', buildSessionSyncPayload(session));

    await runSessionNow(session, resolvedRequest.query, op.tabId, {
        ...op.taskOptions,
        taskKind: resolvedRequest.taskKind,
    });
}

async function handleSessionContinueOp(op: SessionContinueOp) {
    const respond = (payload: Record<string, unknown>) => {
        respondSessionOp(op.sendResponse, payload, op.label);
    };
    const rollbackCommand = parseRollbackCommand(String(op.query || ''));
    const runningTask = getPrimaryRunningTask();
    const runningSessionId = runningTask?.sessionId || null;
    const runningRunId = runningTask?.runId || null;

    if (rollbackCommand) {
        if (runningSessionId) {
            respond({
                accepted: false,
                code: 'E_TURN_MISMATCH',
                message: '存在运行中的任务，无法执行回滚，请先停止当前任务',
                actualSessionId: runningSessionId,
                actualRunId: runningRunId,
            });
            return;
        }
        const targetSession = sessions.get(op.sessionId);
        if (!targetSession) {
            respond({
                accepted: false,
                code: 'E_SESSION_RUNTIME',
                message: `会话不存在：${op.sessionId}`,
            });
            return;
        }
        const rolledBack = await rollbackSessionTurns(targetSession, rollbackCommand.turns, rollbackCommand.source);
        respond({
            accepted: rolledBack.droppedTurns > 0,
            mode: 'rollback',
            sessionId: targetSession.id,
            droppedTurns: rolledBack.droppedTurns,
            message: rolledBack.reason,
        });
        return;
    }

    if (runningSessionId) {
        const injectedQuery = String(op.query || '').trim();
        if (!injectedQuery) {
            respond({
                accepted: false,
                code: 'E_PARAM_RESOLVE',
                message: '追加指令不能为空',
            });
            return;
        }
        if (op.expectedRunId && runningRunId && op.expectedRunId !== runningRunId) {
            respond({
                accepted: false,
                code: 'E_TURN_MISMATCH',
                message: `回合不匹配（expectedRunId=${op.expectedRunId}, actualRunId=${runningRunId}）`,
                expectedRunId: op.expectedRunId,
                actualRunId: runningRunId,
                actualSessionId: runningSessionId,
            });
            return;
        }
        if (op.expectedSessionId && op.expectedSessionId !== runningSessionId) {
            respond({
                accepted: false,
                code: 'E_TURN_MISMATCH',
                message: `会话不匹配（expectedSessionId=${op.expectedSessionId}, actualSessionId=${runningSessionId}）`,
                expectedSessionId: op.expectedSessionId,
                actualSessionId: runningSessionId,
                actualRunId: runningRunId,
            });
            return;
        }

        const activeSession = sessions.get(runningSessionId);
        if (!activeSession) {
            respond({
                accepted: false,
                code: 'E_SESSION_RUNTIME',
                message: `活跃会话不存在：${runningSessionId}`,
            });
            return;
        }

        activeSession.context.push({ role: 'user', content: injectedQuery });
        persistRuntimeSessions();
        respond({ accepted: true, mode: 'injected', sessionId: runningSessionId, runId: runningRunId });
        return;
    }

    const resolvedRequest = resolveSessionTaskRequest(op.query, op.requestedTaskKind);
    const session = sessions.get(op.sessionId);
    if (!session) {
        console.warn(`[Mole] 会话不存在: ${op.sessionId}`);
        respond({
            accepted: false,
            code: 'E_SESSION_RUNTIME',
            message: `会话不存在：${op.sessionId}`,
        });
        return;
    }
    if (op.expectedSessionId && op.expectedSessionId !== op.sessionId) {
        respond({
            accepted: false,
            code: 'E_TURN_MISMATCH',
            message: `会话不匹配（expectedSessionId=${op.expectedSessionId}, actualSessionId=${op.sessionId}）`,
            expectedSessionId: op.expectedSessionId,
            actualSessionId: op.sessionId,
            actualRunId: extractLatestStartedRunId(session.eventLog),
        });
        return;
    }
    if (op.expectedRunId) {
        const latestRunId = extractLatestStartedRunId(session.eventLog);
        if (latestRunId && latestRunId !== op.expectedRunId) {
            respond({
                accepted: false,
                code: 'E_TURN_MISMATCH',
                message: `回合不匹配（expectedRunId=${op.expectedRunId}, actualRunId=${latestRunId}）`,
                expectedRunId: op.expectedRunId,
                actualRunId: latestRunId,
                actualSessionId: op.sessionId,
            });
            return;
        }
    }

    if (activeControllers.has(op.sessionId) || findRunningTask(op.sessionId)) {
        await abortSessionTask(op.sessionId, 'replaced', '继续对话，替换旧会话任务', 'E_SUPERSEDED');
    }

    // 如果 originTabId 对应的标签页已关闭，将当前 tabId 更新为新的 originTabId
    if (session.originTabId && op.tabId) {
        try {
            await chrome.tabs.get(session.originTabId);
        } catch {
            // 原标签页已关闭，更新为当前发起者
            session.originTabId = op.tabId;
        }
    }

    session.status = 'running';
    session.startedAt = Date.now();
    session.endedAt = undefined;
    session.durationMs = undefined;
    session.failureCode = undefined;
    session.lastError = undefined;
    session.agentState = {
        phase: 'plan',
        round: 0,
        reason: `继续对话：${resolvedRequest.query.slice(0, 30)}`,
        updatedAt: Date.now(),
    };
    sessionTaskKinds.set(session.id, resolvedRequest.taskKind);

    Channel.broadcast('__session_sync', buildSessionSyncPayload(session));
    persistRuntimeSessions();

    await runSessionNow(session, resolvedRequest.query, op.tabId, {
        ...op.taskOptions,
        taskKind: resolvedRequest.taskKind,
    });
    respond({
        accepted: true,
        mode: 'restart',
        sessionId: op.sessionId,
    });
}

async function handleSessionRollbackOp(op: SessionRollbackOp) {
    if (hasRunningTasks()) {
        respondSessionOp(op.sendResponse, {
            success: false,
            code: 'E_TURN_MISMATCH',
            message: '存在运行中的任务，无法执行回滚',
        }, op.label);
        return;
    }
    const session = sessions.get(op.sessionId);
    if (!session) {
        respondSessionOp(op.sendResponse, {
            success: false,
            code: 'E_SESSION_RUNTIME',
            message: `会话不存在：${op.sessionId}`,
        }, op.label);
        return;
    }
    const result = await rollbackSessionTurns(session, op.turns, op.source);
    respondSessionOp(op.sendResponse, {
        success: result.droppedTurns > 0,
        sessionId: op.sessionId,
        droppedTurns: result.droppedTurns,
        message: result.reason,
    }, op.label);
}

async function handleSessionClearOp(op: SessionClearOp) {
    await RuntimeResourceManager.closeAll(op.sessionId);
    const clearedTaskKind = getSessionTaskKind(op.sessionId);
    const now = Date.now();

    const session = sessions.get(op.sessionId);
    const isRunningSession = session?.status === 'running';
    if (session) {
        if (session.status === 'running') {
            await abortSessionTask(op.sessionId, 'interrupted', '会话已清除', 'E_CANCELLED');
            persistSessionHistory(session);
        }
    }

    if (activeSessionId === op.sessionId) {
        activeSessionId = null;
    }

    Channel.broadcast('__session_sync', {
        sessionId: op.sessionId,
        activeRunId: null,
        status: 'cleared',
        summary: '',
        agentState: {
            phase: 'idle',
            round: 0,
            reason: '会话已清除',
            updatedAt: now,
        },
        startedAt: session?.startedAt,
        endedAt: session?.endedAt,
        durationMs: session?.durationMs,
        failureCode: isRunningSession ? 'E_CANCELLED' : session?.failureCode,
        lastError: isRunningSession ? '会话已清除' : session?.lastError,
        taskKind: clearedTaskKind,
        opQueue: buildSessionOpQueueSnapshot(now),
    });
    sessionTaskKinds.delete(op.sessionId);
    persistRuntimeSessions();
}

async function handleSessionCancelOp(op: SessionCancelOp) {
    if (activeControllers.has(op.sessionId) || getRunningTasks().some(task => task.sessionId === op.sessionId)) {
        console.log(`[Mole] 取消任务: ${op.sessionId}`);
        await abortSessionTask(op.sessionId, 'interrupted', '任务已取消', 'E_CANCELLED');
    } else {
        await RuntimeResourceManager.closeAll(op.sessionId);
    }

    const session = sessions.get(op.sessionId);
    if (session && session.status === 'error') {
        Channel.broadcast('__session_sync', buildSessionSyncPayload(session));
    }
}

async function handleSessionGetActiveOp(op: SessionGetActiveOp) {
    if (!activeSessionId) {
        respondSessionOp(op.sendResponse, null, op.label);
        return;
    }

    const session = sessions.get(activeSessionId);
    if (!session) {
        respondSessionOp(op.sendResponse, null, op.label);
        return;
    }

    respondSessionOp(op.sendResponse, buildSessionSyncPayload(session), op.label);

    const tabId = op.senderTabId;
    if (session.eventLog.length > 0 && tabId) {
        const replayPayload = buildSessionReplayPayload(session, 'latest_turn');
        setTimeout(() => {
            Channel.sendToTab(tabId, '__session_replay', {
                ...replayPayload,
            });
        }, 50);
    }
}

async function handleSessionReplayRequestOp(op: SessionReplayRequestOp) {
    const sessionId = typeof op.sessionId === 'string' ? op.sessionId : activeSessionId;
    if (!sessionId) {
        respondSessionOp(op.sendResponse, {
            success: false,
            code: 'E_PARAM_RESOLVE',
            message: '缺少 sessionId',
        }, op.label);
        return;
    }

    const session = sessions.get(sessionId);
    if (!session) {
        respondSessionOp(op.sendResponse, {
            success: false,
            code: 'E_SESSION_RUNTIME',
            message: `会话不存在：${sessionId}`,
        }, op.label);
        return;
    }

    const scopeRaw = String(op.scopeRaw || 'latest_turn').trim().toLowerCase();
    const scope: SessionReplayPayload['scope'] = scopeRaw === 'full' || scopeRaw === 'delta'
        ? scopeRaw
        : 'latest_turn';
    const fromEventCount = Number.isFinite(Number(op.fromEventCountRaw))
        ? Number(op.fromEventCountRaw)
        : undefined;
    const payload = buildSessionReplayPayload(session, scope, fromEventCount);

    if (op.senderTabId) {
        Channel.sendToTab(op.senderTabId, '__session_replay', payload);
    } else {
        Channel.broadcast('__session_replay', payload);
    }

    respondSessionOp(op.sendResponse, {
        success: true,
        sessionId,
        scope: payload.scope,
        fromEventCount: payload.fromEventCount,
        eventCount: payload.eventCount,
        deliveredToTabId: op.senderTabId || null,
    }, op.label);
}

async function handleSessionOp(op: SessionOp) {
    if (op.type === 'create') {
        await handleSessionCreateOp(op);
        return;
    }
    if (op.type === 'continue') {
        await handleSessionContinueOp(op);
        return;
    }
    if (op.type === 'rollback') {
        await handleSessionRollbackOp(op);
        return;
    }
    if (op.type === 'clear') {
        await handleSessionClearOp(op);
        return;
    }
    if (op.type === 'cancel') {
        await handleSessionCancelOp(op);
        return;
    }
    if (op.type === 'get_active') {
        await handleSessionGetActiveOp(op);
        return;
    }
    if (op.type === 'replay_request') {
        await handleSessionReplayRequestOp(op);
        return;
    }
}

function submitSessionOp(op: SessionOp): Promise<void> {
    return dispatchSessionOp(op.label, async () => {
        await handleSessionOp(op);
    });
}

/**
 * 创建新会话
 * content script 请求创建新会话，background 生成 sessionId 并开始 AI 对话
 */
Channel.on('__session_create', (data, sender, sendResponse) => {
    const query = typeof data?.query === 'string' ? data.query : '';
    if (!query.trim()) return;
    const op: SessionCreateOp = {
        type: 'create',
        label: '__session_create',
        query,
        requestedTaskKind: data?.taskKind,
        taskOptions: extractExecuteSessionOptions(data),
        tabId: sender?.tab?.id,
        sendResponse,
    };
    void submitSessionOp(op);

    return true;
});

/**
 * 继续对话
 * content script 在已有会话上继续对话
 */
Channel.on('__session_continue', (data, sender, sendResponse) => {
    const sessionId = typeof data?.sessionId === 'string' ? data.sessionId : '';
    const query = typeof data?.query === 'string' ? data.query : '';
    const requestedTaskKind = data?.taskKind;
    const expectedSessionId = typeof data?.expectedSessionId === 'string' ? data.expectedSessionId : null;
    const expectedRunIdRaw = data?.expectedRunId ?? data?.expectedTurnId ?? data?.expected_turn_id;
    const expectedRunId = typeof expectedRunIdRaw === 'string' && expectedRunIdRaw.trim()
        ? expectedRunIdRaw.trim()
        : null;
    if (!sessionId || !query.trim()) return;

    const op: SessionContinueOp = {
        type: 'continue',
        label: '__session_continue',
        sessionId,
        query,
        requestedTaskKind,
        expectedSessionId,
        expectedRunId,
        taskOptions: extractExecuteSessionOptions(data),
        tabId: sender?.tab?.id,
        sendResponse,
    };
    void submitSessionOp(op);

    return true;
});

Channel.on('__session_rollback', (data, _sender, sendResponse) => {
    const sessionId = typeof data?.sessionId === 'string' ? data.sessionId : activeSessionId;
    const turnsRaw = Number(data?.numTurns ?? data?.turns ?? 1);
    const turns = Number.isFinite(turnsRaw) ? Math.max(1, Math.min(50, Math.floor(turnsRaw))) : 1;
    const source = String(data?.source || '').trim().toLowerCase() === 'undo' ? 'undo' : 'rollback';
    if (!sessionId) {
        sendResponse?.({
            success: false,
            code: 'E_PARAM_RESOLVE',
            message: '缺少 sessionId',
        });
        return true;
    }

    const op: SessionRollbackOp = {
        type: 'rollback',
        label: '__session_rollback',
        sessionId,
        turns,
        source,
        sendResponse,
    };
    void submitSessionOp(op);
    return true;
});

/**
 * 获取当前活跃会话信息
 * 新标签页初始化时请求，用于恢复会话状态
 */
Channel.on('__session_get_active', (_data, sender, sendResponse) => {
    const op: SessionGetActiveOp = {
        type: 'get_active',
        label: '__session_get_active',
        senderTabId: sender?.tab?.id,
        sendResponse,
    };
    void submitSessionOp(op);
    return true;
});

/**
 * 请求会话回放
 * 支持 latest_turn / full / delta 三种范围
 */
Channel.on('__session_replay_request', (data, sender, sendResponse) => {
    const op: SessionReplayRequestOp = {
        type: 'replay_request',
        label: '__session_replay_request',
        sessionId: typeof data?.sessionId === 'string' ? data.sessionId : activeSessionId,
        scopeRaw: String(data?.scope || 'latest_turn'),
        fromEventCountRaw: data?.fromEventCount,
        senderTabId: sender?.tab?.id,
        sendResponse,
    };
    void submitSessionOp(op);
    return true;
});

// ============ 站点工作流匹配（供 content script 查询当前页面可用的 workflow） ============

Channel.on('__site_workflows_match', (data, _sender, sendResponse) => {
    void (async () => {
        const url = String(data?.url || '').trim();
        const allWorkflows = await listSiteWorkflows();
        const matched = matchWorkflows(url, allWorkflows);
        // 卡片提示过滤：url_patterns 全是通配符的 workflow 不在卡片中展示
        const isUniversal = (p: string) => /^\*:\/\/\*\/\*$/.test(p.trim());
        const hinted = matched.filter(w => !w.url_patterns.every(isUniversal));
        // 按 label 去重（不同 name 但 label 相同的只保留第一个）
        const seenLabels = new Set<string>();
        const deduped = hinted.filter(w => {
            if (seenLabels.has(w.label)) return false;
            seenLabels.add(w.label);
            return true;
        });
        sendResponse?.({
            success: true,
            workflows: deduped.map(w => ({
                name: w.name,
                label: w.label,
                description: w.description,
                hasRequiredParams: Array.isArray(w.parameters?.required) && w.parameters.required.length > 0,
            })),
        });
    })().catch(() => {
        sendResponse?.({ success: false, workflows: [] });
    });
    return true;
});

Channel.on('__dynamic_tools_list', (_data, _sender, sendResponse) => {
    void (async () => {
        const tools = await listDynamicTools();
        sendResponse?.({
            success: true,
            tools,
        });
    })().catch((err: any) => {
        sendResponse?.({
            success: false,
            message: err?.message || '读取动态工具失败',
        });
    });
    return true;
});

Channel.on('__dynamic_tools_upsert', (data, _sender, sendResponse) => {
    void (async () => {
        const rawSpec = data?.spec && typeof data.spec === 'object'
            ? data.spec
            : data;
        const result = await upsertDynamicTool(rawSpec);
        sendResponse?.(result);
    })().catch((err: any) => {
        sendResponse?.({
            success: false,
            message: err?.message || '更新动态工具失败',
        });
    });
    return true;
});

Channel.on('__dynamic_tools_remove', (data, _sender, sendResponse) => {
    void (async () => {
        const result = await removeDynamicTool(data?.name);
        sendResponse?.(result);
    })().catch((err: any) => {
        sendResponse?.({
            success: false,
            message: err?.message || '移除动态工具失败',
        });
    });
    return true;
});

Channel.on('__dynamic_tools_import_manifest', (data, _sender, sendResponse) => {
    void (async () => {
        const result = await importDynamicToolsFromManifest(data?.url, data?.replaceAll === true);
        sendResponse?.(result);
    })().catch((err: any) => {
        sendResponse?.({
            success: false,
            message: err?.message || '导入动态工具失败',
            imported: 0,
            removed: 0,
            skipped: 0,
        });
    });
    return true;
});

// Workflow 注册表热重载（Options 页面修改后通知刷新内存缓存）
Channel.on('__workflow_registry_invalidate', (_data, _sender, sendResponse) => {
    void (async () => {
        await reloadRegistryFromStore();
        sendResponse?.({ success: true });
    })().catch((err: any) => {
        sendResponse?.({
            success: false,
            message: err?.message || '刷新 workflow 缓存失败',
        });
    });
    return true;
});

Channel.on('__debug_tools_catalog', (_data, _sender, sendResponse) => {
    void (async () => {
        const tools = await mcpClient.listTools();
        sendResponse?.({
            success: true,
            tools,
            now: Date.now(),
        });
    })().catch((err: any) => {
        sendResponse?.({
            success: false,
            message: err?.message || '读取调试工具目录失败',
        });
    });
    return true;
});

Channel.on('__debug_call_tool', (data, _sender, sendResponse) => {
    void (async () => {
        const toolName = String(data?.name || '').trim();
        if (!toolName) {
            sendResponse?.({
                success: false,
                message: '缺少工具名',
            });
            return;
        }
        const args = data?.args && typeof data.args === 'object' && !Array.isArray(data.args)
            ? data.args
            : {};
        const tabIdRaw = Number(data?.tabId);
        const tabId = Number.isFinite(tabIdRaw) ? Math.floor(tabIdRaw) : undefined;
        const startedAt = Date.now();
        const mcpResult = await mcpClient.callTool(toolName, args, tabId ? { tabId } : undefined);
        const text = mcpResult?.content?.[0]?.text || '';
        let parsed: any = null;
        if (text) {
            try {
                parsed = JSON.parse(text);
            } catch {
                parsed = null;
            }
        }
        sendResponse?.({
            success: true,
            name: toolName,
            tabId: tabId ?? null,
            durationMs: Date.now() - startedAt,
            raw: text,
            parsed,
            mcpResult,
        });
    })().catch((err: any) => {
        sendResponse?.({
            success: false,
            message: err?.message || '调试调用失败',
        });
    });
    return true;
});

Channel.on('__debug_run_plan', (data, _sender, sendResponse) => {
    void (async () => {
        const workflow = String(data?.workflow || '').trim();
        const plan = data?.plan;
        const params = data?.params;
        const tabIdRaw = Number(data?.tabId);
        const tabId = Number.isFinite(tabIdRaw) ? Math.floor(tabIdRaw) : undefined;
        const startedAt = Date.now();

        const result = await executeDebugRemotePlan(workflow, plan, params, {
            tabId,
        });
        sendResponse?.({
            success: true,
            workflow: workflow || 'baidu_search',
            tabId: tabId ?? null,
            durationMs: Date.now() - startedAt,
            actions: getSupportedRemotePlanActions(),
            parsed: result,
        });
    })().catch((err: any) => {
        sendResponse?.({
            success: false,
            message: err?.message || '执行 plan 失败',
        });
    });
    return true;
});

/**
 * 清除会话
 * 任意标签页请求清除当前活跃会话
 */
Channel.on('__session_clear', (data) => {
    const sessionId = data?.sessionId || activeSessionId;
    if (!sessionId) return;

    const op: SessionClearOp = {
        type: 'clear',
        label: '__session_clear',
        sessionId,
    };
    void submitSessionOp(op);
});

/**
 * 定位到任务发起页签
 * 非发起页签请求跳转到任务所在页签
 */
Channel.on('__session_focus_tab', async (data) => {
    const tabId = data?.tabId;
    if (typeof tabId !== 'number') return;
    try {
        const tab = await chrome.tabs.get(tabId);
        await chrome.tabs.update(tabId, { active: true });
        if (typeof tab.windowId === 'number') {
            await chrome.windows.update(tab.windowId, { focused: true });
        }
    } catch (err) {
        console.warn('[Mole] 定位到任务页签失败:', err);
    }
});

// ============ AI 对话处理 ============

/**
 * 处理 AI 任务取消请求
 * 支持 sessionId（新模式）和 taskId（兼容旧模式）
 */
Channel.on('__ai_cancel', (data) => {
    const id = data?.sessionId || data?.taskId;
    if (!id) return;

    const op: SessionCancelOp = {
        type: 'cancel',
        label: '__ai_cancel',
        sessionId: id,
    };
    void submitSessionOp(op);
});

/**
 * 测试链式调用：真实调用多个函数
 * 输入 "test:chain:关键词" 时触发，依次调用 baidu_search → jd_search
 */
Channel.on('__test_chain', (data, sender) => {
    const keyword = data?.keyword;
    const taskId = data?.taskId;
    const tabId = sender?.tab?.id;

    if (!keyword || !tabId) return;

    const pushEvent = (event: { type: string; content: string }) => {
        Channel.sendToTab(tabId, '__ai_stream', { ...event, taskId });
    };

    console.log(`[Mole] 测试链式调用, tab: ${tabId}, keyword: ${keyword}`);

    (async () => {
        pushEvent({ type: 'thinking', content: 'AI 正在思考...' });

        // 第一轮：百度搜索（通过 MCP Client 调用）
        pushEvent({ type: 'function_call', content: '正在调用 baidu_search...' });
        try {
            const baiduResult = await mcpClient.callTool('baidu_search', { keyword });
            pushEvent({ type: 'function_result', content: 'baidu_search 执行完成' });
            if (!baiduResult.isError && baiduResult.content[0]?.text) {
                const parsed = JSON.parse(baiduResult.content[0].text);
                if (parsed.success && parsed.data) {
                    pushEvent({ type: 'search_results', content: JSON.stringify(parsed.data) });
                }
            }
        } catch (err: any) {
            pushEvent({ type: 'function_result', content: `baidu_search 出错: ${err.message}` });
        }

        // 第二轮：京东搜索（通过 MCP Client 调用）
        pushEvent({ type: 'function_call', content: '正在调用 jd_search...' });
        try {
            const jdResult = await mcpClient.callTool('jd_search', { keyword });
            pushEvent({ type: 'function_result', content: 'jd_search 执行完成' });
            if (!jdResult.isError && jdResult.content[0]?.text) {
                const parsed = JSON.parse(jdResult.content[0].text);
                if (parsed.success && parsed.data) {
                    pushEvent({ type: 'search_results', content: JSON.stringify(parsed.data) });
                }
            }
        } catch (err: any) {
            pushEvent({ type: 'function_result', content: `jd_search 出错: ${err.message}` });
        }

        // 模拟 AI 流式文本输出
        const aiReply = `### 综合分析\n\n` +
            `根据**百度搜索**和**京东商品**数据，为你整理「${keyword}」选购建议：\n\n` +
            `### 轴体对比\n\n` +
            `- **红轴**：线性手感，轻柔安静，适合长时间打字和游戏\n` +
            `- **青轴**：段落感强，打字有"哒哒"声，喜欢反馈感的首选\n` +
            `- **茶轴**：介于红轴和青轴之间，兼顾手感与静音\n\n` +
            `### 价格区间\n\n` +
            `1. **入门级** \`¥200-500\`：Cherry MX Board、Akko 3068\n` +
            `2. **进阶级** \`¥500-1000\`：Leopold FC750R、Varmilo 阿米洛\n` +
            `3. **旗舰级** \`¥1000+\`：HHKB Professional、Realforce\n\n` +
            `### 选购建议\n\n` +
            `选购时建议关注**键帽材质**（PBT 优于 ABS）、**连接方式**（有线延迟低，蓝牙便携）以及*售后保修政策*。更多信息可参考 [机械键盘吧](https://tieba.baidu.com/f?kw=%E6%9C%BA%E6%A2%B0%E9%94%AE%E7%9B%98)。\n\n` +
            `以下是为你精选的商品，点击可直接查看：`;

        // 逐块推送模拟流式
        for (let i = 0; i < aiReply.length; i += 6) {
            pushEvent({ type: 'text', content: aiReply.slice(0, i + 6) });
            await new Promise(r => setTimeout(r, 15));
        }
        pushEvent({ type: 'text', content: aiReply });

        // 推荐卡片
        const cards = [
            { title: 'Cherry MX Board 3.0S 机械键盘 红轴', price: '¥549', shop: 'Cherry官方旗舰店', url: 'https://item.jd.com/100038004786.html', tag: '性价比首选' },
            { title: 'Leopold FC750R PD 双模机械键盘 茶轴', price: '¥799', shop: 'Leopold海外旗舰店', url: 'https://item.jd.com/100014458498.html', tag: '手感之王' },
            { title: 'HHKB Professional Hybrid 静电容键盘', price: '¥1,899', shop: 'HHKB京东自营', url: 'https://item.jd.com/100011459498.html', tag: '极客必备' },
        ];
        pushEvent({ type: 'cards', content: JSON.stringify(cards) });

        pushEvent({ type: 'text', content: aiReply });
    })().catch((err) => {
        pushEvent({
            type: 'error',
            content: buildErrorContent('E_SESSION_RUNTIME', err.message || '链式调用异常', 'background', true),
        });
    });

    return true;
});

/**
 * 解析快捷指令：格式为 "函数名:参数内容"
 * 例如 "baidu_search:机械键盘" → { funcName: 'baidu_search', arg: '机械键盘' }
 * 通过 MCP Client 获取可用工具列表进行验证
 */
async function parseShortcut(input: string): Promise<{ funcName: string; arg: string } | null> {
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

// ============ 工具函数 ============

/**
 * 显示 Chrome 桌面通知
 */
function showNotification(title: string, message: string, notificationId: string = `mole-ext-${Date.now()}`) {
    chrome.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: './logo.png',
        title: title,
        message: message,
    }).then(() => {
        _console.log(`[background] 通知已显示: ${title}`);
    }).catch((error: any) => {
        _console.error('[background] 显示通知失败:', error);
    });
}

// ============ 常驻任务 AI 响应 ============

/**
 * 常驻任务 AI 响应桥接
 * 将检测结果喂给 AI 生成回复，不走完整 session 体系
 */
export async function runResidentAIResponse(
    job: { id: string; name: string; tabId: number; aiPromptTemplate: string },
    detectData: unknown,
): Promise<{ success: boolean; data?: any; error?: string }> {
    const resultText = typeof detectData === 'string'
        ? detectData
        : JSON.stringify(detectData, null, 2);

    const prompt = job.aiPromptTemplate.replace(/\{\{result\}\}/g, resultText);

    return new Promise((resolve) => {
        let reply = '';
        let resolved = false;

        const safeResolve = (result: { success: boolean; data?: any; error?: string }) => {
            if (resolved) return;
            resolved = true;
            resolve(result);
        };

        handleChat(
            prompt,
            (event) => {
                if (event.type === 'text') reply = event.content;
                if (event.type === 'done' || event.type === 'turn_completed') {
                    safeResolve({ success: true, data: { reply, prompt } });
                }
                if (event.type === 'error' || event.type === 'turn_aborted') {
                    safeResolve({ success: false, error: event.content || '常驻任务 AI 响应失败' });
                }
            },
            job.tabId,
            undefined,
            undefined,
            { maxRounds: 1, disallowTools: ['resident_runtime', 'spawn_subtask'] },
        ).catch((err: any) => {
            safeResolve({ success: false, error: err?.message || 'handleChat 异常' });
        });
    });
}

// 注入 AI 响应函数到常驻运行器（避免循环依赖）
injectAIResponseRunner(runResidentAIResponse);

// ============ 保持 Service Worker 活跃 ============

// 定期发送心跳，防止 Service Worker 被回收
setInterval(() => {
    Storage.get('heartbeat').then(() => {
        Storage.save('heartbeat', Date.now());
    });
}, 20 * 1000);
