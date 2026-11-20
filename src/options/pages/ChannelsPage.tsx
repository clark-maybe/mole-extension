/** 渠道登录入口、专用 CRM 环境绑定与完整本地备份。 */
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Input, Select, Space, Typography, Upload } from 'antd';
import { workspaceAction, workspaceQuery } from '../../chat/workspace-client';
import type { WorkspaceBackup } from '../../workspace/types';
import type { CrmConfig } from '../../platforms/mantis-crm';

export function ChannelsPage() {
  const [config, setConfig] = useState<{ crm?: CrmConfig; hasVerification: boolean }>();
  const [tabs, setTabs] = useState<chrome.tabs.Tab[]>([]);
  const [tabId, setTabId] = useState<number>();
  const [verification, setVerification] = useState('');
  const [capacity, setCapacity] = useState<StorageEstimate>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    const [settings, pages, estimate] = await Promise.all([
      workspaceQuery<{ crm?: CrmConfig; hasVerification: boolean }>({ kind: 'config' }),
      chrome.tabs.query({ url: ['https://bdtg.n4.bjmantis.cn/mantis*', 'https://njtlqc.n4.bjmantis.cn/mantis*'] }),
      workspaceQuery<StorageEstimate>({ kind: 'capacity' }),
    ]);
    setConfig(settings); setTabs(pages); setCapacity(estimate);
  }, []);
  useEffect(() => { void refresh().catch(reason => setError(reason.message)); }, [refresh]);
  const run = async (operation: () => Promise<unknown>, success: string) => {
    setError(''); setMessage('');
    try { await operation(); setMessage(success); await refresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const backup = async () => {
    const data = await workspaceQuery<WorkspaceBackup>({ kind: 'backup' });
    const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `Mole完整备份-${Date.now()}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const channels = [{ label: '抖音', url: 'https://www.douyin.com/' }, { label: '励销云', url: 'https://lxcrm.weiwenjia.com/' }, { label: '风鸟云', url: 'https://riskbird.com/' }];
  return <Space direction="vertical" size="large" style={{ width: '100%' }}>
    {error && <Alert type="error" message={error} />}{message && <Alert type="success" message={message} />}
    <Card title="平台渠道"><Space wrap>{channels.map(channel => <Button key={channel.label} onClick={() => void chrome.tabs.create({ url: channel.url })}>打开{channel.label}</Button>)}</Space>
      <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>平台复用各自的浏览器登录态。任务遇到登录或验证码时暂停，处理后在任务中继续。线索采集、企业与联系方式查询均可独立使用，CRM 仅用于录入数据。</Typography.Paragraph></Card>
    <Card title="可选录入渠道 · 螳螂 CRM"><Space direction="vertical" style={{ width: '100%' }}>
      <Typography.Paragraph type="secondary">找线索默认保存为结果表。只有需要录入此 CRM 时才配置以下信息；后续可接入其他录入渠道。</Typography.Paragraph>
      <Space wrap><Select placeholder="选择已登录的 CRM 工作台" value={tabId} onChange={setTabId} style={{ minWidth: 300 }} options={tabs.map(tab => ({ value: tab.id, label: tab.title || tab.url }))} />
        <Button onClick={() => void refresh().catch(reason => setError(reason.message))}>刷新页签</Button><Button disabled={!tabId} onClick={() => void run(() => workspaceAction({ action: 'bind_crm', tabId }), '已绑定公司与账号环境')}>绑定当前环境</Button></Space>
      {config?.crm && <><Typography.Text>目标：{config.crm.targetHost} · 配置版本 {config.crm.version}</Typography.Text><Typography.Text type="secondary">{config.crm.targetIdentity}</Typography.Text>
        <Typography.Text>产品 {config.crm.productId} / 省份 {config.crm.provinceId} / 地区 {config.crm.areaId}</Typography.Text></>}
      <Space><Input.Password value={verification} onChange={event => setVerification(event.target.value)} placeholder={config?.hasVerification ? '公司验证参数已配置' : '公司 CRM 验证参数'} autoComplete="new-password" />
        <Button disabled={!verification.trim()} onClick={() => void run(async () => { await workspaceAction({ action: 'set_verification', value: verification.trim() }); setVerification(''); }, '验证参数已保存')}>保存</Button></Space>
      <Typography.Paragraph type="secondary">验证参数只保存在当前扩展配置中，不包含在业务证据和完整备份中。CRM 提交使用任务创建时绑定的公司、账号与字段映射。</Typography.Paragraph>
    </Space></Card>
    <Card title="本地数据与备份"><Space direction="vertical">
      <Typography.Text>使用约 {((capacity?.usage || 0) / 1024 / 1024).toFixed(1)} MB；可用配额约 {((capacity?.quota || 0) / 1024 / 1024).toFixed(0)} MB</Typography.Text>
      <Space wrap><Button onClick={() => void run(backup, '完整备份已导出')}>导出完整备份</Button>
        <Upload accept="application/json,.json" showUploadList={false} beforeUpload={file => {
          void run(async () => {
            if (file.size > 64 * 1024 * 1024) throw new Error('单次备份导入上限为 64 MB');
            const data = JSON.parse(await file.text()) as WorkspaceBackup;
            await workspaceAction({ action: 'import', backup: data });
          }, '已合并导入，导入任务保持暂停'); return false;
        }}><Button>导入完整备份</Button></Upload></Space>
      <Typography.Paragraph type="secondary">完整备份包含会话、任务、线索、证据和 CRM 回执。CSV 仅导出线索。卸载或清除扩展数据前请先备份。</Typography.Paragraph>
    </Space></Card>
  </Space>;
}
