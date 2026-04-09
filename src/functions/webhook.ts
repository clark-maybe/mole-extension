/**
 * Webhook 远端通知工具
 * 向用户配置的 webhook URL 发送推送通知
 * 支持通用 webhook 和 Bark（iOS 推送）深度适配
 */

import type { FunctionDefinition } from './types';

/* ---------- Webhook 配置类型与存取 ---------- */

const WEBHOOK_CONFIG_KEY = 'mole_webhook_config_v1';
const WEBHOOK_TIMEOUT_MS = 10_000;

/** webhook 类型 */
export type WebhookType = 'generic' | 'bark';

/** Bark 专属配置 */
export interface BarkConfig {
  /** Bark 服务器地址（如 https://api.day.app） */
  server: string;
  /** 设备 Key */
  deviceKey: string;
  /** 推送分组 */
  group?: string;
  /** 自定义图标 URL */
  icon?: string;
  /** 提示音 */
  sound?: string;
  /** 点击跳转 URL */
  clickUrl?: string;
  /** 时效性通知级别 */
  level?: 'active' | 'timeSensitive' | 'passive';
}

/** 单条 webhook 配置 */
export interface WebhookEntry {
  id: string;
  name: string;
  type: WebhookType;
  enabled: boolean;
  createdAt: number;
  /** 通用 webhook 字段 */
  url?: string;
  headers?: Record<string, string>;
  /** Bark 专属配置 */
  bark?: BarkConfig;
}

interface WebhookConfigStore {
  version: 1;
  updatedAt: number;
  webhooks: WebhookEntry[];
}

/** 读取 webhook 配置列表 */
export const readWebhookConfig = async (): Promise<WebhookEntry[]> => {
  const result = await new Promise<Record<string, unknown>>((resolve) => {
    chrome.storage.local.get(WEBHOOK_CONFIG_KEY, resolve);
  });
  const raw = result[WEBHOOK_CONFIG_KEY] as WebhookConfigStore | undefined;
  if (!raw || !Array.isArray(raw.webhooks)) return [];
  return raw.webhooks;
};

/** 保存 webhook 配置列表 */
export const saveWebhookConfig = async (entries: WebhookEntry[]): Promise<void> => {
  const payload: WebhookConfigStore = {
    version: 1,
    updatedAt: Date.now(),
    webhooks: entries,
  };
  await new Promise<void>((resolve) => {
    chrome.storage.local.set({ [WEBHOOK_CONFIG_KEY]: payload }, resolve);
  });
};

/* ---------- 发送逻辑 ---------- */

/** 构建 Bark 推送请求 */
const buildBarkRequest = (
  bark: BarkConfig,
  body: { title: string; message: string },
): { url: string; init: RequestInit } => {
  const server = bark.server.replace(/\/+$/, '');
  const pushUrl = `${server}/${encodeURIComponent(bark.deviceKey)}/${encodeURIComponent(body.title)}/${encodeURIComponent(body.message)}`;

  const params = new URLSearchParams();
  if (bark.group) params.set('group', bark.group);
  if (bark.icon) params.set('icon', bark.icon);
  if (bark.sound) params.set('sound', bark.sound);
  if (bark.clickUrl) params.set('url', bark.clickUrl);
  if (bark.level) params.set('level', bark.level);

  const qs = params.toString();
  const finalUrl = qs ? `${pushUrl}?${qs}` : pushUrl;

  return { url: finalUrl, init: { method: 'GET' } };
};

/** 构建通用 webhook 请求 */
const buildGenericRequest = (
  entry: WebhookEntry,
  body: { title: string; message: string },
): { url: string; init: RequestInit } => {
  return {
    url: entry.url!,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(entry.headers || {}),
      },
      body: JSON.stringify({
        ...body,
        timestamp: Date.now(),
        source: 'mole-extension',
      }),
    },
  };
};

/** 向单个 webhook 发送通知 */
export const sendToWebhook = async (
  entry: WebhookEntry,
  body: { title: string; message: string },
): Promise<{ success: boolean; message: string }> => {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

  try {
    const { url, init } =
      entry.type === 'bark' && entry.bark
        ? buildBarkRequest(entry.bark, body)
        : buildGenericRequest(entry, body);

    const response = await fetch(url, { ...init, signal: controller.signal });

    if (!response.ok) {
      return { success: false, message: `HTTP ${response.status}` };
    }

    // Bark 返回 JSON { code: 200, message: 'success' }
    if (entry.type === 'bark') {
      try {
        const json = await response.json();
        if (json.code !== undefined && json.code !== 200) {
          return { success: false, message: json.message || `Bark code ${json.code}` };
        }
      } catch {
        // 非 JSON 响应，HTTP 200 视为成功
      }
    }

    return { success: true, message: 'OK' };
  } catch (err: any) {
    if (controller.signal.aborted) {
      return { success: false, message: '请求超时（10s）' };
    }
    return { success: false, message: err?.message || '请求失败' };
  } finally {
    clearTimeout(timer);
  }
};

/** 获取 entry 的展示 URL（用于 Options 页面） */
export const getEntryDisplayUrl = (entry: WebhookEntry): string => {
  if (entry.type === 'bark' && entry.bark) {
    const server = entry.bark.server.replace(/\/+$/, '');
    return `${server}/${entry.bark.deviceKey.slice(0, 8)}…`;
  }
  return entry.url || '';
};

/* ---------- 工具定义 ---------- */

export const webhookFunction: FunctionDefinition = {
  name: 'webhook',
  description:
    'Send a notification to remote webhook endpoints (Bark, Feishu, Slack, Discord, WeChat Work, etc.) configured by the user in Options page. ' +
    'Use this tool when you need to push results, alerts, or reminders to external platforms. ' +
    'The user must configure at least one enabled webhook in Options > Webhook before this tool works.\n\n' +
    '⚠️ Do NOT use this tool for browser desktop notifications — use the "notification" tool instead.',
  supportsParallel: true,
  permissionLevel: 'interact',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Notification title',
      },
      message: {
        type: 'string',
        description: 'Notification body text',
      },
    },
    required: ['title', 'message'],
  },
  execute: async (params: { title: string; message: string }) => {
    const { title, message } = params;

    const entries = await readWebhookConfig();
    const enabled = entries.filter((e) => e.enabled);

    if (enabled.length === 0) {
      return {
        success: false,
        error: '没有已启用的 Webhook，请在 Options > Webhook 页面添加并启用至少一个 Webhook',
      };
    }

    const results: string[] = [];
    let hasError = false;

    for (const entry of enabled) {
      const result = await sendToWebhook(entry, { title, message });
      if (result.success) {
        results.push(`[${entry.name}] 发送成功`);
      } else {
        hasError = true;
        results.push(`[${entry.name}] 失败: ${result.message}`);
      }
    }

    return {
      success: !hasError,
      data: {
        message: results.join('；'),
        sent: enabled.length,
        failed: hasError ? results.filter((r) => r.includes('失败')).length : 0,
      },
    };
  },
};
