/**
 * AI 对话入口 — 从 background.ts 调用的公共 API
 *
 * 设计哲学：代码管机制和边界（保下限），模型管决策和策略（定上限）
 *
 * 模块拆分：
 *   - loop-config.ts — 类型、常量、配置
 *   - core-loop.ts — agenticLoop 核心循环 + 辅助函数
 *   - review-agent.ts — 审查 Agent
 *   - phase-orchestrator.ts — 多阶段编排器
 *   - orchestrator.ts（本文件）— 对外入口 handleChat + re-exports
 */

import type { InputItem, AIStreamEvent } from './types';
import type { SkillGuideEntry, SkillCatalogEntry } from '../functions/skill';
import { ensureToolRegistryReady, mcpClient } from '../functions/registry';
import { mcpToolsToSchema } from '../mcp/adapters';
import { ALWAYS_ON_TOOLS, buildOnDemandCatalog } from '../functions/tool-tiers';
import { buildSkillContext } from '../functions/skill';
import { buildSystemPrompt } from './system-prompt';
import { TodoManager } from './todo-manager';
import { TabTracker } from './tab-tracker';
import { createTodoFunction } from '../functions/todo';
import { resetSensitiveAccessTrust, getSubagentSchemas } from './core-loop';
import { phaseOrchestrator } from './phase-orchestrator';

import type { LoopBudget, HandleChatOptions, HandleChatCheckpoint, PhaseControl, PendingTurnResponseRequest } from './loop-config';
import { DEFAULT_BUDGET, COMPACT_SCHEMA } from './loop-config';

// ============ Re-exports（保持外部 import 路径不变） ============

export type { LoopBudget, HandleChatOptions, HandleChatCheckpoint, PhaseControl, PendingTurnResponseRequest };

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

  // 保存完整工具集（供 load_tools 动态注入使用）
  const allTools = [...tools];

  // 初始只注入 always-on 工具 + 运行时注入工具（todo/compact/子agent） + load_tools
  const loadedOnDemandTools = new Set<string>();
  tools = tools.filter(t =>
    ALWAYS_ON_TOOLS.has(t.name) ||
    t.name === 'load_tools' ||
    t.name === 'todo' ||
    t.name === 'compact' ||
    // 子 agent 工具不受分层影响
    ['explore', 'plan', 'review', 'spawn_subtask'].includes(t.name),
  );

  // 构建系统提示词（域级 guide 直接注入，全局只放目录）
  let systemPrompt = buildSystemPrompt(tools, true, domainGuides, globalCatalog);

  // 追加按需工具目录到系统提示词
  systemPrompt += buildOnDemandCatalog();

  // 标签页生命周期追踪：任务结束后自动关闭 AI 打开的标签页
  const tabTracker = new TabTracker();
  await tabTracker.startListening();
  try {
    return await phaseOrchestrator(
      query, tools, systemPrompt, budget,
      tabId, signal, onEvent, options,
      previousContext, todoManager, todoFn, tabTracker,
      allTools, loadedOnDemandTools,
    );
  } finally {
    await tabTracker.closeAll();
  }
};
