/**
 * Chrome Extension 信道工具，支持background/content/popup/options四方通信和tab广播
 * 用法：
 *   Channel.on(type, handler) // 注册消息处理
 *   Channel.off(type, handler) // 取消注册
 *   Channel.send(type, data, callback?) // 发送消息
 *   Channel.sendToTab(tabId, type, data, callback?) // 发送消息到指定tab
 *   Channel.listen(tabId?) // content侧传tabId注册，background侧不传
 *   Channel.broadcast(type, data) // background侧广播到所有注册tab + extension page
 *   Channel.connectAsExtensionPage() // extension page（options/popup）侧连接，接收broadcast
 *   Channel.getRegisteredTabs() // 获取所有已注册的tabId
 */

export type ChannelHandler = (data: any, sender?: chrome.runtime.MessageSender, sendResponse?: (response: any) => void) => void | boolean | Promise<void | boolean>;

/** Port 连接名称标识，用于区分 extension page 的 port */
const EXTENSION_PAGE_PORT_NAME = '__channel_extension_page';

class Channel {
    private static handlers: Map<string, Set<ChannelHandler>> = new Map();
    // 仅background用：已注册tabId集合
    private static tabSet: Set<number> = new Set();
    // 仅background用：extension page（options/popup）的 port 连接集合
    private static extensionPorts: Set<chrome.runtime.Port> = new Set();
    // 仅 extension page 用：与 background 的 port 连接
    private static _extensionPort: chrome.runtime.Port | null = null;
    private static _extensionWanted = false;
    private static _extensionReconnectTimer: ReturnType<typeof setTimeout> | undefined;

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
        // background 侧：监听 extension page 的 port 连接
        if (typeof tabId === 'undefined' && chrome.runtime.onConnect) {
            chrome.runtime.onConnect.addListener((port) => {
                if (port.name !== EXTENSION_PAGE_PORT_NAME) return;
                Channel.extensionPorts.add(port);
                console.log(`[Channel] Extension page 已连接 (共 ${Channel.extensionPorts.size} 个)`);
                port.onDisconnect.addListener(() => {
                    Channel.extensionPorts.delete(port);
                    console.log(`[Channel] Extension page 已断开 (剩余 ${Channel.extensionPorts.size} 个)`);
                });
            });
        }
    }

    /** background侧：广播消息到所有注册tab + extension page */
    static broadcast(type: string, data?: any) {
        const msg = { type, data };
        // 1. 广播到所有注册的 content script tab
        if (chrome.tabs) {
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
        // 2. 广播到所有连接的 extension page（options/popup）
        for (const port of Channel.extensionPorts) {
            try {
                port.postMessage(msg);
            } catch (error) {
                console.error('[Channel] 广播消息到 extension page 失败:', error);
                Channel.extensionPorts.delete(port);
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

    /**
     * extension page 侧：通过 port 连接到 background，接收 broadcast 消息
     * 连接后 broadcast 的消息会通过 port.onMessage 分发到本地 handlers
     * 调用方需在页面卸载时调用 disconnectExtensionPage() 清理
     */
    static connectAsExtensionPage(): void {
        Channel._extensionWanted = true;
        if (Channel._extensionPort) return; // 已连接
        try {
            const port = chrome.runtime.connect({ name: EXTENSION_PAGE_PORT_NAME });
            Channel._extensionPort = port;
            // 监听来自 background 的 broadcast 消息，分发到本地 handlers
            port.onMessage.addListener((message) => {
                const { type, data } = message || {};
                if (type && Channel.handlers.has(type)) {
                    for (const handler of Channel.handlers.get(type)!) {
                        try {
                            handler(data);
                        } catch (error) {
                            console.error(`[Channel] Extension page 处理消息 ${type} 时出错:`, error);
                        }
                    }
                }
            });
            port.onDisconnect.addListener(() => {
                void chrome.runtime.lastError;
                if (Channel._extensionPort !== port) return;
                Channel._extensionPort = null;
                if (Channel._extensionWanted && !Channel._extensionReconnectTimer) {
                    Channel._extensionReconnectTimer = setTimeout(() => {
                        Channel._extensionReconnectTimer = undefined;
                        if (Channel._extensionWanted) Channel.connectAsExtensionPage();
                    }, 1000);
                }
                console.log('[Channel] Extension page port 已断开');
            });
            for (const handler of Channel.handlers.get('__channel_reconnected') || []) handler({});
            console.log('[Channel] Extension page 已连接到 background');
        } catch (error) {
            console.error('[Channel] Extension page 连接失败:', error);
            Channel._extensionPort = null;
            if (Channel._extensionWanted && !Channel._extensionReconnectTimer) {
                Channel._extensionReconnectTimer = setTimeout(() => {
                    Channel._extensionReconnectTimer = undefined;
                    if (Channel._extensionWanted) Channel.connectAsExtensionPage();
                }, 1000);
            }
        }
    }

    /** extension page 侧：断开与 background 的 port 连接 */
    static disconnectExtensionPage(): void {
        Channel._extensionWanted = false;
        if (Channel._extensionReconnectTimer) clearTimeout(Channel._extensionReconnectTimer);
        Channel._extensionReconnectTimer = undefined;
        if (Channel._extensionPort) {
            try {
                Channel._extensionPort.disconnect();
            } catch { /* 忽略 */ }
            Channel._extensionPort = null;
        }
    }
}

export default Channel;
