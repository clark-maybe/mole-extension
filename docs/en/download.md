---
layout: doc
sidebar: false
title: Download
---

<script setup>
import { data as release } from '../release.data'
</script>

# Download

Get the latest version of MoleClaw and start using it right away — no build tools required.

<ReleaseInfo :release="release" />

## Installation Guide

Follow these steps to install MoleClaw in your Chrome browser.

### Step 1: Download the Extension

Click the **Download Latest** button above to save the `.zip` file to your computer.

### Step 2: Unzip

Extract the downloaded zip file. After extraction you'll get a folder named `mole-extension/`.

::: tip
On macOS, double-click the zip file to extract. On Windows, right-click → "Extract All".
:::

### Step 3: Open Chrome Extensions Page

Open Chrome and enter the following in the address bar:

```
chrome://extensions/
```

### Step 4: Enable Developer Mode

Find the **Developer mode** toggle in the **top-right corner** of the page and turn it on.

### Step 5: Load the Extension

1. Click the **"Load unpacked"** button that appears in the top-left area
2. In the file dialog, navigate to and select the **unzipped folder** (`mole-extension/`)
3. Click **"Select Folder"** (Windows) or **"Open"** (macOS)

### Step 6: Verify Installation

After loading, MoleClaw should appear in your extensions list. To pin it to the toolbar:

1. Click the **puzzle piece icon** (Extensions) in the Chrome toolbar
2. Find **Mole** in the list
3. Click the **pin icon** to keep it visible

### Step 7: Configure Your LLM

MoleClaw needs an OpenAI-compatible LLM service to work. Set it up before first use:

1. **Right-click** the MoleClaw icon in the toolbar → select **"Options"**
2. Fill in the following:
   - **API Endpoint** — LLM service URL (e.g., `https://api.openai.com/v1`)
   - **API Key** — Your API key
   - **Model** — Model name (e.g., `gpt-4o-mini`, `gpt-4o`)
3. Click **Save**

::: info Compatible Services
MoleClaw works with any OpenAI API-compatible service: OpenAI, Azure OpenAI, Claude (via compatibility layer), Ollama, and more.
:::

For more details, see the [Getting Started Guide](/en/guide/getting-started).

### Step 8: Start Using!

Visit any webpage and press **`Cmd+M`** (Mac) or **`Ctrl+M`** (Windows/Linux) to summon the AI assistant. You can also hover over the floating ball on the right side of the page.

---

## Updating

To update MoleClaw to a new version:

1. Download the latest zip from this page
2. Unzip to a **new folder**
3. Go to `chrome://extensions/`, find Mole, and click **Remove**
4. Click **"Load unpacked"** again and select the new folder

::: tip
Your settings (API key, model config) are stored in Chrome and will persist across reinstalls.
:::

## Build from Source

Prefer to build from source? See the [Development Guide](/en/guide/getting-started#installation).
