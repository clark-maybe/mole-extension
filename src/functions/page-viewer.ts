/**
 * 网页查看函数
 * 获取用户当前浏览的网页信息，向当前标签页的 content script 请求页面数据
 */

import type { FunctionDefinition, ToolExecutionContext } from './types';
import { sendToTabWithRetry } from './tab-message';

/** 获取当前活动标签页 ID 作为 fallback */
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

export const pageViewerFunction: FunctionDefinition = {
  name: 'page_viewer',
  description: '获取用户当前正在浏览的网页信息。可获取页面URL、标题、meta信息、正文内容、链接列表、标题层级等。适用于：用户询问当前页面相关问题、需要理解用户浏览上下文、总结或分析当前页面内容时。\n\n⚠️ 不要用此工具来：\n- 获取可交互元素的 element_id（用 page_snapshot）\n- 检查元素是否存在或可见（用 page_assert）\n- 了解页面布局结构（用 page_skeleton）',
  supportsParallel: true,
  permissionLevel: 'read',
  parameters: {
    type: 'object',
    properties: {
      sections: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['meta', 'content', 'links', 'headings'],
        },
        description: '要获取的信息部分，可选值：meta(页面元信息)、content(正文内容)、links(链接列表)、headings(标题层级)。不传则返回全部信息。',
      },
      max_content_length: {
        type: 'number',
        description: '正文内容的最大字符数，默认3000，范围500-10000',
      },
      tab_id: {
        type: 'number',
        description: '目标标签页 ID。不传则操作当前活动标签页。',
      },
    },
    required: [],
  },
  execute: async (
    params: { sections?: string[]; max_content_length?: number; tab_id?: number },
    context?: ToolExecutionContext,
  ) => {
    // 确定目标 tabId（优先级：params.tab_id > context.tabId > 当前活动标签页）
    const { tab_id } = params;
    let tabId: number;
    if (typeof tab_id === 'number' && tab_id > 0) {
      tabId = tab_id;
    } else if (typeof context?.tabId === 'number' && context.tabId > 0) {
      tabId = context.tabId;
    } else {
      const activeTabId = await getActiveTabId();
      if (!activeTabId) {
        return { success: false, error: '无法获取当前标签页' };
      }
      tabId = activeTabId;
    }

    try {
      // 向 content script 发送解析请求
      const response = await sendToTabWithRetry<{
        success: boolean;
        data?: any;
        error?: string;
      }>(tabId, '__parse_page_content', {
        sections: params.sections,
        max_content_length: params.max_content_length,
      }, {
        signal: context?.signal,
        deadlineMs: 12000,
        timeoutMessage: '等待页面内容解析超时',
      });

      if (!response || !response.success) {
        return { success: false, error: response?.error || '解析页面内容失败' };
      }

      return {
        success: true,
        data: response.data,
      };
    } catch (err: any) {
      return { success: false, error: err.message || '网页查看执行失败' };
    }
  },
};
