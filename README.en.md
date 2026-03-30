<p align="center">
  <img src="public/logo.png" width="128" height="128" alt="MoleClaw Logo">
</p>

<h1 align="center">MoleClaw</h1>

<p align="center">
  <strong>Your AI Treasure-Hunting Assistant — like a mole, digging up treasures across the internet for you.</strong>
</p>

<p align="center">
  <a href="./README.md">中文</a> | English
</p>

<p align="center">
  <a href="https://github.com/clark-maybe/mole-extension/blob/master/LICENSE">
    <img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License">
  </a>
</p>

---

After you ask a question, Mole dives underground like a real mole — silently calling tools, searching the web, parsing data, and gathering information across sites. Once it finds the treasure, it surfaces and presents the results to you. The whole process runs quietly in the background, never interrupting what you're doing.

## Features

- **AI-Native Chat** — Summon the floating ball anytime for natural language interaction with streaming responses
- **In-Place Execution** — Works inside your real browser, reusing your existing login sessions. No cookie migration, no re-login — operates directly on sites you're already signed into
- **36+ Built-in Tools** — Page operations, deep CDP control (10 domains), request interception, DOM/CSS/storage manipulation, navigation, screenshots, network diagnostics, human-in-the-loop confirmation...
- **Workflow Recorder** — Show Mole how to do it once, it learns and repeats. Record your browser actions, AI cleans them up, and generates a reusable workflow automatically
- **Site Workflows** — Declarative JSON definitions to automate website operations without writing code
- **Bring Your Own LLM** — Compatible with any OpenAI API-format service, full data sovereignty
- **MCP Protocol** — Standardized tool registration and invocation with dynamic extension support
- **Agentic Loop** — Codex-style autonomous loop: code handles boundaries, model handles decisions
- **Open Source** — AGPL-3.0 license, community-driven

## Quick Start

```bash
git clone https://github.com/clark-maybe/mole-extension.git
cd mole-extension
npm install
npm run build
```

After building, load the extension directory under `build_version/` in Chrome. See the [Getting Started Guide](https://moleclaw.site/guide/getting-started) for details.

## How It Works

```
You ask a question → Mole dives underground (AI enters background Agentic Loop)
                   → Digs through tunnel networks (Channel comms + MCP tool calls + multi-turn reasoning)
                   → Surfaces with treasure (results displayed in the floating ball)
```

MoleClaw runs on the three-layer Chrome Extension (MV3) architecture:

| Layer | Role | Mole Metaphor |
|-------|------|---------------|
| Content Script | Floating ball UI + page interaction | Surface — what you see |
| Background | AI orchestration + tool dispatch | Underground — where the mole works |
| Channel | Cross-layer messaging | Tunnel network — connecting surface and underground |

## Documentation

Visit the [MoleClaw Docs](https://moleclaw.site) for detailed usage and development guides.

## Development

```bash
npm run dev          # Dev mode (watch build)
npm run build        # Build all components
npm run lint         # Lint check
npm run docs:dev     # Local docs preview
```

## Acknowledgements

This project was initiated in the [linux.do](https://linux.do) community. Thanks to the community members for their feedback and support.

## License

[AGPL-3.0](LICENSE)
