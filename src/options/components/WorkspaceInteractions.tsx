/** 提问/授权由同一后台请求标识关联，刷新工作台后仍可回答。 */
import { useEffect, useState } from 'react';
import { Button, Card, Input, Space } from 'antd';
import Channel from '../../lib/channel';
import { workspaceQuery } from '../../chat/workspace-client';

interface Interaction { requestId: string; sessionId?: string; kind: 'question' | 'approval'; state: string; message?: string; question?: string; options?: string[]; allowFreeText?: boolean }
export function WorkspaceInteractions({ sessionId }: { sessionId?: string }) {
  const [items, setItems] = useState<Interaction[]>([]);
  const [answer, setAnswer] = useState('');
  useEffect(() => {
    let disposed = false;
    setItems([]); setAnswer('');
    const load = () => { void workspaceQuery<Interaction[]>({ kind: 'interactions', sessionId }).then(rows => { if (!disposed) setItems(rows.filter(item => item.state === 'pending' && item.sessionId === sessionId)); }).catch(() => undefined); };
    const receive = (item: Interaction) => { if (item.sessionId === sessionId) setItems(previous => [...previous.filter(old => old.requestId !== item.requestId), item]); };
    const settle = (item: { requestId: string }) => setItems(previous => previous.filter(old => old.requestId !== item.requestId));
    Channel.on('__ask_user_request', receive); Channel.on('__approval_request', receive);
    Channel.on('__ask_user_settled', settle); Channel.on('__approval_settled', settle); Channel.on('__ask_user_cancel', settle); Channel.on('__approval_cancel', settle); Channel.on('__channel_reconnected', load);
    load();
    return () => {
      disposed = true; Channel.off('__ask_user_request', receive); Channel.off('__approval_request', receive);
      Channel.off('__ask_user_settled', settle); Channel.off('__approval_settled', settle); Channel.off('__ask_user_cancel', settle); Channel.off('__approval_cancel', settle); Channel.off('__channel_reconnected', load);
    };
  }, [sessionId]);
  return <>{items.map(item => <Card key={item.requestId} size="small" title={item.kind === 'approval' ? '需要确认' : '补充信息'}>
    <p>{item.message || item.question}</p><Space wrap>
      {item.kind === 'approval' ? <><Button type="primary" onClick={() => Channel.send('__approval_response', { requestId: item.requestId, approved: true })}>允许</Button>
        <Button onClick={() => Channel.send('__approval_response', { requestId: item.requestId, approved: false })}>拒绝</Button></>
        : <>{item.options?.map(option => <Button key={option} onClick={() => Channel.send('__ask_user_response', { requestId: item.requestId, answer: option, source: 'option' })}>{option}</Button>)}
          {item.allowFreeText !== false && <><Input value={answer} onChange={event => setAnswer(event.target.value)} placeholder="输入回答" /><Button disabled={!answer.trim()} onClick={() => Channel.send('__ask_user_response', { requestId: item.requestId, answer, source: 'text' })}>提交</Button></>}</>}
    </Space></Card>)}</>;
}
