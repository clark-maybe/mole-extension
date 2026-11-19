/** 人工处理后的自动接续：页面信号 → 原查询检查 → 保存结果 → 恢复原会话。 */
import Channel from '../lib/channel';
import _console from '../lib/console';
import { channelAccess, configureChannelAccess, type ChannelAccessState } from '../lib/channel-access';
import { getBuiltinFunction } from '../functions/registry';
import { updateDouyinPageNotice } from '../functions/douyin-page-notice';
import { DOUYIN_ICON } from '../lib/channel-platforms';
import {
  sessions, createSessionPushEvent, hasRunningTasks, runSessionNow, dispatchSessionOp,
  persistRuntimeSessionsImmediate, buildSessionSyncPayload,
} from './session-manager';

let pumping = false;
let initialized = false;
const published = new Map<string, string>();

async function pumpRecoveredSessions() {
  if (pumping || hasRunningTasks()) return;
  pumping = true;
  try {
    for (const session of sessions.values()) {
      if (session.status !== 'waiting') continue;
      const calls = channelAccess.completed(session.id);
      if (calls.length === 0 && !session.channelResumePending) continue;
      for (const call of calls) {
        const callId = `channel_recovery_${call.id}`;
        if (session.context.some((item) => 'call_id' in item && item.call_id === callId)) continue;
        session.context.push({ type: 'function_call', id: callId, call_id: callId,
          name: call.name, arguments: JSON.stringify(call.args) });
        session.context.push({ type: 'function_call_output', call_id: callId, output: JSON.stringify(call.result) });
      }
      if (!session.channelResumePending) {
        session.context.push({ role: 'user', content: '用户已处理渠道登录或验证，系统已重放受阻查询并提供真实结果。请使用这些结果自动继续原任务，保留已完成工作，不要重复已成功的查询。其他仍受阻的渠道继续等待。' });
      }
      session.channelResumePending = true;
      // 上下文和接续意图一起提交。即使消费结果后后台重启，也能继续交接。
      await persistRuntimeSessionsImmediate();
      await channelAccess.acknowledge(calls.map((call) => call.id));
      await runSessionNow(session, session.channelResumeQuery || session.summary, session.originTabId,
        { ...session.channelResumeOptions, appendUserQuery: false, channelRecovery: true });
      break;
    }
  } finally { pumping = false; }
}

function changed(state: ChannelAccessState) {
  if (state.disposed) {
    void chrome.scripting.executeScript({ target: { tabId: state.tabId }, world: 'ISOLATED',
      func: updateDouyinPageNotice, args: ['', 'stop', DOUYIN_ICON, state.watchId] }).catch(() => undefined);
    return;
  }
  for (const sessionId of new Set(state.calls.map((call) => call.sessionId))) {
    const session = sessions.get(sessionId);
    if (!session || session.status === 'error') continue;
    const key = `${sessionId}:${state.platform}`;
    const content = JSON.stringify({ name: 'douyin_search_users', platform: state.platform,
      status: state.status, kind: state.kind, tabId: state.tabId, watchId: state.watchId,
      pendingCount: state.calls.filter((call) => call.sessionId === sessionId && !call.result).length,
      autoResume: true });
    if (published.get(key) !== content) {
      published.set(key, content);
      createSessionPushEvent(session)({ type: 'platform_access_changed', content });
    }
  }
  void dispatchSessionOp('channel_auto_resume', pumpRecoveredSessions);
}

configureChannelAccess(async (name, args, context) => {
  const tool = getBuiltinFunction(name);
  if (!tool?.channel || tool.permissionLevel !== 'read') return { success: false, error: '此操作需要重新确认' };
  const invalid = tool.validate?.(args);
  if (invalid) return { success: false, error: invalid };
  return tool.execute(args, context);
}, changed);

Channel.on('__channel_access_ready', (data: unknown, sender, respond) => {
  const watchId = data && typeof data === 'object' && 'watchId' in data ? data.watchId : undefined;
  if (sender?.frameId !== 0 || !sender.url?.startsWith('https://www.douyin.com/')
    || !sender.tab?.id || typeof watchId !== 'string') {
    respond?.({ accepted: false });
    return;
  }
  const state = channelAccess.snapshot().find((item) => item.platform === 'douyin'
    && item.tabId === sender.tab?.id && item.watchId === watchId && item.status === 'waiting');
  if (!state) { respond?.({ accepted: false }); return; }
  // 尽快应答，页面回调不等待完整查询；协调器负责去重与串行。
  respond?.({ accepted: true });
  void channelAccess.check('douyin', sender.tab.id, watchId).catch((error) => _console.warn('[ChannelRecovery] 自动检查失败', error));
});

Channel.on('__channel_access_check', (data: { sessionId?: string }, _sender, respond) => {
  const sessionId = data?.sessionId;
  const state = typeof sessionId === 'string' ? channelAccess.forSession(sessionId)[0] : undefined;
  if (!state || state.status !== 'waiting') { respond?.({ accepted: false }); return; }
  respond?.({ accepted: true });
  void channelAccess.check(state.platform, state.tabId, state.watchId)
    .catch((error) => _console.warn('[ChannelRecovery] 手动检查失败', error));
});

/** 页面刷新和后台重启后重装被动观察器，不自动重复调用搜索接口。 */
export async function restoreChannelRecovery() {
  await channelAccess.restore();
  initialized = true;
  for (const session of sessions.values()) {
    if (session.channelResumePending && session.status === 'error' && session.failureCode === 'E_SESSION_RUNTIME') {
      createSessionPushEvent(session)({ type: 'turn_completed', content: JSON.stringify({ status: 'waiting', runId: null, endedAt: Date.now(), durationMs: 0 }) });
    }
  }
  for (const state of channelAccess.snapshot()) {
    for (const call of [...state.calls]) {
      const session = sessions.get(call.sessionId);
      if (!session || (session.status === 'error' && session.failureCode !== 'E_SESSION_RUNTIME')) {
        await channelAccess.cancelSession(call.sessionId);
      } else if (session.status === 'error') {
        createSessionPushEvent(session)({ type: 'turn_completed', content: JSON.stringify({ status: 'waiting', runId: null, endedAt: Date.now(), durationMs: 0 }) });
      }
    }
    if (!channelAccess.snapshot().some((item) => item.platform === state.platform)) continue;
    if (state.status !== 'ready') {
      try {
        const keyword = String(state.calls[0]?.args.keyword || '');
        await chrome.scripting.executeScript({ target: { tabId: state.tabId }, world: 'ISOLATED',
          func: updateDouyinPageNotice,
          args: [keyword, 'watch', DOUYIN_ICON, state.watchId, null, state.kind] });
      } catch { /* 原页面已关闭时保留任务，用户可通过卡片重新打开页面 */ }
    }
    changed(state);
  }
  const active = [...sessions.values()].find((session) => session.status === 'waiting');
  if (active) Channel.broadcast('__session_sync', buildSessionSyncPayload(active));
  void dispatchSessionOp('channel_restore_resume', pumpRecoveredSessions);
}

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (initialized && change.status === 'complete' && channelAccess.snapshot().some((state) => state.tabId === tabId && state.calls.length > 0)) {
    void restoreChannelRecovery().catch((error) => _console.warn('[ChannelRecovery] 重装观察器失败', error));
  }
});
