import type { ToolLoginNotice } from '../../../lib/tool-login';
import { CHANNEL_PLATFORMS } from '../../../lib/channel-platforms';
import Channel from '../../../lib/channel';

/** 独立于模型回复展示，工具一旦报告登录问题即可操作。 */
export function ToolLoginCard({ notice, sessionId }: { notice: ToolLoginNotice; sessionId?: string }) {
  const platform = CHANNEL_PLATFORMS[notice.platform];
  return (
    <div className="mole-login-notice mole-channel-card" role="status">
      <div className="mole-channel-header">
        <img className="mole-channel-icon" src={platform.icon} alt="" />
        <div className="mole-channel-identity"><strong>{platform.name}</strong><span>搜索账号与线索</span></div>
        <span className="mole-channel-state">{notice.status === 'checking' ? '正在检查' : notice.kind === 'verification' ? '安全验证' : '需要登录'}</span>
      </div>
      <div className="mole-channel-body"><strong>{notice.title}</strong><p>{notice.message}</p></div>
      <div className="mole-channel-footer">
        <span>{notice.autoResume ? '处理完成后自动继续' : '完成后回来重试'}</span>
        {notice.autoResume && sessionId && <button type="button" className="mole-channel-check"
          disabled={notice.status === 'checking'} onClick={() => Channel.send('__channel_access_check', { sessionId })}>
          {notice.status === 'checking' ? '正在检查…' : '检查并继续'}
        </button>}
        <a className="mole-channel-action" href={notice.url} target="_blank" rel="noopener noreferrer"
          onClick={(event) => {
            if (notice.tabId) {
              event.preventDefault();
              Channel.send('__session_focus_tab', { tabId: notice.tabId, fallbackUrl: notice.url });
            }
          }}>
          {notice.linkText}<span aria-hidden="true">↗</span>
        </a>
      </div>
    </div>
  );
}
