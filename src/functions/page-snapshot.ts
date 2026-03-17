/**
 * 页面语义快照工具
 * 返回可供模型定位和决策的元素候选列表，而不是要求模型先写 selector
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

export const pageSnapshotFunction: FunctionDefinition = {
  name: 'page_snapshot',
  description: [
    '获取当前页面的语义化快照，返回可交互/可阅读元素候选列表。',
    '每个候选都会带 element_id、文本、标签、role、是否可点击/可编辑、可见性、位置和 selector 候选。',
    '适合陌生网站自动化：先用 page_snapshot(query=...) 找到候选元素，再用 cdp_input(element_id=...) 基于 element_id 执行动作。',
  ].join(' '),
  supportsParallel: true,
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '可选：自然语言定位词，如“搜索框”“登录按钮”“商品价格”“发送”。传入后会按相关性排序。',
      },
      scope_selector: {
        type: 'string',
        description: '可选：限定扫描范围的 CSS selector，例如 "main"、"form"、"#content"。',
      },
      include_non_interactive: {
        type: 'boolean',
        description: '是否额外包含非交互元素。默认 false。查文本信息时可设为 true。',
      },
      include_hidden: {
        type: 'boolean',
        description: '是否包含隐藏元素。默认 false。',
      },
      only_viewport: {
        type: 'boolean',
        description: '是否仅返回当前视口内元素。默认 false。',
      },
      limit: {
        type: 'number',
        description: '最多返回多少个候选元素，范围 1-60，默认 20。',
      },
      tab_id: {
        type: 'number',
        description: '目标标签页 ID。不传则操作当前活动标签页。',
      },
    },
    required: [],
  },
  execute: async (
    params: {
      query?: string;
      scope_selector?: string;
      include_non_interactive?: boolean;
      include_hidden?: boolean;
      only_viewport?: boolean;
      limit?: number;
      tab_id?: number;
    },
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
      const response = await sendToTabWithRetry<{ success: boolean; data?: any; error?: string }>(
        tabId,
        '__page_grounding_snapshot',
        params,
        {
          signal: context?.signal,
          deadlineMs: 12000,
          timeoutMessage: '等待页面语义快照超时',
        },
      );
      if (!response?.success) {
        return { success: false, error: response?.error || '页面语义快照失败' };
      }
      return { success: true, data: response.data };
    } catch (err: any) {
      return { success: false, error: err.message || '页面语义快照失败' };
    }
  },
};
