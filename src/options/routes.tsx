/**
 * 路由 & 菜单配置
 * 新增页面只需在 routes 数组追加一项 + 创建对应 Page 组件
 */

import { useCallback, useEffect, useState } from 'react';
import {
  SettingOutlined,
  ThunderboltOutlined,
  StopOutlined,
  HistoryOutlined,
} from '@ant-design/icons';

export interface RouteItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  description: string;
}

export const routes: RouteItem[] = [
  {
    key: 'settings',
    label: '模型设置',
    icon: <SettingOutlined />,
    description: '配置 API 连接、模型名称与浏览器侧默认行为。',
  },
  {
    key: 'workflows',
    label: '工作流',
    icon: <ThunderboltOutlined />,
    description: '管理本地站点工作流，支持导入、导出与 JSON 编辑。',
  },
  {
    key: 'blocklist',
    label: '域名管理',
    icon: <StopOutlined />,
    description: '维护被禁用的站点列表，控制悬浮球是否出现。',
  },
  {
    key: 'history',
    label: '历史记录',
    icon: <HistoryOutlined />,
    description: '查看会话执行结果、工具调用链与调度日志。',
  },
];

const DEFAULT_KEY = 'settings';

/** 解析 hash 值为路由 key */
const parseHash = (): string => {
  const hash = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  const matched = routes.find((r) => r.key === hash);
  return matched ? matched.key : DEFAULT_KEY;
};

/** 自定义 hash 路由 hook */
export const useHashRoute = (): [string, (key: string) => void] => {
  const [activeKey, setActiveKeyState] = useState(parseHash);

  useEffect(() => {
    const onHashChange = () => {
      setActiveKeyState(parseHash());
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const setActiveKey = useCallback((key: string) => {
    window.location.hash = '#/' + key;
  }, []);

  return [activeKey, setActiveKey];
};
