import type { SessionEventLogItem } from '../ai/types';

/** 只关联当前轮最近一次抖音查询；请求结果未入日志时由页面稍后重报。 */
export function matchDouyinVerification(
    events: SessionEventLogItem[], tabId: number, watchId: string,
): { related: boolean; notified: boolean } {
    let notified = false;
    for (let i = events.length - 1; i >= 0; i--) {
        const event = events[i];
        if (event.type === 'turn_started') break;
        if (!['function_call', 'function_result', 'platform_action_required'].includes(event.type)) continue;
        try {
            const result = JSON.parse(event.content);
            if (result?.name !== 'douyin_search_users') continue;
            // 新查询已经开始，不能让之前的查询更新当前提示。
            if (event.type === 'function_call') break;
            if (event.type === 'platform_action_required') {
                notified ||= result.tabId === tabId && result.verificationWatchId === watchId;
                continue;
            }
            return {
                related: result.tabId === tabId && result.verificationWatchId === watchId,
                notified: notified || result.code === 'E_VERIFICATION_REQUIRED',
            };
        } catch { /* 兼容非 JSON 历史事件 */ }
    }
    return { related: false, notified: false };
}
