# Architecture

This page covers the technical architecture behind Mole. For user-facing features, see [Tips & Tricks](/guide/tips).

## Agentic Loop Architecture

At Mole's core is a minimal Agentic Loop, with this design philosophy:

> **Code handles mechanics and boundaries (guarantees the floor), the model handles decisions and strategy (determines the ceiling)**

### Core Loop

```
Sample → Has tool calls → Execute → Write back → Continue sampling
         No tool calls  → Finish
```

### Code is Responsible For (Mechanics + Boundaries)

- Sample → Execute → Write-back loop
- Budget enforcement (turn limits, call count limits, context length limits)
- Infinite loop detection (same tool + params repeated N times → auto-terminate)
- Empty response retry
- Auto context compression when too long
- Subtask recursion entry point

### Model is Responsible For (Decisions + Strategy)

- Intent classification / tool selection / task decomposition
- Verification strategy / when to stop / response wording

## Task Levels

Mole classifies tasks into four levels by complexity, determined autonomously by the model:

### Level 1: Direct Answer

Greetings, casual chat, knowledge Q&A — answered directly with text, no tools called.

### Level 2: Single-Step Operation

One clear small goal (search, click, screenshot, query) — calls the most suitable tool, replies after getting results.

### Level 3: Multi-Step Task

Goals requiring 2+ steps. Each step decides the next based on the actual result of the previous step, rather than planning all steps upfront.

### Level 4: Compound Task

Contains multiple relatively independent sub-goals. Uses `spawn_subtask` to split each independent sub-goal into an isolated task with its own context, preventing information cross-contamination.

## Multi-Tab Orchestration

Mole can operate across multiple browser tabs within a single task — for example, searching on one page, extracting data, and filling a form on another.

### How It Works

All page-operating tools support an optional `tab_id` parameter. The AI follows this flow:

1. **Open a new tab** — `tab_navigate(action='open', url='...')` returns the new tab's `tab_id`
2. **Operate on the target tab** — Pass `tab_id` to any tool: `page_snapshot(tab_id=123)`, `cdp_input(tab_id=123, ...)`, `extract_data(tab_id=123, ...)`
3. **Clean up** — `tab_navigate(action='close', tab_id=123)` when done

### Key Rules

- **element_id is tab-private** — An element ID obtained from Tab A cannot be used on Tab B. Always call `page_snapshot` on the target tab first.
- **Default behavior unchanged** — When `tab_id` is omitted, tools operate on the tab where the user started the conversation, exactly as before.
- **List open tabs** — `tab_navigate(action='list')` shows all tabs with their IDs.

## Deep CDP Control

Mole connects to 10 Chrome DevTools Protocol (CDP) domains, providing browser-process-level deep control that overcomes Content Script limitations:

- **Trusted event injection** — Sends `isTrusted=true` mouse/keyboard events, bypassing anti-bot event source detection
- **Dialog handling** — Automatically detects and handles alert/confirm/prompt dialogs, preventing automation flow interruption
- **iframe piercing** — Execute JS and get text within cross-origin iframes, solving CAPTCHA and payment form scenarios
- **Network visibility** — Complete request/response data (including body and headers), plus Cookie read/write
- **Request interception** — Intercept requests to modify and continue, return mock responses, or simulate failures; supports auth header injection and CORS bypass
- **Deep DOM operations** — Query/modify DOM ignoring same-origin policy, get precise box model geometry
- **Page storage** — Cross-origin read/write of localStorage / sessionStorage without content scripts
- **CSS styles** — Get computed styles and matching rules, modify inline styles, dynamically inject CSS rules
- **Visual highlighting** — Highlight DOM elements or regions so users can see what the AI is operating on
- **Device emulation** — Simulate mobile viewports, override User-Agent, spoof geolocation and timezone
- **Console capture** — Automatically collect console output and uncaught exceptions to help diagnose page issues

All CDP tools share a unified session manager (`cdp-session.ts`) that automatically manages debugger attach/detach lifecycle and domain event listeners.

## Automatic Context Compression

When conversation context grows too long, Mole automatically compresses historical context while preserving key information, ensuring continued operation within the LLM's context window limits. This prevents long multi-step tasks from failing due to context overflow.

## Vision (Visual Understanding)

Mole has visual understanding capabilities. When the `screenshot` tool is called, the captured image is automatically injected into the LLM context as a multimodal input. The AI can then "see" the page content and make decisions based on visual information.

### Annotated Screenshots

Use `screenshot(annotate=true)` to get a screenshot with numbered interactive element markers:
- Every interactive element in the viewport is marked with a number (1, 2, 3...) and a red highlight box
- Returns a mapping table of number → element_id with tag and text info
- AI can visually identify the target element and use the corresponding element_id for precise operations
- Follows the **Look → Act → Check** protocol: observe the page first, act with confidence, verify critical results

**Limits:**
- Up to 15 screenshot images per task to control context size
- Images are automatically stripped during context compression, replaced with text placeholders
- Prefer `page_snapshot` / `page_skeleton` for structured data; use visual analysis as a supplement
- The floating ball is automatically hidden during screenshots to avoid obscuring page content
