/**
 * 标签页导航控制工具函数
 * 支持打开/关闭/切换/列出标签页，以及获取当前活动标签页信息
 */

import type { FunctionDefinition } from './types';

export const tabNavigateFunction: FunctionDefinition = {
  name: 'tab_navigate',
  description: '标签页导航控制。支持：打开/关闭/切换/列出/刷新/前进后退/复制标签页/固定标签页/静音标签页/移动标签页位置等操作。\n\n⚠️ 不要用此工具来：\n- 不要用 navigate 跳转用户正在浏览的页面（用 open 打开新标签页代替）\n- close 前确认不会丢失用户正在进行的工作',
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
        description: '操作类型：open(新标签页)/navigate(当前标签页内跳转)/close/switch/list/current/reload/duplicate/pin/mute/move/go_back/go_forward',
      },
      url: {
        type: 'string',
        description: '打开新标签页或当前标签页内跳转的 URL（action=open/navigate 时必传）',
      },
      tab_id: {
        type: 'number',
        description: '目标标签页 ID（action=close/switch 时使用）',
      },
      active: {
        type: 'boolean',
        description: '是否激活（聚焦）标签页。默认 false（后台打开，不打扰用户）。仅当用户明确要求跳转/查看时才设为 true',
      },
      bypass_cache: {
        type: 'boolean',
        description: '刷新标签页时是否跳过缓存（action=reload）',
      },
      pinned: {
        type: 'boolean',
        description: '是否固定标签页（action=pin）。默认 true',
      },
      muted: {
        type: 'boolean',
        description: '是否静音标签页（action=mute）。默认 true',
      },
      index: {
        type: 'number',
        description: '移动到的目标位置（action=move，0 为最左）',
      },
      keep_alive: {
        type: 'boolean',
        description: '为 true 时标记此标签页在任务结束后保留，不自动关闭。仅 action=open/duplicate 时生效。默认 false（任务结束自动关闭）',
      },
    },
    required: ['action'],
  },
  validate: (params: { action?: string; url?: string; tab_id?: number; index?: number }) => {
    const action = params.action;
    if (!action) return '缺少 action';
    if (action === 'open' && !params.url) return 'open 需要提供 url';
    if (action === 'navigate' && !params.url) return 'navigate 需要提供 url';
    if (action === 'switch' && typeof params.tab_id !== 'number') return 'switch 需要提供 tab_id';
    if (action === 'move' && typeof params.index !== 'number') return 'move 需要提供 index';
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
