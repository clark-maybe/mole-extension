/**
 * 定时器任务存储管理
 * 提供 CRUD 操作，数据存储在 chrome.storage.local
 */

const STORAGE_KEY = 'mole_timers';

/** 定时器任务 */
export interface TimerTask {
  /** 唯一标识 */
  id: string;
  /** 类型：延时 or 周期 */
  type: 'timeout' | 'interval';
  /** 到期时要执行的操作描述（作为 AI prompt） */
  action: string;
  /** 创建时的标签页 ID */
  tabId: number;
  /** 创建时间戳 */
  createdAt: number;
  /** 周期间隔（分钟），仅 interval 类型 */
  intervalMinutes?: number;
  /** 周期间隔（毫秒），用于更细粒度调度 */
  intervalMs?: number;
  /** 延时（毫秒），仅 timeout 类型 */
  delayMs?: number;
  /** 下一次执行时间戳 */
  nextRunAt?: number;
  /** 调度方式：alarm(分钟级持久) / runtime(毫秒级进程内) */
  scheduleMode?: 'alarm' | 'runtime';
  /** 精度等级：minute / millisecond */
  precision?: 'minute' | 'millisecond';
  /** 最大执行次数，仅 interval 类型 */
  maxCount?: number;
  /** 当前已执行次数 */
  currentCount: number;
}

export const TimerStore = {
  /** 获取所有定时器 */
  async getAll(): Promise<TimerTask[]> {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return result[STORAGE_KEY] || [];
  },

  /** 获取单个定时器 */
  async get(id: string): Promise<TimerTask | null> {
    const tasks = await this.getAll();
    return tasks.find(t => t.id === id) || null;
  },

  /** 保存定时器 */
  async save(task: TimerTask): Promise<void> {
    const tasks = await this.getAll();
    tasks.push(task);
    await chrome.storage.local.set({ [STORAGE_KEY]: tasks });
  },

  /** 更新定时器 */
  async update(id: string, updates: Partial<TimerTask>): Promise<void> {
    const tasks = await this.getAll();
    const index = tasks.findIndex(t => t.id === id);
    if (index !== -1) {
      tasks[index] = { ...tasks[index], ...updates };
      await chrome.storage.local.set({ [STORAGE_KEY]: tasks });
    }
  },

  /** 删除定时器 */
  async remove(id: string): Promise<void> {
    const tasks = await this.getAll();
    const filtered = tasks.filter(t => t.id !== id);
    await chrome.storage.local.set({ [STORAGE_KEY]: filtered });
  },
};
