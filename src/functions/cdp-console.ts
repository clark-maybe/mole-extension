/**
 * CDP 控制台消息捕获工具
 * 通过 chrome.debugger 的 Runtime 域捕获 console 输出和未捕获异常
 * 辅助 AI 诊断页面 JavaScript 错误和调试信息
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

export const cdpConsoleFunction: FunctionDefinition = {
  name: 'cdp_console',
  description: 'Capture page console messages and uncaught exceptions. Once started, automatically collects console.log/warn/error output and JavaScript uncaught exceptions to help diagnose page issues.',
  supportsParallel: true,
  permissionLevel: 'read',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['start', 'stop', 'get_logs', 'get_exceptions', 'clear'],
        description: 'Action type: start=start capture, stop=stop capture, get_logs=get console messages, get_exceptions=get exceptions, clear=clear all',
      },
      max_entries: {
        type: 'number',
        description: 'Maximum entries to retain when starting. Default: 200.',
      },
      level: {
        type: 'string',
        enum: ['log', 'warn', 'error', 'info', 'debug'],
        description: 'Filter by level when using get_logs.',
      },
      limit: {
        type: 'number',
        description: 'Maximum entries returned by get_logs/get_exceptions. Default: 200.',
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
    if (!['start', 'stop', 'get_logs', 'get_exceptions', 'clear'].includes(action)) {
      return `Unsupported action: ${action}`;
    }
    return null;
  },

  execute: async (
    params: {
      action: string;
      max_entries?: number;
      level?: string;
      limit?: number;
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
        return { success: false, error: 'Unable to determine target tab' };
      }
      tabId = activeTabId;
    }

    switch (action) {
      case 'start': {
        const result = await CDPSessionManager.startConsoleListening(tabId, params.max_entries || 200);
        if (!result.success) {
          return { success: false, error: `Failed to start console capture: ${result.error}` };
        }
        return {
          success: true,
          data: {
            tab_id: tabId,
            max_entries: params.max_entries || 200,
            message: 'Console message capture started',
          },
        };
      }

      case 'stop': {
        CDPSessionManager.stopConsoleListening(tabId);
        return {
          success: true,
          data: { message: 'Console capture stopped' },
        };
      }

      case 'get_logs': {
        if (!CDPSessionManager.isConsoleListening(tabId)) {
          return {
            success: false,
            error: 'Console capture not started. Please call the start action first.',
          };
        }
        const entries = CDPSessionManager.getConsoleEntries(tabId, {
          level: params.level,
          limit: params.limit,
        });
        // 格式化输出
        const formatted = entries.map((e) => ({
          level: e.type,
          text: e.text,
          url: e.url,
          line: e.lineNumber,
          time: e.timestamp,
        }));
        return {
          success: true,
          data: {
            total: formatted.length,
            logs: formatted,
          },
        };
      }

      case 'get_exceptions': {
        if (!CDPSessionManager.isConsoleListening(tabId)) {
          return {
            success: false,
            error: 'Console capture not started. Please call the start action first.',
          };
        }
        const exceptions = CDPSessionManager.getExceptionEntries(tabId, params.limit);
        const formatted = exceptions.map((e) => ({
          text: e.text,
          url: e.url,
          line: e.lineNumber,
          column: e.columnNumber,
          stack: e.stackTrace,
          time: e.timestamp,
        }));
        return {
          success: true,
          data: {
            total: formatted.length,
            exceptions: formatted,
          },
        };
      }

      case 'clear': {
        CDPSessionManager.clearConsoleEntries(tabId);
        return {
          success: true,
          data: { message: 'Console capture cleared' },
        };
      }

      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  },
};
