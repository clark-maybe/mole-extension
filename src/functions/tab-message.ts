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
    if (signal?.aborted) {
      const abortError = new Error('aborted');
      abortError.name = 'AbortError';
      reject(abortError);
      return;
    }

    const startedAt = Date.now();
    let attempt = 0;
    let injectedOnce = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const onAbort = () => {
      if (timeout) clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      const abortError = new Error('aborted');
      abortError.name = 'AbortError';
      reject(abortError);
    };

    const sendOnce = (): Promise<T> => {
      return new Promise((resolveSend, rejectSend) => {
        Channel.sendToTab(tabId, type, data, (response: any) => {
          if (chrome.runtime.lastError) {
            rejectSend(new Error(chrome.runtime.lastError.message || '发送消息失败'));
            return;
          }
          resolveSend(response as T);
        });
      });
    };

    const trySend = async () => {
      attempt += 1;
      const remain = deadlineMs - (Date.now() - startedAt);
      if (remain <= 0) {
        signal?.removeEventListener('abort', onAbort);
        reject(new Error(timeoutMessage));
        return;
      }

      timeout = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        reject(new Error(timeoutMessage));
      }, remain);

      try {
        const response = await sendOnce();
        if (timeout) clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
        resolve(response);
      } catch (err: any) {
        if (timeout) clearTimeout(timeout);
        const message = err?.message || '发送消息失败';
        const retryable = isRetryableConnectionError(message) && Date.now() - startedAt < deadlineMs;
        if (!retryable) {
          signal?.removeEventListener('abort', onAbort);
          reject(new Error(message));
          return;
        }

        if (injectContentScript && !injectedOnce) {
          injectedOnce = true;
          await injectContentScriptIfPossible(tabId);
        }

        const delayMs = Math.min(1400, 160 + attempt * 140);
        setTimeout(() => {
          void trySend();
        }, delayMs);
      }
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    void trySend();
  });
};
