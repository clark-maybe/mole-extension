/**
 * 工作流录制模块
 * 从 background.ts 提取，负责工作流录制的状态管理、导航监听和 AI 审计提交
 */

import Channel from '../lib/channel';
import { chatComplete } from '../ai/llm-client';
import { ArtifactStore } from '../lib/artifact-store';
import {
    createSession,
    buildSessionSyncPayload,
    createSessionPushEvent,
    persistRuntimeSessions,
} from './session-manager';
import type { InputItem, AIStreamEvent, Session, SessionSyncPayload } from '../ai/types';

// ============ 类型定义 ============

/** 最大录制步数 */
const MAX_RECORDER_STEPS = 10;

/** 录制步骤 */
export interface RecorderStep {
    seq: number;
    action: 'click' | 'type' | 'select' | 'submit' | 'navigate';
    selector: string;
    selectorCandidates: string[];
    semanticHint: string;
    tag: string;
    value?: string;
    url: string;
    timestamp: number;
    /** 该步骤对应的截图 artifact ID */
    screenshotArtifactId?: string;
}

/** 录制状态 */
export interface RecorderState {
    active: boolean;
    tabId: number;
    startedAt: number;
    steps: RecorderStep[];
    startUrl: string;
}

// ============ 模块内部状态 ============

/** 当前录制状态（内存中） */
let recorderState: RecorderState | null = null;

/** 导航监听器引用，用于注销 */
let recorderNavListener: ((details: chrome.webNavigation.WebNavigationFramedCallbackDetails) => void) | null = null;

// ============ Session Storage 辅助函数 ============

/** 持久化录制状态到 session storage */
const saveRecorderState = async (): Promise<void> => {
    if (!recorderState) {
        await chrome.storage.session.remove('mole_recorder_state');
        return;
    }
    await chrome.storage.session.set({ mole_recorder_state: recorderState });
};

/** 从 session storage 加载录制状态 */
const loadRecorderState = async (): Promise<RecorderState | null> => {
    const result = await chrome.storage.session.get('mole_recorder_state');
    return result.mole_recorder_state || null;
};

// ============ 导航监听 ============

/** 注册录制期间的导航监听器 */
const registerRecorderNavListener = (): void => {
    if (recorderNavListener) return; // 防止重复注册

    recorderNavListener = (details: chrome.webNavigation.WebNavigationFramedCallbackDetails) => {
        // 只监听录制中的 tab 的主 frame
        if (!recorderState?.active) return;
        if (details.tabId !== recorderState.tabId) return;
        if (details.frameId !== 0) return;

        // 追加 navigate 步骤
        const step: RecorderStep = {
            seq: recorderState.steps.length + 1,
            action: 'navigate',
            selector: '',
            selectorCandidates: [],
            semanticHint: '',
            tag: '',
            url: details.url,
            timestamp: Date.now(),
        };
        recorderState.steps.push(step);
        void saveRecorderState();

        // 通知 content 脚本导航已完成
        Channel.sendToTab(recorderState.tabId, '__recorder_navigate', { url: details.url });
    };

    chrome.webNavigation.onCompleted.addListener(recorderNavListener);
};

/** 注销录制导航监听器 */
const unregisterRecorderNavListener = (): void => {
    if (recorderNavListener) {
        chrome.webNavigation.onCompleted.removeListener(recorderNavListener);
        recorderNavListener = null;
    }
};

// ============ Channel 消息处理器 ============

/** 截图串行队列，防止并发截图冲突 */
let screenshotQueue: Promise<void> = Promise.resolve();

/** 对指定步骤执行截图并关联 artifact */
const captureStepScreenshot = async (step: RecorderStep, tabId: number): Promise<void> => {
    try {
        // 等待 DOM 稳定
        await new Promise(r => setTimeout(r, 500));

        // 隐藏悬浮球和录制 overlay
        await new Promise<void>((resolve) => {
            Channel.sendToTab(tabId, '__screenshot_hide', {}, () => resolve());
            setTimeout(resolve, 150); // 超时兜底
        });

        // 截图
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const windowId = activeTab?.windowId;
        if (windowId !== undefined) {
            const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
                format: 'jpeg',
                quality: 70,
            });
            const base64 = dataUrl.split(',')[1] || '';
            const sizeKB = Math.round((base64.length * 3) / 4 / 1024);
            const artifact = await ArtifactStore.saveScreenshot(dataUrl, 'jpeg', sizeKB);

            // 关联截图到步骤
            step.screenshotArtifactId = artifact.id;
            void saveRecorderState();
        }

        // 恢复悬浮球和录制 overlay
        Channel.sendToTab(tabId, '__screenshot_show', {});
    } catch (err) {
        console.warn('[Mole] 录制步骤截图失败:', err);
        // 确保恢复显示
        try { Channel.sendToTab(tabId, '__screenshot_show', {}); } catch { /* 忽略 */ }
    }
};

/** 开始录制 */
Channel.on('__recorder_start', (data, sender, sendResponse) => {
    const tabId = sender?.tab?.id || (data?.tabId as number);
    const url = String(data?.url || '');

    if (!tabId) {
        sendResponse?.({ success: false, error: '缺少 tabId' });
        return true;
    }

    recorderState = {
        active: true,
        tabId,
        startedAt: Date.now(),
        steps: [],
        startUrl: url,
    };

    void saveRecorderState();
    registerRecorderNavListener();

    console.log(`[Mole] 工作流录制已开始, tab: ${tabId}, url: ${url}`);
    sendResponse?.({ success: true });
    return true;
});

/** 停止录制 */
Channel.on('__recorder_stop', (_data, _sender, sendResponse) => {
    if (!recorderState) {
        sendResponse?.({ success: false, error: '当前没有进行中的录制' });
        return true;
    }

    recorderState.active = false;
    void saveRecorderState();
    unregisterRecorderNavListener();

    console.log(`[Mole] 工作流录制已停止, 共 ${recorderState.steps.length} 步`);
    sendResponse?.({ success: true, steps: recorderState.steps });
    return true;
});

/** 接收录制步骤 + 异步截图 */
Channel.on('__recorder_step', (data) => {
    if (!recorderState?.active || !data) return;

    const step: RecorderStep = {
        seq: data.seq ?? (recorderState.steps.length + 1),
        action: data.action,
        selector: data.selector || '',
        selectorCandidates: data.selectorCandidates || [],
        semanticHint: data.semanticHint || '',
        tag: data.tag || '',
        value: data.value,
        url: data.url || '',
        timestamp: data.timestamp || Date.now(),
    };

    recorderState.steps.push(step);
    void saveRecorderState();

    // 10 步兜底：达到上限时通知 content 自动停止
    if (recorderState.steps.length >= MAX_RECORDER_STEPS) {
        recorderState.active = false;
        void saveRecorderState();
        unregisterRecorderNavListener();
        Channel.sendToTab(recorderState.tabId, '__recorder_auto_stop', {});
    }

    // 串行队列截图（不阻塞消息处理）
    const tabId = recorderState.tabId;
    screenshotQueue = screenshotQueue.then(() => captureStepScreenshot(step, tabId));
});

/** 查询当前录制状态 */
Channel.on('__recorder_state', (_data, _sender, sendResponse) => {
    sendResponse?.(recorderState);
    return true;
});

/** 取消审计：清理录制状态，释放 AI 处理 */
let auditCancelled = false;
Channel.on('__recorder_cancel_audit', (_data, _sender, sendResponse) => {
    auditCancelled = true;
    recorderState = null;
    void saveRecorderState();
    console.log('[Mole] 工作流录制审计已取消');
    sendResponse?.({ success: true });
    return true;
});

/** 提交录制结果给 AI 审计，审计后通过对话确认 */
Channel.on('__recorder_submit', (_data, _sender, sendResponse) => {
    if (!recorderState || recorderState.steps.length === 0) {
        sendResponse?.({ success: false, error: '没有可提交的录制步骤' });
        return true;
    }

    const steps = [...recorderState.steps];
    const startUrl = recorderState.startUrl;
    const tabId = recorderState.tabId;

    // 重置取消标志
    auditCancelled = false;

    // 异步执行 AI 审计
    void (async () => {
        try {
            // 构建 AI 审计 prompt
            // 审计时只传必要字段，去掉 screenshotArtifactId 等内部字段
            const cleanSteps = steps.map(({ seq, action, selector, semanticHint, tag, value, url }) => ({
                seq, action, selector, semanticHint, tag, ...(value !== undefined ? { value } : {}), url,
            }));

            const prompt = [
                '你是一个工作流审计助手。以下是用户在浏览器中录制的一系列操作步骤：',
                '',
                JSON.stringify(cleanSteps, null, 2),
                '',
                `起始 URL: ${startUrl}`,
                '',
                '可用的 action 名称（必须从以下清单选取）：',
                '- tab_navigate — 标签页导航（打开/关闭/切换页面，params.action: navigate/open/close）',
                '- cdp_input — 页面元素操作（点击/填写/选择/等待元素，params.action: click/fill/select/wait_for_element）',
                '- page_snapshot — 获取页面语义快照',
                '- page_viewer — 获取页面内容',
                '- cdp_frame — 执行 JavaScript 代码（params.action: evaluate, params.expression: "代码"）',
                '- cdp_dom — DOM 查询和修改',
                '- extract_data — 结构化数据提取',
                '- cdp_input — CDP 可信输入事件（鼠标/键盘）',
                '- page_assert — 页面断言验证',
                '- screenshot — 页面截图',
                '',
                '请完成以下任务：',
                '1. 去除明显的噪声步骤（误点击、重复操作）',
                '2. 合并连续的输入动作',
                '3. 为每步添加中文说明（note 字段）',
                '4. 识别用户输入的变量部分，用 {{param_name}} 替代，并在 parameters 中定义',
                '',
                '重要：',
                '- action 必须从上述清单中选取，不要使用 click/type/navigate 等原始录制动作名',
                '- 页面导航（URL 变化）使用 tab_navigate，不是 cdp_input',
                '- 元素点击/填写/选择使用 cdp_input',
                '- 需要执行 JS 时使用 cdp_frame',
                '',
                '输出格式（严格 JSON，无多余文字）：',
                '{',
                '  "name": "workflow_名称（英文下划线格式）",',
                '  "label": "显示名称（中文）",',
                '  "description": "工作流描述（中文）",',
                '  "url_patterns": ["匹配的 URL 模式"],',
                '  "parameters": { JSON Schema 格式的参数定义 },',
                '  "readable_steps": "人类可读的步骤描述（Markdown 编号列表，含参数标注）",',
                '  "plan": {',
                '    "steps": [',
                '      { "action": "tab_navigate", "params": { "action": "navigate", "url": "..." }, "note": "导航到目标页" },',
                '      { "action": "cdp_input", "params": { "action": "click", "selector": "..." }, "note": "点击按钮" },',
                '      { "action": "cdp_input", "params": { "action": "fill", "selector": "input", "value": "{{keyword}}" }, "note": "输入搜索词" }',
                '    ]',
                '  }',
                '}',
            ].join('\n');

            // 调用 AI 进行审计
            const input: InputItem[] = [
                { role: 'user', content: prompt },
            ];

            const result = await chatComplete(input);

            // 检查是否已取消
            if (auditCancelled) {
                console.log('[Mole] 工作流审计已被用户取消，丢弃结果');
                sendResponse?.({ success: false, error: '用户已取消' });
                return;
            }

            // 从 AI 返回中提取 JSON
            let workflowJson: Record<string, unknown> | null = null;
            for (const item of result.output) {
                if (item.type === 'message' && Array.isArray(item.content)) {
                    for (const part of item.content) {
                        if (part.type === 'output_text' && part.text) {
                            // 尝试提取 JSON（可能被 markdown 代码块包裹）
                            const jsonMatch = part.text.match(/```(?:json)?\s*([\s\S]*?)```/) ||
                                              part.text.match(/(\{[\s\S]*\})/);
                            if (jsonMatch?.[1]) {
                                try {
                                    workflowJson = JSON.parse(jsonMatch[1].trim());
                                } catch {
                                    // JSON 解析失败，继续尝试
                                }
                            }
                        }
                    }
                }
            }

            if (!workflowJson) {
                sendResponse?.({ success: false, error: 'AI 返回的结果无法解析为有效 JSON' });
                Channel.broadcast('__recorder_audit_done', { error: 'AI 审计结果解析失败' });
                return;
            }

            // 创建会话，注入审计结果供对话确认
            const readableSteps = workflowJson.readable_steps || '（步骤解析中…）';
            const sessionQuery = '确认录制的工作流';
            const session = createSession(sessionQuery, tabId);

            // 注入 system context：原始 workflow JSON 供 AI 后续使用
            session.context.push({
                role: 'system',
                content: [
                    '以下是用户刚刚录制并经过审计的工作流 JSON，用户即将确认或修改。',
                    '用户确认后，请调用 save_workflow 工具保存。',
                    '用户如果要求修改步骤，请在 JSON 上进行调整后重新展示，并等待用户再次确认。',
                    '',
                    '```json',
                    JSON.stringify(workflowJson, null, 2),
                    '```',
                ].join('\n'),
            } as InputItem);

            // 注入模拟用户请求 + AI 回复展示审计结果
            session.context.push({
                role: 'user',
                content: '我刚录制了一个操作流程，帮我整理一下。',
            } as InputItem);

            const paramEntries = Object.entries(workflowJson.parameters?.properties || {});
            const paramLine = paramEntries.length > 0
                ? `\n**参数**：${paramEntries.map(([k, v]: [string, Record<string, unknown>]) => `\`${k}\` — ${(v as Record<string, unknown>).description || k}`).join('、')}`
                : '';

            const aiSummary = [
                '我帮你整理了刚才录制的流程：\n',
                readableSteps,
                paramLine,
                '\n需要修改哪些步骤吗？确认无误我就保存为工作流。',
            ].filter(Boolean).join('\n');

            session.context.push({
                role: 'assistant',
                content: aiSummary,
            } as InputItem);

            // 清理录制状态
            recorderState = null;
            void saveRecorderState();

            // 通知悬浮球审计完成，准备对话确认
            Channel.broadcast('__recorder_audit_done', {
                sessionId: session.id,
                summary: aiSummary,
            });

            // 广播会话同步 + AI 文本展示
            Channel.broadcast('__session_sync', buildSessionSyncPayload(session));
            const pushEvent = createSessionPushEvent(session);
            pushEvent({ type: 'text', content: aiSummary });

            // 标记会话为等待用户输入（done 状态，可继续对话）
            session.status = 'done';
            session.endedAt = Date.now();
            session.durationMs = Math.max(0, session.endedAt - session.startedAt);
            session.agentState = {
                phase: 'finalize',
                round: 0,
                reason: '等待用户确认工作流',
                updatedAt: Date.now(),
            };
            Channel.broadcast('__session_sync', buildSessionSyncPayload(session));
            pushEvent({ type: 'turn_completed', content: JSON.stringify({ sessionId: session.id }) });
            persistRuntimeSessions();

            sendResponse?.({ success: true });
        } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : '提交处理失败';
            console.error('[Mole] 工作流录制提交失败:', err);
            sendResponse?.({ success: false, error: errMsg });
            Channel.broadcast('__recorder_audit_done', { error: errMsg });
        }
    })();

    return true;
});

// ============ 录制状态恢复（Service Worker 重启后） ============

void loadRecorderState().then((state) => {
    if (state?.active) {
        recorderState = state;
        registerRecorderNavListener();
        console.log(`[Mole] 录制状态已恢复, tab: ${state.tabId}, 已有 ${state.steps.length} 步`);
    }
});
