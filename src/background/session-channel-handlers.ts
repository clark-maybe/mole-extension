/**
 * 会话 Channel 消息处理器 + Op 处理函数
 * 从 background.ts 提取，处理所有 __session_* 和 __ai_* 相关的 Channel 消息
 */
import Channel from '../lib/channel';
import { mcpClient } from '../functions/registry';
import type { AIStreamEvent, SessionReplayPayload, SessionFailureCode } from '../ai/types';
import {
    sessions,
    getActiveSessionId,
    setActiveSessionId,
    activeControllers,
    sessionTaskKinds,
    activeCoalescedTasks,
    parseRollbackCommand,
    respondSessionOp,
    resolveSessionTaskRequest,
    createSession,
    buildSessionSyncPayload,
    buildSessionReplayPayload,
    buildSessionOpQueueSnapshot,
    buildErrorContent,
    runSessionNow,
    abortSessionTask,
    rollbackSessionTurns,
    extractLatestStartedRunId,
    extractExecuteSessionOptions,
    getPrimaryRunningTask,
    findRunningTask,
    getRunningTasks,
    hasRunningTasks,
    getSessionTaskKind,
    dispatchSessionOp,
    persistRuntimeSessions,
    persistSessionHistory,
    RuntimeResourceManager,
} from './session-manager';
import type {
    SessionOp,
    SessionCreateOp,
    SessionContinueOp,
    SessionRollbackOp,
    SessionClearOp,
    SessionCancelOp,
    SessionGetActiveOp,
    SessionReplayRequestOp,
    SessionResumeOp,
    SessionChannelResponder,
    ExecuteSessionOptions,
    SessionTaskKindRequest,
} from './session-manager';

// ============ 会话管理消息处理 ============

async function handleSessionCreateOp(op: SessionCreateOp) {
    const rollbackCommand = parseRollbackCommand(String(op.query || ''));
    if (rollbackCommand) {
        respondSessionOp(op.sendResponse, {
            accepted: false,
            code: 'E_PARAM_RESOLVE',
            message: '当前没有可回滚的活跃会话，请在已有会话中使用 /rollback 或 /undo',
        }, op.label);
        return;
    }

    const resolvedRequest = resolveSessionTaskRequest(op.query, op.requestedTaskKind);
    const session = createSession(resolvedRequest.query, op.tabId);
    sessionTaskKinds.set(session.id, resolvedRequest.taskKind);

    console.log(`[Mole] 创建会话: ${session.id}, kind: ${resolvedRequest.taskKind}, query: ${resolvedRequest.query}`);

    respondSessionOp(op.sendResponse, buildSessionSyncPayload(session), op.label);
    Channel.broadcast('__session_sync', buildSessionSyncPayload(session));

    await runSessionNow(session, resolvedRequest.query, op.tabId, {
        ...op.taskOptions,
        taskKind: resolvedRequest.taskKind,
    });
}

async function handleSessionContinueOp(op: SessionContinueOp) {
    const respond = (payload: Record<string, unknown>) => {
        respondSessionOp(op.sendResponse, payload, op.label);
    };
    const rollbackCommand = parseRollbackCommand(String(op.query || ''));
    const runningTask = getPrimaryRunningTask();
    const runningSessionId = runningTask?.sessionId || null;
    const runningRunId = runningTask?.runId || null;

    if (rollbackCommand) {
        if (runningSessionId) {
            respond({
                accepted: false,
                code: 'E_TURN_MISMATCH',
                message: '存在运行中的任务，无法执行回滚，请先停止当前任务',
                actualSessionId: runningSessionId,
                actualRunId: runningRunId,
            });
            return;
        }
        const targetSession = sessions.get(op.sessionId);
        if (!targetSession) {
            respond({
                accepted: false,
                code: 'E_SESSION_RUNTIME',
                message: `会话不存在：${op.sessionId}`,
            });
            return;
        }
        const rolledBack = await rollbackSessionTurns(targetSession, rollbackCommand.turns, rollbackCommand.source);
        respond({
            accepted: rolledBack.droppedTurns > 0,
            mode: 'rollback',
            sessionId: targetSession.id,
            droppedTurns: rolledBack.droppedTurns,
            message: rolledBack.reason,
        });
        return;
    }

    if (runningSessionId) {
        const injectedQuery = String(op.query || '').trim();
        if (!injectedQuery) {
            respond({
                accepted: false,
                code: 'E_PARAM_RESOLVE',
                message: '追加指令不能为空',
            });
            return;
        }
        if (op.expectedRunId && runningRunId && op.expectedRunId !== runningRunId) {
            respond({
                accepted: false,
                code: 'E_TURN_MISMATCH',
                message: `回合不匹配（expectedRunId=${op.expectedRunId}, actualRunId=${runningRunId}）`,
                expectedRunId: op.expectedRunId,
                actualRunId: runningRunId,
                actualSessionId: runningSessionId,
            });
            return;
        }
        if (op.expectedSessionId && op.expectedSessionId !== runningSessionId) {
            respond({
                accepted: false,
                code: 'E_TURN_MISMATCH',
                message: `会话不匹配（expectedSessionId=${op.expectedSessionId}, actualSessionId=${runningSessionId}）`,
                expectedSessionId: op.expectedSessionId,
                actualSessionId: runningSessionId,
                actualRunId: runningRunId,
            });
            return;
        }

        const activeSession = sessions.get(runningSessionId);
        if (!activeSession) {
            respond({
                accepted: false,
                code: 'E_SESSION_RUNTIME',
                message: `活跃会话不存在：${runningSessionId}`,
            });
            return;
        }

        activeSession.context.push({ role: 'user', content: injectedQuery });
        persistRuntimeSessions();
        respond({ accepted: true, mode: 'injected', sessionId: runningSessionId, runId: runningRunId });
        return;
    }

    const resolvedRequest = resolveSessionTaskRequest(op.query, op.requestedTaskKind);
    const session = sessions.get(op.sessionId);
    if (!session) {
        console.warn(`[Mole] 会话不存在: ${op.sessionId}`);
        respond({
            accepted: false,
            code: 'E_SESSION_RUNTIME',
            message: `会话不存在：${op.sessionId}`,
        });
        return;
    }
    if (op.expectedSessionId && op.expectedSessionId !== op.sessionId) {
        respond({
            accepted: false,
            code: 'E_TURN_MISMATCH',
            message: `会话不匹配（expectedSessionId=${op.expectedSessionId}, actualSessionId=${op.sessionId}）`,
            expectedSessionId: op.expectedSessionId,
            actualSessionId: op.sessionId,
            actualRunId: extractLatestStartedRunId(session.eventLog),
        });
        return;
    }
    if (op.expectedRunId) {
        const latestRunId = extractLatestStartedRunId(session.eventLog);
        if (latestRunId && latestRunId !== op.expectedRunId) {
            respond({
                accepted: false,
                code: 'E_TURN_MISMATCH',
                message: `回合不匹配（expectedRunId=${op.expectedRunId}, actualRunId=${latestRunId}）`,
                expectedRunId: op.expectedRunId,
                actualRunId: latestRunId,
                actualSessionId: op.sessionId,
            });
            return;
        }
    }

    if (activeControllers.has(op.sessionId) || findRunningTask(op.sessionId)) {
        await abortSessionTask(op.sessionId, 'replaced', '继续对话，替换旧会话任务', 'E_SUPERSEDED');
    }

    // 如果 originTabId 对应的标签页已关闭，将当前 tabId 更新为新的 originTabId
    if (session.originTabId && op.tabId) {
        try {
            await chrome.tabs.get(session.originTabId);
        } catch {
            // 原标签页已关闭，更新为当前发起者
            session.originTabId = op.tabId;
        }
    }

    session.status = 'running';
    session.startedAt = Date.now();
    session.endedAt = undefined;
    session.durationMs = undefined;
    session.failureCode = undefined;
    session.lastError = undefined;
    session.agentState = {
        phase: 'plan',
        round: 0,
        reason: `继续对话：${resolvedRequest.query.slice(0, 30)}`,
        updatedAt: Date.now(),
    };
    sessionTaskKinds.set(session.id, resolvedRequest.taskKind);

    Channel.broadcast('__session_sync', buildSessionSyncPayload(session));
    persistRuntimeSessions();

    await runSessionNow(session, resolvedRequest.query, op.tabId, {
        ...op.taskOptions,
        taskKind: resolvedRequest.taskKind,
    });
    respond({
        accepted: true,
        mode: 'restart',
        sessionId: op.sessionId,
    });
}

/** 可恢复的失败码集合 */
const RESUMABLE_FAILURE_CODES = new Set([
    'E_SESSION_RUNTIME',  // SW 重启
    'E_LLM_API',          // API 错误
    'E_CANCELLED',        // 用户取消（可能想重试）
    'E_TOOL_EXEC',        // 工具执行失败
    'E_UNKNOWN',          // 未知错误
]);

async function handleSessionResumeOp(op: SessionResumeOp) {
    const respond = (payload: Record<string, unknown>) => {
        respondSessionOp(op.sendResponse, payload, op.label);
    };

    const session = sessions.get(op.sessionId);
    if (!session) {
        respond({
            accepted: false,
            code: 'E_SESSION_RUNTIME',
            message: `会话不存在：${op.sessionId}`,
        });
        return;
    }

    // 防重入：正在运行的会话不能恢复
    if (session.status === 'running' || findRunningTask(op.sessionId)) {
        respond({
            accepted: false,
            code: 'E_TURN_MISMATCH',
            message: '会话正在运行中，无法重试',
        });
        return;
    }

    // 没有上下文无法恢复
    if (!Array.isArray(session.context) || session.context.length === 0) {
        respond({
            accepted: false,
            code: 'E_SESSION_RUNTIME',
            message: '会话没有可恢复的上下文',
        });
        return;
    }

    // 检查失败码是否属于可恢复类型
    if (session.failureCode && !RESUMABLE_FAILURE_CODES.has(session.failureCode)) {
        respond({
            accepted: false,
            code: 'E_PARAM_RESOLVE',
            message: `当前错误类型 ${session.failureCode} 不支持断点恢复`,
        });
        return;
    }

    // 构建恢复提示
    const failureDesc = session.failureCode || '异常';
    const resumeHint = `上一轮任务因 ${failureDesc} 中断，请基于已有的工具调用结果继续完成任务。不要重复已经完成的步骤。`;

    // 重置 session 状态
    session.status = 'running';
    session.startedAt = Date.now();
    session.endedAt = undefined;
    session.durationMs = undefined;
    session.failureCode = undefined;
    session.lastError = undefined;
    session.agentState = {
        phase: 'plan',
        round: 0,
        reason: `断点恢复：${resumeHint.slice(0, 30)}`,
        updatedAt: Date.now(),
    };

    // 如果 originTabId 对应的标签页已关闭，更新为当前 tabId
    if (session.originTabId && op.tabId) {
        try {
            await chrome.tabs.get(session.originTabId);
        } catch {
            session.originTabId = op.tabId;
        }
    }

    Channel.broadcast('__session_sync', buildSessionSyncPayload(session));
    persistRuntimeSessions();

    console.log(`[Mole] 断点恢复会话: ${session.id}, failureCode: ${failureDesc}`);

    // 通过 runSessionNow 重新执行，传入 resumeHint 作为 query
    // session.context 已保存了之前的上下文，runSessionTaskChat 会自动用它作为 previousContext
    await runSessionNow(session, resumeHint, op.tabId, {
        appendUserQuery: true,
        taskKind: getSessionTaskKind(session.id),
    });

    respond({
        accepted: true,
        mode: 'resume',
        sessionId: op.sessionId,
    });
}

async function handleSessionRollbackOp(op: SessionRollbackOp) {
    if (hasRunningTasks()) {
        respondSessionOp(op.sendResponse, {
            success: false,
            code: 'E_TURN_MISMATCH',
            message: '存在运行中的任务，无法执行回滚',
        }, op.label);
        return;
    }
    const session = sessions.get(op.sessionId);
    if (!session) {
        respondSessionOp(op.sendResponse, {
            success: false,
            code: 'E_SESSION_RUNTIME',
            message: `会话不存在：${op.sessionId}`,
        }, op.label);
        return;
    }
    const result = await rollbackSessionTurns(session, op.turns, op.source);
    respondSessionOp(op.sendResponse, {
        success: result.droppedTurns > 0,
        sessionId: op.sessionId,
        droppedTurns: result.droppedTurns,
        message: result.reason,
    }, op.label);
}

async function handleSessionClearOp(op: SessionClearOp) {
    await RuntimeResourceManager.closeAll(op.sessionId);
    const clearedTaskKind = getSessionTaskKind(op.sessionId);
    const now = Date.now();

    const session = sessions.get(op.sessionId);
    const isRunningSession = session?.status === 'running';
    if (session) {
        if (session.status === 'running') {
            await abortSessionTask(op.sessionId, 'interrupted', '会话已清除', 'E_CANCELLED');
            persistSessionHistory(session);
        }
    }

    if (getActiveSessionId() === op.sessionId) {
        setActiveSessionId(null);
    }

    Channel.broadcast('__session_sync', {
        sessionId: op.sessionId,
        activeRunId: null,
        status: 'cleared',
        summary: '',
        agentState: {
            phase: 'idle',
            round: 0,
            reason: '会话已清除',
            updatedAt: now,
        },
        startedAt: session?.startedAt,
        endedAt: session?.endedAt,
        durationMs: session?.durationMs,
        failureCode: isRunningSession ? 'E_CANCELLED' : session?.failureCode,
        lastError: isRunningSession ? '会话已清除' : session?.lastError,
        taskKind: clearedTaskKind,
        opQueue: buildSessionOpQueueSnapshot(now),
    });
    sessionTaskKinds.delete(op.sessionId);
    persistRuntimeSessions();
}

async function handleSessionCancelOp(op: SessionCancelOp) {
    if (activeControllers.has(op.sessionId) || getRunningTasks().some(task => task.sessionId === op.sessionId)) {
        console.log(`[Mole] 取消任务: ${op.sessionId}`);
        await abortSessionTask(op.sessionId, 'interrupted', '任务已取消', 'E_CANCELLED');
    } else {
        await RuntimeResourceManager.closeAll(op.sessionId);
    }

    const session = sessions.get(op.sessionId);
    if (session && session.status === 'error') {
        Channel.broadcast('__session_sync', buildSessionSyncPayload(session));
    }
}

async function handleSessionGetActiveOp(op: SessionGetActiveOp) {
    if (!getActiveSessionId()) {
        respondSessionOp(op.sendResponse, null, op.label);
        return;
    }

    const session = sessions.get(getActiveSessionId()!);
    if (!session) {
        respondSessionOp(op.sendResponse, null, op.label);
        return;
    }

    respondSessionOp(op.sendResponse, buildSessionSyncPayload(session), op.label);

    const tabId = op.senderTabId;
    if (session.eventLog.length > 0 && tabId) {
        const replayPayload = buildSessionReplayPayload(session, 'latest_turn');
        setTimeout(() => {
            Channel.sendToTab(tabId, '__session_replay', {
                ...replayPayload,
            });
        }, 50);
    }
}

async function handleSessionReplayRequestOp(op: SessionReplayRequestOp) {
    const sessionId = typeof op.sessionId === 'string' ? op.sessionId : getActiveSessionId();
    if (!sessionId) {
        respondSessionOp(op.sendResponse, {
            success: false,
            code: 'E_PARAM_RESOLVE',
            message: '缺少 sessionId',
        }, op.label);
        return;
    }

    const session = sessions.get(sessionId);
    if (!session) {
        respondSessionOp(op.sendResponse, {
            success: false,
            code: 'E_SESSION_RUNTIME',
            message: `会话不存在：${sessionId}`,
        }, op.label);
        return;
    }

    const scopeRaw = String(op.scopeRaw || 'latest_turn').trim().toLowerCase();
    const scope: SessionReplayPayload['scope'] = scopeRaw === 'full' || scopeRaw === 'delta'
        ? scopeRaw
        : 'latest_turn';
    const fromEventCount = Number.isFinite(Number(op.fromEventCountRaw))
        ? Number(op.fromEventCountRaw)
        : undefined;
    const payload = buildSessionReplayPayload(session, scope, fromEventCount);

    if (op.senderTabId) {
        Channel.sendToTab(op.senderTabId, '__session_replay', payload);
    } else {
        Channel.broadcast('__session_replay', payload);
    }

    respondSessionOp(op.sendResponse, {
        success: true,
        sessionId,
        scope: payload.scope,
        fromEventCount: payload.fromEventCount,
        eventCount: payload.eventCount,
        deliveredToTabId: op.senderTabId || null,
    }, op.label);
}

async function handleSessionOp(op: SessionOp) {
    if (op.type === 'create') {
        await handleSessionCreateOp(op);
        return;
    }
    if (op.type === 'continue') {
        await handleSessionContinueOp(op);
        return;
    }
    if (op.type === 'rollback') {
        await handleSessionRollbackOp(op);
        return;
    }
    if (op.type === 'clear') {
        await handleSessionClearOp(op);
        return;
    }
    if (op.type === 'cancel') {
        await handleSessionCancelOp(op);
        return;
    }
    if (op.type === 'get_active') {
        await handleSessionGetActiveOp(op);
        return;
    }
    if (op.type === 'replay_request') {
        await handleSessionReplayRequestOp(op);
        return;
    }
    if (op.type === 'resume') {
        await handleSessionResumeOp(op);
        return;
    }
}

function submitSessionOp(op: SessionOp): Promise<void> {
    return dispatchSessionOp(op.label, async () => {
        await handleSessionOp(op);
    });
}

/**
 * 创建新会话
 * content script 请求创建新会话，background 生成 sessionId 并开始 AI 对话
 */
Channel.on('__session_create', (data, sender, sendResponse) => {
    const query = typeof data?.query === 'string' ? data.query : '';
    if (!query.trim()) return;
    const op: SessionCreateOp = {
        type: 'create',
        label: '__session_create',
        query,
        requestedTaskKind: data?.taskKind,
        taskOptions: extractExecuteSessionOptions(data),
        tabId: sender?.tab?.id,
        sendResponse,
    };
    void submitSessionOp(op);

    return true;
});

/**
 * 继续对话
 * content script 在已有会话上继续对话
 */
Channel.on('__session_continue', (data, sender, sendResponse) => {
    const sessionId = typeof data?.sessionId === 'string' ? data.sessionId : '';
    const query = typeof data?.query === 'string' ? data.query : '';
    const requestedTaskKind = data?.taskKind;
    const expectedSessionId = typeof data?.expectedSessionId === 'string' ? data.expectedSessionId : null;
    const expectedRunIdRaw = data?.expectedRunId ?? data?.expectedTurnId ?? data?.expected_turn_id;
    const expectedRunId = typeof expectedRunIdRaw === 'string' && expectedRunIdRaw.trim()
        ? expectedRunIdRaw.trim()
        : null;
    if (!sessionId || !query.trim()) return;

    const op: SessionContinueOp = {
        type: 'continue',
        label: '__session_continue',
        sessionId,
        query,
        requestedTaskKind,
        expectedSessionId,
        expectedRunId,
        taskOptions: extractExecuteSessionOptions(data),
        tabId: sender?.tab?.id,
        sendResponse,
    };
    void submitSessionOp(op);

    return true;
});

Channel.on('__session_rollback', (data, _sender, sendResponse) => {
    const sessionId = typeof data?.sessionId === 'string' ? data.sessionId : getActiveSessionId();
    const turnsRaw = Number(data?.numTurns ?? data?.turns ?? 1);
    const turns = Number.isFinite(turnsRaw) ? Math.max(1, Math.min(50, Math.floor(turnsRaw))) : 1;
    const source = String(data?.source || '').trim().toLowerCase() === 'undo' ? 'undo' : 'rollback';
    if (!sessionId) {
        sendResponse?.({
            success: false,
            code: 'E_PARAM_RESOLVE',
            message: '缺少 sessionId',
        });
        return true;
    }

    const op: SessionRollbackOp = {
        type: 'rollback',
        label: '__session_rollback',
        sessionId,
        turns,
        source,
        sendResponse,
    };
    void submitSessionOp(op);
    return true;
});

/**
 * 断点恢复
 * 任务失败后，用户点击"重试"按钮，从保存的 context 断点恢复执行
 */
Channel.on('__session_resume', (data, sender, sendResponse) => {
    const sessionId = typeof data?.sessionId === 'string' ? data.sessionId : '';
    if (!sessionId) {
        sendResponse?.({
            accepted: false,
            code: 'E_PARAM_RESOLVE',
            message: '缺少 sessionId',
        });
        return true;
    }

    const op: SessionResumeOp = {
        type: 'resume',
        label: '__session_resume',
        sessionId,
        tabId: sender?.tab?.id,
        sendResponse,
    };
    void submitSessionOp(op);
    return true;
});

/**
 * 获取当前活跃会话信息
 * 新标签页初始化时请求，用于恢复会话状态
 */
Channel.on('__session_get_active', (_data, sender, sendResponse) => {
    const op: SessionGetActiveOp = {
        type: 'get_active',
        label: '__session_get_active',
        senderTabId: sender?.tab?.id,
        sendResponse,
    };
    void submitSessionOp(op);
    return true;
});

/**
 * 请求会话回放
 * 支持 latest_turn / full / delta 三种范围
 */
Channel.on('__session_replay_request', (data, sender, sendResponse) => {
    const op: SessionReplayRequestOp = {
        type: 'replay_request',
        label: '__session_replay_request',
        sessionId: typeof data?.sessionId === 'string' ? data.sessionId : getActiveSessionId(),
        scopeRaw: String(data?.scope || 'latest_turn'),
        fromEventCountRaw: data?.fromEventCount,
        senderTabId: sender?.tab?.id,
        sendResponse,
    };
    void submitSessionOp(op);
    return true;
});

/**
 * 清除会话
 * 任意标签页请求清除当前活跃会话
 */
Channel.on('__session_clear', (data) => {
    const sessionId = data?.sessionId || getActiveSessionId();
    if (!sessionId) return;

    const op: SessionClearOp = {
        type: 'clear',
        label: '__session_clear',
        sessionId,
    };
    void submitSessionOp(op);
});

// ============ AI 对话处理 ============

/**
 * 处理 AI 任务取消请求
 * 支持 sessionId（新模式）和 taskId（兼容旧模式）
 */
Channel.on('__ai_cancel', (data) => {
    const id = data?.sessionId || data?.taskId;
    if (!id) return;

    const op: SessionCancelOp = {
        type: 'cancel',
        label: '__ai_cancel',
        sessionId: id,
    };
    void submitSessionOp(op);
});

/**
 * 测试链式调用：真实调用多个函数
 * 输入 "test:chain:关键词" 时触发，依次调用 baidu_search → jd_search
 */
Channel.on('__test_chain', (data, sender) => {
    const keyword = data?.keyword;
    const taskId = data?.taskId;
    const tabId = sender?.tab?.id;

    if (!keyword || !tabId) return;

    const pushEvent = (event: { type: string; content: string }) => {
        Channel.sendToTab(tabId, '__ai_stream', { ...event, taskId });
    };

    console.log(`[Mole] 测试链式调用, tab: ${tabId}, keyword: ${keyword}`);

    (async () => {
        pushEvent({ type: 'thinking', content: 'AI 正在思考...' });

        // 第一轮：百度搜索（通过 MCP Client 调用）
        pushEvent({ type: 'function_call', content: '正在调用 baidu_search...' });
        try {
            const baiduResult = await mcpClient.callTool('baidu_search', { keyword });
            pushEvent({ type: 'function_result', content: 'baidu_search 执行完成' });
            if (!baiduResult.isError && baiduResult.content[0]?.text) {
                const parsed = JSON.parse(baiduResult.content[0].text);
                if (parsed.success && parsed.data) {
                    pushEvent({ type: 'search_results', content: JSON.stringify(parsed.data) });
                }
            }
        } catch (err: any) {
            pushEvent({ type: 'function_result', content: `baidu_search 出错: ${err.message}` });
        }

        // 第二轮：京东搜索（通过 MCP Client 调用）
        pushEvent({ type: 'function_call', content: '正在调用 jd_search...' });
        try {
            const jdResult = await mcpClient.callTool('jd_search', { keyword });
            pushEvent({ type: 'function_result', content: 'jd_search 执行完成' });
            if (!jdResult.isError && jdResult.content[0]?.text) {
                const parsed = JSON.parse(jdResult.content[0].text);
                if (parsed.success && parsed.data) {
                    pushEvent({ type: 'search_results', content: JSON.stringify(parsed.data) });
                }
            }
        } catch (err: any) {
            pushEvent({ type: 'function_result', content: `jd_search 出错: ${err.message}` });
        }

        // 模拟 AI 流式文本输出
        const aiReply = `### 综合分析\n\n` +
            `根据**百度搜索**和**京东商品**数据，为你整理「${keyword}」选购建议：\n\n` +
            `### 轴体对比\n\n` +
            `- **红轴**：线性手感，轻柔安静，适合长时间打字和游戏\n` +
            `- **青轴**：段落感强，打字有"哒哒"声，喜欢反馈感的首选\n` +
            `- **茶轴**：介于红轴和青轴之间，兼顾手感与静音\n\n` +
            `### 价格区间\n\n` +
            `1. **入门级** \`¥200-500\`：Cherry MX Board、Akko 3068\n` +
            `2. **进阶级** \`¥500-1000\`：Leopold FC750R、Varmilo 阿米洛\n` +
            `3. **旗舰级** \`¥1000+\`：HHKB Professional、Realforce\n\n` +
            `### 选购建议\n\n` +
            `选购时建议关注**键帽材质**（PBT 优于 ABS）、**连接方式**（有线延迟低，蓝牙便携）以及*售后保修政策*。更多信息可参考 [机械键盘吧](https://tieba.baidu.com/f?kw=%E6%9C%BA%E6%A2%B0%E9%94%AE%E7%9B%98)。\n\n` +
            `以下是为你精选的商品，点击可直接查看：`;

        // 逐块推送模拟流式
        for (let i = 0; i < aiReply.length; i += 6) {
            pushEvent({ type: 'text', content: aiReply.slice(0, i + 6) });
            await new Promise(r => setTimeout(r, 15));
        }
        pushEvent({ type: 'text', content: aiReply });

        // 推荐卡片
        const cards = [
            { title: 'Cherry MX Board 3.0S 机械键盘 红轴', price: '¥549', shop: 'Cherry官方旗舰店', url: 'https://item.jd.com/100038004786.html', tag: '性价比首选' },
            { title: 'Leopold FC750R PD 双模机械键盘 茶轴', price: '¥799', shop: 'Leopold海外旗舰店', url: 'https://item.jd.com/100014458498.html', tag: '手感之王' },
            { title: 'HHKB Professional Hybrid 静电容键盘', price: '¥1,899', shop: 'HHKB京东自营', url: 'https://item.jd.com/100011459498.html', tag: '极客必备' },
        ];
        pushEvent({ type: 'cards', content: JSON.stringify(cards) });

        pushEvent({ type: 'text', content: aiReply });
    })().catch((err) => {
        pushEvent({
            type: 'error',
            content: buildErrorContent('E_SESSION_RUNTIME', err.message || '链式调用异常', 'background', true),
        });
    });

    return true;
});
