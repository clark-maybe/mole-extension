/**
 * 统一定时器工具函数
 * 合并延时任务、周期任务、定时器管理为一个工具
 * 使用 Chrome Alarms API + TimerScheduler 实现双轨调度
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

export const timerFunction: FunctionDefinition = {
  name: 'timer',
  description: '定时器管理。支持 set_timeout(延时任务)、set_interval(周期任务)、clear(取消定时器)、list(列出活跃定时器)。到期后 AI 会自动执行指定操作并推送结果。',
  supportsParallel: false,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['set_timeout', 'set_interval', 'clear', 'list'],
        description: '操作类型：set_timeout(设置延时任务)、set_interval(设置周期任务)、clear(取消定时器)、list(列出活跃定时器)',
      },
      // set_timeout / set_interval 共用
      task_action: {
        type: 'string',
        description: '到期时要执行的操作描述（action=set_timeout/set_interval 时必填）。会作为新一轮 AI 对话的输入。例如："搜索今天的天气预报并告诉用户"',
      },
      // set_timeout 专用
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
        description: '执行时间，ISO 8601 格式。与 delay_* 二选一',
      },
      // set_interval 专用
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
      // clear 专用
      timer_id: {
        type: 'string',
        description: '要取消的定时器 ID（action=clear 时必填）',
      },
    },
    required: ['action'],
  },
  validate: (params: any) => {
    if (!params?.action) return '缺少 action';

    if (params.action === 'set_timeout') {
      if (!params.task_action || !params.task_action.trim()) return 'task_action 不能为空';
      // 复用原 setTimeoutFunction 的校验逻辑
      const hasDelay = ['delay_ms', 'delay_seconds', 'delay_minutes'].some((field) => {
        const value = (params as Record<string, unknown>)[field];
        return typeof value === 'number' && Number.isFinite(value);
      });
      const hasExecuteAt = typeof params.execute_at === 'string' && params.execute_at.trim().length > 0;
      if (!hasDelay && !hasExecuteAt) return '需要提供 delay_ms/delay_seconds/delay_minutes 或 execute_at';
      if (hasDelay && hasExecuteAt) return 'execute_at 与 delay_* 不能同时提供';
    }

    if (params.action === 'set_interval') {
      if (!params.task_action || !params.task_action.trim()) return 'task_action 不能为空';
      const hasInterval = ['interval_ms', 'interval_seconds', 'interval_minutes'].some((field) => {
        const value = (params as Record<string, unknown>)[field];
        return typeof value === 'number' && Number.isFinite(value);
      });
      if (!hasInterval) return '需要提供 interval_ms/interval_seconds/interval_minutes 之一';
      if (typeof params.max_count === 'number' && params.max_count <= 0) return 'max_count 必须大于 0';
    }

    if (params.action === 'clear') {
      if (!params.timer_id || !params.timer_id.trim()) return 'timer_id 不能为空';
    }

    return null;
  },
  execute: async (params: any, context?: { tabId?: number }) => {
    switch (params.action) {
      case 'set_timeout': {
        // 搬迁原 setTimeoutFunction.execute 的完整逻辑
        // 注意：用 params.task_action 代替原来的 params.action（"操作描述"字段已重命名）
        const taskAction = params.task_action;
        const parsedDelay = parseTimeoutDelayMs(params);
        if (!parsedDelay) {
          return { success: false, error: '必须提供有效的 delay_ms / delay_seconds / delay_minutes（可叠加）或 execute_at' };
        }
        const { delayMs, targetTs } = parsedDelay;
        if (delayMs <= 0) return { success: false, error: '执行时间必须在未来' };

        const scheduleMode: 'alarm' | 'runtime' = delayMs < ONE_MINUTE_MS ? 'runtime' : 'alarm';
        const precision: 'millisecond' | 'minute' = delayMs < ONE_MINUTE_MS ? 'millisecond' : 'minute';
        const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const alarmName = `mole_timer_${id}`;

        if (scheduleMode === 'runtime') {
          TimerScheduler.scheduleTimeout(id, delayMs);
        } else {
          const alarmInfo: chrome.alarms.AlarmCreateInfo = {};
          if (params.execute_at) {
            alarmInfo.when = targetTs;
          } else {
            alarmInfo.delayInMinutes = Math.max(1, delayMs / ONE_MINUTE_MS);
          }
          await chrome.alarms.create(alarmName, alarmInfo);
        }

        await TimerStore.save({
          id, type: 'timeout', action: taskAction, tabId: context?.tabId || 0,
          createdAt: Date.now(), delayMs, nextRunAt: targetTs, scheduleMode, precision, currentCount: 0,
        });

        const readableTime = new Date(targetTs).toLocaleString('zh-CN');
        return {
          success: true,
          data: {
            timer_id: id,
            message: `已设置延时任务，将在 ${readableTime} 自动执行（${scheduleMode === 'runtime' ? '毫秒级' : '分钟级'}调度）`,
            action: taskAction, delay_ms: Math.round(delayMs),
            execute_at: new Date(targetTs).toISOString(), schedule_mode: scheduleMode, precision,
          },
        };
      }

      case 'set_interval': {
        // 搬迁原 setIntervalFunction.execute 的完整逻辑
        const taskAction = params.task_action;
        const { max_count = 10 } = params;
        const intervalMs = parseIntervalMs(params);
        if (intervalMs <= 0) {
          return { success: false, error: '必须提供有效的 interval_ms / interval_seconds / interval_minutes（可叠加）' };
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
          await chrome.alarms.create(alarmName, { delayInMinutes: minutes, periodInMinutes: minutes });
        }

        await TimerStore.save({
          id, type: 'interval', action: taskAction, tabId: context?.tabId || 0,
          createdAt: Date.now(), scheduleMode, precision, intervalMinutes: minutes,
          intervalMs: safeIntervalMs, nextRunAt, maxCount: safeMaxCount, currentCount: 0,
        });

        return {
          success: true,
          data: {
            timer_id: id,
            message: `已设置周期任务，每 ${safeIntervalMs} 毫秒执行一次，最多 ${safeMaxCount} 次（${scheduleMode === 'runtime' ? '毫秒级' : '分钟级'}调度）`,
            action: taskAction, interval_ms: safeIntervalMs, interval_minutes: minutes,
            max_count: safeMaxCount, schedule_mode: scheduleMode, precision,
          },
        };
      }

      case 'clear': {
        // 搬迁原 clearTimerFunction.execute 的 "传了 timer_id" 分支
        const { timer_id } = params;
        const task = await TimerStore.get(timer_id);
        if (!task) return { success: false, error: `未找到定时器: ${timer_id}` };

        TimerScheduler.clear(timer_id);
        await chrome.alarms.clear(`mole_timer_${timer_id}`);
        await TimerStore.remove(timer_id);

        return {
          success: true,
          data: { message: `已取消定时器: ${timer_id}`, action: task.action, timer_id, cleared_ids: [timer_id] },
        };
      }

      case 'list': {
        // 搬迁原 clearTimerFunction.execute 的 "不传 timer_id" 分支
        const tasks = await TimerStore.getAll();
        if (tasks.length === 0) {
          return { success: true, data: { message: '当前没有活跃的定时器', timers: [] } };
        }
        return {
          success: true,
          data: {
            message: `当前有 ${tasks.length} 个活跃定时器`,
            timers: tasks.map(t => ({
              timer_id: t.id, type: t.type, action: t.action,
              schedule_mode: t.scheduleMode || 'alarm', precision: t.precision || 'minute',
              created_at: new Date(t.createdAt).toLocaleString('zh-CN'),
              next_run_at: t.nextRunAt ? new Date(t.nextRunAt).toLocaleString('zh-CN') : undefined,
              delay_ms: t.delayMs,
              ...(t.type === 'interval' ? {
                interval_ms: t.intervalMs, interval_minutes: t.intervalMinutes,
                current_count: t.currentCount, max_count: t.maxCount,
              } : {}),
            })),
          },
        };
      }

      default:
        return { success: false, error: `不支持的操作: ${params.action}` };
    }
  },
};
