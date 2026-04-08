/**
 * CDP 对话框处理工具
 * 通过 chrome.debugger 查询和处理 JavaScript 对话框（alert/confirm/prompt/beforeunload）
 * 对话框会阻断自动化流程，本工具让 AI 能检测并处理它们
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

export const cdpDialogFunction: FunctionDefinition = {
  name: 'cdp_dialog',
  description: 'Query and handle JavaScript dialogs (alert/confirm/prompt/beforeunload). Dialogs block page operations and must be handled before automation can continue. Supports querying, accepting, dismissing dialogs, and setting auto-handling policies.',
  supportsParallel: false,
  permissionLevel: 'interact',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['query', 'accept', 'dismiss', 'set_auto'],
        description: 'Action type: query=query pending dialogs, accept=accept dialog, dismiss=dismiss/close dialog, set_auto=set auto-handling policy',
      },
      prompt_text: {
        type: 'string',
        description: 'Text to enter into the prompt input when action=accept and dialog type is prompt',
      },
      policy: {
        type: 'string',
        enum: ['manual', 'auto_accept', 'auto_dismiss'],
        description: 'Auto-handling policy (only for action=set_auto): manual=handle manually, auto_accept=auto accept, auto_dismiss=auto dismiss',
      },
      tab_id: {
        type: 'number',
        description: 'Target tab ID. Uses the current active tab if not provided.',
      },
    },
    required: ['action'],
  },

  validate: (params: any): string | null => {
    const { action } = params || {};
    if (!action) return 'Missing action parameter';
    if (!['query', 'accept', 'dismiss', 'set_auto'].includes(action)) {
      return `Unsupported action: ${action}`;
    }
    if (action === 'set_auto') {
      const { policy } = params;
      if (!policy || !['manual', 'auto_accept', 'auto_dismiss'].includes(policy)) {
        return 'set_auto action requires policy parameter (manual/auto_accept/auto_dismiss)';
      }
    }
    return null;
  },

  execute: async (
    params: {
      action: string;
      prompt_text?: string;
      policy?: string;
      tab_id?: number;
    },
    context?: ToolExecutionContext,
  ): Promise<FunctionResult> => {
    const { action, prompt_text, policy, tab_id } = params;

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

    // 确保 debugger 已 attach（query 也需要，因为事件监听依赖 attach）
    const attachResult = await CDPSessionManager.attach(tabId);
    if (!attachResult.success) {
      return { success: false, error: `无法连接调试器: ${attachResult.error}` };
    }

    switch (action) {
      case 'query': {
        const dialog = CDPSessionManager.getPendingDialog(tabId);
        const currentPolicy = CDPSessionManager.getDialogPolicy(tabId);
        if (!dialog) {
          return {
            success: true,
            data: {
              has_dialog: false,
              current_policy: currentPolicy,
              message: '当前没有待处理的对话框',
            },
          };
        }
        return {
          success: true,
          data: {
            has_dialog: true,
            dialog_type: dialog.type,
            dialog_message: dialog.message,
            default_prompt: dialog.defaultPrompt || undefined,
            dialog_url: dialog.url || undefined,
            received_at: dialog.receivedAt,
            current_policy: currentPolicy,
            message: `检测到 ${dialog.type} 对话框: "${dialog.message}"`,
          },
        };
      }

      case 'accept': {
        const result = await CDPSessionManager.handleDialog(tabId, true, prompt_text);
        if (!result.success) {
          return { success: false, error: result.error || '接受对话框失败' };
        }
        return {
          success: true,
          data: {
            message: prompt_text
              ? `已接受对话框，输入文本: "${prompt_text}"`
              : '已接受对话框',
          },
        };
      }

      case 'dismiss': {
        const result = await CDPSessionManager.handleDialog(tabId, false);
        if (!result.success) {
          return { success: false, error: result.error || '拒绝对话框失败' };
        }
        return {
          success: true,
          data: { message: '已拒绝/关闭对话框' },
        };
      }

      case 'set_auto': {
        const validPolicy = policy as 'manual' | 'auto_accept' | 'auto_dismiss';
        CDPSessionManager.setDialogPolicy(tabId, validPolicy);
        const policyLabels: Record<string, string> = {
          manual: '手动处理',
          auto_accept: '自动接受',
          auto_dismiss: '自动拒绝',
        };
        return {
          success: true,
          data: {
            policy: validPolicy,
            message: `对话框策略已设置为: ${policyLabels[validPolicy]}`,
          },
        };
      }

      default:
        return { success: false, error: `未知操作: ${action}` };
    }
  },
};
