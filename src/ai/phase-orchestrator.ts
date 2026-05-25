/**
 * Phase Orchestrator — 多阶段编排器
 *
 * 包裹 agenticLoop，在 token 预算预警时做结构化交接而不是压缩。
 * 简单任务（一个阶段内完成）零开销 —— phaseOrchestrator 透传 agenticLoop 的结果。
 */

import type {
  InputItem, ToolSchema, AIStreamEvent,
  FunctionCallOutputItem,
} from './types';
import { getTextContent } from './context-manager';
import { TodoManager } from './todo-manager';
import { TabTracker } from './tab-tracker';
import { createTodoFunction } from '../functions/todo';

import type {
  LoopBudget, HandleChatOptions, PhaseControl, HandoffArtifact,
} from './loop-config';
import {
  HANDOFF_TOKEN_THRESHOLD, FORCE_HANDOFF_ROUNDS,
  TODO_COMPLETION_THRESHOLD, MAX_REVIEW_RETRIES, MAX_PHASES,
} from './loop-config';

import { agenticLoop } from './core-loop';
import { shouldSkipReview, runReviewAgent } from './review-agent';

// ============ 阶段编排辅助函数 ============

/**
 * 提取浏览器客观状态
 * 不依赖 LLM，通过 chrome.tabs API 直接获取
 */
const getBrowserState = async (tabId?: number): Promise<HandoffArtifact['browserState']> => {
  try {
    if (typeof chrome === 'undefined' || !chrome.tabs) {
      return { tabs: [], activeTabId: tabId || 0, currentUrl: '' };
    }
    const [focusedActiveTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const allTabs = await chrome.tabs.query({});
    const activeTab = focusedActiveTab || allTabs[0];
    return {
      tabs: allTabs.slice(0, 10).map(t => ({
        tabId: t.id || 0,
        url: t.url || '',
        title: t.title || '',
      })),
      activeTabId: activeTab?.id || tabId || 0,
      currentUrl: activeTab?.url || '',
    };
  } catch {
    return { tabs: [], activeTabId: tabId || 0, currentUrl: '' };
  }
};

/**
 * 从上下文中提取已收集数据和关键观察
 * 规则提取优先：从工具结果中用正则提取结构化信息，不调用 LLM
 */
const extractDataFromContext = (context: InputItem[]): {
  collectedData: Record<string, unknown>;
  observations: string[];
  warnings: string[];
} => {
  const collectedData: Record<string, unknown> = {};
  const observationSet = new Set<string>();
  const warningSet = new Set<string>();

  for (const item of context) {
    if (!('type' in item) || item.type !== 'function_call_output') continue;
    const output = (item as FunctionCallOutputItem).output;
    if (!output || output.length < 10) continue;

    try {
      const parsed = JSON.parse(output);
      if (!parsed?.success) continue;
      const data = parsed.data;
      if (!data) continue;

      if (data.buffer_id) {
        collectedData[`buffer_${data.buffer_id}`] = {
          count: data.count ?? data.total,
          sample: data.sample ?? data.items?.slice?.(0, 3),
        };
      }
      if (data.tab_id && data.url) {
        collectedData[`tab_${data.tab_id}`] = { url: data.url, title: data.title };
      }
      if (Array.isArray(data.items) && data.items.length > 0) {
        const key = `items_${Object.keys(collectedData).length}`;
        collectedData[key] = data.items.slice(0, 5);
      }
      if (Array.isArray(data.results) && data.results.length > 0) {
        const key = `results_${Object.keys(collectedData).length}`;
        collectedData[key] = data.results.slice(0, 5);
      }
    } catch {
      // JSON 解析失败，跳过
    }
  }

  for (const item of context) {
    if (!('role' in item) || item.role !== 'assistant') continue;
    const text = getTextContent(item.content);
    if (text.includes('需要登录') || text.includes('需要验证')) {
      observationSet.add('页面可能需要登录或验证');
    }
    if (text.includes('加载失败') || text.includes('找不到')) {
      warningSet.add('部分操作可能未成功');
    }
  }

  return { collectedData, observations: [...observationSet], warnings: [...warningSet] };
};

/**
 * 提取交接工件
 */
const extractHandoffArtifact = async (
  context: InputItem[],
  todoManager: TodoManager,
  tabId: number | undefined,
  originalQuery: string,
  phaseIndex: number,
): Promise<HandoffArtifact> => {
  const browserState = await getBrowserState(tabId);
  const { collectedData, observations, warnings } = extractDataFromContext(context);

  const completedSummaries: string[] = [];
  for (const item of todoManager.all) {
    if (item.status === 'completed') {
      completedSummaries.push(`#${item.id} ${item.title}${item.result ? `: ${item.result}` : ''}`);
    }
  }

  return {
    taskGoal: originalQuery,
    phaseIndex,
    todoSnapshot: todoManager.toSnapshot(),
    completedSummaries,
    browserState,
    collectedData,
    observations,
    warnings,
  };
};

/**
 * 构建交接注入 prompt（新阶段的首条用户消息）
 */
const buildHandoffPrompt = (artifact: HandoffArtifact): string => {
  const parts: string[] = [];

  parts.push('## 任务接续');
  parts.push('你正在接手一个进行中的任务。以下是前序阶段的执行状态：');
  parts.push('');

  parts.push('### 用户目标');
  parts.push(artifact.taskGoal);
  parts.push('');

  parts.push('### 当前进度');
  for (const s of artifact.completedSummaries) {
    parts.push(`- [x] ${s}`);
  }
  const pending = artifact.todoSnapshot.items.filter(i => i.status !== 'completed');
  for (const t of pending) {
    const icon = t.status === 'in_progress' ? '[>]' : '[ ]';
    parts.push(`- ${icon} #${t.id} ${t.title}`);
  }
  parts.push('');

  parts.push('### 当前浏览器状态');
  parts.push(`当前页面：${artifact.browserState.currentUrl || '(未知)'}`);
  if (artifact.browserState.tabs.length > 1) {
    parts.push('打开的标签页：');
    for (const tab of artifact.browserState.tabs) {
      const marker = tab.tabId === artifact.browserState.activeTabId ? ' **(当前)**' : '';
      parts.push(`- [tab_id=${tab.tabId}] ${tab.title || '(无标题)'}${marker} — ${tab.url}`);
    }
  }
  parts.push('');

  const dataKeys = Object.keys(artifact.collectedData);
  if (dataKeys.length > 0) {
    parts.push('### 已收集数据');
    parts.push('```json');
    parts.push(JSON.stringify(artifact.collectedData, null, 2));
    parts.push('```');
    parts.push('');
  }

  if (artifact.observations.length > 0) {
    parts.push('### 关键观察');
    for (const obs of artifact.observations) {
      parts.push(`- ${obs}`);
    }
    parts.push('');
  }

  if (artifact.warnings.length > 0) {
    parts.push('### 注意事项');
    for (const w of artifact.warnings) {
      parts.push(`- ${w}`);
    }
    parts.push('');
  }

  if (artifact.reviewFeedback) {
    parts.push('### 审查反馈');
    parts.push('上一次执行的审查发现以下问题，请在本阶段优先修正：');
    parts.push(artifact.reviewFeedback);
    parts.push('');
  }

  parts.push('请使用 todo(action=\'list\') 查看当前进度，然后继续执行下一步待办事项。');

  return parts.join('\n');
};

// ============ 阶段编排器 ============

export const phaseOrchestrator = async (
  query: string,
  tools: ToolSchema[],
  systemPrompt: string,
  budget: LoopBudget,
  tabId: number | undefined,
  signal: AbortSignal | undefined,
  emit: (event: AIStreamEvent) => void,
  options: HandleChatOptions | undefined,
  previousContext: InputItem[] | undefined,
  todoManager: TodoManager,
  todoFn: ReturnType<typeof createTodoFunction>,
  tabTracker?: TabTracker,
  allTools?: ToolSchema[],
  loadedOnDemandTools?: Set<string>,
): Promise<InputItem[]> => {
  const originalQuery = query;
  let lastContext: InputItem[] = [];
  let reviewRetries = 0;

  for (let phase = 0; phase < MAX_PHASES; phase++) {
    let context: InputItem[];
    if (phase === 0) {
      context = previousContext ? [...previousContext] : [];
      const shouldAppendQuery = options?.appendUserQuery !== false;
      if (shouldAppendQuery && query.trim()) {
        context.push({ role: 'user' as const, content: query });
      }
    } else {
      context = [{ role: 'user' as const, content: query }];
    }

    // ── 阶段控制信号 ──
    let todoCompletedSinceHandoff = 0;
    const phaseControl: PhaseControl = {
      shouldHandoff: (tokens, round) => {
        if (tokens > HANDOFF_TOKEN_THRESHOLD) return true;
        if (round >= FORCE_HANDOFF_ROUNDS) return true;
        return false;
      },
      onTodoCompleted: () => {
        todoCompletedSinceHandoff++;
        return todoCompletedSinceHandoff >= TODO_COMPLETION_THRESHOLD;
      },
    };

    const resultContext = await agenticLoop(
      context, tools, systemPrompt, budget,
      tabId, signal, emit, options, 0,
      todoManager, todoFn, phaseControl, tabTracker,
      undefined, allTools, loadedOnDemandTools,
    );

    lastContext = resultContext;

    if (!phaseControl.handoffRequested) {
      return resultContext;
    }

    // ── 交接流程 ──
    const handoffReason = todoCompletedSinceHandoff >= TODO_COMPLETION_THRESHOLD
      ? 'todo_completed' : 'token_budget';

    emit({
      type: 'phase_handoff',
      content: JSON.stringify({
        phase,
        nextPhase: phase + 1,
        reason: handoffReason,
        todoStats: todoManager.active ? todoManager.stats : null,
      }),
    });

    const artifact = await extractHandoffArtifact(
      resultContext, todoManager, tabId, originalQuery, phase,
    );

    // ── 审查流程 ──
    if (!shouldSkipReview(todoManager, resultContext)) {
      const verdict = await runReviewAgent(artifact, tools, tabId, signal, emit);

      if (!verdict.passed) {
        if (reviewRetries < MAX_REVIEW_RETRIES) {
          reviewRetries++;
          artifact.reviewFeedback = verdict.feedback;
        }
      }
    }

    query = buildHandoffPrompt(artifact);
  }

  return lastContext;
};
