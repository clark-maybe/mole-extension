/**
 * Mole 悬浮胶囊模块
 * 胶囊形态贴边微隐藏，hover 滑出露出快捷键提示
 * 点击或快捷键（⌘M / Ctrl+M）弹出全局搜索框
 * 搜索框接入 AI 对话，支持流式响应和函数调用状态展示
 * 使用 Shadow DOM 隔离样式
 */

import Channel from '../lib/channel';
import { SESSION_HISTORY_STORAGE_KEY } from '../session-history/constants';
import type { SessionHistoryRecord } from '../session-history/types';
import type {
  SessionReplayPayload,
  SessionOpQueueSnapshot,
  SessionSyncPayload,
  TaskLifecycleEventPayload,
  TurnLifecycleEventPayload,
} from '../ai/types';
import {
  STORAGE_KEY, DISABLED_DOMAINS_KEY, DRAG_THRESHOLD, PILL_HEIGHT, PILL_WIDTH,
  PILL_COMPACT_WIDTH, LOGO_SIZE, TUCK_OFFSET, EDGE_MARGIN, MAX_RECENT_COMPLETED_TASKS,
  isMac, SHORTCUT_TEXT,
  AGENT_PHASE_LABELS, SHOW_AGENT_STATE_PANEL,
  INTERNAL_STATUS_HINT, INTERNAL_STATUS_LINE_HINT, INTERNAL_STATUS_SEGMENT_HINT,
} from './float-ball/constants';
import type { Side, RuntimeTextMode, RecentCompletedTaskItem, SavedPosition } from './float-ball/constants';
import { FUNCTION_ICONS, FUNCTION_LABELS, LOGO_ASK_USER, LOGO_REQUEST_CONFIRMATION } from './float-ball/icons';
import { getStyles } from './float-ball/styles';
import { escapeHtml, markdownToHtml } from './float-ball/markdown';
import {
  replaceInternalToolTerms, inferFriendlyRuntimeText, sanitizeUserFacingRuntimeText,
  toFriendlyPlanningText, isGenericThinkingText, toLiveActionText, toFriendlyToolProgress,
  formatRecentTaskTime, getRecentTaskStatusLabel, clipIntentText, buildToolIntentText,
  buildUserFacingActionSummary, formatClock, formatDuration, formatQueueLatency,
  formatInterval, clipRuntimeText, buildTaskTitle,
} from './float-ball/text-utils';

const savePosition = (pos: SavedPosition) => {
  try {
    chrome.storage.local.set({ [STORAGE_KEY]: pos });
  } catch { /* 忽略 */ }
};

const loadPosition = (): Promise<SavedPosition | null> => {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(STORAGE_KEY, (result) => {
        resolve(result[STORAGE_KEY] || null);
      });
    } catch {
      resolve(null);
    }
  });
};

// ============ 工具函数 ============

/** 获取可视区域宽度（排除滚动条） */
const getViewportWidth = (): number => document.documentElement.clientWidth;

const getTriggerX = (side: Side): number => {
  if (side === 'left') {
    return -(PILL_WIDTH + 10 - PILL_WIDTH) / 2;
  }
  return getViewportWidth() - PILL_WIDTH - (10 / 2);
};

const clampY = (y: number): number => {
  return Math.max(EDGE_MARGIN, Math.min(y, window.innerHeight - PILL_HEIGHT - EDGE_MARGIN));
};

const determineSide = (triggerX: number): Side => {
  const center = triggerX + (PILL_WIDTH + 10) / 2;
  return center < getViewportWidth() / 2 ? 'left' : 'right';
};

// ============ 初始化 ============

export const initFloatBall = async () => {
  if (!document.body) return;
  if (window.location.protocol === 'chrome:' || window.location.protocol === 'chrome-extension:') return;

  // 域名黑名单检查：如果当前域名已被用户禁用，则不初始化悬浮球
  try {
    const stored = await new Promise<Record<string, unknown>>(resolve => {
      chrome.storage.local.get(DISABLED_DOMAINS_KEY, resolve);
    });
    const disabledData = stored[DISABLED_DOMAINS_KEY] as { domains?: (string | { hostname: string })[] } | undefined;
    if (disabledData && Array.isArray(disabledData.domains)) {
      const h = window.location.hostname;
      const isDisabled = disabledData.domains.some((d) =>
        typeof d === 'string' ? d === h : d.hostname === h,
      );
      if (isDisabled) return;
    }
  } catch {
    // 读取失败时不阻塞初始化
  }

  // Shadow DOM
  const host = document.createElement('div');
  host.id = 'mole-root';
  // 宿主元素固定定位 + 脱离文档流，避免页面滚动条和祖先 transform 影响内部 fixed 子元素
  host.style.cssText = 'position: fixed; top: 0; left: 0; width: 0; height: 0; overflow: visible; z-index: 2147483647; pointer-events: none;';
  const shadow = host.attachShadow({ mode: 'closed' });

  const styleEl = document.createElement('style');
  styleEl.textContent = getStyles();
  shadow.appendChild(styleEl);

  // ---- 胶囊触发器 ----
  const trigger = document.createElement('div');
  trigger.className = 'mole-trigger side-right';

  const pill = document.createElement('div');
  pill.className = 'mole-pill';

  const logo = document.createElement('img');
  logo.src = chrome.runtime.getURL('logo.png');
  logo.alt = 'Mole';
  logo.draggable = false;

  const shortcutEl = document.createElement('span');
  shortcutEl.className = 'mole-shortcut';
  shortcutEl.textContent = '';

  const pillMetaEl = document.createElement('span');
  pillMetaEl.className = 'mole-pill-meta';
  pillMetaEl.textContent = `${SHORTCUT_TEXT} 打开`;

  const pillInfoEl = document.createElement('div');
  pillInfoEl.className = 'mole-pill-info';
  pillInfoEl.appendChild(shortcutEl);
  pillInfoEl.appendChild(pillMetaEl);

  const pillNoticeEl = document.createElement('div');
  pillNoticeEl.className = 'mole-pill-notice';

  const settingsBtn = document.createElement('button');
  settingsBtn.className = 'mole-settings-btn';
  settingsBtn.type = 'button';
  settingsBtn.title = '打开设置';
  settingsBtn.setAttribute('aria-label', '打开设置');
  settingsBtn.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3"></circle>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.33 1V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-.33-1A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-.6-1 1.65 1.65 0 0 0-1-.33H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1-.33A1.65 1.65 0 0 0 4.6 8a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 8 4.6a1.65 1.65 0 0 0 1-.6 1.65 1.65 0 0 0 .33-1V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 .33 1 1.65 1.65 0 0 0 1 .6 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 8c0 .39.14.76.4 1.04.28.24.64.36 1 .33H21a2 2 0 1 1 0 4h-.09c-.36-.03-.72.09-1 .33-.26.28-.4.65-.4 1z"></path>
    </svg>
  `;

  pill.appendChild(logo);

  // 后台任务角标
  const bgTaskBadgeEl = document.createElement('span');
  bgTaskBadgeEl.className = 'mole-bg-task-badge';
  pill.appendChild(bgTaskBadgeEl);

  // ---- 关闭按钮（角标式，内嵌于 pill）----
  const closeBtn = document.createElement('button');
  closeBtn.className = 'mole-close-btn';
  closeBtn.type = 'button';
  closeBtn.title = '关闭悬浮球';
  closeBtn.setAttribute('aria-label', '关闭悬浮球');
  closeBtn.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  `;

  pill.appendChild(pillInfoEl);
  pill.appendChild(closeBtn);
  trigger.appendChild(pill);
  trigger.appendChild(pillNoticeEl);
  trigger.appendChild(settingsBtn);

  // ---- 悬浮球迷你操作卡片（确认/提问，不展开面板即可操作）----
  const pillActionCard = document.createElement('div');
  pillActionCard.className = 'mole-pill-action-card';
  trigger.appendChild(pillActionCard);

  // ---- 关闭菜单 ----
  const currentHostname = window.location.hostname;
  const closeMenuEl = document.createElement('div');
  closeMenuEl.className = 'mole-close-menu';

  const closeMenuItemCurrent = document.createElement('button');
  closeMenuItemCurrent.className = 'mole-close-menu-item';
  closeMenuItemCurrent.type = 'button';
  closeMenuItemCurrent.textContent = '仅当前关闭';

  const closeMenuItemDomain = document.createElement('button');
  closeMenuItemDomain.className = 'mole-close-menu-item';
  closeMenuItemDomain.type = 'button';
  closeMenuItemDomain.textContent = `在 ${currentHostname} 上禁用`;

  closeMenuEl.appendChild(closeMenuItemCurrent);
  closeMenuEl.appendChild(closeMenuItemDomain);
  trigger.appendChild(closeMenuEl);

  // ---- 录制按钮（hover 时在 settingsBtn 旁出现） ----
  const recordBtn = document.createElement('button');
  recordBtn.className = 'mole-record-btn';
  recordBtn.type = 'button';
  recordBtn.title = '录制流程';
  recordBtn.setAttribute('aria-label', '录制流程');
  recordBtn.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="6" fill="currentColor"></circle>
    </svg>
  `;
  trigger.appendChild(recordBtn);

  shadow.appendChild(trigger);

  // ---- 全局搜索框 ----
  const overlay = document.createElement('div');
  overlay.className = 'mole-overlay';

  const searchbox = document.createElement('div');
  searchbox.className = 'mole-searchbox state-idle';

  const logoUrl = chrome.runtime.getURL('logo.png');
  searchbox.innerHTML = `
    <div class="mole-input-row">
      <img class="mole-input-icon" src="${logoUrl}" alt="" />
      <input class="mole-input" type="text" placeholder="有什么想让我做的？" autocomplete="off" />
      <span class="mole-input-hint">ESC</span>
      <button class="mole-new-btn" title="新对话">+</button>
      <button class="mole-retry-btn" title="重试">↻</button>
      <button class="mole-stop-btn" title="终止任务">■</button>
    </div>
    <div class="mole-divider"></div>
    <div class="mole-result"></div>
    <div class="mole-divider mole-divider-bottom"></div>
    <div class="mole-footer">
      <span class="mole-footer-icon">✦</span>
      <span class="mole-footer-text">Mole · AI 助手</span>
      <span class="mole-footer-time"></span>
    </div>
  `;

  overlay.appendChild(searchbox);

  const imageViewerEl = document.createElement('div');
  imageViewerEl.className = 'mole-image-viewer';
  imageViewerEl.innerHTML = `
    <div class="mole-image-viewer-content">
      <button class="mole-image-viewer-close" type="button" aria-label="关闭预览">\u00D7</button>
      <div class="mole-image-viewer-stage">
        <button class="mole-image-viewer-nav prev" type="button" aria-label="上一张">\u2039</button>
        <img class="mole-image-viewer-img" alt="截图预览" />
        <button class="mole-image-viewer-nav next" type="button" aria-label="下一张">\u203A</button>
      </div>
      <div class="mole-image-viewer-meta"></div>
    </div>
  `;
  overlay.appendChild(imageViewerEl);

  shadow.appendChild(overlay);

  const inputEl = searchbox.querySelector('.mole-input') as HTMLInputElement;
  const resultEl = searchbox.querySelector('.mole-result') as HTMLDivElement;
  const footerTextEl = searchbox.querySelector('.mole-footer-text') as HTMLSpanElement;
  const footerTimeEl = searchbox.querySelector('.mole-footer-time') as HTMLSpanElement;
  const dividerBottomEl = searchbox.querySelector('.mole-divider-bottom') as HTMLDivElement;

  // 后台任务面板（插入到 dividerBottom 之前）
  const bgTasksPanelEl = document.createElement('div');
  bgTasksPanelEl.className = 'mole-bg-tasks-panel';
  searchbox.insertBefore(bgTasksPanelEl, dividerBottomEl);

  // ---- 录制状态栏（插入到 footer 之前） ----
  const recorderBarEl = document.createElement('div');
  recorderBarEl.className = 'mole-recorder-bar';
  recorderBarEl.innerHTML = `
    <span class="mole-recorder-bar-dot"></span>
    <span class="mole-recorder-bar-info">录制中 \u00B7 0 步</span>
    <button class="mole-recorder-bar-stop" type="button">停止录制</button>
  `;
  const footerEl = searchbox.querySelector('.mole-footer') as HTMLDivElement;
  searchbox.insertBefore(recorderBarEl, footerEl);

  // ---- 结果标记遮罩已移除（改为对话式确认） ----

  const hintEl = searchbox.querySelector('.mole-input-hint') as HTMLSpanElement;
  const imageViewerCloseEl = imageViewerEl.querySelector('.mole-image-viewer-close') as HTMLButtonElement;
  const imageViewerImgEl = imageViewerEl.querySelector('.mole-image-viewer-img') as HTMLImageElement;
  const imageViewerMetaEl = imageViewerEl.querySelector('.mole-image-viewer-meta') as HTMLDivElement;
  const imageViewerPrevEl = imageViewerEl.querySelector('.mole-image-viewer-nav.prev') as HTMLButtonElement;
  const imageViewerNextEl = imageViewerEl.querySelector('.mole-image-viewer-nav.next') as HTMLButtonElement;
  const newBtn = searchbox.querySelector('.mole-new-btn') as HTMLButtonElement;
  const retryBtn = searchbox.querySelector('.mole-retry-btn') as HTMLButtonElement;
  const stopBtn = searchbox.querySelector('.mole-stop-btn') as HTMLButtonElement;

  // ---- "定位到任务页签" 按钮（非发起页签时显示） ----
  const focusTabBtn = document.createElement('button');
  focusTabBtn.className = 'mole-focus-tab-btn';
  focusTabBtn.type = 'button';
  focusTabBtn.title = '定位到任务页签';
  focusTabBtn.textContent = '定位到任务页签';
  focusTabBtn.style.display = 'none';
  // 插入到 input-row 中
  const inputRow = searchbox.querySelector('.mole-input-row');
  if (inputRow) inputRow.appendChild(focusTabBtn);

  focusTabBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (typeof sessionOriginTabId === 'number') {
      Channel.send('__session_focus_tab', { tabId: sessionOriginTabId });
    }
  });

  // ---- 插入页面 ----
  document.body.appendChild(host);

  // ---- DOM 保护：MutationObserver 兜底 ----
  // 当 host 元素被意外从 DOM 中移除时（如 AI 工具操作 innerHTML），自动重新插入
  // 用户主动关闭时设置标志位，不再自动恢复
  let userDismissed = false;
  const bodyObserver = new MutationObserver(() => {
    if (!host.isConnected && !userDismissed) {
      document.body.appendChild(host);
    }
  });
  bodyObserver.observe(document.body, { childList: true });

  // ---- 视口代理：修复 position: fixed 在祖先有 transform/will-change/filter 时失效 ----
  // 内部元素全部使用 position: absolute（相对于 host），
  // 通过 JS 持续将 host 补偿到视口原点 (0, 0)，确保在任何页面上都能正常固定显示
  let _compensateRAF = 0;
  const compensateHostPosition = () => {
    const rect = host.getBoundingClientRect();
    const offsetX = Math.round(rect.left);
    const offsetY = Math.round(rect.top);
    if (offsetX !== 0 || offsetY !== 0) {
      const curLeft = parseFloat(host.style.left) || 0;
      const curTop = parseFloat(host.style.top) || 0;
      host.style.left = `${curLeft - offsetX}px`;
      host.style.top = `${curTop - offsetY}px`;
    }
  };
  window.addEventListener('scroll', () => {
    cancelAnimationFrame(_compensateRAF);
    _compensateRAF = requestAnimationFrame(compensateHostPosition);
  }, { passive: true });
  // 首帧检测
  requestAnimationFrame(compensateHostPosition);

  // ---- 状态 ----
  interface TaskItem {
    id: string;           // sessionId（由 background 生成）
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
    /** 会话是否有可恢复的上下文 */
    hasContext?: boolean;
  }

  interface TabTakeoverState {
    active: boolean;
    label: string;
    expiresAt: number;
    source?: string;
    workflow?: string;
  }

  let isDragging = false;
  let isOpen = false;
  let currentTask: TaskItem | null = null;
  let recentCompletedTasks: RecentCompletedTaskItem[] = [];
  let side: Side = 'right';
  let currentY = 0;
  let startMouseX = 0;
  let startMouseY = 0;
  let startTriggerX = 0;
  let startTriggerY = 0;
  let pillNoticeTimer: number | null = null;
  let pillAnnounceTimer: number | null = null;
  let lastPillState: 'idle' | 'running' | 'done' | 'error' = 'idle';
  let lastPillTaskId = '';
  let isLegacyReplayMode = false;
  let replayActiveRunId: string | null = null;
  let replayActiveQuery = '';
  let replayKnownEventCount = 0;
  let replayAppliedEventCount = 0;
  let replayLastTimestamp = 0;
  let tabTakeoverState: TabTakeoverState | null = null;
  /** 本标签页的 tabId（通过 __get_tab_info 获取） */
  let selfTabId: number | null = null;
  /** 当前会话发起页签的 tabId（从 session_sync 中获取） */
  let sessionOriginTabId: number | undefined = undefined;
  /** 后台任务数据（定时器 + 常驻任务） */
  let bgTasksData: { timers: any[]; residentJobs: any[] } | null = null;

  // ---- 输入历史 ----
  const INPUT_HISTORY_KEY = 'mole_input_history';
  const INPUT_HISTORY_MAX = 50;
  let inputHistory: string[] = [];        // 持久化的历史记录
  let inputHistoryCursor = -1;            // 当前浏览位置，-1 表示在最新输入
  let inputHistoryDraft = '';             // 暂存用户当前正在输入的内容

  // 从 storage 加载历史记录
  chrome.storage.local.get(INPUT_HISTORY_KEY, (result) => {
    const saved = result[INPUT_HISTORY_KEY];
    if (Array.isArray(saved)) inputHistory = saved;
  });

  /** 将一条输入追加到历史并持久化 */
  const pushInputHistory = (text: string) => {
    // 去重：如果最新一条相同则不重复添加
    if (inputHistory.length > 0 && inputHistory[inputHistory.length - 1] === text) return;
    inputHistory.push(text);
    if (inputHistory.length > INPUT_HISTORY_MAX) inputHistory.shift();
    chrome.storage.local.set({ [INPUT_HISTORY_KEY]: inputHistory });
  };

  /** 重置历史浏览状态 */
  const resetInputHistoryCursor = () => {
    inputHistoryCursor = -1;
    inputHistoryDraft = '';
  };

  // ---- 工作流录制状态 ----
  let isRecording = false;
  let recorderStepCount = 0;
  let recorderStartedAt = 0;
  let isRecorderAuditing = false;

  // 初始化时获取自身 tabId
  Channel.send('__get_tab_info', {}, (tabInfo: any) => {
    if (tabInfo && typeof tabInfo.id === 'number') {
      selfTabId = tabInfo.id;
    }
  });

  const resetReplayCursor = () => {
    replayKnownEventCount = 0;
    replayAppliedEventCount = 0;
    replayLastTimestamp = 0;
  };

  /** 判断当前页签是否为非发起页签（需要限制交互） */
  const isNonOriginTab = (): boolean => {
    // originTabId 为 undefined 时不做限制（兼容旧会话）
    if (sessionOriginTabId === undefined) return false;
    // selfTabId 还没获取到时不做限制
    if (selfTabId === null) return false;
    return selfTabId !== sessionOriginTabId;
  };

  interface ReplayRunSnapshotItem {
    sessionId: string;
    runId: string;
    html: string;
    eventCount: number;
    lastTimestamp: number;
  }

  const MAX_REPLAY_RUN_CACHE = 8;
  const replayRunSnapshotCache = new Map<string, ReplayRunSnapshotItem>();
  let replayCacheSessionId = '';

  const ensureReplayCacheSession = (sessionId: string) => {
    if (!sessionId) return;
    if (replayCacheSessionId === sessionId) return;
    replayRunSnapshotCache.clear();
    replayCacheSessionId = sessionId;
  };

  const clearReplayCache = () => {
    replayRunSnapshotCache.clear();
    replayCacheSessionId = '';
  };

  const extractReplayPayloadRunId = (events: Array<{ type?: string; content?: string }>): string => {
    if (!Array.isArray(events) || events.length === 0) return '';
    for (let index = events.length - 1; index >= 0; index--) {
      const event = events[index];
      if (event?.type !== 'turn_started') continue;
      try {
        const parsed = JSON.parse(String(event.content || ''));
        const runId = typeof parsed?.runId === 'string' ? parsed.runId.trim() : '';
        if (runId) return runId;
      } catch {
        // ignore malformed payload
      }
    }
    for (let index = events.length - 1; index >= 0; index--) {
      const event = events[index];
      if (event?.type !== 'turn_completed' && event?.type !== 'turn_aborted') continue;
      try {
        const parsed = JSON.parse(String(event.content || ''));
        const runId = typeof parsed?.runId === 'string' ? parsed.runId.trim() : '';
        if (runId) return runId;
      } catch {
        // ignore malformed payload
      }
    }
    return '';
  };

  const storeReplayRunSnapshot = (runId: string | null | undefined, eventCount: number, lastTimestamp: number) => {
    if (!currentTask) return;
    const normalizedRunId = String(runId || '').trim();
    const html = resultEl.innerHTML;
    if (!normalizedRunId || !html) return;
    ensureReplayCacheSession(currentTask.id);
    replayRunSnapshotCache.set(normalizedRunId, {
      sessionId: currentTask.id,
      runId: normalizedRunId,
      html,
      eventCount: Math.max(0, eventCount),
      lastTimestamp: Math.max(0, lastTimestamp),
    });
    while (replayRunSnapshotCache.size > MAX_REPLAY_RUN_CACHE) {
      const oldestKey = replayRunSnapshotCache.keys().next().value;
      if (!oldestKey) break;
      replayRunSnapshotCache.delete(oldestKey);
    }
  };

  const tryApplyReplayRunSnapshot = (payload: SessionReplayPayload): boolean => {
    if (!currentTask) return false;
    if (payload.scope === 'delta') return false;
    const runId = extractReplayPayloadRunId(payload.events) || String(currentTask.activeRunId || '').trim();
    if (!runId) return false;
    ensureReplayCacheSession(currentTask.id);
    const cached = replayRunSnapshotCache.get(runId);
    if (!cached) return false;
    const payloadEnd = Math.max(0, Number(payload.fromEventCount || 0) + payload.events.length);
    const targetCount = Number.isFinite(Number(payload.eventCount))
      ? Math.max(payloadEnd, Math.max(0, Number(payload.eventCount)))
      : payloadEnd;
    const targetTimestamp = Number.isFinite(Number(payload.lastTimestamp))
      ? Math.max(0, Number(payload.lastTimestamp))
      : 0;
    if (targetCount > cached.eventCount) return false;
    if (targetTimestamp > 0 && targetTimestamp > cached.lastTimestamp) return false;

    resultEl.innerHTML = cached.html;
    currentTask.resultHtml = cached.html;
    currentTask.activeRunId = runId;
    showResult();
    replayAppliedEventCount = targetCount;
    replayKnownEventCount = Math.max(targetCount, replayKnownEventCount);
    replayLastTimestamp = targetTimestamp > 0
      ? targetTimestamp
      : Math.max(replayLastTimestamp, cached.lastTimestamp);
    return true;
  };

  const openOptionsPage = () => {
    Channel.send('__open_options_page', {}, (response?: { success?: boolean }) => {
      if (response?.success) return;
      window.open(chrome.runtime.getURL('options.html'), '_blank');
    });
  };

  const getTaskTitle = (task: TaskItem | null): string => {
    if (!task) return '';
    return buildTaskTitle(task.title || task.query);
  };

  const isTakeoverActive = (): boolean => {
    if (!tabTakeoverState?.active) return false;
    if (tabTakeoverState.expiresAt <= Date.now()) {
      tabTakeoverState = null;
      return false;
    }
    return true;
  };

  const getTakeoverLabel = (): string => {
    if (!isTakeoverActive()) return '';
    return buildTaskTitle(tabTakeoverState?.label || 'AI 接管中');
  };

  const getTakeoverMetaText = (): string => {
    if (!isTakeoverActive()) return '';
    if (tabTakeoverState?.source === 'plan_execution') {
      return '当前页 AI 正在执行任务';
    }
    return '当前页由 AI 接管中';
  };

  const getTakeoverNoticeText = (): string => {
    const label = getTakeoverLabel();
    if (!label) return '';
    if (tabTakeoverState?.source === 'plan_execution') {
      return `${label} · 执行中`;
    }
    return `${label} · 已接管`;
  };


  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[SESSION_HISTORY_STORAGE_KEY]) return;
    loadRecentCompletedTasks();
  });

  const applyTakeoverStatePayload = (data: any): boolean => {
    if (!data || typeof data !== 'object') return false;
    const active = data.active !== false;
    if (!active) {
      const hadState = Boolean(tabTakeoverState);
      tabTakeoverState = null;
      return hadState;
    }
    const label = String(data.label || 'AI 接管中').trim() || 'AI 接管中';
    const ttlRaw = Number(data.expiresInMs);
    const ttlMs = Number.isFinite(ttlRaw)
      ? Math.max(5_000, Math.min(10 * 60_000, Math.floor(ttlRaw)))
      : 120_000;
    tabTakeoverState = {
      active: true,
      label,
      expiresAt: Date.now() + ttlMs,
      source: typeof data.source === 'string' ? data.source : undefined,
      workflow: typeof data.workflow === 'string' ? data.workflow : undefined,
    };
    return true;
  };

  const loadRecentCompletedTasks = () => {
    chrome.storage.local.get(SESSION_HISTORY_STORAGE_KEY, (result) => {
      const historyRaw = result?.[SESSION_HISTORY_STORAGE_KEY];
      const history = Array.isArray(historyRaw) ? historyRaw as SessionHistoryRecord[] : [];
      recentCompletedTasks = history
        .filter((item) => item && typeof item === 'object' && item.status !== 'running')
        .map((item) => ({
          sessionId: String(item.sessionId || '').trim(),
          title: buildTaskTitle(item.summary || item.assistantReply || '历史任务'),
          status: String(item.status || 'done'),
          updatedAt: Number(item.updatedAt || item.endedAt || item.startedAt || 0),
        }))
        .filter((item) => item.sessionId && item.title)
        .slice(0, MAX_RECENT_COMPLETED_TASKS + 2);
      renderTaskRuntimeBoard();
    });
  };

  const parseTaskLifecycleContent = (rawContent: string): TaskLifecycleEventPayload => {
    try {
      const parsed = JSON.parse(rawContent);
      if (parsed && typeof parsed === 'object') {
        const message = typeof parsed.message === 'string'
          ? parsed.message
          : (isLegacyReplayMode && typeof parsed.text === 'string' ? parsed.text : '');
        const reviewOutput = parsed.reviewOutput && typeof parsed.reviewOutput === 'object'
          ? parsed.reviewOutput
          : (isLegacyReplayMode && parsed.review_output && typeof parsed.review_output === 'object'
            ? parsed.review_output
            : null);
        const compactSummary = typeof parsed.compactSummary === 'string'
          ? parsed.compactSummary
          : (isLegacyReplayMode && typeof parsed.compact_summary === 'string' ? parsed.compact_summary : '');
        const assistantReply = typeof parsed.assistantReply === 'string'
          ? parsed.assistantReply
          : (isLegacyReplayMode && typeof parsed.reply === 'string' ? parsed.reply : '');
        const failureCode = typeof parsed.failureCode === 'string' ? parsed.failureCode : '';
        const reason = typeof parsed.reason === 'string' ? parsed.reason : '';
        return {
          message,
          taskKind: typeof parsed.taskKind === 'string' ? parsed.taskKind : '',
          runId: typeof parsed.runId === 'string' ? parsed.runId : null,
          status: parsed.status === 'running' || parsed.status === 'done' || parsed.status === 'error' || parsed.status === 'cleared'
            ? parsed.status
            : 'running',
          phase: parsed.phase === 'entered' || parsed.phase === 'exited' ? parsed.phase : 'exited',
          timestamp: typeof parsed.timestamp === 'number' ? parsed.timestamp : Date.now(),
          reviewOutput,
          compactSummary,
          assistantReply,
          failureCode,
          reason,
        };
      }
    } catch {
      // ignore malformed payload
    }
    return {
      message: isLegacyReplayMode ? String(rawContent || '').trim() : '',
      taskKind: '',
      runId: null,
      status: 'running',
      phase: 'exited',
      timestamp: Date.now(),
      reviewOutput: null,
      compactSummary: '',
      assistantReply: '',
      failureCode: '',
      reason: '',
    };
  };

  const parseFunctionCallEvent = (raw: string): { name: string; summary: string; callId: string } => {
    try {
      const parsed = JSON.parse(raw || '{}');
      if (parsed && typeof parsed.name === 'string') {
        return {
          name: parsed.name,
          summary: clipIntentText(parsed.summary || ''),
          callId: typeof parsed.callId === 'string' ? parsed.callId : '',
        };
      }
    } catch {
      // legacy text payload fallback
    }

    if (!isLegacyReplayMode) {
      return {
        name: '',
        summary: '',
        callId: '',
      };
    }

    const funcMatch = String(raw || '').match(/正在调用\s+(\w+)/);
    return {
      name: funcMatch ? funcMatch[1] : '',
      summary: '',
      callId: '',
    };
  };

  const parseFunctionResultEvent = (raw: string): { callId: string; success: boolean; message: string; cancelled: boolean } => {
    try {
      const parsed = JSON.parse(raw || '{}');
      if (parsed && typeof parsed === 'object') {
        return {
          callId: typeof parsed.callId === 'string' ? parsed.callId : '',
          success: parsed.success !== false,
          message: typeof parsed.message === 'string' ? parsed.message : '',
          cancelled: parsed.cancelled === true,
        };
      }
    } catch {
      // fallback
    }
    if (!isLegacyReplayMode) {
      return {
        callId: '',
        success: false,
        message: '',
        cancelled: false,
      };
    }

    return {
      callId: '',
      success: !String(raw || '').includes('出错'),
      message: String(raw || ''),
      cancelled: String(raw || '').includes('取消'),
    };
  };

  const parseTurnLifecycleEvent = (
    raw: string,
    fallbackStatus: 'done' | 'error',
  ): TurnLifecycleEventPayload => {
    try {
      const parsed = JSON.parse(raw || '{}');
      if (parsed && typeof parsed === 'object') {
        const hasErrorHint = typeof parsed.failureCode === 'string'
          || typeof parsed.reason === 'string'
          || parsed.abortReason === 'interrupted'
          || parsed.abortReason === 'replaced';
        const status = parsed.status === 'done' || parsed.status === 'error' || parsed.status === 'running'
          ? parsed.status
          : (hasErrorHint ? 'error' : fallbackStatus);
        return {
          sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : undefined,
          runId: typeof parsed.runId === 'string' && parsed.runId.trim() ? parsed.runId : null,
          endedAt: typeof parsed.endedAt === 'number' ? parsed.endedAt : Date.now(),
          durationMs: typeof parsed.durationMs === 'number' ? parsed.durationMs : 0,
          taskKind: typeof parsed.taskKind === 'string' ? parsed.taskKind : undefined,
          status,
          failureCode: typeof parsed.failureCode === 'string' ? parsed.failureCode : undefined,
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
          lastAgentMessage: typeof parsed.lastAgentMessage === 'string' ? parsed.lastAgentMessage : undefined,
          abortReason: parsed.abortReason === 'interrupted' || parsed.abortReason === 'replaced'
            ? parsed.abortReason
            : undefined,
        };
      }
    } catch {
      // fallback
    }
    return {
      runId: null,
      endedAt: Date.now(),
      durationMs: 0,
      status: fallbackStatus,
    };
  };

  const bindActiveRun = (runId: string | null): boolean => {
    if (!runId) return true;
    if (currentTask?.activeRunId && runId !== currentTask.activeRunId) return false;
    if (currentTask && !currentTask.activeRunId) {
      currentTask.activeRunId = runId;
    }
    return true;
  };

  const resolveTurnDuration = (endedAt: number, durationMs: number): number => {
    if (durationMs > 0) return durationMs;
    return Math.max(0, endedAt - (currentTask?.startedAt || Date.now()));
  };

  const applyTurnLifecycleToTask = (lifecycle: TurnLifecycleEventPayload): { ignored: boolean; isError: boolean } => {
    const task = currentTask;
    if (!task) return { ignored: true, isError: false };
    if (!bindActiveRun(lifecycle.runId)) {
      return { ignored: true, isError: false };
    }
    const isError = lifecycle.status === 'error';
    task.status = isError ? 'error' : 'done';
    if (isError) {
      task.failureCode = lifecycle.failureCode || task.failureCode || 'E_UNKNOWN';
      task.errorMsg = lifecycle.reason || task.errorMsg || '当前处理已结束';
    } else {
      const reply = (lifecycle.lastAgentMessage || '').trim();
      if (reply) {
        task.lastAIText = reply;
      }
    }
    task.endedAt = lifecycle.endedAt || Date.now();
    task.durationMs = resolveTurnDuration(task.endedAt, lifecycle.durationMs);
    return { ignored: false, isError };
  };

  const applyTaskLifecycleToTask = (lifecycle: TaskLifecycleEventPayload): boolean => {
    const task = currentTask;
    if (!task) return false;
    if (!bindActiveRun(lifecycle.runId)) return false;
    if (lifecycle.taskKind) {
      task.taskKind = lifecycle.taskKind;
    }
    if (lifecycle.status === 'error') {
      task.status = 'error';
      if (lifecycle.failureCode) task.failureCode = lifecycle.failureCode;
      if (lifecycle.reason) task.errorMsg = lifecycle.reason;
    }
    if ((lifecycle.compactSummary || '').trim()) {
      task.lastAIText = lifecycle.compactSummary!.trim();
    }
    if ((lifecycle.assistantReply || '').trim()) {
      task.lastAIText = lifecycle.assistantReply!.trim();
    }
    return true;
  };

  interface ScreenshotPreviewItem {
    src: string;
    meta: string;
  }

  let screenshotPreviewList: ScreenshotPreviewItem[] = [];
  let screenshotPreviewIndex = -1;

  const normalizeIncomingEventType = (rawType: string): string => {
    if (!isLegacyReplayMode) return rawType;
    const legacyTypeMap: Record<string, string> = {
      done: 'text',
      review_mode_started: 'entered_review_mode',
      review_mode_completed: 'exited_review_mode',
      compact_mode_completed: 'context_compacted',
    };
    return legacyTypeMap[rawType] || rawType;
  };

  const refreshImageViewerNav = () => {
    const hasMultiple = screenshotPreviewList.length > 1;
    imageViewerPrevEl.disabled = !hasMultiple;
    imageViewerNextEl.disabled = !hasMultiple;
    imageViewerPrevEl.style.visibility = hasMultiple ? 'visible' : 'hidden';
    imageViewerNextEl.style.visibility = hasMultiple ? 'visible' : 'hidden';
  };

  const renderImageViewer = () => {
    if (screenshotPreviewIndex < 0 || screenshotPreviewIndex >= screenshotPreviewList.length) {
      closeImageViewer();
      return;
    }

    const current = screenshotPreviewList[screenshotPreviewIndex];
    imageViewerImgEl.src = current.src;
    imageViewerMetaEl.textContent = screenshotPreviewList.length > 1
      ? `${current.meta} · ${screenshotPreviewIndex + 1}/${screenshotPreviewList.length}`
      : current.meta;
    refreshImageViewerNav();
    imageViewerEl.classList.add('open');
  };

  const previewNextImage = (step: number) => {
    if (screenshotPreviewList.length <= 1) return;
    const total = screenshotPreviewList.length;
    screenshotPreviewIndex = (screenshotPreviewIndex + step + total) % total;
    renderImageViewer();
  };

  const closeImageViewer = () => {
    imageViewerEl.classList.remove('open');
    imageViewerImgEl.removeAttribute('src');
    imageViewerMetaEl.textContent = '';
    screenshotPreviewList = [];
    screenshotPreviewIndex = -1;
  };

  const openImageViewer = (list: ScreenshotPreviewItem[], startIndex: number) => {
    if (!list.length) return;
    screenshotPreviewList = list;
    screenshotPreviewIndex = Math.max(0, Math.min(startIndex, list.length - 1));
    renderImageViewer();
  };

  imageViewerCloseEl.addEventListener('click', (event) => {
    event.preventDefault();
    closeImageViewer();
  });

  imageViewerPrevEl.addEventListener('click', (event) => {
    event.preventDefault();
    previewNextImage(-1);
  });

  imageViewerNextEl.addEventListener('click', (event) => {
    event.preventDefault();
    previewNextImage(1);
  });

  imageViewerEl.addEventListener('mousedown', (event) => {
    if (event.target === imageViewerEl) {
      closeImageViewer();
    }
  });

  // ---- 加载位置 ----
  const saved = await loadPosition();
  side = saved?.side || 'right';
  currentY = saved ? clampY(saved.y) : window.innerHeight - PILL_HEIGHT - 100;

  const applySideClass = () => {
    trigger.classList.remove('side-left', 'side-right');
    trigger.classList.add(`side-${side}`);
  };

  const applyPosition = () => {
    const x = getTriggerX(side);
    trigger.style.left = `${x}px`;
    trigger.style.top = `${currentY}px`;
    applySideClass();
  };

  applyPosition();
  trigger.classList.add('booting');
  window.setTimeout(() => trigger.classList.remove('booting'), 640);

  loadRecentCompletedTasks();

  const clearPillNotice = () => {
    trigger.classList.remove('notice-visible');
    pillNoticeEl.textContent = '';
    pillNoticeEl.className = 'mole-pill-notice';
  };

  const showPillNotice = (text: string, tone: 'success' | 'error' | 'info') => {
    if (!text) return;
    if (pillNoticeTimer) {
      window.clearTimeout(pillNoticeTimer);
      pillNoticeTimer = null;
    }
    if (pillAnnounceTimer) {
      window.clearTimeout(pillAnnounceTimer);
      pillAnnounceTimer = null;
    }
    pillNoticeEl.textContent = text;
    pillNoticeEl.className = `mole-pill-notice tone-${tone}`;
    trigger.classList.add('notice-visible', 'announce');
    pillNoticeTimer = window.setTimeout(() => {
      clearPillNotice();
      if (!isOpen && currentTask?.status !== 'running') {
        trigger.classList.remove('announce');
      }
      pillNoticeTimer = null;
    }, 3600);
    pillAnnounceTimer = window.setTimeout(() => {
      if (!isOpen && currentTask?.status !== 'running') {
        trigger.classList.remove('announce');
      }
      pillAnnounceTimer = null;
    }, 4200);
  };

  // ---- 悬浮球迷你操作卡片函数 ----

  /** 隐藏迷你操作卡片 */
  const hidePillActionCard = () => {
    pillActionCard.innerHTML = '';
    pillActionCard.classList.remove('visible');
  };

  /** 显示确认迷你卡片 */
  const showPillApprovalCard = (requestId: string, message: string) => {
    const shortMsg = message.length > 40 ? message.slice(0, 40) + '...' : message;
    pillActionCard.innerHTML = `
      <div class="pac-body" data-request-id="${requestId}" data-type="approval">
        <div class="pac-msg">${escapeHtml(shortMsg)}</div>
        <div class="pac-actions">
          <button class="pac-btn pac-approve">批准</button>
          <button class="pac-btn pac-reject">拒绝</button>
        </div>
      </div>
    `;
    pillActionCard.classList.add('visible');
  };

  /** 显示提问迷你卡片 */
  const showPillAskUserCard = (
    requestId: string,
    question: string,
    options?: string[],
    allowFreeText?: boolean,
  ) => {
    const shortQ = question.length > 40 ? question.slice(0, 40) + '...' : question;
    const optionsHtml = options && options.length > 0
      ? options.map(o => `<button class="pac-btn pac-option">${escapeHtml(o)}</button>`).join('')
      : '';
    const inputHtml = allowFreeText
      ? `<div class="pac-input-row">
          <input class="pac-text" placeholder="输入回答..." />
          <button class="pac-btn pac-send">发送</button>
        </div>`
      : '';
    pillActionCard.innerHTML = `
      <div class="pac-body" data-request-id="${requestId}" data-type="ask-user">
        <div class="pac-msg">${escapeHtml(shortQ)}</div>
        ${optionsHtml ? `<div class="pac-options">${optionsHtml}</div>` : ''}
        ${inputHtml}
      </div>
    `;
    pillActionCard.classList.add('visible');
  };

  // ---- 胶囊状态更新 ----
  const updatePillState = () => {
    trigger.classList.remove('task-running', 'task-done', 'task-error');
    const state: 'idle' | 'running' | 'done' | 'error' = currentTask ? currentTask.status : 'idle';
    if (state === 'idle') {
      if (isRecorderAuditing) {
        // AI 审计中：蓝色脉冲 + 文本提示
        shortcutEl.textContent = 'AI 审计中';
        pillMetaEl.textContent = '正在生成工作流...';
        trigger.classList.add('announce');
      } else {
        const takeoverLabel = getTakeoverLabel();
        if (takeoverLabel) {
          trigger.classList.add('task-running');
          shortcutEl.textContent = takeoverLabel;
          pillMetaEl.textContent = getTakeoverMetaText();
          clearPillNotice();
          trigger.classList.add('announce');
        } else {
          shortcutEl.textContent = '';
          pillMetaEl.textContent = `${SHORTCUT_TEXT} 打开`;
          if (!trigger.classList.contains('notice-visible')) {
            trigger.classList.remove('announce');
          }
        }
      }
    } else if (state === 'running' && currentTask) {
      trigger.classList.add('task-running');
      const elapsed = Math.max(0, Date.now() - currentTask.startedAt);
      const liveProgress = clipRuntimeText(
        sanitizeUserFacingRuntimeText(currentTask.liveStatusText || '我正在继续处理，请稍候...', 'current'),
        18,
      );
      shortcutEl.textContent = liveProgress || getTaskTitle(currentTask);
      pillMetaEl.textContent = `已运行 ${formatDuration(elapsed)}`;
      clearPillNotice();
      trigger.classList.add('announce');
    } else if (state === 'done' && currentTask) {
      trigger.classList.add('task-done');
      const end = currentTask.endedAt;
      const duration = currentTask.durationMs ?? (end ? Math.max(0, end - currentTask.startedAt) : null);
      shortcutEl.textContent = getTaskTitle(currentTask);
      pillMetaEl.textContent = duration !== null ? `已完成 · 耗时 ${formatDuration(duration)}` : '已完成';
    } else if (state === 'error' && currentTask) {
      trigger.classList.add('task-error');
      shortcutEl.textContent = getTaskTitle(currentTask);
      pillMetaEl.textContent = currentTask.failureCode
        ? `处理异常 · ${currentTask.failureCode}`
        : '处理异常';
    }

    const taskId = currentTask?.id || '';
    if (lastPillState === 'running' && taskId === lastPillTaskId && currentTask) {
      if (state === 'done') {
        const duration = currentTask.durationMs
          ?? (currentTask.endedAt ? Math.max(0, currentTask.endedAt - currentTask.startedAt) : null);
        showPillNotice(
          duration !== null ? `已完成 · 耗时 ${formatDuration(duration)}` : '已完成',
          'success',
        );
      } else if (state === 'error') {
        showPillNotice(currentTask.failureCode ? `处理失败 · ${currentTask.failureCode}` : '处理失败', 'error');
      }
    }
    lastPillState = state;
    lastPillTaskId = taskId;
  };

  // ---- 后台任务查询与面板渲染 ----

  /** 查询后台任务数据 */
  const queryBgTasks = () => {
    Channel.send('__bg_tasks_query', {}, (resp: any) => {
      bgTasksData = resp;
      updateBgTaskBadge();
      renderBgTasksPanel();
    });
  };

  /** 更新胶囊角标 */
  const updateBgTaskBadge = () => {
    const count = (bgTasksData?.timers?.length || 0) + (bgTasksData?.residentJobs?.length || 0);
    if (count > 0) {
      bgTaskBadgeEl.textContent = String(count);
      bgTaskBadgeEl.classList.add('visible');
    } else {
      bgTaskBadgeEl.classList.remove('visible');
    }
  };

  /** 渲染后台任务面板 */
  const renderBgTasksPanel = () => {
    const count = (bgTasksData?.timers?.length || 0) + (bgTasksData?.residentJobs?.length || 0);
    if (count === 0) {
      bgTasksPanelEl.classList.remove('visible');
      bgTasksPanelEl.innerHTML = '';
      return;
    }

    let html = '';

    // 头部
    html += `<div class="mole-bg-tasks-header">`;
    html += `<span class="mole-bg-tasks-title">后台任务</span>`;
    html += `<span class="mole-bg-tasks-count">${count}</span>`;
    html += `<span class="mole-bg-tasks-toggle">\u25B6</span>`;
    html += `</div>`;

    // 列表
    html += `<div class="mole-bg-tasks-list">`;

    // 定时器任务
    if (bgTasksData?.timers) {
      for (const t of bgTasksData.timers) {
        const icon = FUNCTION_ICONS['timer'] || '';
        const displayName = t.name || String(t.action || '').slice(0, 40);
        const nameHtml = escapeHtml(displayName);
        const fullAction = escapeHtml(String(t.action || ''));
        let meta = '';
        if (t.type === 'schedule' && t.scheduleRule) {
          const rule = t.scheduleRule;
          if (rule.startsWith('daily:')) {
            meta = `每天 ${rule.slice(6)}`;
          } else if (rule.startsWith('weekly:')) {
            const parts = rule.slice(7).split(':');
            const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
            meta = `每${dayNames[parseInt(parts[0])]} ${parts[1]}:${parts[2]}`;
          }
          if (t.currentCount) meta += ` \u00B7 已执行 ${t.currentCount} 次`;
          if (t.nextRunAt) meta += ` \u00B7 下次 ${formatClock(t.nextRunAt)}`;
        } else if (t.type === 'timeout') {
          meta = `延时 \u00B7 将在 ${formatClock(t.nextRunAt)} 执行`;
        } else {
          meta = `周期 \u00B7 已执行 ${t.currentCount || 0} 次`;
          if (t.nextRunAt) {
            meta += ` \u00B7 下次 ${formatClock(t.nextRunAt)}`;
          }
        }
        html += `<div class="mole-bg-task-item" data-kind="timer" data-id="${escapeHtml(String(t.id))}">`;
        html += `<span class="mole-bg-task-icon">${icon ? `<img src="${icon}" alt="" />` : ''}</span>`;
        html += `<div class="mole-bg-task-info">`;
        html += `<span class="mole-bg-task-name" title="${fullAction}">${nameHtml}</span>`;
        html += `<span class="mole-bg-task-meta">${escapeHtml(meta)}</span>`;
        html += `</div>`;
        html += `<button class="mole-bg-task-close" type="button" title="关闭">\u00D7</button>`;
        html += `</div>`;
      }
    }

    // 常驻任务
    if (bgTasksData?.residentJobs) {
      for (const j of bgTasksData.residentJobs) {
        const icon = FUNCTION_ICONS['resident_runtime'] || '';
        const name = escapeHtml(String(j.name || ''));
        let meta = `常驻 \u00B7 间隔 ${formatInterval(j.intervalMs || 0)}`;
        if (j.lastSuccess === true) {
          meta += ' \u00B7 上次成功';
        } else if (j.lastSuccess === false) {
          meta += ' \u00B7 上次失败';
        }
        html += `<div class="mole-bg-task-item" data-kind="resident" data-id="${escapeHtml(String(j.id))}">`;
        html += `<span class="mole-bg-task-icon">${icon ? `<img src="${icon}" alt="" />` : ''}</span>`;
        html += `<div class="mole-bg-task-info">`;
        html += `<span class="mole-bg-task-name">${name}</span>`;
        html += `<span class="mole-bg-task-meta">${escapeHtml(meta)}</span>`;
        html += `</div>`;
        html += `<button class="mole-bg-task-close" type="button" title="关闭">\u00D7</button>`;
        html += `</div>`;
      }
    }

    html += `</div>`;

    bgTasksPanelEl.innerHTML = html;
    bgTasksPanelEl.classList.add('visible');
  };

  // 后台任务面板事件委托（仅绑定一次，避免每次 render 累积监听器）
  bgTasksPanelEl.addEventListener('click', (e: Event) => {
    const target = e.target as HTMLElement;

    // 头部点击：折叠/展开
    if (target.closest('.mole-bg-tasks-header')) {
      bgTasksPanelEl.classList.toggle('open');
      return;
    }

    // 关闭按钮点击
    if (!target.classList.contains('mole-bg-task-close')) return;
    const item = target.closest('.mole-bg-task-item') as HTMLElement | null;
    if (!item) return;
    const kind = item.getAttribute('data-kind');
    const id = item.getAttribute('data-id');
    if (!kind || !id) return;
    Channel.send('__bg_task_close', { kind, id }, (resp: any) => {
      if (resp?.success !== false) {
        showPillNotice('已关闭', 'success');
        queryBgTasks();
      }
    });
  });

  const simplifySessionOpLabel = (label?: string): string => {
    const raw = String(label || '').trim();
    if (!raw) return '';
    const normalized = raw
      .replace(/^__session_/, '')
      .replace(/^__ai_/, '');
    if (normalized.startsWith('session_event:')) return '同步会话状态';
    if (normalized.startsWith('pending_')) return '处理回包';
    if (normalized.includes('create')) return '创建会话';
    if (normalized.includes('continue')) return '继续会话';
    if (normalized.includes('cancel')) return '取消任务';
    if (normalized.includes('clear')) return '清空会话';
    if (normalized.includes('rollback') || normalized.includes('undo')) return '回退历史';
    if (normalized.includes('replay')) return '恢复历史记录';
    return '后台处理中';
  };

  const formatSessionOpQueueHint = (task: TaskItem | null): string => {
    if (!task?.opQueue) return '';
    const depth = Math.max(0, Number(task.opQueue.depth || 0));
    if (depth <= 0) return '';
    const parts: string[] = [`后台队列 ${depth}`];
    if (task.opQueue.runningSince) {
      const runningMs = Math.max(0, Date.now() - task.opQueue.runningSince);
      const runningLabel = simplifySessionOpLabel(task.opQueue.runningLabel);
      const latencyText = formatQueueLatency(runningMs);
      if (runningLabel && latencyText) {
        parts.push(`${runningLabel} ${latencyText}`);
      } else if (latencyText) {
        parts.push(latencyText);
      }
    } else if (task.opQueue.lastLatencyMs) {
      const lastLabel = simplifySessionOpLabel(task.opQueue.lastLabel);
      const latencyText = formatQueueLatency(task.opQueue.lastLatencyMs);
      if (lastLabel && latencyText) {
        parts.push(`${lastLabel} ${latencyText}`);
      } else if (latencyText) {
        parts.push(latencyText);
      }
    }
    return parts.join(' · ');
  };

  // ============ 工作流录制 ============

  /** 生成一个尽可能稳定的 CSS 选择器 */
  const buildSimpleSelector = (el: Element): string => {
    // 有 id 直接使用
    if (el.id) return `#${CSS.escape(el.id)}`;
    // data-testid / data-test
    const testId = el.getAttribute('data-testid') || el.getAttribute('data-test');
    if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
    const tag = el.tagName.toLowerCase();
    // name 属性
    const name = el.getAttribute('name');
    if (name) return `${tag}[name="${CSS.escape(name)}"]`;
    // aria-label
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return `${tag}[aria-label="${CSS.escape(ariaLabel)}"]`;
    // placeholder
    const placeholder = el.getAttribute('placeholder');
    if (placeholder) return `${tag}[placeholder="${CSS.escape(placeholder)}"]`;
    // class 名（取前 2 个）
    const classes = Array.from(el.classList).slice(0, 2);
    if (classes.length > 0) return `${tag}.${classes.map(c => CSS.escape(c)).join('.')}`;
    // nth-of-type 兜底
    const parent = el.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
      const idx = siblings.indexOf(el) + 1;
      return `${tag}:nth-of-type(${idx})`;
    }
    return tag;
  };

  /** 生成元素的语义描述 */
  const getElementSemanticHint = (el: Element): string => {
    const tag = el.tagName.toLowerCase();
    // 按钮/链接：取文本内容
    if (tag === 'button' || tag === 'a' || el.getAttribute('role') === 'button') {
      const text = (el.textContent || '').trim().slice(0, 30);
      if (text) return text;
    }
    // 输入框：取 placeholder / aria-label / name
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      return el.getAttribute('placeholder')
        || el.getAttribute('aria-label')
        || el.getAttribute('name')
        || tag;
    }
    // 其他：aria-label / role / tag
    return el.getAttribute('aria-label')
      || el.getAttribute('role')
      || tag;
  };

  // ---- 事件捕获 ----

  let inputDebounceTimer: number | null = null;
  let lastInputTarget: Element | null = null;
  let lastInputValue = '';

  /** 提交未完成的输入步骤 */
  const flushInputStep = () => {
    if (!lastInputTarget || !lastInputValue) return;
    const target = lastInputTarget;
    const isSelect = target.tagName === 'SELECT';

    recorderStepCount++;
    Channel.send('__recorder_step', {
      seq: recorderStepCount,
      action: isSelect ? 'select' : 'type',
      selector: buildSimpleSelector(target),
      selectorCandidates: [buildSimpleSelector(target)],
      semanticHint: getElementSemanticHint(target),
      tag: target.tagName.toLowerCase(),
      value: lastInputValue,
      url: window.location.href,
      timestamp: Date.now(),
    });
    lastInputTarget = null;
    lastInputValue = '';
    updateRecorderBar();
  };

  /** click 监听器 */
  const recorderClickHandler = (e: MouseEvent) => {
    if (!isRecording) return;
    const target = e.target as Element;
    if (!target || target.closest('#mole-root')) return;

    const selector = buildSimpleSelector(target);
    const semanticHint = getElementSemanticHint(target);

    recorderStepCount++;
    Channel.send('__recorder_step', {
      seq: recorderStepCount,
      action: 'click',
      selector,
      selectorCandidates: [selector],
      semanticHint,
      tag: target.tagName.toLowerCase(),
      url: window.location.href,
      timestamp: Date.now(),
    });
    updateRecorderBar();
  };

  /** input/change 监听器（防抖合并） */
  const recorderInputHandler = (e: Event) => {
    if (!isRecording) return;
    const target = e.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    if (!target || target.closest('#mole-root')) return;

    // 上一个元素的输入已结束，立即提交
    if (target !== lastInputTarget && lastInputTarget && lastInputValue) {
      flushInputStep();
    }

    lastInputTarget = target;
    lastInputValue = target.value || '';

    if (inputDebounceTimer) window.clearTimeout(inputDebounceTimer);
    inputDebounceTimer = window.setTimeout(() => {
      flushInputStep();
    }, 800);
  };

  /** submit 监听器 */
  const recorderSubmitHandler = (e: Event) => {
    if (!isRecording) return;
    const form = e.target as HTMLFormElement;
    if (!form || form.closest('#mole-root')) return;

    flushInputStep(); // 先提交未完成的输入

    recorderStepCount++;
    Channel.send('__recorder_step', {
      seq: recorderStepCount,
      action: 'submit',
      selector: buildSimpleSelector(form),
      selectorCandidates: [buildSimpleSelector(form)],
      semanticHint: '提交表单',
      tag: 'form',
      url: window.location.href,
      timestamp: Date.now(),
    });
    updateRecorderBar();
  };

  /** 开始事件捕获 */
  const startRecordingCapture = () => {
    document.addEventListener('click', recorderClickHandler, true);
    document.addEventListener('input', recorderInputHandler, true);
    document.addEventListener('change', recorderInputHandler, true);
    document.addEventListener('submit', recorderSubmitHandler, true);
  };

  /** 停止事件捕获 */
  const stopRecordingCapture = () => {
    document.removeEventListener('click', recorderClickHandler, true);
    document.removeEventListener('input', recorderInputHandler, true);
    document.removeEventListener('change', recorderInputHandler, true);
    document.removeEventListener('submit', recorderSubmitHandler, true);
    if (inputDebounceTimer) { window.clearTimeout(inputDebounceTimer); inputDebounceTimer = null; }
    lastInputTarget = null;
    lastInputValue = '';
  };

  /** 更新录制状态栏 */
  const updateRecorderBar = () => {
    const barInfo = recorderBarEl.querySelector('.mole-recorder-bar-info') as HTMLSpanElement;
    if (!barInfo) return;
    if (isRecording) {
      const elapsed = Math.max(0, Date.now() - recorderStartedAt);
      barInfo.textContent = `录制中 \u00B7 ${recorderStepCount} 步 \u00B7 ${formatDuration(elapsed)}`;
      recorderBarEl.classList.add('visible');
    } else {
      recorderBarEl.classList.remove('visible');
    }
  };

  /** 提交录制给 background AI 审计 */
  const submitRecording = () => {
    // 进入审计状态
    isRecorderAuditing = true;
    footerTextEl.textContent = 'AI 正在审计录制...';
    trigger.classList.remove('recording');
    trigger.classList.add('auditing', 'announce');
    recorderBarEl.classList.remove('visible');
    updatePillState();

    Channel.send('__recorder_submit', {}, (resp: any) => {
      // 回调仅作为审计失败的兜底
      if (!isRecorderAuditing) return; // 已被 __recorder_audit_done 处理
      isRecorderAuditing = false;
      trigger.classList.remove('auditing');
      if (!resp?.success) {
        showPillNotice(resp?.error || '审计失败', 'error');
      }
      footerTextEl.textContent = 'Mole \u00B7 AI 助手';
      updatePillState();
    });
  };

  /** 开始录制 */
  const startRecording = () => {
    Channel.send('__recorder_start', { tabId: 0, url: window.location.href }, (resp: any) => {
      if (resp?.error) {
        showPillNotice(resp.error, 'error');
        return;
      }
      isRecording = true;
      recorderStepCount = 0;
      recorderStartedAt = Date.now();
      startRecordingCapture();
      // 更新 UI：胶囊加 recording class，显示 recorderBar
      trigger.classList.add('recording');
      updateRecorderBar();
      showPillNotice('开始录制', 'info');
    });
  };

  /** 停止录制 */
  const stopRecording = () => {
    flushInputStep(); // 提交未完成的输入
    stopRecordingCapture();
    Channel.send('__recorder_stop', {}, () => {
      isRecording = false;
      recorderBarEl.classList.remove('visible');
      // 直接提交给 AI 审计
      submitRecording();
    });
  };

  // 录制状态栏停止按钮
  const recorderBarStopBtn = recorderBarEl.querySelector('.mole-recorder-bar-stop') as HTMLButtonElement;
  recorderBarStopBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    stopRecording();
  });

  // 录制按钮点击事件
  recordBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  recordBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isRecording || currentTask?.status === 'running' || isRecorderAuditing) return;
    startRecording();
  });

  // AI 审计完成后注入对话（替代原直接保存模式）
  Channel.on('__recorder_audit_done', (data: any) => {
    isRecorderAuditing = false;
    trigger.classList.remove('recording', 'auditing');
    footerTextEl.textContent = 'Mole \u00B7 AI 助手';
    updatePillState();

    if (!data?.sessionId) {
      showPillNotice(data?.error || '审计失败', 'error');
      return;
    }

    // 创建本地任务以接收后续的对话流式事件
    currentTask = {
      id: data.sessionId,
      query: '确认录制的工作流',
      title: buildTaskTitle('确认录制的工作流'),
      status: 'running',
      resultHtml: '',
      callStack: [],
      errorMsg: '',
      lastAIText: '',
      agentPhase: 'plan',
      agentRound: 0,
      failureCode: '',
      liveStatusText: '',
      startedAt: Date.now(),
      endedAt: null,
      durationMs: null,
      taskKind: 'aux',
    };

    toggleSearch(true);
    updateInputUI();
    showPillNotice('请确认录制的工作流', 'info');
  });

  const updateFooterTime = () => {
    if (!currentTask) {
      footerTimeEl.textContent = '';
      return;
    }
    const start = currentTask.startedAt;
    if (currentTask.status === 'running') {
      const elapsed = Math.max(0, Date.now() - start);
      footerTimeEl.textContent = `开始 ${formatClock(start)} · 已运行 ${formatDuration(elapsed)}`;
      return;
    }
    const end = currentTask.endedAt;
    const duration = currentTask.durationMs
      ?? (end ? Math.max(0, end - start) : null);
    const parts: string[] = [];
    if (end) parts.push(`结束 ${formatClock(end)}`);
    if (duration !== null) parts.push(`耗时 ${formatDuration(duration)}`);
    footerTimeEl.textContent = parts.join(' · ');
  };

  // ---- 统一输入区 UI 状态 ----
  const updateInputUI = () => {
    searchbox.classList.remove('state-idle', 'state-running', 'state-done', 'state-error');
    const nonOrigin = currentTask && isNonOriginTab();

    if (!currentTask) {
      // idle
      searchbox.classList.add('state-idle');
      inputEl.disabled = false;
      const takeoverLabel = getTakeoverLabel();
      inputEl.placeholder = takeoverLabel ? `${takeoverLabel} · 页面接管中` : '有什么想让我做的？';
      footerTextEl.textContent = takeoverLabel ? `AI 接管中 · ${takeoverLabel}` : 'Mole \u00B7 AI 助手';
      footerTimeEl.textContent = '';
      stopBtn.classList.remove('visible');
      newBtn.classList.remove('visible');
      retryBtn.classList.remove('visible');
      focusTabBtn.style.display = 'none';
      hintEl.style.display = '';
    } else if (currentTask.status === 'running') {
      searchbox.classList.add('state-running');
      inputEl.disabled = true;
      const queueHint = formatSessionOpQueueHint(currentTask);
      const liveProgress = clipRuntimeText(
        sanitizeUserFacingRuntimeText(currentTask.liveStatusText || '我正在继续处理，请稍候...', 'current'),
        28,
      );
      const footerParts: string[] = [liveProgress || '我正在继续处理'];
      if (queueHint) footerParts.push(queueHint);
      if (nonOrigin) {
        // 非发起页签：禁用输入，显示提示和定位按钮
        inputEl.disabled = true;
        inputEl.placeholder = '任务运行在其他标签页';
        focusTabBtn.style.display = '';
        stopBtn.classList.remove('visible');
      } else {
        inputEl.disabled = false;
        inputEl.placeholder = `${liveProgress || getTaskTitle(currentTask)}...`;
        focusTabBtn.style.display = 'none';
        stopBtn.classList.add('visible');
      }
      footerTextEl.textContent = footerParts.join(' · ');
      newBtn.classList.remove('visible');
      retryBtn.classList.remove('visible');
      retryBtn.disabled = false;
      hintEl.style.display = 'none';
    } else {
      // done / error
      searchbox.classList.add(currentTask.status === 'error' ? 'state-error' : 'state-done');
      // 判断是否可恢复：error 状态 + 有上下文
      const canResume = currentTask.status === 'error'
        && currentTask.hasContext === true
        && !!currentTask.failureCode;
      if (nonOrigin) {
        // 非发起页签：禁止继续对话
        inputEl.disabled = true;
        inputEl.placeholder = '任务运行在其他标签页';
        focusTabBtn.style.display = '';
        newBtn.classList.remove('visible');
        retryBtn.classList.remove('visible');
      } else {
        inputEl.disabled = false;
        inputEl.placeholder = '继续对话...';
        focusTabBtn.style.display = 'none';
        newBtn.classList.add('visible');
        // 仅在可恢复时显示重试按钮
        if (canResume) {
          retryBtn.classList.add('visible');
          retryBtn.disabled = false;
        } else {
          retryBtn.classList.remove('visible');
        }
      }
      footerTextEl.textContent = currentTask.status === 'error'
        ? `处理失败 · ${getTaskTitle(currentTask)}${currentTask.failureCode ? ` (${currentTask.failureCode})` : ''}`
        : `已完成 · ${getTaskTitle(currentTask)}`;
      stopBtn.classList.remove('visible');
      hintEl.style.display = '';
    }
    updateFooterTime();
    // 录制/审计状态保护：防止被常规状态刷新覆盖
    if (isRecorderAuditing) {
      footerTextEl.textContent = 'AI 正在审计录制...';
    }
    updatePillState();
  };

  // 运行中每秒刷新一次耗时显示
  window.setInterval(() => {
    const takeoverChanged = tabTakeoverState?.active === true && tabTakeoverState.expiresAt <= Date.now();
    if (currentTask?.status === 'running') {
      updateFooterTime();
      updatePillState();
    } else if (takeoverChanged) {
      tabTakeoverState = null;
      updateInputUI();
    } else if (isTakeoverActive()) {
      updatePillState();
    }
    // 录制中每秒刷新录制状态栏
    if (isRecording) {
      updateRecorderBar();
    }
  }, 1000);

  // ---- 终止任务 ----
  const stopTask = () => {
    // 发送取消消息到后台，使用 sessionId
    if (currentTask && currentTask.status === 'running') {
      Channel.send('__ai_cancel', { sessionId: currentTask.id });
      showPillNotice('已停止当前处理', 'info');
    }
    currentTask = null;
    resetReplayCursor();
    clearReplayCache();
    hideResult();
    updateInputUI();
  };

  stopBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    stopTask();
  });

  settingsBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  settingsBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isOpen) {
      toggleSearch(false);
    }
    openOptionsPage();
  });

  // ---- 关闭按钮事件 ----
  closeBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  closeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    // 切换关闭菜单的显示/隐藏
    closeMenuEl.classList.toggle('visible');
  });

  // 菜单项1：仅当前关闭
  closeMenuItemCurrent.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    userDismissed = true;
    host.remove();
  });

  // 菜单项2：在当前域名上禁用
  closeMenuItemDomain.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    // 将当前域名写入黑名单存储
    chrome.storage.local.get(DISABLED_DOMAINS_KEY, (result) => {
      const existing = result[DISABLED_DOMAINS_KEY];
      const domains: string[] = (existing && Array.isArray(existing.domains)) ? [...existing.domains] : [];
      if (!domains.includes(currentHostname)) {
        domains.push(currentHostname);
      }
      const payload = {
        version: 1,
        updatedAt: Date.now(),
        domains,
      };
      chrome.storage.local.set({ [DISABLED_DOMAINS_KEY]: payload }, () => {
        userDismissed = true;
        host.remove();
      });
    });
  });

  // 点击菜单外区域关闭菜单
  shadow.addEventListener('mousedown', (e) => {
    if (!closeMenuEl.classList.contains('visible')) return;
    const path = e.composedPath();
    if (!path.includes(closeMenuEl) && !path.includes(closeBtn)) {
      closeMenuEl.classList.remove('visible');
    }
  });

  // ---- 新对话（公共逻辑） ----
  const startNewSession = () => {
    // 通知 background 清除当前活跃会话
    if (currentTask) {
      Channel.send('__session_clear', { sessionId: currentTask.id });
    }
    clearPillNotice();
    hidePillActionCard();
    trigger.classList.remove('announce');
    currentTask = null;
    resetReplayCursor();
    clearReplayCache();
    hideResult();
    updateInputUI();
    requestAnimationFrame(() => inputEl.focus());
  };

  // ---- ESC 行为：有会话 → 新对话；无会话 → 关闭 ----
  const handleEscape = () => {
    if (!isOpen) return;
    if (imageViewerEl.classList.contains('open')) {
      closeImageViewer();
      return;
    }
    // 有会话内容时，先清空为新会话
    if (currentTask) {
      startNewSession();
      return;
    }
    // 无会话，关闭搜索框
    toggleSearch(false);
  };

  const handleImageViewerHotkey = (key: string): boolean => {
    if (!imageViewerEl.classList.contains('open')) return false;
    if (key === 'ArrowLeft') {
      previewNextImage(-1);
      return true;
    }
    if (key === 'ArrowRight') {
      previewNextImage(1);
      return true;
    }
    return false;
  };

  newBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    startNewSession();
  });

  // ---- 重试按钮：断点恢复 ----
  retryBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!currentTask || currentTask.status !== 'error') return;
    if (retryBtn.disabled) return;

    // 置灰禁用，防止重复点击
    retryBtn.disabled = true;

    const sessionId = currentTask.id;
    Channel.send('__session_resume', { sessionId }, (response: any) => {
      if (response?.accepted === false) {
        // 恢复失败，重新启用按钮
        retryBtn.disabled = false;
        const message = typeof response?.message === 'string' && response.message.trim()
          ? response.message.trim()
          : '恢复失败';
        appendToResult(`<div class="mole-error">\u26A0 ${escapeHtml(message)}</div>`);
        updateInputUI();
      }
      // 恢复成功后，__session_sync 会自动更新 UI 为 running 状态
    });
  });

  // ---- 结果渲染 ----
  const showResult = () => {
    resultEl.classList.add('visible');
    dividerBottomEl.style.display = 'block';
  };

  const hideResult = () => {
    resultEl.classList.remove('visible');
    resultEl.innerHTML = '';
    dividerBottomEl.style.display = 'none';
  };

  /** 渲染当前页面匹配的 workflow 快捷操作卡片 */
  const renderWorkflowHints = () => {
    // 仅在 idle 或 done 状态时显示
    if (currentTask && currentTask.status === 'running') return;

    const url = window.location.href;
    Channel.send('__site_workflows_match', { url }, (response: any) => {
      // 响应回来时再次确认仍然是 idle/done 状态且搜索框打开
      if (currentTask?.status === 'running' || !isOpen) return;
      // 如果已有 resultHtml（done 状态恢复），不覆盖
      if (currentTask?.resultHtml) return;

      const workflows: Array<{
        name: string;
        label: string;
        description: string;
        hasRequiredParams: boolean;
      }> = response?.success && Array.isArray(response.workflows) ? response.workflows : [];

      if (workflows.length === 0) return;

      // 如果 resultEl 中已经有 workflow-hints 卡片或其他内容，跳过
      if (resultEl.querySelector('.mole-workflow-hints')) return;
      if (resultEl.innerHTML.trim()) return;

      const chipsHtml = workflows.map(w =>
        `<div class="mole-workflow-chip" data-name="${escapeHtml(w.name)}" data-label="${escapeHtml(w.label)}" data-has-required="${w.hasRequiredParams ? '1' : '0'}" title="${escapeHtml(w.description)}"><span class="mole-workflow-chip-label">${escapeHtml(w.label)}</span></div>`
      ).join('');

      resultEl.innerHTML = `<div class="mole-workflow-hints">
        <div class="mole-workflow-hints-title">试试快捷指令</div>
        <div class="mole-workflow-chips">${chipsHtml}</div>
      </div>`;
      showResult();
    });
  };

  const setStatus = (html: string) => {
    // 移除之前的状态提示（不影响历史内容）
    resultEl.querySelectorAll('.mole-status, .mole-planning').forEach(el => el.remove());
    // 追加新状态
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    while (wrapper.firstChild) {
      resultEl.appendChild(wrapper.firstChild);
    }
    renderTaskRuntimeBoard();
    showResult();
    resultEl.scrollTop = resultEl.scrollHeight;
  };

  const appendToResult = (html: string) => {
    resultEl.innerHTML += html;
    showResult();
    resultEl.scrollTop = resultEl.scrollHeight;
  };

  const buildRoundPreviewText = (query: string): string => {
    const compact = String(query || '').trim();
    if (!compact) return '历史对话';
    return compact.length > 40 ? `${compact.slice(0, 40)}...` : compact;
  };

  const archiveCurrentRoundView = (previewQuery?: string) => {
    const looseNodes = Array.from(resultEl.childNodes).filter(
      node => !(node instanceof HTMLElement && node.classList.contains('mole-round-history')),
    );
    if (looseNodes.length === 0) return;

    const prevAnswer = resultEl.querySelector('.mole-answer:not(.frozen)');
    if (prevAnswer) prevAnswer.classList.add('frozen');
    const prevGroup = resultEl.querySelector('.mole-calls-group:not(.frozen)');
    if (prevGroup) prevGroup.classList.add('frozen');
    const prevStatePanel = resultEl.querySelector('.mole-agent-state-panel:not(.frozen)');
    if (prevStatePanel) prevStatePanel.classList.add('frozen');

    const roundHistory = document.createElement('div');
    roundHistory.className = 'mole-round-history';

    const summaryBar = document.createElement('div');
    summaryBar.className = 'mole-round-summary';
    summaryBar.innerHTML = `
      <span class="arrow">\u25B6</span>
      <span class="mole-round-preview">${escapeHtml(buildRoundPreviewText(previewQuery || ''))}</span>
    `;

    const roundContent = document.createElement('div');
    roundContent.className = 'mole-round-content';
    for (const node of looseNodes) {
      roundContent.appendChild(node);
    }

    roundHistory.appendChild(summaryBar);
    roundHistory.appendChild(roundContent);
    resultEl.appendChild(roundHistory);
  };

  const updateAnswer = (text: string) => {
    // 查找当前轮次的 answer 元素（排除已冻结的历史轮次）
    let answerEl = resultEl.querySelector('.mole-answer:not(.frozen)');
    if (!answerEl) {
      answerEl = document.createElement('div');
      answerEl.className = 'mole-answer';
      resultEl.appendChild(answerEl);
      showResult();
    }
    answerEl.innerHTML = markdownToHtml(text);
    resultEl.scrollTop = resultEl.scrollHeight;
  };

  // ---- AI 流式事件处理 ----

  /** 确保当前轮次的过程折叠区存在（排除已冻结的历史轮次） */
  const ensureCallsGroup = (): { summary: HTMLElement; detail: HTMLElement } => {
    const panel = ensureAgentStatePanel();
    const anchor = panel.querySelector('.mole-agent-state-ops-anchor') as HTMLElement | null;
    let group = panel.querySelector('.mole-calls-group:not(.frozen)') as HTMLElement | null;
    if (!group) {
      group = document.createElement('div');
      group.className = 'mole-calls-group mole-agent-state-ops';
      group.innerHTML = `
        <div class="mole-calls-summary">
          <span class="arrow open">▶</span>
          <span class="mole-calls-icons"></span>
          <span class="calls-text">查看执行过程</span>
        </div>
        <div class="mole-calls-detail open"></div>
      `;
      if (anchor) {
        anchor.appendChild(group);
      } else {
        panel.appendChild(group);
      }
      showResult();
    }

    return {
      summary: group.querySelector('.mole-calls-summary')! as HTMLElement,
      detail: group.querySelector('.mole-calls-detail')! as HTMLElement,
    };
  };

  /** 更新当前轮次的折叠摘要条 */
  const updateCallsSummary = () => {
    if (!currentTask) return;
    const group = resultEl.querySelector('.mole-agent-state-panel:not(.frozen) .mole-calls-group');
    if (!group) {
      renderTaskRuntimeBoard();
      return;
    }
    const iconsEl = group.querySelector('.mole-calls-icons') as HTMLElement | null;
    const textEl = group.querySelector('.calls-text') as HTMLElement | null;
    const detailEl = group.querySelector('.mole-calls-detail') as HTMLElement | null;
    const uniqueIcons = [...new Set(currentTask.callStack.map(c => c.icon).filter(Boolean))].slice(0, 3);
    if (iconsEl) iconsEl.innerHTML = uniqueIcons.map(src => `<img src="${src}" />`).join('');
    const count = detailEl ? detailEl.querySelectorAll('.mole-call-item').length : 0;
    if (textEl) textEl.textContent = count > 0 ? `查看执行过程 · 共 ${count} 条` : '查看执行过程';
    renderTaskRuntimeBoard();
  };

  const appendProcessEntry = (
    text: string,
    options?: {
      tone?: 'status' | 'action' | 'issue' | 'done';
      icon?: string;
      subtext?: string;
      callId?: string;
      dedupe?: boolean;
    },
  ): HTMLElement | null => {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return null;
    const { detail } = ensureCallsGroup();
    const items = Array.from(detail.querySelectorAll('.mole-call-item')) as HTMLElement[];
    const last = items.length > 0 ? items[items.length - 1] : null;
    if (options?.dedupe !== false && last?.getAttribute('data-process-text') === normalized) {
      return last;
    }

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
    while (detail.children.length > 24) {
      detail.removeChild(detail.firstChild as Node);
    }
    updateCallsSummary();
    resultEl.scrollTop = resultEl.scrollHeight;
    return item;
  };

  const updateProcessEntryStatus = (
    target: Element | null,
    options: { tone?: 'status' | 'action' | 'issue' | 'done'; subtext?: string; statusLabel?: string },
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
      if (subtextEl) {
        subtextEl.textContent = options.subtext;
      } else if (options.subtext.trim()) {
        const mainEl = target.querySelector('.mole-call-main');
        if (mainEl) {
          const next = document.createElement('span');
          next.className = 'mole-call-intent';
          next.textContent = options.subtext;
          mainEl.appendChild(next);
        }
      }
    }
  };

  /** 保存结果快照到当前任务 */
  const saveSnapshot = () => {
    if (currentTask && resultEl.innerHTML) {
      currentTask.resultHtml = resultEl.innerHTML;
      storeReplayRunSnapshot(
        currentTask.activeRunId,
        Math.max(replayKnownEventCount, replayAppliedEventCount),
        replayLastTimestamp,
      );
    }
  };

  const buildAgentStatePanelMarkup = (): string => `
    <div class="mole-agent-state-title">
      <span class="mole-agent-state-title-main"><span class="arrow">▶</span><span>进展</span></span>
      <span class="mole-agent-state-summary">等待任务开始</span>
    </div>
    <div class="mole-task-runtime-board"></div>
    <div class="mole-todo-board"></div>
    <div class="mole-agent-state-ops-anchor"></div>
    <div class="mole-agent-state-log"></div>
  `;

  const ensureAgentStatePanel = (): HTMLElement => {
    let panel = resultEl.querySelector('.mole-agent-state-panel:not(.frozen)') as HTMLElement | null;
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'mole-agent-state-panel';
      panel.innerHTML = buildAgentStatePanelMarkup();
      const statusEl = resultEl.querySelector('.mole-status, .mole-planning');
      if (statusEl) {
        statusEl.after(panel);
      } else {
        resultEl.appendChild(panel);
      }
      showResult();
    } else {
      const board = panel.querySelector('.mole-task-runtime-board');
      const summary = panel.querySelector('.mole-agent-state-summary');
      if (!board || !summary) {
        panel.innerHTML = buildAgentStatePanelMarkup();
      }
    }
    return panel;
  };

  /** 确保调度状态日志容器存在（排除已冻结历史轮次） */
  const ensureAgentStateLog = (): HTMLElement => {
    const panel = ensureAgentStatePanel();
    renderTaskRuntimeBoard();
    return panel.querySelector('.mole-agent-state-log') as HTMLElement;
  };

  const clearTransientStatus = () => {
    resultEl.querySelectorAll('.mole-status, .mole-planning').forEach((el) => el.remove());
  };

  const syncLiveStatusText = (raw: unknown) => {
    if (!currentTask) return;
    const normalized = sanitizeUserFacingRuntimeText(raw, 'current', '我正在继续处理，请稍候...')
      .replace(/\s+/g, ' ')
      .trim();
    currentTask.liveStatusText = normalized;
    clearTransientStatus();
    renderTaskRuntimeBoard();
    showResult();
  };

  const getRuntimePhaseMeta = (
    agentPhase?: string,
  ): { label: string; toneClass: string; statusText: string } => {
    if (agentPhase === 'finalize') {
      return { label: '整理结果', toneClass: 'phase-finalize', statusText: '我正在整理结果，马上给你' };
    }
    if (agentPhase === 'verify') {
      return { label: '确认结果', toneClass: 'phase-verify', statusText: '我正在确认刚才的操作结果' };
    }
    if (agentPhase === 'act') {
      return { label: '继续处理', toneClass: 'phase-execute', statusText: '我正在继续完成页面操作' };
    }
    return { label: '查看页面', toneClass: 'phase-observe', statusText: '我正在查看页面内容并确认线索' };
  };

  const buildAgentStateSummaryText = (): string => {
    if (!currentTask) return '等待任务开始';
    if (currentTask.status === 'done') {
      const duration = currentTask.durationMs ?? (currentTask.endedAt ? Math.max(0, currentTask.endedAt - currentTask.startedAt) : null);
      return duration !== null ? `已完成 · 耗时 ${formatDuration(duration)}` : '已完成';
    }
    if (currentTask.status === 'error') {
      return currentTask.errorMsg ? clipRuntimeText(currentTask.errorMsg, 46) : '处理失败';
    }
    const phaseMeta = getRuntimePhaseMeta(currentTask.agentPhase);
    return clipRuntimeText(
      sanitizeUserFacingRuntimeText(
        currentTask.liveStatusText || phaseMeta.statusText || '我正在继续处理，请稍候...',
        'current',
        '我正在继续处理，请稍候...'
      ),
      46,
    ) || phaseMeta.label;
  };

  const renderTaskRuntimeBoard = () => {
    const panel = currentTask
      ? ensureAgentStatePanel()
      : resultEl.querySelector('.mole-agent-state-panel:not(.frozen)') as HTMLElement | null;
    const board = panel?.querySelector('.mole-task-runtime-board') as HTMLElement | null;
    const summaryEl = panel?.querySelector('.mole-agent-state-summary') as HTMLElement | null;
    if (!board) return;

    const isRunning = currentTask?.status === 'running';
    const isFinished = currentTask?.status === 'done' || currentTask?.status === 'error';

    if (panel) {
      panel.classList.toggle('is-live', isRunning === true);
      // 任务结束后自动折叠进展面板，让答案成为主角
      if (isFinished && panel.classList.contains('open')) {
        panel.classList.remove('open');
      }
    }

    if (summaryEl) {
      summaryEl.textContent = buildAgentStateSummaryText();
    }

    if (isFinished) {
      // 任务已结束，清空 board 中的运行态内容
      board.innerHTML = '';
      return;
    }

    const phaseMeta = getRuntimePhaseMeta(currentTask?.agentPhase);
    const currentStatusText = sanitizeUserFacingRuntimeText(
      currentTask?.liveStatusText || phaseMeta.statusText || '我正在继续处理，请稍候...',
      'current',
      '我正在继续处理，请稍候...'
    );

    board.innerHTML = `
      <div class="mole-runtime-now">
        ${isRunning ? '<span class="mole-inline-loader"><span></span><span></span><span></span></span>' : ''}
        <span class="mole-runtime-now-text">${escapeHtml(clipRuntimeText(currentStatusText, 120))}</span>
      </div>
    `;
  };

  /** 追加一条状态转移日志 */
  const appendAgentStateLog = (rawContent: string) => {
    const logEl = ensureAgentStateLog();
    let lineText = rawContent;
    try {
      const parsed = JSON.parse(rawContent);
      const from = AGENT_PHASE_LABELS[parsed.from] || parsed.from || '未知';
      const to = AGENT_PHASE_LABELS[parsed.to] || parsed.to || '未知';
      const reason = parsed.reason || '';
      const round = typeof parsed.round === 'number' ? parsed.round : 0;
      if (currentTask) {
        currentTask.agentPhase = parsed.to || currentTask.agentPhase;
        currentTask.agentRound = round;
      }
      lineText = `R${round} ${from} → ${to}：${reason}`;
    } catch {
      // 保底：非 JSON 直接按原文展示
    }
    const item = document.createElement('div');
    item.className = 'mole-agent-state-item';
    item.textContent = lineText;
    logEl.appendChild(item);

    // 控制日志长度，避免 DOM 无限增长
    while (logEl.children.length > 24) {
      logEl.removeChild(logEl.firstChild as Node);
    }

    showResult();
    resultEl.scrollTop = resultEl.scrollHeight;
  };

  /** 同步调度状态到当前任务（用户侧默认不展示细粒度日志） */
  const syncAgentState = (rawContent: string) => {
    try {
      const parsed = JSON.parse(rawContent);
      const round = typeof parsed.round === 'number' ? parsed.round : 0;
      if (currentTask) {
        currentTask.agentPhase = parsed.to || currentTask.agentPhase;
        currentTask.agentRound = round;
      }
    } catch {
      // ignore malformed payload
    }

    renderTaskRuntimeBoard();
    if (SHOW_AGENT_STATE_PANEL) {
      appendAgentStateLog(rawContent);
    }
  };

  /** 解析错误事件内容（兼容结构化 JSON 与纯文本） */
  const parseErrorEventContent = (rawContent: string): { message: string; code: string } => {
    try {
      const parsed = JSON.parse(rawContent);
      if (parsed && typeof parsed.message === 'string') {
        return {
          message: parsed.message,
          code: typeof parsed.code === 'string' ? parsed.code : '',
        };
      }
    } catch {
      // 非 JSON，按纯文本处理
    }
    return { message: rawContent, code: '' };
  };

  const renderReviewOutputPayload = (parsed: any) => {
    const summary = typeof parsed?.summary === 'string' ? parsed.summary.trim() : '';
    const findings = Array.isArray(parsed?.findings) ? parsed.findings : [];
    if (!summary && findings.length === 0) return;

    const section = document.createElement('div');
    section.className = 'mole-review-output';
    let html = '';
    if (summary) {
      html += `<div class="mole-review-summary">${escapeHtml(summary)}</div>`;
    }
    if (findings.length > 0) {
      html += '<ol class="mole-review-findings">';
      for (const item of findings) {
        const issue = escapeHtml(String(item?.issue || '未命名问题'));
        const impact = escapeHtml(String(item?.impact || '影响待补充'));
        const suggestion = escapeHtml(String(item?.suggestion || '建议待补充'));
        const priority = typeof item?.priority === 'string' && item.priority
          ? `<span class="mole-review-priority">[${escapeHtml(item.priority)}]</span> `
          : '';
        html += `<li>${priority}<strong>${issue}</strong><br/>影响：${impact}<br/>建议：${suggestion}</li>`;
      }
      html += '</ol>';
    }
    section.innerHTML = html;
    resultEl.appendChild(section);
    showResult();
    resultEl.scrollTop = resultEl.scrollHeight;
  };

  const handleTurnStartedEvent = (content: string) => {
    try {
      const parsed = JSON.parse(content);
      const parsedRunId = typeof parsed?.runId === 'string' && parsed.runId ? parsed.runId : null;
      const parsedQuery = typeof parsed?.query === 'string' ? parsed.query : '';
      if (isLegacyReplayMode) {
        const switchedTurn = Boolean(replayActiveRunId) && replayActiveRunId !== parsedRunId;
        if (switchedTurn) {
          archiveCurrentRoundView(replayActiveQuery);
        }
        replayActiveRunId = parsedRunId;
        replayActiveQuery = parsedQuery.trim() ? parsedQuery : '';
      }
      if (typeof parsed?.runId === 'string' && parsed.runId) {
        currentTask!.activeRunId = parsed.runId;
      }
      if (typeof parsed?.startedAt === 'number') {
        currentTask!.startedAt = parsed.startedAt;
      }
      currentTask!.status = 'running';
    } catch {
      // ignore malformed payload
    }
    saveSnapshot();
  };

  const handleTurnCompletedEvent = (content: string) => {
    const lifecycle = parseTurnLifecycleEvent(content, 'done');
    const previousErrorMsg = currentTask!.errorMsg;
    const { ignored, isError: completedAsError } = applyTurnLifecycleToTask(lifecycle);
    if (ignored) return;
    if (completedAsError) {
      const latestError = currentTask!.errorMsg || '当前处理已结束';
      if (!previousErrorMsg || previousErrorMsg !== latestError) {
        appendToResult(`<div class="mole-error">\u26A0 ${escapeHtml(latestError)}</div>`);
      }
    } else if (currentTask!.lastAIText?.trim()) {
      const statusEls = resultEl.querySelectorAll('.mole-status, .mole-planning');
      statusEls.forEach(el => el.remove());
      updateAnswer(currentTask!.lastAIText);
    } else {
      appendToResult('<div class="mole-status"><span class="dot"></span>已完成处理。</div>');
    }
    renderTaskRuntimeBoard();
    updateInputUI();
    saveSnapshot();
  };

  const handleTurnAbortedEvent = (content: string) => {
    const lifecycle = parseTurnLifecycleEvent(content, 'error');
    const previousErrorMsg = currentTask!.errorMsg;
    const { ignored } = applyTurnLifecycleToTask(lifecycle);
    if (ignored) return;
    if (!previousErrorMsg || previousErrorMsg !== currentTask!.errorMsg) {
      appendToResult(`<div class="mole-error">\u26A0 ${escapeHtml(currentTask!.errorMsg)}</div>`);
    }
    renderTaskRuntimeBoard();
    updateInputUI();
    saveSnapshot();
  };

  const handleTaskLifecycleEvent = (
    eventType: 'entered_review_mode' | 'exited_review_mode' | 'context_compacted',
    content: string,
  ) => {
    const lifecycle = parseTaskLifecycleContent(content);
    if (!applyTaskLifecycleToTask(lifecycle)) return;
    if (eventType === 'exited_review_mode' && lifecycle.reviewOutput) {
      renderReviewOutputPayload(lifecycle.reviewOutput);
    }
    if (lifecycle.status === 'error' && lifecycle.message) {
      appendToResult(`<div class="mole-error">\u26A0 ${escapeHtml(lifecycle.message)}</div>`);
      updateInputUI();
    } else if (lifecycle.message) {
      const friendlyText = toFriendlyPlanningText(lifecycle.message);
      syncLiveStatusText(friendlyText);
    }
    saveSnapshot();
  };

  const handleThreadRolledBackEvent = (content: string) => {
    try {
      const parsed = JSON.parse(content);
      const numTurns = Number.isFinite(Number(parsed?.numTurns)) ? Math.max(1, Math.floor(Number(parsed.numTurns))) : 1;
      const source = String(parsed?.source || '').trim().toLowerCase();
      appendToResult(`<div class="mole-status"><span class="dot"></span>已回滚最近 ${numTurns} 轮${source === 'undo' ? '（撤销）' : ''}。</div>`);
    } catch {
      appendToResult('<div class="mole-status"><span class="dot"></span>已回滚最近会话轮次。</div>');
    }
    if (currentTask) {
      currentTask.status = 'done';
      currentTask.failureCode = '';
      currentTask.errorMsg = '';
      currentTask.endedAt = Date.now();
      currentTask.durationMs = Math.max(0, currentTask.endedAt - currentTask.startedAt);
    }
    updateInputUI();
    saveSnapshot();
  };

  const handleAgentStateEvent = (content: string) => {
    syncAgentState(content);
    saveSnapshot();
  };

  const handlePlanningEvent = (content: string) => {
    const friendlyText = toFriendlyPlanningText(content);
    syncLiveStatusText(friendlyText);
    appendProcessEntry(friendlyText, { tone: 'status' });
    saveSnapshot();
  };

  const handleWarningEvent = (content: string) => {
    const friendlyText = toFriendlyPlanningText(content);
    syncLiveStatusText(friendlyText);
    appendProcessEntry(friendlyText, { tone: 'issue' });
    saveSnapshot();
  };

  const handleThinkingEvent = (content: string) => {
    currentTask!.callStack = [];
    if (!isGenericThinkingText(content) || !currentTask?.liveStatusText) {
      syncLiveStatusText(content);
      appendProcessEntry(sanitizeUserFacingRuntimeText(content, 'current', '我正在继续处理'), { tone: 'status' });
    }
    saveSnapshot();
  };

  const handleErrorEvent = (content: string) => {
    const parsedError = parseErrorEventContent(content);
    currentTask!.status = 'error';
    currentTask!.errorMsg = parsedError.message;
    currentTask!.failureCode = parsedError.code || currentTask!.failureCode || 'E_UNKNOWN';
    if (!currentTask!.endedAt) {
      currentTask!.endedAt = Date.now();
    }
    if (currentTask!.durationMs == null) {
      currentTask!.durationMs = Math.max(0, currentTask!.endedAt - currentTask!.startedAt);
    }
    // API Key 未配置：提示用户前往 Options 页面
    if (currentTask!.failureCode === 'E_AUTH_REQUIRED' || parsedError.message.includes('请先登录')) {
      appendToResult(`<div class="mole-error">\u26A0 请在 Options 页面配置 API Key</div>`);
      updateInputUI();
      saveSnapshot();
      return;
    }
    appendToResult(`<div class="mole-error">\u26A0 ${escapeHtml(parsedError.message)}</div>`);
    updateInputUI();
    saveSnapshot();
  };

  const handleQueueUpdatedEvent = (content: string) => {
    if (!content) return;
    try {
      const payload = JSON.parse(content);
      if (!payload || typeof payload !== 'object') return;
      if (currentTask) {
        if (payload.opQueue && typeof payload.opQueue === 'object') {
          currentTask.opQueue = payload.opQueue as SessionOpQueueSnapshot;
        }
      }
      updateInputUI();
      saveSnapshot();
    } catch {
      // ignore malformed payload
    }
  };

  // ---- 确认卡片处理 ----

  /** 渲染确认卡片（直接展示在结果区，不折叠在工具调用里） */
  const handleApprovalRequest = (requestId: string, message: string) => {
    if (!requestId || !message) return;

    // 如果面板未打开，自动展开
    if (!isOpen) {
      isOpen = true;
      panel.classList.add('show');
      trigger.classList.add('open');
    }

    // 在 resultEl 中直接追加独立确认卡片
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
    resultEl.appendChild(wrapper);
    showResult();

    // 胶囊提示
    showPillNotice('等待确认', 'info');

    // 悬浮球迷你操作卡片（不展开面板也能操作）
    showPillApprovalCard(requestId, message);

    resultEl.scrollTop = resultEl.scrollHeight;
    saveSnapshot();
  };

  /** 禁用确认卡片并显示结果 */
  const disableApprovalCard = (card: HTMLElement, approved: boolean) => {
    card.classList.add('settled');
    // 禁用所有按钮
    card.querySelectorAll('button').forEach(btn => {
      (btn as HTMLButtonElement).disabled = true;
    });
    // 隐藏拒绝输入框
    const rejectInput = card.querySelector('.mole-approval-reject-input') as HTMLElement;
    if (rejectInput) rejectInput.classList.remove('open');

    // 添加结果提示
    const resultText = document.createElement('div');
    resultText.className = 'mole-approval-result';
    resultText.textContent = approved ? '✓ 已批准' : '✗ 已拒绝';
    card.appendChild(resultText);

    // 更新独立卡片外层状态
    const standalone = card.closest('.mole-approval-standalone') as HTMLElement;
    if (standalone) {
      standalone.classList.add('settled');
      const titleEl = standalone.querySelector('.mole-approval-header-bar span') as HTMLElement;
      if (titleEl) titleEl.textContent = approved ? '已批准' : '已拒绝';
    }

    // 收起悬浮球迷你操作卡片
    hidePillActionCard();

    saveSnapshot();
  };

  /** 取消确认卡片 */
  const handleApprovalCancel = (requestId: string) => {
    if (!requestId) return;
    const card = resultEl.querySelector(`.mole-approval-card[data-request-id="${requestId}"]`) as HTMLElement;
    if (!card || card.classList.contains('settled')) return;

    card.classList.add('settled');
    card.querySelectorAll('button').forEach(btn => {
      (btn as HTMLButtonElement).disabled = true;
    });
    const rejectInput = card.querySelector('.mole-approval-reject-input') as HTMLElement;
    if (rejectInput) rejectInput.classList.remove('open');

    const resultText = document.createElement('div');
    resultText.className = 'mole-approval-result';
    resultText.textContent = '已取消';
    card.appendChild(resultText);

    // 更新独立卡片外层状态
    const standalone = card.closest('.mole-approval-standalone') as HTMLElement;
    if (standalone) {
      standalone.classList.add('settled');
      const titleEl = standalone.querySelector('.mole-approval-header-bar span') as HTMLElement;
      if (titleEl) titleEl.textContent = '已取消';
    }

    saveSnapshot();
  };

  // ---- 提问卡片处理（ask_user）----

  /** 渲染提问卡片（直接展示在结果区） */
  const handleAskUserRequest = (
    requestId: string,
    question: string,
    options?: string[],
    allowFreeText?: boolean,
  ) => {
    if (!requestId || !question) return;

    // 如果面板未打开，自动展开（与确认卡片一致）
    if (!isOpen) {
      isOpen = true;
      overlay.classList.add('visible');
      trigger.classList.add('active');
    }

    // 构建选项按钮 HTML
    const optionsHtml = options && options.length > 0
      ? `<div class="mole-ask-user-options">
          ${options.map((opt, idx) => `<button class="mole-ask-user-option" data-index="${idx}">${escapeHtml(opt)}</button>`).join('')}
        </div>`
      : '';

    // 构建文本输入行 HTML
    const inputRowHtml = allowFreeText !== false
      ? `<div class="mole-ask-user-input-row">
          <input class="mole-ask-user-text" placeholder="${options && options.length > 0 ? '或者直接输入...' : '请输入你的回答...'}" />
          <button class="mole-ask-user-submit">发送</button>
        </div>`
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
    resultEl.appendChild(wrapper);
    showResult();

    // 胶囊提示
    showPillNotice('等待回答', 'info');

    // 悬浮球迷你操作卡片（不展开面板也能操作）
    showPillAskUserCard(requestId, question, options, allowFreeText);

    resultEl.scrollTop = resultEl.scrollHeight;
    saveSnapshot();
  };

  /** 禁用提问卡片并显示回答结果 */
  const disableAskUserCard = (requestId: string, answer: string, source: 'option' | 'text') => {
    const card = resultEl.querySelector(`.mole-ask-user-card[data-request-id="${requestId}"]`) as HTMLElement;
    if (!card || card.classList.contains('settled')) return;

    card.classList.add('settled');

    // 禁用所有按钮和输入框
    card.querySelectorAll('button').forEach(btn => {
      (btn as HTMLButtonElement).disabled = true;
    });
    const textInput = card.querySelector('.mole-ask-user-text') as HTMLInputElement;
    if (textInput) textInput.disabled = true;

    // 高亮选中的选项
    if (source === 'option') {
      card.querySelectorAll('.mole-ask-user-option').forEach(btn => {
        if (btn.textContent === answer) {
          btn.classList.add('selected');
        }
      });
    }

    // 添加结果提示
    const resultText = document.createElement('div');
    resultText.className = 'mole-ask-user-result';
    resultText.textContent = `已回答：${answer}`;
    card.appendChild(resultText);

    // 更新外层卡片状态
    const standalone = card.closest('.mole-ask-user-standalone') as HTMLElement;
    if (standalone) {
      standalone.classList.add('settled');
      const titleEl = standalone.querySelector('.mole-ask-user-header-bar span') as HTMLElement;
      if (titleEl) titleEl.textContent = '已回答';
    }

    // 收起悬浮球迷你操作卡片
    hidePillActionCard();

    saveSnapshot();
  };

  /** 取消提问卡片 */
  const handleAskUserCancel = (requestId: string) => {
    if (!requestId) return;
    const card = resultEl.querySelector(`.mole-ask-user-card[data-request-id="${requestId}"]`) as HTMLElement;
    if (!card || card.classList.contains('settled')) return;

    card.classList.add('settled');
    card.querySelectorAll('button').forEach(btn => {
      (btn as HTMLButtonElement).disabled = true;
    });
    const textInput = card.querySelector('.mole-ask-user-text') as HTMLInputElement;
    if (textInput) textInput.disabled = true;

    const resultText = document.createElement('div');
    resultText.className = 'mole-ask-user-result';
    resultText.textContent = '已取消';
    card.appendChild(resultText);

    const standalone = card.closest('.mole-ask-user-standalone') as HTMLElement;
    if (standalone) {
      standalone.classList.add('settled');
      const titleEl = standalone.querySelector('.mole-ask-user-header-bar span') as HTMLElement;
      if (titleEl) titleEl.textContent = '已取消';
    }

    hidePillActionCard();
    saveSnapshot();
  };

  const directEventHandlers: Record<string, (content: string) => void> = {
    turn_started: handleTurnStartedEvent,
    turn_completed: handleTurnCompletedEvent,
    turn_aborted: handleTurnAbortedEvent,
    thread_rolled_back: handleThreadRolledBackEvent,
    entered_review_mode: (content: string) => handleTaskLifecycleEvent('entered_review_mode', content),
    exited_review_mode: (content: string) => handleTaskLifecycleEvent('exited_review_mode', content),
    context_compacted: (content: string) => handleTaskLifecycleEvent('context_compacted', content),
    agent_state: handleAgentStateEvent,
    planning: handlePlanningEvent,
    warning: handleWarningEvent,
    thinking: handleThinkingEvent,
    error: handleErrorEvent,
    queue_updated: handleQueueUpdatedEvent,
  };

  const findTargetCallItem = (callId: string): Element | null => {
    const activeGroup = resultEl.querySelector('.mole-calls-group:not(.frozen)');
    const callItems = activeGroup ? activeGroup.querySelectorAll('.mole-call-item') : resultEl.querySelectorAll('.mole-call-item');
    if (callId) {
      const matched = Array.from(callItems).find((item) => item.getAttribute('data-call-id') === callId);
      if (matched) return matched;
    }
    return callItems.length > 0 ? callItems[callItems.length - 1] : null;
  };

  const appendToolArtifactSection = (section: HTMLElement, callId: string) => {
    const targetItem = findTargetCallItem(callId);
    const body = targetItem?.querySelector('.mole-call-body');
    if (body instanceof HTMLElement) {
      body.appendChild(section);
      const header = targetItem?.querySelector('.mole-call-header');
      if (header instanceof HTMLElement) {
        header.classList.add('has-body');
      }
      return;
    }
    resultEl.appendChild(section);
  };

  const handleToolGroupStartEvent = (content: string) => {
    try {
      const groupInfo = JSON.parse(content);
      const { summary } = ensureCallsGroup();
      const textEl = summary.querySelector('.calls-text');
      if (textEl) {
        textEl.textContent = toFriendlyToolProgress(Number(groupInfo.toolCount) || 0);
      }
    } catch {
      // ignore malformed payload
    }
    saveSnapshot();
  };

  const handleFunctionCallEvent = (content: string) => {
    const callMeta = parseFunctionCallEvent(content);
    const funcName = callMeta.name;

    // todo 调用不显示在执行过程列表中（有独立视图）
    if (funcName === 'todo') {
      saveSnapshot();
      return;
    }

    const icon = FUNCTION_ICONS[funcName] || '';
    const label = FUNCTION_LABELS[funcName] || funcName || '操作执行';
    const intentText = buildToolIntentText(funcName, callMeta.summary);
    const userSummary = buildUserFacingActionSummary(funcName, callMeta.summary, label);

    currentTask!.callStack.push({ funcName, icon, text: label, userSummary });
    if (intentText) {
      syncLiveStatusText(intentText);
    }

    appendProcessEntry(intentText || userSummary || label, {
      tone: 'action',
      icon,
      subtext: label && intentText && label !== intentText ? label : '',
      callId: callMeta.callId || undefined,
    });
    saveSnapshot();
  };

  const handleFunctionResultEvent = (content: string) => {
    const resultMeta = parseFunctionResultEvent(content);
    const targetItem = findTargetCallItem(resultMeta.callId);

    if (targetItem) {
      if (resultMeta.cancelled) {
        updateProcessEntryStatus(targetItem, {
          tone: 'issue',
          statusLabel: '取消',
          subtext: resultMeta.message || '这一步已取消',
        });
      } else if (!resultMeta.success) {
        updateProcessEntryStatus(targetItem, {
          tone: 'issue',
          statusLabel: '失败',
          subtext: sanitizeUserFacingRuntimeText(resultMeta.message || '这一步没有成功，我正在调整', 'issue', '这一步没有成功，我正在调整'),
        });
      } else {
        updateProcessEntryStatus(targetItem, {
          tone: 'done',
          statusLabel: '完成',
          subtext: resultMeta.message ? sanitizeUserFacingRuntimeText(resultMeta.message, 'done', '') : '',
        });
      }
    } else if (!resultMeta.success && resultMeta.message) {
      appendProcessEntry(sanitizeUserFacingRuntimeText(resultMeta.message, 'issue', '这一步没有成功，我正在调整'), { tone: 'issue' });
    }
    updateCallsSummary();
    saveSnapshot();
  };

  const handleSearchResultsEvent = (content: string) => {
    const statusEls = resultEl.querySelectorAll('.mole-status');
    statusEls.forEach(el => el.remove());

    try {
      const searchData = JSON.parse(content);
      const items = searchData.results || [];
      const eventCallId = typeof searchData.callId === 'string' ? searchData.callId : '';

      const section = document.createElement('div');
      section.className = 'mole-search-section';

      let html = `<div class="mole-result-count">找到 ${items.length} 条结果 \u00B7 关键词「${escapeHtml(searchData.keyword || '')}」</div>`;
      html += '<div class="mole-search-results">';
      for (const item of items) {
        const thumbHtml = item.imageUrl
          ? `<img class="mole-result-thumb" src="${escapeHtml(item.imageUrl)}" alt="" referrerpolicy="no-referrer" />`
          : '';
        html += `<div class="mole-result-card" data-url="${escapeHtml(item.url)}">`;
        html += thumbHtml;
        html += '<div class="mole-result-body">';
        html += `<a class="mole-result-title" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a>`;
        if (item.price) {
          html += `<div class="mole-result-snippet" style="color:#d70015;font-weight:500">${escapeHtml(item.price)}${item.shop ? ' \u00B7 ' + escapeHtml(item.shop) : ''}</div>`;
        } else if (item.snippet) {
          html += `<div class="mole-result-snippet">${escapeHtml(item.snippet)}</div>`;
        }
        if (item.source) {
          html += `<div class="mole-result-source">${escapeHtml(item.source)}</div>`;
        }
        html += '</div></div>';
      }
      html += '</div>';
      section.innerHTML = html;

      appendToolArtifactSection(section, eventCallId);
      showResult();
    } catch {
      appendToResult('<div class="mole-error">结果解析失败</div>');
    }
    saveSnapshot();
  };

  const handleScreenshotDataEvent = (content: string) => {
    try {
      const imgData = JSON.parse(content);
      const eventCallId = typeof imgData.callId === 'string' ? imgData.callId : '';
      const hasImage = typeof imgData.dataUrl === 'string' && imgData.dataUrl.length > 0;
      const section = document.createElement('div');
      section.className = 'mole-screenshot-section';
      const screenshotMeta = `${imgData.format || 'png'} \u00B7 ${imgData.sizeKB || '?'}KB`;
      section.setAttribute('data-image-src', hasImage ? String(imgData.dataUrl) : '');
      section.setAttribute('data-image-meta', `截图预览（${screenshotMeta}）`);
      section.innerHTML = `
        <div class="mole-screenshot-header">
          <div class="mole-screenshot-meta">
            <div class="mole-screenshot-label">\u{1F4F8} 截图已完成</div>
            <div class="mole-screenshot-sub">${escapeHtml(screenshotMeta)}</div>
          </div>
          ${hasImage ? '<button class="mole-screenshot-open" type="button">预览</button>' : ''}
        </div>
        ${hasImage
          ? `<div class=\"mole-screenshot-img-wrap\"><img class=\"mole-screenshot-img\" src=\"${escapeHtml(imgData.dataUrl)}\" data-full-src=\"${escapeHtml(imgData.dataUrl)}\" alt=\"页面截图\" loading=\"lazy\" /><span class=\"mole-screenshot-hint\">点击放大</span></div>`
          : `<div class=\"mole-screenshot-artifact\">已保存截图资源：${escapeHtml(imgData.artifactId || '--')}</div>`}
      `;

      appendToolArtifactSection(section, eventCallId);
      showResult();
    } catch {
      // ignore malformed payload
    }
    saveSnapshot();
  };

  const handlePageAssertDataEvent = (content: string) => {
    try {
      const payload = JSON.parse(content);
      const eventCallId = typeof payload.callId === 'string' ? payload.callId : '';
      const results = Array.isArray(payload.results) ? payload.results : [];
      const passed = payload.passed === true;
      const section = document.createElement('div');
      section.className = 'mole-verify-section';
      section.innerHTML = `
        <div class="mole-verify-header">
          <div>
            <div class="mole-verify-title">✅ 页面验证</div>
            <div class="mole-verify-sub">${escapeHtml(payload.message || '')}</div>
          </div>
          <div class="mole-verify-badge ${passed ? 'ok' : 'fail'}">${passed ? '通过' : '未通过'}</div>
        </div>
      `;
      const list = document.createElement('div');
      list.className = 'mole-verify-list';
      for (const item of results.slice(0, 5)) {
        const row = document.createElement('div');
        row.className = `mole-verify-item ${item?.passed ? '' : 'fail'}`;
        row.innerHTML = `
          <div>${item?.passed ? '✓' : '✗'} ${escapeHtml(item?.type || '')}</div>
          <div class="mole-verify-sub">${escapeHtml(item?.detail || '')}</div>
        `;
        list.appendChild(row);
      }
      section.appendChild(list);
      appendToolArtifactSection(section, eventCallId);
      showResult();
    } catch {
      // ignore malformed payload
    }
    saveSnapshot();
  };

  const handlePageRepairDataEvent = (content: string) => {
    try {
      const payload = JSON.parse(content);
      const eventCallId = typeof payload.callId === 'string' ? payload.callId : '';
      const repaired = payload.repaired === true;
      const trace = Array.isArray(payload.trace) ? payload.trace : [];
      const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
      const section = document.createElement('div');
      section.className = 'mole-repair-section';
      section.innerHTML = `
        <div class="mole-repair-header">
          <div>
            <div class="mole-repair-title">🛠️ 自动修复</div>
            <div class="mole-repair-sub">${escapeHtml(payload.message || '')}${payload?.experience_domain ? ` · 域名=${escapeHtml(payload.experience_domain)}` : ''}${typeof payload?.experience_matches === 'number' && payload.experience_matches > 0 ? ` · 经验命中=${payload.experience_matches}` : ''}</div>
          </div>
          <div class="mole-repair-badge ${repaired ? 'ok' : 'fail'}">${repaired ? '找到候选' : '待人工判断'}</div>
        </div>
      `;

      const list = document.createElement('div');
      list.className = 'mole-repair-list';
      for (const item of trace.slice(0, 6)) {
        const row = document.createElement('div');
        row.className = 'mole-repair-item';
        row.innerHTML = `
          <div class="mole-repair-item-head">
            <span>${escapeHtml(item?.step || '')}</span>
            <span>${item?.success ? '✓' : '✗'}${typeof item?.candidate_count === 'number' ? ` · ${item.candidate_count}` : ''}</span>
          </div>
          <div class="mole-repair-sub">${escapeHtml(item?.note || item?.error || '')}${item?.query ? ` · query=${escapeHtml(item.query)}` : ''}</div>
        `;
        list.appendChild(row);
      }
      section.appendChild(list);

      if (candidates.length > 0) {
        const candidateWrap = document.createElement('div');
        candidateWrap.className = 'mole-repair-candidates';
        for (const candidate of candidates.slice(0, 4)) {
          const row = document.createElement('div');
          row.className = 'mole-repair-candidate';
          const title = candidate?.label || candidate?.text || candidate?.placeholder || candidate?.tag || candidate?.element_id || '--';
          const meta = [candidate?.tag, candidate?.clickable ? 'clickable' : '', candidate?.editable ? 'editable' : '', candidate?.visible ? 'visible' : '']
            .filter(Boolean)
            .join(' · ');
          row.innerHTML = `
            <div>${escapeHtml(title)}</div>
            <div class="mole-repair-sub">${escapeHtml(meta)}${candidate?.repair_queries?.length ? ` · hints=${escapeHtml(candidate.repair_queries.join(', '))}` : ''}</div>
          `;
          candidateWrap.appendChild(row);
        }
        section.appendChild(candidateWrap);
      }

      appendToolArtifactSection(section, eventCallId);
      showResult();
    } catch {
      // ignore malformed payload
    }
    saveSnapshot();
  };

  const handleTextEvent = (content: string) => {
    currentTask!.lastAIText = content;

    // 清除临时状态提示
    const statusEls = resultEl.querySelectorAll('.mole-status, .mole-planning');
    statusEls.forEach(el => el.remove());

    // 自动折叠工具调用组，让文本区成为焦点
    const activeGroup = resultEl.querySelector('.mole-calls-group:not(.frozen)');
    if (activeGroup) {
      const detailEl = activeGroup.querySelector('.mole-calls-detail');
      const arrowEl = activeGroup.querySelector('.arrow');
      if (detailEl && detailEl.classList.contains('open')) {
        detailEl.classList.remove('open');
        arrowEl?.classList.remove('open');
      }
    }

    updateAnswer(content);
    saveSnapshot();
  };

  const handleCardsEvent = (content: string) => {
    try {
      const cards = JSON.parse(content) as Array<{
        title: string; price: string; shop?: string; url: string; tag?: string;
      }>;
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
              <div class="mole-rec-card-meta">${metaParts.join(' \u00B7 ')}</div>
            </div>
            ${tagHtml}
            <span class="mole-rec-arrow">\u203A</span>
          </a>
        `;
      }
      resultEl.appendChild(cardsEl);
      showResult();
      resultEl.scrollTop = resultEl.scrollHeight;
    } catch {
      // ignore malformed payload
    }
    saveSnapshot();
  };

  // ── Todo 进度视图 ──

  /** 渲染 todo 独立进度视图 */
  const renderTodoBoard = (items: { id: number; title: string; status: string; result?: string }[], stats: { total: number; completed: number }) => {
    const panel = resultEl.querySelector('.mole-agent-state-panel:not(.frozen)') as HTMLElement | null;
    if (!panel) return;
    const board = panel.querySelector('.mole-todo-board') as HTMLElement | null;
    if (!board) return;

    if (!items || items.length === 0) {
      board.innerHTML = '';
      return;
    }

    const rows = items.map(item => {
      const icon = item.status === 'completed' ? '✓'
                 : item.status === 'in_progress' ? '›'
                 : '○';
      const cls = item.status === 'completed' ? 'done'
                : item.status === 'in_progress' ? 'active'
                : 'pending';
      const resultSuffix = item.result ? ` → ${escapeHtml(item.result)}` : '';
      return `<div class="mole-todo-item ${cls}"><span class="mole-todo-icon">${icon}</span><span class="mole-todo-text">#${item.id} ${escapeHtml(item.title)}${resultSuffix}</span></div>`;
    }).join('');

    const progress = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
    board.innerHTML = `
      <div class="mole-todo-header">
        <span class="mole-todo-label">任务计划</span>
        <span class="mole-todo-stats">${stats.completed}/${stats.total}</span>
      </div>
      <div class="mole-todo-progress-bar"><div class="mole-todo-progress-fill" style="width:${progress}%"></div></div>
      <div class="mole-todo-list">${rows}</div>
    `;
  };

  const handleTodoUpdateEvent = (content: string) => {
    try {
      const parsed = JSON.parse(content);
      if (parsed && Array.isArray(parsed.items)) {
        renderTodoBoard(parsed.items, parsed.stats || { total: parsed.items.length, completed: 0 });
      }
    } catch {
      // ignore malformed payload
    }
    saveSnapshot();
  };

  const streamEventHandlers: Record<string, (content: string) => void> = {
    tool_group_start: handleToolGroupStartEvent,
    function_call: handleFunctionCallEvent,
    function_result: handleFunctionResultEvent,
    search_results: handleSearchResultsEvent,
    screenshot_data: handleScreenshotDataEvent,
    page_assert_data: handlePageAssertDataEvent,
    page_repair_data: handlePageRepairDataEvent,
    text: handleTextEvent,
    cards: handleCardsEvent,
    todo_update: handleTodoUpdateEvent,
  };

  const handleAIStream = (data: any) => {
    if (!data) return;
    // sessionId/taskId 过滤：丢弃不属于当前任务的事件
    const eventId = data.sessionId || data.taskId;
    if (!currentTask || eventId !== currentTask.id) return;

    const rawType = String(data.type || '');
    const type = normalizeIncomingEventType(rawType);
    const content = data.content;

    const directHandler = directEventHandlers[type];
    if (directHandler) {
      directHandler(content);
      return;
    }
    const handler = streamEventHandlers[type];
    if (handler) {
      handler(content);
    }
  };

  const requestSessionReplay = (
    sessionId: string,
    scope: 'latest_turn' | 'delta' | 'full',
    fromEventCount?: number,
  ) => {
    Channel.send('__session_replay_request', {
      sessionId,
      scope,
      ...(typeof fromEventCount === 'number' ? { fromEventCount } : {}),
    });
  };

  // 注册 AI 流式事件监听
  Channel.on('__ai_stream', handleAIStream);

  // 注册确认请求/取消监听
  Channel.on('__approval_request', (data: any) => {
    handleApprovalRequest(data?.requestId, data?.message);
  });
  Channel.on('__approval_cancel', (data: any) => {
    handleApprovalCancel(data?.requestId);
  });
  // 确认卡片跨标签页同步：用户在其他 tab 响应后，本 tab 卡片同步更新
  Channel.on('__approval_settled', (data: any) => {
    const { requestId, approved, trustAll } = data || {};
    if (!requestId) return;
    const card = resultEl.querySelector(
      `.mole-approval-card[data-request-id="${requestId}"]`,
    ) as HTMLElement;
    if (card && !card.classList.contains('settled')) {
      disableApprovalCard(card, !!approved);
      if (trustAll) {
        const headerSpan = card.closest('.mole-approval-standalone')
          ?.querySelector('.mole-approval-header-bar span');
        if (headerSpan) headerSpan.textContent = '已批准（本次不再询问）';
      }
    }
  });

  // 截图时临时隐藏/恢复悬浮球，避免遮挡页面内容
  Channel.on('__screenshot_hide', (_data: any, _sender, sendResponse) => {
    host.style.display = 'none';
    sendResponse?.({ ok: true });
    return true;
  });
  Channel.on('__screenshot_show', () => {
    host.style.display = '';
  });

  // 确认卡片附言输入框 Enter 键提交
  resultEl.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    if (e.key !== 'Enter' || !target.classList.contains('mole-approval-reject-text')) return;
    e.preventDefault();
    const card = target.closest('.mole-approval-card') as HTMLElement;
    if (!card || card.classList.contains('settled')) return;
    const confirmBtn = card.querySelector('.mole-approval-reject-confirm') as HTMLElement;
    if (confirmBtn) confirmBtn.click();
  });

  // 注册提问请求/取消监听（ask_user）
  Channel.on('__ask_user_request', (data: any) => {
    handleAskUserRequest(data?.requestId, data?.question, data?.options, data?.allowFreeText);
  });
  Channel.on('__ask_user_cancel', (data: any) => {
    handleAskUserCancel(data?.requestId);
  });
  // 提问卡片跨标签页同步：用户在其他 tab 回答后，本 tab 卡片同步更新
  Channel.on('__ask_user_settled', (data: any) => {
    const { requestId, answer, source } = data || {};
    if (!requestId) return;
    const card = resultEl.querySelector(
      `.mole-ask-user-card[data-request-id="${requestId}"]`,
    ) as HTMLElement;
    if (card && !card.classList.contains('settled')) {
      disableAskUserCard(requestId, answer || '', source || 'text');
    }
  });

  // 提问卡片文本输入框 Enter 键提交
  resultEl.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    if (e.key !== 'Enter' || !target.classList.contains('mole-ask-user-text')) return;
    e.preventDefault();
    const card = target.closest('.mole-ask-user-card') as HTMLElement;
    if (!card || card.classList.contains('settled')) return;
    const submitBtn = card.querySelector('.mole-ask-user-submit') as HTMLElement;
    if (submitBtn) submitBtn.click();
  });

  // 注册定时器触发事件监听：自动创建任务以接收后续的 AI 流式事件
  Channel.on('__ai_timer_trigger', (data: any) => {
    if (!data?.taskId || !data?.action) return;

    // 自动创建任务（使用 sessionId 或 taskId）

    currentTask = {
      id: data.sessionId || data.taskId,
      query: data.action,
      title: buildTaskTitle(data.summary || data.action),
      status: 'running',
      resultHtml: '',
      callStack: [],
      errorMsg: '',
      lastAIText: '',
      agentPhase: 'plan',
      agentRound: 0,
      failureCode: '',
      liveStatusText: '',
      startedAt: Date.now(),
      endedAt: null,
      durationMs: null,
      taskKind: 'aux',
    };

    // 打开搜索框显示结果
    toggleSearch(true);
    updateInputUI();

    // 显示定时器触发提示
    const timerLabel = data.timerType === 'interval' ? '周期任务' : '定时任务';
    setStatus(`<div class="mole-planning"><span class="dot"></span>${timerLabel}触发：${escapeHtml(data.action)}</div>`);
  });

  // ---- 会话同步监听：接收 background 广播的会话状态变更 ----
  Channel.on('__session_sync', (data: SessionSyncPayload | null | undefined) => {
    if (!data?.sessionId) return;

    // 同步 originTabId
    if (typeof data.originTabId === 'number') {
      sessionOriginTabId = data.originTabId;
    } else if (data.originTabId === undefined || data.originTabId === null) {
      sessionOriginTabId = undefined;
    }

    // 如果是 cleared 状态，清理本地
    if (data.status === 'cleared') {
      if (currentTask && currentTask.id === data.sessionId) {
        clearPillNotice();
        trigger.classList.remove('announce');
        currentTask = null;
        sessionOriginTabId = undefined;
        resetReplayCursor();
        clearReplayCache();
        hideResult();
        updateInputUI();
      }
      return;
    }

    // 同步状态到当前任务
    if (currentTask && currentTask.id === data.sessionId) {
      if (data.status === 'running' || data.status === 'done' || data.status === 'error') {
        ensureReplayCacheSession(data.sessionId);
        const previousKnownReplayCount = replayKnownEventCount;
        const targetReplayEventCount = typeof data.replayEventCount === 'number' && data.replayEventCount >= 0
          ? data.replayEventCount
          : previousKnownReplayCount;
        const shouldRequestDeltaReplay = targetReplayEventCount > replayAppliedEventCount
          && !currentTask.resultHtml
          && replayAppliedEventCount > 0;
        currentTask.status = data.status;
        if (typeof data.activeRunId === 'string' || data.activeRunId === null) {
          currentTask.activeRunId = data.activeRunId;
        }
        if (typeof data.summary === 'string' && data.summary.trim()) {
          currentTask.title = buildTaskTitle(data.summary);
        }
        if (data.agentState) {
          currentTask.agentPhase = data.agentState.phase || currentTask.agentPhase;
          currentTask.agentRound = data.agentState.round || currentTask.agentRound;
        }
        if (typeof data.lastError === 'string' && data.lastError.trim()) {
          currentTask.liveStatusText = data.lastError.trim();
        }
        if (typeof data.startedAt === 'number') currentTask.startedAt = data.startedAt;
        currentTask.endedAt = typeof data.endedAt === 'number' ? data.endedAt : null;
        currentTask.durationMs = typeof data.durationMs === 'number' ? data.durationMs : null;
        currentTask.failureCode = data.failureCode || '';
        if (typeof data.hasContext === 'boolean') {
          currentTask.hasContext = data.hasContext;
        }
        currentTask.taskKind = typeof data.taskKind === 'string' ? data.taskKind : currentTask.taskKind;
        if (data.opQueue && typeof data.opQueue === 'object') {
          currentTask.opQueue = data.opQueue;
        }
        replayKnownEventCount = targetReplayEventCount;
        if (typeof data.replayLastTimestamp === 'number' && data.replayLastTimestamp > replayLastTimestamp) {
          replayLastTimestamp = data.replayLastTimestamp;
        }
        if (data.lastError) {
          currentTask.errorMsg = data.lastError;
        }
        if (shouldRequestDeltaReplay) {
          requestSessionReplay(data.sessionId, 'delta', replayAppliedEventCount);
        }
        renderTaskRuntimeBoard();
        updateInputUI();
      }
    } else if (!currentTask && data.status === 'running') {
      // 其他标签页发起了新会话，本标签页跟踪该会话以同步状态
      ensureReplayCacheSession(data.sessionId);
      replayAppliedEventCount = 0;
      replayLastTimestamp = 0;
      currentTask = {
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
      replayKnownEventCount = typeof data.replayEventCount === 'number' && data.replayEventCount >= 0
        ? data.replayEventCount
        : 0;
      requestSessionReplay(data.sessionId, 'latest_turn');
      renderTaskRuntimeBoard();
      updateInputUI();
    }
  });

  Channel.on('__mole_takeover_state', (data: any) => {
    const changed = applyTakeoverStatePayload(data);
    if (!changed) return;
    if (isTakeoverActive()) {
      const takeoverNotice = getTakeoverNoticeText();
      if (takeoverNotice) {
        showPillNotice(takeoverNotice, 'info');
      }
    }
    updateInputUI();
    saveSnapshot();
  });

  // ---- 后台任务变更监听 ----
  Channel.on('__bg_tasks_changed', (data: any) => {
    bgTasksData = data;
    updateBgTaskBadge();
    renderBgTasksPanel();
  });

  // ---- 事件回放监听：收到 background 发送的完整事件日志，重建 UI ----
  Channel.on('__session_replay', (data: SessionReplayPayload | null | undefined) => {
    if (!data?.sessionId || !Array.isArray(data.events)) return;
    if (!currentTask || data.sessionId !== currentTask.id) return;
    ensureReplayCacheSession(data.sessionId);
    const replayScope = data.scope === 'delta' || data.scope === 'full' ? data.scope : 'latest_turn';
    const baseStart = Number.isFinite(Number(data.fromEventCount)) ? Math.max(0, Math.floor(Number(data.fromEventCount))) : 0;
    const payloadEnd = baseStart + data.events.length;
    const payloadKnownCount = typeof data.eventCount === 'number'
      ? Math.max(payloadEnd, Math.max(0, data.eventCount))
      : payloadEnd;
    const hasReplaySnapshot = Boolean(currentTask.resultHtml);

    if (replayScope !== 'delta' && tryApplyReplayRunSnapshot(data)) {
      replayKnownEventCount = Math.max(replayKnownEventCount, payloadKnownCount);
      if (typeof data.lastTimestamp === 'number' && data.lastTimestamp > replayLastTimestamp) {
        replayLastTimestamp = data.lastTimestamp;
      }
      updateInputUI();
      return;
    }

    if (replayScope !== 'delta' && hasReplaySnapshot && replayAppliedEventCount >= payloadEnd) {
      replayKnownEventCount = Math.max(replayKnownEventCount, payloadKnownCount);
      if (typeof data.lastTimestamp === 'number' && data.lastTimestamp > replayLastTimestamp) {
        replayLastTimestamp = data.lastTimestamp;
      }
      return;
    }

    let replayEvents = data.events.slice();
    let normalizedStart = baseStart;
    if (replayScope === 'delta' && replayAppliedEventCount > normalizedStart) {
      const skipCount = Math.min(replayEvents.length, replayAppliedEventCount - normalizedStart);
      replayEvents = replayEvents.slice(skipCount);
      normalizedStart += skipCount;
    }
    if (replayScope === 'delta' && replayEvents.length === 0) {
      replayKnownEventCount = Math.max(replayKnownEventCount, payloadKnownCount);
      if (typeof data.lastTimestamp === 'number' && data.lastTimestamp > replayLastTimestamp) {
        replayLastTimestamp = data.lastTimestamp;
      }
      return;
    }

    const shouldResetView = replayScope !== 'delta';

    if (shouldResetView) {
      // 清空结果区，逐个重放事件重建 UI
      hideResult();
      currentTask.callStack = [];
      currentTask.resultHtml = '';
      currentTask.lastAIText = '';
      currentTask.activeRunId = null;
      replayActiveRunId = null;
      replayActiveQuery = '';
    }

    isLegacyReplayMode = true;
    try {
      for (const event of replayEvents) {
        handleAIStream({ ...event, sessionId: data.sessionId, taskId: data.sessionId });
      }
    } finally {
      isLegacyReplayMode = false;
      replayActiveRunId = null;
      replayActiveQuery = '';
    }

    // 回放完成后保存快照
    if (currentTask && resultEl.innerHTML) {
      currentTask.resultHtml = resultEl.innerHTML;
    }

    const appliedEnd = normalizedStart + replayEvents.length;
    replayAppliedEventCount = shouldResetView ? appliedEnd : Math.max(replayAppliedEventCount, appliedEnd);
    replayKnownEventCount = payloadKnownCount;
    const lastAppliedTs = replayEvents.length > 0
      ? Number(replayEvents[replayEvents.length - 1]?.timestamp || 0)
      : 0;
    replayLastTimestamp = typeof data.lastTimestamp === 'number' && data.lastTimestamp > 0
      ? Math.max(data.lastTimestamp, lastAppliedTs)
      : Math.max(replayLastTimestamp, lastAppliedTs);
    storeReplayRunSnapshot(
      extractReplayPayloadRunId(replayEvents) || currentTask.activeRunId,
      replayAppliedEventCount,
      replayLastTimestamp,
    );
    updateInputUI();
  });

  // ---- 初始化时恢复活跃会话 ----
  Channel.send('__session_get_active', {}, (response: SessionSyncPayload | null | undefined) => {
    if (response?.sessionId) {
      // 如果已有本地任务（比如刚发起的），不覆盖
      if (currentTask) return;

      // 同步 originTabId
      sessionOriginTabId = typeof response.originTabId === 'number' ? response.originTabId : undefined;

      // 恢复会话状态
      ensureReplayCacheSession(response.sessionId);
      currentTask = {
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
      replayKnownEventCount = typeof response.replayEventCount === 'number' && response.replayEventCount >= 0
        ? response.replayEventCount
        : 0;
      replayAppliedEventCount = 0;
      replayLastTimestamp = typeof response.replayLastTimestamp === 'number' && response.replayLastTimestamp > 0
        ? response.replayLastTimestamp
        : 0;
      renderTaskRuntimeBoard();

      updateInputUI();
      // 回放事件会通过 __session_replay 异步到达
    }
  });

  // 初始化时查询后台任务以更新角标
  queryBgTasks();

  // ---- 恢复录制状态（页面导航后 content 重注入） ----
  Channel.send('__recorder_state', {}, (state: any) => {
    if (state?.active) {
      isRecording = true;
      recorderStepCount = state.steps?.length || 0;
      recorderStartedAt = state.startedAt || Date.now();
      startRecordingCapture();
      trigger.classList.add('recording');
      updateRecorderBar();
    }
  });

  // ---- 事件委托：统一处理结果区所有点击交互 ----
  // 使用委托而非逐个绑定，这样快照恢复后点击仍然有效
  resultEl.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;

    // 1. 顶层折叠组摘要 toggle
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

    // 1.5 历史对话折叠组 toggle
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

    // 2. 确认卡片按钮
    const approvalBtn = target.closest('.mole-approval-btn') as HTMLElement | null;
    if (approvalBtn) {
      const card = approvalBtn.closest('.mole-approval-card') as HTMLElement;
      if (!card || card.classList.contains('settled')) return;
      const requestId = card.getAttribute('data-request-id');
      if (!requestId) return;

      if (approvalBtn.classList.contains('trust-all')) {
        // 本次不再询问：批准并通知后续自动通过
        Channel.send('__approval_response', { requestId, approved: true, trustAll: true });
        disableApprovalCard(card, true);
        // 更新标题提示
        const standalone = card.closest('.mole-approval-standalone') as HTMLElement;
        if (standalone) {
          const titleEl = standalone.querySelector('.mole-approval-header-bar span') as HTMLElement;
          if (titleEl) titleEl.textContent = '已批准（本次不再询问）';
        }
      } else if (approvalBtn.classList.contains('approve')) {
        // 批准
        Channel.send('__approval_response', { requestId, approved: true });
        disableApprovalCard(card, true);
      } else if (approvalBtn.classList.contains('reject') && !approvalBtn.classList.contains('mole-approval-reject-confirm')) {
        // 点击拒绝 → 展开附言输入框
        const rejectInput = card.querySelector('.mole-approval-reject-input') as HTMLElement;
        if (rejectInput) rejectInput.classList.add('open');
        const textInput = card.querySelector('.mole-approval-reject-text') as HTMLInputElement;
        if (textInput) textInput.focus();
      } else if (approvalBtn.classList.contains('mole-approval-reject-confirm')) {
        // 确认拒绝（附言输入后）
        const textInput = card.querySelector('.mole-approval-reject-text') as HTMLInputElement;
        const userMessage = textInput?.value?.trim() || '';
        Channel.send('__approval_response', { requestId, approved: false, userMessage });
        disableApprovalCard(card, false);
      }
      return;
    }

    // 2.5 提问卡片选项点击（ask_user）
    const askUserOption = target.closest('.mole-ask-user-option') as HTMLElement | null;
    if (askUserOption) {
      const card = askUserOption.closest('.mole-ask-user-card') as HTMLElement;
      if (!card || card.classList.contains('settled')) return;
      const requestId = card.getAttribute('data-request-id');
      if (!requestId) return;
      const answer = askUserOption.textContent || '';
      Channel.send('__ask_user_response', { requestId, answer, source: 'option' });
      disableAskUserCard(requestId, answer, 'option');
      return;
    }

    // 2.6 提问卡片发送按钮点击（ask_user）
    const askUserSubmit = target.closest('.mole-ask-user-submit') as HTMLElement | null;
    if (askUserSubmit) {
      const card = askUserSubmit.closest('.mole-ask-user-card') as HTMLElement;
      if (!card || card.classList.contains('settled')) return;
      const requestId = card.getAttribute('data-request-id');
      if (!requestId) return;
      const textInput = card.querySelector('.mole-ask-user-text') as HTMLInputElement;
      const answer = textInput?.value?.trim() || '';
      if (!answer) return; // 空文本不提交
      Channel.send('__ask_user_response', { requestId, answer, source: 'text' });
      disableAskUserCard(requestId, answer, 'text');
      return;
    }

    // 3. 调度状态面板 toggle
    const agentStateTitle = target.closest('.mole-agent-state-title') as HTMLElement | null;
    if (agentStateTitle) {
      const panel = agentStateTitle.closest('.mole-agent-state-panel');
      if (panel) {
        panel.classList.toggle('open');
      }
      return;
    }

    // 3. 单个函数调用项 toggle
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

    // 4. 截图预览（缩略图和按钮）
    const screenshotTrigger = target.closest('.mole-screenshot-img, .mole-screenshot-open') as HTMLElement | null;
    if (screenshotTrigger) {
      const section = screenshotTrigger.closest('.mole-screenshot-section') as HTMLElement | null;
      const screenshotSections = Array.from(
        resultEl.querySelectorAll('.mole-screenshot-section[data-image-src]')
      ) as HTMLElement[];
      const previewList = screenshotSections
        .map((node) => {
          const src = node.getAttribute('data-image-src') || '';
          const meta = node.getAttribute('data-image-meta') || '截图预览';
          return src ? { src, meta } : null;
        })
        .filter((item): item is { src: string; meta: string } => item !== null);

      const startSrc = screenshotTrigger.getAttribute('data-full-src') || section?.getAttribute('data-image-src') || '';
      if (startSrc) {
        let startIndex = previewList.findIndex((item) => item.src === startSrc);
        if (startIndex < 0 && section) {
          const sectionIndex = screenshotSections.indexOf(section);
          startIndex = sectionIndex >= 0 ? Math.min(sectionIndex, previewList.length - 1) : 0;
        }
        openImageViewer(previewList, startIndex < 0 ? 0 : startIndex);
      }
      return;
    }

    // 5. 搜索结果卡片点击跳转
    if ((target as HTMLElement).tagName === 'A') return;
    const card = target.closest('.mole-result-card') as HTMLElement | null;
    if (card) {
      const url = card.getAttribute('data-url');
      if (url) window.open(url, '_blank');
    }
  });

  // ---- 搜索框控制 ----
  const toggleSearch = (show?: boolean) => {
    isOpen = show !== undefined ? show : !isOpen;

    if (isOpen) {
      trigger.classList.add('active');
      overlay.classList.add('visible');

      // 恢复任务显示
      if (currentTask && currentTask.resultHtml) {
        resultEl.innerHTML = currentTask.resultHtml;
        showResult();
      } else {
        // idle 状态：展示 workflow 快捷操作卡片
        renderWorkflowHints();
      }
      updateInputUI();
      queryBgTasks();

      requestAnimationFrame(() => {
        if (!inputEl.disabled) inputEl.focus();
      });
    } else {
      trigger.classList.remove('active');
      overlay.classList.remove('visible');
      closeImageViewer();
      inputEl.value = '';
      inputEl.blur();
      // 保存快照（如果有任务且有内容）
      if (currentTask && resultEl.innerHTML) {
        currentTask.resultHtml = resultEl.innerHTML;
      }
      // 无任务时清除显示
      if (!currentTask) {
        hideResult();
      }
      if (currentTask?.status !== 'running' && !trigger.classList.contains('notice-visible')) {
        trigger.classList.remove('announce');
      }
    }
  };

  // 点击遮罩关闭（但不点击搜索框内部）
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) {
      toggleSearch(false);
    }
  });

  // ESC 关闭/新会话
  shadow.addEventListener('keydown', (e: Event) => {
    const keyboardEvent = e as KeyboardEvent;
    const key = keyboardEvent.key;
    if (handleImageViewerHotkey(key)) {
      e.preventDefault();
      return;
    }
    // Esc 优先关闭关闭菜单
    if (key === 'Escape' && closeMenuEl.classList.contains('visible')) {
      closeMenuEl.classList.remove('visible');
      return;
    }
    if (key === 'Escape') {
      handleEscape();
    }
  });

  // ---- 测试模拟：test: 前缀指令 ----

  /** 延时工具 */
  const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

  /** 模拟发送事件（自动附加 taskId） */
  const simEvent = (taskId: string, type: string, content: string) => {
    handleAIStream({ taskId, type, content });
  };

  /**
   * test:chain — 模拟完整链式调用（覆盖全部 Markdown 格式 + 推荐卡片）
   * 流程：turn_started → thinking → baidu_search → result → jd_search → result → 流式文本 → 推荐卡片 → turn_completed
   */
  const simulateChainCall = async (taskId: string) => {
    const runId = `sim-${Date.now()}`;
    const turnStartAt = Date.now();
    simEvent(taskId, 'turn_started', JSON.stringify({ runId, startedAt: turnStartAt, taskKind: 'regular' }));
    await delay(80);

    // 1. 思考中
    simEvent(taskId, 'thinking', 'AI 正在思考...');
    await delay(800);

    // 2. 第一轮：调用百度搜索
    simEvent(taskId, 'function_call', '正在调用 baidu_search...');
    await delay(1200);
    simEvent(taskId, 'function_result', 'baidu_search 执行完成');
    await delay(300);

    // 3. 第二轮：调用京东搜索
    simEvent(taskId, 'function_call', '正在调用 jd_search...');
    await delay(1500);
    simEvent(taskId, 'function_result', 'jd_search 执行完成');
    await delay(500);

    // 4. AI 流式回复（覆盖各种 Markdown 格式）
    const fullText = '### 综合分析\n\n' +
      '根据**百度搜索**和**京东商品**数据，为你整理机械键盘选购建议：\n\n' +
      '### 轴体对比\n\n' +
      '- **红轴**：线性手感，轻柔安静，适合长时间打字和游戏\n' +
      '- **青轴**：段落感强，打字有"哒哒"声，喜欢反馈感的首选\n' +
      '- **茶轴**：介于红轴和青轴之间，兼顾手感与静音\n\n' +
      '### 价格区间\n\n' +
      '1. **入门级** `¥200-500`：Cherry MX Board、Akko 3068\n' +
      '2. **进阶级** `¥500-1000`：Leopold FC750R、Varmilo 阿米洛\n' +
      '3. **旗舰级** `¥1000+`：HHKB Professional、Realforce\n\n' +
      '### 选购建议\n\n' +
      '选购时建议关注**键帽材质**（PBT 优于 ABS）、**连接方式**（有线延迟低，蓝牙便携）以及*售后保修政策*。更多信息可参考 [机械键盘吧](https://tieba.baidu.com/f?kw=%E6%9C%BA%E6%A2%B0%E9%94%AE%E7%9B%98)。\n\n' +
      '以下是为你精选的商品，点击可直接查看：';

    // 逐步增量推送文本（模拟流式输出）
    for (let i = 0; i < fullText.length; i += 8) {
      if (!currentTask || currentTask.id !== taskId) return; // 已终止
      simEvent(taskId, 'text', fullText.slice(0, i + 8));
      await delay(30);
    }
    simEvent(taskId, 'text', fullText);
    await delay(100);

    // 5. 推荐卡片
    const cards = [
      { title: 'Cherry MX Board 3.0S 机械键盘 红轴', price: '¥549', shop: 'Cherry官方旗舰店', url: 'https://item.jd.com/100038004786.html', tag: '性价比首选' },
      { title: 'Leopold FC750R PD 双模机械键盘 茶轴', price: '¥799', shop: 'Leopold海外旗舰店', url: 'https://item.jd.com/100014458498.html', tag: '手感之王' },
      { title: 'HHKB Professional Hybrid 静电容键盘', price: '¥1,899', shop: 'HHKB京东自营', url: 'https://item.jd.com/100011459498.html', tag: '极客必备' },
    ];
    simEvent(taskId, 'cards', JSON.stringify(cards));
    await delay(100);

    // 6. 完成
    const endedAt = Date.now();
    simEvent(taskId, 'turn_completed', JSON.stringify({
      runId,
      status: 'done',
      endedAt,
      durationMs: Math.max(0, endedAt - turnStartAt),
      lastAgentMessage: fullText,
    }));
  };

  /**
   * test:error — 模拟执行中途出错
   * 流程：turn_started → thinking → baidu_search → error
   */
  const simulateErrorCall = async (taskId: string) => {
    const runId = `sim-${Date.now()}`;
    const turnStartAt = Date.now();
    simEvent(taskId, 'turn_started', JSON.stringify({ runId, startedAt: turnStartAt, taskKind: 'regular' }));
    await delay(80);

    simEvent(taskId, 'thinking', 'AI 正在思考...');
    await delay(800);

    simEvent(taskId, 'function_call', '正在调用 baidu_search...');
    await delay(1500);

    simEvent(taskId, 'error', 'LLM 调用失败：API Key 未配置或已过期');
    await delay(120);
    const endedAt = Date.now();
    simEvent(taskId, 'turn_completed', JSON.stringify({
      runId,
      status: 'error',
      endedAt,
      durationMs: Math.max(0, endedAt - turnStartAt),
      reason: 'LLM 调用失败：API Key 未配置或已过期',
      failureCode: 'E_LLM_API',
    }));
  };

  /**
   * test:search — 模拟搜索结果（含缩略图）
   * 流程：turn_started → thinking → jd_search → search_results（带图片） → turn_completed
   */
  const simulateSearchResults = async (taskId: string) => {
    const runId = `sim-${Date.now()}`;
    const turnStartAt = Date.now();
    simEvent(taskId, 'turn_started', JSON.stringify({ runId, startedAt: turnStartAt, taskKind: 'regular' }));
    await delay(80);

    simEvent(taskId, 'thinking', 'AI 正在搜索商品...');
    await delay(600);

    simEvent(taskId, 'function_call', '正在调用 jd_search...');
    await delay(1200);
    simEvent(taskId, 'function_result', 'jd_search 执行完成');
    await delay(300);

    const mockResults = {
      keyword: '机械键盘',
      total: 3,
      results: [
        { title: 'Cherry MX Board 3.0S 机械键盘 红轴', price: '¥549.00', shop: 'Cherry 官方旗舰店', url: 'https://item.jd.com/100001.html', imageUrl: '' },
        { title: 'Leopold FC750R 87键机械键盘 茶轴', price: '¥799.00', shop: 'Leopold 海外旗舰店', url: 'https://item.jd.com/100002.html', imageUrl: '' },
        { title: 'HHKB Professional Hybrid 静电容键盘', price: '¥1,899.00', shop: 'HHKB 京东自营', url: 'https://item.jd.com/100003.html', imageUrl: '' },
      ],
    };

    simEvent(taskId, 'search_results', JSON.stringify(mockResults));
    await delay(200);
    const endedAt = Date.now();
    simEvent(taskId, 'turn_completed', JSON.stringify({
      runId,
      status: 'done',
      endedAt,
      durationMs: Math.max(0, endedAt - turnStartAt),
      lastAgentMessage: '',
    }));
  };

  /** 分发测试指令 */
  const TEST_COMMANDS: Record<string, (taskId: string) => Promise<void>> = {
    'test:chain': simulateChainCall,
    'test:error': simulateErrorCall,
    'test:search': simulateSearchResults,
  };

  /** 发送查询（仅处理本地测试指令，正常查询通过 session 体系） */
  const dispatchQuery = (value: string, taskId: string) => {
    const testHandler = TEST_COMMANDS[value];
    if (testHandler) {
      testHandler(taskId);
    } else if (value.startsWith('test:chain:')) {
      const keyword = value.slice('test:chain:'.length).trim();
      if (keyword) Channel.send('__test_chain', { keyword, taskId });
    }
    // 正常查询已在 Enter 处理器中通过 __session_create / __session_continue 发送
  };

  // ---- Workflow 卡片点击事件委托 ----
  resultEl.addEventListener('click', (e) => {
    const chip = (e.target as HTMLElement).closest('.mole-workflow-chip') as HTMLElement | null;
    if (!chip) return;
    const label = chip.dataset.label || chip.dataset.name || '';
    const hasRequired = chip.dataset.hasRequired === '1';

    if (hasRequired) {
      // 有必填参数：填入 workflow 标签 + 空格，让用户补参数
      inputEl.value = `${label} `;
      inputEl.focus();
      // 清除卡片
      const hints = resultEl.querySelector('.mole-workflow-hints');
      if (hints) hints.remove();
      if (!resultEl.innerHTML.trim()) hideResult();
    } else {
      // 无必填参数：填入标签后自动提交
      inputEl.value = label;
      inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
  });

  // ---- 用户输入时清除 workflow 卡片 + 重置历史游标 ----
  inputEl.addEventListener('input', () => {
    // 用户手动输入时退出历史浏览模式
    if (inputHistoryCursor !== -1) resetInputHistoryCursor();

    const hints = resultEl.querySelector('.mole-workflow-hints');
    if (hints) {
      hints.remove();
      if (!resultEl.innerHTML.trim()) hideResult();
    }
  });

  // Enter / 上下键
  inputEl.addEventListener('keydown', (e) => {
    // ---- 上下键历史浏览 ----
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.isComposing && inputHistory.length > 0) {
      e.preventDefault();
      if (e.key === 'ArrowUp') {
        if (inputHistoryCursor === -1) {
          // 首次按上键：暂存当前输入，从最新历史开始
          inputHistoryDraft = inputEl.value;
          inputHistoryCursor = inputHistory.length - 1;
        } else if (inputHistoryCursor > 0) {
          inputHistoryCursor--;
        }
      } else {
        // ArrowDown
        if (inputHistoryCursor === -1) return; // 已在最新位置
        if (inputHistoryCursor < inputHistory.length - 1) {
          inputHistoryCursor++;
        } else {
          // 回到用户正在输入的内容
          inputHistoryCursor = -1;
          inputEl.value = inputHistoryDraft;
          return;
        }
      }
      inputEl.value = inputHistory[inputHistoryCursor] ?? '';
      return;
    }

    if (e.key === 'Enter' && !e.isComposing) {
      const value = inputEl.value.trim();
      if (!value) return;

      // running 时不允许新输入
      if (currentTask?.status === 'running') return;

      // 记录到历史并重置游标
      pushInputHistory(value);
      resetInputHistoryCursor();

      inputEl.value = '';

      // 判断是否为本地测试指令
      const isTestCommand = value in TEST_COMMANDS || value.startsWith('test:chain:');

      if (!currentTask || (currentTask.status === 'error')) {
        // ---- 新任务 ----
        if (isTestCommand) {
          // 测试指令：本地生成 taskId，走旧路径
          const taskId = Date.now().toString();
      
          resetReplayCursor();
          clearReplayCache();
          currentTask = {
            id: taskId,
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
          dispatchQuery(value, taskId);
        } else {
          // 正常查询：通过 session 体系，先创建本地任务占位
          const tempId = Date.now().toString();
      
          resetReplayCursor();
          clearReplayCache();
          currentTask = {
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

          // 请求 background 创建会话
          Channel.send('__session_create', { query: value }, (response: any) => {
            if (response?.sessionId && currentTask && currentTask.id === tempId) {
              // 更新为 background 分配的 sessionId
              currentTask.id = response.sessionId;
              if (typeof response.summary === 'string' && response.summary.trim()) {
                currentTask.title = buildTaskTitle(response.summary);
              }
              return;
            }
            if (currentTask && currentTask.id === tempId && response?.accepted === false) {
              const message = typeof response?.message === 'string' && response.message.trim()
                ? response.message.trim()
                : '创建会话失败';
              currentTask.status = 'error';
              currentTask.errorMsg = message;
              currentTask.failureCode = typeof response?.code === 'string' ? response.code : currentTask.failureCode;
              // API Key 未配置：提示用户前往 Options 页面
              if (currentTask.failureCode === 'E_AUTH_REQUIRED' || message.includes('请先登录')) {
                appendToResult(`<div class="mole-error">\u26A0 请在 Options 页面配置 API Key</div>`);
                updateInputUI();
                saveSnapshot();
                return;
              }
              appendToResult(`<div class="mole-error">\u26A0 ${escapeHtml(message)}</div>`);
              updateInputUI();
              saveSnapshot();
            }
          });
        }
      } else {
        // ---- 继续对话 ----
        const previousQuery = currentTask.query;
    
        resetReplayCursor();
        currentTask.query = value;
        currentTask.title = buildTaskTitle(value);
        currentTask.status = 'running';
        currentTask.callStack = [];
        currentTask.lastAIText = '';
        currentTask.agentPhase = 'plan';
        currentTask.agentRound = 0;
        currentTask.failureCode = '';
        currentTask.errorMsg = '';
        currentTask.startedAt = Date.now();
        currentTask.endedAt = null;
        currentTask.durationMs = null;

        archiveCurrentRoundView(previousQuery);

        showResult();
        resultEl.scrollTop = resultEl.scrollHeight;
        saveSnapshot();

        updateInputUI();

        if (isTestCommand) {
          // 测试指令走旧路径
          dispatchQuery(value, currentTask.id);
        } else {
          // 通过 session 体系继续对话
          const expectedSessionId = currentTask.id;
          const expectedRunId = currentTask.activeRunId || undefined;
          Channel.send(
            '__session_continue',
            { sessionId: expectedSessionId, expectedSessionId, expectedRunId, query: value },
            (response: any) => {
              if (!currentTask) return;
              if (response?.accepted === false) {
                if (typeof response.actualSessionId === 'string') {
                  currentTask.id = response.actualSessionId;
                }
                if (typeof response.actualRunId === 'string' || response.actualRunId === null) {
                  currentTask.activeRunId = response.actualRunId;
                }
                const message = typeof response?.message === 'string' && response.message.trim()
                  ? response.message.trim()
                  : '继续对话失败';
                currentTask.status = 'error';
                currentTask.errorMsg = message;
                currentTask.failureCode = typeof response?.code === 'string' ? response.code : currentTask.failureCode;
                // API Key 未配置：提示用户前往 Options 页面
                if (currentTask.failureCode === 'E_AUTH_REQUIRED' || message.includes('请先登录')) {
                  appendToResult(`<div class="mole-error">\u26A0 请在 Options 页面配置 API Key</div>`);
                  updateInputUI();
                  saveSnapshot();
                  return;
                }
                appendToResult(`<div class="mole-error">\u26A0 ${escapeHtml(message)}</div>`);
                updateInputUI();
                saveSnapshot();
              } else if (response?.accepted === true && typeof response.sessionId === 'string') {
                currentTask.id = response.sessionId;
                if (typeof response.runId === 'string' || response.runId === null) {
                  currentTask.activeRunId = response.runId;
                }
                if (typeof response?.message === 'string' && response.message.trim()) {
                  showPillNotice(response.message.trim(), 'info');
                }
              }
            },
          );
        }
      }
    }
  });

  // ---- 拖拽 ----
  const TRIGGER_CENTER = (PILL_WIDTH + 10) / 2;

  const onMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    startMouseX = e.clientX;
    startMouseY = e.clientY;
    startTriggerX = trigger.offsetLeft;
    startTriggerY = currentY;
    isDragging = false;

    trigger.classList.remove('snapping');

    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('mouseup', onMouseUp, true);
  };

  const onMouseMove = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const dx = e.clientX - startMouseX;
    const dy = e.clientY - startMouseY;

    if (!isDragging && Math.sqrt(dx * dx + dy * dy) >= DRAG_THRESHOLD) {
      isDragging = true;
      if (isOpen) toggleSearch(false);
      // 超过阈值后才添加拖拽样式，触发胶囊→圆球变形
      trigger.classList.add('dragging');
      trigger.classList.remove('side-left', 'side-right', 'hovering');
    }

    if (isDragging) {
      // 圆球居中跟随鼠标：trigger 中心对齐鼠标指针
      const newX = e.clientX - TRIGGER_CENTER;
      const newY = e.clientY - (PILL_HEIGHT + 10) / 2;
      trigger.style.left = `${newX}px`;
      trigger.style.top = `${newY}px`;
    }
  };

  const onMouseUp = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('mouseup', onMouseUp, true);

    trigger.classList.remove('dragging');

    if (isDragging) {
      // 用鼠标位置直接判断吸附方向
      side = e.clientX < getViewportWidth() / 2 ? 'left' : 'right';
      currentY = clampY(e.clientY - PILL_HEIGHT / 2);

      applySideClass();
      trigger.classList.add('snapping');
      const x = getTriggerX(side);
      trigger.style.left = `${x}px`;
      trigger.style.top = `${currentY}px`;

      savePosition({ y: currentY, side });

      setTimeout(() => {
        trigger.classList.remove('snapping');
      }, 520);
    } else {
      toggleSearch();
    }

    isDragging = false;
  };

  pill.addEventListener('mousedown', onMouseDown);

  // ---- 悬浮球迷你操作卡片事件 ----
  // 阻止冒泡到 pill（避免触发拖拽/toggle），独立处理点击
  pillActionCard.addEventListener('mousedown', (e) => {
    e.stopPropagation();
  });
  pillActionCard.addEventListener('click', (e) => {
    e.stopPropagation();
    const target = e.target as HTMLElement;
    const pacBtn = target.closest('.pac-btn') as HTMLElement | null;
    if (!pacBtn) return;
    const pacBody = pacBtn.closest('.pac-body') as HTMLElement;
    if (!pacBody) return;
    const requestId = pacBody.getAttribute('data-request-id');
    const cardType = pacBody.getAttribute('data-type');
    if (!requestId) return;

    if (cardType === 'approval') {
      if (pacBtn.classList.contains('pac-approve')) {
        Channel.send('__approval_response', { requestId, approved: true });
        const panelCard = resultEl.querySelector(`.mole-approval-card[data-request-id="${requestId}"]`) as HTMLElement;
        if (panelCard && !panelCard.classList.contains('settled')) disableApprovalCard(panelCard, true);
        hidePillActionCard();
      } else if (pacBtn.classList.contains('pac-reject')) {
        Channel.send('__approval_response', { requestId, approved: false, userMessage: '' });
        const panelCard = resultEl.querySelector(`.mole-approval-card[data-request-id="${requestId}"]`) as HTMLElement;
        if (panelCard && !panelCard.classList.contains('settled')) disableApprovalCard(panelCard, false);
        hidePillActionCard();
      }
    } else if (cardType === 'ask-user') {
      if (pacBtn.classList.contains('pac-option')) {
        const answer = pacBtn.textContent || '';
        Channel.send('__ask_user_response', { requestId, answer, source: 'option' });
        disableAskUserCard(requestId, answer, 'option');
        hidePillActionCard();
      } else if (pacBtn.classList.contains('pac-send')) {
        const textInput = pacBody.querySelector('.pac-text') as HTMLInputElement;
        const answer = textInput?.value?.trim() || '';
        if (!answer) return;
        Channel.send('__ask_user_response', { requestId, answer, source: 'text' });
        disableAskUserCard(requestId, answer, 'text');
        hidePillActionCard();
      }
    }
  });

  // ---- 悬浮球 hover 状态管理 ----
  // 用 JS class 管理 hover 状态，避免 trigger 宽度区域拦截页面操作
  // pill/按钮/菜单共享 hovering 状态，离开后延迟移除以覆盖元素间间隙
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;
  const HOVER_LEAVE_DELAY = 200;

  const enterHover = () => {
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
    trigger.classList.add('hovering');
  };

  const leaveHover = () => {
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      trigger.classList.remove('hovering');
      hoverTimer = null;
    }, HOVER_LEAVE_DELAY);
  };

  for (const el of [pill, closeBtn, settingsBtn, closeMenuEl, recordBtn, pillActionCard]) {
    el.addEventListener('mouseenter', enterHover);
    el.addEventListener('mouseleave', leaveHover);
  }

  // ---- 点击外部关闭（宿主页面） ----
  // 注意：closed Shadow DOM 下 composedPath() 不含内部节点，需检查 host
  document.addEventListener('mousedown', (e) => {
    const path = e.composedPath();
    // 点击宿主页面（Shadow DOM 外部）时关闭关闭菜单
    // 注意：closed Shadow DOM 下 document 只能看到 host，点击菜单项时 path 包含 host，不应关闭
    if (closeMenuEl.classList.contains('visible') && !path.includes(host)) {
      closeMenuEl.classList.remove('visible');
    }
    if (!isOpen) return;
    if (!path.includes(host)) {
      toggleSearch(false);
    }
  });

  // ESC 也要在宿主文档上监听
  document.addEventListener('keydown', (e) => {
    if (handleImageViewerHotkey(e.key)) {
      e.preventDefault();
      return;
    }
    // Esc 优先关闭关闭菜单
    if (e.key === 'Escape' && closeMenuEl.classList.contains('visible')) {
      closeMenuEl.classList.remove('visible');
      return;
    }
    if (e.key === 'Escape') {
      handleEscape();
    }
  });

  // 全局快捷键：Cmd+M (Mac) / Ctrl+M (Win) 唤起/关闭搜索框
  document.addEventListener('keydown', (e) => {
    const modKey = isMac ? e.metaKey : e.ctrlKey;
    if (modKey && e.key.toLowerCase() === 'm') {
      e.preventDefault();
      e.stopPropagation();
      toggleSearch();
    }
  });

  // ---- resize ----
  window.addEventListener('resize', () => {
    currentY = clampY(currentY);
    applyPosition();
    // resize 后重新补偿 host 位置（视口尺寸变化可能影响偏移量）
    compensateHostPosition();
  });
};
