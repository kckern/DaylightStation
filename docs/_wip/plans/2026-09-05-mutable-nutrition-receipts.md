# Mutable nutrition receipts

Objective: implement the user-provided receipt-pipeline plan. Telegram is a mutable
projection of the same authoritative food ledger as Health, with one receipt
renderer and publisher, not an announcement stream. Preserve the new provisional
capture, guarded reviewer, user protections and silent 72-hour stabilization.

## Completion evidence checklist

- [x] Pure receipt renderer in `1_rendering/nutribot`, golden August 20 and burrito
  fixtures; compact colored quantities, group headings, truthful unknowns.
- [x] One publisher for initial binding, corrections, revisions and removals;
  jobs load current ledger inside a serialized queue, never queued parser results.
- [x] All capture/confirmation/revision final writers routed through publisher;
  processing animation drains before handoff; text/photo bindings persist.
- [x] Telegram controls remain functional after Health/Mastra edits; revision
  snapshot and commit-time versions protect newer edits and stable food IDs.
- [x] Mastra continues proposing through guarded `NutritionRepairService` only;
  no renderer/messaging tools, no reminder or routine-success notifications.
- [x] Rendered-content/control fingerprints suppress invisible changes and
  stabilization edits; linked-message failures retry after restart; no new
  headless messages or blind duplicate sends; first migration baselines history.
- [x] Integration replay: yogurt, chia, and scale create exactly three ingredient
  entries; late evidence, guarded repair, manual correction, restart, stabilization
  leave matching Health/receipt values and unchanged message IDs.
- [x] Existing Health visible-tab polling/invalidation observes Telegram/reviewer
  changes; no receipt or Telegram logic added to `HealthApp.jsx`.
- [x] Architecture regression assertions forbid competing final receipt layouts.
- [x] Targeted and broad tests, API tests, frontend checks, current composition
  and precommit gates pass (record unrelated baseline failures separately).
- [x] Build/deploy gates respected; deployed build verified; exact affected
  receipts previewed, then repaired in place without a history-wide rewrite.
- [x] Canonical docs updated and final requirement-by-requirement audit completed.

## Implementation notes

The old sync worker introduced its own formatter in September 4 commit
`6cf6acb99`; that same commit bypassed the old formatted acceptance path.
Keep the existing rich format but remove the duplicate writer, not just its copy.

Use the established data/controls split: original captures remain evidence;
accepted receipts read the ledger. Group headers remain zero-additive. A checkmark
means saved, not user-confirmed. Finalization does not alter receipt copy/controls.

Selective receipt reconciliation defaults to preview, requires exact log IDs,
and verifies preview fingerprints before edits. It never modifies food records.

## Verification notes

- Final focused Vitest run: 128 files, 1,322 tests passed. Repository commit
  gates passed: filesystem/layer/UI/link/parse checks, 316 SCSS entrypoints and
  all 9 composition contracts. Runtime implementation is `fe62028c3`.
- Real YAML capture/reviewer/Health replay passes: 3 incident entries, 871 kcal,
  late weight/density, manual edits, durable delivery retry and silent stabilization.
- Publisher tests cover quiet migration, selected preview conflicts, serialized
  edits, invisible changes, deleted/foreign messages, restoration and retry caching.
- Revision tests fence all original ledger versions; portion confirmation preserves
  Health placement and remains usable after Health Undo restores a discarded row.
- Browser checks: 8/8 desktop/mobile capture, incident, grouping and reviewer UI
  journeys passed using intercepted fixtures, without household food mutations.
  The voice journey was updated to the existing central quick-capture toolbar.
- Legacy Jest scope: 59 passed; 2 unrelated voice-envelope assertions fail on both
  this branch and unchanged `69d61996c` because the actual payload includes
  `audioRef:null`. The Vitest-importing legacy-router file must use Vitest, not Jest.
- Canonical Health and nutrition-cleanup references describe the new ownership,
  delivery state, reconciliation API and quiet-review behavior.
- Deployed `fe62028c3` after clear pre-build and pre-restart gates; container
  health and build metadata verified. Backed up receipt checkpoints and food
  files first. Previewed exactly the yogurt, chia, scale-food and burrito
  receipts; all four returned `delivery:updated` on their original message IDs.
  The burrito retains its photo caption. Delivery acknowledgements are durable,
  with no unavailable targets. Both capture and consumed-ledger files remained
  byte-for-byte identical to their predeployment backups.
- Scope audit: no food repairs or reviewer configuration changes in this rollout;
  no mass history rewrite or new headless Telegram messages. Existing barcode
  nutrition-verification safeguards remain enforced by the shared review command.
