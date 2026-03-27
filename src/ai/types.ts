/**
 * AI 模块类型定义
 * 适配 OpenAI Responses API 格式
 */

/** 多模态内容：纯文本 */
export interface InputTextContent {
  type: 'input_text';
  text: string;
}

/** 多模态内容：图片（base64 data URL） */
export interface InputImageContent {
  type: 'input_image';
  image_url: string;
}

/** 多模态内容联合类型 */
export type ContentPart = InputTextContent | InputImageContent;

/** 用户/助手消息输入项（content 支持纯文本或多模态数组） */
export interface MessageInputItem {
  role: 'user' | 'assistant';
  content: string | ContentPart[];
}

/** 函数调用输入项（来自模型响应，续传时包含） */
export interface FunctionCallInputItem {
  type: 'function_call';
  id: string;
  call_id: string;
  name: string;
  arguments: string;
}

/** 函数调用结果输入项 */
export interface FunctionCallOutputItem {
  type: 'function_call_output';
  call_id: string;
  output: string;
}

/** 输入项联合类型 */
export type InputItem = MessageInputItem | FunctionCallInputItem | FunctionCallOutputItem;

/** 模型输出的消息项 */
export interface OutputMessageItem {
  type: 'message';
  id: string;
  role: 'assistant';
  content: Array<{ type: 'output_text'; text: string }>;
}

/** 模型输出的函数调用项 */
export interface OutputFunctionCallItem {
  type: 'function_call';
  id: string;
  call_id: string;
  name: string;
  arguments: string;
}

/** 输出项联合类型 */
export type OutputItem = OutputMessageItem | OutputFunctionCallItem;

/** Responses API 工具 schema */
export interface ToolSchema {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, any>;
}

/** 流式响应块 */
export interface StreamChunk {
  /** 文本增量 */
  delta?: string;
  /** 完整的输出项（在 response.output_item.done 时发出，用于工具调用续传） */
  outputItem?: OutputItem;
  /** 是否完成 */
  done?: boolean;
}

/** 调度队列快照 */
export interface SessionOpQueueSnapshot {
  depth: number;
  peakDepth: number;
  runningLabel?: string;
  runningSince?: number;
  lastLabel?: string;
  lastLatencyMs?: number;
  updatedAt: number;
}

/** session_sync 负载 */
export interface SessionSyncPayload {
  sessionId: string;
  activeRunId: string | null;
  status: SessionStatus | 'cleared';
  summary?: string;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  agentState?: SessionAgentStateSnapshot;
  failureCode?: SessionFailureCode;
  lastError?: string;
  taskKind?: string;
  opQueue?: SessionOpQueueSnapshot;
  replayEventCount?: number;
  replayLastTimestamp?: number;
  /** 发起任务的标签页 ID（用于页签感知） */
  originTabId?: number;
  /** 会话是否有可恢复的上下文（用于重试按钮判断） */
  hasContext?: boolean;
}

/** 会话回放负载 */
export interface SessionReplayPayload {
  sessionId: string;
  scope: 'full' | 'latest_turn' | 'delta';
  events: SessionEventLogItem[];
  fromEventCount: number;
  eventCount: number;
  lastTimestamp: number;
}

/** AI 事件类型 */
export type AIStreamEventType =
  | 'thinking'
  | 'planning'
  | 'warning'
  | 'agent_state'
  | 'function_call'
  | 'function_result'
  | 'search_results'
  | 'screenshot_data'
  | 'page_assert_data'
  | 'page_repair_data'
  | 'text'
  | 'cards'
  | 'error'
  | 'turn_started'
  | 'turn_completed'
  | 'turn_aborted'
  | 'thread_rolled_back'
  | 'entered_review_mode'
  | 'exited_review_mode'
  | 'context_compacted'
  | 'turn_item_started'
  | 'turn_item_completed'
  | 'approval_request'
  | 'queue_updated'
  | 'todo_update'
  | 'phase_handoff'
  | 'review_started'
  | 'review_completed';

/** 从 background 推送到 content 的流式事件 */
export interface AIStreamEvent {
  type: AIStreamEventType;
  content: string;
}

/** 结构化错误事件负载（通过 AIStreamEvent.content 传输） */
export interface AIErrorPayload {
  code: SessionFailureCode;
  message: string;
  origin?: 'orchestrator' | 'background' | 'tool';
  retriable?: boolean;
}

/** AI 配置（不变） */
export interface AISettings {
  apiKey: string;
  endpoint: string;
  model: string;
  /** 是否开启结果一致性严格模式（行为与结论必须一致） */
  strictResultMode: boolean;
  /** 模型是否支持并行工具调用（未配置时按内置模型表自动判断，未知模型默认 false） */
  supportsParallelToolCalls?: boolean;
}

/** 工具选择策略（传给 API 的 tool_choice 参数） */
export type ToolChoice = 'auto' | 'required' | 'none' | { type: 'function'; name: string };

// ============ 会话管理类型 ============

/** 会话状态 */
export type SessionStatus = 'running' | 'done' | 'error';

/** 会话失败码（用于快速定位失败原因） */
export type SessionFailureCode =
  | 'E_AUTH_REQUIRED'
  | 'E_CANCELLED'
  | 'E_SUPERSEDED'
  | 'E_TURN_MISMATCH'
  | 'E_LLM_API'
  | 'E_PARAM_RESOLVE'
  | 'E_TOOL_EXEC'
  | 'E_NO_TOOL_EXEC'
  | 'E_SESSION_RUNTIME'
  | 'E_UNKNOWN';

/** 会话事件日志项 */
export interface SessionEventLogItem {
  type: string;
  content: string;
  timestamp?: number;
}

/** 会话级状态机快照 */
export interface SessionAgentStateSnapshot {
  phase: AgentPhase | 'idle';
  round: number;
  reason: string;
  updatedAt: number;
}


/** 集中管理的会话数据 */
export interface Session {
  /** 会话 ID（由 background 生成） */
  id: string;
  /** 会话状态 */
  status: SessionStatus;
  /** 完整 AI 上下文（工具调用链） */
  context: InputItem[];
  /** 事件流日志（供新标签页回放） */
  eventLog: SessionEventLogItem[];
  /** 创建时间戳 */
  createdAt: number;
  /** 当前轮次开始时间 */
  startedAt: number;
  /** 当前轮次结束时间（完成/失败时） */
  endedAt?: number;
  /** 当前轮次耗时（毫秒） */
  durationMs?: number;
  /** 首次查询文本作为摘要 */
  summary: string;
  /** 最近一次调度状态快照 */
  agentState: SessionAgentStateSnapshot;
  /** 最近一次失败码 */
  failureCode?: SessionFailureCode;
  /** 最近一次错误文案 */
  lastError?: string;
  /** 发起任务的标签页 ID（用于页签感知） */
  originTabId?: number;
}

/** 调度阶段 */
export type AgentPhase = 'plan' | 'act' | 'observe' | 'verify' | 'finalize';

/** 调度状态转移日志 */
export interface AgentStateTransition {
  from: AgentPhase | 'idle';
  to: AgentPhase;
  reason: string;
  round: number;
  timestamp: number;
  meta?: Record<string, any>;
}

/** review/compact 生命周期事件负载 */
export interface TaskLifecycleEventPayload {
  taskKind: string;
  phase: 'entered' | 'exited';
  status: SessionStatus;
  message: string;
  runId: string | null;
  timestamp: number;
  assistantReply?: string;
  compactSummary?: string;
  reviewOutput?: unknown;
  failureCode?: SessionFailureCode;
  reason?: string;
  beforeContextItems?: number;
  afterContextItems?: number;
  compressionStateBefore?: string[];
  compressionStateAfter?: string[];
}

/** turn 完成/中断生命周期事件负载 */
export interface TurnLifecycleEventPayload {
  sessionId?: string;
  runId: string | null;
  endedAt: number;
  durationMs: number;
  taskKind?: string;
  status: SessionStatus;
  failureCode?: SessionFailureCode;
  reason?: string;
  lastAgentMessage?: string;
  abortReason?: 'replaced' | 'interrupted';
}
