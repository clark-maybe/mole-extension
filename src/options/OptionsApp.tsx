/**
 * Options 页面根组件
 * 使用 @ant-design/pro-layout 的 ProLayout 实现标准 AntD Pro 侧栏布局
 */

import { ConfigProvider, App } from 'antd';
import ProLayout from '@ant-design/pro-layout';
import {
  SettingOutlined,
  ThunderboltOutlined,
  StopOutlined,
  HistoryOutlined,
} from '@ant-design/icons';
import { moleTheme } from './theme';
import { useHashRoute } from './routes';
import { LLMSettingsPage } from './pages/LLMSettingsPage';
import { WorkflowsPage } from './pages/WorkflowsPage';
import { BlocklistPage } from './pages/BlocklistPage';
import { HistoryPage } from './pages/HistoryPage';

/** ProLayout 的 route 配置（仅作为菜单数据源） */
const routeConfig = {
  path: '/',
  routes: [
    { path: '/settings', name: 'LLM 设置', icon: <SettingOutlined /> },
    { path: '/workflows', name: 'Workflows', icon: <ThunderboltOutlined /> },
    { path: '/blocklist', name: '域名管理', icon: <StopOutlined /> },
    { path: '/history', name: '历史记录', icon: <HistoryOutlined /> },
  ],
};

/** 路径 → 页面组件映射 */
const PAGE_MAP: Record<string, React.ComponentType> = {
  '/settings': LLMSettingsPage,
  '/workflows': WorkflowsPage,
  '/blocklist': BlocklistPage,
  '/history': HistoryPage,
};

function OptionsLayout() {
  const [activeKey, setActiveKey] = useHashRoute();
  const pathname = '/' + activeKey;
  const PageComponent = PAGE_MAP[pathname] || LLMSettingsPage;

  return (
    <ProLayout
      title="Mole"
      logo="logo.png"
      layout="side"
      fixSiderbar
      siderWidth={220}
      route={routeConfig}
      location={{ pathname }}
      menuItemRender={(item, dom) => (
        <div onClick={() => setActiveKey((item.path || '/settings').replace(/^\//, ''))}>
          {dom}
        </div>
      )}
      headerRender={false}
      footerRender={false}
      onMenuHeaderClick={() => setActiveKey('settings')}
      token={{
        sider: {
          colorMenuBackground: '#ffffff',
          colorBgMenuItemSelected: 'rgba(0, 0, 0, 0.04)',
          colorTextMenuSelected: '#1d1d1f',
          colorTextMenu: '#86868b',
          colorTextMenuActive: '#1d1d1f',
        },
      }}
    >
      <PageComponent />
    </ProLayout>
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
