/**
 * session-history.ts — 会话历史记录构建与持久化
 * 从 session-manager.ts 提取，负责从 eventLog/context 中提取助手回复、工具调用链、调度状态变化，
 * 构建历史记录并写入 chrome.storage。
 */

import { getTextContent } from '../ai/context-manager';
import type {
    AgentStateTransition,
    InputItem,
    Session,
    SessionEventLogItem,
    SessionHistoryRecord,
    SessionToolCallChainItem,
    SessionAgentTransitionItem,
} from './session-types';
import { MAX_SESSION_HISTORY, SESSION_HISTORY_STORAGE_KEY, SESSION_CONTEXT_COMPRESSION_TAG } from './session-types';
import { getLocalStorage, setLocalStorage } from './session-persistence';
import { parseTurnLifecycleEventPayload, parseEventObject } from './session-event';

// ============ 助手回复提取 ============

/** 提取最新助手回复文本 */
function extractAssistantReply(eventLog: SessionEventLogItem[]): string | undefined {
    for (let index = eventLog.length - 1; index >= 0; index--) {
        const event = eventLog[index];
        if (event.type === 'text') {
            const text = event.content?.trim();
            if (text) return text;
        }
    }
    return undefined;
}

/** 从 turn_completed 事件提取回复 */
function extractTurnCompletedReply(eventLog: SessionEventLogItem[]): string | undefined {
    for (let index = eventLog.length - 1; index >= 0; index--) {
        const event = eventLog[index];
        if (event.type !== 'turn_completed') continue;
        const payload = parseTurnLifecycleEventPayload(event.content || '');
        const text = typeof payload?.lastAgentMessage === 'string'
            ? payload.lastAgentMessage.trim()
            : '';
        if (text) return text;
    }
    return undefined;
}

/** 提取最新 run 的消息 */
function extractLatestRunAgentMessage(eventLog: SessionEventLogItem[], startedAt: number): string | undefined {
    for (let index = eventLog.length - 1; index >= 0; index--) {
        const event = eventLog[index];
        const timestamp = event.timestamp || 0;
        if (timestamp < startedAt) break;
        if (event.type === 'text') {
            const text = String(event.content || '').trim();
            if (text) return text;
        }
    }
    return undefined;
}

/** 从 context 提取助手消息 */
function extractLatestAssistantMessageFromContext(context: InputItem[] | undefined): string | undefined {
    if (!Array.isArray(context) || context.length === 0) return undefined;
    for (let index = context.length - 1; index >= 0; index--) {
        const item = context[index];
        if (!('role' in item) || item.role !== 'assistant') continue;
        const text = getTextContent(item.content).trim();
        if (!text || text.startsWith(SESSION_CONTEXT_COMPRESSION_TAG)) continue;
        return text;
    }
    return undefined;
}

// ============ 工具调用提取 ============

/** 从 function_call 文案中解析工具名 */
function parseToolName(rawContent: string): string {
    const raw = (rawContent || '').trim();
    if (!raw) return '';

    try {
        const parsed = JSON.parse(raw) as { name?: string };
        if (parsed?.name) return parsed.name;
    } catch {
        // 非 JSON，走文本回退
    }

    const matched = raw.match(/正在调用\s+([a-zA-Z0-9_:-]+)\.\.\./);
    if (matched?.[1]) return matched[1];

    return raw.replace(/^正在调用\s+/, '').replace(/\.\.\.$/, '').trim();
}

/** 提取工具调用名称列表（去重） */
function extractToolCalls(eventLog: SessionEventLogItem[]): string[] {
    const toolCalls: string[] = [];
    const seen = new Set<string>();

    for (const event of eventLog) {
        if (event.type !== 'function_call') continue;

        const toolName = parseToolName(event.content || '');

        if (!toolName || seen.has(toolName)) continue;
        seen.add(toolName);
        toolCalls.push(toolName);
    }

    return toolCalls;
}

/** 提取工具调用链（含执行结果） */
function extractToolCallChain(eventLog: SessionEventLogItem[]): SessionToolCallChainItem[] {
    const chain: SessionToolCallChainItem[] = [];
    const pendingIndexes: number[] = [];
    const pendingByCallId = new Map<string, number>();
    const pendingByItemId = new Map<string, number>();
    const removePendingIndex = (index: number) => {
        const pos = pendingIndexes.indexOf(index);
        if (pos >= 0) pendingIndexes.splice(pos, 1);
    };

    const markCompleted = (index: number, status: SessionToolCallChainItem['status'], message: string | undefined, endedAt: number | undefined) => {
        const item = chain[index];
        if (!item) return;
        item.status = status;
        if (message && !item.message) {
            item.message = message;
        } else if (message) {
            item.message = message;
        }
        item.endedAt = endedAt;
    };

    for (const event of eventLog) {
        if (event.type === 'turn_item_started') {
            const payload = parseEventObject(event.content || '');
            if (!payload) continue;
            const itemType = String(payload.itemType || '');
            if (itemType !== 'function_call') continue;
            const callId = typeof payload.callId === 'string' ? payload.callId : '';
            const itemId = typeof payload.itemId === 'string' ? payload.itemId : '';
            const funcName = typeof payload.name === 'string' && payload.name.trim()
                ? payload.name.trim()
                : parseToolName(event.content || '');
            if (!funcName) continue;
            if (callId && pendingByCallId.has(callId)) continue;
            if (itemId && pendingByItemId.has(itemId)) continue;

            const index = chain.length;
            chain.push({
                funcName,
                status: 'running',
                startedAt: event.timestamp,
            });
            pendingIndexes.push(index);
            if (callId) pendingByCallId.set(callId, index);
            if (itemId) pendingByItemId.set(itemId, index);
            continue;
        }

        if (event.type === 'turn_item_completed') {
            const payload = parseEventObject(event.content || '');
            if (!payload) continue;
            const itemType = String(payload.itemType || '');
            if (itemType !== 'function_call') continue;
            const callId = typeof payload.callId === 'string' ? payload.callId : '';
            const itemId = typeof payload.itemId === 'string' ? payload.itemId : '';
            const statusRaw = String(payload.status || '').toLowerCase();
            const status: SessionToolCallChainItem['status'] = statusRaw === 'error' || statusRaw === 'cancelled'
                ? 'error'
                : 'done';
            const index = (callId && pendingByCallId.get(callId) !== undefined)
                ? pendingByCallId.get(callId)!
                : (itemId && pendingByItemId.get(itemId) !== undefined)
                    ? pendingByItemId.get(itemId)!
                    : undefined;
            if (index === undefined) continue;
            markCompleted(index, status, undefined, event.timestamp);
            removePendingIndex(index);
            if (callId) pendingByCallId.delete(callId);
            if (itemId) pendingByItemId.delete(itemId);
            continue;
        }

        if (event.type === 'function_call') {
            const funcName = parseToolName(event.content || '');
            if (!funcName) continue;

            const payload = parseEventObject(event.content || '');
            const callId = typeof payload?.callId === 'string' ? payload.callId : '';
            if (callId && pendingByCallId.has(callId)) continue;

            chain.push({
                funcName,
                status: 'running',
                startedAt: event.timestamp,
            });
            const index = chain.length - 1;
            pendingIndexes.push(index);
            if (callId) pendingByCallId.set(callId, index);
            continue;
        }

        if (event.type === 'function_result') {
            const payload = parseEventObject(event.content || '');
            const callId = typeof payload?.callId === 'string' ? payload.callId : '';
            const resultText = typeof payload?.message === 'string'
                ? payload.message.trim()
                : (event.content || '').trim();
            const isError = typeof payload?.success === 'boolean'
                ? payload.success === false
                : /出错|失败|异常/i.test(resultText);
            const targetIndex = (callId && pendingByCallId.get(callId) !== undefined)
                ? pendingByCallId.get(callId)!
                : pendingIndexes.shift();
            if (targetIndex === undefined) continue;

            markCompleted(targetIndex, isError ? 'error' : 'done', resultText || undefined, event.timestamp);
            removePendingIndex(targetIndex);
            if (callId) pendingByCallId.delete(callId);
            continue;
        }

        if (event.type === 'error' && pendingIndexes.length > 0) {
            for (const index of pendingIndexes) {
                markCompleted(index, 'error', '会话异常终止', event.timestamp);
            }
            pendingIndexes.length = 0;
            pendingByCallId.clear();
            pendingByItemId.clear();
        }
    }

    return chain;
}

// ============ 调度状态变化提取 ============

/** 提取调度状态变化日志 */
function extractAgentTransitions(eventLog: SessionEventLogItem[]): SessionAgentTransitionItem[] {
    const transitions: SessionAgentTransitionItem[] = [];

    for (const event of eventLog) {
        if (event.type !== 'agent_state') continue;

        try {
            const parsed = JSON.parse(event.content) as AgentStateTransition;
            transitions.push({
                phase: parsed.to,
                round: parsed.round || 0,
                reason: parsed.reason || '',
                updatedAt: parsed.timestamp || event.timestamp || Date.now(),
            });
        } catch {
            // 忽略异常格式的 agent_state
        }
    }

    return transitions;
}

// ============ 历史记录构建与持久化 ============

/** 构建会话历史记录 */
function buildSessionHistoryRecord(session: Session): SessionHistoryRecord {
    const updatedAt = Date.now();
    const startedAt = session.startedAt || session.createdAt || updatedAt;
    const endedAt = session.endedAt ?? (session.status === 'running' ? undefined : updatedAt);
    const durationMs = session.durationMs ?? (endedAt ? Math.max(0, endedAt - startedAt) : undefined);

    return {
        sessionId: session.id,
        summary: session.summary,
        status: session.status,
        startedAt,
        endedAt,
        durationMs,
        failureCode: session.failureCode,
        lastError: session.lastError,
        assistantReply: extractTurnCompletedReply(session.eventLog) || extractAssistantReply(session.eventLog),
        toolCalls: extractToolCalls(session.eventLog),
        toolCallChain: extractToolCallChain(session.eventLog),
        agentTransitions: extractAgentTransitions(session.eventLog),
        updatedAt,
    };
}

/** 会话历史写入队列，避免并发覆盖 */
let sessionHistoryPersistQueue: Promise<void> = Promise.resolve();

/** 写入/更新会话历史 */
export function persistSessionHistory(session: Session) {
    if (session.status === 'running') return;

    const record = buildSessionHistoryRecord(session);

    sessionHistoryPersistQueue = sessionHistoryPersistQueue
        .then(async () => {
            const history = (await getLocalStorage<SessionHistoryRecord[]>(SESSION_HISTORY_STORAGE_KEY)) || [];
            const nextHistory = [record, ...history.filter(item => item.sessionId !== record.sessionId)]
                .sort((left, right) => right.updatedAt - left.updatedAt)
                .slice(0, MAX_SESSION_HISTORY);

            await setLocalStorage({
                [SESSION_HISTORY_STORAGE_KEY]: nextHistory,
            });
        })
        .catch((err) => {
            console.error('[Mole] 保存会话历史失败:', err);
        });
}
