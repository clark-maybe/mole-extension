/** 线索列表与逐字段证据；同一组件用于任务结果和跨任务线索库。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Drawer, Empty, Input, Select, Space, Table, Tag, Typography } from 'antd';
import { workspaceAction, workspaceQuery } from '../../chat/workspace-client';
import Channel from '../../lib/channel';
import type { Assessment, Delivery, EntityLink, Evidence, Lead, LeadSummary, LeadFact, LeadTask } from '../../workspace/types';

type Detail = { lead: Lead; facts: LeadFact[]; assessments: Assessment[]; deliveries: Delivery[]; links: EntityLink[] };
export function LeadTable({ taskId }: { taskId?: string }) {
  const [leads, setLeads] = useState<LeadSummary[]>([]);
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState('');
  const [detail, setDetail] = useState<Detail>();
  const [proof, setProof] = useState<Evidence>();
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<'recorded' | 'duplicate' | 'failed'>('recorded');
  const [jobs, setJobs] = useState<LeadTask[]>([]);
  const [exporting, setExporting] = useState(false);
  const requestVersion = useRef(0);
  const invalidate = useCallback(() => { requestVersion.current++; }, []);
  const refresh = useCallback(() => {
    const version = ++requestVersion.current;
    return workspaceQuery<LeadSummary[]>({ kind: 'leads', taskId, offset, search: taskId ? undefined : filter })
      .then(rows => { if (version === requestVersion.current) setLeads(rows); })
      .catch(reason => { if (version === requestVersion.current) setError(String(reason.message || reason)); });
  }, [taskId, offset, filter]);
  useEffect(() => { setOffset(0); }, [taskId]);
  useEffect(() => { void refresh(); return invalidate; }, [refresh, invalidate]);
  useEffect(() => {
    const changed = () => { void refresh(); };
    Channel.on('__workspace_changed', changed); Channel.on('__channel_reconnected', changed);
    return () => { Channel.off('__workspace_changed', changed); Channel.off('__channel_reconnected', changed); };
  }, [refresh]);
  const open = async (leadId: string) => {
    try { setDetail(await workspaceQuery<Detail>({ kind: 'lead', leadId })); setProof(undefined); setNote(''); setJobs(await workspaceQuery<LeadTask[]>({ kind: 'tasks' })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const inspect = async (evidenceId: string) => {
    try { setProof(await workspaceQuery<Evidence>({ kind: 'evidence', evidenceId })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const exportCsv = async () => {
    setExporting(true);
    try {
    const all: LeadSummary[] = [];
    for (let pageOffset = 0; ; pageOffset += 100) {
      const page = await workspaceQuery<LeadSummary[]>({ kind: 'leads', taskId, offset: pageOffset });
      all.push(...page);
      if (page.length < 100) break;
    }
    const quote = (value: unknown) => `"${String(value ?? '').replace(/^[=+@\-\t\r]/, "'$&").replace(/"/g, '""')}"`;
    const rows = [['线索ID', '名称', '类型', '来源平台', '判断', '判断依据', '条件版本', '法人', '联系电话', '统一信用代码', '地址', '来源链接', '字段', '证据ID'], ...all.map(lead =>
      [lead.id, lead.name, lead.kind, lead.provider, !lead.assessment ? '待核验' : !lead.assessment.current ? '条件已变更' : lead.assessment.status, lead.assessment?.reason, lead.assessment?.goalRevision, lead.fields.legalPerson, lead.fields.contact, lead.fields.socialCreditCode, lead.fields.address, lead.sourceUrl, JSON.stringify(lead.fields), lead.evidenceIds.join(';')])];
    const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.map(row => row.map(quote).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `Mole线索-${Date.now()}.csv`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setExporting(false); }
  };
  return <div className="workspace-leads">
    {error && <Alert type="error" message={error} closable onClose={() => setError('')} />}
    <Space wrap className="workspace-toolbar"><Input.Search placeholder={taskId ? '筛选本页名称' : '搜索整个线索库'} value={filter} onChange={event => { setFilter(event.target.value); setOffset(0); }} />
      <Button onClick={() => void refresh()}>刷新</Button><Button loading={exporting} onClick={() => void exportCsv()}>{taskId ? '导出整个任务 CSV' : '导出线索库 CSV'}</Button></Space>
    <Table<LeadSummary> size="small" rowKey="id" dataSource={taskId ? leads.filter(lead => lead.name.includes(filter)) : leads} pagination={false}
      locale={{ emptyText: <Empty description="保存的线索会显示在这里" /> }} columns={[
        { title: '名称', dataIndex: 'name', render: (value: string, lead) => <Button type="link" onClick={() => void open(lead.id)}>{value || '未命名线索'}</Button> },
        { title: '判断', key: 'assessment', render: (_value, lead) => <Tag color={lead.assessment?.current && lead.assessment.status === 'qualified' ? 'green' : undefined}>{!lead.assessment ? '待核验' : !lead.assessment.current ? '条件已变更' : lead.assessment.status === 'qualified' ? '符合' : lead.assessment.status === 'rejected' ? '不符合' : '待确认'}</Tag> },
        { title: '平台', dataIndex: 'provider' }, { title: '类型', dataIndex: 'kind', render: value => <Tag>{value === 'account' ? '平台账号' : value === 'company' ? '企业候选' : '门店'}</Tag> },
      ]} />
    <Space className="workspace-toolbar"><Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))}>上一页</Button><span>{offset + 1}–{offset + leads.length}</span>
      <Button disabled={leads.length < 100} onClick={() => setOffset(offset + 100)}>下一页</Button></Space>
    <Drawer title={detail?.lead.name || '线索详情'} open={Boolean(detail)} width={680} onClose={() => { setDetail(undefined); setProof(undefined); }}>
      {detail && <>
        <Typography.Paragraph><a href={/^https?:/.test(detail.lead.sourceUrl) ? detail.lead.sourceUrl : undefined} target="_blank" rel="noreferrer">打开原始来源</a></Typography.Paragraph>
        <Tag>{detail.lead.id}</Tag><Typography.Paragraph type="secondary">企业候选与平台账号分别保存；关联主体需要证据，名称相似度只用于候选排序。</Typography.Paragraph>
        <h3>企业主体关联</h3>
        {detail.links.length ? detail.links.map(link => <div className="workspace-fact" key={link.id}><Tag>{link.status === 'confirmed' ? '已确认主体' : '候选主体'}</Tag>
          <Button type="link" onClick={() => void open(link.companyLeadId)}>{link.companyLeadId}</Button><p>{link.reason}</p>
          {link.evidenceIds.map(proofId => <Button key={proofId} type="link" size="small" onClick={() => void inspect(proofId)}>关联证据</Button>)}
          {link.status === 'candidate' && <Space direction="vertical"><Input placeholder="核实企业主体后的确认依据" value={note} onChange={event => setNote(event.target.value)} />
            <Button disabled={!note.trim()} onClick={() => void workspaceAction({ action: 'confirm_company', link, reason: note }).then(() => open(detail.lead.id)).catch(reason => setError(reason.message))}>确认此企业主体</Button></Space>}
        </div>) : <Typography.Paragraph type="secondary">尚无主体关联记录。</Typography.Paragraph>}
        <h3>画像字段</h3>
        {Object.entries(detail.lead.fields).map(([key, value]) => <div className="workspace-field" key={key}><strong>{key}</strong><span>{typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')}</span></div>)}
        <h3>字段事实与来源</h3>
        {detail.facts.map(fact => <div className="workspace-fact" key={fact.id}>
          <strong>{fact.field}</strong>：{JSON.stringify(fact.rawValue)} <Button size="small" type="link" onClick={() => void inspect(fact.evidenceId)}>查看证据</Button>
          <div className="workspace-muted">{new Date(fact.createdAt).toLocaleString()} · 任务 {fact.taskId}</div>
        </div>)}
        <h3>符合性判断</h3>
        {detail.assessments.length ? detail.assessments.map(item => <div className="workspace-fact" key={item.id}><Tag>{item.status === 'qualified' ? '符合' : item.status === 'rejected' ? '不符合' : '待确认'}</Tag>{item.reason}
          <div className="workspace-muted">条件版本 {item.goalRevision} · {item.author} · {item.model} · {item.promptVersion}</div></div>) : <Typography.Paragraph type="secondary">尚未核验，保留待确认。</Typography.Paragraph>}
        <h3>录入记录</h3>
        {detail.deliveries.map(delivery => <div className="workspace-fact" key={delivery.id}><Tag>{delivery.status}</Tag>{delivery.targetHost} · {delivery.message}
          {delivery.status === 'unknown' && <Space direction="vertical"><Input.TextArea placeholder="在目标系统人工核对后的依据，例如记录 ID 或录入情况" value={note} onChange={event => setNote(event.target.value)} />
            <Space><Select value={status} onChange={setStatus} options={[{ value: 'recorded', label: '已录入' }, { value: 'duplicate', label: '已有重复记录' }, { value: 'failed', label: '确认未录入' }]} />
              <Button disabled={!note.trim()} onClick={() => void workspaceAction({ action: 'reconcile', operationId: delivery.id, status, message: note }).then(() => open(detail.lead.id)).catch(reason => setError(String(reason.message || reason)))}>登记核对结果</Button></Space></Space>}
        </div>)}
        {proof && <div className="workspace-evidence"><h3>原始证据</h3><p>{proof.provider} · {new Date(proof.collectedAt).toLocaleString()} · {proof.extractorVersion}</p>
          <p>步骤：{proof.stepId}</p><Button type="link" onClick={() => { const job = jobs.find(item => item.id === proof.taskId); if (job) window.location.hash = `#/workspace/${job.sessionId}`; }}>回到来源会话</Button>
          <pre>{JSON.stringify(proof.payload, null, 2)}</pre></div>}
      </>}
    </Drawer>
  </div>;
}
