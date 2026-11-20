/** 企业档案：销售阅读、可信联系方式和可折叠来源；摘要由 Agent 持久填写。 */
import { useEffect, useRef, useState } from 'react';
import { Button, Collapse, Input, message, Modal, Select, Space, Tag, Typography } from 'antd';
import { ExportOutlined, CheckOutlined, CopyOutlined, MailOutlined, PhoneOutlined, SafetyCertificateOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { workspaceAction, workspaceQuery } from '../../chat/workspace-client';
import type { Delivery, EntityLink, Evidence, LeadContact, LeadDetail, LeadTask } from '../../workspace/types';
import { displayField, fieldLabels, providerLabels, sourceLink } from './lead-detail-format';

function CopyButton({ value, label = '复制' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true); clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(false), 1800);
    } catch { void message.error('复制失败，请选中文字后复制'); }
  };
  return <Button className="lead-copy" size="small" type="text" icon={copied ? <CheckOutlined /> : <CopyOutlined />} onClick={() => void copy()}
    aria-label={`${label}：${value}`} title={copied ? '已复制' : label}>{copied ? '已复制' : label}</Button>;
}

function ContactCard({ contact }: { contact: LeadContact }) {
  return <div className={`lead-contact is-${contact.kind}`}>
    <div className="lead-contact-top"><span className="lead-contact-kind">{contact.kind === 'phone' ? <PhoneOutlined /> : <MailOutlined />}
      {contact.legalRepresentative ? '法人手机' : contact.kind === 'phone' ? '联系电话' : '联系邮箱'}</span><CopyButton value={contact.value} /></div>
    <strong className="lead-contact-value">{contact.value}</strong>
    {(contact.names.length > 0 || contact.roles.length > 0) && <div className="lead-contact-person">{contact.names.join(' / ')}{contact.roles.length > 0 && <span>{contact.roles.join(' / ')}</span>}</div>}
    {contact.sources.length > 0 && <div className="lead-contact-sources">{contact.sources.join(' · ')}</div>}
  </div>;
}

function Association({ link, inspect, openLead, refresh }: { link: EntityLink; inspect: (id: string) => void; openLead: (id: string) => void; refresh: () => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    try { await workspaceAction({ action: 'confirm_company', link, reason }); await refresh(); }
    catch (error) { void message.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <div className="workspace-fact"><Tag>{link.status === 'confirmed' ? '已关联' : '候选主体'}</Tag>
    <Button type="link" onClick={() => openLead(link.companyLeadId)}>查看企业档案</Button><p>{link.reason}</p>
    {link.evidenceIds.map((id, index) => <Button key={id} type="link" size="small" onClick={() => inspect(id)}>来源 {index + 1}</Button>)}
    {link.status === 'candidate' && <Space.Compact block><Input aria-label="主体关联依据" placeholder="确认主体后的依据" value={reason} onChange={event => setReason(event.target.value)} />
      <Button disabled={!reason.trim()} loading={busy} onClick={() => void confirm()}>确认关联</Button></Space.Compact>}
  </div>;
}

function DeliveryRecord({ delivery, refresh }: { delivery: Delivery; refresh: () => Promise<void> }) {
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<'recorded' | 'duplicate' | 'failed'>('recorded');
  const [busy, setBusy] = useState(false);
  const reconcile = async () => {
    setBusy(true);
    try { await workspaceAction({ action: 'reconcile', operationId: delivery.id, status, message: note }); await refresh(); }
    catch (error) { void message.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const labels: Record<Delivery['status'], string> = { prepared: '待录入', sending: '录入中', recorded: '已录入', duplicate: '已有记录', failed: '录入失败', unknown: '需核对提交结果' };
  return <div className="workspace-fact"><Tag color={delivery.status === 'recorded' ? 'green' : undefined}>{labels[delivery.status]}</Tag>{delivery.targetHost}
    {delivery.message && <p>{delivery.message}</p>}
    {delivery.status === 'unknown' && <Space direction="vertical" style={{ width: '100%' }}><Input.TextArea aria-label="录入核对依据" placeholder="在目标系统核对后的依据，如记录 ID" value={note} onChange={event => setNote(event.target.value)} />
      <Space wrap><Select value={status} onChange={setStatus} options={[{ value: 'recorded', label: '已录入' }, { value: 'duplicate', label: '已有重复记录' }, { value: 'failed', label: '确认未录入' }]} />
        <Button disabled={!note.trim()} loading={busy} onClick={() => void reconcile()}>保存核对结果</Button></Space></Space>}
  </div>;
}

export function LeadDetailPanel({ detail, taskId, refresh, openLead, close }: { detail: LeadDetail; taskId?: string; refresh: () => Promise<void>; openLead: (id: string) => void; close: () => void }) {
  const { lead, contacts, facts, links, deliveries, profileHistory } = detail;
  const profile = lead.profile;
  const [proof, setProof] = useState<Evidence>();
  const [proofLoading, setProofLoading] = useState(false);
  const [proofOpen, setProofOpen] = useState(false);
  const evidenceRequest = useRef(0);
  const [sourceSession, setSourceSession] = useState('');
  useEffect(() => () => { evidenceRequest.current++; }, []);
  const inspect = async (id: string) => {
    const version = ++evidenceRequest.current;
    setProofOpen(true); setProofLoading(true); setProof(undefined); setSourceSession('');
    try {
      const result = await workspaceQuery<Evidence | undefined>({ kind: 'evidence', evidenceId: id });
      if (version !== evidenceRequest.current) return;
      if (!result) throw new Error('来源证据不存在');
      setProof(result);
      const task = await workspaceQuery<LeadTask | undefined>({ kind: 'task', taskId: result.taskId });
      if (version === evidenceRequest.current) setSourceSession(task?.sessionId || '');
    } catch (error) { if (version === evidenceRequest.current) void message.error(error instanceof Error ? error.message : String(error)); }
    finally { if (version === evidenceRequest.current) setProofLoading(false); }
  };
  const assessments = detail.assessments.filter(item => !taskId || item.taskId === taskId).sort((a, b) => b.createdAt - a.createdAt);
  const latest = assessments[0];
  const basicFields = ['legalPerson', 'establishmentDate', 'registeredCapital', 'industry', 'secondIndustry', 'thirdIndustry', 'address', 'contactAddress', 'socialCreditCode', 'officialWebsite'];
  const sourceTags = Array.isArray(lead.fields.tags) ? lead.fields.tags.filter((tag): tag is string => typeof tag === 'string') : [];
  const tags = [...new Set([...(profile?.tags || []), ...sourceTags])];
  const allContacts = contacts.map(contact => `${contact.names.join(' / ') || lead.name}\t${contact.value}`).join('\n');
  const evidenceButtons = (ids: string[]) => ids.map((id, index) => <Button type="link" size="small" key={id} onClick={() => void inspect(id)}>来源 {index + 1}</Button>);
  return <article className="lead-dossier">
    <header className="lead-dossier-hero">
      <div className="lead-dossier-eyebrow"><span>{providerLabels[lead.provider]}</span><span>{lead.kind === 'account' ? '平台账号' : lead.kind === 'store' ? '门店' : '企业档案'}</span></div>
      <h1>{lead.name || '未命名线索'}</h1>
      <div className="lead-dossier-meta">{displayField('status', lead.fields.status) && <Tag>{displayField('status', lead.fields.status)}</Tag>}
        <span>更新于 {new Date(lead.updatedAt).toLocaleString('zh-CN')}</span>
        {sourceLink(lead.sourceUrl) && <a href={sourceLink(lead.sourceUrl)} target="_blank" rel="noreferrer">原始来源 <ExportOutlined /></a>}</div>
      {tags.length > 0 && <div className="lead-dossier-tags">{tags.map(tag => <Tag key={tag}>{tag}</Tag>)}</div>}
    </header>

    <section className="lead-dossier-section lead-contacts-section">
      <div className="lead-section-heading"><h2>联系方式 <span>{contacts.length}</span></h2>{allContacts && <CopyButton value={allContacts} label="复制全部" />}</div>
      {contacts.length > 0 ? <>
        {contacts.every(contact => contact.trusted) && <div className="lead-trusted"><SafetyCertificateOutlined /> 励销云可信来源 · 可直接联系</div>}
        <div className="lead-contact-grid">{contacts.map(contact => <ContactCard key={`${contact.kind}:${contact.value}`} contact={contact} />)}</div>
      </> : <p className="lead-dossier-empty">{lead.fields.contactLoaded ? '本次查询未返回联系方式' : '联系方式尚未获取，Agent 补全后会自动显示'}</p>}
    </section>

    <section className="lead-dossier-section lead-agent-section">
      <div className="lead-section-heading"><h2><ThunderboltOutlined /> 企业概览</h2>{profile && <span className="lead-section-caption">Agent 整理 · 第 {profile.revision} 版</span>}</div>
      {profile ? <>
        <p className="lead-profile-summary">{profile.summary}</p>
        <div className="lead-profile-grid">{([['business', '主营业务'], ['region', '所在地区'], ['activity', '活跃情况']] as const).map(([key, label]) => profile[key] && <div key={key}><h3>{label}</h3><p>{profile[key]}</p></div>)}</div>
        {profile.nextStep && <div className="lead-next-step"><span>跟进建议</span><p>{profile.nextStep}</p></div>}
        <div className="lead-profile-footnote"><span>整理于 {new Date(profile.createdAt).toLocaleString('zh-CN')}</span>{evidenceButtons(profile.evidenceIds)}</div>
      </> : <p className="lead-dossier-empty">{displayField('signature', lead.fields.signature) || displayField('industry', lead.fields.industry) || '已采集信息保存在下方。'}<br />Agent 整理的业务摘要与跟进建议会自动保存在这里。</p>}
    </section>

    {latest && <section className="lead-dossier-section"><div className="lead-section-heading"><h2>业务匹配</h2>
      <Tag color={latest.current && latest.status === 'qualified' ? 'green' : latest.current && latest.status === 'rejected' ? 'red' : undefined}>{!latest.current ? '条件已变更' : latest.status === 'qualified' ? '符合条件' : latest.status === 'rejected' ? '不符合条件' : '业务信息待补充'}</Tag></div>
      <p className="lead-assessment-reason">{latest.reason}</p><div className="lead-profile-footnote"><span>针对条件版本 {latest.goalRevision} 的判断</span>{evidenceButtons(latest.evidenceIds)}</div>
    </section>}

    {basicFields.some(field => displayField(field, lead.fields[field])) && <section className="lead-dossier-section"><div className="lead-section-heading"><h2>{lead.kind === 'account' ? '账号资料' : '工商资料'}</h2><span className="lead-section-caption">来源原值</span></div>
      <dl className="lead-business-fields">{basicFields.map(field => {
        const value = displayField(field, lead.fields[field]);
        if (!value) return null;
        return <div key={field} className={['address', 'contactAddress', 'socialCreditCode'].includes(field) ? 'is-wide' : ''}><dt>{fieldLabels[field]}</dt>
          <dd>{field === 'officialWebsite' && sourceLink(value) ? <a href={sourceLink(value)} target="_blank" rel="noreferrer">{value}</a> : value}
            {field === 'socialCreditCode' && <CopyButton value={value} />}</dd></div>;
      })}</dl>
    </section>}

    {links.length > 0 && <section className="lead-dossier-section"><div className="lead-section-heading"><h2>关联企业</h2></div>{links.map(link => <Association key={link.id} link={link} inspect={id => void inspect(id)} openLead={openLead} refresh={refresh} />)}</section>}
    {deliveries.length > 0 && <section className="lead-dossier-section"><div className="lead-section-heading"><h2>录入记录</h2><span className="lead-section-caption">可选录入渠道</span></div>{deliveries.map(delivery => <DeliveryRecord key={delivery.id} delivery={delivery} refresh={refresh} />)}</section>}

    <Collapse className="lead-trace" ghost items={[
      { key: 'sources', label: `来源与证据 · ${lead.evidenceIds.length}`, children: <div className="lead-source-list">{lead.evidenceIds.map((id, index) => <div key={id}><span>采集来源 {index + 1}</span><Button size="small" type="link" onClick={() => void inspect(id)}>查看证据与来源会话</Button></div>)}</div> },
      ...(profileHistory.length > 0 ? [{ key: 'profiles', label: `档案整理历史 · 最近 ${profileHistory.length} 版`, children: profileHistory.map(item => <div className="workspace-fact" key={item.id}><strong>第 {item.revision} 版</strong><time className="lead-section-caption"> · {new Date(item.createdAt).toLocaleString('zh-CN')}</time>
        <p>{item.summary}</p><details><summary>完整整理内容与依据</summary><pre>{JSON.stringify(item, null, 2)}</pre></details>{evidenceButtons(item.evidenceIds)}</div>) }] : []),
      ...(assessments.length > 0 ? [{ key: 'assessments', label: `业务判断历史 · ${assessments.length}`, children: assessments.map(item => <div className="workspace-fact" key={item.id}><Tag>{item.status === 'qualified' ? '符合条件' : item.status === 'rejected' ? '不符合条件' : '业务信息待补充'}</Tag><p>{item.reason}</p>
        <div className="workspace-muted">条件版本 {item.goalRevision} · {item.model} · {item.promptVersion} · {new Date(item.createdAt).toLocaleString('zh-CN')}</div>{evidenceButtons(item.evidenceIds)}</div>) }] : []),
      { key: 'facts', label: `字段与采集记录 · ${facts.length}`, children: facts.map(fact => <div className="workspace-fact" key={fact.id}><strong>{fieldLabels[fact.field] || fact.field}</strong><Button size="small" type="link" onClick={() => void inspect(fact.evidenceId)}>来源证据</Button>
        <details><summary>{displayField(fact.field, fact.value).slice(0, 120) || '查看原始值'}</summary><pre>{JSON.stringify({ value: fact.value, rawValue: fact.rawValue, sourcePath: fact.sourcePath, taskId: fact.taskId }, null, 2)}</pre></details><div className="workspace-muted">{new Date(fact.createdAt).toLocaleString('zh-CN')}</div></div>) },
      { key: 'raw', label: '原始数据与追踪标识', children: <pre>{JSON.stringify({ id: lead.id, sourceKey: lead.sourceKey, sourceUrl: lead.sourceUrl, fields: lead.fields }, null, 2)}</pre> },
    ]} />
    <Modal title="来源证据" open={proofOpen} width={720} footer={null} onCancel={() => { evidenceRequest.current++; setProofOpen(false); }} loading={proofLoading}>
      {proof && <div className="lead-evidence-view"><Space wrap><Tag>{providerLabels[proof.provider]}</Tag><span>{new Date(proof.collectedAt).toLocaleString('zh-CN')}</span>
        {sourceSession && <Button type="link" onClick={() => { close(); window.location.hash = `#/workspace/${sourceSession}`; }}>回到来源会话</Button>}
        {sourceLink(proof.sourceUrl) && <a href={sourceLink(proof.sourceUrl)} target="_blank" rel="noreferrer">打开来源</a>}</Space>
        <Typography.Paragraph type="secondary">采集器 {proof.extractorVersion} · 步骤 {proof.stepId}</Typography.Paragraph><pre>{JSON.stringify(proof.payload, null, 2)}</pre></div>}
    </Modal>
  </article>;
}
