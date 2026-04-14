/**
 * CDP 网络请求监听 + Cookie 管理工具
 * 通过 chrome.debugger 的 Network 域实现完整的请求/响应可见性
 * 支持获取响应 body、完整 headers，以及跨域 Cookie 读写
 */

import type { FunctionDefinition, FunctionResult, ToolExecutionContext } from './types';
import { CDPSessionManager } from '../lib/cdp-session';
import { getActiveTabId } from './tab-utils';

const MAX_BODY_SIZE = 50 * 1024; // 响应 body 最大返回 50KB

export const cdpNetworkFunction: FunctionDefinition = {
  name: 'cdp_network',
  description: 'Network request monitoring and Cookie management (CDP enhanced). Monitor page network requests, retrieve complete request/response data (including body and headers), aggregate statistics, and cross-origin Cookie read/write.\n\n⚠️ Do NOT use this tool for:\n- Getting page content (use page_viewer or fetch_url)\n- Only use for debugging API requests or managing Cookies',
  supportsParallel: false,
  permissionLevel: 'interact',
  actionPermissions: {
    get_cookies: 'sensitive',
    set_cookie: 'sensitive',
    delete_cookie: 'sensitive',
  },
  approvalMessageTemplate: {
    get_cookies: 'AI 正在请求读取页面 Cookie',
    set_cookie: 'AI 正在请求设置 Cookie "{name}"',
    delete_cookie: 'AI 正在请求删除 Cookie "{name}"',
  },
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['start', 'stop', 'get_events', 'get_body', 'summary', 'clear', 'get_cookies', 'set_cookie', 'delete_cookie'],
        description: 'Action type: start=start monitoring, stop=stop, get_events=query events, get_body=get response body, summary=aggregate statistics, clear=clear, get_cookies=read cookies, set_cookie=write cookie, delete_cookie=delete cookie',
      },
      url_patterns: {
        type: 'array',
        items: { type: 'string' },
        description: 'URL filter patterns for start (supports * wildcard), empty monitors all',
      },
      max_events: {
        type: 'number',
        description: 'Max events to keep per tab for start, default 500',
      },
      only_errors: {
        type: 'boolean',
        description: 'Return only error requests for get_events (HTTP>=400 or network errors)',
      },
      url_filter: {
        type: 'string',
        description: 'Filter by URL keyword for get_events',
      },
      limit: {
        type: 'number',
        description: 'Max entries to return for get_events, default 200',
      },
      request_id: {
        type: 'string',
        description: 'Request ID for get_body (obtained from requestId in get_events results)',
      },
      urls: {
        type: 'array',
        items: { type: 'string' },
        description: 'URL list to get cookies for in get_cookies',
      },
      name: {
        type: 'string',
        description: 'Cookie name for set_cookie/delete_cookie',
      },
      value: {
        type: 'string',
        description: 'Cookie value for set_cookie',
      },
      domain: {
        type: 'string',
        description: 'Domain for set_cookie/delete_cookie',
      },
      path: {
        type: 'string',
        description: 'Path for set_cookie, default /',
      },
      httpOnly: {
        type: 'boolean',
        description: 'Whether set_cookie is httpOnly',
      },
      secure: {
        type: 'boolean',
        description: 'Whether set_cookie is secure',
      },
      sameSite: {
        type: 'string',
        enum: ['Strict', 'Lax', 'None'],
        description: 'SameSite attribute for set_cookie',
      },
      expires: {
        type: 'number',
        description: 'Expiration time for set_cookie (Unix timestamp in seconds)',
      },
      url: {
        type: 'string',
        description: 'URL for delete_cookie (mutually exclusive with domain)',
      },
      tab_id: {
        type: 'number',
        description: 'Target tab ID, uses current active tab if not provided',
      },
    },
    required: ['action'],
  },

  validate: (params: any): string | null => {
    const { action } = params || {};
    if (!action) return 'Missing action parameter';
    const validActions = ['start', 'stop', 'get_events', 'get_body', 'summary', 'clear', 'get_cookies', 'set_cookie', 'delete_cookie'];
    if (!validActions.includes(action)) {
      return `Unsupported action: ${action}`;
    }
    if (action === 'get_body' && !params.request_id) {
      return 'get_body requires request_id parameter';
    }
    if (action === 'set_cookie') {
      if (!params.name) return 'set_cookie requires name parameter';
      if (params.value === undefined) return 'set_cookie requires value parameter';
      if (!params.domain && !params.url) return 'set_cookie requires domain or url parameter';
    }
    if (action === 'delete_cookie') {
      if (!params.name) return 'delete_cookie requires name parameter';
    }
    return null;
  },

  execute: async (
    params: {
      action: string;
      url_patterns?: string[];
      max_events?: number;
      only_errors?: boolean;
      url_filter?: string;
      limit?: number;
      request_id?: string;
      urls?: string[];
      name?: string;
      value?: string;
      domain?: string;
      path?: string;
      httpOnly?: boolean;
      secure?: boolean;
      sameSite?: string;
      expires?: number;
      url?: string;
      tab_id?: number;
    },
    context?: ToolExecutionContext,
  ): Promise<FunctionResult> => {
    const { action, tab_id } = params;

    // 检查取消信号
    if (context?.signal?.aborted) {
      return { success: false, error: '操作已取消' };
    }

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
      case 'start': {
        const result = await CDPSessionManager.startNetworkListening(tabId, {
          urlPatterns: params.url_patterns,
          maxEvents: params.max_events,
        });
        if (!result.success) {
          return { success: false, error: `启动网络监听失败: ${result.error}` };
        }
        return {
          success: true,
          data: {
            tab_id: tabId,
            url_patterns: params.url_patterns || [],
            max_events: params.max_events || 500,
            message: '网络监听已启动（CDP Network 域）',
          },
        };
      }

      case 'stop': {
        await CDPSessionManager.stopNetworkListening(tabId);
        return {
          success: true,
          data: { message: '网络监听已停止' },
        };
      }

      case 'get_events': {
        const events = CDPSessionManager.getNetworkEvents(tabId, {
          onlyErrors: params.only_errors,
          urlFilter: params.url_filter,
          limit: params.limit,
        });
        // 精简返回格式，避免返回过多 headers 数据
        const simplified = events.map((e) => ({
          requestId: e.requestId,
          method: e.method,
          url: e.url,
          resourceType: e.resourceType,
          statusCode: e.statusCode,
          statusText: e.statusText,
          mimeType: e.mimeType,
          durationMs: e.durationMs,
          fromCache: e.fromCache,
          error: e.error,
          timestamp: e.timestamp,
        }));
        return {
          success: true,
          data: {
            total: simplified.length,
            events: simplified,
          },
        };
      }

      case 'get_body': {
        const bodyResult = await CDPSessionManager.sendCommand(tabId, 'Network.getResponseBody', {
          requestId: params.request_id,
        });
        if (!bodyResult.success) {
          return { success: false, error: `获取响应体失败: ${bodyResult.error}` };
        }
        let body = bodyResult.result?.body || '';
        const base64Encoded = bodyResult.result?.base64Encoded || false;
        let truncated = false;

        if (base64Encoded) {
          // 二进制内容，只返回大小信息
          const sizeKB = Math.round((body.length * 3) / 4 / 1024);
          return {
            success: true,
            data: {
              request_id: params.request_id,
              base64_encoded: true,
              size_kb: sizeKB,
              message: `响应为二进制内容（约 ${sizeKB}KB），无法以文本显示`,
            },
          };
        }

        // 文本内容，截断过大的响应
        if (body.length > MAX_BODY_SIZE) {
          body = body.substring(0, MAX_BODY_SIZE);
          truncated = true;
        }

        return {
          success: true,
          data: {
            request_id: params.request_id,
            body,
            truncated,
            original_length: bodyResult.result?.body?.length || 0,
            message: truncated ? `响应体已截断至 ${MAX_BODY_SIZE} 字节` : '获取响应体成功',
          },
        };
      }

      case 'summary': {
        const summary = CDPSessionManager.getNetworkSummary(tabId);
        return {
          success: true,
          data: summary,
        };
      }

      case 'clear': {
        CDPSessionManager.clearNetworkEvents(tabId);
        return {
          success: true,
          data: { message: '网络事件已清空' },
        };
      }

      case 'get_cookies': {
        const cookieResult = await CDPSessionManager.sendCommand(tabId, 'Network.getCookies', {
          urls: params.urls,
        });
        if (!cookieResult.success) {
          return { success: false, error: `获取 Cookie 失败: ${cookieResult.error}` };
        }
        const cookies = cookieResult.result?.cookies || [];
        return {
          success: true,
          data: {
            total: cookies.length,
            cookies: cookies.map((c: any) => ({
              name: c.name,
              value: c.value,
              domain: c.domain,
              path: c.path,
              expires: c.expires,
              httpOnly: c.httpOnly,
              secure: c.secure,
              sameSite: c.sameSite,
              size: c.size,
            })),
          },
        };
      }

      case 'set_cookie': {
        const cookieParams: Record<string, any> = {
          name: params.name,
          value: params.value,
          path: params.path || '/',
        };
        if (params.domain) cookieParams.domain = params.domain;
        if (params.url) cookieParams.url = params.url;
        if (params.httpOnly !== undefined) cookieParams.httpOnly = params.httpOnly;
        if (params.secure !== undefined) cookieParams.secure = params.secure;
        if (params.sameSite) cookieParams.sameSite = params.sameSite;
        if (params.expires !== undefined) cookieParams.expires = params.expires;

        const setResult = await CDPSessionManager.sendCommand(tabId, 'Network.setCookie', cookieParams);
        if (!setResult.success) {
          return { success: false, error: `设置 Cookie 失败: ${setResult.error}` };
        }
        const ok = setResult.result?.success !== false;
        return {
          success: ok,
          data: ok
            ? { message: `Cookie "${params.name}" 已设置` }
            : undefined,
          error: ok ? undefined : '设置 Cookie 失败（可能被浏览器策略拒绝）',
        };
      }

      case 'delete_cookie': {
        const deleteParams: Record<string, any> = { name: params.name };
        if (params.domain) deleteParams.domain = params.domain;
        if (params.url) deleteParams.url = params.url;

        const delResult = await CDPSessionManager.sendCommand(tabId, 'Network.deleteCookies', deleteParams);
        if (!delResult.success) {
          return { success: false, error: `删除 Cookie 失败: ${delResult.error}` };
        }
        return {
          success: true,
          data: { message: `Cookie "${params.name}" 已删除` },
        };
      }

      default:
        return { success: false, error: `未知操作: ${action}` };
    }
  },
};
