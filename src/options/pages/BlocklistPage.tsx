/**
 * 域名管理页面
 * 管理悬浮球禁用域名的黑名单
 */

import { useCallback, useEffect, useState } from 'react';
import { Button, Space, Table, Typography, App, Popconfirm } from 'antd';
import { ReloadOutlined, DeleteOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { OptionsPageLayout, OptionsSectionCard } from '../components/PageLayout';

const { Text } = Typography;

const DISABLED_DOMAINS_KEY = 'mole_disabled_domains_v1';

interface DisabledDomainsStore {
  version: 1;
  updatedAt: number;
  domains: string[];
}

/** 从 storage 读取黑名单域名列表 */
const readBlockedDomains = async (): Promise<string[]> => {
  const result = await new Promise<Record<string, unknown>>((resolve) => {
    chrome.storage.local.get(DISABLED_DOMAINS_KEY, resolve);
  });
  const raw = result[DISABLED_DOMAINS_KEY] as DisabledDomainsStore | undefined;
  if (!raw || !Array.isArray(raw.domains)) return [];
  return raw.domains;
};

/** 保存黑名单域名列表到 storage */
const persistBlockedDomains = async (domains: string[]): Promise<void> => {
  const payload: DisabledDomainsStore = {
    version: 1,
    updatedAt: Date.now(),
    domains: [...domains].sort(),
  };
  await new Promise<void>((resolve) => {
    chrome.storage.local.set({ [DISABLED_DOMAINS_KEY]: payload }, resolve);
  });
};

export function BlocklistPage() {
  const { message } = App.useApp();
  const [domains, setDomains] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const list = await readBlockedDomains();
      setDomains(list);
    } catch {
      void message.error('加载域名黑名单失败');
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  /* 删除单个域名 */
  const handleRemove = async (domain: string) => {
    const updated = domains.filter((d) => d !== domain);
    await persistBlockedDomains(updated);
    setDomains(updated);
    void message.success(`已移除 "${domain}"，该域名的悬浮球将在下次访问时恢复`);
  };

  /* 清空全部 */
  const handleClearAll = async () => {
    await persistBlockedDomains([]);
    setDomains([]);
    void message.success('域名黑名单已清空');
  };

  const columns: ColumnsType<string> = [
    {
      title: '域名',
      render: (_: unknown, domain: string) => (
        <span style={{ fontFamily: 'monospace' }}>{domain}</span>
      ),
    },
    {
      title: '操作',
      width: 80,
      render: (_: unknown, domain: string) => (
        <Button type="link" size="small" danger onClick={() => void handleRemove(domain)}>
          删除
        </Button>
      ),
    },
  ];

  return (
    <OptionsPageLayout
      eyebrow="Site Control"
      title="域名黑名单"
      description="这里管理被临时关闭悬浮球的站点。整体样式改造成更统一的后台管理风格后，这类表格页只需要关注数据和动作，不需要重复写页面骨架。"
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void loadData()}>刷新</Button>
          <Popconfirm
            title="确定清空全部已禁用的域名吗？"
            onConfirm={() => void handleClearAll()}
            okText="确定"
            cancelText="取消"
          >
            <Button danger icon={<DeleteOutlined />} disabled={domains.length === 0}>清空全部</Button>
          </Popconfirm>
        </Space>
      }
      metrics={[
        {
          label: '禁用域名数',
          value: domains.length,
          hint: domains.length > 0 ? '删除后会在下次访问时恢复悬浮球' : '当前没有被屏蔽的站点',
          accent: domains.length > 0 ? 'orange' : 'green',
        },
        {
          label: '存储位置',
          value: '本地',
          hint: '数据保存在 chrome.storage.local',
          accent: 'blue',
        },
        {
          label: '恢复方式',
          value: '按域名',
          hint: '支持单条删除或一键清空',
          accent: 'neutral',
        },
      ]}
    >
      <OptionsSectionCard
        title="域名列表"
        description="以下域名的悬浮球已被禁用。删除某个域名后，该域名的悬浮球将在下次访问时恢复。"
      >
        <Table
          rowKey={(domain) => domain}
          columns={columns}
          dataSource={domains}
          loading={loading}
          pagination={false}
          size="small"
          locale={{ emptyText: '暂无被禁用的域名' }}
        />
      </OptionsSectionCard>
    </OptionsPageLayout>
  );
}
