/**
 * 站点工作流注册表
 * 职责：远端 Manifest 同步、本地存储、增删改查
 *
 * 核心理念：扩展 = 解释器引擎，Manifest = 内容分发
 * 源码中不硬编码任何 workflow 定义
 */

const STORAGE_KEY = 'mole_site_workflows_v1';
const SOURCES_KEY = 'mole_site_workflow_sources_v1';
const SYNC_ALARM_NAME = 'mole_site_workflow_sync';
const SYNC_INTERVAL_HOURS = 6;
// 本地 manifest：构建时从 public/workflows/ 复制到产物目录
// 稳定后可改回远端 URL，如 'https://logjs.site/mole/manifest.json'
const getDefaultManifestUrl = (): string => {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    return chrome.runtime.getURL('workflows/manifest.json');
  }
  return '';
};

/** 站点工作流定义 */
export interface SiteWorkflowSpec {
  name: string;
  label: string;
  description: string;
  url_patterns: string[];
  parameters: Record<string, any>;
  plan: Record<string, any>;
  enabled: boolean;
  source: 'remote' | 'user';
  manifestUrl?: string;
  version: number;
  createdAt: number;
  updatedAt: number;
}

interface WorkflowStoreShape {
  version: 1;
  updatedAt: number;
  workflows: SiteWorkflowSpec[];
}

/** Manifest 源配置 */
export interface ManifestSource {
  url: string;
  label?: string;
  enabled: boolean;
  lastSyncAt?: number;
  lastSyncError?: string;
}

interface SourcesStoreShape {
  version: 1;
  updatedAt: number;
  sources: ManifestSource[];
}

// ============ 内存缓存 ============

const workflowCache = new Map<string, SiteWorkflowSpec>();
let registryReadyPromise: Promise<void> | null = null;
let syncAlarmRegistered = false;

// ============ 存储操作 ============

const hasChromeStorage = (): boolean =>
  typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);

const hasChromeAlarms = (): boolean =>
  typeof chrome !== 'undefined' && Boolean(chrome.alarms);

const readStore = async (): Promise<WorkflowStoreShape | null> => {
  if (!hasChromeStorage()) return null;
  const result = await new Promise<Record<string, unknown>>(resolve => {
    chrome.storage.local.get(STORAGE_KEY, resolve);
  });
  const raw = result[STORAGE_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const payload = raw as WorkflowStoreShape;
  if (!Array.isArray(payload.workflows)) return null;
  return payload;
};

const persistStore = async (): Promise<void> => {
  if (!hasChromeStorage()) return;
  const workflows = Array.from(workflowCache.values())
    .sort((a, b) => a.name.localeCompare(b.name));
  const payload: WorkflowStoreShape = {
    version: 1,
    updatedAt: Date.now(),
    workflows,
  };
  await new Promise<void>(resolve => {
    chrome.storage.local.set({ [STORAGE_KEY]: payload }, resolve);
  });
};

const readSources = async (): Promise<ManifestSource[]> => {
  if (!hasChromeStorage()) return [];
  const result = await new Promise<Record<string, unknown>>(resolve => {
    chrome.storage.local.get(SOURCES_KEY, resolve);
  });
  const raw = result[SOURCES_KEY];
  if (!raw || typeof raw !== 'object') return [];
  const payload = raw as SourcesStoreShape;
  return Array.isArray(payload.sources) ? payload.sources : [];
};

const persistSources = async (sources: ManifestSource[]): Promise<void> => {
  if (!hasChromeStorage()) return;
  const payload: SourcesStoreShape = {
    version: 1,
    updatedAt: Date.now(),
    sources,
  };
  await new Promise<void>(resolve => {
    chrome.storage.local.set({ [SOURCES_KEY]: payload }, resolve);
  });
};

// ============ Manifest 同步 ============

/** 校验单个 workflow 定义的合法性 */
const validateWorkflowSpec = (raw: unknown): SiteWorkflowSpec | null => {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;

  const name = String(source.name || '').trim();
  if (!name || name.length > 64) return null;

  const label = String(source.label || '').trim();
  if (!label) return null;

  const description = String(source.description || '').trim();
  if (!description) return null;

  const urlPatterns = Array.isArray(source.url_patterns) ? source.url_patterns : [];
  if (urlPatterns.length === 0) return null;
  const validPatterns = urlPatterns
    .map((p: unknown) => String(p || '').trim())
    .filter(Boolean);
  if (validPatterns.length === 0) return null;

  const plan = source.plan;
  if (!plan || typeof plan !== 'object') return null;
  const planObj = plan as Record<string, unknown>;
  if (!Array.isArray(planObj.steps) || planObj.steps.length === 0) return null;

  const parameters = source.parameters && typeof source.parameters === 'object'
    ? source.parameters as Record<string, any>
    : { type: 'object', properties: {} };

  return {
    name,
    label,
    description,
    url_patterns: validPatterns,
    parameters,
    plan: plan as Record<string, any>,
    enabled: source.enabled !== false,
    source: 'remote',
    version: Math.max(1, Math.floor(Number(source.version) || 1)),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
};

/** 从远端 URL 拉取并合并 Manifest */
const syncFromManifestUrl = async (manifestUrl: string): Promise<{
  imported: number;
  skipped: number;
  removed: number;
  error?: string;
}> => {
  try {
    const response = await fetch(manifestUrl, { cache: 'no-store' });
    if (!response.ok) {
      return { imported: 0, skipped: 0, removed: 0, error: `HTTP ${response.status}` };
    }
    const payload = await response.json();
    const rawWorkflows = Array.isArray(payload?.workflows) ? payload.workflows : [];

    // 收集本次 manifest 中的 workflow name 集合
    const incomingNames = new Set<string>();
    let imported = 0;
    let skipped = 0;
    for (const raw of rawWorkflows) {
      const spec = validateWorkflowSpec(raw);
      if (!spec) {
        skipped++;
        continue;
      }
      spec.manifestUrl = manifestUrl;
      incomingNames.add(spec.name);

      // 合并策略：user 来源的永远不覆盖
      const existing = workflowCache.get(spec.name);
      if (existing?.source === 'user') {
        skipped++;
        continue;
      }
      // remote 来源：只有版本更大才覆盖
      if (existing?.source === 'remote' && existing.version >= spec.version) {
        skipped++;
        continue;
      }
      // 保留已有时间戳
      if (existing) {
        spec.createdAt = existing.createdAt;
      }

      workflowCache.set(spec.name, spec);
      imported++;
    }

    // 清理：来自同一 manifestUrl 但已不在最新 manifest 中的 remote workflow
    let removed = 0;
    for (const [name, cached] of Array.from(workflowCache.entries())) {
      if (cached.source !== 'remote') continue;
      if (cached.manifestUrl !== manifestUrl) continue;
      if (incomingNames.has(name)) continue;
      workflowCache.delete(name);
      removed++;
    }

    return { imported, skipped, removed };
  } catch (err: any) {
    return { imported: 0, skipped: 0, removed: 0, error: err?.message || '拉取失败' };
  }
};

/** 从所有已配置的 Manifest 源同步 */
export const syncAllManifests = async (): Promise<{
  totalImported: number;
  totalSkipped: number;
  errors: string[];
}> => {
  const sources = await readSources();
  const enabledSources = sources.filter(s => s.enabled && s.url);

  let totalImported = 0;
  let totalSkipped = 0;
  const errors: string[] = [];

  for (const src of enabledSources) {
    const result = await syncFromManifestUrl(src.url);
    totalImported += result.imported;
    totalSkipped += result.skipped;
    src.lastSyncAt = Date.now();
    src.lastSyncError = result.error;
    if (result.error) {
      errors.push(`${src.url}: ${result.error}`);
    }
  }

  if (enabledSources.length > 0) {
    await persistSources(sources);
  }
  if (totalImported > 0) {
    await persistStore();
  }

  return { totalImported, totalSkipped, errors };
};

// ============ 定时同步 ============

const registerSyncAlarm = (): void => {
  if (syncAlarmRegistered || !hasChromeAlarms()) return;
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name !== SYNC_ALARM_NAME) return;
    void syncAllManifests();
  });
  chrome.alarms.create(SYNC_ALARM_NAME, {
    delayInMinutes: SYNC_INTERVAL_HOURS * 60,
    periodInMinutes: SYNC_INTERVAL_HOURS * 60,
  });
  syncAlarmRegistered = true;
};

// ============ 初始化 ============

const loadFromStore = async (): Promise<void> => {
  workflowCache.clear();
  const store = await readStore();
  if (store?.workflows) {
    for (const raw of store.workflows) {
      const spec = validateWorkflowSpec(raw);
      if (!spec) continue;
      // 恢复已存储的来源信息
      spec.source = (raw as any).source === 'user' ? 'user' : 'remote';
      spec.manifestUrl = typeof (raw as any).manifestUrl === 'string' ? (raw as any).manifestUrl : undefined;
      spec.createdAt = Number((raw as any).createdAt) || Date.now();
      spec.updatedAt = Number((raw as any).updatedAt) || Date.now();
      workflowCache.set(spec.name, spec);
    }
  }
  // 首次安装时自动注入默认 Manifest 源；迁移旧远端源
  const defaultUrl = getDefaultManifestUrl();
  if (defaultUrl) {
    const sources = await readSources();
    // 迁移：清理旧版本（easychat 时代）的远端源，该 URL 字面量仅用于匹配历史数据
    const oldRemoteUrl = 'https://logjs.site/easychat/manifest.json';
    const oldIdx = sources.findIndex(s => s.url === oldRemoteUrl);
    if (oldIdx >= 0) sources.splice(oldIdx, 1);
    // 注入本地源
    const hasDefault = sources.some(s => s.url === defaultUrl);
    if (!hasDefault) {
      sources.push({ url: defaultUrl, label: 'Mole 内置', enabled: true });
    }
    if (oldIdx >= 0 || !hasDefault) {
      await persistSources(sources);
    }
  }
  registerSyncAlarm();
  // 启动时触发一次同步（不阻塞初始化）
  void syncAllManifests();
};

export const ensureSiteWorkflowRegistryReady = async (): Promise<void> => {
  if (!registryReadyPromise) {
    registryReadyPromise = loadFromStore().catch(err => {
      console.warn('[Mole] 加载站点工作流注册表失败:', err);
    });
  }
  await registryReadyPromise;
};

void ensureSiteWorkflowRegistryReady();

// ============ 查询接口 ============

/** 获取所有已注册的 workflow */
export const listSiteWorkflows = async (): Promise<SiteWorkflowSpec[]> => {
  await ensureSiteWorkflowRegistryReady();
  return Array.from(workflowCache.values())
    .sort((a, b) => a.name.localeCompare(b.name));
};

/** 根据 name 获取单个 workflow */
export const getSiteWorkflow = async (name: string): Promise<SiteWorkflowSpec | null> => {
  await ensureSiteWorkflowRegistryReady();
  return workflowCache.get(name) || null;
};

// ============ 管理接口 ============

/** 添加或更新用户自定义 workflow */
export const upsertUserWorkflow = async (raw: unknown): Promise<{
  success: boolean;
  message: string;
}> => {
  await ensureSiteWorkflowRegistryReady();
  const spec = validateWorkflowSpec(raw);
  if (!spec) {
    return { success: false, message: 'workflow 定义不合法' };
  }
  spec.source = 'user';
  spec.manifestUrl = undefined;

  const existing = workflowCache.get(spec.name);
  if (existing) {
    spec.createdAt = existing.createdAt;
  }

  workflowCache.set(spec.name, spec);
  await persistStore();
  return { success: true, message: `用户 workflow 已更新：${spec.name}` };
};

/** 删除 workflow（仅 user 来源可删） */
export const removeUserWorkflow = async (name: string): Promise<{
  success: boolean;
  message: string;
}> => {
  await ensureSiteWorkflowRegistryReady();
  const existing = workflowCache.get(name);
  if (!existing) return { success: false, message: `workflow 不存在：${name}` };
  if (existing.source !== 'user') return { success: false, message: `只能删除用户自定义 workflow` };
  workflowCache.delete(name);
  await persistStore();
  return { success: true, message: `workflow 已删除：${name}` };
};

/** 重置某个 workflow 为远端版本（将 user 来源重置为 remote） */
export const resetWorkflowToRemote = async (name: string): Promise<{
  success: boolean;
  message: string;
}> => {
  await ensureSiteWorkflowRegistryReady();
  const existing = workflowCache.get(name);
  if (!existing) return { success: false, message: `workflow 不存在：${name}` };
  if (existing.source !== 'user') return { success: false, message: `该 workflow 已经是远端版本` };
  workflowCache.delete(name);
  await persistStore();
  // 触发同步以恢复远端版本
  await syncAllManifests();
  return { success: true, message: `workflow 已重置为远端版本：${name}` };
};

// ============ Manifest 源管理 ============

/** 获取所有 Manifest 源 */
export const listManifestSources = async (): Promise<ManifestSource[]> => {
  return readSources();
};

/** 添加 Manifest 源 */
export const addManifestSource = async (url: string, label?: string): Promise<{
  success: boolean;
  message: string;
}> => {
  const trimmedUrl = String(url || '').trim();
  if (!/^https?:\/\//i.test(trimmedUrl)) {
    return { success: false, message: 'Manifest URL 必须是 http/https' };
  }
  const sources = await readSources();
  const exists = sources.some(s => s.url === trimmedUrl);
  if (exists) return { success: false, message: '该 Manifest 源已存在' };
  sources.push({
    url: trimmedUrl,
    label: label || trimmedUrl,
    enabled: true,
  });
  await persistSources(sources);
  // 立即同步新源
  await syncFromManifestUrl(trimmedUrl);
  await persistStore();
  return { success: true, message: `Manifest 源已添加：${trimmedUrl}` };
};

/** 移除 Manifest 源 */
export const removeManifestSource = async (url: string): Promise<{
  success: boolean;
  message: string;
}> => {
  const sources = await readSources();
  const index = sources.findIndex(s => s.url === url);
  if (index < 0) return { success: false, message: '该 Manifest 源不存在' };
  sources.splice(index, 1);
  await persistSources(sources);
  return { success: true, message: `Manifest 源已移除：${url}` };
};

/** 强制从存储重新加载缓存（用于 Options 页面修改后的热重载） */
export const reloadRegistryFromStore = async (): Promise<void> => {
  workflowCache.clear();
  registryReadyPromise = null;
  await ensureSiteWorkflowRegistryReady();
};
