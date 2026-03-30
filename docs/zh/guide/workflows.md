# 工作流

工作流让你教会 Mole 可重复的任务。演示一次，以后随时让它重播。

## 两种创建方式

### 录制（推荐）

最简单的方式——直接演示：

1. 点击搜索框底部的「录制流程」按钮
2. 像平时一样操作——点击、输入、导航
3. 完成后停止录制
4. Mole 的 AI 自动清洗录制内容：去除误点击、合并击键、标记可自定义的部分（如搜索词）
5. 工作流保存完毕，可以使用了

下次直接说「帮我打卡」之类的，Mole 就会自动重播。

### 手动编写（进阶）

如果需要更精细的控制，可以用 JSON 手写工作流定义。适合复杂自动化或者分享给他人。详见下方技术参考。

---

## 内置工作流

MoleClaw 默认包含以下预定义工作流：

| 工作流 | 说明 | URL 匹配 |
|--------|------|----------|
| 京东商品搜索 | 在京东搜索商品，返回商品卡片列表 | 所有页面 |
| 百度搜索 | 在百度搜索关键词，返回搜索结果列表 | 所有页面 |
| Boss 直聘消息回复 | 在 Boss 直聘聊天页面操作会话、采集消息、自动回复 | `*.zhipin.com` |
| 淘宝商品搜索 | 在淘宝搜索商品，返回商品列表 | 所有页面 |
| 淘宝商品详情 | 采集淘宝/天猫商品详情页的结构化数据 | 所有页面 |
| 今日热榜 | 采集今日热榜 Top 100 热点新闻 | 所有页面 |

## 工作流结构

每个工作流是一个 JSON 对象，包含以下字段：

```json
{
  "name": "工作流名称",
  "label": "显示标签",
  "description": "工作流描述，AI 据此判断何时使用",
  "url_patterns": ["*://*.example.com/*"],
  "version": 1,
  "enabled": true,
  "parameters": {
    "type": "object",
    "properties": {
      "keyword": {
        "type": "string",
        "description": "搜索关键词"
      }
    },
    "required": ["keyword"]
  },
  "plan": {
    "version": 1,
    "steps": [
      {
        "action": "tab_navigate",
        "note": "导航到目标页面",
        "params": {
          "action": "navigate",
          "url": "https://example.com/search?q={{keyword}}"
        },
        "saveAs": "nav_result"
      },
      {
        "action": "cdp_input",
        "note": "等待结果加载",
        "params": {
          "action": "wait_for_element",
          "selector": ".results",
          "timeout_ms": 10000
        }
      },
      {
        "action": "cdp_dom",
        "note": "采集结果数据",
        "params": {
          "action": "query",
          "selector": ".result-item",
          "limit": 10
        },
        "saveAs": "items"
      }
    ],
    "resultPath": "items"
  }
}
```

### 关键字段说明

- **`url_patterns`** - URL 匹配规则，使用通配符语法，决定工作流在哪些页面可用
- **`parameters`** - JSON Schema 格式的参数定义，AI 调用时传入
- **`plan.steps`** - 步骤数组，每一步调用一个内置工具
- **`plan.steps[].action`** - 要调用的工具名称
- **`plan.steps[].params`** - 工具参数，支持 `{{变量}}` 模板语法
- **`plan.steps[].saveAs`** - 将步骤结果存储为变量，供后续步骤引用
- **`plan.steps[].when`** - 条件执行，值为 falsy 时跳过该步骤
- **`plan.steps[].retry`** - 重试配置（`maxAttempts`、`delayMs`、`backoffFactor`）
- **`plan.steps[].onError`** - 错误处理策略（`"continue"` 跳过继续）
- **`plan.resultPath`** - 最终结果的取值路径
- **`plan.closeOpenedTabs`** - 是否在完成后关闭新开的标签页（`"on_success"`）

## 录制工作流

创建自定义工作流最简单的方式是在悬浮球中**直接录制**。无需手写 JSON，只需演示一遍操作，AI 会自动生成工作流。

### 操作步骤

1. 打开悬浮球搜索框（`Cmd+M` / `Ctrl+M`）
2. 点击底部的**「录制流程」**按钮
3. 在页面上进行操作（点击、输入、导航等）
4. 操作完成后点击**「停止」**
5. 可以点击页面上的结果元素进行标记，或点击**「跳过」**进入整页快照模式
6. 等待 AI 处理 — 它会清洗录制内容、去除噪声、识别可参数化的输入，生成标准工作流
7. 工作流自动保存，后续对话中 AI 可直接调用

::: tip 提示
录制生成的工作流标记为 `source: "user"`，与手动添加和远程同步的工作流一起管理。可在 Options 页面进行查看和编辑。
:::

## 自定义工作流

### 通过 Options 页面

1. 右键点击 Mole 扩展图标，选择 **选项**
2. 在工作流管理区域，点击 **添加工作流**
3. 粘贴工作流 JSON 定义
4. 保存后立即生效

### 通过 Manifest 远程同步

MoleClaw 支持从远程 URL 同步工作流 Manifest。

#### Manifest 格式

```json
{
  "version": 2,
  "updatedAt": "2025-01-01T00:00:00Z",
  "workflows": [
    { /* 工作流定义 */ },
    { /* 工作流定义 */ }
  ]
}
```

#### 同步机制

- 支持配置多个 Manifest 源
- 默认每 6 小时自动同步一次（通过 Chrome Alarms API）
- 也可以在 Options 页面手动触发同步
- 远程工作流标记为 `source: "remote"`，用户手动添加的标记为 `source: "user"`

::: tip 提示
你可以搭建自己的 Manifest 服务，集中管理和分发工作流给团队使用。
:::
