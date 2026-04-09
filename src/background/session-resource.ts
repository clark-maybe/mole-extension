/**
 * session-resource.ts — 运行时资源管理器
 * 从 session-manager.ts 提取，负责管理会话运行时资源（定时器等）的注册、注销和清理。
 */

import { TimerStore } from '../lib/timer-store';
import { TimerScheduler } from '../lib/timer-scheduler';
import type { RuntimeResourceKind, RuntimeResourceEntry } from './session-types';
import { getActiveTurnRuntime } from './session-state';

// ============ 类型定义 ============

/** 运行时资源事件载荷 */
interface RuntimeResourceEventPayload {
    kind: RuntimeResourceKind;
    action: 'opened' | 'closed';
    resourceIds: string[];
}

/** 运行时资源处理器 */
interface RuntimeResourceHandler {
    close: (resourceId: string) => Promise<void>;
}

// ============ 模块内部状态 ============

/** 每个会话的运行时资源映射表：sessionId → (resourceKey → ResourceEntry) */
const sessionRuntimeResources = new Map<string, Map<string, RuntimeResourceEntry>>();

// ============ 资源处理器注册 ============

/** 各资源类型的关闭处理器 */
const RUNTIME_RESOURCE_HANDLERS: Record<RuntimeResourceKind, RuntimeResourceHandler> = {
    timer: {
        close: async (resourceId: string) => {
            try {
                TimerScheduler.clear(resourceId);
                await chrome.alarms.clear(`mole_timer_${resourceId}`);
                await TimerStore.remove(resourceId);
            } catch (err) {
                console.warn('[Mole] 关闭 timer 资源失败:', resourceId, err);
            }
        },
    },
};

// ============ RuntimeResourceManager ============

/** 运行时资源管理器：注册、注销、解析事件、批量清理 */
export const RuntimeResourceManager = {
    buildKey(kind: RuntimeResourceKind, resourceId: string): string {
        return `${kind}:${resourceId}`;
    },

    getSessionMap(sessionId: string, createIfMissing: boolean = false): Map<string, RuntimeResourceEntry> | null {
        const existed = sessionRuntimeResources.get(sessionId);
        if (existed) return existed;
        if (!createIfMissing) return null;
        const created = new Map<string, RuntimeResourceEntry>();
        sessionRuntimeResources.set(sessionId, created);
        return created;
    },

    register(sessionId: string, kind: RuntimeResourceKind, resourceId: string, runId?: string | null) {
        const normalizedId = String(resourceId || '').trim();
        if (!normalizedId) return;
        const key = RuntimeResourceManager.buildKey(kind, normalizedId);
        const map = RuntimeResourceManager.getSessionMap(sessionId, true);
        if (!map) return;
        const resolvedRunId = runId ?? (() => {
            const rt = getActiveTurnRuntime();
            if (!rt) return null;
            for (const task of rt.tasks.values()) {
                if (task.sessionId === sessionId) return task.runId;
            }
            return null;
        })() ?? null;
        map.set(key, {
            key,
            kind,
            resourceId: normalizedId,
            sessionId,
            runId: resolvedRunId,
            createdAt: Date.now(),
        });
    },

    unregister(sessionId: string, kind: RuntimeResourceKind, resourceId: string) {
        const normalizedId = String(resourceId || '').trim();
        if (!normalizedId) return;
        const key = RuntimeResourceManager.buildKey(kind, normalizedId);
        const map = RuntimeResourceManager.getSessionMap(sessionId, false);
        if (!map) return;
        map.delete(key);
        if (map.size === 0) {
            sessionRuntimeResources.delete(sessionId);
        }
    },

    unregisterFromAllSessions(kind: RuntimeResourceKind, resourceId: string) {
        const normalizedId = String(resourceId || '').trim();
        if (!normalizedId) return;
        for (const [sessionId] of sessionRuntimeResources.entries()) {
            RuntimeResourceManager.unregister(sessionId, kind, normalizedId);
        }
    },

    unregisterManyFromAllSessions(kind: RuntimeResourceKind, resourceIds: string[]) {
        for (const resourceId of resourceIds) {
            RuntimeResourceManager.unregisterFromAllSessions(kind, resourceId);
        }
    },

    parseEvent(payload: Record<string, any>): RuntimeResourceEventPayload | null {
        const resource = payload?.resource;
        if (!resource || typeof resource !== 'object') return null;
        if (resource.kind !== 'timer') return null;
        const action = resource.action === 'closed' ? 'closed' : resource.action === 'opened' ? 'opened' : null;
        if (!action) return null;
        const ids = Array.isArray(resource.resourceIds)
            ? resource.resourceIds.map((item: any) => String(item || '').trim()).filter(Boolean)
            : [];
        if (ids.length === 0) return null;
        return {
            kind: resource.kind,
            action,
            resourceIds: Array.from(new Set(ids)),
        };
    },

    applyEvent(sessionId: string, payload: Record<string, any>) {
        const resourceEvent = RuntimeResourceManager.parseEvent(payload);
        if (!resourceEvent) return;
        for (const resourceId of resourceEvent.resourceIds) {
            if (resourceEvent.action === 'opened') {
                RuntimeResourceManager.register(sessionId, resourceEvent.kind, resourceId);
            } else {
                RuntimeResourceManager.unregister(sessionId, resourceEvent.kind, resourceId);
            }
        }
    },

    async closeEntry(entry: RuntimeResourceEntry) {
        const handler = RUNTIME_RESOURCE_HANDLERS[entry.kind];
        if (!handler) return;
        await handler.close(entry.resourceId);
    },

    async closeByRun(sessionId: string, runId: string | null | undefined) {
        const map = RuntimeResourceManager.getSessionMap(sessionId, false);
        if (!map || map.size === 0) return;
        const normalizedRunId = typeof runId === 'string' && runId.trim() ? runId : null;
        for (const [key, entry] of map.entries()) {
            if (normalizedRunId && entry.runId !== normalizedRunId) continue;
            await RuntimeResourceManager.closeEntry(entry);
            map.delete(key);
        }
        if (map.size === 0) {
            sessionRuntimeResources.delete(sessionId);
        }
    },

    async closeAll(sessionId: string) {
        const map = RuntimeResourceManager.getSessionMap(sessionId, false);
        if (!map || map.size === 0) return;
        for (const entry of map.values()) {
            await RuntimeResourceManager.closeEntry(entry);
        }
        sessionRuntimeResources.delete(sessionId);
    },
};

// ============ 事件跟踪 ============

/** 从事件中跟踪运行时资源（网络监控、定时器等） */
export function trackRuntimeResourceFromEvent(sessionId: string, event: { type: string; content: string }) {
    if (event.type === 'function_result') {
        const payload = (() => {
            if (!event.content) return null;
            try {
                const parsed = JSON.parse(event.content) as Record<string, any>;
                return parsed && typeof parsed === 'object' ? parsed : null;
            } catch {
                return null;
            }
        })();
        if (payload) {
            RuntimeResourceManager.applyEvent(sessionId, payload);
        }
    }
}
