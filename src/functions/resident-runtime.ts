import type { FunctionDefinition, FunctionResult, ToolExecutionContext } from './types';
import { getSiteWorkflow } from './site-workflow-registry';
import { getWorkflowByName } from './skill-registry';
import { executeDebugRemotePlan } from './remote-workflow';

const RESIDENT_RUNTIME_STORAGE_KEY = 'mole_resident_runtime_jobs_v1';
const RESIDENT_RUNTIME_ALARM_PREFIX = 'mole_resident_job_';
const MIN_INTERVAL_MS = 30_000;
const MAX_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MAX_AUTO_STOP_FAILURES = 50;
const AI_CALL_LOG_TTL_MS = 86_400_000; // 24h

type ResidentAction = 'start' | 'stop' | 'status' | 'list' | 'run_once';

/** AI 响应后的动作 */
interface AIPostAction {
  action: 'fill_and_send';
  selector: string;
  key?: string; // 默认 'Enter'
}

/** AI 调用预算 */
interface AIBudget {
  maxPerHour: number; // 0=不限
  maxPerDay: number;  // 0=不限
}

interface ResidentJob {
  id: string;
  name: string;
  tabId: number;
  params: Record<string, unknown>;
  intervalMs: number;
  maxFailures: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  lastDurationMs?: number;
  lastSuccess?: boolean;
  lastError?: string;
  failureCount: number;

  // workflow 来源
  siteWorkflow?: string;

  // 分层执行：AI 响应配置
  aiEnabled: boolean;
  aiPromptTemplate: string;
  aiActionAfter?: AIPostAction;

  // 去重
  lastResultHash?: string;

  // AI 预算
  aiBudget: AIBudget;
  aiCallLog: number[];
}

interface ResidentRuntimeStoreShape {
  version: 1;
  updatedAt: number;
  jobs: ResidentJob[];
}

const residentJobs = new Map<string, ResidentJob>();
const runningJobs = new Set<string>();
let residentReadyPromise: Promise<void> | null = null;
let alarmListenerRegistered = false;

// 延迟加载 AI 响应函数（避免循环依赖）
let _runResidentAIResponse: ((
  job: { id: string; name: string; tabId: number; aiPromptTemplate: string },
  detectData: unknown,
) => Promise<{ success: boolean; data?: any; error?: string }>) | null = null;

/** 注入 AI 响应函数（由 background.ts 初始化时调用） */
export const injectAIResponseRunner = (fn: typeof _runResidentAIResponse): void => {
  _runResidentAIResponse = fn;
};

// ============ 工具函数 ============

const hasChromeStorage = (): boolean => {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
};

const hasChromeAlarms = (): boolean => {
  return typeof chrome !== 'undefined' && Boolean(chrome.alarms);
};

const normalizeIntervalMs = (raw: unknown): number => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 60_000;
  return Math.max(MIN_INTERVAL_MS, Math.min(MAX_INTERVAL_MS, Math.floor(parsed)));
};

const normalizeMaxFailures = (raw: unknown): number => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(MAX_AUTO_STOP_FAILURES, Math.floor(parsed)));
};

/** 简单哈希：对 JSON 字符串做 djb2 哈希 */
const computeHash = (data: unknown): string => {
  const str = JSON.stringify(data ?? '');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
};

/** 从 JSON Schema 提取默认值 */
const extractDefaults = (schema: Record<string, any>): Record<string, any> => {
  const defaults: Record<string, any> = {};
  const properties = schema?.properties;
  if (!properties || typeof properties !== 'object') return defaults;
  for (const [key, prop] of Object.entries(properties)) {
    if (prop && typeof prop === 'object' && 'default' in prop) {
      defaults[key] = (prop as any).default;
    }
  }
  return defaults;
};

/** 检查 AI 调用预算 */
const checkAIBudget = (job: ResidentJob): boolean => {
  const now = Date.now();
  // 清理过期记录
  job.aiCallLog = (job.aiCallLog || []).filter(t => now - t < AI_CALL_LOG_TTL_MS);

  if (job.aiBudget.maxPerHour > 0) {
    const lastHour = job.aiCallLog.filter(t => now - t < 3_600_000).length;
    if (lastHour >= job.aiBudget.maxPerHour) return false;
  }
  if (job.aiBudget.maxPerDay > 0) {
    if (job.aiCallLog.length >= job.aiBudget.maxPerDay) return false;
  }
  return true;
};

/** 记录一次 AI 调用 */
const recordAICall = (job: ResidentJob): void => {
  if (!job.aiCallLog) job.aiCallLog = [];
  job.aiCallLog.push(Date.now());
};

// ============ 存储 ============

const readRuntimeStore = async (): Promise<ResidentRuntimeStoreShape | null> => {
  if (!hasChromeStorage()) return null;
  const result = await new Promise<Record<string, unknown>>((resolve) => {
    chrome.storage.local.get(RESIDENT_RUNTIME_STORAGE_KEY, resolve);
  });
  const raw = result[RESIDENT_RUNTIME_STORAGE_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const payload = raw as ResidentRuntimeStoreShape;
  if (!Array.isArray(payload.jobs)) return null;
  return payload;
};

const persistRuntimeStore = async (): Promise<void> => {
  if (!hasChromeStorage()) return;
  const jobs = Array.from(residentJobs.values()).sort((left, right) => left.createdAt - right.createdAt);
  const payload: ResidentRuntimeStoreShape = {
    version: 1,
    updatedAt: Date.now(),
    jobs,
  };
  await new Promise<void>((resolve) => {
    chrome.storage.local.set({ [RESIDENT_RUNTIME_STORAGE_KEY]: payload }, resolve);
  });
};

const buildJobSummary = (job: ResidentJob) => {
  return {
    id: job.id,
    name: job.name,
    workflow: job.siteWorkflow || null,
    tabId: job.tabId,
    intervalMs: job.intervalMs,
    enabled: job.enabled,
    maxFailures: job.maxFailures,
    failureCount: job.failureCount,
    running: runningJobs.has(job.id),
    aiEnabled: job.aiEnabled,
    aiBudget: job.aiBudget,
    aiCallsLastHour: (job.aiCallLog || []).filter(t => Date.now() - t < 3_600_000).length,
    aiCallsLastDay: (job.aiCallLog || []).length,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    lastRunAt: job.lastRunAt || null,
    lastDurationMs: job.lastDurationMs || null,
    lastSuccess: typeof job.lastSuccess === 'boolean' ? job.lastSuccess : null,
    lastError: job.lastError || null,
  };
};

// ============ Alarm 管理 ============

const alarmNameOfJob = (jobId: string): string => `${RESIDENT_RUNTIME_ALARM_PREFIX}${jobId}`;

const clearJobAlarm = async (jobId: string): Promise<void> => {
  if (!hasChromeAlarms()) return;
  await chrome.alarms.clear(alarmNameOfJob(jobId));
};

const scheduleJobAlarm = async (job: ResidentJob): Promise<void> => {
  if (!hasChromeAlarms()) return;
  const periodInMinutes = Math.max(0.5, job.intervalMs / 60_000);
  await chrome.alarms.create(alarmNameOfJob(job.id), {
    delayInMinutes: periodInMinutes,
    periodInMinutes,
  });
};

const syncJobAlarm = async (job: ResidentJob): Promise<void> => {
  if (job.enabled) {
    await scheduleJobAlarm(job);
    return;
  }
  await clearJobAlarm(job.id);
};

// ============ 分层执行引擎 ============

/** Phase 1: 检测 — 执行 workflow plan（零 token） */
const executeDetection = async (job: ResidentJob): Promise<FunctionResult> => {
  if (!job.siteWorkflow) {
    return { success: false, error: '未配置 siteWorkflow' };
  }

  // 优先从新 Skill 注册表查找
  const skillWf = await getWorkflowByName(job.siteWorkflow);
  if (skillWf) {
    const defaults = extractDefaults(skillWf.parameters);
    return executeDebugRemotePlan(
      job.siteWorkflow,
      skillWf.plan,
      { ...defaults, ...job.params },
      { tabId: job.tabId },
    );
  }

  // 回退：兼容旧 site-workflow 注册表
  const spec = await getSiteWorkflow(job.siteWorkflow);
  if (!spec) return { success: false, error: `workflow 不存在: ${job.siteWorkflow}` };
  const defaults = extractDefaults(spec.parameters);
  return executeDebugRemotePlan(
    job.siteWorkflow,
    spec.plan,
    { ...defaults, ...job.params },
    { tabId: job.tabId },
  );
};

/** Phase 3: AI 响应后执行动作（fill + send） */
const executePostAction = async (job: ResidentJob, replyText: string): Promise<FunctionResult> => {
  if (!job.aiActionAfter) return { success: true };
  const { selector, key } = job.aiActionAfter;
  const tabId = job.tabId;

  try {
    // 动态引入 cdp-input 来执行填充和发送
    const { cdpInputFunction } = await import('./cdp-input');

    // fill
    const fillResult = await cdpInputFunction.execute(
      { action: 'fill', selector, value: replyText },
      { tabId } as ToolExecutionContext,
    );
    if (!fillResult.success) return fillResult;

    // key_press to send（cdp_input 中按键操作为 key_press）
    const pressResult = await cdpInputFunction.execute(
      { action: 'key_press', selector, key: key || 'Enter' },
      { tabId } as ToolExecutionContext,
    );
    return pressResult;
  } catch (err: any) {
    return { success: false, error: `执行发送动作失败: ${err?.message}` };
  }
};

/** 更新 job 成功状态 */
const updateJobSuccess = (job: ResidentJob, startedAt: number, data: unknown): void => {
  const finishedAt = Date.now();
  job.updatedAt = finishedAt;
  job.lastRunAt = finishedAt;
  job.lastDurationMs = Math.max(0, finishedAt - startedAt);
  job.lastSuccess = true;
  job.lastError = undefined;
  job.failureCount = 0;
  residentJobs.set(job.id, job);
};

/** 更新 job 失败状态 */
const updateJobFailure = async (job: ResidentJob, startedAt: number, error?: string): Promise<void> => {
  const finishedAt = Date.now();
  job.updatedAt = finishedAt;
  job.lastRunAt = finishedAt;
  job.lastDurationMs = Math.max(0, finishedAt - startedAt);
  job.lastSuccess = false;
  job.lastError = error || '执行失败';
  job.failureCount += 1;
  if (job.maxFailures > 0 && job.failureCount >= job.maxFailures) {
    job.enabled = false;
    await clearJobAlarm(job.id);
  }
  residentJobs.set(job.id, job);
};

/** 核心执行函数：分层 检测→去重→AI→动作 */
const runJobById = async (jobId: string, source: 'alarm' | 'manual', ignoreDisabled: boolean = false): Promise<FunctionResult> => {
  await ensureResidentRuntimeReady();
  const job = residentJobs.get(jobId);
  if (!job) {
    return { success: false, error: `job not found: ${jobId}` };
  }
  if (!ignoreDisabled && !job.enabled) {
    return { success: false, error: `job disabled: ${jobId}` };
  }
  if (runningJobs.has(jobId)) {
    return { success: false, error: `job is running: ${jobId}` };
  }

  runningJobs.add(jobId);
  const startedAt = Date.now();
  try {
    // === Phase 1: 检测（Plan 直跑，零 token） ===
    const detectResult = await executeDetection(job);

    if (!detectResult.success) {
      await updateJobFailure(job, startedAt, detectResult.error);
      await persistRuntimeStore();
      return {
        success: false,
        error: detectResult.error,
        data: { source, phase: 'detect', summary: buildJobSummary(job) },
      };
    }

    // === 去重判断 ===
    const resultHash = computeHash(detectResult.data);
    const hasChange = resultHash !== job.lastResultHash;
    job.lastResultHash = resultHash;

    if (!hasChange) {
      updateJobSuccess(job, startedAt, null);
      await persistRuntimeStore();
      return {
        success: true,
        data: { source, phase: 'detect', change: false, summary: buildJobSummary(job) },
      };
    }

    // === 不需要 AI：直接返回检测结果 ===
    if (!job.aiEnabled) {
      updateJobSuccess(job, startedAt, detectResult.data);
      await persistRuntimeStore();
      return {
        success: true,
        data: { source, phase: 'detect', change: true, result: detectResult.data, summary: buildJobSummary(job) },
      };
    }

    // === Phase 2: AI 响应（按需） ===
    if (!checkAIBudget(job)) {
      updateJobSuccess(job, startedAt, null);
      await persistRuntimeStore();
      return {
        success: true,
        data: { source, phase: 'ai_skipped', reason: 'budget_exceeded', change: true, summary: buildJobSummary(job) },
      };
    }

    if (!_runResidentAIResponse) {
      updateJobSuccess(job, startedAt, null);
      await persistRuntimeStore();
      return {
        success: false,
        error: 'AI 响应函数未注入',
        data: { source, phase: 'ai_skipped', reason: 'no_runner', summary: buildJobSummary(job) },
      };
    }

    const aiResult = await _runResidentAIResponse(
      { id: job.id, name: job.name, tabId: job.tabId, aiPromptTemplate: job.aiPromptTemplate },
      detectResult.data,
    );
    recordAICall(job);

    if (!aiResult.success) {
      await updateJobFailure(job, startedAt, aiResult.error);
      await persistRuntimeStore();
      return {
        success: false,
        error: aiResult.error,
        data: { source, phase: 'ai_response', summary: buildJobSummary(job) },
      };
    }

    // === Phase 3: 执行动作 ===
    const replyText = aiResult.data?.reply;
    if (job.aiActionAfter && replyText) {
      const actionResult = await executePostAction(job, replyText);
      if (!actionResult.success) {
        await updateJobFailure(job, startedAt, actionResult.error);
        await persistRuntimeStore();
        return {
          success: false,
          error: actionResult.error,
          data: { source, phase: 'post_action', reply: replyText, summary: buildJobSummary(job) },
        };
      }
    }

    updateJobSuccess(job, startedAt, { reply: replyText, detectData: detectResult.data });
    await persistRuntimeStore();
    return {
      success: true,
      data: { source, phase: 'completed', change: true, reply: replyText, summary: buildJobSummary(job) },
    };
  } catch (err: any) {
    await updateJobFailure(job, startedAt, err?.message);
    await persistRuntimeStore();
    return {
      success: false,
      error: job.lastError,
      data: { source, summary: buildJobSummary(job) },
    };
  } finally {
    runningJobs.delete(jobId);
  }
};

// ============ Alarm 监听 ============

const registerAlarmListener = (): void => {
  if (alarmListenerRegistered || !hasChromeAlarms()) return;
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (!alarm.name.startsWith(RESIDENT_RUNTIME_ALARM_PREFIX)) return;
    const jobId = alarm.name.replace(RESIDENT_RUNTIME_ALARM_PREFIX, '');
    void runJobById(jobId, 'alarm');
  });
  alarmListenerRegistered = true;
};

// ============ 初始化 ============

const loadRuntimeJobs = async (): Promise<void> => {
  residentJobs.clear();
  const store = await readRuntimeStore();
  if (store?.jobs) {
    for (const rawJob of store.jobs) {
      if (!rawJob || typeof rawJob !== 'object') continue;
      const raw = rawJob as Record<string, any>;

      // workflow 来源
      const siteWorkflow = typeof raw.siteWorkflow === 'string' ? raw.siteWorkflow.trim() : '';
      if (!siteWorkflow) continue;

      const tabId = Number(raw.tabId);
      if (!Number.isFinite(tabId) || tabId <= 0) continue;

      const job: ResidentJob = {
        id: String(raw.id || '').trim(),
        name: String(raw.name || '').trim() || `resident_${siteWorkflow}`,
        tabId: Math.floor(tabId),
        params: raw.params && typeof raw.params === 'object' && !Array.isArray(raw.params)
          ? raw.params
          : {},
        intervalMs: normalizeIntervalMs(raw.intervalMs),
        maxFailures: normalizeMaxFailures(raw.maxFailures),
        enabled: raw.enabled !== false,
        createdAt: Number(raw.createdAt) || Date.now(),
        updatedAt: Number(raw.updatedAt) || Date.now(),
        lastRunAt: Number(raw.lastRunAt) || undefined,
        lastDurationMs: Number(raw.lastDurationMs) || undefined,
        lastSuccess: typeof raw.lastSuccess === 'boolean' ? raw.lastSuccess : undefined,
        lastError: typeof raw.lastError === 'string' ? raw.lastError : undefined,
        failureCount: Math.max(0, Number(raw.failureCount) || 0),

        // workflow 来源
        siteWorkflow,

        // 分层执行
        aiEnabled: raw.aiEnabled === true,
        aiPromptTemplate: typeof raw.aiPromptTemplate === 'string' ? raw.aiPromptTemplate : '',
        aiActionAfter: raw.aiActionAfter && typeof raw.aiActionAfter === 'object'
          ? raw.aiActionAfter as AIPostAction
          : undefined,

        // 去重
        lastResultHash: typeof raw.lastResultHash === 'string' ? raw.lastResultHash : undefined,

        // AI 预算
        aiBudget: {
          maxPerHour: Math.max(0, Number(raw.aiBudget?.maxPerHour) || 0),
          maxPerDay: Math.max(0, Number(raw.aiBudget?.maxPerDay) || 0),
        },
        aiCallLog: Array.isArray(raw.aiCallLog)
          ? raw.aiCallLog.filter((t: unknown) => typeof t === 'number' && Date.now() - (t as number) < AI_CALL_LOG_TTL_MS) as number[]
          : [],
      };
      if (!job.id) continue;
      residentJobs.set(job.id, job);
    }
  }
  registerAlarmListener();
  for (const job of residentJobs.values()) {
    await syncJobAlarm(job);
  }
};

export const ensureResidentRuntimeReady = async (): Promise<void> => {
  if (!residentReadyPromise) {
    residentReadyPromise = loadRuntimeJobs().catch((err) => {
      console.warn('[Mole] load resident runtime jobs failed:', err);
    });
  }
  await residentReadyPromise;
};

void ensureResidentRuntimeReady();

// ============ 工具定义 ============

export const residentRuntimeFunction: FunctionDefinition = {
  name: 'resident_runtime',
  description: 'Resident runtime. Executes workflows on a specified tab at fixed intervals with layered execution: detection layer (Plan execution, zero tokens) + AI response layer (triggered on demand). Supports start/stop/status/list/run_once. Suitable for auto-reply, periodic inspection, and continuous monitoring.',
  supportsParallel: false,
  permissionLevel: 'interact',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['start', 'stop', 'status', 'list', 'run_once'],
        description: 'Action: start (create/update and start), stop (disable), status (view single), list (view all), run_once (execute immediately once)',
      },
      job_id: {
        type: 'string',
        description: 'Job ID. Required for stop/status/run_once; if provided for start, updates the existing job',
      },
      name: {
        type: 'string',
        description: 'Job name (optional for start)',
      },
      site_workflow: {
        type: 'string',
        description: 'Site workflow name (from registry)',
      },
      tab_id: {
        type: 'number',
        description: 'Target tabId for resident execution (required for start)',
      },
      interval_ms: {
        type: 'number',
        description: 'Execution interval in milliseconds (optional for start, default 60000, range 30000~21600000)',
      },
      params: {
        type: 'object',
        description: 'Parameters object to pass to the workflow',
      },
      max_failures: {
        type: 'number',
        description: 'Consecutive failure threshold, auto-disables when reached. 0 means no auto-disable (default)',
      },
      enabled: {
        type: 'boolean',
        description: 'Whether to enable on start, default true',
      },
      ai_enabled: {
        type: 'boolean',
        description: 'Whether to enable the AI response layer. When enabled, AI generates a reply upon detecting changes',
      },
      ai_prompt_template: {
        type: 'string',
        description: 'AI prompt template. Use {{result}} to reference detection results. E.g. "Here are the latest messages:\\n{{result}}\\nPlease generate a reply"',
      },
      ai_action_after: {
        type: 'object',
        description: 'Action after AI response. action is fixed as "fill_and_send", requires selector (input field selector)',
        properties: {
          action: { type: 'string', enum: ['fill_and_send'] },
          selector: { type: 'string' },
          key: { type: 'string', description: 'Send key, default Enter' },
        },
      },
      ai_budget: {
        type: 'object',
        description: 'AI call budget limits',
        properties: {
          maxPerHour: { type: 'number', description: 'Max calls per hour, 0=unlimited' },
          maxPerDay: { type: 'number', description: 'Max calls per day, 0=unlimited' },
        },
      },
    },
    required: ['action'],
  },
  validate: (params: {
    action?: string;
    job_id?: string;
    site_workflow?: string;
    tab_id?: number;
    interval_ms?: number;
    ai_enabled?: boolean;
    ai_prompt_template?: string;
  }) => {
    const action = String(params.action || '').trim().toLowerCase() as ResidentAction;
    if (!action) return 'Missing action';
    if (action === 'start') {
      const siteWorkflow = String(params.site_workflow || '').trim();
      if (!siteWorkflow) return 'start requires site_workflow';
      if (!Number.isFinite(Number(params.tab_id)) || Number(params.tab_id) <= 0) return 'start requires a valid tab_id';
      if (params.interval_ms != null && (!Number.isFinite(Number(params.interval_ms)) || Number(params.interval_ms) <= 0)) {
        return 'interval_ms must be a positive number';
      }
      if (params.ai_enabled && !params.ai_prompt_template?.trim()) {
        return 'ai_prompt_template is required when AI response is enabled';
      }
    }
    if ((action === 'stop' || action === 'status' || action === 'run_once') && !String(params.job_id || '').trim()) {
      return `${action} requires job_id`;
    }
    return null;
  },
  execute: async (params: {
    action: ResidentAction;
    job_id?: string;
    name?: string;
    site_workflow?: string;
    tab_id?: number;
    interval_ms?: number;
    params?: Record<string, unknown>;
    max_failures?: number;
    enabled?: boolean;
    ai_enabled?: boolean;
    ai_prompt_template?: string;
    ai_action_after?: AIPostAction;
    ai_budget?: AIBudget;
  }) => {
    await ensureResidentRuntimeReady();
    const action = String(params.action || '').trim().toLowerCase() as ResidentAction;

    if (action === 'list') {
      const jobs = Array.from(residentJobs.values())
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .map(buildJobSummary);
      return {
        success: true,
        data: { total: jobs.length, jobs },
      };
    }

    const jobId = String(params.job_id || '').trim();

    if (action === 'status') {
      const job = residentJobs.get(jobId);
      if (!job) return { success: false, error: `job not found: ${jobId}` };
      return { success: true, data: buildJobSummary(job) };
    }

    if (action === 'stop') {
      const job = residentJobs.get(jobId);
      if (!job) return { success: false, error: `job not found: ${jobId}` };
      job.enabled = false;
      job.updatedAt = Date.now();
      residentJobs.set(job.id, job);
      await clearJobAlarm(job.id);
      await persistRuntimeStore();
      return {
        success: true,
        data: { message: `常驻任务已停用: ${job.name}`, job: buildJobSummary(job) },
      };
    }

    if (action === 'run_once') {
      return runJobById(jobId, 'manual', true);
    }

    if (action === 'start') {
      const siteWorkflow = String(params.site_workflow || '').trim() || undefined;
      const tabId = Math.floor(Number(params.tab_id));
      const intervalMs = normalizeIntervalMs(params.interval_ms ?? 60_000);
      const maxFailures = normalizeMaxFailures(params.max_failures);
      const now = Date.now();
      const existing = jobId ? residentJobs.get(jobId) : null;
      const nextId = existing?.id || `resident_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const nextJob: ResidentJob = {
        id: nextId,
        name: String(params.name || existing?.name || `${siteWorkflow}_常驻`).trim(),
        tabId,
        params: params.params && typeof params.params === 'object' && !Array.isArray(params.params)
          ? params.params
          : (existing?.params || {}),
        intervalMs,
        maxFailures,
        enabled: params.enabled !== false,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        lastRunAt: existing?.lastRunAt,
        lastDurationMs: existing?.lastDurationMs,
        lastSuccess: existing?.lastSuccess,
        lastError: existing?.lastError,
        failureCount: existing?.failureCount || 0,

        // workflow 来源
        siteWorkflow,

        // 分层执行配置
        aiEnabled: params.ai_enabled === true,
        aiPromptTemplate: params.ai_prompt_template || existing?.aiPromptTemplate || '',
        aiActionAfter: params.ai_action_after || existing?.aiActionAfter,

        // 去重（保留已有 hash）
        lastResultHash: existing?.lastResultHash,

        // AI 预算
        aiBudget: {
          maxPerHour: Math.max(0, Number(params.ai_budget?.maxPerHour ?? existing?.aiBudget?.maxPerHour) || 0),
          maxPerDay: Math.max(0, Number(params.ai_budget?.maxPerDay ?? existing?.aiBudget?.maxPerDay) || 0),
        },
        aiCallLog: existing?.aiCallLog || [],
      };
      residentJobs.set(nextId, nextJob);
      await syncJobAlarm(nextJob);
      await persistRuntimeStore();
      return {
        success: true,
        data: {
          message: existing ? `常驻任务已更新: ${nextJob.name}` : `常驻任务已启动: ${nextJob.name}`,
          job: buildJobSummary(nextJob),
        },
      };
    }

    return { success: false, error: `unsupported action: ${action}` };
  },
};

// ============ 供 background 直接调用的程序化接口 ============

/** 获取所有启用中的常驻任务摘要（供 UI 展示） */
export const getActiveResidentJobs = async (): Promise<Array<{
  id: string;
  name: string;
  tabId: number;
  enabled: boolean;
  intervalMs: number;
  lastRunAt?: number;
  lastSuccess?: boolean;
  failureCount: number;
  siteWorkflow?: string;
}>> => {
  await ensureResidentRuntimeReady();
  return Array.from(residentJobs.values())
    .filter(j => j.enabled)
    .map(j => ({
      id: j.id,
      name: j.name,
      tabId: j.tabId,
      enabled: j.enabled,
      intervalMs: j.intervalMs,
      lastRunAt: j.lastRunAt,
      lastSuccess: j.lastSuccess,
      failureCount: j.failureCount,
      siteWorkflow: j.siteWorkflow,
    }));
};

/** 按 ID 停用常驻任务（供 UI 手动关闭） */
export const stopResidentJobById = async (jobId: string): Promise<{ success: boolean; error?: string }> => {
  await ensureResidentRuntimeReady();
  const job = residentJobs.get(jobId);
  if (!job) return { success: false, error: `job not found: ${jobId}` };
  job.enabled = false;
  job.updatedAt = Date.now();
  residentJobs.set(job.id, job);
  await clearJobAlarm(job.id);
  await persistRuntimeStore();
  return { success: true };
};
