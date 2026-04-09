# CLAUDE.md

此文件为 Claude Code (claude.ai/code) 提供在本仓库中工作的指导说明。

<!-- OPENSPEC:START -->
# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:
- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:
- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->

## 重要提示

**语言要求：**
- 本项目中所有与 AI 的对话交流必须使用中文
- 代码注释应使用中文
- 提交信息（commit message）应使用中文
- AI 回复时必须全程使用中文，不要使用英文

## 项目概述

**MoleClaw** — 一个像鼹鼠一样工作的 AI 浏览器助手。

用户提出问题后，Mole 会像鼹鼠钻入地下一样，潜入后台默默挖掘——调用工具、搜索网页、解析数据、跨站点采集信息。当它找到宝藏（结果），便会重新浮出地面，把挖到的东西呈现给你。整个过程中，它不会打扰你正在做的事情，就像鼹鼠在地表之下悄无声息地工作。

本项目是 **MoleClaw** Chrome 扩展程序（MV3），使用 React + TypeScript + Vite 构建。核心功能是**在任意网页上注入一个 AI 悬浮助手（Mole）**，用户通过悬浮球或快捷键唤起对话框，与 AI 交互。Mole 运行在用户的真实浏览器环境中，天然复用用户的登录态和 Cookie，无需额外的身份验证或 Cookie 迁移。AI 通过 Phase Orchestrator + Agentic Loop 自主调用 27 个内置工具（+ 动态扩展工具），在后台多轮执行，完成后以流式方式返回结果。

## 构建系统

本项目使用**三个独立的 Vite 配置文件**来构建扩展的不同部分：

### 构建命令

- **`npm run build`** - 按顺序构建所有组件（popup、content、background）
- **`npm run build:popup`** - 构建弹窗 UI（使用 vite.config.popup.ts）
- **`npm run build:content`** - 构建内容脚本（使用 vite.config.content.ts）
- **`npm run build:background`** - 构建后台服务工作器（使用 vite.config.background.ts）
- **`npm run dev`** - 开发模式下的监听构建
- **`npm run lint`** - 对 TypeScript 文件运行 ESLint 检查
- **`npm run docs:dev`** - VitePress 文档开发服务器
- **`npm run docs:build`** - VitePress 文档构建

### 构建输出

所有构建输出到：`build_version/mole-extension/`

输出目录结构符合 Chrome 扩展 manifest 要求：
- `index.html` + assets - 弹窗 UI
- `options.html` + assets - Options 设置页面
- `content.js` - 内容脚本（IIFE 格式）
- `background.js` - 后台服务工作器（IIFE 格式）
- `manifest.json` - 从 `public/manifest.json` 复制
- `logo.png` - 扩展图标

## 架构设计

### 扩展组件

本扩展遵循 Chrome Extension MV3 架构，包含四个主要组件：

1. **弹窗 UI** (`src/main.tsx`, `src/App.tsx`)
   - 基于 React 的极简弹窗界面
   - 显示扩展名称和版本信息
   - 入口文件：`index.html`

2. **内容脚本** (`src/content.ts`)
   - 注入到所有匹配 `<all_urls>` 的网页中（仅主 frame）
   - 初始化 Channel 通信、页面内容解析器、动作执行器、页面 grounding、页面骨架树和悬浮球 UI
   - 子模块：
     - `initPageParser()` - 网页内容解析器（供 background 远程调用获取页面信息）
     - `initActionExecutor()` - 页面动作执行器（供 background 远程调用执行交互操作）
     - `initPageGrounding()` - 页面 grounding 能力（语义快照 + element_id 动作）
     - `initPageSkeleton()` - 页面骨架树（层级化 DOM 感知）
     - `initFloatBallReact()` - React 版悬浮球 UI

3. **后台服务工作器** (`src/background.ts`)
   - 薄编排层，具体逻辑分布在 `src/background/` 子模块中
   - 初始化 Channel 监听、工具注册表、会话状态恢复、运行时定时器恢复
   - 20 秒心跳保活（通过 `Storage.save('heartbeat', ...)` 保持 Service Worker 存活）
   - `src/background/` 子模块（Hub-and-Spoke 架构）：
     - `session-manager.ts` — 会话核心（Hub）：生命周期、Task Runner 引擎、pushEvent
     - `session-types.ts` — 会话类型定义与常量
     - `session-state.ts` — 会话状态管理（内存状态、Op 调度队列）
     - `session-event.ts` — 会话事件处理（状态推导、失败码解析）
     - `session-resource.ts` — 运行时资源管理（RuntimeResourceManager）
     - `session-persistence.ts` — 会话持久化
     - `session-history.ts` — 会话历史记录
     - `session-replay.ts` — 会话事件回放
     - `session-context-tasks.ts` — 审查（Review）与压缩（Compact）任务
     - `session-channel-handlers.ts` — 会话 Channel 消息处理器
     - `channel-handlers.ts` — 基础 Channel 消息处理器
     - `workflow-handlers.ts` — 站点工作流 / 动态工具 / 调试处理器
     - `timer-dispatch.ts` — 定时器触发调度（Chrome Alarms + 运行时定时器）
     - `resident-ai.ts` — 常驻任务 AI 响应
     - `workflow-recorder.ts` — 工作流录制
     - `bg-tasks-manager.ts` — 后台任务管理

4. **Options 设置页面** (`src/options/`)
   - 基于 React + Ant Design 的完整多页面应用
   - 入口文件：`options.html`
   - 页面路由（hash-based）：
     - `settings` — 模型设置（LLMSettingsPage）：配置 API 连接、模型名称与默认行为
     - `workflows` — 工作流管理（WorkflowsPage）：导入、导出与 JSON 编辑
     - `blocklist` — 域名管理（BlocklistPage）：控制悬浮球在特定站点的显示
     - `history` — 历史记录（HistoryPage）：查看会话执行结果、工具调用链与调度日志

### AI 系统

#### Phase Orchestrator + Agentic Loop (`src/ai/orchestrator.ts`)

设计哲学：**代码管机制和边界（保下限），模型管决策和策略（定上限）**

核心循环：采样 → 有工具调用 → 执行 → 回写 → 继续采样 → 无工具调用 → 结束

**Phase Orchestrator（多阶段编排器）：**
- 将复杂任务拆为多个阶段（phase），每个阶段运行一次 Agentic Loop
- 阶段间通过 `HandoffArtifact` 传递结构化状态（任务目标、Todo 进度、浏览器状态、已收集数据、关键发现、风险提示）
- 简单任务零开销 — phaseOrchestrator 透传 agenticLoop 的结果
- 阶段控制信号（`PhaseControl`）：phaseOrchestrator 提供 `shouldHandoff`，agenticLoop 判断是否交接而非压缩

**Agentic Loop（执行引擎）：**
- 循环预算：`maxRounds: 120`、`maxToolCalls: 300`、`maxSameSignature: 5`、`maxContextItems: 300`、`maxSubtaskDepth: 2`
- **工具并行执行**：LLM 一次返回多个 function_call 时，`supportsParallel: true` 的工具使用 Promise.all 并发执行，serial 工具串行执行（`src/ai/tool-executor.ts`）
- **死循环检测**：相同工具+参数签名重复 `maxSameSignature` 次时终止
- **空响应重试**：最多 2 次
- **auto_compact**：上下文估算 token 超过 50000 时自动压缩，保留尾部 25% 条目
- **compact 元工具**：模型可主动调用 compact 压缩上下文（orchestrator 层拦截，不注册 MCP）
- **断点恢复**：任务执行过程中定期持久化 checkpoint（context 快照），因 SW 重启/API 错误等中断时，用户可一键"重试"从断点恢复执行
- **Vision 视觉理解**：截图工具执行后，base64 图片自动注入 LLM 多模态上下文，AI 可"看"到页面内容。支持 `annotate=true` 标注模式。每次任务最多 15 张，压缩时自动降级为文字占位。截图时自动隐藏悬浮球避免遮挡
- **跨标签页操作**：所有页面操作工具均支持 `tab_id` 参数，AI 可在单次任务中操作多个标签页

#### Sub-agent 系统 (`src/ai/agent-registry.ts`)

- `AgentRegistry` — Agent 注册表（内存，单次 handleChat 会话生命周期）
- 预定义 Agent 类型：`spawn_subtask`（子任务）、`explore`（探索，只读工具）、`plan`（规划，只读工具）、`review`（审查，只读工具）
- 每个 Agent 有独立的系统提示词（`buildSubtaskPrompt`/`buildExplorePrompt`/`buildPlanPrompt`/`buildReviewPrompt`）、工具过滤器、预算覆盖
- 只读 Agent（explore/plan/review）可共享 tab
- Agent 通过 `AgentInstance` 追踪状态（running/completed/failed）和消息队列

#### TodoManager (`src/ai/todo-manager.ts`)

- 任务规划与进度追踪，纯状态管理器
- 生命周期：单次 handleChat 任务
- 三个核心约束：计划外化（todo 工具将计划变为可追踪状态）、单焦点约束（同一时间只允许一个任务 in_progress）、20 条上限
- 可序列化快照（`TodoSnapshot`），支持断点恢复时传入

#### TabTracker (`src/ai/tab-tracker.ts`)

- 标签页生命周期追踪器，记录 AI 通过工具显式打开的标签页
- 任务结束时自动批量关闭（未标记 `keep_alive` 的）

#### 上下文管理器 (`src/ai/context-manager.ts`)

- 上下文压缩策略：保留第一条用户消息（原始目标）+ 最近 75% 的条目，中间部分压缩为一条摘要
- 图片降级：将多模态 content 中的图片替换为 "[图片已省略]"
- token 估算：基于字符数的粗略估算

#### 系统提示词 (`src/ai/system-prompt.ts`)

多种提示词构建器：
- `buildSystemPrompt()` — 主系统提示词，按任务复杂度四级分类引导模型自主决策
- `buildSubtaskPrompt()` — 子任务提示词
- `buildExplorePrompt()` — 探索子 agent 提示词
- `buildReviewPrompt()` — 审查子 agent 提示词
- `buildPlanPrompt()` — 规划子 agent 提示词

语言策略：技术指令/工具协议/结构化约束用英文（提升遵循度 + 节省 token），用户交互风格/输出语气/角色话术用中文

#### LLM 客户端 (`src/ai/llm-client.ts`)

基于 fetch 实现的 **OpenAI Responses API** 接口，不引入 SDK：
- `chatComplete()` - 非流式调用（POST `{endpoint}/responses`，用于工具调用循环）
- `chatStream()` - 流式调用（AsyncGenerator，用于最终文本回复）
- AI 配置存储在 `chrome.storage.local`，key 为 `mole_ai_settings`
- 用户自行配置 endpoint / API Key / model
- 模型并行工具能力表（`MODEL_PARALLEL_TOOL_CALL_SUPPORT`）：按模型名自动判断是否支持 `parallel_tool_calls`

### MCP 层 (`src/mcp/`)

自实现的轻量 MCP（Model Context Protocol）层，作为内部工具总线：

- `types.ts` — MCP 协议核心类型（MCPTool、MCPToolCallRequest、MCPToolCallResult）
- `server.ts` — MCP Server（管理工具注册，处理 `tools/list` 和 `tools/call` 请求）
- `client.ts` — MCP Client（供 orchestrator 和 background 使用）
- `transport.ts` — InMemoryTransport（内存传输层，连接 Server 和 Client）
- `adapters.ts` — `mcpToolsToSchema()` 将 MCPTool 转换为 LLM ToolSchema
- `validator.ts` — JSON Schema 校验

架构：`FunctionDefinition` → `MCPServer.registerTool()` → `InMemoryTransport` → `MCPClient.listTools()`/`callTool()` → `mcpToolsToSchema()` → LLM API

### 工具函数系统 (`src/functions/`)

#### 内置工具（27 个，注册在 `registry.ts` 的 `BUILTIN_FUNCTIONS` 数组中）

| 工具名 | 文件 | 说明 |
|--------|------|------|
| `page` | `page.ts` | 页面读取（合并后的统一工具） |
| `timer` | `timer.ts` | 定时器 |
| `fetch_url` | `fetch-url.ts` | 远程获取网页 |
| `tab_navigate` | `tab-navigate.ts` | 标签页导航控制 |
| `clipboard_ops` | `clipboard-ops.ts` | 剪贴板操作 |
| `screenshot` | `screenshot.ts` | 截图 |
| `selection_context` | `selection-context.ts` | 选中文本 |
| `storage_kv` | `storage-kv.ts` | KV 键值存储 |
| `notification` | `notification.ts` | 桌面通知 |
| `bookmark_ops` | `bookmark-ops.ts` | 书签管理 |
| `history_search` | `history-search.ts` | 浏览历史搜索 |
| `download_file` | `download-file.ts` | 文件下载 |
| `resident_runtime` | `resident-runtime.ts` | 常驻后台任务运行时 |
| `skill` | `skill.ts` | Skill 工作流入口（动态 schema 生成 + 执行分发） |
| `cdp_input` | `cdp-input.ts` | 页面交互操作（CDP 可信事件） |
| `cdp_dialog` | `cdp-dialog.ts` | CDP 对话框处理 |
| `cdp_frame` | `cdp-frame.ts` | JS 执行（主 frame + iframe 穿透） |
| `cdp_network` | `cdp-network.ts` | CDP 网络监听 + Cookie 管理 |
| `cdp_emulation` | `cdp-emulation.ts` | CDP 设备/环境模拟 |
| `cdp_dom` | `cdp-dom.ts` | DOM 读写 / CSS 样式 / 页面存储 |
| `cdp_debug` | `cdp-debug.ts` | CDP 调试工具集 |
| `extract_data` | `extract-data.ts` | 结构化数据提取 |
| `data_pipeline` | `data-pipeline.ts` | 数据管道（缓冲区管理 + 转换 + 导出） |
| `request_confirmation` | `request-confirmation.ts` | 人机确认节点 |
| `ask_user` | `ask-user.ts` | AI 主动提问节点 |
| `save_workflow` | `save-workflow.ts` | 保存工作流 |
| `load_tools` | `load-tools.ts` | 元工具，按需加载低频工具 |

#### 其他工具子实现文件（不直接注册，由主工具调用）

- `cdp-console.ts`、`cdp-fetch.ts`、`cdp-overlay.ts` — cdp_debug 的子实现
- `page-assert.ts`、`page-repair.ts`、`page-skeleton.ts`、`page-snapshot.ts`、`page-viewer.ts` — page 工具的子实现
- `todo.ts` — todo 工具（由 orchestrator 动态创建，通过 `createTodoFunction()` 绑定 TodoManager 实例）
- `remote-workflow.ts` — 远程工作流执行
- `site-workflow.ts`、`site-workflow-registry.ts`、`site-workflow-matcher.ts` — 站点工作流匹配与管理
- `site-experience.ts` — 站点经验
- `skill-types.ts`、`skill-registry.ts`、`skill-matcher.ts` — Skill 类型/注册表/URL 匹配器
- `tab-utils.ts` — Tab 工具函数
- `tab-message.ts` — Tab 消息传递

#### 工具分层系统 (`tool-tiers.ts`)

- **always-on 工具**（始终注入 LLM）：`page`、`cdp_input`、`tab_navigate`、`screenshot`、`extract_data`、`data_pipeline`、`skill`、`ask_user`、`request_confirmation`、`save_workflow`、`fetch_url`、`selection_context`
- **on-demand 工具**（通过 `load_tools` 元工具按需加载）：
  - `cdp_advanced`：cdp_dom、cdp_frame、cdp_network、cdp_emulation、cdp_dialog、cdp_debug
  - `browser_utils`：clipboard_ops、notification、bookmark_ops、history_search、download_file
  - `data_storage`：storage_kv、download_file
  - `scheduling`：timer、resident_runtime

#### 动态扩展工具

- 持久化在 `chrome.storage.local`（key: `mole_dynamic_tools_v1`）
- 支持 HTTP 端点工具和 mock:// 协议测试工具
- 通过 `upsertDynamicTool()`/`removeDynamicTool()` 增删，`importDynamicToolsFromManifest()` 批量导入
- 动态工具同样注册到 MCP Server

**跨标签页操作说明：**
所有需要操作页面的工具均支持可选的 `tab_id` 参数。tabId 解析优先级：`params.tab_id` > `context.tabId`（编排器注入） > 当前活动标签页。AI 通过 `tab_navigate(action='open')` 获取新 tab 的 `tab_id`，然后在后续工具调用中传入该 id 即可操作目标标签页。

#### CDP 会话管理器 (`src/lib/cdp-session.ts`)

通过 `chrome.debugger` API 管理 Chrome DevTools Protocol 连接，为所有 CDP 工具提供基础设施：

- **生命周期管理** — attach/detach，防重复，自动清理
- **域管理** — attach 后自动启用 Page/Runtime 域，按需启用 Network/Fetch/DOM/CSS/Overlay/DOMStorage 域
- **对话框事件** — 监听 `Page.javascriptDialogOpening`，支持自动处理策略
- **Frame 映射** — 监听 `Runtime.executionContextCreated`，维护 frameId → contextId
- **网络事件** — 监听 Network 域请求/响应/完成/失败事件，存储事件数据
- **Fetch 拦截** — 监听 `Fetch.requestPaused` 事件，暂存被拦截的请求，支持修改/Mock/失败
- **控制台捕获** — 监听 `Runtime.consoleAPICalled` 和 `Runtime.exceptionThrown`

**工具权限体系（声明式元数据驱动）：**

每个工具通过 `FunctionDefinition` 上的字段声明权限等级，`tool-executor.ts` 根据元数据自动决策是否弹窗确认：

| 权限等级 | 含义 | 行为 |
|---------|------|------|
| `read` | 只读操作（page(action='view')、screenshot 等） | 自动放行 |
| `interact` | 页面交互（cdp_input、tab_navigate.open 等） | 自动放行 |
| `sensitive` | 敏感数据/内容修改（Cookie、Storage 读写等） | 弹窗确认，可被 trustAll 跳过 |
| `dangerous` | 高危不可逆操作（导航跳转、关闭标签页等） | 每次必须确认，不可跳过 |

- `permissionLevel` — 工具整体权限等级（默认 `interact`）
- `actionPermissions` — action 级别覆盖（如 `cdp_dom` 的 `storage_clear: 'dangerous'`）
- `approvalMessageTemplate` — 确认消息模板（支持 `{key}`/`{url}` 等占位符）

**工具负面边界描述：**

重点工具的 `description` 末尾包含 `⚠️ 不要用此工具来：` 段落，明确告知 AI 不应使用该工具的场景及替代工具，防止工具误选。

**扩展工具函数：**
1. 在 `src/functions/` 下新建文件，导出 `FunctionDefinition`
2. **声明 `permissionLevel`**，敏感操作需声明 `actionPermissions` 和 `approvalMessageTemplate`
3. 在 `description` 末尾添加负面边界描述（如有容易混淆的工具）
4. 在 `registry.ts` 中 import 并添加到 `BUILTIN_FUNCTIONS` 数组
5. 在 `src/content/float-ball/icons.ts` 中为新工具添加图标和中文名称**（必须）**
6. 如有必要，在 `src/ai/system-prompt.ts` 中补充使用引导

### 悬浮球 UI（React 版）

- 入口：`src/content/float-ball-react.tsx` → `src/content/float-ball/MoleRoot.tsx`
- Shadow DOM 隔离样式，不影响宿主页面
- React 组件树挂载在 Shadow DOM 内
- 支持域名黑名单（`DISABLED_DOMAINS_KEY`，在 Options 页面管理）
- 快捷键：⌘M (Mac) / Ctrl+M (Windows)
- 搜索框接入 AI 对话，支持流式响应和函数调用状态展示
- 组件文件：`src/content/float-ball/`（包含 MoleRoot、components、context、hooks、styles、constants 等）
- 旧版 `src/content/float-ball.ts` 保留但未使用，待迁移完成后删除

### 页面内容解析器 (`src/content/page-parser.ts`)

- 运行在 content script 侧
- 接收来自 background 的 `__parse_page_content` 消息
- 解析当前页面 DOM 提取结构化数据

### 核心通信系统：Channel (`src/lib/channel.ts`)

Background、Content Script、Popup、Options 之间的双向消息传递系统：

**主要 API：**
- `Channel.on(type, handler)` - 注册消息处理器
- `Channel.off(type, handler)` - 注销处理器
- `Channel.send(type, data, callback?)` - 发送消息
- `Channel.sendToTab(tabId, type, data, callback?)` - 发送消息到指定 tab
- `Channel.listen(tabId?)` - 初始化监听器（content 传 tabId，background 不传）
- `Channel.broadcast(type, data)` - 仅后台使用：向所有已注册标签页 + extension page 广播
- `Channel.connectAsExtensionPage()` - extension page（options/popup）侧连接，接收 broadcast
- `Channel.disconnectExtensionPage()` - extension page 侧断开连接
- `Channel.getRegisteredTabs()` - 获取所有已注册的 tabId
- `Channel.unregisterTab(tabId)` - 注销 tab
- `Channel.clearAllTabs()` - 清空所有已注册 tab

**消息类型（基础）— `channel-handlers.ts`：**
- `__get_tab_info` - 获取 tab 信息
- `__show_notification` - 显示桌面通知
- `__fetch_page_title` - 获取网页标题（link preview 用）
- `__open_options_page` - 打开扩展设置页
- `__log_report` - 日志上报（content → background）
- `__session_focus_tab` - 定位到任务发起页签

**消息类型（会话管理）— `session-channel-handlers.ts`：**
- `__session_create` - 创建新会话
- `__session_continue` - 继续对话
- `__session_resume` - 断点恢复
- `__session_rollback` - 回滚会话轮次
- `__session_get_active` - 获取当前活跃会话信息
- `__session_replay_request` - 请求会话回放（支持 latest_turn/full/delta）
- `__session_clear` - 清除会话
- `__ai_cancel` - 取消任务（兼容 sessionId 和 taskId 两种模式）
- `__test_chain` - 测试链式调用

**广播消息类型（background → content/options）：**
- `__session_sync` - 会话状态同步
- `__session_replay` - 会话事件回放
- `__ai_stream` - AI 流式响应事件

**消息类型（工作流）— `workflow-handlers.ts`：**
- `__site_workflows_match` - 站点工作流匹配
- 动态工具 CRUD 相关消息

### 会话管理系统 (`src/background/session-manager.ts`)

Hub-and-Spoke 架构：`session-manager.ts` 作为 Hub，spoke 模块各司其职：

- **Hub**：会话生命周期、Task Runner 引擎（创建/运行/中止任务）、pushEvent 事件分发
- **Spoke 模块**：session-state（状态）、session-event（事件）、session-resource（资源）、session-persistence（持久化）、session-history（历史）、session-replay（回放）、session-context-tasks（审查/压缩）

**关键常量：**
- `MAX_SESSIONS = 10` — 会话容量上限
- `MAX_MODEL_CONTEXT_ITEMS = 250` — 模型上下文条目上限
- `GRACEFUL_ABORT_TIMEOUT_MS = 120` — 优雅中止超时

**Op 调度队列：**
- 所有会话操作通过 `dispatchSessionOp()` 串行化执行，避免并发冲突
- Op 类型：`create`、`continue`、`rollback`、`clear`、`cancel`、`get_active`、`replay_request`、`resume`

**任务类型（SessionTaskKind）：**
- `regular` — 常规对话
- `review` — 审查任务
- `compact` — 上下文压缩
- `aux` — 辅助任务

### 定时器系统 (`src/background/timer-dispatch.ts`)

双模式定时器：
- **Chrome Alarms** — 持久化定时器，Service Worker 重启后自动恢复
- **运行时定时器** — setTimeout/setInterval，精度更高但 SW 重启后需手动恢复
- `src/lib/timer-store.ts` — 定时器持久化存储
- `src/lib/timer-scheduler.ts` — 定时器调度器

### 存储系统 (`src/lib/storage.ts`)

`chrome.storage.local` 的封装：

- `Storage.get<T>(key)` / `Storage.save(key, data)` - 通用存取
- `Storage.addLog(item)` - 添加日志（循环缓冲区，最大 1000 条）
- `Storage.getLogs()` / `exportLogs()` - 获取/导出日志
- `Storage.clear_all()` / `clearLogs()` - 清除操作

### 其他库模块

- **`src/lib/console.ts`** - 自定义 console，日志持久化到 Storage 并上报到 background
- **`src/lib/url.ts`** - URL 工具（获取活动标签页 URL、域名提取）
- **`src/lib/artifact-store.ts`** - 工件存储（用于阶段间数据传递）
- **`src/lib/cdp-session.ts`** - CDP 会话管理器（详见上文）
- **`src/lib/timer-store.ts`** - 定时器持久化存储
- **`src/lib/timer-scheduler.ts`** - 定时器调度器
- **`src/utils/index.ts`** - 通用工具（sleep、stringToArrayBuffer）

### 配置文件

- **`src/config/index.ts`** - 中央配置：
  - `MAX_LOG_NUM = 1000` — 最大日志数
  - `LOG_LEVEL = 'DEBUG'` — 日志等级
  - `VERSION` — 应用版本（从 `process.env.APP_VERSION` 读取）
  - `AI_CONFIG.MAX_FUNCTION_ROUNDS = 50` — 最大函数调用轮数
  - `AI_CONFIG.MAX_TOOL_CALLS = 120` — 单轮最大工具调用数
  - `AI_CONFIG.MAX_SAME_TOOL_CALLS = 5` — 相同工具+参数最大重复次数
  - `AI_CONFIG.DEFAULT_MODEL = 'gpt-5.3-codex'` — 默认模型

- **`public/manifest.json`** - Chrome 扩展清单文件（MV3）
  - 权限：`tabs`、`activeTab`、`storage`、`notifications`、`alarms`、`scripting`、`clipboardRead`、`clipboardWrite`、`bookmarks`、`history`、`downloads`、`webRequest`、`debugger`
  - host_permissions：`<all_urls>`
  - 内容脚本注入到所有 URL（仅主 frame）
  - options_page：`options.html`
  - Web 可访问资源：`logo.png`、`skills/**/*`

## 依赖

### 生产依赖
- `react` ^18.2.0 - UI 框架（popup、content 悬浮球、options 页面）
- `react-dom` ^18.2.0 - React DOM 渲染
- `dayjs` ^1.11.13 - 日期格式化（日志时间戳）
- `antd` ^5.29.3 - UI 组件库（Options 页面）
- `@ant-design/icons` ^5.6.1 - Ant Design 图标
- `@ant-design/pro-layout` ^7.22.7 - Ant Design Pro 布局组件

### 开发依赖
- `vite` ^5.0.0 + `@vitejs/plugin-react` - 构建工具
- `typescript` ^5.0.2 - TypeScript
- `@types/chrome` ^0.0.328 - Chrome 扩展 API 类型
- `@types/node` ^20.19.2 - Node.js 类型
- `eslint` + `@typescript-eslint/*` - 代码检查
- `vitepress` ^1.6.4 - 文档站点构建

## 类型系统

### 全局类型 (`src/types/index.ts`)

```typescript
type LogType = 'LOG' | 'WARN' | 'ERROR';
interface LogItem { timeStamp?, text?, type?, logObj?, error? }
```

### AI 类型 (`src/ai/types.ts`)

适配 **OpenAI Responses API** 格式：

```typescript
/** 多模态内容 */
type ContentPart = InputTextContent | InputImageContent;

/** 输入项联合类型 */
type InputItem = MessageInputItem | FunctionCallInputItem | FunctionCallOutputItem;

/** MessageInputItem — 用户/助手消息 */
interface MessageInputItem {
  role: 'user' | 'assistant';
  content: string | ContentPart[];
}

/** FunctionCallInputItem — 函数调用（来自模型响应） */
interface FunctionCallInputItem {
  type: 'function_call';
  id: string;
  call_id: string;
  name: string;
  arguments: string;
}

/** FunctionCallOutputItem — 函数调用结果 */
interface FunctionCallOutputItem {
  type: 'function_call_output';
  call_id: string;
  output: string;
}

/** 输出项联合类型 */
type OutputItem = OutputMessageItem | OutputFunctionCallItem;

/** ToolSchema — Responses API 工具 schema */
interface ToolSchema {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, any>;
}

/** AI 配置 */
interface AISettings {
  apiKey: string;
  endpoint: string;
  model: string;
  strictResultMode: boolean;
  supportsParallelToolCalls?: boolean;
}

/** 工具选择策略 */
type ToolChoice = 'auto' | 'required' | 'none' | { type: 'function'; name: string };

/** 会话状态 */
type SessionStatus = 'running' | 'done' | 'error';

/** 会话失败码 */
type SessionFailureCode =
  | 'E_AUTH_REQUIRED' | 'E_CANCELLED' | 'E_SUPERSEDED'
  | 'E_TURN_MISMATCH' | 'E_LLM_API' | 'E_PARAM_RESOLVE'
  | 'E_TOOL_EXEC' | 'E_NO_TOOL_EXEC' | 'E_SESSION_RUNTIME' | 'E_UNKNOWN';

/** 调度阶段 */
type AgentPhase = 'plan' | 'act' | 'observe' | 'verify' | 'finalize';

/** AI 事件类型（30+ 种，用于流式推送） */
type AIStreamEventType =
  | 'thinking' | 'planning' | 'warning' | 'agent_state'
  | 'function_call' | 'function_result' | 'search_results'
  | 'screenshot_data' | 'page_assert_data' | 'page_repair_data'
  | 'text' | 'cards' | 'error'
  | 'turn_started' | 'turn_completed' | 'turn_aborted'
  | 'thread_rolled_back' | 'entered_review_mode' | 'exited_review_mode'
  | 'context_compacted' | 'turn_item_started' | 'turn_item_completed'
  | 'approval_request' | 'queue_updated' | 'todo_update'
  | 'phase_handoff' | 'review_started' | 'review_completed';
```

### 工具函数类型 (`src/functions/types.ts`)

```typescript
type PermissionLevel = 'read' | 'interact' | 'sensitive' | 'dangerous';

interface FunctionDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
  supportsParallel: boolean;
  permissionLevel?: PermissionLevel;
  actionPermissions?: Record<string, PermissionLevel>;
  approvalMessageTemplate?: string | Record<string, string>;
  validate?: (params: any) => string | null;
  execute: (params: any, context?: ToolExecutionContext) => Promise<FunctionResult>;
}

interface FunctionResult { success: boolean; data?: any; error?: string; }

interface ToolExecutionContext { tabId?: number; signal?: AbortSignal; }
```

## 开发工作流

1. 在 `src/` 目录下修改代码
2. 运行 `npm run build` 或 `npm run dev`（监听模式）
3. 在 Chrome 中从 `build_version/mole-extension/` 加载未打包的扩展
4. 内容脚本修改：重新加载扩展并刷新目标页面
5. 后台脚本修改：重新加载扩展
6. 弹窗修改：关闭并重新打开弹窗
7. Options 页面修改：重新加载扩展并刷新 Options 页面

**调试技巧：**
- 使用 `_console.log()` 而不是 `console.log()`，日志会被持久化
- 内容脚本的日志可以在页面的开发者工具控制台中查看
- 后台脚本的日志需要在扩展管理页面点击"Service Worker"查看

## TypeScript 配置

- **`tsconfig.json`** - 根配置
- **`tsconfig.app.json`** - 应用特定配置
- **`tsconfig.node.json`** - Node/构建工具配置

## 与 AI 协作建议

- 提问时请使用中文，描述清晰的问题和期望的结果
- 修改代码时，说明需要修改的功能点和原因
- 添加新功能时，说明功能的具体需求和使用场景
- 修复 bug 时，提供详细的错误信息和复现步骤
- 所有代码注释和文档更新都应使用中文
