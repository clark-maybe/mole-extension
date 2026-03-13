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
  description: '获取用户当前正在浏览的网页信息。可获取页面URL、标题、meta信息、正文内容、链接列表、标题层级等。适用于：用户询问当前页面相关问题、需要理解用户浏览上下文、总结或分析当前页面内容时。',
  supportsParallel: true,
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
    },
    required: [],
  },
  execute: async (
    params: { sections?: string[]; max_content_length?: number },
    context?: ToolExecutionContext,
  ) => {
    // 优先使用 context 中的 tabId，fallback 到当前活动标签页
    let tabId = context?.tabId;
    if (!tabId) {
      tabId = (await getActiveTabId()) ?? undefined;
    }

    if (!tabId) {
      return { success: false, error: '无法获取当前标签页' };
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
