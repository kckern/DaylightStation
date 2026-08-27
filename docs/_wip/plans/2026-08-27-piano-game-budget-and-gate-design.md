# Piano Kiosk — Game Time Budget and Performance Gate

**Status:** design, not yet implemented.
**Date:** 2026-08-27.
**Scope:** `frontend/src/modules/Piano/PianoKiosk/` (Games mode + a new gate),
plus a new budget ledger on the backend.

---

## Problem

Piano-kiosk game usage on 2026-08-27 was measured from the log store: about
**4h25m of hands-on kiosk use** across the household, of which roughly
**2h40m was board games** (chess, checkers, connect-four). Two learners
accounted for ~82% of game time. The kiosk has no notion of how long anyone has
played, so nothing bounds the total and nothing asks for anything in return.

Two existing gates already govern Games and neither addresses duration:

- `useSchoolGameAccess` — opens when the learner's School day is `complete` or
  `no_work_today`. Fails closed. It correctly opened for every learner that day,
  so games were not being played around the gate; the gate simply has nothing to
  say about *how much*.
- `usePianoCurfew` — a time-of-day window. Fails open.

Note the second-order finding: learners whose School completion state is
`no_work_today` have games unlocked from waking, with no work required. A
duration budget is the only lever that bounds that case.

> **Provenance of these figures.** They come from LogsQL queries run on
> 2026-08-27 against a store with **7-day retention**, so they are not
> reproducible after ~2026-09-03. The event-volume and ratio findings were
> independently re-queried and corroborated (`game.restart`:`piano.game-enter`
> came back 27:20 on a rolling 24h window against the 26:16 quoted in D7 — same
> magnitude, same conclusion). The **duration** figures (4h25m / 2h40m / ~82%)
> depend on a sessionization method not recorded here and should be treated as
> directional rather than exact. They motivate the feature; nothing in the design
> depends on their precision.
>
> Queries used: `context.app:piano AND context.source:frontend AND _time:15h |
> stats by (_time:1m) count()` for active minutes, filtered by
> `context.component` for the per-activity split; `_msg:"piano.user.select"`
> joined to `_msg:"piano.game-enter"` by most-recent-preceding for attribution.

---

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Budget is **per-learner allowance + device-wide daily cap**, in series | The per-learner ladder/history already disincentivises profile-swapping; the device cap is a backstop, not the enforcement mechanism |
| D2 | Budget **source is pluggable**: `fixed` \| `earned` \| `economy` | Mirrors `GovernanceGate.js`'s existing multi-adapter shape; ships `fixed`, leaves the others as config selections |
| D3 | Server is the source of truth; client only ticks | The kiosk reloads many times a day (render watchdog, page-failure reload, connectivity reload, kiosk restarts). A client-held counter never survives a day |
| D4 | Metering uses **hold-and-settle with a cumulative high-water mark** | Proven in `coinMeteredGate.js`; idempotent settles, crash costs at most the unsettled tail |
| D5 | The meter **pauses on idle** | Games are abandoned mid-match; charging wall-clock makes the parent-facing number meaningless |
| D6 | Budget resets on the **household study day**, not the UTC day | Attempt evidence buckets on UTC (`YamlPianoAttemptStore.mjs:40`), but School uses `studyDate(instant, timezone, boundaryHour = 4)` (`school/timing.mjs:33`) — a local day that rolls at **4am, not midnight**. A UTC boundary would reset allowances mid-afternoon local |
| D7 | A performance gate fires **before every match**, including replays | Replays outnumber game entries roughly 26:16, so a per-entry gate would miss most play |
| D8 | The gate is a **quality gate** — the attempt must pass a threshold | Chosen over an ungraded toll; makes the practice real |
| D9 | The escape hatch is **ladder degradation**, and the floor is made unfailable by its **rubric**, not by its matcher | See the correction below — the matcher alone does not make a run unfailable |
| D10 | Gate material is a **provider seam**; bank instances and score passages are both acceptable inputs from day one | `createAssessmentAttempt` already accepts either a prepared exercise or a compiled score expectation |
| D11 | The gate **swaps in place at the same route**, replacing the game rather than overlaying it | MIDI is a broadcast context with no focus concept, so a modal over a live game would let gate keypresses drive the game underneath. At a match boundary there is no game state to lose |
| D12 | Failure offers **Retry · Practice this · Leave**; retry degrades the rung after N attempts | None of the three reaches a match without passing, so none is a bypass. "Practice this" reuses the existing `intent=practice` route |
| D13 | The gate and ungraded practice are **unmetered** | The gate is what you pay with, not what you pay for. A learner struggling at a scale must not burn their game allowance on scales |
| D14 | `earned` minutes are **passed gates scaled by `result.score`** | Rewards playing well over scraping the threshold; the score is already in the result contract, so no new measurement is needed |
| D15 | History is **three layers**: 7-day log store, durable household ledger, existing per-user attempts | Different questions need different lifetimes; the log store cannot be the record because it expires in a week |
| D16 | The balance is written by the **domain service, not a logging transport** | Logging transports swallow failures by design. A swallowed debit is free game time — the exact failure this feature prevents |

---

## Gate stack

Games entry becomes four gates in series. Each is independently
config-disablable; the first that blocks wins, with its own copy.

| # | Gate | Status | Fail mode |
|---|---|---|---|
| 1 | School completion — `useSchoolGameAccess` | exists | closed |
| 2 | Curfew — `usePianoCurfew` | exists | open |
| 3 | Budget — daily minutes remaining | **new** | open |
| 4 | Performance gate — per match | **new** | verdict: cannot fail at the floor (D9). Infrastructure: **open** |

Gate 3 is two budgets checked in series with distinct copy: "you are out for
today" (learner) versus "the piano's games are done for today" (device).

**Gate 4 has two distinct fail modes and they resolve differently.** The
*verdict* cannot fail at the floor, once D9's rubric fix is in. But the gate can
also fail to run at all — `pianoLearningApi.instance()` returning 502 during a
backend restart, which this kiosk demonstrably hits (the same 502 windows appear
as `piano.school-access.read-failed` in today's logs). A gate that cannot fetch
its material must **fail open** and let the match start, logging
`gate.unavailable`. Failing closed there would block earned games on an
unrelated backend blip, and unlike the verdict path there is nothing the child
can do about it.

---

## Budget and metering

### Source interface

One interface, three implementations, selected in config:

- `fixed` — N minutes per day, per learner, with per-learner overrides. Ships first.
- `earned` — each passed gate mints `baseMinutes × qualityMultiplier(result.score)`
  (D14). A run at the ladder floor still pays, but pays less, so degrading to
  stay solvent is not a strategy.
- `economy` — drains household coins through the existing hold-and-settle
  session. The client half already exists in `coinMeteredGate.js`.

### What is metered (D13)

Only time inside a match drains the budget. The gate is unmetered, and so is
ungraded practice reached from the gate's "Practice this". A learner who
struggles at a scale must not lose game minutes to the scale.

### Metering contract

```
openSession(learnerId, deviceId)  → one open session per learner (double-spend guard)
tick (1s)                          → drain while playing and not idle
settle(cumulativeSeconds)          → every 60s; monotonic high-water mark
close(cumulativeSeconds)           → on exit or depletion
```

Settle carries the **running total since open**, never a delta, so retries are
idempotent.

> **The reload risk is UNDER-charging, not double-charging.** An earlier draft
> had this backwards. `coinMeteredGate.js:193` sets `totalConsumed = 0` in
> `start()`, and nothing seeds it from the server. Because settle is a monotonic
> high-water mark, a client that restarts at zero produces settles the server
> treats as no-ops until the counter climbs back past the pre-reload total — so
> play after a mid-match reload is **free**. Given D3 (the kiosk reloads many
> times a day), this would be the feature's most common failure, and it fails in
> the direction the feature exists to prevent.

Two additions are therefore required, neither present in `coinMeteredGate.js`:

1. **Open returns the server-held cumulative, and the client seeds from it.**
   `openSession` responds with the seconds already consumed on the open session;
   the local counter starts there, not at zero.
2. **A stale-session policy.** A kiosk crash never calls `close()`, so the next
   `openSession` meets a lingering session. It must either adopt it (resuming the
   cumulative) or expire it after a bounded idle age. Silently failing to open
   would leave the match unmetered, which is the same hole again.

Each settle debits the learner balance and the device counter in one
transaction, so the two cannot drift apart.

### Idle

The meter needs an activity signal covering MIDI note-ons, `pointerdown`, and
`keydown`. `useInactivityReturn` already watches exactly those sources — but it
**cannot be reused unchanged**, and an earlier draft wrongly listed it as
reusable. It keeps activity in a private ref, returns nothing, and its only
output is a single `onIdle()` callback fired once per idle crossing, at
minutes granularity. The meter needs pause **and** resume at seconds
granularity (`idleAfterSeconds: 90`).

So this is a **modification**: expose the activity timestamp / idle state as a
subscribable value, leaving the existing `onIdle` behaviour intact for its
current caller. Budget real work here — the whole kiosk mounts this hook.

**Consequence to expect:** measured game time will read lower than
"minutes containing at least one event", because idle gaps inside a minute
counted toward the latter.

### Warning

The gate surfaces a `warning` state ahead of depletion — the same vocabulary
`GovernanceGate.js` and `coinMeteredGate.js` already use, so consumers need no
new state names. Threshold is config (`warnAtMinutes`).

---

## The performance gate

### Surface — reuse, do not rebuild

`ExerciseRun` is the surface. It already accepts exactly the needed props:

```js
ExerciseRun({ instanceId, intent, practiceMode, programId, stepId,
              requirementOverride, onExit, onPassed })
```

`Exercises.jsx` already contains a **non-program caller** of this shape —
`video-checkpoint` builds `{intent:'challenge', requirement: JSON, return}` and
navigates. The game gate is the same pattern with a different caller.

The pivotal line is `ExerciseRun.jsx:49`:

```js
const selectedMode = challenge ? requirement?.mode : practiceMode;
```

In challenge intent the **requirement dictates the mode**, so the entire
degradation ladder is expressed by rewriting one requirement object. No
branching is added inside the run surface.

`programId` and `stepId` already default to `null`, and evidence uses a
*challenge identity* when `intent === 'challenge'`, so a program-less caller is
already the supported path.

### The ladder

Five axes, walked down on failure, climbing back after 3 clean passes:

| Axis | Hard → easy |
|---|---|
| Timing | `cued` (timed, placement gate, drift) → `cursor` / `held` (wait-for-correct) |
| Hands | 2 → 1 |
| Span | 2 octaves → 1 |
| Difficulty | exotic mode → major |
| Direction | contrary / both → ascending |

Timing degrades **last**, because it changes what failure means. In `cued`, a
wrong note and a late note both count. In `cursor`, the attempt is sequential
wait-for-correct: the cursor does not advance until the right key is down, so
the learner corrects at their own pace. `held` (chord material, where `ordering`
is `any`) compares the physical held set against the onset.

### The floor must be made unfailable — the matcher does not do it

An earlier draft of this design claimed `cursor` and `held` are "unfailable by
construction". **That is false, and it was the load-bearing safety claim.**
Verified in `performance/assessmentAttempt.js`:

- `:363` — the `cursor` matcher appends to `attempt.wrong` for any plausible-but-
  incorrect key (within `wrongWindow: 24` semitones). `:342` — same for `held`.
- `:412` — `cleanliness = matched / (matched + wrongCount)`.
- `:163` — the default generated exercise rubric is
  `criteria: { completeness: 1, cleanliness: 1 }`. The cleanliness threshold is **1.0**.
- `:498`, `:509` — any criterion below threshold lands in `failed_criteria`, and
  `verdict.passed` requires that list to be empty.

So **one stray key on a completed floor run fails the verdict.** The learner
would then sit at the bottom of the ladder with nowhere lower to go, locked out
of a game they had already earned — exactly the outcome the escape hatch exists
to prevent.

**The floor is unfailable only if its requirement says so:**

```yaml
floor:
  mode: free                # NOT a matcher name — see the vocabulary note below
  rubric:
    criteria: { completeness: 1 }   # cleanliness deliberately absent
  passScore: null           # the global passScore does not apply at the floor
```

`completeness` is structurally 1 when a `cursor` or `held` run completes:
`advanceAssessment` (`:369`) early-returns unless `matcher === 'timed'`, and
`closeAssessmentSpan` (`:383`) is a Sheet Music path, so `misses` stays empty
and `completeness = matched / expected = 1`. Dropping `cleanliness` from the
floor rubric therefore makes the floor genuinely unfailable through the existing
verdict machinery, with no special-casing inside the engine.

Wrong notes at the floor are still recorded in the attempt evidence, so nothing
is hidden from the record — they simply stop being disqualifying.

### Vocabulary: mode is not matcher

`MODES = free | metronome | cued`; `MATCHERS = cursor | timed | held`
(`assessmentAttempt.js:1-2`). The matcher is **derived**, never named directly:
`prepareExerciseAssessment` maps `cued → timed`, `ordering: any → held`, and
otherwise `cursor`. `assessmentAttempt.js:137` throws
`Unsupported assessment mode` for anything outside `MODES`, so a requirement
naming `mode: cursor` fails at runtime.

The timing axis therefore degrades `cued → free`, and the matcher follows from
the instance's `ordering`.

### Mount (D11)

The gate renders **in place of** the game, at the same route. `/…/games/chess`
stays in the URL; the game component unmounts and the gate mounts, and passing
swaps back to a fresh match.

This is not a styling preference. `usePianoMidiNotes()` is a
`useSyncExternalStore` over one shared store with no focus or ownership concept,
so every mounted consumer receives every note. A modal over a live game would
let the gate's scale drive the game underneath. Swapping guarantees exactly one
MIDI consumer at a time without introducing input routing that every game would
inherit.

Because the gate fires at match boundaries (D7), the previous match is already
over — there is no in-progress state the unmount could lose.

### Failure (D12)

| Button | Action |
|---|---|
| Try again | Re-runs the current rung. After N attempts the rung drops, and the banner says so |
| Practice this | Routes to the same material with `intent=practice` — ungraded, unlimited, no gate |
| Leave | Returns to the piano menu |

None of the three can reach a match without passing, so none is a bypass. Exit
must never return *into* the match.

### Material providers (D10)

Both are acceptable inputs to the gate:

- **Bank instance** — `prepareExerciseAssessment({instance, mode, purpose, requirement})`.
  The bank is 58 seeds → 2,757 performable instances (`notes`, `intervals`,
  `chords/triads`, `chords/sevenths`, `arpeggios`, `scales/modes`, `runs`,
  `drills/hanon`, `drills/five-finger`, `progressions`), with a compatibility
  sweep of 7,143 supported-mode runs.
- **Score passage** — `compileScoreExpectation({notes, source, tempoMap,
  activeParts, range})` where `range` is a measure range. This lets a gate demand
  a passage from the piece the learner is currently studying.

Both funnel into the same `createAssessmentAttempt`, which accepts either a
prepared exercise or a compiled expectation directly.

---

## Reuse map

Verified against the code, not inferred from names.

### Reused unchanged

| Need | Provided by |
|---|---|
| Staff engraving | `ExerciseNotation` → `AbcRenderer` |
| Progress greying / cursor | `ExerciseNotation.jsx:46-47` — `exercise-note-done` for `index < eventIndex`, `exercise-note-next` at `index === eventIndex` |
| Wrong-note geometry | `WrongNoteGhost` + `ghostPlacement` — props are pure geometry, no caller coupling |
| Assessment lifecycle | `performance/assessmentSession.js` |
| Challenge authorization | `authorization.js:resolveExerciseRunAccess` |
| Axis vocabulary | `filters.js` — `MODE_OPTIONS`, `HAND_OPTIONS`, `LEVEL_BANDS`, `FORM_OPTIONS` |
| Instance/axis data | `pianoLearningApi.instances(seedId)`, `instance.supports`, `instance.level[mode]` |
| Learner history | `useExerciseWorkspace().learning.catalog_progress[seedId].passed` |
| ~~Idle signal~~ | moved to Modified — see below |
| Metering contract | `coinMeteredGate.js` |
| Governance state names | `GovernanceGate.js` (`playing` / `warning` / `paused`) |

### New

- `gameGateLadder.js` — pure: `(rung, failureCount, config) → {material, requirement}`.
  Reads only already-published data, so it is unit-testable with no fixtures.
- Budget meter hook + its backend ledger and session endpoints.
- The gate host that mounts `ExerciseRun` over the game boundary.

### Modified

1. **`ExerciseRun` must stop discarding the played pitch.**
   `ExerciseRun.jsx:86` is `onEvent: (event) => setLastWrong(event?.type === 'wrong')`.
   All three matchers already emit `{type:'wrong', midi, eventId}`
   (`assessmentAttempt.js:305,343,363`). Keep `midi` and `eventId`.

2. **`ExerciseNotation` must mount the ghost.** It needs to expose its container
   ref and the anchor element it already locates by `eventIndex`, and pass
   `clefType` via the existing `scaleClefType(tune)`.

3. **Policy must come from the requirement.** `ExerciseRun.jsx:74` hardcodes
   `policy: {matchWindowMs:220, missWindowMs:420, timingToleranceMs:80, timingWindowMs:320}`.
   The engine already merges caller policy over defaults
   (`assessmentAttempt.js:233`) and exposes knobs `ExerciseRun` never surfaces
   (`wrongWindow`, `allowExtras`). Source it from `requirement.policy` so a rung
   can loosen tolerance.

4. **Material resolution must move behind the D10 seam**, so `buildAttempt` is
   no longer hard-bound to `pianoLearningApi.instance(instanceId)`.

5. **`useInactivityReturn` must expose an activity/idle signal.** It currently
   holds activity in a private ref and returns nothing, emitting one `onIdle()`
   per crossing at minutes granularity. The meter needs pause *and* resume at
   seconds granularity. Add a subscribable value without disturbing the existing
   `onIdle` contract — the whole kiosk mounts this hook.

---

## Known constraint: two notation renderers

Exercises render through **abcjs** (`AbcRenderer`); Sheet Music renders through
**OSMD** (`osmdRender.js`). `WrongNoteGhost` queries `.abcjs-staff > *`
directly, and renders nothing when it cannot measure — an honest failure, but it
means the "show the note actually played" affordance is absent on score
passages, which is where it would help most.

The assessment side unifies cleanly; the notation side does not.

`StaffDimLayer.jsx` (Sheet Music) is the existing OSMD staff-geometry precedent
on which an OSMD ghost placement should be built.

---

## Verification status

Every `file:line` in this document was read against local `main` fast-forwarded
to `origin/main` on 2026-08-27, and independently re-verified by an adversarial
review the same day. The homeserver deploy tree could NOT be checked (no SSH
agent available), so work committed there and never pushed is the one unverified
risk. Implementation should re-read the five Modified call sites before touching
them; a moved line surfaces immediately as a mismatch rather than a silent
conflict.

---

## Phasing

**Phase 1** — the material provider seam accepts both input types. Bank material
is fully supported end to end: five-axis ladder, ghost, requirement-sourced
policy, budget and meter. Score passages are accepted and assessed, but render
without the ghost.

**Phase 2** — OSMD ghost placement, giving score passages parity.

---

## Config

Household piano app config. All thresholds are config; nothing is hardcoded.

```yaml
gameLimit:
  enabled: false            # off by default, like curfew
  source: fixed             # fixed | earned | economy
  dailyMinutes: 45
  deviceDailyMinutes: 120
  warnAtMinutes: 5
  idleAfterSeconds: 90
  users:
    user_1: { dailyMinutes: 30 }
    user_2: { dailyMinutes: 45 }

gameGate:
  enabled: false
  every: match              # match | entry | interval
  passScore: 0.80
  retriesBeforeDegrade: 3   # open question 1 — tune from gate.rung-changed
  metered: false            # D13 — the gate never drains the budget
  climbAfterCleanPasses: 3
  material:                 # both input types are acceptable
    - kind: exercise
      collections: [scales, arpeggios, intervals, chords]
    - kind: score
      source: current-study-piece
      measures: 4
  ladder:
    axes: [timing, hands, span, difficulty, direction]
    floor: { mode: free, hands: 1, span: 1, rubric: { criteria: { completeness: 1 } }, passScore: null }
```

Household app config is cached in memory at startup; changes need a reload or a
dev-server restart before they take effect.

---

## Observability and history

Three layers with different lifetimes. The log store answers "what is happening
now"; the household ledger answers "what happened in October".

### Layer 1 — log store (7-day retention)

New structured events, following the existing `piano-*` component convention.

| Component | Events |
|---|---|
| `piano-game-budget` | `budget.opened`, `budget.settled`, `budget.idle-paused`, `budget.idle-resumed`, `budget.warning`, `budget.depleted`, `budget.device-depleted`, `budget.day-rollover`, `budget.settle-failed` |
| `piano-game-gate` | `gate.presented`, `gate.attempt`, `gate.passed`, `gate.failed`, `gate.rung-changed`, `gate.floor-reached`, `gate.practice-detour`, `gate.abandoned` |

Every event carries `learnerId`, `deviceId`, `studyDate`, and `sessionId`. Gate
events additionally carry `material`, `rung`, `mode`, `score`, and `attemptId`,
so an afternoon reconstructs from a single query.

`gate.rung-changed` and `gate.floor-reached` are the pair that shows whether the
ladder is calibrated: a learner who reaches the floor every time is being asked
for material above their level. Open question 1 (default retry count) is tuned
from these.

`budget.settle-failed` is the alerting signal — a settle that never lands is
un-charged play.

### Layer 2 — household history (durable, authoritative)

```
data/household/history/piano-games/{YYYY-MM-DD}.yml
```

Follows the existing `household/history/{domain}/` convention already used by
fitness and automotive. Holds per-learner minutes consumed, the device-wide
total, and every gate outcome for the day, bucketed on the household study day
(D6).

This file **is** the source of truth referenced by D3 — not a copy of state held
elsewhere.

> **This must not be a logging transport.** `schoolLedger.mjs` is otherwise the
> right template — dated files, `localDay()` bucketing that matches D6, pruning,
> registration in `transports/index.mjs` — but it declares "failures here are
> swallowed by design". For a ledger that is correct; for a *balance* it is not.
> A swallowed write is a lost debit, and a lost debit is free game time, which is
> the exact failure this feature exists to prevent. Layer 2 is written by the
> domain service with real error handling, and a failure surfaces as
> `budget.settle-failed`.

A ledger transport modelled on `schoolLedger.mjs` remains the right tool for a
durable tail of the layer-1 *event stream*, which is a separate concern from the
balance.

### Layer 3 — per-user attempt evidence (already exists)

`ExerciseRun.persist()` already writes graded attempts to
`data/users/{id}/apps/piano/attempts/{YYYY-MM-DD}/` through
`POST /api/v1/piano/users/:userId/attempts`, and those directories are already
populated in the live data tree. Gate performance evidence therefore needs no
new storage — only a challenge identity, which `intent: 'challenge'` already
supplies.

Note this layer buckets on the **UTC** day while layers 1–2 bucket on the
household study day (D6). That is pre-existing and intentional; joins across
layers must convert rather than assume.

---

## Testing

- `gameGateLadder` — pure unit tests over published axis data; degradation and
  climb-back are deterministic.
- **A completed floor attempt with N wrong notes still passes.** This is the
  regression test for D9. Without it the escape hatch silently stops existing
  the next time a rubric default changes.
- Budget metering — settle idempotency, **a mid-session reload does not yield
  free time** (the client seeds from the server cumulative), stale-session
  adoption, idle pause *and resume*, the learner/device series, study-day
  rollover at the 4am boundary.
- Gate infrastructure failure — a 502 from `pianoLearningApi.instance()` opens
  the gate and logs `gate.unavailable`, rather than blocking the match.
- `ExerciseRun` — a ghost renders on a wrong note; requirement policy overrides
  the defaults; a program-less challenge persists with a challenge identity.
- Live flow — a match-boundary gate appears, a passed gate opens the match, a
  depleted budget closes Games.
- Observability — every event in the layer-1 table is actually emitted on its
  path (a gate that never logs `gate.rung-changed` makes open question 1
  untunable), and a failed ledger write surfaces as `budget.settle-failed`
  rather than being swallowed.
- History — a day's play reconstructs from the layer-2 file alone, and the
  learner totals in it reconcile against the sum of settles.

Isolated domain tests must be run with vitest directly; `--only=domain` misroutes
vitest files to Jest.

---

## Resolved

The four questions this design opened are now closed as D11–D14 above.

**Guest** needs no new copy. `useSchoolGameAccess` resolves guest to `locked`
and closes Games *before* the gate is reachable, and `resolveExerciseRunAccess`
independently refuses a challenge without a persistent user. A guest never
reaches the gate, so the existing "Choose your own profile, then finish today's
schoolwork to unlock Games" already covers the case.

## Open questions

1. **Retry count before the rung drops.** N is config, but the default matters:
   too low and the ladder collapses to the floor on a normal bad attempt, too
   high and a stuck learner grinds. `gate.rung-changed` and `gate.floor-reached`
   are instrumented precisely so this can be tuned against real data rather than
   guessed.
2. **Whether the device cap should exempt an adult profile.** A grown-up sitting
   down to play should probably not consume the children's device allowance.
3. **Whether a passed gate should bank credit for more than one match**, so a
   strong run buys a short streak rather than exactly one game.
