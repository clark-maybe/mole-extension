/** 平台业务响应先写证据，再交由 Agent 按线索 ID 查询。 */
import { douyinSearchUsersFunction } from '../functions/douyin-search-users';
import { parseCompanySearchPayload } from './company-parser';
import { businessJson, PlatformError, runReadPageJob } from './page-job';
import type { BatchResult, Evidence, Json, TaskAttempt } from '../workspace/types';
import { workspaceRepository } from '../lib/workspace-db/repository';

function evidence(attempt: TaskAttempt, payload: unknown, sourceUrl: string): Evidence {
  return { id: crypto.randomUUID(), taskId: attempt.task.id, stepId: attempt.step.id,
    provider: attempt.task.provider, sourceUrl, collectedAt: Date.now(), extractorVersion: 'workspace-v1', payload: businessJson(payload) };
}

export async function collectDouyin(attempt: TaskAttempt): Promise<BatchResult> {
  const { task } = attempt;
  const keyword = String(task.input.keyword);
  const previous = await workspaceRepository.getMeta<{ tabId: number }>(`douyin-page:${task.id}`);
  let tabId = previous?.tabId || Number(task.input.tabId) || undefined;
  if (tabId) {
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    if (!tab?.url?.startsWith('https://www.douyin.com/')) tabId = undefined;
  }
  const watchId = `workspace:${task.id}:${attempt.step.epoch}`;
  const result = await douyinSearchUsersFunction.execute({ keyword, count: 20, cursor: Number(task.checkpoint.cursor || 0),
    search_id: task.checkpoint.searchId || undefined, ...(tabId ? { tab_id: tabId } : {}) }, { sessionId: task.sessionId, recoveryWatchId: watchId,
    onChannelPage: async pageId => {
      await workspaceRepository.setMeta(`douyin-page:${task.id}`, { tabId: pageId });
      await workspaceRepository.setMeta(`douyin-watch:${watchId}`, { tabId: pageId, taskId: task.id, epoch: attempt.step.epoch });
    } });
  if (!result.success) throw new PlatformError(result.error || '抖音搜索失败',
    ['E_AUTH_REQUIRED', 'E_VERIFICATION_REQUIRED'].includes(result.code || '') ? 'waiting'
      : result.retryable === false || /格式|缺少.*列表|游标未推进/.test(result.error || '') ? 'failed' : 'retry');
  const data = result.data as { items: Array<Record<string, Json>>; cursor: number; has_more: boolean; search_id: string };
  const proof = evidence(attempt, data, `https://www.douyin.com/search/${encodeURIComponent(keyword)}?type=user`);
  if (!data || !Array.isArray(data.items)) throw new PlatformError('抖音响应格式发生变化，未推进分页');
  const unique = new Map(data.items.filter(item => item.uid || item.sec_uid).map(item => [`douyin:${item.uid || item.sec_uid}`, item]));
  const items = [...unique.values()].filter(item => task.input.enterpriseOnly !== true || item.is_enterprise === true || Boolean(item.enterprise_verify_reason));
  const existingKeys = new Set((await workspaceRepository.listLeads(task.id, 0, 5000)).map(lead => lead.sourceKey));
  const fresh = items.filter(item => !existingKeys.has(`douyin:${item.uid || item.sec_uid}`));
  const additions = fresh.length;
  const noProgress = additions ? 0 : Number(task.checkpoint.noProgress || 0) + 1;
  const target = Number(task.input.targetCount || 100);
  const leads = fresh.slice(0, Math.max(0, target - task.savedCount)).map(item => ({
    sourceKey: `douyin:${item.uid || item.sec_uid}`, kind: 'account' as const, name: String(item.nickname || ''), provider: 'douyin' as const,
    sourceUrl: String(item.profile_url || ''), fields: { ...item, enterprise_name_status: 'unconfirmed' }, evidenceIds: [proof.id],
  }));
  const reached = task.savedCount + Math.min(additions, leads.length) >= target;
  const done = reached || !data.has_more || noProgress >= 3;
  return { evidence: [proof], leads, checkpoint: { cursor: data.cursor, searchId: data.search_id || '', noProgress }, done,
    partial: done && !reached, reason: done && !reached ? '当前查询已结束，尚未达到目标数量' : undefined, delayMs: 10_000 };
}

export async function searchCompanies(attempt: TaskAttempt): Promise<BatchResult> {
  const provider = attempt.task.provider === 'riskbird' ? 'riskbird' : 'lixiaoyun';
  const keyword = String(attempt.task.input.keyword);
  const params = new URLSearchParams({ keyword, jobId: attempt.task.id });
  const url = provider === 'riskbird' ? `https://riskbird.com/search/company?${params}` : `https://lxcrm.weiwenjia.com/soukebox/advanced_search?${params}`;
  const data = await runReadPageJob(attempt, url, provider === 'riskbird' ? 'workspace-riskbird.js' : 'workspace-lixiaoyun.js',
    provider === 'riskbird' ? '__mantis_fengniaoyun_company_search_xhr_hook__' : '__mantis_company_search_xhr_hook__', keyword);
  let parsed: ReturnType<typeof parseCompanySearchPayload>;
  try { parsed = parseCompanySearchPayload(data.payload, provider === 'riskbird' ? 'fengniaoyun' : 'lixiaoyun'); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PlatformError(message, /429|请求频繁|频率|rate.?limit|50[0234]|超时/i.test(message) ? 'retry' : /登录|验证|401|403/.test(message) ? 'waiting' : 'failed');
  }
  const proof = evidence(attempt, data.payload, url);
  const body = data.payload as { data?: { items?: Array<Record<string, Json>>; list?: Array<Record<string, Json>> } };
  const rawItems = body?.data?.items || body?.data?.list || [];
  const paths: Record<string, string> = provider === 'riskbird'
    ? { id: 'entid', name: 'entName', legalPerson: 'faren', contact: 'tels', address: 'dom', status: 'entStatus', socialCreditCode: 'uniscid', registeredCapital: 'regCap', establishmentDate: 'esDate', email: 'emails', officialWebsite: 'website', tags: 'tags' }
    : { id: 'id', name: 'companyName', englishName: 'entNameEng', legalPerson: 'legalperson', address: 'address', status: 'entstatus', industry: 'industry', socialCreditCode: 'socialCreditCode', registeredCapital: 'registercapital', establishmentDate: 'esdate', contactName: 'contactName', tags: 'companyTags', officialWebsite: 'officialWebsite' };
  return { evidence: [proof], leads: parsed.items.map(company => ({
    sourceKey: `${provider}:${company.id || company.socialCreditCode || company.name}`, kind: 'company', name: company.name, provider, sourceUrl: url,
    fields: Object.fromEntries(Object.entries(businessJson(company) as { [key: string]: Json }).filter(([field, value]) =>
      value !== '' && value !== null && !(Array.isArray(value) && !value.length) && !(field === 'contactLoaded' && value === false))), evidenceIds: [proof.id],
    fieldOrigins: Object.fromEntries(Object.entries(paths).flatMap(([field, path]) => {
      const index = rawItems.findIndex(raw => company.id ? String(raw.id || raw.entid || raw.uniscid || '') === company.id : String(raw.companyName || raw.name || raw.value || raw.entName || '') === company.name);
      const raw = rawItems[index];
      return raw && raw[path] !== undefined ? [[field, { rawValue: raw[path], sourcePath: `data.${provider === 'riskbird' ? 'list' : 'items'}[${index}].${path}` }]] : [];
    })),
  })), checkpoint: { page: 1, returned: parsed.items.length, total: parsed.total }, done: true,
    partial: parsed.total > parsed.items.length, reason: parsed.total > parsed.items.length ? '已保存首屏结果；平台返回范围为前 10 条' : undefined };
}

export async function getContacts(attempt: TaskAttempt): Promise<BatchResult> {
  const { lead } = await workspaceRepository.readLead(String(attempt.task.input.leadId));
  if (lead.provider !== 'lixiaoyun' || !lead.fields.id) throw new PlatformError('联系方式查询需要励销云企业 ID');
  const params = new URLSearchParams({ mode: 'contact', pid: String(lead.fields.id), entName: lead.name, jobId: attempt.task.id });
  const url = `https://lxcrm.weiwenjia.com/soukebox/advanced_search?${params}`;
  const data = await runReadPageJob(attempt, url, 'workspace-contacts.js', '__mantis_company_contact_xhr_hook__', lead.name);
  const proof = evidence(attempt, data, url);
  const contact = data.result && typeof data.result === 'object' ? data.result as Record<string, unknown> : data;
  return { evidence: [proof], leads: [{ sourceKey: lead.sourceKey, kind: lead.kind, name: lead.name, provider: lead.provider, sourceUrl: lead.sourceUrl,
    fields: { contact: String(contact.phone || ''), contactDetails: businessJson(contact.details || []), contactLoaded: true }, evidenceIds: [proof.id],
    fieldOrigins: { contact: { rawValue: businessJson(contact.phone || ''), sourcePath: data.result ? 'result.phone' : 'phone' },
      contactDetails: { rawValue: businessJson(contact.details || []), sourcePath: data.result ? 'result.details' : 'details' } } }],
    checkpoint: { leadId: lead.id }, done: true };
}
