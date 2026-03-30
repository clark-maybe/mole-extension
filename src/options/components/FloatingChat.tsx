/**
 * Options 页面悬浮对话组件
 * 底部固定输入栏 + 上展结果面板
 * 与 content script 悬浮球完全同步的对话入口
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import Channel from '../../lib/channel';
import type { SessionSyncPayload, SessionReplayPayload, SessionOpQueueSnapshot } from '../../ai/types';
import { escapeHtml, markdownToHtml } from '../../content/float-ball/markdown';
import { FUNCTION_ICONS, FUNCTION_LABELS, LOGO_REQUEST_CONFIRMATION, LOGO_ASK_USER } from '../../content/float-ball/icons';
import {
  formatDuration, formatClock, buildTaskTitle, clipRuntimeText, sanitizeUserFacingRuntimeText,
} from '../../content/float-ball/text-utils';
import { AGENT_PHASE_LABELS, SHOW_AGENT_STATE_PANEL } from '../../content/float-ball/constants';
import './FloatingChat.css';

// ---- 类型 ----

interface TaskItem {
  id: string;
  activeRunId?: string | null;
  query: string;
  title: string;
  status: 'running' | 'done' | 'error';
  resultHtml: string;
  callStack: Array<{ funcName: string; icon: string; text: string; userSummary?: string }>;
  errorMsg: string;
  lastAIText: string;
  agentPhase: string;
  agentRound: number;
  liveStatusText?: string;
  failureCode: string;
  startedAt: number;
  endedAt: number | null;
  durationMs: number | null;
  taskKind?: string;
  opQueue?: SessionOpQueueSnapshot;
  hasContext?: boolean;
}

// ---- 工具函数 ----

/** 解析事件类型兼容 */
const normalizeIncomingEventType = (raw: string): string => {
  if (raw === 'tool_group_start') return 'tool_group_start';
  return raw;
};

/** 解析错误事件内容 */
const parseErrorEventContent = (rawContent: string): { message: string; code: string } => {
  try {
    const parsed = JSON.parse(rawContent);
    if (parsed && typeof parsed.message === 'string') {
      return { message: parsed.message, code: typeof parsed.code === 'string' ? parsed.code : '' };
    }
  } catch { /* 非 JSON */ }
  return { message: rawContent, code: '' };
};

/** 构建工具意图文本 */
const buildToolIntentText = (funcName: string): string => {
  const label = FUNCTION_LABELS[funcName];
  return label || funcName;
};

// ---- 组件 ----

interface FloatingChatProps {
  /** 布局模式：page=独立页面占满内容区，float=底部悬浮（默认） */
  mode?: 'page' | 'float';
}

export function FloatingChat({ mode = 'float' }: FloatingChatProps) {
  const isPageMode = mode === 'page';
  // 状态用 ref 保存，避免闭包陷阱
  const currentTaskRef = useRef<TaskItem | null>(null);
  const replayKnownEventCountRef = useRef(0);
  const replayAppliedEventCountRef = useRef(0);
  const replayLastTimestampRef = useRef(0);
  const isLegacyReplayModeRef = useRef(false);
  const replayActiveRunIdRef = useRef<string | null>(null);
  const replayActiveQueryRef = useRef('');

  // DOM refs
  const resultPanelRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const footerTextRef = useRef<HTMLSpanElement>(null);
  const footerTimeRef = useRef<HTMLSpanElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 强制重渲染（用于 ref 中的状态变化触发 UI 更新）
  const [, setTick] = useState(0);
  const forceUpdate = useCallback(() => setTick(prev => prev + 1), []);

  // ---- DOM 操作函数 ----

  const showResult = useCallback(() => {
    resultPanelRef.current?.classList.add('visible');
  }, []);

  const hideResult = useCallback(() => {
    resultPanelRef.current?.classList.remove('visible');
    if (resultRef.current) resultRef.current.innerHTML = '';
  }, []);

  const appendToResult = useCallback((html: string) => {
    if (!resultRef.current) return;
    resultRef.current.innerHTML += html;
    showResult();
    resultRef.current.scrollTop = resultRef.current.scrollHeight;
  }, [showResult]);

  const saveSnapshot = useCallback(() => {
    const task = currentTaskRef.current;
    if (task && resultRef.current?.innerHTML) {
      task.resultHtml = resultRef.current.innerHTML;
    }
  }, []);

  // ---- 进展面板 ----

  const buildAgentStatePanelMarkup = (): string => `
    <div class="mole-agent-state-title">
      <span class="mole-agent-state-title-main"><span class="arrow">▶</span><span>进展</span></span>
      <span class="mole-agent-state-summary">等待任务开始</span>
    </div>
    <div class="mole-task-runtime-board"></div>
    <div class="mole-agent-state-ops-anchor"></div>
    <div class="mole-agent-state-log"></div>
  `;

  const ensureAgentStatePanel = useCallback((): HTMLElement => {
    const el = resultRef.current;
    if (!el) throw new Error('resultRef 未挂载');
    let panel = el.querySelector('.mole-agent-state-panel:not(.frozen)') as HTMLElement | null;
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'mole-agent-state-panel';
      panel.innerHTML = buildAgentStatePanelMarkup();
      el.appendChild(panel);
      showResult();
    }
    return panel;
  }, [showResult]);

  const renderTaskRuntimeBoard = useCallback(() => {
    const task = currentTaskRef.current;
    const el = resultRef.current;
    if (!el) return;
    const panel = task
      ? ensureAgentStatePanel()
      : el.querySelector('.mole-agent-state-panel:not(.frozen)') as HTMLElement | null;
    const board = panel?.querySelector('.mole-task-runtime-board') as HTMLElement | null;
    const summaryEl = panel?.querySelector('.mole-agent-state-summary') as HTMLElement | null;
    if (!board) return;

    const isRunning = task?.status === 'running';
    const isFinished = task?.status === 'done' || task?.status === 'error';

    if (panel) {
      panel.classList.toggle('is-live', isRunning === true);
      if (isFinished && panel.classList.contains('open')) {
        panel.classList.remove('open');
      }
    }

    // 构建摘要文本
    let summaryText = '等待任务开始';
    if (task) {
      if (task.status === 'done') {
        const duration = task.durationMs ?? (task.endedAt ? Math.max(0, task.endedAt - task.startedAt) : null);
        summaryText = duration !== null ? `已完成 · 耗时 ${formatDuration(duration)}` : '已完成';
      } else if (task.status === 'error') {
        summaryText = task.errorMsg ? clipRuntimeText(task.errorMsg, 46) : '处理失败';
      } else {
        summaryText = clipRuntimeText(
          sanitizeUserFacingRuntimeText(task.liveStatusText || '我正在继续处理，请稍候...', 'current'),
          46,
        ) || '处理中';
      }
    }
    if (summaryEl) summaryEl.textContent = summaryText;

    if (isFinished) {
      board.innerHTML = '';
      return;
    }

    const statusText = sanitizeUserFacingRuntimeText(
      task?.liveStatusText || '我正在继续处理，请稍候...', 'current',
    );
    board.innerHTML = `
      <div class="mole-runtime-now">
        ${isRunning ? '<span class="mole-inline-loader"><span></span><span></span><span></span></span>' : ''}
        <span class="mole-runtime-now-text">${escapeHtml(clipRuntimeText(statusText, 120))}</span>
      </div>
    `;
  }, [ensureAgentStatePanel]);

  // ---- 工具调用折叠组 ----

  const ensureCallsGroup = useCallback((): { summary: HTMLElement; detail: HTMLElement } => {
    const panel = ensureAgentStatePanel();
    const anchor = panel.querySelector('.mole-agent-state-ops-anchor') as HTMLElement | null;
    let group = panel.querySelector('.mole-calls-group:not(.frozen)') as HTMLElement | null;
    if (!group) {
      group = document.createElement('div');
      group.className = 'mole-calls-group mole-agent-state-ops';
      group.innerHTML = `
        <div class="mole-calls-summary">
          <span class="arrow">▶</span>
          <span class="mole-calls-icons"></span>
          <span class="calls-text">查看执行过程</span>
        </div>
        <div class="mole-calls-detail"></div>
      `;
      if (anchor) anchor.appendChild(group);
      else panel.appendChild(group);
      showResult();
    }
    return {
      summary: group.querySelector('.mole-calls-summary')! as HTMLElement,
      detail: group.querySelector('.mole-calls-detail')! as HTMLElement,
    };
  }, [ensureAgentStatePanel, showResult]);

  const updateCallsSummary = useCallback(() => {
    const task = currentTaskRef.current;
    if (!task) return;
    const el = resultRef.current;
    if (!el) return;
    const group = el.querySelector('.mole-agent-state-panel:not(.frozen) .mole-calls-group');
    if (!group) {
      renderTaskRuntimeBoard();
      return;
    }
    const iconsEl = group.querySelector('.mole-calls-icons') as HTMLElement | null;
    const textEl = group.querySelector('.calls-text') as HTMLElement | null;
    const detailEl = group.querySelector('.mole-calls-detail') as HTMLElement | null;
    const uniqueIcons = [...new Set(task.callStack.map(c => c.icon).filter(Boolean))].slice(0, 3);
    if (iconsEl) iconsEl.innerHTML = uniqueIcons.map(src => `<img src="${src}" />`).join('');
    const count = detailEl ? detailEl.querySelectorAll('.mole-call-item').length : 0;
    if (textEl) textEl.textContent = count > 0 ? `查看执行过程 · 共 ${count} 条` : '查看执行过程';
    renderTaskRuntimeBoard();
  }, [renderTaskRuntimeBoard]);

  const appendProcessEntry = useCallback((
    text: string,
    options?: { tone?: string; icon?: string; subtext?: string; callId?: string; dedupe?: boolean },
  ): HTMLElement | null => {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return null;
    const { detail } = ensureCallsGroup();
    const items = Array.from(detail.querySelectorAll('.mole-call-item')) as HTMLElement[];
    const last = items.length > 0 ? items[items.length - 1] : null;
    if (options?.dedupe !== false && last?.getAttribute('data-process-text') === normalized) return last;

    const tone = options?.tone || 'status';
    const icon = options?.icon || '';
    const subtext = String(options?.subtext || '').trim();
    const statusLabel = tone === 'issue' ? '调整中' : tone === 'done' ? '完成' : tone === 'action' ? '执行中' : '处理中';
    const item = document.createElement('div');
    item.className = `mole-call-item tone-${tone}`;
    item.setAttribute('data-process-text', normalized);
    if (options?.callId) item.setAttribute('data-call-id', options.callId);
    item.innerHTML = `
      <div class="mole-call-header">
        ${icon ? `<img class="mole-func-icon" src="${icon}" />` : '<span class="mole-task-runtime-step-dot"></span>'}
        <span class="mole-call-main">
          <span class="mole-call-title">${escapeHtml(normalized)}</span>
          ${subtext ? `<span class="mole-call-intent">${escapeHtml(subtext)}</span>` : ''}
        </span>
        <span class="mole-call-status">${escapeHtml(statusLabel)}</span>
      </div>
      <div class="mole-call-body"></div>
    `;
    detail.appendChild(item);
    while (detail.children.length > 24) detail.removeChild(detail.firstChild as Node);
    updateCallsSummary();
    if (resultRef.current) resultRef.current.scrollTop = resultRef.current.scrollHeight;
    return item;
  }, [ensureCallsGroup, updateCallsSummary]);

  // ---- 状态渲染 ----

  const clearTransientStatus = useCallback(() => {
    resultRef.current?.querySelectorAll('.mole-status, .mole-planning').forEach(el => el.remove());
  }, []);

  const setStatus = useCallback((html: string) => {
    clearTransientStatus();
    const el = resultRef.current;
    if (!el) return;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    while (wrapper.firstChild) el.appendChild(wrapper.firstChild);
    renderTaskRuntimeBoard();
    showResult();
    el.scrollTop = el.scrollHeight;
  }, [clearTransientStatus, renderTaskRuntimeBoard, showResult]);

  const updateAnswer = useCallback((text: string) => {
    const el = resultRef.current;
    if (!el) return;
    let answerEl = el.querySelector('.mole-answer:not(.frozen)');
    if (!answerEl) {
      answerEl = document.createElement('div');
      answerEl.className = 'mole-answer';
      el.appendChild(answerEl);
      showResult();
    }
    answerEl.innerHTML = markdownToHtml(text);
    el.scrollTop = el.scrollHeight;
  }, [showResult]);

  const archiveCurrentRoundView = useCallback((previewQuery?: string) => {
    const el = resultRef.current;
    if (!el) return;
    const looseNodes = Array.from(el.childNodes).filter(
      node => !(node instanceof HTMLElement && node.classList.contains('mole-round-history')),
    );
    if (looseNodes.length === 0) return;

    const prevAnswer = el.querySelector('.mole-answer:not(.frozen)');
    if (prevAnswer) prevAnswer.classList.add('frozen');
    const prevGroup = el.querySelector('.mole-calls-group:not(.frozen)');
    if (prevGroup) prevGroup.classList.add('frozen');
    const prevStatePanel = el.querySelector('.mole-agent-state-panel:not(.frozen)');
    if (prevStatePanel) prevStatePanel.classList.add('frozen');

    const roundHistory = document.createElement('div');
    roundHistory.className = 'mole-round-history';
    const compact = String(previewQuery || '').trim();
    const preview = compact ? (compact.length > 40 ? `${compact.slice(0, 40)}...` : compact) : '历史对话';
    roundHistory.innerHTML = `
      <div class="mole-round-summary">
        <span class="arrow">▶</span>
        <span class="mole-round-preview">${escapeHtml(preview)}</span>
      </div>
      <div class="mole-round-content"></div>
    `;
    const roundContent = roundHistory.querySelector('.mole-round-content')!;
    for (const node of looseNodes) roundContent.appendChild(node);
    el.appendChild(roundHistory);
  }, []);

  // ---- 输入区 UI 状态更新 ----

  const updateInputUI = useCallback(() => {
    const task = currentTaskRef.current;
    const inputEl = inputRef.current;
    const footerText = footerTextRef.current;
    const footerTime = footerTimeRef.current;
    const bar = containerRef.current?.querySelector('.floating-chat-input-bar') as HTMLElement | null;
    if (!bar || !inputEl) return;

    bar.classList.remove('state-idle', 'state-running', 'state-done', 'state-error');
    const newBtn = bar.querySelector('.floating-chat-btn-new') as HTMLElement | null;
    const retryBtn = bar.querySelector('.floating-chat-btn-retry') as HTMLButtonElement | null;
    const stopBtn = bar.querySelector('.floating-chat-btn-stop') as HTMLElement | null;
    const hintEl = bar.querySelector('.floating-chat-hint') as HTMLElement | null;

    if (!task) {
      bar.classList.add('state-idle');
      inputEl.disabled = false;
      inputEl.placeholder = '有什么想让我做的？';
      if (footerText) footerText.textContent = 'Mole · AI 助手';
      if (footerTime) footerTime.textContent = '';
      stopBtn?.classList.remove('visible');
      newBtn?.classList.remove('visible');
      retryBtn?.classList.remove('visible');
      if (hintEl) hintEl.style.display = '';
    } else if (task.status === 'running') {
      bar.classList.add('state-running');
      inputEl.disabled = false;
      const liveProgress = clipRuntimeText(
        sanitizeUserFacingRuntimeText(task.liveStatusText || '我正在继续处理，请稍候...', 'current'),
        28,
      );
      inputEl.placeholder = `${liveProgress || task.title}...`;
      if (footerText) footerText.textContent = liveProgress || '我正在继续处理';
      stopBtn?.classList.add('visible');
      newBtn?.classList.remove('visible');
      retryBtn?.classList.remove('visible');
      if (hintEl) hintEl.style.display = 'none';
    } else {
      bar.classList.add(task.status === 'error' ? 'state-error' : 'state-done');
      inputEl.disabled = false;
      inputEl.placeholder = '继续对话...';
      newBtn?.classList.add('visible');
      const canResume = task.status === 'error' && task.hasContext === true && !!task.failureCode;
      if (canResume) {
        retryBtn?.classList.add('visible');
        if (retryBtn) retryBtn.disabled = false;
      } else {
        retryBtn?.classList.remove('visible');
      }
      stopBtn?.classList.remove('visible');
      if (footerText) {
        footerText.textContent = task.status === 'error'
          ? `处理失败 · ${task.title}${task.failureCode ? ` (${task.failureCode})` : ''}`
          : `已完成 · ${task.title}`;
      }
      if (hintEl) hintEl.style.display = '';
    }

    // 更新耗时
    if (footerTime && task) {
      if (task.status === 'running') {
        const elapsed = Math.max(0, Date.now() - task.startedAt);
        footerTime.textContent = `开始 ${formatClock(task.startedAt)} · 已运行 ${formatDuration(elapsed)}`;
      } else {
        const end = task.endedAt;
        const duration = task.durationMs ?? (end ? Math.max(0, end - task.startedAt) : null);
        const parts: string[] = [];
        if (end) parts.push(`结束 ${formatClock(end)}`);
        if (duration !== null) parts.push(`耗时 ${formatDuration(duration)}`);
        footerTime.textContent = parts.join(' · ');
      }
    } else if (footerTime) {
      footerTime.textContent = '';
    }
  }, []);

  // ---- AI 事件处理 ----

  const updateProcessEntryStatus = useCallback((
    target: Element | null,
    options: { tone?: string; subtext?: string; statusLabel?: string },
  ) => {
    if (!(target instanceof HTMLElement)) return;
    target.classList.remove('tone-status', 'tone-action', 'tone-issue', 'tone-done');
    target.classList.add(`tone-${options.tone || 'status'}`);
    const statusEl = target.querySelector('.mole-call-status');
    if (statusEl) {
      statusEl.textContent = options.statusLabel || (options.tone === 'done' ? '完成' : options.tone === 'issue' ? '失败' : '处理中');
    }
    if (typeof options.subtext === 'string') {
      const subtextEl = target.querySelector('.mole-call-intent');
      if (subtextEl) subtextEl.textContent = options.subtext;
    }
  }, []);

  // 使用 useEffect 设置所有 Channel 监听
  useEffect(() => {
    const resetReplayCursor = () => {
      replayKnownEventCountRef.current = 0;
      replayAppliedEventCountRef.current = 0;
      replayLastTimestampRef.current = 0;
    };

    // ---- handleAIStream: 核心事件分发 ----
    const handleAIStream = (data: any) => {
      if (!data) return;
      const eventId = data.sessionId || data.taskId;
      const task = currentTaskRef.current;
      if (!task || eventId !== task.id) return;

      const rawType = String(data.type || '');
      const type = normalizeIncomingEventType(rawType);
      const content = data.content;
      const el = resultRef.current;
      if (!el) return;

      // ---- Direct handlers ----

      if (type === 'turn_started') {
        try {
          const parsed = JSON.parse(content);
          const parsedRunId = typeof parsed?.runId === 'string' && parsed.runId ? parsed.runId : null;
          const parsedQuery = typeof parsed?.query === 'string' ? parsed.query : '';
          if (isLegacyReplayModeRef.current) {
            const switchedTurn = Boolean(replayActiveRunIdRef.current) && replayActiveRunIdRef.current !== parsedRunId;
            if (switchedTurn) archiveCurrentRoundView(replayActiveQueryRef.current);
            replayActiveRunIdRef.current = parsedRunId;
            replayActiveQueryRef.current = parsedQuery.trim() ? parsedQuery : '';
          }
          if (parsed?.runId) task.activeRunId = parsed.runId;
          if (typeof parsed?.startedAt === 'number') task.startedAt = parsed.startedAt;
          task.status = 'running';
        } catch { /* ignore */ }
        saveSnapshot();
        return;
      }

      if (type === 'turn_completed') {
        try {
          const parsed = JSON.parse(content);
          const status = parsed?.status === 'error' ? 'error' : 'done';
          task.status = status;
          if (typeof parsed?.endedAt === 'number') task.endedAt = parsed.endedAt;
          if (typeof parsed?.durationMs === 'number') task.durationMs = parsed.durationMs;
          if (parsed?.failureCode) task.failureCode = parsed.failureCode;
          if (parsed?.reason) task.errorMsg = parsed.reason;
          if (typeof parsed?.lastAgentMessage === 'string' && parsed.lastAgentMessage.trim()) {
            if (!task.lastAIText) {
              task.lastAIText = parsed.lastAgentMessage;
              updateAnswer(parsed.lastAgentMessage);
            }
          }
        } catch { /* ignore */ }
        renderTaskRuntimeBoard();
        updateInputUI();
        saveSnapshot();
        return;
      }

      if (type === 'turn_aborted') {
        try {
          const parsed = JSON.parse(content);
          if (parsed?.abortReason === 'replaced') {
            // 被新任务替换，不做状态变更
          } else {
            task.status = 'error';
            task.errorMsg = parsed?.reason || '任务已中断';
            task.failureCode = parsed?.failureCode || 'E_CANCELLED';
            if (typeof parsed?.endedAt === 'number') task.endedAt = parsed.endedAt;
            if (typeof parsed?.durationMs === 'number') task.durationMs = parsed.durationMs;
          }
        } catch { /* ignore */ }
        renderTaskRuntimeBoard();
        updateInputUI();
        saveSnapshot();
        return;
      }

      if (type === 'agent_state') {
        try {
          const parsed = JSON.parse(content);
          task.agentPhase = parsed.to || task.agentPhase;
          task.agentRound = typeof parsed.round === 'number' ? parsed.round : task.agentRound;
        } catch { /* ignore */ }
        renderTaskRuntimeBoard();
        if (SHOW_AGENT_STATE_PANEL) {
          // 追加日志
          const logEl = ensureAgentStatePanel().querySelector('.mole-agent-state-log') as HTMLElement | null;
          if (logEl) {
            try {
              const parsed = JSON.parse(content);
              const from = AGENT_PHASE_LABELS[parsed.from] || parsed.from || '未知';
              const to = AGENT_PHASE_LABELS[parsed.to] || parsed.to || '未知';
              const reason = parsed.reason || '';
              const round = typeof parsed.round === 'number' ? parsed.round : 0;
              const item = document.createElement('div');
              item.className = 'mole-agent-state-item';
              item.textContent = `R${round} ${from} → ${to}：${reason}`;
              logEl.appendChild(item);
              while (logEl.children.length > 24) logEl.removeChild(logEl.firstChild as Node);
            } catch { /* ignore */ }
          }
        }
        saveSnapshot();
        return;
      }

      if (type === 'error') {
        const parsedError = parseErrorEventContent(content);
        task.status = 'error';
        task.errorMsg = parsedError.message;
        task.failureCode = parsedError.code || task.failureCode || 'E_UNKNOWN';
        if (!task.endedAt) task.endedAt = Date.now();
        if (task.durationMs == null) task.durationMs = Math.max(0, task.endedAt - task.startedAt);
        appendToResult(`<div class="mole-error">⚠ ${escapeHtml(parsedError.message)}</div>`);
        updateInputUI();
        saveSnapshot();
        return;
      }

      if (type === 'thinking' || type === 'planning') {
        const label = type === 'planning' ? '规划中' : '思考中';
        task.liveStatusText = content || label;
        setStatus(`<div class="mole-planning"><span class="dot"></span>${escapeHtml(content || label)}</div>`);
        saveSnapshot();
        return;
      }

      if (type === 'warning') {
        task.liveStatusText = content || '注意';
        renderTaskRuntimeBoard();
        saveSnapshot();
        return;
      }

      if (type === 'queue_updated') {
        try {
          const payload = JSON.parse(content);
          if (payload?.opQueue && typeof payload.opQueue === 'object') {
            task.opQueue = payload.opQueue as SessionOpQueueSnapshot;
          }
        } catch { /* ignore */ }
        updateInputUI();
        saveSnapshot();
        return;
      }

      if (type === 'thread_rolled_back' || type === 'entered_review_mode' || type === 'exited_review_mode' || type === 'context_compacted') {
        renderTaskRuntimeBoard();
        saveSnapshot();
        return;
      }

      // ---- Stream handlers ----

      if (type === 'tool_group_start') {
        task.liveStatusText = content || '开始执行工具组';
        clearTransientStatus();
        renderTaskRuntimeBoard();
        saveSnapshot();
        return;
      }

      if (type === 'function_call') {
        let funcName = '';
        let callId = '';
        let intentText = '';
        try {
          const parsed = JSON.parse(content);
          funcName = parsed?.name || parsed?.function?.name || '';
          callId = parsed?.call_id || parsed?.id || '';
          intentText = parsed?.intent || '';
        } catch {
          funcName = content;
        }
        const icon = FUNCTION_ICONS[funcName] || '';
        const label = buildToolIntentText(funcName);
        task.liveStatusText = intentText || `正在执行 ${label}`;
        task.callStack.push({ funcName, icon, text: label });

        appendProcessEntry(label, {
          tone: 'action',
          icon,
          subtext: intentText,
          callId,
        });
        clearTransientStatus();
        renderTaskRuntimeBoard();
        saveSnapshot();
        return;
      }

      if (type === 'function_result') {
        let resultCallId = '';
        let resultText = '';
        let resultSuccess = true;
        let resultUserSummary = '';
        try {
          const parsed = JSON.parse(content);
          resultCallId = parsed?.call_id || '';
          resultText = parsed?.output || parsed?.result || '';
          resultSuccess = parsed?.success !== false;
          resultUserSummary = parsed?.userSummary || parsed?.user_summary || '';
        } catch {
          resultText = content;
        }

        // 更新对应的 process entry
        const detailEl = resultRef.current?.querySelector('.mole-calls-detail:not(.frozen .mole-calls-detail)') as HTMLElement | null;
        if (detailEl && resultCallId) {
          const entry = detailEl.querySelector(`[data-call-id="${resultCallId}"]`) as HTMLElement | null;
          if (entry) {
            updateProcessEntryStatus(entry, {
              tone: resultSuccess ? 'done' : 'issue',
              subtext: resultUserSummary || (resultSuccess ? '完成' : '失败'),
              statusLabel: resultSuccess ? '完成' : '失败',
            });
            // 结果内容放到 body
            if (resultText && typeof resultText === 'string' && resultText.length < 500) {
              const body = entry.querySelector('.mole-call-body') as HTMLElement | null;
              if (body) {
                body.textContent = resultText.slice(0, 300);
                entry.querySelector('.mole-call-header')?.classList.add('has-body');
              }
            }
          }
        }
        task.liveStatusText = resultUserSummary || (resultSuccess ? '工具执行完成' : '工具执行失败');
        renderTaskRuntimeBoard();
        updateCallsSummary();
        saveSnapshot();
        return;
      }

      if (type === 'text') {
        task.lastAIText = content;
        clearTransientStatus();
        // 折叠工具调用组
        const activeGroup = el.querySelector('.mole-calls-group:not(.frozen)');
        if (activeGroup) {
          const detailEl2 = activeGroup.querySelector('.mole-calls-detail');
          const arrowEl = activeGroup.querySelector('.arrow');
          if (detailEl2 && detailEl2.classList.contains('open')) {
            detailEl2.classList.remove('open');
            arrowEl?.classList.remove('open');
          }
        }
        updateAnswer(content);
        saveSnapshot();
        return;
      }

      if (type === 'cards') {
        try {
          const cards = JSON.parse(content) as Array<{ title: string; price: string; shop?: string; url: string; tag?: string }>;
          const cardsEl = document.createElement('div');
          cardsEl.className = 'mole-rec-cards';
          for (const card of cards) {
            const metaParts = [`<span class="mole-rec-card-price">${escapeHtml(card.price)}</span>`];
            if (card.shop) metaParts.push(escapeHtml(card.shop));
            const tagHtml = card.tag ? `<span class="mole-rec-tag">${escapeHtml(card.tag)}</span>` : '';
            cardsEl.innerHTML += `
              <a class="mole-rec-card" href="${escapeHtml(card.url)}" target="_blank" rel="noopener">
                <div class="mole-rec-card-body">
                  <div class="mole-rec-card-title">${escapeHtml(card.title)}</div>
                  <div class="mole-rec-card-meta">${metaParts.join(' · ')}</div>
                </div>
                ${tagHtml}
                <span class="mole-rec-arrow">›</span>
              </a>
            `;
          }
          el.appendChild(cardsEl);
          showResult();
          el.scrollTop = el.scrollHeight;
        } catch { /* ignore */ }
        saveSnapshot();
        return;
      }

      if (type === 'search_results') {
        try {
          const data2 = JSON.parse(content);
          const results = data2.results || [];
          if (results.length > 0) {
            const section = document.createElement('div');
            section.className = 'mole-search-section';
            section.innerHTML = `<div class="mole-result-count">找到 ${results.length} 条结果</div>`;
            const list = document.createElement('div');
            list.className = 'mole-search-results';
            for (const r of results.slice(0, 5)) {
              list.innerHTML += `
                <div class="mole-result-card" data-url="${escapeHtml(r.url || '')}">
                  <div class="mole-result-body">
                    <a class="mole-result-title" href="${escapeHtml(r.url || '')}" target="_blank" rel="noopener">${escapeHtml(r.title || '')}</a>
                    <div class="mole-result-snippet">${escapeHtml(r.snippet || r.description || '')}</div>
                    <div class="mole-result-source">${escapeHtml(r.source || r.shop || '')}</div>
                  </div>
                </div>
              `;
            }
            section.appendChild(list);
            el.appendChild(section);
            showResult();
            el.scrollTop = el.scrollHeight;
          }
        } catch { /* ignore */ }
        saveSnapshot();
        return;
      }

      if (type === 'screenshot_data') {
        try {
          const parsed = JSON.parse(content);
          const imgSrc = parsed?.image || parsed?.data || '';
          if (imgSrc) {
            const section = document.createElement('div');
            section.className = 'mole-screenshot-section';
            section.setAttribute('data-image-src', imgSrc);
            section.innerHTML = `
              <div class="mole-screenshot-img-wrap">
                <img class="mole-screenshot-img" src="${imgSrc}" alt="截图" data-full-src="${imgSrc}" />
              </div>
            `;
            el.appendChild(section);
            showResult();
            el.scrollTop = el.scrollHeight;
          }
        } catch { /* ignore */ }
        saveSnapshot();
        return;
      }

      // page_assert_data / page_repair_data 简化处理
      if (type === 'page_assert_data' || type === 'page_repair_data') {
        saveSnapshot();
        return;
      }
    };

    // ---- 确认/提问卡片处理 ----
    const handleApprovalRequest = (data: any) => {
      const requestId = data?.requestId;
      const message = data?.message;
      if (!requestId || !message) return;
      const el = resultRef.current;
      if (!el) return;

      const wrapper = document.createElement('div');
      wrapper.className = 'mole-approval-standalone';
      wrapper.innerHTML = `
        <div class="mole-approval-header-bar">
          <img src="${LOGO_REQUEST_CONFIRMATION}" />
          <span>需要你的确认</span>
        </div>
        <div class="mole-approval-card" data-request-id="${requestId}">
          <div class="mole-approval-message">${escapeHtml(message)}</div>
          <div class="mole-approval-actions">
            <button class="mole-approval-btn approve">批准</button>
            <button class="mole-approval-btn reject">拒绝</button>
            <button class="mole-approval-btn trust-all">本次不再询问</button>
          </div>
          <div class="mole-approval-reject-input">
            <input class="mole-approval-reject-text" placeholder="拒绝理由（可选）" />
            <button class="mole-approval-reject-confirm mole-approval-btn reject">确认拒绝</button>
          </div>
        </div>
      `;
      el.appendChild(wrapper);
      showResult();
      el.scrollTop = el.scrollHeight;
      saveSnapshot();
    };

    const handleApprovalCancel = (data: any) => {
      const requestId = data?.requestId;
      if (!requestId) return;
      const card = resultRef.current?.querySelector(`.mole-approval-card[data-request-id="${requestId}"]`) as HTMLElement;
      if (!card || card.classList.contains('settled')) return;
      card.classList.add('settled');
      card.querySelectorAll('button').forEach(btn => { (btn as HTMLButtonElement).disabled = true; });
      const resultText = document.createElement('div');
      resultText.className = 'mole-approval-result';
      resultText.textContent = '已取消';
      card.appendChild(resultText);
      saveSnapshot();
    };

    // 确认卡片跨标签页同步：用户在其他地方响应后，本页卡片同步更新
    const handleApprovalSettled = (data: any) => {
      const { requestId, approved, trustAll } = data || {};
      if (!requestId) return;
      const card = resultRef.current?.querySelector(`.mole-approval-card[data-request-id="${requestId}"]`) as HTMLElement;
      if (!card || card.classList.contains('settled')) return;
      card.classList.add('settled');
      card.querySelectorAll('button').forEach(btn => { (btn as HTMLButtonElement).disabled = true; });
      const rejectInput = card.querySelector('.mole-approval-reject-input') as HTMLElement;
      if (rejectInput) rejectInput.classList.remove('open');
      const resultText = document.createElement('div');
      resultText.className = 'mole-approval-result';
      resultText.textContent = approved ? '✓ 已批准' : '✗ 已拒绝';
      card.appendChild(resultText);
      const standalone = card.closest('.mole-approval-standalone') as HTMLElement;
      if (standalone) {
        standalone.classList.add('settled');
        const titleEl = standalone.querySelector('.mole-approval-header-bar span') as HTMLElement;
        if (titleEl) titleEl.textContent = trustAll ? '已批准（本次不再询问）' : (approved ? '已批准' : '已拒绝');
      }
      saveSnapshot();
    };

    const handleAskUserRequest = (data: any) => {
      const requestId = data?.requestId;
      const question = data?.question;
      const options = data?.options;
      const allowFreeText = data?.allowFreeText;
      if (!requestId || !question) return;
      const el = resultRef.current;
      if (!el) return;

      const optionsHtml = options && options.length > 0
        ? `<div class="mole-ask-user-options">${options.map((opt: string, idx: number) => `<button class="mole-ask-user-option" data-index="${idx}">${escapeHtml(opt)}</button>`).join('')}</div>`
        : '';
      const inputRowHtml = allowFreeText !== false
        ? `<div class="mole-ask-user-input-row"><input class="mole-ask-user-text" placeholder="${options && options.length > 0 ? '或者直接输入...' : '请输入你的回答...'}" /><button class="mole-ask-user-submit">发送</button></div>`
        : '';

      const wrapper = document.createElement('div');
      wrapper.className = 'mole-ask-user-standalone';
      wrapper.innerHTML = `
        <div class="mole-ask-user-header-bar">
          <img src="${LOGO_ASK_USER}" />
          <span>Mole 有个问题</span>
        </div>
        <div class="mole-ask-user-card" data-request-id="${requestId}">
          <div class="mole-ask-user-question">${escapeHtml(question)}</div>
          ${optionsHtml}
          ${inputRowHtml}
        </div>
      `;
      el.appendChild(wrapper);
      showResult();
      el.scrollTop = el.scrollHeight;
      saveSnapshot();
    };

    const handleAskUserCancel = (data: any) => {
      const requestId = data?.requestId;
      if (!requestId) return;
      const card = resultRef.current?.querySelector(`.mole-ask-user-card[data-request-id="${requestId}"]`) as HTMLElement;
      if (!card || card.classList.contains('settled')) return;
      card.classList.add('settled');
      card.querySelectorAll('button, input').forEach(el2 => { (el2 as HTMLButtonElement).disabled = true; });
      const resultText = document.createElement('div');
      resultText.className = 'mole-ask-user-result';
      resultText.textContent = '已取消';
      card.appendChild(resultText);
      saveSnapshot();
    };

    // 提问卡片跨标签页同步：用户在其他地方回答后，本页卡片同步更新
    const handleAskUserSettled = (data: any) => {
      const { requestId, answer, source } = data || {};
      if (!requestId) return;
      const card = resultRef.current?.querySelector(`.mole-ask-user-card[data-request-id="${requestId}"]`) as HTMLElement;
      if (!card || card.classList.contains('settled')) return;
      card.classList.add('settled');
      card.querySelectorAll('button, input').forEach(el2 => { (el2 as HTMLButtonElement).disabled = true; });
      if (source === 'option') {
        const optionBtns = card.querySelectorAll('.mole-ask-user-option');
        optionBtns.forEach(btn => {
          if (btn.textContent === answer) btn.classList.add('selected');
        });
      }
      const resultText = document.createElement('div');
      resultText.className = 'mole-ask-user-result';
      resultText.textContent = source === 'option' ? `已选择：${answer}` : `已回答：${answer}`;
      card.appendChild(resultText);
      const standalone = card.closest('.mole-ask-user-standalone') as HTMLElement;
      if (standalone) {
        const titleEl = standalone.querySelector('.mole-ask-user-header-bar span') as HTMLElement;
        if (titleEl) titleEl.textContent = '已回答';
      }
      saveSnapshot();
    };

    // ---- 会话同步 ----
    const handleSessionSync = (data: SessionSyncPayload | null | undefined) => {
      if (!data?.sessionId) return;
      const task = currentTaskRef.current;

      if (data.status === 'cleared') {
        if (task && task.id === data.sessionId) {
          currentTaskRef.current = null;
          resetReplayCursor();
          hideResult();
          updateInputUI();
        }
        return;
      }

      if (task && task.id === data.sessionId) {
        if (data.status === 'running' || data.status === 'done' || data.status === 'error') {
          const prevReplayCount = replayKnownEventCountRef.current;
          const targetReplayEventCount = typeof data.replayEventCount === 'number' && data.replayEventCount >= 0
            ? data.replayEventCount : prevReplayCount;
          const shouldRequestDeltaReplay = targetReplayEventCount > replayAppliedEventCountRef.current
            && !task.resultHtml && replayAppliedEventCountRef.current > 0;
          task.status = data.status;
          if (typeof data.activeRunId === 'string' || data.activeRunId === null) task.activeRunId = data.activeRunId;
          if (typeof data.summary === 'string' && data.summary.trim()) task.title = buildTaskTitle(data.summary);
          if (data.agentState) {
            task.agentPhase = data.agentState.phase || task.agentPhase;
            task.agentRound = data.agentState.round || task.agentRound;
          }
          if (typeof data.lastError === 'string' && data.lastError.trim()) task.liveStatusText = data.lastError.trim();
          if (typeof data.startedAt === 'number') task.startedAt = data.startedAt;
          task.endedAt = typeof data.endedAt === 'number' ? data.endedAt : null;
          task.durationMs = typeof data.durationMs === 'number' ? data.durationMs : null;
          task.failureCode = data.failureCode || '';
          if (typeof data.hasContext === 'boolean') task.hasContext = data.hasContext;
          task.taskKind = typeof data.taskKind === 'string' ? data.taskKind : task.taskKind;
          if (data.opQueue && typeof data.opQueue === 'object') task.opQueue = data.opQueue;
          replayKnownEventCountRef.current = targetReplayEventCount;
          if (typeof data.replayLastTimestamp === 'number' && data.replayLastTimestamp > replayLastTimestampRef.current) {
            replayLastTimestampRef.current = data.replayLastTimestamp;
          }
          if (data.lastError) task.errorMsg = data.lastError;
          if (shouldRequestDeltaReplay) {
            Channel.send('__session_replay_request', {
              sessionId: data.sessionId, scope: 'delta', fromEventCount: replayAppliedEventCountRef.current,
            });
          }
          renderTaskRuntimeBoard();
          updateInputUI();
        }
      } else if (!task && data.status === 'running') {
        // 其他标签页发起了新会话，本标签页跟踪
        replayAppliedEventCountRef.current = 0;
        replayLastTimestampRef.current = 0;
        currentTaskRef.current = {
          id: data.sessionId,
          activeRunId: typeof data.activeRunId === 'string' || data.activeRunId === null ? data.activeRunId : null,
          query: data.summary || '',
          title: buildTaskTitle(data.summary || ''),
          status: 'running',
          resultHtml: '',
          callStack: [],
          errorMsg: '',
          lastAIText: '',
          agentPhase: data.agentState?.phase || 'plan',
          agentRound: data.agentState?.round || 0,
          liveStatusText: '',
          failureCode: data.failureCode || '',
          startedAt: typeof data.startedAt === 'number' ? data.startedAt : Date.now(),
          endedAt: typeof data.endedAt === 'number' ? data.endedAt : null,
          durationMs: typeof data.durationMs === 'number' ? data.durationMs : null,
          taskKind: typeof data.taskKind === 'string' ? data.taskKind : '',
          opQueue: data.opQueue && typeof data.opQueue === 'object' ? data.opQueue : undefined,
        };
        replayKnownEventCountRef.current = typeof data.replayEventCount === 'number' && data.replayEventCount >= 0
          ? data.replayEventCount : 0;
        Channel.send('__session_replay_request', { sessionId: data.sessionId, scope: 'latest_turn' });
        renderTaskRuntimeBoard();
        updateInputUI();
      }
    };

    // ---- 事件回放 ----
    const handleSessionReplay = (data: SessionReplayPayload | null | undefined) => {
      if (!data?.sessionId || !Array.isArray(data.events)) return;
      const task = currentTaskRef.current;
      if (!task || data.sessionId !== task.id) return;

      const replayScope = data.scope === 'delta' || data.scope === 'full' ? data.scope : 'latest_turn';
      const baseStart = Number.isFinite(Number(data.fromEventCount)) ? Math.max(0, Math.floor(Number(data.fromEventCount))) : 0;
      const payloadEnd = baseStart + data.events.length;
      const payloadKnownCount = typeof data.eventCount === 'number'
        ? Math.max(payloadEnd, Math.max(0, data.eventCount)) : payloadEnd;

      let replayEvents = data.events.slice();
      let normalizedStart = baseStart;
      if (replayScope === 'delta' && replayAppliedEventCountRef.current > normalizedStart) {
        const skipCount = Math.min(replayEvents.length, replayAppliedEventCountRef.current - normalizedStart);
        replayEvents = replayEvents.slice(skipCount);
        normalizedStart += skipCount;
      }
      if (replayScope === 'delta' && replayEvents.length === 0) {
        replayKnownEventCountRef.current = Math.max(replayKnownEventCountRef.current, payloadKnownCount);
        return;
      }

      const shouldResetView = replayScope !== 'delta';
      if (shouldResetView) {
        hideResult();
        task.callStack = [];
        task.resultHtml = '';
        task.lastAIText = '';
        task.activeRunId = null;
        replayActiveRunIdRef.current = null;
        replayActiveQueryRef.current = '';
      }

      isLegacyReplayModeRef.current = true;
      try {
        for (const event of replayEvents) {
          handleAIStream({ ...event, sessionId: data.sessionId, taskId: data.sessionId });
        }
      } finally {
        isLegacyReplayModeRef.current = false;
        replayActiveRunIdRef.current = null;
        replayActiveQueryRef.current = '';
      }

      if (task && resultRef.current?.innerHTML) {
        task.resultHtml = resultRef.current.innerHTML;
      }

      const appliedEnd = normalizedStart + replayEvents.length;
      replayAppliedEventCountRef.current = shouldResetView ? appliedEnd : Math.max(replayAppliedEventCountRef.current, appliedEnd);
      replayKnownEventCountRef.current = payloadKnownCount;
      const lastAppliedTs = replayEvents.length > 0
        ? Number(replayEvents[replayEvents.length - 1]?.timestamp || 0) : 0;
      replayLastTimestampRef.current = typeof data.lastTimestamp === 'number' && data.lastTimestamp > 0
        ? Math.max(data.lastTimestamp, lastAppliedTs)
        : Math.max(replayLastTimestampRef.current, lastAppliedTs);
      updateInputUI();
    };

    // ---- 注册 Channel 监听 ----
    Channel.on('__ai_stream', handleAIStream);
    Channel.on('__session_sync', handleSessionSync);
    Channel.on('__session_replay', handleSessionReplay);
    Channel.on('__approval_request', handleApprovalRequest);
    Channel.on('__approval_cancel', handleApprovalCancel);
    Channel.on('__approval_settled', handleApprovalSettled);
    Channel.on('__ask_user_request', handleAskUserRequest);
    Channel.on('__ask_user_cancel', handleAskUserCancel);
    Channel.on('__ask_user_settled', handleAskUserSettled);

    // ---- 初始化：恢复活跃会话 ----
    Channel.send('__session_get_active', {}, (response: SessionSyncPayload | null | undefined) => {
      if (response?.sessionId) {
        if (currentTaskRef.current) return;
        currentTaskRef.current = {
          id: response.sessionId,
          activeRunId: typeof response.activeRunId === 'string' || response.activeRunId === null ? response.activeRunId : null,
          query: response.summary || '',
          title: buildTaskTitle(response.summary || ''),
          status: response.status || 'done',
          resultHtml: '',
          callStack: [],
          errorMsg: response.lastError || '',
          lastAIText: '',
          agentPhase: response.agentState?.phase || 'idle',
          agentRound: response.agentState?.round || 0,
          liveStatusText: '',
          failureCode: response.failureCode || '',
          startedAt: typeof response.startedAt === 'number' ? response.startedAt : Date.now(),
          endedAt: typeof response.endedAt === 'number' ? response.endedAt : null,
          durationMs: typeof response.durationMs === 'number' ? response.durationMs : null,
          taskKind: typeof response.taskKind === 'string' ? response.taskKind : '',
          opQueue: response.opQueue && typeof response.opQueue === 'object' ? response.opQueue : undefined,
          hasContext: typeof response.hasContext === 'boolean' ? response.hasContext : undefined,
        };
        replayKnownEventCountRef.current = typeof response.replayEventCount === 'number' && response.replayEventCount >= 0
          ? response.replayEventCount : 0;
        replayAppliedEventCountRef.current = 0;
        replayLastTimestampRef.current = typeof response.replayLastTimestamp === 'number' && response.replayLastTimestamp > 0
          ? response.replayLastTimestamp : 0;
        renderTaskRuntimeBoard();
        updateInputUI();
      }
    });

    // ---- 定时刷新耗时 ----
    const timer = window.setInterval(() => {
      if (currentTaskRef.current?.status === 'running') {
        updateInputUI();
      }
    }, 1000);

    // ---- 清理 ----
    return () => {
      Channel.off('__ai_stream', handleAIStream);
      Channel.off('__session_sync', handleSessionSync);
      Channel.off('__session_replay', handleSessionReplay);
      Channel.off('__approval_request', handleApprovalRequest);
      Channel.off('__approval_cancel', handleApprovalCancel);
      Channel.off('__approval_settled', handleApprovalSettled);
      Channel.off('__ask_user_request', handleAskUserRequest);
      Channel.off('__ask_user_cancel', handleAskUserCancel);
      Channel.off('__ask_user_settled', handleAskUserSettled);
      clearInterval(timer);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Enter 发送 ----
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    const inputEl = inputRef.current;
    if (!inputEl) return;
    const value = inputEl.value.trim();
    if (!value) return;

    const task = currentTaskRef.current;
    if (task?.status === 'running') return;

    inputEl.value = '';

    if (!task || task.status === 'error') {
      // ---- 新任务 ----
      const tempId = Date.now().toString();
      replayKnownEventCountRef.current = 0;
      replayAppliedEventCountRef.current = 0;
      replayLastTimestampRef.current = 0;
      currentTaskRef.current = {
        id: tempId,
        query: value,
        title: buildTaskTitle(value),
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
      };
      hideResult();
      updateInputUI();

      Channel.send('__session_create', { query: value }, (response: any) => {
        const curTask = currentTaskRef.current;
        if (response?.sessionId && curTask && curTask.id === tempId) {
          curTask.id = response.sessionId;
          if (typeof response.summary === 'string' && response.summary.trim()) {
            curTask.title = buildTaskTitle(response.summary);
          }
          return;
        }
        if (curTask && curTask.id === tempId && response?.accepted === false) {
          const message = typeof response?.message === 'string' && response.message.trim()
            ? response.message.trim() : '创建会话失败';
          curTask.status = 'error';
          curTask.errorMsg = message;
          curTask.failureCode = typeof response?.code === 'string' ? response.code : curTask.failureCode;
          appendToResult(`<div class="mole-error">⚠ ${escapeHtml(message)}</div>`);
          updateInputUI();
          saveSnapshot();
        }
      });
    } else {
      // ---- 继续对话 ----
      const previousQuery = task.query;
      replayKnownEventCountRef.current = 0;
      replayAppliedEventCountRef.current = 0;
      replayLastTimestampRef.current = 0;
      task.query = value;
      task.title = buildTaskTitle(value);
      task.status = 'running';
      task.callStack = [];
      task.lastAIText = '';
      task.agentPhase = 'plan';
      task.agentRound = 0;
      task.failureCode = '';
      task.errorMsg = '';
      task.startedAt = Date.now();
      task.endedAt = null;
      task.durationMs = null;

      archiveCurrentRoundView(previousQuery);
      showResult();
      if (resultRef.current) resultRef.current.scrollTop = resultRef.current.scrollHeight;
      saveSnapshot();
      updateInputUI();

      const expectedSessionId = task.id;
      const expectedRunId = task.activeRunId || undefined;
      Channel.send(
        '__session_continue',
        { sessionId: expectedSessionId, expectedSessionId, expectedRunId, query: value },
        (response: any) => {
          const curTask = currentTaskRef.current;
          if (!curTask) return;
          if (response?.accepted === false) {
            if (typeof response.actualSessionId === 'string') curTask.id = response.actualSessionId;
            if (typeof response.actualRunId === 'string' || response.actualRunId === null) curTask.activeRunId = response.actualRunId;
            const message = typeof response?.message === 'string' && response.message.trim()
              ? response.message.trim() : '继续对话失败';
            curTask.status = 'error';
            curTask.errorMsg = message;
            curTask.failureCode = typeof response?.code === 'string' ? response.code : curTask.failureCode;
            appendToResult(`<div class="mole-error">⚠ ${escapeHtml(message)}</div>`);
            updateInputUI();
            saveSnapshot();
          } else if (response?.accepted === true && typeof response.sessionId === 'string') {
            curTask.id = response.sessionId;
            if (typeof response.runId === 'string' || response.runId === null) curTask.activeRunId = response.runId;
          }
        },
      );
    }
  }, [hideResult, showResult, updateInputUI, appendToResult, saveSnapshot, archiveCurrentRoundView]);

  // ---- 终止任务 ----
  const handleStop = useCallback(() => {
    const task = currentTaskRef.current;
    if (task && task.status === 'running') {
      Channel.send('__ai_cancel', { sessionId: task.id });
    }
    currentTaskRef.current = null;
    replayKnownEventCountRef.current = 0;
    replayAppliedEventCountRef.current = 0;
    replayLastTimestampRef.current = 0;
    hideResult();
    updateInputUI();
  }, [hideResult, updateInputUI]);

  // ---- 新对话 ----
  const handleNew = useCallback(() => {
    const task = currentTaskRef.current;
    if (task) {
      Channel.send('__session_clear', { sessionId: task.id });
    }
    currentTaskRef.current = null;
    replayKnownEventCountRef.current = 0;
    replayAppliedEventCountRef.current = 0;
    replayLastTimestampRef.current = 0;
    hideResult();
    updateInputUI();
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [hideResult, updateInputUI]);

  // ---- 重试 ----
  const handleRetry = useCallback(() => {
    const task = currentTaskRef.current;
    if (!task || task.status !== 'error') return;
    const retryBtn = containerRef.current?.querySelector('.floating-chat-btn-retry') as HTMLButtonElement | null;
    if (retryBtn?.disabled) return;
    if (retryBtn) retryBtn.disabled = true;

    Channel.send('__session_resume', { sessionId: task.id }, (response: any) => {
      if (response?.accepted === false) {
        if (retryBtn) retryBtn.disabled = false;
        const message = typeof response?.message === 'string' && response.message.trim()
          ? response.message.trim() : '恢复失败';
        appendToResult(`<div class="mole-error">⚠ ${escapeHtml(message)}</div>`);
        updateInputUI();
      }
    });
  }, [appendToResult, updateInputUI]);

  // ---- 结果区事件委托 ----
  const handleResultClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;

    // 折叠组摘要 toggle
    const summary = target.closest('.mole-calls-summary') as HTMLElement | null;
    if (summary) {
      const group = summary.closest('.mole-calls-group');
      if (group) {
        const dt = group.querySelector('.mole-calls-detail');
        const ar = summary.querySelector('.arrow');
        if (dt) {
          const opened = dt.classList.toggle('open');
          ar?.classList.toggle('open', opened);
        }
      }
      return;
    }

    // 历史对话折叠组 toggle
    const roundSummary = target.closest('.mole-round-summary') as HTMLElement | null;
    if (roundSummary) {
      const roundHistory = roundSummary.closest('.mole-round-history');
      if (roundHistory) {
        const rc = roundHistory.querySelector('.mole-round-content');
        const ar = roundSummary.querySelector('.arrow');
        if (rc) {
          const opened = rc.classList.toggle('open');
          ar?.classList.toggle('open', opened);
        }
      }
      return;
    }

    // 进展面板 toggle
    const agentStateTitle = target.closest('.mole-agent-state-title') as HTMLElement | null;
    if (agentStateTitle) {
      const panel = agentStateTitle.closest('.mole-agent-state-panel');
      if (panel) panel.classList.toggle('open');
      return;
    }

    // 单个函数调用项 toggle
    const header = target.closest('.mole-call-header') as HTMLElement | null;
    if (header && header.classList.contains('has-body')) {
      const item = header.closest('.mole-call-item');
      if (item) {
        const body = item.querySelector('.mole-call-body');
        const ar = header.querySelector('.arrow');
        if (body) {
          const opened = body.classList.toggle('open');
          ar?.classList.toggle('open', opened);
        }
      }
      return;
    }

    // 确认卡片按钮
    const approvalBtn = target.closest('.mole-approval-btn') as HTMLElement | null;
    if (approvalBtn) {
      const card = approvalBtn.closest('.mole-approval-card') as HTMLElement;
      if (!card || card.classList.contains('settled')) return;
      const requestId = card.getAttribute('data-request-id');
      if (!requestId) return;

      const disableCard = (approved: boolean) => {
        card.classList.add('settled');
        card.querySelectorAll('button').forEach(btn => { (btn as HTMLButtonElement).disabled = true; });
        const rejectInput = card.querySelector('.mole-approval-reject-input') as HTMLElement;
        if (rejectInput) rejectInput.classList.remove('open');
        const resultText = document.createElement('div');
        resultText.className = 'mole-approval-result';
        resultText.textContent = approved ? '✓ 已批准' : '✗ 已拒绝';
        card.appendChild(resultText);
        const standalone = card.closest('.mole-approval-standalone') as HTMLElement;
        if (standalone) {
          standalone.classList.add('settled');
          const titleEl = standalone.querySelector('.mole-approval-header-bar span') as HTMLElement;
          if (titleEl) titleEl.textContent = approved ? '已批准' : '已拒绝';
        }
        saveSnapshot();
      };

      if (approvalBtn.classList.contains('trust-all')) {
        Channel.send('__approval_response', { requestId, approved: true, trustAll: true });
        disableCard(true);
        const standalone = card.closest('.mole-approval-standalone') as HTMLElement;
        if (standalone) {
          const titleEl = standalone.querySelector('.mole-approval-header-bar span') as HTMLElement;
          if (titleEl) titleEl.textContent = '已批准（本次不再询问）';
        }
      } else if (approvalBtn.classList.contains('approve')) {
        Channel.send('__approval_response', { requestId, approved: true });
        disableCard(true);
      } else if (approvalBtn.classList.contains('reject') && !approvalBtn.classList.contains('mole-approval-reject-confirm')) {
        const rejectInput = card.querySelector('.mole-approval-reject-input') as HTMLElement;
        if (rejectInput) rejectInput.classList.add('open');
        const textInput = card.querySelector('.mole-approval-reject-text') as HTMLInputElement;
        if (textInput) textInput.focus();
      } else if (approvalBtn.classList.contains('mole-approval-reject-confirm')) {
        const textInput = card.querySelector('.mole-approval-reject-text') as HTMLInputElement;
        const userMessage = textInput?.value?.trim() || '';
        Channel.send('__approval_response', { requestId, approved: false, userMessage });
        disableCard(false);
      }
      return;
    }

    // 提问卡片选项点击
    const askUserOption = target.closest('.mole-ask-user-option') as HTMLElement | null;
    if (askUserOption) {
      const card = askUserOption.closest('.mole-ask-user-card') as HTMLElement;
      if (!card || card.classList.contains('settled')) return;
      const requestId = card.getAttribute('data-request-id');
      if (!requestId) return;
      const answer = askUserOption.textContent || '';
      Channel.send('__ask_user_response', { requestId, answer, source: 'option' });
      card.classList.add('settled');
      card.querySelectorAll('button, input').forEach(el => { (el as HTMLButtonElement).disabled = true; });
      askUserOption.classList.add('selected');
      const resultText = document.createElement('div');
      resultText.className = 'mole-ask-user-result';
      resultText.textContent = `已选择：${answer}`;
      card.appendChild(resultText);
      saveSnapshot();
      return;
    }

    // 提问卡片发送按钮
    const askUserSubmit = target.closest('.mole-ask-user-submit') as HTMLElement | null;
    if (askUserSubmit) {
      const card = askUserSubmit.closest('.mole-ask-user-card') as HTMLElement;
      if (!card || card.classList.contains('settled')) return;
      const requestId = card.getAttribute('data-request-id');
      if (!requestId) return;
      const textInput = card.querySelector('.mole-ask-user-text') as HTMLInputElement;
      const answer = textInput?.value?.trim() || '';
      if (!answer) return;
      Channel.send('__ask_user_response', { requestId, answer, source: 'text' });
      card.classList.add('settled');
      card.querySelectorAll('button, input').forEach(el => { (el as HTMLButtonElement).disabled = true; });
      const resultText = document.createElement('div');
      resultText.className = 'mole-ask-user-result';
      resultText.textContent = `已回答：${answer}`;
      card.appendChild(resultText);
      saveSnapshot();
      return;
    }

    // 搜索结果卡片点击
    if ((target as HTMLElement).tagName === 'A') return;
    const resultCard = target.closest('.mole-result-card') as HTMLElement | null;
    if (resultCard) {
      const url = resultCard.getAttribute('data-url');
      if (url) window.open(url, '_blank');
    }
  }, [saveSnapshot]);

  // ---- 结果区 keydown（确认/提问输入框的 Enter 提交） ----
  const handleResultKeyDown = useCallback((e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (e.key !== 'Enter') return;
    if (target.classList.contains('mole-approval-reject-text')) {
      e.preventDefault();
      const card = target.closest('.mole-approval-card') as HTMLElement;
      if (!card || card.classList.contains('settled')) return;
      const confirmBtn = card.querySelector('.mole-approval-reject-confirm') as HTMLElement;
      if (confirmBtn) confirmBtn.click();
    }
    if (target.classList.contains('mole-ask-user-text')) {
      e.preventDefault();
      const card = target.closest('.mole-ask-user-card') as HTMLElement;
      if (!card || card.classList.contains('settled')) return;
      const submitBtn = card.querySelector('.mole-ask-user-submit') as HTMLElement;
      if (submitBtn) submitBtn.click();
    }
  }, []);

  // ---- ESC 键处理 ----
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const task = currentTaskRef.current;
        if (task) {
          handleNew();
        }
      }
    };
    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, [handleNew]);

  return (
    <div className={`floating-chat-container ${isPageMode ? 'floating-chat-page' : ''}`} ref={containerRef}>
      {/* 输入栏（页面模式放在顶部） */}
      {isPageMode && (
        <div className="floating-chat-input-bar state-idle">
          <img className="floating-chat-logo" src="logo.png" alt="" />
          <input
            ref={inputRef}
            className="floating-chat-input"
            type="text"
            placeholder="有什么想让我做的？"
            autoComplete="off"
            onKeyDown={handleKeyDown}
          />
          <span className="floating-chat-hint">ESC</span>
          <button className="floating-chat-btn floating-chat-btn-new" title="新对话" onClick={handleNew}>+</button>
          <button className="floating-chat-btn floating-chat-btn-retry" title="重试" onClick={handleRetry}>↻</button>
          <button className="floating-chat-btn floating-chat-btn-stop" title="终止任务" onClick={handleStop}>■</button>
        </div>
      )}

      {/* 结果面板 */}
      <div
        ref={resultPanelRef}
        className={`floating-chat-result-panel ${isPageMode ? 'visible' : ''}`}
        onClick={handleResultClick}
        onKeyDown={handleResultKeyDown}
      >
        <div ref={resultRef}></div>
      </div>

      {/* 输入栏（悬浮模式放在底部） */}
      {!isPageMode && (
        <div className="floating-chat-input-bar state-idle">
          <img className="floating-chat-logo" src="logo.png" alt="" />
          <input
            ref={inputRef}
            className="floating-chat-input"
            type="text"
            placeholder="有什么想让我做的？"
            autoComplete="off"
            onKeyDown={handleKeyDown}
          />
          <span className="floating-chat-hint">ESC</span>
          <button className="floating-chat-btn floating-chat-btn-new" title="新对话" onClick={handleNew}>+</button>
          <button className="floating-chat-btn floating-chat-btn-retry" title="重试" onClick={handleRetry}>↻</button>
          <button className="floating-chat-btn floating-chat-btn-stop" title="终止任务" onClick={handleStop}>■</button>
        </div>
      )}

      {/* 状态栏 */}
      <div className="floating-chat-footer">
        <span className="floating-chat-footer-icon">✦</span>
        <span className="floating-chat-footer-text" ref={footerTextRef}>Mole · AI 助手</span>
        <span className="floating-chat-footer-time" ref={footerTimeRef}></span>
      </div>
    </div>
  );
}
