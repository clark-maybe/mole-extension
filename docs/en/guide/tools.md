# Built-in Tools

MoleClaw includes 37+ built-in tools covering all aspects of browser automation. The AI automatically selects the most suitable tools based on your natural language instructions.

## Page Awareness

| Tool | Description |
|------|-------------|
| `page_viewer` | Get the current page's visible text content for understanding page information |
| `page_snapshot` | Take a structured snapshot of the page, supports query-based element targeting, returns element tree and element_id |
| `page_skeleton` | Extract page skeleton structure for a quick overview of the overall layout |
| `page_assert` | Assert whether the page state meets expectations, used for verification after critical operations |
| `page_repair` | When page_assert fails, attempt to automatically repair the page state |
| `screenshot` | Take page screenshots — supports visible area, full page, region, and element screenshots (CDP enhanced). `annotate=true` mode overlays numbered markers on interactive elements and returns an element_id mapping table for precise targeting |
| `selection_context` | Get the text selected by the user on the page along with its surrounding context |

## Page Operations

| Tool | Description |
|------|-------------|
| `cdp_input` | Page interaction operations via CDP (trusted events). Supports click, double click, right click, hover, drag, type, key press, scroll, fill, clear, select, click by text, scroll into view, focus, wait for element/text/navigation, get element info. Two targeting modes: element_id (from page_snapshot, preferred) and CSS selector. |
| `cdp_dom` | Cross-origin DOM operations via CDP: query elements, modify attributes, insert/remove nodes, read/write HTML, get precise box model, etc. |
| `cdp_frame` | Cross-iframe operations via CDP: list all page frames, execute JS in a specific frame (`expression` parameter), get iframe text snapshot. Solves cross-origin iframe issues |

## Navigation & Tabs

| Tool | Description |
|------|-------------|
| `tab_navigate` | Tab navigation: navigate URL in current tab, open new tab, close tab, etc. |
| `fetch_url` | Make HTTP requests in the background to fetch URL content without affecting the current page |

## Douyin User Search

`douyin_search_users` is available to the agent by default. For example: “Search Douyin for Wuhan restaurant accounts. Return 12 results with their bios and profile links.”

- Parameters: required `keyword`; optional `count` (default 12, range 1–20), `cursor` (0 for the first page), `search_id` (from the previous page), and `tab_id` (an existing Douyin tab). Reset pagination when changing keywords.
- Results: `items` contains string user IDs, handles, nicknames, original bios, verification text, follower/like counts and profile URLs. The response also includes `cursor`, `has_more`, `search_id`, a search source URL and the collection time.
- Reuses an existing Douyin tab or temporarily opens one in the background. Temporary tabs are cleaned up after success or ordinary failures; tabs requiring login or manual verification stay open for the user. Requests run in the page's main world using the current login session; no copied cookies, tokens or signatures are needed.
- Rejected queries (such as HTTP 401/403, a business rejection or an explicit login requirement) return `success: false`, `code: E_AUTH_REQUIRED` and `data.login_url`. The agent asks the user to log in, and the channel card shows a login action button. After the user completes login and page verification, the runtime checks the saved query and continues the task automatically. Network failures, timeouts and normal empty results are not automatically treated as missing login.
- When `#captcha_container` or a captcha iframe whose URL starts with `https://rmc.bytedance.com/verifycenter/captcha/` appears, the tool returns `E_VERIFICATION_REQUIRED`, `data.verification_required` and the original `data.tab_id`. It stops the current request and asks the user to complete verification manually. Detection covers the period before the request, while waiting, and while reading the response, including iframe `src` changes. It does not need access to the cross-origin iframe's contents. Monitoring continues after the query returns: a captcha shown later during login updates the page banner and the current conversation's verification card directly. Notifications are tied to the original tab and query, so an older query cannot overwrite a newer query or conversation turn. Once verification disappears and remains stable, the runtime checks the saved query and resumes on success. A failed check waits for a new signal instead of repeatedly searching.
- Login and verification use a shared channel card with the platform's brand icon, status and action button, which focuses the original tab when available. A dismissible persistent banner on Douyin explains the search keyword, task purpose and next steps. A successful query check clears the banner. The card shows waiting/checking status and provides a “Check and continue” fallback. If the original tab was closed, its action reopens Douyin and reconnects the saved query.
- Agent queries to the same channel are serialized and spaced. A blocked query preserves its keyword, cursor and search ID and returns `data.auto_resume: true`; independent work can continue. Waiting state, saved queries and recovered results persist across background restarts. Canceling, clearing or replacing the task stops automatic recovery.
- Data-pipeline buffers persist locally and can be appended to or exported after a background restart.
- Matches are candidate accounts; location, enterprise identity and customer fit require supporting evidence.

## Browser Capabilities

| Tool | Description |
|------|-------------|
| `clipboard_ops` | Clipboard operations: read and write clipboard content |
| `storage_kv` | Key-value storage: read/write data in the extension's local storage, supports cross-session persistence |
| `notification` | Send browser desktop notifications |
| `bookmark_ops` | Bookmark operations: search, create, delete bookmarks |
| `history_search` | Search browser history |
| `download_file` | Download files to local disk |

## Timers & Automation

| Tool | Description |
|------|-------------|
| `timer` | Unified timer management: set delayed tasks, recurring tasks, clear timers, and list active timers |
| `resident_runtime` | Resident runner: continuously run tasks in the background, suitable for long-term monitoring or periodic execution |

## Workflows & Tasks

| Tool | Description |
|------|-------------|
| `site_workflow` | Execute predefined site workflows, automatically matches available workflows based on the current page URL |
| `spawn_subtask` | Split independent sub-goals into isolated tasks, each with its own context |
| `request_confirmation` | Request user confirmation before performing sensitive or irreversible actions. The user sees the message and can approve or reject with an optional reason |
| `ask_user` | Ask the user a question to gather missing information or let them choose between options. Supports preset options and/or free text input |
| `save_workflow` | Save a user-confirmed workflow definition to the registry, used in the dialog-based recording confirmation flow |

## CDP Enhanced Tools <Badge type="tip" text="Chrome DevTools Protocol" />

Connected to Chrome DevTools Protocol via the `chrome.debugger` API, providing browser-process-level deep control. These tools are especially critical when regular Content Script approaches are limited (anti-bot detection, cross-origin iframes, network details, etc.).

### Input & Interaction

| Tool | Description |
|------|-------------|
| `cdp_input` | Send trusted mouse/keyboard events (`isTrusted=true`): click, double-click, right-click, hover, drag, type text, keypress, scroll. Bypasses anti-bot event source detection |
| `cdp_dialog` | Query and handle JavaScript dialogs (alert/confirm/prompt/beforeunload), supports manual handling and auto strategies |

### Pages & Frames

| Tool | Description |
|------|-------------|
| `cdp_frame` | Cross-iframe operations: list all page frames, execute JS in a specific frame, get iframe text snapshot. Solves cross-origin iframe issues (CAPTCHAs, payment forms, etc.) |

### Network & Cookies

| Tool | Description |
|------|-------------|
| `cdp_network` | CDP-enhanced network monitoring: complete request/response data (including body and headers), statistical summaries, and cross-origin Cookie read/write (get/set/delete) |

### Environment Emulation

| Tool | Description |
|------|-------------|
| `cdp_emulation` | Device and environment emulation: viewport size (mobile), User-Agent override, geolocation spoofing, language/timezone settings, network condition simulation (3G/offline, etc.) |

### Request Interception

| Tool | Description |
|------|-------------|
| `cdp_fetch` | Request interception and modification (Fetch domain): intercept page network requests to modify and continue, return custom responses (Mock API), or simulate failures. Useful for auth header injection, data mocking, and CORS bypass |

### Deep DOM Operations

| Tool | Description |
|------|-------------|
| `cdp_dom` | Cross-origin DOM operations (DOM domain): query/modify DOM nodes via CDP, ignoring same-origin policy. Supports CSS selector queries, HTML read/write, attribute operations, precise element box model (margin/border/padding/content), and node removal |

::: tip
Page storage operations (`storage_` prefix actions) and CSS style operations (`css_` prefix actions) are now integrated into `cdp_dom` as unified actions.
:::

### Visual Highlighting

| Tool | Description |
|------|-------------|
| `cdp_overlay` | Element highlighting (Overlay domain): highlight specified DOM nodes, elements matching CSS selectors, or rectangular regions with custom colors. Visually marks AI operation targets so users can observe what's being operated on |

### Debug & Diagnostics

| Tool | Description |
|------|-------------|
| `cdp_console` | Capture page console.log/warn/error output and uncaught JavaScript exceptions to help AI diagnose page issues |

::: warning Note
CDP tools require the `debugger` permission. A debugger notification bar will appear at the top of the browser during use — this is Chrome's security mechanism and is expected behavior.
:::

## Tool Selection Priority

When the AI needs to operate on a page, it selects tools in this priority order:

1. **`site_workflow`** — Preferred: use predefined workflows when available for the current page, fast and reliable
2. **`page_snapshot`** + `cdp_input(element_id=...)` — Snapshot to locate elements, then operate precisely by element_id
3. **`cdp_input(selector=...)`** — CSS selector-based operations when element_id is unavailable
4. **`cdp_dom`** — DOM read/write, CSS styles, and page storage operations

::: tip
You don't need to manually choose tools — just describe your needs in natural language, and the AI will automatically select the best tool combination for the task.
:::
