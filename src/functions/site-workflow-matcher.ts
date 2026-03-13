/**
 * URL 匹配器
 * 根据当前页面 URL 过滤出匹配的站点工作流
 */

import type { SiteWorkflowSpec } from './site-workflow-registry';

const REGEX_PREFIX = 'regex:';

/** 将简单 glob pattern 转为正则（支持 * 通配符） */
const globToRegex = (pattern: string): RegExp => {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
};

/** 判断 URL 是否匹配单个 pattern */
const matchesPattern = (url: string, pattern: string): boolean => {
  try {
    if (pattern.startsWith(REGEX_PREFIX)) {
      const regex = new RegExp(pattern.slice(REGEX_PREFIX.length));
      return regex.test(url);
    }
    return globToRegex(pattern).test(url);
  } catch {
    return false;
  }
};

/**
 * 根据 URL 匹配可用的 workflow
 * 只返回 enabled 且至少一个 url_pattern 命中的 workflow
 */
export const matchWorkflows = (
  url: string,
  allWorkflows: SiteWorkflowSpec[],
): SiteWorkflowSpec[] => {
  if (!url) return [];
  return allWorkflows
    .filter(w => w.enabled && w.url_patterns.some(p => matchesPattern(url, p)))
    .sort((a, b) => a.name.localeCompare(b.name));
};
