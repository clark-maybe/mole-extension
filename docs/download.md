---
layout: doc
sidebar: false
title: 下载
---

<script setup>
import { data as release } from './release.data'
</script>

# 下载

获取最新版本的 MoleClaw，无需任何构建工具，下载即可使用。

<ReleaseInfo :release="release" lang="zh" />

## 安装指南

按以下步骤将 MoleClaw 安装到你的 Chrome 浏览器。

### 第 1 步：下载扩展

点击上方的 **下载最新版本** 按钮，将 `.zip` 文件保存到本地。

### 第 2 步：解压

解压下载的 zip 文件，得到一个名为 `mole-extension/` 的文件夹。

::: tip 提示
macOS 双击 zip 文件即可解压。Windows 右键 → "全部解压缩"。
:::

### 第 3 步：打开 Chrome 扩展页面

打开 Chrome 浏览器，在地址栏输入：

```
chrome://extensions/
```

### 第 4 步：开启开发者模式

找到页面 **右上角** 的 **"开发者模式"** 开关，将其打开。

### 第 5 步：加载扩展

1. 点击左上角出现的 **"加载已解压的扩展程序"** 按钮
2. 在文件选择对话框中，找到并选择 **解压后的文件夹**（如 `mole-extension/`）
3. 点击 **"选择文件夹"**（Windows）或 **"打开"**（macOS）

### 第 6 步：确认安装

加载成功后，MoleClaw 会出现在扩展列表中。将它固定到工具栏：

1. 点击 Chrome 工具栏的 **拼图图标**（扩展程序）
2. 在列表中找到 **Mole**
3. 点击 **固定图标** 使其始终显示在工具栏

### 第 7 步：配置 LLM

MoleClaw 需要连接一个 OpenAI 兼容的 LLM 服务才能工作，首次使用前请完成配置：

1. **右键** 工具栏的 MoleClaw 图标 → 选择 **"选项"**
2. 填写以下信息：
   - **API Endpoint** — LLM 服务地址（如 `https://api.openai.com/v1`）
   - **API Key** — 你的 API 密钥
   - **Model** — 模型名称（如 `gpt-4o-mini`、`gpt-4o`）
3. 点击 **保存**

::: info 兼容服务
MoleClaw 兼容任何 OpenAI API 格式的服务：OpenAI、Azure OpenAI、Claude（通过兼容层）、Ollama 等。
:::

更多配置细节请参阅 [快速开始](/guide/getting-started)。

### 第 8 步：开始使用！

访问任意网页，按 **`Cmd+M`**（Mac）或 **`Ctrl+M`**（Windows/Linux）唤起 AI 助手。也可以将鼠标悬停在页面右侧的悬浮球上。

---

## 更新版本

升级到新版本的步骤：

1. 从本页面下载最新 zip 包
2. 解压到一个 **新文件夹**
3. 打开 `chrome://extensions/`，找到 Mole，点击 **移除**
4. 重新点击 **"加载已解压的扩展程序"**，选择新文件夹

::: tip 提示
你的设置（API Key、模型配置等）保存在 Chrome 中，卸载重装后会自动保留。
:::

## 从源码构建

想要自行构建？请参阅 [快速开始 - 安装](/guide/getting-started#安装)。
