/**
 * 周期任务工具函数
 * 设置周期性监控任务，每隔指定时间自动执行操作
 * 使用 Chrome Alarms API 实现，可存活 Service Worker 重启
 */

import type { FunctionDefinition } from './types';
import { TimerStore } from '../lib/timer-store';
import { TimerScheduler } from '../lib/timer-scheduler';

const ONE_MINUTE_MS = 60 * 1000;

const parseIntervalMs = (params: {
  interval_ms?: number;
  interval_seconds?: number;
  interval_minutes?: number;
}): number => {
  const { interval_ms, interval_seconds, interval_minutes } = params;
  let totalMs = 0;
  if (typeof interval_ms === 'number' && Number.isFinite(interval_ms)) totalMs += interval_ms;
  if (typeof interval_seconds === 'number' && Number.isFinite(interval_seconds)) totalMs += interval_seconds * 1000;
  if (typeof interval_minutes === 'number' && Number.isFinite(interval_minutes)) totalMs += interval_minutes * ONE_MINUTE_MS;
  return totalMs;
};

export const setIntervalFunction: FunctionDefinition = {
  name: 'set_interval',
  description: '设置周期性监控任务，每隔指定时间自动执行操作。支持毫秒/秒/分钟粒度。适用于：高频页面监测、价格监控、周期性采集等。',
  supportsParallel: false,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: '每次到期时要执行的操作描述。例如："查看当前页面的商品价格，如果低于500元就提醒用户"',
      },
      interval_ms: {
        type: 'number',
        description: '执行间隔（毫秒），可与 interval_seconds / interval_minutes 叠加',
      },
      interval_seconds: {
        type: 'number',
        description: '执行间隔（秒），可与 interval_ms / interval_minutes 叠加',
      },
      interval_minutes: {
        type: 'number',
        description: '执行间隔（分钟），可与 interval_ms / interval_seconds 叠加',
      },
      max_count: {
        type: 'number',
        description: '最大执行次数，达到后自动停止。默认10次，最大100次',
      },
    },
    required: ['action'],
  },
  validate: (params: {
    action?: string;
    interval_ms?: number;
    interval_seconds?: number;
    interval_minutes?: number;
    max_count?: number;
  }) => {
    if (!params.action || !params.action.trim()) return 'action 不能为空';
    const hasInterval = ['interval_ms', 'interval_seconds', 'interval_minutes']
      .some((field) => {
        const value = (params as Record<string, unknown>)[field];
        return typeof value === 'number' && Number.isFinite(value);
      });
    if (!hasInterval) return '需要提供 interval_ms/interval_seconds/interval_minutes 之一';
    if (typeof params.max_count === 'number' && params.max_count <= 0) {
      return 'max_count 必须大于 0';
    }
    return null;
  },
  execute: async (
    params: { action: string; interval_ms?: number; interval_seconds?: number; interval_minutes?: number; max_count?: number },
    context?: { tabId?: number },
  ) => {
    const { action, max_count = 10 } = params;

    const intervalMs = parseIntervalMs(params);
    if (intervalMs <= 0) {
      return {
        success: false,
        error: '必须提供有效的 interval_ms / interval_seconds / interval_minutes（可叠加）',
      };
    }

    const safeIntervalMs = Math.max(1, Math.floor(intervalMs));
    const minutes = Math.max(1, safeIntervalMs / ONE_MINUTE_MS);
    const safeMaxCount = Math.min(Math.max(1, max_count), 100);
    const scheduleMode: 'alarm' | 'runtime' = safeIntervalMs < ONE_MINUTE_MS ? 'runtime' : 'alarm';
    const precision: 'millisecond' | 'minute' = safeIntervalMs < ONE_MINUTE_MS ? 'millisecond' : 'minute';

    const id = `i_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const alarmName = `mole_timer_${id}`;
    const nextRunAt = Date.now() + safeIntervalMs;

    if (scheduleMode === 'runtime') {
      TimerScheduler.scheduleInterval(id, safeIntervalMs);
    } else {
      // 创建周期性 alarm，首次也延迟 interval 时间
      await chrome.alarms.create(alarmName, {
        delayInMinutes: minutes,
        periodInMinutes: minutes,
      });
    }

    await TimerStore.save({
      id,
      type: 'interval',
      action,
      tabId: context?.tabId || 0,
      createdAt: Date.now(),
      scheduleMode,
      precision,
      intervalMinutes: minutes,
      intervalMs: safeIntervalMs,
      nextRunAt,
      maxCount: safeMaxCount,
      currentCount: 0,
    });

    return {
      success: true,
      data: {
        timer_id: id,
        message: `已设置周期任务，每 ${safeIntervalMs} 毫秒执行一次，最多 ${safeMaxCount} 次（${scheduleMode === 'runtime' ? '毫秒级' : '分钟级'}调度）`,
        action,
        interval_ms: safeIntervalMs,
        interval_minutes: minutes,
        max_count: safeMaxCount,
        schedule_mode: scheduleMode,
        precision,
      },
    };
  },
};
