import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'MoleClaw',
  description: 'MoleClaw - AI-powered browser assistant',

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
          { text: 'Get Started', link: '/guide/getting-started' },
          { text: 'What Can Mole Do?', link: '/guide/examples' },
          { text: 'Download', link: '/download' },
          { text: 'GitHub', link: 'https://github.com/clark-maybe/mole-extension' },
        ],
        sidebar: {
          '/guide/': [
            {
              text: 'Get Started',
              items: [
                { text: 'Download & Install', link: '/guide/getting-started' },
                { text: 'Your First Task', link: '/guide/first-task' },
              ],
            },
            {
              text: 'Explore',
              items: [
                { text: 'What Can Mole Do?', link: '/guide/examples' },
                { text: 'Workflows', link: '/guide/workflows' },
                { text: 'Tips & Tricks', link: '/guide/tips' },
              ],
            },
            {
              text: 'Reference',
              collapsed: true,
              items: [
                { text: 'Tools Reference', link: '/guide/tools' },
                { text: 'Configuration', link: '/guide/configuration' },
                { text: 'Architecture', link: '/guide/features' },
                { text: 'Development', link: '/guide/development' },
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
          { text: '快速开始', link: '/zh/guide/getting-started' },
          { text: 'Mole 能做什么？', link: '/zh/guide/examples' },
          { text: '下载', link: '/zh/download' },
          { text: 'GitHub', link: 'https://github.com/clark-maybe/mole-extension' },
        ],
        sidebar: {
          '/zh/guide/': [
            {
              text: '快速上手',
              items: [
                { text: '下载安装', link: '/zh/guide/getting-started' },
                { text: '第一个任务', link: '/zh/guide/first-task' },
              ],
            },
            {
              text: '探索',
              items: [
                { text: 'Mole 能做什么？', link: '/zh/guide/examples' },
                { text: '工作流', link: '/zh/guide/workflows' },
                { text: '使用技巧', link: '/zh/guide/tips' },
              ],
            },
            {
              text: '参考',
              collapsed: true,
              items: [
                { text: '工具列表', link: '/zh/guide/tools' },
                { text: '配置指南', link: '/zh/guide/configuration' },
                { text: '架构说明', link: '/zh/guide/features' },
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
