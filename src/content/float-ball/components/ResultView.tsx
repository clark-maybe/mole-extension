/**
 * 结果区容器组件
 * 显示 AI 回复内容：状态面板、工具调用、Markdown 答案、错误信息
 *
 * 改用 React 组件直接渲染，避免 dangerouslySetInnerHTML 导致 DOM 状态丢失
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useMole } from '../context/useMole';
import { markdownToHtml } from '../markdown';
import {
  sanitizeUserFacingRuntimeText,
  clipRuntimeText,
  formatDuration,
} from '../text-utils';

/** 判断滚动容器是否在底部附近（阈值 60px） */
const isNearBottom = (el: HTMLElement, threshold = 60): boolean => {
  return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
};

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
                <span className={`mole-call-status${isRunning && idx === calls.length - 1 ? ' running' : ''}`}>
                  {isRunning && idx === calls.length - 1 ? '···' : '✓'}
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
  const answerRef = useRef<HTMLDivElement>(null);
  const prevTaskIdRef = useRef('');
  // 追踪用户是否在底部附近，新任务开始时重置为 true
  const userAtBottomRef = useRef(true);
  const task = state.currentTask;

  // 监听用户滚动：实时更新是否在底部
  const handleScroll = useCallback(() => {
    const el = resultRef.current;
    if (el) userAtBottomRef.current = isNearBottom(el);
  }, []);

  // 新任务开始时重置滚动状态
  useEffect(() => {
    userAtBottomRef.current = true;
  }, [task?.id]);

  // 智能滚动：仅在用户处于底部附近时才自动滚动
  useEffect(() => {
    const el = resultRef.current;
    if (el && userAtBottomRef.current) {
      requestAnimationFrame(() => {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      });
    }
  }, [task?.lastAIText, task?.status, task?.liveStatusText, task?.callStack?.length]);

  // 增量 DOM 更新：只对新出现的块级元素加淡入动画，已有元素就地更新，避免全量替换闪烁
  useEffect(() => {
    const el = answerRef.current;
    if (!el) return;

    const text = task?.lastAIText || '';
    const html = text ? markdownToHtml(text) : '';
    const taskId = task?.id || '';

    // 任务切换 → 全量替换
    if (taskId !== prevTaskIdRef.current) {
      el.innerHTML = html;
      prevTaskIdRef.current = taskId;
      return;
    }

    if (!html) { el.innerHTML = ''; return; }

    // 解析新 HTML 到临时容器对比
    const temp = document.createElement('div');
    temp.innerHTML = html;

    const oldCount = el.childElementCount;
    const newCount = temp.childElementCount;

    // 首次出现内容 → 写入并对所有子元素加淡入
    if (oldCount === 0) {
      el.innerHTML = html;
      for (const child of Array.from(el.children)) {
        (child as HTMLElement).classList.add('mole-answer-new');
      }
      return;
    }

    // 结构大幅变化（元素变少，罕见：markdown 重解析） → 全量替换
    if (newCount < oldCount) {
      el.innerHTML = html;
      return;
    }

    // 就地更新最后一个已有元素（流式追加到当前段落/代码块等）
    const lastIdx = oldCount - 1;
    const oldLast = el.children[lastIdx];
    const newLast = temp.children[lastIdx];
    if (oldLast && newLast) {
      if (oldLast.tagName === newLast.tagName) {
        // 同类型：直接更新内容
        oldLast.innerHTML = newLast.innerHTML;
      } else {
        // 类型变了（如文本变列表）：替换节点
        el.replaceChild(newLast.cloneNode(true), oldLast);
      }
    }

    // 追加新出现的块级元素，带淡入动画
    for (let i = oldCount; i < newCount; i++) {
      const newChild = temp.children[i].cloneNode(true) as HTMLElement;
      newChild.classList.add('mole-answer-new');
      el.appendChild(newChild);
    }
  }, [task?.lastAIText, task?.id]);

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
    <div className="mole-result visible" ref={resultRef} onScroll={handleScroll}>
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

      {/* AI 文本回复 — ref 管理 DOM 实现增量更新 */}
      <div
        className="mole-answer"
        ref={answerRef}
        style={!task.lastAIText ? { display: 'none' } : undefined}
      />

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
