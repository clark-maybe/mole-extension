/** 复用已有对话的消息渲染，工作台只维护阅读位置和档案分页。 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from 'antd';
import { CallsGroup, MarkdownAnswer, UserMessage } from '../../content/float-ball/components/ConversationItems';
import { FUNCTION_ICONS, FUNCTION_LABELS } from '../../content/float-ball/icons';
import type { TranscriptItem } from '../../chat/transcript';

interface Props {
  sessionId?: string;
  items: TranscriptItem[];
  live: string;
  running: boolean;
  hasEarlier: boolean;
  onLoadEarlier: () => Promise<void>;
  children?: ReactNode;
}

type Entry = { kind: 'message'; item: TranscriptItem } | { kind: 'calls'; id: string; items: TranscriptItem[] };

export function WorkspaceTranscript({ sessionId, items, live, running, hasEarlier, onLoadEarlier, children }: Props) {
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const anchor = useRef<{ height: number; top: number }>();
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const entries = useMemo(() => {
    const result: Entry[] = [];
    for (const item of items) {
      if (item.role !== 'tool') { result.push({ kind: 'message', item }); continue; }
      const last = result.at(-1);
      if (last?.kind === 'calls') last.items.push(item);
      else result.push({ kind: 'calls', id: item.id, items: [item] });
    }
    return result;
  }, [items]);
  useLayoutEffect(() => { follow.current = true; anchor.current = undefined; }, [sessionId]);
  useLayoutEffect(() => {
    const element = scroll.current;
    if (!element) return;
    if (anchor.current) {
      if (loadingEarlier) return;
      element.scrollTop = anchor.current.top + element.scrollHeight - anchor.current.height;
      anchor.current = undefined;
    } else if (follow.current) element.scrollTop = element.scrollHeight;
  }, [items, live, sessionId, loadingEarlier]);

  const loadEarlier = async () => {
    const element = scroll.current;
    if (!element || loadingEarlier) return;
    anchor.current = { height: element.scrollHeight, top: element.scrollTop };
    follow.current = false;
    setLoadingEarlier(true);
    try { await onLoadEarlier(); } finally { setLoadingEarlier(false); }
  };
  const replaceLastAnswer = running && Boolean(live) && items.at(-1)?.role === 'assistant';
  return <div className="workspace-transcript" ref={scroll} onScroll={() => {
    const element = scroll.current;
    if (element) follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 72;
  }}>
    <div className="workspace-transcript-content">
      {hasEarlier && <div className="workspace-earlier"><Button type="text" size="small" loading={loadingEarlier} onClick={() => void loadEarlier()}>加载更早的对话</Button></div>}
      {!items.length && !live && !running && <div className="workspace-welcome">
        <img src={chrome.runtime.getURL('logo.png')} alt="" /><h2>想寻找什么样的客户？</h2>
        <p>说说行业、地区和筛选条件，我会帮你寻找线索、核实信息并整理成表。</p>
        <div>例如：寻找上海从事汽车贴膜的企业，先核验主营业务，再补充企业与联系方式。</div>
      </div>}
      {entries.map((entry, index) => {
        if (entry.kind === 'calls') return <CallsGroup key={entry.id} initiallyOpen={false} isRunning={running} calls={entry.items.map(item => ({
          funcName: item.toolName || '', icon: FUNCTION_ICONS[item.toolName || ''] || '',
          text: FUNCTION_LABELS[item.toolName || ''] || item.toolName || item.text,
          userSummary: [item.summary, item.message].filter(Boolean).join(' · '), status: item.status === '完成' ? 'done' : item.status === '未完成' ? 'error' : running ? 'running' : 'interrupted',
        }))} />;
        const { item } = entry;
        if (item.role === 'user') return <UserMessage key={item.id} text={item.text} />;
        if (item.role === 'assistant') return <article key={item.id} className="workspace-assistant">
          <div className="workspace-assistant-label"><img src={chrome.runtime.getURL('logo.png')} alt="" />Mole</div>
          <MarkdownAnswer text={replaceLastAnswer && index === entries.length - 1 ? live : item.text} />
        </article>;
        return <div key={item.id} className={`workspace-conversation-note${item.status === '执行失败' ? ' is-error' : ''}`} role="status">
          {item.status && <span>{item.status}</span>}{item.text}
        </div>;
      })}
      {running && live && !replaceLastAnswer && <article className="workspace-assistant">
        <div className="workspace-assistant-label"><img src={chrome.runtime.getURL('logo.png')} alt="" />Mole</div>
        <MarkdownAnswer text={live} />
      </article>}
      {running && !live && <div className="workspace-thinking" role="status"><span /><span /><span />正在处理</div>}
      {children}
    </div>
  </div>;
}
