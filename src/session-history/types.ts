import type { SessionFailureCode, SessionStatus } from '../ai/types';

/** 工具调用链项（用于 options 页面复现调用进度） */
export interface SessionToolCallChainItem {
  funcName: string;
  status: 'running' | 'done' | 'error';
  message?: string;
  startedAt?: number;
  endedAt?: number;
}

/** 调度状态变化项（对应 agent_state 事件） */
export interface SessionAgentTransitionItem {
  phase: string;
  round: number;
  reason: string;
  updatedAt: number;
}

/** 会话历史记录（用于 options 页面展示） */
export interface SessionHistoryRecord {
  sessionId: string;
  summary: string;
  status: SessionStatus | 'cleared';
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  failureCode?: SessionFailureCode;
  lastError?: string;
  assistantReply?: string;
  toolCalls: string[];
  toolCallChain: SessionToolCallChainItem[];
  agentTransitions: SessionAgentTransitionItem[];
  updatedAt: number;
}
