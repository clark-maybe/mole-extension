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
  ToolSchema, AIStreamEvent,
} from './types';
import { chatStream } from './llm-client';
import { compactContext } from './context-manager';
import { executeToolCalls, SPAWN_SUBTASK_SCHEMA } from './tool-executor';
import { buildSystemPrompt, buildSubtaskPrompt } from './system-prompt';
import { ensureToolRegistryReady, mcpClient } from '../functions/registry';
import { mcpToolsToSchema } from '../mcp/adapters';
import { buildSiteWorkflowSchema } from '../functions/site-workflow';

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
}

// ============ 默认配置 ============

const DEFAULT_BUDGET: LoopBudget = {
  maxRounds: 30,
  maxToolCalls: 60,
  maxSameSignature: 3,
  maxContextItems: 200,
  maxSubtaskDepth: 2,
};

const MAX_EMPTY_RETRIES = 2;

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
) => {
  if (!options?.onCheckpoint) return;
  options.onCheckpoint({
    phase,
    round,
    summary,
    contextSnapshot: context,
    updatedAt: Date.now(),
  });
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
): Promise<InputItem[]> => {
  let round = 0;
  let totalToolCalls = 0;
  let emptyRetries = 0;
  const signatureCount = new Map<string, number>();

  emit({ type: 'thinking', content: 'AI 正在思考...' });
  emitCheckpoint(options, 'act', 0, '开始处理', context);

  while (round < budget.maxRounds) {
    if (signal?.aborted) {
      emit({ type: 'error', content: JSON.stringify({ code: 'E_CANCELLED', message: '任务已取消' }) });
      return context;
    }

    // ── 边界：上下文压缩 ──
    compactContext(context, budget.maxContextItems, emit);

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

        context.push({
          role: 'user' as const,
          content: '已达到工具调用次数上限。请基于当前已有的信息直接给出回答。',
        });
        // 不带工具再给模型一次机会
        try {
          const finalResponse = await collectStreamResponse(context, [], systemPrompt, signal, emit);
          for (const item of finalResponse.outputItems) context.push(item as InputItem);
        } catch { /* 忽略，已经有足够上下文 */ }
        break;
      }

      // ── 机制：执行工具 ──
      const subtaskRunner = depth < budget.maxSubtaskDepth
        ? (goal: string, subtaskSignal?: AbortSignal) => {
            const subContext: InputItem[] = [{ role: 'user' as const, content: goal }];
            const subTools = tools.filter(t => t.name !== 'spawn_subtask');
            const subBudget = { ...budget, maxRounds: Math.min(budget.maxRounds, 15), maxSubtaskDepth: budget.maxSubtaskDepth };
            return agenticLoop(
              subContext, subTools, buildSubtaskPrompt(), subBudget,
              tabId, subtaskSignal || signal, emit, undefined, depth + 1,
            );
          }
        : undefined;

      const results = await executeToolCalls(functionCalls, tabId, signal, emit, subtaskRunner);
      for (const r of results) context.push(r);

      emitCheckpoint(options, 'act', round, `工具执行完毕（共 ${totalToolCalls} 次调用）`, context);
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
    emitCheckpoint(options, 'finalize', round, '任务完成', context);
    break;
  }

  // ── 边界：轮数耗尽 ──
  if (round >= budget.maxRounds) {
    const lastItem = context[context.length - 1];
    const hasReply = 'role' in lastItem && lastItem.role === 'assistant' &&
                     typeof (lastItem as any).content === 'string' && (lastItem as any).content.trim();
    if (!hasReply) {
      context.push({
        role: 'user' as const,
        content: '已达到最大执行轮数。请基于当前已有的信息直接给出最终回答。',
      });
      try {
        const finalResponse = await collectStreamResponse(context, [], systemPrompt, signal, emit);
        for (const item of finalResponse.outputItems) context.push(item as InputItem);
      } catch { /* 忽略 */ }
    }
    emitCheckpoint(options, 'finalize', round, '达到轮数上限', context);
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

  // 动态注入 site_workflow（根据当前 tab URL 匹配可用 workflow）
  try {
    let tabUrl = '';
    if (typeof chrome !== 'undefined' && chrome.tabs && tabId && Number.isFinite(tabId)) {
      const tab = await chrome.tabs.get(tabId);
      tabUrl = tab?.url || '';
    }
    if (tabUrl) {
      const siteWorkflowSchema = await buildSiteWorkflowSchema(tabUrl);
      if (siteWorkflowSchema) {
        // 替换静态的 site_workflow schema 为动态版本
        tools = tools.filter(t => t.name !== 'site_workflow');
        tools.push(siteWorkflowSchema);
      }
    }
  } catch {
    // site_workflow 注入失败不影响正常工具链
  }

  // 注入 spawn_subtask（只有顶层才有）
  tools.push(SPAWN_SUBTASK_SCHEMA);

  // 构建系统提示词
  const systemPrompt = buildSystemPrompt(tools, true);

  // 构建初始上下文
  const context: InputItem[] = previousContext ? [...previousContext] : [];
  const shouldAppendQuery = options?.appendUserQuery !== false;
  if (shouldAppendQuery && query.trim()) {
    context.push({ role: 'user' as const, content: query });
  }

  // 执行循环
  return agenticLoop(context, tools, systemPrompt, budget, tabId, signal, onEvent, options, 0);
};
