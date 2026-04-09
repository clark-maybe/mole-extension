/**
 * 函数注册表（MCP 架构）
 * 支持内置工具 + 动态扩展工具（持久化在 chrome.storage.local）
 */

import type { ToolSchema } from '../ai/types';
import { MCPServer } from '../mcp/server';
import { InMemoryTransport } from '../mcp/transport';
import { MCPClient } from '../mcp/client';
import { mcpToolsToSchema } from '../mcp/adapters';
import type { FunctionDefinition, FunctionResult, ToolExecutionContext } from './types';
import { pageFunction } from './page';
import { timerFunction } from './timer';
import { fetchUrlFunction } from './fetch-url';
import { tabNavigateFunction } from './tab-navigate';
import { clipboardOpsFunction } from './clipboard-ops';
import { screenshotFunction } from './screenshot';
import { selectionContextFunction } from './selection-context';
import { storageKvFunction } from './storage-kv';
import { notificationFunction } from './notification';
import { bookmarkOpsFunction } from './bookmark-ops';
import { historySearchFunction } from './history-search';
import { downloadFileFunction } from './download-file';
import { residentRuntimeFunction } from './resident-runtime';
import { skillFunction } from './skill';
import { cdpInputFunction } from './cdp-input';
import { cdpDialogFunction } from './cdp-dialog';
import { cdpFrameFunction } from './cdp-frame';
import { cdpNetworkFunction } from './cdp-network';
import { cdpEmulationFunction } from './cdp-emulation';
import { cdpDomFunction } from './cdp-dom';
import { cdpDebugFunction } from './cdp-debug';
import { extractDataFunction } from './extract-data';
import { dataPipelineFunction } from './data-pipeline';
import { requestConfirmationFunction } from './request-confirmation';
import { askUserFunction } from './ask-user';
import { saveWorkflowFunction } from './save-workflow';
import { loadToolsFunction } from './load-tools';
import { webhookFunction } from './webhook';

const DYNAMIC_TOOL_STORAGE_KEY = 'mole_dynamic_tools_v1';
const DYNAMIC_TOOL_MAX_TIMEOUT_MS = 60_000;
const DYNAMIC_TOOL_DEFAULT_TIMEOUT_MS = 15_000;
const DYNAMIC_TOOL_NAME_PATTERN = /^[a-z][a-z0-9_:-]{1,63}$/;
const DYNAMIC_TOOL_HTTP_METHOD_SET = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

export interface DynamicToolSpec {
  name: string;
  description: string;
  parameters: Record<string, any>;
  supportsParallel?: boolean;
  endpoint: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  timeoutMs?: number;
  enabled?: boolean;
}

interface DynamicToolStoreShape {
  version: 1;
  updatedAt: number;
  tools: DynamicToolSpec[];
}

export interface DynamicToolMutationResult {
  success: boolean;
  message: string;
  tool?: DynamicToolSpec;
}

export interface DynamicToolImportResult {
  success: boolean;
  message: string;
  imported: number;
  removed: number;
  skipped: number;
}

const BUILTIN_FUNCTIONS: FunctionDefinition[] = [
  pageFunction,
  timerFunction,
  fetchUrlFunction,
  tabNavigateFunction,
  clipboardOpsFunction,
  screenshotFunction,
  selectionContextFunction,
  storageKvFunction,
  notificationFunction,
  bookmarkOpsFunction,
  historySearchFunction,
  downloadFileFunction,
  residentRuntimeFunction,
  skillFunction,
  cdpInputFunction,
  cdpDialogFunction,
  cdpFrameFunction,
  cdpNetworkFunction,
  cdpEmulationFunction,
  cdpDomFunction,
  cdpDebugFunction,
  extractDataFunction,
  dataPipelineFunction,
  requestConfirmationFunction,
  askUserFunction,
  saveWorkflowFunction,
  loadToolsFunction,
  webhookFunction,
];

const builtinToolNames = new Set(BUILTIN_FUNCTIONS.map((tool) => tool.name));
/** 内置工具名称到定义的映射（供 workflow 等模块按名称查找） */
const builtinToolMap = new Map<string, FunctionDefinition>(
  BUILTIN_FUNCTIONS.map((tool) => [tool.name, tool]),
);

/** 按名称查找内置工具定义 */
export const getBuiltinFunction = (name: string): FunctionDefinition | undefined => {
  return builtinToolMap.get(name);
};

/** 获取所有内置工具名称列表 */
export const getBuiltinFunctionNames = (): string[] => {
  return BUILTIN_FUNCTIONS.map((tool) => tool.name);
};
const dynamicToolSpecs = new Map<string, DynamicToolSpec>();

/** MCP Server 实例 */
const mcpServer = new MCPServer();
for (const tool of BUILTIN_FUNCTIONS) {
  mcpServer.registerTool(tool);
}

/** 内存传输层 */
const transport = new InMemoryTransport(mcpServer);

/** MCP Client 实例（供 orchestrator 和 background 使用） */
export const mcpClient = new MCPClient(transport);

let toolRegistryReadyPromise: Promise<void> | null = null;

const hasChromeStorage = (): boolean => {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
};

const readDynamicToolStore = async (): Promise<DynamicToolStoreShape | null> => {
  if (!hasChromeStorage()) return null;
  const result = await new Promise<Record<string, unknown>>((resolve) => {
    chrome.storage.local.get(DYNAMIC_TOOL_STORAGE_KEY, resolve);
  });
  const raw = result[DYNAMIC_TOOL_STORAGE_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const payload = raw as DynamicToolStoreShape;
  if (!Array.isArray(payload.tools)) return null;
  return payload;
};

const persistDynamicToolStore = async (): Promise<void> => {
  if (!hasChromeStorage()) return;
  const tools = Array.from(dynamicToolSpecs.values())
    .sort((left, right) => left.name.localeCompare(right.name));
  const payload: DynamicToolStoreShape = {
    version: 1,
    updatedAt: Date.now(),
    tools,
  };
  await new Promise<void>((resolve) => {
    chrome.storage.local.set({ [DYNAMIC_TOOL_STORAGE_KEY]: payload }, resolve);
  });
};

const normalizeDynamicToolSpec = (
  raw: unknown,
): { ok: true; spec: DynamicToolSpec } | { ok: false; message: string } => {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, message: '工具配置必须是对象' };
  }
  const source = raw as Record<string, unknown>;
  const name = String(source.name || '').trim();
  if (!DYNAMIC_TOOL_NAME_PATTERN.test(name)) {
    return { ok: false, message: '工具名不合法（仅支持小写字母、数字、下划线、连字符）' };
  }
  if (builtinToolNames.has(name)) {
    return { ok: false, message: `工具名冲突：${name} 已是内置工具` };
  }
  const description = String(source.description || '').trim();
  if (!description) {
    return { ok: false, message: 'description 不能为空' };
  }
  const parameters = source.parameters;
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    return { ok: false, message: 'parameters 必须是 JSON Schema 对象' };
  }
  const endpoint = String(source.endpoint || '').trim();
  if (!/^https?:\/\//i.test(endpoint) && !/^mock:\/\//i.test(endpoint)) {
    return { ok: false, message: 'endpoint 必须是 http/https URL 或 mock:// 协议' };
  }
  const method = String(source.method || 'POST').trim().toUpperCase();
  if (!DYNAMIC_TOOL_HTTP_METHOD_SET.has(method)) {
    return { ok: false, message: `不支持的 method: ${method}` };
  }
  const timeoutRaw = Number(source.timeoutMs);
  const timeoutMs = Number.isFinite(timeoutRaw)
    ? Math.max(500, Math.min(DYNAMIC_TOOL_MAX_TIMEOUT_MS, Math.floor(timeoutRaw)))
    : DYNAMIC_TOOL_DEFAULT_TIMEOUT_MS;

  const headers: Record<string, string> = {};
  if (source.headers && typeof source.headers === 'object' && !Array.isArray(source.headers)) {
    for (const [key, value] of Object.entries(source.headers)) {
      const normalizedKey = String(key || '').trim();
      const normalizedValue = String(value || '').trim();
      if (!normalizedKey) continue;
      headers[normalizedKey] = normalizedValue;
    }
  }

  return {
    ok: true,
    spec: {
      name,
      description,
      parameters: parameters as Record<string, any>,
      supportsParallel: source.supportsParallel === true,
      endpoint,
      method: method as DynamicToolSpec['method'],
      headers,
      timeoutMs,
      enabled: source.enabled !== false,
    },
  };
};

const executeDynamicHttpTool = async (
  spec: DynamicToolSpec,
  params: any,
  context?: ToolExecutionContext,
): Promise<FunctionResult> => {
  const sleepWithAbort = async (ms: number, signal?: AbortSignal): Promise<void> => {
    if (ms <= 0) return;
    await new Promise<void>((resolve, reject) => {
      const timer = globalThis.setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(new Error('aborted'));
      };
      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  };

  const isMockEndpoint = /^mock:\/\//i.test(spec.endpoint);
  if (isMockEndpoint) {
    const mockRoute = String(spec.endpoint || '').replace(/^mock:\/\//i, '').trim().toLowerCase();
    const segments = mockRoute.split('/').filter(Boolean);
    const mode = segments[0] || 'ok';
    const delayMsRaw = Number(segments[1]);
    const delayMs = Number.isFinite(delayMsRaw) ? Math.max(0, Math.min(30_000, Math.floor(delayMsRaw))) : 0;
    if (delayMs > 0) {
      try {
        await sleepWithAbort(delayMs, context?.signal);
      } catch {
        return {
          success: false,
          error: 'aborted by user',
        };
      }
    }
    if (mode === 'error') {
      return {
        success: false,
        error: 'mock endpoint error',
        data: {
          mock: true,
          mode,
          tool: spec.name,
          received: params && typeof params === 'object' ? params : {},
        },
      };
    }
    return {
      success: true,
      data: {
        mock: true,
        mode: delayMs > 0 ? 'delay' : 'ok',
        delayMs,
        tool: spec.name,
        received: params && typeof params === 'object' ? params : {},
        context: {
          tabId: context?.tabId ?? null,
          timestamp: Date.now(),
        },
      },
    };
  }

  const timeoutMs = Math.max(500, Math.min(DYNAMIC_TOOL_MAX_TIMEOUT_MS, Number(spec.timeoutMs || DYNAMIC_TOOL_DEFAULT_TIMEOUT_MS)));
  const method = String(spec.method || 'POST').toUpperCase();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(spec.headers || {}),
  };
  const payload = {
    tool: spec.name,
    params: params && typeof params === 'object' ? params : {},
    context: {
      tabId: context?.tabId ?? null,
      timestamp: Date.now(),
    },
  };

  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  if (context?.signal) {
    if (context.signal.aborted) {
      clearTimeout(timeoutId);
      return {
        success: false,
        error: 'aborted by user',
      };
    }
    context.signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    let requestUrl = spec.endpoint;
    let body: string | undefined;
    if (method === 'GET') {
      const query = encodeURIComponent(JSON.stringify(payload));
      requestUrl += `${requestUrl.includes('?') ? '&' : '?'}input=${query}`;
    } else {
      body = JSON.stringify(payload);
    }

    const response = await fetch(requestUrl, {
      method,
      headers,
      body,
      signal: controller.signal,
      cache: 'no-store',
    });
    const text = await response.text();

    let parsed: any = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }

    if (!response.ok) {
      return {
        success: false,
        error: parsed?.error || parsed?.message || `HTTP ${response.status}`,
        data: parsed?.data,
      };
    }

    if (parsed && typeof parsed === 'object' && typeof parsed.success === 'boolean') {
      return {
        success: parsed.success,
        data: parsed.data,
        error: typeof parsed.error === 'string' ? parsed.error : undefined,
      };
    }

    return {
      success: true,
      data: parsed ?? text ?? null,
    };
  } catch (err: any) {
    if (controller.signal.aborted) {
      return {
        success: false,
        error: context?.signal?.aborted ? 'aborted by user' : 'dynamic tool request timeout',
      };
    }
    return {
      success: false,
      error: err?.message || 'dynamic tool request failed',
    };
  } finally {
    clearTimeout(timeoutId);
    if (context?.signal) {
      context.signal.removeEventListener('abort', onAbort);
    }
  }
};

const toFunctionDefinition = (spec: DynamicToolSpec): FunctionDefinition => {
  return {
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    supportsParallel: spec.supportsParallel === true,
    execute: (params, context) => executeDynamicHttpTool(spec, params, context),
  };
};

const loadDynamicToolsFromStore = async (): Promise<void> => {
  const stored = await readDynamicToolStore();
  dynamicToolSpecs.clear();
  if (!stored?.tools) return;

  for (const rawSpec of stored.tools) {
    const normalized = normalizeDynamicToolSpec(rawSpec);
    if (!normalized.ok) continue;
    const spec = normalized.spec;
    if (spec.enabled === false) continue;
    dynamicToolSpecs.set(spec.name, spec);
    mcpServer.registerTool(toFunctionDefinition(spec));
  }
};

export const ensureToolRegistryReady = async (): Promise<void> => {
  if (!toolRegistryReadyPromise) {
    toolRegistryReadyPromise = loadDynamicToolsFromStore().catch((err) => {
      console.warn('[Mole] 加载动态工具失败:', err);
    });
  }
  await toolRegistryReadyPromise;
};

void ensureToolRegistryReady();

export const listDynamicTools = async (): Promise<DynamicToolSpec[]> => {
  await ensureToolRegistryReady();
  return Array.from(dynamicToolSpecs.values())
    .sort((left, right) => left.name.localeCompare(right.name));
};

export const upsertDynamicTool = async (rawSpec: unknown): Promise<DynamicToolMutationResult> => {
  await ensureToolRegistryReady();
  const normalized = normalizeDynamicToolSpec(rawSpec);
  if (!normalized.ok) {
    return {
      success: false,
      message: normalized.message,
    };
  }
  const spec = normalized.spec;
  dynamicToolSpecs.set(spec.name, spec);
  mcpServer.registerTool(toFunctionDefinition(spec));
  await persistDynamicToolStore();
  return {
    success: true,
    message: `动态工具已更新：${spec.name}`,
    tool: spec,
  };
};

export const removeDynamicTool = async (nameRaw: unknown): Promise<DynamicToolMutationResult> => {
  await ensureToolRegistryReady();
  const name = String(nameRaw || '').trim();
  if (!name) {
    return { success: false, message: '缺少工具名' };
  }
  if (builtinToolNames.has(name)) {
    return { success: false, message: `不能移除内置工具：${name}` };
  }
  const existed = dynamicToolSpecs.delete(name);
  if (!existed) {
    return { success: false, message: `工具不存在：${name}` };
  }
  mcpServer.unregisterTool(name);
  await persistDynamicToolStore();
  return {
    success: true,
    message: `动态工具已移除：${name}`,
  };
};

export const importDynamicToolsFromManifest = async (
  manifestUrlRaw: unknown,
  replaceAll: boolean = false,
): Promise<DynamicToolImportResult> => {
  await ensureToolRegistryReady();
  const manifestUrl = String(manifestUrlRaw || '').trim();
  if (!/^https?:\/\//i.test(manifestUrl)) {
    return {
      success: false,
      message: 'manifest URL 必须是 http/https',
      imported: 0,
      removed: 0,
      skipped: 0,
    };
  }

  try {
    const response = await fetch(manifestUrl, { cache: 'no-store' });
    if (!response.ok) {
      return {
        success: false,
        message: `拉取 manifest 失败：HTTP ${response.status}`,
        imported: 0,
        removed: 0,
        skipped: 0,
      };
    }

    const payload = await response.json();
    const rawTools = Array.isArray(payload)
      ? payload
      : (Array.isArray(payload?.tools) ? payload.tools : []);
    if (!Array.isArray(rawTools)) {
      return {
        success: false,
        message: 'manifest 格式错误：未找到 tools 数组',
        imported: 0,
        removed: 0,
        skipped: 0,
      };
    }

    let imported = 0;
    let skipped = 0;
    const incomingNames = new Set<string>();
    for (const rawSpec of rawTools) {
      const normalized = normalizeDynamicToolSpec(rawSpec);
      if (!normalized.ok) {
        skipped += 1;
        continue;
      }
      const spec = normalized.spec;
      incomingNames.add(spec.name);
      dynamicToolSpecs.set(spec.name, spec);
      mcpServer.registerTool(toFunctionDefinition(spec));
      imported += 1;
    }

    let removed = 0;
    if (replaceAll) {
      const existingNames = Array.from(dynamicToolSpecs.keys());
      for (const name of existingNames) {
        if (incomingNames.has(name)) continue;
        dynamicToolSpecs.delete(name);
        mcpServer.unregisterTool(name);
        removed += 1;
      }
    }

    await persistDynamicToolStore();
    return {
      success: true,
      message: `manifest 导入完成：新增/更新 ${imported}，移除 ${removed}，跳过 ${skipped}`,
      imported,
      removed,
      skipped,
    };
  } catch (err: any) {
    return {
      success: false,
      message: err?.message || '拉取 manifest 失败',
      imported: 0,
      removed: 0,
      skipped: 0,
    };
  }
};

/**
 * 获取所有函数的 schema（传给 LLM 的 tools 参数）
 */
export const getFunctionSchemas = async (): Promise<ToolSchema[]> => {
  await ensureToolRegistryReady();
  const tools = await mcpClient.listTools();
  return mcpToolsToSchema(tools);
};
