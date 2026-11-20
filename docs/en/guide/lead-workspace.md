# Sales Lead Workspace

Options opens at `#/workspace`. Session links use `#/workspace/<sessionId>`; the side panel can open the workspace with its current session selected.

Prospecting delivers a traceable lead table by default. CRM is one optional recording destination. It does not provide company or contact lookup and is not a required step in a prospecting task. Use it only when the user requests that destination. The current integration supports a company-specific Mantis CRM; other destinations can be added later.

## Using the workspace

1. Configure a model, then open and sign in to the platforms you need from the channels page.
2. Describe the industry, region, quantity, and qualification criteria. Platform jobs save results in batches and remain managed by the background after Options closes.
3. Inspect fields, raw evidence, collection steps, qualification decisions, and criteria versions in the lead library. Platform accounts and company identities remain separate; identity candidates can be confirmed with supporting evidence.
4. Export a task or the full library as CSV. Columns include qualification, criteria version, legal representative, business phone, source, and evidence IDs. Unconfirmed leads are included; use the qualification column to filter them.
5. To record leads in Mantis CRM, bind the target company, account, and field configuration, supply the runtime verification parameter, and state the destination in the conversation. Only company leads qualified under current criteria in the same session can be submitted. CRM configuration is unnecessary when this destination is not used.

The workspace shares user bubbles and execution groups with the existing conversation UI and uses its Markdown renderer. Consecutive tool calls are collapsed by default. Messages scroll within their own area above the fixed composer; reading older messages does not force a jump to the bottom, and loading older history preserves the reading position.

## Persistence and recovery

- IndexedDB `mole_workspace` stores complete session archives, tasks, evidence, facts, assessments, identity links, recording receipts, and commands. Chrome Storage retains settings and legacy compatibility caches.
- Each batch commits evidence, leads, facts, task links, steps, and its cursor in one transaction. Failed writes do not advance the cursor. Stable source IDs deduplicate leads; execution generations reject stale results.
- Inputs are saved before model execution is queued. Model orchestration runs serially; starting another session does not cancel the previous one. Added instructions reach the selected session on a subsequent round.
- A background restart resumes authorized read-only platform jobs. Interrupted model turns can be continued from saved state. A raw tool response that was never saved is not presented as a completed job.
- Company and contact queries blocked by the obsolete CRM login requirement are queued again. User pauses, cancellations, and provider login waits remain unchanged.
- Douyin login or verification completion wakes the matching task after checking its execution generation and tab. Paused or cancelled tasks remain stopped. Other providers use the task's Continue action after login is resolved.
- Questions and approvals are saved by request ID and survive page refreshes. A background restart marks old pending interactions as interrupted; continuing the session establishes new interactions.
- CRM recording saves the target identity, field snapshot, and user intent before sending. Lost receipts become `unknown` and require manual reconciliation or a late receipt before proceeding. Confirmed success, duplicate, or failure receipts are not overwritten by a late unknown result.
- Storage failures stop execution that depends on persistence. Resolve the storage issue and reload the extension to recover from committed checkpoints.

## Current limits

- Douyin collection uses the current authenticated pagination API, supports targets of 1–999 accounts, waits at least ten seconds between batches, and recognizes both enterprise verification fields. The legacy foreground scrolling fallback has not been added.
- Lixiaoyun and Riskbird return the first ten company candidates; additional matches produce a partial result. Company and contact queries depend only on their respective provider sessions, independently of CRM.
- Enterprise certification identifies candidates, not proven business fit. Business activity, region, company identity, and qualification require evidence. A business phone is not automatically treated as the legal representative's personal phone.
- Legacy sessions containing only summaries or truncated caches are marked `legacy_partial`; previously unsaved conversation content cannot be reconstructed.
- Full JSON backups preserve business relationships. Import fills missing record IDs without replacing local records and pauses imported tasks. Backup generation currently holds the package in memory; imports are limited to 64 MB. Streaming backups are not implemented. Verification parameters are excluded.
- Stable IDs, versions, event sequences, and metadata leave room for server synchronization; synchronization itself is not implemented.
- Automated tests use IndexedDB and browser API fixtures. Live provider login, verification, and CRM behavior still require integration checks. The project owner reviews the UI.

## Validation

```bash
npm test
npm run build
npx tsc -p tsconfig.app.json --noEmit
```

Compare TypeScript diagnostics against the existing baseline; a successful Vite build does not imply a clean project type check. Reliability tests cover transaction rollback, long history pagination, stale execution generations, pause and recovery, storage failures, field provenance, criteria invalidation, CRM receipts, and frozen field snapshots.
