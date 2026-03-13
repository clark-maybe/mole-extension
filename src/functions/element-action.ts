/**
 * 基于 element_id 的动作工具
 * 配合 page_snapshot 使用，避免模型在陌生网站上硬写 selector
 */

import type { FunctionDefinition, ToolExecutionContext } from './types';
import { sendToTabWithRetry } from './tab-message';

const getActiveTabId = (): Promise<number | null> => {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs.length > 0 && tabs[0].id) {
        resolve(tabs[0].id);
      } else {
        resolve(null);
      }
    });
  });
};

export const elementActionFunction: FunctionDefinition = {
  name: 'element_action',
  description: [
    '对 page_snapshot 返回的 element_id 执行动作。',
    '优先传 element_id；只有句柄失效时才退回 selector。',
    '支持 click/fill/focus/get_info/press_key/scroll_into_view/select/hover。',
  ].join(' '),
  supportsParallel: false,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['click', 'fill', 'focus', 'get_info', 'press_key', 'scroll_into_view', 'select', 'hover'],
        description: '动作类型。',
      },
      element_id: {
        type: 'string',
        description: 'page_snapshot 返回的元素句柄 ID。优先使用该字段。',
      },
      selector: {
        type: 'string',
        description: '可选：当 element_id 失效时使用的 CSS selector 兜底。',
      },
      value: {
        type: 'string',
        description: 'fill/select 时需要填写或选择的值。',
      },
      key: {
        type: 'string',
        description: 'press_key 时要触发的按键，如 Enter、Tab。',
      },
      modifiers: {
        type: 'array',
        items: { type: 'string' },
        description: 'press_key 的组合键，可选 ctrl/shift/alt/meta。',
      },
    },
    required: ['action'],
  },
  validate: (params: { action?: string; element_id?: string; selector?: string; value?: string; key?: string }) => {
    if (!params?.action) return '缺少 action';
    if (!params.element_id && !params.selector) {
      return '至少需要提供 element_id 或 selector';
    }
    if ((params.action === 'fill' || params.action === 'select') && typeof params.value !== 'string') {
      return `${params.action} 需要提供 value`;
    }
    if (params.action === 'press_key' && !params.key) {
      return 'press_key 需要提供 key';
    }
    return null;
  },
  execute: async (
    params: {
      action: 'click' | 'fill' | 'focus' | 'get_info' | 'press_key' | 'scroll_into_view' | 'select' | 'hover';
      element_id?: string;
      selector?: string;
      value?: string;
      key?: string;
      modifiers?: string[];
    },
    context?: ToolExecutionContext,
  ) => {
    let tabId = context?.tabId;
    if (!tabId) {
      tabId = (await getActiveTabId()) ?? undefined;
    }
    if (!tabId) {
      return { success: false, error: '无法获取当前标签页' };
    }

    try {
      const response = await sendToTabWithRetry<{ success: boolean; data?: any; error?: string }>(
        tabId,
        '__page_grounding_action',
        params,
        {
          signal: context?.signal,
          deadlineMs: 12000,
          timeoutMessage: '等待 element_action 响应超时',
        },
      );
      if (!response?.success) {
        return { success: false, error: response?.error || 'element_action 执行失败' };
      }
      return { success: true, data: response.data };
    } catch (err: any) {
      return { success: false, error: err.message || 'element_action 执行失败' };
    }
  },
};
