# 快速开始

## 安装

MoleClaw 目前通过源码构建安装。

### 1. 克隆仓库

```bash
git clone https://github.com/clark-maybe/mole-extension.git
cd mole-extension
```

### 2. 安装依赖

```bash
npm install
```

### 3. 构建扩展

```bash
npm run build
```

构建产物输出到 `build_version/mole-extension_1.0.0/` 目录。

### 4. 加载到 Chrome

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启右上角的 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择 `build_version/mole-extension_1.0.0/` 目录
5. 扩展安装完成，图标出现在浏览器工具栏

## 首次使用

### 配置 LLM

Mole 需要连接一个 OpenAI API 兼容的 LLM 服务。首次使用前需要完成配置：

1. 点击浏览器工具栏的 Mole 图标，打开弹窗
2. 进入 **Options 页面**（右键扩展图标 > 选项）
3. 填写以下配置：
   - **API Endpoint** - LLM 服务地址（默认 `https://api.openai.com/v1`）
   - **API Key** - 你的 API 密钥
   - **Model** - 使用的模型名称（如 `gpt-4o-mini`、`gpt-4o` 等）
4. 点击保存

::: tip 提示
Mole 兼容任何 OpenAI API 格式的服务，包括但不限于：OpenAI、Azure OpenAI、Claude（通过兼容层）、本地部署的 Ollama 等。
:::

### 唤起 AI 助手
配置完成后，访问任意网页：

- **快捷键**：按 `Cmd+E`（Mac）或 `Ctrl+E`（Windows/Linux）唤起搜索框
- **悬浮球**：页面右侧会出现一个贴边的悬浮球，hover 滑出，点击即可唤起

## 基本交互

1. 通过快捷键或悬浮球唤起搜索框
2. 输入自然语言指令，例如：
   - "帮我截个图"
   - "这个页面讲了什么"
   - "在京东搜索 iPhone 16"
   - "帮我把这个页面的表格数据提取出来"
3. AI 会自动选择合适的工具执行任务
4. 执行过程中会显示工具调用状态，最终以流式方式返回结果

::: info 任务分级
Mole 会根据请求的复杂度自动分级处理：
- **直接回答** - 简单问答，不调用工具
- **单步操作** - 一个工具即可完成
- **多步任务** - 需要多个工具协作
- **复合任务** - 拆分为独立子任务并行执行
:::
