/** 会话执行态同时考虑模型与持久作业，模型回合结束不等于后台任务结束。 */
import type { Session } from '../ai/types';
import type { LeadTask, SessionActivity } from './types';

export const ACTIVE_SESSION_STATES = new Set(['running', 'queued', 'waiting', 'paused']);
const jobLabels: Record<LeadTask['kind'], string> = {
  douyin_collect: '正在发现活跃企业', company_search: '正在补全企业信息',
  company_contacts: '正在获取法人联系方式', crm_delivery: '正在录入 CRM', tool_read: '正在读取资料',
};
const jobLabel = (task: LeadTask): string => task.kind === 'company_search' && task.checkpoint?.stage === 'contacts' ? '正在获取法人联系方式' : jobLabels[task.kind];

export function getSessionActivity(snapshot: Pick<Session, 'status'> & Partial<Pick<Session, 'agentState' | 'lastError' | 'failureCode'>>, tasks: LeadTask[], interaction?: { kind?: string; question?: string; message?: string }): SessionActivity {
  const jobs = tasks.filter(task => task.kind !== 'tool_read');
  const running = jobs.filter(task => task.status === 'running');
  const queued = jobs.filter(task => task.status === 'queued');
  const waiting = jobs.filter(task => task.status === 'waiting');
  const paused = jobs.filter(task => task.status === 'paused');
  const counts = { totalTasks: jobs.length, completedTasks: jobs.filter(task => ['completed', 'partial'].includes(task.status)).length,
    activeTasks: running.length + queued.length, waitingTasks: waiting.length, pausedTasks: paused.length };
  const result = (state: SessionActivity['state'], label: string, detail: string, task?: LeadTask): SessionActivity =>
    ({ ...counts, state, label, detail, ...(task ? { taskId: task.id } : {}) });
  if (interaction) return { ...result('waiting', interaction.kind === 'approval' ? '等待你的确认' : '等待你的回复', interaction.question || interaction.message || '请处理对话中的问题后继续'), needsReply: true };
  if (running.length) {
    const task = running[0];
    return result('running', jobLabel(task), `${task.title}${task.savedCount ? ` · 已保存 ${task.savedCount} 条` : ''}`, task);
  }
  if (snapshot.status === 'running') {
    const phaseLabels: Record<string, string> = { plan: '正在规划', act: '正在执行', observe: '正在整理信息', verify: '正在核验信息', finalize: '正在整理结果' };
    return result('running', phaseLabels[snapshot.agentState?.phase || ''] || '正在处理', waiting.length ? `${waiting.length} 个作业等待处理，其他工作继续中` : 'Agent 正在处理这轮诉求');
  }
  if (queued.length) {
    const task = queued[0];
    return result('queued', task.kind === 'douyin_collect' && task.batches ? '等待下一批' : task.checkpoint?.stage === 'contacts' ? '等待补全联系方式' : '排队执行', `${jobLabel(task).replace(/^正在/, '')} · ${task.title}${task.savedCount ? ` · 已保存 ${task.savedCount} 条` : ''}`, task);
  }
  if (waiting.length) return result('waiting', '需要处理', waiting[0].reason || '请处理平台登录或验证后继续', waiting[0]);
  if (snapshot.status === 'waiting') return result(snapshot.agentState?.phase === 'plan' ? 'queued' : 'waiting', snapshot.agentState?.phase === 'plan' ? '等待执行' : '等待回复', snapshot.agentState?.phase === 'plan' ? '已接收，前一个会话结束后开始' : '请查看对话中的待处理事项');
  if (paused.length) return result('paused', '已暂停', '进度已保存，继续后从检查点接续', paused[0]);
  if (snapshot.status === 'error') return result('error', snapshot.failureCode === 'E_CANCELLED' ? '已停止' : '已中断', snapshot.lastError || '已保存已有内容，可继续对话');
  const failed = jobs.find(task => task.status === 'failed');
  if (failed) return result('error', '有任务未完成', failed.reason || '查看执行任务了解原因', failed);
  return result('done', '本轮结束', jobs.some(task => task.status === 'partial') ? '已有结果已保存，部分信息仍待补充' : '对话和结果已保存');
}
