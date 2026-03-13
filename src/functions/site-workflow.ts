/**
 * site_workflow 工具
 * 单入口，动态 schema，按 URL 过滤
 *
 * 职责：
 * 1. 根据当前 tab URL 动态生成 tool schema（只列出匹配的 workflow）
 * 2. 执行时从注册表取 Plan，调用 runRemotePlan 引擎
 */

import type { FunctionDefinition, FunctionResult, ToolExecutionContext } from './types';
import type { ToolSchema } from '../ai/types';
import type { SiteWorkflowSpec } from './site-workflow-registry';
import { listSiteWorkflows, getSiteWorkflow, ensureSiteWorkflowRegistryReady } from './site-workflow-registry';
import { matchWorkflows } from './site-workflow-matcher';
import { executeDebugRemotePlan } from './remote-workflow';

const MAX_MATCHED_WORKFLOWS = 10;

/** 从 JSON Schema 中提取参数默认值 */
const extractDefaults = (schema: Record<string, any>): Record<string, any> => {
  const defaults: Record<string, any> = {};
  const properties = schema?.properties;
  if (!properties || typeof properties !== 'object') return defaults;
  for (const [key, prop] of Object.entries(properties)) {
    if (prop && typeof prop === 'object' && 'default' in prop) {
      defaults[key] = (prop as any).default;
    }
  }
  return defaults;
};

/** 获取当前 tab 的 URL */
const getTabUrl = async (tabId?: number): Promise<string> => {
  if (typeof chrome === 'undefined' || !chrome.tabs) return '';
  try {
    if (tabId && Number.isFinite(tabId)) {
      const tab = await chrome.tabs.get(tabId);
      return tab?.url || '';
    }
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs?.[0]?.url || '';
  } catch {
    return '';
  }
};

/**
 * 根据当前 tab URL 动态生成 site_workflow 的 tool schema
 * 如果没有匹配的 workflow，返回 null（不注入到工具列表）
 */
export const buildSiteWorkflowSchema = async (tabUrl: string): Promise<ToolSchema | null> => {
  await ensureSiteWorkflowRegistryReady();
  const allWorkflows = await listSiteWorkflows();
  const matched = matchWorkflows(tabUrl, allWorkflows).slice(0, MAX_MATCHED_WORKFLOWS);

  if (matched.length === 0) return null;

  // 收集所有匹配 workflow 的参数，合并到顶层 schema
  const mergedProperties: Record<string, any> = {
    name: {
      type: 'string',
      enum: matched.map(w => w.name),
      description: '要执行的工作流名称',
    },
  };
  const mergedRequired = new Set<string>(['name']);

  for (const w of matched) {
    const props = w.parameters?.properties;
    if (!props || typeof props !== 'object') continue;
    const wRequired = Array.isArray(w.parameters?.required) ? w.parameters.required as string[] : [];
    for (const [key, schema] of Object.entries(props as Record<string, any>)) {
      if (key === 'name') continue; // 避免覆盖 name 字段
      if (!mergedProperties[key]) {
        mergedProperties[key] = { ...schema };
      }
    }
    // 只有所有 workflow 都要求的参数才标记为 required（避免冲突）
    // 实际上直接不标 required，让 description 中的"必填"提示 AI 即可
    void wRequired;
  }

  const workflowList = matched
    .map(w => {
      const props = w.parameters?.properties;
      const required = Array.isArray(w.parameters?.required) ? w.parameters.required as string[] : [];
      let paramDesc = '';
      if (props && typeof props === 'object') {
        const parts = Object.entries(props as Record<string, any>).map(([key, schema]) => {
          const desc = schema?.description || '';
          const isRequired = required.includes(key);
          const defaultVal = schema?.default !== undefined ? `，默认${schema.default}` : '';
          return `${key}(${desc}${defaultVal}${isRequired ? '，必填' : ''})`;
        });
        if (parts.length > 0) paramDesc = ` | 参数: ${parts.join(', ')}`;
      }
      return `- ${w.name}: ${w.description}${paramDesc}`;
    })
    .join('\n');

  return {
    type: 'function',
    name: 'site_workflow',
    description: `执行当前网站的预定义操作流程，速度快、可靠性高。优先使用此工具而非通用页面操作。\n当前页面可用：\n${workflowList}`,
    parameters: {
      type: 'object',
      properties: mergedProperties,
      required: ['name'],
    },
  };
};

/**
 * site_workflow 工具的 FunctionDefinition
 * 注册到 MCP 工具列表中
 */
export const siteWorkflowFunction: FunctionDefinition = {
  name: 'site_workflow',
  description: '执行当前网站的预定义操作流程。根据当前页面 URL 自动匹配可用的工作流。',
  supportsParallel: false,
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: '要执行的工作流名称',
      },
      params: {
        type: 'object',
        description: '传给工作流的参数',
      },
    },
    required: ['name'],
  },

  execute: async (
    rawParams: { name?: string; params?: Record<string, unknown> },
    context?: ToolExecutionContext,
  ): Promise<FunctionResult> => {
    const workflowName = String(rawParams?.name || '').trim();
    if (!workflowName) {
      return { success: false, error: '缺少 workflow 名称' };
    }

    const spec = await getSiteWorkflow(workflowName);
    if (!spec) {
      return { success: false, error: `workflow 不存在：${workflowName}` };
    }
    if (!spec.enabled) {
      return { success: false, error: `workflow 已禁用：${workflowName}` };
    }

    // 合并参数：schema 默认值 < 顶层参数 < params 嵌套参数
    // AI 可能把参数放在顶层（如 {name, keyword}）或嵌套在 params 里（如 {name, params: {keyword}}）
    const defaults = extractDefaults(spec.parameters);
    const { name: _n, params: nested, ...topLevel } = (rawParams || {}) as Record<string, unknown>;
    const nestedParams = nested && typeof nested === 'object' && !Array.isArray(nested)
      ? nested as Record<string, unknown>
      : {};
    const mergedParams = { ...defaults, ...topLevel, ...nestedParams };

    // 调用执行引擎
    return executeDebugRemotePlan(
      workflowName,
      spec.plan,
      mergedParams,
      context,
    );
  },
};
