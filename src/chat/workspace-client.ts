/** 工作台统一客户端：每个指令有稳定 requestId，查询用持久序号补齐。 */
import Channel from '../lib/channel';
import type { WorkspaceCommand } from '../workspace/types';

export function workspaceRequest<T>(type: string, data: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('后台响应超时，指令可能已被接受；可使用原标识重试')), 20_000);
    Channel.send(type, data, (response: { success?: boolean; data?: T; error?: string }) => {
      clearTimeout(timeout);
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) { reject(new Error(runtimeError.message || '后台连接已断开')); return; }
      if (!response?.success) { reject(new Error(response?.error || '后台操作失败')); return; }
      resolve(response.data as T);
    });
  });
}

export const workspaceQuery = <T>(data: Record<string, unknown>): Promise<T> => workspaceRequest('__workspace_query', data);
export const workspaceAction = <T>(data: Record<string, unknown>): Promise<T> => workspaceRequest('__workspace_action', data);
export function sendWorkspaceCommand(command: Omit<WorkspaceCommand, 'requestId'> & { requestId?: string }): Promise<{ sessionId: string; requestId: string; duplicate: boolean }> {
  return workspaceRequest('__workspace_command', { ...command, requestId: command.requestId || crypto.randomUUID() });
}
