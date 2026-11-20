/** 阅读位置属于当前客户端，后台任务不会因组件卸载而停止。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Channel from '../lib/channel';
import { workspaceQuery } from './workspace-client';
import type { LeadTask, SessionArchive, SessionSummary, SessionPage, WorkspaceEvent } from '../workspace/types';

export function useWorkspace(sessionId?: string) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [archive, setArchive] = useState<SessionArchive>();
  const [events, setEvents] = useState<WorkspaceEvent[]>([]);
  const [tasks, setTasks] = useState<LeadTask[]>([]);
  const [live, setLive] = useState('');
  const [search, setSearch] = useState('');
  const searchRef = useRef('');
  const [hasMoreSessions, setHasMoreSessions] = useState(false);
  const [hasEarlier, setHasEarlier] = useState(false);
  const [error, setError] = useState('');
  const selected = useRef(sessionId);
  const cursor = useRef(0);
  const generation = useRef(0);
  const loading = useRef<Promise<void>>();
  const again = useRef(false);
  const invalidate = useCallback(() => { generation.current++; }, []);
  const refresh = useCallback(() => {
    if (loading.current) { again.current = true; return loading.current; }
    const epoch = generation.current;
    const id = selected.current;
    const work = (async () => {
      const [list, jobs] = await Promise.all([
        workspaceQuery<SessionSummary[]>({ kind: 'sessions', search: searchRef.current }),
        id ? workspaceQuery<LeadTask[]>({ kind: 'tasks', sessionId: id }) : Promise.resolve([]),
      ]);
      if (epoch !== generation.current) return;
      setSessions(previous => [...new Map([...previous, ...list].map(row => [row.id, row])).values()].sort((a, b) => b.updatedAt - a.updatedAt || b.id.localeCompare(a.id)));
      setHasMoreSessions(list.length === 50); setTasks(jobs.filter(job => job.kind !== 'tool_read'));
      if (!id) return;
      let more = true;
      while (more && epoch === generation.current) {
        const initial = cursor.current === 0;
        const page = await workspaceQuery<SessionPage>(initial ? { kind: 'session_history', sessionId: id } : { kind: 'session', sessionId: id, afterSeq: cursor.current });
        if (epoch !== generation.current) return;
        setArchive(page.session);
        setEvents(previous => {
          const merged = new Map(previous.map(event => [event.eventId, event]));
          page.events.forEach(event => merged.set(event.eventId, event));
          return [...merged.values()].sort((a, b) => Number(a.seq) - Number(b.seq));
        });
        cursor.current = page.lastSeq; more = !initial && page.hasMore;
        if (initial) setHasEarlier(page.hasMore);
      }
      if (epoch === generation.current) { setLive(''); setError(''); }
    })().catch(reason => { if (epoch === generation.current) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => {
        loading.current = undefined;
        if (again.current || epoch !== generation.current) { again.current = false; void refresh(); }
      });
    loading.current = work;
    return work;
  }, []);

  useEffect(() => {
    selected.current = sessionId; generation.current++; cursor.current = 0;
    setEvents([]); setArchive(undefined); setLive(''); setError(''); setHasEarlier(false);
    void refresh();
  }, [sessionId, refresh]);

  useEffect(() => {
    const changed = () => { void refresh(); };
    const stream = (data: { sessionId?: string; type?: string; content?: string }) => {
      if (data.sessionId !== selected.current) return;
      if (data.type === 'text') setLive(data.content || '');
      else if (['function_call', 'turn_started', 'turn_completed', 'turn_aborted'].includes(data.type || '')) setLive('');
    };
    const failed = (data: { sessionId?: string; message?: string }) => {
      if (!data.sessionId || data.sessionId === selected.current) setError(data.message || '后台操作失败');
    };
    Channel.on('__workspace_changed', changed); Channel.on('__channel_reconnected', changed);
    Channel.on('__ai_stream', stream); Channel.on('__workspace_storage_error', failed); Channel.on('__workspace_command_error', failed);
    return () => {
      Channel.off('__workspace_changed', changed); Channel.off('__channel_reconnected', changed);
      Channel.off('__ai_stream', stream); Channel.off('__workspace_storage_error', failed); Channel.off('__workspace_command_error', failed);
      invalidate();
    };
  }, [refresh, invalidate]);

  const loadMoreSessions = async () => {
    const last = sessions.at(-1);
    if (!last) return;
    const term = searchRef.current;
    try {
      const page = await workspaceQuery<SessionSummary[]>({ kind: 'sessions', before: { updatedAt: last.updatedAt, id: last.id }, search: term });
      if (term !== searchRef.current) return;
      setSessions(previous => [...new Map([...previous, ...page].map(row => [row.id, row])).values()]);
      setHasMoreSessions(page.length === 50);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const loadEarlier = async () => {
    const id = selected.current, epoch = generation.current;
    const first = events[0]?.seq;
    if (!id || !first) return;
    try {
      const page = await workspaceQuery<SessionPage>({ kind: 'session_history', sessionId: id, beforeSeq: first });
      if (epoch !== generation.current) return;
      setEvents(previous => [...new Map([...page.events, ...previous].map(row => [row.eventId, row])).values()].sort((a, b) => Number(a.seq) - Number(b.seq)));
      setHasEarlier(page.hasMore);
    } catch (reason) { if (epoch === generation.current) setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const searchSessions = (term: string) => {
    searchRef.current = term; setSearch(term); setSessions([]); generation.current++;
    void refresh();
  };
  return { sessions, archive, events, tasks, live, error, refresh, search, searchSessions, loadMoreSessions, hasMoreSessions, loadEarlier, hasEarlier };
}
