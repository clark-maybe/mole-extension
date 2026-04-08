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
  description: 'Retrieve information about the web page the user is currently viewing. Can obtain page URL, title, meta info, body content, link list, heading hierarchy, etc. Use when: the user asks about the current page, you need to understand the browsing context, or summarize/analyze the current page content.\n\n⚠️ Do NOT use this tool for:\n- Getting element_id of interactive elements (use page_snapshot)\n- Checking whether an element exists or is visible (use page_assert)\n- Understanding page layout structure (use page_skeleton)',
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
        description: 'Sections to retrieve. Options: meta (page metadata), content (body text), links (link list), headings (heading hierarchy). Returns all sections if omitted.',
      },
      max_content_length: {
        type: 'number',
        description: 'Maximum character count for body content. Default: 3000, range: 500-10000.',
      },
      tab_id: {
        type: 'number',
        description: 'Target tab ID. Uses the current active tab if omitted.',
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
        return { success: false, error: 'Unable to get current tab' };
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
        timeoutMessage: 'Timed out waiting for page content parsing',
      });

      if (!response || !response.success) {
        return { success: false, error: response?.error || 'Failed to parse page content' };
      }

      return {
        success: true,
        data: response.data,
      };
    } catch (err: any) {
      return { success: false, error: err.message || 'Page viewer execution failed' };
    }
  },
};
