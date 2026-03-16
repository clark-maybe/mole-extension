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
  description: '请求拦截与篡改工具（CDP Fetch 域）。拦截页面网络请求，可修改请求参数后放行、直接返回自定义响应（Mock）、或模拟请求失败。适用于注入认证 headers、Mock API 数据、绕过 CORS 等场景。注意：启用拦截后，被匹配的请求会被暂停，必须通过 continue/fulfill/fail 操作来处理，否则页面会卡住。',
  supportsParallel: false,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['enable', 'disable', 'get_intercepted', 'continue', 'fulfill', 'fail', 'continue_all'],
        description: '操作类型：enable=启用拦截, disable=停止拦截, get_intercepted=查看被暂停的请求, continue=放行请求(可修改), fulfill=返回自定义响应, fail=模拟失败, continue_all=放行所有暂停请求',
      },
      url_patterns: {
        type: 'array',
        items: { type: 'string' },
        description: 'enable 时的 URL 匹配模式（支持 * 通配），如 ["*api.example.com*"]，空则拦截全部',
      },
      resource_types: {
        type: 'array',
        items: { type: 'string' },
        description: 'enable 时按资源类型过滤（Document/Stylesheet/Image/Script/XHR/Fetch 等）',
      },
      request_id: {
        type: 'string',
        description: 'continue/fulfill/fail 时指定的请求 ID（从 get_intercepted 获取）',
      },
      // continue 参数
      url: {
        type: 'string',
        description: 'continue 时修改请求 URL',
      },
      method: {
        type: 'string',
        description: 'continue 时修改请求方法（GET/POST/PUT 等）',
      },
      headers: {
        type: 'object',
        description: 'continue 时修改请求 headers（对象格式 {name: value}）',
      },
      post_data: {
        type: 'string',
        description: 'continue 时修改请求 body（base64 编码）',
      },
      // fulfill 参数
      response_code: {
        type: 'number',
        description: 'fulfill 时的 HTTP 状态码，默认 200',
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
        description: 'fulfill 时的响应 headers（[{name, value}] 格式）',
      },
      body: {
        type: 'string',
        description: 'fulfill 时的响应体内容（文本）',
      },
      body_base64: {
        type: 'string',
        description: 'fulfill 时的响应体内容（base64 编码，用于二进制数据）',
      },
      // fail 参数
      error_reason: {
        type: 'string',
        enum: ['Failed', 'Aborted', 'TimedOut', 'AccessDenied', 'ConnectionClosed', 'ConnectionReset', 'ConnectionRefused', 'ConnectionAborted', 'ConnectionFailed', 'NameNotResolved', 'InternetDisconnected', 'AddressUnreachable', 'BlockedByClient', 'BlockedByResponse'],
        description: 'fail 时的错误原因，默认 Failed',
      },
      tab_id: {
        type: 'number',
        description: '目标标签页 ID，不传则使用当前活动标签页',
      },
    },
    required: ['action'],
  },

  validate: (params: any): string | null => {
    const { action } = params || {};
    if (!action) return '缺少 action 参数';
    const validActions = ['enable', 'disable', 'get_intercepted', 'continue', 'fulfill', 'fail', 'continue_all'];
    if (!validActions.includes(action)) {
      return `不支持的 action: ${action}`;
    }
    if (['continue', 'fulfill', 'fail'].includes(action) && !params.request_id) {
      return `${action} 需要 request_id 参数`;
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
        return { success: false, error: '无法确定目标标签页' };
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
          return { success: false, error: `启用请求拦截失败: ${result.error}` };
        }
        return {
          success: true,
          data: {
            tab_id: tabId,
            url_patterns: params.url_patterns || ['*'],
            resource_types: params.resource_types || [],
            message: '请求拦截已启用（CDP Fetch 域）。匹配的请求会被暂停，请及时通过 continue/fulfill/fail 处理。',
          },
        };
      }

      case 'disable': {
        await CDPSessionManager.stopFetchInterception(tabId);
        return {
          success: true,
          data: { message: '请求拦截已停止，所有暂停的请求已自动放行' },
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
              ? `当前有 ${simplified.length} 个被暂停的请求`
              : '当前没有被暂停的请求',
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
          return { success: false, error: `放行请求失败: ${result.error}` };
        }
        return {
          success: true,
          data: {
            request_id: params.request_id,
            modified: Boolean(params.url || params.method || params.headers || params.post_data),
            message: params.url || params.method || params.headers || params.post_data
              ? '请求已修改后放行'
              : '请求已原样放行',
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
          return { success: false, error: `Mock 响应失败: ${result.error}` };
        }
        return {
          success: true,
          data: {
            request_id: params.request_id,
            response_code: params.response_code || 200,
            body_length: (params.body || '').length,
            message: `已返回自定义响应（状态码 ${params.response_code || 200}）`,
          },
        };
      }

      case 'fail': {
        const result = await CDPSessionManager.sendCommand(tabId, 'Fetch.failRequest', {
          requestId: params.request_id,
          errorReason: params.error_reason || 'Failed',
        });
        if (!result.success) {
          return { success: false, error: `模拟失败请求失败: ${result.error}` };
        }
        return {
          success: true,
          data: {
            request_id: params.request_id,
            error_reason: params.error_reason || 'Failed',
            message: `请求已模拟失败（${params.error_reason || 'Failed'}）`,
          },
        };
      }

      case 'continue_all': {
        await CDPSessionManager.clearFetchPausedRequests(tabId);
        return {
          success: true,
          data: { message: '所有暂停的请求已全部放行' },
        };
      }

      default:
        return { success: false, error: `未知操作: ${action}` };
    }
  },
};
