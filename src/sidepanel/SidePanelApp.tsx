/**
 * Side Panel 根组件
 * 复用悬浮球的 Context、Hooks 和 UI 组件，适配侧边栏布局
 */

import React, { useRef, useEffect, useCallback } from 'react';
import { MoleProvider } from '../content/float-ball/context/MoleContext';
import { useMole } from '../content/float-ball/context/useMole';
import { useAIStream } from '../content/float-ball/hooks/useAIStream';
import { useSecondTick } from '../content/float-ball/hooks/useGlobalEvents';
import { InputBar } from '../content/float-ball/components/InputBar';
import { ResultView } from '../content/float-ball/components/ResultView';
import { ApprovalCard } from '../content/float-ball/components/ApprovalCard';
import { AskUserCard } from '../content/float-ball/components/AskUserCard';
import { RecorderBar } from '../content/float-ball/components/RecorderBar';
import { BgTasksPanel } from '../content/float-ball/components/BgTasksPanel';
import { ImageViewer } from '../content/float-ball/components/ImageViewer';
import Channel from '../lib/channel';
import { formatClock, formatDuration } from '../content/float-ball/text-utils';

/** Tab 感知 hook：追踪当前活跃标签页，并同步到 MoleContext.selfTabId */
const useActiveTab = () => {
    const { dispatch } = useMole();

    useEffect(() => {
        const updateTabId = (tabId: number) => {
            dispatch({ type: 'SET_SELF_TAB_ID', payload: tabId });
        };

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.id) updateTabId(tabs[0].id);
        });

        const handleActivated = (info: chrome.tabs.TabActiveInfo) => {
            updateTabId(info.tabId);
        };
        chrome.tabs.onActivated.addListener(handleActivated);
        return () => chrome.tabs.onActivated.removeListener(handleActivated);
    }, [dispatch]);
};

/** Side Panel 键盘事件 hook */
const useSidePanelEvents = () => {
    const { state, dispatch } = useMole();
    const stateRef = useRef(state);
    stateRef.current = state;

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            const s = stateRef.current;

            if (s.screenshotPreviewList.length > 0) {
                dispatch({ type: 'SET_SCREENSHOT_PREVIEW', payload: { list: [], index: 0 } });
                return;
            }

            if (s.currentTask) {
                Channel.send('__session_clear', { sessionId: s.currentTask.id });
                dispatch({ type: 'SET_TASK', payload: null });
                return;
            }

            // 无会话时关闭侧边栏
            window.close();
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [dispatch]);
};

/** Side Panel 内部组件 */
const SidePanelInner: React.FC = () => {
    const { state, dispatch } = useMole();
    const resultRef = useRef<HTMLDivElement>(null);
    useActiveTab();

    // 注册 AI 流式事件监听
    useAIStream(resultRef);
    useSidePanelEvents();

    const task = state.currentTask;
    const isRunning = task?.status === 'running';

    useSecondTick(isRunning === true);

    // Side Panel 打开时自动标记为已打开状态
    useEffect(() => {
        dispatch({ type: 'TOGGLE_OPEN', payload: true });
    }, [dispatch]);

    // 恢复活跃会话
    useEffect(() => {
        Channel.send('__session_get_active', {}, (response: { sessionId?: string; status?: string; summary?: string; startedAt?: number }) => {
            if (response?.sessionId && response?.status === 'running') {
                dispatch({
                    type: 'SET_TASK',
                    payload: {
                        id: response.sessionId,
                        query: response.summary || '',
                        title: response.summary || '',
                        status: 'running',
                        resultHtml: '',
                        callStack: [],
                        errorMsg: '',
                        lastAIText: '',
                        agentPhase: 'plan',
                        agentRound: 0,
                        failureCode: '',
                        startedAt: response.startedAt || Date.now(),
                        endedAt: null,
                        durationMs: null,
                    },
                });
            }
        });
    }, [dispatch]);

    // 搜索框状态 class
    const boxState = !task ? 'state-idle'
        : task.status === 'running' ? 'state-running'
        : task.status === 'error' ? 'state-error'
        : 'state-done';

    // Footer 时间
    const getFooterTime = () => {
        if (!task) return '';
        if (isRunning) {
            const elapsed = Math.max(0, Date.now() - task.startedAt);
            return `开始 ${formatClock(task.startedAt)} · 已运行 ${formatDuration(elapsed)}`;
        }
        const end = task.endedAt;
        const duration = task.durationMs ?? (end ? Math.max(0, end - task.startedAt) : null);
        const parts: string[] = [];
        if (end) parts.push(`结束 ${formatClock(end)}`);
        if (duration !== null) parts.push(`耗时 ${formatDuration(duration)}`);
        return parts.join(' · ');
    };

    // Footer 文本
    const getFooterText = () => {
        if (!task) return 'Mole · AI 助手';
        if (isRunning) return task.liveStatusText || '我正在继续处理';
        if (task.status === 'error') return `处理失败 · ${task.title}`;
        return `已完成 · ${task.title}`;
    };

    // 录制操作（Side Panel 中暂不支持直接录制，保留接口）
    const handleStopRecording = useCallback(() => {
        Channel.send('__recorder_stop', {});
    }, []);
    const handleCancelAuditing = useCallback(() => {
        Channel.send('__recorder_cancel_audit', {});
    }, []);

    const logoUrl = chrome.runtime.getURL('logo.png');

    // 新对话
    const handleNewChat = useCallback(() => {
        if (task) {
            Channel.send('__session_clear', { sessionId: task.id });
        }
        dispatch({ type: 'SET_TASK', payload: null });
    }, [task, dispatch]);

    // 打开设置
    const handleOpenSettings = useCallback(() => {
        Channel.send('__open_options_page', {});
    }, []);

    return (
        <div className={`sidepanel-root ${boxState}`}>
            {/* 顶栏 */}
            <div className="sidepanel-header">
                <div className="sidepanel-header-left">
                    <img className="sidepanel-header-logo" src={logoUrl} alt="Mole" />
                    <span className="sidepanel-header-title">Mole</span>
                </div>
                <div className="sidepanel-header-actions">
                    <button
                        className="sidepanel-header-btn"
                        title="新对话"
                        onClick={handleNewChat}
                    >
                        +
                    </button>
                    <button
                        className="sidepanel-header-btn"
                        title="设置"
                        onClick={handleOpenSettings}
                    >
                        ⚙
                    </button>
                </div>
            </div>

            {/* 内容区 */}
            <div className="sidepanel-content">
                {!task ? (
                    <div className="sidepanel-empty">
                        <img className="sidepanel-empty-logo" src={logoUrl} alt="" />
                        <p className="sidepanel-empty-text">有什么想让我做的？</p>
                    </div>
                ) : (
                    <div ref={resultRef}>
                        <ResultView />
                    </div>
                )}
                {state.approvalRequest && (
                    <ApprovalCard
                        key={state.approvalRequest.requestId}
                        requestId={state.approvalRequest.requestId}
                        message={state.approvalRequest.message}
                    />
                )}
                {state.askUserRequest && (
                    <AskUserCard
                        key={state.askUserRequest.requestId}
                        requestId={state.askUserRequest.requestId}
                        question={state.askUserRequest.question}
                        options={state.askUserRequest.options}
                        allowFreeText={state.askUserRequest.allowFreeText}
                    />
                )}
                <RecorderBar onStop={handleStopRecording} onCancelAudit={handleCancelAuditing} />
                <BgTasksPanel />
            </div>

            {/* 输入区 */}
            <div className="sidepanel-input-area">
                <InputBar resultRef={resultRef} />
            </div>

            {/* 底栏 */}
            <div className="sidepanel-footer">
                <span className="sidepanel-footer-icon">✦</span>
                <span className="sidepanel-footer-text">{getFooterText()}</span>
                <span className="sidepanel-footer-time">{getFooterTime()}</span>
            </div>

            {/* 截图预览 */}
            <ImageViewer />
        </div>
    );
};

export const SidePanelApp: React.FC = () => {
    return (
        <MoleProvider>
            <SidePanelInner />
        </MoleProvider>
    );
};
