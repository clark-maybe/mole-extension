import type { FunctionDefinition, FunctionResult } from './types';
import { upsertUserWorkflow as upsertOldUserWorkflow } from './site-workflow-registry';
import { upsertUserWorkflow as upsertSkillUserWorkflow } from './skill-registry';
import { getBuiltinFunction } from './registry';

// 保存用户确认的工作流
export const saveWorkflowFunction: FunctionDefinition = {
  name: 'save_workflow',
  description: 'Save a user-confirmed workflow definition to the registry. Only call this after the user has explicitly confirmed the workflow content. Pass the complete workflow JSON object serialized as a string to the workflow_json parameter.',
  supportsParallel: false,
  permissionLevel: 'interact',
  parameters: {
    type: 'object',
    properties: {
      workflow_json: {
        type: 'string',
        description: 'Complete workflow definition as a JSON string. Must contain name and plan fields. Example: {"name":"search_product","label":"Search Product","plan":{"steps":[...]}}',
      },
    },
    required: ['workflow_json'],
  },
  execute: async (params: Record<string, any>): Promise<FunctionResult> => {
    // 解析 JSON 字符串
    let workflow: any;
    try {
      const raw = params.workflow_json || params.workflow || params;
      workflow = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return { success: false, error: 'workflow_json is not a valid JSON string' };
    }

    // 兼容嵌套传参
    if (workflow.workflow && typeof workflow.workflow === 'object') {
      workflow = workflow.workflow;
    }

    if (!workflow.name || !workflow.plan) {
      return { success: false, error: 'Missing required workflow fields (name, plan)' };
    }

    // 校验 plan.steps 中每个 action 是否为合法的内置工具名称
    const steps = workflow.plan?.steps;
    if (Array.isArray(steps)) {
      for (let i = 0; i < steps.length; i++) {
        const action = steps[i]?.action;
        if (!action || !getBuiltinFunction(action)) {
          return {
            success: false,
            error: `Step ${i + 1} action "${action || '(empty)'}" is not a valid built-in tool name`,
          };
        }
      }
    }

    const spec = {
      ...workflow,
      enabled: true,
      source: 'user',
      version: workflow.version || 1,
      createdAt: workflow.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
    // 保存到新 Skill 注册表
    const skillResult = await upsertSkillUserWorkflow(spec);
    // 同时保存到旧注册表（向后兼容）
    await upsertOldUserWorkflow(spec);
    return { success: skillResult.success, data: skillResult.message, error: skillResult.success ? undefined : skillResult.message };
  },
};
