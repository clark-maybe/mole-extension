# Features

## Why "Mole"?

Mole works just like its namesake: after you ask a question, it burrows underground (into the background), silently digging through tunnel networks — calling tools, searching the web, parsing data. Once it finds the treasure, it surfaces and presents the results in the floating ball. The whole process never interrupts what you're doing.

> Surface = Floating ball (the entry point you see)
> Underground = Background (where the AI works)
> Tunnels = Channel + MCP (the communication network connecting everything)

## Floating Ball AI Chat

Mole injects a floating ball on every webpage as the entry point for AI interaction.

- **Shadow DOM isolation** — The floating ball's styles are fully isolated within Shadow DOM, never affecting or being affected by the host page's styles
- **Keyboard shortcut** — `Cmd+M` (Mac) / `Ctrl+M` (Windows) to quickly summon the search box
- **Drag to reposition** — The floating ball can be dragged anywhere on screen; position persists to `chrome.storage.local`
- **Edge-hugging** — Capsule shape hugs the screen edge, slides out on hover, never disrupts normal browsing
- **Streaming responses** — AI replies stream in real time, showing the thinking process and tool call status

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
2. **Operate on the target tab** — Pass `tab_id` to any tool: `page_snapshot(tab_id=123)`, `page_action(tab_id=123, ...)`, `extract_data(tab_id=123, ...)`
3. **Clean up** — `tab_navigate(action='close', tab_id=123)` when done

### Key Rules

- **element_id is tab-private** — An element ID obtained from Tab A cannot be used on Tab B. Always call `page_snapshot` on the target tab first.
- **Default behavior unchanged** — When `tab_id` is omitted, tools operate on the tab where the user started the conversation, exactly as before.
- **List open tabs** — `tab_navigate(action='list')` shows all tabs with their IDs.

### Example Scenarios

- "Open Hacker News, extract the top 5 headlines, and summarize them here"
- "Search for product X on site A, then fill in the price on site B's form"
- "Compare the pricing tables on these two URLs"

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

## Workflow Recorder

Mole supports a **"show once, learn forever"** workflow recording mode. Instead of manually writing JSON workflow definitions, you can simply demonstrate the operation on the page, and Mole will learn from your actions.

### How It Works

1. **Start Recording** — Click the "Record Workflow" button in the floating ball's search box footer
2. **Demonstrate** — Perform the operation on the page as you normally would. Mole captures clicks, text input, form submissions, and page navigations in the background
3. **Mark Results** — After stopping the recording, you can click on the page element that represents the operation result (e.g., a search result list), or skip this step for full-page snapshot mode
4. **AI Audit** — Mole sends the raw recorded steps to the AI, which:
   - Removes noise (accidental clicks, meaningless scrolls)
   - Merges fragmented actions (multiple keystrokes → one type action)
   - Identifies parameterizable inputs (marks them as `{{param_name}}`)
   - Generates assertions based on the result selector
   - Outputs a standard workflow plan
5. **Save & Reuse** — The generated workflow is automatically saved to the workflow registry, ready for use in future conversations

### Recording Indicators

- The capsule shows a red recording pulse with "Recording" text
- The search box footer displays the step count, recording duration, and a "Stop" button

### Cross-Navigation Support

Recording persists across page navigations within the same tab. If the page redirects during your demonstration, Mole automatically records the navigation step and continues capturing on the new page.

## Task Recovery

If a task is interrupted due to Service Worker restart, network error, or LLM API timeout, Mole saves the execution context as a checkpoint. When the failure occurs:

- The floating ball shows an error message with a **Retry** button
- Clicking "Retry" resumes execution from the last checkpoint — no need to start over
- The AI receives the full context of previous tool calls and results, and continues from where it left off

Recoverable error types include: Service Worker restart, LLM API errors, user cancellation, and tool execution failures.

## Human-in-the-Loop

Mole supports two types of human interaction during task execution:

- **Confirmation** (`request_confirmation`) — Before irreversible actions (form submission, payment, deletion), the AI pauses and asks for user approval
- **Question** (`ask_user`) — When the AI encounters multiple options or needs missing information, it presents a question card with preset options and/or a free text input field. The user's answer is fed back into the loop, and execution continues

## Automatic Context Compression

When conversation context grows too long, Mole automatically compresses historical context while preserving key information, ensuring continued operation within the LLM's context window limits. This prevents long multi-step tasks from failing due to context overflow.

## Session History

Mole supports session history — you can view and manage past conversations in the Options page. The complete process of each conversation (including tool calls and results) is saved.
