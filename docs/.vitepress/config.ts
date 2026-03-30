import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'MoleClaw',
  description: 'MoleClaw - AI 浏览器助手',

  head: [
    ['link', { rel: 'icon', href: '/logo.png' }],
  ],

  locales: {
    root: {
      label: '中文',
      lang: 'zh-CN',
      themeConfig: {
        nav: [
          { text: '首页', link: '/' },
          { text: '快速开始', link: '/guide/getting-started' },
          { text: 'Mole 能做什么？', link: '/guide/examples' },
          { text: '下载', link: '/download' },
          { text: 'GitHub', link: 'https://github.com/clark-maybe/mole-extension' },
        ],
        sidebar: {
          '/guide/': [
            {
              text: '快速上手',
              items: [
                { text: '下载安装', link: '/guide/getting-started' },
                { text: '第一个任务', link: '/guide/first-task' },
              ],
            },
            {
              text: '探索',
              items: [
                { text: 'Mole 能做什么？', link: '/guide/examples' },
                { text: '工作流', link: '/guide/workflows' },
                { text: '使用技巧', link: '/guide/tips' },
              ],
            },
            {
              text: '参考',
              collapsed: true,
              items: [
                { text: '工具列表', link: '/guide/tools' },
                { text: '配置指南', link: '/guide/configuration' },
                { text: '架构说明', link: '/guide/features' },
                { text: '开发指南', link: '/guide/development' },
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
    en: {
      label: 'English',
      lang: 'en',
      link: '/en/',
      themeConfig: {
        nav: [
          { text: 'Home', link: '/en/' },
          { text: 'Get Started', link: '/en/guide/getting-started' },
          { text: 'What Can Mole Do?', link: '/en/guide/examples' },
          { text: 'Download', link: '/en/download' },
          { text: 'GitHub', link: 'https://github.com/clark-maybe/mole-extension' },
        ],
        sidebar: {
          '/en/guide/': [
            {
              text: 'Get Started',
              items: [
                { text: 'Download & Install', link: '/en/guide/getting-started' },
                { text: 'Your First Task', link: '/en/guide/first-task' },
              ],
            },
            {
              text: 'Explore',
              items: [
                { text: 'What Can Mole Do?', link: '/en/guide/examples' },
                { text: 'Workflows', link: '/en/guide/workflows' },
                { text: 'Tips & Tricks', link: '/en/guide/tips' },
              ],
            },
            {
              text: 'Reference',
              collapsed: true,
              items: [
                { text: 'Tools Reference', link: '/en/guide/tools' },
                { text: 'Configuration', link: '/en/guide/configuration' },
                { text: 'Architecture', link: '/en/guide/features' },
                { text: 'Development', link: '/en/guide/development' },
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
