/**
 * 剪贴板操作工具
 * 通过 content script 侧的 navigator.clipboard API 实现读写剪贴板
 */

import type { FunctionDefinition, ToolExecutionContext } from './types';
import Channel from '../lib/channel';

/** 向 tab 发送消息并等待响应 */
const sendAndWait = <T = any>(tabId: number, type: string, data: any, signal?: AbortSignal): Promise<T> => {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const abortError = new Error('aborted');
      abortError.name = 'AbortError';
      reject(abortError);
      return;
    }

    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      reject(new Error('等待剪贴板操作超时'));
    }, 10000);

    const onAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      const abortError = new Error('aborted');
      abortError.name = 'AbortError';
      reject(abortError);
    };

    Channel.sendToTab(tabId, type, data, (response: any) => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });

    signal?.addEventListener('abort', onAbort, { once: true });
  });
};

export const clipboardOpsFunction: FunctionDefinition = {
  name: 'clipboard_ops',
  description: 'Read from or write to the user clipboard. Write: copy text to the clipboard so the user can paste it elsewhere. Read: retrieve clipboard content as input.\n\n⚠️ Do NOT use this tool to:\n- Pass intermediate AI results (use them directly in context)\n- Only use when the user explicitly needs copy/paste',
  supportsParallel: false,
  permissionLevel: 'interact',
  actionPermissions: { read: 'sensitive' },
  approvalMessageTemplate: { read: 'AI 正在请求读取剪贴板内容' },
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['read', 'write'],
        description: 'Action type: read (read clipboard), write (write to clipboard)',
      },
      text: {
        type: 'string',
        description: 'Text to write to clipboard (required when action=write)',
      },
    },
    required: ['action'],
  },
  execute: async (params: { action: string; text?: string }, context?: ToolExecutionContext) => {
    let tabId = context?.tabId;
    if (!tabId) {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = activeTab?.id;
    }
    if (!tabId) {
      return { success: false, error: '无法获取当前标签页' };
    }

    try {
      const response = await sendAndWait<{ success: boolean; data?: any; error?: string }>(
        tabId, '__clipboard_ops', params, context?.signal
      );

      if (!response || !response.success) {
        return { success: false, error: response?.error || '剪贴板操作失败' };
      }

      return { success: true, data: response.data };
    } catch (err: any) {
      return { success: false, error: err.message || '剪贴板操作失败' };
    }
  },
};
