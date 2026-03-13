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
  description: '读取或写入用户剪贴板。写入：将文本复制到剪贴板，方便用户粘贴到其他地方。读取：获取用户剪贴板中的内容作为输入。',
  supportsParallel: false,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['read', 'write'],
        description: '操作类型：read(读取剪贴板)、write(写入到剪贴板)',
      },
      text: {
        type: 'string',
        description: '要写入剪贴板的文本（action=write 时必传）',
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
