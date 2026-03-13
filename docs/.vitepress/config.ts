import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'MoleClaw',
  description: 'MoleClaw - AI-powered browser assistant with workflow automation',
  lang: 'zh-CN',

  head: [
    ['link', { rel: 'icon', href: '/logo.png' }],
  ],

  themeConfig: {
    logo: '/logo.png',

    nav: [
      { text: '首页', link: '/' },
      { text: '指南', link: '/guide/getting-started' },
      { text: 'GitHub', link: 'https://github.com/clark-maybe/mole-extension' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: '入门',
          items: [
            { text: '快速开始', link: '/guide/getting-started' },
            { text: '功能介绍', link: '/guide/features' },
          ],
        },
        {
          text: '使用',
          items: [
            { text: '内置工具列表', link: '/guide/tools' },
            { text: '站点工作流', link: '/guide/workflows' },
            { text: '配置指南', link: '/guide/configuration' },
          ],
        },
        {
          text: '开发',
          items: [
            { text: '开发指南', link: '/guide/development' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/clark-maybe/mole-extension' },
    ],

    footer: {
      message: '基于 AGPL-3.0 协议发布',
      copyright: 'Copyright 2025-present MoleClaw Contributors',
    },

    search: {
      provider: 'local',
      options: {
        translations: {
          button: {
            buttonText: '搜索文档',
            buttonAriaLabel: '搜索文档',
          },
          modal: {
            noResultsText: '无法找到相关结果',
            resetButtonTitle: '清除查询条件',
            footer: {
              selectText: '选择',
              navigateText: '切换',
              closeText: '关闭',
            },
          },
        },
      },
    },

    outline: {
      label: '页面导航',
    },

    docFooter: {
      prev: '上一页',
      next: '下一页',
    },

    lastUpdated: {
      text: '最后更新于',
    },

    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '菜单',
    darkModeSwitchLabel: '主题',
  },
})
