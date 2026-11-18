import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
// 使用真实 MCP 序列化、工具执行器和结果组件，仅隔离全量浏览器工具注册表。
const bundle = await build({
  stdin: {
    contents: `export { executeToolCalls } from './src/ai/tool-executor';
      export { setToolResult } from 'test-registry';
      export { updateToolLoginNotice } from './src/lib/tool-login';
      export { MoleContext } from './src/content/float-ball/context/context';
      export { moleReducer } from './src/content/float-ball/context/reducer';
      export { initialMoleState } from './src/content/float-ball/context/types';
      export { ResultView } from './src/content/float-ball/components/ResultView';`,
    resolveDir: root,
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  write: false,
  plugins: [{
    name: 'isolated-tool-registry',
    setup(build) {
      build.onResolve({ filter: /^(react|react\/.*)$/ }, ({ path }) => ({
        path: pathToFileURL(require.resolve(path)).href, external: true,
      }));
      build.onResolve({ filter: /^(test-registry|\.\.\/functions\/registry)$/ }, () => ({
        path: 'test-registry', namespace: 'test',
      }));
      build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
        contents: `import { MCPServer } from './src/mcp/server';
          import { MCPClient } from './src/mcp/client';
          import { InMemoryTransport } from './src/mcp/transport';
          let result = { success: true };
          export const setToolResult = (value) => { result = value; };
          const tool = { name: 'douyin_search_users', supportsParallel: false,
            permissionLevel: 'read', parameters: { type: 'object' }, execute: async () => result };
          const server = new MCPServer();
          server.registerTool(tool);
          export const mcpClient = new MCPClient(new InMemoryTransport(server));
          export const getBuiltinFunction = () => tool;`,
        resolveDir: root,
      }));
    },
  }],
});
const {
  executeToolCalls, setToolResult, updateToolLoginNotice,
  MoleContext, moleReducer, initialMoleState, ResultView,
} = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

const authFailure = {
  success: false, code: 'E_AUTH_REQUIRED', error: '抖音查询被拒绝，请先登录',
  data: { platform: 'douyin', login_required: true, login_url: 'https://www.douyin.com/' },
};

async function execute(result) {
  setToolResult(result);
  const events = [];
  const outputs = await executeToolCalls([{
    type: 'function_call', name: 'douyin_search_users', call_id: 'call-1', arguments: '{}',
  }], 7, undefined, (event) => events.push(event));
  return { outputs, event: JSON.parse(events.find((event) => event.type === 'function_result').content) };
}

test('未登录状态穿过 MCP 和事件，视图直接展示登录入口，不依赖模型回复', async () => {
  const { outputs, event } = await execute(authFailure);
  assert.equal(JSON.parse(outputs[0].output).data.login_required, true);
  assert.equal(event.code, 'E_AUTH_REQUIRED');
  assert.equal(event.success, false);
  assert.equal(event.callId, 'call-1');

  let state = { ...initialMoleState, currentTask: {
    id: 'session-1', query: '武汉 餐饮', title: '查找用户', status: 'running',
    resultHtml: '', lastAIText: '', callStack: [], errorMsg: '',
    startedAt: 0, endedAt: null, durationMs: null,
  } };
  state = moleReducer(state, { type: 'UPDATE_TASK', payload: {
    loginNotice: updateToolLoginNotice(undefined, event),
  } });
  const render = () => renderToStaticMarkup(React.createElement(MoleContext.Provider, {
    value: { state, dispatch: () => {} },
  }, React.createElement(ResultView)));
  let html = render();
  assert.match(html, /登录后继续搜索/);
  assert.match(html, /查询暂时被抖音拒绝/);
  assert.match(html, /class="mole-channel-icon" src="data:image\/svg\+xml/);
  assert.match(html, /href="https:\/\/www\.douyin\.com\/" target="_blank" rel="noopener noreferrer"/);

  // 回合正常结束不会吞掉提示，也不会显示误导的“已完成处理”。
  state = moleReducer(state, { type: 'UPDATE_TASK', payload: { status: 'done' } });
  html = render();
  assert.match(html, /去登录/);
  assert.doesNotMatch(html, /已完成处理/);

  // 保存到历史后仍能保留引导，当前回合成功后清除旧提示。
  state = moleReducer(state, { type: 'SAVE_ROUND' });
  assert.equal(state.currentTask.rounds[0].loginNotice.platform, 'douyin');
  const success = await execute({ success: true, data: { items: [] } });
  state = moleReducer(state, { type: 'UPDATE_TASK', payload: {
    loginNotice: updateToolLoginNotice(state.currentTask.loginNotice, success.event),
  } });
  assert.doesNotMatch(render(), /去登录/);
});

test('验证状态传递原标签页，渠道卡片提供手动验证入口', async () => {
  const { event } = await execute({
    success: false, code: 'E_VERIFICATION_REQUIRED', error: '请手动完成验证',
    data: { platform: 'douyin', verification_required: true, tab_id: 99, verification_watch_id: 'watch-99' },
  });
  assert.equal(event.code, 'E_VERIFICATION_REQUIRED');
  assert.equal(event.tabId, 99);
  assert.equal(event.verificationWatchId, 'watch-99');
  const notice = updateToolLoginNotice(undefined, event);
  assert.equal(notice.kind, 'verification');
  assert.equal(notice.tabId, 99);
  const html = renderToStaticMarkup(React.createElement(MoleContext.Provider, {
    value: { state: { ...initialMoleState, currentTask: {
      id: 'verification', status: 'done', loginNotice: notice, lastAIText: '', callStack: [],
    } }, dispatch: () => {} },
  }, React.createElement(ResultView)));
  assert.match(html, /安全验证/);
  assert.match(html, /去完成验证/);
  assert.doesNotMatch(html, /需要登录/);
});

test('回合结束后主动验证事件仍可更新状态并渲染验证入口', () => {
  let state = { ...initialMoleState, currentTask: {
    id: 'done-session', status: 'done', loginNotice: null, lastAIText: '', callStack: [],
  } };
  const payload = { name: 'douyin_search_users', success: false,
    code: 'E_VERIFICATION_REQUIRED', tabId: 7 };
  state = moleReducer(state, { type: 'UPDATE_TASK', payload: {
    loginNotice: updateToolLoginNotice(undefined, payload),
  } });
  assert.equal(state.currentTask.status, 'done');
  const html = renderToStaticMarkup(React.createElement(MoleContext.Provider, {
    value: { state, dispatch: () => {} },
  }, React.createElement(ResultView)));
  assert.match(html, /去完成验证/);
  assert.match(html, /安全验证/);
});

test('只对明确的抖音登录状态显示提示，拒绝任意结果里的跳转链接', () => {
  for (const result of [null, 'E_AUTH_REQUIRED', {},
    { name: 'douyin_search_users', success: false, message: 'network error' },
    { name: 'other_tool', success: false, code: 'E_AUTH_REQUIRED' },
    { name: 'douyin_search_users', success: false, message: '用户拒绝' },
  ]) {
    assert.equal(updateToolLoginNotice(undefined, result), undefined);
  }
  const notice = updateToolLoginNotice(undefined, {
    name: 'douyin_search_users', ...authFailure, login_url: 'javascript:alert(1)',
    message: '<script>bad</script>',
  });
  assert.equal(notice.url, 'https://www.douyin.com/');
  assert.doesNotMatch(notice.message, /script/);
  assert.equal(updateToolLoginNotice(notice, { name: 'other_tool', success: true }), notice);
});
