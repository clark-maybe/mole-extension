/** 只记录主文档的 HTTP 状态；复用现有 webRequest 权限，避免把子资源失败当成整页失败。 */
import { normalizeWebUrl } from './web-access';
export interface NavigationStatus { url: string; status?: number; retryAfterMs?: number; error?: string }

export class WebNavigationObserver {
  private pages = new Map<number, NavigationStatus>();
  private targets = new Map<string, number>();
  private reported = new WeakSet<NavigationStatus>();
  private listening = false;
  private onHeaders = (details: chrome.webRequest.OnHeadersReceivedDetails): undefined => {
    if (details.statusCode >= 300 && details.statusCode < 400) return undefined;
    const retryAfter = details.responseHeaders?.find(header => header.name.toLowerCase() === 'retry-after')?.value;
    const seconds = Number(retryAfter);
    const retryAfterMs = retryAfter ? (Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now()) : undefined;
    this.pages.set(details.tabId, { url: details.url, status: details.statusCode,
      retryAfterMs: retryAfterMs && retryAfterMs > 0 ? retryAfterMs : undefined });
    return undefined;
  };
  private onBefore = (details: chrome.webRequest.OnBeforeRequestDetails): undefined => {
    this.pages.delete(details.tabId);
    return undefined;
  };
  private onError = (details: chrome.webRequest.OnErrorOccurredDetails) => {
    this.pages.set(details.tabId, { url: details.url, error: details.error });
  };
  private onRemoved = (tabId: number) => {
    this.pages.delete(tabId);
    for (const [url, id] of this.targets) if (id === tabId) this.targets.delete(url);
  };

  start(): void {
    if (this.listening || typeof chrome === 'undefined' || !chrome.webRequest) return;
    const filter: chrome.webRequest.RequestFilter = { urls: ['<all_urls>'], types: ['main_frame'] };
    chrome.webRequest.onBeforeRequest.addListener(this.onBefore, filter);
    chrome.webRequest.onHeadersReceived.addListener(this.onHeaders, filter, ['responseHeaders']);
    chrome.webRequest.onErrorOccurred.addListener(this.onError, filter);
    chrome.tabs.onRemoved.addListener(this.onRemoved);
    this.listening = true;
  }

  get(tabId: number): NavigationStatus | undefined { return this.pages.get(tabId); }

  track(tabId: number, url: string): void {
    for (const [target, id] of this.targets) if (id === tabId) this.targets.delete(target);
    this.targets.set(normalizeWebUrl(url), tabId);
  }

  forUrl(url: string): NavigationStatus | undefined {
    const target = normalizeWebUrl(url);
    const tabId = this.targets.get(target);
    return (tabId != null ? this.pages.get(tabId) : undefined)
      || [...this.pages.values()].find(page => normalizeWebUrl(page.url) === target);
  }

  /** 同一个迟到的临时响应只计一次失败，冷却结束后允许真正重新导航。 */
  reportOnce(status: NavigationStatus): boolean {
    if (this.reported.has(status)) return false;
    this.reported.add(status);
    return true;
  }

  stop(): void {
    if (!this.listening) return;
    chrome.webRequest.onBeforeRequest.removeListener(this.onBefore);
    chrome.webRequest.onHeadersReceived.removeListener(this.onHeaders);
    chrome.webRequest.onErrorOccurred.removeListener(this.onError);
    chrome.tabs.onRemoved.removeListener(this.onRemoved);
    this.pages.clear();
    this.targets.clear();
    this.listening = false;
  }
}
