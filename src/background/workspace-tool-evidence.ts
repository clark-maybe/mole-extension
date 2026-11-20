/** 只读工具在模型截断前保存完整业务回包，供画像与判断引用。 */
import { workspaceRepository as repository } from '../lib/workspace-db/repository';
import { businessJson } from '../platforms/page-job';
import type { TaskAttempt } from '../workspace/types';
import { WorkspacePersistenceError } from '../workspace/errors';

export { WorkspacePersistenceError };

export async function beginObservation(sessionId: string | undefined, callId: string, name: string, params: Record<string, unknown>): Promise<TaskAttempt | undefined> {
  if (!sessionId || !['page', 'fetch_url', 'extract_data', 'douyin_search_users'].includes(name)
    || (name === 'page' && !['view', 'snapshot', 'assert', undefined].includes(params.action as string | undefined))) return undefined;
  try {
    const task = await repository.createTask({ id: `${sessionId}:${callId}`, sessionId, kind: 'tool_read', provider: name === 'douyin_search_users' ? 'douyin' : 'web', title: name,
      input: { tool: name, arguments: businessJson(params) }, maxBatches: 1, maxAttempts: 1 });
    const attempt = await repository.claimTask(task.id);
    if (!attempt) throw new Error('此读取调用已有保存记录或已中断，请查询原证据或用新调用读取');
    return attempt;
  } catch (error) { throw new WorkspacePersistenceError(`工具读取意图保存失败：${error instanceof Error ? error.message : String(error)}`); }
}

export async function commitObservation(attempt: TaskAttempt, text: string, sourceUrl: string): Promise<string> {
  try {
    let response: unknown;
    try { response = JSON.parse(text); } catch { response = { text }; }
    const evidenceId = `observation:${attempt.step.attemptId}`;
    await repository.commitBatch(attempt, { evidence: [{ id: evidenceId, taskId: attempt.task.id, stepId: attempt.step.id,
      provider: attempt.task.provider, sourceUrl, collectedAt: Date.now(), extractorVersion: 'tool-result-v1', payload: businessJson(response) }],
      leads: [], checkpoint: { evidenceId }, done: true });
    const object = response && typeof response === 'object' && !Array.isArray(response) ? response as Record<string, unknown> : { data: response };
    return JSON.stringify({ ...object, workspace_evidence_id: evidenceId, workspace_task_id: attempt.task.id });
  } catch (error) { throw new WorkspacePersistenceError(`工具结果保存失败，已停止执行：${error instanceof Error ? error.message : String(error)}`); }
}
