/**
 * 页面交互操作工具函数
 * 在用户当前浏览的页面上执行 DOM 操作（点击、填写、选择、滚动、获取元素信息）
 * 通过向 content script 发送 __execute_page_action 消息实现
 */

import type { FunctionDefinition, ToolExecutionContext } from './types';
import { sendToTabWithRetry } from './tab-message';

interface WaitNavigationOptions {
  timeoutMs: number;
  stableMs: number;
  requireUrlChange: boolean;
  expectedUrlContains?: string;
  expectedUrlRegex?: string;
}

const waitForTabNavigationStable = async (
  tabId: number,
  options: WaitNavigationOptions,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> => {
  const timeoutMs = Math.max(200, Math.floor(Number(options.timeoutMs) || 10_000));
  const stableMs = Math.max(200, Math.floor(Number(options.stableMs) || 1_200));
  const requireUrlChange = options.requireUrlChange !== false;
  const expectedUrlContains = String(options.expectedUrlContains || '').trim();
  const expectedUrlRegexText = String(options.expectedUrlRegex || '').trim();
  const expectedUrlRegex = expectedUrlRegexText
    ? (() => {
      try {
        return new RegExp(expectedUrlRegexText);
      } catch {
        return null;
      }
    })()
    : null;

  const urlMatched = (url: string): boolean => {
    if (!url) return false;
    if (expectedUrlContains && url.includes(expectedUrlContains)) return true;
    if (expectedUrlRegex && expectedUrlRegex.test(url)) return true;
    return false;
  };

  const initialTab = await chrome.tabs.get(tabId);
  const fromUrl = initialTab.url || initialTab.pendingUrl || '';
  let currentUrl = fromUrl;
  let currentStatus = initialTab.status || 'complete';
  let sawUrlChange = false;
  let sawLoading = currentStatus === 'loading';
  let expectedMatched = urlMatched(currentUrl);
  let lastActivityAt = Date.now();
  const startedAt = Date.now();

  const applyTabSnapshot = (tab?: chrome.tabs.Tab | null): void => {
    if (!tab) return;
    const nextUrl = tab.url || tab.pendingUrl || '';
    const nextStatus = tab.status || currentStatus;
    const now = Date.now();
    if (nextUrl && nextUrl !== currentUrl) {
      currentUrl = nextUrl;
      sawUrlChange = true;
      lastActivityAt = now;
    } else if (!currentUrl && nextUrl) {
      currentUrl = nextUrl;
    }
    if (urlMatched(nextUrl)) expectedMatched = true;
    if (nextStatus !== currentStatus) {
      currentStatus = nextStatus;
      lastActivityAt = now;
    } else {
      currentStatus = nextStatus;
    }
    if (nextStatus === 'loading') {
      sawLoading = true;
      lastActivityAt = now;
    }
  };

  return await new Promise<Record<string, unknown>>((resolve, reject) => {
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    let pollHandle: ReturnType<typeof setInterval> | null = null;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (pollHandle) clearInterval(pollHandle);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      signal?.removeEventListener('abort', handleAbort);
    };

    const done = (payload: { success: true; data: Record<string, unknown> } | { success: false; error: string }) => {
      if (settled) return;
      cleanup();
      if (payload.success) {
        resolve(payload.data);
      } else {
        reject(new Error(payload.error));
      }
    };

    const maybeResolve = () => {
      const now = Date.now();
      const hasTrigger = requireUrlChange
        ? (sawUrlChange || sawLoading || expectedMatched)
        : true;
      if (!hasTrigger) return;
      if (currentStatus !== 'complete') return;
      if (now - lastActivityAt < stableMs) return;
      done({
        success: true,
        data: {
          message: '页面导航已稳定',
          from_url: fromUrl,
          to_url: currentUrl,
          elapsed_ms: now - startedAt,
          require_url_change: requireUrlChange,
          url_changed: sawUrlChange,
          saw_loading: sawLoading,
          expected_url_matched: expectedMatched,
        },
      });
    };

    const handleUpdated = (updatedTabId: number, _changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (updatedTabId !== tabId) return;
      applyTabSnapshot(tab);
      maybeResolve();
    };

    const handleAbort = () => {
      done({
        success: false,
        error: 'aborted',
      });
    };

    chrome.tabs.onUpdated.addListener(handleUpdated);
    signal?.addEventListener('abort', handleAbort, { once: true });

    timeoutHandle = setTimeout(() => {
      done({
        success: false,
        error: `等待页面导航稳定超时（${timeoutMs}ms）`,
      });
    }, timeoutMs);

    pollHandle = setInterval(() => {
      void chrome.tabs.get(tabId)
        .then((tab) => {
          applyTabSnapshot(tab);
          maybeResolve();
        })
        .catch(() => {
          done({
            success: false,
            error: `目标标签页不可用: ${tabId}`,
          });
        });
    }, 180);

    maybeResolve();
  });
};

export const pageActionFunction: FunctionDefinition = {
  name: 'page_action',
  description: '在用户当前浏览的页面上执行原子交互操作。支持点击、填写、清空、聚焦、下拉选择、滚动、悬停、键盘输入、等待元素出现、获取元素信息。建议先用 page_viewer/get_element_info 了解页面结构再执行。',
  supportsParallel: false,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['click', 'click_text', 'fill', 'clear', 'focus', 'select', 'scroll', 'hover', 'press_key', 'wait_for_element', 'wait_text', 'wait_navigation', 'get_element_info'],
        description: '操作类型：click/click_text/fill/clear/focus/select/scroll/hover/press_key/wait_for_element/wait_text/wait_navigation/get_element_info',
      },
      selector: {
        type: 'string',
        description: 'CSS 选择器，用于定位目标元素。如 "#submit-btn"、".search-input"、"button[type=submit]"、"input[name=email]"',
      },
      text: {
        type: 'string',
        description: '文本匹配值（action=click_text/wait_text 时使用）',
      },
      match_mode: {
        type: 'string',
        enum: ['contains', 'exact'],
        description: '文本匹配模式，默认 contains',
      },
      value: {
        type: 'string',
        description: '填写/选择的值（action=fill/select 时使用）',
      },
      scroll_to: {
        type: 'string',
        enum: ['top', 'bottom'],
        description: '滚动目标（action=scroll 时可用）：top(页面顶部)、bottom(页面底部)',
      },
      direction: {
        type: 'string',
        enum: ['up', 'down'],
        description: '滚动方向（action=scroll 时可用，与 scroll_to 二选一）',
      },
      amount: {
        type: 'number',
        description: '滚动像素量（与 direction 配合使用），默认500',
      },
      key: {
        type: 'string',
        description: '按键值（action=press_key）。如 "Enter"、"Escape"、"Tab"、"a"',
      },
      modifiers: {
        type: 'array',
        items: { type: 'string' },
        description: '组合键修饰符（action=press_key）。可选：ctrl/shift/alt/meta',
      },
      timeout_ms: {
        type: 'number',
        description: '等待超时毫秒（action=wait_for_element/wait_text/wait_navigation），默认5000',
      },
      visible: {
        type: 'boolean',
        description: '等待元素时是否要求可见（action=wait_for_element），默认 true',
      },
      stable_ms: {
        type: 'number',
        description: '等待导航稳定时长（action=wait_navigation），默认 1200ms',
      },
      require_url_change: {
        type: 'boolean',
        description: 'wait_navigation 是否必须捕获 URL/加载态变化，默认 true',
      },
      url_contains: {
        type: 'string',
        description: 'wait_navigation 可选：URL 包含该字符串即视作匹配',
      },
      url_regex: {
        type: 'string',
        description: 'wait_navigation 可选：URL 正则匹配（字符串形式）',
      },
    },
    required: ['action'],
  },
  validate: (params: { action?: string; selector?: string; text?: string; value?: string; key?: string; direction?: string; scroll_to?: string }) => {
    const action = params?.action;
    if (!action) return '缺少 action';

    const requireSelectorActions = new Set([
      'click', 'fill', 'clear', 'focus', 'select', 'hover', 'wait_for_element', 'get_element_info',
    ]);
    if (requireSelectorActions.has(action) && !params.selector) {
      return `${action} 需要提供 selector`;
    }
    if ((action === 'click_text' || action === 'wait_text') && !params.text) {
      return `${action} 需要提供 text`;
    }
    if ((action === 'fill' || action === 'select') && typeof params.value !== 'string') {
      return `${action} 需要提供 value（字符串）`;
    }
    if (action === 'press_key' && !params.key) {
      return 'press_key 需要提供 key';
    }
    if (action === 'scroll' && !params.selector && !params.scroll_to && !params.direction) {
      return 'scroll 需要 selector 或 scroll_to 或 direction';
    }
    return null;
  },
  execute: async (
    params: {
      action: string;
      selector?: string;
      text?: string;
      match_mode?: 'contains' | 'exact';
      value?: string;
      scroll_to?: string;
      direction?: string;
      amount?: number;
      key?: string;
      modifiers?: string[];
      timeout_ms?: number;
      visible?: boolean;
      stable_ms?: number;
      require_url_change?: boolean;
      url_contains?: string;
      url_regex?: string;
    },
    context?: ToolExecutionContext,
  ) => {
    // 获取目标 tabId
    let tabId = context?.tabId;
    if (!tabId) {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = activeTab?.id;
    }
    if (!tabId) {
      return { success: false, error: '无法获取当前标签页' };
    }

    if (params.action === 'wait_navigation') {
      try {
        const data = await waitForTabNavigationStable(
          tabId,
          {
            timeoutMs: params.timeout_ms ?? 10_000,
            stableMs: params.stable_ms ?? 1_200,
            requireUrlChange: params.require_url_change !== false,
            expectedUrlContains: params.url_contains,
            expectedUrlRegex: params.url_regex,
          },
          context?.signal,
        );
        return { success: true, data };
      } catch (err: any) {
        return { success: false, error: err?.message || '等待页面导航稳定失败' };
      }
    }

    try {
      // 发送操作到 content script
      const response = await sendToTabWithRetry<{
        success: boolean;
        data?: any;
        error?: string;
      }>(tabId, '__execute_page_action', params, {
        signal: context?.signal,
        deadlineMs: 12000,
        timeoutMessage: '目标页面连接超时：content script 未就绪',
      });

      if (!response || !response.success) {
        return { success: false, error: response?.error || '页面操作执行失败' };
      }

      return { success: true, data: response.data };
    } catch (err: any) {
      return { success: false, error: err.message || '页面操作执行失败' };
    }
  },
};
