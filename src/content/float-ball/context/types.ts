/**
 * 悬浮球 React 架构 — 核心类型定义
 */

import type { SessionOpQueueSnapshot } from '../../../ai/types';
import type { Side, RecentCompletedTaskItem } from '../constants';

// ============ 任务状态 ============

export interface TaskItem {
  id: string;                  // sessionId（由 background 生成）
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

export interface TabTakeoverState {
  active: boolean;
  label: string;
  expiresAt: number;
  source?: string;
  workflow?: string;
}

// ============ 全局状态 ============

export interface MoleState {
  // 面板状态
  isOpen: boolean;
  isDragging: boolean;

  // 位置
  side: Side;
  currentY: number;

  // 任务
  currentTask: TaskItem | null;
  recentCompletedTasks: RecentCompletedTaskItem[];

  // 胶囊状态
  lastPillState: 'idle' | 'running' | 'done' | 'error';
  lastPillTaskId: string;

  // 回放
  isLegacyReplayMode: boolean;
  replayActiveRunId: string | null;
  replayActiveQuery: string;
  replayKnownEventCount: number;
  replayAppliedEventCount: number;
  replayLastTimestamp: number;

  // Tab
  selfTabId: number | null;
  sessionOriginTabId: number | undefined;
  tabTakeoverState: TabTakeoverState | null;

  // 后台任务
  bgTasksData: { timers: any[]; residentJobs: any[] } | null;

  // 输入历史
  inputHistory: string[];
  inputHistoryCursor: number;
  inputHistoryDraft: string;

  // 审批/提问请求
  approvalRequest: { requestId: string; message: string } | null;
  askUserRequest: { requestId: string; question: string; options?: string[]; allowFreeText?: boolean } | null;

  // 录制
  isRecording: boolean;
  isRecorderAuditing: boolean;
  recorderStepCount: number;
  showRecordModal: boolean;

  // 截图预览
  screenshotPreviewList: string[];
  screenshotPreviewIndex: number;

  // 关闭菜单
  closeMenuVisible: boolean;

  // 用户主动关闭
  userDismissed: boolean;
}

// ============ Action 类型 ============

export type MoleAction =
  | { type: 'TOGGLE_OPEN'; payload?: boolean }
  | { type: 'SET_DRAGGING'; payload: boolean }
  | { type: 'SET_POSITION'; payload: { side: Side; currentY: number } }
  | { type: 'SET_SIDE'; payload: Side }
  | { type: 'SET_Y'; payload: number }
  | { type: 'SET_TASK'; payload: TaskItem | null }
  | { type: 'UPDATE_TASK'; payload: Partial<TaskItem> }
  | { type: 'SET_RECENT_TASKS'; payload: RecentCompletedTaskItem[] }
  | { type: 'SET_PILL_STATE'; payload: { state: 'idle' | 'running' | 'done' | 'error'; taskId: string } }
  | { type: 'SET_REPLAY_MODE'; payload: boolean }
  | { type: 'SET_REPLAY_STATE'; payload: Partial<Pick<MoleState, 'replayActiveRunId' | 'replayActiveQuery' | 'replayKnownEventCount' | 'replayAppliedEventCount' | 'replayLastTimestamp'>> }
  | { type: 'SET_SELF_TAB_ID'; payload: number | null }
  | { type: 'SET_SESSION_ORIGIN_TAB'; payload: number | undefined }
  | { type: 'SET_TAKEOVER'; payload: TabTakeoverState | null }
  | { type: 'SET_BG_TASKS'; payload: { timers: any[]; residentJobs: any[] } | null }
  | { type: 'SET_INPUT_HISTORY'; payload: string[] }
  | { type: 'SET_INPUT_CURSOR'; payload: { cursor: number; draft: string } }
  | { type: 'PUSH_INPUT_HISTORY'; payload: string }
  | { type: 'SET_APPROVAL_REQUEST'; payload: { requestId: string; message: string } | null }
  | { type: 'SET_ASK_USER_REQUEST'; payload: { requestId: string; question: string; options?: string[]; allowFreeText?: boolean } | null }
  | { type: 'APPEND_CALL_STACK'; payload: { funcName: string; icon: string; text: string; userSummary?: string } }
  | { type: 'SET_RECORDING'; payload: { isRecording: boolean; stepCount?: number } }
  | { type: 'SET_RECORDER_AUDITING'; payload: boolean }
  | { type: 'SET_RECORD_MODAL'; payload: boolean }
  | { type: 'SET_SCREENSHOT_PREVIEW'; payload: { list: string[]; index: number } }
  | { type: 'SET_CLOSE_MENU'; payload: boolean }
  | { type: 'SET_USER_DISMISSED'; payload: boolean }
  | { type: 'RESET' };

// ============ 初始状态 ============

export const initialMoleState: MoleState = {
  isOpen: false,
  isDragging: false,
  side: 'right',
  currentY: 0,
  currentTask: null,
  recentCompletedTasks: [],
  lastPillState: 'idle',
  lastPillTaskId: '',
  isLegacyReplayMode: false,
  replayActiveRunId: null,
  replayActiveQuery: '',
  replayKnownEventCount: 0,
  replayAppliedEventCount: 0,
  replayLastTimestamp: 0,
  selfTabId: null,
  sessionOriginTabId: undefined,
  tabTakeoverState: null,
  bgTasksData: null,
  approvalRequest: null,
  askUserRequest: null,
  inputHistory: [],
  inputHistoryCursor: -1,
  inputHistoryDraft: '',
  isRecording: false,
  isRecorderAuditing: false,
  recorderStepCount: 0,
  showRecordModal: false,
  screenshotPreviewList: [],
  screenshotPreviewIndex: 0,
  closeMenuVisible: false,
  userDismissed: false,
};
