/** 网页失败分类与任务级访问限制；不依赖模型上下文或浏览器全局状态。 */
import type { FunctionResult } from '../functions/types';

export interface WebFailure {
  code: string;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
}

export interface WebAccessEntry extends WebFailure {
  url: string;
  aliases: string[];
  failures: number;
  nextRetryAt: number;
}

export type WebAccessSnapshot = WebAccessEntry[];
const MAX_FAILURES = 3;
const MAX_ENTRIES = 200;

/** 保留业务查询参数，仅移除片段和明确的追踪参数。 */
export const normalizeWebUrl = (raw: string): string => {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_.+|gclid|fbclid|msclkid)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.href;
  } catch { return ''; }
};

export const classifyWebPage = (page: {
  title?: string; content?: string; status?: number; retryAfterMs?: number;
}): WebFailure | undefined => {
  const { status } = page;
  if ([401, 403, 404, 410, 451].includes(status || 0)) {
    return { code: status === 404 || status === 410 ? 'E_WEB_NOT_FOUND' : 'E_WEB_ACCESS_DENIED',
      message: `目标网页返回 HTTP ${status}，当前任务停止访问此地址，请使用其他来源。`, retryable: false };
  }
  if (status === 429 || (status != null && status >= 500 && status <= 599)) {
    return { code: 'E_WEB_TEMPORARY', message: `目标网页返回 HTTP ${status}，暂时无法读取。`,
      retryable: true, retryAfterMs: page.retryAfterMs };
  }
  const title = (page.title || '').trim();
  const content = (page.content || '').replace(/\s+/g, ' ').trim();
  // 只判断错误页标题或短正文开头，避免正文中讨论 403/拒绝访问的文章被封禁。
  const denied = /^(?:(?:error\s*)?403\b[\s:：-]*)?(?:forbidden|access\s+denied|request\s+(?:was\s+)?(?:denied|rejected)|拒绝访问|访问被拒绝|禁止访问|无权访问|您(?:没有|无)权限)(?=$|[.!:：。！]|\s+(?:you\b|sorry\b|nginx\b|您))/i;
  const missing = /^(?:(?:error\s*)?(?:404|410)\b[\s:：-]*)?(?:not\s+found|page\s+not\s+found|页面不存在|网页不存在|页面已(?:删除|失效))(?=$|[.!:：。！])/i;
  const titleError = (pattern: RegExp) => title.length <= 100 && pattern.test(title);
  if ((content.length <= 800 && titleError(denied)) || (content.length <= 800 && denied.test(content))) {
    return { code: 'E_WEB_ACCESS_DENIED', message: '目标网页明确拒绝访问，当前任务停止访问此地址，请使用其他来源。', retryable: false };
  }
  if ((content.length <= 300 && titleError(missing)) || (content.length <= 300 && missing.test(content))) {
    return { code: 'E_WEB_NOT_FOUND', message: '目标网页不存在或已失效，请使用其他来源。', retryable: false };
  }
  if (page.content !== undefined && !content) {
    return { code: 'E_WEB_EMPTY', message: '页面没有可读取的正文，可能尚未加载完成。', retryable: true };
  }
  return undefined;
};

export const webFailureResult = (failure: WebFailure, url: string): FunctionResult => ({
  success: false, code: failure.code, error: failure.message, retryable: failure.retryable,
  data: { url, retry_after_ms: failure.retryAfterMs },
});

const failureFromResult = (result: FunctionResult): WebFailure | undefined => {
  if (result.success || result.code === 'E_CANCELLED') return undefined;
  if (result.code?.startsWith('E_WEB_')) return {
    code: result.code, message: result.error || '网页读取失败', retryable: result.retryable !== false,
    retryAfterMs: Number(result.data?.retry_after_ms) || undefined,
  };
  // 脚本参数错误和元素定位失败不等于网址不可访问。
  if (/超时|timed?\s*out|timeout|ERR_(?:CONNECTION|NAME_NOT_RESOLVED|INTERNET|ADDRESS)|receiving end does not exist|could not establish connection|message port closed/i.test(result.error || '')) {
    return { code: 'E_WEB_TEMPORARY', message: result.error || '网页连接失败', retryable: true };
  }
  return undefined;
};

export class WebAccessGuard {
  private entries = new Map<string, WebAccessEntry>();
  private queues = new Map<string, Promise<unknown>>();
  private now: () => number;

  constructor(snapshot: WebAccessSnapshot = [], now = () => Date.now()) {
    this.now = now;
    for (const entry of (Array.isArray(snapshot) ? snapshot : []).slice(-MAX_ENTRIES)) {
      if (!entry || typeof entry.code !== 'string' || !entry.code.startsWith('E_WEB_') ||
        typeof entry.retryable !== 'boolean' || typeof entry.message !== 'string') continue;
      const url = normalizeWebUrl(entry.url);
      if (!url || !Number.isFinite(entry.failures) || entry.failures < 1) continue;
      this.entries.set(url, { ...entry, url, failures: Math.min(MAX_FAILURES, Math.floor(entry.failures)),
        nextRetryAt: Number.isFinite(entry.nextRetryAt) ? entry.nextRetryAt : now(),
        aliases: (Array.isArray(entry.aliases) ? entry.aliases : []).map(normalizeWebUrl).filter(Boolean).slice(0, 10) });
    }
  }

  snapshot(): WebAccessSnapshot { return [...this.entries.values()].map(entry => ({ ...entry, aliases: [...entry.aliases] })); }

  private find(url: string): WebAccessEntry | undefined {
    return this.entries.get(url) || [...this.entries.values()].find(entry => entry.aliases.includes(url));
  }

  blocked(rawUrl: string): FunctionResult | undefined {
    const entry = this.find(normalizeWebUrl(rawUrl));
    if (!entry) return this.entries.size >= MAX_ENTRIES ? {
      success: false, code: 'E_WEB_ACCESS_BLOCKED', retryable: false,
      error: '本次任务已遇到过多不可用网页，请基于已有信息收尾。',
      data: { url: normalizeWebUrl(rawUrl) },
    } : undefined;
    if (!entry.retryable || entry.failures >= MAX_FAILURES) return {
      success: false, code: 'E_WEB_ACCESS_BLOCKED', retryable: false,
      error: `此地址已确认不可用，已停止重复访问。${entry.message} 请继续其他独立工作或说明缺失信息。`,
      data: { url: entry.url, cause: entry.code, attempts: entry.failures },
    };
    if (this.now() < entry.nextRetryAt) return {
      success: false, code: 'E_WEB_BACKOFF', retryable: true,
      error: '此地址仍在失败冷却期，请先使用其他来源；不要更换工具或参数重复请求。',
      data: { url: entry.url, retry_after_ms: entry.nextRetryAt - this.now(), attempts: entry.failures },
    };
    return undefined;
  }

  /** 同网址串行，排队调用在前一次结果落定后重新检查；取消不会新增失败记录。 */
  async execute(rawUrl: string, run: () => Promise<FunctionResult>, signal?: AbortSignal): Promise<FunctionResult> {
    const url = normalizeWebUrl(rawUrl);
    if (!url) return run();
    const key = this.find(url)?.url || url;
    const previous = this.queues.get(key) || Promise.resolve();
    const task = previous.catch(() => undefined).then(async () => {
      if (signal?.aborted) return { success: false, code: 'E_CANCELLED', error: '任务已取消' };
      const blocked = this.blocked(url);
      if (blocked) return blocked;
      let result: FunctionResult;
      try { result = await run(); } catch (error: unknown) {
        result = { success: false, error: error instanceof Error ? error.message : '网页访问失败',
          code: signal?.aborted ? 'E_CANCELLED' : undefined };
      }
      if (signal?.aborted) return { success: false, code: 'E_CANCELLED', error: '任务已取消' };
      if (result.code === 'E_CANCELLED') return result;
      const finalUrl = normalizeWebUrl(String(result.data?.url || '')) || url;
      const failure = failureFromResult(result);
      const old = this.find(url) || this.find(finalUrl);
      if (failure) {
        const failures = (old?.failures || 0) + 1;
        const retryAfter = Number.isFinite(failure.retryAfterMs) ? failure.retryAfterMs || 0 : 0;
        const delay = Math.max(1000 * 2 ** (failures - 1), retryAfter);
        if (old) this.entries.delete(old.url);
        this.entries.set(finalUrl, { ...failure, url: finalUrl, failures,
          aliases: [...new Set([...(old?.aliases || []), old?.url || url, url])].filter(alias => alias !== finalUrl).slice(-10),
          nextRetryAt: this.now() + delay });
      } else if (result.success && old) {
        this.entries.delete(old.url);
      }
      return result;
    });
    this.queues.set(key, task);
    try { return await task; } finally { if (this.queues.get(key) === task) this.queues.delete(key); }
  }
}
