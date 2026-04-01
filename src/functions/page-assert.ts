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
    '验证当前页面是否满足某些条件，适合在点击、输入、跳转、提交后做结果核验。',
    '支持 URL、标题、文本、selector 是否存在/可见、selector 文本是否包含等断言。',
    '建议：关键动作后优先调用 page_assert，而不是直接假设动作已成功。',
  ].join(' '),
  supportsParallel: true,
  permissionLevel: 'read',
  parameters: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        enum: ['all', 'any'],
        description: '断言模式。all=全部通过才算成功；any=任一通过即可。默认 all。',
      },
      scope_selector: {
        type: 'string',
        description: '可选：将文本断言限制在某个 DOM 范围中。',
      },
      assertions: {
        type: 'array',
        description: '断言列表。',
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['url_includes', 'title_includes', 'text_includes', 'selector_exists', 'selector_visible', 'selector_text_includes'],
              description: '断言类型。',
            },
            value: {
              type: 'string',
              description: 'url_includes/title_includes/text_includes 使用的匹配值。',
            },
            selector: {
              type: 'string',
              description: 'selector_exists/selector_visible/selector_text_includes 使用的 CSS selector。',
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
      return 'assertions 不能为空';
    }
    for (const assertion of params.assertions) {
      const type = String(assertion?.type || '');
      if (!type) return 'assertion.type 不能为空';
      if (['url_includes', 'title_includes', 'text_includes'].includes(type) && !assertion?.value) {
        return `${type} 需要 value`;
      }
      if (['selector_exists', 'selector_visible', 'selector_text_includes'].includes(type) && !assertion?.selector) {
        return `${type} 需要 selector`;
      }
      if (type === 'selector_text_includes' && !assertion?.value) {
        return 'selector_text_includes 需要 value';
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
      return { success: false, error: '无法获取当前标签页' };
    }

    try {
      const response = await sendToTabWithRetry<{ success: boolean; data?: any; error?: string }>(
        tabId,
        '__page_grounding_assert',
        params,
        {
          signal: context?.signal,
          deadlineMs: 12000,
          timeoutMessage: '等待 page_assert 响应超时',
        },
      );
      if (!response?.success) {
        return { success: false, error: response?.error || 'page_assert 执行失败' };
      }
      if (response.data?.passed === true) {
        const domain = await resolveSiteExperienceDomain(context);
        await reinforceRecentSiteRepairSuccess(domain);
      }
      return { success: true, data: response.data };
    } catch (err: any) {
      return { success: false, error: err.message || 'page_assert 执行失败' };
    }
  },
};
