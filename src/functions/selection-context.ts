/**
 * 获取用户选中文本工具
 * 通过 content script 侧的 window.getSelection() 获取用户选中的文本及上下文
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
      reject(new Error('等待获取选中文本超时'));
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

export const selectionContextFunction: FunctionDefinition = {
  name: 'selection_context',
  description: 'Get the text content selected (highlighted) by the user on the page. Use cases: user selects text and asks AI to translate, explain, summarize, or analyze it. Returns empty if no text is selected.',
  supportsParallel: true,
  permissionLevel: 'read',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (_params: any, context?: ToolExecutionContext) => {
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
        tabId, '__get_selection', {}, context?.signal
      );

      if (!response || !response.success) {
        return { success: false, error: response?.error || '获取选中文本失败' };
      }

      return { success: true, data: response.data };
    } catch (err: any) {
      return { success: false, error: err.message || '获取选中文本失败' };
    }
  },
};
