/**
 * 页面骨架树工具
 * 返回层级化的页面结构概览，让 AI 快速理解页面布局
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

export const pageSkeletonFunction: FunctionDefinition = {
  name: 'page_skeleton',
  description: [
    'Get the hierarchical skeleton structure of the current page, returning a simplified text representation similar to an Accessibility Tree.',
    'Understand overall page layout, section divisions, and interactive element distribution with minimal tokens.',
    'Best used before performing actions to get the global structure first, then use page_snapshot to precisely locate specific elements.',
    'Interactive elements are automatically assigned element_id and can be used directly with cdp_input.',
    'Supports expand_selector for progressively expanding specific regions.',
    '\n\n⚠️ Do NOT use this tool for:',
    '- When you need detailed element info or element_id (use page_snapshot)',
    '- When you need page body content (use page_viewer)',
    '- Only for quickly understanding overall page layout and section divisions',
  ].join('\n'),
  supportsParallel: true,
  permissionLevel: 'read',
  parameters: {
    type: 'object',
    properties: {
      scope_selector: {
        type: 'string',
        description: 'Optional: CSS selector to limit skeleton tree scope, e.g. "main", "#content". Defaults to the entire body.',
      },
      expand_selector: {
        type: 'string',
        description: 'Optional: CSS selector for a region to expand with detailed structure, e.g. ".product-list". This region gets deeper level expansion.',
      },
      max_depth: {
        type: 'number',
        description: 'Maximum traversal depth. Range: 3-12, default: 6. Expanded regions get 4 additional levels.',
      },
      max_nodes: {
        type: 'number',
        description: 'Maximum number of nodes in the skeleton tree. Range: 50-300, default: 150.',
      },
      include_hidden: {
        type: 'boolean',
        description: 'Whether to include hidden elements. Default: false.',
      },
      tab_id: {
        type: 'number',
        description: 'Target tab ID. Uses the current active tab if omitted.',
      },
    },
    required: [],
  },
  execute: async (
    params: {
      scope_selector?: string;
      expand_selector?: string;
      max_depth?: number;
      max_nodes?: number;
      include_hidden?: boolean;
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
        return { success: false, error: 'Unable to get current tab' };
      }
      tabId = activeTabId;
    }

    try {
      const response = await sendToTabWithRetry<{ success: boolean; data?: any; error?: string }>(
        tabId,
        '__page_skeleton_build',
        params,
        {
          signal: context?.signal,
          deadlineMs: 12000,
          timeoutMessage: 'Timed out waiting for page skeleton tree',
        },
      );
      if (!response?.success) {
        return { success: false, error: response?.error || 'Page skeleton tree build failed' };
      }
      return { success: true, data: response.data };
    } catch (err: any) {
      return { success: false, error: err.message || 'Page skeleton tree build failed' };
    }
  },
};
