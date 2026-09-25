# Nutrition auditor

The nutrition auditor is the AI agent behind nutrition cleanup: a read-only
Mastra agent (`3_applications/agents/nutrition-auditor/NutritionAuditor.mjs`)
that looks at the review window's food rows and proposes repairs and questions.
`NutritionCleanup` (`3_applications/nutrition/NutritionCleanup.mjs`) decides
when it runs, what it may change, applies what it proposes through
`NutritionRepairService`, and records every run. What a repair may do, the
72-hour review window, questions and the artwork queue are in
[nutrition-cleanup.md](nutrition-cleanup.md). This page covers when the agent
runs, what it is allowed to do, what it cost, and where to see all of it.

Status: implemented on branch `feat/nutrition-auditor-transparency`, pending
deploy. Design and plan:
`docs/_wip/plans/2026-09-25-nutrition-auditor-transparency-{design,plan}.md`.

## Why this exists

Before this work the auditor ran on `gpt-4o` through Mastra's own SDK client,
which never passed through `OpenAIAdapter`, so no agent turn reached the AI
usage ledger. The provider's export for Sep 10–22 showed about $21 of gpt-4o
that the ledger did not see, all of it auditor runs. It also re-audited its own
repairs: after a run it stored the fingerprint of the snapshot *before* its
repairs, so the repairs looked like a new change and started another run.

## What starts a run

`NutritionCleanup.tick` runs every 30 seconds from the scheduler (origin
`tick:nutrition-cleanup`). A run is queued for one of these reasons, recorded on
the run and its journal row as `trigger` (a list of kinds):

| Kind | Label on the page | Source |
|---|---|---|
| `captures` | New food captured | a row that was not in the last checked snapshot |
| `reviews` | You reviewed food | settlement or review status changed, `settledBy: user` |
| `stabilization` | 72-hour review window closed | settlement changed by the clock |
| `edits` | Food edited | a row's content changed |
| `artwork` | Artwork changed | only the icon or photo changed |
| `scaleReconcile` | Scale readings updated | the snapshot's scale observations changed |
| `dayRollover` | New day | the review window's dates moved |
| `dailySweep` | Daily sweep | startup reconciliation, and the sweep at/after local 03:00 |
| `manual` | Run manually | **Run now** (`POST /run`) |
| `unclassified` | First check after update | no earlier digest to compare with (first check after deploy) |
| `unknown` | Before tracking began | backfilled rows (see [Journal](#journal)) |

Classification is `auditTrigger.classifyChange` (`2_domains/nutrition/services/`)
over two snapshot digests. A digest keeps, per row, one hash of the content
(bookkeeping such as `version`, timestamps and repair provenance excluded), one
of the artwork, and the settlement fields, plus a hash of the observations and
the window's dates. Per row the most specific kind wins: settlement, then
content, then artwork. A sweep adds `dailySweep` to whatever else changed.

Changes that start nothing:

- **Bookkeeping only** (a version bump, a timestamp): the snapshot is marked
  checked without a run.
- **Deletions.** A row that left the snapshot (deleted by a person, or aged out
  of the review window; the digest cannot tell them apart) is not a trigger.
  The rows that remain are unchanged, and the daily sweep still covers them.
- **The auditor's own repairs** (the self-trigger fix). After a run,
  `NutritionCleanup` takes a fresh snapshot. When the only rows that differ from
  the audited input are ones the run itself repaired (`onlyOwnChanges`), that
  post-repair state becomes the checked state. Anything else that moved mid-run
  (a capture, an edit to another row, new scale observations) keeps the audited
  input as checked, so it is audited next.

A real change debounces (60 seconds without a further change, 120 seconds at most) before it may
queue a run.

## Gates

An automatic run passes these in order. A manual run skips all of them.

1. **Trigger filter.** `settings.triggers` switches kinds off. When every kind
   in a change is switched off, the snapshot is marked checked and one
   `skipped: filtered` journal row is written (once per fingerprint).
   `unclassified` cannot be switched off. A sweep's own `dailySweep` kind never
   absorbs a real change that happened to be pending at sweep time.
2. **Minimum gap** (`minGapMinutes`: 0, 15, 30 or 60). Changes keep
   accumulating while it runs out and are audited together. `nextEligibleAt` on
   the status says when.
3. **Daily cap** (`dailyCapUsd`, household day, 0–50 or `null` for none). Spend
   is read from the AI usage ledger's `nutrition-auditor` rows (`spendSource` in
   `5_composition/modules/nutritionCleanup.mjs`), so a turn billed before its
   run failed still counts. Without a ledger the journal is the fallback. At or
   over the cap: one `skipped: cap` row is written, `state.capped` records the
   day and cap, and nothing automatic runs (and spend is not re-read) until the
   household day or the cap value changes. Pending changes and a due sweep then
   run. A manual run over the cap still goes and is marked `overCap: true`.
4. **Triage** (`NutritionAuditTriage`, `agents.yml` →
   `nutrition_auditor.triage`). In `gate` mode a clean verdict marks the
   snapshot checked and logs `nutrition.cleanup.skipped` with the triage reason
   and score (no journal row). Details in
   [nutrition-cleanup.md](nutrition-cleanup.md#execution-and-durability).

A run fixes its model, permissions and trigger when it is queued. A retry sends
the identical input, and a settings change mid-run does not change what that run
may do.

## Permissions

Ten kinds, each on by default (`auditorPolicy.PERMISSION_KINDS`):

| Kind | Covers |
|---|---|
| `naming` | `name`, `label` |
| `identification` | `foodId` |
| `mealPlacement` | `date`, `mealTime` |
| `grouping` | `parentId`, `kind`, new groups |
| `artwork` | `icon`, `photoRef` |
| `portion` | `amount`, `unit`, `grams` |
| `nutrients` | any other field (calories, macros, micronutrients) |
| `estimates` | repairs in `estimate` mode |
| `completeCaptures` | repairs in `complete` mode |
| `questions` | asking a question at all |

Enforced at three points:

- **Proposal time.** The prompt lists the disabled kinds so the model does not
  spend tokens on them. Every repair is then checked with `blockedKinds` before
  `repairs.apply`; a disallowed one is recorded as outcome
  `{ status: 'blocked', kinds, proposal }`, so the page shows what it would have
  done, and logged `nutrition.cleanup.blocked`.
- **Question time.** With `questions` off, no question is asked. Otherwise each
  choice that needs a disallowed kind is dropped; a question left with fewer
  than two choices is not asked. Both land in `suppressedQuestions` with a
  reason (`questions-off`, `blocked`, `entries-missing`).
- **Answer time.** Answering a question re-checks the chosen repair against the
  permissions of the run that asked it (pruning keeps that run while its
  question is open), and a free-text answer's interpreted repair too.

## Settings and `settingsVersion`

Settings live in the cleanup state store (`users/{user}/agents/nutrition-cleanup.yml`)
and are read through `auditorPolicy.effectiveSettings`, which fills defaults
and ignores invalid stored values. Defaults: `enabled: false`, `dryRun: true`,
`telegram: false`, `model: gpt-4.1-mini`, `dailyCapUsd: 1`, `minGapMinutes: 15`,
every trigger and permission on. `model` is one of `gpt-4o`, `gpt-4.1`,
`gpt-4.1-mini`, `gpt-5.6-luna` and overrides `agents.yml`.

`PATCH /settings` takes `expectedSettingsVersion` plus any partial of the
settings (`triggers` and `permissions` merge per kind) and returns the new
status. `settingsVersion` moves only on a settings change; the status `version`
moves on every state write (runs, questions), so a run finishing between
loading the page and saving does not turn the save into a conflict. A stale
`expectedSettingsVersion` is a 409, a missing one a 400. Each changed field
appends `{ at, actor, field, from, to }` to the settings log (the last 500 kept),
compared against the effective value, so a first explicit choice of a default
is not logged as a change. Nested fields log as `permissions.nutrients`,
`triggers.dailySweep`.

## Journal

One row per run, and per skip, in
`users/{user}/lifelog/nutrition/auditor-journal/YYYY-MM.<writer>.jsonl`
(`JsonlAuditJournalStore`, behind the `IAuditJournalStore` port). The month is
the row's `at`. Each writer has its own file (the same writer id the AI usage
ledger uses) because the data tree is synced between machines, and two writers
appending one file is a conflict loop; `list` reads every writer's files. A
journal write failure is logged (`nutrition.cleanup.journal_failed`) and never
fails the run.

Completed run:

```
{ runId, at, completedAt, status: 'completed', trigger: [kinds], model,
  usage: { input, cached, output }, costUsd, turnId, toolCalls: [digest],
  outcomes: [...], questions: [{ question, choices: [labels] }],
  suppressedQuestions: [{ question, entryIds, reason }],
  summary, dryRun, manual, overCap }
```

Outcomes:

- `applied`: `operationId` (the repair id, `<runId>_<index>`), `affectedIds`,
  `logUuid` for a pending capture, `reason`, `mode`, and the changes digest.
- `proposed` (preview only): `proposal`, `reason`, `mode`, and the digest of
  what it would have changed.
- `unchanged`, `skipped` (409/404 at apply, with `reason`), `rejected`
  (unknown evidence), `blocked` (`kinds`, `proposal`).

The **changes digest** is `changes: [{ id, name, field, from, to }]` over the
fields a person reads (name, kind, parent, icon, photo, food id, date, meal,
amount, unit, grams and the nutrients), at most 50 per outcome with
`changesOmitted` for the rest. A new group row is described by name, kind, date
and meal. `before` is the audited snapshot; `after` is what was written (or, in
preview, what would have been).

Failed run: `{ runId, at, status: 'failed', error, attempt, trigger, model }`,
written once the retries are exhausted. Skip rows: `{ at, skipped: 'cap',
spentUsd, capUsd }` and `{ at, skipped: 'filtered', kinds }`.

`usage` has one shape everywhere: `normalizeUsage` also reads the runtime's
`{ inputTokens, cachedInputTokens, outputTokens }` that early live rows stored.

**Read time additions.** `GET /journal/:runId` marks an applied outcome with
`undoneAt` once a person undid it (the `undo_<operationId>` receipt, from the
nutrition ledger or the capture's metadata), and adds a view of the agent
transcript while it is still kept: tool calls with results capped at 8 KB,
rows in scope. `transcriptExpired` / `transcriptError` say why there is none.

**Backfilled rows.** Runs from before the journal were rebuilt from agent
transcripts by the backfill CLI (below). They carry `backfilled: true`,
`trigger: ['unknown']`, summed usage and cost across retried turns, and the
last transcript's repairs as `proposals` (outcomes were not recorded). They are
written with writer `backfill`, never into a live writer's file.

## Cost path

1. `MastraAdapter` reads each turn's total usage (execute and stream, success
   or failure) and hands it to the
   `usageRecorder` it was built with. The recorder is built in composition
   (`5_composition/agentUsageRecorder.mjs`) because adapters may not import each
   other and pricing lives in `1_adapters/ai/aiPricing.mjs`.
2. The recorder prices the turn, logs `agent.usage`, and appends a row to the AI
   usage ledger with `agentId`, `runId`, `turnId`, tokens, `costUsd`, status,
   `app`/`feature` from `AGENT_ATTRIBUTION` (`nutrition-auditor` →
   `health/auditor`) and `origin` from the current AI context.
3. The daily cap and the header's "today" read those ledger rows. The journal
   row carries the run's own `usage` and `costUsd` for the timeline and spend
   panel.

Every other AI call goes through a scoped gateway view that stamps
`app`/`feature` on its ledger row; the auditor's triage screen is
`health/auditor-triage`, its icon picks `health/icon-pick`. Ledger fields,
scoped views, `origin`, Whisper (billed on returned audio duration) and TTS
(per million characters) pricing are documented under **AI usage ledger** in
[configuration.md](../core/configuration.md).

## The auditor page

`/health/auditor` (`frontend/src/modules/Health/auditor/`), reached from Health
→ Settings → **Open auditor**. One cleanup status poll feeds every section.
Top to bottom:

- **Header**: state (On / Preview only / Off, and Over cap), model, last run,
  next eligible run, daily cap, spend today against the cap (the ledger figure,
  which includes failed runs), 7 days, month.
- **Runs**: journal rows newest first, the last seven household days, 50 per
  page with Load more. Filters: changed something, trigger, minimum cost. Each
  row: time, cost, trigger chips, Preview / "from transcript" badges, status,
  model, duration, outcome counts, and the first change ("Rice · grams 100 →
  150 (+2 more)"). Skip rows read "Skipped: over daily cap ($x of $y)" or
  "Skipped: only switched-off triggers (…)".
- **Run detail** sheet: why it ran (triggers, manual or automatic, over cap,
  preview, model, failure), what it looked at (rows in scope and tool calls),
  what it noticed (summary, questions asked and not asked with the reason),
  what it changed (reason and before/after table per repair, Undo per applied
  repair, "Undone at …" once undone), rejected or blocked proposals in full,
  tokens and cost.
- **AI usage**: all of Health's AI spend by feature (below).
- **Spend**: 30 daily cost columns with the cap as a reference line; cost per
  run by trigger and by model.
- **Auditor settings**: automatic cleanup, preview only, Telegram, Run now;
  model with its observed cost per run; daily cap; minimum gap; triggers; the
  ten permissions. Each control is its own versioned PATCH; a 409 reads
  "Settings changed. Reload first." and reloads.
- **Settings changes**: the log in plain words ("Nutrient values permission: On
  → Off · Sep 25, 10:42 AM"), ten until Show all.
- **Cleanup runs** and **Repair history**.

The **Health AI usage card** (`modules/Health/ai-usage/AiUsageCard.jsx`,
`GET /api/v1/health/ai-usage?days=30`, `HealthAiUsageService`) shows today /
7 days / month, a 30-day daily strip, and calls, average and cost per feature
(voice, photo, text, barcode and scale logging, corrections, meal suggestions,
icon matching, coach, coach commentary, nutrition auditor, auditor triage).
A feature whose calls were all unpriced reads "cost unknown", never $0.
Settings shows a compact version (totals, top three features, See all →
`/health/auditor#ai-usage`).

The response (`days` 1–90, household days, 400 on a repeated or bracketed
param, 503 when the service is not composed):
`{ range, today, week, month, byFeature: [{ feature, calls, costUsd, avgUsd,
unpriced }], days: [{ date, total, byFeature }], beforeTracking: { costUsd,
calls } | null }`. It reads the AI usage ledger only, through the
`IAiUsageReader` port. Only rows attributed to `app: health` count, and rows
under any other app never do. `calls` and `avgUsd` count ok rows only (a call
retried after an error writes an error row too); `costUsd` sums every row's
cost; a Health row without a feature is `unspecified` ("Other"). Rows written
before the ledger carried attribution show once as "Before tracking: $X across
all apps", the household total, never presented as Health's. The auditor's
spend from before attribution stays on the Spend panel, which reads the
journal.

The daily strip is one series on purpose: a dozen features exceed a
categorical palette, and stacked 30-day columns are a few pixels wide at phone
width, so features are named by row label and compared by bar length.

Frontend logging: child loggers `health-auditor` (mount, filters, run open,
settings saves and failures, undo) and `health-ai-usage`.

## API

Under `/api/v1/health/nutrition/cleanup`:

| Method/path | Contract |
|---|---|
| `GET /` | `{ version, settingsVersion, settings, nextEligibleAt, questions, runs }` |
| `PATCH /settings` | `expectedSettingsVersion` plus a partial of the settings; returns the status |
| `GET /settings/log` | `{ entries: [{ at, actor, field, from, to }] }`, newest first |
| `GET /journal?from&to&trigger&changed=1&offset` | `{ rows, total }`, household dates, default the last seven days, 50 per page |
| `GET /journal/:runId?at=` | one row with `undoneAt` marks and the transcript view; 404 for an unknown run |
| `GET /spend?days=30` | `{ days: [{ date, costUsd, runs, changed }], today, week, month, byTrigger, byModel, capUsd, cappedToday, ledgerTodayUsd }` |
| `POST /run` | manual run (202) |

Query params must be single plain strings; a repeated or bracketed param is a
400. `days` is 1–90. Averages (`avgUsd`) are over priced runs only and `null`
when none were priced.

## CLIs

- `node cli/nutrition-auditor-backfill.cli.mjs [--since YYYY-MM-DD] [--user ID] [--dry-run]`
  rebuilds journal rows from `<mediaDir>/logs/agents/nutrition-auditor/`
  transcripts. Idempotent by `runId`: runs already in any writer's file are
  skipped. Run it where the data tree is (inside `{env.docker_container}` on
  `{env.prod_host}`), `--dry-run` first.
- `node cli/openai-usage.cli.mjs ledger --since YYYY-MM-DD --by agentId,model`
  shows the auditor's ledger rows; `--by app,feature` splits all spend by owner;
  `--untagged` lists rows no app claimed, grouped by `origin`. `reconcile`
  compares the provider's billed dollars with the ledger per day (needs an
  admin-capable key; see the CLI header).

## Logs

Backend: `nutrition.cleanup.completed` (with `changed` and the triage verdict),
`nutrition.cleanup.filtered`, `nutrition.cleanup.capped`,
`nutrition.cleanup.skipped`, `nutrition.cleanup.blocked`,
`nutrition.cleanup.journal_failed`, `nutrition.cleanup.spend_read_failed`,
`nutrition.cleanup.transcript_read_failed`, `agent.usage`.

## Tests

- Backend: `backend/src/3_applications/nutrition/NutritionCleanup.test.mjs`,
  `2_domains/nutrition/services/{auditorPolicy,auditTrigger}.test.mjs`,
  `JsonlAuditJournalStore.test.mjs`, `agentUsageRecorder{,.wiring}.test.mjs`,
  `4_api/v1/routers/health.{auditorJournal,aiUsage}.test.mjs`.
- Frontend: `frontend/src/modules/Health/auditor/*.test.jsx`,
  `ai-usage/AiUsageCard.test.jsx`.
- Playwright: `tests/live/flow/health/health-auditor.runtime.test.mjs`, against
  a mocked API (it writes nothing).
