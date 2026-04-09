/**
 * session-state.ts
 * 会话管理的共享可变状态、调度队列与简单工具函数
 * 从 session-manager.ts 提取
 */

import type {
    ActiveTurnRuntime,
    RuntimeResourceEntry,
    RunningSessionTask,
    Session,
    SessionChannelResponder,
    SessionOpQueueSnapshot,
    SessionTaskKind,
} from './session-types';

// ============ 共享可变状态 ============

/** 会话存储 */
export const sessions = new Map<string, Session>();

/** 当前活跃会话 ID（内部变量） */
let _activeSessionId: string | null = null;

/** 获取当前活跃会话 ID */
export function getActiveSessionId(): string | null {
    return _activeSessionId;
}

/** 设置当前活跃会话 ID */
export function setActiveSessionId(id: string | null): void {
    _activeSessionId = id;
}

/** 活跃任务的 AbortController 映射 */
export const activeControllers = new Map<string, AbortController>();

/** 会话任务类型映射 */
export const sessionTaskKinds = new Map<string, SessionTaskKind>();

/** 活跃轮次运行时（内部变量） */
let activeTurnRuntime: ActiveTurnRuntime | null = null;

/** 获取活跃轮次运行时 */
export function getActiveTurnRuntime(): ActiveTurnRuntime | null {
    return activeTurnRuntime;
}

/** 设置活跃轮次运行时 */
export function setActiveTurnRuntime(rt: ActiveTurnRuntime | null): void {
    activeTurnRuntime = rt;
}

/** 确保活跃轮次运行时存在，不存在则创建 */
export function ensureActiveTurnRuntime(): ActiveTurnRuntime {
    if (!activeTurnRuntime) activeTurnRuntime = { tasks: new Map() };
    return activeTurnRuntime;
}

/** 运行时资源映射 */
export const sessionRuntimeResources = new Map<string, Map<string, RuntimeResourceEntry>>();

/** 活跃合并任务集合 */
export const activeCoalescedTasks = new Set<string>();

// ============ 调度队列 ============

let sessionDispatchQueue: Promise<void> = Promise.resolve();
let sessionOpQueueDepth = 0;
let sessionOpQueuePeakDepth = 0;
let sessionOpRunningLabel = '';
let sessionOpRunningStartedAt = 0;
let sessionOpLastLabel = '';
let sessionOpLastLatencyMs = 0;
let sessionOpUpdatedAt = Date.now();

/** 构建会话操作队列快照 */
export function buildSessionOpQueueSnapshot(now: number = Date.now()): SessionOpQueueSnapshot {
    return {
        depth: sessionOpQueueDepth,
        peakDepth: sessionOpQueuePeakDepth,
        runningLabel: sessionOpRunningLabel || undefined,
        runningSince: sessionOpRunningStartedAt > 0 ? sessionOpRunningStartedAt : undefined,
        lastLabel: sessionOpLastLabel || undefined,
        lastLatencyMs: sessionOpLastLatencyMs > 0 ? sessionOpLastLatencyMs : undefined,
        updatedAt: sessionOpUpdatedAt || now,
    };
}

/** 分发会话操作到串行队列 */
export function dispatchSessionOp(label: string, op: () => Promise<void> | void): Promise<void> {
    sessionOpQueueDepth += 1;
    sessionOpQueuePeakDepth = Math.max(sessionOpQueuePeakDepth, sessionOpQueueDepth);
    sessionOpUpdatedAt = Date.now();

    const run = async () => {
        const startedAt = Date.now();
        sessionOpRunningLabel = label;
        sessionOpRunningStartedAt = startedAt;
        sessionOpUpdatedAt = startedAt;
        try {
            await op();
        } catch (err) {
            console.error(`[Mole] 会话操作失败 (${label}):`, err);
        } finally {
            const finishedAt = Date.now();
            sessionOpLastLabel = label;
            sessionOpLastLatencyMs = Math.max(0, finishedAt - startedAt);
            sessionOpRunningLabel = '';
            sessionOpRunningStartedAt = 0;
            sessionOpQueueDepth = Math.max(0, sessionOpQueueDepth - 1);
            sessionOpUpdatedAt = finishedAt;
        }
    };

    sessionDispatchQueue = sessionDispatchQueue.then(run, run);
    return sessionDispatchQueue;
}

/** 安全调用会话操作的 sendResponse 回调 */
export function respondSessionOp(sendResponse: SessionChannelResponder, payload: unknown, label: string) {
    if (!sendResponse) return;
    try {
        sendResponse(payload);
    } catch (err) {
        console.warn(`[Mole] ${label} sendResponse 失败:`, err);
    }
}

// ============ 简单工具函数 ============

/** 延迟指定毫秒 */
export function delayMs(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 规范化任务类型 */
export function normalizeTaskKind(raw?: string): SessionTaskKind {
    if (raw === 'review' || raw === 'compact' || raw === 'aux') return raw;
    return 'regular';
}
