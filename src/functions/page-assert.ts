/**
 * 页面断言工具
 * 用声明式断言验证页面是否达到预期状态，供 agent 在动作后核验结果
 */

import type { FunctionDefinition, ToolExecutionContext } from './types';
import { sendToTabWithRetry } from './tab-message';
import { reinforceRecentSiteRepairSuccess, resolveSiteExperienceDomain } from './site-experience';

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

export const pageAssertFunction: FunctionDefinition = {
  name: 'page_assert',
  description: [
    'Verify whether the current page meets certain conditions. Ideal for result validation after click, input, navigation, or form submission.',
    'Supports assertions for URL, title, text, selector existence/visibility, and selector text content.',
    'Recommendation: call page_assert after critical actions instead of assuming the action succeeded.',
  ].join(' '),
  supportsParallel: true,
  permissionLevel: 'read',
  parameters: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        enum: ['all', 'any'],
        description: 'Assertion mode. all=all must pass to succeed; any=pass if any one succeeds. Default: all.',
      },
      scope_selector: {
        type: 'string',
        description: 'Optional: limit text assertions to a specific DOM scope.',
      },
      assertions: {
        type: 'array',
        description: 'List of assertions.',
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['url_includes', 'title_includes', 'text_includes', 'selector_exists', 'selector_visible', 'selector_text_includes'],
              description: 'Assertion type.',
            },
            value: {
              type: 'string',
              description: 'Match value used by url_includes/title_includes/text_includes.',
            },
            selector: {
              type: 'string',
              description: 'CSS selector used by selector_exists/selector_visible/selector_text_includes.',
            },
          },
          required: ['type'],
        },
      },
    },
    required: ['assertions'],
  },
  validate: (params: { assertions?: Array<{ type?: string; selector?: string; value?: string }> }) => {
    if (!Array.isArray(params?.assertions) || params.assertions.length === 0) {
      return 'assertions cannot be empty';
    }
    for (const assertion of params.assertions) {
      const type = String(assertion?.type || '');
      if (!type) return 'assertion.type cannot be empty';
      if (['url_includes', 'title_includes', 'text_includes'].includes(type) && !assertion?.value) {
        return `${type} requires value`;
      }
      if (['selector_exists', 'selector_visible', 'selector_text_includes'].includes(type) && !assertion?.selector) {
        return `${type} requires selector`;
      }
      if (type === 'selector_text_includes' && !assertion?.value) {
        return 'selector_text_includes requires value';
      }
    }
    return null;
  },
  execute: async (
    params: {
      mode?: 'all' | 'any';
      scope_selector?: string;
      assertions: Array<{
        type: 'url_includes' | 'title_includes' | 'text_includes' | 'selector_exists' | 'selector_visible' | 'selector_text_includes';
        value?: string;
        selector?: string;
      }>;
    },
    context?: ToolExecutionContext,
  ) => {
    let tabId = context?.tabId;
    if (!tabId) {
      tabId = (await getActiveTabId()) ?? undefined;
    }

    if (!tabId) {
      return { success: false, error: 'Unable to get current tab' };
    }

    try {
      const response = await sendToTabWithRetry<{ success: boolean; data?: any; error?: string }>(
        tabId,
        '__page_grounding_assert',
        params,
        {
          signal: context?.signal,
          deadlineMs: 12000,
          timeoutMessage: 'Timed out waiting for page_assert response',
        },
      );
      if (!response?.success) {
        return { success: false, error: response?.error || 'page_assert execution failed' };
      }
      if (response.data?.passed === true) {
        const domain = await resolveSiteExperienceDomain(context);
        await reinforceRecentSiteRepairSuccess(domain);
      }
      return { success: true, data: response.data };
    } catch (err: any) {
      return { success: false, error: err.message || 'page_assert execution failed' };
    }
  },
};
