/** 渠道查询协调：统一串行、人工介入、精确重放和持久化。 */
import type { FunctionResult, ToolExecutionContext } from '../functions/types';
import type { ChannelPlatform } from './channel-platforms';
import Storage from './storage';

export interface PendingChannelCall {
  id: string;
  sessionId: string;
  name: string;
  args: Record<string, unknown>;
  result?: FunctionResult;
}

export interface ChannelAccessState {
  platform: ChannelPlatform;
  status: 'waiting' | 'checking' | 'ready';
  kind: 'login' | 'verification';
  tabId: number;
  watchId: string;
  calls: PendingChannelCall[];
  message?: string;
  disposed?: boolean;
  ownerSessionId?: string;
}

interface ChannelAccessDependencies {
  load: () => Promise<ChannelAccessState[] | undefined>;
  save: (states: ChannelAccessState[]) => Promise<void>;
  run: (name: string, args: Record<string, unknown>, context: ToolExecutionContext) => Promise<FunctionResult>;
  changed?: (state: ChannelAccessState) => void;
  intervalMs?: number;
}

const blockedCode = (state: ChannelAccessState) => state.kind === 'verification'
  ? 'E_VERIFICATION_REQUIRED' : 'E_AUTH_REQUIRED';

export class ChannelAccessCoordinator {
  private states = new Map<ChannelPlatform, ChannelAccessState>();
  private queues = new Map<ChannelPlatform, Promise<unknown>>();
  private controllers = new Map<ChannelPlatform, AbortController>();
  private restored?: Promise<void>;
  private writes: Promise<void> = Promise.resolve();
  private dependencies: ChannelAccessDependencies;
  private lastRequestAt = new Map<ChannelPlatform, number>();

  constructor(dependencies: ChannelAccessDependencies) { this.dependencies = dependencies; }

  async restore(): Promise<void> {
    this.restored ??= this.dependencies.load().then((states) => {
      for (const state of states || []) {
        if (state.platform !== 'douyin' || !Array.isArray(state.calls)
          || !Number.isSafeInteger(state.tabId) || !state.watchId) continue;
        // 后台重启不把未完成的检查当作成功，也不立即重发请求。
        if (state.status === 'checking') state.status = 'waiting';
        this.states.set(state.platform, state);
      }
    });
    await this.restored;
  }

  snapshot(): ChannelAccessState[] {
    return structuredClone([...this.states.values()]);
  }

  forSession(sessionId: string): ChannelAccessState[] {
    return this.snapshot().filter((state) => state.calls.some((call) => call.sessionId === sessionId));
  }

  hasPending(sessionId: string): boolean {
    return [...this.states.values()].some((state) => state.calls.some((call) => call.sessionId === sessionId));
  }

  notify(): void {
    for (const state of this.snapshot()) this.dependencies.changed?.(state);
  }

  private persist(): Promise<void> {
    const snapshot = this.snapshot();
    this.writes = this.writes.catch(() => undefined).then(() => this.dependencies.save(snapshot));
    return this.writes;
  }

  private async publish(state: ChannelAccessState): Promise<void> {
    await this.persist();
    this.dependencies.changed?.(structuredClone(state));
  }

  private async serial<T>(platform: ChannelPlatform, work: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(platform) || Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    this.queues.set(platform, next);
    try { return await next; } finally {
      if (this.queues.get(platform) === next) this.queues.delete(platform);
    }
  }

  private remember(state: ChannelAccessState, name: string, args: Record<string, unknown>, sessionId?: string) {
    if (!sessionId) return;
    const signature = JSON.stringify(args);
    if (state.calls.some((call) => call.sessionId === sessionId && call.name === name
      && JSON.stringify(call.args) === signature)) return;
    state.calls.push({ id: crypto.randomUUID(), sessionId, name, args: structuredClone(args) });
  }

  private async request(platform: ChannelPlatform, context: ToolExecutionContext, run: () => Promise<FunctionResult>): Promise<FunctionResult> {
    const remaining = (this.dependencies.intervalMs || 0) - (Date.now() - (this.lastRequestAt.get(platform) || 0));
    if (remaining > 0) await new Promise<void>((resolve) => {
      const finish = () => { clearTimeout(timer); context.signal?.removeEventListener('abort', finish); resolve(); };
      const timer = setTimeout(finish, remaining);
      context.signal?.addEventListener('abort', finish, { once: true });
    });
    if (context.signal?.aborted) return { success: false, error: '任务已取消', code: 'E_CANCELLED' };
    this.lastRequestAt.set(platform, Date.now());
    return run();
  }

  private waitingResult(state: ChannelAccessState): FunctionResult {
    return {
      success: false, code: blockedCode(state),
      error: '该渠道已暂停，等待用户处理。查询已保存，处理完成后会自动恢复；请继续其他独立工作，不要重复请求此渠道。',
      data: { platform: state.platform, tab_id: state.tabId, verification_watch_id: state.watchId,
        auto_resume: true, login_url: 'https://www.douyin.com/',
        verification_required: state.kind === 'verification', login_required: state.kind === 'login' },
    };
  }

  async execute(platform: ChannelPlatform, name: string, args: Record<string, unknown>,
    context: ToolExecutionContext, run: () => Promise<FunctionResult>): Promise<FunctionResult> {
    await this.restore();
    // 无会话的调试调用保留原行为；已持久化的暂停状态仍会阻断调试请求。
    if (!context.sessionId && !this.states.has(platform)) return run();
    return this.serial(platform, async () => {
      if (context.signal?.aborted) return { success: false, error: '任务已取消', code: 'E_CANCELLED' };
      const existing = this.states.get(platform);
      if (existing && existing.status !== 'ready') {
        this.remember(existing, name, args, context.sessionId);
        await this.publish(existing);
        return this.waitingResult(existing);
      }
      const result = await this.request(platform, context, run);
      if (context.signal?.aborted) return { success: false, error: '任务已取消', code: 'E_CANCELLED' };
      const tabId = result.data?.tab_id;
      const watchId = result.data?.verification_watch_id;
      if (context.sessionId && result.success && Number.isSafeInteger(tabId) && typeof watchId === 'string') {
        this.states.set(platform, { platform, status: 'ready', kind: 'login', tabId, watchId,
          ownerSessionId: context.sessionId, calls: existing?.calls || [] });
        await this.persist();
      }
      if (!context.sessionId || !['E_AUTH_REQUIRED', 'E_VERIFICATION_REQUIRED'].includes(result.code || '')) return result;
      if (!Number.isSafeInteger(tabId) || typeof watchId !== 'string') return result;
      const state: ChannelAccessState = { platform, status: 'waiting',
        ownerSessionId: context.sessionId,
        kind: result.code === 'E_VERIFICATION_REQUIRED' ? 'verification' : 'login',
        tabId, watchId, calls: existing?.calls || [] };
      this.remember(state, name, args, context.sessionId);
      this.states.set(platform, state);
      await this.publish(state);
      return { ...result, data: { ...result.data, auto_resume: true } };
    });
  }

  /** 被动信号只触发一次真实查询；失败后等待新的页面变化。 */
  async check(platform: ChannelPlatform, tabId: number, watchId: string): Promise<boolean> {
    await this.restore();
    const candidate = this.states.get(platform);
    if (!candidate || candidate.tabId !== tabId || candidate.watchId !== watchId
      || candidate.status !== 'waiting' || !candidate.calls.some((call) => !call.result)) return false;
    candidate.status = 'checking';
    try {
      await this.publish(candidate);
    } catch (error) {
      candidate.status = 'waiting';
      candidate.message = '检查状态暂未保存，请稍后检查并继续';
      this.dependencies.changed?.(structuredClone(candidate));
      throw error;
    }
    return this.serial(platform, async () => {
      const controller = new AbortController();
      this.controllers.set(platform, controller);
      try {
        for (const call of [...candidate.calls]) {
          if (call.result || !candidate.calls.includes(call)) continue;
          const context = { tabId: candidate.tabId, signal: controller.signal };
          const result = await this.request(platform, context, () => this.dependencies.run(call.name,
            { ...call.args, tab_id: candidate.tabId }, context));
          if (controller.signal.aborted || !candidate.calls.includes(call)) return false;
          if (!result.success) {
            candidate.status = 'waiting';
            candidate.message = result.error;
            if (result.code === 'E_VERIFICATION_REQUIRED') candidate.kind = 'verification';
            if (result.code === 'E_AUTH_REQUIRED') candidate.kind = 'login';
            if (typeof result.data?.verification_watch_id === 'string') candidate.watchId = result.data.verification_watch_id;
            await this.publish(candidate);
            return false;
          }
          call.result = result;
          if (typeof result.data?.verification_watch_id === 'string') candidate.watchId = result.data.verification_watch_id;
          await this.persist();
        }
        candidate.status = 'ready';
        candidate.message = undefined;
        await this.publish(candidate);
        return true;
      } catch (error: unknown) {
        candidate.status = 'waiting';
        candidate.message = error instanceof Error ? error.message : '检查暂未成功';
        await this.publish(candidate);
        return false;
      } finally {
        this.controllers.delete(platform);
      }
    });
  }

  async verificationDetected(tabId: number, watchId: string): Promise<boolean> {
    await this.restore();
    const state = this.states.get('douyin');
    if (!state || state.tabId !== tabId || state.watchId !== watchId) return false;
    if (state.kind !== 'verification' || state.status === 'ready') {
      state.kind = 'verification';
      state.status = 'waiting';
      await this.publish(state);
    }
    return true;
  }

  completed(sessionId: string): PendingChannelCall[] {
    return this.forSession(sessionId).flatMap((state) => state.calls.filter((call) => call.sessionId === sessionId && call.result));
  }

  async acknowledge(ids: string[]): Promise<void> {
    for (const state of this.states.values()) state.calls = state.calls.filter((call) => !ids.includes(call.id));
    await this.persist();
  }

  async cancelSession(sessionId: string): Promise<void> {
    await this.restore();
    for (const state of this.states.values()) {
      const affected = state.ownerSessionId === sessionId || state.calls.some((call) => call.sessionId === sessionId);
      if (!affected) continue;
      state.calls = state.calls.filter((call) => call.sessionId !== sessionId);
      if (state.calls.length === 0) {
        this.controllers.get(state.platform)?.abort();
        this.states.delete(state.platform);
        this.dependencies.changed?.({ ...structuredClone(state), disposed: true });
      }
    }
    await this.persist();
  }

  async rebindTab(oldTabId: number, newTabId: number): Promise<void> {
    for (const state of this.states.values()) {
      if (state.tabId === oldTabId) {
        this.controllers.get(state.platform)?.abort();
        state.tabId = newTabId;
        state.watchId = crypto.randomUUID();
        state.status = 'waiting';
        await this.publish(state);
      }
    }
  }
}

let recoveryRunner: ChannelAccessDependencies['run'] = async () => ({ success: false, error: '渠道尚未就绪' });
let changed: ChannelAccessDependencies['changed'];
export const channelAccess = new ChannelAccessCoordinator({
  load: () => Storage.get<ChannelAccessState[]>('mole_channel_access_v1'),
  save: (states) => Storage.save('mole_channel_access_v1', states),
  run: (...args) => recoveryRunner(...args),
  changed: (state) => changed?.(state),
  intervalMs: 1500,
});

export function configureChannelAccess(run: ChannelAccessDependencies['run'], onChanged: NonNullable<ChannelAccessDependencies['changed']>) {
  recoveryRunner = run;
  changed = onChanged;
}
