/** 工作台持久领域类型；浏览器页面、Agent 和后台共用。 */
import type { Session, SessionEventLogItem } from '../ai/types';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type TaskStatus = 'queued' | 'running' | 'waiting' | 'paused' | 'completed' | 'partial' | 'failed' | 'cancelled';
export type TaskKind = 'douyin_collect' | 'company_search' | 'company_contacts' | 'crm_delivery' | 'tool_read';
export type Provider = 'douyin' | 'lixiaoyun' | 'riskbird' | 'mantis_crm' | 'web';

export interface SessionArchive {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  completeness: 'full' | 'legacy_partial';
  revision: number;
  lastSeq: number;
  snapshot: Omit<Session, 'eventLog'>;
}

export type SessionSummary = Omit<SessionArchive, 'snapshot'> & { status: Session['status'] };
export interface SessionCursor { updatedAt: number; id: string }

export interface WorkspaceEvent {
  seq?: number;
  eventId: string;
  sessionId: string;
  taskId?: string;
  type: string;
  content: string;
  timestamp: number;
}

export interface LeadTask {
  id: string;
  sessionId: string;
  kind: TaskKind;
  provider: Provider;
  title: string;
  input: { [key: string]: Json };
  checkpoint: { [key: string]: Json };
  status: TaskStatus;
  goalRevision: number;
  revision: number;
  epoch: number;
  batches: number;
  savedCount: number;
  attempts: number;
  maxAttempts: number;
  maxBatches: number;
  nextRunAt: number;
  createdAt: number;
  updatedAt: number;
  reason?: string;
}

export interface TaskStep {
  id: string;
  taskId: string;
  attemptId: string;
  epoch: number;
  status: 'running' | 'succeeded' | 'failed' | 'unknown';
  startedAt: number;
  endedAt?: number;
  evidenceIds: string[];
  error?: string;
}

export interface Evidence {
  id: string;
  taskId: string;
  stepId: string;
  provider: Provider;
  sourceUrl: string;
  sourceId?: string;
  collectedAt: number;
  extractorVersion: string;
  payload: Json;
}

export interface Lead {
  id: string;
  sourceKey: string;
  kind: 'account' | 'company' | 'store';
  name: string;
  provider: Provider;
  sourceUrl: string;
  fields: { [key: string]: Json };
  evidenceIds: string[];
  companyId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface LeadSummary extends Lead {
  assessment?: Pick<Assessment, 'status' | 'reason' | 'goalRevision' | 'taskId'> & { current: boolean };
}

export interface TaskLead {
  id: string;
  taskId: string;
  leadId: string;
  discoveredAt: number;
}

export interface LeadFact {
  id: string;
  leadId: string;
  taskId: string;
  field: string;
  rawValue: Json;
  value: Json;
  evidenceId: string;
  sourcePath?: string;
  createdAt: number;
}

export interface Assessment {
  id: string;
  taskId: string;
  leadId: string;
  goalRevision: number;
  status: 'qualified' | 'rejected' | 'unconfirmed';
  reason: string;
  factIds: string[];
  evidenceIds: string[];
  model: string;
  promptVersion: string;
  createdAt: number;
  author: 'agent' | 'human';
}

export interface EntityLink {
  id: string;
  sourceLeadId: string;
  companyLeadId: string;
  status: 'candidate' | 'confirmed';
  reason: string;
  evidenceIds: string[];
  author: 'agent' | 'human';
  createdAt: number;
}

export interface Delivery {
  id: string;
  taskId: string;
  leadId: string;
  targetHost: string;
  targetIdentity: string;
  configVersion: number;
  fields: { [key: string]: Json };
  status: 'prepared' | 'sending' | 'recorded' | 'duplicate' | 'failed' | 'unknown';
  createdAt: number;
  updatedAt: number;
  receipt?: Json;
  message?: string;
}

export interface BatchResult {
  evidence: Evidence[];
  leads: Array<Omit<Lead, 'id' | 'createdAt' | 'updatedAt'> & { fieldOrigins?: Record<string, { rawValue: Json; sourcePath: string }> }>;
  checkpoint: LeadTask['checkpoint'];
  done: boolean;
  partial?: boolean;
  reason?: string;
  delayMs?: number;
}

export interface TaskAttempt {
  task: LeadTask;
  step: TaskStep;
}

export interface WorkspaceCommand {
  requestId: string;
  kind: 'send_message' | 'task_update' | 'pause_task' | 'resume_task' | 'cancel_task' | 'archive_session';
  sessionId: string;
  taskId?: string;
  expectedRevision?: number;
  text?: string;
  tabId?: number;
}

export interface CommandReceipt {
  id: string;
  fingerprint: string;
  command: WorkspaceCommand;
  status: 'pending' | 'running' | 'done' | 'interrupted';
  createdAt: number;
  updatedAt: number;
}

export interface SessionPage {
  session: SessionArchive;
  events: WorkspaceEvent[];
  hasMore: boolean;
  lastSeq: number;
}

export interface WorkspaceBackup {
  format: 'mole-workspace';
  version: 1;
  exportedAt: number;
  records: Record<string, unknown[]>;
}

export function archiveEvent(sessionId: string, item: SessionEventLogItem): WorkspaceEvent {
  return { ...item, eventId: crypto.randomUUID(), sessionId, timestamp: item.timestamp || Date.now() };
}
