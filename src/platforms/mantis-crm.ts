/** 专用 CRM：绑定环境、冻结字段、持久提交意图与结果核对。 */
import Storage from '../lib/storage';
import { workspaceRepository as repository } from '../lib/workspace-db/repository';
import { businessJson, PlatformError } from './page-job';
import type { BatchResult, Delivery, Json, TaskAttempt } from '../workspace/types';

export const CRM_HOSTS = ['bdtg.n4.bjmantis.cn', 'njtlqc.n4.bjmantis.cn'];
export interface CrmConfig {
  targetHost: string;
  targetIdentity: string;
  version: number;
  provinceId: string;
  productId: string;
  areaId: string;
  mscCode: string;
}

/** 此函数仅返回业务身份与字段配置，不返回 Cookie 或令牌。 */
export function inspectCrmPage() {
  const get = (...keys: string[]) => keys.map(key => localStorage.getItem(key)).find(Boolean) || '';
  const identity = { host: location.hostname, enterpriseId: get('enterprise_id', 'enterpriseId'),
    username: get('mantisUserName', 'username', 'userName'), serverName: get('serverName', 'server_name', 'mantisServerName') };
  return { targetHost: location.hostname, targetIdentity: JSON.stringify(identity), valid: Boolean(identity.enterpriseId && identity.username && location.pathname.startsWith('/mantis/')),
    provinceId: get('mantisCustomerProvinceId', 'customerProvinceId') || '373', productId: get('mantisCustomerProductId', 'customerProductId') || '1180',
    areaId: get('mantisCustomerAreaId', 'customerAreaId') || '374', mscCode: '31b23dc92e284bbc9f6298c70ee65f96' };
}

export async function bindCrm(tabId: number): Promise<CrmConfig> {
  const tab = await chrome.tabs.get(tabId);
  if (!CRM_HOSTS.includes(new URL(tab.url || '').hostname)) throw new Error('请选择指定公司的 CRM 工作台页签');
  const inspected = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: inspectCrmPage });
  const identity = inspected[0]?.result;
  if (!identity?.valid) throw new Error('CRM 公司或账号身份尚未就绪，请先完成登录');
  const previous = await repository.getMeta<CrmConfig>('crm-config');
  const { valid: _valid, ...config } = identity;
  const result: CrmConfig = { ...config, version: (previous?.version || 0) + 1 };
  await repository.setMeta('crm-config', result);
  return result;
}

export async function recordCrm(attempt: TaskAttempt): Promise<BatchResult> {
  const { task } = attempt;
  const config = task.input.targetConfig as unknown as CrmConfig;
  if (!config?.targetIdentity || !CRM_HOSTS.includes(config.targetHost)) throw new PlatformError('请先在渠道与交付中绑定 CRM 环境', 'waiting');
  const leadIds = task.input.leadIds as string[];
  if (!Array.isArray(leadIds) || !leadIds.length || leadIds.length > 100) throw new PlatformError('CRM 线索集合无效');
  const index = Number(task.checkpoint.index || 0);
  const { lead, assessments, deliveries } = await repository.readLead(leadIds[index]);
  const operationId = `${task.id}:${lead.id}`;
  const priorFailure = deliveries.find(delivery => delivery.id === operationId && delivery.status === 'failed');
  if (priorFailure) return { evidence: [], leads: [], checkpoint: { index: index + 1, failedCount: Number(task.checkpoint.failedCount || 0) + 1 }, done: index + 1 >= leadIds.length, partial: true, reason: priorFailure.message, delayMs: 2000 };
  const known = deliveries.find(delivery => delivery.targetIdentity === config.targetIdentity && ['recorded', 'duplicate', 'sending', 'unknown'].includes(delivery.status));
  if (known && ['sending', 'unknown'].includes(known.status)) throw new PlatformError('该线索已有提交结果待核对，不能重新发送', 'waiting');
  let qualified = false;
  for (const assessment of [...assessments].sort((a, b) => b.createdAt - a.createdAt)) {
    const sourceTask = await repository.getTask(assessment.taskId);
    if (sourceTask?.sessionId === task.sessionId && sourceTask.goalRevision === assessment.goalRevision) { qualified = assessment.status === 'qualified'; break; }
  }
  if (lead.kind !== 'company' || !qualified) throw new PlatformError('CRM 交付需要当前条件下已确认符合的企业线索；请先核验并记录判断');
  const done = index + 1 >= leadIds.length;
  if (known) return { evidence: [], leads: [], checkpoint: { ...task.checkpoint, index: index + 1 }, done, partial: Number(task.checkpoint.failedCount || 0) > 0, reason: '该企业已交付，保留原回执', delayMs: 2000 };
  const verification = await Storage.get<string>('mole_sales_crm_verification');
  if (!verification) throw new PlatformError('请先在渠道与交付中配置公司 CRM 验证参数', 'waiting');
  const tabs = await chrome.tabs.query({ url: `https://${config.targetHost}/mantis*` });
  const target = tabs.find(tab => tab.id && tab.url?.includes('/mantis/'));
  if (!target?.id) throw new PlatformError('请先打开并登录任务目标公司的 CRM', 'waiting');
  const identity = (await chrome.scripting.executeScript({ target: { tabId: target.id }, world: 'MAIN', func: inspectCrmPage }))[0]?.result;
  if (!identity?.valid || identity.targetIdentity !== config.targetIdentity) throw new PlatformError('当前 CRM 公司或账号与任务目标不一致，已暂停交付', 'waiting');
  const tab = await chrome.tabs.create({ url: `https://${config.targetHost}/mantis/tmk/myCustomer/first`, active: false });
  if (!tab.id) throw new PlatformError('创建 CRM 任务页签失败', 'waiting');
  const tabId = tab.id;
  let retain = false;
  try {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if ((await chrome.tabs.get(tabId)).status === 'complete') break;
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    const actual = (await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: inspectCrmPage }))[0]?.result;
    if (!actual?.valid || actual.targetIdentity !== config.targetIdentity) throw new PlatformError('CRM 新页签未处于预期公司与账号', 'waiting');
    await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', files: ['workspace-crm.js'] });
    const company = { ...lead.fields, id: String(lead.fields.id || lead.id), name: lead.name };
    const fields = deliveries.find(row => row.id === operationId && row.status === 'prepared')?.fields || (await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN',
      func: (item: Record<string, Json>, mapping: CrmConfig) => {
        const preview = (window as Window & { __mole_crm_preview__?: (company: Record<string, Json>, config: CrmConfig) => Record<string, Json> }).__mole_crm_preview__;
        if (!preview) throw new Error('CRM 页面能力尚未就绪');
        return preview(item, mapping);
      }, args: [company, config] }))[0]?.result;
    if (!fields?.phone1) throw new PlatformError('企业没有可用联系电话，未发出 CRM 请求');
    const delivery = await repository.prepareDelivery({ id: operationId, taskId: task.id, leadId: lead.id, targetHost: config.targetHost,
      targetIdentity: config.targetIdentity, configVersion: config.version, fields });
    if (delivery.status !== 'prepared') throw new PlatformError('该请求已经发送，请核对原交付记录', 'waiting');
    await repository.setMeta(`crm-tab:${operationId}`, { tabId, targetHost: config.targetHost });
    // 独立桥接在后台休眠后仍可唤醒后台保存晚到回执。
    await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: (id: string) => {
      const listener = (event: MessageEvent) => {
        if (event.source !== window || event.data?.source !== '__mantis_customer_record_hook__' || event.data.type !== 'result' || event.data.jobId !== id) return;
        window.removeEventListener('message', listener);
        void chrome.runtime.sendMessage({ type: '__workspace_crm_receipt', data: { operationId: id, payload: event.data } }).catch(() => undefined);
      };
      window.addEventListener('message', listener);
    }, args: [operationId] });
    await repository.updateDelivery(operationId, 'sending');
    const response = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: (id: string, item: Record<string, Json>, mapping: CrmConfig & { verification: string; preparedFields: Delivery['fields'] }) =>
      new Promise<Record<string, unknown>>((resolve) => {
        const handler = (event: MessageEvent) => {
          if (event.source !== window || event.data?.source !== '__mantis_customer_record_hook__' || event.data.type !== 'result' || event.data.jobId !== id) return;
          clearTimeout(timeout); window.removeEventListener('message', handler); resolve(event.data);
        };
        const timeout = setTimeout(() => { window.removeEventListener('message', handler); resolve({ error: '请求回执超时' }); }, 40_000);
        window.addEventListener('message', handler);
        window.postMessage({ source: '__mantis_customer_record_hook__', type: 'execute', jobId: id, companies: [item], config: mapping }, '*');
      }), args: [operationId, company, { ...config, verification, preparedFields: delivery.fields }] });
    const saved = await saveCrmReceipt(operationId, response[0]?.result);
    if (saved.status === 'unknown') { retain = true; throw new PlatformError('CRM 请求已发送，结果待核对', 'waiting'); }
    const proofId = crypto.randomUUID();
    const failedCount = Number(task.checkpoint.failedCount || 0) + (saved.status === 'failed' ? 1 : 0);
    return { evidence: [{ id: proofId, taskId: task.id, stepId: attempt.step.id, provider: 'mantis_crm', sourceUrl: `https://${config.targetHost}/mantis/tmk/myCustomer/first`,
      collectedAt: Date.now(), extractorVersion: 'mantis-crm-v1', payload: businessJson(saved.receipt || {}) }], leads: [], checkpoint: { index: index + 1, failedCount }, done,
      partial: failedCount > 0, reason: saved.message, delayMs: 2000 };
  } catch (error) {
    const detail = await repository.readLead(lead.id);
    const delivery = detail.deliveries.find(row => row.id === operationId);
    if (delivery?.status === 'sending') { await repository.updateDelivery(operationId, 'unknown', undefined, '提交阶段中断，请核对 CRM'); retain = true; }
    throw error;
  } finally {
    if (!retain) await chrome.tabs.remove(tabId).catch(() => undefined);
  }
}

export async function saveCrmReceipt(operationId: string, response: unknown): Promise<Delivery> {
  const data = response && typeof response === 'object' ? response as Record<string, unknown> : {};
  const item = Array.isArray(data.items) ? data.items[0] as Record<string, unknown> : undefined;
  const status = ['recorded', 'duplicate', 'failed'].includes(String(item?.status)) ? item!.status as Delivery['status'] : 'unknown';
  const debug = item?.debug && typeof item.debug === 'object' ? item.debug as Record<string, unknown> : undefined;
  return repository.updateDelivery(operationId, status, businessJson({ ...data, businessResponse: debug?.response }), String(item?.message || data.error || '结果待核对'));
}
