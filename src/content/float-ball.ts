/**
 * Mole 悬浮胶囊模块
 * 胶囊形态贴边微隐藏，hover 滑出露出快捷键提示
 * 点击或快捷键（⌘M / Ctrl+M）弹出全局搜索框
 * 搜索框接入 AI 对话，支持流式响应和函数调用状态展示
 * 使用 Shadow DOM 隔离样式
 */

import Channel from '../lib/channel';
import { SESSION_HISTORY_STORAGE_KEY } from '../session-history/constants';
import type { SessionHistoryRecord } from '../session-history/types';
import type {
  SessionReplayPayload,
  SessionOpQueueSnapshot,
  SessionSyncPayload,
  TaskLifecycleEventPayload,
  TurnLifecycleEventPayload,
} from '../ai/types';

// ============ 常量 ============

const STORAGE_KEY = 'mole_float_ball_pos';
const DISABLED_DOMAINS_KEY = 'mole_disabled_domains_v1';
const DRAG_THRESHOLD = 5;
const PILL_HEIGHT = 40;
const PILL_WIDTH = 164;
const PILL_COMPACT_WIDTH = 112;
const LOGO_SIZE = 24;
// 收起时保留完整图标可见（两侧一致）
const TUCK_OFFSET = 104;
const EDGE_MARGIN = 12;
const MAX_RECENT_COMPLETED_TASKS = 3;

type RuntimeTextMode = 'current' | 'plan' | 'done' | 'issue' | 'ask';

interface RecentCompletedTaskItem {
  sessionId: string;
  title: string;
  status: string;
  updatedAt: number;
}

// 平台检测
const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
const SHORTCUT_TEXT = isMac ? '⌘ M' : 'Ctrl M';

// 网页查看 logo（放大镜+页面）
const LOGO_PAGE_VIEWER = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><path d="M490.666667 384c-58.88 0-106.666667 47.786667-106.666667 106.666667s47.786667 106.666667 106.666667 106.666666 106.666667-47.786667 106.666666-106.666666-47.786667-106.666667-106.666666-106.666667zM853.333333 170.666667H170.666667c-47.146667 0-85.333333 38.186667-85.333334 85.333333v512c0 47.146667 38.186667 85.333333 85.333334 85.333333h682.666666c47.146667 0 85.333333-38.186667 85.333334-85.333333V256c0-47.146667-38.186667-85.333333-85.333334-85.333333z m-136.746666 606.08l-123.946667-123.946667c-29.653333 18.773333-64.426667 29.866667-101.973333 29.866667a192 192 0 1 1 192-192c0 37.546667-11.093333 72.32-29.866667 101.76l124.16 123.733333-60.373333 60.586667z" fill="#0071e3"/></svg>')}`;

// 获取网页（地球）
const LOGO_FETCH_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>')}`;

// 标签页导航
const LOGO_TAB_NAVIGATE = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="14" rx="2"/><path d="M3 7l4-4h6l4 4"/><line x1="9" y1="3" x2="9" y2="7"/></svg>')}`;

// 页面操作（鼠标指针）
const LOGO_PAGE_ACTION = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#8b5cf6" stroke="none"><path d="M4 2l12 10.5-5.5 1 3.5 7-2.5 1.5-3.5-7L4 18V2z"/></svg>')}`;

// JS 执行（花括号）
const LOGO_JS_EXECUTE = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>')}`;

// 剪贴板
const LOGO_CLIPBOARD = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 1h6v4H9z"/><line x1="9" y1="10" x2="15" y2="10"/><line x1="9" y1="14" x2="15" y2="14"/></svg>')}`;

// 截图（相机）
const LOGO_SCREENSHOT = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#ec4899" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>')}`;

// 选中文本
const LOGO_SELECTION = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#14b8a6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/></svg>')}`;

// 键值存储
const LOGO_STORAGE = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>')}`;

// 延时任务（时钟）
const LOGO_TIMEOUT = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>')}`;

// 周期任务（时钟+循环）
const LOGO_INTERVAL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/><path d="M22.7 13.5a10 10 0 0 1-7.2 8.8"/><path d="M20 17l2.7-3.5L26 17"/></svg>')}`;

// 通知（铃铛）
const LOGO_NOTIFICATION = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>')}`;

// 收藏夹（星星）
const LOGO_BOOKMARK = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>')}`;

// 历史记录（时间回溯）
const LOGO_HISTORY = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>')}`;

// 下载（箭头向下）
const LOGO_DOWNLOAD = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>')}`;

// DOM 操作（树形结构）
const LOGO_DOM_MANIPULATE = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="7" height="5" rx="1"/><rect x="15" y="9" width="7" height="5" rx="1"/><rect x="15" y="17" width="7" height="5" rx="1"/><path d="M5.5 7v3.5a2 2 0 0 0 2 2H15"/><path d="M5.5 10.5V17a2 2 0 0 0 2 2H15"/></svg>')}`;

// 站点工作流（齿轮+闪电）
const LOGO_SITE_WORKFLOW = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>')}`;

// 页面骨架（树形结构）
const LOGO_PAGE_SKELETON = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="9" x2="9" y2="21"/></svg>')}`;

// CDP 输入（鼠标指针+闪电，红色，区别于 page_action 的紫色指针）
const LOGO_CDP_INPUT = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><path d="M4 2l10 8.5-4.5 0.5 2.5 5.5-2 1-2.5-5.5-3.5 2.5V2z" fill="#dc2626" stroke="none"/><path d="M17 3l-2 5h3l-4 7 1-4h-2.5l2.5-8z" fill="#f59e0b" stroke="none"/></svg>')}`;

// CDP 对话框（气泡图标，橙色）
const LOGO_CDP_DIALOG = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#ea580c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="9" y1="10" x2="9" y2="10"/><line x1="15" y1="10" x2="15" y2="10"/><circle cx="12" cy="10" r="1" fill="#ea580c" stroke="none"/></svg>')}`;

// CDP Frame（窗口/iframe 图标，青色）
const LOGO_CDP_FRAME = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#0891b2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="18" rx="2"/><line x1="2" y1="9" x2="22" y2="9"/><line x1="12" y1="9" x2="12" y2="21"/></svg>')}`;

// CDP 网络（信号波图标，蓝色）
const LOGO_CDP_NETWORK = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1" fill="#2563eb"/></svg>')}`;

// CDP 模拟（手机+桌面图标，紫色）
const LOGO_CDP_EMULATION = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12" y2="18"/></svg>')}`;

// CDP 控制台（终端图标，绿色）
const LOGO_CDP_CONSOLE = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>')}`;

// CDP 请求拦截（漏斗+闪电，玫红色）
const LOGO_CDP_FETCH = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#e11d48" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/><path d="M17 8l-2 4h2.5l-3 5" fill="none" stroke="#f59e0b" stroke-width="1.5"/></svg>')}`;

// CDP DOM 操作（节点树，深青色）
const LOGO_CDP_DOM = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#0d9488" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="4" r="2"/><circle cx="6" cy="12" r="2"/><circle cx="18" cy="12" r="2"/><circle cx="6" cy="20" r="2"/><circle cx="18" cy="20" r="2"/><line x1="12" y1="6" x2="6" y2="10"/><line x1="12" y1="6" x2="18" y2="10"/><line x1="6" y1="14" x2="6" y2="18"/><line x1="18" y1="14" x2="18" y2="18"/></svg>')}`;

// CDP 存储操作（数据库图标，琥珀色）
const LOGO_CDP_STORAGE = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>')}`;

// CDP CSS 样式（画刷图标，品红色）
const LOGO_CDP_CSS = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#c026d3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.5 4.5H18l-3.5 2.5L16 14.5 12 12l-4 2.5 1.5-4.5L6 7.5h4.5z" fill="none"/><rect x="4" y="17" width="16" height="4" rx="1"/></svg>')}`;

// CDP 高亮标注（靶心图标，石板蓝色）
const LOGO_CDP_OVERLAY = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>')}`;

// 函数图标映射（函数名 → logo）
const FUNCTION_ICONS: Record<string, string> = {
  page_viewer: LOGO_PAGE_VIEWER,
  fetch_url: LOGO_FETCH_URL,
  tab_navigate: LOGO_TAB_NAVIGATE,
  page_action: LOGO_PAGE_ACTION,
  js_execute: LOGO_JS_EXECUTE,
  clipboard_ops: LOGO_CLIPBOARD,
  screenshot: LOGO_SCREENSHOT,
  selection_context: LOGO_SELECTION,
  storage_kv: LOGO_STORAGE,
  timer: LOGO_TIMEOUT,
  notification: LOGO_NOTIFICATION,
  bookmark_ops: LOGO_BOOKMARK,
  history_search: LOGO_HISTORY,
  download_file: LOGO_DOWNLOAD,
  dom_manipulate: LOGO_DOM_MANIPULATE,
  resident_runtime: LOGO_INTERVAL,
  site_workflow: LOGO_SITE_WORKFLOW,
  page_skeleton: LOGO_PAGE_SKELETON,
  cdp_input: LOGO_CDP_INPUT,
  cdp_dialog: LOGO_CDP_DIALOG,
  cdp_frame: LOGO_CDP_FRAME,
  cdp_network: LOGO_CDP_NETWORK,
  cdp_emulation: LOGO_CDP_EMULATION,
  cdp_console: LOGO_CDP_CONSOLE,
  cdp_fetch: LOGO_CDP_FETCH,
  cdp_dom: LOGO_CDP_DOM,
  cdp_storage: LOGO_CDP_STORAGE,
  cdp_css: LOGO_CDP_CSS,
  cdp_overlay: LOGO_CDP_OVERLAY,
};

// 函数中文名映射（用户可见，不暴露英文标识）
const FUNCTION_LABELS: Record<string, string> = {
  page_viewer: '网页查看',
  fetch_url: '获取网页',
  tab_navigate: '标签页管理',
  page_action: '页面操作',
  js_execute: 'JS 执行',
  clipboard_ops: '剪贴板',
  screenshot: '页面截图',
  selection_context: '选中文本',
  storage_kv: '数据存储',
  timer: '定时器',
  notification: '发送通知',
  bookmark_ops: '收藏管理',
  history_search: '历史记录',
  download_file: '下载文件',
  dom_manipulate: 'DOM 操作',
  resident_runtime: '常驻运行',
  site_workflow: '站点流程',
  page_skeleton: '页面骨架',
  cdp_input: 'CDP 输入',
  cdp_dialog: '对话框处理',
  cdp_frame: 'iframe 穿透',
  cdp_network: '网络诊断',
  cdp_emulation: '设备模拟',
  cdp_console: '控制台捕获',
  cdp_fetch: '请求拦截',
  cdp_dom: 'DOM 深度操作',
  cdp_storage: '页面存储',
  cdp_css: 'CSS 样式',
  cdp_overlay: '元素高亮',
};
type Side = 'left' | 'right';

// ============ 样式 ============

const getStyles = () => `
  :host {
    all: initial;
    --ec-surface: rgba(255, 255, 255, 0.88);
    --ec-surface-strong: rgba(255, 255, 255, 0.96);
    --ec-surface-soft: rgba(255, 255, 255, 0.8);
    --ec-border: rgba(15, 23, 42, 0.09);
    --ec-border-soft: rgba(15, 23, 42, 0.05);
    --ec-text: #1d1d1f;
    --ec-text-muted: #6e6e73;
    --ec-primary: #0071e3;
    --ec-primary-strong: #0066cc;
    --ec-primary-soft: rgba(0, 113, 227, 0.1);
    --ec-success: #248a3d;
    --ec-success-soft: rgba(36, 138, 61, 0.1);
    --ec-danger: #d70015;
    --ec-danger-soft: rgba(215, 0, 21, 0.1);
    --ec-focus-ring: 0 0 0 3px rgba(0, 113, 227, 0.16);
    --ec-shadow: 0 22px 56px rgba(15, 23, 42, 0.14), 0 8px 20px rgba(15, 23, 42, 0.08);
    --ec-pill-shadow: 0 8px 24px rgba(15, 23, 42, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.84);
    --ec-card-shadow: 0 8px 18px rgba(15, 23, 42, 0.1);
  }

  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    font-family: "SF Pro Text", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  }

  /* ---- 胶囊触发区域 ---- */
  .mole-trigger {
    position: absolute;
    z-index: 2147483647;
    width: ${PILL_WIDTH + 10}px;
    height: ${PILL_HEIGHT + 10}px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    pointer-events: none;
  }

  /* hover 桥接已移至 JS .hovering class 管理，不再需要 ::before 拦截 */

  .mole-pill {
    position: relative;
    isolation: isolate;
    overflow: hidden;
    width: ${PILL_COMPACT_WIDTH}px;
    height: ${PILL_HEIGHT}px;
    padding: 0 12px 0 9px;
    border-radius: 999px;
    border: 1px solid var(--ec-border);
    background: linear-gradient(180deg, var(--ec-surface-strong) 0%, var(--ec-surface) 100%);
    box-shadow: var(--ec-pill-shadow);
    backdrop-filter: blur(22px) saturate(180%);
    -webkit-backdrop-filter: blur(22px) saturate(180%);
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    user-select: none;
    -webkit-user-select: none;
    flex-shrink: 0;
    white-space: normal;
    pointer-events: auto;
    transition: transform 0.36s cubic-bezier(0.22, 1, 0.36, 1),
                width 0.28s cubic-bezier(0.22, 1, 0.36, 1),
                box-shadow 0.28s ease,
                border-color 0.28s ease;
  }

  .mole-pill::before {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(140deg, rgba(255, 255, 255, 0.92), rgba(255, 255, 255, 0.28) 42%, rgba(255, 255, 255, 0) 72%);
    pointer-events: none;
    z-index: 0;
  }

  .mole-pill::after {
    content: "";
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    background: radial-gradient(circle at 86% 50%, rgba(0, 113, 227, 0.12), rgba(0, 113, 227, 0));
    opacity: 0;
    transition: opacity 0.3s ease;
    pointer-events: none;
    z-index: 0;
  }

  .mole-trigger.side-right .mole-pill {
    transform: translateX(${TUCK_OFFSET}px);
  }

  .mole-trigger.side-left .mole-pill {
    transform: translateX(-${TUCK_OFFSET}px);
    flex-direction: row-reverse;
    padding: 0 9px 0 12px;
  }

  .mole-trigger.side-left .mole-pill-info {
    align-items: flex-end;
    text-align: right;
  }

  .mole-trigger.side-left .mole-pill::before {
    background: linear-gradient(220deg, rgba(255, 255, 255, 0.92), rgba(255, 255, 255, 0.28) 42%, rgba(255, 255, 255, 0) 72%);
  }

  .mole-trigger.side-left .mole-pill::after {
    background: radial-gradient(circle at 14% 50%, rgba(0, 113, 227, 0.12), rgba(0, 113, 227, 0));
  }

  .mole-trigger.task-running .mole-pill,
  .mole-trigger.task-done .mole-pill,
  .mole-trigger.task-error .mole-pill,
  .mole-trigger.announce .mole-pill {
    width: ${PILL_WIDTH}px;
    transform: translateX(0);
  }

  .mole-trigger.side-right.hovering:not(.task-running):not(.task-done):not(.task-error):not(.announce) .mole-pill,
  .mole-trigger.side-right.active:not(.task-running):not(.task-done):not(.task-error):not(.announce) .mole-pill {
    transform: translateX(${PILL_WIDTH - PILL_COMPACT_WIDTH}px);
    box-shadow: 0 14px 32px rgba(15, 23, 42, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.92);
  }

  .mole-trigger.side-left.hovering:not(.task-running):not(.task-done):not(.task-error):not(.announce) .mole-pill,
  .mole-trigger.side-left.active:not(.task-running):not(.task-done):not(.task-error):not(.announce) .mole-pill {
    transform: translateX(-${PILL_WIDTH - PILL_COMPACT_WIDTH}px);
    box-shadow: 0 14px 32px rgba(15, 23, 42, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.92);
  }

  .mole-trigger.hovering .mole-pill::after,
  .mole-trigger.active .mole-pill::after {
    opacity: 1;
  }

  .mole-trigger.dragging .mole-pill {
    transform: translateX(0) scale(1.03);
    box-shadow: 0 18px 36px rgba(15, 23, 42, 0.2);
    transition: none;
  }

  .mole-pill img {
    position: relative;
    z-index: 1;
    width: ${LOGO_SIZE}px;
    height: ${LOGO_SIZE}px;
    border-radius: 5px;
    pointer-events: none;
    user-select: none;
    -webkit-user-drag: none;
    flex-shrink: 0;
  }

  .mole-pill-info {
    position: relative;
    z-index: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 1px;
    flex: 1;
    overflow: hidden;
  }

  .mole-shortcut {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    font-weight: 600;
    color: var(--ec-text);
    letter-spacing: 0.2px;
    line-height: 1.15;
    white-space: nowrap;
    text-overflow: ellipsis;
    overflow: hidden;
    transition: color 0.2s ease;
  }

  .mole-shortcut:empty {
    display: none;
  }

  .mole-pill-meta {
    font-size: 10px;
    color: var(--ec-text-muted);
    line-height: 1.1;
    white-space: nowrap;
    text-overflow: ellipsis;
    overflow: hidden;
    transition: color 0.2s ease;
  }

  /* 胶囊任务状态 */
  .mole-task-dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: radial-gradient(circle, #fff 0%, var(--ec-primary) 60%);
    box-shadow: 0 0 0 3px var(--ec-primary-soft);
    animation: mole-pulse 1.2s ease-in-out infinite;
  }

  .mole-trigger.task-running .mole-pill {
    border-color: rgba(0, 113, 227, 0.26);
  }

  .mole-trigger.task-running .mole-pill-meta {
    color: var(--ec-primary-strong);
  }

  .mole-trigger.task-done .mole-shortcut {
    color: var(--ec-success);
  }

  .mole-trigger.task-done .mole-pill {
    border-color: rgba(36, 138, 61, 0.24);
  }

  .mole-trigger.task-done .mole-pill-meta {
    color: var(--ec-success);
  }

  .mole-trigger.task-error .mole-shortcut {
    color: var(--ec-danger);
  }

  .mole-trigger.task-error .mole-pill {
    border-color: rgba(215, 0, 21, 0.24);
  }

  .mole-trigger.task-error .mole-pill-meta {
    color: var(--ec-danger);
  }

  .mole-pill-notice {
    position: absolute;
    top: -34px;
    left: 50%;
    transform: translate(-50%, 8px) scale(0.96);
    background: var(--ec-surface-strong);
    border: 1px solid var(--ec-border-soft);
    box-shadow: 0 10px 20px rgba(15, 23, 42, 0.16);
    border-radius: 999px;
    padding: 4px 10px;
    font-size: 11px;
    color: var(--ec-text);
    max-width: 220px;
    white-space: nowrap;
    text-overflow: ellipsis;
    overflow: hidden;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease, transform 0.22s ease;
  }

  .mole-pill-notice.tone-success {
    border-color: rgba(36, 138, 61, 0.24);
    color: var(--ec-success);
  }

  .mole-pill-notice.tone-info {
    border-color: rgba(0, 113, 227, 0.24);
    color: var(--ec-primary-strong);
  }

  .mole-pill-notice.tone-error {
    border-color: rgba(215, 0, 21, 0.24);
    color: var(--ec-danger);
  }

  .mole-trigger::after {
    content: "";
    position: absolute;
    top: 100%;
    left: 50%;
    width: 56px;
    height: 18px;
    transform: translateX(-50%);
    z-index: 1;
  }

  .mole-trigger.side-right:not(.task-running):not(.task-done):not(.task-error):not(.announce)::after {
    left: calc(50% + ${PILL_WIDTH - PILL_COMPACT_WIDTH}px);
  }

  .mole-trigger.side-left:not(.task-running):not(.task-done):not(.task-error):not(.announce)::after {
    left: calc(50% - ${PILL_WIDTH - PILL_COMPACT_WIDTH}px);
  }

  .mole-trigger.notice-visible .mole-pill-notice {
    opacity: 1;
    transform: translate(-50%, 0) scale(1);
  }

  .mole-settings-btn {
    position: absolute;
    top: calc(100% + 8px);
    left: 50%;
    transform: translate(-50%, -4px);
    width: 30px;
    height: 30px;
    border-radius: 50%;
    border: 1px solid var(--ec-border);
    background: linear-gradient(180deg, var(--ec-surface-strong) 0%, var(--ec-surface) 100%);
    box-shadow: 0 10px 22px rgba(15, 23, 42, 0.16);
    color: var(--ec-text);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    pointer-events: none;
    cursor: pointer;
    transition: opacity 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
    z-index: 2;
  }

  .mole-trigger.side-right:not(.task-running):not(.task-done):not(.task-error):not(.announce) .mole-settings-btn {
    left: calc(50% + ${PILL_WIDTH - PILL_COMPACT_WIDTH}px);
  }

  .mole-trigger.side-left:not(.task-running):not(.task-done):not(.task-error):not(.announce) .mole-settings-btn {
    left: calc(50% - ${PILL_WIDTH - PILL_COMPACT_WIDTH}px);
  }

  .mole-settings-btn svg {
    width: 14px;
    height: 14px;
    stroke: currentColor;
    fill: none;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .mole-settings-btn:hover {
    transform: translate(-50%, -6px);
    box-shadow: 0 12px 24px rgba(15, 23, 42, 0.2);
  }

  .mole-settings-btn:focus-visible {
    box-shadow: var(--ec-focus-ring);
  }

  .mole-trigger.hovering .mole-settings-btn,
  .mole-trigger:focus-within .mole-settings-btn {
    opacity: 1;
    pointer-events: auto;
    transform: translate(-50%, 0);
  }

  .mole-trigger.dragging .mole-settings-btn {
    opacity: 0;
    pointer-events: none;
  }

  /* ---- 关闭按钮 ---- */
  .mole-close-btn {
    position: absolute;
    bottom: calc(100% + 8px);
    left: 50%;
    transform: translate(-50%, 4px);
    width: 30px;
    height: 30px;
    border-radius: 50%;
    border: 1px solid var(--ec-border);
    background: linear-gradient(180deg, var(--ec-surface-strong) 0%, var(--ec-surface) 100%);
    box-shadow: 0 10px 22px rgba(15, 23, 42, 0.16);
    color: var(--ec-text);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    pointer-events: none;
    cursor: pointer;
    transition: opacity 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
    z-index: 2;
  }

  .mole-trigger.side-right:not(.task-running):not(.task-done):not(.task-error):not(.announce) .mole-close-btn {
    left: calc(50% + ${PILL_WIDTH - PILL_COMPACT_WIDTH}px);
  }

  .mole-trigger.side-left:not(.task-running):not(.task-done):not(.task-error):not(.announce) .mole-close-btn {
    left: calc(50% - ${PILL_WIDTH - PILL_COMPACT_WIDTH}px);
  }

  .mole-close-btn svg {
    width: 14px;
    height: 14px;
    stroke: currentColor;
    fill: none;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .mole-close-btn:hover {
    transform: translate(-50%, 2px);
    box-shadow: 0 12px 24px rgba(15, 23, 42, 0.2);
  }

  .mole-close-btn:focus-visible {
    box-shadow: var(--ec-focus-ring);
  }

  .mole-trigger.hovering .mole-close-btn,
  .mole-trigger:focus-within .mole-close-btn {
    opacity: 1;
    pointer-events: auto;
    transform: translate(-50%, 0);
  }

  .mole-trigger.dragging .mole-close-btn {
    opacity: 0;
    pointer-events: none;
  }

  .mole-trigger.active .mole-close-btn {
    opacity: 0;
    pointer-events: none;
  }

  /* ---- 关闭菜单 ---- */
  .mole-close-menu {
    display: none;
    position: absolute;
    bottom: calc(100% + 44px);
    min-width: 180px;
    background: linear-gradient(180deg, var(--ec-surface-strong) 0%, var(--ec-surface) 100%);
    backdrop-filter: blur(22px) saturate(180%);
    -webkit-backdrop-filter: blur(22px) saturate(180%);
    border: 1px solid var(--ec-border);
    border-radius: 14px;
    box-shadow: 0 16px 40px rgba(15, 23, 42, 0.18);
    padding: 6px;
    z-index: 10;
    pointer-events: auto;
  }

  /* 右侧：菜单右对齐，向左展开，不会溢出屏幕右边 */
  .mole-trigger.side-right .mole-close-menu {
    right: 0;
  }

  /* 左侧：菜单左对齐，向右展开，不会溢出屏幕左边 */
  .mole-trigger.side-left .mole-close-menu {
    left: 0;
  }

  .mole-close-menu.visible {
    display: block;
  }

  .mole-close-menu-item {
    display: block;
    width: 100%;
    padding: 8px 12px;
    border: none;
    border-radius: 10px;
    background: transparent;
    color: var(--ec-text);
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    transition: background 0.15s ease;
    white-space: nowrap;
  }

  .mole-close-menu-item:hover {
    background: var(--ec-primary-soft);
    color: var(--ec-primary-strong);
  }

  .mole-trigger.side-right.booting .mole-pill {
    animation: mole-pill-enter-right 560ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .mole-trigger.side-left.booting .mole-pill {
    animation: mole-pill-enter-left 560ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .mole-trigger.side-right.snapping:not(.task-running):not(.announce) .mole-pill {
    animation: mole-pill-snap-right 480ms cubic-bezier(0.2, 1.18, 0.32, 1);
  }

  .mole-trigger.side-left.snapping:not(.task-running):not(.announce) .mole-pill {
    animation: mole-pill-snap-left 480ms cubic-bezier(0.2, 1.18, 0.32, 1);
  }

  /* 终止按钮 */
  .mole-stop-btn {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    border: 1px solid rgba(215, 0, 21, 0.18);
    outline: none;
    background: var(--ec-danger-soft);
    color: var(--ec-danger);
    border-radius: 9px;
    cursor: pointer;
    display: none;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    line-height: 1;
    transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease;
  }

  .mole-stop-btn:hover {
    transform: translateY(-1px);
    background: rgba(215, 0, 21, 0.12);
    border-color: rgba(215, 0, 21, 0.24);
  }

  .mole-stop-btn.visible {
    display: flex;
  }

  .mole-stop-btn:focus-visible,
  .mole-new-btn:focus-visible {
    box-shadow: var(--ec-focus-ring);
  }

  .mole-trigger.snapping {
    transition: left 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94),
                top 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  }

  /* ---- 遮罩层 ---- */
  .mole-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    z-index: 2147483646;
    background:
      radial-gradient(circle at 50% -12%, rgba(255, 255, 255, 0.58), rgba(255, 255, 255, 0) 45%),
      rgba(246, 248, 255, 0.46);
    backdrop-filter: blur(20px) saturate(130%);
    -webkit-backdrop-filter: blur(20px) saturate(130%);
    opacity: 0;
    transition: opacity 0.2s ease;
    pointer-events: none;

    /* 搜索框居中偏上 */
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 18vh;
  }

  .mole-overlay.visible {
    opacity: 1;
    pointer-events: auto;
  }

  /* ---- 搜索框容器 ---- */
  .mole-searchbox {
    position: relative;
    width: 580px;
    max-width: 90vw;
    background: linear-gradient(168deg, var(--ec-surface-strong) 0%, var(--ec-surface) 100%);
    backdrop-filter: blur(28px) saturate(160%);
    -webkit-backdrop-filter: blur(28px) saturate(160%);
    border: 1px solid var(--ec-border);
    border-radius: 24px;
    box-shadow: var(--ec-shadow);
    overflow: hidden;

    transform: scale(0.95) translateY(-10px);
    opacity: 0;
    transition: transform 0.25s cubic-bezier(0.34, 1.3, 0.64, 1),
                opacity 0.2s ease;
  }

  .mole-overlay.visible .mole-searchbox {
    transform: scale(1) translateY(0);
    opacity: 1;
  }

  .mole-searchbox.state-running {
    border-color: rgba(0, 113, 227, 0.2);
    box-shadow: 0 24px 64px rgba(15, 23, 42, 0.14), 0 0 0 1px rgba(0, 113, 227, 0.12);
  }

  .mole-searchbox.state-done {
    border-color: rgba(36, 138, 61, 0.2);
  }

  .mole-searchbox.state-error {
    border-color: rgba(215, 0, 21, 0.2);
    box-shadow: 0 24px 64px rgba(15, 23, 42, 0.14), 0 0 0 1px rgba(215, 0, 21, 0.1);
  }

  /* 输入行 */
  .mole-input-row {
    display: flex;
    align-items: center;
    margin: 12px 12px 8px;
    padding: 12px 14px;
    gap: 12px;
    border-radius: 13px;
    border: 1px solid var(--ec-border-soft);
    background: linear-gradient(170deg, var(--ec-surface-strong) 0%, var(--ec-surface-soft) 100%);
    transition: background-color 0.2s ease;
    border: none;
  }

  .mole-input-row:focus-within {
    border-color: var(--ec-border-soft);
    box-shadow: none;
  }

  .mole-input-icon {
    width: 22px;
    height: 22px;
    border-radius: 5px;
    flex-shrink: 0;
  }

  .mole-input {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    font-size: 16px;
    line-height: 1.5;
    color: var(--ec-text);
    caret-color: var(--ec-primary);
  }

  .mole-input::placeholder {
    color: var(--ec-text-muted);
    opacity: 0.78;
  }

  .mole-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .mole-input-hint {
    flex-shrink: 0;
    font-size: 12px;
    color: var(--ec-text-muted);
    padding: 3px 8px;
    border: 1px solid var(--ec-border-soft);
    background: var(--ec-primary-soft);
    border-radius: 7px;
    line-height: 1;
  }

  /* 分割线 */
  .mole-divider {
    height: 1px;
    background: linear-gradient(90deg, transparent, var(--ec-border-soft), transparent);
    margin: 0 12px;
  }

  /* ---- 结果展示区 ---- */
  .mole-result {
    display: none;
    max-height: 50vh;
    overflow-y: auto;
    padding: 14px 16px 16px;
    font-size: 15px;
    line-height: 1.72;
    letter-spacing: 0.01em;
    color: var(--ec-text);
    background: linear-gradient(180deg, rgba(255, 255, 255, 0) 0%, rgba(0, 113, 227, 0.02) 100%);
  }

  .mole-result.visible {
    display: block;
  }

  /* 状态指示 */
  .mole-status {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 8px 0;
    padding: 10px 12px;
    color: var(--ec-text);
    font-size: 13px;
    border-radius: 12px;
    border: 1px solid var(--ec-border-soft);
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.82), rgba(248, 250, 252, 0.92));
    box-shadow: 0 6px 18px rgba(15, 23, 42, 0.04);
  }

  .mole-status .dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--ec-primary);
    animation: mole-pulse 1.2s ease-in-out infinite;
  }

  /* 规划状态指示（与 thinking 类似，使用品牌蓝） */
  .mole-planning {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 8px 0;
    padding: 10px 12px;
    color: var(--ec-primary-strong);
    font-size: 13px;
    border-radius: 12px;
    border: 1px solid rgba(0, 113, 227, 0.14);
    background: linear-gradient(180deg, rgba(0, 113, 227, 0.08), rgba(255, 255, 255, 0.9));
    box-shadow: 0 8px 22px rgba(0, 113, 227, 0.06);
  }

  .mole-planning .dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--ec-primary-strong);
    animation: mole-pulse 1.2s ease-in-out infinite;
  }

  .mole-review-output {
    margin: 10px 0;
    border: 1px solid rgba(15, 23, 42, 0.08);
    border-radius: 12px;
    background: rgba(248, 250, 252, 0.85);
    padding: 10px 12px;
    color: var(--ec-text);
    font-size: 13px;
    line-height: 1.5;
  }

  .mole-review-summary {
    font-weight: 600;
    color: #0f172a;
    margin-bottom: 6px;
  }

  .mole-review-findings {
    margin: 0;
    padding-left: 18px;
  }

  .mole-review-findings li + li {
    margin-top: 6px;
  }

  .mole-review-priority {
    color: #b45309;
    font-weight: 700;
  }

  /* 调度状态机日志 */
  .mole-agent-state-panel {
    margin: 10px 0;
    border-radius: 14px;
    background: rgba(248, 250, 252, 0.92);
    overflow: hidden;
  }

  .mole-agent-state-title {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    padding: 10px 12px;
    font-size: 12px;
    color: var(--ec-primary-strong);
    background: rgba(0, 113, 227, 0.05);
    font-weight: 600;
    user-select: none;
    cursor: pointer;
    transition: background 0.18s ease;
  }

  .mole-agent-state-panel.is-live .mole-agent-state-title {
    background: rgba(0, 113, 227, 0.06);
  }

  .mole-agent-state-title-main {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-size: 11px;
    letter-spacing: 0.02em;
    color: var(--ec-text-soft);
  }

  .mole-agent-state-summary {
    min-width: 0;
    margin-left: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: normal;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    font-size: 13px;
    line-height: 1.5;
    color: var(--ec-text);
    font-weight: 600;
    padding: 8px 10px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.82);
  }

  .mole-agent-state-panel.is-live .mole-agent-state-summary::before {
    content: '';
    display: inline-block;
    width: 6px;
    height: 6px;
    margin-right: 6px;
    border-radius: 999px;
    background: rgba(0, 113, 227, 0.72);
    animation: mole-pulse 2.6s ease-in-out infinite;
    vertical-align: middle;
  }

  .mole-agent-state-ops-anchor {
    display: none;
    padding: 0 12px 12px;
  }

  .mole-agent-state-panel.open .mole-agent-state-ops-anchor {
    display: block;
  }

  .mole-agent-state-ops-anchor .mole-calls-group {
    margin: 0;
  }

  .mole-agent-state-title:hover {
    background: rgba(0, 113, 227, 0.08);
  }

  .mole-agent-state-title .arrow {
    font-size: 10px;
    transition: transform 0.2s ease;
  }

  .mole-agent-state-panel.open .mole-agent-state-title .arrow {
    transform: rotate(90deg);
  }

  .mole-agent-state-panel.open .mole-agent-state-summary {
    display: none;
  }

  .mole-agent-state-log {
    display: none;
    padding: 6px 12px;
  }

  .mole-agent-state-panel.open .mole-agent-state-log {
    display: block;
  }

  .mole-agent-state-item {
    font-size: 12px;
    color: var(--ec-text);
    line-height: 1.6;
    word-break: break-word;
  }

  .mole-agent-state-item + .mole-agent-state-item {
    margin-top: 4px;
  }

  .mole-task-runtime-board {
    display: none;
    gap: 8px;
    padding: 0 12px 12px;
    background: transparent;
  }

  .mole-agent-state-panel.open .mole-task-runtime-board {
    display: grid;
  }

  .mole-runtime-now {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.82);
    color: var(--ec-text);
    font-size: 13px;
    line-height: 1.5;
    font-weight: 600;
  }

  .mole-runtime-now-text {
    min-width: 0;
    flex: 1;
  }

  .mole-inline-loader {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .mole-inline-loader span {
    width: 4px;
    height: 4px;
    border-radius: 999px;
    background: rgba(0, 113, 227, 0.58);
    animation: mole-loader-fade 1.2s ease-in-out infinite;
  }

  .mole-inline-loader span:nth-child(2) {
    animation-delay: 0.16s;
  }

  .mole-inline-loader span:nth-child(3) {
    animation-delay: 0.32s;
  }

  .mole-task-runtime-step-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    margin-top: 7px;
    background: rgba(0, 113, 227, 0.22);
  }

  @keyframes mole-pulse {
    0%, 100% {
      opacity: 0.55;
      transform: scale(1);
    }
    50% {
      opacity: 0.9;
      transform: scale(1.03);
    }
  }

  @keyframes mole-loader-fade {
    0%, 80%, 100% { opacity: 0.24; transform: scale(1); }
    40% { opacity: 0.9; transform: scale(1.15); }
  }

  @keyframes mole-breathe {
    0%, 100% { transform: scale(1); opacity: 0.98; }
    50% { transform: scale(1.004); opacity: 1; }
  }

  @keyframes mole-pill-enter-right {
    0% {
      opacity: 0;
      transform: translateX(${TUCK_OFFSET + 16}px) scale(0.9);
    }
    65% {
      opacity: 1;
      transform: translateX(${TUCK_OFFSET - 4}px) scale(1.02);
    }
    100% {
      opacity: 1;
      transform: translateX(${TUCK_OFFSET}px) scale(1);
    }
  }

  @keyframes mole-pill-enter-left {
    0% {
      opacity: 0;
      transform: translateX(-${TUCK_OFFSET + 16}px) scale(0.9);
    }
    65% {
      opacity: 1;
      transform: translateX(-${TUCK_OFFSET - 4}px) scale(1.02);
    }
    100% {
      opacity: 1;
      transform: translateX(-${TUCK_OFFSET}px) scale(1);
    }
  }

  @keyframes mole-pill-snap-right {
    0% { transform: translateX(0) scale(1.02); }
    60% { transform: translateX(${TUCK_OFFSET + 10}px) scale(0.98); }
    100% { transform: translateX(${TUCK_OFFSET}px) scale(1); }
  }

  @keyframes mole-pill-snap-left {
    0% { transform: translateX(0) scale(1.02); }
    60% { transform: translateX(-${TUCK_OFFSET + 10}px) scale(0.98); }
    100% { transform: translateX(-${TUCK_OFFSET}px) scale(1); }
  }

  /* 函数调用标签 */
  .mole-func-tag {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 10px;
    margin: 4px 0;
    background: var(--ec-primary-soft);
    border: 1px solid rgba(0, 113, 227, 0.14);
    border-radius: 10px;
    font-size: 12px;
    color: var(--ec-primary-strong);
  }

  .mole-func-icon {
    width: 14px;
    height: 14px;
    border-radius: 3px;
    flex-shrink: 0;
  }

  /* ---- 函数调用折叠区 ---- */
  .mole-calls-group {
    margin: 4px 0 0;
  }

  .mole-calls-summary {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    background: rgba(0, 113, 227, 0.05);
    border-radius: 10px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    color: var(--ec-primary-strong);
    user-select: none;
    transition: background 0.15s ease;
  }

  .mole-calls-summary:hover {
    background: rgba(0, 113, 227, 0.08);
  }

  .mole-calls-summary .arrow {
    display: inline-block;
    font-size: 10px;
    transition: transform 0.2s ease;
  }

  .mole-calls-summary .arrow.open {
    transform: rotate(90deg);
  }

  .mole-calls-icons {
    display: flex;
    gap: 3px;
  }

  .mole-calls-icons img {
    width: 14px;
    height: 14px;
    border-radius: 3px;
  }

  .mole-calls-detail {
    display: none;
    padding: 8px 2px 0;
  }

  .mole-calls-detail.open {
    display: grid;
    gap: 4px;
  }

  .mole-calls-detail .mole-call-item {
    margin: 0;
  }

  .mole-call-header {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 10px;
    cursor: default;
    font-size: 12px;
    color: var(--ec-text);
    user-select: none;
    background: rgba(255, 255, 255, 0.78);
  }

  .mole-call-item.tone-status .mole-call-header {
    background: rgba(0, 113, 227, 0.04);
  }

  .mole-call-item.tone-action .mole-call-header {
    background: rgba(124, 58, 237, 0.05);
  }

  .mole-call-item.tone-issue .mole-call-header {
    background: rgba(217, 119, 6, 0.08);
  }

  .mole-call-item.tone-done .mole-call-header {
    background: rgba(22, 163, 74, 0.07);
  }

  .mole-call-header.has-body {
    cursor: pointer;
  }

  .mole-call-header .arrow {
    display: inline-block;
    font-size: 10px;
    transition: transform 0.2s ease;
  }

  .mole-call-header .arrow.open {
    transform: rotate(90deg);
  }

  .mole-call-status {
    margin-left: auto;
    font-size: 11px;
    padding-top: 1px;
    color: var(--ec-text-soft);
    flex-shrink: 0;
  }

  .mole-call-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .mole-call-title {
    line-height: 1.4;
    font-weight: 500;
    color: var(--ec-text);
  }

  .mole-call-intent {
    font-size: 11px;
    line-height: 1.35;
    color: var(--ec-text-muted);
    font-weight: 400;
    word-break: break-word;
  }

  .mole-call-body {
    display: none;
    padding: 6px 0 6px 24px;
  }

  .mole-call-body.open {
    display: block;
  }

  /* ---- 推荐卡片 ---- */
  .mole-rec-cards {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 10px 0 4px;
  }

  .mole-rec-card {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    background: linear-gradient(160deg, var(--ec-surface-soft) 0%, rgba(0, 113, 227, 0.05) 100%);
    border: 1px solid var(--ec-border-soft);
    border-radius: 14px;
    cursor: pointer;
    transition: all 0.15s ease;
    text-decoration: none;
    color: inherit;
  }

  .mole-rec-card:hover {
    background: linear-gradient(160deg, var(--ec-surface-strong) 0%, rgba(0, 113, 227, 0.09) 100%);
    border-color: rgba(0, 113, 227, 0.16);
    transform: translateY(-1px);
    box-shadow: var(--ec-card-shadow);
  }

  .mole-rec-card-body {
    flex: 1;
    min-width: 0;
  }

  .mole-rec-card-title {
    font-size: 13px;
    font-weight: 500;
    color: var(--ec-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .mole-rec-card-meta {
    font-size: 12px;
    color: var(--ec-text-muted);
    margin-top: 2px;
  }

  .mole-rec-card-price {
    color: var(--ec-danger);
    font-weight: 600;
  }

  .mole-rec-tag {
    flex-shrink: 0;
    padding: 2px 8px;
    background: var(--ec-primary-soft);
    color: var(--ec-primary-strong);
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
  }

  .mole-rec-arrow {
    flex-shrink: 0;
    color: var(--ec-text-muted);
    font-size: 16px;
    line-height: 1;
  }

  /* ---- 新对话按钮 ---- */
  .mole-new-btn {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    border: 1px solid var(--ec-border-soft);
    outline: none;
    background: var(--ec-primary-soft);
    color: var(--ec-primary-strong);
    border-radius: 9px;
    cursor: pointer;
    display: none;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    line-height: 1;
    transition: all 0.15s ease;
    padding: 0;
  }

  .mole-new-btn:hover {
    background: rgba(0, 113, 227, 0.12);
    color: var(--ec-primary-strong);
    border-color: rgba(0, 113, 227, 0.2);
    transform: translateY(-1px);
  }

  .mole-new-btn.visible {
    display: flex;
  }

  /* ---- 定位到任务页签按钮 ---- */
  .mole-focus-tab-btn {
    flex-shrink: 0;
    height: 26px;
    border: 1px solid rgba(0, 113, 227, 0.2);
    outline: none;
    background: var(--ec-primary-soft);
    color: var(--ec-primary-strong);
    border-radius: 13px;
    cursor: pointer;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    line-height: 1;
    transition: all 0.15s ease;
    padding: 0 10px;
    white-space: nowrap;
    pointer-events: auto;
  }
  .mole-focus-tab-btn:hover {
    background: rgba(0, 113, 227, 0.15);
    border-color: rgba(0, 113, 227, 0.3);
  }

  /* ---- 用户消息气泡 ---- */
  .mole-user-msg {
    margin: 12px 0 6px;
    padding: 8px 14px;
    background: var(--ec-primary-soft);
    border: 1px solid rgba(0, 113, 227, 0.2);
    border-radius: 14px 14px 6px 14px;
    font-size: 14px;
    color: var(--ec-text);
    max-width: 85%;
    margin-left: auto;
    word-break: break-word;
  }

  /* ---- 历史对话折叠 ---- */
  .mole-round-history {
    margin-bottom: 4px;
    border-bottom: 1px solid var(--ec-border-soft);
    padding-bottom: 4px;
  }
  .mole-round-summary {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 2px;
    cursor: pointer;
    font-size: 12px;
    color: var(--ec-text-muted);
    user-select: none;
  }
  .mole-round-summary:hover {
    color: var(--ec-text);
  }
  .mole-round-summary .arrow {
    font-size: 9px;
    transition: transform 0.2s;
    color: var(--ec-text-muted);
  }
  .mole-round-summary .arrow.open {
    transform: rotate(90deg);
  }
  .mole-round-preview {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }
  .mole-round-content {
    display: none;
    padding: 4px 0 2px;
  }
  .mole-round-content.open {
    display: block;
  }

  /* ---- 搜索结果卡片（带缩略图） ---- */
  .mole-result-card {
    display: flex;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid rgba(15, 23, 42, 0.06);
    border-radius: 14px;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.72), rgba(255, 255, 255, 0.48));
    transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
    cursor: pointer;
  }

  .mole-result-card:hover {
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(240, 247, 255, 0.72));
    border-color: rgba(0, 113, 227, 0.18);
    transform: translateY(-1px);
  }

  .mole-result-thumb {
    width: 58px;
    height: 58px;
    border-radius: 10px;
    object-fit: cover;
    flex-shrink: 0;
    background: rgba(148, 163, 184, 0.18);
    border: 1px solid rgba(15, 23, 42, 0.06);
  }

  .mole-result-body {
    flex: 1;
    min-width: 0;
  }

  /* AI 回复文本 */
  .mole-answer {
    margin: 8px 0 4px;
    padding: 12px 14px;
    border-radius: 16px;
    border: 1px solid rgba(15, 23, 42, 0.08);
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(250, 252, 255, 0.84));
    box-shadow: 0 8px 20px rgba(15, 23, 42, 0.08);
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 14px;
    line-height: 1.72;
  }

  .mole-answer p {
    margin: 0;
  }

  .mole-answer p + p {
    margin-top: 10px;
  }

  .mole-answer h3, .mole-answer h4, .mole-answer h5 {
    font-weight: 600;
    margin: 14px 0 6px;
    color: #111112;
  }

  .mole-answer h3 { font-size: 16px; letter-spacing: -0.01em; }
  .mole-answer h4 { font-size: 15px; letter-spacing: -0.01em; }

  .mole-answer ul, .mole-answer ol {
    padding-left: 20px;
    margin: 8px 0;
  }

  .mole-answer li {
    margin: 4px 0;
  }

  .mole-answer code {
    background: rgba(0, 113, 227, 0.1);
    border: 1px solid rgba(0, 113, 227, 0.12);
    padding: 1px 6px;
    border-radius: 6px;
    font-size: 12px;
    font-family: "SF Mono", Monaco, Consolas, monospace;
  }

  .mole-answer pre {
    margin: 10px 0 0;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid rgba(15, 23, 42, 0.1);
    background: rgba(15, 23, 42, 0.86);
    color: #f2f5f9;
    font-family: "SF Mono", Monaco, Consolas, monospace;
    font-size: 12px;
    line-height: 1.55;
    overflow-x: auto;
    white-space: pre;
  }

  .mole-answer pre code {
    border: 0;
    background: transparent;
    color: inherit;
    padding: 0;
  }

  .mole-answer blockquote {
    margin: 10px 0 0;
    padding: 8px 12px;
    border-left: 3px solid rgba(0, 113, 227, 0.45);
    border-radius: 0 10px 10px 0;
    background: rgba(0, 113, 227, 0.07);
    color: #314863;
  }

  .mole-answer strong {
    font-weight: 600;
    color: var(--ec-text);
  }

  .mole-answer a {
    color: var(--ec-primary-strong);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  /* 错误信息 */
  .mole-error {
    color: var(--ec-danger);
    padding: 4px 0;
    font-size: 13px;
  }

  /* ---- 搜索结果卡片 ---- */
  .mole-search-results {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .mole-result-title {
    font-size: 13px;
    font-weight: 500;
    color: var(--ec-primary-strong);
    text-decoration: none;
    display: -webkit-box;
    -webkit-line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
    line-height: 1.4;
  }

  .mole-result-title:hover {
    text-decoration: underline;
  }

  .mole-result-snippet {
    font-size: 12px;
    color: var(--ec-text-muted);
    margin-top: 4px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    line-height: 1.5;
  }

  .mole-result-source {
    font-size: 12px;
    color: var(--ec-text-muted);
    margin-top: 4px;
  }

  .mole-result-count {
    font-size: 12px;
    color: var(--ec-text-muted);
    padding: 4px 2px 10px;
  }

  /* 截图结果内联展示 */
  .mole-screenshot-section {
    margin: 8px 0;
    padding: 10px;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.86), rgba(245, 248, 255, 0.66));
    border-radius: 14px;
    border: 1px solid rgba(15, 23, 42, 0.08);
    box-shadow: 0 6px 16px rgba(15, 23, 42, 0.08);
  }
  .mole-screenshot-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 8px;
  }
  .mole-screenshot-meta {
    min-width: 0;
  }
  .mole-screenshot-label {
    font-size: 12px;
    color: #354b67;
    font-weight: 600;
    line-height: 1.4;
  }
  .mole-screenshot-sub {
    font-size: 11px;
    margin-top: 2px;
    color: var(--ec-text-muted);
    line-height: 1.4;
  }
  .mole-screenshot-open {
    flex-shrink: 0;
    border: 1px solid rgba(0, 113, 227, 0.2);
    background: rgba(0, 113, 227, 0.08);
    color: var(--ec-primary-strong);
    border-radius: 8px;
    height: 26px;
    padding: 0 10px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
  }
  .mole-screenshot-open:hover {
    background: rgba(0, 113, 227, 0.12);
  }
  .mole-verify-section,
  .mole-repair-section {
    margin: 8px 0;
    padding: 10px;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.86), rgba(245, 248, 255, 0.66));
    border-radius: 14px;
    border: 1px solid rgba(15, 23, 42, 0.08);
    box-shadow: 0 6px 16px rgba(15, 23, 42, 0.08);
  }
  .mole-verify-header,
  .mole-repair-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 8px;
  }
  .mole-verify-title,
  .mole-repair-title {
    font-size: 12px;
    color: #354b67;
    font-weight: 600;
    line-height: 1.4;
  }
  .mole-verify-badge,
  .mole-repair-badge {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 999px;
    font-weight: 600;
  }
  .mole-verify-badge.ok,
  .mole-repair-badge.ok {
    color: #166534;
    background: rgba(22, 101, 52, 0.1);
  }
  .mole-verify-badge.fail,
  .mole-repair-badge.fail {
    color: #b42318;
    background: rgba(180, 35, 24, 0.1);
  }
  .mole-verify-list,
  .mole-repair-list,
  .mole-repair-candidates {
    display: grid;
    gap: 6px;
  }
  .mole-verify-item,
  .mole-repair-item,
  .mole-repair-candidate {
    font-size: 12px;
    line-height: 1.5;
    color: var(--ec-text);
    padding: 7px 8px;
    background: rgba(255, 255, 255, 0.72);
    border-radius: 10px;
    border: 1px solid rgba(15, 23, 42, 0.06);
  }
  .mole-verify-item.fail {
    border-color: rgba(180, 35, 24, 0.18);
    background: rgba(255, 245, 245, 0.92);
  }
  .mole-repair-item-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .mole-verify-sub,
  .mole-repair-sub {
    font-size: 11px;
    margin-top: 2px;
    color: var(--ec-text-muted);
    line-height: 1.45;
  }
  .mole-screenshot-open:focus-visible {
    box-shadow: var(--ec-focus-ring);
    outline: none;
  }
  .mole-screenshot-img-wrap {
    position: relative;
  }
  .mole-screenshot-img {
    width: 100%;
    max-height: 240px;
    object-fit: cover;
    border-radius: 10px;
    cursor: pointer;
    border: 1px solid rgba(15, 23, 42, 0.08);
    transition: transform 0.2s ease, filter 0.2s ease;
  }
  .mole-screenshot-img:hover {
    transform: scale(1.01);
    filter: saturate(104%);
  }
  .mole-screenshot-hint {
    position: absolute;
    right: 8px;
    bottom: 8px;
    border-radius: 999px;
    padding: 3px 8px;
    font-size: 11px;
    color: #fff;
    background: rgba(15, 23, 42, 0.62);
    pointer-events: none;
  }
  .mole-screenshot-artifact {
    font-size: 12px;
    color: var(--ec-text-muted);
    border: 1px dashed rgba(15, 23, 42, 0.16);
    border-radius: 10px;
    padding: 8px 10px;
    background: rgba(255, 255, 255, 0.64);
    word-break: break-all;
  }

  .mole-image-viewer {
    position: absolute;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 26px;
    background: rgba(9, 12, 18, 0.78);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.18s ease;
    z-index: 2147483647;
  }

  .mole-image-viewer.open {
    opacity: 1;
    pointer-events: auto;
  }

  .mole-image-viewer-content {
    position: relative;
    width: min(920px, 100%);
    max-height: calc(100vh - 52px);
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: center;
  }

  .mole-image-viewer-stage {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
  }

  .mole-image-viewer-img {
    flex: 1;
    width: 100%;
    max-height: calc(100vh - 120px);
    border-radius: 14px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    box-shadow: 0 28px 62px rgba(0, 0, 0, 0.4);
    background: #fff;
    object-fit: contain;
  }

  .mole-image-viewer-nav {
    flex-shrink: 0;
    width: 38px;
    height: 38px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.24);
    background: rgba(15, 23, 42, 0.66);
    color: #fff;
    font-size: 18px;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .mole-image-viewer-nav:disabled {
    opacity: 0.32;
    cursor: not-allowed;
  }

  .mole-image-viewer-nav:not(:disabled):hover {
    background: rgba(15, 23, 42, 0.8);
  }

  .mole-image-viewer-nav:focus-visible,
  .mole-image-viewer-close:focus-visible {
    box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.22);
    outline: none;
  }

  .mole-image-viewer-meta {
    border-radius: 999px;
    padding: 6px 12px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.9);
    background: rgba(15, 23, 42, 0.52);
    border: 1px solid rgba(255, 255, 255, 0.16);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mole-image-viewer-close {
    position: absolute;
    top: -8px;
    right: -8px;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.24);
    background: rgba(15, 23, 42, 0.68);
    color: #fff;
    font-size: 18px;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .mole-image-viewer-close:hover {
    background: rgba(15, 23, 42, 0.86);
  }

  /* 底部提示区 */
  .mole-footer {
    padding: 12px 14px;
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--ec-text-muted);
    font-size: 13px;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.42) 0%, var(--ec-surface-soft) 100%);
    border-top: 1px solid var(--ec-border-soft);
  }

  .mole-footer-icon {
    font-size: 15px;
    color: var(--ec-primary-strong);
  }

  .mole-footer-text {
    min-width: 0;
    flex: 1;
    white-space: nowrap;
    text-overflow: ellipsis;
    overflow: hidden;
  }

  .mole-footer-time {
    margin-left: auto;
    font-size: 12px;
    color: var(--ec-text-muted);
    background: var(--ec-primary-soft);
    border: 1px solid rgba(0, 113, 227, 0.16);
    border-radius: 999px;
    padding: 3px 8px;
    white-space: nowrap;
  }

  .mole-footer-time:empty {
    display: none;
  }

  .mole-searchbox.state-running .mole-footer-time {
    background: var(--ec-primary-soft);
    border-color: rgba(0, 113, 227, 0.2);
    color: var(--ec-primary-strong);
  }

  .mole-searchbox.state-running .mole-footer-icon {
    animation: mole-breathe 1.4s ease-in-out infinite;
  }

  .mole-searchbox.state-done .mole-footer-icon {
    color: var(--ec-success);
  }

  .mole-searchbox.state-error .mole-footer-icon {
    color: var(--ec-danger);
  }

  .mole-searchbox.state-done .mole-footer-time {
    background: var(--ec-success-soft);
    border-color: rgba(36, 138, 61, 0.2);
    color: var(--ec-success);
  }

  .mole-searchbox.state-error .mole-footer-time {
    background: var(--ec-danger-soft);
    border-color: rgba(215, 0, 21, 0.2);
    color: var(--ec-danger);
  }

  /* 滚动条美化 */
  .mole-result::-webkit-scrollbar {
    width: 4px;
  }

  .mole-result::-webkit-scrollbar-track {
    background: transparent;
  }

  .mole-result::-webkit-scrollbar-thumb {
    background: rgba(0, 113, 227, 0.26);
    border-radius: 2px;
  }

  @media (max-width: 720px) {
    .mole-image-viewer {
      padding: 14px;
    }

    .mole-image-viewer-stage {
      gap: 8px;
    }

    .mole-image-viewer-nav {
      width: 34px;
      height: 34px;
      font-size: 16px;
    }
  }

  /* ===== Workflow 快捷操作卡片 ===== */

  .mole-workflow-hints {
    padding: 10px 14px 8px;
  }

  .mole-workflow-hints-title {
    font-size: 10px;
    color: #b0b0b4;
    margin-bottom: 6px;
    font-weight: 500;
    letter-spacing: 0.03em;
  }

  .mole-workflow-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .mole-workflow-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.04);
    border: none;
    cursor: pointer;
    transition: background 0.15s;
    font-size: 12px;
    line-height: 1.4;
    color: #636366;
  }

  .mole-workflow-chip:hover {
    background: rgba(0, 113, 227, 0.1);
    color: #0071e3;
  }

  .mole-workflow-chip:active {
    background: rgba(0, 113, 227, 0.16);
  }

  .mole-workflow-chip-label {
    font-weight: 500;
  }

  .mole-workflow-chip-desc {
    display: none;
  }

  @media (prefers-reduced-motion: reduce) {
    * {
      animation: none !important;
      transition: none !important;
    }
  }

  /* ===== 后台任务角标 ===== */

  .mole-bg-task-badge {
    position: absolute;
    top: 2px;
    left: 22px;
    min-width: 16px;
    height: 16px;
    border-radius: 999px;
    background: var(--ec-primary-strong);
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    line-height: 16px;
    text-align: center;
    padding: 0 4px;
    display: none;
    z-index: 2;
    pointer-events: none;
  }

  .mole-bg-task-badge.visible {
    display: block;
  }

  /* ===== 后台任务面板 ===== */

  .mole-bg-tasks-panel {
    display: none;
    padding: 6px 14px 8px;
  }

  .mole-bg-tasks-panel.visible {
    display: block;
  }

  .mole-bg-tasks-header {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--ec-text-muted);
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 8px;
    transition: background 0.15s;
    user-select: none;
  }

  .mole-bg-tasks-header:hover {
    background: rgba(0, 113, 227, 0.06);
  }

  .mole-bg-tasks-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 18px;
    min-width: 18px;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--ec-primary-soft);
    color: var(--ec-primary-strong);
    font-size: 11px;
    font-weight: 600;
  }

  .mole-bg-tasks-toggle {
    margin-left: auto;
    font-size: 10px;
    transition: transform 0.2s ease;
  }

  .mole-bg-tasks-panel.open .mole-bg-tasks-toggle {
    transform: rotate(90deg);
  }

  .mole-bg-tasks-list {
    display: none;
    gap: 4px;
    margin-top: 6px;
  }

  .mole-bg-tasks-panel.open .mole-bg-tasks-list {
    display: grid;
  }

  .mole-bg-task-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.7);
    transition: background 0.15s;
  }

  .mole-bg-task-item:hover {
    background: rgba(255, 255, 255, 0.9);
  }

  .mole-bg-task-icon {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
  }

  .mole-bg-task-icon img {
    width: 100%;
    height: 100%;
  }

  .mole-bg-task-info {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  .mole-bg-task-name {
    font-size: 12px;
    font-weight: 500;
    color: var(--ec-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .mole-bg-task-meta {
    font-size: 11px;
    color: var(--ec-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .mole-bg-task-close {
    width: 22px;
    height: 22px;
    border-radius: 7px;
    border: none;
    background: transparent;
    color: var(--ec-text-muted);
    font-size: 14px;
    line-height: 22px;
    text-align: center;
    cursor: pointer;
    opacity: 0;
    flex-shrink: 0;
    transition: opacity 0.15s, background 0.15s, color 0.15s;
    padding: 0;
  }

  .mole-bg-task-item:hover .mole-bg-task-close {
    opacity: 1;
  }

  .mole-bg-task-close:hover {
    background: var(--ec-danger-soft);
    color: var(--ec-danger);
  }

  /* ===== 工作流录制 ===== */

  /* 录制按钮 - 放在 footer 中 */
  .mole-recorder-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-left: auto;
    padding: 4px 10px;
    border: 1px solid var(--ec-border-soft);
    border-radius: 999px;
    background: transparent;
    color: var(--ec-text-muted);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
  }
  .mole-recorder-btn:hover {
    background: rgba(215, 0, 21, 0.06);
    border-color: rgba(215, 0, 21, 0.18);
    color: var(--ec-danger);
  }
  .mole-recorder-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--ec-danger);
    flex-shrink: 0;
  }

  /* 录制中状态 - footer 录制状态栏 */
  .mole-recorder-bar {
    display: none;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    background: rgba(215, 0, 21, 0.04);
    border-top: 1px solid rgba(215, 0, 21, 0.12);
    font-size: 12px;
    color: var(--ec-text-secondary, var(--ec-text-muted));
  }
  .mole-recorder-bar.visible { display: flex; }
  .mole-recorder-bar-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--ec-danger);
    animation: mole-breathe 1.4s ease-in-out infinite;
    flex-shrink: 0;
  }
  .mole-recorder-bar-info { flex: 1; min-width: 0; }
  .mole-recorder-bar-stop {
    padding: 4px 12px;
    border: 1px solid rgba(215, 0, 21, 0.2);
    border-radius: 6px;
    background: transparent;
    color: var(--ec-danger);
    font-size: 12px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .mole-recorder-bar-stop:hover {
    background: rgba(215, 0, 21, 0.08);
  }

  /* 胶囊录制状态 */
  .mole-trigger.recording .mole-pill {
    border-color: rgba(215, 0, 21, 0.3);
  }
  .mole-trigger.recording .mole-pill::after {
    content: '';
    position: absolute;
    top: 4px;
    right: 4px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--ec-danger);
    animation: mole-breathe 1.4s ease-in-out infinite;
    opacity: 1;
    z-index: 2;
  }

  /* 结果标记遮罩 */
  .mole-result-mark-overlay {
    display: none;
    position: fixed;
    inset: 0;
    z-index: 2147483646;
    pointer-events: none;
  }
  .mole-result-mark-overlay.visible { display: block; }
  .mole-result-mark-bar {
    position: fixed;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2147483647;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 18px;
    border-radius: 12px;
    background: rgba(15, 23, 42, 0.88);
    color: rgba(255, 255, 255, 0.9);
    font-size: 13px;
    backdrop-filter: blur(12px);
    box-shadow: 0 4px 24px rgba(0,0,0,0.2);
    pointer-events: auto;
  }
  .mole-result-mark-skip {
    padding: 4px 12px;
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: 6px;
    background: transparent;
    color: rgba(255,255,255,0.8);
    font-size: 12px;
    cursor: pointer;
  }
  .mole-result-mark-skip:hover {
    background: rgba(255,255,255,0.1);
  }
`;

// ============ 位置存储 ============

interface SavedPosition {
  y: number;
  side: Side;
}

const savePosition = (pos: SavedPosition) => {
  try {
    chrome.storage.local.set({ [STORAGE_KEY]: pos });
  } catch { /* 忽略 */ }
};

const loadPosition = (): Promise<SavedPosition | null> => {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(STORAGE_KEY, (result) => {
        resolve(result[STORAGE_KEY] || null);
      });
    } catch {
      resolve(null);
    }
  });
};

// ============ 工具函数 ============

/** 获取可视区域宽度（排除滚动条） */
const getViewportWidth = (): number => document.documentElement.clientWidth;

const getTriggerX = (side: Side): number => {
  if (side === 'left') {
    return -(PILL_WIDTH + 10 - PILL_WIDTH) / 2;
  }
  return getViewportWidth() - PILL_WIDTH - (10 / 2);
};

const clampY = (y: number): number => {
  return Math.max(EDGE_MARGIN, Math.min(y, window.innerHeight - PILL_HEIGHT - EDGE_MARGIN));
};

const determineSide = (triggerX: number): Side => {
  const center = triggerX + (PILL_WIDTH + 10) / 2;
  return center < getViewportWidth() / 2 ? 'left' : 'right';
};

/** 内联 Markdown：加粗、斜体、行内代码、链接 */
const inlineMarkdown = (escaped: string): string => {
  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
};

/** Markdown 文本转 HTML（支持标题、列表、段落、内联格式） */
const markdownToHtml = (text: string): string => {
  const blocks = text.split(/\n{2,}/);
  let html = '';

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const lines = trimmed.split('\n');

    // 代码块
    const fenceMatch = trimmed.match(/^```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```$/);
    if (fenceMatch) {
      const language = (fenceMatch[1] || '').trim();
      const codeText = fenceMatch[2].replace(/\n$/, '');
      const langClass = language ? ` class="language-${escapeHtml(language)}"` : '';
      html += `<pre><code${langClass}>${escapeHtml(codeText)}</code></pre>`;
      continue;
    }

    // 标题
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const tag = `h${headingMatch[1].length + 2}`;
      html += `<${tag}>${inlineMarkdown(escapeHtml(headingMatch[2]))}</${tag}>`;
      continue;
    }

    // 引用
    if (lines.every((line) => line.trim().startsWith('>'))) {
      const quote = lines
        .map((line) => line.trim().replace(/^>\s?/, ''))
        .map((line) => inlineMarkdown(escapeHtml(line)))
        .join('<br>');
      html += `<blockquote>${quote}</blockquote>`;
      continue;
    }

    // 无序列表（支持混合普通行 + 列表项）
    if (lines.some(l => /^[-*]\s/.test(l.trim()))) {
      html += '<ul>' + lines
        .filter(l => /^[-*]\s/.test(l.trim()))
        .map(l => `<li>${inlineMarkdown(escapeHtml(l.trim().replace(/^[-*]\s+/, '')))}</li>`)
        .join('') + '</ul>';
      continue;
    }

    // 有序列表
    if (lines.some(l => /^\d+\.\s/.test(l.trim()))) {
      html += '<ol>' + lines
        .filter(l => /^\d+\.\s/.test(l.trim()))
        .map(l => `<li>${inlineMarkdown(escapeHtml(l.trim().replace(/^\d+\.\s+/, '')))}</li>`)
        .join('') + '</ol>';
      continue;
    }

    // 普通段落
    html += `<p>${inlineMarkdown(escapeHtml(trimmed).replace(/\n/g, '<br>'))}</p>`;
  }

  return html;
};

// ============ 初始化 ============

export const initFloatBall = async () => {
  if (!document.body) return;
  if (window.location.protocol === 'chrome:' || window.location.protocol === 'chrome-extension:') return;

  // 域名黑名单检查：如果当前域名已被用户禁用，则不初始化悬浮球
  try {
    const stored = await new Promise<Record<string, unknown>>(resolve => {
      chrome.storage.local.get(DISABLED_DOMAINS_KEY, resolve);
    });
    const disabledData = stored[DISABLED_DOMAINS_KEY] as { domains?: string[] } | undefined;
    if (disabledData && Array.isArray(disabledData.domains)) {
      if (disabledData.domains.includes(window.location.hostname)) {
        return;
      }
    }
  } catch {
    // 读取失败时不阻塞初始化
  }

  // Shadow DOM
  const host = document.createElement('div');
  host.id = 'mole-root';
  // 宿主元素固定定位 + 脱离文档流，避免页面滚动条和祖先 transform 影响内部 fixed 子元素
  host.style.cssText = 'position: fixed; top: 0; left: 0; width: 0; height: 0; overflow: visible; z-index: 2147483647; pointer-events: none;';
  const shadow = host.attachShadow({ mode: 'closed' });

  const styleEl = document.createElement('style');
  styleEl.textContent = getStyles();
  shadow.appendChild(styleEl);

  // ---- 胶囊触发器 ----
  const trigger = document.createElement('div');
  trigger.className = 'mole-trigger side-right';

  const pill = document.createElement('div');
  pill.className = 'mole-pill';

  const logo = document.createElement('img');
  logo.src = chrome.runtime.getURL('logo.png');
  logo.alt = 'Mole';
  logo.draggable = false;

  const shortcutEl = document.createElement('span');
  shortcutEl.className = 'mole-shortcut';
  shortcutEl.textContent = '';

  const pillMetaEl = document.createElement('span');
  pillMetaEl.className = 'mole-pill-meta';
  pillMetaEl.textContent = `${SHORTCUT_TEXT} 打开`;

  const pillInfoEl = document.createElement('div');
  pillInfoEl.className = 'mole-pill-info';
  pillInfoEl.appendChild(shortcutEl);
  pillInfoEl.appendChild(pillMetaEl);

  const pillNoticeEl = document.createElement('div');
  pillNoticeEl.className = 'mole-pill-notice';

  const settingsBtn = document.createElement('button');
  settingsBtn.className = 'mole-settings-btn';
  settingsBtn.type = 'button';
  settingsBtn.title = '打开设置';
  settingsBtn.setAttribute('aria-label', '打开设置');
  settingsBtn.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3"></circle>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.33 1V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-.33-1A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-.6-1 1.65 1.65 0 0 0-1-.33H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1-.33A1.65 1.65 0 0 0 4.6 8a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 8 4.6a1.65 1.65 0 0 0 1-.6 1.65 1.65 0 0 0 .33-1V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 .33 1 1.65 1.65 0 0 0 1 .6 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 8c0 .39.14.76.4 1.04.28.24.64.36 1 .33H21a2 2 0 1 1 0 4h-.09c-.36-.03-.72.09-1 .33-.26.28-.4.65-.4 1z"></path>
    </svg>
  `;

  pill.appendChild(logo);

  // 后台任务角标
  const bgTaskBadgeEl = document.createElement('span');
  bgTaskBadgeEl.className = 'mole-bg-task-badge';
  pill.appendChild(bgTaskBadgeEl);

  pill.appendChild(pillInfoEl);
  trigger.appendChild(pill);
  trigger.appendChild(pillNoticeEl);
  trigger.appendChild(settingsBtn);

  // ---- 关闭按钮 ----
  const closeBtn = document.createElement('button');
  closeBtn.className = 'mole-close-btn';
  closeBtn.type = 'button';
  closeBtn.title = '关闭悬浮球';
  closeBtn.setAttribute('aria-label', '关闭悬浮球');
  closeBtn.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  `;
  trigger.appendChild(closeBtn);

  // ---- 关闭菜单 ----
  const currentHostname = window.location.hostname;
  const closeMenuEl = document.createElement('div');
  closeMenuEl.className = 'mole-close-menu';

  const closeMenuItemCurrent = document.createElement('button');
  closeMenuItemCurrent.className = 'mole-close-menu-item';
  closeMenuItemCurrent.type = 'button';
  closeMenuItemCurrent.textContent = '仅当前关闭';

  const closeMenuItemDomain = document.createElement('button');
  closeMenuItemDomain.className = 'mole-close-menu-item';
  closeMenuItemDomain.type = 'button';
  closeMenuItemDomain.textContent = `在 ${currentHostname} 上禁用`;

  closeMenuEl.appendChild(closeMenuItemCurrent);
  closeMenuEl.appendChild(closeMenuItemDomain);
  trigger.appendChild(closeMenuEl);

  shadow.appendChild(trigger);

  // ---- 全局搜索框 ----
  const overlay = document.createElement('div');
  overlay.className = 'mole-overlay';

  const searchbox = document.createElement('div');
  searchbox.className = 'mole-searchbox state-idle';

  const logoUrl = chrome.runtime.getURL('logo.png');
  searchbox.innerHTML = `
    <div class="mole-input-row">
      <img class="mole-input-icon" src="${logoUrl}" alt="" />
      <input class="mole-input" type="text" placeholder="有什么想让我做的？" autocomplete="off" />
      <span class="mole-input-hint">ESC</span>
      <button class="mole-new-btn" title="新对话">+</button>
      <button class="mole-stop-btn" title="终止任务">■</button>
    </div>
    <div class="mole-divider"></div>
    <div class="mole-result"></div>
    <div class="mole-divider mole-divider-bottom"></div>
    <div class="mole-footer">
      <span class="mole-footer-icon">✦</span>
      <span class="mole-footer-text">Mole · AI 助手</span>
      <span class="mole-footer-time"></span>
      <button class="mole-recorder-btn" type="button" title="录制工作流">
        <span class="mole-recorder-dot"></span>录制
      </button>
    </div>
  `;

  overlay.appendChild(searchbox);

  const imageViewerEl = document.createElement('div');
  imageViewerEl.className = 'mole-image-viewer';
  imageViewerEl.innerHTML = `
    <div class="mole-image-viewer-content">
      <button class="mole-image-viewer-close" type="button" aria-label="关闭预览">\u00D7</button>
      <div class="mole-image-viewer-stage">
        <button class="mole-image-viewer-nav prev" type="button" aria-label="上一张">\u2039</button>
        <img class="mole-image-viewer-img" alt="截图预览" />
        <button class="mole-image-viewer-nav next" type="button" aria-label="下一张">\u203A</button>
      </div>
      <div class="mole-image-viewer-meta"></div>
    </div>
  `;
  overlay.appendChild(imageViewerEl);

  shadow.appendChild(overlay);

  const inputEl = searchbox.querySelector('.mole-input') as HTMLInputElement;
  const resultEl = searchbox.querySelector('.mole-result') as HTMLDivElement;
  const footerTextEl = searchbox.querySelector('.mole-footer-text') as HTMLSpanElement;
  const footerTimeEl = searchbox.querySelector('.mole-footer-time') as HTMLSpanElement;
  const dividerBottomEl = searchbox.querySelector('.mole-divider-bottom') as HTMLDivElement;

  // 后台任务面板（插入到 dividerBottom 之前）
  const bgTasksPanelEl = document.createElement('div');
  bgTasksPanelEl.className = 'mole-bg-tasks-panel';
  searchbox.insertBefore(bgTasksPanelEl, dividerBottomEl);

  // ---- 录制状态栏（插入到 footer 之前） ----
  const recorderBarEl = document.createElement('div');
  recorderBarEl.className = 'mole-recorder-bar';
  recorderBarEl.innerHTML = `
    <span class="mole-recorder-bar-dot"></span>
    <span class="mole-recorder-bar-info">录制中 \u00B7 0 步</span>
    <button class="mole-recorder-bar-stop" type="button">停止录制</button>
  `;
  const footerEl = searchbox.querySelector('.mole-footer') as HTMLDivElement;
  searchbox.insertBefore(recorderBarEl, footerEl);

  // 录制按钮引用
  const recorderBtnEl = searchbox.querySelector('.mole-recorder-btn') as HTMLButtonElement;

  // ---- 结果标记遮罩（添加到 shadow DOM 根层级） ----
  const resultMarkOverlay = document.createElement('div');
  resultMarkOverlay.className = 'mole-result-mark-overlay';
  resultMarkOverlay.innerHTML = `
    <div class="mole-result-mark-bar">
      <span>点击页面元素作为流程结果，或</span>
      <button class="mole-result-mark-skip" type="button">跳过</button>
    </div>
  `;
  shadow.appendChild(resultMarkOverlay);

  const hintEl = searchbox.querySelector('.mole-input-hint') as HTMLSpanElement;
  const imageViewerCloseEl = imageViewerEl.querySelector('.mole-image-viewer-close') as HTMLButtonElement;
  const imageViewerImgEl = imageViewerEl.querySelector('.mole-image-viewer-img') as HTMLImageElement;
  const imageViewerMetaEl = imageViewerEl.querySelector('.mole-image-viewer-meta') as HTMLDivElement;
  const imageViewerPrevEl = imageViewerEl.querySelector('.mole-image-viewer-nav.prev') as HTMLButtonElement;
  const imageViewerNextEl = imageViewerEl.querySelector('.mole-image-viewer-nav.next') as HTMLButtonElement;
  const newBtn = searchbox.querySelector('.mole-new-btn') as HTMLButtonElement;
  const stopBtn = searchbox.querySelector('.mole-stop-btn') as HTMLButtonElement;

  // ---- "定位到任务页签" 按钮（非发起页签时显示） ----
  const focusTabBtn = document.createElement('button');
  focusTabBtn.className = 'mole-focus-tab-btn';
  focusTabBtn.type = 'button';
  focusTabBtn.title = '定位到任务页签';
  focusTabBtn.textContent = '定位到任务页签';
  focusTabBtn.style.display = 'none';
  // 插入到 input-row 中
  const inputRow = searchbox.querySelector('.mole-input-row');
  if (inputRow) inputRow.appendChild(focusTabBtn);

  focusTabBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (typeof sessionOriginTabId === 'number') {
      Channel.send('__session_focus_tab', { tabId: sessionOriginTabId });
    }
  });

  // ---- 插入页面 ----
  document.body.appendChild(host);

  // ---- DOM 保护：MutationObserver 兜底 ----
  // 当 host 元素被意外从 DOM 中移除时（如 AI 工具操作 innerHTML），自动重新插入
  // 用户主动关闭时设置标志位，不再自动恢复
  let userDismissed = false;
  const bodyObserver = new MutationObserver(() => {
    if (!host.isConnected && !userDismissed) {
      document.body.appendChild(host);
    }
  });
  bodyObserver.observe(document.body, { childList: true });

  // ---- 视口代理：修复 position: fixed 在祖先有 transform/will-change/filter 时失效 ----
  // 内部元素全部使用 position: absolute（相对于 host），
  // 通过 JS 持续将 host 补偿到视口原点 (0, 0)，确保在任何页面上都能正常固定显示
  let _compensateRAF = 0;
  const compensateHostPosition = () => {
    const rect = host.getBoundingClientRect();
    const offsetX = Math.round(rect.left);
    const offsetY = Math.round(rect.top);
    if (offsetX !== 0 || offsetY !== 0) {
      const curLeft = parseFloat(host.style.left) || 0;
      const curTop = parseFloat(host.style.top) || 0;
      host.style.left = `${curLeft - offsetX}px`;
      host.style.top = `${curTop - offsetY}px`;
    }
  };
  window.addEventListener('scroll', () => {
    cancelAnimationFrame(_compensateRAF);
    _compensateRAF = requestAnimationFrame(compensateHostPosition);
  }, { passive: true });
  // 首帧检测
  requestAnimationFrame(compensateHostPosition);

  // ---- 状态 ----
  interface TaskItem {
    id: string;           // sessionId（由 background 生成）
    activeRunId?: string | null;
    query: string;
    title: string;
    status: 'running' | 'done' | 'error';
    resultHtml: string;
    callStack: Array<{ funcName: string; icon: string; text: string; userSummary?: string }>;
    errorMsg: string;
    lastAIText: string;
    agentPhase: string;
    agentRound: number;
    liveStatusText?: string;
    failureCode: string;
    startedAt: number;
    endedAt: number | null;
    durationMs: number | null;
    taskKind?: string;
    opQueue?: SessionOpQueueSnapshot;
  }

  interface TabTakeoverState {
    active: boolean;
    label: string;
    expiresAt: number;
    source?: string;
    workflow?: string;
  }

  let isDragging = false;
  let isOpen = false;
  let currentTask: TaskItem | null = null;
  let recentCompletedTasks: RecentCompletedTaskItem[] = [];
  let side: Side = 'right';
  let currentY = 0;
  let startMouseX = 0;
  let startMouseY = 0;
  let startTriggerX = 0;
  let startTriggerY = 0;
  let pillNoticeTimer: number | null = null;
  let pillAnnounceTimer: number | null = null;
  let lastPillState: 'idle' | 'running' | 'done' | 'error' = 'idle';
  let lastPillTaskId = '';
  let isLegacyReplayMode = false;
  let replayActiveRunId: string | null = null;
  let replayActiveQuery = '';
  let replayKnownEventCount = 0;
  let replayAppliedEventCount = 0;
  let replayLastTimestamp = 0;
  let tabTakeoverState: TabTakeoverState | null = null;
  /** 本标签页的 tabId（通过 __get_tab_info 获取） */
  let selfTabId: number | null = null;
  /** 当前会话发起页签的 tabId（从 session_sync 中获取） */
  let sessionOriginTabId: number | undefined = undefined;
  /** 后台任务数据（定时器 + 常驻任务） */
  let bgTasksData: { timers: any[]; residentJobs: any[] } | null = null;

  // ---- 工作流录制状态 ----
  let isRecording = false;
  let recorderStepCount = 0;
  let recorderStartedAt = 0;
  let isResultMarking = false;

  // 初始化时获取自身 tabId
  Channel.send('__get_tab_info', {}, (tabInfo: any) => {
    if (tabInfo && typeof tabInfo.id === 'number') {
      selfTabId = tabInfo.id;
    }
  });

  const resetReplayCursor = () => {
    replayKnownEventCount = 0;
    replayAppliedEventCount = 0;
    replayLastTimestamp = 0;
  };

  /** 判断当前页签是否为非发起页签（需要限制交互） */
  const isNonOriginTab = (): boolean => {
    // originTabId 为 undefined 时不做限制（兼容旧会话）
    if (sessionOriginTabId === undefined) return false;
    // selfTabId 还没获取到时不做限制
    if (selfTabId === null) return false;
    return selfTabId !== sessionOriginTabId;
  };

  interface ReplayRunSnapshotItem {
    sessionId: string;
    runId: string;
    html: string;
    eventCount: number;
    lastTimestamp: number;
  }

  const MAX_REPLAY_RUN_CACHE = 8;
  const replayRunSnapshotCache = new Map<string, ReplayRunSnapshotItem>();
  let replayCacheSessionId = '';

  const ensureReplayCacheSession = (sessionId: string) => {
    if (!sessionId) return;
    if (replayCacheSessionId === sessionId) return;
    replayRunSnapshotCache.clear();
    replayCacheSessionId = sessionId;
  };

  const clearReplayCache = () => {
    replayRunSnapshotCache.clear();
    replayCacheSessionId = '';
  };

  const extractReplayPayloadRunId = (events: Array<{ type?: string; content?: string }>): string => {
    if (!Array.isArray(events) || events.length === 0) return '';
    for (let index = events.length - 1; index >= 0; index--) {
      const event = events[index];
      if (event?.type !== 'turn_started') continue;
      try {
        const parsed = JSON.parse(String(event.content || ''));
        const runId = typeof parsed?.runId === 'string' ? parsed.runId.trim() : '';
        if (runId) return runId;
      } catch {
        // ignore malformed payload
      }
    }
    for (let index = events.length - 1; index >= 0; index--) {
      const event = events[index];
      if (event?.type !== 'turn_completed' && event?.type !== 'turn_aborted') continue;
      try {
        const parsed = JSON.parse(String(event.content || ''));
        const runId = typeof parsed?.runId === 'string' ? parsed.runId.trim() : '';
        if (runId) return runId;
      } catch {
        // ignore malformed payload
      }
    }
    return '';
  };

  const storeReplayRunSnapshot = (runId: string | null | undefined, eventCount: number, lastTimestamp: number) => {
    if (!currentTask) return;
    const normalizedRunId = String(runId || '').trim();
    const html = resultEl.innerHTML;
    if (!normalizedRunId || !html) return;
    ensureReplayCacheSession(currentTask.id);
    replayRunSnapshotCache.set(normalizedRunId, {
      sessionId: currentTask.id,
      runId: normalizedRunId,
      html,
      eventCount: Math.max(0, eventCount),
      lastTimestamp: Math.max(0, lastTimestamp),
    });
    while (replayRunSnapshotCache.size > MAX_REPLAY_RUN_CACHE) {
      const oldestKey = replayRunSnapshotCache.keys().next().value;
      if (!oldestKey) break;
      replayRunSnapshotCache.delete(oldestKey);
    }
  };

  const tryApplyReplayRunSnapshot = (payload: SessionReplayPayload): boolean => {
    if (!currentTask) return false;
    if (payload.scope === 'delta') return false;
    const runId = extractReplayPayloadRunId(payload.events) || String(currentTask.activeRunId || '').trim();
    if (!runId) return false;
    ensureReplayCacheSession(currentTask.id);
    const cached = replayRunSnapshotCache.get(runId);
    if (!cached) return false;
    const payloadEnd = Math.max(0, Number(payload.fromEventCount || 0) + payload.events.length);
    const targetCount = Number.isFinite(Number(payload.eventCount))
      ? Math.max(payloadEnd, Math.max(0, Number(payload.eventCount)))
      : payloadEnd;
    const targetTimestamp = Number.isFinite(Number(payload.lastTimestamp))
      ? Math.max(0, Number(payload.lastTimestamp))
      : 0;
    if (targetCount > cached.eventCount) return false;
    if (targetTimestamp > 0 && targetTimestamp > cached.lastTimestamp) return false;

    resultEl.innerHTML = cached.html;
    currentTask.resultHtml = cached.html;
    currentTask.activeRunId = runId;
    showResult();
    replayAppliedEventCount = targetCount;
    replayKnownEventCount = Math.max(targetCount, replayKnownEventCount);
    replayLastTimestamp = targetTimestamp > 0
      ? targetTimestamp
      : Math.max(replayLastTimestamp, cached.lastTimestamp);
    return true;
  };

  const AGENT_PHASE_LABELS: Record<string, string> = {
    idle: '待机',
    plan: '规划',
    act: '执行',
    observe: '观察',
    verify: '校验',
    finalize: '完成',
  };
  const SHOW_AGENT_STATE_PANEL = false;
  const INTERNAL_STATUS_HINT =
    /(子代理切换|你现在扮演|当前扮演|round\s*\d+|post_tool_execution_verify|router_initial_route|offering_instead_of_doing|调用链|检查点|调度状态|当前轮次|执行约束|当前优先子目标|下一步优先|本轮首选|优先使用|严格按当前策略推进|工具已执行完毕|不要反问用户|不要说|代理角色|tool calls?|tool_choice|function_call(?:_output)?)/i;
  const INTERNAL_STATUS_LINE_HINT =
    /^(?:[-*]\s*|\d+\.\s*)?(?:你现在扮演|当前扮演|角色[:：]|目标[:：]|依据[:：]|优先使用|当前优先子目标|下一步优先|本轮首选|当前策略|执行约束|工具已执行完毕|不要反问用户|不要说|严格按当前策略推进|聚焦当前子目标|检查点|调用链|代理角色|子代理|router|round\s*\d+|tool_choice|function_call(?:_output)?)/i;
  const INTERNAL_STATUS_SEGMENT_HINT =
    /(你现在扮演|当前扮演|子代理|代理角色|router|tool_choice|function_call(?:_output)?|post_tool_|round\s*\d+|当前优先子目标|下一步优先|本轮首选|执行约束|不要反问用户|不要说|严格按当前策略推进|工具已执行完毕|聚焦当前子目标)/i;

  const openOptionsPage = () => {
    Channel.send('__open_options_page', {}, (response?: { success?: boolean }) => {
      if (response?.success) return;
      window.open(chrome.runtime.getURL('options.html'), '_blank');
    });
  };

  const buildTaskTitle = (raw?: string): string => {
    const text = (raw || '').replace(/\s+/g, ' ').trim();
    if (!text) return '未命名任务';
    return text.length > 42 ? `${text.slice(0, 42)}...` : text;
  };

  const getTaskTitle = (task: TaskItem | null): string => {
    if (!task) return '';
    return buildTaskTitle(task.title || task.query);
  };

  const isTakeoverActive = (): boolean => {
    if (!tabTakeoverState?.active) return false;
    if (tabTakeoverState.expiresAt <= Date.now()) {
      tabTakeoverState = null;
      return false;
    }
    return true;
  };

  const getTakeoverLabel = (): string => {
    if (!isTakeoverActive()) return '';
    return buildTaskTitle(tabTakeoverState?.label || 'AI 接管中');
  };

  const getTakeoverMetaText = (): string => {
    if (!isTakeoverActive()) return '';
    if (tabTakeoverState?.source === 'plan_execution') {
      return '当前页 AI 正在执行任务';
    }
    return '当前页由 AI 接管中';
  };

  const getTakeoverNoticeText = (): string => {
    const label = getTakeoverLabel();
    if (!label) return '';
    if (tabTakeoverState?.source === 'plan_execution') {
      return `${label} · 执行中`;
    }
    return `${label} · 已接管`;
  };


  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[SESSION_HISTORY_STORAGE_KEY]) return;
    loadRecentCompletedTasks();
  });

  const applyTakeoverStatePayload = (data: any): boolean => {
    if (!data || typeof data !== 'object') return false;
    const active = data.active !== false;
    if (!active) {
      const hadState = Boolean(tabTakeoverState);
      tabTakeoverState = null;
      return hadState;
    }
    const label = String(data.label || 'AI 接管中').trim() || 'AI 接管中';
    const ttlRaw = Number(data.expiresInMs);
    const ttlMs = Number.isFinite(ttlRaw)
      ? Math.max(5_000, Math.min(10 * 60_000, Math.floor(ttlRaw)))
      : 120_000;
    tabTakeoverState = {
      active: true,
      label,
      expiresAt: Date.now() + ttlMs,
      source: typeof data.source === 'string' ? data.source : undefined,
      workflow: typeof data.workflow === 'string' ? data.workflow : undefined,
    };
    return true;
  };

  const replaceInternalToolTerms = (raw: string): string => {
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

  const inferFriendlyRuntimeText = (raw: string, mode: RuntimeTextMode): string => {
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

  const sanitizeUserFacingRuntimeText = (raw: unknown, mode: RuntimeTextMode, fallback?: string): string => {
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
      .replace(/(?:不要反问用户|不要说“?如果你要.*?$|不要说"?如果你要.*?$)/gi, '')
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

  const toFriendlyPlanningText = (raw: string): string => {
    const text = String(raw || '').trim();
    if (!text) return '正在处理，请稍候...';
    if (/已规划\s*\d+\s*个步骤/.test(text)) return '我已开始执行，请稍候...';
    if (/分析问题/.test(text)) return '我正在理解你的需求...';
    return sanitizeUserFacingRuntimeText(text, 'current', '我正在继续处理，请稍候...');
  };

  const isGenericThinkingText = (raw: unknown): boolean => {
    const text = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!text) return true;
    return /(AI\s*)?(正在思考|思考中|分析中|处理中)(\.\.\.|…)?$/i.test(text)
      || /(AI\s*)?正在思考/i.test(text);
  };

  const toLiveActionText = (toolName: string, summary?: string): string => {
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

  const toFriendlyToolProgress = (count: number): string => {
    if (!Number.isFinite(count) || count <= 0) return '正在执行操作';
    return `正在执行 ${count} 项操作`;
  };

  const formatRecentTaskTime = (updatedAt: number): string => {
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) return '刚刚';
    const diff = Math.max(0, Date.now() - updatedAt);
    if (diff < 60_000) return '刚刚';
    if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))} 分钟前`;
    if (diff < 86_400_000) return `${Math.max(1, Math.floor(diff / 3_600_000))} 小时前`;
    return `${Math.max(1, Math.floor(diff / 86_400_000))} 天前`;
  };

  const getRecentTaskStatusLabel = (status: string): string => {
    if (status === 'done') return '已完成';
    if (status === 'error') return '已结束';
    if (status === 'cleared') return '已关闭';
    return '已处理';
  };

  const loadRecentCompletedTasks = () => {
    chrome.storage.local.get(SESSION_HISTORY_STORAGE_KEY, (result) => {
      const historyRaw = result?.[SESSION_HISTORY_STORAGE_KEY];
      const history = Array.isArray(historyRaw) ? historyRaw as SessionHistoryRecord[] : [];
      recentCompletedTasks = history
        .filter((item) => item && typeof item === 'object' && item.status !== 'running')
        .map((item) => ({
          sessionId: String(item.sessionId || '').trim(),
          title: buildTaskTitle(item.summary || item.assistantReply || '历史任务'),
          status: String(item.status || 'done'),
          updatedAt: Number(item.updatedAt || item.endedAt || item.startedAt || 0),
        }))
        .filter((item) => item.sessionId && item.title)
        .slice(0, MAX_RECENT_COMPLETED_TASKS + 2);
      renderTaskRuntimeBoard();
    });
  };

  const parseTaskLifecycleContent = (rawContent: string): TaskLifecycleEventPayload => {
    try {
      const parsed = JSON.parse(rawContent);
      if (parsed && typeof parsed === 'object') {
        const message = typeof parsed.message === 'string'
          ? parsed.message
          : (isLegacyReplayMode && typeof parsed.text === 'string' ? parsed.text : '');
        const reviewOutput = parsed.reviewOutput && typeof parsed.reviewOutput === 'object'
          ? parsed.reviewOutput
          : (isLegacyReplayMode && parsed.review_output && typeof parsed.review_output === 'object'
            ? parsed.review_output
            : null);
        const compactSummary = typeof parsed.compactSummary === 'string'
          ? parsed.compactSummary
          : (isLegacyReplayMode && typeof parsed.compact_summary === 'string' ? parsed.compact_summary : '');
        const assistantReply = typeof parsed.assistantReply === 'string'
          ? parsed.assistantReply
          : (isLegacyReplayMode && typeof parsed.reply === 'string' ? parsed.reply : '');
        const failureCode = typeof parsed.failureCode === 'string' ? parsed.failureCode : '';
        const reason = typeof parsed.reason === 'string' ? parsed.reason : '';
        return {
          message,
          taskKind: typeof parsed.taskKind === 'string' ? parsed.taskKind : '',
          runId: typeof parsed.runId === 'string' ? parsed.runId : null,
          status: parsed.status === 'running' || parsed.status === 'done' || parsed.status === 'error' || parsed.status === 'cleared'
            ? parsed.status
            : 'running',
          phase: parsed.phase === 'entered' || parsed.phase === 'exited' ? parsed.phase : 'exited',
          timestamp: typeof parsed.timestamp === 'number' ? parsed.timestamp : Date.now(),
          reviewOutput,
          compactSummary,
          assistantReply,
          failureCode,
          reason,
        };
      }
    } catch {
      // ignore malformed payload
    }
    return {
      message: isLegacyReplayMode ? String(rawContent || '').trim() : '',
      taskKind: '',
      runId: null,
      status: 'running',
      phase: 'exited',
      timestamp: Date.now(),
      reviewOutput: null,
      compactSummary: '',
      assistantReply: '',
      failureCode: '',
      reason: '',
    };
  };

  const clipIntentText = (raw: unknown, max: number = 34): string => {
    const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return text.length > max ? `${text.slice(0, max)}...` : text;
  };

  const buildToolIntentText = (toolName: string, summary?: string): string => {
    return toLiveActionText(toolName, summary);
  };

  const buildUserFacingActionSummary = (toolName: string, summary?: string, fallbackLabel?: string): string => {
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

  const parseFunctionCallEvent = (raw: string): { name: string; summary: string; callId: string } => {
    try {
      const parsed = JSON.parse(raw || '{}');
      if (parsed && typeof parsed.name === 'string') {
        return {
          name: parsed.name,
          summary: clipIntentText(parsed.summary || ''),
          callId: typeof parsed.callId === 'string' ? parsed.callId : '',
        };
      }
    } catch {
      // legacy text payload fallback
    }

    if (!isLegacyReplayMode) {
      return {
        name: '',
        summary: '',
        callId: '',
      };
    }

    const funcMatch = String(raw || '').match(/正在调用\s+(\w+)/);
    return {
      name: funcMatch ? funcMatch[1] : '',
      summary: '',
      callId: '',
    };
  };

  const parseFunctionResultEvent = (raw: string): { callId: string; success: boolean; message: string; cancelled: boolean } => {
    try {
      const parsed = JSON.parse(raw || '{}');
      if (parsed && typeof parsed === 'object') {
        return {
          callId: typeof parsed.callId === 'string' ? parsed.callId : '',
          success: parsed.success !== false,
          message: typeof parsed.message === 'string' ? parsed.message : '',
          cancelled: parsed.cancelled === true,
        };
      }
    } catch {
      // fallback
    }
    if (!isLegacyReplayMode) {
      return {
        callId: '',
        success: false,
        message: '',
        cancelled: false,
      };
    }

    return {
      callId: '',
      success: !String(raw || '').includes('出错'),
      message: String(raw || ''),
      cancelled: String(raw || '').includes('取消'),
    };
  };

  const parseTurnLifecycleEvent = (
    raw: string,
    fallbackStatus: 'done' | 'error',
  ): TurnLifecycleEventPayload => {
    try {
      const parsed = JSON.parse(raw || '{}');
      if (parsed && typeof parsed === 'object') {
        const hasErrorHint = typeof parsed.failureCode === 'string'
          || typeof parsed.reason === 'string'
          || parsed.abortReason === 'interrupted'
          || parsed.abortReason === 'replaced';
        const status = parsed.status === 'done' || parsed.status === 'error' || parsed.status === 'running'
          ? parsed.status
          : (hasErrorHint ? 'error' : fallbackStatus);
        return {
          sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : undefined,
          runId: typeof parsed.runId === 'string' && parsed.runId.trim() ? parsed.runId : null,
          endedAt: typeof parsed.endedAt === 'number' ? parsed.endedAt : Date.now(),
          durationMs: typeof parsed.durationMs === 'number' ? parsed.durationMs : 0,
          taskKind: typeof parsed.taskKind === 'string' ? parsed.taskKind : undefined,
          status,
          failureCode: typeof parsed.failureCode === 'string' ? parsed.failureCode : undefined,
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
          lastAgentMessage: typeof parsed.lastAgentMessage === 'string' ? parsed.lastAgentMessage : undefined,
          abortReason: parsed.abortReason === 'interrupted' || parsed.abortReason === 'replaced'
            ? parsed.abortReason
            : undefined,
        };
      }
    } catch {
      // fallback
    }
    return {
      runId: null,
      endedAt: Date.now(),
      durationMs: 0,
      status: fallbackStatus,
    };
  };

  const bindActiveRun = (runId: string | null): boolean => {
    if (!runId) return true;
    if (currentTask?.activeRunId && runId !== currentTask.activeRunId) return false;
    if (currentTask && !currentTask.activeRunId) {
      currentTask.activeRunId = runId;
    }
    return true;
  };

  const resolveTurnDuration = (endedAt: number, durationMs: number): number => {
    if (durationMs > 0) return durationMs;
    return Math.max(0, endedAt - (currentTask?.startedAt || Date.now()));
  };

  const applyTurnLifecycleToTask = (lifecycle: TurnLifecycleEventPayload): { ignored: boolean; isError: boolean } => {
    const task = currentTask;
    if (!task) return { ignored: true, isError: false };
    if (!bindActiveRun(lifecycle.runId)) {
      return { ignored: true, isError: false };
    }
    const isError = lifecycle.status === 'error';
    task.status = isError ? 'error' : 'done';
    if (isError) {
      task.failureCode = lifecycle.failureCode || task.failureCode || 'E_UNKNOWN';
      task.errorMsg = lifecycle.reason || task.errorMsg || '当前处理已结束';
    } else {
      const reply = (lifecycle.lastAgentMessage || '').trim();
      if (reply) {
        task.lastAIText = reply;
      }
    }
    task.endedAt = lifecycle.endedAt || Date.now();
    task.durationMs = resolveTurnDuration(task.endedAt, lifecycle.durationMs);
    return { ignored: false, isError };
  };

  const applyTaskLifecycleToTask = (lifecycle: TaskLifecycleEventPayload): boolean => {
    const task = currentTask;
    if (!task) return false;
    if (!bindActiveRun(lifecycle.runId)) return false;
    if (lifecycle.taskKind) {
      task.taskKind = lifecycle.taskKind;
    }
    if (lifecycle.status === 'error') {
      task.status = 'error';
      if (lifecycle.failureCode) task.failureCode = lifecycle.failureCode;
      if (lifecycle.reason) task.errorMsg = lifecycle.reason;
    }
    if ((lifecycle.compactSummary || '').trim()) {
      task.lastAIText = lifecycle.compactSummary!.trim();
    }
    if ((lifecycle.assistantReply || '').trim()) {
      task.lastAIText = lifecycle.assistantReply!.trim();
    }
    return true;
  };

  interface ScreenshotPreviewItem {
    src: string;
    meta: string;
  }

  let screenshotPreviewList: ScreenshotPreviewItem[] = [];
  let screenshotPreviewIndex = -1;

  const normalizeIncomingEventType = (rawType: string): string => {
    if (!isLegacyReplayMode) return rawType;
    const legacyTypeMap: Record<string, string> = {
      done: 'text',
      review_mode_started: 'entered_review_mode',
      review_mode_completed: 'exited_review_mode',
      compact_mode_completed: 'context_compacted',
    };
    return legacyTypeMap[rawType] || rawType;
  };

  const refreshImageViewerNav = () => {
    const hasMultiple = screenshotPreviewList.length > 1;
    imageViewerPrevEl.disabled = !hasMultiple;
    imageViewerNextEl.disabled = !hasMultiple;
    imageViewerPrevEl.style.visibility = hasMultiple ? 'visible' : 'hidden';
    imageViewerNextEl.style.visibility = hasMultiple ? 'visible' : 'hidden';
  };

  const renderImageViewer = () => {
    if (screenshotPreviewIndex < 0 || screenshotPreviewIndex >= screenshotPreviewList.length) {
      closeImageViewer();
      return;
    }

    const current = screenshotPreviewList[screenshotPreviewIndex];
    imageViewerImgEl.src = current.src;
    imageViewerMetaEl.textContent = screenshotPreviewList.length > 1
      ? `${current.meta} · ${screenshotPreviewIndex + 1}/${screenshotPreviewList.length}`
      : current.meta;
    refreshImageViewerNav();
    imageViewerEl.classList.add('open');
  };

  const previewNextImage = (step: number) => {
    if (screenshotPreviewList.length <= 1) return;
    const total = screenshotPreviewList.length;
    screenshotPreviewIndex = (screenshotPreviewIndex + step + total) % total;
    renderImageViewer();
  };

  const closeImageViewer = () => {
    imageViewerEl.classList.remove('open');
    imageViewerImgEl.removeAttribute('src');
    imageViewerMetaEl.textContent = '';
    screenshotPreviewList = [];
    screenshotPreviewIndex = -1;
  };

  const openImageViewer = (list: ScreenshotPreviewItem[], startIndex: number) => {
    if (!list.length) return;
    screenshotPreviewList = list;
    screenshotPreviewIndex = Math.max(0, Math.min(startIndex, list.length - 1));
    renderImageViewer();
  };

  imageViewerCloseEl.addEventListener('click', (event) => {
    event.preventDefault();
    closeImageViewer();
  });

  imageViewerPrevEl.addEventListener('click', (event) => {
    event.preventDefault();
    previewNextImage(-1);
  });

  imageViewerNextEl.addEventListener('click', (event) => {
    event.preventDefault();
    previewNextImage(1);
  });

  imageViewerEl.addEventListener('mousedown', (event) => {
    if (event.target === imageViewerEl) {
      closeImageViewer();
    }
  });

  // ---- 加载位置 ----
  const saved = await loadPosition();
  side = saved?.side || 'right';
  currentY = saved ? clampY(saved.y) : window.innerHeight - PILL_HEIGHT - 100;

  const applySideClass = () => {
    trigger.classList.remove('side-left', 'side-right');
    trigger.classList.add(`side-${side}`);
  };

  const applyPosition = () => {
    const x = getTriggerX(side);
    trigger.style.left = `${x}px`;
    trigger.style.top = `${currentY}px`;
    applySideClass();
  };

  applyPosition();
  trigger.classList.add('booting');
  window.setTimeout(() => trigger.classList.remove('booting'), 640);

  loadRecentCompletedTasks();

  const clearPillNotice = () => {
    trigger.classList.remove('notice-visible');
    pillNoticeEl.textContent = '';
    pillNoticeEl.className = 'mole-pill-notice';
  };

  const showPillNotice = (text: string, tone: 'success' | 'error' | 'info') => {
    if (!text) return;
    if (pillNoticeTimer) {
      window.clearTimeout(pillNoticeTimer);
      pillNoticeTimer = null;
    }
    if (pillAnnounceTimer) {
      window.clearTimeout(pillAnnounceTimer);
      pillAnnounceTimer = null;
    }
    pillNoticeEl.textContent = text;
    pillNoticeEl.className = `mole-pill-notice tone-${tone}`;
    trigger.classList.add('notice-visible', 'announce');
    pillNoticeTimer = window.setTimeout(() => {
      clearPillNotice();
      if (!isOpen && currentTask?.status !== 'running') {
        trigger.classList.remove('announce');
      }
      pillNoticeTimer = null;
    }, 3600);
    pillAnnounceTimer = window.setTimeout(() => {
      if (!isOpen && currentTask?.status !== 'running') {
        trigger.classList.remove('announce');
      }
      pillAnnounceTimer = null;
    }, 4200);
  };

  // ---- 胶囊状态更新 ----
  const updatePillState = () => {
    trigger.classList.remove('task-running', 'task-done', 'task-error');
    const state: 'idle' | 'running' | 'done' | 'error' = currentTask ? currentTask.status : 'idle';
    if (state === 'idle') {
      const takeoverLabel = getTakeoverLabel();
      if (takeoverLabel) {
        trigger.classList.add('task-running');
        shortcutEl.textContent = takeoverLabel;
        pillMetaEl.textContent = getTakeoverMetaText();
        clearPillNotice();
        trigger.classList.add('announce');
      } else {
        shortcutEl.textContent = '';
        pillMetaEl.textContent = `${SHORTCUT_TEXT} 打开`;
        if (!trigger.classList.contains('notice-visible')) {
          trigger.classList.remove('announce');
        }
      }
    } else if (state === 'running' && currentTask) {
      trigger.classList.add('task-running');
      const elapsed = Math.max(0, Date.now() - currentTask.startedAt);
      const liveProgress = clipRuntimeText(
        sanitizeUserFacingRuntimeText(currentTask.liveStatusText || '我正在继续处理，请稍候...', 'current'),
        18,
      );
      shortcutEl.textContent = liveProgress || getTaskTitle(currentTask);
      pillMetaEl.textContent = `已运行 ${formatDuration(elapsed)}`;
      clearPillNotice();
      trigger.classList.add('announce');
    } else if (state === 'done' && currentTask) {
      trigger.classList.add('task-done');
      const end = currentTask.endedAt;
      const duration = currentTask.durationMs ?? (end ? Math.max(0, end - currentTask.startedAt) : null);
      shortcutEl.textContent = getTaskTitle(currentTask);
      pillMetaEl.textContent = duration !== null ? `已完成 · 耗时 ${formatDuration(duration)}` : '已完成';
    } else if (state === 'error' && currentTask) {
      trigger.classList.add('task-error');
      shortcutEl.textContent = getTaskTitle(currentTask);
      pillMetaEl.textContent = currentTask.failureCode
        ? `处理异常 · ${currentTask.failureCode}`
        : '处理异常';
    }

    const taskId = currentTask?.id || '';
    if (lastPillState === 'running' && taskId === lastPillTaskId && currentTask) {
      if (state === 'done') {
        const duration = currentTask.durationMs
          ?? (currentTask.endedAt ? Math.max(0, currentTask.endedAt - currentTask.startedAt) : null);
        showPillNotice(
          duration !== null ? `已完成 · 耗时 ${formatDuration(duration)}` : '已完成',
          'success',
        );
      } else if (state === 'error') {
        showPillNotice(currentTask.failureCode ? `处理失败 · ${currentTask.failureCode}` : '处理失败', 'error');
      }
    }
    lastPillState = state;
    lastPillTaskId = taskId;
  };

  const formatClock = (ts?: number | null): string => {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  };

  const formatDuration = (ms?: number | null): string => {
    if (!ms || ms <= 0) return '0秒';
    const totalSec = Math.floor(ms / 1000);
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    if (hours > 0) return `${hours}小时${minutes}分`;
    if (minutes > 0) return `${minutes}分${seconds}秒`;
    return `${seconds}秒`;
  };

  const formatQueueLatency = (ms?: number | null): string => {
    if (!ms || ms <= 0) return '';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  /** 格式化间隔毫秒数为可读文本 */
  const formatInterval = (ms: number): string => {
    if (ms >= 60000) return `${Math.round(ms / 60000)} 分钟`;
    if (ms >= 1000) return `${Math.round(ms / 1000)} 秒`;
    return `${ms} 毫秒`;
  };

  // ---- 后台任务查询与面板渲染 ----

  /** 查询后台任务数据 */
  const queryBgTasks = () => {
    Channel.send('__bg_tasks_query', {}, (resp: any) => {
      bgTasksData = resp;
      updateBgTaskBadge();
      renderBgTasksPanel();
    });
  };

  /** 更新胶囊角标 */
  const updateBgTaskBadge = () => {
    const count = (bgTasksData?.timers?.length || 0) + (bgTasksData?.residentJobs?.length || 0);
    if (count > 0) {
      bgTaskBadgeEl.textContent = String(count);
      bgTaskBadgeEl.classList.add('visible');
    } else {
      bgTaskBadgeEl.classList.remove('visible');
    }
  };

  /** 渲染后台任务面板 */
  const renderBgTasksPanel = () => {
    const count = (bgTasksData?.timers?.length || 0) + (bgTasksData?.residentJobs?.length || 0);
    if (count === 0) {
      bgTasksPanelEl.classList.remove('visible');
      bgTasksPanelEl.innerHTML = '';
      return;
    }

    let html = '';

    // 头部
    html += `<div class="mole-bg-tasks-header">`;
    html += `<span class="mole-bg-tasks-title">后台任务</span>`;
    html += `<span class="mole-bg-tasks-count">${count}</span>`;
    html += `<span class="mole-bg-tasks-toggle">\u25B6</span>`;
    html += `</div>`;

    // 列表
    html += `<div class="mole-bg-tasks-list">`;

    // 定时器任务
    if (bgTasksData?.timers) {
      for (const t of bgTasksData.timers) {
        const icon = FUNCTION_ICONS['timer'] || '';
        const name = escapeHtml(String(t.action || '').slice(0, 40));
        let meta = '';
        if (t.type === 'timeout') {
          meta = `延时 \u00B7 将在 ${formatClock(t.nextRunAt)} 执行`;
        } else {
          meta = `周期 \u00B7 已执行 ${t.currentCount || 0} 次`;
          if (t.nextRunAt) {
            meta += ` \u00B7 下次 ${formatClock(t.nextRunAt)}`;
          }
        }
        html += `<div class="mole-bg-task-item" data-kind="timer" data-id="${escapeHtml(String(t.id))}">`;
        html += `<span class="mole-bg-task-icon">${icon ? `<img src="${icon}" alt="" />` : ''}</span>`;
        html += `<div class="mole-bg-task-info">`;
        html += `<span class="mole-bg-task-name">${name}</span>`;
        html += `<span class="mole-bg-task-meta">${escapeHtml(meta)}</span>`;
        html += `</div>`;
        html += `<button class="mole-bg-task-close" type="button" title="关闭">\u00D7</button>`;
        html += `</div>`;
      }
    }

    // 常驻任务
    if (bgTasksData?.residentJobs) {
      for (const j of bgTasksData.residentJobs) {
        const icon = FUNCTION_ICONS['resident_runtime'] || '';
        const name = escapeHtml(String(j.name || ''));
        let meta = `常驻 \u00B7 间隔 ${formatInterval(j.intervalMs || 0)}`;
        if (j.lastSuccess === true) {
          meta += ' \u00B7 上次成功';
        } else if (j.lastSuccess === false) {
          meta += ' \u00B7 上次失败';
        }
        html += `<div class="mole-bg-task-item" data-kind="resident" data-id="${escapeHtml(String(j.id))}">`;
        html += `<span class="mole-bg-task-icon">${icon ? `<img src="${icon}" alt="" />` : ''}</span>`;
        html += `<div class="mole-bg-task-info">`;
        html += `<span class="mole-bg-task-name">${name}</span>`;
        html += `<span class="mole-bg-task-meta">${escapeHtml(meta)}</span>`;
        html += `</div>`;
        html += `<button class="mole-bg-task-close" type="button" title="关闭">\u00D7</button>`;
        html += `</div>`;
      }
    }

    html += `</div>`;

    bgTasksPanelEl.innerHTML = html;
    bgTasksPanelEl.classList.add('visible');
  };

  // 后台任务面板事件委托（仅绑定一次，避免每次 render 累积监听器）
  bgTasksPanelEl.addEventListener('click', (e: Event) => {
    const target = e.target as HTMLElement;

    // 头部点击：折叠/展开
    if (target.closest('.mole-bg-tasks-header')) {
      bgTasksPanelEl.classList.toggle('open');
      return;
    }

    // 关闭按钮点击
    if (!target.classList.contains('mole-bg-task-close')) return;
    const item = target.closest('.mole-bg-task-item') as HTMLElement | null;
    if (!item) return;
    const kind = item.getAttribute('data-kind');
    const id = item.getAttribute('data-id');
    if (!kind || !id) return;
    Channel.send('__bg_task_close', { kind, id }, (resp: any) => {
      if (resp?.success !== false) {
        showPillNotice('已关闭', 'success');
        queryBgTasks();
      }
    });
  });

  const simplifySessionOpLabel = (label?: string): string => {
    const raw = String(label || '').trim();
    if (!raw) return '';
    const normalized = raw
      .replace(/^__session_/, '')
      .replace(/^__ai_/, '');
    if (normalized.startsWith('session_event:')) return '同步会话状态';
    if (normalized.startsWith('pending_')) return '处理回包';
    if (normalized.includes('create')) return '创建会话';
    if (normalized.includes('continue')) return '继续会话';
    if (normalized.includes('cancel')) return '取消任务';
    if (normalized.includes('clear')) return '清空会话';
    if (normalized.includes('rollback') || normalized.includes('undo')) return '回退历史';
    if (normalized.includes('replay')) return '恢复历史记录';
    return '后台处理中';
  };

  const formatSessionOpQueueHint = (task: TaskItem | null): string => {
    if (!task?.opQueue) return '';
    const depth = Math.max(0, Number(task.opQueue.depth || 0));
    if (depth <= 0) return '';
    const parts: string[] = [`后台队列 ${depth}`];
    if (task.opQueue.runningSince) {
      const runningMs = Math.max(0, Date.now() - task.opQueue.runningSince);
      const runningLabel = simplifySessionOpLabel(task.opQueue.runningLabel);
      const latencyText = formatQueueLatency(runningMs);
      if (runningLabel && latencyText) {
        parts.push(`${runningLabel} ${latencyText}`);
      } else if (latencyText) {
        parts.push(latencyText);
      }
    } else if (task.opQueue.lastLatencyMs) {
      const lastLabel = simplifySessionOpLabel(task.opQueue.lastLabel);
      const latencyText = formatQueueLatency(task.opQueue.lastLatencyMs);
      if (lastLabel && latencyText) {
        parts.push(`${lastLabel} ${latencyText}`);
      } else if (latencyText) {
        parts.push(latencyText);
      }
    }
    return parts.join(' · ');
  };

  // ============ 工作流录制 ============

  /** 生成一个尽可能稳定的 CSS 选择器 */
  const buildSimpleSelector = (el: Element): string => {
    // 有 id 直接使用
    if (el.id) return `#${CSS.escape(el.id)}`;
    // data-testid / data-test
    const testId = el.getAttribute('data-testid') || el.getAttribute('data-test');
    if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
    const tag = el.tagName.toLowerCase();
    // name 属性
    const name = el.getAttribute('name');
    if (name) return `${tag}[name="${CSS.escape(name)}"]`;
    // aria-label
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return `${tag}[aria-label="${CSS.escape(ariaLabel)}"]`;
    // placeholder
    const placeholder = el.getAttribute('placeholder');
    if (placeholder) return `${tag}[placeholder="${CSS.escape(placeholder)}"]`;
    // class 名（取前 2 个）
    const classes = Array.from(el.classList).slice(0, 2);
    if (classes.length > 0) return `${tag}.${classes.map(c => CSS.escape(c)).join('.')}`;
    // nth-of-type 兜底
    const parent = el.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
      const idx = siblings.indexOf(el) + 1;
      return `${tag}:nth-of-type(${idx})`;
    }
    return tag;
  };

  /** 生成元素的语义描述 */
  const getElementSemanticHint = (el: Element): string => {
    const tag = el.tagName.toLowerCase();
    // 按钮/链接：取文本内容
    if (tag === 'button' || tag === 'a' || el.getAttribute('role') === 'button') {
      const text = (el.textContent || '').trim().slice(0, 30);
      if (text) return text;
    }
    // 输入框：取 placeholder / aria-label / name
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      return el.getAttribute('placeholder')
        || el.getAttribute('aria-label')
        || el.getAttribute('name')
        || tag;
    }
    // 其他：aria-label / role / tag
    return el.getAttribute('aria-label')
      || el.getAttribute('role')
      || tag;
  };

  // ---- 事件捕获 ----

  let inputDebounceTimer: number | null = null;
  let lastInputTarget: Element | null = null;
  let lastInputValue = '';

  /** 提交未完成的输入步骤 */
  const flushInputStep = () => {
    if (!lastInputTarget || !lastInputValue) return;
    const target = lastInputTarget;
    const isSelect = target.tagName === 'SELECT';

    recorderStepCount++;
    Channel.send('__recorder_step', {
      seq: recorderStepCount,
      action: isSelect ? 'select' : 'type',
      selector: buildSimpleSelector(target),
      selectorCandidates: [buildSimpleSelector(target)],
      semanticHint: getElementSemanticHint(target),
      tag: target.tagName.toLowerCase(),
      value: lastInputValue,
      url: window.location.href,
      timestamp: Date.now(),
    });
    lastInputTarget = null;
    lastInputValue = '';
    updateRecorderBar();
  };

  /** click 监听器 */
  const recorderClickHandler = (e: MouseEvent) => {
    if (!isRecording) return;
    const target = e.target as Element;
    if (!target || target.closest('#mole-root')) return;

    const selector = buildSimpleSelector(target);
    const semanticHint = getElementSemanticHint(target);

    recorderStepCount++;
    Channel.send('__recorder_step', {
      seq: recorderStepCount,
      action: 'click',
      selector,
      selectorCandidates: [selector],
      semanticHint,
      tag: target.tagName.toLowerCase(),
      url: window.location.href,
      timestamp: Date.now(),
    });
    updateRecorderBar();
  };

  /** input/change 监听器（防抖合并） */
  const recorderInputHandler = (e: Event) => {
    if (!isRecording) return;
    const target = e.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    if (!target || target.closest('#mole-root')) return;

    // 上一个元素的输入已结束，立即提交
    if (target !== lastInputTarget && lastInputTarget && lastInputValue) {
      flushInputStep();
    }

    lastInputTarget = target;
    lastInputValue = target.value || '';

    if (inputDebounceTimer) window.clearTimeout(inputDebounceTimer);
    inputDebounceTimer = window.setTimeout(() => {
      flushInputStep();
    }, 800);
  };

  /** submit 监听器 */
  const recorderSubmitHandler = (e: Event) => {
    if (!isRecording) return;
    const form = e.target as HTMLFormElement;
    if (!form || form.closest('#mole-root')) return;

    flushInputStep(); // 先提交未完成的输入

    recorderStepCount++;
    Channel.send('__recorder_step', {
      seq: recorderStepCount,
      action: 'submit',
      selector: buildSimpleSelector(form),
      selectorCandidates: [buildSimpleSelector(form)],
      semanticHint: '提交表单',
      tag: 'form',
      url: window.location.href,
      timestamp: Date.now(),
    });
    updateRecorderBar();
  };

  /** 开始事件捕获 */
  const startRecordingCapture = () => {
    document.addEventListener('click', recorderClickHandler, true);
    document.addEventListener('input', recorderInputHandler, true);
    document.addEventListener('change', recorderInputHandler, true);
    document.addEventListener('submit', recorderSubmitHandler, true);
  };

  /** 停止事件捕获 */
  const stopRecordingCapture = () => {
    document.removeEventListener('click', recorderClickHandler, true);
    document.removeEventListener('input', recorderInputHandler, true);
    document.removeEventListener('change', recorderInputHandler, true);
    document.removeEventListener('submit', recorderSubmitHandler, true);
    if (inputDebounceTimer) { window.clearTimeout(inputDebounceTimer); inputDebounceTimer = null; }
    lastInputTarget = null;
    lastInputValue = '';
  };

  /** 更新录制状态栏 */
  const updateRecorderBar = () => {
    const barInfo = recorderBarEl.querySelector('.mole-recorder-bar-info') as HTMLSpanElement;
    if (!barInfo) return;
    if (isRecording) {
      const elapsed = Math.max(0, Date.now() - recorderStartedAt);
      barInfo.textContent = `录制中 \u00B7 ${recorderStepCount} 步 \u00B7 ${formatDuration(elapsed)}`;
      recorderBarEl.classList.add('visible');
    } else {
      recorderBarEl.classList.remove('visible');
    }
  };

  /** 提交录制给 background AI 处理 */
  const submitRecording = (resultSelector: string | null) => {
    // 更新 footer 提示
    footerTextEl.textContent = 'AI 正在审计录制...';
    trigger.classList.remove('recording');
    recorderBarEl.classList.remove('visible');
    recorderBtnEl.style.display = '';

    Channel.send('__recorder_submit', {
      resultSelector,
      resultMode: resultSelector ? 'element' : 'skip',
    }, (resp: any) => {
      if (resp?.success) {
        showPillNotice('工作流已保存', 'success');
      } else {
        showPillNotice(resp?.error || '生成失败', 'error');
      }
      footerTextEl.textContent = 'Mole \u00B7 AI 助手';
    });
  };

  /** 进入结果标记模式 */
  const enterResultMarkMode = () => {
    isResultMarking = true;
    // 显示提示栏
    resultMarkOverlay.classList.add('visible');
    // 关闭搜索框
    if (isOpen) toggleSearch(false);

    // 注册一次性点击捕获（在 document 上）
    const markClickHandler = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const target = e.target as Element;
      if (!target) return;
      // 忽略 mole 自身的点击
      if (target.closest('#mole-root')) return;

      const selector = buildSimpleSelector(target);
      document.removeEventListener('click', markClickHandler, true);
      isResultMarking = false;
      resultMarkOverlay.classList.remove('visible');
      submitRecording(selector);
    };
    document.addEventListener('click', markClickHandler, true);

    // 跳过按钮
    const skipBtn = resultMarkOverlay.querySelector('.mole-result-mark-skip') as HTMLButtonElement;
    const skipHandler = () => {
      document.removeEventListener('click', markClickHandler, true);
      isResultMarking = false;
      resultMarkOverlay.classList.remove('visible');
      submitRecording(null);
      skipBtn.removeEventListener('click', skipHandler);
    };
    skipBtn.addEventListener('click', skipHandler);
  };

  /** 开始录制 */
  const startRecording = () => {
    Channel.send('__recorder_start', { tabId: 0, url: window.location.href }, (resp: any) => {
      if (resp?.error) {
        showPillNotice(resp.error, 'error');
        return;
      }
      isRecording = true;
      recorderStepCount = 0;
      recorderStartedAt = Date.now();
      startRecordingCapture();
      // 更新 UI：胶囊加 recording class，显示 recorderBar，隐藏录制按钮
      trigger.classList.add('recording');
      recorderBtnEl.style.display = 'none';
      updateRecorderBar();
      showPillNotice('开始录制', 'info');
    });
  };

  /** 停止录制 */
  const stopRecording = () => {
    flushInputStep(); // 提交未完成的输入
    stopRecordingCapture();
    Channel.send('__recorder_stop', {}, () => {
      isRecording = false;
      recorderBarEl.classList.remove('visible');
      // 进入结果标记模式
      enterResultMarkMode();
    });
  };

  // 录制按钮点击事件
  recorderBtnEl.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isRecording || currentTask?.status === 'running') return;
    startRecording();
  });

  // 录制状态栏停止按钮
  const recorderBarStopBtn = recorderBarEl.querySelector('.mole-recorder-bar-stop') as HTMLButtonElement;
  recorderBarStopBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    stopRecording();
  });

  // AI 处理结果监听
  Channel.on('__recorder_result', (data: any) => {
    trigger.classList.remove('recording');
    if (data?.success) {
      showPillNotice('工作流已保存', 'success');
    } else {
      showPillNotice(data?.error || '生成失败', 'error');
    }
    footerTextEl.textContent = 'Mole \u00B7 AI 助手';
  });

  const updateFooterTime = () => {
    if (!currentTask) {
      footerTimeEl.textContent = '';
      return;
    }
    const start = currentTask.startedAt;
    if (currentTask.status === 'running') {
      const elapsed = Math.max(0, Date.now() - start);
      footerTimeEl.textContent = `开始 ${formatClock(start)} · 已运行 ${formatDuration(elapsed)}`;
      return;
    }
    const end = currentTask.endedAt;
    const duration = currentTask.durationMs
      ?? (end ? Math.max(0, end - start) : null);
    const parts: string[] = [];
    if (end) parts.push(`结束 ${formatClock(end)}`);
    if (duration !== null) parts.push(`耗时 ${formatDuration(duration)}`);
    footerTimeEl.textContent = parts.join(' · ');
  };

  // ---- 统一输入区 UI 状态 ----
  const updateInputUI = () => {
    searchbox.classList.remove('state-idle', 'state-running', 'state-done', 'state-error');
    const nonOrigin = currentTask && isNonOriginTab();

    if (!currentTask) {
      // idle
      searchbox.classList.add('state-idle');
      inputEl.disabled = false;
      const takeoverLabel = getTakeoverLabel();
      inputEl.placeholder = takeoverLabel ? `${takeoverLabel} · 页面接管中` : '有什么想让我做的？';
      footerTextEl.textContent = takeoverLabel ? `AI 接管中 · ${takeoverLabel}` : 'Mole \u00B7 AI 助手';
      footerTimeEl.textContent = '';
      stopBtn.classList.remove('visible');
      newBtn.classList.remove('visible');
      focusTabBtn.style.display = 'none';
      hintEl.style.display = '';
    } else if (currentTask.status === 'running') {
      searchbox.classList.add('state-running');
      inputEl.disabled = true;
      const queueHint = formatSessionOpQueueHint(currentTask);
      const liveProgress = clipRuntimeText(
        sanitizeUserFacingRuntimeText(currentTask.liveStatusText || '我正在继续处理，请稍候...', 'current'),
        28,
      );
      const footerParts: string[] = [liveProgress || '我正在继续处理'];
      if (queueHint) footerParts.push(queueHint);
      if (nonOrigin) {
        // 非发起页签：禁用输入，显示提示和定位按钮
        inputEl.disabled = true;
        inputEl.placeholder = '任务运行在其他标签页';
        focusTabBtn.style.display = '';
        stopBtn.classList.remove('visible');
      } else {
        inputEl.disabled = false;
        inputEl.placeholder = `${liveProgress || getTaskTitle(currentTask)}...`;
        focusTabBtn.style.display = 'none';
        stopBtn.classList.add('visible');
      }
      footerTextEl.textContent = footerParts.join(' · ');
      newBtn.classList.remove('visible');
      hintEl.style.display = 'none';
    } else {
      // done / error
      searchbox.classList.add(currentTask.status === 'error' ? 'state-error' : 'state-done');
      if (nonOrigin) {
        // 非发起页签：禁止继续对话
        inputEl.disabled = true;
        inputEl.placeholder = '任务运行在其他标签页';
        focusTabBtn.style.display = '';
        newBtn.classList.remove('visible');
      } else {
        inputEl.disabled = false;
        inputEl.placeholder = '继续对话...';
        focusTabBtn.style.display = 'none';
        newBtn.classList.add('visible');
      }
      footerTextEl.textContent = currentTask.status === 'error'
        ? `处理失败 · ${getTaskTitle(currentTask)}${currentTask.failureCode ? ` (${currentTask.failureCode})` : ''}`
        : `已完成 · ${getTaskTitle(currentTask)}`;
      stopBtn.classList.remove('visible');
      hintEl.style.display = '';
    }
    updateFooterTime();
    updatePillState();
  };

  // 运行中每秒刷新一次耗时显示
  window.setInterval(() => {
    const takeoverChanged = tabTakeoverState?.active === true && tabTakeoverState.expiresAt <= Date.now();
    if (currentTask?.status === 'running') {
      updateFooterTime();
      updatePillState();
    } else if (takeoverChanged) {
      tabTakeoverState = null;
      updateInputUI();
    } else if (isTakeoverActive()) {
      updatePillState();
    }
    // 录制中每秒刷新录制状态栏
    if (isRecording) {
      updateRecorderBar();
    }
  }, 1000);

  // ---- 终止任务 ----
  const stopTask = () => {
    // 发送取消消息到后台，使用 sessionId
    if (currentTask && currentTask.status === 'running') {
      Channel.send('__ai_cancel', { sessionId: currentTask.id });
      showPillNotice('已停止当前处理', 'info');
    }
    currentTask = null;
    resetReplayCursor();
    clearReplayCache();
    hideResult();
    updateInputUI();
  };

  stopBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    stopTask();
  });

  settingsBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  settingsBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isOpen) {
      toggleSearch(false);
    }
    openOptionsPage();
  });

  // ---- 关闭按钮事件 ----
  closeBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  closeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    // 切换关闭菜单的显示/隐藏
    closeMenuEl.classList.toggle('visible');
  });

  // 菜单项1：仅当前关闭
  closeMenuItemCurrent.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    userDismissed = true;
    host.remove();
  });

  // 菜单项2：在当前域名上禁用
  closeMenuItemDomain.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    // 将当前域名写入黑名单存储
    chrome.storage.local.get(DISABLED_DOMAINS_KEY, (result) => {
      const existing = result[DISABLED_DOMAINS_KEY];
      const domains: string[] = (existing && Array.isArray(existing.domains)) ? [...existing.domains] : [];
      if (!domains.includes(currentHostname)) {
        domains.push(currentHostname);
      }
      const payload = {
        version: 1,
        updatedAt: Date.now(),
        domains,
      };
      chrome.storage.local.set({ [DISABLED_DOMAINS_KEY]: payload }, () => {
        userDismissed = true;
        host.remove();
      });
    });
  });

  // 点击菜单外区域关闭菜单
  shadow.addEventListener('mousedown', (e) => {
    if (!closeMenuEl.classList.contains('visible')) return;
    const path = e.composedPath();
    if (!path.includes(closeMenuEl) && !path.includes(closeBtn)) {
      closeMenuEl.classList.remove('visible');
    }
  });

  // ---- 新对话（公共逻辑） ----
  const startNewSession = () => {
    // 通知 background 清除当前活跃会话
    if (currentTask) {
      Channel.send('__session_clear', { sessionId: currentTask.id });
    }
    clearPillNotice();
    trigger.classList.remove('announce');
    currentTask = null;
    resetReplayCursor();
    clearReplayCache();
    hideResult();
    updateInputUI();
    requestAnimationFrame(() => inputEl.focus());
  };

  // ---- ESC 行为：有会话 → 新对话；无会话 → 关闭 ----
  const handleEscape = () => {
    if (!isOpen) return;
    if (imageViewerEl.classList.contains('open')) {
      closeImageViewer();
      return;
    }
    // 有会话内容时，先清空为新会话
    if (currentTask) {
      startNewSession();
      return;
    }
    // 无会话，关闭搜索框
    toggleSearch(false);
  };

  const handleImageViewerHotkey = (key: string): boolean => {
    if (!imageViewerEl.classList.contains('open')) return false;
    if (key === 'ArrowLeft') {
      previewNextImage(-1);
      return true;
    }
    if (key === 'ArrowRight') {
      previewNextImage(1);
      return true;
    }
    return false;
  };

  newBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    startNewSession();
  });

  // ---- 结果渲染 ----
  const showResult = () => {
    resultEl.classList.add('visible');
    dividerBottomEl.style.display = 'block';
  };

  const hideResult = () => {
    resultEl.classList.remove('visible');
    resultEl.innerHTML = '';
    dividerBottomEl.style.display = 'none';
  };

  /** 渲染当前页面匹配的 workflow 快捷操作卡片 */
  const renderWorkflowHints = () => {
    // 仅在 idle 或 done 状态时显示
    if (currentTask && currentTask.status === 'running') return;

    const url = window.location.href;
    Channel.send('__site_workflows_match', { url }, (response: any) => {
      // 响应回来时再次确认仍然是 idle/done 状态且搜索框打开
      if (currentTask?.status === 'running' || !isOpen) return;
      // 如果已有 resultHtml（done 状态恢复），不覆盖
      if (currentTask?.resultHtml) return;

      const workflows: Array<{
        name: string;
        label: string;
        description: string;
        hasRequiredParams: boolean;
      }> = response?.success && Array.isArray(response.workflows) ? response.workflows : [];

      if (workflows.length === 0) return;

      // 如果 resultEl 中已经有 workflow-hints 卡片或其他内容，跳过
      if (resultEl.querySelector('.mole-workflow-hints')) return;
      if (resultEl.innerHTML.trim()) return;

      const chipsHtml = workflows.map(w =>
        `<div class="mole-workflow-chip" data-name="${escapeHtml(w.name)}" data-label="${escapeHtml(w.label)}" data-has-required="${w.hasRequiredParams ? '1' : '0'}" title="${escapeHtml(w.description)}"><span class="mole-workflow-chip-label">${escapeHtml(w.label)}</span></div>`
      ).join('');

      resultEl.innerHTML = `<div class="mole-workflow-hints">
        <div class="mole-workflow-hints-title">试试快捷指令</div>
        <div class="mole-workflow-chips">${chipsHtml}</div>
      </div>`;
      showResult();
    });
  };

  const setStatus = (html: string) => {
    // 移除之前的状态提示（不影响历史内容）
    resultEl.querySelectorAll('.mole-status, .mole-planning').forEach(el => el.remove());
    // 追加新状态
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    while (wrapper.firstChild) {
      resultEl.appendChild(wrapper.firstChild);
    }
    renderTaskRuntimeBoard();
    showResult();
    resultEl.scrollTop = resultEl.scrollHeight;
  };

  const appendToResult = (html: string) => {
    resultEl.innerHTML += html;
    showResult();
    resultEl.scrollTop = resultEl.scrollHeight;
  };

  const buildRoundPreviewText = (query: string): string => {
    const compact = String(query || '').trim();
    if (!compact) return '历史对话';
    return compact.length > 40 ? `${compact.slice(0, 40)}...` : compact;
  };

  const archiveCurrentRoundView = (previewQuery?: string) => {
    const looseNodes = Array.from(resultEl.childNodes).filter(
      node => !(node instanceof HTMLElement && node.classList.contains('mole-round-history')),
    );
    if (looseNodes.length === 0) return;

    const prevAnswer = resultEl.querySelector('.mole-answer:not(.frozen)');
    if (prevAnswer) prevAnswer.classList.add('frozen');
    const prevGroup = resultEl.querySelector('.mole-calls-group:not(.frozen)');
    if (prevGroup) prevGroup.classList.add('frozen');
    const prevStatePanel = resultEl.querySelector('.mole-agent-state-panel:not(.frozen)');
    if (prevStatePanel) prevStatePanel.classList.add('frozen');

    const roundHistory = document.createElement('div');
    roundHistory.className = 'mole-round-history';

    const summaryBar = document.createElement('div');
    summaryBar.className = 'mole-round-summary';
    summaryBar.innerHTML = `
      <span class="arrow">\u25B6</span>
      <span class="mole-round-preview">${escapeHtml(buildRoundPreviewText(previewQuery || ''))}</span>
    `;

    const roundContent = document.createElement('div');
    roundContent.className = 'mole-round-content';
    for (const node of looseNodes) {
      roundContent.appendChild(node);
    }

    roundHistory.appendChild(summaryBar);
    roundHistory.appendChild(roundContent);
    resultEl.appendChild(roundHistory);
  };

  const updateAnswer = (text: string) => {
    // 查找当前轮次的 answer 元素（排除已冻结的历史轮次）
    let answerEl = resultEl.querySelector('.mole-answer:not(.frozen)');
    if (!answerEl) {
      answerEl = document.createElement('div');
      answerEl.className = 'mole-answer';
      resultEl.appendChild(answerEl);
      showResult();
    }
    answerEl.innerHTML = markdownToHtml(text);
    resultEl.scrollTop = resultEl.scrollHeight;
  };

  // ---- AI 流式事件处理 ----

  /** 确保当前轮次的过程折叠区存在（排除已冻结的历史轮次） */
  const ensureCallsGroup = (): { summary: HTMLElement; detail: HTMLElement } => {
    const panel = ensureAgentStatePanel();
    const anchor = panel.querySelector('.mole-agent-state-ops-anchor') as HTMLElement | null;
    let group = panel.querySelector('.mole-calls-group:not(.frozen)') as HTMLElement | null;
    if (!group) {
      group = document.createElement('div');
      group.className = 'mole-calls-group mole-agent-state-ops';
      group.innerHTML = `
        <div class="mole-calls-summary">
          <span class="arrow">▶</span>
          <span class="mole-calls-icons"></span>
          <span class="calls-text">查看执行过程</span>
        </div>
        <div class="mole-calls-detail"></div>
      `;
      if (anchor) {
        anchor.appendChild(group);
      } else {
        panel.appendChild(group);
      }
      showResult();
    }

    return {
      summary: group.querySelector('.mole-calls-summary')! as HTMLElement,
      detail: group.querySelector('.mole-calls-detail')! as HTMLElement,
    };
  };

  /** 更新当前轮次的折叠摘要条 */
  const updateCallsSummary = () => {
    if (!currentTask) return;
    const group = resultEl.querySelector('.mole-agent-state-panel:not(.frozen) .mole-calls-group');
    if (!group) {
      renderTaskRuntimeBoard();
      return;
    }
    const iconsEl = group.querySelector('.mole-calls-icons') as HTMLElement | null;
    const textEl = group.querySelector('.calls-text') as HTMLElement | null;
    const detailEl = group.querySelector('.mole-calls-detail') as HTMLElement | null;
    const uniqueIcons = [...new Set(currentTask.callStack.map(c => c.icon).filter(Boolean))].slice(0, 3);
    if (iconsEl) iconsEl.innerHTML = uniqueIcons.map(src => `<img src="${src}" />`).join('');
    const count = detailEl ? detailEl.querySelectorAll('.mole-call-item').length : 0;
    if (textEl) textEl.textContent = count > 0 ? `查看执行过程 · 共 ${count} 条` : '查看执行过程';
    renderTaskRuntimeBoard();
  };

  const appendProcessEntry = (
    text: string,
    options?: {
      tone?: 'status' | 'action' | 'issue' | 'done';
      icon?: string;
      subtext?: string;
      callId?: string;
      dedupe?: boolean;
    },
  ): HTMLElement | null => {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return null;
    const { detail } = ensureCallsGroup();
    const items = Array.from(detail.querySelectorAll('.mole-call-item')) as HTMLElement[];
    const last = items.length > 0 ? items[items.length - 1] : null;
    if (options?.dedupe !== false && last?.getAttribute('data-process-text') === normalized) {
      return last;
    }

    const tone = options?.tone || 'status';
    const icon = options?.icon || '';
    const subtext = String(options?.subtext || '').trim();
    const statusLabel = tone === 'issue' ? '调整中' : tone === 'done' ? '完成' : tone === 'action' ? '执行中' : '处理中';
    const item = document.createElement('div');
    item.className = `mole-call-item tone-${tone}`;
    item.setAttribute('data-process-text', normalized);
    if (options?.callId) item.setAttribute('data-call-id', options.callId);
    item.innerHTML = `
      <div class="mole-call-header">
        ${icon ? `<img class="mole-func-icon" src="${icon}" />` : '<span class="mole-task-runtime-step-dot"></span>'}
        <span class="mole-call-main">
          <span class="mole-call-title">${escapeHtml(normalized)}</span>
          ${subtext ? `<span class="mole-call-intent">${escapeHtml(subtext)}</span>` : ''}
        </span>
        <span class="mole-call-status">${escapeHtml(statusLabel)}</span>
      </div>
      <div class="mole-call-body"></div>
    `;
    detail.appendChild(item);
    while (detail.children.length > 24) {
      detail.removeChild(detail.firstChild as Node);
    }
    updateCallsSummary();
    resultEl.scrollTop = resultEl.scrollHeight;
    return item;
  };

  const updateProcessEntryStatus = (
    target: Element | null,
    options: { tone?: 'status' | 'action' | 'issue' | 'done'; subtext?: string; statusLabel?: string },
  ) => {
    if (!(target instanceof HTMLElement)) return;
    target.classList.remove('tone-status', 'tone-action', 'tone-issue', 'tone-done');
    target.classList.add(`tone-${options.tone || 'status'}`);
    const statusEl = target.querySelector('.mole-call-status');
    if (statusEl) {
      statusEl.textContent = options.statusLabel || (options.tone === 'done' ? '完成' : options.tone === 'issue' ? '失败' : '处理中');
    }
    if (typeof options.subtext === 'string') {
      const subtextEl = target.querySelector('.mole-call-intent');
      if (subtextEl) {
        subtextEl.textContent = options.subtext;
      } else if (options.subtext.trim()) {
        const mainEl = target.querySelector('.mole-call-main');
        if (mainEl) {
          const next = document.createElement('span');
          next.className = 'mole-call-intent';
          next.textContent = options.subtext;
          mainEl.appendChild(next);
        }
      }
    }
  };

  /** 保存结果快照到当前任务 */
  const saveSnapshot = () => {
    if (currentTask && resultEl.innerHTML) {
      currentTask.resultHtml = resultEl.innerHTML;
      storeReplayRunSnapshot(
        currentTask.activeRunId,
        Math.max(replayKnownEventCount, replayAppliedEventCount),
        replayLastTimestamp,
      );
    }
  };

  const buildAgentStatePanelMarkup = (): string => `
    <div class="mole-agent-state-title">
      <span class="mole-agent-state-title-main"><span class="arrow">▶</span><span>进展</span></span>
      <span class="mole-agent-state-summary">等待任务开始</span>
    </div>
    <div class="mole-task-runtime-board"></div>
    <div class="mole-agent-state-ops-anchor"></div>
    <div class="mole-agent-state-log"></div>
  `;

  const ensureAgentStatePanel = (): HTMLElement => {
    let panel = resultEl.querySelector('.mole-agent-state-panel:not(.frozen)') as HTMLElement | null;
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'mole-agent-state-panel';
      panel.innerHTML = buildAgentStatePanelMarkup();
      const statusEl = resultEl.querySelector('.mole-status, .mole-planning');
      if (statusEl) {
        statusEl.after(panel);
      } else {
        resultEl.appendChild(panel);
      }
      showResult();
    } else {
      const board = panel.querySelector('.mole-task-runtime-board');
      const summary = panel.querySelector('.mole-agent-state-summary');
      if (!board || !summary) {
        panel.innerHTML = buildAgentStatePanelMarkup();
      }
    }
    return panel;
  };

  /** 确保调度状态日志容器存在（排除已冻结历史轮次） */
  const ensureAgentStateLog = (): HTMLElement => {
    const panel = ensureAgentStatePanel();
    renderTaskRuntimeBoard();
    return panel.querySelector('.mole-agent-state-log') as HTMLElement;
  };

  const clipRuntimeText = (raw: unknown, max: number = 56): string => {
    const normalized = String(raw ?? '').replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
  };

  const clearTransientStatus = () => {
    resultEl.querySelectorAll('.mole-status, .mole-planning').forEach((el) => el.remove());
  };

  const syncLiveStatusText = (raw: unknown) => {
    if (!currentTask) return;
    const normalized = sanitizeUserFacingRuntimeText(raw, 'current', '我正在继续处理，请稍候...')
      .replace(/\s+/g, ' ')
      .trim();
    currentTask.liveStatusText = normalized;
    clearTransientStatus();
    renderTaskRuntimeBoard();
    showResult();
  };

  const getRuntimePhaseMeta = (
    agentPhase?: string,
  ): { label: string; toneClass: string; statusText: string } => {
    if (agentPhase === 'finalize') {
      return { label: '整理结果', toneClass: 'phase-finalize', statusText: '我正在整理结果，马上给你' };
    }
    if (agentPhase === 'verify') {
      return { label: '确认结果', toneClass: 'phase-verify', statusText: '我正在确认刚才的操作结果' };
    }
    if (agentPhase === 'act') {
      return { label: '继续处理', toneClass: 'phase-execute', statusText: '我正在继续完成页面操作' };
    }
    return { label: '查看页面', toneClass: 'phase-observe', statusText: '我正在查看页面内容并确认线索' };
  };

  const buildAgentStateSummaryText = (): string => {
    if (!currentTask) return '等待任务开始';
    if (currentTask.status === 'done') {
      const duration = currentTask.durationMs ?? (currentTask.endedAt ? Math.max(0, currentTask.endedAt - currentTask.startedAt) : null);
      return duration !== null ? `已完成 · 耗时 ${formatDuration(duration)}` : '已完成';
    }
    if (currentTask.status === 'error') {
      return currentTask.errorMsg ? clipRuntimeText(currentTask.errorMsg, 46) : '处理失败';
    }
    const phaseMeta = getRuntimePhaseMeta(currentTask.agentPhase);
    return clipRuntimeText(
      sanitizeUserFacingRuntimeText(
        currentTask.liveStatusText || phaseMeta.statusText || '我正在继续处理，请稍候...',
        'current',
        '我正在继续处理，请稍候...'
      ),
      46,
    ) || phaseMeta.label;
  };

  const renderTaskRuntimeBoard = () => {
    const panel = currentTask
      ? ensureAgentStatePanel()
      : resultEl.querySelector('.mole-agent-state-panel:not(.frozen)') as HTMLElement | null;
    const board = panel?.querySelector('.mole-task-runtime-board') as HTMLElement | null;
    const summaryEl = panel?.querySelector('.mole-agent-state-summary') as HTMLElement | null;
    if (!board) return;

    const isRunning = currentTask?.status === 'running';
    const isFinished = currentTask?.status === 'done' || currentTask?.status === 'error';

    if (panel) {
      panel.classList.toggle('is-live', isRunning === true);
      // 任务结束后自动折叠进展面板，让答案成为主角
      if (isFinished && panel.classList.contains('open')) {
        panel.classList.remove('open');
      }
    }

    if (summaryEl) {
      summaryEl.textContent = buildAgentStateSummaryText();
    }

    if (isFinished) {
      // 任务已结束，清空 board 中的运行态内容
      board.innerHTML = '';
      return;
    }

    const phaseMeta = getRuntimePhaseMeta(currentTask?.agentPhase);
    const currentStatusText = sanitizeUserFacingRuntimeText(
      currentTask?.liveStatusText || phaseMeta.statusText || '我正在继续处理，请稍候...',
      'current',
      '我正在继续处理，请稍候...'
    );

    board.innerHTML = `
      <div class="mole-runtime-now">
        ${isRunning ? '<span class="mole-inline-loader"><span></span><span></span><span></span></span>' : ''}
        <span class="mole-runtime-now-text">${escapeHtml(clipRuntimeText(currentStatusText, 120))}</span>
      </div>
    `;
  };

  /** 追加一条状态转移日志 */
  const appendAgentStateLog = (rawContent: string) => {
    const logEl = ensureAgentStateLog();
    let lineText = rawContent;
    try {
      const parsed = JSON.parse(rawContent);
      const from = AGENT_PHASE_LABELS[parsed.from] || parsed.from || '未知';
      const to = AGENT_PHASE_LABELS[parsed.to] || parsed.to || '未知';
      const reason = parsed.reason || '';
      const round = typeof parsed.round === 'number' ? parsed.round : 0;
      if (currentTask) {
        currentTask.agentPhase = parsed.to || currentTask.agentPhase;
        currentTask.agentRound = round;
      }
      lineText = `R${round} ${from} → ${to}：${reason}`;
    } catch {
      // 保底：非 JSON 直接按原文展示
    }
    const item = document.createElement('div');
    item.className = 'mole-agent-state-item';
    item.textContent = lineText;
    logEl.appendChild(item);

    // 控制日志长度，避免 DOM 无限增长
    while (logEl.children.length > 24) {
      logEl.removeChild(logEl.firstChild as Node);
    }

    showResult();
    resultEl.scrollTop = resultEl.scrollHeight;
  };

  /** 同步调度状态到当前任务（用户侧默认不展示细粒度日志） */
  const syncAgentState = (rawContent: string) => {
    try {
      const parsed = JSON.parse(rawContent);
      const round = typeof parsed.round === 'number' ? parsed.round : 0;
      if (currentTask) {
        currentTask.agentPhase = parsed.to || currentTask.agentPhase;
        currentTask.agentRound = round;
      }
    } catch {
      // ignore malformed payload
    }

    renderTaskRuntimeBoard();
    if (SHOW_AGENT_STATE_PANEL) {
      appendAgentStateLog(rawContent);
    }
  };

  /** 解析错误事件内容（兼容结构化 JSON 与纯文本） */
  const parseErrorEventContent = (rawContent: string): { message: string; code: string } => {
    try {
      const parsed = JSON.parse(rawContent);
      if (parsed && typeof parsed.message === 'string') {
        return {
          message: parsed.message,
          code: typeof parsed.code === 'string' ? parsed.code : '',
        };
      }
    } catch {
      // 非 JSON，按纯文本处理
    }
    return { message: rawContent, code: '' };
  };

  const renderReviewOutputPayload = (parsed: any) => {
    const summary = typeof parsed?.summary === 'string' ? parsed.summary.trim() : '';
    const findings = Array.isArray(parsed?.findings) ? parsed.findings : [];
    if (!summary && findings.length === 0) return;

    const section = document.createElement('div');
    section.className = 'mole-review-output';
    let html = '';
    if (summary) {
      html += `<div class="mole-review-summary">${escapeHtml(summary)}</div>`;
    }
    if (findings.length > 0) {
      html += '<ol class="mole-review-findings">';
      for (const item of findings) {
        const issue = escapeHtml(String(item?.issue || '未命名问题'));
        const impact = escapeHtml(String(item?.impact || '影响待补充'));
        const suggestion = escapeHtml(String(item?.suggestion || '建议待补充'));
        const priority = typeof item?.priority === 'string' && item.priority
          ? `<span class="mole-review-priority">[${escapeHtml(item.priority)}]</span> `
          : '';
        html += `<li>${priority}<strong>${issue}</strong><br/>影响：${impact}<br/>建议：${suggestion}</li>`;
      }
      html += '</ol>';
    }
    section.innerHTML = html;
    resultEl.appendChild(section);
    showResult();
    resultEl.scrollTop = resultEl.scrollHeight;
  };

  const handleTurnStartedEvent = (content: string) => {
    try {
      const parsed = JSON.parse(content);
      const parsedRunId = typeof parsed?.runId === 'string' && parsed.runId ? parsed.runId : null;
      const parsedQuery = typeof parsed?.query === 'string' ? parsed.query : '';
      if (isLegacyReplayMode) {
        const switchedTurn = Boolean(replayActiveRunId) && replayActiveRunId !== parsedRunId;
        if (switchedTurn) {
          archiveCurrentRoundView(replayActiveQuery);
        }
        replayActiveRunId = parsedRunId;
        replayActiveQuery = parsedQuery.trim() ? parsedQuery : '';
      }
      if (typeof parsed?.runId === 'string' && parsed.runId) {
        currentTask!.activeRunId = parsed.runId;
      }
      if (typeof parsed?.startedAt === 'number') {
        currentTask!.startedAt = parsed.startedAt;
      }
      currentTask!.status = 'running';
    } catch {
      // ignore malformed payload
    }
    saveSnapshot();
  };

  const handleTurnCompletedEvent = (content: string) => {
    const lifecycle = parseTurnLifecycleEvent(content, 'done');
    const previousErrorMsg = currentTask!.errorMsg;
    const { ignored, isError: completedAsError } = applyTurnLifecycleToTask(lifecycle);
    if (ignored) return;
    if (completedAsError) {
      const latestError = currentTask!.errorMsg || '当前处理已结束';
      if (!previousErrorMsg || previousErrorMsg !== latestError) {
        appendToResult(`<div class="mole-error">\u26A0 ${escapeHtml(latestError)}</div>`);
      }
    } else if (currentTask!.lastAIText?.trim()) {
      const statusEls = resultEl.querySelectorAll('.mole-status, .mole-planning');
      statusEls.forEach(el => el.remove());
      updateAnswer(currentTask!.lastAIText);
    } else {
      appendToResult('<div class="mole-status"><span class="dot"></span>已完成处理。</div>');
    }
    renderTaskRuntimeBoard();
    updateInputUI();
    saveSnapshot();
  };

  const handleTurnAbortedEvent = (content: string) => {
    const lifecycle = parseTurnLifecycleEvent(content, 'error');
    const previousErrorMsg = currentTask!.errorMsg;
    const { ignored } = applyTurnLifecycleToTask(lifecycle);
    if (ignored) return;
    if (!previousErrorMsg || previousErrorMsg !== currentTask!.errorMsg) {
      appendToResult(`<div class="mole-error">\u26A0 ${escapeHtml(currentTask!.errorMsg)}</div>`);
    }
    renderTaskRuntimeBoard();
    updateInputUI();
    saveSnapshot();
  };

  const handleTaskLifecycleEvent = (
    eventType: 'entered_review_mode' | 'exited_review_mode' | 'context_compacted',
    content: string,
  ) => {
    const lifecycle = parseTaskLifecycleContent(content);
    if (!applyTaskLifecycleToTask(lifecycle)) return;
    if (eventType === 'exited_review_mode' && lifecycle.reviewOutput) {
      renderReviewOutputPayload(lifecycle.reviewOutput);
    }
    if (lifecycle.status === 'error' && lifecycle.message) {
      appendToResult(`<div class="mole-error">\u26A0 ${escapeHtml(lifecycle.message)}</div>`);
      updateInputUI();
    } else if (lifecycle.message) {
      const friendlyText = toFriendlyPlanningText(lifecycle.message);
      syncLiveStatusText(friendlyText);
    }
    saveSnapshot();
  };

  const handleThreadRolledBackEvent = (content: string) => {
    try {
      const parsed = JSON.parse(content);
      const numTurns = Number.isFinite(Number(parsed?.numTurns)) ? Math.max(1, Math.floor(Number(parsed.numTurns))) : 1;
      const source = String(parsed?.source || '').trim().toLowerCase();
      appendToResult(`<div class="mole-status"><span class="dot"></span>已回滚最近 ${numTurns} 轮${source === 'undo' ? '（撤销）' : ''}。</div>`);
    } catch {
      appendToResult('<div class="mole-status"><span class="dot"></span>已回滚最近会话轮次。</div>');
    }
    if (currentTask) {
      currentTask.status = 'done';
      currentTask.failureCode = '';
      currentTask.errorMsg = '';
      currentTask.endedAt = Date.now();
      currentTask.durationMs = Math.max(0, currentTask.endedAt - currentTask.startedAt);
    }
    updateInputUI();
    saveSnapshot();
  };

  const handleAgentStateEvent = (content: string) => {
    syncAgentState(content);
    saveSnapshot();
  };

  const handlePlanningEvent = (content: string) => {
    const friendlyText = toFriendlyPlanningText(content);
    syncLiveStatusText(friendlyText);
    appendProcessEntry(friendlyText, { tone: 'status' });
    saveSnapshot();
  };

  const handleWarningEvent = (content: string) => {
    const friendlyText = toFriendlyPlanningText(content);
    syncLiveStatusText(friendlyText);
    appendProcessEntry(friendlyText, { tone: 'issue' });
    saveSnapshot();
  };

  const handleThinkingEvent = (content: string) => {
    currentTask!.callStack = [];
    if (!isGenericThinkingText(content) || !currentTask?.liveStatusText) {
      syncLiveStatusText(content);
      appendProcessEntry(sanitizeUserFacingRuntimeText(content, 'current', '我正在继续处理'), { tone: 'status' });
    }
    saveSnapshot();
  };

  const handleErrorEvent = (content: string) => {
    const parsedError = parseErrorEventContent(content);
    currentTask!.status = 'error';
    currentTask!.errorMsg = parsedError.message;
    currentTask!.failureCode = parsedError.code || currentTask!.failureCode || 'E_UNKNOWN';
    if (!currentTask!.endedAt) {
      currentTask!.endedAt = Date.now();
    }
    if (currentTask!.durationMs == null) {
      currentTask!.durationMs = Math.max(0, currentTask!.endedAt - currentTask!.startedAt);
    }
    // API Key 未配置：提示用户前往 Options 页面
    if (currentTask!.failureCode === 'E_AUTH_REQUIRED' || parsedError.message.includes('请先登录')) {
      appendToResult(`<div class="mole-error">\u26A0 请在 Options 页面配置 API Key</div>`);
      updateInputUI();
      saveSnapshot();
      return;
    }
    appendToResult(`<div class="mole-error">\u26A0 ${escapeHtml(parsedError.message)}</div>`);
    updateInputUI();
    saveSnapshot();
  };

  const handleQueueUpdatedEvent = (content: string) => {
    if (!content) return;
    try {
      const payload = JSON.parse(content);
      if (!payload || typeof payload !== 'object') return;
      if (currentTask) {
        if (payload.opQueue && typeof payload.opQueue === 'object') {
          currentTask.opQueue = payload.opQueue as SessionOpQueueSnapshot;
        }
      }
      updateInputUI();
      saveSnapshot();
    } catch {
      // ignore malformed payload
    }
  };

  const directEventHandlers: Record<string, (content: string) => void> = {
    turn_started: handleTurnStartedEvent,
    turn_completed: handleTurnCompletedEvent,
    turn_aborted: handleTurnAbortedEvent,
    thread_rolled_back: handleThreadRolledBackEvent,
    entered_review_mode: (content: string) => handleTaskLifecycleEvent('entered_review_mode', content),
    exited_review_mode: (content: string) => handleTaskLifecycleEvent('exited_review_mode', content),
    context_compacted: (content: string) => handleTaskLifecycleEvent('context_compacted', content),
    agent_state: handleAgentStateEvent,
    planning: handlePlanningEvent,
    warning: handleWarningEvent,
    thinking: handleThinkingEvent,
    error: handleErrorEvent,
    queue_updated: handleQueueUpdatedEvent,
  };

  const findTargetCallItem = (callId: string): Element | null => {
    const activeGroup = resultEl.querySelector('.mole-calls-group:not(.frozen)');
    const callItems = activeGroup ? activeGroup.querySelectorAll('.mole-call-item') : resultEl.querySelectorAll('.mole-call-item');
    if (callId) {
      const matched = Array.from(callItems).find((item) => item.getAttribute('data-call-id') === callId);
      if (matched) return matched;
    }
    return callItems.length > 0 ? callItems[callItems.length - 1] : null;
  };

  const appendToolArtifactSection = (section: HTMLElement, callId: string) => {
    const targetItem = findTargetCallItem(callId);
    const body = targetItem?.querySelector('.mole-call-body');
    if (body instanceof HTMLElement) {
      body.appendChild(section);
      const header = targetItem?.querySelector('.mole-call-header');
      if (header instanceof HTMLElement) {
        header.classList.add('has-body');
      }
      return;
    }
    resultEl.appendChild(section);
  };

  const handleToolGroupStartEvent = (content: string) => {
    try {
      const groupInfo = JSON.parse(content);
      const { summary } = ensureCallsGroup();
      const textEl = summary.querySelector('.calls-text');
      if (textEl) {
        textEl.textContent = toFriendlyToolProgress(Number(groupInfo.toolCount) || 0);
      }
    } catch {
      // ignore malformed payload
    }
    saveSnapshot();
  };

  const handleFunctionCallEvent = (content: string) => {
    const callMeta = parseFunctionCallEvent(content);
    const funcName = callMeta.name;
    const icon = FUNCTION_ICONS[funcName] || '';
    const label = FUNCTION_LABELS[funcName] || funcName || '操作执行';
    const intentText = buildToolIntentText(funcName, callMeta.summary);
    const userSummary = buildUserFacingActionSummary(funcName, callMeta.summary, label);

    currentTask!.callStack.push({ funcName, icon, text: label, userSummary });
    if (intentText) {
      syncLiveStatusText(intentText);
    }

    appendProcessEntry(intentText || userSummary || label, {
      tone: 'action',
      icon,
      subtext: label && intentText && label !== intentText ? label : '',
      callId: callMeta.callId || undefined,
    });
    saveSnapshot();
  };

  const handleFunctionResultEvent = (content: string) => {
    const resultMeta = parseFunctionResultEvent(content);
    const targetItem = findTargetCallItem(resultMeta.callId);

    if (targetItem) {
      if (resultMeta.cancelled) {
        updateProcessEntryStatus(targetItem, {
          tone: 'issue',
          statusLabel: '取消',
          subtext: resultMeta.message || '这一步已取消',
        });
      } else if (!resultMeta.success) {
        updateProcessEntryStatus(targetItem, {
          tone: 'issue',
          statusLabel: '失败',
          subtext: sanitizeUserFacingRuntimeText(resultMeta.message || '这一步没有成功，我正在调整', 'issue', '这一步没有成功，我正在调整'),
        });
      } else {
        updateProcessEntryStatus(targetItem, {
          tone: 'done',
          statusLabel: '完成',
          subtext: resultMeta.message ? sanitizeUserFacingRuntimeText(resultMeta.message, 'done', '') : '',
        });
      }
    } else if (!resultMeta.success && resultMeta.message) {
      appendProcessEntry(sanitizeUserFacingRuntimeText(resultMeta.message, 'issue', '这一步没有成功，我正在调整'), { tone: 'issue' });
    }
    updateCallsSummary();
    saveSnapshot();
  };

  const handleSearchResultsEvent = (content: string) => {
    const statusEls = resultEl.querySelectorAll('.mole-status');
    statusEls.forEach(el => el.remove());

    try {
      const searchData = JSON.parse(content);
      const items = searchData.results || [];
      const eventCallId = typeof searchData.callId === 'string' ? searchData.callId : '';

      const section = document.createElement('div');
      section.className = 'mole-search-section';

      let html = `<div class="mole-result-count">找到 ${items.length} 条结果 \u00B7 关键词「${escapeHtml(searchData.keyword || '')}」</div>`;
      html += '<div class="mole-search-results">';
      for (const item of items) {
        const thumbHtml = item.imageUrl
          ? `<img class="mole-result-thumb" src="${escapeHtml(item.imageUrl)}" alt="" referrerpolicy="no-referrer" />`
          : '';
        html += `<div class="mole-result-card" data-url="${escapeHtml(item.url)}">`;
        html += thumbHtml;
        html += '<div class="mole-result-body">';
        html += `<a class="mole-result-title" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a>`;
        if (item.price) {
          html += `<div class="mole-result-snippet" style="color:#d70015;font-weight:500">${escapeHtml(item.price)}${item.shop ? ' \u00B7 ' + escapeHtml(item.shop) : ''}</div>`;
        } else if (item.snippet) {
          html += `<div class="mole-result-snippet">${escapeHtml(item.snippet)}</div>`;
        }
        if (item.source) {
          html += `<div class="mole-result-source">${escapeHtml(item.source)}</div>`;
        }
        html += '</div></div>';
      }
      html += '</div>';
      section.innerHTML = html;

      appendToolArtifactSection(section, eventCallId);
      showResult();
    } catch {
      appendToResult('<div class="mole-error">结果解析失败</div>');
    }
    saveSnapshot();
  };

  const handleScreenshotDataEvent = (content: string) => {
    try {
      const imgData = JSON.parse(content);
      const eventCallId = typeof imgData.callId === 'string' ? imgData.callId : '';
      const hasImage = typeof imgData.dataUrl === 'string' && imgData.dataUrl.length > 0;
      const section = document.createElement('div');
      section.className = 'mole-screenshot-section';
      const screenshotMeta = `${imgData.format || 'png'} \u00B7 ${imgData.sizeKB || '?'}KB`;
      section.setAttribute('data-image-src', hasImage ? String(imgData.dataUrl) : '');
      section.setAttribute('data-image-meta', `截图预览（${screenshotMeta}）`);
      section.innerHTML = `
        <div class="mole-screenshot-header">
          <div class="mole-screenshot-meta">
            <div class="mole-screenshot-label">\u{1F4F8} 截图已完成</div>
            <div class="mole-screenshot-sub">${escapeHtml(screenshotMeta)}</div>
          </div>
          ${hasImage ? '<button class="mole-screenshot-open" type="button">预览</button>' : ''}
        </div>
        ${hasImage
          ? `<div class=\"mole-screenshot-img-wrap\"><img class=\"mole-screenshot-img\" src=\"${escapeHtml(imgData.dataUrl)}\" data-full-src=\"${escapeHtml(imgData.dataUrl)}\" alt=\"页面截图\" loading=\"lazy\" /><span class=\"mole-screenshot-hint\">点击放大</span></div>`
          : `<div class=\"mole-screenshot-artifact\">已保存截图资源：${escapeHtml(imgData.artifactId || '--')}</div>`}
      `;

      appendToolArtifactSection(section, eventCallId);
      showResult();
    } catch {
      // ignore malformed payload
    }
    saveSnapshot();
  };

  const handlePageAssertDataEvent = (content: string) => {
    try {
      const payload = JSON.parse(content);
      const eventCallId = typeof payload.callId === 'string' ? payload.callId : '';
      const results = Array.isArray(payload.results) ? payload.results : [];
      const passed = payload.passed === true;
      const section = document.createElement('div');
      section.className = 'mole-verify-section';
      section.innerHTML = `
        <div class="mole-verify-header">
          <div>
            <div class="mole-verify-title">✅ 页面验证</div>
            <div class="mole-verify-sub">${escapeHtml(payload.message || '')}</div>
          </div>
          <div class="mole-verify-badge ${passed ? 'ok' : 'fail'}">${passed ? '通过' : '未通过'}</div>
        </div>
      `;
      const list = document.createElement('div');
      list.className = 'mole-verify-list';
      for (const item of results.slice(0, 5)) {
        const row = document.createElement('div');
        row.className = `mole-verify-item ${item?.passed ? '' : 'fail'}`;
        row.innerHTML = `
          <div>${item?.passed ? '✓' : '✗'} ${escapeHtml(item?.type || '')}</div>
          <div class="mole-verify-sub">${escapeHtml(item?.detail || '')}</div>
        `;
        list.appendChild(row);
      }
      section.appendChild(list);
      appendToolArtifactSection(section, eventCallId);
      showResult();
    } catch {
      // ignore malformed payload
    }
    saveSnapshot();
  };

  const handlePageRepairDataEvent = (content: string) => {
    try {
      const payload = JSON.parse(content);
      const eventCallId = typeof payload.callId === 'string' ? payload.callId : '';
      const repaired = payload.repaired === true;
      const trace = Array.isArray(payload.trace) ? payload.trace : [];
      const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
      const section = document.createElement('div');
      section.className = 'mole-repair-section';
      section.innerHTML = `
        <div class="mole-repair-header">
          <div>
            <div class="mole-repair-title">🛠️ 自动修复</div>
            <div class="mole-repair-sub">${escapeHtml(payload.message || '')}${payload?.experience_domain ? ` · 域名=${escapeHtml(payload.experience_domain)}` : ''}${typeof payload?.experience_matches === 'number' && payload.experience_matches > 0 ? ` · 经验命中=${payload.experience_matches}` : ''}</div>
          </div>
          <div class="mole-repair-badge ${repaired ? 'ok' : 'fail'}">${repaired ? '找到候选' : '待人工判断'}</div>
        </div>
      `;

      const list = document.createElement('div');
      list.className = 'mole-repair-list';
      for (const item of trace.slice(0, 6)) {
        const row = document.createElement('div');
        row.className = 'mole-repair-item';
        row.innerHTML = `
          <div class="mole-repair-item-head">
            <span>${escapeHtml(item?.step || '')}</span>
            <span>${item?.success ? '✓' : '✗'}${typeof item?.candidate_count === 'number' ? ` · ${item.candidate_count}` : ''}</span>
          </div>
          <div class="mole-repair-sub">${escapeHtml(item?.note || item?.error || '')}${item?.query ? ` · query=${escapeHtml(item.query)}` : ''}</div>
        `;
        list.appendChild(row);
      }
      section.appendChild(list);

      if (candidates.length > 0) {
        const candidateWrap = document.createElement('div');
        candidateWrap.className = 'mole-repair-candidates';
        for (const candidate of candidates.slice(0, 4)) {
          const row = document.createElement('div');
          row.className = 'mole-repair-candidate';
          const title = candidate?.label || candidate?.text || candidate?.placeholder || candidate?.tag || candidate?.element_id || '--';
          const meta = [candidate?.tag, candidate?.clickable ? 'clickable' : '', candidate?.editable ? 'editable' : '', candidate?.visible ? 'visible' : '']
            .filter(Boolean)
            .join(' · ');
          row.innerHTML = `
            <div>${escapeHtml(title)}</div>
            <div class="mole-repair-sub">${escapeHtml(meta)}${candidate?.repair_queries?.length ? ` · hints=${escapeHtml(candidate.repair_queries.join(', '))}` : ''}</div>
          `;
          candidateWrap.appendChild(row);
        }
        section.appendChild(candidateWrap);
      }

      appendToolArtifactSection(section, eventCallId);
      showResult();
    } catch {
      // ignore malformed payload
    }
    saveSnapshot();
  };

  const handleTextEvent = (content: string) => {
    currentTask!.lastAIText = content;

    // 清除临时状态提示
    const statusEls = resultEl.querySelectorAll('.mole-status, .mole-planning');
    statusEls.forEach(el => el.remove());

    // 自动折叠工具调用组，让文本区成为焦点
    const activeGroup = resultEl.querySelector('.mole-calls-group:not(.frozen)');
    if (activeGroup) {
      const detailEl = activeGroup.querySelector('.mole-calls-detail');
      const arrowEl = activeGroup.querySelector('.arrow');
      if (detailEl && detailEl.classList.contains('open')) {
        detailEl.classList.remove('open');
        arrowEl?.classList.remove('open');
      }
    }

    updateAnswer(content);
    saveSnapshot();
  };

  const handleCardsEvent = (content: string) => {
    try {
      const cards = JSON.parse(content) as Array<{
        title: string; price: string; shop?: string; url: string; tag?: string;
      }>;
      const cardsEl = document.createElement('div');
      cardsEl.className = 'mole-rec-cards';
      for (const card of cards) {
        const metaParts = [`<span class="mole-rec-card-price">${escapeHtml(card.price)}</span>`];
        if (card.shop) metaParts.push(escapeHtml(card.shop));
        const tagHtml = card.tag ? `<span class="mole-rec-tag">${escapeHtml(card.tag)}</span>` : '';
        cardsEl.innerHTML += `
          <a class="mole-rec-card" href="${escapeHtml(card.url)}" target="_blank" rel="noopener">
            <div class="mole-rec-card-body">
              <div class="mole-rec-card-title">${escapeHtml(card.title)}</div>
              <div class="mole-rec-card-meta">${metaParts.join(' \u00B7 ')}</div>
            </div>
            ${tagHtml}
            <span class="mole-rec-arrow">\u203A</span>
          </a>
        `;
      }
      resultEl.appendChild(cardsEl);
      showResult();
      resultEl.scrollTop = resultEl.scrollHeight;
    } catch {
      // ignore malformed payload
    }
    saveSnapshot();
  };

  const streamEventHandlers: Record<string, (content: string) => void> = {
    tool_group_start: handleToolGroupStartEvent,
    function_call: handleFunctionCallEvent,
    function_result: handleFunctionResultEvent,
    search_results: handleSearchResultsEvent,
    screenshot_data: handleScreenshotDataEvent,
    page_assert_data: handlePageAssertDataEvent,
    page_repair_data: handlePageRepairDataEvent,
    text: handleTextEvent,
    cards: handleCardsEvent,
  };

  const handleAIStream = (data: any) => {
    if (!data) return;
    // sessionId/taskId 过滤：丢弃不属于当前任务的事件
    const eventId = data.sessionId || data.taskId;
    if (!currentTask || eventId !== currentTask.id) return;

    const rawType = String(data.type || '');
    const type = normalizeIncomingEventType(rawType);
    const content = data.content;

    const directHandler = directEventHandlers[type];
    if (directHandler) {
      directHandler(content);
      return;
    }
    const handler = streamEventHandlers[type];
    if (handler) {
      handler(content);
    }
  };

  const requestSessionReplay = (
    sessionId: string,
    scope: 'latest_turn' | 'delta' | 'full',
    fromEventCount?: number,
  ) => {
    Channel.send('__session_replay_request', {
      sessionId,
      scope,
      ...(typeof fromEventCount === 'number' ? { fromEventCount } : {}),
    });
  };

  // 注册 AI 流式事件监听
  Channel.on('__ai_stream', handleAIStream);

  // 注册定时器触发事件监听：自动创建任务以接收后续的 AI 流式事件
  Channel.on('__ai_timer_trigger', (data: any) => {
    if (!data?.taskId || !data?.action) return;

    // 自动创建任务（使用 sessionId 或 taskId）

    currentTask = {
      id: data.sessionId || data.taskId,
      query: data.action,
      title: buildTaskTitle(data.summary || data.action),
      status: 'running',
      resultHtml: '',
      callStack: [],
      errorMsg: '',
      lastAIText: '',
      agentPhase: 'plan',
      agentRound: 0,
      failureCode: '',
      liveStatusText: '',
      startedAt: Date.now(),
      endedAt: null,
      durationMs: null,
      taskKind: 'aux',
    };

    // 打开搜索框显示结果
    toggleSearch(true);
    updateInputUI();

    // 显示定时器触发提示
    const timerLabel = data.timerType === 'interval' ? '周期任务' : '定时任务';
    setStatus(`<div class="mole-planning"><span class="dot"></span>${timerLabel}触发：${escapeHtml(data.action)}</div>`);
  });

  // ---- 会话同步监听：接收 background 广播的会话状态变更 ----
  Channel.on('__session_sync', (data: SessionSyncPayload | null | undefined) => {
    if (!data?.sessionId) return;

    // 同步 originTabId
    if (typeof data.originTabId === 'number') {
      sessionOriginTabId = data.originTabId;
    } else if (data.originTabId === undefined || data.originTabId === null) {
      sessionOriginTabId = undefined;
    }

    // 如果是 cleared 状态，清理本地
    if (data.status === 'cleared') {
      if (currentTask && currentTask.id === data.sessionId) {
        clearPillNotice();
        trigger.classList.remove('announce');
        currentTask = null;
        sessionOriginTabId = undefined;
        resetReplayCursor();
        clearReplayCache();
        hideResult();
        updateInputUI();
      }
      return;
    }

    // 同步状态到当前任务
    if (currentTask && currentTask.id === data.sessionId) {
      if (data.status === 'running' || data.status === 'done' || data.status === 'error') {
        ensureReplayCacheSession(data.sessionId);
        const previousKnownReplayCount = replayKnownEventCount;
        const targetReplayEventCount = typeof data.replayEventCount === 'number' && data.replayEventCount >= 0
          ? data.replayEventCount
          : previousKnownReplayCount;
        const shouldRequestDeltaReplay = targetReplayEventCount > replayAppliedEventCount
          && !currentTask.resultHtml
          && replayAppliedEventCount > 0;
        currentTask.status = data.status;
        if (typeof data.activeRunId === 'string' || data.activeRunId === null) {
          currentTask.activeRunId = data.activeRunId;
        }
        if (typeof data.summary === 'string' && data.summary.trim()) {
          currentTask.title = buildTaskTitle(data.summary);
        }
        if (data.agentState) {
          currentTask.agentPhase = data.agentState.phase || currentTask.agentPhase;
          currentTask.agentRound = data.agentState.round || currentTask.agentRound;
        }
        if (typeof data.lastError === 'string' && data.lastError.trim()) {
          currentTask.liveStatusText = data.lastError.trim();
        }
        if (typeof data.startedAt === 'number') currentTask.startedAt = data.startedAt;
        currentTask.endedAt = typeof data.endedAt === 'number' ? data.endedAt : null;
        currentTask.durationMs = typeof data.durationMs === 'number' ? data.durationMs : null;
        currentTask.failureCode = data.failureCode || '';
        currentTask.taskKind = typeof data.taskKind === 'string' ? data.taskKind : currentTask.taskKind;
        if (data.opQueue && typeof data.opQueue === 'object') {
          currentTask.opQueue = data.opQueue;
        }
        replayKnownEventCount = targetReplayEventCount;
        if (typeof data.replayLastTimestamp === 'number' && data.replayLastTimestamp > replayLastTimestamp) {
          replayLastTimestamp = data.replayLastTimestamp;
        }
        if (data.lastError) {
          currentTask.errorMsg = data.lastError;
        }
        if (shouldRequestDeltaReplay) {
          requestSessionReplay(data.sessionId, 'delta', replayAppliedEventCount);
        }
        renderTaskRuntimeBoard();
        updateInputUI();
      }
    } else if (!currentTask && data.status === 'running') {
      // 其他标签页发起了新会话，本标签页跟踪该会话以同步状态
      ensureReplayCacheSession(data.sessionId);
      replayAppliedEventCount = 0;
      replayLastTimestamp = 0;
      currentTask = {
        id: data.sessionId,
        activeRunId: typeof data.activeRunId === 'string' || data.activeRunId === null ? data.activeRunId : null,
        query: data.summary || '',
        title: buildTaskTitle(data.summary || ''),
        status: 'running',
        resultHtml: '',
        callStack: [],
        errorMsg: '',
        lastAIText: '',
        agentPhase: data.agentState?.phase || 'plan',
        agentRound: data.agentState?.round || 0,
        liveStatusText: '',
        failureCode: data.failureCode || '',
        startedAt: typeof data.startedAt === 'number' ? data.startedAt : Date.now(),
        endedAt: typeof data.endedAt === 'number' ? data.endedAt : null,
        durationMs: typeof data.durationMs === 'number' ? data.durationMs : null,
        taskKind: typeof data.taskKind === 'string' ? data.taskKind : '',
        opQueue: data.opQueue && typeof data.opQueue === 'object' ? data.opQueue : undefined,
      };
      replayKnownEventCount = typeof data.replayEventCount === 'number' && data.replayEventCount >= 0
        ? data.replayEventCount
        : 0;
      requestSessionReplay(data.sessionId, 'latest_turn');
      renderTaskRuntimeBoard();
      updateInputUI();
    }
  });

  Channel.on('__mole_takeover_state', (data: any) => {
    const changed = applyTakeoverStatePayload(data);
    if (!changed) return;
    if (isTakeoverActive()) {
      const takeoverNotice = getTakeoverNoticeText();
      if (takeoverNotice) {
        showPillNotice(takeoverNotice, 'info');
      }
    }
    updateInputUI();
    saveSnapshot();
  });

  // ---- 后台任务变更监听 ----
  Channel.on('__bg_tasks_changed', (data: any) => {
    bgTasksData = data;
    updateBgTaskBadge();
    renderBgTasksPanel();
  });

  // ---- 事件回放监听：收到 background 发送的完整事件日志，重建 UI ----
  Channel.on('__session_replay', (data: SessionReplayPayload | null | undefined) => {
    if (!data?.sessionId || !Array.isArray(data.events)) return;
    if (!currentTask || data.sessionId !== currentTask.id) return;
    ensureReplayCacheSession(data.sessionId);
    const replayScope = data.scope === 'delta' || data.scope === 'full' ? data.scope : 'latest_turn';
    const baseStart = Number.isFinite(Number(data.fromEventCount)) ? Math.max(0, Math.floor(Number(data.fromEventCount))) : 0;
    const payloadEnd = baseStart + data.events.length;
    const payloadKnownCount = typeof data.eventCount === 'number'
      ? Math.max(payloadEnd, Math.max(0, data.eventCount))
      : payloadEnd;
    const hasReplaySnapshot = Boolean(currentTask.resultHtml);

    if (replayScope !== 'delta' && tryApplyReplayRunSnapshot(data)) {
      replayKnownEventCount = Math.max(replayKnownEventCount, payloadKnownCount);
      if (typeof data.lastTimestamp === 'number' && data.lastTimestamp > replayLastTimestamp) {
        replayLastTimestamp = data.lastTimestamp;
      }
      updateInputUI();
      return;
    }

    if (replayScope !== 'delta' && hasReplaySnapshot && replayAppliedEventCount >= payloadEnd) {
      replayKnownEventCount = Math.max(replayKnownEventCount, payloadKnownCount);
      if (typeof data.lastTimestamp === 'number' && data.lastTimestamp > replayLastTimestamp) {
        replayLastTimestamp = data.lastTimestamp;
      }
      return;
    }

    let replayEvents = data.events.slice();
    let normalizedStart = baseStart;
    if (replayScope === 'delta' && replayAppliedEventCount > normalizedStart) {
      const skipCount = Math.min(replayEvents.length, replayAppliedEventCount - normalizedStart);
      replayEvents = replayEvents.slice(skipCount);
      normalizedStart += skipCount;
    }
    if (replayScope === 'delta' && replayEvents.length === 0) {
      replayKnownEventCount = Math.max(replayKnownEventCount, payloadKnownCount);
      if (typeof data.lastTimestamp === 'number' && data.lastTimestamp > replayLastTimestamp) {
        replayLastTimestamp = data.lastTimestamp;
      }
      return;
    }

    const shouldResetView = replayScope !== 'delta';

    if (shouldResetView) {
      // 清空结果区，逐个重放事件重建 UI
      hideResult();
      currentTask.callStack = [];
      currentTask.resultHtml = '';
      currentTask.lastAIText = '';
      currentTask.activeRunId = null;
      replayActiveRunId = null;
      replayActiveQuery = '';
    }

    isLegacyReplayMode = true;
    try {
      for (const event of replayEvents) {
        handleAIStream({ ...event, sessionId: data.sessionId, taskId: data.sessionId });
      }
    } finally {
      isLegacyReplayMode = false;
      replayActiveRunId = null;
      replayActiveQuery = '';
    }

    // 回放完成后保存快照
    if (currentTask && resultEl.innerHTML) {
      currentTask.resultHtml = resultEl.innerHTML;
    }

    const appliedEnd = normalizedStart + replayEvents.length;
    replayAppliedEventCount = shouldResetView ? appliedEnd : Math.max(replayAppliedEventCount, appliedEnd);
    replayKnownEventCount = payloadKnownCount;
    const lastAppliedTs = replayEvents.length > 0
      ? Number(replayEvents[replayEvents.length - 1]?.timestamp || 0)
      : 0;
    replayLastTimestamp = typeof data.lastTimestamp === 'number' && data.lastTimestamp > 0
      ? Math.max(data.lastTimestamp, lastAppliedTs)
      : Math.max(replayLastTimestamp, lastAppliedTs);
    storeReplayRunSnapshot(
      extractReplayPayloadRunId(replayEvents) || currentTask.activeRunId,
      replayAppliedEventCount,
      replayLastTimestamp,
    );
    updateInputUI();
  });

  // ---- 初始化时恢复活跃会话 ----
  Channel.send('__session_get_active', {}, (response: SessionSyncPayload | null | undefined) => {
    if (response?.sessionId) {
      // 如果已有本地任务（比如刚发起的），不覆盖
      if (currentTask) return;

      // 同步 originTabId
      sessionOriginTabId = typeof response.originTabId === 'number' ? response.originTabId : undefined;

      // 恢复会话状态
      ensureReplayCacheSession(response.sessionId);
      currentTask = {
        id: response.sessionId,
        activeRunId: typeof response.activeRunId === 'string' || response.activeRunId === null ? response.activeRunId : null,
        query: response.summary || '',
        title: buildTaskTitle(response.summary || ''),
        status: response.status || 'done',
        resultHtml: '',
        callStack: [],
        errorMsg: response.lastError || '',
        lastAIText: '',
        agentPhase: response.agentState?.phase || 'idle',
        agentRound: response.agentState?.round || 0,
        liveStatusText: '',
        failureCode: response.failureCode || '',
        startedAt: typeof response.startedAt === 'number' ? response.startedAt : Date.now(),
        endedAt: typeof response.endedAt === 'number' ? response.endedAt : null,
        durationMs: typeof response.durationMs === 'number' ? response.durationMs : null,
        taskKind: typeof response.taskKind === 'string' ? response.taskKind : '',
        opQueue: response.opQueue && typeof response.opQueue === 'object' ? response.opQueue : undefined,
      };
      replayKnownEventCount = typeof response.replayEventCount === 'number' && response.replayEventCount >= 0
        ? response.replayEventCount
        : 0;
      replayAppliedEventCount = 0;
      replayLastTimestamp = typeof response.replayLastTimestamp === 'number' && response.replayLastTimestamp > 0
        ? response.replayLastTimestamp
        : 0;
      renderTaskRuntimeBoard();

      updateInputUI();
      // 回放事件会通过 __session_replay 异步到达
    }
  });

  // 初始化时查询后台任务以更新角标
  queryBgTasks();

  // ---- 恢复录制状态（页面导航后 content 重注入） ----
  Channel.send('__recorder_state', {}, (state: any) => {
    if (state?.active) {
      isRecording = true;
      recorderStepCount = state.steps?.length || 0;
      recorderStartedAt = state.startedAt || Date.now();
      startRecordingCapture();
      trigger.classList.add('recording');
      recorderBtnEl.style.display = 'none';
      updateRecorderBar();
    }
  });

  // ---- 事件委托：统一处理结果区所有点击交互 ----
  // 使用委托而非逐个绑定，这样快照恢复后点击仍然有效
  resultEl.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;

    // 1. 顶层折叠组摘要 toggle
    const summary = target.closest('.mole-calls-summary') as HTMLElement | null;
    if (summary) {
      const group = summary.closest('.mole-calls-group');
      if (group) {
        const dt = group.querySelector('.mole-calls-detail');
        const ar = summary.querySelector('.arrow');
        if (dt) {
          const opened = dt.classList.toggle('open');
          ar?.classList.toggle('open', opened);
        }
      }
      return;
    }

    // 1.5 历史对话折叠组 toggle
    const roundSummary = target.closest('.mole-round-summary') as HTMLElement | null;
    if (roundSummary) {
      const roundHistory = roundSummary.closest('.mole-round-history');
      if (roundHistory) {
        const rc = roundHistory.querySelector('.mole-round-content');
        const ar = roundSummary.querySelector('.arrow');
        if (rc) {
          const opened = rc.classList.toggle('open');
          ar?.classList.toggle('open', opened);
        }
      }
      return;
    }

    // 2. 调度状态面板 toggle
    const agentStateTitle = target.closest('.mole-agent-state-title') as HTMLElement | null;
    if (agentStateTitle) {
      const panel = agentStateTitle.closest('.mole-agent-state-panel');
      if (panel) {
        panel.classList.toggle('open');
      }
      return;
    }

    // 3. 单个函数调用项 toggle
    const header = target.closest('.mole-call-header') as HTMLElement | null;
    if (header && header.classList.contains('has-body')) {
      const item = header.closest('.mole-call-item');
      if (item) {
        const body = item.querySelector('.mole-call-body');
        const ar = header.querySelector('.arrow');
        if (body) {
          const opened = body.classList.toggle('open');
          ar?.classList.toggle('open', opened);
        }
      }
      return;
    }

    // 4. 截图预览（缩略图和按钮）
    const screenshotTrigger = target.closest('.mole-screenshot-img, .mole-screenshot-open') as HTMLElement | null;
    if (screenshotTrigger) {
      const section = screenshotTrigger.closest('.mole-screenshot-section') as HTMLElement | null;
      const screenshotSections = Array.from(
        resultEl.querySelectorAll('.mole-screenshot-section[data-image-src]')
      ) as HTMLElement[];
      const previewList = screenshotSections
        .map((node) => {
          const src = node.getAttribute('data-image-src') || '';
          const meta = node.getAttribute('data-image-meta') || '截图预览';
          return src ? { src, meta } : null;
        })
        .filter((item): item is { src: string; meta: string } => item !== null);

      const startSrc = screenshotTrigger.getAttribute('data-full-src') || section?.getAttribute('data-image-src') || '';
      if (startSrc) {
        let startIndex = previewList.findIndex((item) => item.src === startSrc);
        if (startIndex < 0 && section) {
          const sectionIndex = screenshotSections.indexOf(section);
          startIndex = sectionIndex >= 0 ? Math.min(sectionIndex, previewList.length - 1) : 0;
        }
        openImageViewer(previewList, startIndex < 0 ? 0 : startIndex);
      }
      return;
    }

    // 5. 搜索结果卡片点击跳转
    if ((target as HTMLElement).tagName === 'A') return;
    const card = target.closest('.mole-result-card') as HTMLElement | null;
    if (card) {
      const url = card.getAttribute('data-url');
      if (url) window.open(url, '_blank');
    }
  });

  // ---- 搜索框控制 ----
  const toggleSearch = (show?: boolean) => {
    isOpen = show !== undefined ? show : !isOpen;

    if (isOpen) {
      trigger.classList.add('active');
      overlay.classList.add('visible');

      // 恢复任务显示
      if (currentTask && currentTask.resultHtml) {
        resultEl.innerHTML = currentTask.resultHtml;
        showResult();
      } else {
        // idle 状态：展示 workflow 快捷操作卡片
        renderWorkflowHints();
      }
      updateInputUI();
      queryBgTasks();

      requestAnimationFrame(() => {
        if (!inputEl.disabled) inputEl.focus();
      });
    } else {
      trigger.classList.remove('active');
      overlay.classList.remove('visible');
      closeImageViewer();
      inputEl.value = '';
      inputEl.blur();
      // 保存快照（如果有任务且有内容）
      if (currentTask && resultEl.innerHTML) {
        currentTask.resultHtml = resultEl.innerHTML;
      }
      // 无任务时清除显示
      if (!currentTask) {
        hideResult();
      }
      if (currentTask?.status !== 'running' && !trigger.classList.contains('notice-visible')) {
        trigger.classList.remove('announce');
      }
    }
  };

  // 点击遮罩关闭（但不点击搜索框内部）
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) {
      toggleSearch(false);
    }
  });

  // ESC 关闭/新会话
  shadow.addEventListener('keydown', (e: Event) => {
    const keyboardEvent = e as KeyboardEvent;
    const key = keyboardEvent.key;
    if (handleImageViewerHotkey(key)) {
      e.preventDefault();
      return;
    }
    // Esc 优先关闭关闭菜单
    if (key === 'Escape' && closeMenuEl.classList.contains('visible')) {
      closeMenuEl.classList.remove('visible');
      return;
    }
    if (key === 'Escape') {
      handleEscape();
    }
  });

  // ---- 测试模拟：test: 前缀指令 ----

  /** 延时工具 */
  const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

  /** 模拟发送事件（自动附加 taskId） */
  const simEvent = (taskId: string, type: string, content: string) => {
    handleAIStream({ taskId, type, content });
  };

  /**
   * test:chain — 模拟完整链式调用（覆盖全部 Markdown 格式 + 推荐卡片）
   * 流程：turn_started → thinking → baidu_search → result → jd_search → result → 流式文本 → 推荐卡片 → turn_completed
   */
  const simulateChainCall = async (taskId: string) => {
    const runId = `sim-${Date.now()}`;
    const turnStartAt = Date.now();
    simEvent(taskId, 'turn_started', JSON.stringify({ runId, startedAt: turnStartAt, taskKind: 'regular' }));
    await delay(80);

    // 1. 思考中
    simEvent(taskId, 'thinking', 'AI 正在思考...');
    await delay(800);

    // 2. 第一轮：调用百度搜索
    simEvent(taskId, 'function_call', '正在调用 baidu_search...');
    await delay(1200);
    simEvent(taskId, 'function_result', 'baidu_search 执行完成');
    await delay(300);

    // 3. 第二轮：调用京东搜索
    simEvent(taskId, 'function_call', '正在调用 jd_search...');
    await delay(1500);
    simEvent(taskId, 'function_result', 'jd_search 执行完成');
    await delay(500);

    // 4. AI 流式回复（覆盖各种 Markdown 格式）
    const fullText = '### 综合分析\n\n' +
      '根据**百度搜索**和**京东商品**数据，为你整理机械键盘选购建议：\n\n' +
      '### 轴体对比\n\n' +
      '- **红轴**：线性手感，轻柔安静，适合长时间打字和游戏\n' +
      '- **青轴**：段落感强，打字有"哒哒"声，喜欢反馈感的首选\n' +
      '- **茶轴**：介于红轴和青轴之间，兼顾手感与静音\n\n' +
      '### 价格区间\n\n' +
      '1. **入门级** `¥200-500`：Cherry MX Board、Akko 3068\n' +
      '2. **进阶级** `¥500-1000`：Leopold FC750R、Varmilo 阿米洛\n' +
      '3. **旗舰级** `¥1000+`：HHKB Professional、Realforce\n\n' +
      '### 选购建议\n\n' +
      '选购时建议关注**键帽材质**（PBT 优于 ABS）、**连接方式**（有线延迟低，蓝牙便携）以及*售后保修政策*。更多信息可参考 [机械键盘吧](https://tieba.baidu.com/f?kw=%E6%9C%BA%E6%A2%B0%E9%94%AE%E7%9B%98)。\n\n' +
      '以下是为你精选的商品，点击可直接查看：';

    // 逐步增量推送文本（模拟流式输出）
    for (let i = 0; i < fullText.length; i += 8) {
      if (!currentTask || currentTask.id !== taskId) return; // 已终止
      simEvent(taskId, 'text', fullText.slice(0, i + 8));
      await delay(30);
    }
    simEvent(taskId, 'text', fullText);
    await delay(100);

    // 5. 推荐卡片
    const cards = [
      { title: 'Cherry MX Board 3.0S 机械键盘 红轴', price: '¥549', shop: 'Cherry官方旗舰店', url: 'https://item.jd.com/100038004786.html', tag: '性价比首选' },
      { title: 'Leopold FC750R PD 双模机械键盘 茶轴', price: '¥799', shop: 'Leopold海外旗舰店', url: 'https://item.jd.com/100014458498.html', tag: '手感之王' },
      { title: 'HHKB Professional Hybrid 静电容键盘', price: '¥1,899', shop: 'HHKB京东自营', url: 'https://item.jd.com/100011459498.html', tag: '极客必备' },
    ];
    simEvent(taskId, 'cards', JSON.stringify(cards));
    await delay(100);

    // 6. 完成
    const endedAt = Date.now();
    simEvent(taskId, 'turn_completed', JSON.stringify({
      runId,
      status: 'done',
      endedAt,
      durationMs: Math.max(0, endedAt - turnStartAt),
      lastAgentMessage: fullText,
    }));
  };

  /**
   * test:error — 模拟执行中途出错
   * 流程：turn_started → thinking → baidu_search → error
   */
  const simulateErrorCall = async (taskId: string) => {
    const runId = `sim-${Date.now()}`;
    const turnStartAt = Date.now();
    simEvent(taskId, 'turn_started', JSON.stringify({ runId, startedAt: turnStartAt, taskKind: 'regular' }));
    await delay(80);

    simEvent(taskId, 'thinking', 'AI 正在思考...');
    await delay(800);

    simEvent(taskId, 'function_call', '正在调用 baidu_search...');
    await delay(1500);

    simEvent(taskId, 'error', 'LLM 调用失败：API Key 未配置或已过期');
    await delay(120);
    const endedAt = Date.now();
    simEvent(taskId, 'turn_completed', JSON.stringify({
      runId,
      status: 'error',
      endedAt,
      durationMs: Math.max(0, endedAt - turnStartAt),
      reason: 'LLM 调用失败：API Key 未配置或已过期',
      failureCode: 'E_LLM_API',
    }));
  };

  /**
   * test:search — 模拟搜索结果（含缩略图）
   * 流程：turn_started → thinking → jd_search → search_results（带图片） → turn_completed
   */
  const simulateSearchResults = async (taskId: string) => {
    const runId = `sim-${Date.now()}`;
    const turnStartAt = Date.now();
    simEvent(taskId, 'turn_started', JSON.stringify({ runId, startedAt: turnStartAt, taskKind: 'regular' }));
    await delay(80);

    simEvent(taskId, 'thinking', 'AI 正在搜索商品...');
    await delay(600);

    simEvent(taskId, 'function_call', '正在调用 jd_search...');
    await delay(1200);
    simEvent(taskId, 'function_result', 'jd_search 执行完成');
    await delay(300);

    const mockResults = {
      keyword: '机械键盘',
      total: 3,
      results: [
        { title: 'Cherry MX Board 3.0S 机械键盘 红轴', price: '¥549.00', shop: 'Cherry 官方旗舰店', url: 'https://item.jd.com/100001.html', imageUrl: '' },
        { title: 'Leopold FC750R 87键机械键盘 茶轴', price: '¥799.00', shop: 'Leopold 海外旗舰店', url: 'https://item.jd.com/100002.html', imageUrl: '' },
        { title: 'HHKB Professional Hybrid 静电容键盘', price: '¥1,899.00', shop: 'HHKB 京东自营', url: 'https://item.jd.com/100003.html', imageUrl: '' },
      ],
    };

    simEvent(taskId, 'search_results', JSON.stringify(mockResults));
    await delay(200);
    const endedAt = Date.now();
    simEvent(taskId, 'turn_completed', JSON.stringify({
      runId,
      status: 'done',
      endedAt,
      durationMs: Math.max(0, endedAt - turnStartAt),
      lastAgentMessage: '',
    }));
  };

  /** 分发测试指令 */
  const TEST_COMMANDS: Record<string, (taskId: string) => Promise<void>> = {
    'test:chain': simulateChainCall,
    'test:error': simulateErrorCall,
    'test:search': simulateSearchResults,
  };

  /** 发送查询（仅处理本地测试指令，正常查询通过 session 体系） */
  const dispatchQuery = (value: string, taskId: string) => {
    const testHandler = TEST_COMMANDS[value];
    if (testHandler) {
      testHandler(taskId);
    } else if (value.startsWith('test:chain:')) {
      const keyword = value.slice('test:chain:'.length).trim();
      if (keyword) Channel.send('__test_chain', { keyword, taskId });
    }
    // 正常查询已在 Enter 处理器中通过 __session_create / __session_continue 发送
  };

  // ---- Workflow 卡片点击事件委托 ----
  resultEl.addEventListener('click', (e) => {
    const chip = (e.target as HTMLElement).closest('.mole-workflow-chip') as HTMLElement | null;
    if (!chip) return;
    const label = chip.dataset.label || chip.dataset.name || '';
    const hasRequired = chip.dataset.hasRequired === '1';

    if (hasRequired) {
      // 有必填参数：填入 workflow 标签 + 空格，让用户补参数
      inputEl.value = `${label} `;
      inputEl.focus();
      // 清除卡片
      const hints = resultEl.querySelector('.mole-workflow-hints');
      if (hints) hints.remove();
      if (!resultEl.innerHTML.trim()) hideResult();
    } else {
      // 无必填参数：填入标签后自动提交
      inputEl.value = label;
      inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
  });

  // ---- 用户输入时清除 workflow 卡片 ----
  inputEl.addEventListener('input', () => {
    const hints = resultEl.querySelector('.mole-workflow-hints');
    if (hints) {
      hints.remove();
      if (!resultEl.innerHTML.trim()) hideResult();
    }
  });

  // Enter 发送到 AI
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      const value = inputEl.value.trim();
      if (!value) return;

      // running 时不允许新输入
      if (currentTask?.status === 'running') return;

      inputEl.value = '';

      // 判断是否为本地测试指令
      const isTestCommand = value in TEST_COMMANDS || value.startsWith('test:chain:');

      if (!currentTask || (currentTask.status === 'error')) {
        // ---- 新任务 ----
        if (isTestCommand) {
          // 测试指令：本地生成 taskId，走旧路径
          const taskId = Date.now().toString();
      
          resetReplayCursor();
          clearReplayCache();
          currentTask = {
            id: taskId,
            query: value,
            title: buildTaskTitle(value),
            status: 'running',
            resultHtml: '',
            callStack: [],
            errorMsg: '',
            lastAIText: '',
            agentPhase: 'plan',
            agentRound: 0,
            failureCode: '',
            startedAt: Date.now(),
            endedAt: null,
            durationMs: null,
            taskKind: 'regular',
          };
          hideResult();
          updateInputUI();
          dispatchQuery(value, taskId);
        } else {
          // 正常查询：通过 session 体系，先创建本地任务占位
          const tempId = Date.now().toString();
      
          resetReplayCursor();
          clearReplayCache();
          currentTask = {
            id: tempId,
            query: value,
            title: buildTaskTitle(value),
            status: 'running',
            resultHtml: '',
            callStack: [],
            errorMsg: '',
            lastAIText: '',
            agentPhase: 'plan',
            agentRound: 0,
            failureCode: '',
            startedAt: Date.now(),
            endedAt: null,
            durationMs: null,
            taskKind: 'regular',
          };
          hideResult();
          updateInputUI();

          // 请求 background 创建会话
          Channel.send('__session_create', { query: value }, (response: any) => {
            if (response?.sessionId && currentTask && currentTask.id === tempId) {
              // 更新为 background 分配的 sessionId
              currentTask.id = response.sessionId;
              if (typeof response.summary === 'string' && response.summary.trim()) {
                currentTask.title = buildTaskTitle(response.summary);
              }
              return;
            }
            if (currentTask && currentTask.id === tempId && response?.accepted === false) {
              const message = typeof response?.message === 'string' && response.message.trim()
                ? response.message.trim()
                : '创建会话失败';
              currentTask.status = 'error';
              currentTask.errorMsg = message;
              currentTask.failureCode = typeof response?.code === 'string' ? response.code : currentTask.failureCode;
              // API Key 未配置：提示用户前往 Options 页面
              if (currentTask.failureCode === 'E_AUTH_REQUIRED' || message.includes('请先登录')) {
                appendToResult(`<div class="mole-error">\u26A0 请在 Options 页面配置 API Key</div>`);
                updateInputUI();
                saveSnapshot();
                return;
              }
              appendToResult(`<div class="mole-error">\u26A0 ${escapeHtml(message)}</div>`);
              updateInputUI();
              saveSnapshot();
            }
          });
        }
      } else {
        // ---- 继续对话 ----
        const previousQuery = currentTask.query;
    
        resetReplayCursor();
        currentTask.query = value;
        currentTask.title = buildTaskTitle(value);
        currentTask.status = 'running';
        currentTask.callStack = [];
        currentTask.lastAIText = '';
        currentTask.agentPhase = 'plan';
        currentTask.agentRound = 0;
        currentTask.failureCode = '';
        currentTask.errorMsg = '';
        currentTask.startedAt = Date.now();
        currentTask.endedAt = null;
        currentTask.durationMs = null;

        archiveCurrentRoundView(previousQuery);

        showResult();
        resultEl.scrollTop = resultEl.scrollHeight;
        saveSnapshot();

        updateInputUI();

        if (isTestCommand) {
          // 测试指令走旧路径
          dispatchQuery(value, currentTask.id);
        } else {
          // 通过 session 体系继续对话
          const expectedSessionId = currentTask.id;
          const expectedRunId = currentTask.activeRunId || undefined;
          Channel.send(
            '__session_continue',
            { sessionId: expectedSessionId, expectedSessionId, expectedRunId, query: value },
            (response: any) => {
              if (!currentTask) return;
              if (response?.accepted === false) {
                if (typeof response.actualSessionId === 'string') {
                  currentTask.id = response.actualSessionId;
                }
                if (typeof response.actualRunId === 'string' || response.actualRunId === null) {
                  currentTask.activeRunId = response.actualRunId;
                }
                const message = typeof response?.message === 'string' && response.message.trim()
                  ? response.message.trim()
                  : '继续对话失败';
                currentTask.status = 'error';
                currentTask.errorMsg = message;
                currentTask.failureCode = typeof response?.code === 'string' ? response.code : currentTask.failureCode;
                // API Key 未配置：提示用户前往 Options 页面
                if (currentTask.failureCode === 'E_AUTH_REQUIRED' || message.includes('请先登录')) {
                  appendToResult(`<div class="mole-error">\u26A0 请在 Options 页面配置 API Key</div>`);
                  updateInputUI();
                  saveSnapshot();
                  return;
                }
                appendToResult(`<div class="mole-error">\u26A0 ${escapeHtml(message)}</div>`);
                updateInputUI();
                saveSnapshot();
              } else if (response?.accepted === true && typeof response.sessionId === 'string') {
                currentTask.id = response.sessionId;
                if (typeof response.runId === 'string' || response.runId === null) {
                  currentTask.activeRunId = response.runId;
                }
                if (typeof response?.message === 'string' && response.message.trim()) {
                  showPillNotice(response.message.trim(), 'info');
                }
              }
            },
          );
        }
      }
    }
  });

  // ---- 拖拽 ----
  const onMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    startMouseX = e.clientX;
    startMouseY = e.clientY;
    startTriggerX = trigger.offsetLeft;
    startTriggerY = currentY;
    isDragging = false;

    trigger.classList.add('dragging');
    trigger.classList.remove('snapping');

    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('mouseup', onMouseUp, true);
  };

  const onMouseMove = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const dx = e.clientX - startMouseX;
    const dy = e.clientY - startMouseY;

    if (!isDragging && Math.sqrt(dx * dx + dy * dy) >= DRAG_THRESHOLD) {
      isDragging = true;
      if (isOpen) toggleSearch(false);
    }

    if (isDragging) {
      const newX = startTriggerX + dx;
      const newY = Math.max(0, Math.min(startTriggerY + dy, window.innerHeight - PILL_HEIGHT));
      trigger.style.left = `${newX}px`;
      trigger.style.top = `${newY}px`;
      trigger.classList.add('dragging');
      trigger.classList.remove('side-left', 'side-right');
    }
  };

  const onMouseUp = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('mouseup', onMouseUp, true);

    trigger.classList.remove('dragging');

    if (isDragging) {
      const curLeft = trigger.offsetLeft;
      side = determineSide(curLeft);
      currentY = clampY(parseInt(trigger.style.top) || currentY);

      applySideClass();
      trigger.classList.add('snapping');
      const x = getTriggerX(side);
      trigger.style.left = `${x}px`;
      trigger.style.top = `${currentY}px`;

      savePosition({ y: currentY, side });

      setTimeout(() => {
        trigger.classList.remove('snapping');
      }, 520);
    } else {
      toggleSearch();
    }

    isDragging = false;
  };

  pill.addEventListener('mousedown', onMouseDown);

  // ---- 悬浮球 hover 状态管理 ----
  // 用 JS class 管理 hover 状态，避免 trigger 宽度区域拦截页面操作
  // pill/按钮/菜单共享 hovering 状态，离开后延迟移除以覆盖元素间间隙
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;
  const HOVER_LEAVE_DELAY = 200;

  const enterHover = () => {
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
    trigger.classList.add('hovering');
  };

  const leaveHover = () => {
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      trigger.classList.remove('hovering');
      hoverTimer = null;
    }, HOVER_LEAVE_DELAY);
  };

  for (const el of [pill, closeBtn, settingsBtn, closeMenuEl]) {
    el.addEventListener('mouseenter', enterHover);
    el.addEventListener('mouseleave', leaveHover);
  }

  // ---- 点击外部关闭（宿主页面） ----
  // 注意：closed Shadow DOM 下 composedPath() 不含内部节点，需检查 host
  document.addEventListener('mousedown', (e) => {
    const path = e.composedPath();
    // 点击宿主页面（Shadow DOM 外部）时关闭关闭菜单
    // 注意：closed Shadow DOM 下 document 只能看到 host，点击菜单项时 path 包含 host，不应关闭
    if (closeMenuEl.classList.contains('visible') && !path.includes(host)) {
      closeMenuEl.classList.remove('visible');
    }
    if (!isOpen) return;
    if (!path.includes(host)) {
      toggleSearch(false);
    }
  });

  // ESC 也要在宿主文档上监听
  document.addEventListener('keydown', (e) => {
    if (handleImageViewerHotkey(e.key)) {
      e.preventDefault();
      return;
    }
    // Esc 优先关闭关闭菜单
    if (e.key === 'Escape' && closeMenuEl.classList.contains('visible')) {
      closeMenuEl.classList.remove('visible');
      return;
    }
    if (e.key === 'Escape') {
      handleEscape();
    }
  });

  // 全局快捷键：Cmd+M (Mac) / Ctrl+M (Win) 唤起/关闭搜索框
  document.addEventListener('keydown', (e) => {
    const modKey = isMac ? e.metaKey : e.ctrlKey;
    if (modKey && e.key.toLowerCase() === 'm') {
      e.preventDefault();
      e.stopPropagation();
      toggleSearch();
    }
  });

  // ---- resize ----
  window.addEventListener('resize', () => {
    currentY = clampY(currentY);
    applyPosition();
    // resize 后重新补偿 host 位置（视口尺寸变化可能影响偏移量）
    compensateHostPosition();
  });
};

// ============ 辅助函数 ============

/** 转义 HTML 特殊字符 */
const escapeHtml = (text: string): string => {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};
