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

## 网页访问与循环边界

`lib/web-access.ts` 分类明确拒绝、失效页面和临时故障，并按规范化 URL 串行处理访问。`functions/web-access.ts` 在 MCP 执行前统一接入读取、导航和页面操作工具；`lib/web-navigation.ts` 使用现有 `webRequest` 权限记录主文档 HTTP 状态，跟踪搜索跳转目标，不把子资源错误当成整页失败。任务结束时移除监听。

导航操作等待主文档完成，并检查 HTTP 状态及明确拒绝页后才报告成功；浏览器接受打开命令不代表目标可访问，不能据此清空已有失败计数。

明确拒绝在本任务内停止；临时失败最多实际尝试三次，重试前的基础冷却为 1、2 秒，服务端 `Retry-After` 可以延长等待，第三次失败后停止。冷却返回不会重新请求网页。错误页文本识别限制为明确标题或短正文开头，避免误拦讨论错误码的文章。

`ai/run-state.ts` 跨阶段和子 Agent 共用访问状态、总预算及失败计数。普通操作相同参数连续失败两次后阻止重复执行；获得新进展后可以重新定位操作，网址拒绝状态继续保留。连续六轮实际工作均失败后以无工具调用的最终回复收尾，记账、工具发现和标签页列表不视为新进展。

访问快照通过检查点元数据写入 `Session.webAccessSnapshot`，不依赖上下文摘要；仅在同一任务恢复时通过 `resumeWebAccessSnapshot` 还原。新用户回合创建新的访问状态。回归命令为 `node --test tests/*.test.mjs`。

## 渠道恢复机制

`lib/channel-access.ts` 统一串行渠道工具、保存待恢复调用和检查结果。工具通过 `FunctionDefinition.channel` 声明渠道，MCP 元数据携带 `sessionId`。页面观察器只上报候选信号，不在页面循环探测搜索接口。

`background/channel-recovery.ts` 检查消息来源、重放原查询，并将成功结果写入原会话后再消费，使用稳定调用 ID 防止重复交付。会话没有其他工作时进入 `waiting`；后台重启后重装观察器，取消和任务替换会移除恢复请求。自动恢复保留原任务的工具限制、预算和 Todo 快照。

恢复结果与 `channelResumePending` 接续标记一同落盘，在 Agent 收到首个续跑检查点后清除标记，覆盖“结果已消费但 Agent 尚未启动”的重启窗口。立即持久化必须向调用方报告失败，写入失败时不能消费恢复结果。

运行态会话由会话管理器维护；同步快照只读，事件重建只用于启动恢复或回滚。事件队列发送快照时读取最新状态，界面同时处理完成事件及完成/失败快照，避免回复已结束后仍停留在“处理中”。

`data_pipeline` 与 `extract_data` 的缓冲区变更在返回成功前写入本地存储，后台重启后按需恢复。涉及敏感或危险操作的权限确认继续沿用原机制，渠道检查仅重放已授权的只读查询。
