/** 平台工具是薄入口：创建持久作业后立即返回，执行由后台运行器承担。 */
import type { FunctionDefinition, FunctionResult, ToolExecutionContext } from './types';
import { workspaceRepository as repository } from '../lib/workspace-db/repository';
import { workspaceStorageReady } from '../background/workspace-storage';
import { wakeLeadTasks } from '../background/lead-task-runner';
import type { Assessment, Json, LeadTask } from '../workspace/types';
import type { CrmConfig } from '../platforms/mantis-crm';
import { WorkspacePersistenceError } from '../workspace/errors';

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
          : { keyword: String(params.keyword).trim() };
        if ('keyword' in input && !String(input.keyword).trim()) throw new Error('关键词不能为空');
        if (typeof params.criteria === 'string') input.criteria = params.criteria;
        if (kind === 'crm_delivery' && (!Array.isArray(input.leadIds) || input.leadIds.length < 1 || input.leadIds.length > 100 || !input.targetConfig)) throw new Error('请选择 1–100 条线索并先绑定目标 CRM');
        const task = await repository.createTask({ id: `${context.sessionId}:${key}`, sessionId: context.sessionId,
          kind, provider, input, title: String(input.keyword || name), maxBatches: kind === 'douyin_collect' ? 150 : kind === 'crm_delivery' ? 100 : 1 });
        void wakeLeadTasks();
        return { success: true, data: { task_id: task.id, status: task.status, saved_count: task.savedCount,
          message: '作业已持久化；后台按批次执行。结果到达后会通知会话，请勿循环调用状态查询。' } };
      } catch (error) { if (error instanceof WorkspacePersistenceError) throw error; return { success: false, error: error instanceof Error ? error.message : String(error) }; }
    },
  };
}

export const douyinCollectUsersFunction = jobTool('douyin_collect_users', 'douyin_collect', 'douyin',
  'Start a durable Douyin user collection job (1–999 candidates). Saves each page and its evidence atomically. Enterprise certification is a discovery filter, not proof of business fit. Returns immediately; do not poll. Wait for a workspace notification before enrichment.',
  { keyword: text('Search keyword.'), target_count: { type: 'integer', minimum: 1, maximum: 999 }, enterprise_only: { type: 'boolean', default: true } }, ['keyword', 'target_count']);

export const lixiaoyunSearchCompaniesFunction = jobTool('lixiaoyun_search_companies', 'company_search', 'lixiaoyun',
  'Search Lixiaoyun for candidate companies, legal representatives and business profiles. Uses the provider login independently of CRM. Current provider returns the first 10 candidates; name similarity does not establish identity.',
  { keyword: text('Company name or search keyword.') }, ['keyword']);

export const riskbirdSearchCompaniesFunction = jobTool('riskbird_search_companies', 'company_search', 'riskbird',
  'Search Riskbird for company candidates, legal representatives and available contacts. Current provider returns the first 10 candidates. Name similarity is not identity verification.',
  { keyword: text('Company name or search keyword.') }, ['keyword']);

export const lixiaoyunGetContactsFunction = jobTool('lixiaoyun_get_contacts', 'company_contacts', 'lixiaoyun',
  'Get available contact details for an existing Lixiaoyun company lead. Saves source evidence and raw contact fields; does not assume that the legal representative is the phone owner.',
  { lead_id: idSchema.lead_id }, ['lead_id']);

export const mantisCrmRecordFunction = jobTool('mantis_crm_record', 'crm_delivery', 'mantis_crm',
  'Optionally record selected verified company leads in a configured company-specific Mantis CRM. This is one recording destination, independent of lead search or company lookup; it is not a required final step. Use only when the user explicitly requests this CRM destination. Requires a saved target identity and field mapping. Ambiguous submissions wait for reconciliation and are never blindly retried.',
  { lead_ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 100 }, intent: text('The explicit user instruction authorizing this specific lead set and CRM destination.') }, ['lead_ids', 'intent']);

export const leadWorkspaceFunction: FunctionDefinition = {
  name: 'lead_workspace', supportsParallel: false, permissionLevel: 'read',
  description: 'Query saved sales jobs and leads, inspect raw evidence or field facts, record evidence-backed qualification, and control jobs. Use bounded pages. Do not poll a running job: background notifications resume the conversation. Missing evidence means unconfirmed. CSV export is available in the workspace.',
  parameters: { type: 'object', properties: { action: { type: 'string', enum: ['tasks', 'leads', 'read_lead', 'evidence', 'attach_fact', 'link_company', 'assess', 'set_criteria', 'pause', 'resume', 'cancel'] },
    ...idSchema, evidence_id: text('Evidence ID.'), offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 },
    field: text('Business field name for a saved fact.'), source_path: text('Exact dot/index path in the saved evidence JSON, e.g. data.content or data.items[0].signature. Values are extracted from evidence, not invented.'), company_lead_id: text('Candidate company lead ID to associate with a source account. Without an identical verified credit code this records a candidate for human review.'),
    goal_revision: { type: 'integer', minimum: 1 }, status: { type: 'string', enum: ['qualified', 'rejected', 'unconfirmed'] },
    reason: text('Reason grounded in the referenced facts and user criteria.'), fact_ids: { type: 'array', items: { type: 'string' } }, evidence_ids: { type: 'array', items: { type: 'string' } },
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
      return { success: true, data };
    } catch (error) { if (error instanceof WorkspacePersistenceError) throw error; return { success: false, error: error instanceof Error ? error.message : String(error) }; }
  },
};

export const SALES_FUNCTIONS = [douyinCollectUsersFunction, lixiaoyunSearchCompaniesFunction, riskbirdSearchCompaniesFunction, lixiaoyunGetContactsFunction, mantisCrmRecordFunction, leadWorkspaceFunction];
