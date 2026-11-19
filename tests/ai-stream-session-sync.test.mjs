import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Buffer } from 'node:buffer';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';

// 无浏览器的 Hook 事件测试；保留真实 reducer 和渠道卡片状态转换。
const bundle = await build({
  stdin: { contents: `export { useAIStream } from './src/content/float-ball/hooks/useAIStream';
    export * from 'test-hook-state';`, resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
  bundle: true, format: 'esm', platform: 'node', write: false,
  plugins: [{ name: 'hook-runtime', setup(build) {
    build.onResolve({ filter: /^react$/ }, () => ({ path: 'hooks', namespace: 'fixture' }));
    build.onResolve({ filter: /^(test-hook-state|\.\.\/context\/useMole)$/ }, () => ({ path: 'state', namespace: 'fixture' }));
    build.onResolve({ filter: /^\.\.\/\.\.\/\.\.\/lib\/channel$/ }, () => ({ path: 'channel', namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ resolveDir: fileURLToPath(new URL('../', import.meta.url)),
      contents: path === 'state'
        ? `import { moleReducer } from './src/content/float-ball/context/reducer';
          export let state = {};
          export const reset = (task) => { state = {currentTask:task}; };
          export const useMole = () => ({state, dispatch:(action)=>{ state=moleReducer(state,action); }});
          export { receive } from 'test-channel';`
        : path === 'hooks'
          ? `import { state } from 'test-hook-state';
            export const useRef = () => ({get current(){return state;},set current(_value){}});
            export const useCallback = fn => fn;
            export const useEffect = fn => fn();`
          : `const handlers = new Map();
            export const receive = (name, data) => handlers.get(name)?.(data);
            export default {on:(name,handler)=>handlers.set(name,handler), off:()=>{},send:()=>{}};`,
    }));
    build.onResolve({ filter: /^test-channel$/ }, () => ({ path: 'channel', namespace: 'fixture' }));
  } }],
});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
api.useAIStream({ current: null });
const running = () => ({ id: 'session-1', status: 'running', lastAIText: '查询结果已经整理。',
  liveStatusText: '处理中...', startedAt: 10, endedAt: null, durationMs: null, callStack: [] });

test('即使缺少 turn_completed，完成快照也会结束处理中并保留回复', () => {
  api.reset(running());
  api.receive('__session_sync', { sessionId: 'session-1', status: 'done', endedAt: 25, durationMs: 15, hasContext: true });
  assert.equal(api.state.currentTask.status, 'done');
  assert.equal(api.state.currentTask.lastAIText, '查询结果已经整理。');
  assert.equal(api.state.currentTask.endedAt, 25);
  assert.equal(api.state.currentTask.liveStatusText, '已完成');
  assert.equal(api.state.currentTask.hasContext, true);
});

test('错误快照结束运行态，无关会话的完成及清空快照不影响当前任务', () => {
  api.reset(running());
  api.receive('__session_sync', { sessionId: 'other-session', status: 'done' });
  api.receive('__session_sync', { sessionId: 'other-session', status: 'cleared' });
  assert.equal(api.state.currentTask.status, 'running');
  api.receive('__session_sync', { sessionId: 'session-1', status: 'error', failureCode: 'E_LLM_API', lastError: '连接中断' });
  assert.equal(api.state.currentTask.status, 'error');
  assert.equal(api.state.currentTask.errorMsg, '连接中断');
  assert.equal(api.state.currentTask.failureCode, 'E_LLM_API');
});

test('等待渠道继续保持等待，自动接续的新轮次仍可进入 running', () => {
  api.reset(running());
  api.receive('__session_sync', { sessionId: 'session-1', status: 'waiting',
    channelAccess: [{ platform: 'douyin', status: 'waiting', kind: 'verification', tabId: 7 }] });
  assert.equal(api.state.currentTask.status, 'waiting');
  assert.equal(api.state.currentTask.loginNotice.autoResume, true);
  api.receive('__session_sync', { sessionId: 'session-1', status: 'running', channelAccess: [] });
  assert.equal(api.state.currentTask.status, 'running');
  assert.equal(api.state.currentTask.loginNotice, null);
});
