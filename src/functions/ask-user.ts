/**
 * ask_user 工具
 * AI 主动提问节点 — 向用户提出问题并等待回答
 *
 * 职责：
 * 1. AI 判断需要获取用户信息或让用户做选择时调用此工具
 * 2. 通过 Channel 广播提问请求到悬浮球
 * 3. 阻塞等待用户选择选项或输入文本
 * 4. 返回用户的回答（含答案来源）
 */

import type { FunctionDefinition, FunctionResult, ToolExecutionContext } from './types';
import Channel from '../lib/channel';

let requestCounter = 0;

export const askUserFunction: FunctionDefinition = {
  name: 'ask_user',
  description: '向用户提出问题，获取缺失信息或让用户做出选择。支持预设选项和/或自由文本输入。用户回答后继续执行任务。',
  supportsParallel: false,
  permissionLevel: 'read',
  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: '向用户展示的问题，简洁明确地说清楚需要什么信息',
      },
      options: {
        type: 'array',
        items: { type: 'string' },
        description: '可选，预设选项列表（1-6 个），用户可点选',
      },
      allow_free_text: {
        type: 'boolean',
        description: '是否允许自由文本输入，默认 true',
      },
    },
    required: ['question'],
  },

  execute: async (
    params: { question?: string; options?: string[]; allow_free_text?: boolean },
    context?: ToolExecutionContext,
  ): Promise<FunctionResult> => {
    const question = String(params.question || '').trim();
    if (!question) {
      return { success: false, error: '缺少问题内容' };
    }

    // 规范化参数
    const options = Array.isArray(params.options)
      ? params.options.map(o => String(o || '').trim()).filter(Boolean).slice(0, 6)
      : [];
    const allowFreeText = params.allow_free_text !== false; // 默认 true

    // 校验：如果没有选项也不允许文本输入，则无法交互
    if (options.length === 0 && !allowFreeText) {
      return { success: false, error: '参数错误：options 为空且 allow_free_text 为 false，用户无法回答' };
    }

    const requestId = `ask_${Date.now()}_${++requestCounter}`;
    const signal = context?.signal;

    // 广播提问请求到所有标签页
    Channel.broadcast('__ask_user_request', {
      requestId,
      question,
      options: options.length > 0 ? options : undefined,
      allowFreeText,
    });

    // 阻塞等待用户回答
    return new Promise<FunctionResult>((resolve) => {
      let settled = false;

      const cleanup = () => {
        settled = true;
        Channel.off('__ask_user_response', handler);
        signal?.removeEventListener('abort', onAbort);
      };

      // 监听用户回答（匹配 requestId）
      const handler = (data: any) => {
        if (settled || data?.requestId !== requestId) return;
        cleanup();
        // 广播给所有标签页，同步更新卡片状态
        Channel.broadcast('__ask_user_settled', {
          requestId,
          answer: String(data.answer || ''),
          source: data.source === 'option' ? 'option' : 'text',
        });
        resolve({
          success: true,
          data: {
            answer: String(data.answer || ''),
            source: data.source === 'option' ? 'option' : 'text',
          },
        });
      };

      // abort 时清理并通知悬浮球取消
      const onAbort = () => {
        if (settled) return;
        cleanup();
        Channel.broadcast('__ask_user_cancel', { requestId });
        resolve({ success: false, error: '任务已取消' });
      };

      Channel.on('__ask_user_response', handler);

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
