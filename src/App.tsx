/**
 * Popup App — 状态面板
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { VERSION } from './config';

/** LLM 配置状态 */
interface LLMStatus {
  configured: boolean;
  endpoint: string;
  model: string;
}

/** 从 chrome.storage.local 读取 LLM 配置状态 */
const getLLMStatus = (): Promise<LLMStatus> =>
  new Promise((resolve) => {
    chrome.storage.local.get('mole_ai_settings', (result) => {
      const settings = result.mole_ai_settings as Record<string, string> | undefined;
      const endpoint = settings?.endpoint || '';
      const model = settings?.model || '';
      const apiKey = settings?.apiKey || '';
      resolve({
        configured: !!(endpoint && apiKey),
        endpoint,
        model,
      });
    });
  });

/** 从 chrome.storage.local 读取 skill 数量（域级 Skill） */
const getWorkflowCount = (): Promise<number> =>
  new Promise((resolve) => {
    chrome.storage.local.get('mole_skills', (result) => {
      const skills = result.mole_skills as Array<unknown> | undefined;
      resolve(Array.isArray(skills) ? skills.length : 0);
    });
  });

/** 从 endpoint 提取更短的展示文本 */
const formatEndpointLabel = (endpoint?: string): string => {
  if (!endpoint) return '尚未设置 API 地址';
  try {
    const url = new URL(endpoint);
    return `${url.host}${url.pathname === '/' ? '' : url.pathname}`;
  } catch {
    return endpoint;
  }
};

function App() {
  const [llmStatus, setLLMStatus] = useState<LLMStatus | null>(null);
  const [workflowCount, setWorkflowCount] = useState<number | null>(null);

  const loadOverview = useCallback(async () => {
    const [nextLLMStatus, nextWorkflowCount] = await Promise.all([
      getLLMStatus(),
      getWorkflowCount(),
    ]);
    setLLMStatus(nextLLMStatus);
    setWorkflowCount(nextWorkflowCount);
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName !== 'local') return;
      if (changes.mole_ai_settings || changes.mole_skills) {
        void loadOverview();
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, [loadOverview]);

  /** 打开 Options 页面 */
  const openOptions = (hash?: string) => {
    const optionsUrl = chrome.runtime.getURL(`options.html${hash ? `#/${hash}` : ''}`);
    void chrome.tabs.create({ url: optionsUrl });
    window.close();
  };

  const llmReady = !!llmStatus?.configured;
  const endpointLabel = useMemo(() => formatEndpointLabel(llmStatus?.endpoint), [llmStatus?.endpoint]);
  const modelLabel = llmStatus?.model || 'gpt-5.4';
  const workflowValue = workflowCount === null ? '...' : String(workflowCount);

  return (
    <div className="popup-shell">
      <div className="popup-glow popup-glow-left" />
      <div className="popup-glow popup-glow-right" />

      <div className="popup-card">
        <div className="popup-topbar">
          <div className="popup-topbar-badge">
            <span className="popup-topbar-dot" />
            Extension Console
          </div>
          <div className="popup-version">v{VERSION}</div>
        </div>

        <div className="popup-brand">
          <img src="logo.png" alt="Mole" className="popup-logo" />
          <div className="popup-brand-copy">
            <h1 className="popup-title">Mole</h1>
            <p className="popup-subtitle">AI 助手控制台</p>
          </div>
        </div>

        <div className="popup-summary">
          <div>
            <div className="popup-summary-eyebrow">Quick Overview</div>
            <div className="popup-summary-title">核心状态</div>
            <div className="popup-summary-text">
              {llmStatus === null ? '正在同步配置…' : llmReady ? '模型与工作流已就绪' : '请先完成模型配置'}
            </div>
          </div>
          <div className={`popup-hero-status${llmReady ? ' is-ready' : ' is-warning'}`}>
            {llmStatus === null ? '读取中' : llmReady ? '已就绪' : '待配置'}
          </div>
        </div>

        <div className="popup-metrics">
          <div className="popup-metric popup-metric-blue">
            <div className="popup-metric-label">模型连接</div>
            <div className="popup-metric-value">{llmStatus === null ? '...' : llmReady ? '正常' : '未配置'}</div>
            <div className="popup-metric-hint">{endpointLabel}</div>
          </div>
          <div className="popup-metric popup-metric-green">
            <div className="popup-metric-label">默认模型</div>
            <div className="popup-metric-value">{llmStatus === null ? '...' : modelLabel}</div>
            <div className="popup-metric-hint">当前默认模型</div>
          </div>
          <div className="popup-metric popup-metric-orange">
            <div className="popup-metric-label">工作流数量</div>
            <div className="popup-metric-value">{workflowValue}</div>
            <div className="popup-metric-hint">本地已加载配置</div>
          </div>
        </div>

        <div className="popup-section">
          <div className="popup-section-header">
            <div className="popup-section-title">状态摘要</div>
          </div>

          <div className="popup-status-list">
            <div className="popup-status-item">
              <div className="popup-status-copy">
                <div className="popup-status-name">LLM 接口</div>
                <div className="popup-status-text">
                  {llmStatus === null ? '正在读取本地配置…' : llmReady ? endpointLabel : '需要先配置 Endpoint 和 API Key'}
                </div>
              </div>
              <div className={`popup-pill${llmReady ? ' is-success' : ' is-danger'}`}>
                {llmStatus === null ? '读取中' : llmReady ? '已配置' : '未配置'}
              </div>
            </div>

          </div>
        </div>

        <div className="popup-actions">
          <button type="button" className="popup-btn popup-btn-primary" onClick={() => openOptions()}>
            打开控制台
          </button>
        </div>

        <div className="popup-links">
          <button type="button" className="popup-link-btn" onClick={() => openOptions('settings')}>
            模型设置
          </button>
          <button type="button" className="popup-link-btn" onClick={() => openOptions('workflows')}>
            工作流
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
