/**
 * 输入框组件
 * 功能：文字输入、Enter 提交、上下键历史浏览、状态按钮（终止/新对话/重试）
 */

import React, { useRef, useCallback, useEffect } from 'react';
import Channel from '../../../lib/channel';
import { useMole } from '../context/useMole';
import { buildTaskTitle } from '../text-utils';
import type { TaskItem } from '../context/types';

interface InputBarProps {
  resultRef: React.RefObject<HTMLDivElement | null>;
}

/** 创建新任务的默认状态 */
const createNewTask = (query: string, id?: string): TaskItem => ({
  id: id || Date.now().toString(),
  query,
  title: buildTaskTitle(query),
  status: 'running',
  resultHtml: '',
  callStack: [],
  errorMsg: '',
  lastAIText: '',
  agentPhase: 'plan',
  agentRound: 0,
  failureCode: '',
  startedAt: Date.now(),
  endedAt: null,
  durationMs: null,
  taskKind: 'regular',
});

export const InputBar: React.FC<InputBarProps> = ({ resultRef }) => {
  const { state, dispatch } = useMole();
  const inputRef = useRef<HTMLInputElement>(null);
  const task = state.currentTask;
  const isRunning = task?.status === 'running';

  // 面板打开时自动聚焦
  useEffect(() => {
    if (state.isOpen) {
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el && !el.disabled) el.focus();
      });
    }
  }, [state.isOpen]);

  // 提交新任务
  const submitNewTask = useCallback((value: string) => {
    const tempTask = createNewTask(value);
    dispatch({ type: 'SET_TASK', payload: tempTask });
    dispatch({ type: 'PUSH_INPUT_HISTORY', payload: value });

    Channel.send('__session_create', { query: value }, (response: any) => {
      if (response?.sessionId) {
        dispatch({
          type: 'UPDATE_TASK',
          payload: {
            id: response.sessionId,
            ...(response.summary ? { title: buildTaskTitle(response.summary) } : {}),
          },
        });
        return;
      }
      if (response?.accepted === false) {
        const message = response?.message?.trim() || '创建会话失败';
        dispatch({
          type: 'UPDATE_TASK',
          payload: {
            status: 'error',
            errorMsg: message,
            failureCode: response?.code || '',
          },
        });
      }
    });
  }, [dispatch]);

  // 继续对话
  const continueTask = useCallback((value: string) => {
    if (!task) return;
    dispatch({
      type: 'UPDATE_TASK',
      payload: {
        query: value,
        title: buildTaskTitle(value),
        status: 'running',
        callStack: [],
        lastAIText: '',
        agentPhase: 'plan',
        agentRound: 0,
        failureCode: '',
        errorMsg: '',
        startedAt: Date.now(),
        endedAt: null,
        durationMs: null,
      },
    });
    dispatch({ type: 'PUSH_INPUT_HISTORY', payload: value });

    Channel.send(
      '__session_continue',
      { sessionId: task.id, query: value },
      (response: any) => {
        if (response?.accepted === false) {
          const message = response?.message?.trim() || '继续对话失败';
          dispatch({
            type: 'UPDATE_TASK',
            payload: {
              status: 'error',
              errorMsg: message,
              failureCode: response?.code || '',
            },
          });
        } else if (response?.accepted === true && response?.sessionId) {
          dispatch({ type: 'UPDATE_TASK', payload: { id: response.sessionId } });
        }
      },
    );
  }, [task, dispatch]);

  // 键盘事件
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    const el = inputRef.current;
    if (!el) return;

    // 上下键历史浏览
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.nativeEvent.isComposing && state.inputHistory.length > 0) {
      e.preventDefault();
      if (e.key === 'ArrowUp') {
        if (state.inputHistoryCursor === -1) {
          dispatch({ type: 'SET_INPUT_CURSOR', payload: { cursor: state.inputHistory.length - 1, draft: el.value } });
        } else if (state.inputHistoryCursor > 0) {
          dispatch({ type: 'SET_INPUT_CURSOR', payload: { cursor: state.inputHistoryCursor - 1, draft: state.inputHistoryDraft } });
        }
      } else {
        if (state.inputHistoryCursor === -1) return;
        if (state.inputHistoryCursor < state.inputHistory.length - 1) {
          dispatch({ type: 'SET_INPUT_CURSOR', payload: { cursor: state.inputHistoryCursor + 1, draft: state.inputHistoryDraft } });
        } else {
          dispatch({ type: 'SET_INPUT_CURSOR', payload: { cursor: -1, draft: '' } });
          el.value = state.inputHistoryDraft;
          return;
        }
      }
      el.value = state.inputHistory[state.inputHistoryCursor === -1 ? state.inputHistory.length - 1 : state.inputHistoryCursor] ?? '';
      return;
    }

    // Enter 提交
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      const value = el.value.trim();
      if (!value || isRunning) return;

      el.value = '';

      if (!task || task.status === 'error') {
        submitNewTask(value);
      } else {
        continueTask(value);
      }
    }
  }, [state, task, isRunning, dispatch, submitNewTask, continueTask]);

  // 终止任务
  const handleStop = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (task?.status === 'running') {
      Channel.send('__ai_cancel', { sessionId: task.id });
    }
    dispatch({ type: 'SET_TASK', payload: null });
  }, [task, dispatch]);

  // 新对话
  const handleNew = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (task) {
      Channel.send('__session_clear', { sessionId: task.id });
    }
    dispatch({ type: 'SET_TASK', payload: null });
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [task, dispatch]);

  // 重试（断点恢复）
  const handleRetry = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!task || task.status !== 'error') return;
    Channel.send('__session_resume', { sessionId: task.id }, (response: any) => {
      if (response?.accepted === false) {
        dispatch({
          type: 'UPDATE_TASK',
          payload: { errorMsg: response?.message || '恢复失败' },
        });
      }
    });
  }, [task, dispatch]);

  // 状态相关的 UI
  const placeholder = (() => {
    if (!task) return '有什么想让我做的？';
    if (isRunning) return task.liveStatusText || `${task.title}...`;
    return '继续对话...';
  })();

  const canResume = task?.status === 'error' && task.hasContext === true && !!task.failureCode;
  const logoUrl = chrome.runtime.getURL('logo.png');

  return (
    <div className="mole-input-row">
      <img className="mole-input-icon" src={logoUrl} alt="" />
      <input
        ref={inputRef}
        className="mole-input"
        type="text"
        placeholder={placeholder}
        autoComplete="off"
        disabled={isRunning}
        onKeyDown={handleKeyDown}
      />
      <span className="mole-input-hint" style={{ display: isRunning ? 'none' : '' }}>ESC</span>
      <button
        className={`mole-new-btn${task && !isRunning ? ' visible' : ''}`}
        title="新对话"
        onClick={handleNew}
      >
        +
      </button>
      <button
        className={`mole-retry-btn${canResume ? ' visible' : ''}`}
        title="重试"
        onClick={handleRetry}
      >
        ↻
      </button>
      <button
        className={`mole-stop-btn${isRunning ? ' visible' : ''}`}
        title="终止任务"
        onClick={handleStop}
      >
        ■
      </button>
    </div>
  );
};
