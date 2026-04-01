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

/** 解析星期缩写为数字 (0=Sun, 1=Mon, ..., 6=Sat) */
const parseDayName = (name: string): number | null => {
  const map: Record<string, number> = {
    sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
  };
  return map[name.toLowerCase().slice(0, 3)] ?? null;
};

/** 根据调度规则计算下一次执行的时间戳 */
export const computeNextScheduleRun = (rule: string): number => {
  const now = new Date();

  if (rule.startsWith('daily:')) {
    const [h, m] = rule.slice(6).split(':').map(Number);
    const next = new Date(now);
    next.setHours(h, m, 0, 0);
    if (next.getTime() <= now.getTime()) {
      next.setDate(next.getDate() + 1);
    }
    return next.getTime();
  }

  if (rule.startsWith('weekly:')) {
    const parts = rule.slice(7).split(':');
    const dayOfWeek = parseInt(parts[0]);
    const h = parseInt(parts[1]);
    const m = parseInt(parts[2]);
    const next = new Date(now);
    next.setHours(h, m, 0, 0);
    const currentDay = next.getDay();
    let daysUntil = dayOfWeek - currentDay;
    if (daysUntil < 0 || (daysUntil === 0 && next.getTime() <= now.getTime())) {
      daysUntil += 7;
    }
    next.setDate(next.getDate() + daysUntil);
    return next.getTime();
  }

  // 兜底：24 小时后
  return Date.now() + 24 * 60 * 60 * 1000;
};

export const timerFunction: FunctionDefinition = {
  name: 'timer',
  description: '定时器管理。支持 set_timeout(延时任务)、set_interval(周期任务)、set_schedule(定时调度：每天/每周)、update(修改定时器)、clear(取消)、list(列出)。到期后 AI 会自动执行指定操作并推送结果。',
  supportsParallel: false,
  permissionLevel: 'interact',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['set_timeout', 'set_interval', 'set_schedule', 'update', 'clear', 'list'],
        description: '操作类型：set_timeout(延时任务)、set_interval(周期任务)、set_schedule(定时调度)、update(修改定时器)、clear(取消)、list(列出)',
      },
      name: {
        type: 'string',
        description: '任务友好名称（如"每日天气"、"价格监控"），在后台任务面板中显示',
      },
      // set_timeout / set_interval / set_schedule 共用
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
      // set_schedule 专用
      daily_at: {
        type: 'string',
        description: '每天执行时间，HH:MM 格式（如 "09:00"、"14:30"）。仅 set_schedule 使用，与 weekly_at 二选一',
      },
      weekly_at: {
        type: 'string',
        description: '每周执行时间，"Day HH:MM" 格式（如 "Mon 09:00"、"Fri 18:00"）。Day 支持 Mon/Tue/Wed/Thu/Fri/Sat/Sun。仅 set_schedule 使用，与 daily_at 二选一',
      },
      // clear / update 专用
      timer_id: {
        type: 'string',
        description: '要操作的定时器 ID（action=clear/update 时必填）',
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

    if (params.action === 'set_schedule') {
      if (!params.task_action || !params.task_action.trim()) return 'task_action 不能为空';
      const hasDaily = typeof params.daily_at === 'string' && params.daily_at.trim().length > 0;
      const hasWeekly = typeof params.weekly_at === 'string' && params.weekly_at.trim().length > 0;
      if (!hasDaily && !hasWeekly) return '需要提供 daily_at 或 weekly_at';
      if (hasDaily && hasWeekly) return 'daily_at 与 weekly_at 不能同时提供';
      if (hasDaily && !/^\d{1,2}:\d{2}$/.test(params.daily_at.trim())) return 'daily_at 格式应为 HH:MM';
      if (hasWeekly && !/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{1,2}:\d{2}$/i.test(params.weekly_at.trim())) {
        return 'weekly_at 格式应为 "Day HH:MM"，如 "Mon 09:00"';
      }
    }

    if (params.action === 'update') {
      if (!params.timer_id || !params.timer_id.trim()) return 'timer_id 不能为空';
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
          ...(params.name ? { name: params.name } : {}),
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
          ...(params.name ? { name: params.name } : {}),
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

      case 'set_schedule': {
        const taskAction = params.task_action;
        const taskName = params.name;

        let scheduleRule: string;
        if (params.daily_at) {
          const [h, m] = params.daily_at.trim().split(':').map(Number);
          scheduleRule = `daily:${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        } else {
          const parts = params.weekly_at.trim().split(/\s+/);
          const day = parseDayName(parts[0]);
          if (day === null) return { success: false, error: `无法识别星期: ${parts[0]}` };
          const [h, m] = parts[1].split(':').map(Number);
          scheduleRule = `weekly:${day}:${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        }

        const nextRunAt = computeNextScheduleRun(scheduleRule);
        const id = `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const alarmName = `mole_timer_${id}`;

        await chrome.alarms.create(alarmName, { when: nextRunAt });

        await TimerStore.save({
          id, type: 'schedule', action: taskAction, tabId: context?.tabId || 0,
          createdAt: Date.now(), nextRunAt, scheduleMode: 'alarm', precision: 'minute',
          currentCount: 0, scheduleRule, ...(taskName ? { name: taskName } : {}),
        });

        const readableNext = new Date(nextRunAt).toLocaleString('zh-CN');
        const ruleDesc = scheduleRule.startsWith('daily:')
          ? `每天 ${scheduleRule.slice(6)}`
          : `每周${['日','一','二','三','四','五','六'][parseInt(scheduleRule.split(':')[1])]} ${scheduleRule.split(':').slice(2).join(':')}`;

        return {
          success: true,
          data: {
            timer_id: id, message: `已设置定时调度（${ruleDesc}），下次执行：${readableNext}`,
            action: taskAction, schedule_rule: scheduleRule, next_run_at: new Date(nextRunAt).toISOString(),
            ...(taskName ? { name: taskName } : {}),
          },
        };
      }

      case 'update': {
        const { timer_id } = params;
        const task = await TimerStore.get(timer_id);
        if (!task) return { success: false, error: `未找到定时器: ${timer_id}` };

        const updates: Partial<import('../lib/timer-store').TimerTask> = {};
        const changes: string[] = [];

        // 更新文本字段
        if (params.task_action && params.task_action.trim()) {
          updates.action = params.task_action.trim();
          changes.push('操作描述');
        }
        if (params.name !== undefined) {
          updates.name = params.name || undefined;
          changes.push('名称');
        }
        if (typeof params.max_count === 'number' && params.max_count > 0) {
          updates.maxCount = Math.min(params.max_count, 100);
          changes.push('最大次数');
        }

        // 更新调度参数（需要重建 alarm/scheduler）
        let needReschedule = false;

        if (task.type === 'interval') {
          const newIntervalMs = parseIntervalMs(params);
          if (newIntervalMs > 0 && newIntervalMs !== task.intervalMs) {
            // 清除旧调度
            TimerScheduler.clear(timer_id);
            await chrome.alarms.clear(`mole_timer_${timer_id}`);

            const scheduleMode: 'alarm' | 'runtime' = newIntervalMs < ONE_MINUTE_MS ? 'runtime' : 'alarm';
            const minutes = Math.max(1, newIntervalMs / ONE_MINUTE_MS);

            if (scheduleMode === 'runtime') {
              TimerScheduler.scheduleInterval(timer_id, newIntervalMs);
            } else {
              await chrome.alarms.create(`mole_timer_${timer_id}`, { delayInMinutes: minutes, periodInMinutes: minutes });
            }

            updates.intervalMs = newIntervalMs;
            updates.intervalMinutes = minutes;
            updates.scheduleMode = scheduleMode;
            updates.precision = newIntervalMs < ONE_MINUTE_MS ? 'millisecond' : 'minute';
            updates.nextRunAt = Date.now() + newIntervalMs;
            changes.push('执行间隔');
            needReschedule = true;
          }
        }

        if (task.type === 'schedule') {
          let newRule: string | null = null;
          if (params.daily_at) {
            const [h, m] = params.daily_at.trim().split(':').map(Number);
            newRule = `daily:${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
          } else if (params.weekly_at) {
            const parts = params.weekly_at.trim().split(/\s+/);
            const day = parseDayName(parts[0]);
            if (day === null) return { success: false, error: `无法识别星期: ${parts[0]}` };
            const [h, m] = parts[1].split(':').map(Number);
            newRule = `weekly:${day}:${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
          }

          if (newRule && newRule !== task.scheduleRule) {
            await chrome.alarms.clear(`mole_timer_${timer_id}`);
            const nextRunAt = computeNextScheduleRun(newRule);
            await chrome.alarms.create(`mole_timer_${timer_id}`, { when: nextRunAt });
            updates.scheduleRule = newRule;
            updates.nextRunAt = nextRunAt;
            changes.push('调度规则');
            needReschedule = true;
          }
        }

        if (changes.length === 0) {
          return { success: false, error: '没有提供需要修改的字段' };
        }

        // 抑制 needReschedule 未使用警告
        void needReschedule;

        await TimerStore.update(timer_id, updates);

        return {
          success: true,
          data: {
            timer_id, message: `已更新定时器: ${changes.join('、')}`,
            updated_fields: changes,
            ...(updates.nextRunAt ? { next_run_at: new Date(updates.nextRunAt).toISOString() } : {}),
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
              ...(t.name ? { name: t.name } : {}),
              ...(t.scheduleRule ? { schedule_rule: t.scheduleRule } : {}),
              schedule_mode: t.scheduleMode || 'alarm', precision: t.precision || 'minute',
              created_at: new Date(t.createdAt).toLocaleString('zh-CN'),
              next_run_at: t.nextRunAt ? new Date(t.nextRunAt).toLocaleString('zh-CN') : undefined,
              delay_ms: t.delayMs,
              ...(t.type === 'interval' ? {
                interval_ms: t.intervalMs, interval_minutes: t.intervalMinutes,
                current_count: t.currentCount, max_count: t.maxCount,
              } : {}),
              ...(t.type === 'schedule' ? {
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
