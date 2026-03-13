# Getting Started

## Installation

MoleClaw is currently installed by building from source.

### 1. Clone the Repository

```bash
git clone https://github.com/clark-maybe/mole-extension.git
cd mole-extension
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Build the Extension

```bash
npm run build
```

Build output goes to the `build_version/mole-extension_1.0.0/` directory.

### 4. Load into Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** in the top right corner
3. Click **Load unpacked**
4. Select the `build_version/mole-extension_1.0.0/` directory
5. The extension is installed — the icon appears in the browser toolbar

## First Use

### Configure Your LLM

Mole needs to connect to an OpenAI API-compatible LLM service. Complete the configuration before first use:

1. Click the Mole icon in the browser toolbar to open the popup
2. Go to the **Options page** (right-click the extension icon > Options)
3. Fill in the following settings:
   - **API Endpoint** — LLM service URL (default: `https://api.openai.com/v1`)
   - **API Key** — Your API key
   - **Model** — Model name to use (e.g., `gpt-4o-mini`, `gpt-4o`, etc.)
4. Click Save

::: tip
Mole is compatible with any OpenAI API-format service, including but not limited to: OpenAI, Azure OpenAI, Claude (via compatibility layer), locally deployed Ollama, etc.
:::

### Summon the AI Assistant

After configuration, visit any webpage:

- **Keyboard shortcut**: Press `Cmd+E` (Mac) or `Ctrl+E` (Windows/Linux) to summon the search box
- **Floating ball**: A capsule-shaped floating ball appears on the right side of the page — hover to slide out, click to open

## Basic Interaction

1. Summon the search box via shortcut or floating ball
2. Type natural language instructions, for example:
   - "Take a screenshot of this page"
   - "What is this page about"
   - "Search for iPhone 16 on Amazon"
   - "Extract the table data from this page"
3. The AI will automatically choose the right tools to execute the task
4. Tool call status is displayed during execution, and results stream back in real time

::: info Task Levels
Mole automatically classifies requests by complexity:
- **Direct answer** — Simple Q&A, no tools needed
- **Single-step** — One tool call is sufficient
- **Multi-step** — Multiple tools working together
- **Compound task** — Split into independent subtasks executed in parallel
:::
