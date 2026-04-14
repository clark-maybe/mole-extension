/**
 * 基础 Channel 消息处理器
 * 从 background.ts 提取，处理非会话相关的 Channel 消息
 */
import Channel from '../lib/channel';
import _console from '../lib/console';
import { VERSION } from '../config';
import dayjs from 'dayjs';
import { CDPSessionManager } from '../lib/cdp-session';

// ============ 工具函数 ============

/**
 * 显示 Chrome 桌面通知
 */
export function showNotification(title: string, message: string, notificationId: string = `mole-ext-${Date.now()}`) {
    chrome.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: './logo.png',
        title: title,
        message: message,
    }).then(() => {
        _console.log(`[background] 通知已显示: ${title}`);
    }).catch((error: unknown) => {
        _console.error('[background] 显示通知失败:', error);
    });
}

// ============ 内置消息处理 ============

/**
 * 获取 tab 信息
 * content script 请求自身的 tab 信息
 */
Channel.on('__get_tab_info', (_data, sender, sendResponse) => {
    if (sender?.tab && sendResponse) {
        sendResponse({
            id: sender.tab.id,
            url: sender.tab.url,
            title: sender.tab.title,
        });
    }
    return true;
});

/**
 * 显示桌面通知
 */
Channel.on('__show_notification', (data, _sender, sendResponse) => {
    const { title, message } = data || {};
    if (title && message) {
        showNotification(title, message);
    }
    if (sendResponse) sendResponse({ success: true });
    return true;
});

/**
 * 获取网页标题（link preview 用）
 * content script 请求 → background fetch → 提取 <title> → 返回
 */
const pageTitleCache = new Map<string, string>();

Channel.on('__fetch_page_title', async (data, _sender, sendResponse) => {
    const url = data?.url;
    if (!url || !sendResponse) return true;

    // 缓存命中
    const cached = pageTitleCache.get(url);
    if (cached !== undefined) {
        sendResponse({ title: cached });
        return true;
    }

    try {
        const resp = await fetch(url, {
            headers: { 'Accept': 'text/html' },
            signal: AbortSignal.timeout(5000),
        });
        // 只读前 16KB 提取 title，避免下载整页
        const reader = resp.body?.getReader();
        if (!reader) { sendResponse({}); return true; }

        let text = '';
        const decoder = new TextDecoder();
        while (text.length < 16384) {
            const { done, value } = await reader.read();
            if (done) break;
            text += decoder.decode(value, { stream: true });
            const match = text.match(/<title[^>]*>([^<]+)<\/title>/i);
            if (match) {
                reader.cancel().catch(() => {});
                const title = match[1].trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
                pageTitleCache.set(url, title);
                sendResponse({ title });
                return true;
            }
        }
        reader.cancel().catch(() => {});
        pageTitleCache.set(url, '');
        sendResponse({});
    } catch {
        sendResponse({});
    }
    return true;
});

/**
 * 打开扩展设置页（options.html）
 */
Channel.on('__open_options_page', (_data, _sender, sendResponse) => {
    chrome.runtime.openOptionsPage(() => {
        const lastError = chrome.runtime.lastError;
        if (sendResponse) {
            sendResponse({
                success: !lastError,
                error: lastError?.message,
            });
        }
    });
    return true;
});

/**
 * 日志上报（content script → background 汇总日志）
 */
Channel.on('__log_report', (data, sender) => {
    if (!data) return;

    const timeStamp = data.timeStamp;
    const type = data.type || 'LOG';
    const text = data.text || '';
    const tabId = sender?.tab?.id || 'unknown';

    const tempText = `[${dayjs(timeStamp).format('HH:mm:ss.SSS')}][Tab:${tabId}] ${text}`;
    const textTitle = `%c Mole %c V${VERSION} `;
    const titleStyle = 'padding: 2px 1px; border-radius: 3px 0 0 3px; color: #fff; background: #606060; font-weight: bold;';
    const versionStyle = 'padding: 2px 1px; border-radius: 0 3px 3px 0; color: #fff; background: #42c02e; font-weight: bold;';

    const logData = data.error || data.logObj;

    switch (type) {
        case 'LOG':
            console.log(textTitle, titleStyle, versionStyle, tempText, logData);
            break;
        case 'WARN':
            console.warn(textTitle, titleStyle, versionStyle, tempText, logData);
            break;
        case 'ERROR':
            console.error(textTitle, titleStyle, versionStyle, tempText, logData);
            break;
    }
});

// ============ Tab 管理 ============

// tab 关闭时清理注册
chrome.tabs.onRemoved.addListener((tabId) => {
    Channel.unregisterTab(tabId);
    // CDP debugger 会话清理
    CDPSessionManager.detachTab(tabId).catch(() => {});
});

/**
 * 定位到任务发起页签
 * 非发起页签请求跳转到任务所在页签
 */
Channel.on('__session_focus_tab', async (data) => {
    const tabId = data?.tabId;
    if (typeof tabId !== 'number') return;
    try {
        const tab = await chrome.tabs.get(tabId);
        await chrome.tabs.update(tabId, { active: true });
        if (typeof tab.windowId === 'number') {
            await chrome.windows.update(tab.windowId, { focused: true });
        }
    } catch (err) {
        console.warn('[Mole] 定位到任务页签失败:', err);
    }
});
