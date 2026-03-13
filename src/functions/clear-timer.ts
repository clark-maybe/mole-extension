/**
 * 取消定时器工具函数
 * 取消已设置的定时或周期性任务，也可列出所有活跃定时器
 */

import type { FunctionDefinition } from './types';
import { TimerStore } from '../lib/timer-store';
import { TimerScheduler } from '../lib/timer-scheduler';

export const clearTimerFunction: FunctionDefinition = {
  name: 'clear_timer',
  description: '取消一个已设置的定时或周期性任务。也可以列出当前所有活跃的定时器。',
  supportsParallel: false,
  parameters: {
    type: 'object',
    properties: {
      timer_id: {
        type: 'string',
        description: '要取消的定时器 ID。如果不提供，则返回当前所有活跃定时器的列表',
      },
    },
    required: [],
  },
  execute: async (params: { timer_id?: string }) => {
    const { timer_id } = params;

    // 不传 timer_id：列出所有活跃定时器
    if (!timer_id) {
      const tasks = await TimerStore.getAll();
      if (tasks.length === 0) {
        return { success: true, data: { message: '当前没有活跃的定时器', timers: [] } };
      }
      return {
        success: true,
        data: {
          message: `当前有 ${tasks.length} 个活跃定时器`,
          timers: tasks.map(t => ({
            timer_id: t.id,
            type: t.type,
            action: t.action,
            schedule_mode: t.scheduleMode || 'alarm',
            precision: t.precision || 'minute',
            created_at: new Date(t.createdAt).toLocaleString('zh-CN'),
            next_run_at: t.nextRunAt ? new Date(t.nextRunAt).toLocaleString('zh-CN') : undefined,
            delay_ms: t.delayMs,
            ...(t.type === 'interval' ? {
              interval_ms: t.intervalMs,
              interval_minutes: t.intervalMinutes,
              current_count: t.currentCount,
              max_count: t.maxCount,
            } : {}),
          })),
        },
      };
    }

    // 传了 timer_id：取消指定定时器
    const task = await TimerStore.get(timer_id);
    if (!task) {
      return { success: false, error: `未找到定时器: ${timer_id}` };
    }

    TimerScheduler.clear(timer_id);
    await chrome.alarms.clear(`mole_timer_${timer_id}`);
    await TimerStore.remove(timer_id);

    return {
      success: true,
      data: {
        message: `已取消定时器: ${timer_id}`,
        action: task.action,
        timer_id,
        cleared_ids: [timer_id],
      },
    };
  },
};
