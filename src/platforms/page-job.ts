/** 平台读取使用独立页签与既有 CDP 管理器，避免覆盖用户当前页面。 */
import { CDPSessionManager } from '../lib/cdp-session';
import { workspaceRepository } from '../lib/workspace-db/repository';
import type { Json, TaskAttempt } from '../workspace/types';

export class PlatformError extends Error {
  disposition: 'waiting' | 'retry' | 'failed';
  constructor(message: string, disposition: 'waiting' | 'retry' | 'failed' = 'failed') {
    super(message); this.disposition = disposition;
  }
}

/** 证据只保留业务数据，鉴权、签名及请求调试信息不离开页面环境。 */
export function businessJson(value: unknown): Json {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(businessJson);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key, entry]) => entry !== undefined && !/^(authorization|cookie|set-cookie|headers|requestheaders|app_token|access.?token|token|sign|nonce|debug)$/i.test(key))
      .map(([key, entry]) => [key, businessJson(entry)]));
  }
  return null;
}

export async function runReadPageJob(attempt: TaskAttempt, url: string, file: string, source: string, keyword: string): Promise<Record<string, unknown>> {
  const hook = await (await fetch(chrome.runtime.getURL(file))).text();
  const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
  if (!tab.id) throw new PlatformError('无法创建渠道任务页签', 'retry');
  const tabId = tab.id;
  let retain = false;
  try {
    await workspaceRepository.setMeta(`platform-tab:${attempt.task.id}`, { tabId, url, attemptId: attempt.step.attemptId });
    const prelude = `(() => {
      window.__mole_workspace_result__ = null;
      window.addEventListener('message', event => {
        if (event.source === window && event.data && event.data.source === ${JSON.stringify(source)} && event.data.type === 'result')
          window.__mole_workspace_result__ = event.data;
      });
    })();`;
    const trigger = `(() => {
      const run = () => setTimeout(() => window.postMessage({source:${JSON.stringify(source)},type:'execute',keyword:${JSON.stringify(keyword)}}, '*'), 1000);
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, {once:true}); else run();
    })();`;
    const installed = await CDPSessionManager.sendCommand(tabId, 'Page.addScriptToEvaluateOnNewDocument', { source: prelude + '\n' + hook + '\n' + trigger });
    if (!installed.success) throw new PlatformError(installed.error || '渠道初始化失败', 'retry');
    await chrome.tabs.update(tabId, { url });
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 600));
      const current = await chrome.tabs.get(tabId);
      if (!current.url || new URL(current.url).hostname !== new URL(url).hostname) continue;
      const result = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: () =>
        (window as Window & { __mole_workspace_result__?: Record<string, unknown> }).__mole_workspace_result__ || null });
      const data = result[0]?.result;
      if (!data) continue;
      if (data.error) {
        const message = String(data.error);
        const waiting = /登录|验证|401|403/.test(message);
        retain = waiting;
        throw new PlatformError(`${message}（任务页签 ${tabId}）`, waiting ? 'waiting' : /429|超时|50[0234]|network/i.test(message) ? 'retry' : 'failed');
      }
      return data;
    }
    retain = true;
    throw new PlatformError(`渠道未返回结果，请检查登录或验证（任务页签 ${tabId}）`, 'waiting');
  } finally {
    await CDPSessionManager.detachTab(tabId);
    if (!retain) await chrome.tabs.remove(tabId).catch(() => undefined);
    await workspaceRepository.setMeta(`platform-tab:${attempt.task.id}`, retain ? { tabId, url, retained: true } : null);
  }
}
