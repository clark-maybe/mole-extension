/**
 * 页面修复工具（v2）
 * 在动作失败或断言未通过后，执行多步通用恢复策略：多 query 快照、多方向滚动、整页扩展快照、候选合并重排
 */

import type { FunctionDefinition, ToolExecutionContext, FunctionResult } from './types';
import { pageSnapshotFunction } from './page-snapshot';
import { cdpInputFunction } from './cdp-input';
import { pageViewerFunction } from './page-viewer';
import {
  applySiteExperienceBoost,
  markRecentSiteRepair,
  rememberSiteRepairExperience,
  replayRecentSiteRepair,
  resolveSiteExperienceDomain,
} from './site-experience';

interface PageRepairParams {
  target_hint?: string;
  scope_selector?: string;
  attempts?: number;
  scroll_amount?: number;
}

interface RepairTraceItem {
  step: string;
  success: boolean;
  candidate_count?: number;
  note?: string;
  error?: string;
  query?: string;
}

interface RepairCandidate {
  element_id?: string;
  tag?: string;
  text?: string;
  label?: string;
  placeholder?: string;
  clickable?: boolean;
  editable?: boolean;
  visible?: boolean;
  in_viewport?: boolean;
  score?: number;
  selector_candidates?: string[];
  repair_score?: number;
  repair_queries?: string[];
  repair_sources?: string[];
}

const normalizeText = (raw: unknown): string => String(raw || '').replace(/\s+/g, ' ').trim();

const getSnapshotCandidates = (result: FunctionResult): RepairCandidate[] => {
  if (!result.success || !Array.isArray(result.data?.elements)) return [];
  return result.data.elements as RepairCandidate[];
};

const tokenizeHint = (hint: string): string[] => {
  return normalizeText(hint)
    .split(/[\s,，、/|]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
};

const inferHintVariants = (hint: string): string[] => {
  const text = normalizeText(hint);
  if (!text) return [];

  const variants = new Set<string>([text]);
  for (const token of tokenizeHint(text)) {
    variants.add(token);
  }

  const pushGroup = (matched: boolean, group: string[]) => {
    if (!matched) return;
    group.forEach((item) => variants.add(item));
  };

  pushGroup(/搜索|查询|查找|search/i.test(text), ['搜索框', '搜索', '查询', '查找']);
  pushGroup(/发送|提交|确定|发布|save|submit|send/i.test(text), ['发送', '提交', '确定', '按钮']);
  pushGroup(/登录|登陆|sign in|signin|log in|login/i.test(text), ['登录', '登陆', 'sign in', 'login']);
  pushGroup(/邮箱|email/i.test(text), ['邮箱', 'email']);
  pushGroup(/密码|password|pwd/i.test(text), ['密码', 'password']);
  pushGroup(/手机|电话|phone|tel/i.test(text), ['手机', '电话', 'phone']);
  pushGroup(/下一步|继续|next/i.test(text), ['下一步', '继续', 'next']);

  return Array.from(variants).slice(0, 8);
};

const buildCandidateKey = (candidate: RepairCandidate): string => {
  const selector = Array.isArray(candidate.selector_candidates) ? candidate.selector_candidates[0] : '';
  return candidate.element_id || `${selector}::${candidate.tag || ''}::${candidate.text || ''}::${candidate.label || ''}`;
};

const scoreRepairCandidate = (candidate: RepairCandidate, query: string, sourceStep: string): number => {
  let score = Number(candidate.score || 0);
  const haystack = [candidate.text, candidate.label, candidate.placeholder].map((item) => normalizeText(item).toLowerCase()).join(' ');
  const normalizedQuery = normalizeText(query).toLowerCase();
  if (normalizedQuery && haystack.includes(normalizedQuery)) score += 8;
  for (const token of tokenizeHint(normalizedQuery)) {
    if (haystack.includes(token.toLowerCase())) score += 3;
  }
  if (candidate.visible) score += 4;
  if (candidate.in_viewport) score += 4;
  if (candidate.clickable) score += 3;
  if (candidate.editable) score += 3;
  if (sourceStep.includes('full_page')) score -= 2;
  if (sourceStep.includes('after_scroll')) score += 1;
  return score;
};

const mergeRepairCandidates = (
  accumulator: Map<string, RepairCandidate>,
  candidates: RepairCandidate[],
  query: string,
  sourceStep: string,
): void => {
  for (const rawCandidate of candidates) {
    const key = buildCandidateKey(rawCandidate);
    const nextScore = scoreRepairCandidate(rawCandidate, query, sourceStep);
    const current = accumulator.get(key);
    if (!current) {
      accumulator.set(key, {
        ...rawCandidate,
        repair_score: nextScore,
        repair_queries: query ? [query] : [],
        repair_sources: [sourceStep],
      });
      continue;
    }

    accumulator.set(key, {
      ...current,
      ...rawCandidate,
      repair_score: Math.max(Number(current.repair_score || 0), nextScore),
      repair_queries: Array.from(new Set([...(current.repair_queries || []), ...(query ? [query] : [])])),
      repair_sources: Array.from(new Set([...(current.repair_sources || []), sourceStep])),
    });
  }
};

const runSnapshotStep = async (
  query: string | undefined,
  params: {
    step: string;
    note: string;
    scope_selector?: string;
    only_viewport?: boolean;
    include_non_interactive?: boolean;
    limit?: number;
  },
  context?: ToolExecutionContext,
): Promise<{ result: FunctionResult; trace: RepairTraceItem }> => {
  const result = await pageSnapshotFunction.execute({
    query,
    scope_selector: params.scope_selector,
    only_viewport: params.only_viewport,
    include_non_interactive: params.include_non_interactive,
    limit: params.limit,
  }, context);

  return {
    result,
    trace: {
      step: params.step,
      success: result.success,
      candidate_count: getSnapshotCandidates(result).length,
      error: result.error,
      note: params.note,
      query,
    },
  };
};

export const pageRepairFunction: FunctionDefinition = {
  name: 'page_repair',
  description: [
    '在页面动作失败或断言未通过后执行通用修复策略。',
    '会尝试多 query 语义快照、向下/向上滚动、整页扩展快照，并将候选元素合并重排。',
    '适合陌生网站恢复定位，不依赖硬编码站点规则。',
  ].join(' '),
  supportsParallel: false,
  parameters: {
    type: 'object',
    properties: {
      target_hint: {
        type: 'string',
        description: '目标提示词，如“搜索框”“发送按钮”“登录”。会用于重新定位候选元素，并自动扩展相近词。',
      },
      scope_selector: {
        type: 'string',
        description: '可选：将修复范围限制在某个区域。',
      },
      attempts: {
        type: 'number',
        description: '最多执行几层修复策略，范围 1-5，默认 5。',
      },
      scroll_amount: {
        type: 'number',
        description: '滚动像素量，默认 720。',
      },
    },
    required: [],
  },
  execute: async (params: PageRepairParams, context?: ToolExecutionContext) => {
    const targetHint = normalizeText(params.target_hint || '');
    const scopeSelector = normalizeText(params.scope_selector || '') || undefined;
    const attempts = Math.min(Math.max(Math.floor(Number(params.attempts) || 5), 1), 5);
    const scrollAmount = Math.max(200, Math.floor(Number(params.scroll_amount) || 720));
    const trace: RepairTraceItem[] = [];
    const mergedCandidates = new Map<string, RepairCandidate>();
    const queryVariants = inferHintVariants(targetHint);
    const primaryQueries = queryVariants.length > 0 ? queryVariants : [''];
    const experienceDomain = await resolveSiteExperienceDomain(context);
    const replayed = await replayRecentSiteRepair(experienceDomain, targetHint, 3);
    if (replayed.candidates.length > 0) {
      mergeRepairCandidates(mergedCandidates, replayed.candidates as RepairCandidate[], replayed.sourceHint || targetHint, 'memory_replay');
      trace.push({
        step: 'memory_replay',
        success: true,
        candidate_count: replayed.candidates.length,
        note: replayed.ageMs != null
          ? `复用最近修复候选（${Math.floor(replayed.ageMs / 1000)}s 前）`
          : '复用最近修复候选',
        query: replayed.sourceHint || targetHint || undefined,
      });
    }

    const maybeReturnIfEnough = async (strategy: string, minCount: number = 1) => {
      const boosted = await applySiteExperienceBoost(
        experienceDomain,
        targetHint,
        Array.from(mergedCandidates.values()),
      );
      const candidates = boosted.candidates.slice(0, 10);
      if (candidates.length < minCount) return null;
      await rememberSiteRepairExperience(experienceDomain, targetHint, candidates);
      await markRecentSiteRepair(experienceDomain, targetHint, candidates);
      return {
        success: true,
        data: {
          repaired: true,
          strategy,
          experience_domain: experienceDomain || undefined,
          experience_matches: boosted.matchedEntries,
          target_hint: targetHint || undefined,
          query_variants: queryVariants,
          trace,
          candidates,
          message: `修复成功：找到 ${candidates.length} 个候选元素`,
        },
      };
    };

    const earlyMemoryReplay = replayed.candidates.length > 0 && (replayed.ageMs ?? Number.MAX_SAFE_INTEGER) <= 90 * 1000
      ? await maybeReturnIfEnough('memory_replay')
      : null;
    if (earlyMemoryReplay) return earlyMemoryReplay;

    for (const query of primaryQueries.slice(0, 3)) {
      const snapshot = await runSnapshotStep(query, {
        step: 'viewport_snapshot',
        note: '当前视口内查找候选元素',
        scope_selector: scopeSelector,
        only_viewport: true,
        limit: 8,
      }, context);
      trace.push(snapshot.trace);
      mergeRepairCandidates(mergedCandidates, getSnapshotCandidates(snapshot.result), query, 'viewport_snapshot');
    }
    if (attempts <= 1) {
      return await maybeReturnIfEnough('viewport_snapshot') || {
        success: true,
        data: {
          repaired: false,
          strategy: 'viewport_snapshot',
          experience_domain: experienceDomain || undefined,
          target_hint: targetHint || undefined,
          query_variants: queryVariants,
          trace,
          candidates: [],
          message: '已执行视口修复，但未找到候选元素。',
        },
      };
    }
    const earlyViewport = await maybeReturnIfEnough('viewport_snapshot');
    if (earlyViewport) return earlyViewport;

    const scrollDownResult = await cdpInputFunction.execute({
      action: 'scroll',
      direction: 'down',
      amount: scrollAmount,
    }, context);
    trace.push({
      step: 'scroll_down',
      success: scrollDownResult.success,
      error: scrollDownResult.error,
      note: `向下滚动 ${scrollAmount}px`,
    });
    for (const query of primaryQueries.slice(0, 2)) {
      const snapshot = await runSnapshotStep(query, {
        step: 'viewport_snapshot_after_scroll_down',
        note: '向下滚动后重新查找候选元素',
        scope_selector: scopeSelector,
        only_viewport: true,
        limit: 8,
      }, context);
      trace.push(snapshot.trace);
      mergeRepairCandidates(mergedCandidates, getSnapshotCandidates(snapshot.result), query, 'viewport_snapshot_after_scroll_down');
    }
    if (attempts <= 2) {
      return await maybeReturnIfEnough('scroll_down_then_snapshot') || {
        success: true,
        data: {
          repaired: false,
          strategy: 'scroll_down_then_snapshot',
          experience_domain: experienceDomain || undefined,
          target_hint: targetHint || undefined,
          query_variants: queryVariants,
          trace,
          candidates: [],
          message: '已执行向下滚动修复，但未找到候选元素。',
        },
      };
    }
    const afterDown = await maybeReturnIfEnough('scroll_down_then_snapshot');
    if (afterDown) return afterDown;

    const scrollUpResult = await cdpInputFunction.execute({
      action: 'scroll',
      direction: 'up',
      amount: Math.max(200, Math.floor(scrollAmount * 0.75)),
    }, context);
    trace.push({
      step: 'scroll_up',
      success: scrollUpResult.success,
      error: scrollUpResult.error,
      note: '回滚视口，避免错过页首入口',
    });
    for (const query of primaryQueries.slice(0, 2)) {
      const snapshot = await runSnapshotStep(query, {
        step: 'viewport_snapshot_after_scroll_up',
        note: '向上滚动后重新查找候选元素',
        scope_selector: scopeSelector,
        only_viewport: true,
        limit: 8,
      }, context);
      trace.push(snapshot.trace);
      mergeRepairCandidates(mergedCandidates, getSnapshotCandidates(snapshot.result), query, 'viewport_snapshot_after_scroll_up');
    }
    if (attempts <= 3) {
      return await maybeReturnIfEnough('scroll_roundtrip_snapshot') || {
        success: true,
        data: {
          repaired: false,
          strategy: 'scroll_roundtrip_snapshot',
          experience_domain: experienceDomain || undefined,
          target_hint: targetHint || undefined,
          query_variants: queryVariants,
          trace,
          candidates: [],
          message: '已执行往返滚动修复，但未找到候选元素。',
        },
      };
    }
    const afterRoundtrip = await maybeReturnIfEnough('scroll_roundtrip_snapshot');
    if (afterRoundtrip) return afterRoundtrip;

    for (const query of (queryVariants.length > 0 ? queryVariants : ['']).slice(0, 4)) {
      const snapshot = await runSnapshotStep(query || undefined, {
        step: 'full_page_snapshot',
        note: '扩大到整页范围后查找候选元素',
        scope_selector: scopeSelector,
        only_viewport: false,
        limit: 10,
      }, context);
      trace.push(snapshot.trace);
      mergeRepairCandidates(mergedCandidates, getSnapshotCandidates(snapshot.result), query, 'full_page_snapshot');
    }
    if (attempts <= 4) {
      return await maybeReturnIfEnough('full_page_snapshot') || {
        success: true,
        data: {
          repaired: false,
          strategy: 'full_page_snapshot',
          experience_domain: experienceDomain || undefined,
          target_hint: targetHint || undefined,
          query_variants: queryVariants,
          trace,
          candidates: [],
          message: '已执行整页修复，但未找到候选元素。',
        },
      };
    }
    const afterFullPage = await maybeReturnIfEnough('full_page_snapshot');
    if (afterFullPage) return afterFullPage;

    for (const query of (queryVariants.length > 0 ? queryVariants : ['']).slice(0, 5)) {
      const snapshot = await runSnapshotStep(query || undefined, {
        step: 'full_page_expanded_snapshot',
        note: '扩大到整页并包含非交互元素后重试',
        scope_selector: scopeSelector,
        include_non_interactive: true,
        only_viewport: false,
        limit: 12,
      }, context);
      trace.push(snapshot.trace);
      mergeRepairCandidates(mergedCandidates, getSnapshotCandidates(snapshot.result), query, 'full_page_expanded_snapshot');
    }
    const afterExpanded = await maybeReturnIfEnough('full_page_expanded_snapshot');
    if (afterExpanded) return afterExpanded;

    const fallbackViewer = await pageViewerFunction.execute({
      sections: ['headings', 'meta'],
      max_content_length: 1200,
    }, context);
    trace.push({
      step: 'fallback_page_viewer',
      success: fallbackViewer.success,
      error: fallbackViewer.error,
      note: '未找到候选元素，补充页面结构信息',
    });

    return {
      success: true,
      data: {
        repaired: false,
        strategy: 'fallback_observation',
        experience_domain: experienceDomain || undefined,
        target_hint: targetHint || undefined,
        query_variants: queryVariants,
        trace,
        candidates: [],
        page_context: fallbackViewer.success ? fallbackViewer.data : undefined,
        message: '修复流程已执行，但仍未找到可靠候选元素。建议基于当前页面结构重新判断目标。',
      },
    };
  },
};
