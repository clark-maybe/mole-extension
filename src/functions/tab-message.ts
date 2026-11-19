/**
 * 标签页消息工具
 * 统一处理发送到 content script 的消息、超时、Abort、自动注入重试
 */

import Channel from '../lib/channel';

interface SendToTabOptions {
  signal?: AbortSignal;
  deadlineMs?: number;
  injectContentScript?: boolean;
  timeoutMessage?: string;
}

const isRetryableConnectionError = (message: string): boolean => {
  const normalized = String(message || '').toLowerCase();
  return normalized.includes('receiving end does not exist')
    || normalized.includes('could not establish connection')
    || normalized.includes('message port closed');
};

const injectContentScriptIfPossible = async (tabId: number): Promise<boolean> => {
  try {
    const tab = await chrome.tabs.get(tabId);
    const targetUrl = tab.url || tab.pendingUrl || '';
    if (!/^https?:\/\//i.test(targetUrl)) {
      return false;
    }
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
    return true;
  } catch {
    return false;
  }
};

export const sendToTabWithRetry = async <T = any>(
  tabId: number,
  type: string,
  data: any,
  options?: SendToTabOptions,
): Promise<T> => {
  const deadlineMs = Math.max(1000, Math.floor(Number(options?.deadlineMs) || 12000));
  const timeoutMessage = options?.timeoutMessage || '目标页面连接超时：content script 未就绪';
  const injectContentScript = options?.injectContentScript !== false;
  const signal = options?.signal;

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let attempt = 0;
    let injectedOnce = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (error?: Error, response?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(retryTimer);
      clearTimeout(deadlineTimer);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(response as T);
    };
    const onAbort = () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      finish(error);
    };
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener('abort', onAbort, { once: true });
    deadlineTimer = setTimeout(() => finish(new Error(timeoutMessage)), deadlineMs);

    const trySend = async () => {
      if (settled || signal?.aborted) return;
      attempt++;
      try {
        const response = await new Promise<T>((resolveSend, rejectSend) => {
          Channel.sendToTab(tabId, type, data, (reply: T) => {
            if (chrome.runtime.lastError) {
              rejectSend(new Error(chrome.runtime.lastError.message || '发送消息失败'));
            } else resolveSend(reply);
          });
        });
        finish(undefined, response);
      } catch (error: unknown) {
        if (settled) return;
        const message = error instanceof Error ? error.message : '发送消息失败';
        if (!isRetryableConnectionError(message)) { finish(new Error(message)); return; }
        if (injectContentScript && !injectedOnce) {
          injectedOnce = true;
          await injectContentScriptIfPossible(tabId);
        }
        // 注入或发送期间可能已经取消/超时，不得重新启动重试链。
        if (settled || signal?.aborted) return;
        retryTimer = setTimeout(() => { void trySend(); }, Math.min(1400, 160 + attempt * 140));
      }
    };
    void trySend();
  });
};
