/**
 * 审查 Agent
 *
 * 在阶段交接时执行独立审查，验证执行结果
 */

import type { InputItem, ToolSchema, AIStreamEvent, FunctionCallInputItem } from './types';
import { getTextContent } from './context-manager';
import { TodoManager } from './todo-manager';
import { agenticLoop } from './core-loop';
import type { LoopBudget, HandoffArtifact } from './loop-config';
import { DEFAULT_BUDGET, SUBAGENT_LOOP_CONFIGS, WRITE_TOOLS } from './loop-config';

/**
 * 判断是否应跳过审查
 * 纯信息查询、简单任务、任务已全部完成时跳过
 */
export const shouldSkipReview = (
  todoManager: TodoManager,
  context: InputItem[],
): boolean => {
  // 所有 todo 已完成 → 任务即将结束，无需审查
  if (todoManager.active && todoManager.stats.total > 0 &&
    todoManager.stats.completed === todoManager.stats.total) {
    return true;
  }

  // 上下文很短（< 15 条，约 < 5 轮工具调用）→ 简单任务
  if (context.length < 15) {
    return true;
  }

  // 纯只读任务（无写入操作）→ 无需验证
  let hasWriteOp = false;
  for (const item of context) {
    if ('type' in item && item.type === 'function_call') {
      const fc = item as FunctionCallInputItem;
      if (WRITE_TOOLS.has(fc.name)) {
        hasWriteOp = true;
        break;
      }
    }
  }
  if (!hasWriteOp) return true;

  return false;
};

/**
 * 构建审查目标（提供给审查 Agent 的 user message）
 */
export const buildReviewGoal = (artifact: HandoffArtifact): string => {
  const parts: string[] = [];
  parts.push('请审查以下执行阶段的结果：');
  parts.push('');

  parts.push('## 任务目标');
  parts.push(artifact.taskGoal);
  parts.push('');

  parts.push('## 已完成步骤');
  if (artifact.completedSummaries.length > 0) {
    for (const s of artifact.completedSummaries) {
      parts.push(`- ${s}`);
    }
  } else {
    parts.push('- （无明确完成记录）');
  }
  parts.push('');

  parts.push('## 预期页面状态');
  parts.push(`当前 URL 应为：${artifact.browserState.currentUrl || '(未知)'}`);
  parts.push('');

  const dataKeys = Object.keys(artifact.collectedData);
  if (dataKeys.length > 0) {
    parts.push('## 声称已收集的数据');
    parts.push('```json');
    parts.push(JSON.stringify(artifact.collectedData, null, 2));
    parts.push('```');
    parts.push('');
  }

  parts.push('请用 screenshot(annotate=true) 查看当前页面实际状态，对比上述声称的结果，逐维度给出审查判定。');
  return parts.join('\n');
};

/**
 * 从审查 Agent 的上下文中解析审查结论
 */
const parseReviewVerdict = (context: InputItem[]): { passed: boolean; feedback?: string } => {
  for (let i = context.length - 1; i >= 0; i--) {
    const item = context[i];
    if (!('role' in item) || item.role !== 'assistant') continue;
    const text = getTextContent(item.content);
    if (!text.trim()) continue;

    const failed = text.includes('审查结果：未通过') || text.includes('未通过');
    if (failed) {
      const feedbackMatch = text.match(/(?:改进建议|建议)[：:]?\s*([\s\S]*?)(?=\n###|\n##|$)/);
      const problemMatch = text.match(/(?:发现的问题|问题)[：:]?\s*([\s\S]*?)(?=\n###|\n##|$)/);
      const feedback = feedbackMatch?.[1]?.trim() || problemMatch?.[1]?.trim() || text.slice(-500);
      return { passed: false, feedback };
    }

    if (text.includes('审查结果：通过') || text.includes('通过')) {
      return { passed: true };
    }

    // 兜底：没有明确关键词，默认通过
    return { passed: true };
  }

  return { passed: true };
};

/**
 * 运行审查 Agent
 * 在独立上下文中执行审查，不携带执行 agent 的对话历史
 */
export const runReviewAgent = async (
  artifact: HandoffArtifact,
  tools: ToolSchema[],
  tabId: number | undefined,
  signal: AbortSignal | undefined,
  emit: (event: AIStreamEvent) => void,
): Promise<{ passed: boolean; feedback?: string }> => {
  const config = SUBAGENT_LOOP_CONFIGS.review;

  emit({ type: 'review_started', content: JSON.stringify({ phase: artifact.phaseIndex }) });

  try {
    const goal = buildReviewGoal(artifact);
    const reviewContext: InputItem[] = [{ role: 'user' as const, content: goal }];
    const reviewTools = tools.filter(t => config.toolFilter!(t.name));

    const reviewBudget: LoopBudget = {
      ...DEFAULT_BUDGET,
      maxRounds: (config.budget.maxRounds ?? 8),
      maxToolCalls: (config.budget.maxToolCalls ?? 15),
      maxSubtaskDepth: 0,
    };

    const resultContext = await agenticLoop(
      reviewContext, reviewTools, config.buildPrompt(), reviewBudget,
      tabId, signal, emit, undefined, 1,
    );

    const verdict = parseReviewVerdict(resultContext);

    emit({
      type: 'review_completed',
      content: JSON.stringify({ phase: artifact.phaseIndex, passed: verdict.passed }),
    });

    return verdict;
  } catch {
    emit({
      type: 'review_completed',
      content: JSON.stringify({ phase: artifact.phaseIndex, passed: true, error: true }),
    });
    return { passed: true };
  }
};
