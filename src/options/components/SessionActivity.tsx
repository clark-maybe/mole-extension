/** 运行反馈使用真实模型/作业状态；动画仅表达活动，不制造进度。 */
import { ArrowRightOutlined, PauseOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import type { LeadTask, SessionActivity } from '../../workspace/types';

export function ActivityMark({ state }: { state: SessionActivity['state'] }) {
  return <span className={`workspace-activity-mark is-${state}`} aria-hidden="true">
    {state === 'running' ? <><i /><i /><i /><i /></> : state === 'queued' ? <span className="workspace-queue-ring" /> : state === 'waiting' ? '!' : state === 'paused' ? <PauseOutlined /> : state === 'error' ? '!' : '✓'}
  </span>;
}

export function SessionStatusBadge({ activity }: { activity: SessionActivity }) {
  return <span className={`workspace-status-badge is-${activity.state}`}><ActivityMark state={activity.state} />{activity.label}</span>;
}

export function SessionRuntime({ activity, task, onInspect, onControl, busy }: {
  activity: SessionActivity;
  task?: LeadTask;
  onInspect: () => void;
  onControl: (taskId: string, action: 'pause_task' | 'resume_task') => void;
  busy: boolean;
}) {
  if (activity.state === 'done') return null;
  return <div className={`workspace-runtime is-${activity.state}`}>
    <div className="workspace-runtime-orb"><ActivityMark state={activity.state} /></div>
    <div className="workspace-runtime-copy" role="status" aria-live="polite">
      <div className="workspace-runtime-title">{activity.label}<span>{activity.activeTasks ? `${activity.activeTasks} 个后台作业` : '会话状态'}</span></div>
      <p title={activity.detail}>{activity.detail}</p>
      {activity.totalTasks > 0 && <div className="workspace-runtime-facts"><span>{activity.completedTasks} / {activity.totalTasks} 个作业已结束</span>{activity.waitingTasks > 0 && <span>{activity.waitingTasks} 个待处理</span>}{task && task.savedCount > 0 && <span>当前作业已保存 {task.savedCount} 条</span>}</div>}
    </div>
    <div className="workspace-runtime-actions">
      {task && ['running', 'queued'].includes(task.status) && <Button size="small" type="text" icon={<PauseOutlined />} loading={busy} onClick={() => onControl(task.id, 'pause_task')}>暂停作业</Button>}
      {task?.status === 'paused' && <Button size="small" type="text" icon={<PlayCircleOutlined />} loading={busy} onClick={() => onControl(task.id, 'resume_task')}>继续作业</Button>}
      <Button size="small" type="text" icon={<ArrowRightOutlined rotate={-45} />} onClick={onInspect}>{activity.state === 'waiting' ? '查看待处理项' : '查看执行'}</Button>
    </div>
  </div>;
}
