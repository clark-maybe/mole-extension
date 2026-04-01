/**
 * skill 工具
 * 三模式：list（查看目录）、detail（获取指南）、run（执行工作流）
 *
 * 上下文优化策略：
 *   域级 Skill（URL 匹配到的，数量少）→ guide 直接注入系统提示词
 *   全局 Skill（可能很多）→ 系统提示词只放目录，AI 按需 detail
 *
 * 这样 skill 数量增长不会撑爆系统提示词
 */

import type { FunctionDefinition, FunctionResult, ToolExecutionContext } from './types';
import type { ToolSchema } from '../ai/types';
import type { SkillSpec, WorkflowEntry } from './skill-types';
import { matchSkillsByUrl, listAllSkills, getSkill, ensureSkillRegistryReady } from './skill-registry';
import { executeDebugRemotePlan } from './remote-workflow';

const MAX_WORKFLOWS_IN_SCHEMA = 15;

/** guide 条目（传给系统提示词，仅域级 Skill） */
export interface SkillGuideEntry {
  scope: 'global' | 'domain';
  skillName: string;
  skillLabel: string;
  guide: string;
}

/** 全局 Skill 目录条目（轻量，放在系统提示词中） */
export interface SkillCatalogEntry {
  name: string;
  label: string;
  description: string;
  workflowCount: number;
}

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

/** 构建单个 workflow 的参数简述 */
const buildWorkflowDescription = (wf: WorkflowEntry): string => {
  const paramProps = wf.parameters?.properties;
  let paramHint = '';
  if (paramProps && typeof paramProps === 'object') {
    const parts = Object.entries(paramProps as Record<string, any>).map(([key, schema]) => {
      const desc = (schema as any)?.description || '';
      const req = Array.isArray(wf.parameters?.required) && (wf.parameters.required as string[]).includes(key);
      const def = (schema as any)?.default !== undefined ? `，默认${(schema as any).default}` : '';
      return `${key}(${desc}${def}${req ? '，必填' : ''})`;
    });
    if (parts.length > 0) paramHint = ` | 参数: ${parts.join(', ')}`;
  }
  return `- ${wf.name}: ${wf.description}${paramHint}`;
};

/**
 * 根据当前 tab URL 构建 Skill 上下文
 *
 * 混合策略：
 *   域级 Skill → guide 直接注入系统提示词（数量少，高度相关）
 *   全局 Skill → 只返回目录（名称+一句话），AI 按需调用 detail
 *
 * 返回：
 * - schema: skill 工具的动态 ToolSchema
 * - domainGuides: 域级 guide（直接注入系统提示词）
 * - globalCatalog: 全局 Skill 目录（轻量，注入系统提示词）
 */
export const buildSkillContext = async (tabUrl: string): Promise<{
  schema: ToolSchema | null;
  domainGuides: SkillGuideEntry[];
  globalCatalog: SkillCatalogEntry[];
}> => {
  await ensureSkillRegistryReady();
  const matchedSkills = await matchSkillsByUrl(tabUrl);

  if (matchedSkills.length === 0) return { schema: null, domainGuides: [], globalCatalog: [] };

  // 1. 分离全局和域级
  const globalSkills = matchedSkills.filter(s => s.scope === 'global');
  const domainSkills = matchedSkills.filter(s => s.scope === 'domain');

  // 2. 域级 Skill：收集完整 guide（直接注入）
  const domainGuides: SkillGuideEntry[] = domainSkills
    .filter(s => s.guide?.trim())
    .map(s => ({
      scope: 'domain' as const,
      skillName: s.name,
      skillLabel: s.label,
      guide: s.guide.trim(),
    }));

  // 3. 全局 Skill：只收集目录（轻量）
  const globalCatalog: SkillCatalogEntry[] = globalSkills.map(s => ({
    name: s.name,
    label: s.label,
    description: s.description,
    workflowCount: s.workflows.length,
  }));

  // 4. 收集域级 workflow（直接放在 schema enum 中，零延迟调用）
  const domainWorkflows: { skill: SkillSpec; wf: WorkflowEntry }[] = [];
  for (const skill of domainSkills) {
    for (const wf of skill.workflows) {
      domainWorkflows.push({ skill, wf });
    }
  }

  // 5. 构建 schema
  const limited = domainWorkflows.slice(0, MAX_WORKFLOWS_IN_SCHEMA);

  // description 中列出域级可直接 run 的 workflow + 提示全局需 detail
  const descParts: string[] = [
    '预定义技能工作流。支持三种操作：',
    '',
    '**action=run**（默认）：执行工作流，速度快。',
    '**action=detail**：查看某个技能的完整指南和工作流清单。',
    '**action=list**：列出所有可用技能。',
  ];

  if (limited.length > 0) {
    descParts.push('');
    descParts.push('当前页面可直接 run 的工作流：');
    for (const { wf } of limited) {
      descParts.push(buildWorkflowDescription(wf));
    }
  }

  if (globalCatalog.length > 0) {
    descParts.push('');
    descParts.push('基础技能（用 detail 查看详情后再 run）：');
    for (const cat of globalCatalog) {
      descParts.push(`- ${cat.name}: ${cat.description}（${cat.workflowCount} 个工作流）`);
    }
  }

  // name enum 只包含域级 workflow（全局需 detail 后才知道具体 name）
  const domainWfNames = limited.map(({ wf }) => wf.name);

  const schema: ToolSchema = {
    type: 'function',
    name: 'skill',
    description: descParts.join('\n'),
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['run', 'detail', 'list'],
          description: '操作类型。run=执行工作流（默认），detail=查看技能详情，list=列出所有技能',
        },
        name: {
          type: 'string',
          ...(domainWfNames.length > 0 ? {} : {}), // 不设 enum，允许全局 workflow 名称
          description: 'action=run 时为工作流名称，action=detail 时为技能名称',
        },
        params: {
          type: 'object',
          description: 'action=run 时传给工作流的参数对象',
        },
        tab_id: {
          type: 'number',
          description: '目标标签页 ID。不传则使用当前活动标签页。',
        },
      },
      required: ['name'],
    },
  };

  return { schema, domainGuides, globalCatalog };
};

// ============ action 处理器 ============

/** action=list：列出所有可用技能 */
const handleList = async (tabUrl?: string): Promise<FunctionResult> => {
  await ensureSkillRegistryReady();

  // 如果有 tabUrl 则按匹配过滤，否则列出全部
  const skills = tabUrl
    ? await matchSkillsByUrl(tabUrl)
    : await listAllSkills();

  const result = skills.map(s => ({
    name: s.name,
    label: s.label,
    description: s.description,
    scope: s.scope,
    workflowCount: s.workflows.length,
    workflows: s.workflows.map(w => w.name),
  }));

  return {
    success: true,
    data: {
      totalSkills: result.length,
      skills: result,
      hint: '使用 skill(action="detail", name="技能名") 查看具体技能的完整指南和参数说明',
    },
  };
};

/** action=detail：查看某个技能的完整指南 */
const handleDetail = async (skillName: string): Promise<FunctionResult> => {
  await ensureSkillRegistryReady();
  const skill = await getSkill(skillName);
  if (!skill) {
    return { success: false, error: `技能不存在：${skillName}` };
  }

  const workflowDetails = skill.workflows.map(wf => ({
    name: wf.name,
    label: wf.label,
    description: wf.description,
    parameters: wf.parameters,
  }));

  return {
    success: true,
    data: {
      name: skill.name,
      label: skill.label,
      description: skill.description,
      scope: skill.scope,
      guide: skill.guide || '（无指南）',
      workflows: workflowDetails,
      hint: '使用 skill(name="工作流名称", params={...}) 执行具体工作流',
    },
  };
};

/** action=run：执行工作流 */
const handleRun = async (
  rawParams: Record<string, unknown>,
  context?: ToolExecutionContext,
): Promise<FunctionResult> => {
  const workflowName = String(rawParams?.name || '').trim();
  if (!workflowName) {
    return { success: false, error: '缺少 workflow 名称' };
  }

  // 在所有 Skill 中查找 workflow
  await ensureSkillRegistryReady();
  const allSkills = await listAllSkills();
  let targetWorkflow: WorkflowEntry | null = null;

  for (const skill of allSkills) {
    if (!skill.enabled) continue;
    const found = skill.workflows.find(w => w.name === workflowName);
    if (found) {
      targetWorkflow = found;
      break;
    }
  }

  if (!targetWorkflow) {
    return { success: false, error: `工作流不存在：${workflowName}。请先用 skill(action="list") 查看可用工作流` };
  }

  // 合并参数：schema 默认值 < 顶层参数 < params 嵌套参数
  const defaults = extractDefaults(targetWorkflow.parameters);
  const { action: _a, name: _n, params: nested, tab_id: _t, ...topLevel } = rawParams || {};
  const nestedParams = nested && typeof nested === 'object' && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : {};
  const mergedParams = { ...defaults, ...topLevel, ...nestedParams };

  // 构建最终 context：tab_id 参数优先于 context.tabId
  const effectiveContext: ToolExecutionContext = {
    ...context,
    tabId: (typeof rawParams.tab_id === 'number' && Number.isFinite(rawParams.tab_id))
      ? rawParams.tab_id
      : context?.tabId,
    signal: context?.signal,
  };

  return executeDebugRemotePlan(
    workflowName,
    targetWorkflow.plan,
    mergedParams,
    effectiveContext,
  );
};

// ============ FunctionDefinition ============

/**
 * skill 工具
 * 三模式：list / detail / run
 */
export const skillFunction: FunctionDefinition = {
  name: 'skill',
  description: '预定义技能工作流。支持 list（列出技能）、detail（查看指南）、run（执行工作流，默认）。',
  supportsParallel: false,
  permissionLevel: 'interact',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['run', 'detail', 'list'],
        description: '操作类型。默认 run',
      },
      name: {
        type: 'string',
        description: 'run 时为工作流名称，detail 时为技能名称',
      },
      params: {
        type: 'object',
        description: 'run 时传给工作流的参数',
      },
      tab_id: {
        type: 'number',
        description: '目标标签页 ID',
      },
    },
    required: ['name'],
  },

  execute: async (
    rawParams: { action?: string; name?: string; params?: Record<string, unknown>; tab_id?: number; [key: string]: unknown },
    context?: ToolExecutionContext,
  ): Promise<FunctionResult> => {
    const action = String(rawParams?.action || 'run').trim().toLowerCase();

    switch (action) {
      case 'list':
        return handleList();

      case 'detail': {
        const skillName = String(rawParams?.name || '').trim();
        if (!skillName) return { success: false, error: '缺少技能名称' };
        return handleDetail(skillName);
      }

      case 'run':
      default:
        return handleRun(rawParams as Record<string, unknown>, context);
    }
  },
};
