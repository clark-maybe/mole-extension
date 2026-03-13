/**
 * Chrome Extension 信道工具，支持background/content/popup三方通信和tab广播
 * 用法：
 *   Channel.on(type, handler) // 注册消息处理
 *   Channel.off(type, handler) // 取消注册
 *   Channel.send(type, data, callback?) // 发送消息
 *   Channel.sendToTab(tabId, type, data, callback?) // 发送消息到指定tab
 *   Channel.listen(tabId?) // content侧传tabId注册，background侧不传
 *   Channel.broadcast(type, data) // background侧广播到所有注册tab
 *   Channel.getRegisteredTabs() // 获取所有已注册的tabId
 */

export type ChannelHandler = (data: any, sender?: chrome.runtime.MessageSender, sendResponse?: (response: any) => void) => void | boolean;

class Channel {
    private static handlers: Map<string, Set<ChannelHandler>> = new Map();
    // 仅background用：已注册tabId集合
    private static tabSet: Set<number> = new Set();

    /** 注册消息处理 */
    static on(type: string, handler: ChannelHandler) {
        if (!this.handlers.has(type)) {
            this.handlers.set(type, new Set());
        }
        this.handlers.get(type)!.add(handler);
    }

    /** 取消注册 */
    static off(type: string, handler: ChannelHandler) {
        if (this.handlers.has(type)) {
            this.handlers.get(type)!.delete(handler);
        }
    }

    /** 发送消息（支持回调） */
    static send(type: string, data?: any, callback?: (response: any) => void) {
        const msg = { type, data };
        try {
            if (callback) {
                chrome.runtime.sendMessage(msg, callback);
            } else {
                chrome.runtime.sendMessage(msg);
            }
        } catch (error) {
            console.error('[Channel] 发送消息失败:', error);
        }
    }

    /** 发送消息到指定tab */
    static sendToTab(tabId: number, type: string, data?: any, callback?: (response: any) => void) {
        if (!chrome.tabs) {
            console.error('[Channel] chrome.tabs API 不可用');
            return;
        }
        const msg = { type, data };
        try {
            if (callback) {
                chrome.tabs.sendMessage(tabId, msg, callback);
            } else {
                chrome.tabs.sendMessage(tabId, msg);
            }
        } catch (error) {
            console.error(`[Channel] 发送消息到 tab ${tabId} 失败:`, error);
        }
    }

    /** content侧注册tabId，background侧不传 */
    static listen(tabId?: number) {
        if ((this as any)._listening) return;
        (this as any)._listening = true;
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            const { type, data, __channel_tab_register, __channel_tab_unregister } = message || {};

            // content注册tabId
            if (__channel_tab_register && sender.tab && sender.tab.id !== undefined) {
                Channel.tabSet.add(sender.tab.id);
                console.log(`[Channel] Tab ${sender.tab.id} 已注册`);
                sendResponse({ success: true });
                return;
            }

            // content注销tabId
            if (__channel_tab_unregister && sender.tab && sender.tab.id !== undefined) {
                Channel.tabSet.delete(sender.tab.id);
                console.log(`[Channel] Tab ${sender.tab.id} 已注销`);
                sendResponse({ success: true });
                return;
            }

            if (type && this.handlers.has(type)) {
                let asyncHandled = false;
                for (const handler of this.handlers.get(type)!) {
                    try {
                        const result = handler(data, sender, sendResponse);
                        // 支持 async 处理器：检查返回值是否为 true 或 Promise
                        if (result === true) {
                            asyncHandled = true;
                        } else if (result && typeof result === 'object' && typeof (result as any).then === 'function') {
                            // async 函数返回 Promise，也认为是异步处理
                            asyncHandled = true;
                        }
                    } catch (error) {
                        console.error(`[Channel] 处理消息 ${type} 时出错:`, error);
                    }
                }
                return asyncHandled;
            }
        });
        // content侧注册tabId到background
        if (typeof tabId === 'number') {
            chrome.runtime.sendMessage({ __channel_tab_register: true });
        }
    }

    /** background侧：广播消息到所有注册tab */
    static broadcast(type: string, data?: any) {
        if (!chrome.tabs) return;
        const msg = { type, data };
        for (const tabId of Channel.tabSet) {
            try {
                chrome.tabs.sendMessage(tabId, msg);
            } catch (error) {
                console.error(`[Channel] 广播消息到 tab ${tabId} 失败:`, error);
                // 如果tab不存在了，从集合中移除
                Channel.tabSet.delete(tabId);
            }
        }
    }

    /** 获取所有已注册的tabId */
    static getRegisteredTabs(): number[] {
        return Array.from(Channel.tabSet);
    }

    /** 注销tab（通常在tab关闭时调用） */
    static unregisterTab(tabId: number): void {
        Channel.tabSet.delete(tabId);
        console.log(`[Channel] Tab ${tabId} 已从注册列表移除`);
    }

    /** 清空所有已注册的tab */
    static clearAllTabs(): void {
        Channel.tabSet.clear();
        console.log('[Channel] 所有tab已清空');
    }
}

export default Channel; 