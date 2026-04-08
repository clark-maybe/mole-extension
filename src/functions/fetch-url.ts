/**
 * 获取任意 URL 网页内容工具函数
 * 在后台打开隐藏标签页，由 content script 解析内容后返回，用户不会看到该页面
 */

import type { FunctionDefinition, ToolExecutionContext } from './types';
import { sendToTabWithRetry, waitForAnySelector, waitForTabComplete, withHiddenTab } from './tab-utils';

export const fetchUrlFunction: FunctionDefinition = {
  name: 'fetch_url',
  description: 'Fetch the content of a specified URL. No need for the user to open the page — AI can read any webpage\'s title, body text, links, heading hierarchy, etc. in the background. Use cases: deep-reading search result links, comparing multiple webpages, summarizing articles, fetching remote page info.\n\n⚠️ Do NOT use this tool for:\n- Getting content of the page the user is currently browsing (use page_viewer for richer context)\n- When you need interactive element information (use page_snapshot)',
  supportsParallel: true,
  permissionLevel: 'read',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The webpage URL to fetch, must be a full http/https link',
      },
      sections: {
        type: 'array',
        items: { type: 'string', enum: ['meta', 'content', 'links', 'headings'] },
        description: 'Sections of information to retrieve. Returns all if omitted.',
      },
      max_content_length: {
        type: 'number',
        description: 'Maximum character count for body text, default 5000, range 500-10000',
      },
    },
    required: ['url'],
  },
  validate: (params: { url?: string }) => {
    if (!params.url) return 'Missing url';
    if (!/^https?:\/\//i.test(params.url)) return 'url must be an http/https link';
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
