# Nutrition auditor transparency and control (design)

**Status:** implemented on branch `feat/nutrition-auditor-transparency`, pending deploy
(design approved 2026-09-25). Reference: `docs/reference/health/nutrition-auditor.md`.
**Owner surface:** Health app, new route `/health/auditor`, linked from Settings.

## Why

The OpenAI bill for the current key was far above what the AI usage ledger
recorded. The provider's usage export (Sep 10–22) put **gpt-4o at 692
requests and 8.74M input tokens (≈ $21)**, with zero gpt-4o rows in the
ledger. Hour-by-hour correlation against the log store tied every gpt-4o hour
to a `nutrition-auditor` run.

- The auditor is a Mastra agent (`5_composition/modules/nutritionCleanup.mjs`)
  on `openai/gpt-4o` unless `agents.yml` sets `nutrition_auditor.model`.
- Mastra calls OpenAI through its own SDK client, never `OpenAIAdapter`, so no
  agent writes an `openai.usage` event or a ledger row, and
  `agent.execute.complete` logs no usage either.
- It ran 160 times in 7 days, ~3 model calls and ~40k input tokens per run
  (≈ $0.10). 58 of 158 completed runs changed nothing.

What started each run (last 7 days, nearest preceding event within 3 min):

| Trigger | Runs |
|---|---|
| Scale relay reconnect → `nutrition.scale.reconciled` | 74 |
| Nothing else observed | 25 |
| Its own previous run's repairs | 20 |
| A completed review | 19 |
| 72h stabilization | 16 |
| Artwork remediation | 5 |

`NutritionCleanup.tick` (every 30 s) re-audits whenever the snapshot
fingerprint changes. After a run it stores the fingerprint of the snapshot
*before* its own repairs, so its repairs trigger the next run.

## Page

- **Header:** status (on / preview-only / off), model, last run, next eligible
  run, spend today / 7 days / month against the daily cap.
- **Run timeline** (newest first): time, trigger, duration, model, cost,
  counts of changed / proposed / rejected / blocked / asked. Filters: changed
  something, cost ≥ $X, trigger.
- **Run detail sheet:** why it ran; what it looked at (rows in scope, each tool
  call with collapsed results); what it noticed (summary, findings it did not
  act on); what it changed (before/after diff with Undo, reusing the existing
  repair-history component); rejected and permission-blocked proposals in
  full; questions and answers; tokens and dollars.
- **Spend panel:** 30-day daily cost bars; cost per run by trigger.
- **Configuration and permissions**, then the **settings change log**.

## Configuration

Stored in the cleanup state store behind `PATCH /nutrition/cleanup/settings`.
Every change appends `{at, actor, field, from, to}` to the change log.

- Existing: enabled, dryRun, telegram, Run now.
- `model`: allowlist (gpt-4o, gpt-4.1, gpt-4.1-mini, gpt-5.6-luna), shown with
  real average cost per run. Overrides `agents.yml`. `MastraAdapter.execute`
  gains a per-call model option.
- `dailyCapUsd`: checked before each automatic run against today's journal
  cost (household timezone). Over the cap, automatic runs pause until
  midnight; Run now still works and is marked over-cap.
- `minGapMinutes` (0 / 15 / 30 / 60): changes accumulate and are audited
  together once the gap passes.
- `triggers`: captures, reviews, stabilization, scaleReconcile, dailySweep. A
  change whose only classes are unchecked is marked seen without a run.

### Permissions

One toggle per kind: names/labels, identification (`foodId`), meal placement
(date/mealTime), grouping, icons/photos, portion (amount/unit/grams), nutrient
values, estimate mode, completing stranded captures, asking questions.

Enforced twice: the prompt lists disabled kinds so the model does not spend
tokens on them, and `NutritionCleanup` checks every proposal before
`repairs.apply`. A disallowed proposal is recorded as `blocked` with the full
proposal, so the page shows what it would have done.

## Trigger attribution and the self-trigger fix

Split the snapshot fingerprint into per-class hashes (captures, reviewed rows,
stabilized rows, observations, rows the auditor changed). The diff between the
last checked hashes and the current ones is the run's trigger, and the same
split drives the trigger filter.

After a run, `checkedFingerprint` becomes the fingerprint of the snapshot taken
*after* its own repairs. This is a bug fix independent of settings.

## Data

**Run journal:** `YamlAuditJournalStore`, monthly JSONL under household
history. One row per run: `runId`, start/end, `trigger {classes, detail}`,
`model`, `usage {input, cached, output}`, `costUsd`, tool-call digest
(name, short args, ok, latency), `outcomes` (applied / proposed / rejected /
blocked, with reason), `questions`, `summary`, `transcriptPath`. Skipped
evaluations get a row too (`skipped: cap | gap | filtered | triage`).

**Cost:** `MastraAdapter` reads `response.totalUsage` (execute and stream) and
records it to `aiUsageLedger` with provider, model, `agentId` and `runId`,
priced by `aiPricing.mjs`. This covers every Mastra agent. Ledger and journal
share `runId`; `cli/openai-usage.cli.mjs ledger --by agentId` must agree with
the page.

**API** (`4_api/v1/routers/health.mjs`):

- `GET /nutrition/cleanup/journal?from&to&trigger&changed`
- `GET /nutrition/cleanup/journal/:runId` (adds transcript tool calls while the
  file exists)
- `GET /nutrition/cleanup/spend`
- `GET /nutrition/cleanup/settings/log`
- `PATCH /nutrition/cleanup/settings` extended with validation

**Backfill:** one-time CLI reading `media/logs/agents/nutrition-auditor/**`
(from 2026-09-06) into journal rows, trigger `unknown (backfilled)`, outcomes
from transcript output. Idempotent by `runId`.

## Logging

Backend: `nutrition.cleanup.skipped {reason}`, `nutrition.cleanup.blocked
{kind}`, `agent.usage`, `nutrition.cleanup.settings.changed`. Frontend:
`health-auditor` child logger for mount, filter changes, settings mutations
(success/failure).

## Errors

- A journal write failure never fails a run; it logs a warning.
- An expired transcript shows "Transcript expired" in the detail view.
- An unknown model price shows "—", with tokens still visible.

## Tests

- Unit: permission enforcement, trigger classification, cap / gap / filter
  gates, self-trigger fix, MastraAdapter ledger write.
- Router tests for the new endpoints.
- Component test for the timeline and detail sheet.
- Playwright: load `/health/auditor`, open a run, toggle a permission, see it
  in the change log.

## Addendum (2026-09-25): AI spend attribution by app and feature

**Problem.** Every non-Mastra call goes through one shared `OpenAIAdapter`
handed to ~20 consumers (health/nutribot, journalist, homebot, finance,
school, weekly review, party games, card ladder…). Ledger rows say model and
cost but not who called, so Health's total AI spend and its split (photo log vs
icon pick vs auditor) cannot be answered. Granularity chosen: **app + feature**.

**Approach (chosen over ambient-only context).** Explicit scoped gateway views
do the attribution; an automatic origin stamp makes any gap findable.

- **Ledger row** gains `app`, `feature`, `origin`. Mastra rows keep `agentId`;
  the recorder maps agents → app/feature (nutrition-auditor → health/auditor,
  health-coach → health/coach, health-coach-commentary → health/coach-commentary,
  newsreporter-consolidator → news/consolidator, …).
- **`scoped(tags)`** on `OpenAIAdapter` (and `AnthropicAdapter`, `JevAdapter`,
  `VoiceTranscriptionService`, `OpenAITTSAdapter`): same methods, merges `tags`
  into each call's usage record; nesting merges (app in composition, feature in
  the use case).
- **Health features:** voice-log, photo-log, text-log, upc-log, scale-log,
  revision, meal-instruction, icon-pick, coach, coach-commentary, auditor,
  auditor-triage (the Jev pre-audit screen). Other
  apps: app-level now; features where trivial, else null ("(no feature)").
- **Origin** (`0_system` `aiContext`, AsyncLocalStorage): set by Express
  middleware (`http:METHOD route-pattern`), scheduler (`job:<id>`), Telegram
  webhook (`telegram:<bot>`), timers (`tick:nutrition-cleanup`, `tick:artwork`),
  CLIs (`cli:<name>`). Informational only; never used as attribution.
- **Pricing gaps:** Whisper `verbose_json` duration × $0.006/min; gpt-5-nano
  added; TTS rows (tts-1, $15/1M chars); the three ledger-less CLIs get the
  ledger.
- **Guards:** composition guard — no bare shared gateway handed to a consumer
  (`aiGateway:`/`openaiAdapter:`/`transcriptionService:` values must be
  `.scoped({ app })`); Health feature test asserts each Health use case records
  `health/<feature>`; `openai-usage ledger --by app,feature` lists untagged rows
  with origins.
- **Display:** `GET /api/v1/health/ai-usage?days=30` (app-layer service over a
  ledger reader port, filtered to app=health) → totals, `byFeature`, daily bars
  stacked by feature. Health app "AI usage" card on the auditor page and in
  Settings; auditor line links to its timeline. Pre-tagging rows show as
  "Before tracking" — not guessed.
