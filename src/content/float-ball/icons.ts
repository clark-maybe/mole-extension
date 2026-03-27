/**
 * 悬浮胶囊 — 函数图标与中文标签
 */

// 网页查看 logo（放大镜+页面）
const LOGO_PAGE_VIEWER = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><path d="M490.666667 384c-58.88 0-106.666667 47.786667-106.666667 106.666667s47.786667 106.666667 106.666667 106.666666 106.666667-47.786667 106.666666-106.666666-47.786667-106.666667-106.666666-106.666667zM853.333333 170.666667H170.666667c-47.146667 0-85.333333 38.186667-85.333334 85.333333v512c0 47.146667 38.186667 85.333333 85.333334 85.333333h682.666666c47.146667 0 85.333333-38.186667 85.333334-85.333333V256c0-47.146667-38.186667-85.333333-85.333334-85.333333z m-136.746666 606.08l-123.946667-123.946667c-29.653333 18.773333-64.426667 29.866667-101.973333 29.866667a192 192 0 1 1 192-192c0 37.546667-11.093333 72.32-29.866667 101.76l124.16 123.733333-60.373333 60.586667z" fill="#0071e3"/></svg>')}`;

// 获取网页（地球）
const LOGO_FETCH_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>')}`;

// 标签页导航
const LOGO_TAB_NAVIGATE = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="14" rx="2"/><path d="M3 7l4-4h6l4 4"/><line x1="9" y1="3" x2="9" y2="7"/></svg>')}`;

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

// 站点工作流（齿轮+闪电）
const LOGO_SITE_WORKFLOW = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>')}`;

// 页面骨架（树形结构）
const LOGO_PAGE_SKELETON = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="9" x2="9" y2="21"/></svg>')}`;

// CDP 输入（鼠标指针+闪电，红色）
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

// CDP 高亮标注（靶心图标，石板蓝色）
const LOGO_CDP_OVERLAY = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>')}`;

// 数据提取（表格+放大镜，翠绿色）
const LOGO_EXTRACT_DATA = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/><circle cx="18" cy="18" r="3" fill="white" stroke="#059669" stroke-width="1.5"/><line x1="20" y1="20" x2="22" y2="22" stroke="#059669" stroke-width="1.5"/></svg>')}`;

// 数据管道（漏斗+箭头，靛蓝色）
const LOGO_DATA_PIPELINE = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>')}`;

// 请求确认（盾牌+勾号，蓝绿色）
export const LOGO_REQUEST_CONFIRMATION = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#0d9488" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10" stroke="#0d9488" stroke-width="2.5"/></svg>')}`;
const LOGO_SAVE_WORKFLOW = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>')}`;

// 向用户提问（问号气泡，靛蓝色）
export const LOGO_ASK_USER = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M12 8a1.5 1.5 0 0 0-1.5 1.5c0 .5.5 1 1.5 1.5" stroke="#4f46e5" stroke-width="2"/><circle cx="12" cy="14" r="0.5" fill="#4f46e5" stroke="none"/></svg>')}`;

// 任务规划（清单勾选，青色）
const LOGO_TODO = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#0891b2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>')}`;

// 探索侦察（望远镜，琥珀色）
const LOGO_EXPLORE = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><path d="M11 8a3 3 0 0 0-3 3"/><circle cx="11" cy="11" r="2" fill="none" stroke="#d97706" stroke-width="1.5"/></svg>')}`;

// 上下文压缩（折叠/压缩图标，石板灰色）
const LOGO_COMPACT = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>')}`;

// 任务规划（路线图/地图标记，靛蓝色）
const LOGO_PLAN = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg>')}`;

// 审查验证（盾牌打勾，翠绿色）
const LOGO_REVIEW = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>')}`;

// 函数图标映射（函数名 → logo）
export const FUNCTION_ICONS: Record<string, string> = {
  page_viewer: LOGO_PAGE_VIEWER,
  fetch_url: LOGO_FETCH_URL,
  tab_navigate: LOGO_TAB_NAVIGATE,
  clipboard_ops: LOGO_CLIPBOARD,
  screenshot: LOGO_SCREENSHOT,
  selection_context: LOGO_SELECTION,
  storage_kv: LOGO_STORAGE,
  timer: LOGO_TIMEOUT,
  notification: LOGO_NOTIFICATION,
  bookmark_ops: LOGO_BOOKMARK,
  history_search: LOGO_HISTORY,
  download_file: LOGO_DOWNLOAD,
  resident_runtime: LOGO_INTERVAL,
  site_workflow: LOGO_SITE_WORKFLOW,
  skill: LOGO_SITE_WORKFLOW,
  page_skeleton: LOGO_PAGE_SKELETON,
  cdp_input: LOGO_CDP_INPUT,
  cdp_dialog: LOGO_CDP_DIALOG,
  cdp_frame: LOGO_CDP_FRAME,
  cdp_network: LOGO_CDP_NETWORK,
  cdp_emulation: LOGO_CDP_EMULATION,
  cdp_console: LOGO_CDP_CONSOLE,
  cdp_fetch: LOGO_CDP_FETCH,
  cdp_dom: LOGO_CDP_DOM,
  cdp_overlay: LOGO_CDP_OVERLAY,
  extract_data: LOGO_EXTRACT_DATA,
  data_pipeline: LOGO_DATA_PIPELINE,
  request_confirmation: LOGO_REQUEST_CONFIRMATION,
  ask_user: LOGO_ASK_USER,
  save_workflow: LOGO_SAVE_WORKFLOW,
  todo: LOGO_TODO,
  explore: LOGO_EXPLORE,
  compact: LOGO_COMPACT,
  plan: LOGO_PLAN,
  review: LOGO_REVIEW,
};

// 函数中文名映射（用户可见，不暴露英文标识）
export const FUNCTION_LABELS: Record<string, string> = {
  page_viewer: '网页查看',
  fetch_url: '获取网页',
  tab_navigate: '标签页管理',
  clipboard_ops: '剪贴板',
  screenshot: '页面截图',
  selection_context: '选中文本',
  storage_kv: '数据存储',
  timer: '定时器',
  notification: '发送通知',
  bookmark_ops: '收藏管理',
  history_search: '历史记录',
  download_file: '下载文件',
  resident_runtime: '常驻运行',
  site_workflow: '站点流程',
  skill: '技能执行',
  page_skeleton: '页面骨架',
  cdp_input: '页面操作',
  cdp_dialog: '对话框处理',
  cdp_frame: 'JS 执行',
  cdp_network: '网络与 Cookie',
  cdp_emulation: '设备模拟',
  cdp_console: '控制台捕获',
  cdp_fetch: '请求拦截',
  cdp_dom: 'DOM 操作',
  cdp_overlay: '元素高亮',
  extract_data: '数据提取',
  data_pipeline: '数据管道',
  request_confirmation: '请求确认',
  ask_user: '向用户提问',
  save_workflow: '保存工作流',
  todo: '任务规划',
  explore: '探索',
  compact: '压缩',
  plan: '规划',
  review: '审查',
};
