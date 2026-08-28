# SP1 — Ask Platform Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the ask pipeline (schema → resolve → present → grade → record) into `frontend/src/modules/Piano/ask/` as `askSchema.js` + `AskSession.jsx`, and re-seat all four existing hosts on it — with no visible change except the program/video framing lines (bug-report C1).

**Architecture:** A pure schema module becomes the single source of truth for the nine ask axes, their constraints, and the tier presets. `AskSession` takes over material resolution, requirement building, ask copy, and framing from `GameGate.serve()` and `ExerciseRun.loadInstance()`; `ExerciseRun` slims to presentation+grading; `GameGate` slims to ladder+rotation+stake. The move is mechanical — behaviour is pinned by ~5,000 existing tests that must pass unmodified except where they asserted the smear itself.

**Tech Stack:** React 18, vitest (+ happy-dom, @testing-library/react), the existing Chromium measure harness (must pass unchanged).

**Spec:** `docs/superpowers/specs/2026-08-28-sp1-ask-platform-design.md` (parent roadmap alongside it).

## Global Constraints

- **No visible change** except the two C1 framing lines (program: *"Pass this to finish {step title}"*; video checkpoint: its course title framing). Everything else byte-identical on screen.
- The existing suites are the regression net: Exercises, Games, gateEvents, `useGameBudgetMeter`, both Chromium measure specs (`ExerciseRun.measure.test.jsx` 15 scenarios, `GameGate.measure.test.jsx` 4) — pass **unmodified** except assertions on the smear itself, which move to the new boundary, never weakened.
- Reason vocabularies are frozen: `onUnavailable` reasons `no-access | instance-not-found | unrunnable`; material decline reasons `no-score-source | no-collection-or-instance | unknown-material-kind | instance-unavailable | catalog-unavailable | score-unavailable | score-material-phase-2(gone)`; `onFailed` fires for judged attempts only (`completed ∪ timeout`, `aborted` excluded); mode vocabulary `free | cued`.
- The ladder is **gate-host state**, never session state. Rotation (`pickMaterial`, retry-hold via `retryRef`) stays in `GameGate`. The config-vs-infrastructure substitution policy (`isConfigOnlyDecline` → `FALLBACK_LEVEL`) stays in `GameGate`; `AskSession` surfaces reasons, never decides policy.
- `prompt: recall` and `hints ≠ none` validate as grammar but return `not-yet-implemented` errors (SP2 ships them). The live YAML is untouched; legacy `{tier, material, grading}` levels keep working through `expandAsk`.
- D9 (unfailable floor), D12, the 20s stall, auto-arm order (`start` then `observe` of the arming note), count-in mechanics: all preserved exactly; the extraction must not change effect ordering inside `ExerciseRun`.
- Referential-stability obligations move with props: whoever constructs `materialSpec`/`ask` objects memoizes them.
- No raw `console.*`. Never `git stash`; never bare `git checkout <file>` with uncommitted work (scratchpad copies for teeth checks).
- Test invocation: `npx vitest run --config vitest.config.mjs <paths>` from the worktree root.

## Verified current-state facts (from the shipped branch; re-verify only if contradicted)

- `ExerciseRun.jsx` props today: `{ instanceId, material, intent, practiceMode, programId, stepId, requirementOverride, framing, ask, tier, onExit, onPassed, onFailed, onUnavailable }`. Its `loadInstance` resolves `material` via `resolveGateMaterial`; requirement selection is `requirementOverride ?? step?.requirement`; program fetch happens inside; `runPassed`/`JUDGED_STATUSES`/stall/auto-arm all live here and DO NOT MOVE.
- `GameGate.jsx` `serve()` today: resolve repertoire → level → `pickMaterial` → resolve material (`resolveGateMaterial`/`keysInstance` via `pickGateMaterial`) → `requirementForLevel(level)` → `askForMaterial(spec, instance)` → sets `attempt` state → renders `ExerciseRun` with framing/ask/tier/requirementOverride/material. Substitution policy `isConfigOnlyDecline` + `FALLBACK_LEVEL`; events (`gate.*`) with four identity fields; `retryRef` reuse of `attempt.material`.
- `gateAsk.js` exports `requirementForLevel`, `askForMaterial`, `framingFor({kind:'gate'|'program'|'practice', …})` — `framingFor`'s program branch has NO production caller yet (C1).
- `runPresentation.js` exports `deriveRunTier`, `stageForTier`, `sequenceStaffCanDraw`, `clefForAsk`, `clefForInstance`, `accidentalForKey`, `instanceKeySignature`.
- `Exercises.jsx:396-420` `ExerciseRunRoute` mounts `ExerciseRun` raw with query params; video checkpoints arrive as `intent=challenge&requirement=<json>&return=<path>`.
- Tier presets in behaviour today: 0 keys/no-staff, 1 keys+small-staff, 2 sequence-staff (with `sequenceStaffCanDraw` fallback to notation), 3 notation+cued. `ordering:'any'` forces the keys stage.
- The live config's repertoire levels are legacy-shaped `{id, tier, grading?, material}`; users carry `startLevel`.

## File Structure

```
frontend/src/modules/Piano/ask/
  askSchema.js         NEW   axes, constraints, presets, expandAsk, validateAsk
  askSchema.test.js    NEW
  AskSession.jsx       NEW   the seam (resolution, requirement, copy, framing)
  AskSession.test.jsx  NEW   contract tests
  gateAsk.js           MOVED from modes/Games/ (imports updated; re-export shim left behind)
frontend/src/modules/Piano/PianoKiosk/modes/Exercises/
  ExerciseRun.jsx      SLIMMED  material-resolution + requirement-selection move up
  Exercises.jsx        ExerciseRunRoute mounts AskSession
  runPresentation.js   stage/clef resolution re-exported through askSchema (thin shim)
frontend/src/modules/Piano/PianoKiosk/modes/Games/
  GameGate.jsx         SLIMMED  serve() picks; AskSession resolves
```

---

### Task 1: `askSchema.js` — axes, constraints, presets, expansion

**Files:**
- Create: `frontend/src/modules/Piano/ask/askSchema.js`
- Test: `frontend/src/modules/Piano/ask/askSchema.test.js`

**Interfaces — Produces (pure):**

```js
AXES                       // { texture:[...], hands:[...], source:{synthesized:{params},bank:{params},score:{params}},
                           //   prompt:[...], secondary:[...], notationStyle:[...], timing:[...], judging:[...], hints:[...] }
PRESETS                    // { 'tier-0':{prompt:'follow',secondary:'none',timing:'free',judging:'completion'},
                           //   'tier-1':{...+secondary:'staff'}, 'tier-2':{prompt:'read',secondary:'keyboard-strip',
                           //   notationStyle:'sequence',timing:'free',judging:'completion'},
                           //   'tier-3':{prompt:'read',secondary:'keyboard-strip',notationStyle:'engraved',
                           //   timing:'cued',judging:'placed'} }
expandAsk(levelLike) → { material, presentation, grading, errors:[] }
                           // legacy {tier,material,grading} → preset expansion;
                           // explicit {material,presentation,grading} → presets overridden key-by-key
validateAsk(tuple) → { ok, errors:[] }
                           // executable constraints: placed⇒cued; recall⇒source!=='score';
                           // sequence style ⇒ single-hand ≤2 octaves; polyphony⇒engraved|score;
                           // recall / hints!=='none' → 'not-yet-implemented: <axis>'
```

- [ ] **Step 1: Failing tests** — table-driven: every axis value listed in `AXES` is accepted and every out-of-vocabulary value rejected with a named error; all four tier presets expand to the exact tuples above (pinned `toEqual`); explicit keys override preset values; each constraint rejects its named violation and passes its boundary (`cued` without `placed` is fine; `placed` without `cued` is not); `recall` and `hints:'after-stall'` yield `not-yet-implemented` errors; a legacy live-config level (`{id:'L1',tier:2,material:[{kind:'exercise',…}]}`) expands without errors.
- [ ] **Step 2: Verify failure** (module not found). **Step 3: Implement** (~120 lines, data + pure functions). **Step 4: Verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(piano): the ask schema — nine axes, executable constraints, tiers as presets"`

---

### Task 2: Stage resolution consolidates under the schema

**Files:**
- Modify: `frontend/src/modules/Piano/ask/askSchema.js` (adds `deriveStage`)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/runPresentation.js` (becomes a re-export shim for the moved pieces; keeps what only `ExerciseRun` uses)
- Test: extend `askSchema.test.js`; `runPresentation.test.js` keeps passing via the shim

**Behaviour contract:** `deriveStage(tuple, instance)` reproduces today's routing exactly: `follow` → `keys` stage (staff per `secondary`); `read` + `sequence` → sequence stage unless `sequenceStaffCanDraw` refuses → notation; `read` + `engraved`/`score` → notation/score stages; `ordering:'any'` still forces keys. `sequenceStaffCanDraw`, `clefForAsk`, `clefForInstance`, `instanceKeySignature`, `accidentalForKey` move to `ask/` with `runPresentation.js` re-exporting them so no import elsewhere changes in this task.

- [ ] **Step 1: Failing tests** — the truth table from the Task-6 review of the last branch, re-expressed over tuples: {each preset} × {ordering any/strict} × {canDraw yes/no} → stage; every existing `runPresentation.test.js` case must have an equivalent tuple case here.
- [ ] **Step 2–4: Fail → implement (move + adapt, don't rewrite) → pass**, then the whole Exercises directory green via the shim.
- [ ] **Step 5: Commit** — `git commit -m "refactor(piano): stage resolution answers to the schema, one owner"`

---

### Task 3: `AskSession.jsx` + the `ExerciseRun` slim

**Files:**
- Create: `frontend/src/modules/Piano/ask/AskSession.jsx`
- Create: `frontend/src/modules/Piano/ask/AskSession.test.jsx`
- Move: `modes/Games/gateAsk.js` → `ask/gateAsk.js` (re-export shim left at the old path)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ExerciseRun.jsx`

**Interfaces — Produces:**

```jsx
<AskSession
  ask={levelLike}                    // expandAsk + validateAsk inside; invalid → onUnavailable('unrunnable') + warn
  materialSpec={spec}                // optional; the host-picked spec (gate). Absent → instanceId/programId path
  instanceId={id} programId={p} stepId={s} requirementOverride={r}   // the practice/program/video plumbing
  intent practiceMode
  framing={string|{kind,…}|null}     // string passes through; object → framingFor; null+programId → computed program framing
  onPassed onFailed onExit onUnavailable
/>
```

**The move, mechanically:**
1. `ExerciseRun` loses its `material` prop and `loadInstance`'s material branch; loses requirement *selection* (`requirementOverride ?? step?.requirement`) and the program fetch; gains `instance` + `requirement` + `framing` + `ask` + `tier` as plain inputs (already has the last three). Its effect ordering, stall, auto-arm, count-in, stages, persistence: untouched. Every `ExerciseRun.component.test.jsx` case updates its mount to supply `instance`/`requirement` directly where it previously exercised the moved branch — same assertions, new boundary; cases that test presentation/grading change **not at all**.
2. `AskSession` takes over: material resolution (`resolveGateMaterial`/`keysInstance` for a `materialSpec`; `pianoLearningApi.instance` for an `instanceId`), the program/checkpoint fetch, requirement building (`requirementForLevel(level)` when `ask` given; `requirementOverride ?? step.requirement` otherwise), `askForMaterial` copy, `framingFor` — including the program branch, computed from the fetched step title (C1's production caller).
3. Resolution failures surface as today's exact reasons through `onUnavailable`; a schema-invalid `ask` is `unrunnable` with a `piano.ask-invalid` warn naming the errors.

- [ ] **Step 1: Failing contract tests** — with a fake api: gate-shaped mount (ask+materialSpec) resolves, builds the completeness requirement, passes framing/ask/tier to the inner component (mock `ExerciseRun`, assert props); practice-shaped mount (instanceId, no framing) yields `framing: null` and the instance; program-shaped mount computes *"Pass this to finish {title}"* from the fetched program; video-shaped mount (requirementOverride + return) keeps the requirement identity (`toBe`); each `onUnavailable` reason for: schema-invalid ask, `instance-unavailable`, unknown material kind; callbacks pass through 1:1.
- [ ] **Step 2–4: Fail → implement → pass**, then the FULL Exercises + Games directories and both Chromium specs — the measure specs mount `ExerciseRun` directly and must pass with the slimmed component (their fixtures pass `instance`-equivalent props already via mocks; if a fixture exercised the moved branch, update its mount, not its assertions).
- [ ] **Step 5: Commit** — `git commit -m "feat(piano): AskSession — one seam between a host and a judged attempt"`

---

### Task 4: `GameGate` on the seam

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Games/GameGate.jsx`
- Test: update `GameGate.test.jsx`, `gateEvents.test.jsx` mounts/mocks at the new boundary

**Behaviour contract:** `serve()` = resolve repertoire → level → `pickMaterial` (rotation + retry-hold IDENTICAL) → set attempt `{level, spec}` — and stops. Render mounts `<AskSession ask={level} materialSpec={spec} framing={framingFor({kind:'gate', gameLabel})} …/>`. The substitution policy moves its trigger: `AskSession`'s `onUnavailable` reasons feed the SAME `isConfigOnlyDecline`/fail-open split the gate runs today (config-class → `FALLBACK_LEVEL` substitute + `gate.material-config-invalid`; infrastructure → `gate.unavailable` + grant). Events, identity fields, panels, ladder movement (judged-failures only), `no-access` non-granting: byte-identical.

- [ ] **Step 1: Failing tests** — update the `ExerciseRun` module mock to an `AskSession` mock at the new path; every existing gate spec keeps its assertion; add: the gate never imports `resolveGateMaterial`/`requirementForLevel` directly anymore (a boundary test: the AskSession mock receives `ask`+`materialSpec` and the gate performs no resolution of its own — assert the api mocks uncalled from the gate's own serve).
- [ ] **Step 2–4: Fail → implement → pass**, full Games directory + `GameGate.measure.test.jsx`.
- [ ] **Step 5: Commit** — `git commit -m "refactor(piano): the gate keeps the ladder and the stakes, the session does the asking"`

---

### Task 5: Practice, program, and video hosts on the seam — C1 closes

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/Exercises.jsx` (`ExerciseRunRoute` mounts `AskSession`)
- Test: extend `ExerciseRun.component.test.jsx` (or a new route-level spec) for the two framing lines

**Behaviour contract:** the route passes its query plumbing to `AskSession` unchanged. Practice: `framing null`, title-as-headline preserved (existing assertions prove it). Program challenge: header shows *"Pass this to finish {step title}"*. Video checkpoint: framing from the checkpoint's course/title context (`requirementOverride` + `return` flow otherwise identical). Bug report C1 row flips to resolved; the reference doc sentence rescoped in Task 11 of the last branch gets its "gate only" caveat lifted.

- [ ] **Step 1: Failing tests** — program-challenge mount renders the framing line (the C1 assertion that could never pass before); practice mount renders the title exactly as today (pin before changing); video-checkpoint mount keeps requirement identity and the return navigation.
- [ ] **Step 2–4: Fail → implement → pass**, full Exercises + Games + MusicNotation.
- [ ] **Step 5:** Update `docs/_wip/bugs/2026-08-28-match-gate-challenge-is-unreadable.md` C1 row (Partly → Resolved, one line) and the reference doc's framing sentence.
- [ ] **Step 6: Commit** — `git commit -m "feat(piano): every host says why the screen exists — C1 closed"`

---

### Task 6: Sweeps, gate, deploy

- [ ] **Step 1:** `npx vitest run --config vitest.config.mjs frontend/src/modules/Piano/ frontend/src/modules/MusicNotation/` — expect ≥ 411 files green, zero modified-assertion regressions.
- [ ] **Step 2:** `npm run test:unit:vitest` once. Known pre-existing reds on main (two ScreenProvider mock gaps, `band.measure`) are not yours; a NEW failing file in this branch's files is. Do not baseline.
- [ ] **Step 3:** Coordinator deploys per house rules (gate → build → gate → deploy; no config change this SP — the live YAML is legacy-shaped and `expandAsk` serves it).
- [ ] **Step 4: Commit** any doc corrections found — `git commit -m "feat(piano): the ask platform foundation — four hosts, one seam"`

## Self-review (performed while writing)

- **Spec coverage:** schema/SSoT → T1; presets-as-tiers → T1; stage resolution one-owner → T2; AskSession ownership list → T3; ExerciseRun slim boundaries → T3; gate keeps ladder/rotation/policy → T4; four hosts + C1 → T4/T5; no-visible-change + suites-as-net + Chromium unchanged → every task's step 4 + T6; not-yet-implemented recall/hints → T1; legacy config compat → T1 (`expandAsk`) + T6 step 3.
- **Placeholder scan:** none. Exact values are drawn from the verified-facts block; movers are named function-by-function.
- **Type consistency:** `levelLike`/`expandAsk` shape identical in T1/T3/T4; `materialSpec` naming consistent; reason strings frozen in Global Constraints and repeated nowhere else.
- **Risk note:** T3 is the big one (two heavily-tested files change hands). Its guard is the instruction to move-not-rewrite and the requirement that presentation/grading tests change *not at all*.
