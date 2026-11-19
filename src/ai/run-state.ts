/** 跨阶段、跨子 Agent 共享的任务边界，不随上下文压缩而清空。 */
import { WebAccessGuard } from '../lib/web-access';
import { WebNavigationObserver } from '../lib/web-navigation';
import type { WebAccessSnapshot } from '../lib/web-access';
import type { LoopBudget } from './loop-config';

export const createRunState = (budget: LoopBudget, snapshot?: WebAccessSnapshot) => ({
  webAccess: new WebAccessGuard(snapshot),
  webNavigation: new WebNavigationObserver(),
  rounds: 0,
  toolCalls: 0,
  failureRounds: 0,
  failedSignatures: new Map<string, number>(),
  maxRounds: budget.maxRounds,
  maxToolCalls: budget.maxToolCalls,
});

export type AgentRunState = ReturnType<typeof createRunState>;

/** 记账/工具发现不代表网页任务获得了新进展。 */
export const isProgressTool = (name: string, args: string): boolean => {
  if (['todo', 'compact', 'load_tools'].includes(name)) return false;
  try {
    return !(name === 'tab_navigate' && ['list', 'current', 'switch'].includes(JSON.parse(args).action));
  } catch { return true; }
};
