/**
 * 浏览器历史记录搜索工具
 * 使用 chrome.history API 搜索浏览历史
 */

import type { FunctionDefinition } from './types';

export const historySearchFunction: FunctionDefinition = {
  name: 'history_search',
  description: 'Search browser history. Search previously visited pages by keyword, or retrieve recent browsing history. Use cases: find a previously viewed page, recall visited websites, understand recent browsing preferences.',
  supportsParallel: true,
  permissionLevel: 'read',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search keyword. If omitted, returns recent browsing history',
      },
      max_results: {
        type: 'number',
        description: 'Maximum number of results, default 20, max 100',
      },
      days_back: {
        type: 'number',
        description: 'Number of days to search back, default 7',
      },
    },
    required: [],
  },
  execute: async (params: { query?: string; max_results?: number; days_back?: number }) => {
    const { query = '', max_results = 20, days_back = 7 } = params;
    const safeMax = Math.min(Math.max(max_results, 1), 100);
    const startTime = Date.now() - days_back * 24 * 60 * 60 * 1000;

    try {
      const results = await chrome.history.search({
        text: query,
        maxResults: safeMax,
        startTime,
      });

      const items = results.map(item => ({
        title: item.title || '',
        url: item.url || '',
        visit_count: item.visitCount || 0,
        last_visit: item.lastVisitTime
          ? new Date(item.lastVisitTime).toLocaleString('zh-CN')
          : undefined,
      }));

      return {
        success: true,
        data: {
          query: query || '(最近浏览)',
          total: items.length,
          days_back,
          history: items,
        },
      };
    } catch (err: any) {
      return { success: false, error: err.message || '搜索历史记录失败' };
    }
  },
};
