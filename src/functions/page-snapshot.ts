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
    'Get a semantic snapshot of the current page, returning a candidate list of interactive/readable elements.',
    'Each candidate includes element_id, text, tag, role, clickable/editable status, visibility, position, and selector candidates.',
    'Ideal for automating unfamiliar websites: first use page_snapshot(query=...) to find candidate elements, then use cdp_input(element_id=...) to perform actions based on element_id.',
    '\n\n⚠️ Do NOT use this tool for:',
    '- When you only need plain text content (use page_viewer, lighter weight)',
    '- Verifying whether an action result meets expectations (use page_assert)',
    '- When you only need to understand overall page layout (use page_skeleton, lighter weight)',
  ].join('\n'),
  supportsParallel: true,
  permissionLevel: 'read',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Optional: natural language locator, e.g. “search box”, “login button”, “product price”, “send”. Results are ranked by relevance when provided.',
      },
      scope_selector: {
        type: 'string',
        description: 'Optional: CSS selector to limit the scan scope, e.g. "main", "form", "#content".',
      },
      include_non_interactive: {
        type: 'boolean',
        description: 'Whether to include non-interactive elements. Default: false. Set to true when looking for text information.',
      },
      include_hidden: {
        type: 'boolean',
        description: 'Whether to include hidden elements. Default: false.',
      },
      only_viewport: {
        type: 'boolean',
        description: 'Whether to return only elements within the current viewport. Default: false.',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of candidate elements to return. Range: 1-60, default: 20.',
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
        return { success: false, error: 'Unable to get current tab' };
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
          timeoutMessage: 'Timed out waiting for page semantic snapshot',
        },
      );
      if (!response?.success) {
        return { success: false, error: response?.error || 'Page semantic snapshot failed' };
      }
      return { success: true, data: response.data };
    } catch (err: any) {
      return { success: false, error: err.message || 'Page semantic snapshot failed' };
    }
  },
};
