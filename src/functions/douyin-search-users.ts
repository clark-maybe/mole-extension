/**
 * 抖音用户搜索
 * 在抖音页面主环境中调用搜索接口，复用当前登录态和页面请求环境。
 */

import type { FunctionDefinition, FunctionResult, ToolExecutionContext } from './types';
import { waitForAnySelector } from './tab-utils';
import { updateDouyinPageNotice } from './douyin-page-notice';
import { DOUYIN_ICON } from '../lib/channel-platforms';

interface DouyinSearchUsersParams {
  keyword: string;
  count?: number;
  cursor?: number;
  search_id?: string;
  tab_id?: number;
}

// 验证内容可能位于跨域 iframe 内，只需识别主页面上的 iframe 地址。
const CAPTCHA_SELECTOR = [
  '#captcha_container',
  'iframe[src^="https://rmc.bytedance.com/verifycenter/captcha/"]',
  'iframe[src^="//rmc.bytedance.com/verifycenter/captcha/"]',
].join(', ');

/** 此函数会序列化注入页面，所有运行时依赖必须定义在函数内部。 */
async function searchUsersInPage(
  keyword: string,
  count: number,
  cursor: number,
  searchId: string,
  captchaSelector: string,
): Promise<FunctionResult> {
  if (location.origin !== 'https://www.douyin.com') {
    return { success: false, error: '请在抖音网页中执行用户搜索' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
  const text = (value: unknown): string => typeof value === 'string' ? value : '';
  const metric = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  const loginRequired = (): FunctionResult => ({
    success: false,
    code: 'E_AUTH_REQUIRED',
    error: '抖音查询被拒绝，通常是尚未登录或登录已失效。请先打开抖音登录，完成页面验证后再重试。',
    data: {
      platform: 'douyin',
      login_required: true,
      login_url: 'https://www.douyin.com/',
    },
  });
  const needsLogin = (message: string): boolean =>
    /登录|登陆|未授权|无权限|拒绝|login|log\s*in|sign\s*in|unauth|forbidden|denied/i.test(message);
  let captchaDetected = false;
  const hasCaptcha = (): boolean => {
    captchaDetected = captchaDetected || document.querySelector(captchaSelector) !== null;
    return captchaDetected;
  };
  const verificationRequired = (): FunctionResult => ({
    success: false,
    code: 'E_VERIFICATION_REQUIRED',
    error: '抖音出现安全验证，请切换到当前抖音标签页手动完成验证，再回来重试。',
    data: {
      platform: 'douyin',
      verification_required: true,
      verification_url: 'https://www.douyin.com/',
    },
  });
  let captchaObserver: MutationObserver | undefined;

  try {
    if (hasCaptcha()) return verificationRequired();
    // 请求期间出现验证时立即结束等待，交由用户处理当前页面上的验证。
    captchaObserver = new MutationObserver(() => {
      if (hasCaptcha()) controller.abort();
    });
    captchaObserver.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['id', 'src'],
    });
    const url = new URL('/aweme/v1/web/discover/search/', location.origin);
    url.search = new URLSearchParams({
      device_platform: 'webapp',
      aid: '6383',
      channel: 'channel_pc_web',
      search_channel: 'aweme_user_web',
      keyword,
      search_source: 'normal_search',
      query_correct_type: '1',
      is_filter_search: '0',
      offset: String(cursor),
      count: String(count),
      need_filter_settings: cursor === 0 ? '1' : '0',
      list_type: 'single',
    }).toString();
    if (searchId) url.searchParams.set('search_id', searchId);

    // 使用页面的 fetch，让当前页面处理登录态及请求环境，不复制 Cookie 或签名。
    const response = await fetch(url.href, {
      method: 'GET',
      credentials: 'include',
      headers: { accept: 'application/json, text/plain, */*' },
      signal: controller.signal,
    });
    if (hasCaptcha()) return verificationRequired();
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) return loginRequired();
      return { success: false, error: `抖音用户搜索失败（HTTP ${response.status}），请检查抖音页面的登录或验证状态` };
    }

    const body = await response.text();
    if (hasCaptcha()) return verificationRequired();
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      if (needsLogin(body)) return loginRequired();
      return { success: false, error: '抖音未返回有效 JSON，请在抖音页面确认登录或完成验证后重试' };
    }
    if (!isRecord(payload) || payload.status_code !== 0) {
      const status = isRecord(payload) ? payload.status_code : 'unknown';
      const message = isRecord(payload)
        ? [payload.status_msg, payload.status_message, payload.message, payload.msg,
          payload.description, isRecord(payload.data) ? payload.data.description : ''].map(text).join(' ')
        : '';
      // status_code=8 为查询拒绝；登录失效时也可能返回 HTTP 200 和业务错误。
      if (status === 8 || status === 401 || status === 403 || needsLogin(message)) return loginRequired();
      return { success: false, error: `抖音用户搜索未成功（status_code=${String(status)}），请在抖音页面确认登录或完成验证后重试` };
    }
    if (!Array.isArray(payload.user_list) && payload.user_list !== null) {
      return { success: false, error: '抖音响应缺少用户列表，无法确认搜索结果' };
    }

    const items = (payload.user_list ?? []).flatMap((entry: unknown) => {
      if (!isRecord(entry) || !isRecord(entry.user_info)) return [];
      const user = entry.user_info;
      const uid = text(user.uid);
      const secUid = text(user.sec_uid);
      if (!uid || !secUid) return [];
      return [{
        uid,
        sec_uid: secUid,
        unique_id: text(user.unique_id) || text(user.short_id),
        nickname: text(user.nickname),
        signature: text(user.signature),
        custom_verify: text(user.custom_verify),
        enterprise_verify_reason: text(user.enterprise_verify_reason),
        follower_count: metric(user.follower_count),
        total_favorited: metric(user.total_favorited),
        profile_url: `https://www.douyin.com/user/${encodeURIComponent(secUid)}`,
      }];
    });
    if (Array.isArray(payload.user_list) && payload.user_list.length > 0 && items.length === 0) {
      return { success: false, error: '抖音用户数据格式发生变化，未能读取有效用户' };
    }

    const hasMore = payload.has_more === 1 || payload.has_more === true;
    const nextCursor = typeof payload.cursor === 'number' && Number.isSafeInteger(payload.cursor)
      && payload.cursor >= 0 ? payload.cursor : cursor;
    if (hasMore && nextCursor <= cursor) {
      return { success: false, error: '抖音搜索游标未推进，请停止翻页并重新发起搜索' };
    }
    const logPb = isRecord(payload.log_pb) ? payload.log_pb : {};
    // 后续请求的日志 ID 可能变化，翻页须保留首次搜索的 ID。
    const nextSearchId = searchId || text(logPb.impr_id) || text(payload.rid);

    return {
      success: true,
      data: {
        platform: 'douyin',
        search_type: 'user',
        keyword: text(payload.input_keyword) || keyword,
        count: items.length,
        items,
        cursor: nextCursor,
        has_more: hasMore,
        search_id: nextSearchId,
        source_url: `https://www.douyin.com/jingxuan/search/${encodeURIComponent(keyword)}?type=user`,
        fetched_at: new Date().toISOString(),
      },
    };
  } catch (error: unknown) {
    if (hasCaptcha()) return verificationRequired();
    return {
      success: false,
      error: controller.signal.aborted ? '抖音用户搜索超时，请检查抖音页面后重试'
        : `抖音用户搜索请求失败：${error instanceof Error ? error.message : '未知错误'}`,
    };
  } finally {
    captchaObserver?.disconnect();
    clearTimeout(timeout);
  }
}

export const douyinSearchUsersFunction: FunctionDefinition = {
  name: 'douyin_search_users',
  description: 'Search Douyin (抖音) user accounts by keyword using the user\'s real browser login session. Prefer this tool for Douyin user searches instead of manual page operations. Returns items with string user IDs, nickname, original bio/signature, verification text, follower counts and profile URLs. Reuses an existing Douyin tab or temporarily opens Douyin in the background. For pagination, pass the returned cursor and search_id with the SAME keyword; stop when has_more is false. E_AUTH_REQUIRED means the query was rejected, usually because login is missing or expired: stop retrying, tell the user to log in via data.login_url and retry after login. E_VERIFICATION_REQUIRED means a captcha is present: stop requests and ask the user to manually complete verification in data.tab_id. That tab is kept open for the user. Search matches are candidates, not verified companies, locations or customers. This tool does not search videos, read full profiles, follow accounts or send messages.',
  supportsParallel: false,
  permissionLevel: 'read',
  parameters: {
    type: 'object',
    properties: {
      keyword: { type: 'string', minLength: 1, maxLength: 200, description: 'Search keyword, e.g. 武汉 美团 or 武汉 餐饮' },
      count: { type: 'integer', minimum: 1, maximum: 20, default: 12, description: 'Requested page size, default 12, maximum 20' },
      cursor: { type: 'integer', minimum: 0, default: 0, description: '0 for the first page; use the cursor returned by the previous call for the next page' },
      search_id: { type: 'string', description: 'Search ID returned by the previous page; omit when starting a new keyword search' },
      tab_id: { type: 'integer', minimum: 1, description: 'Optional existing https://www.douyin.com tab. Otherwise reuses the context/active/existing Douyin tab or temporarily opens one' },
    },
    required: ['keyword'],
  },
  validate: (params: DouyinSearchUsersParams): string | null => {
    if (typeof params.keyword !== 'string' || !params.keyword.trim() || params.keyword.length > 200) {
      return 'keyword 必须为 1–200 字符的非空搜索词';
    }
    if (params.count !== undefined && (!Number.isSafeInteger(params.count) || params.count < 1 || params.count > 20)) {
      return 'count 必须为 1–20 的整数';
    }
    if (params.cursor !== undefined && (!Number.isSafeInteger(params.cursor) || params.cursor < 0)) {
      return 'cursor 必须为非负安全整数';
    }
    if (params.tab_id !== undefined && (!Number.isSafeInteger(params.tab_id) || params.tab_id < 1)) {
      return 'tab_id 必须为正整数';
    }
    return null;
  },
  execute: async (params: DouyinSearchUsersParams, context?: ToolExecutionContext): Promise<FunctionResult> => {
    const validationError = douyinSearchUsersFunction.validate?.(params);
    if (validationError) return { success: false, error: validationError };
    const signal = context?.signal;
    if (signal?.aborted) return { success: false, error: '操作已取消' };

    try {
      const tabs = await chrome.tabs.query({ url: 'https://www.douyin.com/*' });
      const selectedTab = params.tab_id !== undefined
        ? tabs.find((tab) => tab.id === params.tab_id)
        : tabs.find((tab) => tab.id === context?.tabId)
          ?? tabs.find((tab) => tab.active)
          ?? tabs[0];
      if (params.tab_id !== undefined && !selectedTab) {
        return { success: false, error: '指定的 tab_id 不是可用的抖音标签页，请选择 https://www.douyin.com 页面' };
      }

      const runSearch = async (tabId: number): Promise<FunctionResult> => {
        const watchId = crypto.randomUUID();
        const ready = await waitForAnySelector(tabId, [CAPTCHA_SELECTOR, 'input[placeholder*="搜索"]'], 20_000, 300, signal);
        if (!ready) return { success: false, error: '抖音页面未准备好，请打开 https://www.douyin.com/ 并确认登录或完成验证' };
        if (signal?.aborted) return { success: false, error: '操作已取消' };
        // 隔离环境观察器会在请求返回后继续运行，捕获登录流程延后弹出的验证。
        await chrome.scripting.executeScript({
          target: { tabId }, world: 'ISOLATED', func: updateDouyinPageNotice,
          args: [params.keyword.trim(), 'watch', DOUYIN_ICON, watchId, CAPTCHA_SELECTOR],
        });
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: searchUsersInPage,
          args: [params.keyword.trim(), params.count ?? 12, params.cursor ?? 0, params.search_id ?? '', CAPTCHA_SELECTOR],
        });
        if (signal?.aborted) return { success: false, error: '操作已取消' };
        const result = results[0]?.result;
        const needsVerification = result?.code === 'E_VERIFICATION_REQUIRED';
        const needsAuthentication = result?.code === 'E_AUTH_REQUIRED';
        if (needsVerification || needsAuthentication || result?.success) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId }, world: 'ISOLATED', func: updateDouyinPageNotice,
              args: [params.keyword.trim(), needsVerification ? 'verification' : needsAuthentication ? 'login' : null, DOUYIN_ICON, watchId, CAPTCHA_SELECTOR],
            });
          } catch { /* 页面提醒失败不覆盖工具结果 */ }
        }
        return result ? { ...result, data: { ...result.data, tab_id: tabId, verification_watch_id: watchId } }
          : { success: false, error: '未收到抖音搜索结果，请检查页面是否已关闭或跳转' };
      };

      if (selectedTab?.id !== undefined) return await runSearch(selectedTab.id);
      const temporaryTab = await chrome.tabs.create({ url: 'https://www.douyin.com/', active: false });
      if (!temporaryTab.id) return { success: false, error: '无法创建抖音后台标签页' };
      let keepOpen = false;
      try {
        const result = await runSearch(temporaryTab.id);
        // 保留验证所在页面，避免销毁用户需要手动处理的验证现场。
        keepOpen = (result.code === 'E_VERIFICATION_REQUIRED' || result.code === 'E_AUTH_REQUIRED') && !signal?.aborted;
        return result;
      } finally {
        if (!keepOpen) {
          try { await chrome.tabs.remove(temporaryTab.id); } catch { /* 页面可能已关闭 */ }
        }
      }
    } catch (error: unknown) {
      return {
        success: false,
        error: signal?.aborted ? '操作已取消'
          : `无法执行抖音用户搜索：${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  },
};
