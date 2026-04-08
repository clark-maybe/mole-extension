/**
 * CDP 请求拦截工具
 * 通过 chrome.debugger 的 Fetch 域实现请求拦截、修改和 Mock
 * 支持拦截请求后修改 URL/headers/body、直接返回自定义响应、模拟失败
 */

import type { FunctionDefinition, FunctionResult, ToolExecutionContext } from './types';
import { CDPSessionManager } from '../lib/cdp-session';

/** 获取当前活动标签页 ID */
const getActiveTabId = (): Promise<number | null> => {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs?.[0]?.id ?? null);
    });
  });
};

export const cdpFetchFunction: FunctionDefinition = {
  name: 'cdp_fetch',
  description: 'Request interception and modification tool (CDP Fetch domain). Intercept page network requests to modify request parameters before forwarding, return custom responses (Mock), or simulate request failures. Useful for injecting auth headers, mocking API data, bypassing CORS, etc. Note: once interception is enabled, matched requests are paused and must be handled via continue/fulfill/fail, otherwise the page will hang.',
  supportsParallel: false,
  permissionLevel: 'sensitive',
  approvalMessageTemplate: 'AI is requesting to intercept/modify network requests ({action})',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['enable', 'disable', 'get_intercepted', 'continue', 'fulfill', 'fail', 'continue_all'],
        description: 'Action type: enable=enable interception, disable=stop interception, get_intercepted=view paused requests, continue=forward request (modifiable), fulfill=return custom response, fail=simulate failure, continue_all=forward all paused requests',
      },
      url_patterns: {
        type: 'array',
        items: { type: 'string' },
        description: 'URL match patterns for enable (supports * wildcard), e.g. ["*api.example.com*"]. Intercepts all if empty.',
      },
      resource_types: {
        type: 'array',
        items: { type: 'string' },
        description: 'Filter by resource type for enable (Document/Stylesheet/Image/Script/XHR/Fetch, etc.).',
      },
      request_id: {
        type: 'string',
        description: 'Request ID for continue/fulfill/fail (obtained from get_intercepted).',
      },
      // continue 参数
      url: {
        type: 'string',
        description: 'Modified request URL for continue.',
      },
      method: {
        type: 'string',
        description: 'Modified request method for continue (GET/POST/PUT, etc.).',
      },
      headers: {
        type: 'object',
        description: 'Modified request headers for continue (object format {name: value}).',
      },
      post_data: {
        type: 'string',
        description: 'Modified request body for continue (base64 encoded).',
      },
      // fulfill 参数
      response_code: {
        type: 'number',
        description: 'HTTP status code for fulfill. Default: 200.',
      },
      response_headers: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            value: { type: 'string' },
          },
        },
        description: 'Response headers for fulfill ([{name, value}] format).',
      },
      body: {
        type: 'string',
        description: 'Response body content for fulfill (text).',
      },
      body_base64: {
        type: 'string',
        description: 'Response body content for fulfill (base64 encoded, for binary data).',
      },
      // fail 参数
      error_reason: {
        type: 'string',
        enum: ['Failed', 'Aborted', 'TimedOut', 'AccessDenied', 'ConnectionClosed', 'ConnectionReset', 'ConnectionRefused', 'ConnectionAborted', 'ConnectionFailed', 'NameNotResolved', 'InternetDisconnected', 'AddressUnreachable', 'BlockedByClient', 'BlockedByResponse'],
        description: 'Error reason for fail. Default: Failed.',
      },
      tab_id: {
        type: 'number',
        description: 'Target tab ID. Uses the current active tab if omitted.',
      },
    },
    required: ['action'],
  },

  validate: (params: any): string | null => {
    const { action } = params || {};
    if (!action) return 'Missing action parameter';
    const validActions = ['enable', 'disable', 'get_intercepted', 'continue', 'fulfill', 'fail', 'continue_all'];
    if (!validActions.includes(action)) {
      return `Unsupported action: ${action}`;
    }
    if (['continue', 'fulfill', 'fail'].includes(action) && !params.request_id) {
      return `${action} requires request_id parameter`;
    }
    return null;
  },

  execute: async (
    params: {
      action: string;
      url_patterns?: string[];
      resource_types?: string[];
      request_id?: string;
      url?: string;
      method?: string;
      headers?: Record<string, string>;
      post_data?: string;
      response_code?: number;
      response_headers?: Array<{ name: string; value: string }>;
      body?: string;
      body_base64?: string;
      error_reason?: string;
      tab_id?: number;
    },
    context?: ToolExecutionContext,
  ): Promise<FunctionResult> => {
    const { action, tab_id } = params;

    // 确定目标 tabId
    let tabId: number;
    if (typeof tab_id === 'number' && tab_id > 0) {
      tabId = tab_id;
    } else if (typeof context?.tabId === 'number' && context.tabId > 0) {
      tabId = context.tabId;
    } else {
      const activeTabId = await getActiveTabId();
      if (!activeTabId) {
        return { success: false, error: 'Unable to determine target tab' };
      }
      tabId = activeTabId;
    }

    switch (action) {
      case 'enable': {
        const result = await CDPSessionManager.startFetchInterception(tabId, {
          urlPatterns: params.url_patterns,
          resourceTypes: params.resource_types,
        });
        if (!result.success) {
          return { success: false, error: `Failed to enable request interception: ${result.error}` };
        }
        return {
          success: true,
          data: {
            tab_id: tabId,
            url_patterns: params.url_patterns || ['*'],
            resource_types: params.resource_types || [],
            message: 'Request interception enabled (CDP Fetch domain). Matched requests will be paused. Handle them promptly via continue/fulfill/fail.',
          },
        };
      }

      case 'disable': {
        await CDPSessionManager.stopFetchInterception(tabId);
        return {
          success: true,
          data: { message: 'Request interception stopped. All paused requests have been automatically forwarded.' },
        };
      }

      case 'get_intercepted': {
        const paused = CDPSessionManager.getFetchPausedRequests(tabId);
        const simplified = paused.map((r) => ({
          request_id: r.requestId,
          url: r.request.url,
          method: r.request.method,
          resource_type: r.resourceType,
          has_response: r.responseStatusCode !== undefined,
          response_status: r.responseStatusCode,
          paused_at: r.pausedAt,
          age_ms: Date.now() - r.pausedAt,
        }));
        return {
          success: true,
          data: {
            total: simplified.length,
            intercepted: simplified,
            message: simplified.length > 0
              ? `Currently ${simplified.length} paused request(s)`
              : 'No paused requests at this time',
          },
        };
      }

      case 'continue': {
        const cmdParams: Record<string, any> = {
          requestId: params.request_id,
        };
        if (params.url) cmdParams.url = params.url;
        if (params.method) cmdParams.method = params.method;
        if (params.post_data) cmdParams.postData = params.post_data;
        if (params.headers) {
          // 将对象格式转为 CDP 要求的数组格式
          cmdParams.headers = Object.entries(params.headers).map(([name, value]) => ({
            name,
            value: String(value),
          }));
        }

        const result = await CDPSessionManager.sendCommand(tabId, 'Fetch.continueRequest', cmdParams);
        if (!result.success) {
          return { success: false, error: `Failed to continue request: ${result.error}` };
        }
        return {
          success: true,
          data: {
            request_id: params.request_id,
            modified: Boolean(params.url || params.method || params.headers || params.post_data),
            message: params.url || params.method || params.headers || params.post_data
              ? 'Request forwarded with modifications'
              : 'Request forwarded as-is',
          },
        };
      }

      case 'fulfill': {
        // 将文本 body 转为 base64
        let bodyBase64 = params.body_base64 || '';
        if (!bodyBase64 && params.body) {
          bodyBase64 = btoa(unescape(encodeURIComponent(params.body)));
        }

        const cmdParams: Record<string, any> = {
          requestId: params.request_id,
          responseCode: params.response_code || 200,
        };
        if (bodyBase64) cmdParams.body = bodyBase64;
        if (params.response_headers) {
          cmdParams.responseHeaders = params.response_headers;
        } else if (params.body) {
          // 默认添加 Content-Type header
          cmdParams.responseHeaders = [
            { name: 'Content-Type', value: 'application/json; charset=utf-8' },
          ];
        }

        const result = await CDPSessionManager.sendCommand(tabId, 'Fetch.fulfillRequest', cmdParams);
        if (!result.success) {
          return { success: false, error: `Failed to fulfill request: ${result.error}` };
        }
        return {
          success: true,
          data: {
            request_id: params.request_id,
            response_code: params.response_code || 200,
            body_length: (params.body || '').length,
            message: `Custom response returned (status code ${params.response_code || 200})`,
          },
        };
      }

      case 'fail': {
        const result = await CDPSessionManager.sendCommand(tabId, 'Fetch.failRequest', {
          requestId: params.request_id,
          errorReason: params.error_reason || 'Failed',
        });
        if (!result.success) {
          return { success: false, error: `Failed to simulate request failure: ${result.error}` };
        }
        return {
          success: true,
          data: {
            request_id: params.request_id,
            error_reason: params.error_reason || 'Failed',
            message: `Request simulated as failed (${params.error_reason || 'Failed'})`,
          },
        };
      }

      case 'continue_all': {
        await CDPSessionManager.clearFetchPausedRequests(tabId);
        return {
          success: true,
          data: { message: 'All paused requests have been forwarded' },
        };
      }

      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  },
};
