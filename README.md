<p align="center">
  <img src="public/logo.png" width="128" height="128" alt="MoleClaw Logo">
</p>

<h1 align="center">MoleClaw</h1>

<p align="center">
  <strong>你的 AI 挖宝助手 — 像鼹鼠一样，在互联网的地下为你挖掘宝藏。</strong>
</p>

<p align="center">
  <a href="https://github.com/clark-maybe/mole-extension/blob/master/LICENSE">
    <img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License">
  </a>
</p>

---

提问之后，Mole 会像鼹鼠钻入地下一样，潜入后台默默挖掘——调用工具、搜索网页、解析数据、跨站点采集信息。找到宝藏后，它会重新浮出地面，把结果呈现给你。整个过程悄无声息，不打扰你正在做的事。

## 特性

- **AI 原生对话** — 悬浮球随时唤起，自然语言交互，流式响应
- **35+ 内置工具** — 页面操作、CDP 深度控制（10 域）、请求拦截、DOM/CSS/存储操作、导航、截图、网络诊断…
- **站点工作流** — 声明式 JSON 定义，无需写代码即可自动化网站操作
- **LLM 自由选择** — 兼容任何 OpenAI API 格式的服务，数据完全自主可控
- **MCP 协议** — 标准化工具注册与调用，支持动态扩展
- **Agentic Loop** — Codex 风格自驱循环，代码管边界，模型管决策
- **开源免费** — AGPL-3.0 协议，社区驱动

## 快速开始

```bash
git clone https://github.com/clark-maybe/mole-extension.git
cd mole-extension
npm install
npm run build
```

构建完成后，在 Chrome 中加载 `build_version/` 下的扩展目录即可使用。详见 [快速开始文档](https://moleclaw.site/guide/getting-started)。

## 工作原理

```
你提问 → 鼹鼠钻入地下（AI 进入后台 Agentic Loop）
       → 在隧道网络中挖掘（Channel 通信 + MCP 工具调用 + 多轮推理）
       → 带着宝物浮出地面（结果呈现在悬浮球中）
```

MoleClaw 运行在 Chrome 扩展的三层架构中：

| 层 | 角色 | 鼹鼠隐喻 |
|---|------|---------|
| Content Script | 悬浮球 UI + 页面交互 | 地面 — 你看到的部分 |
| Background | AI 编排 + 工具调度 | 地下 — 鼹鼠工作的地方 |
| Channel | 跨层消息通信 | 隧道网络 — 连接地面与地下 |

## 文档

访问 [MoleClaw 文档站](https://moleclaw.site) 了解详细使用和开发指南。

## 开发

```bash
npm run dev          # 开发模式（监听构建）
npm run build        # 构建所有组件
npm run lint         # 代码检查
npm run docs:dev     # 文档站本地预览
```

## 许可证

[AGPL-3.0](LICENSE)
