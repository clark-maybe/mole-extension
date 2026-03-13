/**
 * 网络请求监听工具函数
 * 提供页面级请求监听、事件查询与错误诊断能力。
 */

import type { FunctionDefinition } from './types';
import { NetworkMonitorStore } from '../lib/network-monitor';

export const networkMonitorFunction: FunctionDefinition = {
  name: 'network_monitor',
  description: '网络请求监听与诊断。支持 start/stop/list/get_events/summary/clear_events，帮助 AI 观察页面请求、定位接口错误、分析资源加载问题。',
  supportsParallel: false,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['start', 'stop', 'list', 'get_events', 'summary', 'clear_events'],
        description: '操作类型：start(开始监听)、stop(停止监听)、list(列出监听会话)、get_events(获取事件)、summary(聚合统计)、clear_events(清空事件)',
      },
      monitor_id: {
        type: 'string',
        description: '监听会话 ID。stop/get_events/summary/clear_events 可使用',
      },
      tab_id: {
        type: 'number',
        description: '目标标签页 ID。start 时可指定；stop/get_events/summary 也可按 tab 过滤',
      },
      url_patterns: {
        type: 'array',
        items: { type: 'string' },
        description: 'URL 过滤模式数组，支持 * 通配（如 "*://api.example.com/*"），默认监听全部',
      },
      resource_types: {
        type: 'array',
        items: { type: 'string' },
        description: '资源类型过滤，如 xhr/fetch/script/image/document 等',
      },
      max_events: {
        type: 'number',
        description: '每个监听会话最大保留事件数，默认300，最大2000',
      },
      include_inactive: {
        type: 'boolean',
        description: 'list 时是否包含已停止会话，默认 false',
      },
      only_errors: {
        type: 'boolean',
        description: 'get_events 时是否仅返回错误请求（网络错误或 HTTP >=400）',
      },
      limit: {
        type: 'number',
        description: 'get_events 返回条数上限，默认200，最大2000',
      },
    },
    required: ['action'],
  },
  execute: async (
    params: {
      action: 'start' | 'stop' | 'list' | 'get_events' | 'summary' | 'clear_events';
      monitor_id?: string;
      tab_id?: number;
      url_patterns?: string[];
      resource_types?: string[];
      max_events?: number;
      include_inactive?: boolean;
      only_errors?: boolean;
      limit?: number;
    },
    context?: { tabId?: number },
  ) => {
    if (!NetworkMonitorStore.isSupported()) {
      return { success: false, error: '当前环境不支持网络监听（缺少 webRequest 权限）' };
    }

    const targetTabId = params.tab_id || context?.tabId;

    switch (params.action) {
      case 'start': {
        if (!targetTabId) {
          return { success: false, error: 'start 需要 tab_id（或在当前标签页上下文调用）' };
        }
        const session = NetworkMonitorStore.start({
          tabId: targetTabId,
          urlPatterns: params.url_patterns,
          resourceTypes: params.resource_types,
          maxEvents: params.max_events,
        });
        return {
          success: true,
          data: {
            monitor_id: session.id,
            tab_id: session.tabId,
            message: `已开始网络监听（${session.id}）`,
            url_patterns: session.urlPatterns,
            resource_types: session.resourceTypes,
            max_events: session.maxEvents,
          },
        };
      }

      case 'stop': {
        if (params.monitor_id) {
          const stopped = NetworkMonitorStore.stop(params.monitor_id);
          if (!stopped) return { success: false, error: `未找到监听会话: ${params.monitor_id}` };
          return {
            success: true,
            data: {
              message: `已停止监听: ${params.monitor_id}`,
              monitor_id: params.monitor_id,
              stopped_ids: [params.monitor_id],
            },
          };
        }
        if (!targetTabId) return { success: false, error: 'stop 需要 monitor_id 或 tab_id' };
        const activeMonitorIds = NetworkMonitorStore
          .list({ includeInactive: false })
          .filter((session) => session.active && session.tabId === targetTabId)
          .map((session) => session.id);
        const count = NetworkMonitorStore.stopByTab(targetTabId);
        return {
          success: true,
          data: {
            message: `已停止 tab ${targetTabId} 的 ${count} 个监听会话`,
            count,
            tab_id: targetTabId,
            stopped_ids: activeMonitorIds,
          },
        };
      }

      case 'list': {
        const sessions = NetworkMonitorStore.list({ includeInactive: !!params.include_inactive });
        const filtered = typeof targetTabId === 'number'
          ? sessions.filter((s) => s.tabId === targetTabId)
          : sessions;
        return {
          success: true,
          data: {
            total: filtered.length,
            monitors: filtered.map((s) => ({
              monitor_id: s.id,
              tab_id: s.tabId,
              active: s.active,
              created_at: new Date(s.createdAt).toLocaleString('zh-CN'),
              event_count: s.eventCount,
              url_patterns: s.urlPatterns,
              resource_types: s.resourceTypes,
              max_events: s.maxEvents,
            })),
          },
        };
      }

      case 'get_events': {
        const events = NetworkMonitorStore.getEvents({
          monitorId: params.monitor_id,
          tabId: targetTabId,
          onlyErrors: !!params.only_errors,
          limit: params.limit,
        });
        return {
          success: true,
          data: {
            total: events.length,
            events,
          },
        };
      }

      case 'summary': {
        const summary = NetworkMonitorStore.getSummary({
          monitorId: params.monitor_id,
          tabId: targetTabId,
        });
        return {
          success: true,
          data: summary,
        };
      }

      case 'clear_events': {
        const cleared = NetworkMonitorStore.clearEvents(params.monitor_id);
        return {
          success: true,
          data: {
            message: params.monitor_id
              ? `已清空监听 ${params.monitor_id} 的 ${cleared} 条事件`
              : `已清空全部监听事件，共 ${cleared} 条`,
            cleared,
          },
        };
      }

      default:
        return { success: false, error: `不支持的操作: ${params.action}` };
    }
  },
};
