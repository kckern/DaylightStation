# School Physical Console — Full Lifecycle Build Plan (Phases D–G)

> **For Claude:** Companion to `2026-07-27-school-document-system-plan.md` (Phases A–C).
> This document adds the lifecycle spine, virtual hardware, sample curriculum, and
> the end-to-end harness. Same worktree, same branch.

**Goal:** A complete, testable loop — assign curriculum → scan personal card →
printed agenda → scan a choice → worksheet printed *or* media played → work done →
graded → result receipt → retry on fail → credit on pass → next unit unlocks —
with every hardware endpoint replaced by a virtual double so the whole lifecycle
runs in CI with no physical device.

**Architecture:** `docs/superpowers/specs/2026-07-27-school-physical-console-architecture.md`.
Phases A–C build contracts + rendering + catalog. Phase D builds work sessions and
action tokens. Phase E builds virtual hardware behind the same ports the real
adapters implement. Phase F wires the lifecycle use cases. Phase G ships sample
curriculum and the e2e harness.

**Non-negotiables inherited from the spec:** append-only session events with
derived state; opaque server-owned tokens (no meaning in the barcode); one grading
engine for paper and screen; a stable outcome ID gating all rewards; every failure
path ends in a printed recovery action, never a dead end.

---

## Phase D — Work sessions and action tokens

### Task D1: Session event model + reducer (pure domain)

**Create:** `backend/src/2_domains/school/sessions/sessionEvents.mjs`
**Test:** `tests/isolated/domain/school/sessions/sessionEvents.test.mjs`

- `EVENT_TYPES` closed set: `created, issued, reprinted, media_dispatched,
  media_completed, media_stalled, submitted, graded, outcome_recorded,
  rewarded, remediation_opened, reassigned, failed, abandoned`.
- `createEvent({ type, at, ... })` factory validating per-type payloads; every
  event carries `sessionId` and a monotonically increasing `seq`.
- `reduceSession(events)` → derived state:
  `{ sessionId, learnerId, unitId, state, issuedArtifacts[], attemptIds[],
     mediaDispatch, outcome, rewardTxn, remediationOf, nextAction }`.
- Legal transitions table (a closed map, same posture as the block/type sets):
  `created→issued|media_dispatched|abandoned`,
  `issued→submitted|reprinted|failed|abandoned`,
  `reprinted→submitted|reprinted|abandoned`,
  `media_dispatched→media_completed|media_stalled|abandoned`,
  `media_completed→issued|submitted`,
  `media_stalled→media_dispatched|abandoned`,
  `submitted→graded`,
  `graded→outcome_recorded`,
  `outcome_recorded→rewarded|remediation_opened` (terminal otherwise).
  An illegal transition is recorded as an error in the derived state, never
  silently dropped and never thrown — a corrupt log must still render.
- `reduceSession` is pure and total: unknown event types surface as
  `state.errors[]`.
- **Every non-terminal state must yield a non-null `nextAction`** — assert this
  as a property test across all reachable states. A state with no next action is
  the "wedged session" failure the spec forbids.

> **Correction found during implementation (2026-07-27).** The transition table
> above lists `issued→failed` but gives `failed` no outgoing edges, which reads
> as a terminal dead end — directly contradicting §9, where a failed print must
> leave the token valid so the next scan retries. `failed` and `reassigned` are
> therefore **annotations, not states**: they record a fact, are legal at any
> non-terminal state, and leave `state` unchanged. A retry after a print failure
> is a `reprinted` event (already legal from `issued`), with the pending failure
> surfacing as `lastFailure` plus a reprint `nextAction`. `reassigned` behaves
> the same way — it re-credits work without moving the lifecycle (§5.3).
> Terminal states are exactly `rewarded`, `remediation_opened`, and `abandoned`.

Commit: `feat(school): work-session event model and reducer`

### Task D2: Outcome + reward idempotency (pure domain)

**Create:** `backend/src/2_domains/school/sessions/outcome.mjs`
**Test:** `tests/isolated/domain/school/sessions/outcome.test.mjs`

- `outcomeIdFor(sessionId)` → `out:${sessionId}` (deterministic, the reward `ref`).
- `evaluateOutcome({ gradedPercent, passingPercent, requiresSignoff, signedOff })`
  → `{ result: 'passed'|'needs_remediation', reason }`.
- `rewardDecision({ outcome, unitReward, existingRewardTxn, economyEnabled })`
  → `{ award: boolean, amount, ref, skipReason }`. MUST return `award:false` when
  `existingRewardTxn` is present (School's own durable guard — the economy's
  replay guard is per-UTC-day and cannot see across days), when the outcome is
  not `passed`, when the unit has no reward policy, when the economy is disabled,
  or when sign-off is required and absent.
- Test the cross-day double-pay scenario explicitly.

Commit: `feat(school): outcome evaluation and reward idempotency rules`

### Task D3: Token semantics (pure domain)

**Create:** `backend/src/2_domains/school/sessions/tokens.mjs`
**Test:** `tests/isolated/domain/school/sessions/tokens.test.mjs`

- `TOKEN_CLASSES` closed set: `identify, select_unit, issue_document,
  media_action, remediation, recovery`.
- `mintToken({ class, subject, at, rng })` → `{ token: 'sch:<opaque>', ... }`.
  The opaque part comes from an injected `rng` (pure/testable); it encodes
  NOTHING — no learner id, no unit id, no policy.
- `resolveTokenState(record, { sessionState, now })` →
  `{ status: 'actionable'|'already_done'|'expired'|'unknown', message }`.
  Per the spec: `identify` never expires and is reusable; selection/media/
  remediation are renewable and valid until the session leaves the state that
  makes them meaningful — re-scan while valid re-executes idempotently,
  re-scan after the state advanced returns `already_done` with a friendly
  message (never an error); `recovery` is valid while the session is open and
  only ever reprints.
- Prefix helpers: `isSchoolToken(code)` (`sch:` prefix, used by the relay branch).

Commit: `feat(school): opaque action token semantics`

### Task D4: Session + token repositories (ports + YAML adapters)

**Create:**
- `backend/src/3_applications/school/ports/IWorkSessionRepository.mjs`
  (`appendEvent`, `readEvents(sessionId)`, `listOpenForLearner(learnerId)`, `nextSeq`)
- `backend/src/3_applications/school/ports/ITokenRegistry.mjs`
  (`put(record)`, `get(token)`, `revoke(token)`)
- `backend/src/1_adapters/persistence/yaml/YamlWorkSessionDatastore.mjs` (extends the port)
- `backend/src/1_adapters/persistence/yaml/YamlTokenRegistry.mjs` (extends the port)
**Test:** `tests/isolated/adapter/school/workSessionDatastore.test.mjs`,
`tests/isolated/adapter/school/tokenRegistry.test.mjs` (temp dirs)

Layout per spec §5.1: `<dataDir>/apps/school/sessions/{YYYY-MM-DD}/{sessionId}/events.yml`
(append-only) plus a per-day index `index.yml` for open-session lookup, and
`<dataDir>/apps/school/tokens/{token}.yml`. Serialize appends through a promise
chain (the `barcodeRelay.mjs` read-modify-write guard is the house precedent —
read it). A malformed session file isolates to itself.

Commit: `feat(school): work-session and token persistence`

---

## Phase E — Virtual hardware (the e2e enabler)

**Principle:** every virtual device implements the SAME port/interface as the
real adapter, records what it was asked to do, and lets a test drive its inbound
events. No production code branches on "am I in test mode" — composition chooses
the double. Each double also exposes a tiny HTTP surface (Phase E5) so a human
can drive the loop from a browser without hardware.

### Task E1: Virtual laser printer

**Create:** `backend/src/1_adapters/hardware/laser-printer/VirtualLaserPrinterAdapter.mjs`
**Test:** `tests/isolated/adapter/school/virtualLaserPrinter.test.mjs`

Same surface as `LaserPrinterAdapter` (read it first): `printPdf(buffer, opts)`,
`getStatus()`, `ping()`. Writes each job to `<captureDir>/{jobId}.pdf` plus a
`{jobId}.json` sidecar (bytes, pageCount, timestamp, requestedBy). Test-controllable
fault injection: `setFault('offline'|'jam'|null)` so the recovery paths in the
lifecycle are exercisable — an offline printer must produce the queued/pending
behavior, not a crash.

### Task E2: Virtual thermal printer

**Create:** `backend/src/1_adapters/hardware/thermal-printer/VirtualThermalPrinterAdapter.mjs`
**Test:** `tests/isolated/adapter/school/virtualThermalPrinter.test.mjs`

Same surface as `ThermalPrinterAdapter` (`print`, `ping`, `getStatus`, the
`createReceiptPrint`/`createImagePrint` item shapes). Captures each receipt as
PNG + a decoded text transcript (the text items in order) so tests can assert
"the receipt told the child to rescan" without OCR. Same fault injection.

### Task E3: Virtual scanner (barcode/NFC card)

**Create:** `backend/src/1_adapters/hardware/scanner/VirtualScannerAdapter.mjs`
**Test:** `tests/isolated/adapter/school/virtualScanner.test.mjs`

Emits the same normalized scan event the real relay publishes
(`{ source:'barcode-relay', device, route, code, ts }`) onto an injected event
bus. Note: `type:'scan'` belongs to the *inbound* WebSocket message and is
dropped on re-broadcast — verified against `barcodeRelay.mjs`, which is the
authority here. API: `scan(code, { device })`, plus `scanCard(learnerId)`
convenience that looks up the learner's registered card token. Must support
double-scan (replay) so idempotency is testable.

### Task E4: Virtual playback target + virtual OMR reader

**Create:** `backend/src/1_adapters/hardware/playback/VirtualPlaybackAdapter.mjs`,
`backend/src/1_adapters/hardware/omr/VirtualOmrReader.mjs`
**Test:** `tests/isolated/adapter/school/virtualPlayback.test.mjs`,
`tests/isolated/adapter/school/virtualOmr.test.mjs`

- Playback: `dispatch({ target, contentId, learnerId })` returns a dispatchId and
  records it; `playToEnd(dispatchId)` emits the completion signal the lifecycle
  correlates on; `interrupt(dispatchId)` emits nothing (drives the stall path);
  `getStatus()` mirrors the playback-hub status shape.
- OMR: `scanSheet({ formMap, chosen })` — takes a **real form map** produced by
  the PDF renderer plus a chosen answer per item, and synthesizes the normalized
  sheet event (`{ source:'omr-relay', type:'sheet', id, columns,
  markedColumns, marks[] }` per `docs/reference/omr/README.md`). Support
  `ambiguous: ['q3']` (two marks in one row) and `blank: ['q4']` so the
  review-queue paths are exercisable. This is what makes OMR testable years
  before the hardware is assembled.

### Task E5: Virtual device console (HTTP + minimal UI)

**Create:** `backend/src/4_api/v1/routers/schoolVirtualDevices.mjs`,
`frontend/src/modules/Admin/School/VirtualConsole.jsx`
**Test:** `tests/isolated/api/school/virtualDevices.test.mjs`

Mounted ONLY when the virtual doubles are wired (composition flag
`school.virtualDevices: true` in `school.yml`, default false — fail-closed).
Routes: `GET /api/v1/school/devices/captures` (list printed jobs/receipts),
`GET .../captures/:id` (fetch the PDF/PNG), `POST .../scan` `{code}`,
`POST .../playback/:dispatchId/complete`, `POST .../omr/submit`
`{ formId, answers }`, `POST .../fault` `{ device, fault }`.
The Admin page renders: captured worksheets/receipts inline, a scan box
(type or click a token from the last receipt), playback complete/interrupt
buttons, an OMR answer-entry grid built from the form map, and fault toggles.
This is the "virtual e2e testing" surface a human drives.

---

## Phase F — Lifecycle use cases

Each is a use case in `backend/src/3_applications/school/usecases/`, constructor-
injected, no concrete adapters (D1), no FileIO (D5). Test each with fakes in
`tests/isolated/application/school/`.

### Task F1: `AssignCurriculum` + `BuildAgenda`
Planner policy is pure (`backend/src/2_domains/school/planner.mjs`, tested
separately): given learner, catalog, session history, and now → what is
expected, available, and next. Assignments persist to
`<dataDir>/apps/school/assignments/{learnerId}.yml` (parent-editable; written by
the Admin surface). `BuildAgenda` composes the agenda **document** (typed blocks
from Phase A) with one `scan_action` per offered choice, minting tokens for each.

### Task F2: `ResolvePersonalCard` + `ResolveScanAction`
The single entry point behind the relay's `sch:` branch. Resolves the token,
routes by class, and ALWAYS returns a physical response (a receipt/PDF to print),
including for expired/unknown tokens (an explanation slip). Idempotent per
`resolveTokenState`.

### Task F3: `IssueDocument`
Mints tokens, renders through the Phase B renderer, sends to the laser printer
port, records `issued` (or `reprinted` with the same artifact ID) on the session.
Handles printer-offline → `print_pending` + recovery action.

### Task F4: `DispatchMedia` + `RecordMediaCompletion`
Target policy (`child_selectable`), dispatch through the playback port, correlate
completion, `media_stalled` after duration+grace, and release the linked
quiz/form issue action only on `media_completed`.

### Task F5: `SubmitPaperWork` + `GradeSubmission`
Maps form entries (itemId → given) through the EXISTING `SchoolService` grade
path, producing normal attempts with the additive `transport: 'paper'` field.
Ambiguous/blank OMR rows and free-response items route to the review queue
instead of grading.

### Task F6: `CloseSessionOutcome` (receipt, retry, credit, progression)
Evaluates the outcome, prints the result receipt (score, objectives to revisit,
and opaque retry/remediation/next-unit actions), opens a linked remediation
session with a **new document variant** on fail, calls `EconomyService.earn` via
the reward decision on pass, and reports the newly unlocked next unit for a
sequential course.

### Task F7: Composition wiring
`app.mjs` (or `5_composition`): construct the datastores, token registry, the
real-or-virtual hardware doubles by config, register the `sch:` branch at the TOP
of the relay `onScan` router, and register the session/planner reporter with
`GetSchoolReport`. Add the API routes for the lifecycle.

---

## Phase G — Sample curriculum and the end-to-end harness

### Task G1: Sample math curriculum (real YAML, multi-unit sequence)

**Create** under `data/content/school/` in-repo fixtures mirrored at
`tests/_fixtures/school/curriculum/`:
- A course `math-fractions` with **four sequenced units**, enough to prove
  gating and progression:
  1. `math-fractions.01` — video unit (media manifest) + post-video quiz bank.
  2. `math-fractions.02` — printed worksheet (document with math blocks +
     answer spaces) graded by parent review.
  3. `math-fractions.03` — printed OMR quiz (document with `omr_response`
     blocks) graded by the virtual OMR reader.
  4. `math-fractions.04` — mixed: audio manifest + worksheet.
- Matching question banks in the existing bank format, matching documents in the
  Phase A document format, matching manifests, all `reviewState: approved`, with
  a reward policy on units 2 and 3 (one requiring sign-off, one not).
- Must pass `ValidateCatalog` (Phase C) with zero errors.

### Task G2: The lifecycle e2e harness

**Create:** `tests/isolated/e2e/school/lifecycle.e2e.test.mjs` plus
`tests/_lib/school/lifecycleHarness.mjs`

The harness constructs the full object graph with virtual hardware and a temp
data dir — real use cases, real domain, real renderers, real persistence, fake
devices only. It exposes a fluent driver: `harness.scanCard('kid')`,
`harness.lastReceiptText()`, `harness.scanTokenLabeled(/worksheet/)`,
`harness.printedPdfs()`, `harness.playToEnd()`, `harness.omrSubmit({q1:'B'})`,
`harness.parentGrades({...})`, `harness.coinsFor('kid')`.

**Scenarios to assert (each its own test):**
1. **Happy path, video unit:** assign course → scan card → agenda prints listing
   unit 1 → scan the unit action → media dispatched → play to end → quiz form
   prints → submit correct answers → graded pass → result receipt prints →
   unit 2 unlocks.
2. **Happy path, worksheet unit:** scan → worksheet PDF printed (assert it is a
   real multi-page PDF with a form map) → parent grades → pass → receipt.
3. **OMR unit:** worksheet printed → virtual OMR scans the real form map →
   grades through the canonical engine → pass.
4. **Fail then retry:** submit wrong answers → receipt says needs remediation and
   carries a retry action → scan retry → a NEW document variant prints (different
   seed, same unit) → pass on second attempt → credit awarded ONCE.
5. **Idempotency sweep** — drive the spec's matrix: double-scan card (one
   session), double-scan selection (no duplicate), reprint (same artifact id, new
   lineage event), duplicate submission (rejected, points at existing result),
   re-scan media mid-play (no second dispatch), outcome twice (one outcome
   record), earn retried across a simulated day boundary (no second payout).
6. **Failure recovery:** printer offline at issue time → session records pending
   and the child gets a recovery action → printer back → reprint succeeds.
7. **Media interruption:** dispatch, never complete, advance the clock past
   duration+grace → `media_stalled` → recovery action offers replay.
8. **Gating:** unit 3 cannot be selected before unit 2 passes, and the agenda
   says WHY (the lock always names the remedy).
9. **Guest/unclaimed:** no identity → no session, no records, and the receipt
   explains rather than failing silently.

Clock must be injectable (no `Date.now()` in the harness path) so day-boundary
and grace-window scenarios are deterministic.

### Task G3: Smoke test + docs

- `npm run test:isolated` passes end to end.
- A `school:smoke` script that boots the composition with virtual devices,
  runs scenario 1, and prints a PASS/FAIL summary — the "does the whole thing
  still work" one-liner.
- Update `docs/reference/school/README.md` with the new subsystem sections
  (document system, work sessions, tokens, virtual devices, lifecycle) and mark
  roadmap delivery items 1–6 accordingly.

---

## Sequencing

Phases A–C first (contracts and rendering are dependencies of everything).
D can start once A2 lands. E is independent of everything and can run in
parallel with D. F requires D+E+C. G requires all.

**Review weight:** two-stage review (spec then quality) for domain and lifecycle
tasks where a bug is silent and expensive; single combined review for the virtual
doubles and fixtures where the e2e harness itself is the check.
