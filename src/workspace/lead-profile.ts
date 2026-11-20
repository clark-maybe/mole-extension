/** 档案写入边界校验；仅接收销售摘要，不覆盖平台原始字段。 */
import type { LeadProfileContent } from './types';

export function parseLeadProfileContent(value: unknown): LeadProfileContent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请提供结构化企业档案');
  const input = value as Record<string, unknown>;
  const result: LeadProfileContent = { summary: '', tags: [] };
  for (const key of ['summary', 'business', 'region', 'activity', 'nextStep'] as const) {
    const item = input[key];
    if (item === undefined && key !== 'summary') continue;
    if (typeof item !== 'string' || item.length > 4000 || (key === 'summary' && !item.trim())) throw new Error(`档案 ${key} 需要 1–4000 字的文本`);
    result[key] = item.trim();
  }
  if (input.tags !== undefined) {
    if (!Array.isArray(input.tags) || input.tags.length > 12 || input.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 40)) throw new Error('档案标签最多 12 个，每个 1–40 字');
    result.tags = [...new Set(input.tags.map(tag => (tag as string).trim()))];
  }
  return result;
}

export const leadProfileHistoryKey = (leadId: string, revision: number): string => `lead-profile:${leadId}:${String(revision).padStart(10, '0')}`;
