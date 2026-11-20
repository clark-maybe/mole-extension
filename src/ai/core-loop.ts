/**
 * 核心 Agentic Loop
 *
 * 采样 → 有工具调用 → 执行 → 回写 → 继续采样
 *        无工具调用 → 结束
 */

import type {
  InputItem, OutputItem, OutputFunctionCallItem,
  ToolSchema, AIStreamEvent, ContentPart,
  MessageInputItem, FunctionCallInputItem, FunctionCallOutputItem,
} from './types';
import { ArtifactStore } from '../lib/artifact-store';
import { chatStream, chatComplete } from './llm-client';
import { compactContext, getTextContent, microCompact, estimateContextTokens, stripImagesFromContent } from './context-manager';
import { executeToolCalls, getSubagentSchemas, isAgentTool, extractLastAssistantReply, resetSensitiveAccessTrust } from './tool-executor';
import type { AgentRunner } from './tool-executor';
import { AgentRegistry } from './agent-registry';
import type { AgentDefinition } from './agent-registry';
import { getToolsByCategory } from '../functions/tool-tiers';
import { TodoManager } from './todo-manager';
import { TabTracker } from './tab-tracker';
import { createTodoFunction } from '../functions/todo';
import { createRunState, isProgressTool } from './run-state';
import type { AgentRunState } from './run-state';

import type {
  LoopBudget, HandleChatOptions, PhaseControl,
} from './loop-config';
import {
  MAX_EMPTY_RETRIES, MAX_IMAGE_INJECTIONS,
  AUTO_COMPACT_TOKEN_THRESHOLD, AUTO_COMPACT_KEEP_TAIL_RATIO,
  AUTO_COMPACT_SUMMARY_INSTRUCTION,
  SUBAGENT_LOOP_CONFIGS,
} from './loop-config';

// re-export 给其他模块使用
export { resetSensitiveAccessTrust, getSubagentSchemas };

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
export const collectStreamResponse = async (
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
      const content: ContentPart[] = [];
      const annotations = parsed.data.annotations;
      const hasAnnotations = Array.isArray(annotations) && annotations.length > 0;

      content.push({
        type: 'input_text' as const,
        text: hasAnnotations
          ? `标注截图（已标注 ${annotations.length} 个可交互元素）：`
          : `截图内容（${parsed.data.mode || '可见区域'}）：`,
      });

      content.push({ type: 'input_image' as const, image_url: artifact.dataUrl });

      // 标注映射表（仅标注截图时注入，让 AI 知道每个编号对应的 element_id）
      if (hasAnnotations) {
        const mappingLines: string[] = [];
        for (const a of annotations) {
          const desc: string[] = [a.tag];
          if (a.text) desc.push(`"${a.text}"`);
          else if (a.placeholder) desc.push(`placeholder="${a.placeholder}"`);
          else if (a.aria_label) desc.push(`aria-label="${a.aria_label}"`);
          else if (a.name) desc.push(`name="${a.name}"`);
          if (a.href) desc.push(`[${a.href}]`);
          mappingLines.push(`${a.index}. ${desc.join(' ')} → element_id=${a.element_id}`);
        }
        content.push({
          type: 'input_text' as const,
          text: `\n元素映射：\n${mappingLines.join('\n')}\n\n使用 element_id 操作对应元素。`,
        });
      }

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
const emitCheckpoint = async (
  options: HandleChatOptions | undefined,
  phase: string,
  round: number,
  summary: string,
  context: InputItem[],
  todoSnapshot?: import('./todo-manager').TodoSnapshot,
) => {
  if (!options?.onCheckpoint) return;
  await options.onCheckpoint({
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
 * @returns 摘要文本（成功时），null（失败时降级到 compactContext）
 */
export const performAutoCompact = async (
  context: InputItem[],
  emit: (event: AIStreamEvent) => void,
  signal: AbortSignal | undefined,
  todoStatusText?: string,
): Promise<{ summary: string; before: number; after: number } | null> => {
  const beforeSize = context.length;

  try {
    const readableText = contextToReadableText(context);
    const summaryInput: InputItem[] = [
      { role: 'user' as const, content: readableText },
    ];
    const result = await chatComplete(summaryInput, undefined, AUTO_COMPACT_SUMMARY_INSTRUCTION, signal);

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
      return null;
    }

    const firstUserIndex = context.findIndex(
      item => 'role' in item && item.role === 'user',
    );
    const firstUserMessage = firstUserIndex >= 0 ? context[firstUserIndex] : null;
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

    let fullSummary = `[context-compacted]\n${summaryText}`;
    if (todoStatusText) {
      fullSummary += `\n\n当前任务计划：\n${todoStatusText}`;
    }

    const summaryItem: InputItem = {
      role: 'assistant' as const,
      content: fullSummary,
    };

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
    return null;
  }
};

// ============ 标签页追踪 ============

/** 扫描工具调用结果，追踪 tab_navigate 打开/关闭的标签页 */
const scanTabNavigateResults = (
  calls: OutputFunctionCallItem[],
  results: InputItem[],
  tracker: TabTracker,
) => {
  for (const fc of calls) {
    if (fc.name !== 'tab_navigate') continue;
    try {
      const params = JSON.parse(fc.arguments || '{}');
      const action = params.action;
      if (action !== 'open' && action !== 'close' && action !== 'duplicate') continue;

      const resultItem = results.find(
        r => 'call_id' in r && r.call_id === fc.call_id,
      ) as FunctionCallOutputItem | undefined;
      if (!resultItem) continue;

      const output = JSON.parse(resultItem.output || '{}');
      if (!output.success) continue;

      if (action === 'open' || action === 'duplicate') {
        const newTabId = output.data?.tab_id;
        if (typeof newTabId === 'number') {
          tracker.trackOpened(newTabId, !!params.keep_alive);
        }
      } else if (action === 'close') {
        const closedId = params.tab_id || output.data?.tab_id;
        if (typeof closedId === 'number') {
          tracker.trackClosed(closedId);
        }
      }
    } catch {
      // JSON 解析失败，跳过
    }
  }
};

// ============ 核心循环 ============

/**
 * 核心 Agentic Loop（内部实现）
 */
export const agenticLoop = async (
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
  phaseControl?: PhaseControl,
  tabTracker?: TabTracker,
  registry?: AgentRegistry,
  allTools?: ToolSchema[],
  loadedOnDemandTools?: Set<string>,
  sharedRunState?: AgentRunState,
): Promise<InputItem[]> => {
  let round = 0;
  let totalToolCalls = 0;
  let emptyRetries = 0;
  let imageInjectionCount = 0;
  const runState = sharedRunState || createRunState(budget);
  let forceFinalize = false;
  let roundsSinceTodoOp = 0;

  emit({ type: 'thinking', content: 'AI 正在思考...' });
  await emitCheckpoint(options, 'act', 0, '开始处理', context);

  while (round < budget.maxRounds && runState.rounds < runState.maxRounds &&
    totalToolCalls < budget.maxToolCalls && runState.toolCalls < runState.maxToolCalls && runState.failureRounds < 6) {
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

    // ── 边界：阶段交接检查（优先于 auto_compact） ──
    const estimatedTokens = estimateContextTokens(context);
    if (phaseControl?.shouldHandoff?.(estimatedTokens, round)) {
      phaseControl.handoffRequested = true;
      await emitCheckpoint(options, 'act', round, '阶段交接', context, todoManager?.active ? todoManager.toSnapshot() : undefined);
      break;
    }

    // Layer 2: auto_compact — token 阈值触发 LLM 智能摘要
    if (estimatedTokens > AUTO_COMPACT_TOKEN_THRESHOLD) {
      const todoText = todoManager?.active ? todoManager.toStatusText() : undefined;
      const autoResult = await performAutoCompact(context, emit, signal, todoText);
      if (!autoResult) {
        compactContext(context, budget.maxContextItems, emit, todoText);
      }
    } else {
      const todoText = todoManager?.active ? todoManager.toStatusText() : undefined;
      compactContext(context, budget.maxContextItems, emit, todoText);
    }

    // ── 机制：注入待处理的用户输入 ──
    await injectPendingInputs(context, options?.consumePendingUserInputs);

    // ── 机制：调用 LLM ──
    round++;
    runState.rounds++;
    await emitCheckpoint(options, 'act', round, `第 ${round} 轮`, context);

    let fullText: string;
    let functionCalls: OutputFunctionCallItem[];
    let outputItems: OutputItem[];

    try {
      const response = await collectStreamResponse(context, tools, systemPrompt, signal, emit);
      fullText = response.fullText;
      functionCalls = response.functionCalls;
      outputItems = response.outputItems;
    } catch (err: unknown) {
      const isAborted = signal?.aborted || (err instanceof Error && (err.name === 'AbortError' || err.message === 'ABORTED'));
      if (isAborted) {
        emit({ type: 'error', content: JSON.stringify({ code: 'E_CANCELLED', message: '任务已取消' }) });
        return context;
      }
      emit({ type: 'error', content: JSON.stringify({ code: 'E_LLM_API', message: err instanceof Error ? err.message : 'LLM 调用失败' }) });
      return context;
    }

    // 写入上下文
    for (const item of outputItems) {
      context.push(item as InputItem);
    }

    // ── 路径 A：模型调用了工具 ──
    if (functionCalls.length > 0) {
      emptyRetries = 0;

      // ── 边界：总调用数检查 ──
      if (totalToolCalls + functionCalls.length > budget.maxToolCalls ||
        runState.toolCalls + functionCalls.length > runState.maxToolCalls) {
        for (const fc of functionCalls) context.push({ type: 'function_call_output', call_id: fc.call_id,
          output: JSON.stringify({ success: false, code: 'E_TOOL_BUDGET', error: '任务处理已达到边界，请基于已有信息收尾。' }) });
        forceFinalize = true;
        break;
      }
      totalToolCalls += functionCalls.length;
      runState.toolCalls += functionCalls.length;

      // ── 机制：构建统一 Agent runner ──
      const effectiveRegistry = registry || new AgentRegistry();

      const agentRunner: AgentRunner = async (params, runnerSignal) => {
        const { type: agentType = 'subtask', goal, tab_id: targetTabId } = params;
        const configName = agentType === 'subtask' ? 'spawn_subtask' : agentType;
        const config = SUBAGENT_LOOP_CONFIGS[configName];

        if (!config) {
          return { success: false, summary: `未知的 Agent 类型: ${agentType}`, agentId: '' };
        }

        const configDepth = config.budget.maxSubtaskDepth;
        if (configDepth === undefined || configDepth > 0) {
          const effectiveDepth = configDepth ?? budget.maxSubtaskDepth;
          if (depth >= effectiveDepth) {
            return { success: false, summary: '已达最大嵌套深度', agentId: '' };
          }
        }

        const effectiveTabId = targetTabId || tabId;
        if (effectiveTabId && effectiveRegistry.hasWriteAgentOnTab(effectiveTabId)) {
          if (!AgentRegistry.isReadOnly(agentType)) {
            return { success: false, summary: '该标签页已有其他 Agent 在操作', agentId: '' };
          }
        }

        const def: AgentDefinition = {
          type: agentType,
          description: `${agentType} agent`,
          buildPrompt: config.buildPrompt,
          toolFilter: config.toolFilter,
          budget: config.budget,
        };
        const instance = effectiveRegistry.create(def, undefined, effectiveTabId);

        try {
          const subContext: InputItem[] = [{ role: 'user' as const, content: goal }];
          const subTools = config.toolFilter
            ? tools.filter(t => config.toolFilter!(t.name))
            : tools.filter(t => !isAgentTool(t.name));

          const mergedBudget: Partial<LoopBudget> = {};
          for (const [key, value] of Object.entries(config.budget)) {
            const budgetKey = key as keyof LoopBudget;
            mergedBudget[budgetKey] = Math.min(budget[budgetKey], value as number);
          }
          const subBudget: LoopBudget = { ...budget, ...mergedBudget };

          const resultContext = await agenticLoop(
            subContext, subTools, config.buildPrompt(), subBudget,
            effectiveTabId, runnerSignal || signal, emit, { sessionId: options?.sessionId }, depth + 1,
            undefined, undefined, undefined, tabTracker,
            effectiveRegistry,
            undefined, undefined, runState,
          );

          const summary = extractLastAssistantReply(resultContext) || 'Agent 已完成但无明确输出';
          const success = runState.failureRounds < 6 && !(runnerSignal || signal)?.aborted;
          effectiveRegistry.updateStatus(instance.id, success ? 'completed' : 'failed', summary);
          return { success, summary, agentId: instance.id };
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : 'Agent 执行失败';
          effectiveRegistry.updateStatus(instance.id, 'failed', errMsg);
          return { success: false, summary: errMsg, agentId: instance.id };
        }
      };

      // ── 机制：拦截 todo / compact 调用，本地执行 ──
      const regularCalls: OutputFunctionCallItem[] = [];
      if (todoManager && todoFn) {
        for (const fc of functionCalls) {
          if (fc.name === 'todo') {
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
            } catch (err: unknown) {
              todoOutput = JSON.stringify({ success: false, error: err instanceof Error ? err.message : 'todo 执行异常' });
            }

            context.push({ type: 'function_call_output' as const, call_id: fc.call_id, output: todoOutput });
            roundsSinceTodoOp = 0;

            const todoSuccess = !todoOutput.includes('"success":false');
            emit({ type: 'function_call', content: JSON.stringify({ name: 'todo', callId: fc.call_id, arguments: fc.arguments }) });
            emit({ type: 'function_result', content: JSON.stringify({ name: 'todo', callId: fc.call_id, success: todoSuccess, message: '', cancelled: false }) });
            if (todoManager.active) {
              emit({ type: 'todo_update', content: JSON.stringify({ items: todoManager.all, stats: todoManager.stats }) });
            }

            // ── 阶段边界：todo 完成事件驱动交接 ──
            if (todoSuccess && phaseControl?.onTodoCompleted) {
              try {
                const params = JSON.parse(fc.arguments || '{}');
                if (params.action === 'update' && params.status === 'completed') {
                  const allDone = todoManager.stats.total > 0 &&
                    todoManager.stats.completed === todoManager.stats.total;
                  if (!allDone && phaseControl.onTodoCompleted()) {
                    phaseControl.handoffRequested = true;
                  }
                }
              } catch { /* 参数解析失败跳过 */ }
            }
          } else if (fc.name === 'compact') {
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
        const allowedCalls: OutputFunctionCallItem[] = [];
        const results: InputItem[] = [];
        for (const fc of regularCalls) {
          if ((runState.failedSignatures.get(buildSignature(fc)) || 0) >= Math.min(2, budget.maxSameSignature)) {
            const error = '相同操作已经重复失败，已停止再次执行。请使用其他来源或基于已有结果回答。';
            results.push({ type: 'function_call_output', call_id: fc.call_id,
              output: JSON.stringify({ success: false, code: 'E_TOOL_REPEATED_FAILURE', retryable: false, error }) });
            emit({ type: 'function_call', content: JSON.stringify({ name: fc.name, callId: fc.call_id, arguments: fc.arguments }) });
            emit({ type: 'function_result', content: JSON.stringify({ name: fc.name, callId: fc.call_id, success: false, message: error }) });
          } else allowedCalls.push(fc);
        }
        await emitCheckpoint(options, 'act', round, '工具执行前检查点', context, todoManager?.active ? todoManager.toSnapshot() : undefined);
        results.push(...await executeToolCalls(allowedCalls, tabId, signal, emit, agentRunner, options?.sessionId, runState));
        for (const r of results) context.push(r);
        let failed = 0;
        let succeeded = 0;
        for (const fc of regularCalls) {
          if (!isProgressTool(fc.name, fc.arguments)) continue;
          const output = results.find(item => 'type' in item && item.type === 'function_call_output' && item.call_id === fc.call_id);
          if (!output || !('output' in output)) continue;
          try {
            const parsed = JSON.parse(output.output);
            const signature = buildSignature(fc);
            if (parsed.success === false) {
              failed++;
              // 网页冷却回包没有发起新请求，不能挤占网址自身的实际尝试次数。
              if (!String(parsed.code || '').startsWith('E_WEB_')) {
                runState.failedSignatures.set(signature, (runState.failedSignatures.get(signature) || 0) + 1);
              }
            } else {
              succeeded++;
              runState.failedSignatures.delete(signature);
            }
          } catch { /* 无法解析的结果不视为成功进展。 */ }
        }
        if (succeeded > 0) {
          runState.failureRounds = 0;
          // 页面状态有新进展后允许重新定位操作；网址级拒绝仍由 webAccess 独立保留。
          runState.failedSignatures.clear();
        }
        else if (failed > 0) runState.failureRounds++;
        if (tabTracker) scanTabNavigateResults(regularCalls, results, tabTracker);
        imageInjectionCount = await injectScreenshotImages(regularCalls, results, context, imageInjectionCount);

        // ── 机制：load_tools 动态工具注入 ──
        if (allTools && loadedOnDemandTools) {
          for (const fc of regularCalls) {
            if (fc.name !== 'load_tools') continue;
            try {
              const params = JSON.parse(fc.arguments || '{}');
              const category = params.category;
              if (!category) continue;
              const toolNames = getToolsByCategory(category);
              for (const toolName of toolNames) {
                if (loadedOnDemandTools.has(toolName)) continue;
                const schema = allTools.find(t => t.name === toolName);
                if (schema && !tools.some(t => t.name === toolName)) {
                  tools.push(schema);
                }
                loadedOnDemandTools.add(toolName);
              }
            } catch {
              // 参数解析失败跳过
            }
          }
        }
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
      await emitCheckpoint(options, 'act', round, `工具执行完毕（共 ${totalToolCalls} 次调用）`, context, todoSnap);

      // ── 边界：Todo 完成驱动的阶段交接 ──
      if (phaseControl?.handoffRequested && runState.failureRounds < 6 &&
        runState.rounds < runState.maxRounds && runState.toolCalls < runState.maxToolCalls) {
        await emitCheckpoint(options, 'act', round, '阶段交接（Todo 完成）', context, todoSnap);
        break;
      }

      continue;
    }

    // ── 路径 B：模型没有调用工具（想结束）──

    // ── 边界：空响应重试 ──
    if (!fullText.trim()) {
      emptyRetries++;
      if (emptyRetries <= MAX_EMPTY_RETRIES) {
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
    await emitCheckpoint(options, 'finalize', round, '任务完成', context, todoManager?.active ? todoManager.toSnapshot() : undefined);
    break;
  }

  // ── 边界：预算耗尽或连续失败，停止工具执行并给出可交付结果 ──
  if (forceFinalize || round >= budget.maxRounds || runState.rounds >= runState.maxRounds ||
    totalToolCalls >= budget.maxToolCalls || runState.toolCalls >= runState.maxToolCalls || runState.failureRounds >= 6) {
    if (phaseControl) phaseControl.handoffRequested = false;
    const lastItem = context[context.length - 1];
    const hasReply = lastItem && 'role' in lastItem && lastItem.role === 'assistant' &&
                     'content' in lastItem && getTextContent(lastItem.content).trim();
    if (!hasReply) {
      context.push({
        role: 'user' as const,
        content: runState.failureRounds >= 6
          ? '多次尝试均失败，当前没有获得新信息。请基于已有证据说明完成的部分、无法获取的信息及具体障碍，直接给出最终回答，不要把受阻任务说成已完成，也不要继续尝试。'
          : '本次处理已经进行了很多步骤。请基于当前已有的信息，总结你已经完成的内容和当前进展，直接给出最终回答。不要提及"轮数""工具限制"等内部概念。',
      });
      try {
        const finalResponse = await collectStreamResponse(context, [], systemPrompt, signal, emit);
        for (const item of finalResponse.outputItems) context.push(item as InputItem);
      } catch { /* 忽略 */ }
    }
    await emitCheckpoint(options, 'finalize', round, runState.failureRounds >= 6 ? '连续失败，基于已有结果收尾' : '达到任务处理边界', context,
      todoManager?.active ? todoManager.toSnapshot() : undefined);
  }

  return context;
};
