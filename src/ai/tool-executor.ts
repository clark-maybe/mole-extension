/**
 * 工具执行层
 * 职责：调用 MCP 工具、spawn_subtask 递归、结果截断、事件广播
 */

import type { InputItem, OutputFunctionCallItem, AIStreamEvent, ToolSchema, MessageInputItem } from './types';
import { mcpClient } from '../functions/registry';
import { truncateToolResult, getTextContent } from './context-manager';
import { requestConfirmationFunction } from '../functions/request-confirmation';

/** 统一子 agent 执行器类型（由 orchestrator 注入，实现递归） */
export type SubagentRunner = (goal: string, signal?: AbortSignal) => Promise<InputItem[]>;

/** 子 agent 配置 */
interface SubagentConfig {
  /** 工具 schema 定义 */
  schema: ToolSchema;
  /** thinking 事件的前缀文案 */
  thinkingPrefix: string;
  /** 执行失败时的默认错误消息 */
  defaultErrorMessage: string;
  /** 执行成功但无输出时的默认消息 */
  defaultEmptyMessage: string;
}

/** 子 agent 配置注册表 */
const SUBAGENT_CONFIGS: Record<string, SubagentConfig> = {
  spawn_subtask: {
    schema: {
      type: 'function',
      name: 'spawn_subtask',
      description: '将一个独立的子目标拆分为隔离任务执行。子任务有自己独立的上下文，完成后返回结果摘要。适用于：任务包含多个互不依赖的子目标、需要跨多个网页分别操作、当前上下文已经很长需要隔离执行。不要用于简单的单步操作。',
      parameters: {
        type: 'object',
        properties: {
          goal: {
            type: 'string',
            description: '子任务的目标描述，要具体明确，包含必要的上下文信息',
          },
        },
        required: ['goal'],
      },
    },
    thinkingPrefix: '正在处理子任务',
    defaultErrorMessage: '子任务执行失败',
    defaultEmptyMessage: '子任务已完成但无明确输出',
  },
  explore: {
    schema: {
      type: 'function',
      name: 'explore',
      description: '启动探索子 agent 侦察页面结构和交互元素。探索 agent 在独立上下文中运行，只做观察不做写入操作，返回页面分析摘要和建议执行步骤。适合：首次访问陌生页面、需要了解页面结构再制定计划、复杂表单/流程的前期侦察。',
      parameters: {
        type: 'object',
        properties: {
          goal: {
            type: 'string',
            description: '探索目标描述，说明你想了解什么（如"了解这个表单有哪些字段和提交按钮"、"查看搜索结果的结构和翻页方式"）',
          },
        },
        required: ['goal'],
      },
    },
    thinkingPrefix: '正在探索',
    defaultErrorMessage: '探索执行失败',
    defaultEmptyMessage: '探索已完成但无明确输出',
  },
  plan: {
    schema: {
      type: 'function',
      name: 'plan',
      description: '启动规划子 agent 分析任务并制定执行计划。规划 agent 在独立上下文中观察页面、拆解目标，返回可直接用于 todo 的结构化步骤。适合：复杂多步任务开始前的整体规划、不确定最佳路径时的方案评估、需要根据页面现状调整策略时。',
      parameters: {
        type: 'object',
        properties: {
          goal: {
            type: 'string',
            description: '需要规划的任务目标，说明你想完成什么（如"在携程上订一张下周五北京到上海的高铁票"、"把这个表格的数据导出为 CSV 文件"）',
          },
        },
        required: ['goal'],
      },
    },
    thinkingPrefix: '正在规划',
    defaultErrorMessage: '规划执行失败',
    defaultEmptyMessage: '规划已完成但无明确输出',
  },
  review: {
    schema: {
      type: 'function',
      name: 'review',
      description: '启动独立审查 agent 验证操作结果。审查 agent 用干净上下文重新观察页面实际状态，对比预期结果，返回结构化的通过/未通过判定。适合：关键操作后验证（表单提交、数据提取、页面跳转）、多步任务的阶段性检查。不要用于简单的信息查询。',
      parameters: {
        type: 'object',
        properties: {
          goal: {
            type: 'string',
            description: '审查目标，说明预期状态和需要验证的内容（如"验证表单是否提交成功，页面应显示订单确认信息"、"检查搜索结果是否包含 AirPods Pro 的价格信息"）',
          },
        },
        required: ['goal'],
      },
    },
    thinkingPrefix: '正在审查',
    defaultErrorMessage: '审查执行失败',
    defaultEmptyMessage: '审查已完成但无明确输出',
  },
};

/** 返回所有注册的子 agent 名称列表 */
export const getSubagentNames = (): string[] => Object.keys(SUBAGENT_CONFIGS);

/** 返回所有子 agent 的 schema */
export const getSubagentSchemas = (): ToolSchema[] =>
  Object.values(SUBAGENT_CONFIGS).map(config => config.schema);

/** 判断是否是子 agent 工具 */
export const isSubagent = (name: string): boolean => name in SUBAGENT_CONFIGS;

/** 执行组类型：并行组或串行组 */
interface ExecutionGroup {
  type: 'parallel' | 'serial';
  calls: OutputFunctionCallItem[];
}

/**
 * 按 supportsParallel 标记将 calls 数组分组
 * 连续的 parallel 工具收集为一个并行组，serial 工具各自独立成组
 */
const buildExecutionGroups = async (calls: OutputFunctionCallItem[]): Promise<ExecutionGroup[]> => {
  const groups: ExecutionGroup[] = [];
  let currentParallelGroup: OutputFunctionCallItem[] = [];

  const flushParallelGroup = () => {
    if (currentParallelGroup.length > 0) {
      groups.push({ type: 'parallel', calls: [...currentParallelGroup] });
      currentParallelGroup = [];
    }
  };

  for (const call of calls) {
    // 子 agent 始终串行
    if (SUBAGENT_CONFIGS[call.name]) {
      flushParallelGroup();
      groups.push({ type: 'serial', calls: [call] });
      continue;
    }

    const parallel = await mcpClient.isParallel(call.name);
    if (parallel) {
      currentParallelGroup.push(call);
    } else {
      flushParallelGroup();
      groups.push({ type: 'serial', calls: [call] });
    }
  }

  // 收尾：清空剩余的并行组
  flushParallelGroup();

  return groups;
};

/**
 * 执行一批工具调用
 * 支持并行分流：连续的 supportsParallel 工具用 Promise.all 并发执行
 */
/** 会话级敏感操作信任标记：用户选择"本次不再询问"后置为 true，持续到 SW 重启 */
let sensitiveAccessTrusted = false;

/** 重置敏感操作信任标记（新会话时调用） */
export const resetSensitiveAccessTrust = () => { sensitiveAccessTrusted = false; };

export const executeToolCalls = async (
  calls: OutputFunctionCallItem[],
  tabId: number | undefined,
  signal: AbortSignal | undefined,
  emit: (event: AIStreamEvent) => void,
  subagentRunners?: Record<string, SubagentRunner>,
): Promise<InputItem[]> => {
  const results: InputItem[] = [];

  /** 敏感操作检测：需要用户确认的工具+参数组合 */
  const getSensitiveApprovalMessage = (name: string, params: Record<string, any>): string | null => {
    const action = String(params.action || '');
    if (name === 'cdp_dom') {
      const label = params.storage_type === 'session' ? 'sessionStorage' : 'localStorage';
      if (action === 'storage_get_items' || action === 'storage_get_item') {
        return `AI 正在请求读取页面的 ${label} 数据`;
      }
      if (action === 'storage_set_item') {
        return `AI 正在请求写入页面 ${label}（key: ${params.key || '?'}）`;
      }
      if (action === 'storage_remove_item') {
        return `AI 正在请求删除页面 ${label} 中的 "${params.key || '?'}"`;
      }
      if (action === 'storage_clear') {
        return `AI 正在请求清空页面的 ${label}`;
      }
    }
    if (name === 'cdp_network') {
      if (action === 'get_cookies') return 'AI 正在请求读取页面 Cookie';
      if (action === 'set_cookie') return `AI 正在请求设置 Cookie "${params.name || ''}"`;
      if (action === 'delete_cookie') return `AI 正在请求删除 Cookie "${params.name || ''}"`;
    }
    return null;
  };

  /**
   * 串行处理敏感操作确认
   * 返回 null 表示已通过（或无需确认），返回 string 表示被拒绝（值为 output）
   */
  const resolveSensitiveApproval = async (
    call: OutputFunctionCallItem,
  ): Promise<string | null> => {
    const params = safeParseArgs(call.arguments);
    const approvalMessage = getSensitiveApprovalMessage(call.name, params);
    if (!approvalMessage || sensitiveAccessTrusted) return null;

    const approvalResult = await requestConfirmationFunction.execute(
      { message: approvalMessage },
      { tabId, signal },
    );
    const approved = approvalResult.success && approvalResult.data?.approved;
    // 用户选择"本次不再询问"时，后续自动跳过确认
    if (approved && approvalResult.data?.trustAll) {
      sensitiveAccessTrusted = true;
    }
    if (approved) return null;

    // 被拒绝：emit 结果并返回 output
    const output = JSON.stringify({
      success: false,
      error: approvalResult.data?.userMessage || '用户拒绝了敏感数据访问请求',
    });
    emit({
      type: 'function_result',
      content: JSON.stringify({
        name: call.name,
        callId: call.call_id,
        success: false,
        message: '用户拒绝',
        cancelled: false,
      }),
    });
    return output;
  };

  /** 执行单个工具调用（不含 emit function_call，由调用方控制；确认已在外部完成） */
  const executeSingleTool = async (
    call: OutputFunctionCallItem,
  ): Promise<{ call: OutputFunctionCallItem; output: string }> => {
    const params = safeParseArgs(call.arguments);
    let output: string;

    const subagentConfig = SUBAGENT_CONFIGS[call.name];
    const runner = subagentRunners?.[call.name];
    if (subagentConfig && runner) {
      // 统一子 agent 执行
      const goal = String(params.goal || '');
      emit({ type: 'thinking', content: `${subagentConfig.thinkingPrefix}：${goal.slice(0, 60)}` });

      try {
        const subContext = await runner(goal, signal);
        const lastReply = extractLastAssistantReply(subContext);
        output = JSON.stringify({
          success: true,
          data: { summary: lastReply || subagentConfig.defaultEmptyMessage },
        });
      } catch (err: any) {
        output = JSON.stringify({
          success: false,
          error: err?.message || subagentConfig.defaultErrorMessage,
        });
      }
    } else {
      // 常规工具执行
      try {
        const result = await mcpClient.callTool(
          call.name,
          params,
          { tabId },
          { signal },
        );
        const text = result.content?.[0]?.text || '{}';
        output = truncateToolResult(text);
      } catch (err: any) {
        if (signal?.aborted) {
          output = JSON.stringify({ success: false, error: '任务已取消' });
        } else {
          output = JSON.stringify({
            success: false,
            error: err?.message || '工具执行异常',
          });
        }
      }
    }

    // 从 output 中提取 success/error 供 UI 层展示
    let resultSuccess = true;
    let resultMessage = '';
    let resultCancelled = false;
    try {
      const parsed = JSON.parse(output);
      resultSuccess = parsed.success !== false;
      resultMessage = parsed.error || parsed.data?.summary || '';
      resultCancelled = signal?.aborted === true && !resultSuccess;
    } catch {
      // output 解析失败，保持默认值
    }

    // 工具执行完成后立即 emit 结果（并行组内按完成顺序 emit）
    emit({
      type: 'function_result',
      content: JSON.stringify({
        name: call.name,
        callId: call.call_id,
        success: resultSuccess,
        message: resultMessage,
        cancelled: resultCancelled,
      }),
    });

    return { call, output };
  };

  // 构建执行分组
  const groups = await buildExecutionGroups(calls);

  for (const group of groups) {
    if (signal?.aborted) break;

    if (group.type === 'serial' || group.calls.length === 1) {
      // 串行执行（包括只有 1 个工具的"并行组"退化为串行）
      for (const call of group.calls) {
        if (signal?.aborted) break;

        // 串行路径：先确认再执行
        const rejected = await resolveSensitiveApproval(call);
        if (rejected) {
          results.push({ type: 'function_call_output' as const, call_id: call.call_id, output: rejected });
          continue;
        }

        emit({
          type: 'function_call',
          content: JSON.stringify({
            name: call.name,
            callId: call.call_id,
            arguments: call.arguments,
          }),
        });

        const { output } = await executeSingleTool(call);

        results.push({
          type: 'function_call_output' as const,
          call_id: call.call_id,
          output,
        });
      }
    } else {
      // 并行执行：先串行完成所有敏感操作确认，再并发执行工具
      const approvedCalls: OutputFunctionCallItem[] = [];
      for (const call of group.calls) {
        if (signal?.aborted) break;
        const rejected = await resolveSensitiveApproval(call);
        if (rejected) {
          results.push({ type: 'function_call_output' as const, call_id: call.call_id, output: rejected });
        } else {
          approvedCalls.push(call);
        }
      }

      // emit 所有已通过确认的 function_call 事件
      for (const call of approvedCalls) {
        emit({
          type: 'function_call',
          content: JSON.stringify({
            name: call.name,
            callId: call.call_id,
            arguments: call.arguments,
          }),
        });
      }

      // Promise.all 并发执行
      const groupResults = await Promise.all(
        approvedCalls.map((call) => executeSingleTool(call)),
      );

      // 按原始 calls 顺序 push 到 results（保持与输入顺序一致）
      for (const { call, output } of groupResults) {
        results.push({
          type: 'function_call_output' as const,
          call_id: call.call_id,
          output,
        });
      }
    }
  }

  return results;
};

/** 安全解析工具参数 */
const safeParseArgs = (raw: string): Record<string, any> => {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
};

/** 从上下文中提取最后一条助手回复 */
const extractLastAssistantReply = (context: InputItem[]): string => {
  for (let i = context.length - 1; i >= 0; i--) {
    const item = context[i];
    if ('role' in item && item.role === 'assistant') {
      return getTextContent((item as MessageInputItem).content);
    }
  }
  return '';
};
