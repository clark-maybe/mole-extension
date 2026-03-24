/**
 * 上下文管理器
 * 职责：上下文压缩、目标保留、工具结果截断
 * 只做事实保留，不做策略注入
 */

import type { InputItem, AIStreamEvent, ContentPart, MessageInputItem, FunctionCallInputItem, FunctionCallOutputItem } from './types';
import { getSubagentNames } from './tool-executor';

/** 上下文压缩标记 */
const CONTEXT_COMPACT_TAG = '[context-compacted]';

/**
 * 从 content 中提取纯文字内容
 * 兼容 string 和 ContentPart[] 两种格式
 */
export const getTextContent = (content: string | ContentPart[]): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content || '');
  return content
    .filter((part): part is { type: 'input_text'; text: string } => part.type === 'input_text')
    .map(part => part.text)
    .join('\n');
};

/**
 * 将包含图片的多模态 content 降级为纯文字
 * 保留 input_text 部分，图片替换为 "[图片已省略]"
 */
export const stripImagesFromContent = (content: string | ContentPart[]): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content || '');
  const parts: string[] = [];
  for (const part of content) {
    if (part.type === 'input_text') {
      parts.push(part.text);
    } else if (part.type === 'input_image') {
      parts.push('[图片已省略]');
    }
  }
  return parts.join('\n');
};

/**
 * 上下文压缩
 *
 * 策略：保留第一条用户消息（原始目标）+ 最近 75% 的条目
 * 中间部分压缩为一条摘要
 */
export const compactContext = (
  context: InputItem[],
  maxItems: number,
  emit: (event: AIStreamEvent) => void,
  todoStatusText?: string,
): boolean => {
  if (context.length <= maxItems) return false;

  const keepTail = Math.floor(maxItems * 0.75);

  // 找到第一条用户消息（原始目标）
  const firstUserIndex = context.findIndex(
    item => 'role' in item && item.role === 'user'
  );
  const firstUserMessage = firstUserIndex >= 0 ? context[firstUserIndex] : null;

  // 计算要丢弃的部分
  const dropEnd = context.length - keepTail;
  const dropStart = firstUserMessage ? firstUserIndex + 1 : 0;

  if (dropEnd <= dropStart) return false;

  const dropped = context.slice(dropStart, dropEnd);
  const tail = context.slice(dropEnd);

  // 统计被丢弃的工具调用
  const toolNames: string[] = [];
  for (const item of dropped) {
    if ('type' in item && item.type === 'function_call' && 'name' in item) {
      const name = (item as any).name as string;
      if (!toolNames.includes(name)) {
        toolNames.push(name);
      }
    }
  }

  // 构造摘要
  const summaryParts: string[] = [CONTEXT_COMPACT_TAG];
  summaryParts.push(`已压缩 ${dropped.length} 条历史记录。`);
  if (toolNames.length > 0) {
    summaryParts.push(`此前使用过的工具：${toolNames.join('、')}`);
  }
  if (firstUserMessage && 'content' in firstUserMessage) {
    const goalText = getTextContent((firstUserMessage as MessageInputItem).content).slice(0, 200);
    summaryParts.push(`原始目标：${goalText}`);
  }
  if (todoStatusText) {
    summaryParts.push(`\n当前任务计划：\n${todoStatusText}`);
  }

  const summary: InputItem = {
    role: 'assistant' as const,
    content: summaryParts.join('\n'),
  };

  // 压缩时将包含图片的多模态 content 降级为纯文字
  for (const item of tail) {
    if ('role' in item && 'content' in item) {
      const msg = item as MessageInputItem;
      if (Array.isArray(msg.content)) {
        msg.content = stripImagesFromContent(msg.content);
      }
    }
  }

  // 替换上下文
  const beforeSize = context.length;
  context.splice(0, context.length);
  if (firstUserMessage) {
    // 首条用户消息也需要降级图片
    if ('content' in firstUserMessage && Array.isArray((firstUserMessage as MessageInputItem).content)) {
      (firstUserMessage as MessageInputItem).content = stripImagesFromContent(
        (firstUserMessage as MessageInputItem).content,
      );
    }
    context.push(firstUserMessage);
  }
  context.push(summary, ...tail);

  emit({
    type: 'context_compacted',
    content: JSON.stringify({ before: beforeSize, after: context.length }),
  });

  return true;
};

/**
 * 工具结果截断
 * 如果工具返回结果超过指定长度，只保留前 N 字符 + 提示
 */
export const truncateToolResult = (output: string, maxChars: number = 8000): string => {
  if (output.length <= maxChars) return output;
  return output.slice(0, maxChars) + '\n\n[结果过长，已截断。如需完整内容请再次查询指定部分]';
};

/** 不压缩结果的工具白名单（它们本身就是摘要性质，从子 agent 注册表获取） */
let _microCompactSkipTools: Set<string> | null = null;
const getMicroCompactSkipTools = (): Set<string> => {
  if (!_microCompactSkipTools) {
    _microCompactSkipTools = new Set(getSubagentNames());
  }
  return _microCompactSkipTools;
};

/**
 * 微压缩：每轮静默清理旧工具结果
 *
 * 策略：
 * - 扫描 context 中所有 function_call_output 项
 * - 保留最近 keepRecentOutputs 条完整
 * - 更早的 function_call_output，如果 output > 500 字符，替换为精简摘要
 * - 通过 call_id 关联 function_call 项获取 tool_name
 * - 不压缩子 agent（explore、spawn_subtask 等）的结果
 *
 * @returns 压缩的条目数
 */
export const microCompact = (context: InputItem[], keepRecentOutputs: number = 6): number => {
  // 收集所有 function_call_output 的索引
  const outputIndices: number[] = [];
  for (let i = 0; i < context.length; i++) {
    const item = context[i];
    if ('type' in item && item.type === 'function_call_output') {
      outputIndices.push(i);
    }
  }

  if (outputIndices.length <= keepRecentOutputs) return 0;

  // 构建 call_id → tool_name 映射
  const callIdToName = new Map<string, string>();
  for (const item of context) {
    if ('type' in item && item.type === 'function_call' && 'call_id' in item && 'name' in item) {
      const fc = item as FunctionCallInputItem;
      callIdToName.set(fc.call_id, fc.name);
    }
  }

  // 需要压缩的索引（排除最近 keepRecentOutputs 条）
  const toCompressIndices = outputIndices.slice(0, outputIndices.length - keepRecentOutputs);

  let compressedCount = 0;
  for (const idx of toCompressIndices) {
    const item = context[idx] as FunctionCallOutputItem;
    const output = item.output;

    // 跳过短内容
    if (output.length <= 500) continue;

    // 通过 call_id 找到工具名
    const toolName = callIdToName.get(item.call_id) || 'unknown';

    // 跳过白名单工具
    if (getMicroCompactSkipTools().has(toolName)) continue;

    // 判断执行结果成功/失败
    let status = '完成';
    try {
      const parsed = JSON.parse(output);
      if (parsed.success === false) status = '失败';
    } catch {
      // 非 JSON 格式，默认为完成
    }

    // 替换为精简摘要
    item.output = `[已执行 ${toolName}: ${status}]`;
    compressedCount++;
  }

  return compressedCount;
};

/**
 * 估算上下文 token 数
 *
 * 策略：累加所有文本字符数，最终除以 2 作为 token 估算
 * - string content 取 length
 * - ContentPart[] 取所有 text 部分 length 之和，图片部分估算 300 token（即 600 字符）
 * - function_call 取 name + arguments 的 length
 * - function_call_output 取 output 的 length
 */
export const estimateContextTokens = (context: InputItem[]): number => {
  let totalChars = 0;

  for (const item of context) {
    if ('type' in item) {
      if (item.type === 'function_call') {
        const fc = item as FunctionCallInputItem;
        totalChars += (fc.name || '').length + (fc.arguments || '').length;
      } else if (item.type === 'function_call_output') {
        const fco = item as FunctionCallOutputItem;
        totalChars += (fco.output || '').length;
      }
    } else if ('role' in item && 'content' in item) {
      const msg = item as MessageInputItem;
      if (typeof msg.content === 'string') {
        totalChars += msg.content.length;
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'input_text') {
            totalChars += part.text.length;
          } else if (part.type === 'input_image') {
            // 图片估算 300 token = 600 字符
            totalChars += 600;
          }
        }
      }
    }
  }

  return Math.floor(totalChars / 2);
};
