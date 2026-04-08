/**
 * 标签页导航控制工具函数
 * 支持打开/关闭/切换/列出标签页，以及获取当前活动标签页信息
 */

import type { FunctionDefinition } from './types';

export const tabNavigateFunction: FunctionDefinition = {
  name: 'tab_navigate',
  description: 'Tab navigation control. Supports: open/close/switch/list/reload/go back & forward/duplicate/pin/mute/move tab position.\n\n⚠️ Do NOT use this tool for:\n- Do not use navigate to redirect the page the user is currently browsing (use open to create a new tab instead)\n- Before close, make sure it will not lose the user\'s ongoing work',
  supportsParallel: false,
  permissionLevel: 'interact',
  actionPermissions: {
    navigate: 'dangerous',
    close: 'dangerous',
  },
  approvalMessageTemplate: {
    navigate: 'AI 正在请求跳转当前页面到 {url}',
    close: 'AI 正在请求关闭标签页',
  },
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['open', 'navigate', 'close', 'switch', 'list', 'current', 'reload', 'duplicate', 'pin', 'mute', 'move', 'go_back', 'go_forward'],
        description: 'Action type: open(new tab)/navigate(navigate within current tab)/close/switch/list/current/reload/duplicate/pin/mute/move/go_back/go_forward',
      },
      url: {
        type: 'string',
        description: 'URL to open in a new tab or navigate within the current tab (required when action=open/navigate)',
      },
      tab_id: {
        type: 'number',
        description: 'Target tab ID (used when action=close/switch)',
      },
      active: {
        type: 'boolean',
        description: 'Whether to activate (focus) the tab. Default false (opens in background without disturbing the user). Only set to true when the user explicitly requests to navigate/view',
      },
      bypass_cache: {
        type: 'boolean',
        description: 'Whether to bypass cache when reloading the tab (action=reload)',
      },
      pinned: {
        type: 'boolean',
        description: 'Whether to pin the tab (action=pin). Default true',
      },
      muted: {
        type: 'boolean',
        description: 'Whether to mute the tab (action=mute). Default true',
      },
      index: {
        type: 'number',
        description: 'Target position to move to (action=move, 0 is leftmost)',
      },
      keep_alive: {
        type: 'boolean',
        description: 'Default false (auto-close when task ends). Almost never needs to be true. Only set to true when the user explicitly says "open it for me" / "show me this page" and wants the page to persist. Temporary tabs opened during work (searching, researching, data collection) should NEVER be set to true',
      },
    },
    required: ['action'],
  },
  validate: (params: { action?: string; url?: string; tab_id?: number; index?: number }) => {
    const action = params.action;
    if (!action) return 'Missing action';
    if (action === 'open' && !params.url) return 'open requires url';
    if (action === 'navigate' && !params.url) return 'navigate requires url';
    if (action === 'switch' && typeof params.tab_id !== 'number') return 'switch requires tab_id';
    if (action === 'move' && typeof params.index !== 'number') return 'move requires index';
    return null;
  },
  execute: async (
    params: {
      action: string;
      url?: string;
      tab_id?: number;
      active?: boolean;
      bypass_cache?: boolean;
      pinned?: boolean;
      muted?: boolean;
      index?: number;
    },
    context?: { tabId?: number },
  ) => {
    const { action, url, tab_id, active = false, bypass_cache = false, pinned = true, muted = true, index } = params;

    switch (action) {
      case 'open': {
        if (!url) {
          return { success: false, error: '打开标签页需要提供 url' };
        }
        const tab = await chrome.tabs.create({ url, active });
        return {
          success: true,
          data: {
            tab_id: tab.id,
            url: tab.pendingUrl || url,
            message: active ? '已打开并跳转到新标签页' : '已在后台打开新标签页',
          },
        };
      }

      case 'navigate': {
        if (!url) {
          return { success: false, error: '当前标签页导航需要提供 url' };
        }
        const targetId = tab_id || context?.tabId;
        if (!targetId) {
          return { success: false, error: '无法确定当前标签页' };
        }
        try {
          const tab = await chrome.tabs.update(targetId, { url });
          return {
            success: true,
            data: {
              tab_id: tab.id,
              url: tab.pendingUrl || url,
              message: '已在当前标签页内导航',
            },
          };
        } catch (err: any) {
          return { success: false, error: `当前标签页导航失败: ${err.message}` };
        }
      }

      case 'close': {
        const targetId = tab_id || context?.tabId;
        if (!targetId) {
          return { success: false, error: '需要提供 tab_id' };
        }
        try {
          await chrome.tabs.remove(targetId);
          return {
            success: true,
            data: { message: `已关闭标签页 ${targetId}` },
          };
        } catch (err: any) {
          return { success: false, error: `关闭标签页失败: ${err.message}` };
        }
      }

      case 'switch': {
        if (!tab_id) {
          return { success: false, error: '切换标签页需要提供 tab_id' };
        }
        try {
          await chrome.tabs.update(tab_id, { active: true });
          const tab = await chrome.tabs.get(tab_id);
          return {
            success: true,
            data: {
              tab_id: tab.id,
              url: tab.url,
              title: tab.title,
              message: '已切换到目标标签页',
            },
          };
        } catch (err: any) {
          return { success: false, error: `切换标签页失败: ${err.message}` };
        }
      }

      case 'list': {
        const tabs = await chrome.tabs.query({ currentWindow: true });
        const tabList = tabs.map(t => ({
          tab_id: t.id,
          title: t.title || '',
          url: t.url || '',
          active: t.active,
          index: t.index,
        }));
        return {
          success: true,
          data: { total: tabList.length, tabs: tabList },
        };
      }

      case 'current': {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!activeTab) {
          return { success: false, error: '无法获取当前标签页' };
        }
        return {
          success: true,
          data: {
            tab_id: activeTab.id,
            title: activeTab.title,
            url: activeTab.url,
            favicon: activeTab.favIconUrl,
          },
        };
      }

      case 'reload': {
        const targetId = tab_id || context?.tabId;
        if (!targetId) return { success: false, error: '刷新标签页需要提供 tab_id' };
        try {
          await chrome.tabs.reload(targetId, { bypassCache: bypass_cache });
          return {
            success: true,
            data: { tab_id: targetId, bypass_cache, message: '已刷新标签页' },
          };
        } catch (err: any) {
          return { success: false, error: `刷新标签页失败: ${err.message}` };
        }
      }

      case 'duplicate': {
        const targetId = tab_id || context?.tabId;
        if (!targetId) return { success: false, error: '复制标签页需要提供 tab_id' };
        try {
          const tab = await chrome.tabs.duplicate(targetId);
          return {
            success: true,
            data: {
              tab_id: tab.id,
              url: tab.url,
              title: tab.title,
              message: '已复制标签页',
            },
          };
        } catch (err: any) {
          return { success: false, error: `复制标签页失败: ${err.message}` };
        }
      }

      case 'pin': {
        const targetId = tab_id || context?.tabId;
        if (!targetId) return { success: false, error: '固定标签页需要提供 tab_id' };
        try {
          const tab = await chrome.tabs.update(targetId, { pinned });
          return {
            success: true,
            data: {
              tab_id: tab.id,
              pinned: tab.pinned,
              message: tab.pinned ? '已固定标签页' : '已取消固定标签页',
            },
          };
        } catch (err: any) {
          return { success: false, error: `更新标签页固定状态失败: ${err.message}` };
        }
      }

      case 'mute': {
        const targetId = tab_id || context?.tabId;
        if (!targetId) return { success: false, error: '静音标签页需要提供 tab_id' };
        try {
          const tab = await chrome.tabs.update(targetId, { muted });
          return {
            success: true,
            data: {
              tab_id: tab.id,
              muted: tab.mutedInfo?.muted || false,
              message: tab.mutedInfo?.muted ? '已静音标签页' : '已取消静音',
            },
          };
        } catch (err: any) {
          return { success: false, error: `更新标签页静音状态失败: ${err.message}` };
        }
      }

      case 'move': {
        const targetId = tab_id || context?.tabId;
        if (!targetId || typeof index !== 'number' || !Number.isFinite(index)) {
          return { success: false, error: '移动标签页需要提供 tab_id 和有效的 index' };
        }
        try {
          const tab = await chrome.tabs.move(targetId, { index: Math.max(0, Math.floor(index)) });
          return {
            success: true,
            data: {
              tab_id: tab.id,
              index: tab.index,
              message: `已移动标签页到位置 ${tab.index}`,
            },
          };
        } catch (err: any) {
          return { success: false, error: `移动标签页失败: ${err.message}` };
        }
      }

      case 'go_back': {
        const targetId = tab_id || context?.tabId;
        if (!targetId) return { success: false, error: '后退需要提供 tab_id' };
        try {
          await chrome.tabs.goBack(targetId);
          return {
            success: true,
            data: { tab_id: targetId, message: '已执行后退' },
          };
        } catch (err: any) {
          return { success: false, error: `后退失败: ${err.message}` };
        }
      }

      case 'go_forward': {
        const targetId = tab_id || context?.tabId;
        if (!targetId) return { success: false, error: '前进需要提供 tab_id' };
        try {
          await chrome.tabs.goForward(targetId);
          return {
            success: true,
            data: { tab_id: targetId, message: '已执行前进' },
          };
        } catch (err: any) {
          return { success: false, error: `前进失败: ${err.message}` };
        }
      }

      default:
        return { success: false, error: `不支持的操作: ${action}` };
    }
  },
};
