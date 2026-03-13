/**
 * 获取任意 URL 网页内容工具函数
 * 在后台打开隐藏标签页，由 content script 解析内容后返回，用户不会看到该页面
 */

import type { FunctionDefinition, ToolExecutionContext } from './types';
import { sendToTabWithRetry, waitForAnySelector, waitForTabComplete, withHiddenTab } from './tab-utils';

export const fetchUrlFunction: FunctionDefinition = {
  name: 'fetch_url',
  description: '获取指定 URL 的网页内容。无需用户打开该页面，AI 可以在后台读取任意网页的标题、正文、链接、标题层级等信息。适用于：深入阅读搜索结果链接、对比多个网页内容、总结指定文章、获取远程页面信息。',
  supportsParallel: true,
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: '要获取的网页 URL，必须是完整的 http/https 链接',
      },
      sections: {
        type: 'array',
        items: { type: 'string', enum: ['meta', 'content', 'links', 'headings'] },
        description: '要获取的信息部分。不传则返回全部。',
      },
      max_content_length: {
        type: 'number',
        description: '正文最大字符数，默认5000，范围500-10000',
      },
    },
    required: ['url'],
  },
  validate: (params: { url?: string }) => {
    if (!params.url) return '缺少 url';
    if (!/^https?:\/\//i.test(params.url)) return 'url 必须是 http/https 链接';
    return null;
  },
  execute: async (
    params: { url: string; sections?: string[]; max_content_length?: number },
    context?: ToolExecutionContext,
  ) => {
    const { url, sections, max_content_length = 5000 } = params;
    const signal = context?.signal;

    try {
      return await withHiddenTab(url, async (tabId) => {
        await waitForTabComplete(tabId, 24_000, '页面加载超时', signal);
        await waitForAnySelector(tabId, ['body', 'main', 'article', '[role="main"]'], 12_000, 280, signal);

        const response = await sendToTabWithRetry<{
          success: boolean;
          data?: any;
          error?: string;
        }>(
          tabId,
          '__parse_page_content',
          {
            sections,
            max_content_length: Math.min(Math.max(max_content_length, 500), 10000),
          },
          {
            attempts: 4,
            timeoutMs: 12_000,
            retryDelayMs: 500,
            shouldRetry: (res) => !res || res.success !== true,
            signal,
          },
        );

        if (!response || !response.success) {
          return { success: false, error: response?.error || '页面内容解析失败' };
        }

        return { success: true, data: response.data };
      }, signal);
    } catch (err: any) {
      return { success: false, error: err.message || '获取页面内容失败' };
    }
  },
};
