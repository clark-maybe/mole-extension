/** MCP 页面工具统一入口：跨工具共享目标状态，读取前检查主文档与错误页。 */
import type { FunctionResult, ToolExecutionContext } from './types';
import { classifyWebPage, normalizeWebUrl, webFailureResult } from '../lib/web-access';
import { waitForTabComplete } from './tab-utils';

const PAGE_TOOLS = new Set(['page', 'page_viewer', 'page_snapshot', 'page_skeleton', 'page_assert',
  'page_repair', 'extract_data', 'cdp_input', 'cdp_dom', 'cdp_frame']);

const inspectDeniedPage = async (tabId: number): Promise<FunctionResult | undefined> => {
  try {
    const [page] = await chrome.scripting.executeScript({ target: { tabId }, func: () => ({
      url: location.href, title: document.title, content: (document.body?.innerText || '').slice(0, 1600),
    }) });
    if (page?.result) {
      const failure = classifyWebPage(page.result);
      // 空正文可能正在加载；不能据此阻止后续等待、截图或页面交互。
      if (failure && !failure.retryable) return webFailureResult(failure, page.result.url);
    }
  } catch { /* 注入不允许或导航中时，保留工具自身的等待和错误处理。 */ }
  return undefined;
};

export const guardWebTool = async (
  name: string, args: Record<string, unknown>, context: ToolExecutionContext,
  run: () => Promise<FunctionResult>,
): Promise<FunctionResult> => {
  const navigation = name === 'tab_navigate' && ['open', 'navigate', 'reload', 'duplicate'].includes(String(args.action));
  if (!context.webAccess || !(name === 'fetch_url' || navigation || PAGE_TOOLS.has(name))) return run();
  let tabId = typeof args.tab_id === 'number' ? args.tab_id : context.tabId;
  let url = typeof args.url === 'string' && (name === 'fetch_url' || navigation) ? args.url : '';
  if (!url) {
    try {
      if (!tabId) tabId = (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
      if (tabId) {
        const tab = await chrome.tabs.get(tabId);
        url = tab.pendingUrl || tab.url || '';
      }
    } catch { /* 交由工具返回精确的标签页错误。 */ }
  }
  if (!normalizeWebUrl(url)) return run();
  return context.webAccess.execute(url, async () => {
    const known = context.webNavigation?.forUrl(url);
    const knownFailure = known && (classifyWebPage(known) || (known.error
      ? { code: 'E_WEB_TEMPORARY', message: known.error, retryable: true } : undefined));
    if (knownFailure && (!knownFailure.retryable || context.webNavigation?.reportOnce(known))) {
      return webFailureResult(knownFailure, known.url);
    }
    if (!navigation && name !== 'fetch_url' && tabId) {
      const status = context.webNavigation?.get(tabId);
      if (status && normalizeWebUrl(status.url) === normalizeWebUrl(url)) {
        const failure = classifyWebPage(status);
        if (failure) return webFailureResult(failure, status.url);
        if (status.error) return webFailureResult({ code: 'E_WEB_TEMPORARY', message: status.error, retryable: true }, url);
      }
      // 兼容任务开始前已打开的页面，以及 HTTP 200 返回的拒绝页。
      const denial = await inspectDeniedPage(tabId);
      if (denial && normalizeWebUrl(String(denial.data?.url || '')) === normalizeWebUrl(url)) return denial;
    }
    if (context.signal?.aborted) return { success: false, code: 'E_CANCELLED', error: '任务已取消' };
    const result = await run();
    if (navigation && result.success && typeof result.data?.tab_id === 'number') {
      const openedTabId: number = result.data.tab_id;
      context.webNavigation?.track(openedTabId, url);
      // 创建/刷新成功只是浏览器接受了命令，主文档加载完成后才能清除旧失败。
      try {
        await waitForTabComplete(openedTabId, 24_000, '目标网页加载超时', context.signal);
      } catch (error: unknown) {
        const failed = context.webNavigation?.get(openedTabId);
        const failure = failed && classifyWebPage(failed);
        if (!context.signal?.aborted && failure) {
          if (failed) context.webNavigation?.reportOnce(failed);
          const response = webFailureResult(failure, failed?.url || url);
          return { ...response, data: { ...result.data, ...response.data } };
        }
        return { success: false, code: context.signal?.aborted ? 'E_CANCELLED' : 'E_WEB_TEMPORARY',
          retryable: !context.signal?.aborted, error: error instanceof Error ? error.message : '网页加载失败', data: { ...result.data, url } };
      }
      const loaded = context.webNavigation?.get(openedTabId);
      const loadFailure = loaded && (classifyWebPage(loaded) || (loaded.error
        ? { code: 'E_WEB_TEMPORARY', message: loaded.error, retryable: true } : undefined));
      if (loadFailure) {
        if (loaded) context.webNavigation?.reportOnce(loaded);
        const failure = webFailureResult(loadFailure, loaded?.url || url);
        return { ...failure, data: { ...result.data, ...failure.data } };
      }
      const denial = await inspectDeniedPage(openedTabId);
      if (denial) return { ...denial, data: { ...result.data, ...denial.data } };
    }
    return result;
  }, context.signal);
};
