import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundle = buildSync({ entryPoints: [fileURLToPath(new URL('../src/workspace/session-activity.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const { getSessionActivity } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const job = (status, overrides = {}) => ({ id: 'j', kind: 'douyin_collect', status, title: '上海贴膜企业', savedCount: 20, batches: 1, ...overrides });

test('模型回合结束后，后台作业仍显示执行/下一批，而非会话已结束', () => {
  const running = getSessionActivity({ status: 'done' }, [job('running')]);
  assert.equal(running.state, 'running'); assert.equal(running.taskId, 'j'); assert.match(running.detail, /20/);
  const queued = getSessionActivity({ status: 'done' }, [job('queued')]);
  assert.equal(queued.state, 'queued'); assert.equal(queued.label, '等待下一批');
  assert.equal(queued.completedTasks, 0);
});

test('登录等待、人工暂停、模型排队和中断分别表达，不制造进度', () => {
  const waiting = getSessionActivity({ status: 'done' }, [job('waiting', { reason: '请完成抖音验证' })]);
  assert.equal(waiting.state, 'waiting'); assert.match(waiting.detail, /抖音验证/);
  assert.equal(getSessionActivity({ status: 'done' }, [job('paused')]).state, 'paused');
  assert.equal(getSessionActivity({ status: 'waiting', agentState: { phase: 'plan' } }, []).state, 'queued');
  assert.equal(getSessionActivity({ status: 'error', lastError: '连接中断' }, []).state, 'error');
  const done = getSessionActivity({ status: 'done' }, [job('completed'), job('partial', { id: 'other' })]);
  assert.equal(done.state, 'done'); assert.equal(done.completedTasks, 2); assert.match(done.detail, /仍待补充/);
});

test('一个平台等待时其他工作继续，等待数量仍可见；普通读取不重复计为后台作业', () => {
  const current = getSessionActivity({ status: 'running' }, [job('waiting'), job('running', { id: 'read', kind: 'tool_read' })]);
  assert.equal(current.state, 'running'); assert.equal(current.waitingTasks, 1); assert.equal(current.totalTasks, 1);
});

test('模型阻塞等待用户时显示待回复或待确认，同时保留后台作业数量', () => {
  const question = getSessionActivity({ status: 'running' }, [job('running')], { kind: 'question', question: '请确认企业名称' });
  assert.equal(question.state, 'waiting'); assert.equal(question.needsReply, true); assert.equal(question.activeTasks, 1);
  assert.equal(question.detail, '请确认企业名称');
  assert.equal(getSessionActivity({ status: 'running' }, [], { kind: 'approval', message: '是否录入？' }).label, '等待你的确认');
});
