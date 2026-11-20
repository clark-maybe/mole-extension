/** 对话显示原语：侧栏与工作台共用消息气泡、Markdown 和执行过程。 */
import { useMemo, useState } from 'react';
import { markdownToHtml } from '../markdown';

export interface ConversationCall {
  funcName: string;
  icon: string;
  text: string;
  userSummary?: string;
  status?: 'running' | 'done' | 'error' | 'interrupted';
}

export function UserMessage({ text }: { text: string }) {
  return <div className="mole-user-msg">{text}</div>;
}

/** 仅渲染 Markdown 生成的 HTML；链接和图片仍须校验协议。 */
export function MarkdownAnswer({ text }: { text: string }) {
  const html = useMemo(() => {
    const document = new DOMParser().parseFromString(markdownToHtml(text), 'text/html');
    for (const element of document.body.querySelectorAll('*')) {
      for (const attribute of [...element.attributes]) {
        if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
      }
    }
    for (const anchor of document.body.querySelectorAll('a')) {
      if (!/^(https?:\/\/|mailto:|tel:)/i.test(anchor.getAttribute('href') || '')) anchor.removeAttribute('href');
      anchor.setAttribute('rel', 'noopener noreferrer');
    }
    for (const image of document.body.querySelectorAll('img')) {
      if (!/^https?:\/\//i.test(image.getAttribute('src') || '')) image.remove();
    }
    return document.body.innerHTML;
  }, [text]);
  return <div className="mole-answer" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function CallsGroup({ calls, isRunning, initiallyOpen = true }: {
  calls: ConversationCall[];
  isRunning: boolean;
  initiallyOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(initiallyOpen);
  if (!calls.length) return null;
  const active = calls.some(call => call.status === 'running') && isRunning;
  return <div className="mole-calls-group mole-agent-state-ops">
    <button type="button" className="mole-calls-summary" aria-expanded={isOpen} onClick={() => setIsOpen(!isOpen)}>
      <span className={`arrow${isOpen ? ' open' : ''}`} aria-hidden="true">▶</span>
      <span className="calls-text">{active ? '正在执行' : '查看执行过程'} · 共 {calls.length} 条</span>
      {active && <span className="mole-call-status running" aria-label="执行中">···</span>}
    </button>
    {isOpen && <div className="mole-calls-detail open">{calls.map((call, index) => {
      const status = call.status || (isRunning && index === calls.length - 1 ? 'running' : 'done');
      const running = status === 'running' && isRunning;
      const symbol = running ? '···' : status === 'done' ? '✓' : status === 'error' ? '!' : '—';
      const label = running ? '执行中' : status === 'done' ? '完成' : status === 'error' ? '未完成' : '已中断';
      return <div key={index} className={`mole-call-item tone-${running ? 'action' : status === 'error' ? 'issue' : 'done'}`}>
        <div className="mole-call-header">
          {call.icon ? <img className="mole-func-icon" src={call.icon} alt="" /> : <span className="mole-task-runtime-step-dot" />}
          <span className="mole-call-main"><span className="mole-call-title">{call.text}</span>
            {call.userSummary && call.userSummary !== call.text && <span className="mole-call-intent">{call.userSummary}</span>}
          </span>
          <span className={`mole-call-status${running ? ' running' : ''}`} aria-label={label}>{symbol}</span>
        </div>
      </div>;
    })}</div>}
  </div>;
}
