/**
 * 常驻任务 AI 响应模块
 * 从 background.ts 提取，将检测结果喂给 AI 生成回复，不走完整 session 体系
 */

import { handleChat } from '../ai/orchestrator';
import { injectAIResponseRunner } from '../functions/resident-runtime';

// ============ 常驻任务 AI 响应 ============

/**
 * 常驻任务 AI 响应桥接
 * 将检测结果喂给 AI 生成回复，不走完整 session 体系
 */
export async function runResidentAIResponse(
    job: { id: string; name: string; tabId: number; aiPromptTemplate: string },
    detectData: unknown,
): Promise<{ success: boolean; data?: { reply: string; prompt: string }; error?: string }> {
    const resultText = typeof detectData === 'string'
        ? detectData
        : JSON.stringify(detectData, null, 2);

    const prompt = job.aiPromptTemplate.replace(/\{\{result\}\}/g, resultText);

    return new Promise((resolve) => {
        let reply = '';
        let resolved = false;

        const safeResolve = (result: { success: boolean; data?: { reply: string; prompt: string }; error?: string }) => {
            if (resolved) return;
            resolved = true;
            resolve(result);
        };

        handleChat(
            prompt,
            (event) => {
                if (event.type === 'text') reply = event.content;
                if (event.type === 'done' || event.type === 'turn_completed') {
                    safeResolve({ success: true, data: { reply, prompt } });
                }
                if (event.type === 'error' || event.type === 'turn_aborted') {
                    safeResolve({ success: false, error: event.content || '常驻任务 AI 响应失败' });
                }
            },
            job.tabId,
            undefined,
            undefined,
            { maxRounds: 1, disallowTools: ['resident_runtime', 'spawn_subtask'] },
        ).catch((err: unknown) => {
            safeResolve({ success: false, error: err instanceof Error ? err.message : 'handleChat 异常' });
        });
    });
}

// ============ 初始化（副作用：注册 AI 响应函数） ============

injectAIResponseRunner(runResidentAIResponse);
