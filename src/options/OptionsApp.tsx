import { useCallback, useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { getAISettings, saveAISettings } from '../ai/llm-client';
import { SESSION_HISTORY_STORAGE_KEY } from '../session-history/constants';
import type { SessionHistoryRecord } from '../session-history/types';

type OptionsTab = 'settings' | 'workflows' | 'history' | 'blocklist';

/** 格式化耗时（毫秒 → 可读文本） */
const formatDuration = (ms?: number): string => {
    if (ms == null) return '-';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.round((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
};

/** 状态标签中文映射 */
const STATUS_LABEL: Record<string, string> = {
    done: '完成',
    error: '失败',
    running: '运行中',
    cleared: '已清除',
};

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
    const result = await new Promise<Record<string, unknown>>(resolve => {
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
    await new Promise<void>(resolve => {
        chrome.storage.local.set({ [WORKFLOW_STORAGE_KEY]: payload }, resolve);
    });
};

/** 通知 background 刷新 workflow 缓存 */
const invalidateWorkflowCache = (): void => {
    try {
        chrome.runtime.sendMessage({ type: '__workflow_registry_invalidate' }, () => {
            // 忽略错误（background 可能暂时不可用）
            void chrome.runtime.lastError;
        });
    } catch {
        // background 不可用时 sendMessage 可能同步抛异常
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

// ============ 域名黑名单存储 ============

const DISABLED_DOMAINS_KEY = 'mole_disabled_domains_v1';

interface DisabledDomainsStore {
    version: 1;
    updatedAt: number;
    domains: string[];
}

/** 从 storage 读取黑名单域名列表 */
const readBlockedDomains = async (): Promise<string[]> => {
    const result = await new Promise<Record<string, unknown>>(resolve => {
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
    await new Promise<void>(resolve => {
        chrome.storage.local.set({ [DISABLED_DOMAINS_KEY]: payload }, resolve);
    });
};

/** 从 storage 读取会话历史记录 */
const readSessionHistory = async (): Promise<SessionHistoryRecord[]> => {
    const result = await new Promise<Record<string, unknown>>(resolve => {
        chrome.storage.local.get(SESSION_HISTORY_STORAGE_KEY, resolve);
    });
    const raw = result[SESSION_HISTORY_STORAGE_KEY];
    // 兼容两种存储格式：{ version, records } 或直接是数组
    if (Array.isArray(raw)) return raw as SessionHistoryRecord[];
    if (raw && typeof raw === 'object' && Array.isArray((raw as any).records)) {
        return (raw as any).records as SessionHistoryRecord[];
    }
    return [];
};

export function OptionsApp() {
    const [view, setView] = useState<OptionsTab>('settings');
    const [notice, setNotice] = useState('');

    // notice 自动消失
    useEffect(() => {
        if (!notice) return;
        const timer = globalThis.setTimeout(() => setNotice(''), 3000);
        return () => clearTimeout(timer);
    }, [notice]);

    // LLM 设置相关状态
    const [settingsEndpoint, setSettingsEndpoint] = useState('');
    const [settingsApiKey, setSettingsApiKey] = useState('');
    const [settingsModel, setSettingsModel] = useState('');
    const [showApiKey, setShowApiKey] = useState(false);
    const [savingSettings, setSavingSettings] = useState(false);

    // Workflow 管理相关状态
    const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
    const [loadingWorkflows, setLoadingWorkflows] = useState(false);
    const [selectedWorkflowName, setSelectedWorkflowName] = useState<string | null>(null);
    const [workflowEditorJson, setWorkflowEditorJson] = useState('');
    const [_workflowEditorDirty, setWorkflowEditorDirty] = useState(false);
    const [workflowEditorError, setWorkflowEditorError] = useState('');
    const [exportSelection, setExportSelection] = useState<Set<string>>(new Set());

    // 域名黑名单相关状态
    const [blockedDomains, setBlockedDomains] = useState<string[]>([]);
    const [loadingBlocklist, setLoadingBlocklist] = useState(false);

    // 历史记录相关状态
    const [historyRecords, setHistoryRecords] = useState<SessionHistoryRecord[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

    // 加载 Workflow 列表
    const loadWorkflows = useCallback(async () => {
        setLoadingWorkflows(true);
        try {
            const items = await readWorkflows();
            setWorkflows(items);
        } catch {
            setNotice('加载 Workflow 列表失败');
        } finally {
            setLoadingWorkflows(false);
        }
    }, []);

    useEffect(() => {
        void loadWorkflows();
    }, [loadWorkflows]);

    // 加载 LLM 设置
    useEffect(() => {
        const loadSettings = async () => {
            const settings = await getAISettings();
            setSettingsEndpoint(settings.endpoint || '');
            setSettingsApiKey(settings.apiKey || '');
            setSettingsModel(settings.model || '');
        };
        void loadSettings();
    }, []);

    // 加载黑名单域名
    const loadBlockedDomains = useCallback(async () => {
        setLoadingBlocklist(true);
        try {
            const domains = await readBlockedDomains();
            setBlockedDomains(domains);
        } catch {
            setNotice('加载域名黑名单失败');
        } finally {
            setLoadingBlocklist(false);
        }
    }, []);

    // 切换到域名管理 tab 时加载数据
    useEffect(() => {
        if (view === 'blocklist') {
            void loadBlockedDomains();
        }
    }, [view, loadBlockedDomains]);

    // 加载历史记录
    const loadHistory = useCallback(async () => {
        setLoadingHistory(true);
        try {
            const records = await readSessionHistory();
            // 按 updatedAt 降序排列
            records.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
            setHistoryRecords(records);
        } catch {
            setNotice('加载历史记录失败');
        } finally {
            setLoadingHistory(false);
        }
    }, []);

    // 切换到历史记录 tab 时自动加载
    useEffect(() => {
        if (view === 'history') {
            void loadHistory();
        }
    }, [view, loadHistory]);

    // 监听 storage 变化，实时刷新历史记录
    useEffect(() => {
        const handler = (changes: { [key: string]: chrome.storage.StorageChange }) => {
            if (changes[SESSION_HISTORY_STORAGE_KEY] && view === 'history') {
                void loadHistory();
            }
        };
        chrome.storage.onChanged.addListener(handler);
        return () => chrome.storage.onChanged.removeListener(handler);
    }, [view, loadHistory]);

    // 保存 LLM 设置
    const handleSaveSettings = async () => {
        setSavingSettings(true);
        try {
            await saveAISettings({
                endpoint: settingsEndpoint.trim(),
                apiKey: settingsApiKey.trim(),
                model: settingsModel.trim(),
            });
            setNotice('LLM 设置已保存');
        } catch (err: any) {
            setNotice(err?.message || '保存设置失败');
        } finally {
            setSavingSettings(false);
        }
    };

    // ============ Workflow 管理操作 ============

    /** 选择 workflow */
    const selectWorkflow = (name: string) => {
        const wf = workflows.find(w => w.name === name);
        if (!wf) return;
        setSelectedWorkflowName(name);
        setWorkflowEditorJson(JSON.stringify(wf, null, 2));
        setWorkflowEditorDirty(false);
    };

    /** 保存 workflow（新增或更新） */
    const handleSaveWorkflow = async () => {
        let parsed: Record<string, any>;
        try {
            parsed = JSON.parse(workflowEditorJson);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                setWorkflowEditorError('Workflow JSON 必须是对象');
                return;
            }
        } catch {
            setWorkflowEditorError('JSON 格式错误，请检查语法');
            return;
        }

        const name = String(parsed.name || '').trim();
        if (!name) {
            setWorkflowEditorError('缺少必填字段 "name"（工作流唯一标识）');
            return;
        }
        if (!parsed.label) {
            setWorkflowEditorError('缺少必填字段 "label"（工作流显示名称）');
            return;
        }
        if (!parsed.description) {
            setWorkflowEditorError('缺少必填字段 "description"（工作流描述）');
            return;
        }
        if (!parsed.plan || !Array.isArray(parsed.plan?.steps)) {
            setWorkflowEditorError('缺少 "plan.steps" 数组（steps 需要嵌套在 plan 对象内）');
            return;
        }
        setWorkflowEditorError('');

        // 构建 WorkflowItem
        const now = Date.now();
        const existing = workflows.find(w => w.name === name);
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

        // 更新列表
        const updated = workflows.filter(w => w.name !== name);
        updated.push(item);

        await persistWorkflows(updated);
        setWorkflows(updated.sort((a, b) => a.name.localeCompare(b.name)));
        setSelectedWorkflowName(name);
        setWorkflowEditorDirty(false);
        setNotice(`Workflow "${name}" 已保存`);
        invalidateWorkflowCache();
    };

    /** 删除 workflow */
    const handleDeleteWorkflow = async () => {
        if (!selectedWorkflowName) return;
        const wf = workflows.find(w => w.name === selectedWorkflowName);
        if (!wf) return;

        if (!confirm(`确定删除 "${wf.label || wf.name}" 吗？`)) return;

        const updated = workflows.filter(w => w.name !== selectedWorkflowName);
        await persistWorkflows(updated);
        setWorkflows(updated);
        setSelectedWorkflowName(null);
        setWorkflowEditorJson('');
        setWorkflowEditorDirty(false);
        setNotice(`Workflow "${wf.label}" 已删除`);
        invalidateWorkflowCache();
    };

    /** 新增 workflow */
    const handleNewWorkflow = () => {
        const empty = createEmptyWorkflow();
        setSelectedWorkflowName(null);
        setWorkflowEditorJson(JSON.stringify(empty, null, 2));
        setWorkflowEditorDirty(true);
    };

    /** 导出选中的 workflow */
    const handleExportSelected = () => {
        const toExport = workflows.filter(w => exportSelection.has(w.name));
        if (toExport.length === 0) {
            setNotice('请先勾选要导出的 Workflow');
            return;
        }
        // 导出格式与 manifest.json 兼容
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
        setNotice(`已导出 ${toExport.length} 个 Workflow`);
    };

    /** 导入 workflow */
    const handleImportWorkflows = () => {
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

                    const existingWf = updatedWorkflows.find(w => w.name === wfName);
                    if (existingWf) {
                        // 同名冲突：询问覆盖
                        if (!confirm(`"${wfName}" 已存在，是否覆盖？`)) {
                            skippedCount++;
                            continue;
                        }
                        // 移除旧的
                        const idx = updatedWorkflows.findIndex(w => w.name === wfName);
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
                }
                setNotice(`导入完成：${importedCount} 个成功，${skippedCount} 个跳过`);
                if (importedCount > 0) {
                    invalidateWorkflowCache();
                }
            } catch {
                setNotice('导入失败：文件格式不正确');
            }
        };
        input.click();
    };

    /** 导出勾选框切换 */
    const toggleExportSelection = (name: string) => {
        setExportSelection(prev => {
            const next = new Set(prev);
            if (next.has(name)) {
                next.delete(name);
            } else {
                next.add(name);
            }
            return next;
        });
    };

    // ============ 域名黑名单操作 ============

    /** 删除单个域名 */
    const handleRemoveDomain = async (domain: string) => {
        const updated = blockedDomains.filter(d => d !== domain);
        await persistBlockedDomains(updated);
        setBlockedDomains(updated);
        setNotice(`已移除 "${domain}"，该域名的悬浮球将在下次访问时恢复`);
    };

    /** 清空全部黑名单 */
    const handleClearAllDomains = async () => {
        if (!confirm('确定清空全部已禁用的域名吗？')) return;
        await persistBlockedDomains([]);
        setBlockedDomains([]);
        setNotice('域名黑名单已清空');
    };

    // ============ 历史记录操作 ============

    /** 清空全部历史记录 */
    const handleClearAllHistory = async () => {
        if (!confirm('确定清空全部历史记录吗？此操作不可撤销。')) return;
        await new Promise<void>(resolve => {
            chrome.storage.local.remove(SESSION_HISTORY_STORAGE_KEY, resolve);
        });
        setHistoryRecords([]);
        setSelectedSessionId(null);
        setNotice('历史记录已清空');
    };

    /** 获取选中的历史记录 */
    const selectedRecord = historyRecords.find(r => r.sessionId === selectedSessionId) || null;

    return (
        <div className="debug-shell">
            <header className="debug-header">
                <div className="header-brand">
                    <img src="logo.png" alt="Mole" className="header-logo" />
                    <div>
                        <h1>Mole 设置</h1>
                        <p>LLM 配置 · 工作流管理 · 域名管理 · 历史记录</p>
                    </div>
                </div>
                <div className="header-actions">
                    {notice ? <span className="notice-pill">{notice}</span> : null}
                </div>
            </header>

            <div className="workspace-grid">
                <aside className="side-panel">
                    <div className="mode-switch">
                        <button type="button" className={`mode-btn ${view === 'settings' ? 'is-active' : ''}`} onClick={() => setView('settings')}>LLM 设置</button>
                        <button type="button" className={`mode-btn ${view === 'workflows' ? 'is-active' : ''}`} onClick={() => setView('workflows')}>Workflows</button>
                        <button type="button" className={`mode-btn ${view === 'blocklist' ? 'is-active' : ''}`} onClick={() => setView('blocklist')}>域名管理</button>
                        <button type="button" className={`mode-btn ${view === 'history' ? 'is-active' : ''}`} onClick={() => setView('history')}>历史记录</button>
                    </div>

                    {view === 'workflows' ? (
                        <div className="card-list">
                            <h3>Workflow 列表</h3>
                            {loadingWorkflows ? <p className="muted">加载中...</p> : null}
                            {!loadingWorkflows && workflows.length === 0 ? <p className="muted">暂无</p> : null}
                            {workflows.map((wf) => (
                                <div key={wf.name} className={`tool-row ${selectedWorkflowName === wf.name ? 'is-active' : ''}`}>
                                    <input
                                        type="checkbox"
                                        checked={exportSelection.has(wf.name)}
                                        onChange={() => toggleExportSelection(wf.name)}
                                        onClick={(e) => e.stopPropagation()}
                                        className="workflow-checkbox"
                                    />
                                    <button
                                        type="button"
                                        className="workflow-select-btn"
                                        onClick={() => selectWorkflow(wf.name)}
                                    >
                                        <span>{wf.label || wf.name}</span>
                                        <small>{wf.source === 'user' ? '自定义' : '内置'}</small>
                                    </button>
                                </div>
                            ))}
                        </div>
                    ) : null}

                    {view === 'history' ? (
                        <div className="card-list">
                            <h3>会话历史</h3>
                            {loadingHistory ? <p className="muted">加载中...</p> : null}
                            {!loadingHistory && historyRecords.length === 0 ? <p className="muted">暂无记录</p> : null}
                            {historyRecords.map((record) => (
                                <div
                                    key={record.sessionId}
                                    className={`tool-row ${selectedSessionId === record.sessionId ? 'is-active' : ''}`}
                                    onClick={() => setSelectedSessionId(record.sessionId)}
                                >
                                    <div className="history-row-content">
                                        <div className="history-row-top">
                                            <span className="history-summary">{record.summary || '(无摘要)'}</span>
                                            <span className={`history-status-badge history-status-${record.status}`}>
                                                {STATUS_LABEL[record.status] || record.status}
                                            </span>
                                        </div>
                                        <small>{dayjs(record.updatedAt).format('MM-DD HH:mm')}</small>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : null}
                </aside>

                <main className="main-panel">
                    {view === 'settings' ? (
                        <>
                            <section className="card">
                                <h2>LLM 配置</h2>
                                <p className="muted">配置你的 LLM API 连接信息，支持 OpenAI 兼容接口。</p>
                                <label className="field">
                                    <span>Endpoint URL</span>
                                    <input
                                        value={settingsEndpoint}
                                        onChange={(e) => setSettingsEndpoint(e.target.value)}
                                        placeholder="https://api.openai.com/v1"
                                    />
                                </label>
                                <label className="field">
                                    <div className="field-head">
                                        <span>API Key</span>
                                        <button type="button" className="ghost-btn small" onClick={() => setShowApiKey(!showApiKey)}>
                                            {showApiKey ? '隐藏' : '显示'}
                                        </button>
                                    </div>
                                    <input
                                        type={showApiKey ? 'text' : 'password'}
                                        value={settingsApiKey}
                                        onChange={(e) => setSettingsApiKey(e.target.value)}
                                        placeholder="sk-..."
                                    />
                                </label>
                                <label className="field">
                                    <span>Model</span>
                                    <input
                                        value={settingsModel}
                                        onChange={(e) => setSettingsModel(e.target.value)}
                                        placeholder="gpt-4o"
                                    />
                                </label>
                                <button type="button" className="primary-btn" disabled={savingSettings} onClick={() => void handleSaveSettings()}>
                                    {savingSettings ? '保存中...' : '保存设置'}
                                </button>
                            </section>
                        </>
                    ) : null}

                    {view === 'workflows' ? (
                        <>
                            <section className="card">
                                <div className="field-head">
                                    <h2>Workflow 管理</h2>
                                    <div className="workflow-actions">
                                        <button type="button" className="ghost-btn small" onClick={handleNewWorkflow}>新建</button>
                                        <button type="button" className="ghost-btn small" onClick={handleImportWorkflows}>导入</button>
                                        <button type="button" className="ghost-btn small" onClick={handleExportSelected} disabled={exportSelection.size === 0}>
                                            导出 ({exportSelection.size})
                                        </button>
                                        <button type="button" className="ghost-btn small" onClick={() => void loadWorkflows()}>刷新</button>
                                    </div>
                                </div>
                                <p className="muted">选择左侧列表中的 Workflow 进行编辑，或新建 / 导入。勾选后可批量导出。</p>
                            </section>

                            <section className="card">
                                <div className="field-head">
                                    <h2>{selectedWorkflowName ? `编辑: ${selectedWorkflowName}` : '新建 Workflow'}</h2>
                                </div>
                                <label className="field">
                                    <span>Workflow JSON</span>
                                    <textarea
                                        value={workflowEditorJson}
                                        onChange={(e) => { setWorkflowEditorJson(e.target.value); setWorkflowEditorDirty(true); setWorkflowEditorError(''); }}
                                        placeholder='选择一个 Workflow 或点击 "新建"'
                                        className="workflow-editor"
                                    />
                                </label>
                                {workflowEditorError ? (
                                    <div className="workflow-editor-error">{workflowEditorError}</div>
                                ) : null}
                                <div className="workflow-editor-actions">
                                    <button
                                        type="button"
                                        className="primary-btn"
                                        onClick={() => void handleSaveWorkflow()}
                                        disabled={!workflowEditorJson.trim()}
                                    >
                                        保存
                                    </button>
                                    {selectedWorkflowName ? (
                                        <button
                                            type="button"
                                            className="ghost-btn"
                                            onClick={() => void handleDeleteWorkflow()}
                                        >
                                            删除
                                        </button>
                                    ) : null}
                                </div>
                            </section>
                        </>
                    ) : null}

                    {view === 'blocklist' ? (
                        <>
                            <section className="card">
                                <div className="field-head">
                                    <h2>域名管理</h2>
                                    <div className="workflow-actions">
                                        <button type="button" className="ghost-btn small" onClick={() => void loadBlockedDomains()}>刷新</button>
                                        <button
                                            type="button"
                                            className="ghost-btn small"
                                            onClick={() => void handleClearAllDomains()}
                                            disabled={blockedDomains.length === 0}
                                        >
                                            清空全部
                                        </button>
                                    </div>
                                </div>
                                <p className="muted">
                                    以下域名的悬浮球已被禁用。删除某个域名后，该域名的悬浮球将在下次访问时恢复。
                                </p>
                            </section>

                            <section className="card">
                                {loadingBlocklist ? <p className="muted">加载中...</p> : null}
                                {!loadingBlocklist && blockedDomains.length === 0 ? (
                                    <p className="muted">暂无被禁用的域名</p>
                                ) : null}
                                {!loadingBlocklist && blockedDomains.length > 0 ? (
                                    <div className="blocklist-items">
                                        {blockedDomains.map((domain) => (
                                            <div key={domain} className="blocklist-row">
                                                <span className="blocklist-domain">{domain}</span>
                                                <button
                                                    type="button"
                                                    className="ghost-btn small"
                                                    onClick={() => void handleRemoveDomain(domain)}
                                                >
                                                    删除
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                ) : null}
                            </section>
                        </>
                    ) : null}

                    {view === 'history' ? (
                        <>
                            {/* 操作栏 */}
                            <section className="card">
                                <div className="field-head">
                                    <h2>历史记录</h2>
                                    <div className="workflow-actions">
                                        <button type="button" className="ghost-btn small" onClick={() => void loadHistory()}>刷新</button>
                                        <button
                                            type="button"
                                            className="ghost-btn small"
                                            onClick={() => void handleClearAllHistory()}
                                            disabled={historyRecords.length === 0}
                                        >
                                            清空全部
                                        </button>
                                    </div>
                                </div>
                                <p className="muted">
                                    共 {historyRecords.length} 条记录。点击左侧列表查看详情。
                                </p>
                            </section>

                            {/* 详情区域 */}
                            {selectedRecord ? (
                                <>
                                    {/* 卡片1：基本信息 */}
                                    <section className="card">
                                        <h2>{selectedRecord.summary || '(无摘要)'}</h2>
                                        <div className="history-detail-meta">
                                            <span className={`history-status-badge history-status-${selectedRecord.status}`}>
                                                {STATUS_LABEL[selectedRecord.status] || selectedRecord.status}
                                            </span>
                                            <span className="muted">{dayjs(selectedRecord.startedAt).format('YYYY-MM-DD HH:mm:ss')}</span>
                                            <span className="muted">耗时: {formatDuration(selectedRecord.durationMs)}</span>
                                        </div>
                                        <p className="muted history-session-id">Session ID: {selectedRecord.sessionId}</p>
                                        {selectedRecord.toolCalls.length > 0 ? (
                                            <div className="history-tool-tags">
                                                {selectedRecord.toolCalls.map((name, idx) => (
                                                    <span key={idx} className="history-tool-tag">{name}</span>
                                                ))}
                                            </div>
                                        ) : null}
                                    </section>

                                    {/* 卡片2：工具调用链 */}
                                    {selectedRecord.toolCallChain.length > 0 ? (
                                        <section className="card">
                                            <h2>工具调用链</h2>
                                            <div className="history-timeline">
                                                {selectedRecord.toolCallChain.map((step, idx) => {
                                                    const stepDuration = (step.startedAt && step.endedAt)
                                                        ? step.endedAt - step.startedAt
                                                        : undefined;
                                                    const statusIcon = step.status === 'done' ? '\u2713'
                                                        : step.status === 'error' ? '\u2717'
                                                        : '\u23F3';
                                                    return (
                                                        <div key={idx} className="history-timeline-item">
                                                            <div className={`history-timeline-dot history-dot-${step.status}`}>
                                                                {statusIcon}
                                                            </div>
                                                            <div className="history-timeline-content">
                                                                <div className="history-timeline-header">
                                                                    <strong>{step.funcName}</strong>
                                                                    {stepDuration != null ? (
                                                                        <span className="muted">{formatDuration(stepDuration)}</span>
                                                                    ) : null}
                                                                </div>
                                                                {step.message ? (
                                                                    <p className="muted">{step.message}</p>
                                                                ) : null}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </section>
                                    ) : null}

                                    {/* 卡片3：AI 回复 */}
                                    {selectedRecord.assistantReply ? (
                                        <section className="card">
                                            <h2>AI 回复</h2>
                                            <pre className="history-reply-pre">{selectedRecord.assistantReply}</pre>
                                        </section>
                                    ) : null}

                                    {/* 卡片4：调度日志 */}
                                    {selectedRecord.agentTransitions.length > 0 ? (
                                        <section className="card">
                                            <h2>调度日志</h2>
                                            <div className="history-transitions-table">
                                                <div className="history-table-header">
                                                    <span>阶段</span>
                                                    <span>轮次</span>
                                                    <span>原因</span>
                                                    <span>时间</span>
                                                </div>
                                                {selectedRecord.agentTransitions.map((t, idx) => (
                                                    <div key={idx} className="history-table-row">
                                                        <span className="history-phase-label">{t.phase}</span>
                                                        <span>{t.round}</span>
                                                        <span className="muted">{t.reason}</span>
                                                        <span className="muted">{dayjs(t.updatedAt).format('HH:mm:ss')}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </section>
                                    ) : null}

                                    {/* 卡片5：错误信息 */}
                                    {(selectedRecord.failureCode || selectedRecord.lastError) ? (
                                        <section className="card history-error-card">
                                            <h2>错误信息</h2>
                                            {selectedRecord.failureCode ? (
                                                <p><strong>错误码：</strong>{selectedRecord.failureCode}</p>
                                            ) : null}
                                            {selectedRecord.lastError ? (
                                                <pre className="history-error-pre">{selectedRecord.lastError}</pre>
                                            ) : null}
                                        </section>
                                    ) : null}
                                </>
                            ) : (
                                view === 'history' && historyRecords.length > 0 ? (
                                    <section className="card">
                                        <p className="muted">请在左侧选择一条记录查看详情。</p>
                                    </section>
                                ) : null
                            )}
                        </>
                    ) : null}
                </main>
            </div>
        </div>
    );
}
