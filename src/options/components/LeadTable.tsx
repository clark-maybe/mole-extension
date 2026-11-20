/** 线索列表与逐字段证据；同一组件用于任务结果和跨任务线索库。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Drawer, Empty, Input, Skeleton, Space, Table, Tag, Typography } from 'antd';
import { workspaceQuery } from '../../chat/workspace-client';
import Channel from '../../lib/channel';
import type { LeadDetail, LeadSummary } from '../../workspace/types';
import { getLeadContacts } from '../../workspace/lead-contacts';
import { LeadDetailPanel } from './LeadDetailPanel';
import { providerLabels } from './lead-detail-format';

export function LeadTable({ taskId }: { taskId?: string }) {
  const [leads, setLeads] = useState<LeadSummary[]>([]);
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<LeadDetail>();
  const [detailError, setDetailError] = useState('');
  const detailRequest = useRef(0);
  const invalidateDetail = useCallback(() => { detailRequest.current++; }, []);
  const [error, setError] = useState('');
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
  const refreshDetail = useCallback(async () => {
    if (!selectedId) return;
    const version = ++detailRequest.current;
    try {
      const result = await workspaceQuery<LeadDetail>({ kind: 'lead', leadId: selectedId });
      if (version === detailRequest.current) { setDetail(result); setDetailError(''); }
    } catch (reason) {
      if (version === detailRequest.current) setDetailError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [selectedId]);
  useEffect(() => {
    setDetail(undefined); setDetailError(''); void refreshDetail();
    return invalidateDetail;
  }, [refreshDetail, invalidateDetail]);
  useEffect(() => {
    const changed = () => { void refresh(); void refreshDetail(); };
    Channel.on('__workspace_changed', changed); Channel.on('__channel_reconnected', changed);
    return () => { Channel.off('__workspace_changed', changed); Channel.off('__channel_reconnected', changed); };
  }, [refresh, refreshDetail]);
  const open = (leadId: string) => {
    if (leadId === selectedId) return;
    detailRequest.current++; setDetail(undefined); setDetailError(''); setSelectedId(leadId);
  };
  const close = () => { detailRequest.current++; setSelectedId(''); setDetail(undefined); };
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
    const rows = [['线索ID', '名称', '类型', '来源平台', '判断', '判断依据', '条件版本', '法人', '法人手机号', '联系方式', '企业概览', '主营业务', '所在地区', '活跃情况', '跟进建议', '统一信用代码', '地址', '来源链接', '字段', '证据ID'], ...all.map(lead =>
      [lead.id, lead.name, lead.kind, lead.provider, !lead.assessment ? '业务待评估' : !lead.assessment.current ? '条件已变更' : lead.assessment.status, lead.assessment?.reason, lead.assessment?.goalRevision, lead.fields.legalPerson, lead.fields.legalPersonPhone, getLeadContacts(lead).map(contact => contact.value).join(';'), lead.profile?.summary, lead.profile?.business, lead.profile?.region, lead.profile?.activity, lead.profile?.nextStep, lead.fields.socialCreditCode, lead.fields.address, lead.sourceUrl, JSON.stringify(lead.fields), lead.evidenceIds.join(';')])];
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
        { title: '名称与联系', dataIndex: 'name', render: (value: string, lead) => {
          const contacts = getLeadContacts(lead), primary = contacts.find(contact => contact.kind === 'phone') || contacts[0];
          return <div className="lead-table-name"><Button type="link" onClick={() => open(lead.id)}>{value || '未命名线索'}</Button>
            {primary && <Typography.Text className="lead-table-contact" copyable={{ text: primary.value }}>{primary.value}</Typography.Text>}
            {contacts.some(contact => contact.trusted) && <span className="lead-table-trust">励销云 · 联系方式已获取</span>}</div>;
        } },
        { title: '业务匹配', key: 'assessment', render: (_value, lead) => <Tag color={lead.assessment?.current && lead.assessment.status === 'qualified' ? 'green' : undefined}>{!lead.assessment ? '待评估' : !lead.assessment.current ? '条件已变更' : lead.assessment.status === 'qualified' ? '符合' : lead.assessment.status === 'rejected' ? '不符合' : '信息待补充'}</Tag> },
        { title: '来源', dataIndex: 'provider', render: (value: LeadSummary['provider']) => providerLabels[value] },
      ]} />
    <Space className="workspace-toolbar"><Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))}>上一页</Button><span>{offset + 1}–{offset + leads.length}</span>
      <Button disabled={leads.length < 100} onClick={() => setOffset(offset + 100)}>下一页</Button></Space>
    <Drawer title="线索档案" className="lead-detail-drawer" open={Boolean(selectedId)} width={780} onClose={close} destroyOnHidden>
      {detailError && <Alert type="error" message={detailError} action={<Button size="small" onClick={() => void refreshDetail()}>重试</Button>} />}
      {detail ? <LeadDetailPanel key={detail.lead.id} detail={detail} taskId={taskId} refresh={refreshDetail} openLead={open} close={close} /> : !detailError && <Skeleton active paragraph={{ rows: 8 }} />}
    </Drawer>
  </div>;
}
