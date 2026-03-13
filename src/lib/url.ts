/**
 * URL 处理模块
 */

/**
 * 异步获取当前活动标签页的 URL
 */
export const getActiveTabUrl = async (): Promise<string | undefined> => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs.length > 0) {
        return tabs[0].url;
    }
    return undefined;
};

/**
 * 从一个完整的 URL 中提取域名
 */
export const getDomainFromUrl = (url: string): string | null => {
    try {
        const urlObject = new URL(url);
        return urlObject.hostname;
    } catch (error) {
        console.error("Invalid URL:", error);
        return null;
    }
};
