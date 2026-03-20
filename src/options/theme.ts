/**
 * AntD 主题配置
 * 极简风格：中性灰色调、克制的色彩、大量留白
 */

import type { ThemeConfig } from 'antd';

export const moleTheme: ThemeConfig = {
  token: {
    colorPrimary: '#1677ff',
    colorSuccess: '#34a853',
    colorError: '#d93025',
    colorText: '#172033',
    colorTextSecondary: '#667085',
    colorBorder: '#dbe3ee',
    colorBorderSecondary: '#eef2f7',
    colorBgContainer: '#ffffff',
    colorBgLayout: '#eef3f9',
    borderRadius: 14,
    fontFamily: '-apple-system, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "PingFang SC", sans-serif',
    boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)',
    boxShadowSecondary: '0 18px 48px rgba(15, 23, 42, 0.10)',
    fontSize: 13,
    controlHeight: 38,
  },
  components: {
    Layout: {
      siderBg: '#ffffff',
      bodyBg: '#eef3f9',
      headerBg: '#ffffff',
    },
    Menu: {
      itemBorderRadius: 12,
      itemSelectedBg: 'rgba(22, 119, 255, 0.10)',
      itemSelectedColor: '#1677ff',
      itemHoverBg: 'rgba(15, 23, 42, 0.04)',
      itemColor: '#667085',
    },
    Card: {
      borderRadiusLG: 20,
      paddingLG: 24,
      colorBorderSecondary: '#eef2f7',
    },
    Table: {
      headerBg: '#f8fbff',
      headerColor: '#667085',
      borderColor: '#eef2f7',
      headerSplitColor: '#eef2f7',
      borderRadius: 12,
      fontSize: 12,
    },
    Input: {
      borderRadius: 10,
      colorBorder: '#dbe3ee',
      activeBorderColor: '#1677ff',
      hoverBorderColor: '#98a2b3',
    },
    Button: {
      borderRadius: 10,
      primaryColor: '#ffffff',
      colorPrimaryBg: '#1677ff',
      colorPrimaryBgHover: '#3b8cff',
      defaultBorderColor: '#dbe3ee',
      fontSize: 13,
    },
    Form: {
      labelColor: '#172033',
      labelFontSize: 13,
      itemMarginBottom: 20,
    },
    Tag: {
      borderRadiusSM: 999,
    },
    Modal: {
      borderRadiusLG: 20,
    },
  },
};
