import { CHANNEL_PLATFORMS, type ChannelPlatform } from './channel-platforms';

/** 渠道操作引导：只使用已知平台的固定链接。 */
export interface ToolLoginNotice {
  platform: ChannelPlatform;
  kind: 'login' | 'verification';
  title: string;
  message: string;
  url: string;
  linkText: string;
  tabId?: number;
  autoResume?: boolean;
  status?: 'waiting' | 'checking';
}

/** 其他工具结果不影响已有提示；同平台查询成功后清除提示。 */
export function updateToolLoginNotice(
  current: ToolLoginNotice | null | undefined,
  result: unknown,
): ToolLoginNotice | null | undefined {
  if (!result || typeof result !== 'object') return current;
  const event = result as Record<string, unknown>;
  if (event.name !== 'douyin_search_users') return current;
  if (event.status === 'ready') return null;
  if (event.status === 'waiting' || event.status === 'checking') {
    const checking = event.status === 'checking';
    const verification = event.kind === 'verification';
    return { platform: 'douyin', kind: verification ? 'verification' : 'login',
      title: checking ? '正在检查，成功后自动继续' : verification ? '完成验证后自动继续' : '登录后自动继续',
      message: checking ? '正在重新执行刚才的查询，已完成的进度会保留。'
        : `请在抖音页面${verification ? '完成安全验证' : '完成登录'}。Mole 检查通过后会自动继续原任务，无需重新发送指令。`,
      url: CHANNEL_PLATFORMS.douyin.homeUrl, linkText: verification ? '去完成验证' : '去登录',
      tabId: typeof event.tabId === 'number' && Number.isSafeInteger(event.tabId) && event.tabId > 0
        ? event.tabId : undefined,
      autoResume: true, status: event.status };
  }
  if (event.success === true) return null;
  if (event.success === false && event.code === 'E_VERIFICATION_REQUIRED') {
    return {
      platform: 'douyin',
      kind: 'verification',
      title: event.autoResume ? '完成验证后自动继续' : '完成验证后继续搜索',
      message: event.autoResume ? '请在原页面完成安全验证，Mole 检查通过后会自动继续原任务。' : '抖音需要确认是你本人操作。请在原页面完成安全验证，再回到这里重试。',
      url: CHANNEL_PLATFORMS.douyin.homeUrl,
      linkText: '去完成验证',
      tabId: typeof event.tabId === 'number' && Number.isSafeInteger(event.tabId) && event.tabId > 0
        ? event.tabId : undefined,
      autoResume: event.autoResume === true,
    };
  }
  if (event.success !== false || event.code !== 'E_AUTH_REQUIRED') return current;
  return {
    platform: 'douyin',
    kind: 'login',
    title: event.autoResume ? '登录后自动继续' : '登录后继续搜索',
    message: event.autoResume ? '请在抖音页面完成登录，Mole 检查通过后会自动继续原任务。' : '查询暂时被抖音拒绝，通常需要重新登录。完成登录后，回到这里重试。',
    url: CHANNEL_PLATFORMS.douyin.homeUrl,
    linkText: '去登录',
    tabId: typeof event.tabId === 'number' && Number.isSafeInteger(event.tabId) && event.tabId > 0
      ? event.tabId : undefined,
    autoResume: event.autoResume === true,
  };
}
