/**
 * 网络请求监听会话管理
 * 负责记录请求事件，供工具函数查询与汇总。
 */

export interface NetworkEventItem {
  timestamp: number;
  tabId: number;
  requestId: string;
  phase: 'completed' | 'error';
  method: string;
  url: string;
  resourceType: string;
  statusCode?: number;
  statusLine?: string;
  ip?: string;
  fromCache?: boolean;
  initiator?: string;
  error?: string;
  durationMs?: number;
}

export interface NetworkMonitorSession {
  id: string;
  tabId: number;
  urlPatterns: string[];
  resourceTypes: string[];
  maxEvents: number;
  active: boolean;
  createdAt: number;
}

interface RequestStartInfo {
  startedAt: number;
}

const sessions = new Map<string, NetworkMonitorSession>();
const sessionEvents = new Map<string, NetworkEventItem[]>();
const requestStarts = new Map<string, RequestStartInfo>();

const DEFAULT_MAX_EVENTS = 300;

const escapeRegex = (input: string): string => input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const matchesPattern = (url: string, pattern: string): boolean => {
  if (!pattern || pattern === '*') return true;
  // 支持 wildcard（*）与直接子串匹配
  if (!pattern.includes('*')) return url.includes(pattern);
  const regexText = `^${pattern.split('*').map(escapeRegex).join('.*')}$`;
  try {
    return new RegExp(regexText).test(url);
  } catch {
    return false;
  }
};

const matchSession = (
  session: NetworkMonitorSession,
  input: { tabId: number; url: string; resourceType?: string },
): boolean => {
  if (!session.active) return false;
  if (session.tabId !== input.tabId) return false;
  if (session.urlPatterns.length > 0 && !session.urlPatterns.some((pattern) => matchesPattern(input.url, pattern))) {
    return false;
  }
  if (
    session.resourceTypes.length > 0
    && input.resourceType
    && !session.resourceTypes.includes(input.resourceType)
  ) {
    return false;
  }
  return true;
};

const pushEvent = (monitorId: string, event: NetworkEventItem) => {
  const events = sessionEvents.get(monitorId) || [];
  events.push(event);
  const session = sessions.get(monitorId);
  const maxEvents = session?.maxEvents || DEFAULT_MAX_EVENTS;
  if (events.length > maxEvents) {
    events.splice(0, events.length - maxEvents);
  }
  sessionEvents.set(monitorId, events);
};

export const NetworkMonitorStore = {
  isSupported(): boolean {
    return !!chrome.webRequest;
  },

  start(input: {
    tabId: number;
    urlPatterns?: string[];
    resourceTypes?: string[];
    maxEvents?: number;
  }): NetworkMonitorSession {
    const id = `nm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const session: NetworkMonitorSession = {
      id,
      tabId: input.tabId,
      urlPatterns: (input.urlPatterns || ['*']).filter(Boolean),
      resourceTypes: (input.resourceTypes || []).filter(Boolean),
      maxEvents: Math.min(Math.max(20, Math.floor(input.maxEvents || DEFAULT_MAX_EVENTS)), 2000),
      active: true,
      createdAt: Date.now(),
    };
    sessions.set(id, session);
    sessionEvents.set(id, []);
    return session;
  },

  stop(monitorId: string): boolean {
    const target = sessions.get(monitorId);
    if (!target) return false;
    target.active = false;
    sessions.set(monitorId, target);
    return true;
  },

  stopByTab(tabId: number): number {
    let count = 0;
    for (const [id, session] of sessions) {
      if (session.tabId === tabId && session.active) {
        session.active = false;
        sessions.set(id, session);
        count++;
      }
    }
    return count;
  },

  remove(monitorId: string): boolean {
    const existed = sessions.delete(monitorId);
    sessionEvents.delete(monitorId);
    return existed;
  },

  clearEvents(monitorId?: string): number {
    if (monitorId) {
      const events = sessionEvents.get(monitorId) || [];
      sessionEvents.set(monitorId, []);
      return events.length;
    }
    let total = 0;
    for (const [id, events] of sessionEvents) {
      total += events.length;
      sessionEvents.set(id, []);
    }
    return total;
  },

  list(options?: { includeInactive?: boolean }): Array<NetworkMonitorSession & { eventCount: number }> {
    const includeInactive = !!options?.includeInactive;
    const result: Array<NetworkMonitorSession & { eventCount: number }> = [];
    for (const [id, session] of sessions) {
      if (!includeInactive && !session.active) continue;
      result.push({
        ...session,
        eventCount: (sessionEvents.get(id) || []).length,
      });
    }
    return result.sort((a, b) => b.createdAt - a.createdAt);
  },

  getEvents(input: {
    monitorId?: string;
    tabId?: number;
    onlyErrors?: boolean;
    limit?: number;
  }): NetworkEventItem[] {
    const limit = Math.min(Math.max(1, Math.floor(input.limit || 200)), 2000);
    let merged: NetworkEventItem[] = [];

    if (input.monitorId) {
      merged = [...(sessionEvents.get(input.monitorId) || [])];
    } else {
      for (const [id, session] of sessions) {
        if (typeof input.tabId === 'number' && session.tabId !== input.tabId) continue;
        merged.push(...(sessionEvents.get(id) || []));
      }
    }

    if (input.onlyErrors) {
      merged = merged.filter((event) => event.phase === 'error' || (event.statusCode || 0) >= 400);
    }

    merged.sort((a, b) => b.timestamp - a.timestamp);
    return merged.slice(0, limit);
  },

  getSummary(input: { monitorId?: string; tabId?: number }) {
    const events = this.getEvents({ ...input, limit: 2000 });
    const byResourceType: Record<string, number> = {};
    const byStatusClass: Record<string, number> = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, error: 0 };
    const byDomain: Record<string, number> = {};

    for (const event of events) {
      byResourceType[event.resourceType] = (byResourceType[event.resourceType] || 0) + 1;
      if (event.phase === 'error') {
        byStatusClass.error += 1;
      } else if (event.statusCode) {
        if (event.statusCode >= 500) byStatusClass['5xx'] += 1;
        else if (event.statusCode >= 400) byStatusClass['4xx'] += 1;
        else if (event.statusCode >= 300) byStatusClass['3xx'] += 1;
        else byStatusClass['2xx'] += 1;
      }
      try {
        const host = new URL(event.url).host;
        byDomain[host] = (byDomain[host] || 0) + 1;
      } catch {
        // ignore invalid url
      }
    }

    return {
      total: events.length,
      errors: events.filter((event) => event.phase === 'error' || (event.statusCode || 0) >= 400).length,
      by_resource_type: byResourceType,
      by_status_class: byStatusClass,
      top_domains: Object.entries(byDomain)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([domain, count]) => ({ domain, count })),
      last_event_at: events[0]?.timestamp || null,
    };
  },

  recordBeforeRequest(details: chrome.webRequest.WebRequestBodyDetails | chrome.webRequest.WebRequestDetails): void {
    requestStarts.set(details.requestId, { startedAt: Date.now() });
  },

  recordCompleted(details: chrome.webRequest.WebResponseCacheDetails): void {
    if (typeof details.tabId !== 'number' || details.tabId < 0) return;
    const started = requestStarts.get(details.requestId);
    if (started) requestStarts.delete(details.requestId);

    for (const [monitorId, session] of sessions) {
      if (!matchSession(session, { tabId: details.tabId, url: details.url, resourceType: details.type })) {
        continue;
      }
      pushEvent(monitorId, {
        timestamp: Date.now(),
        tabId: details.tabId,
        requestId: details.requestId,
        phase: 'completed',
        method: details.method,
        url: details.url,
        resourceType: details.type,
        statusCode: details.statusCode,
        statusLine: details.statusLine,
        ip: details.ip,
        fromCache: details.fromCache,
        initiator: details.initiator,
        durationMs: started ? Math.max(0, Date.now() - started.startedAt) : undefined,
      });
    }
  },

  recordError(details: chrome.webRequest.WebResponseErrorDetails): void {
    if (typeof details.tabId !== 'number' || details.tabId < 0) return;
    const started = requestStarts.get(details.requestId);
    if (started) requestStarts.delete(details.requestId);

    for (const [monitorId, session] of sessions) {
      if (!matchSession(session, { tabId: details.tabId, url: details.url, resourceType: details.type })) {
        continue;
      }
      pushEvent(monitorId, {
        timestamp: Date.now(),
        tabId: details.tabId,
        requestId: details.requestId,
        phase: 'error',
        method: details.method,
        url: details.url,
        resourceType: details.type,
        initiator: details.initiator,
        error: details.error,
        durationMs: started ? Math.max(0, Date.now() - started.startedAt) : undefined,
      });
    }
  },
};

