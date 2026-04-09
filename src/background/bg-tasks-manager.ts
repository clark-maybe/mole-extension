/**
 * 后台任务管理模块
 * 从 background.ts 提取，负责后台任务（定时器 + 常驻任务）的查询、关闭和变更广播
 */

import Channel from '../lib/channel';
import { TimerStore } from '../lib/timer-store';
import { TimerScheduler } from '../lib/timer-scheduler';
import { getActiveResidentJobs, stopResidentJobById } from '../functions/resident-runtime';
import { RuntimeResourceManager } from './session-resource';

// ============ 广播函数 ============

/** 防抖定时器 */
let _bgTasksBroadcastTimer: ReturnType<typeof setTimeout> | null = null;

/** 收集最新的后台任务列表并广播到所有标签页 */
export async function broadcastBgTasksChanged(): Promise<void> {
    try {
        const [timers, residentJobs] = await Promise.all([
            TimerStore.getAll(),
            getActiveResidentJobs(),
        ]);
        Channel.broadcast('__bg_tasks_changed', { timers, residentJobs });
    } catch (err) {
        console.warn('[Mole] broadcastBgTasksChanged 失败:', err);
    }
}

// ============ 存储变更监听 ============

/** 监听定时器/常驻任务存储变化，自动广播到所有标签页 */
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (!changes['mole_timers'] && !changes['mole_resident_runtime_jobs_v1']) return;
    // 防抖：短时间内多次变更只广播一次
    if (_bgTasksBroadcastTimer) clearTimeout(_bgTasksBroadcastTimer);
    _bgTasksBroadcastTimer = setTimeout(() => {
        _bgTasksBroadcastTimer = null;
        void broadcastBgTasksChanged();
    }, 300);
});

// ============ Channel 消息处理器 ============

/** 查询所有活跃的后台任务（定时器 + 常驻任务） */
Channel.on('__bg_tasks_query', async (_data, _sender, sendResponse) => {
    try {
        const [timers, residentJobs] = await Promise.all([
            TimerStore.getAll(),
            getActiveResidentJobs(),
        ]);
        sendResponse({ timers, residentJobs });
    } catch (err: any) {
        sendResponse({ timers: [], residentJobs: [], error: err.message || '查询失败' });
    }
    return true;
});

/** 关闭指定的后台任务（定时器或常驻任务） */
Channel.on('__bg_task_close', async (data, _sender, sendResponse) => {
    const kind = data?.kind as string;
    const id = data?.id as string;
    if (!kind || !id) {
        sendResponse({ success: false, error: '缺少 kind 或 id' });
        return true;
    }
    try {
        if (kind === 'timer') {
            TimerScheduler.clear(id);
            await chrome.alarms.clear(`mole_timer_${id}`);
            await TimerStore.remove(id);
            RuntimeResourceManager.unregisterFromAllSessions('timer', id);
        } else if (kind === 'resident') {
            const result = await stopResidentJobById(id);
            if (!result.success) {
                sendResponse(result);
                void broadcastBgTasksChanged();
                return true;
            }
        } else {
            sendResponse({ success: false, error: `未知 kind: ${kind}` });
            return true;
        }
        sendResponse({ success: true });
        void broadcastBgTasksChanged();
    } catch (err: any) {
        sendResponse({ success: false, error: err.message || '关闭失败' });
    }
    return true;
});
