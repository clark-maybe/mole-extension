/**
 * 浏览器历史记录搜索工具
 * 使用 chrome.history API 搜索浏览历史
 */

import type { FunctionDefinition } from './types';

export const historySearchFunction: FunctionDefinition = {
  name: 'history_search',
  description: '搜索浏览器历史记录。可以根据关键词搜索之前访问过的页面，或获取最近的浏览历史。适用于：找回之前看过的页面、回忆访问过的网站、了解用户近期浏览偏好。',
  supportsParallel: true,
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '搜索关键词。不传则返回最近的浏览历史',
      },
      max_results: {
        type: 'number',
        description: '最大返回数量，默认20，最大100',
      },
      days_back: {
        type: 'number',
        description: '搜索多少天内的历史，默认7天',
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
