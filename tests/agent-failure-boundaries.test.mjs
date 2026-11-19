import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Buffer } from 'node:buffer';
import { build } from 'esbuild';
import { fileURLToPath, URL } from 'node:url';

// 使用真实循环、工具执行器、MCP 网页保护与阶段交接，只隔离模型和浏览器。
const bundle = await build({ stdin: { contents: `
  export { agenticLoop } from './src/ai/core-loop';
  export { phaseOrchestrator } from './src/ai/phase-orchestrator';
  export { createRunState } from './src/ai/run-state';
  export { TodoManager } from './src/ai/todo-manager';
  export { createTodoFunction } from './src/functions/todo';
  export { DEFAULT_BUDGET } from './src/ai/loop-config';`,
  resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
  bundle: true, format: 'esm', platform: 'node', write: false,
  plugins: [{ name: 'model-fixture', setup(build) {
    build.onResolve({ filter: /\/llm-client$/ }, () => ({ path: 'model', namespace: 'fixture' }));
    build.onResolve({ filter: /\/functions\/registry$/ }, () => ({ path: 'registry', namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
      resolveDir: fileURLToPath(new URL('../', import.meta.url)),
      contents: path === 'model' ? `
        export const chatComplete = async () => ({output: []});
        export async function* chatStream(context, tools) {
          const f = globalThis.__moleFailureFixture;
          if (!tools?.length) {
            f.finals++;
            yield {outputItem: {type:'message',id:'final',role:'assistant',content:[{type:'output_text',text:'部分来源访问失败，已整理现有信息。'}]}};
            return;
          }
          const calls = f.next(++f.rounds, context);
          if (!calls) {
            yield {outputItem: {type:'message',id:'done',role:'assistant',content:[{type:'output_text',text:'任务完成'}]}};
          } else for (const [index, call] of calls.entries()) {
            yield {outputItem: {type:'function_call',id:'id-'+f.rounds+'-'+index,call_id:'call-'+f.rounds+'-'+index,
              name:call.name,arguments:JSON.stringify(call.args || {})}};
          }
        }` : `
        import { guardWebTool } from '${fileURLToPath(new URL('../src/functions/web-access.ts', import.meta.url))}';
        export const getBuiltinFunction = () => ({permissionLevel:'read'});
        export const mcpClient = {isParallel: async () => true,
          callTool: async (name, args, context, options) => {
            const result = await guardWebTool(name, args, {...context, signal:options?.signal},
              () => globalThis.__moleFailureFixture.execute(name, args));
            return {content:[{type:'text',text:JSON.stringify(result)}], isError:!result.success};
          }};`,
    }));
  } }],
});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const tools = [{ type: 'function', name: 'fetch_url', parameters: {}, description: '' }];
function fixture(next, execute) {
  const state = { next, execute, rounds: 0, finals: 0 };
  globalThis.__moleFailureFixture = state;
  return state;
}
const budget = () => ({ ...api.DEFAULT_BUDGET });
const context = () => [{ role: 'user', content: '持续收集可访问的网页资料' }];
const loop = (ctx, limits, state, control) => api.agenticLoop(ctx, tools, '', limits, undefined, undefined, () => {},
  undefined, 0, undefined, undefined, control, undefined, undefined, undefined, undefined, state);

test('不断修改参数并穿插记账也无法重访拒绝目标，连续失败强制收尾', async () => {
  let requests = 0;
  const f = fixture(round => [
    { name: 'fetch_url', args: { url: 'https://example.com/denied', max_content_length: 500 + round } },
    { name: 'todo', args: { action: 'list' } },
  ], async name => {
    if (name === 'todo') return { success: true };
    requests++;
    return { success: false, code: 'E_WEB_ACCESS_DENIED', retryable: false, error: '拒绝访问' };
  });
  const result = await loop(context(), budget());
  assert.equal(requests, 1); assert.equal(f.rounds, 6); assert.equal(f.finals, 1);
  assert.ok(result.some(item => item.type === 'function_call_output' && item.output.includes('E_WEB_ACCESS_BLOCKED')));
});

test('普通工具相同参数两次失败后真正拦截，正常重复读取不受影响', async () => {
  let requests = 0;
  const f = fixture(() => [{ name: 'broken_tool', args: { selector: '#missing' } }], async () => {
    requests++; return { success: false, error: '元素不存在' };
  });
  await loop(context(), budget());
  assert.equal(requests, 2); assert.equal(f.finals, 1);
  requests = 0;
  fixture(round => round <= 10 ? [{ name: 'read_tool', args: {} }] : undefined, async () => { requests++; return { success: true }; });
  await loop(context(), budget()); assert.equal(requests, 10);
});

test('拒绝一个链接后可继续其他来源，不把整个站点或任务提前结束', async () => {
  const requests = [];
  const f = fixture(round => round <= 3 ? [{ name: 'fetch_url', args: { url: `https://example.com/${round}` } }] : undefined,
    async (_name, args) => {
      requests.push(args.url);
      return args.url.endsWith('/1') ? { success: false, code: 'E_WEB_ACCESS_DENIED', retryable: false, error: '拒绝访问' }
        : { success: true, data: { content: '有效资料' } };
    });
  const limits = budget(), state = api.createRunState(limits);
  await loop(context(), limits, state);
  assert.equal(requests.length, 3); assert.equal(state.failureRounds, 0); assert.equal(f.finals, 0);
});

test('页面取得新进展后，先前失败的普通操作允许重新执行', async () => {
  let attempts = 0;
  fixture(round => round <= 4 ? [{ name: round === 3 ? 'inspect_page' : 'click_button', args: {} }] : undefined,
    async name => name === 'inspect_page' ? { success: true, data: { found: true } }
      : (++attempts <= 2 ? { success: false, error: '按钮尚未出现' } : { success: true }));
  await loop(context(), budget());
  assert.equal(attempts, 3);
});

test('冷却回包不消耗实际重试次数，相同参数仍能按时进行有限重试', async () => {
  let now = 0, requests = 0;
  fixture(round => {
    if (round === 3) now += 1000;
    if (round === 4) now += 2000;
    return round <= 4 ? [{ name: 'fetch_url', args: { url: 'https://example.com/slow' } }] : undefined;
  }, async () => { requests++; return { success: false, code: 'E_WEB_TEMPORARY', retryable: true, error: '超时' }; });
  const limits = budget(), state = api.createRunState(limits);
  state.webAccess = new state.webAccess.constructor([], () => now);
  await loop(context(), limits, state);
  assert.equal(requests, 3);
});

test('阶段交接后保留拒绝状态和失败轮数，不重新开始尝试', async () => {
  let requests = 0;
  const f = fixture(round => [{ name: 'fetch_url', args: { url: 'https://example.com/denied', sections: [String(round)] } }], async () => {
    requests++; return { success: false, code: 'E_WEB_ACCESS_DENIED', retryable: false, error: '拒绝访问' };
  });
  const limits = budget(), state = api.createRunState(limits);
  const control = { shouldHandoff: (_tokens, round) => round >= 3 };
  await loop(context(), limits, state, control);
  assert.equal(control.handoffRequested, true); assert.equal(state.failureRounds, 3);
  await loop(context(), limits, state);
  assert.equal(requests, 1); assert.equal(f.rounds, 6); assert.equal(f.finals, 1);
});

test('真实阶段编排共用总轮数预算，交接不能把预算清零', async () => {
  let requests = 0;
  const f = fixture(round => [{ name: 'fetch_url', args: { url: `https://example.com/${round}` } }], async () => {
    requests++; return { success: true };
  });
  const limits = { ...budget(), maxRounds: 22 };
  const state = api.createRunState(limits), manager = new api.TodoManager(), events = [];
  await api.phaseOrchestrator('收集资料', tools, '', limits, undefined, undefined, event => events.push(event),
    undefined, undefined, manager, api.createTodoFunction(() => manager), undefined, undefined, undefined, state);
  assert.equal(requests, 22); assert.equal(state.rounds, 22); assert.equal(f.finals, 1);
  assert.equal(events.filter(event => event.type === 'phase_handoff').length, 1);
});

test('模型单批调用超出剩余预算时不执行副作用，并补齐所有工具回包', async () => {
  let requests = 0;
  const f = fixture(() => [1, 2, 3].map(index => ({ name: 'write_tool', args: { index } })), async () => { requests++; return { success: true }; });
  const result = await loop(context(), { ...budget(), maxToolCalls: 2 });
  assert.equal(requests, 0); assert.equal(f.finals, 1);
  assert.equal(result.filter(item => item.type === 'function_call_output' && item.output.includes('E_TOOL_BUDGET')).length, 3);
});
