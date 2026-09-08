# Health: capture, reconcile, and stabilize without settlement spam

Status: proposed implementation course. September 5, 2026.
Baseline reviewed: `2144f762a`. Planning and read-only production diagnosis only;
this document does not record an implementation, data repair, or activation.

## Outcome agreed with the user

Food appears in the consumed ledger with a reasonable provisional estimate as
inputs arrive. Further evidence improves that same entry. The user may confirm or
correct it, but silence is an acceptable workflow: the estimate eventually
stabilizes without reminders or a required confirmation action.

The September 5 sequence must produce **three counted food entries**:

| Entry | Initial interpretation | Expected behavior |
|---|---|---|
| Oikos yogurt | One provisional serving, approximately 160 kcal | Log immediately; repair the serving representation from evidence; allow optional portion correction. |
| Chia seeds | One provisional serving, 14 g / 70 kcal | Separate ingredient eaten with the yogurt; retain its own quantity and nutrition. |
| Food weighed in a container | 458 g reading plus scanned 140 kcal/100 g | Combine the observations into one food row. If 458 g is net, display approximately 641 kcal. Preserve tare uncertainty if the reading includes an unidentified container. |

Those serving assumptions were explicitly accepted in this conversation. They are
defaults for this example, not proof that every future barcode means an entire
package. Yogurt and chia can share a meal association without collapsing into one
ingredient, adding another calorie-bearing parent, or requiring a fourth entry.
Timing alone suggests relatedness; the user's explanation establishes it here.

## What today's evidence actually establishes

Times below are user-local. Sources: production structured logs, read-only Health
pending/observation/cleanup endpoints, and the corresponding persisted records.

- **12:48:16:** yogurt UPC received; `logUPC.catalogHit` resolved OIKOS PRO PLAIN.
  Capture completed at 12:48:18, but remains pending. It has 160 kcal, `grams: null`,
  `amount: 1`, `unit: g`, and no saved nutrition-basis audit. Its icon is hummus.
- **12:48:20:** chia UPC received; a 14 g / 70 kcal capture completed at 12:48:21.
  It also remains pending. Lookup warnings concern missing sugar and cholesterol,
  despite usable calories and serving mass.
- **14:28:15:** a 458 g scale observation and pending scale capture were recorded.
- **14:28:22:** `dl:140` resolved successfully to density level 4, 140 kcal/100 g;
  the existing prompt was edited at 14:28:23. The density scan was understood.
- Both scale observations are now `dismissed`, unpaired; the surviving food capture
  is pending, labeled Unknown, 458 g, zero calories. The logs examined contain no
  successful scale commit for this placement.
- The live cleanup endpoint reports `enabled: false`, `dryRun: true`,
  `telegram: true`, no questions, and no runs. The agent did not attempt recovery.
- A separate morning protein-shake scan is also pending, even with **no** lookup
  warnings. It is a useful additional regression case, outside the three-entry
  sequence above.

Correction to the earlier conversational diagnosis: missing yogurt mass is a data
defect, but it is **not the sole reason the scan remains pending**. UPC paths retain
a mandatory portion-confirmation workflow regardless of whether lookup succeeded.
Hardware additionally bypasses the common capture stamping path.

The scale code demonstrably cancels its timer and dismisses observations when a
placement ends. This is consistent with the surviving incident records. The exact
removal/tare frame and dismissal reason were not logged at info level, so the
precise physical trigger remains an inference. A restart occurred several minutes
later; it does not explain a successfully completed 25-second commit disappearing.
Do not manufacture a dismissal timestamp or container tare during incident repair.

## Current seams and the changes they need

| Seam | Current behavior | Required change |
|---|---|---|
| [ScanIngressCoordinator](../../../backend/src/3_applications/scan/ScanIngressCoordinator.mjs) `handleProduct` | Calls the UPC use case directly with a headless response; reports `logged` before asynchronous completion. | Persist a capture identity and dispatch through a shared application command; distinguish received, processing, and committed outcomes. |
| [NutribotInputRouter](../../../backend/src/3_applications/nutribot/services/NutribotInputRouter.mjs) `handleUpc` | Explicitly uses `commit: false`; awaits portion selection. | UPC ingestion should create an accepted, provisional row on every transport. |
| [LogFoodFromUPC](../../../backend/src/3_applications/nutribot/usecases/LogFoodFromUPC.mjs) | Any catalog hit overrides upstream lookup; synthesizes a gram serving from possibly absent mass; drops lookup metadata and records only four nutrients into catalog usage. | Preserve product serving facts separately from consumed amount; enrich incomplete catalog matches; retain all available nutrients and provenance. |
| [FoodLogReview](../../../backend/src/3_applications/nutrition/FoodLogReview.mjs), [SelectUPCPortion](../../../backend/src/3_applications/nutribot/usecases/SelectUPCPortion.mjs) | Confirmation operates on pending captures; warnings can block it. | Portion controls must also revise existing provisional entries, idempotently, without a second append or double scaling. |
| [ObservationService](../../../backend/src/3_applications/nutrition/ObservationService.mjs) | Waits 25 seconds, then commits; removal cancels the timer and dismisses observations. Live entry identity and timer are in memory. | Persist placement identity, entry association, and deadline. Publish once sufficient evidence exists; removal closes the placement without throwing away its result or recovery work. |
| [settlement](../../../backend/src/2_domains/nutrition/services/settlement.mjs) | `> 3` calendar-day age changes presentation only; raw state remains unsettled. | One precise review deadline and shared lifecycle policy for UI, workers, tools, and matching. |
| [NutritionAuditor](../../../backend/src/3_applications/agents/nutrition-auditor/NutritionAuditor.mjs), [evidence tools](../../../backend/src/3_applications/agents/nutrition-auditor/NutritionEvidenceToolFactory.mjs) | Only snapshots today/yesterday food; cannot read raw scale observations; cannot finish pending capture ingestion. | Read complete capture/placement evidence and all eligible provisional rows; propose evidence-linked recovery and improvements. |
| [cleanupPolicy](../../../backend/src/2_domains/nutrition/services/cleanupPolicy.mjs) | Requires exact numeric facts; protects a field permanently after one automated repair. | Distinguish estimates from verified corrections; permit improvements from stronger new evidence without oscillation or overriding user corrections. |
| [NutritionCleanup](../../../backend/src/3_applications/nutrition/NutritionCleanup.mjs), [AgentInteractions](../../../backend/src/3_applications/agents/framework/AgentInteractions.mjs) | Some rejected repairs become questions; question identity includes entry versions. | Separate diagnostic findings from user questions. Deduplicate an issue across harmless version changes; apply a shared interruption policy. |
| [NutritionSurfaceSync](../../../backend/src/3_applications/nutrition/NutritionSurfaceSync.mjs), [surface composition](../../../backend/src/5_composition/modules/nutritionSurfaceSync.mjs) | Can create a Telegram Needs review message for each headless pending capture; food changes trigger report synchronization. | Separate data refresh from new outbound messages; routine capture/repair/stabilization must not create review demands or full reports. |

## Target behavior and proposed defaults

### Separate evidence, consumption, and review

Use the existing consumed ledger as authority. Preserve capture logs and observations
as evidence; never reconstruct corrected or deleted consumption by blindly replaying
old captures. Extend the current application commands and recoverable journal rather
than introducing a second nutrition database or a replacement agent framework.

For new entries, introduce an explicit review record with state `provisional`,
`confirmed`, or `stabilized`, an immutable initial capture time, and a review deadline.
Keep `status: accepted` as the consumption axis. Derive compatibility `settled` /
`settledBy` fields from the new record, with a single adapter for legacy writes.
Rows without new metadata retain the existing legacy interpretation; they are not
silently reopened. An incomplete observation is distinct from a counted food row.

- **Provisional:** counted immediately; best current estimate; eligible for evidence
  enrichment and bounded agent revision.
- **Confirmed:** user has ratified the entry; protect their choices.
- **Stabilized:** the review window expired; preserve the best estimate and its
  uncertainty. Silence does not become evidence that the portion was measured.
- All states remain manually editable. Later automatic changes to a stabilized row
  require an explicit reopen policy; they do not happen merely because a worker
  reread old input. Internal retries may finish an already journaled operation.

Recommended timing, subject to implementation evaluation:

| Clock | Proposed role |
|---|---|
| Placement assembly: current 25-second quiet period | Close/coalesce an interaction, not delay a complete provisional food appearing. Late tare/density within that placement updates the same row. |
| Agent debounce: current 60 seconds, maximum 120 seconds | Batch changed evidence and avoid a model call for every frame or scan. Known arithmetic and ingestion do not wait for the model. |
| Review: 72 elapsed hours from capture | Stabilize automatically; use explicit UTC instants and user-local meal dates. Routine rereads, retries, or repairs do not keep extending the deadline. |

The 72-hour definition is a proposed clarification of the existing three-day intent,
not a claim about current code. A finalizer persists the transition, resumes after
restart, and remains independent of model availability. Every automatic mutation
checks the same deadline at commit time, so delayed agent output cannot cross it.
Replace the unrelated today/yesterday write cutoff for new provisional entries;
retain older records as reference-only unless the user directs a correction.

### Associate signals without merging unrelated consumption

Persist source event ID, owner, device, event time, receive time, capture ID,
placement ID where applicable, and the resulting entry IDs. Store both the raw
code and its normalized meaning, including the density value/config revision used.
Persist these before optional delivery or model work.

Use explicit IDs and placement boundaries first; food identity, compatibility, and
time are supporting evidence. A burst of product scans can share a meal/session
association while each remains a counted ingredient. A scale measurement must not
attach itself to one ingredient merely because it is the nearest row in time.
Do not distribute a whole bowl's weight between yogurt and chia without evidence.

On stable weight plus usable density, write/update one provisional scale row
immediately. Tare is applied exactly once; distinguish device-tared/net readings
from gross measurements requiring a known container. If tare is genuinely unknown,
retain that fact and any displayed gross-based estimate as provisional. Do not
present it as verified net mass or guess a Tupperware weight from its name.

Removal seals the current placement and releases the scale for the next one;
remaining reconciliation uses its saved snapshot. `clear`, user dismissal, ordinary
removal, expiry, and successful consumption need distinct reasons. Otherwise a
recovery worker cannot tell abandoned evidence from a food the user deleted.
Keep bounded closed-placement retention and archive processing so stale observations
do not grow forever in the hot file. Preserve enough linkage for restart recovery.

Transport retries reuse an event/operation ID; deliberate second scans get distinct
IDs. Never deduplicate food solely by UPC or name. Verify what the relay can supply
and add sequence identity there if necessary; legacy timestamp-based dedup cannot
be advertised as exactly-once delivery. The commit journal must cover the entry,
summary, and observation linkage or persist a recoverable intent spanning them.

### Make estimates explicit and serving math consistent

Keep product label basis, package quantity, chosen serving count, actual consumed
mass/volume, and their provenance separate. A catalog's usual logged portion is
not necessarily the manufacturer's serving. Unit conversion/scaling must be shared
by ingestion, catalog reuse, portion editing, scale computation, and agent tools.

Specific regressions to fix:

- Yogurt's unknown mass must not become `1 g`. Keep a one-serving estimate while
  looking up the real serving basis; retain the same food/entry identity.
- Catalog hits must retain known micronutrients and serving audits. Missing
  nutrition must not become a claimed zero. Use nullable values/coverage metadata
  consistently through domain serialization, persistence, API, and UI.
- Missing sugar or cholesterol alone must not block a usable calorie entry or ask
  the user to certify a label.
- Current agent barcode facts scale by `item.amount / product.serving.size`; a
  captured solid can have `amount: 1`, `unit: g`, `grams: 14`. Normalize quantity
  before generating repair facts so the agent does not divide a serving twice.
- A suspect upstream value should cause lookup/estimate reconciliation. Keep a
  supported last-known estimate when available; otherwise preserve missing values
  visibly, without counting unknown calories as a verified zero.
- Density-derived macro splits are estimates from the configured table, not macro
  measurements. Preserve that provenance if retaining those estimates.

### Give Mastra useful judgment with accountable writes

Reuse the existing managed Mastra runtime, evidence tools, repair receipts, version
checks, and Undo. The agent reasons; application services execute validated commands.
Adding a larger model or enabling the current switch alone does not fix these seams.

Extend its snapshot/tools to include placement observations (including closed but
unresolved ones), capture identities, serving bases, known containers, original
texts, source lookups, previous corrections, and notification history. Include
observation revisions and lifecycle deadlines in invalidation/scheduling.

Support three distinct actions:

1. **Complete/reconcile captured consumption:** route a stranded successful scan or
   complete placement through the same idempotent ingestion command. It creates the
   missing projection of recorded food, not a second serving. Require source IDs and
   versions; a user-deleted entry or explicitly dismissed capture stays deleted.
2. **Improve a provisional estimate:** allow the user-approved serving default and
   reasonable food estimates, recorded as estimates with source and rationale.
   Higher quality new evidence can replace an earlier machine estimate. Fix known
   unit mistakes deterministically; reserve model judgment for ambiguous identity,
   portion interpretation, relatedness, and conflicting sources.
3. **Apply a verified correction:** use quantity-compatible label/scale/user facts
   with field-level provenance. Product evidence establishes nutrition per basis;
   it does not establish how much was consumed.

This intentionally changes the previous policy that all uncertain numeric changes
must become questions and pending captures can never progress automatically.
Update prompt, schemas, guards, and tests together; do not merely loosen a prompt
while the application continues rejecting its output. Confirmation remains a user
act; completing ingestion never impersonates confirmation.

An anti-oscillation rule should use evidence identity, authority, and entry version,
not permanently forbid all second repairs to a field. Repeated input produces no
new repair or question. A real user correction/Undo remains protected. Grouping
across separate scans requires an explicit meal association; retain each capture's
identity and use a non-additive presentation, not an extra counted food.

### Make silence an enforceable product contract

Introduce one notification policy used by capture responses, scale prompts, cleanup
questions, surface sync, and relevant coach/report triggers. A structured issue is
not automatically a message to the user.

| Event | Default presentation |
|---|---|
| Successful scan or complete placement | Update the log; at most one compact, silent receipt per interaction when that surface is enabled. |
| Routine provisional estimate | Subtle Estimated cue; optional edit/confirm inside the entry. No repeated Unconfirmed demands. |
| Missing nonessential nutrition or artwork | Background lookup/neutral artwork; details inside the entry only. |
| Automatic repair or stabilization | Update the row/history and any existing receipt in place; no new push, toast, or per-change daily report. |
| Incomplete recoverable input | Keep evidence and retry locally; show progress/details without a confirmation chore. |
| Material unresolved ambiguity after recovery | One consolidated optional question in Health; keep a reasonable provisional estimate when possible. |
| Capture could not be saved at all | One actionable failure at the originating surface, with retained input/retry. Never falsely report Logged. |

Default automatic Telegram cleanup questions to **off**, including deliberate
migration of the current default `telegram: true` when this policy rolls out.
This does not disable user-requested coaching or scheduled reports. Optional future
question delivery must be opt-in, batched, capped, and deduplicated by underlying
issue across versions. Ignoring/dismissing a question must not recreate it on every
scan; expire it quietly at stabilization. No settlement reminders.

Separate report rendering/invalidation from report publication. Synchronizing a
changed day must not create a report merely because a row stabilized. Editing an
existing receipt is fine; unavailable old messages must not trigger historical
catch-up spam. Handle uncertain sends with durable delivery state, not blind retries.

## Implementation order and completion gates

### 1. Lock the contracts and replay the incident

Add a sanitized, isolated incident fixture with the two UPCs, their saved catalog
shapes, and weight/density timestamps. Drive the real application commands and
temporary stores with an injected clock and fake delivery; do not send household
Telegram messages. Include removal-before-25-seconds as a regression scenario,
explicitly labeled a reconstruction rather than a recorded raw removal frame.

Define the lifecycle/evidence/notification contracts above before changing callers.
Implement the quiet delivery policy alongside the first capture behavior changes;
otherwise turning pending entries into food may create a report burst.

Gate: the current implementation's failures are reproducible and the desired
three-row/totals/no-reminder assertions are executable. Existing tests that require
UPC confirmation are deliberately updated to the new product contract.

### 2. Make UPC capture complete, consistent, and provisional

Extract a shared capture-to-ledger command from the router's private seam, reusing
the existing durable ledger/review machinery. Route hardware, web, Telegram, and
coach callers through it. Normalize serving basis and preserve nutrition/evidence
on catalog reuse. Adapt portion callbacks into versioned edits of an existing row;
retain safe compatibility for old pending-capture buttons.

Gate: yogurt and chia appear/count as two rows without interaction; a 325 ml shake
is also loggable without pretending ml are grams. A later portion change updates
once, retry/restart cannot add another row, and missing micros cause zero questions.

### 3. Make scale composition durable and independent of message lifetime

Persist placement/entry/deadline state, publish complete provisional measurements,
and change removal from discard to placement close. Late tare updates the same
entry; restart resumes persisted work; new placements cannot inherit old density
or tare. Extend the existing journal/intent mechanism to recover partial linkage.
Ensure a message delivery failure cannot prevent recording the observation.

Gate: the 458 g + 140 kcal/100 g fixture yields one approximately 641 kcal row when
net; immediate removal, delayed tare, failed Telegram, and restart preserve the
same row identity. Explicit clear/dismiss remains respected. Incomplete weight-only
evidence cannot silently become a verified zero-calorie food.

### 4. Unify stabilization and expand the agent's reconciliation authority

Implement durable 72-hour finalization and use the same eligibility function in
read models, repair commits, matching, questions, and scheduling. Add observation
tools and the three bounded agent action types. Replace the two-day cutoff and
blanket already-repaired lock for new provisional records. Add run health/status
so off, preview, processing, failed, and caught-up are distinguishable in Settings.

Gate: stronger evidence corrects a provisional entry quietly; repeated evidence is
a no-op; a protected user correction survives; deadlines close questions and reject
late repairs; disabling/unavailable Mastra cannot stop capture or stabilization.

### 5. Validate, repair the incident, and activate in stages

Run fixture-owned unit/HTTP tests, built desktop/mobile journeys, and a bounded
real-model preview on sanitized incident inputs through the installed runtime.
Check proposed repairs and tool evidence, not just whether the model returns JSON.
Replay a second time: zero new rows, repairs, or questions.

Prepare a version-checked dry-run repair of only the identified September 5 captures
and their linked observations. Preserve original IDs, backup, and before/after
receipts; do not mass-accept all historical pending food or repeat the previous
ledger conversion. Confirm net/gross evidence before treating 641 kcal as measured;
unknown tare can remain an explicit provisional assumption. Keep the morning shake
separate from the user's three-entry example.

Deploy through the existing activity gate. Enable the deterministic capture and
finalization path with quiet delivery first; then preview and activate the updated
auditor with Telegram questions off. Verify runtime settings/run receipts and the
deployed revision. A deployed agent with `enabled: false` is not completion.
Repairing household records and enabling writes are rollout actions, not performed
by creating this plan. Preserve a switch that pauses model repairs while capture,
manual editing, and stabilization continue working.

Gate: read-only verification shows the corrected incident's three counted rows,
coherent totals across Health/coach/reports, linked scale evidence, no unintended
servings, no startup review burst, and a functioning active reconciliation worker.

## Acceptance matrix

| Scenario | Required result |
|---|---|
| Yogurt + chia + separate weighed food | Exactly three counted food rows for this sequence; optional meal association adds no consumption. |
| No clicks for 72 hours | Estimates stabilize, retain provenance, and create zero settlement reminders. |
| Known serving with missing micronutrients | Log usable calories; missing remains unknown; no mandatory review. |
| Broken catalog mass / gram count mismatch | One-serving estimate is preserved; corrected basis scales once; no 1 g fabrication. |
| Weight/density/tare in different valid orders | Same eventual net/calories; one row per placement; no tare double subtraction. |
| Remove immediately after density | Complete evidence survives; one counted provisional row. |
| Second placement; explicit clear; user deletion | No stale density/tare reuse; no resurrection by agent/replay. |
| Scale and barcode mixed in one interaction | Evidence attaches only to a supported target; no arbitrary ingredient-weight allocation. |
| Duplicate delivery versus deliberate second scan | Retry creates nothing new; a genuinely new consumption event remains possible. |
| Crash between ledger write and observation linkage | Journal resumes to one coherent entry and receipt. |
| Human edit during an agent run | Expected-version/deadline conflict prevents overwrite; no automatic nag. |
| Improved evidence after an earlier agent repair | One justified revision; no oscillation on unchanged evidence. |
| Model timeout; Telegram unavailable | Capture persists, deadline still works, bounded recovery, no duplicate sends. |
| Day boundary, DST, backdated entry | Meal date remains intentional; review age uses capture instants; no accidental history rewrite. |
| Stabilization or cosmetic correction only | No daily-report publication or user-message burst. |

Add structured transition receipts for capture outcome, placement close reason,
association/repair decision, stabilization, and notification suppression. Correlate
event/capture/placement/entry/run IDs. Log meaningful transitions at info, raw
frames at sampled debug. Track time-to-counted-entry, unresolved evidence age,
repair outcomes, and outbound question counts so the next incident is explainable
without reverse-engineering storage.

Update the [Health reference](../../reference/health/README.md),
[nutrition reference](../../reference/nutrition/README.md),
[cleanup policy reference](../../reference/health/nutrition-cleanup.md), and
[rollout runbook](../../runbooks/nutrition-cleanup-rollout.md) as each phase lands.
Those references describe shipped behavior today; this plan describes the proposed
replacement for the conflicting capture/confirmation/cleanup rules.
