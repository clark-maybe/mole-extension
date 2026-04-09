/**
 * 定时器触发调度
 * 从 background.ts 提取，处理定时任务触发、Chrome Alarms 和运行时定时器恢复
 */
import Channel from '../lib/channel';
import { TimerStore } from '../lib/timer-store';
import { TimerScheduler } from '../lib/timer-scheduler';
import { computeNextScheduleRun } from '../functions/timer';
import { broadcastBgTasksChanged } from './bg-tasks-manager';
import { showNotification } from './channel-handlers';
import {
    createSession,
    runSessionNow,
    hasRunningTasks,
    dispatchSessionOp,
    RuntimeResourceManager,
    activeCoalescedTasks,
    restoreRuntimeSessions,
} from './session-manager';

// ============ 定时器到期处理 ============

const activeTimerDispatch = new Set<string>();

/**
 * 定时任务触发处理（支持 alarm + runtime）
 */
async function handleTimerTrigger(timerId: string, source: 'alarm' | 'runtime_timeout' | 'runtime_interval') {
    if (activeTimerDispatch.has(timerId)) {
        console.log(`[Mole] 定时器触发忽略（仍在处理上一轮）: ${timerId}, 来源: ${source}`);
        return;
    }

    activeTimerDispatch.add(timerId);
    try {
        const task = await TimerStore.get(timerId);
        if (!task) return;

        const coalesceKey = `timer:${timerId}`;
        const hasInFlightTimerRun = activeCoalescedTasks.has(coalesceKey);
        const hasActiveSessionRun = hasRunningTasks();
        if (hasInFlightTimerRun || hasActiveSessionRun) {
            if (task.type === 'interval') {
                const intervalMs = task.intervalMs || Math.max(1, Math.round((task.intervalMinutes || 1) * 60 * 1000));
                await TimerStore.update(timerId, {
                    nextRunAt: Date.now() + intervalMs,
                });
            }
            console.log(`[Mole] 定时器触发已合并（已有活跃执行）: ${timerId}`);
            return;
        }

        console.log(`[Mole] 定时器触发: ${timerId}, 来源: ${source}, 操作: ${task.action}`);

        // 更新计数或清理
        if (task.type === 'interval') {
            task.currentCount++;
            if (task.maxCount && task.currentCount >= task.maxCount) {
                // 达到最大次数，清理
                TimerScheduler.clear(timerId);
                await chrome.alarms.clear(`mole_timer_${timerId}`);
                await TimerStore.remove(timerId);
                RuntimeResourceManager.unregisterFromAllSessions('timer', timerId);
                console.log(`[Mole] 周期任务已达最大次数，已清理: ${timerId}`);
                void broadcastBgTasksChanged();
            } else {
                const intervalMs = task.intervalMs || Math.max(1, Math.round((task.intervalMinutes || 1) * 60 * 1000));
                await TimerStore.update(timerId, {
                    currentCount: task.currentCount,
                    nextRunAt: Date.now() + intervalMs,
                });
            }
        } else if (task.type === 'schedule') {
            task.currentCount++;
            if (task.maxCount && task.currentCount >= task.maxCount) {
                // 达到最大次数，清理
                await chrome.alarms.clear(`mole_timer_${timerId}`);
                await TimerStore.remove(timerId);
                RuntimeResourceManager.unregisterFromAllSessions('timer', timerId);
                console.log(`[Mole] 定时调度已达最大次数，已清理: ${timerId}`);
                void broadcastBgTasksChanged();
            } else {
                // 计算下一次执行时间，创建新的一次性 alarm
                const nextRunAt = computeNextScheduleRun(task.scheduleRule!);
                await TimerStore.update(timerId, { currentCount: task.currentCount, nextRunAt });
                await chrome.alarms.create(`mole_timer_${timerId}`, { when: nextRunAt });
            }
        } else {
            // timeout：执行后清理
            TimerScheduler.clear(timerId);
            await TimerStore.remove(timerId);
            RuntimeResourceManager.unregisterFromAllSessions('timer', timerId);
            void broadcastBgTasksChanged();
        }

        // 检查标签页是否存在
        let tabExists = false;
        if (task.tabId) {
            try {
                await chrome.tabs.get(task.tabId);
                tabExists = true;
            } catch {
                tabExists = false;
            }
        }

        if (tabExists) {
            await dispatchSessionOp(`timer:${timerId}`, async () => {
                // 标签页存在：通过 session 体系执行定时任务
                const session = createSession(task.action, task.tabId);
                const taskId = session.id;

                // 先发送 __ai_timer_trigger 让悬浮球创建任务
                Channel.sendToTab(task.tabId, '__ai_timer_trigger', {
                    taskId,
                    sessionId: taskId,
                    action: task.action,
                    timerId,
                    timerType: task.type,
                });

                // 稍等一下让悬浮球创建任务
                await new Promise(r => setTimeout(r, 200));

                // 直接执行（定时触发禁止再创建定时任务）
                await runSessionNow(session, task.action, task.tabId, {
                    coalesceKey,
                    disallowTools: ['timer'],
                    maxRounds: 20,
                    maxToolCalls: 50,
                    maxSameToolCalls: 5,
                    taskKind: 'aux',
                });
            });
        } else {
            // 标签页不存在：显示通知
            showNotification(
                '定时任务触发',
                `${task.action}\n（原标签页已关闭，无法推送结果）`,
            );
        }
    } finally {
        activeTimerDispatch.delete(timerId);
    }
}

/**
 * Chrome Alarms 监听器（分钟级持久调度）
 */
chrome.alarms.onAlarm.addListener((alarm) => {
    if (!alarm.name.startsWith('mole_timer_')) return;
    const timerId = alarm.name.replace('mole_timer_', '');
    void handleTimerTrigger(timerId, 'alarm').catch(err => {
        console.error(`[Mole] alarm 定时器处理异常: ${timerId}`, err);
    });
});

/**
 * 运行时定时器触发处理（毫秒级）
 */
TimerScheduler.setTriggerHandler((timerId, source) => {
    return handleTimerTrigger(timerId, source);
});

/**
 * Service Worker 启动时恢复运行时定时器
 */
export async function restoreRuntimeTimers() {
    const tasks = await TimerStore.getAll();
    const now = Date.now();

    for (const task of tasks) {
        if (task.scheduleMode !== 'runtime') continue;

        if (task.type === 'timeout') {
            const nextRunAt = task.nextRunAt || now;
            const delayMs = Math.max(1, nextRunAt - now);
            TimerScheduler.scheduleTimeout(task.id, delayMs);
            continue;
        }

        if (task.type === 'interval') {
            const intervalMs = task.intervalMs || Math.max(1, Math.round((task.intervalMinutes || 1) * 60 * 1000));
            TimerScheduler.scheduleInterval(task.id, intervalMs);
            // 恢复时同步下一次执行时间，便于 UI 展示
            await TimerStore.update(task.id, { nextRunAt: now + intervalMs });
        }
    }
}

/**
 * Service Worker 启动时恢复会话运行态
 */
export async function restoreSessionState() {
    await restoreRuntimeSessions();
}
