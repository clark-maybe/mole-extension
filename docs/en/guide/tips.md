# Tips & Tricks

Get more out of Mole with these tips.

## Your Browser, Your Workspace

Mole is not a remote scraper or a simulated browser — it runs directly inside the Chrome you're already using.

This means **login session reuse**. Any website you're signed into — e-commerce, GitHub, Slack, internal admin panels — Mole can operate on directly. The website sees your real session, no extra authentication triggered.

### Where This Shines

- Managing orders on e-commerce sites you're already logged into
- Working with internal company tools and admin panels
- Organizing information on social media platforms
- Accessing member-only content
- Operating on banking and finance sites (sensitive actions always ask for your confirmation)

### Your Data Stays Safe

- All operations happen locally in your browser
- Your cookies and login credentials are never sent to any external service
- Irreversible actions (form submission, payment, deletion) always ask for your confirmation first

## The Floating Ball

Mole places a small floating ball on every webpage — your entry point to the AI assistant.

- **Keyboard shortcut** — `Cmd+M` (Mac) / `Ctrl+M` (Windows) to quickly open the search box
- **Drag to move** — Drag the floating ball anywhere on screen; your preferred position is remembered
- **Stays out of the way** — It hugs the screen edge and hides itself; hover to reveal
- **Real-time updates** — As Mole works, you see status updates streaming in real time

## Workflow Recorder

Don't want to repeat the same steps every day? Record them once, and Mole replays them for you.

### How It Works

1. **Start Recording** — Click the "Record Workflow" button at the bottom of the search box
2. **Do your thing** — Perform the task as you normally would. Mole watches silently in the background
3. **Mark the result** — After stopping, click on the element that represents the result (optional)
4. **Mole cleans it up** — The AI removes accidental clicks, merges keystrokes, and identifies parts that should be customizable (like search terms)
5. **Use it anytime** — The workflow is saved and ready. Next time, just ask "run my check-in workflow" or similar

Recording continues even if the page navigates — Mole tracks the whole flow.

## Screenshots and Visual Understanding

Mole can take screenshots and actually understand what's on screen. This is useful when:

- The page has charts, images, or Canvas content that can't be read as text
- You need to verify how something looks (layout, colors, positioning)
- There are many similar elements on the page and you need Mole to identify the right one visually

In annotated mode, Mole marks every clickable element with a number, making it easy to say "click element 3" with precision.

## Task Recovery

If something goes wrong mid-task — a network hiccup, the browser restarting, or an API timeout — Mole doesn't lose your progress.

You'll see a **Retry** button. Click it, and Mole picks up right where it left off, with full memory of what it already did. No need to start over.

## Safety Checks

Mole has built-in safety for sensitive actions:

- **Confirmation before action** — Before submitting a form, making a payment, or deleting anything, Mole pauses and asks "Are you sure?"
- **Questions when unsure** — If Mole encounters multiple options or needs information it doesn't have, it asks you directly with clear choices

You're always in control.

## Session History

Every conversation with Mole is saved. Open the Options page to browse past sessions, review what happened, and pick up where you left off.

## Pro Tips

- **Be specific** — "Search Amazon for wireless keyboards under $50" beats "find me a keyboard"
- **Reference what you see** — Mole can see your page. "Click the blue button" or "extract the table below" just works
- **Chain requests** — Ask follow-up questions in the same conversation for context-aware responses
- **Use workflows for repetition** — If you do something more than twice, record it as a workflow
- **Multiple tabs** — Mole can work across tabs. "Open Amazon, search for X, then come back here and fill in the price" is a valid request
