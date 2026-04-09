/**
 * Webhook 配置页面
 * 管理远端通知 webhook，深度适配 Bark（iOS 推送）
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Button, Form, Input, Modal, Select, Space, Switch, Table, Tag,
  Typography, App, Popconfirm, Divider,
} from 'antd';
import {
  PlusOutlined,
  ReloadOutlined,
  DeleteOutlined,
  SendOutlined,
  EditOutlined,
  LoadingOutlined,
  AppleOutlined,
  ApiOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { OptionsPageLayout, OptionsSectionCard } from '../components/PageLayout';
import type { WebhookEntry, WebhookType, BarkConfig } from '../../functions/webhook';
import {
  readWebhookConfig,
  saveWebhookConfig,
  sendToWebhook,
  getEntryDisplayUrl,
} from '../../functions/webhook';

const { Text } = Typography;

/** Bark 默认服务器 */
const BARK_DEFAULT_SERVER = 'https://api.day.app';

/** Bark 提示音列表 */
const BARK_SOUNDS = [
  'alarm', 'anticipate', 'bell', 'birdsong', 'bloom', 'calypso',
  'chime', 'choo', 'descent', 'electronic', 'fanfare', 'glass',
  'gotosleep', 'healthnotification', 'horn', 'ladder', 'mailsent',
  'minuet', 'multiwayinvitation', 'newmail', 'newsflash', 'noir',
  'paymentsuccess', 'shake', 'sherwoodforest', 'silence', 'spell',
  'suspense', 'telegraph', 'tiptoes', 'typewriters', 'update',
];

/** URL 脱敏显示 */
const maskUrl = (url: string): string => {
  try {
    const u = new URL(url);
    const host = u.hostname;
    const path = u.pathname;
    const display = host + (path.length > 20 ? path.slice(0, 20) + '…' : path);
    return u.protocol + '//' + display;
  } catch {
    return url.length > 40 ? url.slice(0, 40) + '…' : url;
  }
};

/** 类型标签渲染 */
const TypeTag = ({ type }: { type: WebhookType }) => {
  if (type === 'bark') {
    return (
      <Tag icon={<AppleOutlined />} color="blue">
        Bark
      </Tag>
    );
  }
  return (
    <Tag icon={<ApiOutlined />} color="default">
      通用
    </Tag>
  );
};

export function WebhookPage() {
  const { message } = App.useApp();
  const [webhooks, setWebhooks] = useState<WebhookEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [form] = Form.useForm();
  const webhookType = Form.useWatch('type', form) as WebhookType | undefined;

  /* 加载数据 */
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const list = await readWebhookConfig();
      setWebhooks(list);
    } catch {
      void message.error('加载 Webhook 配置失败');
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  /* 保存并刷新 */
  const persist = async (updated: WebhookEntry[]) => {
    await saveWebhookConfig(updated);
    setWebhooks(updated);
  };

  /* 新增弹窗 */
  const openAdd = () => {
    setEditingId(null);
    form.resetFields();
    form.setFieldsValue({ type: 'bark', barkServer: BARK_DEFAULT_SERVER, barkLevel: 'active' });
    setModalOpen(true);
  };

  /* 编辑弹窗 */
  const openEdit = (entry: WebhookEntry) => {
    setEditingId(entry.id);
    if (entry.type === 'bark' && entry.bark) {
      form.setFieldsValue({
        type: 'bark',
        name: entry.name,
        barkServer: entry.bark.server,
        barkDeviceKey: entry.bark.deviceKey,
        barkGroup: entry.bark.group || '',
        barkIcon: entry.bark.icon || '',
        barkSound: entry.bark.sound || undefined,
        barkClickUrl: entry.bark.clickUrl || '',
        barkLevel: entry.bark.level || 'active',
      });
    } else {
      form.setFieldsValue({
        type: 'generic',
        name: entry.name,
        url: entry.url,
        headers: entry.headers ? JSON.stringify(entry.headers, null, 2) : '',
      });
    }
    setModalOpen(true);
  };

  /* 表单提交 */
  const handleModalOk = async () => {
    try {
      const values = await form.validateFields();
      const type: WebhookType = values.type || 'generic';

      let entry: Partial<WebhookEntry> = {
        name: values.name,
        type,
      };

      if (type === 'bark') {
        const bark: BarkConfig = {
          server: (values.barkServer || BARK_DEFAULT_SERVER).replace(/\/+$/, ''),
          deviceKey: values.barkDeviceKey,
        };
        if (values.barkGroup?.trim()) bark.group = values.barkGroup.trim();
        if (values.barkIcon?.trim()) bark.icon = values.barkIcon.trim();
        if (values.barkSound) bark.sound = values.barkSound;
        if (values.barkClickUrl?.trim()) bark.clickUrl = values.barkClickUrl.trim();
        if (values.barkLevel && values.barkLevel !== 'active') bark.level = values.barkLevel;
        entry.bark = bark;
      } else {
        entry.url = values.url;
        if (values.headers?.trim()) {
          try {
            entry.headers = JSON.parse(values.headers);
          } catch {
            void message.error('自定义 Headers 必须是合法 JSON');
            return;
          }
        }
      }

      if (editingId) {
        const updated = webhooks.map((w) =>
          w.id === editingId ? { ...w, ...entry } : w,
        );
        await persist(updated);
        void message.success('Webhook 已更新');
      } else {
        const full: WebhookEntry = {
          id: String(Date.now()),
          enabled: true,
          createdAt: Date.now(),
          ...entry,
        } as WebhookEntry;
        await persist([...webhooks, full]);
        void message.success('Webhook 已添加');
      }
      setModalOpen(false);
    } catch {
      /* 表单校验失败 */
    }
  };

  /* 切换启用状态 */
  const handleToggle = async (id: string, enabled: boolean) => {
    const updated = webhooks.map((w) => (w.id === id ? { ...w, enabled } : w));
    await persist(updated);
  };

  /* 删除 */
  const handleRemove = async (id: string) => {
    const updated = webhooks.filter((w) => w.id !== id);
    await persist(updated);
    void message.success('Webhook 已删除');
  };

  /* 清空全部 */
  const handleClearAll = async () => {
    await persist([]);
    void message.success('所有 Webhook 已清空');
  };

  /* 测试发送 */
  const handleTest = async (entry: WebhookEntry) => {
    setTestingId(entry.id);
    try {
      const result = await sendToWebhook(entry, {
        title: 'Mole 测试通知',
        message: '如果你收到这条消息，说明配置正确 🎉',
      });
      if (result.success) {
        void message.success(`[${entry.name}] 测试成功`);
      } else {
        void message.error(`[${entry.name}] 测试失败: ${result.message}`);
      }
    } catch (err: any) {
      void message.error(`测试失败: ${err?.message || '未知错误'}`);
    } finally {
      setTestingId(null);
    }
  };

  const enabledCount = webhooks.filter((w) => w.enabled).length;
  const barkCount = webhooks.filter((w) => w.type === 'bark').length;

  const columns: ColumnsType<WebhookEntry> = [
    {
      title: '类型',
      dataIndex: 'type',
      width: 90,
      render: (_: unknown, entry: WebhookEntry) => <TypeTag type={entry.type} />,
    },
    {
      title: '名称',
      dataIndex: 'name',
      width: 160,
      render: (name: string) => <Text strong>{name}</Text>,
    },
    {
      title: '地址',
      key: 'address',
      render: (_: unknown, entry: WebhookEntry) => (
        <Text code style={{ fontSize: 12 }}>
          {entry.type === 'bark' ? getEntryDisplayUrl(entry) : maskUrl(entry.url || '')}
        </Text>
      ),
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 80,
      render: (_: unknown, entry: WebhookEntry) => (
        <Switch
          size="small"
          checked={entry.enabled}
          onChange={(checked) => void handleToggle(entry.id, checked)}
        />
      ),
    },
    {
      title: '操作',
      width: 180,
      render: (_: unknown, entry: WebhookEntry) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={testingId === entry.id ? <LoadingOutlined /> : <SendOutlined />}
            disabled={testingId !== null}
            onClick={() => void handleTest(entry)}
          >
            测试
          </Button>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEdit(entry)}
          >
            编辑
          </Button>
          <Popconfirm
            title={`确定删除 "${entry.name}" 吗？`}
            onConfirm={() => void handleRemove(entry.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <OptionsPageLayout
        eyebrow="Notifications"
        title="Webhook 配置"
        description="管理远端通知推送地址。AI 调用 webhook 工具时，会向所有已启用的地址发送通知。深度适配 Bark（iOS 推送），也支持飞书、Slack 等通用 Webhook。"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => void loadData()}>
              刷新
            </Button>
            <Popconfirm
              title="确定清空全部 Webhook 吗？"
              onConfirm={() => void handleClearAll()}
              okText="确定"
              cancelText="取消"
            >
              <Button danger icon={<DeleteOutlined />} disabled={webhooks.length === 0}>
                清空全部
              </Button>
            </Popconfirm>
            <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>
              添加 Webhook
            </Button>
          </Space>
        }
        metrics={[
          {
            label: 'Webhook 总数',
            value: webhooks.length,
            hint: webhooks.length > 0 ? `其中 ${enabledCount} 个已启用` : '尚未配置任何 Webhook',
            accent: webhooks.length > 0 ? 'blue' : 'neutral',
          },
          {
            label: 'Bark 设备',
            value: barkCount,
            hint: barkCount > 0 ? 'iOS 推送通知' : '可添加 Bark 实现 iPhone 推送',
            accent: barkCount > 0 ? 'green' : 'neutral',
          },
          {
            label: '存储位置',
            value: '本地',
            hint: '数据保存在 chrome.storage.local',
            accent: 'neutral',
          },
        ]}
      >
        <OptionsSectionCard
          title="Webhook 列表"
          description="AI 使用 webhook 工具时，会向所有已启用的地址发送通知。支持 Bark（iOS）和通用 Webhook 两种类型。"
        >
          <Table
            rowKey="id"
            columns={columns}
            dataSource={webhooks}
            loading={loading}
            pagination={false}
            size="small"
            locale={{ emptyText: '暂无 Webhook 配置，点击上方「添加 Webhook」开始' }}
          />
        </OptionsSectionCard>
      </OptionsPageLayout>

      {/* 新增/编辑弹窗 */}
      <Modal
        title={editingId ? '编辑 Webhook' : '添加 Webhook'}
        open={modalOpen}
        onOk={() => void handleModalOk()}
        onCancel={() => setModalOpen(false)}
        okText={editingId ? '保存' : '添加'}
        cancelText="取消"
        width={520}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          {/* 类型选择 */}
          <Form.Item label="类型" name="type" initialValue="bark">
            <Select
              options={[
                { value: 'bark', label: 'Bark（iOS 推送）' },
                { value: 'generic', label: '通用 Webhook' },
              ]}
            />
          </Form.Item>

          <Form.Item
            label="名称"
            name="name"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input placeholder={webhookType === 'bark' ? '如：我的 iPhone' : '如：飞书通知群'} />
          </Form.Item>

          {/* ---- Bark 表单 ---- */}
          {webhookType === 'bark' && (
            <>
              <Form.Item
                label="服务器地址"
                name="barkServer"
                extra="自部署填你的服务器地址，使用官方服务保持默认即可"
                initialValue={BARK_DEFAULT_SERVER}
              >
                <Input placeholder={BARK_DEFAULT_SERVER} />
              </Form.Item>

              <Form.Item
                label="Device Key"
                name="barkDeviceKey"
                rules={[{ required: true, message: '请输入 Bark Device Key' }]}
                extra="打开 Bark App 首页即可看到"
              >
                <Input placeholder="粘贴你的 Device Key" />
              </Form.Item>

              <Divider plain style={{ margin: '12px 0', fontSize: 12, color: '#999' }}>
                可选参数
              </Divider>

              <Form.Item label="推送分组" name="barkGroup">
                <Input placeholder="如：mole（同组通知会折叠显示）" />
              </Form.Item>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Form.Item label="提示音" name="barkSound" style={{ marginBottom: 12 }}>
                  <Select
                    allowClear
                    placeholder="默认"
                    options={BARK_SOUNDS.map((s) => ({ value: s, label: s }))}
                    showSearch
                  />
                </Form.Item>

                <Form.Item label="时效性" name="barkLevel" initialValue="active" style={{ marginBottom: 12 }}>
                  <Select
                    options={[
                      { value: 'active', label: '默认' },
                      { value: 'timeSensitive', label: '时效性（突破专注模式）' },
                      { value: 'passive', label: '被动（静默）' },
                    ]}
                  />
                </Form.Item>
              </div>

              <Form.Item label="自定义图标" name="barkIcon">
                <Input placeholder="图标 URL（如 https://example.com/icon.png）" />
              </Form.Item>

              <Form.Item label="点击跳转" name="barkClickUrl">
                <Input placeholder="点击通知后打开的 URL（可选）" />
              </Form.Item>
            </>
          )}

          {/* ---- 通用 Webhook 表单 ---- */}
          {webhookType === 'generic' && (
            <>
              <Form.Item
                label="Webhook URL"
                name="url"
                rules={[
                  { required: true, message: '请输入 Webhook URL' },
                  { type: 'url', message: '请输入合法的 URL' },
                ]}
              >
                <Input placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/xxx" />
              </Form.Item>
              <Form.Item
                label="自定义 Headers（可选）"
                name="headers"
                extra='JSON 格式，如 {"Authorization": "Bearer xxx"}'
              >
                <Input.TextArea rows={3} placeholder='{"Authorization": "Bearer xxx"}' />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
    </>
  );
}
