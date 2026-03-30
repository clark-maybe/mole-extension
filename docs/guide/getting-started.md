# 快速开始

5 分钟内让 Mole 跑起来。

## 第一步：安装扩展

1. 打开[下载页面](/download)，下载最新版本
2. 解压下载的文件
3. 在 Chrome 中打开 `chrome://extensions/`
4. 开启右上角的**开发者模式**
5. 点击**加载已解压的扩展程序**，选择解压后的文件夹
6. 将 Mole 固定到工具栏，方便使用

::: tip 想从源码构建？
请参考[开发指南](/guide/development)了解如何从仓库构建。
:::

## 第二步：连接 AI 模型

Mole 需要一个 AI 服务来思考。配置一次就好。

1. 右键点击工具栏上的 Mole 图标，选择**选项**
2. 填写 AI 服务信息：
   - **API Endpoint** — 如 `https://api.openai.com/v1`
   - **API Key** — 你的 API 密钥
   - **Model** — 如 `gpt-4o-mini` 或 `gpt-4o`
3. 点击**保存**

::: details 支持哪些 AI 服务？
任何支持 OpenAI API 格式且支持 **Function Calling**（工具调用）的服务：

- **OpenAI** — `https://api.openai.com/v1`
- **Azure OpenAI** — 你的 Azure 端点
- **Claude** — 通过 OpenAI 兼容代理
- **Ollama**（本地）— `http://localhost:11434/v1`
- **LM Studio**（本地）— `http://localhost:1234/v1`
- 其他任何 OpenAI 兼容服务
:::

## 第三步：试一试

打开任意网页，按 `Cmd+M`（Mac）或 `Ctrl+M`（Windows）。

试着输入：
- 「这个页面讲了什么？」
- 「帮我截个图」
- 「在淘宝搜索 iPhone 16，给我前 5 个结果」

Mole 会在后台工作，然后把结果带回来。

## 接下来

- [第一个任务](/guide/first-task) — 手把手引导教程
- [Mole 能做什么？](/guide/examples) — 浏览使用场景和示例
- [工作流](/guide/workflows) — 教 Mole 重复执行任务
- [配置指南](/guide/configuration) — 高级设置
