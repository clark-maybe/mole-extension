/**
 * 上下文管理器
 * 职责：上下文压缩、目标保留、工具结果截断
 * 只做事实保留，不做策略注入
 */

import type { InputItem, AIStreamEvent } from './types';

/** 上下文压缩标记 */
const CONTEXT_COMPACT_TAG = '[context-compacted]';

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
    const goalText = String((firstUserMessage as any).content || '').slice(0, 200);
    summaryParts.push(`原始目标：${goalText}`);
  }

  const summary: InputItem = {
    role: 'assistant' as const,
    content: summaryParts.join('\n'),
  };

  // 替换上下文
  const beforeSize = context.length;
  context.splice(0, context.length);
  if (firstUserMessage) {
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
export const truncateToolResult = (output: string, maxChars: number = 4000): string => {
  if (output.length <= maxChars) return output;
  return output.slice(0, maxChars) + '\n\n[结果过长，已截断。如需完整内容请再次查询指定部分]';
};
