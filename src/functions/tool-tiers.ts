/**
 * 工具分层配置
 *
 * always-on 工具：每次对话始终注入 LLM
 * on-demand 工具：通过 load_tools 元工具按需加载
 */

/** always-on 工具名集合（始终注入） */
export const ALWAYS_ON_TOOLS: ReadonlySet<string> = new Set([
  'page',                  // 页面读取（合并后的统一工具）
  'cdp_input',             // 页面交互
  'tab_navigate',          // 标签页控制
  'screenshot',            // 截图
  'extract_data',          // 数据提取
  'data_pipeline',         // 数据管道
  'skill',                 // Skill 工作流
  'ask_user',              // 向用户提问
  'request_confirmation',  // 用户确认
  'save_workflow',         // 保存工作流
  'fetch_url',             // 远程获取网页
  'selection_context',     // 选中文本
]);

/** on-demand 工具分类映射 */
export const ON_DEMAND_CATEGORIES: Record<string, {
  label: string;
  description: string;
  tools: string[];
}> = {
  cdp_advanced: {
    label: 'CDP Advanced Tools',
    description: 'DOM manipulation, JS execution, network monitoring, device emulation, dialog handling, debugging tools',
    tools: ['cdp_dom', 'cdp_frame', 'cdp_network', 'cdp_emulation', 'cdp_dialog', 'cdp_debug'],
  },
  browser_utils: {
    label: 'Browser Utilities',
    description: 'Clipboard, notifications, bookmark management, history search, file download',
    tools: ['clipboard_ops', 'notification', 'webhook', 'bookmark_ops', 'history_search', 'download_file'],
  },
  data_storage: {
    label: 'Data Persistence',
    description: 'KV key-value storage, file download & save',
    tools: ['storage_kv', 'download_file'],
  },
  scheduling: {
    label: 'Scheduling',
    description: 'Timers, persistent background tasks',
    tools: ['timer', 'resident_runtime'],
  },
};

/** 根据分类名获取工具名列表（去重） */
export const getToolsByCategory = (category: string): string[] => {
  return ON_DEMAND_CATEGORIES[category]?.tools || [];
};

/** 构建按需工具目录文本（用于系统提示词） */
export const buildOnDemandCatalog = (): string => {
  const lines: string[] = [
    '\n## On-Demand Tools',
    'The following tools are not in the default toolset. Load the corresponding category via load_tools when needed:\n',
    '| Category | Description | How to Load |',
    '|----------|-------------|-------------|',
  ];
  for (const [key, cat] of Object.entries(ON_DEMAND_CATEGORIES)) {
    lines.push(`| ${cat.label} | ${cat.description} | load_tools(category="${key}") |`);
  }
  return lines.join('\n');
};
