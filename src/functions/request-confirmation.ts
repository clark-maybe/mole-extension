/**
 * request_confirmation 工具
 * AI 驱动的人机确认节点
 *
 * 职责：
 * 1. AI 判断需要用户确认时调用此工具
 * 2. 通过 Channel 广播确认请求到悬浮球
 * 3. 阻塞等待用户批准/拒绝
 * 4. 返回用户决策（含可选的拒绝附言）
 */

import type { FunctionDefinition, FunctionResult, ToolExecutionContext } from './types';
import Channel from '../lib/channel';

let requestCounter = 0;

export const requestConfirmationFunction: FunctionDefinition = {
  name: 'request_confirmation',
  description: 'Request user confirmation before performing sensitive or critical operations. The user will see a confirmation message and choose to approve or reject, optionally providing a reason when rejecting.',
  supportsParallel: false,
  permissionLevel: 'read',
  parameters: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'The confirmation message to present to the user, briefly describing the operation to be performed and its impact.',
      },
    },
    required: ['message'],
  },

  execute: async (
    params: { message?: string },
    context?: ToolExecutionContext,
  ): Promise<FunctionResult> => {
    const message = String(params.message || '').trim();
    if (!message) {
      return { success: false, error: 'Missing confirmation message' };
    }

    const requestId = `approval_${Date.now()}_${++requestCounter}`;
    const signal = context?.signal;

    // 广播确认请求到所有标签页（与 __ai_stream 一致的通信模式）
    Channel.broadcast('__approval_request', { requestId, message });

    // 阻塞等待用户响应
    return new Promise<FunctionResult>((resolve) => {
      let settled = false;

      const cleanup = () => {
        settled = true;
        Channel.off('__approval_response', handler);
        signal?.removeEventListener('abort', onAbort);
      };

      // 监听用户响应（匹配 requestId）
      const handler = (data: any) => {
        if (settled || data?.requestId !== requestId) return;
        cleanup();
        // 广播给所有标签页，同步更新卡片状态
        Channel.broadcast('__approval_settled', {
          requestId,
          approved: !!data.approved,
          userMessage: data.userMessage || '',
          trustAll: !!data.trustAll,
        });
        resolve({
          success: true,
          data: {
            approved: !!data.approved,
            userMessage: data.userMessage || undefined,
            trustAll: !!data.trustAll,
          },
        });
      };

      // abort 时清理并通知悬浮球取消
      const onAbort = () => {
        if (settled) return;
        cleanup();
        Channel.broadcast('__approval_cancel', { requestId });
        resolve({ success: false, error: 'Task cancelled' });
      };

      Channel.on('__approval_response', handler);

      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  },
};
