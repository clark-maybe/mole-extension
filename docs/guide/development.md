# 开发指南

## 项目架构

MoleClaw 是一个 Chrome Extension MV3 项目，包含三个主要组件：

### Popup（弹窗）

基于 React 的极简弹窗界面，显示扩展基本信息。

- 入口：`src/main.tsx`
- 构建配置：`vite.config.popup.ts`

### Content Script（内容脚本）

注入到所有网页中，负责：

- 悬浮球 UI（Shadow DOM 隔离）
- 页面语义快照与元素定位
- 页面操作执行（点击、填写、滚动等）
- 搜索引擎结果解析
- 表单工作流执行

- 入口：`src/content.ts`
- 构建配置：`vite.config.content.ts`

### Background（后台服务工作器）

扩展的中枢，负责：

- AI 编排器（Agentic Loop）
- LLM API 调用
- MCP 工具注册与调度
- 跨组件通信中枢（Channel）
- 定时任务调度
- 会话历史管理

- 入口：`src/background.ts`
- 构建配置：`vite.config.background.ts`

### Options（选项页面）

扩展的配置界面，包含：

- LLM 设置（Endpoint、API Key、Model）
- 工作流管理（新建/编辑/删除/导入/导出）
- 会话历史查看

- 入口：`src/options.tsx`

## 目录结构

```
src/
├── ai/                    # AI 核心
│   ├── orchestrator.ts    # Agentic Loop 编排器
│   ├── llm-client.ts      # LLM API 客户端
│   ├── system-prompt.ts   # 系统提示词
│   ├── context-manager.ts # 上下文压缩管理
│   ├── tool-executor.ts   # 工具执行器
│   └── types.ts           # AI 类型定义
├── content/               # Content Script 模块
│   ├── float-ball.ts      # 悬浮球 UI
│   ├── page-grounding.ts  # 页面语义快照
│   ├── action-executor.ts # 动作执行器
│   ├── search-parser.ts   # 搜索引擎解析
│   ├── page-parser.ts     # 网页内容解析
│   └── form-workflow.ts   # 表单工作流
├── functions/             # 工具函数（37+ 内置工具）
│   ├── registry.ts        # 工具注册表（内置 + 动态）
│   ├── types.ts           # 工具类型定义
│   ├── cdp-input.ts       # CDP 可信输入事件
│   ├── cdp-dialog.ts      # CDP 对话框处理
│   ├── cdp-frame.ts       # CDP iframe 穿透
│   ├── cdp-network.ts     # CDP 网络监听 + Cookie
│   ├── cdp-emulation.ts   # CDP 设备/环境模拟
│   ├── cdp-console.ts     # CDP 控制台捕获
│   ├── cdp-fetch.ts       # CDP 请求拦截与篡改
│   ├── cdp-dom.ts         # CDP 跨域 DOM 操作
│   ├── cdp-storage.ts     # CDP 页面存储操作
│   ├── cdp-css.ts         # CDP CSS 样式操作
│   ├── cdp-overlay.ts     # CDP 视觉高亮标注
│   ├── site-workflow.ts   # 站点工作流入口
│   ├── site-workflow-registry.ts  # 工作流注册表
│   └── *.ts               # 其他工具实现
├── mcp/                   # MCP 协议实现
│   ├── server.ts          # MCP Server
│   ├── client.ts          # MCP Client
│   ├── transport.ts       # 内存传输层
│   ├── adapters.ts        # OpenAI 适配器
│   └── validator.ts       # 参数校验
├── lib/                   # 基础库
│   ├── channel.ts         # 跨组件通信
│   ├── storage.ts         # Chrome 存储封装
│   ├── console.ts         # 日志持久化
│   ├── artifact-store.ts  # 大体积结果存储
│   ├── cdp-session.ts     # CDP 会话管理器（debugger 生命周期 + 域事件）
│   ├── timer-store.ts     # 定时器持久化
│   └── timer-scheduler.ts # 定时器调度
├── options/               # Options 页面
├── session-history/       # 会话历史
├── config/                # 配置
├── types/                 # 全局类型
└── utils/                 # 通用工具
```

## 本地开发

### 环境要求

- Node.js 18+
- npm 9+
- Chrome 浏览器

### 开发流程

```bash
# 1. 克隆并安装
git clone https://github.com/clark-maybe/mole-extension.git
cd mole-extension
npm install

# 2. 构建扩展
npm run build

# 3. 加载到 Chrome
# 打开 chrome://extensions/ → 开发者模式 → 加载已解压 → 选择构建目录

# 4. 监听模式开发
npm run dev
```

### 构建命令

| 命令 | 说明 |
|------|------|
| `npm run build` | 构建所有组件（popup + content + background） |
| `npm run build:popup` | 仅构建弹窗 |
| `npm run build:content` | 仅构建内容脚本 |
| `npm run build:background` | 仅构建后台服务 |
| `npm run dev` | 监听模式构建 |
| `npm run lint` | ESLint 代码检查 |

### 调试技巧

- **Content Script**：在目标页面打开开发者工具（F12），日志在 Console 中查看
- **Background**：在 `chrome://extensions/` 点击扩展的 "Service Worker" 链接
- **Popup**：右键点击扩展图标 → 审查弹出内容
- 使用 `_console.log()` 替代 `console.log()`，日志会被持久化并可导出

## 扩展工具函数

### 添加新工具的步骤

1. **创建工具文件**

在 `src/functions/` 下新建文件，导出 `FunctionDefinition`：

```typescript
import type { FunctionDefinition, FunctionResult } from './types'

export const myTool: FunctionDefinition = {
  name: 'my_tool',
  description: '工具描述（AI 据此判断何时调用）',
  supportsParallel: true,  // 是否支持并行执行（true = 多工具时 Promise.all 并发）
  parameters: {
    type: 'object',
    properties: {
      param1: {
        type: 'string',
        description: '参数说明',
      },
    },
    required: ['param1'],
  },
  async execute(args: Record<string, unknown>): Promise<FunctionResult> {
    // 实现逻辑
    return { success: true, data: '结果' }
  },
}
```

2. **注册到 Registry**

在 `src/functions/registry.ts` 中导入并注册：

```typescript
import { myTool } from './my-tool'
// 在注册区域添加：
mcpServer.registerTool(myTool)
```

3. **添加图标和中文名**（必须）

在 `src/content/float-ball.ts` 中添加：

```typescript
// FUNCTION_ICONS 中添加 SVG 图标
my_tool: '<svg>...</svg>',

// FUNCTION_LABELS 中添加中文名
my_tool: '我的工具',
```

## MCP 协议

MoleClaw 内置了完整的 MCP（Model Context Protocol）实现，所有工具通过 MCP 协议注册和调用。

### 架构

```
orchestrator.ts
    ↓ 调用
mcp/client.ts (MCP Client)
    ↓ 通过 InMemoryTransport
mcp/server.ts (MCP Server)
    ↓ 调度
functions/registry.ts → 具体工具
```

### 关键模块

- **MCP Server** - 管理工具注册，处理 `tools/list` 和 `tools/call` 请求
- **MCP Client** - 供编排器调用，提供 `listTools()` 和 `callTool()` 方法
- **MCP Transport** - 内存传输层（InMemoryTransport），Server 和 Client 在同一进程内通信
- **MCP Adapters** - 将 MCP 工具定义转换为 OpenAI ToolSchema 格式

## 贡献指南

1. Fork 仓库
2. 创建功能分支：`git checkout -b feat/my-feature`
3. 编写代码并测试
4. 确保通过 lint 检查：`npm run lint`
5. 提交：`git commit -m "feat(scope): 描述"`
6. 推送并创建 Pull Request

### 提交信息格式

```
type(scope): 描述
```

- **type**: `feat`（新功能）、`fix`（修复）、`docs`（文档）、`refactor`（重构）、`test`（测试）、`chore`（杂项）
- **scope**: 模块名，如 `ai`、`tools`、`content`、`mcp`
