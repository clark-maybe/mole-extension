/**
 * session-types.ts
 * 会话管理的类型定义与常量
 * 从 session-manager.ts 提取
 */

// ============ 从外部模块重新导出的类型 ============

export type {
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
    SessionSyncPayload,
} from '../ai/types';

export type { HandleChatOptions } from '../ai/orchestrator';

export type {
    SessionAgentTransitionItem,
    SessionHistoryRecord,
    SessionToolCallChainItem,
} from '../session-history/types';

export { MAX_SESSION_HISTORY, SESSION_HISTORY_STORAGE_KEY } from '../session-history/constants';

// ============ 会话任务类型 ============

export type SessionTaskKind = 'regular' | 'review' | 'compact' | 'aux';
export type TurnAbortReason = 'replaced' | 'interrupted';

export interface RunningSessionTask {
    runId: string;
    sessionId: string;
    kind: SessionTaskKind;
    runner: SessionTaskRunner;
    controller: AbortController;
    createdAt: number;
    done: Promise<void>;
    markDone: () => void;
}

export interface SessionTaskRunContext {
    session: import('../ai/types').Session;
    runId: string;
    taskKind: SessionTaskKind;
    normalizedQuery: string;
    tabId: number | undefined;
    signal: AbortSignal;
    options: ExecuteSessionOptions | undefined;
    pushEvent: (event: import('../ai/types').AIStreamEvent) => void;
}

export interface SessionTaskAbortContext {
    session: import('../ai/types').Session;
    reason: TurnAbortReason;
    message: string;
    failureCode: import('../ai/types').SessionFailureCode;
    task: RunningSessionTask;
}

export interface SessionTaskStartContext {
    session: import('../ai/types').Session;
    pushEvent: (event: import('../ai/types').AIStreamEvent) => void;
    taskKind: SessionTaskKind;
    query: string;
    runId: string;
}

export interface SessionTaskFinishContext {
    session: import('../ai/types').Session;
    pushEvent: (event: import('../ai/types').AIStreamEvent) => void;
    taskKind: SessionTaskKind;
    status: import('../ai/types').SessionStatus;
    runId: string;
}

export interface SessionTaskRunner {
    kind: SessionTaskKind;
    emitTurnStarted?: boolean;
    run: (ctx: SessionTaskRunContext) => Promise<void>;
    start?: (ctx: SessionTaskStartContext) => Promise<void> | void;
    finish?: (ctx: SessionTaskFinishContext) => Promise<void> | void;
    abort?: (ctx: SessionTaskAbortContext) => Promise<void> | void;
}

export interface ActiveTurnRuntime {
    tasks: Map<string, RunningSessionTask>;
}

export type RuntimeResourceKind = 'timer';

export interface RuntimeResourceEntry {
    key: string;
    kind: RuntimeResourceKind;
    resourceId: string;
    sessionId: string;
    runId: string | null;
    createdAt: number;
}

// ============ 操作类型（Op） ============

export interface ExecuteSessionOptions {
    disallowTools?: string[];
    maxRounds?: number;
    maxToolCalls?: number;
    maxSameToolCalls?: number;
    coalesceKey?: string;
    appendUserQuery?: boolean;
    suppressNextStepHint?: boolean;
    taskKind?: SessionTaskKind;
}

export type SessionChannelResponder = ((response?: unknown) => void) | undefined;
export type SessionTaskKindRequest = SessionTaskKind | string | undefined;

export interface SessionCreateOp {
    type: 'create';
    label: string;
    query: string;
    requestedTaskKind: SessionTaskKindRequest;
    taskOptions: Partial<ExecuteSessionOptions>;
    tabId: number | undefined;
    sendResponse: SessionChannelResponder;
}

export interface SessionContinueOp {
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

export interface SessionRollbackOp {
    type: 'rollback';
    label: string;
    sessionId: string;
    turns: number;
    source: 'rollback' | 'undo';
    sendResponse: SessionChannelResponder;
}

export interface SessionClearOp {
    type: 'clear';
    label: string;
    sessionId: string;
}

export interface SessionCancelOp {
    type: 'cancel';
    label: string;
    sessionId: string;
}

export interface SessionGetActiveOp {
    type: 'get_active';
    label: string;
    senderTabId: number | undefined;
    sendResponse: SessionChannelResponder;
}

export interface SessionReplayRequestOp {
    type: 'replay_request';
    label: string;
    sessionId: string | null;
    scopeRaw: string;
    fromEventCountRaw: unknown;
    senderTabId: number | undefined;
    sendResponse: SessionChannelResponder;
}

export interface SessionResumeOp {
    type: 'resume';
    label: string;
    sessionId: string;
    tabId: number | undefined;
    sendResponse: SessionChannelResponder;
}

export type SessionOp =
    | SessionCreateOp
    | SessionContinueOp
    | SessionRollbackOp
    | SessionClearOp
    | SessionCancelOp
    | SessionGetActiveOp
    | SessionReplayRequestOp
    | SessionResumeOp;

// ============ 常量 ============

/** 会话容量上限 */
export const MAX_SESSIONS = 10;
export const SESSION_RUNTIME_STORAGE_KEY = 'mole_session_runtime_v1';
export const MAX_RUNTIME_EVENT_LOG = 500;
export const MAX_RUNTIME_CONTEXT = 280;
export const MAX_MODEL_CONTEXT_ITEMS = 250;
export const COMPACT_USER_CONTEXT_LIMIT = 10;
export const COMPACT_USER_CONTEXT_CHAR_LIMIT = 6000;
export const SESSION_CONTEXT_COMPRESSION_TAG = '[mole-context-compressed]';
export const TURN_ABORTED_INTERRUPTED_GUIDANCE = '用户主动中断了上一轮任务；若部分工具已执行，请先核对当前状态再继续。';
export const DEFAULT_REVIEW_TASK_QUERY = '请审阅当前任务结果，指出关键问题并给出修复建议。';
export const DEFAULT_COMPACT_TASK_QUERY = '请压缩当前会话上下文，保留事实、结论和下一步。';
export const REVIEW_TASK_INSTRUCTIONS = [
    '你是一名严格且务实的代码审查助手。',
    '只基于提供的上下文给结论，不得编造未执行事实。',
    '输出结构：先给总体判断，再按"问题-影响-建议"分点列出。',
    '问题按风险从高到低排序，必要时注明优先级（P0/P1/P2）。',
    '语言面向普通用户，避免调度、轮次、状态机等内部术语。',
].join('\n');
export const COMPACT_TASK_INSTRUCTIONS = [
    '你是上下文压缩助手。',
    '只提炼已发生的事实：已完成动作、关键证据、当前结论、后续建议。',
    '删除重复描述，不新增推测信息，不编造未执行结果。',
    '输出简短明确，最多 8 行。',
].join('\n');
export const GRACEFUL_ABORT_TIMEOUT_MS = 120;

export const SESSION_SYNC_EVENT_TYPES = new Set<string>([
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
export const SESSION_IMMEDIATE_PERSIST_EVENT_TYPES = new Set<string>([
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
export const SESSION_PRE_EMIT_PERSIST_EVENT_TYPES = new Set<string>([
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
