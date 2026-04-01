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

本项目是 **MoleClaw** Chrome 扩展程序（MV3），使用 React + TypeScript + Vite 构建。核心功能是**在任意网页上注入一个 AI 悬浮助手（Mole）**，用户通过悬浮球或快捷键唤起对话框，与 AI 交互。Mole 运行在用户的真实浏览器环境中，天然复用用户的登录态和 Cookie，无需额外的身份验证或 Cookie 迁移。AI 通过 Agentic Loop 自主调用 37+ 内置工具，在后台多轮执行，完成后以流式方式返回结果。

## 构建系统

本项目使用**三个独立的 Vite 配置文件**来构建扩展的不同部分：

### 构建命令

- **`npm run build`** - 按顺序构建所有组件（popup、content、background）
- **`npm run build:popup`** - 构建弹窗 UI（使用 vite.config.popup.ts）
- **`npm run build:content`** - 构建内容脚本（使用 vite.config.content.ts）
- **`npm run build:background`** - 构建后台服务工作器（使用 vite.config.background.ts）
- **`npm run dev`** - 开发模式下的监听构建
- **`npm run lint`** - 对 TypeScript 文件运行 ESLint 检查

### 构建输出

所有构建输出到：`build_version/mole-extension/`

输出目录结构符合 Chrome 扩展 manifest 要求：
- `index.html` + assets - 弹窗 UI
- `content.js` - 内容脚本（IIFE 格式）
- `background.js` - 后台服务工作器（IIFE 格式）
- `manifest.json` - 从 `public/manifest.json` 复制
- `logo.png` - 扩展图标

## 架构设计

### 扩展组件

本扩展遵循 Chrome Extension MV3 架构，包含三个主要组件：

1. **弹窗 UI** (`src/main.tsx`, `src/App.tsx`)
   - 基于 React 的极简弹窗界面
   - 显示扩展名称和版本信息
   - 入口文件：`index.html`

2. **内容脚本** (`src/content.ts`)
   - 注入到所有匹配 `<all_urls>` 的网页中
   - 初始化 Channel 通信、搜索结果解析器和悬浮球 UI
   - 所有网页统一注入相同的 AI 悬浮助手

3. **后台服务工作器** (`src/background.ts`)
   - 处理跨组件通信中枢
   - AI 对话处理（快捷指令模式 + AI 编排模式）
   - Tab 信息服务和生命周期管理
   - 桌面通知、日志汇总
   - 20 秒心跳保活

### AI 系统

#### AI 编排器 (`src/ai/orchestrator.ts`)

核心调度循环：用户输入 → LLM → function_call → 执行工具 → 再 LLM → 流式回复

- 支持多轮 function calling（最多 5 轮，防止无限循环）
- 系统提示词定义了 AI 角色和可用工具
- 通过回调函数推送流式事件（thinking/function_call/function_result/text/done/error）
- **工具并行执行**：LLM 一次返回多个 function_call 时，`supportsParallel: true` 的工具使用 Promise.all 并发执行，serial 工具作为屏障串行执行（`src/ai/tool-executor.ts`）
- **断点恢复**：任务执行过程中定期持久化 checkpoint（context 快照），因 SW 重启/API 错误等中断时，用户可一键"重试"从断点恢复执行
- **Vision 视觉理解**：截图工具执行后，base64 图片自动注入 LLM 多模态上下文，AI 可"看"到页面内容（Canvas/图表/验证码等）。支持 `annotate=true` 标注模式，在截图上标注所有可交互元素编号并返回 element_id 映射表，配合 Look→Act→Check 操作协议大幅提升元素定位准确率。每次任务最多 15 张，压缩时自动降级为文字占位。截图时自动隐藏悬浮球避免遮挡
- **跨标签页操作**：所有页面操作工具均支持 `tab_id` 参数，AI 可在单次任务中操作多个标签页（如在 A 页面查信息，在 B 页面填表）

#### LLM 客户端 (`src/ai/llm-client.ts`)

基于 fetch 实现的 OpenAI 兼容接口，不引入 SDK：
- `chatComplete()` - 非流式调用（用于 function calling 循环）
- `chatStream()` - 流式调用（用于最终文本回复，AsyncGenerator）
- AI 配置存储在 `chrome.storage.local`，key 为 `mole_ai_settings`
- 用户自行配置 endpoint / API Key / model

#### 工具函数系统 (`src/functions/`)

- `registry.ts` - 函数注册表，管理所有内置工具 + 动态扩展工具
- `types.ts` - `FunctionDefinition`、`FunctionResult`、`PermissionLevel` 类型
- `cdp-input.ts` - 页面交互操作（点击/输入/滚动/填写/等待/拖拽等 18 种 action，CDP 可信事件）
- `cdp-dom.ts` - DOM 读写/CSS 样式/页面存储（query/get_text/set_html/add_class/css_*/storage_* 等 34 种 action）
- `cdp-frame.ts` - JS 执行（主 frame + iframe 穿透，支持 return 语句和 async/await）
- `cdp-dialog.ts` - CDP 对话框处理（alert/confirm/prompt）
- `cdp-network.ts` - CDP 网络监听 + Cookie 管理
- `cdp-emulation.ts` - CDP 设备/环境模拟
- `cdp-console.ts` - CDP 控制台消息捕获
- `cdp-fetch.ts` - CDP 请求拦截与篡改（Fetch 域）
- `cdp-overlay.ts` - CDP 视觉高亮标注（Overlay 域）
- `extract-data.ts` - 结构化数据提取（auto/table/list/repeat/schema 五种模式）
- `data-pipeline.ts` - 数据管道（缓冲区管理 + 转换 + JSON/CSV/Markdown/TSV 导出）
- `request-confirmation.ts` - 人机确认节点（AI 驱动的操作前用户授权）
- `ask-user.ts` - AI 主动提问节点（向用户提出问题并等待回答，支持选项和自由文本）
- `save-workflow.ts` - 保存工作流（录制确认后 AI 调用保存）
- `tab-navigate.ts` - 标签页导航控制（open/close/switch/list/navigate 等 13 种操作）
- `tab-utils.ts` - Tab 工具函数（等待加载、隐藏 tab 操作等）
- `skill.ts` - Skill 工具入口（动态 schema 生成 + 执行分发，替代旧 site_workflow）
- `skill-types.ts` - Skill 类型定义（SkillSpec、WorkflowEntry）
- `skill-registry.ts` - Skill 注册表（两层架构：全局 + 域级，同步/缓存/增删改查）
- `skill-matcher.ts` - Skill URL 匹配器（全局始终匹配，域级按 url_patterns 匹配）

**跨标签页操作说明：**
所有需要操作页面的工具（page_viewer、page_snapshot、page_skeleton、cdp_input、cdp_dom、cdp_frame、extract_data、skill 以及其他 CDP 工具）均支持可选的 `tab_id` 参数。tabId 解析优先级：`params.tab_id` > `context.tabId`（编排器注入） > 当前活动标签页。AI 通过 `tab_navigate(action='open')` 获取新 tab 的 `tab_id`，然后在后续工具调用中传入该 id 即可操作目标标签页。

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
| `read` | 只读操作（page_viewer、screenshot 等） | 自动放行 |
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
5. 在 `src/content/float-ball.ts` 中为新工具添加 `FUNCTION_ICONS`（SVG 图标）和 `FUNCTION_LABELS`（中文名称）**（必须）**
6. 如有必要，在 `src/ai/orchestrator.ts` 的系统提示词中补充使用引导

### 悬浮球 UI (`src/content/float-ball.ts`)

- Shadow DOM 隔离样式，不影响宿主页面
- 胶囊形态贴边微隐藏，hover 滑出
- 快捷键：⌘M (Mac) / Ctrl+M (Windows)
- 搜索框接入 AI 对话，支持流式响应和函数调用状态展示
- 支持拖拽定位，位置持久化到 `chrome.storage.local`

### 搜索结果解析器 (`src/content/search-parser.ts`)

- 运行在 content script 侧
- 接收来自 background 的 `__parse_search_results` 消息
- 根据当前页面 hostname 识别搜索引擎（百度/京东）
- 解析 DOM 提取结构化数据

### 核心通信系统：Channel (`src/lib/channel.ts`)

Background、Content Script、Popup 之间的双向消息传递系统：

**主要 API：**
- `Channel.on(type, handler)` - 注册消息处理器
- `Channel.off(type, handler)` - 注销处理器
- `Channel.send(type, data, callback?)` - 发送消息
- `Channel.sendToTab(tabId, type, data, callback?)` - 发送消息到指定 tab
- `Channel.listen(tabId?)` - 初始化监听器（content 传 tabId，background 不传）
- `Channel.broadcast(type, data)` - 仅后台使用：向所有已注册标签页广播
- `Channel.unregisterTab(tabId)` - 注销 tab

**内置消息类型：**
- `__get_tab_info` - 获取 tab 信息
- `__show_notification` - 显示桌面通知
- `__log_report` - 日志上报（content → background）
- `__ai_chat` - AI 对话请求
- `__ai_stream` - AI 流式响应事件
- `__parse_search_results` - 搜索结果解析
- `__test_chain` - 测试链式调用
- `__channel_tab_register` - 内部：tab 注册

### 存储系统 (`src/lib/storage.ts`)

`chrome.storage.local` 的封装：

- `Storage.get<T>(key)` / `Storage.save(key, data)` - 通用存取
- `Storage.addLog(item)` - 添加日志（循环缓冲区，最大 1000 条）
- `Storage.getLogs()` / `exportLogs()` - 获取/导出日志
- `Storage.clear_all()` / `clearLogs()` - 清除操作

### 工具模块

- **`src/lib/console.ts`** - 自定义 console，日志持久化到 Storage 并上报到 background
- **`src/lib/url.ts`** - URL 工具（获取活动标签页 URL、域名提取）
- **`src/utils/index.ts`** - 通用工具（sleep、stringToArrayBuffer）

### 配置文件

- **`src/config/index.ts`** - 中央配置（MAX_LOG_NUM、LOG_LEVEL、VERSION、AI_CONFIG）
- **`public/manifest.json`** - Chrome 扩展清单文件（MV3）
  - 权限：tabs、activeTab、storage、notifications、debugger 等
  - host_permissions：`<all_urls>`
  - 内容脚本注入到所有 URL（仅主 frame）
  - Web 可访问资源：`logo.png`

## 依赖

### 生产依赖
- `react` ^18.2.0 - UI 框架（仅 popup）
- `react-dom` ^18.2.0 - React DOM 渲染
- `dayjs` ^1.11.13 - 日期格式化（日志时间戳）

### 开发依赖
- `vite` ^5.0.0 + `@vitejs/plugin-react` - 构建工具
- `typescript` ^5.0.2 - TypeScript
- `@types/chrome` ^0.0.328 - Chrome 扩展 API 类型
- `eslint` + `@typescript-eslint/*` - 代码检查

## 类型系统

### 全局类型 (`src/types/index.ts`)

```typescript
type LogType = 'LOG' | 'WARN' | 'ERROR';
interface LogItem { timeStamp?, text?, type?, logObj?, error? }
```

### AI 类型 (`src/ai/types.ts`)

```typescript
interface ChatMessage { role, content, tool_calls?, tool_call_id? }
interface ToolCall { id, type, function: { name, arguments } }
interface ToolSchema { type, function: { name, description, parameters } }
interface StreamChunk { delta?, tool_calls?, finish_reason? }
interface AIStreamEvent { type, content }
interface AISettings { apiKey, endpoint, model }
```

### 工具函数类型 (`src/functions/types.ts`)

```typescript
interface FunctionDefinition { name, description, parameters, execute() }
interface FunctionResult { success, data?, error? }
```

## 开发工作流

1. 在 `src/` 目录下修改代码
2. 运行 `npm run build` 或 `npm run dev`（监听模式）
3. 在 Chrome 中从 `build_version/mole-extension/` 加载未打包的扩展
4. 内容脚本修改：重新加载扩展并刷新目标页面
5. 后台脚本修改：重新加载扩展
6. 弹窗修改：关闭并重新打开弹窗

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
