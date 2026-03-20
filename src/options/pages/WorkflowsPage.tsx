/**
 * Workflow 管理页面
 * 支持新建、编辑、删除、导入、导出 Workflow
 */

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Input, Modal, Space, Switch, Table, Tag, Typography, App, Popconfirm } from 'antd';
import { PlusOutlined, ImportOutlined, ExportOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { OptionsPageLayout, OptionsSectionCard } from '../components/PageLayout';

const { Text } = Typography;

/** Workflow 定义（与 registry 中格式一致） */
interface WorkflowItem {
  name: string;
  label: string;
  description: string;
  url_patterns: string[];
  parameters: Record<string, any>;
  plan: Record<string, any>;
  enabled: boolean;
  source: 'remote' | 'user';
  manifestUrl?: string;
  version: number;
  createdAt: number;
  updatedAt: number;
}

interface WorkflowStoreShape {
  version: 1;
  updatedAt: number;
  workflows: WorkflowItem[];
}

const WORKFLOW_STORAGE_KEY = 'mole_site_workflows_v1';

/** 从 storage 读取所有 workflow */
const readWorkflows = async (): Promise<WorkflowItem[]> => {
  const result = await new Promise<Record<string, unknown>>((resolve) => {
    chrome.storage.local.get(WORKFLOW_STORAGE_KEY, resolve);
  });
  const raw = result[WORKFLOW_STORAGE_KEY] as WorkflowStoreShape | undefined;
  if (!raw || !Array.isArray(raw.workflows)) return [];
  return raw.workflows;
};

/** 保存 workflow 列表到 storage */
const persistWorkflows = async (workflows: WorkflowItem[]): Promise<void> => {
  const payload: WorkflowStoreShape = {
    version: 1,
    updatedAt: Date.now(),
    workflows: [...workflows].sort((a, b) => a.name.localeCompare(b.name)),
  };
  await new Promise<void>((resolve) => {
    chrome.storage.local.set({ [WORKFLOW_STORAGE_KEY]: payload }, resolve);
  });
};

/** 通知 background 刷新 workflow 缓存 */
const invalidateWorkflowCache = (): void => {
  try {
    chrome.runtime.sendMessage({ type: '__workflow_registry_invalidate' }, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    // background 不可用时忽略
  }
};

/** 创建空白 workflow 模板 */
const createEmptyWorkflow = (): WorkflowItem => ({
  name: '',
  label: '',
  description: '',
  url_patterns: ['*://*/*'],
  parameters: { type: 'object', properties: {}, required: [] },
  plan: { version: 1, steps: [] },
  enabled: true,
  source: 'user',
  version: 1,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

export function WorkflowsPage() {
  const { message } = App.useApp();
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);

  /* Modal 编辑状态 */
  const [modalOpen, setModalOpen] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editorJson, setEditorJson] = useState('');
  const [editorError, setEditorError] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const items = await readWorkflows();
      setWorkflows(items);
    } catch {
      void message.error('加载 Workflow 列表失败');
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  /* 打开编辑弹窗 */
  const openEditor = (wf: WorkflowItem | null) => {
    if (wf) {
      setEditingName(wf.name);
      setEditorJson(JSON.stringify(wf, null, 2));
    } else {
      setEditingName(null);
      setEditorJson(JSON.stringify(createEmptyWorkflow(), null, 2));
    }
    setEditorError('');
    setModalOpen(true);
  };

  /* 保存 workflow（新增或更新） */
  const handleSave = async () => {
    let parsed: Record<string, any>;
    try {
      parsed = JSON.parse(editorJson);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setEditorError('Workflow JSON 必须是对象');
        return;
      }
    } catch {
      setEditorError('JSON 格式错误，请检查语法');
      return;
    }

    const name = String(parsed.name || '').trim();
    if (!name) { setEditorError('缺少必填字段 "name"（工作流唯一标识）'); return; }
    if (!parsed.label) { setEditorError('缺少必填字段 "label"（工作流显示名称）'); return; }
    if (!parsed.description) { setEditorError('缺少必填字段 "description"（工作流描述）'); return; }
    if (!parsed.plan || !Array.isArray(parsed.plan?.steps)) {
      setEditorError('缺少 "plan.steps" 数组（steps 需要嵌套在 plan 对象内）');
      return;
    }
    setEditorError('');

    const now = Date.now();
    const existing = workflows.find((w) => w.name === name);
    const item: WorkflowItem = {
      name,
      label: String(parsed.label || ''),
      description: String(parsed.description || ''),
      url_patterns: Array.isArray(parsed.url_patterns) ? parsed.url_patterns : ['*://*/*'],
      parameters: parsed.parameters || { type: 'object', properties: {} },
      plan: parsed.plan,
      enabled: parsed.enabled !== false,
      source: 'user',
      version: Math.max(1, Math.floor(Number(parsed.version) || 1)),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    const updated = workflows.filter((w) => w.name !== name);
    updated.push(item);
    await persistWorkflows(updated);
    setWorkflows(updated.sort((a, b) => a.name.localeCompare(b.name)));
    setModalOpen(false);
    void message.success(`Workflow "${name}" 已保存`);
    invalidateWorkflowCache();
  };

  /* 删除 workflow */
  const handleDelete = async (wf: WorkflowItem) => {
    const updated = workflows.filter((w) => w.name !== wf.name);
    await persistWorkflows(updated);
    setWorkflows(updated);
    void message.success(`Workflow "${wf.label}" 已删除`);
    invalidateWorkflowCache();
  };

  /* 导出选中 */
  const handleExport = () => {
    const toExport = workflows.filter((w) => selectedRowKeys.includes(w.name));
    if (toExport.length === 0) {
      void message.warning('请先勾选要导出的 Workflow');
      return;
    }
    const exportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      workflows: toExport.map(({ source, manifestUrl, createdAt, updatedAt, ...rest }) => rest),
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mole-workflows-${toExport.length}.json`;
    a.click();
    URL.revokeObjectURL(url);
    void message.success(`已导出 ${toExport.length} 个 Workflow`);
  };

  /* 导入 */
  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const rawList = Array.isArray(data?.workflows) ? data.workflows : (Array.isArray(data) ? data : [data]);

        let importedCount = 0;
        let skippedCount = 0;
        const updatedWorkflows = [...workflows];

        for (const raw of rawList) {
          const wfName = String(raw?.name || '').trim();
          if (!wfName || !raw?.label || !raw?.plan?.steps) {
            skippedCount++;
            continue;
          }

          const existingWf = updatedWorkflows.find((w) => w.name === wfName);
          if (existingWf) {
            if (!confirm(`"${wfName}" 已存在，是否覆盖？`)) {
              skippedCount++;
              continue;
            }
            const idx = updatedWorkflows.findIndex((w) => w.name === wfName);
            if (idx >= 0) updatedWorkflows.splice(idx, 1);
          }

          const now = Date.now();
          updatedWorkflows.push({
            name: wfName,
            label: String(raw.label || ''),
            description: String(raw.description || ''),
            url_patterns: Array.isArray(raw.url_patterns) ? raw.url_patterns : ['*://*/*'],
            parameters: raw.parameters || { type: 'object', properties: {} },
            plan: raw.plan,
            enabled: raw.enabled !== false,
            source: 'user',
            version: Math.max(1, Math.floor(Number(raw.version) || 1)),
            createdAt: existingWf?.createdAt || now,
            updatedAt: now,
          });
          importedCount++;
        }

        if (importedCount > 0) {
          await persistWorkflows(updatedWorkflows);
          setWorkflows(updatedWorkflows.sort((a, b) => a.name.localeCompare(b.name)));
          invalidateWorkflowCache();
        }
        void message.info(`导入完成：${importedCount} 个成功，${skippedCount} 个跳过`);
      } catch {
        void message.error('导入失败：文件格式不正确');
      }
    };
    input.click();
  };

  const columns: ColumnsType<WorkflowItem> = [
    {
      title: '名称',
      dataIndex: 'label',
      render: (label: string, wf: WorkflowItem) => (
        <div>
          <div style={{ fontWeight: 500 }}>{label || wf.name}</div>
          {wf.description ? (
            <Text type="secondary" style={{ fontSize: 12 }} ellipsis>{wf.description}</Text>
          ) : null}
        </div>
      ),
    },
    {
      title: '标识',
      dataIndex: 'name',
      width: 160,
      render: (name: string) => <code style={{ fontSize: 12, color: '#86868b' }}>{name}</code>,
    },
    {
      title: '来源',
      dataIndex: 'source',
      width: 80,
      render: (source: string) => (
        <Tag color={source === 'user' ? 'blue' : 'green'}>
          {source === 'user' ? '自定义' : '内置'}
        </Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 70,
      render: (enabled: boolean) => (
        <Switch size="small" checked={enabled} disabled />
      ),
    },
    {
      title: '操作',
      width: 120,
      render: (_: unknown, wf: WorkflowItem) => (
        <Space size="small">
          <Button type="link" size="small" onClick={() => openEditor(wf)}>编辑</Button>
          <Popconfirm
            title={`确定删除 "${wf.label || wf.name}" 吗？`}
            onConfirm={() => void handleDelete(wf)}
            okText="确定"
            cancelText="取消"
          >
            <Button type="link" size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <OptionsPageLayout
        eyebrow="Automation"
        title="站点工作流管理"
        description="这一页适合做成标准后台表格页：上方放标题和操作区，下方放概览卡片与数据表。这样既贴近你截图里的风格，也方便后面继续扩展筛选、分组和状态统计。"
        extra={
          <Space>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor(null)}>新建</Button>
            <Button icon={<ImportOutlined />} onClick={handleImport}>导入</Button>
            <Button icon={<ExportOutlined />} onClick={handleExport} disabled={selectedRowKeys.length === 0}>
              导出 ({selectedRowKeys.length})
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => void loadData()}>刷新</Button>
          </Space>
        }
        metrics={[
          {
            label: '工作流总数',
            value: workflows.length,
            hint: workflows.length > 0 ? '包含用户自定义与远端同步配置' : '还没有可用工作流',
            accent: 'blue',
          },
          {
            label: '启用数量',
            value: workflows.filter((wf) => wf.enabled).length,
            hint: '关闭后不会参与站点执行',
            accent: 'green',
          },
          {
            label: '当前已选择',
            value: selectedRowKeys.length,
            hint: '可用于批量导出',
            accent: selectedRowKeys.length > 0 ? 'orange' : 'neutral',
          },
        ]}
      >
        <OptionsSectionCard
          title="工作流列表"
          description="管理站点工作流。勾选后可批量导出，也可以直接通过 JSON 编辑器增删改配置。"
        >
          <Table
            rowKey="name"
            columns={columns}
            dataSource={workflows}
            loading={loading}
            pagination={false}
            size="small"
            rowSelection={{
              selectedRowKeys,
              onChange: (keys) => setSelectedRowKeys(keys as string[]),
            }}
            locale={{ emptyText: '暂无 Workflow' }}
          />
        </OptionsSectionCard>
      </OptionsPageLayout>

      <Modal
        title={editingName ? `编辑: ${editingName}` : '新建 Workflow'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => void handleSave()}
        okText="保存"
        cancelText="取消"
        width={720}
        destroyOnClose
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          编辑 Workflow 的 JSON 配置。必须包含 name、label、description 和 plan.steps 字段。
        </Text>
        <Input.TextArea
          value={editorJson}
          onChange={(e) => { setEditorJson(e.target.value); setEditorError(''); }}
          rows={18}
          style={{ fontFamily: '"SF Mono", "JetBrains Mono", "Menlo", monospace', fontSize: 12 }}
        />
        {editorError ? (
          <Alert message={editorError} type="error" showIcon style={{ marginTop: 12 }} />
        ) : null}
      </Modal>
    </>
  );
}
