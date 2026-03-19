/**
 * AntD 主题配置
 * 极简风格：中性灰色调、克制的色彩、大量留白
 */

import type { ThemeConfig } from 'antd';

export const moleTheme: ThemeConfig = {
  token: {
    colorPrimary: '#1d1d1f',
    colorSuccess: '#34a853',
    colorError: '#d93025',
    colorText: '#1d1d1f',
    colorTextSecondary: '#86868b',
    colorBorder: '#d2d2d7',
    colorBorderSecondary: '#e8e8ed',
    colorBgContainer: '#ffffff',
    colorBgLayout: '#f5f5f7',
    borderRadius: 10,
    fontFamily: '-apple-system, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "PingFang SC", sans-serif',
    boxShadow: 'none',
    boxShadowSecondary: 'none',
    fontSize: 14,
    controlHeight: 38,
  },
  components: {
    Layout: {
      siderBg: '#ffffff',
      bodyBg: '#f5f5f7',
      headerBg: '#ffffff',
    },
    Menu: {
      itemBorderRadius: 6,
      itemSelectedBg: 'rgba(0, 0, 0, 0.04)',
      itemSelectedColor: '#1d1d1f',
      itemHoverBg: 'rgba(0, 0, 0, 0.03)',
      itemColor: '#86868b',
      itemHeight: 36,
      iconSize: 15,
      itemMarginInline: 8,
      itemPaddingInline: 12,
    },
    Card: {
      borderRadiusLG: 12,
      paddingLG: 24,
      colorBorderSecondary: '#e8e8ed',
    },
    Table: {
      headerBg: '#fafafa',
      headerColor: '#86868b',
      borderColor: '#e8e8ed',
      headerSplitColor: '#e8e8ed',
      borderRadius: 12,
      fontSize: 13,
    },
    Input: {
      borderRadius: 8,
      colorBorder: '#d2d2d7',
      activeBorderColor: '#0071e3',
      hoverBorderColor: '#86868b',
    },
    Button: {
      borderRadius: 8,
      primaryColor: '#ffffff',
      colorPrimaryBg: '#0071e3',
      colorPrimaryBgHover: '#0077ed',
      defaultBorderColor: '#d2d2d7',
    },
    Form: {
      labelColor: '#1d1d1f',
      itemMarginBottom: 24,
    },
    Tag: {
      borderRadiusSM: 6,
    },
    Modal: {
      borderRadiusLG: 14,
    },
  },
};
