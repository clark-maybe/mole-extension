/**
 * 悬浮球状态 Reducer
 */

import { type MoleState, type MoleAction, initialMoleState } from './types';

const INPUT_HISTORY_KEY = 'mole_input_history';
const INPUT_HISTORY_MAX = 50;

export const moleReducer = (state: MoleState, action: MoleAction): MoleState => {
  switch (action.type) {
    case 'TOGGLE_OPEN':
      return { ...state, isOpen: action.payload ?? !state.isOpen };

    case 'SET_DRAGGING':
      return { ...state, isDragging: action.payload };

    case 'SET_POSITION':
      return { ...state, side: action.payload.side, currentY: action.payload.currentY };

    case 'SET_SIDE':
      return { ...state, side: action.payload };

    case 'SET_Y':
      return { ...state, currentY: action.payload };

    case 'SET_TASK':
      return { ...state, currentTask: action.payload };

    case 'UPDATE_TASK':
      if (!state.currentTask) return state;
      return { ...state, currentTask: { ...state.currentTask, ...action.payload } };

    case 'SET_RECENT_TASKS':
      return { ...state, recentCompletedTasks: action.payload };

    case 'SET_PILL_STATE':
      return { ...state, lastPillState: action.payload.state, lastPillTaskId: action.payload.taskId };

    case 'SET_REPLAY_MODE':
      return { ...state, isLegacyReplayMode: action.payload };

    case 'SET_REPLAY_STATE':
      return { ...state, ...action.payload };

    case 'SET_SELF_TAB_ID':
      return { ...state, selfTabId: action.payload };

    case 'SET_SESSION_ORIGIN_TAB':
      return { ...state, sessionOriginTabId: action.payload };

    case 'SET_TAKEOVER':
      return { ...state, tabTakeoverState: action.payload };

    case 'SET_BG_TASKS':
      return { ...state, bgTasksData: action.payload };

    case 'SET_INPUT_HISTORY':
      return { ...state, inputHistory: action.payload };

    case 'SET_INPUT_CURSOR':
      return { ...state, inputHistoryCursor: action.payload.cursor, inputHistoryDraft: action.payload.draft };

    case 'PUSH_INPUT_HISTORY': {
      const history = [...state.inputHistory];
      if (history.length > 0 && history[history.length - 1] === action.payload) return state;
      history.push(action.payload);
      if (history.length > INPUT_HISTORY_MAX) history.shift();
      try { chrome.storage.local.set({ [INPUT_HISTORY_KEY]: history }); } catch { /* 忽略 */ }
      return { ...state, inputHistory: history, inputHistoryCursor: -1, inputHistoryDraft: '' };
    }

    case 'SET_APPROVAL_REQUEST':
      return { ...state, approvalRequest: action.payload };

    case 'SET_ASK_USER_REQUEST':
      return { ...state, askUserRequest: action.payload };

    case 'APPEND_CALL_STACK':
      if (!state.currentTask) return state;
      return {
        ...state,
        currentTask: {
          ...state.currentTask,
          callStack: [...state.currentTask.callStack, action.payload],
        },
      };

    case 'SET_RECORDING':
      return {
        ...state,
        isRecording: action.payload.isRecording,
        recorderStepCount: action.payload.stepCount ?? state.recorderStepCount,
      };

    case 'SET_RECORDER_AUDITING':
      return { ...state, isRecorderAuditing: action.payload };

    case 'SET_RECORD_MODAL':
      return { ...state, showRecordModal: action.payload };

    case 'SET_SCREENSHOT_PREVIEW':
      return { ...state, screenshotPreviewList: action.payload.list, screenshotPreviewIndex: action.payload.index };

    case 'SET_CLOSE_MENU':
      return { ...state, closeMenuVisible: action.payload };

    case 'SET_USER_DISMISSED':
      return { ...state, userDismissed: action.payload };

    case 'RESET':
      return { ...initialMoleState };

    default:
      return state;
  }
};
