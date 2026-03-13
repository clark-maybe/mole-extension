/**
 * 延时任务工具函数
 * 设置延时任务，在指定时间后自动执行操作
 * 使用 Chrome Alarms API 实现，可存活 Service Worker 重启
 */

import type { FunctionDefinition } from './types';
import { TimerStore } from '../lib/timer-store';
import { TimerScheduler } from '../lib/timer-scheduler';

const ONE_MINUTE_MS = 60 * 1000;

const parseTimeoutDelayMs = (params: {
  delay_ms?: number;
  delay_seconds?: number;
  delay_minutes?: number;
  execute_at?: string;
}): { delayMs: number; targetTs: number; source: 'delay' | 'execute_at' } | null => {
  const { delay_ms, delay_seconds, delay_minutes, execute_at } = params;

  if (execute_at) {
    const targetTs = new Date(execute_at).getTime();
    if (!Number.isFinite(targetTs)) {
      return null;
    }
    return { delayMs: targetTs - Date.now(), targetTs, source: 'execute_at' };
  }

  let delayMs = 0;
  if (typeof delay_ms === 'number' && Number.isFinite(delay_ms)) delayMs += delay_ms;
  if (typeof delay_seconds === 'number' && Number.isFinite(delay_seconds)) delayMs += delay_seconds * 1000;
  if (typeof delay_minutes === 'number' && Number.isFinite(delay_minutes)) delayMs += delay_minutes * ONE_MINUTE_MS;

  if (delayMs <= 0) return null;
  return { delayMs, targetTs: Date.now() + delayMs, source: 'delay' };
};

export const setTimeoutFunction: FunctionDefinition = {
  name: 'set_timeout',
  description: '设置延时任务，在指定时间后自动执行操作。支持毫秒/秒/分钟三种粒度，适用于：高精度等待、延迟执行、预约查询等。到期后 AI 会自动执行指定操作并推送结果。',
  supportsParallel: false,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: '到期时要执行的操作描述，会作为新一轮 AI 对话的输入。例如："搜索今天的天气预报并告诉用户"',
      },
      delay_ms: {
        type: 'number',
        description: '延迟毫秒数（可小于1分钟）。可与 delay_seconds / delay_minutes 叠加使用；与 execute_at 二选一',
      },
      delay_seconds: {
        type: 'number',
        description: '延迟秒数。可与 delay_ms / delay_minutes 叠加使用；与 execute_at 二选一',
      },
      delay_minutes: {
        type: 'number',
        description: '延迟分钟数。可与 delay_ms / delay_seconds 叠加使用；与 execute_at 二选一',
      },
      execute_at: {
        type: 'string',
        description: '执行时间，ISO 8601 格式（如 "2024-01-01T18:00:00.250+08:00"）。与 delay_ms/delay_seconds/delay_minutes 二选一',
      },
    },
    required: ['action'],
  },
  validate: (params: {
    action?: string;
    delay_ms?: number;
    delay_seconds?: number;
    delay_minutes?: number;
    execute_at?: string;
  }) => {
    if (!params.action || !params.action.trim()) return 'action 不能为空';
    const hasDelay = ['delay_ms', 'delay_seconds', 'delay_minutes']
      .some((field) => {
        const value = (params as Record<string, unknown>)[field];
        return typeof value === 'number' && Number.isFinite(value);
      });
    const hasExecuteAt = typeof params.execute_at === 'string' && params.execute_at.trim().length > 0;
    if (!hasDelay && !hasExecuteAt) {
      return '需要提供 delay_ms/delay_seconds/delay_minutes 或 execute_at';
    }
    if (hasDelay && hasExecuteAt) {
      return 'execute_at 与 delay_* 不能同时提供';
    }
    return null;
  },
  execute: async (
    params: {
      action: string;
      delay_ms?: number;
      delay_seconds?: number;
      delay_minutes?: number;
      execute_at?: string;
    },
    context?: { tabId?: number },
  ) => {
    const { action, execute_at } = params;

    const parsedDelay = parseTimeoutDelayMs(params);
    if (!parsedDelay) {
      return {
        success: false,
        error: '必须提供有效的 delay_ms / delay_seconds / delay_minutes（可叠加）或 execute_at',
      };
    }
    const { delayMs, targetTs } = parsedDelay;
    if (delayMs <= 0) {
      return { success: false, error: '执行时间必须在未来' };
    }

    const scheduleMode: 'alarm' | 'runtime' = delayMs < ONE_MINUTE_MS ? 'runtime' : 'alarm';
    const precision: 'millisecond' | 'minute' = delayMs < ONE_MINUTE_MS ? 'millisecond' : 'minute';

    const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const alarmName = `mole_timer_${id}`;

    if (scheduleMode === 'runtime') {
      TimerScheduler.scheduleTimeout(id, delayMs);
    } else {
      const alarmInfo: chrome.alarms.AlarmCreateInfo = {};
      if (execute_at) {
        alarmInfo.when = targetTs;
      } else {
        alarmInfo.delayInMinutes = Math.max(1, delayMs / ONE_MINUTE_MS); // Chrome alarms 粗粒度
      }
      await chrome.alarms.create(alarmName, alarmInfo);
    }

    // 存储元数据
    await TimerStore.save({
      id,
      type: 'timeout',
      action,
      tabId: context?.tabId || 0,
      createdAt: Date.now(),
      delayMs,
      nextRunAt: targetTs,
      scheduleMode,
      precision,
      currentCount: 0,
    });

    const readableTime = new Date(targetTs).toLocaleString('zh-CN');

    return {
      success: true,
      data: {
        timer_id: id,
        message: `已设置延时任务，将在 ${readableTime} 自动执行（${scheduleMode === 'runtime' ? '毫秒级' : '分钟级'}调度）`,
        action,
        delay_ms: Math.round(delayMs),
        execute_at: new Date(targetTs).toISOString(),
        schedule_mode: scheduleMode,
        precision,
      },
    };
  },
};
