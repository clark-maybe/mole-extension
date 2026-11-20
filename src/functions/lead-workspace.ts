/** 平台工具是薄入口：创建持久作业后立即返回，执行由后台运行器承担。 */
import type { FunctionDefinition, FunctionResult, ToolExecutionContext } from './types';
import { workspaceRepository as repository } from '../lib/workspace-db/repository';
import { workspaceStorageReady } from '../background/workspace-storage';
import { wakeLeadTasks } from '../background/lead-task-runner';
import type { Assessment, Json, LeadTask } from '../workspace/types';
import type { CrmConfig } from '../platforms/mantis-crm';
import { WorkspacePersistenceError } from '../workspace/errors';
import Channel from '../lib/channel';

const text = (description: string) => ({ type: 'string', description });
const idSchema = { task_id: text('Persistent task ID.'), lead_id: text('Persistent lead ID.'), operation_key: text('Stable idempotency key. Reuse only for the same logical job.') };

function jobTool(name: string, kind: LeadTask['kind'], provider: LeadTask['provider'], description: string, properties: Record<string, unknown>, required: string[]): FunctionDefinition {
  return {
    name, description, supportsParallel: false, permissionLevel: kind === 'crm_delivery' ? 'sensitive' : 'read',
    approvalMessageTemplate: '将所选线索录入已配置的公司 CRM',
    parameters: { type: 'object', properties: { ...properties, criteria: text('The complete user qualification criteria, including region, industry and required business evidence.'), operation_key: idSchema.operation_key, tab_id: { type: 'integer', minimum: 1 } }, required },
    execute: async (params: Record<string, Json>, context?: ToolExecutionContext): Promise<FunctionResult> => {
      try {
        await workspaceStorageReady();
        if (!context?.sessionId) throw new Error('平台作业需要关联会话');
        if (required.some(key => !params[key])) throw new Error('缺少必要平台参数');
        if (kind === 'douyin_collect' && (!Number.isInteger(params.target_count) || Number(params.target_count) < 1 || Number(params.target_count) > 999)) throw new Error('目标数量须为 1–999 的整数');
        if (kind === 'company_contacts') await repository.readLead(String(params.lead_id));
        const key = String(params.operation_key || context.callId || '');
        if (!key) throw new Error('缺少作业去重标识');
        const input: LeadTask['input'] = kind === 'douyin_collect'
          ? { keyword: String(params.keyword).trim(), targetCount: Number(params.target_count), enterpriseOnly: params.enterprise_only !== false,
            ...(params.tab_id ? { tabId: Number(params.tab_id) } : {}) }
          : kind === 'company_contacts' ? { leadId: String(params.lead_id) }
          : kind === 'crm_delivery' ? { leadIds: params.lead_ids, intent: params.intent,
            targetConfig: (await repository.getMeta<CrmConfig>('crm-config') || null) as unknown as Json }
          : { keyword: String(params.keyword).trim(), enrichContacts: true };
        if ('keyword' in input && !String(input.keyword).trim()) throw new Error('关键词不能为空');
        if (typeof params.criteria === 'string') input.criteria = params.criteria;
        if (kind === 'crm_delivery' && (!Array.isArray(input.leadIds) || input.leadIds.length < 1 || input.leadIds.length > 100 || !input.targetConfig)) throw new Error('请选择 1–100 条线索并先绑定目标 CRM');
        const task = await repository.createTask({ id: `${context.sessionId}:${key}`, sessionId: context.sessionId,
          kind, provider, input, title: String(input.keyword || (kind === 'company_contacts' ? '获取法人联系方式' : name)), maxBatches: kind === 'douyin_collect' ? 150 : kind === 'crm_delivery' ? 100 : kind === 'company_search' ? 2 : 1 });
        void wakeLeadTasks();
        return { success: true, data: { task_id: task.id, status: task.status, saved_count: task.savedCount,
          message: '作业已持久化；后台按批次执行。结果到达后会通知会话，请勿循环调用状态查询。' } };
      } catch (error) { if (error instanceof WorkspacePersistenceError) throw error; return { success: false, error: error instanceof Error ? error.message : String(error) }; }
    },
  };
}

export const douyinCollectUsersFunction = jobTool('douyin_collect_users', 'douyin_collect', 'douyin',
  'Discover potentially active businesses through Douyin accounts (1–999 candidates). Use this discovery stage before precise company enrichment. Saves each page and its evidence atomically. Search presence and enterprise certification do not prove recent activity or business fit: verify recent posts, dates and business evidence before qualification. Returns immediately; do not poll. Wait for a workspace notification.',
  { keyword: text('Search keyword.'), target_count: { type: 'integer', minimum: 1, maximum: 999 }, enterprise_only: { type: 'boolean', default: true } }, ['keyword', 'target_count']);

export const lixiaoyunSearchCompaniesFunction = jobTool('lixiaoyun_search_companies', 'company_search', 'lixiaoyun',
  'Precisely enrich a known company through Lixiaoyun after identifying the business or when the user supplies its name. Retrieves the business profile, legal representative and trusted contact details, including legal representative mobile when attributed by the provider. Lixiaoyun contacts are trusted and ready for sales outreach; do not ask for a second check of phone authenticity or ownership. Preserve the provider contact name/role. A missing legalPersonPhone does not invalidate other returned contacts. Exact-name matches retrieve contacts automatically; ambiguous names return candidates. Use known company names, not broad industry/region discovery keywords. Independent of CRM.',
  { keyword: text('Known company name to look up precisely, ideally its full legal name. Do not pass generic industry or region discovery keywords.') }, ['keyword']);

export const lixiaoyunGetContactsFunction = jobTool('lixiaoyun_get_contacts', 'company_contacts', 'lixiaoyun',
  'Complete or refresh trusted, ready-to-contact phone and email details for an identified Lixiaoyun company lead. Saves raw contact records and provenance. Trust Lixiaoyun contacts by default: do not request additional authenticity or owner verification. Keep original contact names and roles without inventing attribution. A missing separate legalPersonPhone field is not a failure and does not require another lookup. Company lookup usually retrieves these automatically. Organize results with lead_workspace save_profile.',
  { lead_id: idSchema.lead_id }, ['lead_id']);

export const mantisCrmRecordFunction = jobTool('mantis_crm_record', 'crm_delivery', 'mantis_crm',
  'Optionally record selected verified company leads in a configured company-specific Mantis CRM. This is one recording destination, independent of lead search or company lookup; it is not a required final step. Use only when the user explicitly requests this CRM destination. Requires a saved target identity and field mapping. Ambiguous submissions wait for reconciliation and are never blindly retried.',
  { lead_ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 100 }, intent: text('The explicit user instruction authorizing this specific lead set and CRM destination.') }, ['lead_ids', 'intent']);

export const leadWorkspaceFunction: FunctionDefinition = {
  name: 'lead_workspace', supportsParallel: false, permissionLevel: 'read',
  description: 'Query saved sales jobs and leads, inspect raw evidence and trusted contacts, save a structured sales profile (save_profile), record business-fit qualification, and control jobs. Always save the organized profile to the lead, not only the chat. read_lead returns contacts with trust and source roles, current profile revision and recent profile history. save_profile replaces the entire profile and appends a traceable revision; cite that lead’s evidence. Contact trust is independent of business fit. Use bounded pages; do not poll running jobs.',
  parameters: { type: 'object', properties: { action: { type: 'string', enum: ['tasks', 'leads', 'read_lead', 'evidence', 'attach_fact', 'save_profile', 'link_company', 'assess', 'set_criteria', 'pause', 'resume', 'cancel'] },
    ...idSchema, evidence_id: text('Evidence ID.'), offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 },
    field: text('Business field name for a saved fact.'), source_path: text('Exact dot/index path in the saved evidence JSON, e.g. data.content or data.items[0].signature. Values are extracted from evidence, not invented.'), company_lead_id: text('Candidate company lead ID to associate with a source account. Without an identical verified credit code this records a candidate for human review.'),
    goal_revision: { type: 'integer', minimum: 1 }, status: { type: 'string', enum: ['qualified', 'rejected', 'unconfirmed'] },
    reason: text('Reason grounded in the referenced facts and user criteria.'), fact_ids: { type: 'array', items: { type: 'string' } }, evidence_ids: { type: 'array', items: { type: 'string' } },
    profile_revision: { type: 'integer', minimum: 0, description: 'Required for save_profile: current lead.profile.revision, or 0 when absent. On conflict read_lead again.' },
    profile: { type: 'object', description: 'Required for save_profile. Full replacement sales profile, written in the user’s language. Summarize supported facts; distinguish observed activity and suggestions. Do not invent missing facts. Contacts are sourced automatically, never retype or invent numbers here.',
      properties: { summary: text('Concise company overview.'), business: text('Main business, products and services supported by sources.'), region: text('Service area or location supported by sources.'), activity: text('Recent platform activity and dates, or a concise description of missing activity evidence.'), nextStep: text('Suggested sales follow-up based on available information.'), tags: { type: 'array', items: { type: 'string', maxLength: 40 }, maxItems: 12 } }, required: ['summary'] },
    criteria: text('Complete updated criteria when action=set_criteria. This invalidates prior qualification for delivery.'),
    model: text('Model identifier used for the assessment.'), prompt_version: text('Assessment instruction version, e.g. lead-qualification-v1.') }, required: ['action'] },
  execute: async (params: Record<string, unknown>, context?: ToolExecutionContext) => {
    try {
      await workspaceStorageReady();
      const taskId = typeof params.task_id === 'string' ? params.task_id : undefined;
      let data: unknown;
      switch (params.action) {
        case 'tasks': data = await repository.listTasks(context?.sessionId); break;
        case 'leads': data = await repository.listLeadSummaries(taskId, Math.max(0, Number(params.offset) || 0), Math.max(1, Math.min(100, Number(params.limit) || 30))); break;
        case 'read_lead': data = await repository.readLead(String(params.lead_id)); break;
        case 'evidence': data = await repository.readEvidence(String(params.evidence_id)); break;
        case 'attach_fact': data = await repository.attachFact(String(params.lead_id), String(params.evidence_id), String(params.field || ''), String(params.source_path || '')); break;
        case 'save_profile': {
          if (!taskId) throw new Error('保存档案需要关联任务');
          data = await repository.saveLeadProfile({ taskId, leadId: String(params.lead_id), expectedRevision: Number(params.profile_revision ?? -1), profile: params.profile,
            factIds: Array.isArray(params.fact_ids) ? params.fact_ids.map(String) : [], evidenceIds: Array.isArray(params.evidence_ids) ? params.evidence_ids.map(String) : [],
            model: String(params.model || 'unspecified'), promptVersion: String(params.prompt_version || 'lead-profile-v1') });
          break;
        }
        case 'link_company': data = await repository.linkCompany({ sourceLeadId: String(params.lead_id), companyLeadId: String(params.company_lead_id), status: 'confirmed', reason: String(params.reason || ''), evidenceIds: Array.isArray(params.evidence_ids) ? params.evidence_ids.map(String) : [], author: 'agent' }); break;
        case 'assess': {
          if (!taskId || !['qualified', 'rejected', 'unconfirmed'].includes(String(params.status))) throw new Error('缺少任务或判断状态');
          data = await repository.assess({ taskId, leadId: String(params.lead_id), goalRevision: Number(params.goal_revision),
            status: params.status as Assessment['status'], reason: String(params.reason || ''),
            factIds: Array.isArray(params.fact_ids) ? params.fact_ids.map(String) : [], evidenceIds: Array.isArray(params.evidence_ids) ? params.evidence_ids.map(String) : [],
            model: String(params.model || 'unspecified'), promptVersion: String(params.prompt_version || 'lead-qualification-v1'), author: 'agent' });
          break;
        }
        case 'set_criteria': {
          const task = taskId ? await repository.getTask(taskId) : undefined;
          if (!task || task.sessionId !== context?.sessionId) throw new Error('任务不属于当前会话');
          data = await repository.reviseCriteria(task.id, String(params.criteria || params.reason || '')); break;
        }
        case 'pause': case 'resume': case 'cancel': {
          const task = taskId ? await repository.getTask(taskId) : undefined;
          if (!task || task.sessionId !== context?.sessionId) throw new Error('任务不属于当前会话');
          data = await repository.controlTask(task.id, params.action); void wakeLeadTasks(); break;
        }
        default: throw new Error('不支持的线索操作');
      }
      if (['attach_fact', 'save_profile', 'link_company', 'assess', 'set_criteria'].includes(String(params.action))) Channel.broadcast('__workspace_changed', { taskId, leadId: params.lead_id });
      return { success: true, data };
    } catch (error) { if (error instanceof WorkspacePersistenceError) throw error; return { success: false, error: error instanceof Error ? error.message : String(error) }; }
  },
};

export const SALES_FUNCTIONS = [douyinCollectUsersFunction, lixiaoyunSearchCompaniesFunction, lixiaoyunGetContactsFunction, mantisCrmRecordFunction, leadWorkspaceFunction];
