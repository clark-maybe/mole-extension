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

/**
 * 执行一批工具调用
 */
export const executeToolCalls = async (
  calls: OutputFunctionCallItem[],
  tabId: number | undefined,
  signal: AbortSignal | undefined,
  emit: (event: AIStreamEvent) => void,
  runSubtask?: SubtaskRunner,
): Promise<InputItem[]> => {
  const results: InputItem[] = [];

  for (const call of calls) {
    if (signal?.aborted) break;

    const params = safeParseArgs(call.arguments);

    emit({
      type: 'function_call',
      content: JSON.stringify({
        name: call.name,
        call_id: call.call_id,
        arguments: call.arguments,
      }),
    });

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

    emit({
      type: 'function_result',
      content: JSON.stringify({
        name: call.name,
        call_id: call.call_id,
        output,
      }),
    });

    results.push({
      type: 'function_call_output' as const,
      call_id: call.call_id,
      output,
    });
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
