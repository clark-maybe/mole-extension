/**
 * CDP 本地存储操作工具
 * 通过 chrome.debugger 的 DOMStorage 域操作页面的 localStorage / sessionStorage
 * 无需 content script 即可跨域读写存储数据
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

/** 获取页面的 securityOrigin */
const getSecurityOrigin = async (tabId: number): Promise<string | null> => {
  // 通过 Runtime.evaluate 获取 location.origin
  const result = await CDPSessionManager.sendCommand(tabId, 'Runtime.evaluate', {
    expression: 'location.origin',
    returnByValue: true,
  });
  if (result.success && result.result?.result?.value) {
    return result.result.result.value;
  }
  return null;
};

/** 构建 storageId 对象 */
const buildStorageId = (securityOrigin: string, isLocalStorage: boolean) => ({
  securityOrigin,
  isLocalStorage,
});

export const cdpStorageFunction: FunctionDefinition = {
  name: 'cdp_storage',
  description: '页面存储操作工具（CDP DOMStorage 域）。读写目标页面的 localStorage 和 sessionStorage，无需 content script。适用于读取页面登录 token、修改缓存配置、清除存储数据等场景。',
  supportsParallel: true,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['get_items', 'get_item', 'set_item', 'remove_item', 'clear'],
        description: '操作类型：get_items=获取全部键值对, get_item=获取单个值, set_item=设置值, remove_item=删除值, clear=清空存储',
      },
      storage_type: {
        type: 'string',
        enum: ['local', 'session'],
        description: '存储类型：local=localStorage（默认）, session=sessionStorage',
      },
      key: {
        type: 'string',
        description: 'get_item/set_item/remove_item 的键名',
      },
      value: {
        type: 'string',
        description: 'set_item 的值',
      },
      security_origin: {
        type: 'string',
        description: '目标页面的 origin（如 "https://example.com"），不传则自动获取当前页面的 origin',
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
    const validActions = ['get_items', 'get_item', 'set_item', 'remove_item', 'clear'];
    if (!validActions.includes(action)) {
      return `不支持的 action: ${action}`;
    }
    if (['get_item', 'remove_item'].includes(action) && !params.key) {
      return `${action} 需要 key 参数`;
    }
    if (action === 'set_item') {
      if (!params.key) return 'set_item 需要 key 参数';
      if (params.value === undefined) return 'set_item 需要 value 参数';
    }
    return null;
  },

  execute: async (
    params: {
      action: string;
      storage_type?: string;
      key?: string;
      value?: string;
      security_origin?: string;
      tab_id?: number;
    },
    context?: ToolExecutionContext,
  ): Promise<FunctionResult> => {
    const { action, tab_id } = params;
    const isLocalStorage = params.storage_type !== 'session';

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

    // 确保 debugger 已 attach
    const attachResult = await CDPSessionManager.attach(tabId);
    if (!attachResult.success) {
      return { success: false, error: `无法连接调试器: ${attachResult.error}` };
    }

    // 启用 DOMStorage 域
    await CDPSessionManager.sendCommand(tabId, 'DOMStorage.enable', {});

    // 获取 securityOrigin
    let origin = params.security_origin;
    if (!origin) {
      origin = await getSecurityOrigin(tabId);
      if (!origin) {
        return { success: false, error: '无法获取页面 origin，请手动指定 security_origin 参数' };
      }
    }

    const storageId = buildStorageId(origin, isLocalStorage);
    const storageLabel = isLocalStorage ? 'localStorage' : 'sessionStorage';

    switch (action) {
      case 'get_items': {
        const result = await CDPSessionManager.sendCommand(tabId, 'DOMStorage.getDOMStorageItems', {
          storageId,
        });
        if (!result.success) {
          return { success: false, error: `获取 ${storageLabel} 失败: ${result.error}` };
        }
        const entries: Array<[string, string]> = result.result?.entries || [];
        const items: Record<string, string> = {};
        for (const [key, value] of entries) {
          items[key] = value;
        }
        return {
          success: true,
          data: {
            storage_type: storageLabel,
            origin,
            items,
            count: Object.keys(items).length,
            message: `获取到 ${Object.keys(items).length} 个 ${storageLabel} 条目`,
          },
        };
      }

      case 'get_item': {
        const result = await CDPSessionManager.sendCommand(tabId, 'DOMStorage.getDOMStorageItems', {
          storageId,
        });
        if (!result.success) {
          return { success: false, error: `获取 ${storageLabel} 失败: ${result.error}` };
        }
        const entries: Array<[string, string]> = result.result?.entries || [];
        const found = entries.find(([k]) => k === params.key);
        if (!found) {
          return {
            success: true,
            data: {
              key: params.key,
              value: null,
              exists: false,
              message: `${storageLabel} 中不存在 key "${params.key}"`,
            },
          };
        }
        return {
          success: true,
          data: {
            key: params.key,
            value: found[1],
            exists: true,
            message: `获取 ${storageLabel}["${params.key}"] 成功`,
          },
        };
      }

      case 'set_item': {
        const result = await CDPSessionManager.sendCommand(tabId, 'DOMStorage.setDOMStorageItem', {
          storageId,
          key: params.key,
          value: params.value,
        });
        if (!result.success) {
          return { success: false, error: `设置 ${storageLabel} 失败: ${result.error}` };
        }
        return {
          success: true,
          data: {
            key: params.key,
            value: params.value,
            message: `${storageLabel}["${params.key}"] 已设置`,
          },
        };
      }

      case 'remove_item': {
        const result = await CDPSessionManager.sendCommand(tabId, 'DOMStorage.removeDOMStorageItem', {
          storageId,
          key: params.key,
        });
        if (!result.success) {
          return { success: false, error: `删除 ${storageLabel} 条目失败: ${result.error}` };
        }
        return {
          success: true,
          data: {
            key: params.key,
            message: `${storageLabel}["${params.key}"] 已删除`,
          },
        };
      }

      case 'clear': {
        const result = await CDPSessionManager.sendCommand(tabId, 'DOMStorage.clear', {
          storageId,
        });
        if (!result.success) {
          return { success: false, error: `清空 ${storageLabel} 失败: ${result.error}` };
        }
        return {
          success: true,
          data: {
            storage_type: storageLabel,
            origin,
            message: `${storageLabel} 已清空`,
          },
        };
      }

      default:
        return { success: false, error: `未知操作: ${action}` };
    }
  },
};
