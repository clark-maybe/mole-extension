/**
 * 极简 Agentic Loop
 *
 * 设计哲学：代码管机制和边界（保下限），模型管决策和策略（定上限）
 *
 * 核心循环：
 *   采样 → 有工具调用 → 执行 → 回写 → 继续采样
 *          无工具调用 → 结束
 *
 * 代码做的（机制 + 边界）：
 *   - 采样 → 执行 → 回写循环
 *   - 预算执行（轮数、调用数、上下文长度）
 *   - 死循环检测（相同签名重复 N 次）
 *   - 空响应重试
 *   - 上下文超长压缩
 *   - 子任务递归入口
 *
 * 代码不做的（交给模型）：
 *   - 意图分类 / 工具选择 / 任务拆分
 *   - 验证策略 / 何时停止 / 回复措辞
 */

import type {
  InputItem, OutputItem, OutputFunctionCallItem,
  ToolSchema, AIStreamEvent, ContentPart,
  MessageInputItem, FunctionCallInputItem, FunctionCallOutputItem,
} from './types';
import { ArtifactStore } from '../lib/artifact-store';
import { chatStream, chatComplete } from './llm-client';
import { compactContext, getTextContent, microCompact, estimateContextTokens, stripImagesFromContent } from './context-manager';
import { executeToolCalls, getSubagentSchemas, isSubagent, resetSensitiveAccessTrust } from './tool-executor';
import type { SubagentRunner } from './tool-executor';
import { buildSystemPrompt, buildSubtaskPrompt, buildExplorePrompt } from './system-prompt';
import { ensureToolRegistryReady, mcpClient } from '../functions/registry';
import { mcpToolsToSchema } from '../mcp/adapters';
import { buildSiteWorkflowSchema } from '../functions/site-workflow';
import { buildSkillContext } from '../functions/skill';
import type { SkillGuideEntry, SkillCatalogEntry } from '../functions/skill';
import { TodoManager } from './todo-manager';
import type { TodoSnapshot } from './todo-manager';
import { createTodoFunction } from '../functions/todo';

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
  meta?: Record<string, any>;
}

/** 等待外部回包请求（保持向后兼容） */
export interface PendingTurnResponseRequest {
  requestId?: string;
  kind?: string;
  itemId?: string;
  callId?: string;
  name?: string;
  args?: Record<string, any>;
  timeoutMs?: number;
  availableDecisions?: string[];
  questions?: any[];
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

// ============ 默认配置 ============

const DEFAULT_BUDGET: LoopBudget = {
  maxRounds: 120,
  maxToolCalls: 300,
  maxSameSignature: 5,
  maxContextItems: 300,
  maxSubtaskDepth: 2,
};

const MAX_EMPTY_RETRIES = 2;

/** 每次任务最多注入的截图图片数量（防止上下文膨胀） */
const MAX_IMAGE_INJECTIONS = 3;

/** auto_compact 触发阈值（估算 token 数） */
const AUTO_COMPACT_TOKEN_THRESHOLD = 50000;

/** auto_compact 摘要后保留的尾部条目比例 */
const AUTO_COMPACT_KEEP_TAIL_RATIO = 0.25;

/** compact 工具 Schema（在 orchestrator 层拦截，不注册 MCP） */
const COMPACT_SCHEMA: ToolSchema = {
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
const AUTO_COMPACT_SUMMARY_INSTRUCTION = `请总结以下 AI 助手的工作进展，用紧凑的结构化格式输出：

1. 用户原始请求
2. 已完成的主要步骤和关键发现
3. 当前任务进度
4. 需要记住的关键数据（element_id、tab_id、URL、表单字段等）
5. 尚未完成的待办事项

只输出摘要，不要解释。中文。`;

/** explore 探索子 agent 允许使用的只读工具白名单 */
const EXPLORE_ALLOWED_TOOLS: ReadonlySet<string> = new Set([
  'page_skeleton',
  'page_snapshot',
  'page_viewer',
  'screenshot',
  'tab_navigate',
  'extract_data',
  'fetch_url',
  'selection_context',
  'skill',
]);

/** 子 agent 循环配置（决定 agenticLoop 的行为） */
interface SubagentLoopConfig {
  /** 系统提示词构建函数 */
  buildPrompt: () => string;
  /** 工具过滤器（返回 true 保留，不提供则使用全部工具去掉子 agent） */
  toolFilter?: (toolName: string) => boolean;
  /** 预算覆盖 */
  budget: Partial<LoopBudget>;
}

/** 子 agent 循环配置注册表 */
const SUBAGENT_LOOP_CONFIGS: Record<string, SubagentLoopConfig> = {
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
};

// ============ 辅助函数 ============

/** 稳定序列化用于签名对比 */
const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
};

/** 构建工具调用签名（用于死循环检测） */
const buildSignature = (fc: OutputFunctionCallItem): string => {
  try {
    return `${fc.name}:${stableStringify(JSON.parse(fc.arguments || '{}'))}`;
  } catch {
    return `${fc.name}:${(fc.arguments || '').trim()}`;
  }
};

/** 从流式响应中收集完整输出 */
const collectStreamResponse = async (
  input: InputItem[],
  tools: ToolSchema[],
  systemPrompt: string,
  signal: AbortSignal | undefined,
  emit: (event: AIStreamEvent) => void,
): Promise<{
  fullText: string;
  functionCalls: OutputFunctionCallItem[];
  outputItems: OutputItem[];
}> => {
  let fullText = '';
  const outputItems: OutputItem[] = [];
  const functionCalls: OutputFunctionCallItem[] = [];

  for await (const chunk of chatStream(input, tools.length > 0 ? tools : undefined, systemPrompt, signal)) {
    if (signal?.aborted) throw new Error('ABORTED');

    if (chunk.delta) {
      fullText += chunk.delta;
      emit({ type: 'text', content: fullText });
    }
    if (chunk.outputItem) {
      outputItems.push(chunk.outputItem);
      if (chunk.outputItem.type === 'function_call') {
        functionCalls.push(chunk.outputItem);
      }
    }
    if (chunk.done) break;
  }

  // 备用提取：如果流式 delta 没有文本但 outputItems 有 message
  if (!fullText.trim()) {
    for (const item of outputItems) {
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c.type === 'output_text' && c.text) {
            fullText += c.text;
          }
        }
      }
    }
    if (fullText.trim()) {
      emit({ type: 'text', content: fullText });
    }
  }

  return { fullText, functionCalls, outputItems };
};

/**
 * 检测工具执行结果中的截图，将图片 base64 注入 LLM 上下文
 * 让 AI 能"看到"截图内容，用于视觉理解场景
 */
const injectScreenshotImages = async (
  functionCalls: OutputFunctionCallItem[],
  results: InputItem[],
  context: InputItem[],
  imageInjectionCount: number,
): Promise<number> => {
  if (imageInjectionCount >= MAX_IMAGE_INJECTIONS) return imageInjectionCount;

  for (const fc of functionCalls) {
    if (fc.name !== 'screenshot' || imageInjectionCount >= MAX_IMAGE_INJECTIONS) continue;

    // 从结果中找到对应的 function_call_output
    const resultItem = results.find(
      r => 'type' in r && r.type === 'function_call_output' && 'call_id' in r && r.call_id === fc.call_id,
    );
    if (!resultItem || !('output' in resultItem)) continue;

    try {
      const parsed = JSON.parse((resultItem as { output: string }).output);
      if (!parsed?.success || !parsed?.data?.artifact_id) continue;

      const artifact = await ArtifactStore.getScreenshot(parsed.data.artifact_id);
      if (!artifact?.dataUrl) continue;

      // 构造多模态 user message 追加到 context
      const content: ContentPart[] = [
        { type: 'input_text' as const, text: `截图内容（${parsed.data.mode || '可见区域'}）：` },
        { type: 'input_image' as const, image_url: artifact.dataUrl },
      ];
      context.push({ role: 'user' as const, content });
      imageInjectionCount++;
    } catch {
      // 解析失败跳过，不影响主流程
    }
  }

  return imageInjectionCount;
};

/** 注入待处理的用户输入 */
const injectPendingInputs = async (
  context: InputItem[],
  consumeFn?: () => Promise<string[] | undefined> | string[] | undefined,
): Promise<number> => {
  if (!consumeFn) return 0;
  try {
    const pending = await consumeFn();
    if (!pending || pending.length === 0) return 0;
    for (const content of pending) {
      if (content && content.trim()) {
        context.push({ role: 'user' as const, content });
      }
    }
    return pending.length;
  } catch {
    return 0;
  }
};

/** 发送检查点 */
const emitCheckpoint = (
  options: HandleChatOptions | undefined,
  phase: string,
  round: number,
  summary: string,
  context: InputItem[],
  todoSnapshot?: TodoSnapshot,
) => {
  if (!options?.onCheckpoint) return;
  options.onCheckpoint({
    phase,
    round,
    summary,
    contextSnapshot: context,
    updatedAt: Date.now(),
    meta: todoSnapshot ? { todoSnapshot } : undefined,
  });
};

/**
 * 将上下文转为可读文本（供 auto_compact LLM 摘要使用）
 */
const contextToReadableText = (context: InputItem[]): string => {
  const parts: string[] = [];
  for (const item of context) {
    if ('role' in item && 'content' in item) {
      const msg = item as MessageInputItem;
      const text = getTextContent(msg.content);
      if (text.trim()) {
        parts.push(`[${msg.role}] ${text}`);
      }
    } else if ('type' in item && item.type === 'function_call') {
      const fc = item as FunctionCallInputItem;
      parts.push(`[tool_call] ${fc.name}(${fc.arguments})`);
    } else if ('type' in item && item.type === 'function_call_output') {
      const fco = item as FunctionCallOutputItem;
      // 截断过长的工具输出避免摘要 prompt 自身过长
      const output = fco.output.length > 500 ? fco.output.slice(0, 500) + '...' : fco.output;
      parts.push(`[tool_result] ${output}`);
    }
  }
  return parts.join('\n');
};

/**
 * 执行 auto_compact（LLM 智能摘要压缩）
 *
 * 策略：
 * 1. 将当前 context 转为可读文本
 * 2. 用 chatComplete 调用 LLM 生成摘要
 * 3. 替换上下文为：首条用户消息 + LLM 摘要 + 最近 25% 条目
 * 4. 图片降级为文字
 *
 * @returns 摘要文本（成功时），null（失败时降级到 compactContext）
 */
const performAutoCompact = async (
  context: InputItem[],
  emit: (event: AIStreamEvent) => void,
  signal: AbortSignal | undefined,
  todoStatusText?: string,
): Promise<{ summary: string; before: number; after: number } | null> => {
  const beforeSize = context.length;

  try {
    // 将上下文转为可读文本
    const readableText = contextToReadableText(context);

    // 用 chatComplete 生成摘要
    const summaryInput: InputItem[] = [
      { role: 'user' as const, content: readableText },
    ];
    const result = await chatComplete(summaryInput, undefined, AUTO_COMPACT_SUMMARY_INSTRUCTION, signal);

    // 从 LLM 输出中提取摘要文本
    let summaryText = '';
    for (const outputItem of result.output) {
      if (outputItem.type === 'message' && Array.isArray(outputItem.content)) {
        for (const c of outputItem.content) {
          if (c.type === 'output_text' && c.text) {
            summaryText += c.text;
          }
        }
      }
    }

    if (!summaryText.trim()) {
      return null; // 摘要为空，降级
    }

    // 找到第一条用户消息
    const firstUserIndex = context.findIndex(
      item => 'role' in item && item.role === 'user',
    );
    const firstUserMessage = firstUserIndex >= 0 ? context[firstUserIndex] : null;

    // 计算保留的尾部条目数
    const keepTail = Math.max(Math.floor(context.length * AUTO_COMPACT_KEEP_TAIL_RATIO), 1);
    const tail = context.slice(context.length - keepTail);

    // 图片降级
    if (firstUserMessage && 'content' in firstUserMessage && Array.isArray((firstUserMessage as MessageInputItem).content)) {
      (firstUserMessage as MessageInputItem).content = stripImagesFromContent(
        (firstUserMessage as MessageInputItem).content,
      );
    }
    for (const item of tail) {
      if ('role' in item && 'content' in item) {
        const msg = item as MessageInputItem;
        if (Array.isArray(msg.content)) {
          msg.content = stripImagesFromContent(msg.content);
        }
      }
    }

    // 构建摘要条目（附带 todo 状态）
    let fullSummary = `[context-compacted]\n${summaryText}`;
    if (todoStatusText) {
      fullSummary += `\n\n当前任务计划：\n${todoStatusText}`;
    }

    const summaryItem: InputItem = {
      role: 'assistant' as const,
      content: fullSummary,
    };

    // 替换上下文
    context.splice(0, context.length);
    if (firstUserMessage) {
      context.push(firstUserMessage);
    }
    context.push(summaryItem, ...tail);

    const afterSize = context.length;

    emit({
      type: 'context_compacted',
      content: JSON.stringify({ before: beforeSize, after: afterSize, method: 'auto_compact' }),
    });

    return { summary: summaryText, before: beforeSize, after: afterSize };
  } catch {
    // LLM 摘要调用失败，返回 null 让调用方降级
    return null;
  }
};

// ============ 核心循环 ============

/**
 * 核心 Agentic Loop（内部实现）
 */
const agenticLoop = async (
  context: InputItem[],
  tools: ToolSchema[],
  systemPrompt: string,
  budget: LoopBudget,
  tabId: number | undefined,
  signal: AbortSignal | undefined,
  emit: (event: AIStreamEvent) => void,
  options?: HandleChatOptions,
  depth: number = 0,
  todoManager?: TodoManager,
  todoFn?: ReturnType<typeof createTodoFunction>,
): Promise<InputItem[]> => {
  let round = 0;
  let totalToolCalls = 0;
  let emptyRetries = 0;
  let imageInjectionCount = 0;
  const signatureCount = new Map<string, number>();
  let roundsSinceTodoOp = 0;

  emit({ type: 'thinking', content: 'AI 正在思考...' });
  emitCheckpoint(options, 'act', 0, '开始处理', context);

  while (round < budget.maxRounds) {
    if (signal?.aborted) {
      emit({ type: 'error', content: JSON.stringify({ code: 'E_CANCELLED', message: '任务已取消' }) });
      return context;
    }

    // ── 边界：三层上下文压缩 ──

    // Layer 1: micro_compact — 每轮静默清理旧工具结果
    const microCompacted = microCompact(context);
    if (microCompacted > 0) {
      emit({
        type: 'context_compacted',
        content: JSON.stringify({ method: 'micro_compact', compressed: microCompacted }),
      });
    }

    // Layer 2: auto_compact — token 阈值触发 LLM 智能摘要
    const estimatedTokens = estimateContextTokens(context);
    if (estimatedTokens > AUTO_COMPACT_TOKEN_THRESHOLD) {
      const todoText = todoManager?.active ? todoManager.toStatusText() : undefined;
      const autoResult = await performAutoCompact(context, emit, signal, todoText);
      if (!autoResult) {
        // LLM 摘要失败，降级到现有 compactContext 兜底
        compactContext(context, budget.maxContextItems, emit, todoText);
      }
    } else {
      // token 未超阈值，仍保留原有 compactContext 作为条目数兜底
      const todoText = todoManager?.active ? todoManager.toStatusText() : undefined;
      compactContext(context, budget.maxContextItems, emit, todoText);
    }

    // ── 机制：注入待处理的用户输入 ──
    await injectPendingInputs(context, options?.consumePendingUserInputs);

    // ── 机制：调用 LLM ──
    round++;
    emitCheckpoint(options, 'act', round, `第 ${round} 轮`, context);

    let fullText: string;
    let functionCalls: OutputFunctionCallItem[];
    let outputItems: OutputItem[];

    try {
      const response = await collectStreamResponse(context, tools, systemPrompt, signal, emit);
      fullText = response.fullText;
      functionCalls = response.functionCalls;
      outputItems = response.outputItems;
    } catch (err: any) {
      if (err?.name === 'AbortError' || signal?.aborted || err?.message === 'ABORTED') {
        emit({ type: 'error', content: JSON.stringify({ code: 'E_CANCELLED', message: '任务已取消' }) });
        return context;
      }
      emit({ type: 'error', content: JSON.stringify({ code: 'E_LLM_API', message: err?.message || 'LLM 调用失败' }) });
      return context;
    }

    // 写入上下文
    for (const item of outputItems) {
      context.push(item as InputItem);
    }

    // ── 路径 A：模型调用了工具 ──
    if (functionCalls.length > 0) {
      emptyRetries = 0;

      // ── 边界：死循环检测 ──
      for (const fc of functionCalls) {
        const sig = buildSignature(fc);
        const count = (signatureCount.get(sig) || 0) + 1;
        signatureCount.set(sig, count);
        if (count >= budget.maxSameSignature) {
          context.push({
            role: 'user' as const,
            content: `你已经用完全相同的参数调用 ${fc.name} ${count} 次了，结果不会改变。请换一种方法，或者基于已有结果给出回答。`,
          });
        }
      }

      // ── 边界：总调用数检查 ──
      totalToolCalls += functionCalls.length;
      if (totalToolCalls >= budget.maxToolCalls) {
        // 执行当前这批工具调用，然后强制收口
        const results = await executeToolCalls(functionCalls, tabId, signal, emit);
        for (const r of results) context.push(r);

        // 注入截图图片到上下文（视觉理解）
        imageInjectionCount = await injectScreenshotImages(functionCalls, results, context, imageInjectionCount);

        context.push({
          role: 'user' as const,
          content: '本次处理已经进行了很多步骤。请基于当前已有的信息，总结你已经完成的内容和当前进展，直接给出最终回答。不要提及"轮数""工具限制"等内部概念。',
        });
        // 不带工具再给模型一次机会
        try {
          const finalResponse = await collectStreamResponse(context, [], systemPrompt, signal, emit);
          for (const item of finalResponse.outputItems) context.push(item as InputItem);
        } catch { /* 忽略，已经有足够上下文 */ }
        break;
      }

      // ── 机制：构建子 agent runners ──
      const subagentRunners: Record<string, SubagentRunner> = {};
      for (const [name, config] of Object.entries(SUBAGENT_LOOP_CONFIGS)) {
        // 检查递归深度限制
        // - 未指定 maxSubtaskDepth 的子 agent（如 spawn_subtask）：继承父预算的 depth 限制
        // - maxSubtaskDepth === 0 的子 agent（如 explore）：始终可用，但其内部不会再产生子 agent
        const configDepth = config.budget.maxSubtaskDepth;
        if (configDepth === undefined || configDepth > 0) {
          // 继承父预算深度限制
          const effectiveDepth = configDepth ?? budget.maxSubtaskDepth;
          if (depth >= effectiveDepth) continue;
        }
        // configDepth === 0：始终创建 runner（不受 depth 限制）

        subagentRunners[name] = (goal: string, runnerSignal?: AbortSignal) => {
          const subContext: InputItem[] = [{ role: 'user' as const, content: goal }];
          const subTools = config.toolFilter
            ? tools.filter(t => config.toolFilter!(t.name))
            : tools.filter(t => !isSubagent(t.name));
          // 预算合并：config.budget 中的数值字段使用 Math.min 取较小值（保持与重构前一致的行为）
          const mergedBudget: Partial<LoopBudget> = {};
          for (const [key, value] of Object.entries(config.budget)) {
            const budgetKey = key as keyof LoopBudget;
            mergedBudget[budgetKey] = Math.min(budget[budgetKey], value as number);
          }
          const subBudget: LoopBudget = { ...budget, ...mergedBudget };
          return agenticLoop(
            subContext, subTools, config.buildPrompt(), subBudget,
            tabId, runnerSignal || signal, emit, undefined, depth + 1,
          );
        };
      }

      // ── 机制：拦截 todo / compact 调用，本地执行 ──
      const regularCalls: OutputFunctionCallItem[] = [];
      if (todoManager && todoFn) {
        for (const fc of functionCalls) {
          if (fc.name === 'todo') {
            // 本地执行 todo 工具
            let todoOutput: string;
            try {
              const params = JSON.parse(fc.arguments || '{}');
              const validationError = todoFn.validate?.(params) ?? null;
              if (validationError) {
                todoOutput = JSON.stringify({ success: false, error: validationError });
              } else {
                const result = await todoFn.execute(params);
                todoOutput = JSON.stringify(result);
              }
            } catch (err: any) {
              todoOutput = JSON.stringify({ success: false, error: err?.message || 'todo 执行异常' });
            }

            context.push({ type: 'function_call_output' as const, call_id: fc.call_id, output: todoOutput });
            roundsSinceTodoOp = 0;

            // emit 事件（UI 展示）
            const todoSuccess = !todoOutput.includes('"success":false');
            emit({ type: 'function_call', content: JSON.stringify({ name: 'todo', callId: fc.call_id, arguments: fc.arguments }) });
            emit({ type: 'function_result', content: JSON.stringify({ name: 'todo', callId: fc.call_id, success: todoSuccess, message: '', cancelled: false }) });
            // emit todo 状态更新事件（供悬浮球渲染独立进度视图）
            if (todoManager.active) {
              emit({ type: 'todo_update', content: JSON.stringify({ items: todoManager.all, stats: todoManager.stats }) });
            }
          } else if (fc.name === 'compact') {
            // Layer 3: compact 工具 — 模型主动触发压缩
            emit({ type: 'function_call', content: JSON.stringify({ name: 'compact', callId: fc.call_id, arguments: fc.arguments }) });

            const beforeSize = context.length;
            const compactTodoText = todoManager?.active ? todoManager.toStatusText() : undefined;
            const compactResult = await performAutoCompact(context, emit, signal, compactTodoText);

            let compactOutput: string;
            if (compactResult) {
              compactOutput = JSON.stringify({
                success: true,
                data: {
                  before: compactResult.before,
                  after: compactResult.after,
                  summary: compactResult.summary.slice(0, 200),
                },
              });
            } else {
              // LLM 摘要失败，降级到 compactContext
              const fallbackResult = compactContext(context, Math.floor(context.length * 0.5), emit, compactTodoText);
              compactOutput = JSON.stringify({
                success: true,
                data: {
                  before: beforeSize,
                  after: context.length,
                  summary: fallbackResult ? '已通过规则压缩' : '上下文无需压缩',
                },
              });
            }

            context.push({ type: 'function_call_output' as const, call_id: fc.call_id, output: compactOutput });
            emit({ type: 'function_result', content: JSON.stringify({ name: 'compact', callId: fc.call_id, success: true, message: '', cancelled: false }) });
          } else {
            regularCalls.push(fc);
          }
        }
      } else {
        // 无 todoManager 时仍需拦截 compact
        for (const fc of functionCalls) {
          if (fc.name === 'compact') {
            emit({ type: 'function_call', content: JSON.stringify({ name: 'compact', callId: fc.call_id, arguments: fc.arguments }) });

            const beforeSize = context.length;
            const compactTodoText = todoManager?.active ? todoManager.toStatusText() : undefined;
            const compactResult = await performAutoCompact(context, emit, signal, compactTodoText);

            let compactOutput: string;
            if (compactResult) {
              compactOutput = JSON.stringify({
                success: true,
                data: {
                  before: compactResult.before,
                  after: compactResult.after,
                  summary: compactResult.summary.slice(0, 200),
                },
              });
            } else {
              const fallbackResult = compactContext(context, Math.floor(context.length * 0.5), emit, compactTodoText);
              compactOutput = JSON.stringify({
                success: true,
                data: {
                  before: beforeSize,
                  after: context.length,
                  summary: fallbackResult ? '已通过规则压缩' : '上下文无需压缩',
                },
              });
            }

            context.push({ type: 'function_call_output' as const, call_id: fc.call_id, output: compactOutput });
            emit({ type: 'function_result', content: JSON.stringify({ name: 'compact', callId: fc.call_id, success: true, message: '', cancelled: false }) });
          } else {
            regularCalls.push(fc);
          }
        }
      }

      // 执行剩余常规工具
      if (regularCalls.length > 0) {
        const results = await executeToolCalls(regularCalls, tabId, signal, emit, subagentRunners);
        for (const r of results) context.push(r);

        // 注入截图图片到上下文（视觉理解）
        imageInjectionCount = await injectScreenshotImages(regularCalls, results, context, imageInjectionCount);
      }

      // ── 机制：Todo 进度提醒 ──
      if (todoManager) {
        roundsSinceTodoOp++;
        if (todoManager.active) {
          const reminderInterval = todoManager.current ? 4 : 2;
          if (roundsSinceTodoOp >= reminderInterval) {
            context.push({
              role: 'user' as const,
              content: `<todo-reminder>\n${todoManager.toStatusText()}\n</todo-reminder>`,
            });
            roundsSinceTodoOp = 0;
          }
        } else if (round >= 6 && roundsSinceTodoOp >= 6) {
          context.push({
            role: 'user' as const,
            content: '<todo-reminder>当前任务已执行多步，建议用 todo(action=\'create\') 制定剩余计划。</todo-reminder>',
          });
          roundsSinceTodoOp = 0;
        }
      }

      const todoSnap = todoManager?.active ? todoManager.toSnapshot() : undefined;
      emitCheckpoint(options, 'act', round, `工具执行完毕（共 ${totalToolCalls} 次调用）`, context, todoSnap);
      continue;
    }

    // ── 路径 B：模型没有调用工具（想结束）──

    // ── 边界：空响应重试 ──
    if (!fullText.trim()) {
      emptyRetries++;
      if (emptyRetries <= MAX_EMPTY_RETRIES) {
        // 移除最后一条空的 assistant 输出
        if (context.length > 0) {
          const last = context[context.length - 1];
          const isEmptyAssistant = 'role' in last && last.role === 'assistant';
          const isOutputMessage = 'type' in last && (last as unknown as { type: string }).type === 'message';
          if (isEmptyAssistant || isOutputMessage) {
            context.pop();
          }
        }
        context.push({
          role: 'user' as const,
          content: '你的回复是空的。请给出回答，或者继续调用工具。',
        });
        continue;
      }
      emit({ type: 'error', content: JSON.stringify({ code: 'E_LLM_API', message: '模型连续返回空响应' }) });
      break;
    }

    // 模型给出了非空文本回复 → 循环自然结束
    emitCheckpoint(options, 'finalize', round, '任务完成', context, todoManager?.active ? todoManager.toSnapshot() : undefined);
    break;
  }

  // ── 边界：轮数耗尽 ──
  if (round >= budget.maxRounds) {
    const lastItem = context[context.length - 1];
    const hasReply = 'role' in lastItem && lastItem.role === 'assistant' &&
                     'content' in lastItem && getTextContent(lastItem.content).trim();
    if (!hasReply) {
      context.push({
        role: 'user' as const,
        content: '本次处理已经进行了很多步骤。请基于当前已有的信息，总结你已经完成的内容和当前进展，直接给出最终回答。不要提及"轮数""工具限制"等内部概念。',
      });
      try {
        const finalResponse = await collectStreamResponse(context, [], systemPrompt, signal, emit);
        for (const item of finalResponse.outputItems) context.push(item as InputItem);
      } catch { /* 忽略 */ }
    }
    emitCheckpoint(options, 'finalize', round, '达到轮数上限', context, todoManager?.active ? todoManager.toSnapshot() : undefined);
  }

  return context;
};

// ============ 对外接口 ============

/**
 * AI 对话入口（与 background.ts 对接）
 *
 * 签名保持向后兼容
 */
export const handleChat = async (
  query: string,
  onEvent: (event: AIStreamEvent) => void,
  tabId?: number,
  signal?: AbortSignal,
  previousContext?: InputItem[],
  options?: HandleChatOptions,
): Promise<InputItem[]> => {
  // 新对话开始时重置敏感操作信任标记
  resetSensitiveAccessTrust();

  const budget: LoopBudget = {
    ...DEFAULT_BUDGET,
    ...(options?.maxRounds != null ? { maxRounds: options.maxRounds } : {}),
    ...(options?.maxToolCalls != null ? { maxToolCalls: options.maxToolCalls } : {}),
    ...(options?.maxSameToolCalls != null ? { maxSameSignature: options.maxSameToolCalls } : {}),
    ...(options?.maxInputItems != null ? { maxContextItems: options.maxInputItems } : {}),
  };

  // 准备工具
  await ensureToolRegistryReady();
  const mcpTools = await mcpClient.listTools();
  let tools = mcpToolsToSchema(mcpTools);

  // 过滤被禁用的工具
  if (options?.disallowTools && options.disallowTools.length > 0) {
    const disallowed = new Set(options.disallowTools);
    tools = tools.filter(t => !disallowed.has(t.name));
  }

  // 动态注入 skill（根据当前 tab URL 匹配可用 Skill + workflow）
  let domainGuides: SkillGuideEntry[] = [];
  let globalCatalog: SkillCatalogEntry[] = [];
  try {
    let tabUrl = '';
    if (typeof chrome !== 'undefined' && chrome.tabs && tabId && Number.isFinite(tabId)) {
      const tab = await chrome.tabs.get(tabId);
      tabUrl = tab?.url || '';
    }

    const skillContext = await buildSkillContext(tabUrl);
    domainGuides = skillContext.domainGuides;
    globalCatalog = skillContext.globalCatalog;

    if (skillContext.schema) {
      // 替换静态的 skill schema 为动态版本
      tools = tools.filter(t => t.name !== 'skill');
      tools.push(skillContext.schema);
    }

    // 向后兼容：如果旧代码仍使用 site_workflow，也尝试注入
    if (tabUrl) {
      const siteWorkflowSchema = await buildSiteWorkflowSchema(tabUrl);
      if (siteWorkflowSchema) {
        tools = tools.filter(t => t.name !== 'site_workflow');
        tools.push(siteWorkflowSchema);
      }
    }
  } catch {
    // skill 注入失败不影响正常工具链
  }

  // 注入子 agent 工具（只有顶层才有）
  tools.push(...getSubagentSchemas());

  // ── 任务规划追踪 ──
  const todoManager = options?.resumeTodoSnapshot
    ? TodoManager.fromSnapshot(options.resumeTodoSnapshot)
    : new TodoManager();
  const todoFn = createTodoFunction(() => todoManager);
  tools.push({
    type: 'function' as const,
    name: todoFn.name,
    description: todoFn.description,
    parameters: todoFn.parameters,
  });

  // 注入 compact 上下文压缩工具
  tools.push(COMPACT_SCHEMA);

  // 构建系统提示词（域级 guide 直接注入，全局只放目录）
  const systemPrompt = buildSystemPrompt(tools, true, domainGuides, globalCatalog);

  // 构建初始上下文
  const context: InputItem[] = previousContext ? [...previousContext] : [];
  const shouldAppendQuery = options?.appendUserQuery !== false;
  if (shouldAppendQuery && query.trim()) {
    context.push({ role: 'user' as const, content: query });
  }

  // 执行循环
  return agenticLoop(context, tools, systemPrompt, budget, tabId, signal, onEvent, options, 0, todoManager, todoFn);
};
