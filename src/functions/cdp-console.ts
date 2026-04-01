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
  description: '捕获页面控制台消息和未捕获异常。开始捕获后，自动收集 console.log/warn/error 输出以及 JavaScript 未捕获异常，帮助诊断页面问题。',
  supportsParallel: true,
  permissionLevel: 'read',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['start', 'stop', 'get_logs', 'get_exceptions', 'clear'],
        description: '操作类型：start=开始捕获, stop=停止, get_logs=获取console消息, get_exceptions=获取异常, clear=清空',
      },
      max_entries: {
        type: 'number',
        description: 'start 时最大保留条数，默认 200',
      },
      level: {
        type: 'string',
        enum: ['log', 'warn', 'error', 'info', 'debug'],
        description: 'get_logs 时按级别过滤',
      },
      limit: {
        type: 'number',
        description: 'get_logs/get_exceptions 返回条数上限，默认 200',
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
    if (!['start', 'stop', 'get_logs', 'get_exceptions', 'clear'].includes(action)) {
      return `不支持的 action: ${action}`;
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
        const result = await CDPSessionManager.startConsoleListening(tabId, params.max_entries || 200);
        if (!result.success) {
          return { success: false, error: `启动控制台捕获失败: ${result.error}` };
        }
        return {
          success: true,
          data: {
            tab_id: tabId,
            max_entries: params.max_entries || 200,
            message: '控制台消息捕获已启动',
          },
        };
      }

      case 'stop': {
        CDPSessionManager.stopConsoleListening(tabId);
        return {
          success: true,
          data: { message: '控制台捕获已停止' },
        };
      }

      case 'get_logs': {
        if (!CDPSessionManager.isConsoleListening(tabId)) {
          return {
            success: false,
            error: '尚未启动控制台捕获。请先调用 start 操作。',
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
            error: '尚未启动控制台捕获。请先调用 start 操作。',
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
          data: { message: '控制台捕获已清空' },
        };
      }

      default:
        return { success: false, error: `未知操作: ${action}` };
    }
  },
};
