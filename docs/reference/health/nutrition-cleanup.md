# Nutrition cleanup

The nutrition auditor is a read-only reasoning agent. It proposes changes; the
application applies them through `NutritionRepairService`, never through a model
mutation tool. `NutritionEvidenceToolFactory` can be reused by other agents.

## User controls

Health → Settings (`/health/settings`) contains automatic-cleanup, preview-only,
and optional Telegram switches; Run now; recent scans; and repair history with
before/after values, evidence, and Undo. Automatic cleanup defaults **off** and
preview-only defaults **on**. Preview evaluates the real policy without changing
food or sending questions. Successful automatic repairs do not show notifications.

Questions appear in Today and Settings. Each choice displays its proposed changes;
free text and “Leave unchanged” are also supported. Free text is interpreted into a
single bounded proposal; an answer that needs further guessing is left for manual
editing. Telegram is an optional projection of the same question ID. Replies are
matched to that message, not to the latest conversation, and checked against its
private owner chat. Answering on either surface resolves the shared record; the
Telegram message is edited in place. There are no reminder messages. Long proposals
must be reviewed in Health instead of truncated Telegram choice buttons.

## Authority and evidence

- Read historical food, saved meals, original captures, barcode products and repair
  precedents without a date cutoff. History searches are paginated.
- Automatically write only today/yesterday, evaluated in the user's configured
  timezone **at commit time**, including delayed answers and restarted work.
- Names, food identification, meal/date categorization, available artwork and flat
  groups are eligible. New headers have zero additive nutrition; children retain
  their existing quantities/nutrition. Groups cannot cross captures/days/meals.
- Quantity, unit and nutrient changes require exact, serving-specific facts from
  trusted evidence tools. Habitual portions, a product's package size, and model
  confidence are not evidence of the amount consumed. The barcode tool reads the
  original `sourceUpc` and grants numeric authority only for a verified compatible
  serving basis without lookup warnings.
- No autonomous consumed-food deletion, invented consumption, or pending-capture
  confirmation. Cleanup shares the pending review/confirmation lock.
- Protect user-set fields and previously ratified rows. Automatically repaired
  fields cannot oscillate through successive cleanups; further changes require user
  direction. Label/name aliases share the same protection.
- Committed entries require expected row versions; pending captures require the
  complete capture version. Concurrent edits produce a skip/stale result.

Explicit user Undo can restore an **older** repair. It compares every affected
version (or the complete pending-capture version) and refuses conflicting later
edits or new group members. Confirming a pending capture is a later change: its
historical pending repair cannot overwrite the now-committed food.

## Execution and durability

`NutritionCleanup` runs one audit per user in the single household backend. The
existing scheduler checks revisions every 30 seconds; changes debounce for 60
seconds with a 120-second maximum. Enabled users get a startup reconciliation and
a daily sweep at/after local 03:00. Reference artwork is reloaded for a new scan.
The reasoning budget is 120 seconds / 20 tool calls. Failed transient runs retry
twice with backoff; failed inputs wait for changed data, a manual scan, or the next
scheduled reconciliation. Answer processing has the same three-attempt ceiling.
Development scheduling is disabled unless explicitly enabled, and the app's global
`enableScheduler` gate is respected.

Runs/checkpoints live in `data/agents/cleanup-runs.db`. Per-owner dispatch, settings
and questions live in `users/{user}/agents/nutrition-cleanup.yml`. Committed repair
receipts live alongside the nutrition ledger in `cleanup-audit.yml`; they commit in
the same recoverable ledger journal as the food and daily summary. Pending receipts
live in the capture's `metadata.cleanupAudit`, in the same atomic capture write.
Completed dispatch records discard duplicate full report payloads; the managed
workflow checkpoint and repair receipts remain durable. Transcripts use the existing
private agent transcript store. Do not publish these files: they contain food history
and user responses.

The existing nutrition surface synchronizer handles changed receipts and report
regeneration. Telegram failures do not gate food saves. A Telegram send whose result
is uncertain is not retried automatically (Telegram has no idempotent send); the
question remains actionable in Health. Known message edits are retried.

This dispatcher assumes **one backend writer**. Do not start another household
backend or horizontally scale the YAML writer. SQLite workflow storage is not a
distributed lock around nutrition YAML.

## HTTP boundary

All paths below are under `/api/v1/health/nutrition/cleanup`. Owner identity is
resolved from Health's existing trusted household context, never a body `userId`.
These routes inherit the application's existing network/auth perimeter; they do
not add a new public authentication mechanism.

| Method/path | Contract |
|---|---|
| `GET /` | Settings, active questions, recent scan summaries |
| `GET /history?offset=0` | Paginated committed and pending repair receipts |
| `PATCH /settings` | `expectedVersion` and boolean `enabled`, `dryRun`, `telegram` |
| `POST /run` | Explicit one-off scan using the current preview setting; 202/runId |
| `POST /questions/:id/answer` | `expectedVersion`, `operationId`, one of `choiceId`, `text`, `dismiss` |
| `POST /undo/:id` | Explicit Undo with `operationId`; conflict-safe and idempotent |

Unavailable service returns 503; changed versions and expired questions do not
silently rewrite food. The generic agent registry exposes a read-only audit;
mutations remain behind Health's guarded cleanup service.
