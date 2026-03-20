/**
 * Options 页面根组件
 * 居中 Card 布局：浅灰背景 + 白色面板（左侧菜单 + 右侧内容）
 */

import { ConfigProvider, App } from 'antd';
import { moleTheme } from './theme';
import { routes, useHashRoute } from './routes';
import { LLMSettingsPage } from './pages/LLMSettingsPage';
import { WorkflowsPage } from './pages/WorkflowsPage';
import { BlocklistPage } from './pages/BlocklistPage';
import { HistoryPage } from './pages/HistoryPage';

/** 路由 key → 页面组件映射 */
const PAGE_MAP: Record<string, React.ComponentType> = {
  settings: LLMSettingsPage,
  workflows: WorkflowsPage,
  blocklist: BlocklistPage,
  history: HistoryPage,
};

function OptionsLayout() {
  const [activeKey, setActiveKey] = useHashRoute();
  const PageComponent = PAGE_MAP[activeKey] || LLMSettingsPage;
  const activeRoute = routes.find((route) => route.key === activeKey) || routes[0];

  return (
    <div className="options-page">
      <div className="options-panel">
        {/* 左侧菜单 */}
        <nav className="options-menu">
          <div className="options-menu-header">
            <div className="options-menu-brand">
              <img
                src={chrome.runtime?.getURL?.('logo.png') || 'logo.png'}
                alt="Mole"
                className="options-menu-logo"
              />
              <div>
                <span className="options-menu-title">Mole</span>
                <span className="options-menu-subtitle">Extension Console</span>
              </div>
            </div>
            <div className="options-menu-pill">设置中心</div>
          </div>

          <div className="options-menu-section-title">系统配置</div>

          <div className="options-menu-items">
            {routes.map((route) => (
              <button
                key={route.key}
                type="button"
                className={`options-menu-item${activeKey === route.key ? ' active' : ''}`}
                onClick={() => setActiveKey(route.key)}
              >
                <span className="options-menu-icon">{route.icon}</span>
                <span className="options-menu-label">{route.label}</span>
              </button>
            ))}
          </div>

          <div className="options-menu-footer">
            <div className="options-menu-footer-label">当前页面</div>
            <div className="options-menu-footer-title">{activeRoute.label}</div>
            <div className="options-menu-footer-desc">{activeRoute.description}</div>
          </div>
        </nav>

        {/* 右侧内容 */}
        <div className="options-body">
          <div className="options-body-topbar">
            <div>
              <div className="options-body-breadcrumb">Mole Console / 设置</div>
              <div className="options-body-heading">{activeRoute.label}</div>
            </div>
            <div className="options-body-status">
              <span className="options-body-status-dot" />
              本地扩展设置
            </div>
          </div>

          <div className="options-body-content">
            <PageComponent />
          </div>
        </div>
      </div>
    </div>
  );
}

export function OptionsApp() {
  return (
    <ConfigProvider theme={moleTheme}>
      <App>
        <OptionsLayout />
      </App>
    </ConfigProvider>
  );
}
