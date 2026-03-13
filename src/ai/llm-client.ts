/**
 * LLM API 客户端
 * 基于 fetch 实现 OpenAI Responses API，支持流式响应和工具调用
 * 不引入 SDK，保持轻量
 */

import type { InputItem, OutputItem, ToolSchema, StreamChunk, AISettings, ToolChoice } from './types';

const STORAGE_KEY_AI_SETTINGS = 'mole_ai_settings';

/** 默认配置 */
const DEFAULT_SETTINGS: AISettings = {
  apiKey: '',
  endpoint: '',
  model: '',
  strictResultMode: true,
};

/**
 * 模型并行工具能力表（对齐 Codex models.json）
 * 未命中时按 Codex fallback 语义默认 false。
 */
const MODEL_PARALLEL_TOOL_CALL_SUPPORT: Record<string, boolean> = {
  'gpt-5.4': true,
  'gpt-5.3-codex': true,
  'gpt-5.2-codex': true,
  'gpt-5.1-codex-max': false,
  'gpt-5.1-codex': false,
  'gpt-5.2': true,
  'gpt-5.1': true,
  'gpt-5-codex': false,
  'gpt-5': false,
  'gpt-oss-120b': false,
  'gpt-oss-20b': false,
  'gpt-5.1-codex-mini': false,
  'gpt-5-codex-mini': false,
};

const resolveParallelToolCalls = (settings: AISettings): boolean => {
  if (typeof settings.supportsParallelToolCalls === 'boolean') {
    return settings.supportsParallelToolCalls;
  }
  const modelSlug = String(settings.model || '').trim().toLowerCase();
  if (!modelSlug) return false;
  return MODEL_PARALLEL_TOOL_CALL_SUPPORT[modelSlug] === true;
};

/** 读取 AI 配置（apiKey 从存储中读取，用户自行配置） */
export const getAISettings = async (): Promise<AISettings> => {
  const saved = await new Promise<Record<string, unknown> | undefined>((resolve) => {
    try {
      chrome.storage.local.get(STORAGE_KEY_AI_SETTINGS, (result) => {
        resolve(result[STORAGE_KEY_AI_SETTINGS] as Record<string, unknown> | undefined);
      });
    } catch {
      resolve(undefined);
    }
  });

  return { ...DEFAULT_SETTINGS, ...saved };
};

/** 保存 AI 配置 */
export const saveAISettings = async (settings: Partial<AISettings>): Promise<void> => {
  const current = await getAISettings();
  const updated = { ...current, ...settings };
  await chrome.storage.local.set({ [STORAGE_KEY_AI_SETTINGS]: updated });
};

/**
 * 非流式调用 OpenAI Responses API（用于工具调用循环中拿完整响应）
 * @param input 输入项列表
 * @param tools 可用工具列表
 * @param instructions 系统提示词
 * @param signal 可选的 AbortSignal，用于取消请求
 * @param toolChoice 工具选择策略（'required' 可强制模型必须调用工具）
 */
export const chatComplete = async (
  input: InputItem[],
  tools?: ToolSchema[],
  instructions?: string,
  signal?: AbortSignal,
  toolChoice?: ToolChoice,
): Promise<{ output: OutputItem[]; status: string }> => {
  const settings = await getAISettings();

  if (!settings.apiKey) {
    throw new Error('未配置 API Key，请在设置中填写后重试。');
  }

  const body: Record<string, any> = {
    model: settings.model,
    input,
    max_output_tokens: 4096,
  };
  if (instructions) {
    body.instructions = instructions;
  }
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.parallel_tool_calls = resolveParallelToolCalls(settings);
    // tool_choice 仅在有 tools 时生效
    if (toolChoice) {
      body.tool_choice = toolChoice;
    }
  }

  const res = await fetch(`${settings.endpoint}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.apiKey}`,
      'User-Agent': 'claude-code/1.0.0',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    // 401/403 视为 API Key 无效
    if (res.status === 401 || res.status === 403) {
      throw new Error('API Key 无效或已过期，请检查配置。');
    }
    const text = await res.text();
    throw new Error(`LLM API 错误 (${res.status}): ${text}`);
  }

  const json = await res.json();

  if (!json.output) {
    throw new Error('LLM 返回格式异常：无 output');
  }

  return {
    output: json.output as OutputItem[],
    status: json.status || 'completed',
  };
};

/**
 * 流式调用 OpenAI Responses API（用于最终文本回复的流式输出）
 * @param input 输入项列表
 * @param tools 可用工具列表
 * @param instructions 系统提示词
 * @param signal 可选的 AbortSignal，用于取消请求
 * @param toolChoice 工具选择策略（'required' 可强制模型必须调用工具）
 */
export async function* chatStream(
  input: InputItem[],
  tools?: ToolSchema[],
  instructions?: string,
  signal?: AbortSignal,
  toolChoice?: ToolChoice,
): AsyncGenerator<StreamChunk> {
  const settings = await getAISettings();

  if (!settings.apiKey) {
    throw new Error('未配置 API Key，请在设置中填写后重试。');
  }

  const body: Record<string, any> = {
    model: settings.model,
    input,
    max_output_tokens: 4096,
    stream: true,
  };
  if (instructions) {
    body.instructions = instructions;
  }
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.parallel_tool_calls = resolveParallelToolCalls(settings);
    if (toolChoice) {
      body.tool_choice = toolChoice;
    }
  }

  const res = await fetch(`${settings.endpoint}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.apiKey}`,
      'User-Agent': 'claude-code/1.0.0',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    // 401/403 视为 API Key 无效
    if (res.status === 401 || res.status === 403) {
      throw new Error('API Key 无效或已过期，请检查配置。');
    }
    const text = await res.text();
    throw new Error(`LLM API 错误 (${res.status}): ${text}`);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error('无法读取流式响应');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // 保留最后一个可能不完整的行
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();

        // 跳过空行和 event: 行（SSE 格式中 event: 行只是标记，数据在 data: 行）
        if (!trimmed || trimmed.startsWith('event:')) continue;
        if (!trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6);
        if (data === '[DONE]') return;

        try {
          const json = JSON.parse(data);

          // 处理文本增量事件
          if (json.type === 'response.output_text.delta' && json.delta) {
            yield { delta: json.delta };
          }

          // 处理输出项完成事件（包含完整的 message 或 function_call 项）
          if (json.type === 'response.output_item.done' && json.item) {
            yield { outputItem: json.item as OutputItem };
          }

          // 处理完成事件
          if (json.type === 'response.completed' || json.type === 'response.done') {
            yield { done: true };
            return;
          }
        } catch {
          // 忽略解析错误的行
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
