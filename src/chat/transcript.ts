/** 从完整事件构造结构化对话，不把模型上下文当作聊天记录。 */
import type { WorkspaceEvent } from '../workspace/types';

export interface TranscriptItem { id: string; role: 'user' | 'assistant' | 'system' | 'tool'; text: string; status?: string; toolName?: string; summary?: string; message?: string }
export function parseObject(text: string): Record<string, unknown> {
  try { const value = JSON.parse(text); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; }
}

export function buildTranscript(events: WorkspaceEvent[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const recorded = new Map<string, number>();
  const calls = new Map<string, TranscriptItem>();
  const interactions = new Map<string, TranscriptItem>();
  let assistant: TranscriptItem | undefined;
  for (const event of events) {
    if (event.type === 'workspace:user_message') {
      items.push({ id: event.eventId, role: 'user', text: event.content });
      recorded.set(event.content, (recorded.get(event.content) || 0) + 1); assistant = undefined;
    } else if (event.type === 'turn_started') {
      const data = parseObject(event.content), query = String(data.query || '');
      if (query && !(recorded.get(query) || 0) && !query.startsWith('[系统作业通知]')) items.push({ id: event.eventId, role: 'user', text: query });
      else if (recorded.get(query)) recorded.set(query, recorded.get(query)! - 1);
      assistant = undefined;
    } else if (event.type === 'text') {
      if (!assistant) { assistant = { id: event.eventId, role: 'assistant', text: '' }; items.push(assistant); }
      assistant.text = event.content;
    } else if (event.type === 'function_call') {
      const data = parseObject(event.content);
      const item: TranscriptItem = { id: event.eventId, role: 'tool', text: String(data.name || '执行工具'), toolName: String(data.name || ''), summary: String(data.summary || ''), status: '执行中' };
      calls.set(String(data.callId), item); items.push(item); assistant = undefined;
    } else if (event.type === 'function_result') {
      const data = parseObject(event.content), item = calls.get(String(data.callId));
      if (item) {
        item.status = data.success === false ? '未完成' : '完成';
        if (data.message) { item.message = String(data.message); item.text += ` · ${item.message}`; }
      }
    } else if (event.type === 'workspace:interaction') {
      const data = parseObject(event.content), key = String(data.requestId);
      let item = interactions.get(key);
      if (!item) {
        item = { id: event.eventId, role: 'system', text: '', status: '' };
        interactions.set(key, item); items.push(item);
      }
      const response = data.state === 'settled' ? (data.kind === 'approval' ? (data.approved ? '已允许' : '已拒绝') : String(data.answer || '')) : '';
      item.text = `${String(data.question || data.message || '')}${response ? `\n你的回复：${response}` : ''}`;
      item.status = data.state === 'pending' ? '等待回复' : data.state === 'settled' ? '已回复' : '已中断';
      assistant = undefined;
    } else if (event.type === 'error') {
      const data = parseObject(event.content);
      items.push({ id: event.eventId, role: 'system', text: String(data.message || event.content) });
    } else if (event.type === 'workspace:step_failed') {
      const data = parseObject(event.content);
      items.push({ id: event.eventId, role: 'system', text: String(data.message || '平台步骤未完成'), status: data.disposition === 'waiting' ? '需要处理' : data.disposition === 'retry' ? '稍后重试' : '执行失败' });
      assistant = undefined;
    } else if (event.type === 'workspace:notification' || event.type === 'workspace:legacy_summary') {
      const text = event.type === 'workspace:legacy_summary' ? String(parseObject(event.content).assistantReply || parseObject(event.content).summary || '旧版摘要') : event.content;
      items.push({ id: event.eventId, role: 'system', text }); assistant = undefined;
    }
  }
  return items;
}
