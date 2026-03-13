# Configuration

## LLM Configuration

Mole is compatible with any OpenAI API-format LLM service. Configuration is available in the extension's **Options page** (right-click extension icon > Options).

### Settings

| Setting | Description | Default |
|---------|-------------|---------|
| API Endpoint | LLM service API URL | `https://api.openai.com/v1` |
| API Key | Your API key | - |
| Model | Model name to use | `gpt-4o-mini` |

Settings are stored in `chrome.storage.local` under the key `mole_ai_settings`.

### Supported Models / Services

Mole theoretically supports any service that provides an OpenAI-compatible API:

| Service | Endpoint Example | Notes |
|---------|------------------|-------|
| OpenAI | `https://api.openai.com/v1` | Official service |
| Azure OpenAI | `https://{resource}.openai.azure.com/openai/deployments/{model}/v1` | Azure hosted |
| Proxy services | Provider-specific endpoints | OpenAI-format compatible proxy services |
| Ollama | `http://localhost:11434/v1` | Local deployment |
| LM Studio | `http://localhost:1234/v1` | Local deployment |

::: warning Note
Mole relies on the LLM's **Function Calling (tool use)** capability. Make sure the model you're using supports this feature — otherwise the AI can only have plain text conversations and cannot perform browser operations.
:::

## Workflow Management

Manage site workflows from the Options page:

- **View** — Browse the installed workflow list (built-in + user-defined + remote-synced)
- **Add** — Paste JSON definitions to add custom workflows
- **Delete** — Remove user-defined or remote-synced workflows (built-in workflows cannot be deleted)
- **Enable/Disable** — Control whether workflows are visible to the AI
- **Manifest Source Management** — Add/remove remote Manifest URLs, manually trigger sync

## Dynamic Tools

In addition to built-in tools and site workflows, MoleClaw also supports **Dynamic Tools** — custom tools invoked via HTTP remote calls.

### Dynamic Tool Configuration

Each dynamic tool requires the following configuration:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Tool name (lowercase letters, numbers, underscores) |
| `description` | string | Yes | Tool description (AI uses this to decide whether to call it) |
| `parameters` | object | Yes | Parameter definitions in JSON Schema format |
| `endpoint` | string | Yes | HTTP endpoint URL |
| `method` | string | No | HTTP method (default: `POST`) |
| `headers` | object | No | Custom request headers |
| `timeoutMs` | number | No | Timeout in ms (default: 15s, max: 60s) |
| `enabled` | boolean | No | Whether enabled (default: `true`) |

Dynamic tools also support batch import via Manifest URL.

## Keyboard Shortcuts

| Shortcut | Function |
|----------|----------|
| `Cmd+E` / `Ctrl+E` | Toggle AI search box |

::: tip
Keyboard shortcuts work on all webpages. If there's a conflict with a page's own shortcuts, use the floating ball to open instead.
:::
