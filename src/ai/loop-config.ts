/**
 * Agentic Loop 配置、类型、常量
 *
 * 从 orchestrator.ts 提取的纯配置模块，不包含运行时逻辑
 */

import type { InputItem, ToolSchema, TodoSnapshot } from './types';
import { buildSubtaskPrompt, buildExplorePrompt, buildReviewPrompt, buildPlanPrompt } from './system-prompt';

// ============ 类型定义 ============

/** 循环预算 */
export interface LoopBudget {
  maxRounds: number;
  maxToolCalls: number;
  maxSameSignature: number;
  maxContextItems: number;
  maxSubtaskDepth: number;
}

/** 检查点（供 background.ts 持久化会话状态） */
export interface HandleChatCheckpoint {
  phase: string;
  round: number;
  summary: string;
  contextSnapshot?: InputItem[];
  updatedAt: number;
  meta?: Record<string, unknown>;
}

/** 等待外部回包请求（保持向后兼容） */
export interface PendingTurnResponseRequest {
  requestId?: string;
  kind?: string;
  itemId?: string;
  callId?: string;
  name?: string;
  args?: Record<string, unknown>;
  timeoutMs?: number;
  availableDecisions?: string[];
  questions?: unknown[];
}

/** handleChat 选项（保持向后兼容） */
export interface HandleChatOptions {
  /** 禁用指定工具 */
  disallowTools?: string[];
  /** 最大轮数 */
  maxRounds?: number;
  /** 最大工具调用次数 */
  maxToolCalls?: number;
  /** 相同工具+参数的最大重复次数 */
  maxSameToolCalls?: number;
  /** 是否追加用户 query 到 previousContext（默认 true） */
  appendUserQuery?: boolean;
  /** 检查点回调 */
  onCheckpoint?: (checkpoint: HandleChatCheckpoint) => void;
  /** 消费待处理的用户输入 */
  consumePendingUserInputs?: () => Promise<string[] | undefined> | string[] | undefined;
  /** 上下文条目上限 */
  maxInputItems?: number;
  /** 等待外部回包（保留接口，当前循环内不主动触发） */
  awaitTurnResponse?: (request: PendingTurnResponseRequest, signal?: AbortSignal) => Promise<unknown>;
  /** 抑制下一步建议（向后兼容，新架构不产生此类文案） */
  suppressNextStepHint?: boolean;
  /** 从断点恢复的 todo 快照 */
  resumeTodoSnapshot?: TodoSnapshot;
}

/** 阶段控制信号（phaseOrchestrator ↔ agenticLoop 通信） */
export interface PhaseControl {
  /** 由 phaseOrchestrator 提供：是否应该做交接而不是压缩 */
  shouldHandoff?: (estimatedTokens: number, round: number) => boolean;
  /** 由 agenticLoop 写入：true 表示因交接请求而退出 */
  handoffRequested?: boolean;
  /** Todo 完成回调，返回 true 表示应该触发交接 */
  onTodoCompleted?: () => boolean;
}

/** 交接工件（阶段间传递的结构化状态） */
export interface HandoffArtifact {
  /** 原始用户目标 */
  taskGoal: string;
  /** 当前阶段编号（从 0 开始） */
  phaseIndex: number;
  /** todo 快照（完整进度） */
  todoSnapshot: TodoSnapshot;
  /** 每个已完成 todo 的摘要 */
  completedSummaries: string[];
  /** 浏览器客观状态 */
  browserState: {
    tabs: Array<{ tabId: number; url: string; title: string }>;
    activeTabId: number;
    currentUrl: string;
  };
  /** 已收集的结构化数据 */
  collectedData: Record<string, unknown>;
  /** 执行过程中的关键发现 */
  observations: string[];
  /** 风险提示 */
  warnings: string[];
  /** 审查反馈（仅重试时存在） */
  reviewFeedback?: string;
}

/** 子 agent 循环配置（决定 agenticLoop 的行为） */
export interface SubagentLoopConfig {
  /** 系统提示词构建函数 */
  buildPrompt: () => string;
  /** 工具过滤器（返回 true 保留，不提供则使用全部工具去掉子 agent） */
  toolFilter?: (toolName: string) => boolean;
  /** 预算覆盖 */
  budget: Partial<LoopBudget>;
}

// ============ 默认配置 ============

export const DEFAULT_BUDGET: LoopBudget = {
  maxRounds: 120,
  maxToolCalls: 300,
  maxSameSignature: 5,
  maxContextItems: 300,
  maxSubtaskDepth: 2,
};

export const MAX_EMPTY_RETRIES = 2;

/** 每次任务最多注入的截图图片数量 */
export const MAX_IMAGE_INJECTIONS = 15;

/** auto_compact 触发阈值（估算 token 数） */
export const AUTO_COMPACT_TOKEN_THRESHOLD = 50000;

/** auto_compact 摘要后保留的尾部条目比例 */
export const AUTO_COMPACT_KEEP_TAIL_RATIO = 0.25;

/** compact 工具 Schema（在 orchestrator 层拦截，不注册 MCP） */
export const COMPACT_SCHEMA: ToolSchema = {
  type: 'function',
  name: 'compact',
  description: '压缩当前对话上下文，保留关键信息，释放空间。当你感觉上下文太长、重复信息太多、或需要为后续操作腾出空间时调用。',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

/** auto_compact 摘要系统提示词 */
export const AUTO_COMPACT_SUMMARY_INSTRUCTION = `请总结以下 AI 助手的工作进展，用紧凑的结构化格式输出：

1. 用户原始请求
2. 已完成的主要步骤和关键发现
3. 当前任务进度
4. 需要记住的关键数据（element_id、tab_id、URL、表单字段等）
5. 尚未完成的待办事项

只输出摘要，不要解释。中文。`;

/** explore 探索子 agent 允许使用的只读工具白名单 */
export const EXPLORE_ALLOWED_TOOLS: ReadonlySet<string> = new Set([
  'page',
  'screenshot',
  'tab_navigate',
  'extract_data',
  'fetch_url',
  'selection_context',
  'skill',
]);

/** review 审查子 agent 允许使用的只读工具白名单 */
export const REVIEW_ALLOWED_TOOLS: ReadonlySet<string> = new Set([
  'page',
  'screenshot',
  'tab_navigate',
  'extract_data',
]);

/** 子 agent 循环配置注册表 */
export const SUBAGENT_LOOP_CONFIGS: Record<string, SubagentLoopConfig> = {
  spawn_subtask: {
    buildPrompt: buildSubtaskPrompt,
    // 只过滤掉自身，保留 explore 等其他子 agent（与重构前行为一致）
    toolFilter: (name) => name !== 'spawn_subtask',
    budget: { maxRounds: 25 },
  },
  explore: {
    buildPrompt: buildExplorePrompt,
    toolFilter: (name) => EXPLORE_ALLOWED_TOOLS.has(name),
    budget: { maxRounds: 15, maxToolCalls: 30, maxSubtaskDepth: 0 },
  },
  plan: {
    buildPrompt: buildPlanPrompt,
    toolFilter: (name) => EXPLORE_ALLOWED_TOOLS.has(name),
    budget: { maxRounds: 15, maxToolCalls: 30, maxSubtaskDepth: 0 },
  },
  review: {
    buildPrompt: buildReviewPrompt,
    toolFilter: (name) => REVIEW_ALLOWED_TOOLS.has(name),
    budget: { maxRounds: 8, maxToolCalls: 15, maxSubtaskDepth: 0 },
  },
};

// ============ 阶段编排常量 ============

/** 阶段交接 token 阈值（低于 auto_compact 的 50000，确保在压缩前交接） */
export const HANDOFF_TOKEN_THRESHOLD = 40000;

/** 连续轮数强制交接阈值 */
export const FORCE_HANDOFF_ROUNDS = 20;

/** todo 完成数触发交接的阈值 */
export const TODO_COMPLETION_THRESHOLD = 2;

/** 审查失败最大重试次数 */
export const MAX_REVIEW_RETRIES = 1;

/** 最大阶段数 */
export const MAX_PHASES = 10;

/** 写入类工具名称集合（用于判断是否为纯只读任务） */
export const WRITE_TOOLS: ReadonlySet<string> = new Set([
  'cdp_input', 'cdp_dom', 'cdp_frame', 'save_workflow', 'data_pipeline',
]);
