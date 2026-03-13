/**
 * CDP 网络请求监听 + Cookie 管理工具
 * 通过 chrome.debugger 的 Network 域实现完整的请求/响应可见性
 * 支持获取响应 body、完整 headers，以及跨域 Cookie 读写
 */

import type { FunctionDefinition, FunctionResult, ToolExecutionContext } from './types';
import { CDPSessionManager } from '../lib/cdp-session';

const MAX_BODY_SIZE = 50 * 1024; // 响应 body 最大返回 50KB

/** 获取当前活动标签页 ID */
const getActiveTabId = (): Promise<number | null> => {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs?.[0]?.id ?? null);
    });
  });
};

export const cdpNetworkFunction: FunctionDefinition = {
  name: 'cdp_network',
  description: '网络请求监听与 Cookie 管理（CDP 增强版）。监听页面网络请求，获取完整请求/响应数据（包括 body 和 headers），统计汇总，以及跨域 Cookie 读写。',
  supportsParallel: false,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['start', 'stop', 'get_events', 'get_body', 'summary', 'clear', 'get_cookies', 'set_cookie', 'delete_cookie'],
        description: '操作类型：start=开始监听, stop=停止, get_events=查询事件, get_body=获取响应体, summary=统计汇总, clear=清空, get_cookies=读Cookie, set_cookie=写Cookie, delete_cookie=删Cookie',
      },
      url_patterns: {
        type: 'array',
        items: { type: 'string' },
        description: 'start 时的 URL 过滤模式（支持 * 通配），空则监听全部',
      },
      max_events: {
        type: 'number',
        description: 'start 时每个 tab 最大保留事件数，默认 500',
      },
      only_errors: {
        type: 'boolean',
        description: 'get_events 时仅返回错误请求（HTTP>=400 或网络错误）',
      },
      url_filter: {
        type: 'string',
        description: 'get_events 时按 URL 关键词过滤',
      },
      limit: {
        type: 'number',
        description: 'get_events 返回条数上限，默认 200',
      },
      request_id: {
        type: 'string',
        description: 'get_body 时指定的请求 ID（从 get_events 返回的 requestId 获取）',
      },
      urls: {
        type: 'array',
        items: { type: 'string' },
        description: 'get_cookies 时指定要获取 cookie 的 URL 列表',
      },
      name: {
        type: 'string',
        description: 'set_cookie/delete_cookie 的 cookie 名称',
      },
      value: {
        type: 'string',
        description: 'set_cookie 的 cookie 值',
      },
      domain: {
        type: 'string',
        description: 'set_cookie/delete_cookie 的域名',
      },
      path: {
        type: 'string',
        description: 'set_cookie 的路径，默认 /',
      },
      httpOnly: {
        type: 'boolean',
        description: 'set_cookie 是否 httpOnly',
      },
      secure: {
        type: 'boolean',
        description: 'set_cookie 是否 secure',
      },
      sameSite: {
        type: 'string',
        enum: ['Strict', 'Lax', 'None'],
        description: 'set_cookie 的 SameSite 属性',
      },
      expires: {
        type: 'number',
        description: 'set_cookie 的过期时间（Unix 时间戳，秒）',
      },
      url: {
        type: 'string',
        description: 'delete_cookie 时指定的 URL（与 domain 二选一）',
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
    const validActions = ['start', 'stop', 'get_events', 'get_body', 'summary', 'clear', 'get_cookies', 'set_cookie', 'delete_cookie'];
    if (!validActions.includes(action)) {
      return `不支持的 action: ${action}`;
    }
    if (action === 'get_body' && !params.request_id) {
      return 'get_body 需要 request_id 参数';
    }
    if (action === 'set_cookie') {
      if (!params.name) return 'set_cookie 需要 name 参数';
      if (params.value === undefined) return 'set_cookie 需要 value 参数';
      if (!params.domain && !params.url) return 'set_cookie 需要 domain 或 url 参数';
    }
    if (action === 'delete_cookie') {
      if (!params.name) return 'delete_cookie 需要 name 参数';
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

    // 确定目标 tabId
    let tabId: number;
    if (typeof tab_id === 'number' && Number.isFinite(tab_id)) {
      tabId = tab_id;
    } else if (typeof context?.tabId === 'number') {
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
