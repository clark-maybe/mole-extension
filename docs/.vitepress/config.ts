import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'MoleClaw',
  description: 'MoleClaw - AI-powered browser assistant with workflow automation',

  head: [
    ['link', { rel: 'icon', href: '/logo.png' }],
  ],

  locales: {
    root: {
      label: 'English',
      lang: 'en',
      themeConfig: {
        nav: [
          { text: 'Home', link: '/' },
          { text: 'Guide', link: '/guide/getting-started' },
          { text: 'GitHub', link: 'https://github.com/clark-maybe/mole-extension' },
        ],
        sidebar: {
          '/guide/': [
            {
              text: 'Getting Started',
              items: [
                { text: 'Quick Start', link: '/guide/getting-started' },
                { text: 'Features', link: '/guide/features' },
              ],
            },
            {
              text: 'Usage',
              items: [
                { text: 'Built-in Tools', link: '/guide/tools' },
                { text: 'Site Workflows', link: '/guide/workflows' },
                { text: 'Configuration', link: '/guide/configuration' },
              ],
            },
            {
              text: 'Development',
              items: [
                { text: 'Development Guide', link: '/guide/development' },
              ],
            },
          ],
        },
        footer: {
          message: 'Released under the AGPL-3.0 License',
          copyright: 'Copyright 2025-present MoleClaw Contributors',
        },
        outline: {
          label: 'On this page',
        },
        docFooter: {
          prev: 'Previous',
          next: 'Next',
        },
        lastUpdated: {
          text: 'Last updated',
        },
        returnToTopLabel: 'Back to top',
        sidebarMenuLabel: 'Menu',
        darkModeSwitchLabel: 'Theme',
      },
    },
    zh: {
      label: '中文',
      lang: 'zh-CN',
      link: '/zh/',
      themeConfig: {
        nav: [
          { text: '首页', link: '/zh/' },
          { text: '指南', link: '/zh/guide/getting-started' },
          { text: 'GitHub', link: 'https://github.com/clark-maybe/mole-extension' },
        ],
        sidebar: {
          '/zh/guide/': [
            {
              text: '入门',
              items: [
                { text: '快速开始', link: '/zh/guide/getting-started' },
                { text: '功能介绍', link: '/zh/guide/features' },
              ],
            },
            {
              text: '使用',
              items: [
                { text: '内置工具列表', link: '/zh/guide/tools' },
                { text: '站点工作流', link: '/zh/guide/workflows' },
                { text: '配置指南', link: '/zh/guide/configuration' },
              ],
            },
            {
              text: '开发',
              items: [
                { text: '开发指南', link: '/zh/guide/development' },
              ],
            },
          ],
        },
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
    },
  },

  themeConfig: {
    logo: '/logo.png',

    socialLinks: [
      { icon: 'github', link: 'https://github.com/clark-maybe/mole-extension' },
    ],

    search: {
      provider: 'local',
    },
  },
})
