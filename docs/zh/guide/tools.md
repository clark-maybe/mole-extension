# 内置工具列表

MoleClaw 内置了 35+ 个工具，覆盖浏览器自动化的各个场景。AI 会根据用户的自然语言指令自动选择最合适的工具。

## 页面感知类

| 工具 | 说明 |
|------|------|
| `page_viewer` | 获取当前页面的可见文本内容，用于理解页面信息 |
| `page_snapshot` | 对页面进行结构化快照，支持按查询条件定位目标元素，返回元素树和 element_id |
| `page_skeleton` | 提取页面骨架结构，快速了解页面整体布局 |
| `page_assert` | 断言页面状态是否符合预期，用于关键操作后的验证 |
| `page_repair` | 当 page_assert 失败时，尝试自动修复页面状态 |
| `screenshot` | 页面截图，支持可见区域、全页截图、区域截图和元素截图（CDP 增强） |
| `selection_context` | 获取用户在页面上选中的文本及其上下文信息 |

## 页面操作类

| 工具 | 说明 |
|------|------|
| `page_action` | 页面交互操作，支持两种定位方式：element_id（来自 page_snapshot，优先）和 CSS selector。支持点击、填写、清空、聚焦、选择、滚动、滚动到元素可见、悬停、键盘输入、等待元素、获取元素信息等 |
| `dom_manipulate` | 直接操作 DOM：查询元素、修改属性、插入/删除节点等 |
| `js_execute` | 在页面上下文中执行自定义 JavaScript 代码，用于复杂的页面交互 |

## 导航与标签页

| 工具 | 说明 |
|------|------|
| `tab_navigate` | 标签页导航：在当前标签页跳转 URL、新开标签页、关闭标签页等 |
| `fetch_url` | 在后台发起 HTTP 请求获取 URL 内容，不影响当前页面 |

## 浏览器能力

| 工具 | 说明 |
|------|------|
| `clipboard_ops` | 剪贴板操作：读取和写入剪贴板内容 |
| `storage_kv` | 键值存储：在扩展的本地存储中读写数据，支持跨会话持久化 |
| `notification` | 发送浏览器桌面通知 |
| `bookmark_ops` | 书签操作：搜索、创建、删除书签 |
| `history_search` | 搜索浏览器历史记录 |
| `download_file` | 下载文件到本地 |

## 定时与自动化

| 工具 | 说明 |
|------|------|
| `timer` | 统一定时器管理：支持延时任务、周期任务、取消定时器、列出活跃定时器 |
| `resident_runtime` | 常驻运行器：在后台持续运行任务，适合需要长时间监控或定期执行的场景 |

## 工作流与任务

| 工具 | 说明 |
|------|------|
| `site_workflow` | 执行预定义的站点工作流，根据当前页面 URL 自动匹配可用的工作流 |
| `spawn_subtask` | 将独立子目标拆分为隔离任务执行，每个子任务有独立上下文 |

## CDP 增强工具 <Badge type="tip" text="Chrome DevTools Protocol" />

通过 `chrome.debugger` API 接入 Chrome DevTools Protocol，提供浏览器进程级别的深度控制能力。这些工具在常规 Content Script 手段受限时（反爬检测、跨域 iframe、网络细节等）尤为关键。

### 输入与交互

| 工具 | 说明 |
|------|------|
| `cdp_input` | 发送可信鼠标/键盘事件（`isTrusted=true`），支持点击、双击、右键、悬停、拖拽、输入文字、按键、滚动。绕过反爬的事件来源检测 |
| `cdp_dialog` | 查询和处理 JavaScript 对话框（alert/confirm/prompt/beforeunload），支持手动处理和自动策略 |

### 页面与 Frame

| 工具 | 说明 |
|------|------|
| `cdp_frame` | 跨 iframe 操作：列出页面所有 frame、在指定 frame 中执行 JS、获取 iframe 文本快照。解决跨域 iframe（验证码、支付表单等）无法操作的问题 |

### 网络与 Cookie

| 工具 | 说明 |
|------|------|
| `cdp_network` | CDP 增强版网络监听：完整的请求/响应数据（包括 body 和 headers）、统计汇总，以及跨域 Cookie 读写（get/set/delete） |

### 环境模拟

| 工具 | 说明 |
|------|------|
| `cdp_emulation` | 设备与环境模拟：视口尺寸（移动端）、User-Agent 覆盖、地理位置伪造、语言/时区设置、网络条件模拟（3G/离线等） |

### 请求拦截

| 工具 | 说明 |
|------|------|
| `cdp_fetch` | 请求拦截与篡改（Fetch 域）：拦截页面网络请求，可修改请求参数后放行、直接返回自定义响应（Mock API）、或模拟请求失败。适用于注入认证 headers、Mock 数据、绕过 CORS 等场景 |

### DOM 深度操作

| 工具 | 说明 |
|------|------|
| `cdp_dom` | 跨域 DOM 操作（DOM 域）：通过 CDP 直接查询/修改 DOM 节点，无视同源策略。支持 CSS 选择器查询、HTML 读写、属性操作、获取元素精确 box model（margin/border/padding/content）、节点删除 |

### 页面存储

| 工具 | 说明 |
|------|------|
| `cdp_storage` | 页面存储操作（DOMStorage 域）：读写目标页面的 localStorage 和 sessionStorage，无需 content script。适用于读取登录 token、修改缓存配置、清除存储数据等 |

### 样式操作

| 工具 | 说明 |
|------|------|
| `cdp_css` | CSS 样式检查与修改（CSS 域）：获取元素计算样式、匹配的 CSS 规则、修改内联样式、动态添加 CSS 规则、读写完整样式表。适用于样式诊断、动态注入 CSS、提取设计 token |

### 视觉高亮

| 工具 | 说明 |
|------|------|
| `cdp_overlay` | 元素高亮标注（Overlay 域）：高亮指定 DOM 节点、CSS 选择器匹配的元素或矩形区域，支持自定义颜色。AI 操作时可视化标注目标，让用户观察到操作对象 |

### 调试诊断

| 工具 | 说明 |
|------|------|
| `cdp_console` | 捕获页面 console.log/warn/error 输出和未捕获的 JavaScript 异常，辅助 AI 诊断页面问题 |

::: warning 注意
CDP 工具需要 `debugger` 权限。使用时浏览器顶部会显示调试器提示条，这是 Chrome 的安全机制，属于正常现象。
:::

## 工具使用优先级

当 AI 需要操作页面时，会按以下优先级选择工具：

1. **`site_workflow`** - 首选：当前页面有匹配的预定义工作流时优先使用，速度快且可靠
2. **`page_snapshot`** + `page_action(element_id=...)` - 先快照定位元素，再基于 element_id 精确操作
3. **`page_action(selector=...)`** - 基于 CSS 选择器的操作，当 element_id 不可用时使用
4. **`cdp_input`** - 当页面有反爬检测拦截常规点击时，使用 CDP 发送可信事件
5. **`dom_manipulate`** - 直接 DOM 操作，作为最后手段

::: tip 提示
你不需要手动选择工具，只需用自然语言描述你的需求，AI 会自动选择最合适的工具组合来完成任务。
:::
