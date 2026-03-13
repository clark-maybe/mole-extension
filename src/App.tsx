/**
 * Popup App — 状态面板
 */

import type React from 'react';
import { useState, useEffect } from 'react';
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

/** 从 chrome.storage.local 读取 workflow 数量 */
const getWorkflowCount = (): Promise<number> =>
  new Promise((resolve) => {
    chrome.storage.local.get('mole_site_workflows_v1', (result) => {
      const store = result.mole_site_workflows_v1 as { workflows?: unknown[] } | undefined;
      resolve(Array.isArray(store?.workflows) ? store.workflows.length : 0);
    });
  });

function App() {
  const [llmStatus, setLLMStatus] = useState<LLMStatus | null>(null);
  const [workflowCount, setWorkflowCount] = useState<number | null>(null);

  useEffect(() => {
    void getLLMStatus().then(setLLMStatus);
    void getWorkflowCount().then(setWorkflowCount);
  }, []);

  /** 打开 Options 页面 */
  const openOptions = () => {
    chrome.runtime.openOptionsPage();
  };

  return (
    <div style={styles.container}>
      {/* 品牌区 */}
      <div style={styles.brandArea}>
        <img src="logo.png" alt="Mole" style={styles.logo} />
        <div>
          <h1 style={styles.title}>Mole</h1>
          <p style={styles.version}>v{VERSION}</p>
        </div>
      </div>

      {/* 状态卡片 */}
      <div style={styles.statusArea}>
        {/* LLM 状态 */}
        <div style={styles.statusCard}>
          <div style={styles.statusRow}>
            <span style={styles.statusLabel}>LLM</span>
            <span style={{
              ...styles.statusBadge,
              backgroundColor: llmStatus?.configured ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
              color: llmStatus?.configured ? '#22c55e' : '#ef4444',
            }}>
              {llmStatus === null ? '...' : llmStatus.configured ? '已配置' : '未配置'}
            </span>
          </div>
          {llmStatus?.configured ? (
            <>
              <p style={styles.statusDetail}>{llmStatus.endpoint}</p>
              <p style={styles.statusDetail}>{llmStatus.model || '未指定模型'}</p>
            </>
          ) : (
            <p style={styles.statusDetail}>请在 Options 页面配置 API</p>
          )}
        </div>

        {/* Workflow 状态 */}
        <div style={styles.statusCard}>
          <div style={styles.statusRow}>
            <span style={styles.statusLabel}>Workflows</span>
            <span style={styles.statusCount}>
              {workflowCount === null ? '...' : workflowCount}
            </span>
          </div>
          <p style={styles.statusDetail}>已加载工作流</p>
        </div>
      </div>

      {/* 操作区 */}
      <button type="button" style={styles.optionsBtn} onClick={openOptions}>
        打开设置
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '320px',
    minHeight: '280px',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: '#050507',
    color: '#e5e7eb',
    fontFamily: "'JetBrains Mono', 'Menlo', monospace",
    padding: '20px',
    boxSizing: 'border-box',
  },
  brandArea: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '20px',
  },
  logo: {
    width: '48px',
    height: '48px',
    borderRadius: '10px',
  },
  title: {
    fontSize: '18px',
    fontWeight: 700,
    margin: 0,
    color: '#f9fafb',
  },
  version: {
    fontSize: '11px',
    color: '#6b7280',
    margin: '2px 0 0 0',
  },
  statusArea: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    flex: 1,
  },
  statusCard: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: '8px',
    padding: '12px',
    border: '1px solid rgba(255,255,255,0.06)',
  },
  statusRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '6px',
  },
  statusLabel: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#d1d5db',
  },
  statusBadge: {
    fontSize: '10px',
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: '999px',
  },
  statusCount: {
    fontSize: '14px',
    fontWeight: 700,
    color: '#3b82f6',
  },
  statusDetail: {
    fontSize: '11px',
    color: '#6b7280',
    margin: '2px 0 0 0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  optionsBtn: {
    marginTop: '16px',
    padding: '10px',
    borderRadius: '8px',
    border: '1px solid rgba(59,130,246,0.3)',
    backgroundColor: 'rgba(59,130,246,0.1)',
    color: '#60a5fa',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: "'JetBrains Mono', monospace",
  },
};

export default App;
