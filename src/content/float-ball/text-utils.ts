/**
 * 悬浮胶囊 — 文本处理纯函数
 *
 * 从 initFloatBall 闭包中提取的纯函数，不依赖任何闭包状态变量。
 */

import type { RuntimeTextMode } from './constants';
import { INTERNAL_STATUS_HINT, INTERNAL_STATUS_LINE_HINT, INTERNAL_STATUS_SEGMENT_HINT } from './constants';
import { FUNCTION_LABELS } from './icons';

/** 将内部工具术语替换为用户可读文本 */
export const replaceInternalToolTerms = (raw: string): string => {
  return raw
    .replace(/(page_snapshot|page_viewer|fetch_url)/gi, '查看页面内容')
    .replace(/(page_action|js_execute|tab_navigate)/gi, '执行页面操作')
    .replace(/page_assert/gi, '确认操作结果')
    .replace(/screenshot/gi, '截图查看')
    .replace(/retry_action/gi, '重试操作')
    .replace(/replay_candidate/gi, '尝试备用方案')
    .replace(/observe/gi, '查看页面')
    .replace(/verify/gi, '确认结果')
    .replace(/repair/gi, '修复问题')
    .replace(/extract/gi, '提取信息')
    .replace(/finalize/gi, '整理结果');
};

/** 根据原始文本和模式推断用户友好的运行时描述 */
export const inferFriendlyRuntimeText = (raw: string, mode: RuntimeTextMode): string => {
  const text = replaceInternalToolTerms(String(raw || ''));
  const choose = (current: string, plan: string, done: string, issue: string, ask: string): string => {
    const map: Record<RuntimeTextMode, string> = { current, plan, done, issue, ask };
    return map[mode];
  };

  if (/(approval|补充信息|用户输入|确认|需要你|授权|审批)/i.test(text)) {
    return choose('我正在等待你补充必要信息', '接下来可能需要你补充一点信息', '我已拿到你补充的信息', '当前缺少必要信息，拿到后我会继续', '需要你补充一点信息，我收到后继续');
  }
  if (/(finalize|收口|整理最终|最终结果|最终回答|总结)/i.test(text)) {
    return choose('我正在整理最终结果', '接下来我会整理最终结果', '我已整理出结果', '结果正在整理中，稍后会给你', '暂时不需要你补充，我正在整理结果');
  }
  if (/(verify|确认结果|核验|断言|assert|确认刚才|是否成功)/i.test(text)) {
    return choose('我正在确认刚才的操作是否成功', '接下来我会确认刚才的操作结果', '我已确认关键结果', '刚才的结果还需要再确认一次', '暂时不需要你补充，我先确认结果');
  }
  if (/(repair|retry|重试|恢复|绕路|备用方案|replay|停滞|stagnation|失败)/i.test(text)) {
    return choose('我正在换一种方式继续推进', '接下来我会换一种方式继续尝试', '我已切换到新的处理路径', '刚才的尝试没有成功，我正在调整方案', '暂时不需要你补充，我先调整方案');
  }
  if (/(extract|提取|整理信息|汇总|归纳)/i.test(text)) {
    return choose('我正在提取关键信息并整理结果', '接下来我会提取关键信息并整理结果', '我已提取到关键信息', '信息还不够完整，我正在继续补齐', '暂时不需要你补充，我先整理信息');
  }
  if (/(page_action|js_execute|执行页面操作|点击|输入|填写|导航|act|execute)/i.test(text)) {
    return choose('我正在页面里执行关键操作', '接下来我会继续执行页面操作', '我已完成一个页面操作', '页面操作没有完全成功，我正在重试', '暂时不需要你补充，我先继续操作');
  }
  if (/(page_snapshot|page_viewer|fetch_url|查看页面|观察|定位|证据|线索|explore|observe)/i.test(text)) {
    return choose('我正在查看页面内容并确认线索', '接下来我会先查看页面内容并确认线索', '我已确认一批页面线索', '线索还不够清晰，我正在继续查看页面', '暂时不需要你补充，我先继续查看页面');
  }
  if (/(规划|分析问题|理解需求|plan|步骤)/i.test(text)) {
    return choose('我正在理解你的需求并安排执行路径', '接下来我会先理清执行路径', '我已理清下一步方向', '当前方向还需要再调整一下', '如果需要我会向你确认少量信息');
  }

  return choose('我正在继续处理，请稍候...', '接下来我会继续推进', '我已完成一个关键步骤', '当前遇到一点问题，我正在继续处理', '暂时不需要你补充信息');
};

/** 清理并转换面向用户的运行时文本，过滤内部术语 */
export const sanitizeUserFacingRuntimeText = (raw: unknown, mode: RuntimeTextMode, fallback?: string): string => {
  const baseFallback = fallback || inferFriendlyRuntimeText('', mode);
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return baseFallback;

  if (/(你现在扮演|当前扮演|子代理|代理角色|目标[:：]|优先使用|执行约束|当前优先子目标|下一步优先|本轮首选|严格按当前策略推进|聚焦当前子目标|tool_choice|function_call(?:_output)?|router|post_tool_)/i.test(text)) {
    return inferFriendlyRuntimeText(text, mode);
  }

  if (/(正文片段|html片段|selector|选择器|元素句柄|句柄[:：]|坐标|bbox|dom路径|outerhtml|innerhtml|innertext|ec-[a-z0-9-]+)/i.test(text)) {
    return inferFriendlyRuntimeText(text, mode);
  }

  if (/(任务未完成且超过重试上限|关键操作完成不足|重试上限|完成不足\s*\(\d+\/\d+\))/i.test(text)) {
    if (mode === 'issue') return '我卡在某个需要连续操作的步骤上，正在重新定位并换一种方式继续。';
    if (mode === 'current') return '我卡在一个需要连续完成的页面步骤上，正在重新尝试。';
    return inferFriendlyRuntimeText(text, mode);
  }

  if (/(点击.+选择|先点.+再选|下拉|选项|弹窗|菜单|展开)/i.test(text) && /(失败|未完成|卡住|不足|重试)/i.test(text)) {
    if (mode === 'issue') return '页面里有一个需要先点开再选择的步骤，我正在重新定位这个选项。';
    if (mode === 'current') return '我正在重新处理一个需要先点开再选择的页面步骤。';
  }

  const cleaned = replaceInternalToolTerms(text)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !INTERNAL_STATUS_LINE_HINT.test(line))
    .join(' ')
    .replace(/(?:不要反问用户|不要说"?如果你要.*?$|不要说"?如果你要.*?$)/gi, '')
    .replace(/(?:执行约束|当前优先子目标|下一步优先|本轮首选|依据|目标)[:：][^。；]*[。；]?/gi, '')
    .replace(/(?:工具已执行完毕|严格按当前策略推进|聚焦当前子目标)[^。；]*[。；]?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return inferFriendlyRuntimeText(text, mode);
  if (INTERNAL_STATUS_HINT.test(cleaned) || INTERNAL_STATUS_SEGMENT_HINT.test(cleaned)) {
    return inferFriendlyRuntimeText(text, mode);
  }

  if (mode === 'plan') {
    return cleaned
      .replace(/^我正在/, '接下来我会')
      .replace(/^正在/, '接下来会');
  }
  if (mode === 'done') {
    if (/^(我已|已)/.test(cleaned)) return cleaned;
    if (/^(找到|确认|提取|整理|定位|查看|执行|完成)/.test(cleaned)) return `已${cleaned}`;
    return `我已完成：${cleaned}`;
  }
  return cleaned;
};

/** 将规划文本转换为友好的用户可见文本 */
export const toFriendlyPlanningText = (raw: string): string => {
  const text = String(raw || '').trim();
  if (!text) return '正在处理，请稍候...';
  if (/已规划\s*\d+\s*个步骤/.test(text)) return '我已开始执行，请稍候...';
  if (/分析问题/.test(text)) return '我正在理解你的需求...';
  return sanitizeUserFacingRuntimeText(text, 'current', '我正在继续处理，请稍候...');
};

/** 判断文本是否为通用的"正在思考"描述 */
export const isGenericThinkingText = (raw: unknown): boolean => {
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!text) return true;
  return /(AI\s*)?(正在思考|思考中|分析中|处理中)(\.\.\.|…)?$/i.test(text)
    || /(AI\s*)?正在思考/i.test(text);
};

/** 根据工具名和摘要生成实时操作描述 */
export const toLiveActionText = (toolName: string, summary?: string): string => {
  const text = String(summary || '').replace(/\s+/g, ' ').trim();
  if (text) {
    if (/(元素句柄|ec-[a-z0-9-]+|selector|选择器|bbox|坐标|dom路径|outerhtml|innerhtml|innertext)/i.test(text)) {
      if (/点击/.test(text)) return '我正在尝试点击目标位置';
      if (/读取|获取|查看/.test(text)) return '我正在读取页面上的元素信息';
      return '我正在定位页面上的目标元素';
    }
    if (/点击/.test(text)) return '我正在点击页面上的目标位置';
    if (/输入|填写/.test(text)) return '我正在填写页面内容';
    if (/选择|下拉|选项|弹窗|菜单/.test(text)) return '我正在选择页面中的目标项';
    if (/读取|查看|抓取|获取/.test(text)) return '我正在查看页面内容';
    if (/搜索|查找/.test(text)) return '我正在查找相关信息';
    if (/截图/.test(text)) return '我正在查看当前页面画面';
    if (/等待/.test(text)) return '我正在等待页面状态稳定';
  }

  if (toolName === 'page_action') return '我正在执行页面操作';
  if (toolName === 'dom_manipulate') return '我正在定位页面上的目标元素';
  if (toolName === 'page_viewer' || toolName === 'page_snapshot' || toolName === 'fetch_url') return '我正在查看页面内容';
  if (toolName === 'screenshot') return '我正在查看当前页面画面';
  if (toolName === 'tab_navigate') return '我正在切换页面继续处理';
  if (toolName === 'js_execute') return '我正在执行页面内的辅助操作';
  if (toolName === 'history_search') return '我正在查找相关信息';
  return '我正在继续处理';
};

/** 生成友好的工具进度文本 */
export const toFriendlyToolProgress = (count: number): string => {
  if (!Number.isFinite(count) || count <= 0) return '正在执行操作';
  return `正在执行 ${count} 项操作`;
};

/** 格式化最近任务的相对时间 */
export const formatRecentTaskTime = (updatedAt: number): string => {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return '刚刚';
  const diff = Math.max(0, Date.now() - updatedAt);
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))} 分钟前`;
  if (diff < 86_400_000) return `${Math.max(1, Math.floor(diff / 3_600_000))} 小时前`;
  return `${Math.max(1, Math.floor(diff / 86_400_000))} 天前`;
};

/** 获取最近任务的状态标签 */
export const getRecentTaskStatusLabel = (status: string): string => {
  if (status === 'done') return '已完成';
  if (status === 'error') return '已结束';
  if (status === 'cleared') return '已关闭';
  return '已处理';
};

/** 裁剪意图文本，超长时截断并加省略号 */
export const clipIntentText = (raw: unknown, max: number = 34): string => {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}...` : text;
};

/** 构建工具意图文本（委托给 toLiveActionText） */
export const buildToolIntentText = (toolName: string, summary?: string): string => {
  return toLiveActionText(toolName, summary);
};

/** 构建面向用户的操作摘要 */
export const buildUserFacingActionSummary = (toolName: string, summary?: string, fallbackLabel?: string): string => {
  const cleanSummary = String(summary || '').replace(/\s+/g, ' ').trim();
  if (cleanSummary) {
    if (/点击|提交|输入|填写|选择|打开|切换|搜索|查看|读取|截图|下载|复制|粘贴/.test(cleanSummary)) {
      return cleanSummary;
    }
    return `我已执行：${clipIntentText(cleanSummary, 42)}`;
  }
  if (toolName === 'page_snapshot' || toolName === 'page_viewer' || toolName === 'fetch_url') return '我已查看当前页面内容';
  if (toolName === 'page_action') return '我已在页面上尝试执行关键操作';
  if (toolName === 'dom_manipulate') return '我已查找页面上的相关元素';
  if (toolName === 'screenshot') return '我已记录当前页面画面';
  if (toolName === 'tab_navigate') return '我已切换到相关页面继续处理';
  if (toolName === 'js_execute') return '我已执行页面内的辅助操作';
  if (toolName === 'history_search') return '我已搜索相关信息';
  if (toolName === 'download_file') return '我已尝试下载所需文件';
  if (toolName === 'clipboard_ops') return '我已处理剪贴板内容';
  if (toolName === 'storage_kv') return '我已保存当前任务需要的数据';
  return fallbackLabel ? `我已完成：${fallbackLabel}` : '我已完成一步处理';
};

/** 格式化时间戳为 HH:MM 格式 */
export const formatClock = (ts?: number | null): string => {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
};

/** 格式化毫秒数为可读时长 */
export const formatDuration = (ms?: number | null): string => {
  if (!ms || ms <= 0) return '0秒';
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) return `${hours}小时${minutes}分`;
  if (minutes > 0) return `${minutes}分${seconds}秒`;
  return `${seconds}秒`;
};

/** 格式化队列延迟为可读文本 */
export const formatQueueLatency = (ms?: number | null): string => {
  if (!ms || ms <= 0) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

/** 格式化间隔毫秒数为可读文本 */
export const formatInterval = (ms: number): string => {
  if (ms >= 60000) return `${Math.round(ms / 60000)} 分钟`;
  if (ms >= 1000) return `${Math.round(ms / 1000)} 秒`;
  return `${ms} 毫秒`;
};

/** 裁剪运行时文本，超长时截断并加省略号 */
export const clipRuntimeText = (raw: unknown, max: number = 56): string => {
  const normalized = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
};

/** 构建任务标题，超长截断 */
export const buildTaskTitle = (raw?: string): string => {
  const text = (raw || '').replace(/\s+/g, ' ').trim();
  if (!text) return '未命名任务';
  return text.length > 42 ? `${text.slice(0, 42)}...` : text;
};
