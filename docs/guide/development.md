# Development Guide

## Project Architecture

MoleClaw is a Chrome Extension MV3 project with three main components:

### Popup

A minimal React-based popup UI displaying basic extension information.

- Entry: `src/main.tsx`
- Build config: `vite.config.popup.ts`

### Content Script

Injected into all webpages, responsible for:

- Floating ball UI (Shadow DOM isolated)
- Page semantic snapshots and element targeting
- Page action execution (click, fill, scroll, etc.)
- Search engine result parsing
- Form workflow execution

- Entry: `src/content.ts`
- Build config: `vite.config.content.ts`

### Background (Service Worker)

The extension's central hub, responsible for:

- AI orchestrator (Agentic Loop)
- LLM API calls
- MCP tool registration and dispatch
- Cross-component communication hub (Channel)
- Scheduled task dispatch
- Session history management

- Entry: `src/background.ts`
- Build config: `vite.config.background.ts`

### Options Page

The extension's configuration interface, including:

- LLM settings (Endpoint, API Key, Model)
- Workflow management (create/edit/delete/import/export)
- Session history viewer

- Entry: `src/options.tsx`

## Directory Structure

```
src/
├── ai/                    # AI core
│   ├── orchestrator.ts    # Agentic Loop orchestrator
│   ├── llm-client.ts      # LLM API client
│   ├── system-prompt.ts   # System prompts
│   ├── context-manager.ts # Context compression manager
│   ├── tool-executor.ts   # Tool executor
│   └── types.ts           # AI type definitions
├── content/               # Content Script modules
│   ├── float-ball.ts      # Floating ball UI
│   ├── page-grounding.ts  # Page semantic snapshots
│   ├── action-executor.ts # Action executor
│   ├── search-parser.ts   # Search engine parser
│   ├── page-parser.ts     # Web page content parser
│   └── form-workflow.ts   # Form workflow
├── functions/             # Tool functions (37+ built-in tools)
│   ├── registry.ts        # Tool registry (built-in + dynamic)
│   ├── types.ts           # Tool type definitions
│   ├── cdp-input.ts       # CDP trusted input events
│   ├── cdp-dialog.ts      # CDP dialog handling
│   ├── cdp-frame.ts       # CDP iframe piercing
│   ├── cdp-network.ts     # CDP network monitoring + Cookies
│   ├── cdp-emulation.ts   # CDP device/environment emulation
│   ├── cdp-console.ts     # CDP console capture
│   ├── cdp-fetch.ts       # CDP request interception
│   ├── cdp-dom.ts         # CDP cross-origin DOM operations
│   ├── cdp-storage.ts     # CDP page storage operations
│   ├── cdp-css.ts         # CDP CSS style operations
│   ├── cdp-overlay.ts     # CDP visual highlighting
│   ├── site-workflow.ts   # Site workflow entry
│   ├── site-workflow-registry.ts  # Workflow registry
│   └── *.ts               # Other tool implementations
├── mcp/                   # MCP protocol implementation
│   ├── server.ts          # MCP Server
│   ├── client.ts          # MCP Client
│   ├── transport.ts       # In-memory transport layer
│   ├── adapters.ts        # OpenAI adapter
│   └── validator.ts       # Parameter validation
├── lib/                   # Core libraries
│   ├── channel.ts         # Cross-component communication
│   ├── storage.ts         # Chrome storage wrapper
│   ├── console.ts         # Log persistence
│   ├── artifact-store.ts  # Large result storage
│   ├── cdp-session.ts     # CDP session manager (debugger lifecycle + domain events)
│   ├── timer-store.ts     # Timer persistence
│   └── timer-scheduler.ts # Timer scheduling
├── options/               # Options page
├── session-history/       # Session history
├── config/                # Configuration
├── types/                 # Global types
└── utils/                 # Utilities
```

## Local Development

### Requirements

- Node.js 18+
- npm 9+
- Chrome browser

### Development Flow

```bash
# 1. Clone and install
git clone https://github.com/clark-maybe/mole-extension.git
cd mole-extension
npm install

# 2. Build the extension
npm run build

# 3. Load into Chrome
# Open chrome://extensions/ → Developer mode → Load unpacked → Select build directory

# 4. Watch mode development
npm run dev
```

### Build Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Build all components (popup + content + background) |
| `npm run build:popup` | Build popup only |
| `npm run build:content` | Build content script only |
| `npm run build:background` | Build background service only |
| `npm run dev` | Watch mode build |
| `npm run lint` | ESLint code check |

### Debugging Tips

- **Content Script**: Open DevTools (F12) on the target page, view logs in the Console
- **Background**: Click the "Service Worker" link on `chrome://extensions/`
- **Popup**: Right-click the extension icon → Inspect popup
- Use `_console.log()` instead of `console.log()` — logs are persisted and exportable

## Extending Tool Functions

### Steps to Add a New Tool

1. **Create the tool file**

Create a new file under `src/functions/`, exporting a `FunctionDefinition`:

```typescript
import type { FunctionDefinition, FunctionResult } from './types'

export const myTool: FunctionDefinition = {
  name: 'my_tool',
  description: 'Tool description (AI uses this to decide when to call it)',
  supportsParallel: true,  // Whether it supports parallel invocation
  parameters: {
    type: 'object',
    properties: {
      param1: {
        type: 'string',
        description: 'Parameter description',
      },
    },
    required: ['param1'],
  },
  async execute(args: Record<string, unknown>): Promise<FunctionResult> {
    // Implementation logic
    return { success: true, data: 'result' }
  },
}
```

2. **Register in the Registry**

Import and register in `src/functions/registry.ts`:

```typescript
import { myTool } from './my-tool'
// Add to the registration area:
mcpServer.registerTool(myTool)
```

3. **Add icon and label** (required)

Add to `src/content/float-ball.ts`:

```typescript
// Add SVG icon in FUNCTION_ICONS
my_tool: '<svg>...</svg>',

// Add display name in FUNCTION_LABELS
my_tool: 'My Tool',
```

## MCP Protocol

MoleClaw includes a complete MCP (Model Context Protocol) implementation — all tools are registered and invoked through MCP.

### Architecture

```
orchestrator.ts
    ↓ calls
mcp/client.ts (MCP Client)
    ↓ via InMemoryTransport
mcp/server.ts (MCP Server)
    ↓ dispatches
functions/registry.ts → specific tools
```

### Key Modules

- **MCP Server** — Manages tool registration, handles `tools/list` and `tools/call` requests
- **MCP Client** — Called by the orchestrator, provides `listTools()` and `callTool()` methods
- **MCP Transport** — In-memory transport layer (InMemoryTransport); Server and Client communicate within the same process
- **MCP Adapters** — Converts MCP tool definitions to OpenAI ToolSchema format

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Write code and test
4. Ensure lint passes: `npm run lint`
5. Commit: `git commit -m "feat(scope): description"`
6. Push and create a Pull Request

### Commit Message Format

```
type(scope): description
```

- **type**: `feat` (feature), `fix` (bugfix), `docs` (documentation), `refactor`, `test`, `chore`
- **scope**: module name, e.g., `ai`, `tools`, `content`, `mcp`
