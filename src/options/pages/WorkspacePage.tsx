/** Options 对话与任务工作台。 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Empty, Input, Select, Space, Tabs } from 'antd';
import { ArrowUpOutlined, PauseOutlined, PlayCircleOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons';
import { useWorkspace } from '../../chat/useWorkspace';
import { buildTranscript } from '../../chat/transcript';
import { sendWorkspaceCommand, workspaceAction } from '../../chat/workspace-client';
import type { WorkspaceCommand } from '../../workspace/types';
import { LeadTable } from '../components/LeadTable';
import { WorkspaceInteractions } from '../components/WorkspaceInteractions';
import { WorkspaceTranscript } from '../components/WorkspaceTranscript';
import { WorkspaceSessions } from '../components/WorkspaceSessions';
import { SessionRuntime, SessionStatusBadge } from '../components/SessionActivity';
import { getSessionActivity } from '../../workspace/session-activity';

const fromHash = () => window.location.hash.replace(/^#\/?/, '').split('/')[1]?.split('?')[0] || undefined;
const labels: Record<string, string> = { queued: '排队中', running: '执行中', waiting: '等待处理', paused: '已暂停', completed: '已完成', partial: '部分完成', failed: '失败', cancelled: '已取消', done: '已结束', error: '已中断' };
export function WorkspacePage() {
  const [id, setId] = useState<string | undefined>(fromHash);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [taskId, setTaskId] = useState<string>();
  const [targetTab, setTargetTab] = useState<number>();
  const [resultsTab, setResultsTab] = useState('leads');
  const [pendingTask, setPendingTask] = useState<string>();
  const [sessionBusy, setSessionBusy] = useState(false);
  const composer = useRef<HTMLDivElement>(null);
  const [tabs, setTabs] = useState<chrome.tabs.Tab[]>([]);
  const pending = useRef<WorkspaceCommand>();
  const workspace = useWorkspace(id);
  useEffect(() => { if (workspace.tasks.length && !workspace.tasks.some(task => task.id === taskId)) setTaskId(workspace.tasks[0].id); }, [taskId, workspace.tasks]);
  const activity = useMemo(() => {
    const summary = workspace.sessions.find(session => session.id === id)?.activity;
    return summary?.needsReply ? summary : getSessionActivity(workspace.archive?.snapshot || { status: 'done' }, workspace.tasks);
  }, [id, workspace.sessions, workspace.archive, workspace.tasks]);
  const activityTask = workspace.tasks.find(task => task.id === activity.taskId);
  const isModelRunning = workspace.archive?.snapshot.status === 'running';
  const transcript = useMemo(() => buildTranscript(workspace.events), [workspace.events]);
  useEffect(() => {
    const change = () => { setId(fromHash()); setTaskId(undefined); };
    window.addEventListener('hashchange', change);
    void chrome.tabs.query({}).then(items => setTabs(items.filter(tab => /^https?:/.test(tab.url || ''))));
    try {
      const saved = sessionStorage.getItem('mole.workspace.pending-message');
      if (saved) { pending.current = JSON.parse(saved) as WorkspaceCommand; setInput(pending.current.text || ''); setError('上次消息的发送结果待确认；再次发送将使用原指令标识核对。'); }
    } catch { sessionStorage.removeItem('mole.workspace.pending-message'); }
    return () => window.removeEventListener('hashchange', change);
  }, []);
  const send = async () => {
    if (!input.trim() || sending) return;
    const command = pending.current?.text === input.trim() ? pending.current : { requestId: crypto.randomUUID(), sessionId: id || crypto.randomUUID(), kind: 'send_message' as const, text: input.trim(), ...(targetTab ? { tabId: targetTab } : {}) };
    pending.current = command; sessionStorage.setItem('mole.workspace.pending-message', JSON.stringify(command)); setSending(true); setError('');
    try {
      const result = await sendWorkspaceCommand(command);
      pending.current = undefined; sessionStorage.removeItem('mole.workspace.pending-message'); setInput('');
      window.location.hash = `#/workspace/${result.sessionId}`;
      void workspace.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSending(false); }
  };
  const control = async (target: string, action: 'pause_task' | 'resume_task' | 'cancel_task') => {
    if (!id) return;
    if (pendingTask) return;
    setPendingTask(target);
    try { await sendWorkspaceCommand({ sessionId: id, taskId: target, kind: action }); await workspace.refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setPendingTask(undefined); }
  };
  const archive = async () => {
    if (!id) return;
    try { await sendWorkspaceCommand({ kind: 'archive_session', sessionId: id }); window.location.hash = '#/workspace'; void workspace.refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const sessionAction = async (action: 'stop_session' | 'resume_session') => {
    if (!id || sessionBusy) return;
    setSessionBusy(true);
    try { await workspaceAction({ action, sessionId: id }); await workspace.refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSessionBusy(false); }
  };
  const suggest = (text: string) => { setInput(text); composer.current?.querySelector('textarea')?.focus(); };
  return <div className="lead-workspace">
    <WorkspaceSessions selectedId={id} sessions={workspace.sessions} activeSessions={workspace.activeSessions}
      search={workspace.search} onSearch={workspace.searchSessions} hasMore={workspace.hasMoreSessions} onLoadMore={workspace.loadMoreSessions}
      onNew={() => { window.location.hash = '#/workspace'; setId(undefined); setTaskId(undefined); setInput(''); }}
      onSelect={sessionId => { window.location.hash = `#/workspace/${sessionId}`; }} />
    <section className={`workspace-conversation is-${activity.state}`}>
      <div className="workspace-conversation-heading"><div className="workspace-conversation-title"><span>{id ? '当前会话' : '开始一段新的探索'}</span><strong>{workspace.archive?.title || '发现你的下一位客户'}</strong></div>
        <Space size={6}>{id && workspace.archive && <SessionStatusBadge activity={activity} />}<Button type="text" size="small" icon={<ReloadOutlined />} aria-label="同步会话" title="同步会话" onClick={() => void workspace.refresh()} />{id && <Button type="text" size="small" onClick={() => void archive()}>归档</Button>}</Space></div>
      {(error || workspace.error) && <Alert type="error" message={error || workspace.error} closable onClose={() => setError('')} />}
      {workspace.archive?.completeness === 'legacy_partial' && <Alert type="info" message="这是旧版记录，可用内容已导入；此前未保存的完整对话无法复原。" />}
      {id && workspace.archive && <SessionRuntime activity={activity} task={activityTask} busy={Boolean(pendingTask)} onControl={(target, action) => void control(target, action)} onInspect={() => {
        if (activity.taskId) { setTaskId(activity.taskId); setResultsTab('tasks'); }
        else { const messages = document.querySelector<HTMLDivElement>('.workspace-transcript'); messages?.scrollTo({ top: messages.scrollHeight, behavior: 'smooth' }); }
      }} />}
      <WorkspaceTranscript sessionId={id} items={transcript} live={workspace.live} running={isModelRunning} waitingForUser={activity.needsReply} hasEarlier={workspace.hasEarlier} onLoadEarlier={workspace.loadEarlier} onSuggest={suggest}>
        <WorkspaceInteractions sessionId={id} />
      </WorkspaceTranscript>
      <div className="workspace-composer" ref={composer}><div className="workspace-composer-box"><Input.TextArea value={input} onChange={event => setInput(event.target.value)} autoSize={{ minRows: 2, maxRows: 6 }} maxLength={40000}
        aria-label="发送给 Mole 的消息" placeholder="想找什么样的客户？说说行业、地区和活跃要求…" onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
        <div className="workspace-composer-actions"><Select allowClear placeholder="操作网页（可选）" className="workspace-target-tab" value={targetTab} onChange={setTargetTab} options={tabs.map(tab => ({ value: tab.id, label: tab.title || tab.url }))} />
          <Space size={8}>{id && isModelRunning && <Button type="text" loading={sessionBusy} icon={<StopOutlined />} onClick={() => void sessionAction('stop_session')}>停止回复</Button>}
          {id && workspace.archive?.snapshot.status === 'error' && <Button type="text" loading={sessionBusy} icon={<PlayCircleOutlined />} onClick={() => void sessionAction('resume_session')}>继续对话</Button>}
          <Button type="primary" className="workspace-send" shape="circle" icon={<ArrowUpOutlined />} aria-label="发送消息" title="发送消息" loading={sending} disabled={!input.trim()} onClick={() => void send()} /></Space></div>
        </div><div className="workspace-composer-hint"><span>{['running', 'queued'].includes(activity.state) && id ? '任务在后台推进，你可以继续追加条件' : '发现活跃企业 · 核实主体 · 精确补全'}</span><span>Enter 发送 · Shift + Enter 换行</span></div>
      </div>
    </section>
    <section className="workspace-results"><Tabs activeKey={resultsTab} onChange={setResultsTab} items={[
      { key: 'leads', label: '关联线索', children: <><Select allowClear value={taskId} placeholder="选择任务查看结果" style={{ width: '100%', marginBottom: 12 }} onChange={setTaskId} options={workspace.tasks.map(task => ({ value: task.id, label: `${task.title} · ${task.savedCount} 条` }))} />{taskId ? <LeadTable taskId={taskId} /> : <Empty description="发现的线索会逐批保存在这里" />}</> },
      { key: 'tasks', label: <span className="workspace-tasks-tab">执行任务 <b>{workspace.tasks.length}</b>{activity.activeTasks > 0 && <i className="workspace-live-dot" />}</span>, children: workspace.tasks.length ? workspace.tasks.map(task => <article className={`workspace-job is-${task.status}`} key={task.id}>
        <div className="workspace-job-heading"><strong>{task.title}</strong><span className={`workspace-job-status is-${task.status}`}>{labels[task.status]}</span></div>
        <div className="workspace-job-metrics"><span><b>{task.savedCount}</b>已保存</span><span><b>{task.batches}</b>批次</span></div>
        {task.kind === 'douyin_collect' && Number(task.input.targetCount) > 0 && <div className="workspace-job-progress" role="progressbar" aria-label="采集目标完成数量" aria-valuemin={0} aria-valuemax={Number(task.input.targetCount)} aria-valuenow={Math.min(task.savedCount, Number(task.input.targetCount))}><span style={{ width: `${Math.min(100, task.savedCount / Number(task.input.targetCount) * 100)}%` }} /></div>}
        {task.reason && <p className="workspace-job-reason">{task.reason}</p>}
        <Space wrap size={4}><Button type="text" size="small" onClick={() => { setTaskId(task.id); setResultsTab('leads'); }}>查看结果</Button>{['queued', 'running', 'waiting'].includes(task.status) && <Button type="text" size="small" icon={<PauseOutlined />} disabled={Boolean(pendingTask)} onClick={() => void control(task.id, 'pause_task')}>暂停</Button>}
          {['paused', 'waiting', 'cancelled'].includes(task.status) && <Button type="text" size="small" icon={<PlayCircleOutlined />} loading={pendingTask === task.id} disabled={Boolean(pendingTask) && pendingTask !== task.id} onClick={() => void control(task.id, 'resume_task')}>继续</Button>}
          {!['completed', 'partial', 'failed', 'cancelled'].includes(task.status) && <Button type="text" size="small" disabled={Boolean(pendingTask)} onClick={() => void control(task.id, 'cancel_task')}>停止</Button>}</Space></article>) : <Empty description="开始找客后，这里会显示执行进度" /> },
    ]} /></section>
  </div>;
}
