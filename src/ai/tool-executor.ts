/**
 * 工具执行层
 * 职责：调用 MCP 工具、spawn_subtask 递归、结果截断、事件广播
 */

import type { InputItem, OutputFunctionCallItem, AIStreamEvent, ToolSchema } from './types';
import { mcpClient } from '../functions/registry';
import { truncateToolResult } from './context-manager';

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
export const executeToolCalls = async (
  calls: OutputFunctionCallItem[],
  tabId: number | undefined,
  signal: AbortSignal | undefined,
  emit: (event: AIStreamEvent) => void,
  runSubtask?: SubtaskRunner,
): Promise<InputItem[]> => {
  const results: InputItem[] = [];

  /** 执行单个工具调用（不含 emit function_call，由调用方控制） */
  const executeSingleTool = async (
    call: OutputFunctionCallItem,
  ): Promise<{ call: OutputFunctionCallItem; output: string }> => {
    const params = safeParseArgs(call.arguments);
    let output: string;

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
      return item.content;
    }
  }
  return '';
};
