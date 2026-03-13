/**
 * 站点经验记忆（本地缓存版）
 * 只做排序偏置，不做硬编码规则
 */

import Storage from '../lib/storage';
import type { ToolExecutionContext } from './types';

const SITE_EXPERIENCE_STORAGE_KEY = 'mole_site_experience_v1';
const SITE_EXPERIENCE_RECENT_REPAIR_STORAGE_KEY = 'mole_site_experience_recent_repair_v1';
const MAX_DOMAIN_ENTRIES = 40;
const MAX_TOTAL_DOMAINS = 60;
const RECENT_REPAIR_TTL_MS = 20 * 60 * 1000;

export interface SiteExperienceCandidateInput {
  element_id?: string;
  tag?: string;
  text?: string;
  label?: string;
  placeholder?: string;
  selector_candidates?: string[];
  clickable?: boolean;
  editable?: boolean;
  visible?: boolean;
  in_viewport?: boolean;
  repair_score?: number;
}

interface SiteExperienceEntry {
  key: string;
  hint: string;
  tag?: string;
  text?: string;
  label?: string;
  placeholder?: string;
  selector?: string;
  clickable?: boolean;
  editable?: boolean;
  strength: number;
  count: number;
  source: 'repair';
  updatedAt: number;
}

interface SiteExperienceDomainRecord {
  updatedAt: number;
  entries: SiteExperienceEntry[];
}

interface SiteExperienceStoreShape {
  version: 1;
  updatedAt: number;
  domains: Record<string, SiteExperienceDomainRecord>;
}

interface RecentRepairEntry {
  domain: string;
  hint: string;
  candidates: SiteExperienceCandidateInput[];
  createdAt: number;
}

export interface SiteExperienceBoostResult<T extends SiteExperienceCandidateInput> {
  candidates: Array<T & { experience_boost?: number; experience_matches?: number }>;
  matchedEntries: number;
}

const normalizeText = (raw: unknown): string => String(raw || '').replace(/\s+/g, ' ').trim();

const normalizeHint = (hint: string): string => normalizeText(hint).toLowerCase();

const tokenizeHint = (hint: string): string[] => {
  return normalizeHint(hint)
    .split(/[\s,，、/|]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
};

const buildEntryKey = (hint: string, candidate: SiteExperienceCandidateInput): string => {
  const selector = Array.isArray(candidate.selector_candidates) ? normalizeText(candidate.selector_candidates[0] || '') : '';
  return [
    normalizeHint(hint),
    normalizeText(candidate.tag || '').toLowerCase(),
    normalizeText(candidate.label || '').toLowerCase(),
    normalizeText(candidate.text || '').toLowerCase(),
    normalizeText(candidate.placeholder || '').toLowerCase(),
    selector.toLowerCase(),
  ].join('::');
};

const readStore = async (): Promise<SiteExperienceStoreShape> => {
  const stored = await Storage.get<SiteExperienceStoreShape>(SITE_EXPERIENCE_STORAGE_KEY);
  if (stored && stored.version === 1 && stored.domains && typeof stored.domains === 'object') {
    return stored;
  }
  return {
    version: 1,
    updatedAt: Date.now(),
    domains: {},
  };
};

const persistStore = async (store: SiteExperienceStoreShape): Promise<void> => {
  const domainEntries = Object.entries(store.domains)
    .sort((left, right) => Number(right[1]?.updatedAt || 0) - Number(left[1]?.updatedAt || 0))
    .slice(0, MAX_TOTAL_DOMAINS);
  const nextStore: SiteExperienceStoreShape = {
    version: 1,
    updatedAt: Date.now(),
    domains: Object.fromEntries(domainEntries),
  };
  await Storage.save(SITE_EXPERIENCE_STORAGE_KEY, nextStore);
};

const readRecentRepairMap = async (): Promise<Record<string, RecentRepairEntry>> => {
  const stored = await Storage.get<Record<string, RecentRepairEntry>>(SITE_EXPERIENCE_RECENT_REPAIR_STORAGE_KEY);
  if (!stored || typeof stored !== 'object') return {};
  const now = Date.now();
  return Object.fromEntries(
    Object.entries(stored).filter(([, value]) => {
      return value && typeof value === 'object' && now - Number(value.createdAt || 0) <= RECENT_REPAIR_TTL_MS;
    }),
  );
};

const persistRecentRepairMap = async (map: Record<string, RecentRepairEntry>): Promise<void> => {
  await Storage.save(SITE_EXPERIENCE_RECENT_REPAIR_STORAGE_KEY, map);
};

const getDomainFromUrl = (url: string): string | null => {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
};

export const resolveSiteExperienceDomain = async (context?: ToolExecutionContext): Promise<string | null> => {
  try {
    if (typeof context?.tabId === 'number') {
      const tab = await chrome.tabs.get(context.tabId);
      return getDomainFromUrl(tab.url || tab.pendingUrl || '');
    }
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return getDomainFromUrl(activeTab?.url || activeTab?.pendingUrl || '');
  } catch {
    return null;
  }
};

const computeHintSimilarity = (entryHint: string, runtimeHint: string): number => {
  const left = tokenizeHint(entryHint);
  const right = tokenizeHint(runtimeHint);
  if (left.length === 0 || right.length === 0) {
    return normalizeHint(entryHint) === normalizeHint(runtimeHint) ? 1 : 0;
  }
  const rightSet = new Set(right);
  const overlap = left.filter((token) => rightSet.has(token)).length;
  if (overlap === 0) return 0;
  return overlap / Math.max(left.length, right.length);
};

const computeCandidateBoost = (entry: SiteExperienceEntry, candidate: SiteExperienceCandidateInput, runtimeHint: string): number => {
  const hintSimilarity = runtimeHint ? computeHintSimilarity(entry.hint, runtimeHint) : 0.4;
  if (runtimeHint && hintSimilarity <= 0) return 0;

  let boost = entry.strength * (runtimeHint ? 6 * hintSimilarity : 2);
  const text = normalizeText(candidate.text || '').toLowerCase();
  const label = normalizeText(candidate.label || '').toLowerCase();
  const placeholder = normalizeText(candidate.placeholder || '').toLowerCase();
  const selector = Array.isArray(candidate.selector_candidates) ? normalizeText(candidate.selector_candidates[0] || '').toLowerCase() : '';

  if (entry.selector && selector && selector === entry.selector.toLowerCase()) boost += 16;
  if (entry.label && label && label === entry.label.toLowerCase()) boost += 12;
  if (entry.text && text && text === entry.text.toLowerCase()) boost += 10;
  if (entry.placeholder && placeholder && placeholder === entry.placeholder.toLowerCase()) boost += 8;
  if (entry.label && label && label.includes(entry.label.toLowerCase())) boost += 4;
  if (entry.text && text && text.includes(entry.text.toLowerCase())) boost += 4;
  if (entry.tag && normalizeText(candidate.tag || '').toLowerCase() === entry.tag.toLowerCase()) boost += 2;
  if (entry.clickable && candidate.clickable) boost += 1;
  if (entry.editable && candidate.editable) boost += 1;
  return boost;
};

export const applySiteExperienceBoost = async <T extends SiteExperienceCandidateInput>(
  domain: string | null,
  runtimeHint: string,
  candidates: T[],
): Promise<SiteExperienceBoostResult<T>> => {
  if (!domain || candidates.length === 0) {
    return { candidates, matchedEntries: 0 };
  }

  const store = await readStore();
  const domainRecord = store.domains[domain];
  if (!domainRecord || !Array.isArray(domainRecord.entries) || domainRecord.entries.length === 0) {
    return { candidates, matchedEntries: 0 };
  }

  let matchedEntries = 0;
  const nextCandidates = candidates.map((candidate) => {
    let experienceBoost = 0;
    let experienceMatches = 0;
    for (const entry of domainRecord.entries) {
      const boost = computeCandidateBoost(entry, candidate, runtimeHint);
      if (boost <= 0) continue;
      matchedEntries++;
      experienceMatches++;
      experienceBoost += boost;
    }
    return {
      ...candidate,
      ...(experienceBoost > 0 ? { experience_boost: experienceBoost } : {}),
      ...(experienceMatches > 0 ? { experience_matches: experienceMatches } : {}),
    };
  });

  nextCandidates.sort((left, right) => {
    const rightScore = Number((right as any).repair_score || 0) + Number((right as any).experience_boost || 0);
    const leftScore = Number((left as any).repair_score || 0) + Number((left as any).experience_boost || 0);
    return rightScore - leftScore;
  });

  return { candidates: nextCandidates, matchedEntries };
};

export const rememberSiteRepairExperience = async (
  domain: string | null,
  runtimeHint: string,
  candidates: SiteExperienceCandidateInput[],
): Promise<void> => {
  if (!domain || !runtimeHint || candidates.length === 0) return;

  const store = await readStore();
  const domainRecord: SiteExperienceDomainRecord = store.domains[domain] || {
    updatedAt: Date.now(),
    entries: [],
  };

  const now = Date.now();
  const nextEntries = [...domainRecord.entries];
  for (const candidate of candidates.slice(0, 3)) {
    const key = buildEntryKey(runtimeHint, candidate);
    const existingIndex = nextEntries.findIndex((entry) => entry.key === key);
    if (existingIndex >= 0) {
      const current = nextEntries[existingIndex];
      nextEntries[existingIndex] = {
        ...current,
        strength: Math.min(current.strength + 1, 12),
        count: current.count + 1,
        updatedAt: now,
      };
      continue;
    }

    nextEntries.push({
      key,
      hint: runtimeHint,
      tag: normalizeText(candidate.tag || '') || undefined,
      text: normalizeText(candidate.text || '') || undefined,
      label: normalizeText(candidate.label || '') || undefined,
      placeholder: normalizeText(candidate.placeholder || '') || undefined,
      selector: Array.isArray(candidate.selector_candidates) ? normalizeText(candidate.selector_candidates[0] || '') || undefined : undefined,
      clickable: candidate.clickable === true,
      editable: candidate.editable === true,
      strength: 2,
      count: 1,
      source: 'repair',
      updatedAt: now,
    });
  }

  domainRecord.updatedAt = now;
  domainRecord.entries = nextEntries
    .sort((left, right) => {
      const rightScore = right.strength * 100 + right.count * 10 + Math.floor(right.updatedAt / 1000);
      const leftScore = left.strength * 100 + left.count * 10 + Math.floor(left.updatedAt / 1000);
      return rightScore - leftScore;
    })
    .slice(0, MAX_DOMAIN_ENTRIES);
  store.domains[domain] = domainRecord;
  await persistStore(store);
};

export const markRecentSiteRepair = async (
  domain: string | null,
  runtimeHint: string,
  candidates: SiteExperienceCandidateInput[],
): Promise<void> => {
  if (!domain || candidates.length === 0) return;
  const recentMap = await readRecentRepairMap();
  recentMap[domain] = {
    domain,
    hint: runtimeHint,
    candidates: candidates.slice(0, 5),
    createdAt: Date.now(),
  };
  await persistRecentRepairMap(recentMap);
};


export const replayRecentSiteRepair = async (
  domain: string | null,
  runtimeHint: string,
  maxCount: number = 3,
): Promise<{ candidates: SiteExperienceCandidateInput[]; sourceHint?: string; ageMs?: number }> => {
  if (!domain) {
    return { candidates: [] };
  }
  const recentMap = await readRecentRepairMap();
  const recent = recentMap[domain];
  if (!recent || !Array.isArray(recent.candidates) || recent.candidates.length === 0) {
    return { candidates: [] };
  }

  const similarity = runtimeHint ? computeHintSimilarity(recent.hint, runtimeHint) : 1;
  if (runtimeHint && similarity <= 0) {
    return { candidates: [] };
  }

  return {
    candidates: recent.candidates.slice(0, Math.max(1, maxCount)).map((candidate, index) => ({
      ...candidate,
      repair_score: Math.max(Number(candidate.repair_score || 0), 14 - index * 2),
    })),
    sourceHint: recent.hint,
    ageMs: Math.max(0, Date.now() - Number(recent.createdAt || 0)),
  };
};

export const reinforceRecentSiteRepairSuccess = async (domain: string | null): Promise<void> => {
  if (!domain) return;
  const recentMap = await readRecentRepairMap();
  const recent = recentMap[domain];
  if (!recent) return;

  const store = await readStore();
  const domainRecord: SiteExperienceDomainRecord = store.domains[domain] || {
    updatedAt: Date.now(),
    entries: [],
  };
  const now = Date.now();
  const nextEntries = [...domainRecord.entries];

  for (const candidate of recent.candidates.slice(0, 3)) {
    const key = buildEntryKey(recent.hint, candidate);
    const existingIndex = nextEntries.findIndex((entry) => entry.key === key);
    if (existingIndex >= 0) {
      const current = nextEntries[existingIndex];
      nextEntries[existingIndex] = {
        ...current,
        strength: Math.min(current.strength + 3, 20),
        count: current.count + 2,
        updatedAt: now,
      };
      continue;
    }

    nextEntries.push({
      key,
      hint: recent.hint,
      tag: normalizeText(candidate.tag || '') || undefined,
      text: normalizeText(candidate.text || '') || undefined,
      label: normalizeText(candidate.label || '') || undefined,
      placeholder: normalizeText(candidate.placeholder || '') || undefined,
      selector: Array.isArray(candidate.selector_candidates) ? normalizeText(candidate.selector_candidates[0] || '') || undefined : undefined,
      clickable: candidate.clickable === true,
      editable: candidate.editable === true,
      strength: 5,
      count: 2,
      source: 'repair',
      updatedAt: now,
    });
  }

  domainRecord.updatedAt = now;
  domainRecord.entries = nextEntries
    .sort((left, right) => {
      const rightScore = right.strength * 100 + right.count * 10 + Math.floor(right.updatedAt / 1000);
      const leftScore = left.strength * 100 + left.count * 10 + Math.floor(left.updatedAt / 1000);
      return rightScore - leftScore;
    })
    .slice(0, MAX_DOMAIN_ENTRIES);
  store.domains[domain] = domainRecord;
  await persistStore(store);

  delete recentMap[domain];
  await persistRecentRepairMap(recentMap);
};
