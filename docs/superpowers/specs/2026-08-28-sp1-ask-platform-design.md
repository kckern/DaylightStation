# SP1 — The Ask Platform Foundation

**Date:** 2026-08-28
**Parent roadmap:** `docs/superpowers/specs/2026-08-28-ask-platform-roadmap-design.md`
**Contract:** no visible change except the two framing lines bug-report C1 was about.
Today's entire suite stays green; the Chromium authority runs unchanged.

## What exists today (the smear SP1 ends)

Ask-posing is split across two components with duplicated responsibilities:

- `GameGate.jsx` owns repertoire+ladder (rightly) **and** requirement-building, ask
  copy, framing, and the knowledge of which `ExerciseRun` props exist (wrongly — every
  new host would re-learn all of it).
- `ExerciseRun.jsx` owns presentation and grading (rightly) **and** material resolution
  (`loadInstance`/`resolveGateMaterial`), program fetching, and requirement selection
  (`requirementOverride ?? step?.requirement`) — resolution concerns a session wrapper
  should own.
- The practice/program/video callers (`Exercises.jsx:396-420`) mount `ExerciseRun` raw
  with query-string plumbing and **no framing/ask** — which is why C1 is still "Partly".

## The pieces

### 1. `frontend/src/modules/Piano/ask/askSchema.js` — the single source of truth

Pure module. Exports:

- `AXES` — the nine axes, their values, and per-value parameter schemas (the roadmap's
  MECE table, as data).
- `validateAsk(tuple)` → `{ ok, errors[] }` — executable constraint table (placed⇒cued,
  recall⇒source≠score, sequence-style bounds, …). `prompt: recall` and
  `hints ≠ none` validate as *grammar* but return
  `{ ok: false, errors: ['not-yet-implemented: recall'] }` until SP2 ships them — a
  config authoring one early gets a distinct, queryable rejection, never a silent drop
  or a broken screen.
- `PRESETS` — today's tiers as named bundles
  (`tier-0` = ⟨follow, none, —, free, completion⟩ … `tier-3` = ⟨read, keyboard-strip,
  engraved, cued, placed⟩), exactly reproducing current behaviour.
- `expandAsk(levelLike)` → full tuple — accepts BOTH shapes: the legacy repertoire
  level (`{tier, material, grading}`) and the new explicit form
  (`{material, presentation, grading}`); explicit keys override preset values.
- `deriveStage(tuple, instance)` — the presentation-resolution now in
  `runPresentation.js` (`stageForTier`, `sequenceStaffCanDraw`, clef/accidental
  helpers move here or are re-exported here; one owner, `runPresentation` becomes a
  thin re-export until callers migrate).

The reference doc's axis tables cite this module as their source; SP4 makes the
generation mechanical.

### 2. `frontend/src/modules/Piano/ask/AskSession.jsx` — the seam

```jsx
<AskSession
  ask={levelLike}            // schema-validated; expandAsk applied inside
  materialSpec={spec}        // the PICKED spec (rotation stays with the host)
  framing={string | {kind, ...}}   // a string passes through; an object goes to framingFor
  onPassed={(result) => …}
  onFailed={(result) => …}   // judged attempts only (completed ∪ timeout)
  onExit={() => …}
  onUnavailable={(reason) => …}   // carries the SAME reason vocabulary hosts key on today
/>
```

Owns, moved from the current owners:

- **Material resolution** — `resolveGateMaterial` / `keysInstance` calls (from
  `GameGate.serve`) and `ExerciseRun.loadInstance`'s material path. Reason
  classification (config-class vs infrastructure) is *surfaced*, not decided —
  `onUnavailable(reason)` keeps the exact reason strings; the gate's
  fail-open/substitute policy stays in the gate.
- **Requirement building** — `requirementForLevel` (from `gateAsk.js`, which moves to
  `ask/`), and for program/video contexts the existing
  `requirementOverride ?? step.requirement` selection.
- **Ask copy** — `askForMaterial(spec, instance)`.
- **Framing** — `framingFor`; when mounted with `programId/stepId` it computes the
  program framing from the step it already fetches (C1's missing production caller,
  closed here, with no route changes).
- **Presentation + grading + evidence** — by mounting `ExerciseRun`, which SLIMS: its
  `material`-resolution branch and requirement selection move up; it keeps stages,
  start model, stall, grading, persistence. Its props contract otherwise unchanged so
  the entire component test suite keeps passing against the inner component, and
  AskSession gets its own contract tests.

### 3. The four host migrations (all in SP1)

- **GameGate** — `serve()` stops resolving/building; it picks (`pickMaterial`,
  retry-hold unchanged), then renders `AskSession` with the level, the spec, and gate
  framing. Ladder state, rotation, substitution policy, fail/no-access panels, events:
  unchanged, still gate-owned. `gateAsk.js` moves to `ask/` (gate imports follow).
- **Practice route** — `ExerciseRunRoute` mounts AskSession (`framing: null` — practice
  keeps the title-as-headline behaviour, pinned by existing tests).
- **Program steps / video checkpoints** — same route, `programId`/`requirement` present:
  AskSession supplies framing (*"Pass this to finish {step title}"* / the checkpoint's
  course title). The ONLY visible change SP1 ships.

## Explicit non-goals (SP2–SP4 own them)

No recall/hints/pitchClass, no engraved-free, no new hosts, no config-grammar rollout
(the live YAML is untouched; legacy levels keep working through `expandAsk`), no bank
content, no doc generation.

## Testing

- `askSchema` unit: every axis value round-trips; every constraint rejects its named
  violation; both level shapes expand to identical tuples for today's four tiers;
  `not-yet-implemented` rejections for recall/hints.
- `AskSession` contract tests: each callback fires on its exact condition; reason
  strings byte-identical to today's; framing per context (gate string / program
  computed / practice null).
- The existing suites are the regression net: Exercises, Games, gateEvents, both
  Chromium measure specs — all must pass unmodified except where a test asserted the
  *smear itself* (e.g. mounts `ExerciseRun` and passes gate-only props); those move to
  the equivalent assertion on the new boundary, never weakened.
- The vitest gate ratchet: no new failing files; nothing baselined.

## Risks

- The extraction touches the two most-reviewed files of the last two branches; the
  suite is dense there — trust it, and keep the diff mechanical (move, don't rewrite).
- `ExerciseRun`'s effect ordering (auto-arm, stall, count-in) must not change hands;
  AskSession wraps *above* the load boundary, below nothing else.
- Watch the referential-stability contracts (`material`, `requirementOverride`) across
  the new boundary — memoization obligations move with the props.
