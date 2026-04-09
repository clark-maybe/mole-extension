/**
 * session-context-tasks.ts — 审查（Review）与压缩（Compact）任务
 * 从 session-manager.ts 提取，包含 context 审查、压缩、摘要构建等逻辑。
 */

import type {
    AIStreamEvent,
    InputItem,
    OutputItem,
    Session,
    SessionStatus,
    SessionTaskKind,
    TaskLifecycleEventPayload,
    SessionTaskRunContext,
} from './session-types';
import {
    MAX_MODEL_CONTEXT_ITEMS,
    COMPACT_USER_CONTEXT_LIMIT,
    COMPACT_USER_CONTEXT_CHAR_LIMIT,
    SESSION_CONTEXT_COMPRESSION_TAG,
    REVIEW_TASK_INSTRUCTIONS,
    COMPACT_TASK_INSTRUCTIONS,
    DEFAULT_REVIEW_TASK_QUERY,
    DEFAULT_COMPACT_TASK_QUERY,
} from './session-types';
import { chatComplete } from '../ai/llm-client';
import { getTextContent } from '../ai/context-manager';
import { persistRuntimeSessions } from './session-manager';

// ============ 内部辅助：任务生命周期事件 ============

/** 构建任务生命周期事件 payload */
function buildTaskLifecycleEventPayload(
    taskKind: SessionTaskKind,
    phase: 'entered' | 'exited',
    message: string,
    status: SessionStatus,
    runId?: string | null,
    extra?: Partial<TaskLifecycleEventPayload>,
): TaskLifecycleEventPayload {
    return {
        taskKind,
        phase,
        status,
        message,
        runId: typeof runId === 'string' && runId.trim() ? runId : null,
        timestamp: Date.now(),
        ...extra,
    };
}

/** 解析任务生命周期事件类型 */
function resolveTaskLifecycleEventType(
    taskKind: SessionTaskKind,
    phase: 'entered' | 'exited',
): AIStreamEvent['type'] {
    if (taskKind === 'review') {
        return phase === 'entered' ? 'entered_review_mode' : 'exited_review_mode';
    }
    return 'context_compacted';
}

/** 发射任务生命周期事件 */
function emitTaskLifecycleEvent(
    pushEvent: (event: { type: string; content: string }) => void,
    taskKind: SessionTaskKind,
    phase: 'entered' | 'exited',
    message: string,
    status: SessionStatus,
    runId?: string | null,
    extra?: Partial<TaskLifecycleEventPayload>,
) {
    const payload = buildTaskLifecycleEventPayload(taskKind, phase, message, status, runId, extra);
    pushEvent({
        type: resolveTaskLifecycleEventType(taskKind, phase),
        content: JSON.stringify(payload),
    });
}

// ============ Review 审查任务相关 ============

/** 从 OutputItem 数组中提取助手文本 */
function extractAssistantOutputText(output: OutputItem[]): string {
    const lines: string[] = [];
    for (const item of output) {
        if (item.type !== 'message' || !Array.isArray(item.content)) continue;
        for (const contentItem of item.content) {
            if (contentItem.type !== 'output_text') continue;
            const text = String(contentItem.text || '').trim();
            if (text) {
                lines.push(text);
            }
        }
    }
    return lines.join('\n').trim();
}

interface ReviewFindingItem {
    issue: string;
    impact: string;
    suggestion: string;
    priority?: 'P0' | 'P1' | 'P2';
}

interface ReviewOutputPayload {
    summary: string;
    findings: ReviewFindingItem[];
}

/** 标准化审查优先级 */
function normalizeReviewPriority(raw: unknown): ReviewFindingItem['priority'] | undefined {
    const text = String(raw || '').trim().toUpperCase();
    if (text === 'P0' || text === 'P1' || text === 'P2') return text;
    return undefined;
}

/** 解析审查输出 payload */
function parseReviewOutputPayload(text: string): ReviewOutputPayload {
    const normalizedText = String(text || '').trim();
    if (!normalizedText) {
        return {
            summary: '已完成审查，当前未识别到明确高风险问题。',
            findings: [],
        };
    }

    try {
        const parsed = JSON.parse(normalizedText) as any;
        const summary = typeof parsed?.summary === 'string'
            ? parsed.summary.trim()
            : typeof parsed?.overall_explanation === 'string'
                ? parsed.overall_explanation.trim()
                : '';
        const findings = Array.isArray(parsed?.findings)
            ? parsed.findings
                .map((item: any): ReviewFindingItem | null => {
                    if (!item || typeof item !== 'object') return null;
                    const issue = String(item.issue || item.problem || item.title || '').trim();
                    const impact = String(item.impact || item.risk || '').trim();
                    const suggestion = String(item.suggestion || item.fix || item.recommendation || '').trim();
                    if (!issue && !impact && !suggestion) return null;
                    return {
                        issue: issue || '未命名问题',
                        impact: impact || '影响待补充',
                        suggestion: suggestion || '建议待补充',
                        priority: normalizeReviewPriority(item.priority),
                    };
                })
                .filter(Boolean) as ReviewFindingItem[]
            : [];

        if (summary || findings.length > 0) {
            return {
                summary: summary || normalizedText,
                findings,
            };
        }
    } catch {
        // ignore and fallback
    }

    return {
        summary: normalizedText,
        findings: [],
    };
}

/** 构建审查回复文本 */
function buildReviewReplyText(output: ReviewOutputPayload): string {
    const summary = output.summary.trim() || '已完成审查。';
    if (!output.findings.length) return summary;
    const detailLines = output.findings.map((finding, index) => {
        const prefix = finding.priority ? `[${finding.priority}] ` : '';
        return `${index + 1}. ${prefix}${finding.issue}：${finding.impact}；建议：${finding.suggestion}`;
    });
    return [summary, ...detailLines].join('\n');
}

/** 构建一次性输入（基于当前 context + prompt） */
function buildTaskOneShotInput(session: Session, prompt: string): InputItem[] {
    const base = compactSessionContext([...(session.context || [])]).slice(-MAX_MODEL_CONTEXT_ITEMS);
    return [...base, { role: 'user', content: prompt }];
}

/** 将任务结果追加到会话 context */
function appendTaskResultToContext(session: Session, taskPrompt: string, assistantText: string) {
    const nextContext = [
        ...(session.context || []),
        { role: 'user', content: taskPrompt } as InputItem,
        { role: 'assistant', content: assistantText } as InputItem,
    ];
    session.context = compactSessionContext(nextContext);
    persistRuntimeSessions();
}

/** 独立执行审查任务 */
export async function runReviewTaskStandalone(ctx: SessionTaskRunContext) {
    const reviewPrompt = buildReviewTaskQuery(ctx.normalizedQuery || DEFAULT_REVIEW_TASK_QUERY);
    const input = buildTaskOneShotInput(ctx.session, reviewPrompt);
    ctx.pushEvent({
        type: 'planning',
        content: '正在审查当前结果并整理关键问题...',
    });

    try {
        const response = await chatComplete(input, undefined, REVIEW_TASK_INSTRUCTIONS, ctx.signal);
        const reviewText = extractAssistantOutputText(response.output) || '已完成审查，当前未识别到明确高风险问题。';
        const reviewOutput = parseReviewOutputPayload(reviewText);
        const replyText = buildReviewReplyText(reviewOutput);
        appendTaskResultToContext(ctx.session, reviewPrompt, replyText);
        ctx.session.status = 'done';
        ctx.session.failureCode = undefined;
        ctx.session.lastError = undefined;
        const assistantItemId = `assistant-review-${Date.now()}`;
        ctx.pushEvent({
            type: 'turn_item_started',
            content: JSON.stringify({
                itemType: 'assistant_message',
                itemId: assistantItemId,
                status: 'running',
            }),
        });
        ctx.pushEvent({
            type: 'turn_item_completed',
            content: JSON.stringify({
                itemType: 'assistant_message',
                itemId: assistantItemId,
                status: 'completed',
            }),
        });
        ctx.pushEvent({
            type: 'text',
            content: replyText,
        });
        emitTaskLifecycleEvent(
            ctx.pushEvent,
            'review',
            'exited',
            '审查模式已结束，已返回结果。',
            'done',
            ctx.runId,
            {
                reviewOutput,
                assistantReply: replyText,
            },
        );
    } catch (err) {
        const aborted = ctx.signal.aborted || (err as any)?.name === 'AbortError';
        if (aborted) throw err;
        emitTaskLifecycleEvent(
            ctx.pushEvent,
            'review',
            'exited',
            '审查模式已结束。',
            'error',
            ctx.runId,
            {
                failureCode: 'E_SESSION_RUNTIME',
                reason: 'review_task_failed',
            },
        );
        throw err;
    }
}

/** 构建审查任务 prompt */
function buildReviewTaskQuery(normalizedQuery: string): string {
    return [
        '请进入审查子任务，只基于现有上下文做结论：',
        '- 先给一段总体判断，再列"问题-影响-建议"。',
        '- 问题按优先级从高到低排序，优先指出真实风险与回归点。',
        '- 不要编造未发生的执行结果，不要要求用户理解内部调度术语。',
        `用户需求：${normalizedQuery}`,
    ].join('\n');
}

// ============ Compact 压缩任务相关 ============

/** 判断是否为压缩摘要消息 */
function isSessionCompressionMessage(item: InputItem): boolean {
    if (!('role' in item) || item.role !== 'assistant') return false;
    const text = getTextContent(item.content);
    return text.startsWith(SESSION_CONTEXT_COMPRESSION_TAG);
}

/** 裁剪文本到指定最大长度 */
function clipCompactText(raw: unknown, max: number = 48): string {
    const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return text.length > max ? `${text.slice(0, max)}...` : text;
}

/** 从 context 中逆序提取用户主要目标 */
function pickCompactPrimaryGoal(context: InputItem[]): string {
    for (let index = context.length - 1; index >= 0; index--) {
        const item = context[index];
        if (!('role' in item) || item.role !== 'user') continue;
        const content = clipCompactText(getTextContent(item.content), 72);
        if (content) return content;
    }
    return '延续当前任务';
}

/** 收集工具执行事实（function_call + function_call_output 配对） */
function collectCompactToolFacts(context: InputItem[], maxCount: number = 18): Array<{ toolName: string; success: boolean; detail: string }> {
    const callIdToTool = new Map<string, string>();
    const facts: Array<{ toolName: string; success: boolean; detail: string }> = [];

    for (const item of context) {
        if ('type' in item && item.type === 'function_call') {
            callIdToTool.set(item.call_id, item.name);
            continue;
        }
        if (!('type' in item) || item.type !== 'function_call_output') continue;
        const toolName = callIdToTool.get(item.call_id);
        if (!toolName) continue;
        let parsed: any = {};
        try {
            parsed = JSON.parse(item.output || '{}');
        } catch {
            parsed = {};
        }
        const detail = clipCompactText(
            parsed?.data?.message || parsed?.error || parsed?.data?.summary || parsed?.data?.title || '',
            42,
        );
        facts.push({
            toolName,
            success: Boolean(parsed?.success),
            detail,
        });
        if (facts.length > maxCount) {
            facts.splice(0, facts.length - maxCount);
        }
    }

    return facts;
}

/** 构建上下文摘要（Goal / Done / Open / Next） */
function buildCompactContextDigest(context: InputItem[]): string[] {
    const normalized = [...(context || [])]
        .slice(-MAX_MODEL_CONTEXT_ITEMS)
        .filter((item) => !isSessionCompressionMessage(item));
    const facts = collectCompactToolFacts(normalized, 18);
    const goal = pickCompactPrimaryGoal(normalized);
    const done = facts
        .filter((item) => item.success)
        .map((item) => item.detail ? `${item.toolName}：${item.detail}` : item.toolName)
        .filter((item, index, list) => Boolean(item) && list.indexOf(item) === index)
        .slice(-3);
    const latestFailure = [...facts].reverse().find((item) => !item.success || /未找到|没找到|失败|超时|error|异常|无结果|没有结果/i.test(item.detail));
    const open = latestFailure
        ? `${latestFailure.toolName} 未闭环${latestFailure.detail ? `：${latestFailure.detail}` : ''}`
        : done.length > 0
            ? '暂无明确阻塞，优先补齐验证并收口答案。'
            : '暂无稳定完成项，需要继续观察页面与目标。';
    const next = latestFailure
        ? '围绕最近失败点继续修复，优先观察页面、重定位目标、完成验证。'
        : done.length > 0
            ? '沿最近有效结果继续推进，并保留最终证据与结论。'
            : '先锁定目标页面或元素，再执行动作并验证结果。';

    return [
        `Goal: ${goal}`,
        `Done: ${done.length > 0 ? done.join('；') : '暂无稳定完成项'}`,
        `Open: ${clipCompactText(open, 96)}`,
        `Next: ${next}`,
    ];
}

/** 构建压缩摘要文本（包含标签、摘要、丢弃统计） */
function buildSessionCompressionSummary(
    context: InputItem[],
    droppedCount: number,
    droppedUsers: number,
    droppedAssistants: number,
    droppedTools: number,
): string {
    return [
        `${SESSION_CONTEXT_COMPRESSION_TAG} 历史上下文已压缩。`,
        ...buildCompactContextDigest(context),
        `Dropped: ${droppedCount} 条（用户 ${droppedUsers}、助手 ${droppedAssistants}、工具链 ${droppedTools}）`,
    ].join('\n');
}

/** 构建压缩任务 prompt */
function buildCompactTaskQuery(normalizedQuery: string, context: InputItem[]): string {
    return [
        '请执行上下文压缩子任务：',
        '- 只保留已发生的事实、关键证据、当前结论和下一步。',
        '- 删除重复表述，不要新增未执行事实。',
        '- 输出优先围绕 Goal / Done / Open / Next 组织。',
        '当前上下文摘要：',
        ...buildCompactContextDigest(context),
        `附加要求：${normalizedQuery}`,
    ].join('\n');
}

/** 独立执行压缩任务 */
export async function runCompactTaskStandalone(ctx: SessionTaskRunContext) {
    const beforeContext = ctx.session.context || [];
    const beforeDigest = buildCompactContextDigest(beforeContext);
    const compactPrompt = buildCompactTaskQuery(
        ctx.normalizedQuery || DEFAULT_COMPACT_TASK_QUERY,
        beforeContext,
    );
    const input = buildTaskOneShotInput(ctx.session, compactPrompt);
    const compactItemId = `context-compaction-${Date.now()}`;
    ctx.pushEvent({
        type: 'turn_item_started',
        content: JSON.stringify({
            itemType: 'context_compaction',
            itemId: compactItemId,
            status: 'running',
        }),
    });
    ctx.pushEvent({
        type: 'planning',
        content: '正在提炼已完成动作与关键结论...',
    });

    try {
        const response = await chatComplete(input, undefined, COMPACT_TASK_INSTRUCTIONS, ctx.signal);
        const compactSummary = extractAssistantOutputText(response.output) || '已完成上下文整理。';
        const nextContext = buildCompactedReplacementContext(beforeContext, compactSummary);
        const afterDigest = buildCompactContextDigest(nextContext);
        ctx.session.context = nextContext;
        ctx.session.status = 'done';
        ctx.session.failureCode = undefined;
        ctx.session.lastError = undefined;
        persistRuntimeSessions();
        ctx.pushEvent({
            type: 'planning',
            content: `上下文压缩完成：${beforeContext.length} -> ${nextContext.length}，已保留任务主线。`,
        });
        ctx.pushEvent({
            type: 'turn_item_completed',
            content: JSON.stringify({
                itemType: 'context_compaction',
                itemId: compactItemId,
                status: 'completed',
            }),
        });
        const assistantItemId = `assistant-compact-${Date.now()}`;
        ctx.pushEvent({
            type: 'turn_item_started',
            content: JSON.stringify({
                itemType: 'assistant_message',
                itemId: assistantItemId,
                status: 'running',
            }),
        });
        ctx.pushEvent({
            type: 'turn_item_completed',
            content: JSON.stringify({
                itemType: 'assistant_message',
                itemId: assistantItemId,
                status: 'completed',
            }),
        });
        ctx.pushEvent({
            type: 'text',
            content: compactSummary,
        });
        ctx.pushEvent({
            type: 'warning',
            content: '上下文已压缩。若后续结果不完整，建议重新开启一个新会话继续。',
        });
        emitTaskLifecycleEvent(
            ctx.pushEvent,
            'compact',
            'exited',
            '上下文整理已完成。',
            'done',
            ctx.runId,
            {
                compactSummary,
                assistantReply: compactSummary,
                beforeContextItems: beforeContext.length,
                afterContextItems: nextContext.length,
                compressionStateBefore: beforeDigest,
                compressionStateAfter: afterDigest,
            },
        );
    } catch (err) {
        const aborted = ctx.signal.aborted || (err as any)?.name === 'AbortError';
        if (aborted) throw err;
        ctx.pushEvent({
            type: 'turn_item_completed',
            content: JSON.stringify({
                itemType: 'context_compaction',
                itemId: compactItemId,
                status: 'error',
            }),
        });
        emitTaskLifecycleEvent(
            ctx.pushEvent,
            'compact',
            'exited',
            '上下文整理已结束。',
            'error',
            ctx.runId,
            {
                failureCode: 'E_SESSION_RUNTIME',
                reason: 'compact_task_failed',
            },
        );
        throw err;
    }
}

/** 压缩 context 数组（超出 MAX_MODEL_CONTEXT_ITEMS 时自动裁剪并生成摘要） */
export function compactSessionContext(context: InputItem[]): InputItem[] {
    if (!Array.isArray(context) || context.length <= MAX_MODEL_CONTEXT_ITEMS) return context;

    const keepTail = Math.max(90, Math.floor(MAX_MODEL_CONTEXT_ITEMS * 0.78));
    const dropCount = Math.max(0, context.length - keepTail);
    const dropped = context.slice(0, dropCount);
    const tail = context.slice(dropCount).filter((item) => !isSessionCompressionMessage(item));

    const droppedUsers = dropped.filter((item) => 'role' in item && item.role === 'user').length;
    const droppedAssistants = dropped.filter((item) => 'role' in item && item.role === 'assistant').length;
    const droppedTools = dropped.filter((item) => 'type' in item).length;

    const summary: InputItem = {
        role: 'assistant',
        content: buildSessionCompressionSummary(tail, dropCount, droppedUsers, droppedAssistants, droppedTools),
    };

    const merged = [summary, ...tail];
    return merged.slice(-MAX_MODEL_CONTEXT_ITEMS);
}

/** 构建压缩后的替换 context（保留近期用户消息 + 压缩摘要） */
function buildCompactedReplacementContext(context: InputItem[], compactSummary: string): InputItem[] {
    const normalized = compactSessionContext([...(context || [])]).filter((item) => {
        return !isSessionCompressionMessage(item);
    });

    const selectedUsers: InputItem[] = [];
    let remainingChars = COMPACT_USER_CONTEXT_CHAR_LIMIT;
    for (let index = normalized.length - 1; index >= 0; index--) {
        const item = normalized[index];
        if (!('role' in item) || item.role !== 'user') continue;
        const content = getTextContent(item.content).trim();
        if (!content) continue;
        const effectiveLen = content.length;
        if (effectiveLen > remainingChars && selectedUsers.length > 0) break;
        selectedUsers.push({ role: 'user', content });
        remainingChars = Math.max(0, remainingChars - effectiveLen);
        if (selectedUsers.length >= COMPACT_USER_CONTEXT_LIMIT || remainingChars === 0) break;
    }
    selectedUsers.reverse();

    const summaryItem: InputItem = {
        role: 'assistant',
        content: `${SESSION_CONTEXT_COMPRESSION_TAG} ${compactSummary}`,
    };

    return compactSessionContext([...selectedUsers, summaryItem]);
}
