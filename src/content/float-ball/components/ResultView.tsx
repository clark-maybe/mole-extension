/**
 * 结果区容器组件
 * 显示 AI 回复内容：状态面板、工具调用、Markdown 答案、错误信息
 *
 * 改用 React 组件直接渲染，避免 dangerouslySetInnerHTML 导致 DOM 状态丢失
 */

import React, { useRef, useEffect, useState } from 'react';
import { useMole } from '../context/useMole';
import { markdownToHtml } from '../markdown';
import {
  sanitizeUserFacingRuntimeText,
  clipRuntimeText,
  formatDuration,
} from '../text-utils';

/** 工具调用折叠组 */
const CallsGroup: React.FC<{
  calls: Array<{ funcName: string; icon: string; text: string; userSummary?: string }>;
  isRunning: boolean;
}> = ({ calls, isRunning }) => {
  const [isOpen, setIsOpen] = useState(true);

  if (calls.length === 0) return null;

  return (
    <div className="mole-calls-group mole-agent-state-ops">
      <div
        className="mole-calls-summary"
        onClick={() => setIsOpen(!isOpen)}
        style={{ cursor: 'pointer' }}
      >
        <span className={`arrow${isOpen ? ' open' : ''}`}>▶</span>
        <span className="calls-text">查看执行过程 · 共 {calls.length} 条</span>
      </div>
      {isOpen && (
        <div className="mole-calls-detail open">
          {calls.map((call, idx) => (
            <div key={idx} className={`mole-call-item tone-${isRunning && idx === calls.length - 1 ? 'action' : 'done'}`}>
              <div className="mole-call-header">
                {call.icon
                  ? <img className="mole-func-icon" src={call.icon} alt="" />
                  : <span className="mole-task-runtime-step-dot" />
                }
                <span className="mole-call-main">
                  <span className="mole-call-title">{call.text}</span>
                  {call.userSummary && (
                    <span className="mole-call-intent">{call.userSummary}</span>
                  )}
                </span>
                <span className="mole-call-status">
                  {isRunning && idx === calls.length - 1 ? '执行中' : '完成'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/** 进展状态面板 */
const AgentStatePanel: React.FC<{
  statusText: string;
  isRunning: boolean;
  isFinished: boolean;
  durationText: string;
  children?: React.ReactNode;
}> = ({ statusText, isRunning, isFinished, durationText, children }) => {
  const [isOpen, setIsOpen] = useState(true);

  // 任务结束自动折叠
  useEffect(() => {
    if (isFinished) setIsOpen(false);
  }, [isFinished]);

  const summaryText = isFinished
    ? (durationText ? `已完成 · 耗时 ${durationText}` : '已完成')
    : statusText;

  return (
    <div className={`mole-agent-state-panel${isRunning ? ' is-live' : ''}${isOpen ? ' open' : ''}`}>
      <div
        className="mole-agent-state-title"
        onClick={() => setIsOpen(!isOpen)}
        style={{ cursor: 'pointer' }}
      >
        <span className="mole-agent-state-title-main">
          <span className={`arrow${isOpen ? ' open' : ''}`}>▶</span>
          <span>进展</span>
        </span>
        <span className="mole-agent-state-summary">{summaryText}</span>
      </div>
      {isOpen && (
        <>
          <div className="mole-task-runtime-board">
            {isRunning && (
              <div className="mole-runtime-now">
                <span className="mole-inline-loader"><span /><span /><span /></span>
                <span className="mole-runtime-now-text">{statusText}</span>
              </div>
            )}
          </div>
          {children}
        </>
      )}
    </div>
  );
};

export const ResultView: React.FC = () => {
  const { state } = useMole();
  const resultRef = useRef<HTMLDivElement>(null);
  const task = state.currentTask;

  // 自动滚动到底部
  useEffect(() => {
    const el = resultRef.current;
    if (el) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [task?.lastAIText, task?.status, task?.liveStatusText, task?.callStack?.length]);

  if (!task) return null;

  const isRunning = task.status === 'running';
  const isFinished = task.status === 'done' || task.status === 'error';

  const statusText = clipRuntimeText(
    sanitizeUserFacingRuntimeText(task.liveStatusText || '我正在继续处理，请稍候...', 'current'),
    120,
  );

  const duration = task.durationMs ?? (task.endedAt ? Math.max(0, task.endedAt - task.startedAt) : null);
  const durationText = duration !== null ? formatDuration(duration) : '';

  return (
    <div className="mole-result visible" ref={resultRef}>
      {/* 进展面板 */}
      {(isRunning || isFinished) && (
        <AgentStatePanel
          statusText={statusText}
          isRunning={isRunning}
          isFinished={isFinished}
          durationText={durationText}
        >
          <CallsGroup calls={task.callStack} isRunning={isRunning} />
        </AgentStatePanel>
      )}

      {/* AI 文本回复 */}
      {task.lastAIText && (
        <div
          className="mole-answer"
          dangerouslySetInnerHTML={{ __html: markdownToHtml(task.lastAIText) }}
        />
      )}

      {/* 错误信息 */}
      {task.status === 'error' && task.errorMsg && (
        <div className="mole-error">⚠ {task.errorMsg}</div>
      )}

      {/* 完成但无文本 */}
      {task.status === 'done' && !task.lastAIText && (
        <div className="mole-status"><span className="dot" />已完成处理。</div>
      )}
    </div>
  );
};
