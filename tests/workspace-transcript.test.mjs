import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
const bundle = buildSync({ entryPoints: [fileURLToPath(new URL('../src/chat/transcript.ts', import.meta.url))], bundle: true, format: 'esm', platform: 'node', write: false });
const { buildTranscript } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const event = (type, content) => ({ eventId: crypto.randomUUID(), type, content: typeof content === 'string' ? content : JSON.stringify(content), sessionId: 's', timestamp: 1 });

test('恢复累计文本流不重复拼接，同一用户输入与回合开始只展示一次', () => {
  const items = buildTranscript([event('workspace:user_message', '找贴膜企业'), event('turn_started', { query: '找贴膜企业' }), event('text', '已'), event('text', '已保存'), event('text', '已保存十条线索')]);
  assert.equal(items.length, 2); assert.equal(items[1].text, '已保存十条线索');
});

test('提问和授权的结果可从完整事件恢复，工具回包关联调用标识', () => {
  const items = buildTranscript([event('workspace:interaction', { requestId: 'q', kind: 'question', question: '哪个地区？', state: 'pending' }), event('workspace:interaction', { requestId: 'q', kind: 'question', question: '哪个地区？', state: 'settled', answer: '上海' }), event('function_call', { callId: 'call', name: 'douyin_collect_users' }), event('function_result', { callId: 'call', success: true })]);
  assert.equal(items.length, 2); assert.match(items[0].text, /上海/); assert.equal(items[0].status, '已回复'); assert.equal(items[1].status, '完成');
});

test('工具名称与执行意图独立保存，恢复后仍可显示中文工具名与失败状态', () => {
  const [item] = buildTranscript([event('function_call', { callId: 'lookup', name: 'lixiaoyun_search_companies', summary: '核实贴膜企业主体' }), event('function_result', { callId: 'lookup', success: false, message: '请完成平台登录' })]);
  assert.equal(item.toolName, 'lixiaoyun_search_companies');
  assert.equal(item.summary, '核实贴膜企业主体');
  assert.equal(item.message, '请完成平台登录');
  assert.equal(item.status, '未完成');
  assert.match(item.text, /请完成平台登录/);
});
