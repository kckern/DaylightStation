# Nutrition cleanup

The nutrition auditor is a read-only reasoning agent. It proposes changes; the
application applies them through `NutritionRepairService`, never through a model
mutation tool. `NutritionEvidenceToolFactory` can be reused by other agents.

## User controls

Health → Settings (`/health/settings`) contains automatic-cleanup, preview-only,
and optional Telegram switches; Run now; recent scans; and repair history with
before/after values, evidence, and Undo. Automatic cleanup defaults **off** and
preview-only defaults **on**. Preview evaluates the real policy without changing
food or sending questions. Telegram defaults off. Successful automatic repairs do
not show notifications. Disabling the auditor does not disable capture or the
deterministic 72-hour finalization clock.

## Capture and the 72-hour review window

Successful UPC scans count immediately as one provisional label serving. Unknown
mass is `amount: 1, unit: serving, grams: null`, not one gram. Missing nutrients
remain null. Incomplete catalog nutrition gets a barcode refresh, with a safe
one-serving fallback when the provider is unavailable. Delivery is not a save gate.

The production scale path is `ScaleObservationService` → `ScaleCapture` →
`FoodLogReview`. Placement identity, baseline, observations and quiet deadlines are
durable. Weight + density publishes one counted entry immediately; later weight or
tare updates that same identity. Removal closes a placement without discarding it.
All six weight/density/container arrival orders work. A new weighed placement does
not inherit the previous one's density or tare. Explicit clear/delete is respected.

For example, yogurt (160 kcal), chia (14 g / 70 kcal), then 458 g at 140 kcal/100 g
produce three ingredient entries totaling 871 kcal. The scale contributes 641 kcal
provisionally; unknown container tare is explicit, never silently invented, and
density alone does not imply any macro/micronutrient composition.

`review.startedAt` and `review.stabilizesAt` are UTC instants exactly 72 elapsed
hours apart. `NutritionStabilization` persists `settledBy: auto` at the deadline on
the next scheduler tick, including after downtime. It does not change totals or
send messages. Optional confirmation/edit records `settledBy: user` and immediately
ends automatic review. Legacy date-only display behavior is retained without a
bulk history migration. Health shows a muted “Estimated” label, not a settlement task.

Questions appear in Settings and in Today's follow-up tray (a one-line count under the macro bars that opens a sheet of question cards, one at a time; see the Health reference, *Feedback never moves the day*).

**What a question must be** (enforced, not just requested): one plain sentence of at most 140 characters naming the food, never system words ("provisional", "group header", "nutrients"); 2–3 choices whose labels are the concrete outcome in at most 40 characters ("1 cup (186 g)"), each repair making exactly that change. The wire schema holds the lengths and the 2-choice minimum, and `normalizeAuditRepairs` drops any question whose choices change nothing but artwork or nothing at all — icons, layout and naming style are the auditor's own call, never a question (logged `nutrition.audit.question_dropped`). Each choice displays its proposed changes;
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
- Automatically revise active provisional captures within their 72-hour deadline,
  checked **at commit time**, including delayed/restarted work. Legacy repairs
  retain the today/yesterday guard in the user's timezone and require explicit
  `settled: false`. Absent settlement metadata means legacy settled history and is
  not reopened. Unsupported artwork is removed from the repair independently of
  nutrient repairs, and the food is handed to the [artwork queue](#artwork-remediation-queue)
  instead of being forgotten; compatible patches to one entry are merged, but
  conflicting values are rejected.
- Names, food identification, meal/date categorization, available artwork and flat
  groups are eligible. New headers have zero additive nutrition; children retain
  their existing quantities/nutrition. Groups cannot cross captures/days/meals.
  Already-grouped ingredients keep their existing parent: automatic cleanup cannot
  create a duplicate header or orphan the original group by moving its children.
- Verified quantity, unit and nutrient changes require exact, serving-specific facts from
  trusted evidence tools. Habitual portions, a product's package size, and model
  confidence are not evidence of the amount consumed. The barcode tool reads the
  original `sourceUpc` and grants numeric authority only for a verified compatible
  serving basis. Known nonconflicting fields remain usable when other nutrients
  are missing; a 14 g seed serving is not scaled from the legacy `amount: 1`.
- Bounded provisional nutrient estimates require confidence ≥0.8, relevant
  evidence and an explicit rationale. They cannot invent a portion, override
  label/scale/user nutrition, or pass energy/mass sanity limits. Later verified
  evidence can replace an estimate and its provenance.
- `complete` repairs finish a stranded provisional capture through the same
  idempotent save command, requiring its original evidence and capture version.
  This counts food; it never impersonates user confirmation.
- No autonomous consumed-food deletion, invented consumption, or pending-capture
  confirmation. Cleanup shares the pending review/confirmation lock.
- Protect user-set fields and previously ratified rows. Automatically repaired
  fields cannot oscillate through successive cleanups; further automatic changes
  require genuinely new trusted evidence for that field. Label/name aliases share
  the same protection. Unsupported repairs do not turn into synthetic questions.
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
The tick reads that state file several times a pass, and it was 1.9 MB with 448
runs as of 2026-09-25. `YamlAgentStateStore.load` and the nutrition list/archive
reads therefore go through `FileIO.loadYamlCached`, which re-parses only when a
file's mtime, size or inode changes and hands each caller a clone. Re-parsing on
every 30 s tick had held the backend's event loop about 0.7 s each time.
Completed dispatch records discard duplicate full report payloads; the managed
workflow checkpoint and repair receipts remain durable. Transcripts use the existing
private agent transcript store. Do not publish these files: they contain food history
and user responses.

The shared nutrition receipt publisher edits already-linked receipts from the
committed ledger using the same renderer as initial captures. The synchronizer
only triggers it; Mastra never renders receipt prose or receives a receipt
messaging capability. It does not create pending prompts or daily reports after
captures/repairs. See [mutable messaging synchronization](README.md#optional-messaging-surface-synchronization)
for ownership, retry and selective preview/repair contracts.
Cosmetic finalization does not trigger a receipt edit. Ordinary serving assumptions,
unknown tare and missing nutrients need no question; exceptional questions are
deduplicated by issue, not by every changing entry version. Telegram failures do
not gate food saves. A Telegram send whose result
is uncertain is not retried automatically (Telegram has no idempotent send); the
question remains actionable in Health. Known message edits are retried.

**Triage** (`NutritionAuditTriage`). Before a non-manual audit is queued, a cheap
check decides whether the snapshot is worth the LLM: a pending capture always is
(code rule); otherwise the typed decision model answers five yes/no gut-checks
over compact rows (garbled name, implausible nutrition, mismatched icon, an
ungrouped dish, an accidental duplicate). The highest probability is the score.
Configured in `agents.yml` → `nutrition_auditor.triage: { mode, threshold }`:

- `shadow` (default when a decision model is configured) — assess, store the
  verdict on the run, audit anyway. `nutrition.cleanup.completed` carries
  `changed` (repairs applied or proposed) beside `triageNeedsAudit` /
  `triageScore`, which is the evaluation data for choosing a threshold.
- `gate` — a clean verdict marks the fingerprint checked and logs
  `nutrition.cleanup.skipped` instead of auditing. Manual scans and the daily
  reconcile are never gated.
- `off` — no triage.

Any triage failure means "audit", as before triage existed.

This dispatcher assumes **one backend writer**. Do not start another household
backend or horizontally scale the YAML writer. SQLite workflow storage is not a
distributed lock around nutrition YAML.

## Artwork remediation queue

Rule: a food whose icon or photo cannot be shown is never abandoned. It becomes a
queue item and is worked until it is fixed. No new art is generated.

**Intake.** Three sources, deduplicated by key (`food:{foodId}`, else
`name:{normalized name}` for icon problems; `photo:{photoRef}` for photos; a bare
`icon:{slug}` when the browser reports a slug with no row):

- the browser: `artworkLog.reportArtworkFailure` (FoodIcon load/decode failure, a
  row photo that will not load) posts once per key per page session;
- a sweep of today and yesterday every 2 minutes (so a capture that lands on
  `default` is queued within minutes), and of the last 7 days hourly: rows with no working photo and an icon that is
  missing, `default`, or not served by the manifest (a person's own icon choice —
  `manualFields: icon`, including an Undo of an artwork repair — is left alone);
- the auditor, when it proposes art the manifest does not serve.

A new report on an open item adds its rows without resetting the wait; a report on a
resolved item reopens it, due now.

**Item shape** (`2_domains/nutrition/services/artworkQueue.mjs`):
`{ key, kind: icon-missing | icon-failed | photo-failed, foodId, rowIds, earliestDate,
name, icon, photoRef, attempts, nextAttemptAt, lastError, createdAt, updatedAt,
resolvedAt, resolution }`. Stored per user in
`users/{user}/lifelog/nutrition/artwork-queue.yml`.

**Resolution ladder** (`3_applications/nutrition/ArtworkRemediation.mjs`), stopping at
the first slug that the manifest serves and whose file resolves:

1. the catalog entry's pin (`iconOverride`), then its learned `icon`;
2. the manifest's reviewed `foodNames` map;
3. `guessIconForName` — the longest run of the name's words that is a slug;
4. a pick of the NEAREST slug, confined to the manifest vocabulary, through
   `NearestIconChooser` (`3_applications/nutrition/`): the typed decision model
   (Jev, `IDecisionGateway`) answers one choice over the whole vocabulary; a pick
   at or above confidence 0.5 stands (`via: 'jev'`), anything else falls back to
   the LLM prompt (the UPC use case's `#selectIconFromList` shape, same AI
   gateway, `via: 'ai'`). The UPC capture's own icon fallback uses the same
   chooser. Every pick logs `nutrition.icon.pick` with Jev's candidate and
   confidence beside the LLM's, so agreement can be measured before the floor
   moves. The vocabulary may exceed Jev's 255-option cap; the adapter narrows
   it in two rounds, invisible here.

Exception: names in `EXACT_ONLY_NAMES`, and names the reviewed map sets to `null`
("no suitable art"), never get a near neighbour and never reach the AI. They take
their exact slug, else the barcode product photo when a row or the catalog entry has
one, else the item stays open (listed in Settings) and keeps retrying.

A `photo-failed` item whose row came from a barcode re-fetches the product image
through the UPC gateway and stores it as a new `photoRef` (row and catalog entry).
Without a barcode image, the row gets an icon by the ladder and the dead `photoRef`
is cleared. A bare-slug report is checked against the manifest and, when the file is
gone, fanned out into one item per food that uses the slug (last 30 days).

**Applying.** Row fixes go through `NutritionRepairService.apply` in mode `artwork`,
actor `artwork-remediation`, with a reason and evidence: icon and `photoRef` only,
any date, never over `manualFields: icon`, never on a group header
(`validateArtworkRepair`). They are journaled in `cleanup-audit.yml`, listed in
Repair history, and Undo restores them (Undo covers `photoRef`). The chosen icon is
also written onto the catalog entry when it has none; a pin is never touched.

**Retry.** A failed attempt increments `attempts`, records `lastError`, and waits
1 minute doubling to a 24-hour ceiling. There is no attempt cap. Rows reported while
an attempt runs keep the item open.

**Schedule.** From `5_composition/modules/nutritionCleanup.mjs`, behind the same
`scheduled` gate and head-of-household owner as the cleanup tick, with its own
non-overlapping guard: a 1-day `sweep` + `tick` every 2 minutes (up to 20 due items), and a 7-day
`sweep` + `tick` every hour and at startup. Each pass reads the ledger once from the
oldest day its items need, and the catalog once.

**One-time full-history sweep.** `node cli/health-artwork-sweep.cli.mjs --user ID`
is a dry run: it prints broken rows, foods, and what the deterministic ladder would
pick per food (`ai` = only the AI step is left; `stays-open` = exact-only with no
art). `--apply` enqueues the findings for the server's tick to work; run it only
where that server reads the same tree.

**Logs.** `artwork.queue.enqueued` (info), `artwork.queue.resolved` (info, with `via`),
`artwork.queue.retry` (warn, with `attempts`, `nextAttemptAt`, `error`),
`artwork.queue.sweep` (info). Browser side: `artwork.{icon,photo}-failed` and
`artwork.queue.report-failed`.

| Method/path (under `/api/v1/health`) | Contract |
|---|---|
| `POST /nutrition/artwork-failures` | `{kind: icon-missing\|icon-failed\|photo-failed, key, uuid?, name?, icon?}` → 202 `{queued, key, attempts}`; 400 on a bad kind/key |
| `GET /nutrition/artwork-queue` | `{open: [...], recentlyResolved: [...]}` |

Both answer 503 when the queue is not composed. Health → Settings shows the
**Artwork queue** card: open items (food, problem, attempts, next attempt, last error)
and the most recent fixes.

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

## Replay and selective recovery

`node cli/health-reconciliation-preview.cli.mjs --live-model` runs the installed
Mastra runtime against synthetic incident data in disposable YAML stores. Supply
`OPENAI_API_KEY` through the environment, never command text or logs. It validates
repairs, applies them only to the fixture, then replays them to check idempotency.
The model wire format uses typed field/value lists for sparse changes; strict
Structured Outputs cannot represent optional object patch keys. Local policy still
validates all writes.

`POST /api/v1/health/nutrition/capture-recovery` accepts `logUuid`,
`expectedVersion`, `operationId`, optional original `observationIds`, and `dryRun`
(default true). This is an explicit operator-selected recovery, not a model tool
or an automatic sweep. It only accepts untouched single-food legacy captures.
Preview returns before/after values; applying preserves original IDs, capture-time
deadlines, and an atomic `metadata.captureRecovery` receipt. Scale recovery requires
the matching unclaimed weight/density observations and records unknown tare.
Retry the identical request after an interrupted write. Back up the selected
nutrition files before applying; do not start a second backend writer.

Rollout order: isolated tests and live-model preview; activity gate; build;
activity gate again; deploy; inspect actual-data recovery previews; apply only
the selected receipts; preview the auditor on household evidence; then enable
`enabled: true, dryRun: false, telegram: false` with the current settings version.
