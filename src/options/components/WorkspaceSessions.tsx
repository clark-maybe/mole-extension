/** 活跃会话独立置顶，历史分页不隐藏旧会话的后台任务。 */
import { useState } from 'react';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { Button, Input } from 'antd';
import type { SessionSummary } from '../../workspace/types';
import { ActivityMark } from './SessionActivity';

interface Props {
  selectedId?: string;
  sessions: SessionSummary[];
  activeSessions: SessionSummary[];
  search: string;
  hasMore: boolean;
  onSearch: (value: string) => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  onLoadMore: () => Promise<void>;
}

export function WorkspaceSessions({ selectedId, sessions, activeSessions, search, hasMore, onSearch, onNew, onSelect, onLoadMore }: Props) {
  const [filter, setFilter] = useState<'all' | 'active' | 'attention'>('all');
  const [loading, setLoading] = useState(false);
  const active = activeSessions.filter(session => ['running', 'queued'].includes(session.activity.state));
  const attention = activeSessions.filter(session => ['waiting', 'paused'].includes(session.activity.state));
  const pinned = new Set(activeSessions.map(session => session.id));
  const history = sessions.filter(session => !pinned.has(session.id));
  const row = (session: SessionSummary) => <button key={session.id} type="button" title={session.title}
    className={`workspace-session is-${session.activity.state}${session.id === selectedId ? ' selected' : ''}`}
    aria-current={session.id === selectedId ? 'page' : undefined} onClick={() => onSelect(session.id)}>
    <div className="workspace-session-row"><strong>{session.title}</strong><ActivityMark state={session.activity.state} /></div>
    <div className="workspace-session-meta"><span className="workspace-session-state">{session.activity.label}</span><time dateTime={new Date(session.updatedAt).toISOString()}>{new Date(session.updatedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</time></div>
    {pinned.has(session.id) && <p className="workspace-session-detail">{session.activity.detail}</p>}
    {session.archived && <span className="workspace-session-archived">已归档</span>}
  </button>;
  const group = (title: string, rows: SessionSummary[], className: string) => rows.length > 0 && <section className={`workspace-session-group ${className}`}>
    <h3>{title}<span>{rows.length}</span></h3>{rows.map(row)}
  </section>;
  return <aside className="workspace-sessions">
    <div className="workspace-session-tools"><Button type="primary" block icon={<PlusOutlined />} onClick={onNew}>新对话</Button>
      <div className={`workspace-session-overview${active.length ? ' is-live' : ''}`}><span>{active.length ? <><span className="workspace-live-dot" />{active.length} 个会话正在推进</> : '你的找客工作空间'}</span><small>{attention.length ? `${attention.length} 个待处理 / 已暂停` : '对话与进度持续保存'}</small></div>
      <Input prefix={<SearchOutlined />} placeholder="搜索会话" allowClear aria-label="搜索会话标题" value={search} onChange={event => onSearch(event.target.value)} />
      <div className="workspace-session-filters" aria-label="筛选会话">{([['all', '全部', undefined], ['active', '进行中', active.length], ['attention', '待处理', attention.length]] as const).map(([value, label, count]) =>
        <button type="button" key={value} className={filter === value ? 'selected' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}{count !== undefined && count > 0 && <span>{count}</span>}</button>)}</div>
    </div>
    <div className="workspace-session-list">
      {filter !== 'attention' && group('正在推进', active, 'is-active')}
      {filter !== 'active' && group('待处理与暂停', attention, 'is-attention')}
      {filter === 'all' && group('最近对话', history, 'is-history')}
      {((filter === 'active' && !active.length) || (filter === 'attention' && !attention.length) || (filter === 'all' && !sessions.length && !activeSessions.length)) && <div className="workspace-session-empty">{search ? '没有找到匹配的会话' : filter === 'attention' ? '暂时没有待处理事项' : '从一段新的对话开始'}</div>}
      {filter === 'all' && hasMore && <Button type="text" size="small" block loading={loading} onClick={() => {
        setLoading(true); void onLoadMore().finally(() => setLoading(false));
      }}>加载更多会话</Button>}
    </div>
  </aside>;
}
