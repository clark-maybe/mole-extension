/**
 * 工具执行层
 * 职责：调用 MCP 工具、spawn_subtask 递归、结果截断、事件广播
 */

import type { InputItem, OutputFunctionCallItem, AIStreamEvent, ToolSchema, MessageInputItem } from './types';
import { mcpClient } from '../functions/registry';
import { truncateToolResult, getTextContent } from './context-manager';
import { requestConfirmationFunction } from '../functions/request-confirmation';

/** 子任务执行器类型（由 orchestrator 注入，实现递归） */
export type SubtaskRunner = (goal: string, signal?: AbortSignal) => Promise<InputItem[]>;

/** spawn_subtask 工具 Schema */
export const SPAWN_SUBTASK_SCHEMA: ToolSchema = {
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
};

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
    // spawn_subtask 始终串行
    if (call.name === 'spawn_subtask') {
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
  runSubtask?: SubtaskRunner,
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

  /** 执行单个工具调用（不含 emit function_call，由调用方控制） */
  const executeSingleTool = async (
    call: OutputFunctionCallItem,
  ): Promise<{ call: OutputFunctionCallItem; output: string }> => {
    const params = safeParseArgs(call.arguments);
    let output: string;

    // ── 敏感操作拦截：自动请求用户确认 ──
    const approvalMessage = getSensitiveApprovalMessage(call.name, params);
    if (approvalMessage && !sensitiveAccessTrusted) {
      const approvalResult = await requestConfirmationFunction.execute(
        { message: approvalMessage },
        { tabId, signal },
      );
      const approved = approvalResult.success && approvalResult.data?.approved;
      // 用户选择"本次不再询问"时，后续自动跳过确认
      if (approved && approvalResult.data?.trustAll) {
        sensitiveAccessTrusted = true;
      }
      if (!approved) {
        output = JSON.stringify({
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

        return { call, output };
      }
    }

    if (call.name === 'spawn_subtask' && runSubtask) {
      // 子任务递归
      const goal = String(params.goal || '');
      emit({ type: 'thinking', content: `正在处理子任务：${goal.slice(0, 60)}` });

      try {
        const subContext = await runSubtask(goal, signal);
        const lastReply = extractLastAssistantReply(subContext);
        output = JSON.stringify({
          success: true,
          data: { summary: lastReply || '子任务已完成但无明确输出' },
        });
      } catch (err: any) {
        output = JSON.stringify({
          success: false,
          error: err?.message || '子任务执行失败',
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
      // 并行执行：先 emit 所有 function_call 事件，再并发执行
      for (const call of group.calls) {
        emit({
          type: 'function_call',
          content: JSON.stringify({
            name: call.name,
            callId: call.call_id,
            arguments: call.arguments,
          }),
        });
      }

      // Promise.all 并发执行，按完成顺序 emit function_result
      const groupResults = await Promise.all(
        group.calls.map((call) => executeSingleTool(call)),
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
