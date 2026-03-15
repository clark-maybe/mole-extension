/**
 * 悬浮胶囊 — 常量与类型定义
 */

// ============ 模块级常量 ============

export const STORAGE_KEY = 'mole_float_ball_pos';
export const DISABLED_DOMAINS_KEY = 'mole_disabled_domains_v1';
export const DRAG_THRESHOLD = 5;
export const PILL_HEIGHT = 40;
export const PILL_WIDTH = 164;
export const PILL_COMPACT_WIDTH = 112;
export const LOGO_SIZE = 24;
// 收起时保留完整图标可见（两侧一致）
export const TUCK_OFFSET = 104;
export const EDGE_MARGIN = 12;
export const MAX_RECENT_COMPLETED_TASKS = 3;

export type RuntimeTextMode = 'current' | 'plan' | 'done' | 'issue' | 'ask';

export interface RecentCompletedTaskItem {
  sessionId: string;
  title: string;
  status: string;
  updatedAt: number;
}

// 平台检测
export const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
export const SHORTCUT_TEXT = isMac ? '⌘ M' : 'Ctrl M';

export type Side = 'left' | 'right';

export interface SavedPosition {
  y: number;
  side: Side;
}

// ============ initFloatBall 闭包内常量 ============

export const AGENT_PHASE_LABELS: Record<string, string> = {
  idle: '待机',
  plan: '规划',
  act: '执行',
  observe: '观察',
  verify: '校验',
  finalize: '完成',
};

export const SHOW_AGENT_STATE_PANEL = false;

export const INTERNAL_STATUS_HINT =
  /(子代理切换|你现在扮演|当前扮演|round\s*\d+|post_tool_execution_verify|router_initial_route|offering_instead_of_doing|调用链|检查点|调度状态|当前轮次|执行约束|当前优先子目标|下一步优先|本轮首选|优先使用|严格按当前策略推进|工具已执行完毕|不要反问用户|不要说|代理角色|tool calls?|tool_choice|function_call(?:_output)?)/i;

export const INTERNAL_STATUS_LINE_HINT =
  /^(?:[-*]\s*|\d+\.\s*)?(?:你现在扮演|当前扮演|角色[:：]|目标[:：]|依据[:：]|优先使用|当前优先子目标|下一步优先|本轮首选|当前策略|执行约束|工具已执行完毕|不要反问用户|不要说|严格按当前策略推进|聚焦当前子目标|检查点|调用链|代理角色|子代理|router|round\s*\d+|tool_choice|function_call(?:_output)?)/i;

export const INTERNAL_STATUS_SEGMENT_HINT =
  /(你现在扮演|当前扮演|子代理|代理角色|router|tool_choice|function_call(?:_output)?|post_tool_|round\s*\d+|当前优先子目标|下一步优先|本轮首选|执行约束|不要反问用户|不要说|严格按当前策略推进|工具已执行完毕|聚焦当前子目标)/i;
