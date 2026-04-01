/**
 * 胶囊球触发器组件
 * 功能：拖拽吸附、hover 展开、状态指示灯、关闭菜单、录制按钮、迷你操作卡片
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { SHORTCUT_TEXT, DISABLED_DOMAINS_KEY } from '../constants';
import { useMole } from '../context/useMole';
import { useDrag } from '../hooks/useDrag';
import { usePosition } from '../hooks/usePosition';
import { useSecondTick } from '../hooks/useGlobalEvents';
import { buildTaskTitle, formatDuration } from '../text-utils';
import Channel from '../../../lib/channel';

/** 迷你操作卡片：悬浮球上方的审批/提问快捷卡 */
const PillActionCard: React.FC<{
  approvalRequest: { requestId: string; message: string } | null;
  askUserRequest: { requestId: string; question: string; options?: string[]; allowFreeText?: boolean } | null;
  dispatch: (action: any) => void;
  enterHover: () => void;
  leaveHover: () => void;
}> = ({ approvalRequest, askUserRequest, dispatch, enterHover, leaveHover }) => {
  const [textInput, setTextInput] = useState('');
  const visible = !!(approvalRequest || askUserRequest);

  const hideSelf = useCallback(() => {
    dispatch({ type: 'SET_APPROVAL_REQUEST', payload: null });
    dispatch({ type: 'SET_ASK_USER_REQUEST', payload: null });
    setTextInput('');
  }, [dispatch]);

  // 审批操作
  const handleApprove = useCallback(() => {
    if (!approvalRequest) return;
    Channel.send('__approval_response', { requestId: approvalRequest.requestId, approved: true });
    hideSelf();
  }, [approvalRequest, hideSelf]);

  const handleReject = useCallback(() => {
    if (!approvalRequest) return;
    Channel.send('__approval_response', { requestId: approvalRequest.requestId, approved: false, userMessage: '' });
    hideSelf();
  }, [approvalRequest, hideSelf]);

  // 提问操作
  const handleOption = useCallback((opt: string) => {
    if (!askUserRequest) return;
    Channel.send('__ask_user_response', { requestId: askUserRequest.requestId, answer: opt, source: 'option' });
    hideSelf();
  }, [askUserRequest, hideSelf]);

  const handleSendText = useCallback(() => {
    if (!askUserRequest || !textInput.trim()) return;
    Channel.send('__ask_user_response', { requestId: askUserRequest.requestId, answer: textInput.trim(), source: 'text' });
    hideSelf();
  }, [askUserRequest, textInput, hideSelf]);

  const clipText = (s: string, max = 40) => s.length > max ? s.slice(0, max) + '...' : s;

  return (
    <div
      className={`mole-pill-action-card${visible ? ' visible' : ''}`}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onMouseEnter={enterHover}
      onMouseLeave={leaveHover}
    >
      {approvalRequest && (
        <div className="pac-body" data-request-id={approvalRequest.requestId} data-type="approval">
          <div className="pac-msg">{clipText(approvalRequest.message)}</div>
          <div className="pac-actions">
            <button className="pac-btn pac-approve" onClick={handleApprove}>批准</button>
            <button className="pac-btn pac-reject" onClick={handleReject}>拒绝</button>
          </div>
        </div>
      )}
      {askUserRequest && !approvalRequest && (
        <div className="pac-body" data-request-id={askUserRequest.requestId} data-type="ask-user">
          <div className="pac-msg">{clipText(askUserRequest.question)}</div>
          {askUserRequest.options && askUserRequest.options.length > 0 && (
            <div className="pac-options">
              {askUserRequest.options.map((opt, idx) => (
                <button key={idx} className="pac-btn pac-option" onClick={() => handleOption(opt)}>{opt}</button>
              ))}
            </div>
          )}
          {askUserRequest.allowFreeText && (
            <div className="pac-input-row">
              <input
                className="pac-text"
                placeholder="输入回答..."
                value={textInput}
                onChange={e => setTextInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleSendText(); }}
              />
              <button className="pac-btn pac-send" onClick={handleSendText}>发送</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const Trigger: React.FC = () => {
  const { state, dispatch } = useMole();
  const { side, currentY, savePosition, getTriggerX } = usePosition();
  const [isHovering, setIsHovering] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoUrl = chrome.runtime.getURL('logo.png');
  const currentHostname = window.location.hostname;

  // 拖拽
  const { triggerRef, onMouseDown } = useDrag({
    getCurrentY: () => currentY,
    onDragStart: () => {
      if (state.isOpen) dispatch({ type: 'TOGGLE_OPEN', payload: false });
    },
    onDragEnd: (newSide, newY) => {
      savePosition({ side: newSide, y: newY });
    },
    onClick: () => {
      dispatch({ type: 'TOGGLE_OPEN' });
    },
  });

  // 同步位置到 DOM（用 ref 直接操作避免频繁 re-render）
  useEffect(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const x = getTriggerX(side);
    trigger.style.left = `${x}px`;
    trigger.style.top = `${currentY}px`;
  }, [side, currentY, getTriggerX, triggerRef]);

  // 启动动画
  useEffect(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    trigger.classList.add('booting');
    const timer = setTimeout(() => trigger.classList.remove('booting'), 640);
    return () => clearTimeout(timer);
  }, [triggerRef]);

  // Hover 管理
  const enterHover = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setIsHovering(true);
  }, []);

  const leaveHover = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      setIsHovering(false);
      hoverTimerRef.current = null;
    }, 200);
  }, []);

  // 同步 hovering class 到 trigger DOM
  useEffect(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    if (isHovering) {
      trigger.classList.add('hovering');
    } else {
      trigger.classList.remove('hovering');
    }
  }, [isHovering, triggerRef]);

  // 关闭菜单
  const handleCloseCurrent = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch({ type: 'TOGGLE_OPEN', payload: false });
    dispatch({ type: 'SET_CLOSE_MENU', payload: false });
    dispatch({ type: 'SET_USER_DISMISSED', payload: true });
    const trigger = triggerRef.current;
    if (trigger) trigger.style.display = 'none';
  }, [dispatch, triggerRef]);

  const handleCloseDomain = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    // 捕获当前页面元数据
    const pageTitle = document.title || '';
    const faviconEl = document.querySelector<HTMLLinkElement>('link[rel*="icon"]');
    const favicon = faviconEl?.href || `https://www.google.com/s2/favicons?domain=${currentHostname}&sz=32`;

    chrome.storage.local.get(DISABLED_DOMAINS_KEY, (result) => {
      const data = result[DISABLED_DOMAINS_KEY] as { domains?: (string | Record<string, unknown>)[] } | undefined;
      const domains = data?.domains || [];
      // 兼容旧数据：检查是否已存在（字符串或对象）
      const exists = domains.some((d) =>
        typeof d === 'string' ? d === currentHostname : (d as any).hostname === currentHostname,
      );
      if (!exists) {
        domains.push({
          hostname: currentHostname,
          title: pageTitle,
          favicon,
          disabledAt: Date.now(),
        });
      }
      chrome.storage.local.set({ [DISABLED_DOMAINS_KEY]: { version: 1, updatedAt: Date.now(), domains } });
    });
    dispatch({ type: 'TOGGLE_OPEN', payload: false });
    dispatch({ type: 'SET_CLOSE_MENU', payload: false });
    dispatch({ type: 'SET_USER_DISMISSED', payload: true });
    const trigger = triggerRef.current;
    if (trigger) trigger.style.display = 'none';
  }, [dispatch, currentHostname, triggerRef]);

  // 设置按钮
  const handleOpenSettings = useCallback(() => {
    // 通过 Channel 发送，但 Channel 的导入在 hooks 里，这里直接 import
    import('../../../lib/channel').then(({ default: Channel }) => {
      Channel.send('__open_options_page', {}, (response?: { success?: boolean }) => {
        if (response?.success) return;
        window.open(chrome.runtime.getURL('options.html'), '_blank');
      });
    });
  }, []);

  // 关闭按钮点击
  const handleCloseClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch({ type: 'SET_CLOSE_MENU', payload: !state.closeMenuVisible });
  }, [dispatch, state.closeMenuVisible]);

  // 稳定的每秒计时器（仅运行中时激活）
  const task = state.currentTask;
  const isTaskRunning = task?.status === 'running';
  useSecondTick(isTaskRunning === true);

  // 状态文本
  const pillState = task ? task.status : 'idle';
  const statusText = task ? buildTaskTitle(task.title || task.query) : '';
  const elapsed = isTaskRunning ? Math.max(0, Date.now() - task.startedAt) : 0;
  const metaText = isTaskRunning
    ? `已运行 ${formatDuration(elapsed)}`
    : `${SHORTCUT_TEXT} 打开`;

  // CSS class 拼接
  const triggerClass = [
    'mole-trigger',
    `side-${side}`,
    state.isOpen ? 'active' : '',
    pillState === 'running' ? 'task-running' : '',
    pillState === 'done' ? 'task-done' : '',
    pillState === 'error' ? 'task-error' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={triggerClass} ref={triggerRef}>
      <div
        className="mole-pill"
        onMouseDown={onMouseDown}
        onMouseEnter={enterHover}
        onMouseLeave={leaveHover}
      >
        <img src={logoUrl} alt="Mole" draggable={false} />
        {(() => {
          const bgCount = (state.bgTasksData?.timers?.length || 0) + (state.bgTasksData?.residentJobs?.length || 0);
          return bgCount > 0
            ? <span className="mole-bg-task-badge visible">{bgCount}</span>
            : <span className="mole-bg-task-badge" />;
        })()}
        <div className="mole-pill-info">
          <span className="mole-shortcut">{statusText}</span>
          <span className="mole-pill-meta">{metaText}</span>
        </div>
        <button
          className="mole-close-btn"
          type="button"
          title="关闭悬浮球"
          aria-label="关闭悬浮球"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={handleCloseClick}
          onMouseEnter={enterHover}
          onMouseLeave={leaveHover}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* 通知气泡 */}
      <div className="mole-pill-notice" />

      {/* 设置按钮 */}
      <button
        className="mole-settings-btn"
        type="button"
        title="打开设置"
        aria-label="打开设置"
        onClick={handleOpenSettings}
        onMouseEnter={enterHover}
        onMouseLeave={leaveHover}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.33 1V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-.33-1A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-.6-1 1.65 1.65 0 0 0-1-.33H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1-.33A1.65 1.65 0 0 0 4.6 8a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 8 4.6a1.65 1.65 0 0 0 1-.6 1.65 1.65 0 0 0 .33-1V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 .33 1 1.65 1.65 0 0 0 1 .6 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 8c0 .39.14.76.4 1.04.28.24.64.36 1 .33H21a2 2 0 1 1 0 4h-.09c-.36-.03-.72.09-1 .33-.26.28-.4.65-.4 1z" />
        </svg>
      </button>

      {/* 录制按钮 */}
      <button
        className="mole-record-btn"
        type="button"
        title="录制流程"
        aria-label="录制流程"
        onMouseEnter={enterHover}
        onMouseLeave={leaveHover}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="6" fill="currentColor" />
        </svg>
      </button>

      {/* 迷你操作卡片 */}
      <PillActionCard
        approvalRequest={state.approvalRequest}
        askUserRequest={state.askUserRequest}
        dispatch={dispatch}
        enterHover={enterHover}
        leaveHover={leaveHover}
      />

      {/* 关闭菜单 */}
      <div
        className={`mole-close-menu${state.closeMenuVisible ? ' visible' : ''}`}
        onMouseEnter={enterHover}
        onMouseLeave={leaveHover}
      >
        <button
          className="mole-close-menu-item"
          type="button"
          onClick={handleCloseCurrent}
        >
          <span className="mole-close-menu-icon">✕</span>
          本次关闭
        </button>
        <div className="mole-close-menu-divider" />
        <button
          className="mole-close-menu-item mole-close-menu-domain"
          type="button"
          onClick={handleCloseDomain}
        >
          <img
            className="mole-close-menu-favicon"
            src={`https://www.google.com/s2/favicons?domain=${currentHostname}&sz=32`}
            alt=""
          />
          <span className="mole-close-menu-domain-info">
            <span className="mole-close-menu-domain-label">不再显示</span>
            <span className="mole-close-menu-domain-host">{currentHostname}</span>
          </span>
        </button>
      </div>
    </div>
  );
};
