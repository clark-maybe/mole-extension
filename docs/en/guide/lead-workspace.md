# Sales Lead Workspace

Options opens at `#/workspace`. Session links use `#/workspace/<sessionId>`; the side panel can open the workspace with its current session selected.

Prospecting delivers a traceable lead table by default. CRM is one optional recording destination. It does not provide company or contact lookup and is not a required step in a prospecting task. Use it only when the user requests that destination. The current integration supports a company-specific Mantis CRM; other destinations can be added later.

Lixiaoyun is currently the only enabled company information provider. Discover active businesses on Douyin or other content platforms, verify recent posts, dates and business evidence, then establish the company name/identity before precise Lixiaoyun enrichment of its profile, legal representative and mobile. A user-supplied company name can go directly to enrichment. Riskbird entries and agent tools are disabled for now; existing data is retained.

## Using the workspace

1. Configure a model, then open and sign in to the platforms you need from the channels page.
2. Describe the industry, region, quantity, activity requirements, and qualification criteria. Discover and verify businesses on content platforms, establish their identities, then enrich them through Lixiaoyun. Platform jobs save results in batches and remain managed by the background after Options closes.
3. Open a lead dossier to view copyable phones/emails, the agent-written overview, business fit, and company registration details. Platform accounts and company identities remain separate; identity candidates can be confirmed with supporting evidence.
4. Export a task or the full library as CSV. Columns include business qualification, criteria version, legal representative, all contacts, agent summaries and follow-up suggestions, source, and evidence IDs. Leads with unevaluated business fit are included; filter by qualification as needed.
5. To record leads in Mantis CRM, bind the target company, account, and field configuration, supply the runtime verification parameter, and state the destination in the conversation. Only company leads qualified under current criteria in the same session can be submitted. CRM configuration is unnecessary when this destination is not used.

The workspace shares user bubbles and execution groups with the existing conversation UI and uses its Markdown renderer. Consecutive tool calls are collapsed by default. Messages scroll within their own area above the fixed composer; reading older messages does not force a jump to the bottom, and loading older history preserves the reading position.

Active sessions and sessions needing attention or paused are pinned separately, with filters for each group. Activity combines model and background job state: ending a model turn does not mark an ongoing collection as finished, and history pagination does not hide older active sessions. The current conversation has a live status banner, real job counts, and pause/resume controls. Green waveforms indicate execution, a dashed ring indicates queuing, and amber indicates attention. Reduced motion preferences disable animation.

## Dossiers and contacts

- Lixiaoyun contacts are trusted by default and ready for sales outreach, including legacy records. No second authenticity or owner verification is required. Retain source names and roles; a missing separate representative-mobile field does not invalidate other contacts.
- Details prioritize copyable phones and emails, followed by an overview, business fit, and readable registration fields. Copy an individual value or all contacts. Empty identity-link and recording sections are hidden.
- After enrichment, the agent uses `lead_workspace(action="save_profile")` to save an overview, business, region, observed activity, follow-up suggestion, and tags with evidence/fact references. The open dossier refreshes after persistence; no manual form entry is needed.
- Agent summaries remain separate from raw facts. Each save appends a revision; stale writes must re-read instead of silently overwriting. Details show the latest 30 revisions; complete backups retain all revisions.
- Raw fields, internal IDs, evidence, field records, and profile/assessment history are collapsed for tracing back to the source conversation. Contact trust and business qualification are independent; changed business criteria do not change contact trust.

## Persistence and recovery

- IndexedDB `mole_workspace` stores complete session archives, tasks, evidence, facts, assessments, identity links, recording receipts, and commands. Chrome Storage retains settings and legacy compatibility caches.
- Each batch commits evidence, leads, facts, task links, steps, and its cursor in one transaction. Failed writes do not advance the cursor. Stable source IDs deduplicate leads; execution generations reject stale results.
- A unique exact-name Lixiaoyun match saves its profile and a contact checkpoint before retrieving contacts automatically. Restarts resume contact retrieval without repeating the company query. Ambiguous names retain candidates for clarification. Provider contact names or explicit legal representative roles attribute a mobile to the separate `legalPersonPhone` field and evidence path; other numbers remain business contacts.
- Inputs are saved before model execution is queued. Model orchestration runs serially; starting another session does not cancel the previous one. Added instructions reach the selected session on a subsequent round.
- A background restart resumes authorized read-only platform jobs. Interrupted model turns can be continued from saved state. A raw tool response that was never saved is not presented as a completed job.
- Company and contact queries blocked by the obsolete CRM login requirement are queued again. User pauses, cancellations, and provider login waits remain unchanged.
- Douyin login or verification completion wakes the matching task after checking its execution generation and tab. Paused or cancelled tasks remain stopped. Other providers use the task's Continue action after login is resolved.
- Questions and approvals are saved by request ID and survive page refreshes. A background restart marks old pending interactions as interrupted; continuing the session establishes new interactions.
- CRM recording saves the target identity, field snapshot, and user intent before sending. Lost receipts become `unknown` and require manual reconciliation or a late receipt before proceeding. Confirmed success, duplicate, or failure receipts are not overwritten by a late unknown result.
- Storage failures stop execution that depends on persistence. Resolve the storage issue and reload the extension to recover from committed checkpoints.

## Current limits

- Douyin collection uses the current authenticated pagination API, supports targets of 1–999 accounts, waits at least ten seconds between batches, and recognizes both enterprise verification fields. The legacy foreground scrolling fallback has not been added.
- Lixiaoyun precisely enriches a known company name; it is not a broad industry/region discovery tool. Its matching window remains the first ten candidates. Non-unique matches remain partial until clarified. Queries use only Lixiaoyun login, independently of CRM. Legacy Riskbird jobs no longer send provider requests.
- Certification and search presence identify candidates, not proven recent activity or business fit. Activity dates, business activity, region, company identity, and qualification require evidence. Returned Lixiaoyun contacts remain usable with their original role labels, without additional owner checks. Missing business evidence only affects business-fit qualification.
- Legacy sessions containing only summaries or truncated caches are marked `legacy_partial`; previously unsaved conversation content cannot be reconstructed.
- Full JSON backups preserve business relationships. Import fills missing records and provenance links, preserves local current fields, dossiers and receipts, and pauses imported tasks. Backup generation currently holds the package in memory; imports are limited to 64 MB. Streaming backups are not implemented. Verification parameters are excluded.
- Stable IDs, versions, event sequences, and metadata leave room for server synchronization; synchronization itself is not implemented.
- Automated tests use IndexedDB and browser API fixtures. Live provider login, verification, and CRM behavior still require integration checks. The project owner reviews the UI.

## Validation

```bash
npm test
npm run build
npx tsc -p tsconfig.app.json --noEmit
```

Compare TypeScript diagnostics against the existing baseline; a successful Vite build does not imply a clean project type check. Reliability tests cover transaction rollback, long history pagination, stale execution generations, pause and recovery, storage failures, field provenance, criteria invalidation, CRM receipts, and frozen field snapshots.
