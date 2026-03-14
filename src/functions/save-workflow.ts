import type { FunctionDefinition, FunctionResult } from './types';
import { upsertUserWorkflow } from './site-workflow-registry';

// 保存用户确认的工作流
export const saveWorkflowFunction: FunctionDefinition = {
  name: 'save_workflow',
  description: '保存用户确认的工作流定义到 registry。仅在用户明确确认工作流内容后调用。将完整的 workflow JSON 对象序列化为字符串传入 workflow_json 参数。',
  supportsParallel: false,
  parameters: {
    type: 'object',
    properties: {
      workflow_json: {
        type: 'string',
        description: '完整的 workflow 定义 JSON 字符串，必须包含 name 和 plan 字段。示例：{"name":"search_product","label":"搜索商品","plan":{"steps":[...]}}',
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
      return { success: false, error: 'workflow_json 不是有效的 JSON 字符串' };
    }

    // 兼容嵌套传参
    if (workflow.workflow && typeof workflow.workflow === 'object') {
      workflow = workflow.workflow;
    }

    if (!workflow.name || !workflow.plan) {
      return { success: false, error: '缺少必要的 workflow 字段（name、plan）' };
    }

    const spec = {
      ...workflow,
      enabled: true,
      source: 'user',
      version: workflow.version || 1,
      createdAt: workflow.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
    const result = await upsertUserWorkflow(spec);
    return { success: result.success, data: result.message, error: result.success ? undefined : result.message };
  },
};
