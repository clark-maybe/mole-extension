/** Options 对话与任务工作台。 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Empty, Input, Select, Space, Tabs, Tag } from 'antd';
import { useWorkspace } from '../../chat/useWorkspace';
import { buildTranscript } from '../../chat/transcript';
import { sendWorkspaceCommand, workspaceAction } from '../../chat/workspace-client';
import type { WorkspaceCommand } from '../../workspace/types';
import { LeadTable } from '../components/LeadTable';
import { WorkspaceInteractions } from '../components/WorkspaceInteractions';
import { WorkspaceTranscript } from '../components/WorkspaceTranscript';

const fromHash = () => window.location.hash.replace(/^#\/?/, '').split('/')[1]?.split('?')[0] || undefined;
const labels: Record<string, string> = { queued: '排队中', running: '执行中', waiting: '等待处理', paused: '已暂停', completed: '已完成', partial: '部分完成', failed: '失败', cancelled: '已取消', done: '已结束', error: '已中断' };
export function WorkspacePage() {
  const [id, setId] = useState<string | undefined>(fromHash);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [taskId, setTaskId] = useState<string>();
  const [targetTab, setTargetTab] = useState<number>();
  const [tabs, setTabs] = useState<chrome.tabs.Tab[]>([]);
  const pending = useRef<WorkspaceCommand>();
  const workspace = useWorkspace(id);
  useEffect(() => { if (!taskId && workspace.tasks.length) setTaskId(workspace.tasks[0].id); }, [taskId, workspace.tasks]);
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
    try { await sendWorkspaceCommand({ sessionId: id, taskId: target, kind: action }); void workspace.refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const archive = async () => {
    if (!id) return;
    try { await sendWorkspaceCommand({ kind: 'archive_session', sessionId: id }); window.location.hash = '#/workspace'; void workspace.refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  return <div className="lead-workspace">
    <aside className="workspace-sessions"><div className="workspace-session-tools"><Button type="primary" block onClick={() => { window.location.hash = '#/workspace'; setId(undefined); setInput(''); }}>新对话</Button>
      <div className="workspace-session-label">历史会话</div>
      <Input.Search placeholder="搜索会话标题" allowClear value={workspace.search} onChange={event => workspace.searchSessions(event.target.value)} /></div>
      <div className="workspace-session-list">{workspace.sessions.map(session => <button key={session.id} className={`workspace-session${session.id === id ? ' selected' : ''}`} onClick={() => { window.location.hash = `#/workspace/${session.id}`; }}>
        <strong>{session.title}</strong><span>{session.archived ? '已归档 · ' : ''}{labels[session.status]} · {new Date(session.updatedAt).toLocaleDateString()}</span></button>)}
      {workspace.hasMoreSessions && <Button block onClick={() => void workspace.loadMoreSessions()}>加载更多会话</Button>}</div>
    </aside>
    <section className="workspace-conversation">
      <div className="workspace-conversation-heading"><strong>{workspace.archive?.title || '描述你想寻找的客户'}</strong>
        <Space><Button type="text" size="small" onClick={() => void workspace.refresh()}>同步</Button>{id && <Button type="text" size="small" onClick={() => void archive()}>归档</Button>}</Space></div>
      {(error || workspace.error) && <Alert type="error" message={error || workspace.error} closable onClose={() => setError('')} />}
      {workspace.archive?.completeness === 'legacy_partial' && <Alert type="info" message="这是旧版记录，可用内容已导入；此前未保存的完整对话无法复原。" />}
      <WorkspaceTranscript sessionId={id} items={transcript} live={workspace.live} running={workspace.archive?.snapshot.status === 'running'} hasEarlier={workspace.hasEarlier} onLoadEarlier={workspace.loadEarlier}>
        <WorkspaceInteractions sessionId={id} />
      </WorkspaceTranscript>
      <div className="workspace-composer"><Input.TextArea value={input} onChange={event => setInput(event.target.value)} autoSize={{ minRows: 2, maxRows: 6 }} maxLength={40000}
        placeholder="描述行业、地区、目标数量和筛选标准，也可以在执行中追加条件" onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
        <div className="workspace-composer-actions"><Select allowClear placeholder="操作网页（可选）" className="workspace-target-tab" value={targetTab} onChange={setTargetTab} options={tabs.map(tab => ({ value: tab.id, label: tab.title || tab.url }))} />
          <Space wrap><Button type="primary" loading={sending} disabled={!input.trim()} onClick={() => void send()}>发送</Button>
          {id && workspace.archive?.snapshot.status === 'running' && <Button onClick={() => void workspaceAction({ action: 'stop_session', sessionId: id }).catch(reason => setError(reason.message))}>停止</Button>}
          {id && workspace.archive?.snapshot.status === 'error' && <Button onClick={() => void workspaceAction({ action: 'resume_session', sessionId: id }).catch(reason => setError(reason.message))}>继续对话</Button>}</Space></div>
      </div>
    </section>
    <section className="workspace-results"><Tabs items={[
      { key: 'leads', label: '关联线索', children: <><Select allowClear value={taskId} placeholder="选择任务查看结果" style={{ width: '100%', marginBottom: 12 }} onChange={setTaskId} options={workspace.tasks.map(task => ({ value: task.id, label: `${task.title} · ${task.savedCount} 条` }))} />{taskId ? <LeadTable taskId={taskId} /> : <Empty description="选择一个任务查看已保存线索" />}</> },
      { key: 'tasks', label: `执行任务 ${workspace.tasks.length}`, children: workspace.tasks.map(task => <article className="workspace-job" key={task.id}><strong>{task.title}</strong><p><Tag>{labels[task.status]}</Tag>已保存 {task.savedCount} 条 · {task.batches} 批</p><p>{task.reason}</p><div className="workspace-muted">{task.id}</div>
        <Space wrap><Button size="small" onClick={() => { setTaskId(task.id); }}>选择结果</Button>{['queued', 'running', 'waiting'].includes(task.status) && <Button size="small" onClick={() => void control(task.id, 'pause_task')}>暂停</Button>}
          {['paused', 'waiting', 'cancelled'].includes(task.status) && <Button size="small" onClick={() => void control(task.id, 'resume_task')}>继续</Button>}
          {!['completed', 'partial', 'failed', 'cancelled'].includes(task.status) && <Button size="small" onClick={() => void control(task.id, 'cancel_task')}>停止</Button>}</Space></article>) },
    ]} /></section>
  </div>;
}
