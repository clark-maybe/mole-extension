/** 中断时补齐悬空工具调用的回包；已启动的持久作业只引用，不重新创建。 */
import type { Session } from '../ai/types';
import { workspaceRepository } from '../lib/workspace-db/repository';

export async function repairInterruptedContext(session: Session): Promise<void> {
  const outputs = new Set(session.context.flatMap(item => 'type' in item && item.type === 'function_call_output' ? [item.call_id] : []));
  const repaired: Session['context'] = [];
  for (const item of session.context) {
    repaired.push(item);
    if (!('type' in item) || item.type !== 'function_call' || outputs.has(item.call_id)) continue;
    const task = await workspaceRepository.getTask(`${session.id}:${item.call_id}`);
    repaired.push({ type: 'function_call_output', call_id: item.call_id, output: JSON.stringify(task && task.kind !== 'tool_read'
      ? { success: true, data: { task_id: task.id, status: task.status, saved_count: task.savedCount, message: '已启动的持久作业，请查询保存结果，不要重新创建' } }
      : { success: false, code: 'E_INTERRUPTED_RESULT_UNKNOWN', error: '此工具执行被中断，结果未确认。写入操作必须先核对；读取可根据任务需要重试。' }) });
  }
  session.context = repaired;
}
