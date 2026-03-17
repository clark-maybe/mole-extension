# Site Workflows

## Overview

Site Workflows are MoleClaw's declarative automation system. Define a series of steps in JSON format to automate website operations without writing code.

Core principle: **Extension = interpreter engine, Manifest = content distribution**. No workflow definitions are hardcoded in the source code — all workflows are distributed and synced via Manifest files.

## Built-in Workflows

MoleClaw comes with the following predefined workflows:

| Workflow | Description | URL Match |
|----------|-------------|-----------|
| JD Product Search | Search products on JD.com, returns product card list | All pages |
| Baidu Search | Search keywords on Baidu, returns search result list | All pages |
| Boss Zhipin Message Reply | Operate chats, collect messages, auto-reply on Boss Zhipin | `*.zhipin.com` |
| Taobao Product Search | Search products on Taobao, returns product list | All pages |
| Taobao Product Details | Collect structured data from Taobao/Tmall product detail pages | All pages |
| Toutiao Hot List | Collect the Top 100 trending news from Toutiao Hot List | All pages |

## Workflow Structure

Each workflow is a JSON object with the following fields:

```json
{
  "name": "workflow_name",
  "label": "Display Label",
  "description": "Workflow description — AI uses this to decide when to invoke it",
  "url_patterns": ["*://*.example.com/*"],
  "version": 1,
  "enabled": true,
  "parameters": {
    "type": "object",
    "properties": {
      "keyword": {
        "type": "string",
        "description": "Search keyword"
      }
    },
    "required": ["keyword"]
  },
  "plan": {
    "version": 1,
    "steps": [
      {
        "action": "tab_navigate",
        "note": "Navigate to the target page",
        "params": {
          "action": "navigate",
          "url": "https://example.com/search?q={{keyword}}"
        },
        "saveAs": "nav_result"
      },
      {
        "action": "cdp_input",
        "note": "Wait for results to load",
        "params": {
          "action": "wait_for_element",
          "selector": ".results",
          "timeout_ms": 10000
        }
      },
      {
        "action": "cdp_dom",
        "note": "Collect result data",
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

### Key Fields

- **`url_patterns`** — URL matching rules using wildcard syntax; determines which pages the workflow is available on
- **`parameters`** — Parameter definitions in JSON Schema format, passed by the AI when invoking
- **`plan.steps`** — Array of steps, each calling a built-in tool
- **`plan.steps[].action`** — Name of the tool to call
- **`plan.steps[].params`** — Tool parameters, supports `{{variable}}` template syntax
- **`plan.steps[].saveAs`** — Store the step result as a variable for subsequent steps to reference
- **`plan.steps[].when`** — Conditional execution; step is skipped when the value is falsy
- **`plan.steps[].retry`** — Retry configuration (`maxAttempts`, `delayMs`, `backoffFactor`)
- **`plan.steps[].onError`** — Error handling strategy (`"continue"` to skip and proceed)
- **`plan.resultPath`** — Path to extract the final result from
- **`plan.closeOpenedTabs`** — Whether to close newly opened tabs after completion (`"on_success"`)

## Recording Workflows

The easiest way to create a custom workflow is to **record it** directly in the floating ball. Instead of writing JSON by hand, just demonstrate the operation and let AI generate the workflow for you.

### Steps

1. Open the floating ball search box (`Cmd+M` / `Ctrl+M`)
2. Click the **"Record Workflow"** button in the footer area
3. Perform the operation on the page (click, type, navigate, etc.)
4. Click **"Stop"** when done
5. Optionally click on the result element, or click **"Skip"** for full-page snapshot mode
6. Wait for AI to process — it will clean up the recording, remove noise, identify parameters, and generate a standard workflow
7. The workflow is saved automatically and can be invoked by AI in future conversations

::: tip
Recorded workflows are marked with `source: "user"` and stored alongside manually added and remote-synced workflows. You can manage them from the Options page.
:::

## Custom Workflows

### Via the Options Page

1. Right-click the Mole extension icon and select **Options**
2. In the workflow management area, click **Add Workflow**
3. Paste the workflow JSON definition
4. Save — takes effect immediately

### Via Remote Manifest Sync

MoleClaw supports syncing workflow Manifests from remote URLs.

#### Manifest Format

```json
{
  "version": 2,
  "updatedAt": "2025-01-01T00:00:00Z",
  "workflows": [
    { /* workflow definition */ },
    { /* workflow definition */ }
  ]
}
```

#### Sync Mechanism

- Supports configuring multiple Manifest sources
- Auto-syncs every 6 hours by default (via Chrome Alarms API)
- Can also be manually triggered from the Options page
- Remote workflows are tagged as `source: "remote"`, user-added ones as `source: "user"`

::: tip
You can host your own Manifest service to centrally manage and distribute workflows to your team.
:::
