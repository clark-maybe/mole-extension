/**
 * 运行时定时器调度器
 * 提供毫秒级调度（setTimeout/setInterval），并将触发事件回调给 background。
 */

type TimerTriggerSource = 'runtime_timeout' | 'runtime_interval';
type TimerTriggerHandler = (timerId: string, source: TimerTriggerSource) => void | Promise<void>;

const runtimeTimeouts = new Map<string, number>();
const runtimeIntervals = new Map<string, number>();

let triggerHandler: TimerTriggerHandler | null = null;

const callTrigger = async (timerId: string, source: TimerTriggerSource) => {
  if (!triggerHandler) {
    console.warn('[Mole] TimerScheduler 未注册触发处理器，忽略触发:', timerId, source);
    return;
  }
  try {
    await triggerHandler(timerId, source);
  } catch (err) {
    console.error('[Mole] TimerScheduler 触发处理失败:', timerId, source, err);
  }
};

export const TimerScheduler = {
  setTriggerHandler(handler: TimerTriggerHandler) {
    triggerHandler = handler;
  },

  scheduleTimeout(timerId: string, delayMs: number) {
    this.clear(timerId);
    const safeDelay = Math.max(1, Math.floor(delayMs));
    const handle = globalThis.setTimeout(() => {
      runtimeTimeouts.delete(timerId);
      void callTrigger(timerId, 'runtime_timeout');
    }, safeDelay);
    runtimeTimeouts.set(timerId, handle);
  },

  scheduleInterval(timerId: string, intervalMs: number) {
    this.clear(timerId);
    const safeInterval = Math.max(1, Math.floor(intervalMs));
    const handle = globalThis.setInterval(() => {
      void callTrigger(timerId, 'runtime_interval');
    }, safeInterval);
    runtimeIntervals.set(timerId, handle);
  },

  clear(timerId: string) {
    const timeoutHandle = runtimeTimeouts.get(timerId);
    if (typeof timeoutHandle === 'number') {
      globalThis.clearTimeout(timeoutHandle);
      runtimeTimeouts.delete(timerId);
    }

    const intervalHandle = runtimeIntervals.get(timerId);
    if (typeof intervalHandle === 'number') {
      globalThis.clearInterval(intervalHandle);
      runtimeIntervals.delete(timerId);
    }
  },

  isScheduled(timerId: string): boolean {
    return runtimeTimeouts.has(timerId) || runtimeIntervals.has(timerId);
  },
};
