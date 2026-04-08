/**
 * CDP 调试工具（统一入口）
 * 合并 cdp_console（控制台捕获）、cdp_overlay（视觉高亮）、cdp_fetch（请求拦截）三个工具
 * 通过 scope 参数分发到对应的子功能
 */

import type { FunctionDefinition, FunctionResult, ToolExecutionContext } from './types';
import { cdpConsoleFunction } from './cdp-console';
import { cdpOverlayFunction } from './cdp-overlay';
import { cdpFetchFunction } from './cdp-fetch';

export const cdpDebugFunction: FunctionDefinition = {
  name: 'cdp_debug',
  description: `CDP debugging tool with three sub-functions (selected via the scope parameter):

**scope="console"** — Console message capture. Once started, automatically collects console.log/warn/error output and uncaught exceptions to help diagnose page issues.
  action: start | stop | get_logs | get_exceptions | clear
  params: max_entries (max entries to keep on start), level (filter by level for get_logs), limit (max entries to return)

**scope="overlay"** — Visual highlight annotations (CDP Overlay domain). Highlights page elements or specified regions so the user can see what the AI is operating on.
  action: highlight_node | highlight_selector | highlight_rect | hide
  params: node_id, selector, x/y/width/height (rectangle area), content_color/border_color/padding_color/margin_color (custom colors)

**scope="fetch"** — Request interception and modification (CDP Fetch domain). Intercepts page network requests; can modify and continue, return custom responses (mock), or simulate failures.
  action: enable | disable | get_intercepted | continue | fulfill | fail | continue_all
  params: url_patterns, resource_types, request_id, url/method/headers/post_data (continue modifications), response_code/response_headers/body/body_base64 (fulfill response), error_reason (fail reason)
  Note: After enabling interception, matched requests are paused and must be handled via continue/fulfill/fail, otherwise the page will hang.`,

  // cdp_fetch 为 false，取最严格
  supportsParallel: false,
  // cdp_fetch 为 sensitive，取最严格
  permissionLevel: 'sensitive',
  // fetch scope 的操作需要确认提示
  approvalMessageTemplate: 'AI 正在使用 CDP 调试工具（{scope}.{action}）',

  // fetch scope 下的 action 继承 cdp_fetch 的 sensitive 权限，console/overlay 为 read
  actionPermissions: {
    // console scope 的 action 均为 read（默认 permissionLevel 已覆盖，此处显式声明以降低权限）
    // 注意：actionPermissions 的 key 是 action 值，但此处 action 在不同 scope 下含义不同
    // 由于工具执行器按 action 值匹配权限，而 console 和 overlay 的 action 值与 fetch 不重叠，
    // 可以安全地为非 fetch 的 action 声明更低权限
    'start': 'read',
    'stop': 'read',
    'get_logs': 'read',
    'get_exceptions': 'read',
    'clear': 'read',
    'highlight_node': 'read',
    'highlight_selector': 'read',
    'highlight_rect': 'read',
    'hide': 'read',
    // fetch scope 的 action 保持 sensitive
    'enable': 'sensitive',
    'disable': 'sensitive',
    'get_intercepted': 'read',
    'continue': 'sensitive',
    'fulfill': 'sensitive',
    'fail': 'sensitive',
    'continue_all': 'sensitive',
  },

  parameters: {
    type: 'object',
    properties: {
      scope: {
        type: 'string',
        enum: ['console', 'overlay', 'fetch'],
        description: 'Sub-function scope: console=console capture, overlay=visual highlight, fetch=request interception',
      },
      action: {
        type: 'string',
        description: 'Action type, depends on scope. console: start/stop/get_logs/get_exceptions/clear; overlay: highlight_node/highlight_selector/highlight_rect/hide; fetch: enable/disable/get_intercepted/continue/fulfill/fail/continue_all',
      },
      // === console scope 参数 ===
      max_entries: {
        type: 'number',
        description: '[console] Max entries to keep on start, default 200',
      },
      level: {
        type: 'string',
        enum: ['log', 'warn', 'error', 'info', 'debug'],
        description: '[console] Filter by level for get_logs',
      },
      limit: {
        type: 'number',
        description: '[console] Max entries to return for get_logs/get_exceptions, default 200',
      },
      // === overlay scope 参数 ===
      node_id: {
        type: 'number',
        description: '[overlay] Node ID for highlight_node',
      },
      selector: {
        type: 'string',
        description: '[overlay] CSS selector for highlight_selector',
      },
      x: {
        type: 'number',
        description: '[overlay] Top-left x coordinate of rectangle (viewport coordinates)',
      },
      y: {
        type: 'number',
        description: '[overlay] Top-left y coordinate of rectangle (viewport coordinates)',
      },
      width: {
        type: 'number',
        description: '[overlay] Rectangle width',
      },
      height: {
        type: 'number',
        description: '[overlay] Rectangle height',
      },
      content_color: {
        type: 'string',
        description: '[overlay] Content area highlight color (hex e.g. "#FF000066" or rgba e.g. "rgba(255,0,0,0.4)"), default semi-transparent blue',
      },
      border_color: {
        type: 'string',
        description: '[overlay] Border highlight color, default blue',
      },
      padding_color: {
        type: 'string',
        description: '[overlay] Padding area color, default semi-transparent green',
      },
      margin_color: {
        type: 'string',
        description: '[overlay] Margin area color, default semi-transparent orange',
      },
      // === fetch scope 参数 ===
      url_patterns: {
        type: 'array',
        items: { type: 'string' },
        description: '[fetch] URL match patterns for enable (supports * wildcard), e.g. ["*api.example.com*"], empty intercepts all',
      },
      resource_types: {
        type: 'array',
        items: { type: 'string' },
        description: '[fetch] Filter by resource type for enable (Document/Stylesheet/Image/Script/XHR/Fetch, etc.)',
      },
      request_id: {
        type: 'string',
        description: '[fetch] Request ID for continue/fulfill/fail (obtained from get_intercepted)',
      },
      url: {
        type: 'string',
        description: '[fetch] Modified request URL for continue',
      },
      method: {
        type: 'string',
        description: '[fetch] Modified request method for continue (GET/POST/PUT, etc.)',
      },
      headers: {
        type: 'object',
        description: '[fetch] Modified request headers for continue (object format {name: value})',
      },
      post_data: {
        type: 'string',
        description: '[fetch] Modified request body for continue (base64 encoded)',
      },
      response_code: {
        type: 'number',
        description: '[fetch] HTTP status code for fulfill, default 200',
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
        description: '[fetch] Response headers for fulfill ([{name, value}] format)',
      },
      body: {
        type: 'string',
        description: '[fetch] Response body content for fulfill (text)',
      },
      body_base64: {
        type: 'string',
        description: '[fetch] Response body content for fulfill (base64 encoded, for binary data)',
      },
      error_reason: {
        type: 'string',
        enum: ['Failed', 'Aborted', 'TimedOut', 'AccessDenied', 'ConnectionClosed', 'ConnectionReset', 'ConnectionRefused', 'ConnectionAborted', 'ConnectionFailed', 'NameNotResolved', 'InternetDisconnected', 'AddressUnreachable', 'BlockedByClient', 'BlockedByResponse'],
        description: '[fetch] Error reason for fail, default Failed',
      },
      // === 公共参数 ===
      tab_id: {
        type: 'number',
        description: 'Target tab ID, uses current active tab if not provided',
      },
    },
    required: ['scope', 'action'],
  },

  validate: (params: any): string | null => {
    const { scope, action } = params || {};
    if (!scope) return 'Missing scope parameter';
    if (!['console', 'overlay', 'fetch'].includes(scope)) {
      return `Unsupported scope: ${scope}`;
    }
    if (!action) return 'Missing action parameter';

    // 委托给对应子工具的 validate
    switch (scope) {
      case 'console':
        return cdpConsoleFunction.validate?.(params) ?? null;
      case 'overlay':
        return cdpOverlayFunction.validate?.(params) ?? null;
      case 'fetch':
        return cdpFetchFunction.validate?.(params) ?? null;
      default:
        return `Unsupported scope: ${scope}`;
    }
  },

  execute: async (
    params: Record<string, any>,
    context?: ToolExecutionContext,
  ): Promise<FunctionResult> => {
    const { scope } = params;

    // 根据 scope 分发到对应子工具的 execute
    switch (scope) {
      case 'console':
        return cdpConsoleFunction.execute(params, context);
      case 'overlay':
        return cdpOverlayFunction.execute(params, context);
      case 'fetch':
        return cdpFetchFunction.execute(params, context);
      default:
        return { success: false, error: `不支持的 scope: ${scope}` };
    }
  },
};
