/**
 * 搜索面板容器组件
 * 包含：遮罩层 + 搜索框（InputBar + ResultView + Footer）
 */

import React, { useRef, useCallback } from 'react';
import { useMole } from '../context/useMole';
import { useAIStream } from '../hooks/useAIStream';
import { useSecondTick } from '../hooks/useGlobalEvents';
import { InputBar } from './InputBar';
import { ResultView } from './ResultView';
import { ApprovalCard } from './ApprovalCard';
import { AskUserCard } from './AskUserCard';
import { RecorderBar } from './RecorderBar';
import { BgTasksPanel } from './BgTasksPanel';
import { formatClock, formatDuration } from '../text-utils';

export const SearchPanel: React.FC<{ stopRecording: () => void; cancelAuditing?: () => void }> = ({ stopRecording, cancelAuditing }) => {
  const { state, dispatch } = useMole();
  const resultRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // 注册 AI 流式事件监听
  useAIStream(resultRef);

  const task = state.currentTask;
  const isRunning = task?.status === 'running';

  // 稳定的每秒计时器（仅运行中时）
  useSecondTick(isRunning === true);

  // 搜索框状态 class
  const boxState = !task ? 'state-idle'
    : task.status === 'running' ? 'state-running'
    : task.status === 'error' ? 'state-error'
    : 'state-done';

  // 点击遮罩关闭
  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === overlayRef.current) {
      dispatch({ type: 'TOGGLE_OPEN', payload: false });
    }
  }, [dispatch]);

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
    if (!task) return 'Mole \u00B7 AI 助手';
    if (isRunning) return task.liveStatusText || '我正在继续处理';
    if (task.status === 'error') return `处理失败 · ${task.title}`;
    return `已完成 · ${task.title}`;
  };

  if (!state.isOpen) return null;

  return (
    <div
      className="mole-overlay visible"
      ref={overlayRef}
      onMouseDown={handleOverlayClick}
    >
      <div className={`mole-searchbox ${boxState}`}>
        <InputBar resultRef={resultRef} />
        <div className="mole-divider" />
        <ResultView />
        {/* 审批卡片（独立于 ResultView，不依赖 currentTask） */}
        {state.approvalRequest && (
          <ApprovalCard
            key={state.approvalRequest.requestId}
            requestId={state.approvalRequest.requestId}
            message={state.approvalRequest.message}
          />
        )}
        {/* 提问卡片 */}
        {state.askUserRequest && (
          <AskUserCard
            key={state.askUserRequest.requestId}
            requestId={state.askUserRequest.requestId}
            question={state.askUserRequest.question}
            options={state.askUserRequest.options}
            allowFreeText={state.askUserRequest.allowFreeText}
          />
        )}
        <div className="mole-divider mole-divider-bottom" />
        <RecorderBar onStop={stopRecording} onCancelAudit={cancelAuditing} />
        <BgTasksPanel />
        <div className="mole-footer">
          <span className="mole-footer-icon">✦</span>
          <span className="mole-footer-text">{getFooterText()}</span>
          <span className="mole-footer-time">{getFooterTime()}</span>
        </div>
      </div>
    </div>
  );
};
