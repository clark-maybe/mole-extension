/**
 * 工作流录制模块
 * 从 background.ts 提取，负责工作流录制的状态管理、导航监听和 AI 审计提交
 */

import Channel from '../lib/channel';
import { chatComplete } from '../ai/llm-client';
import type { InputItem, AIStreamEvent, Session, SessionSyncPayload } from '../ai/types';

// ============ 类型定义 ============

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
}

/** 录制状态 */
export interface RecorderState {
    active: boolean;
    tabId: number;
    startedAt: number;
    steps: RecorderStep[];
    startUrl: string;
}

// ============ 依赖注入接口 ============

/** 录制模块所需的外部依赖 */
export interface RecorderDeps {
    createSession: (query: string, tabId: number) => Session;
    buildSessionSyncPayload: (session: Session) => SessionSyncPayload;
    createSessionPushEvent: (session: Session) => (event: AIStreamEvent) => void;
    persistRuntimeSessions: () => void;
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

// ============ 初始化入口 ============

/**
 * 注册所有录制相关的 Channel 消息处理器，并恢复录制状态
 * @param deps 外部依赖（会话管理相关函数）
 */
export function setupRecorderHandlers(deps: RecorderDeps): void {
    const { createSession, buildSessionSyncPayload, createSessionPushEvent, persistRuntimeSessions } = deps;

    // ---- Channel 消息处理器 ----

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

    /** 接收录制步骤（fire-and-forget） */
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
    });

    /** 查询当前录制状态 */
    Channel.on('__recorder_state', (_data, _sender, sendResponse) => {
        sendResponse?.(recorderState);
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

        // 异步执行 AI 审计
        void (async () => {
            try {
                // 构建 AI 审计 prompt
                const prompt = [
                    '你是一个工作流审计助手。以下是用户在浏览器中录制的一系列操作步骤：',
                    '',
                    JSON.stringify(steps, null, 2),
                    '',
                    `起始 URL: ${startUrl}`,
                    '',
                    '请完成以下任务：',
                    '1. 去除明显的噪声步骤（误点击、重复操作）',
                    '2. 合并连续的输入动作',
                    '3. 为每步添加中文说明（note 字段）',
                    '4. 识别用户输入的变量部分，用 {{param_name}} 替代，并在 parameters 中定义',
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
                    '      {',
                    '        "action": "page_action",',
                    '        "params": { "action": "click|fill|select", "selector": "...", "value": "..." },',
                    '        "note": "中文说明"',
                    '      }',
                    '    ]',
                    '  }',
                    '}',
                ].join('\n');

                // 调用 AI 进行审计
                const input: InputItem[] = [
                    { role: 'user', content: prompt },
                ];

                const result = await chatComplete(input);

                // 从 AI 返回中提取 JSON
                let workflowJson: any = null;
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
                    ? `\n**参数**：${paramEntries.map(([k, v]: [string, any]) => `\`${k}\` — ${v.description || k}`).join('、')}`
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
            } catch (err: any) {
                console.error('[Mole] 工作流录制提交失败:', err);
                sendResponse?.({ success: false, error: err?.message || '提交处理失败' });
                Channel.broadcast('__recorder_audit_done', { error: err?.message || '审计失败' });
            }
        })();

        return true;
    });

    // ---- 录制状态恢复（Service Worker 重启后） ----

    void loadRecorderState().then((state) => {
        if (state?.active) {
            recorderState = state;
            registerRecorderNavListener();
            console.log(`[Mole] 录制状态已恢复, tab: ${state.tabId}, 已有 ${state.steps.length} 步`);
        }
    });
}
