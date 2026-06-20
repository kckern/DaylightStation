# Cycle Challenge Design

**Status:** As-built reference (present tense). Reconciled against
`GovernanceEngine.js` and the overlay source on 2026-06-19, and validated against
production session logs.
**Scope:** The `cycle` governance challenge type — an RPM-based, single-rider,
multi-phase workout with a health-pool punishment model and a social boost.

> This document supersedes the 2026-04-17 pre-implementation spec. Where the
> shipped system diverged from that spec (the health pool replacing the
> dim-band/lo-floor model; the promoted-overlay lock screen replacing the RPM-pill
> row; the trimmed overlay), this reflects what the code does today. See
> `docs/_wip/audits/2026-06-19-cycle-challenge-overlay-as-built-audit.md` for the
> drift findings that motivated the rewrite. The overlay's own behavior is
> documented in detail at `docs/reference/fitness/cycing-challenge.md`.

## Summary

A cycle challenge is one selection type in the fitness governance challenge pool,
peer to the implicit `zone` challenge and `vibration`. Unlike zone challenges,
which evaluate every participant against a shared target, a cycle challenge binds
a **single rider** to a specific piece of cadence equipment and makes them clear a
**sequence of RPM phases**. Only one challenge of any type is active at a time
(the single `activeChallenge` slot), so cycle, zone, and vibration are mutually
exclusive.

The distinguishing behaviors are:

- **Procedurally generated phase sequences** (random / progressive / regressive /
  constant RPM profiles), or hand-authored explicit phases.
- **A per-phase target band** — `hiRpm` is the target the rider must reach and
  hold; `loRpm` is the red line below which they bleed health.
- **A health pool** — a short grace buffer that depletes below the red line,
  regenerates in the green zone, and pauses the video when it empties. This is the
  punishment mechanic (it replaced an earlier instant-lock-below-`lo` design).
- **A social boost** — riders in `hot`/`fire` HR zones accelerate progress
  accrual; the rider's own zone counts.
- **A rider swap** during the early, low-commitment window only.
- **A per-rider cooldown** so the same person is not assigned back-to-back.

## Architecture & Integration

Cycle challenges live in the same `selections[]` array under
`policies.*.challenges[0]` and are drawn by the same weighted-random / cyclic
selector as every other challenge. They reuse the engine heartbeat, the
pause/resume machinery, the lock-screen pipeline, and the audio-cue player. No
separate timers are introduced.

Touched seams:

1. **Policy normalization** accepts the `type: cycle` selection shape (init
   thresholds, procedural-generation ranges or explicit `phases[]`, `boost`,
   `user_cooldown_seconds`) and the equipment `eligible_users` whitelist.
2. **Challenge evaluation** branches on selection `type`; the cycle branch runs
   the sub-state machine each tick.
3. **The display projection** emits cycle-specific fields when the active
   challenge is a cycle (see [Engine → UI snapshot](#engine--ui-snapshot)).
4. **The fitness session** exposes per-equipment cadence so the engine can read
   the rider's live RPM.
5. **The frontend** selects the cycle overlay when the snapshot's challenge type
   is `cycle`, and applies a `--cycle-dim` video filter during maintain.

Left untouched: preview scheduling, interval mechanics, base-requirement
evaluation, existing zone/vibration behavior, and the challenge-history shape
(fields added, pattern preserved).

## Config

Authoring supports two modes: explicit `phases[]` (hand-authored) or procedural
generation from ranges. When both are present, explicit phases win.

```yaml
governance:
  policies:
    default:
      challenges:
        - interval: [30, 120]
          selection_type: random
          selections:
            - type: cycle
              label: "Cycle sprints"
              equipment: cycle_ace          # references an equipment entry
              weight: 1
              user_cooldown_seconds: 600    # per-rider cooldown (default 600)

              init:
                min_rpm: 30                  # rider must reach this to start
                time_allowed_seconds: 60     # init timer before init-lock

              # Mode A — procedural generation
              segment_count: [3, 5]                # phase count, drawn from range
              segment_duration_seconds: [20, 45]   # maintainSeconds per phase
              ramp_seconds: [10, 20]               # ramp budget per phase
              hi_rpm_range: [50, 90]               # hiRpm drawn from range
              lo_rpm_ratio: 0.75                   # loRpm = round(hi * ratio)
              sequence_type: progressive           # random | progressive | regressive | constant

              # Mode B — explicit phases (override procedural)
              # phases:
              #   - hi_rpm: 60
              #     lo_rpm: 45
              #     ramp_seconds: 15
              #     maintain_seconds: 30

              boost:
                zone_multipliers:
                  hot: 0.5                    # each user at hot adds 0.5x (incl. rider)
                  fire: 1.0                   # each user at fire adds 1.0x (incl. rider)
                max_total_multiplier: 3.0
```

```yaml
equipment:
  - id: cycle_ace
    name: CycleAce
    type: stationary_bike
    cadence: 49904
    eligible_users: [kckern, felix, milo]   # required for cycle challenges
```

### Defaults

| Field | Default |
|---|---|
| `user_cooldown_seconds` | `600` |
| `lo_rpm_ratio` | `0.75` |
| `init.min_rpm` | `30` |
| `init.time_allowed_seconds` | `60` |
| `boost.max_total_multiplier` | `3.0` |
| `sequence_type` | `random` |

### Sequence generation

Phases are generated at **challenge start** (not at preview):

- **`random`** — N values drawn uniformly from `hi_rpm_range`, in random order.
- **`progressive`** — N evenly-spaced ascending values across the range, with
  small per-value jitter.
- **`regressive`** — same, descending.
- **`constant`** — one value drawn from the range, repeated N times.

`maintainSeconds` and `rampSeconds` are drawn per phase from their ranges (scalar
configs become single-element ranges). `loRpm = round(hiRpm × lo_rpm_ratio)`,
clamped to a sane band.

## State machine

The active cycle challenge carries an outer `status`
(`pending | success | failed | abandoned`) and an inner `cycleState`
(`init | ramp | maintain | locked`). Evaluation runs on the engine heartbeat,
self-scheduling tighter (~200 ms) during `maintain` for smooth rendering and
looser (~500 ms) otherwise.

### States

- **`init`** — rider selected; waiting for them to reach `init.min_rpm` **and**
  satisfy their own HR base requirement. The init timer runs.
- **`ramp`** — a phase has begun; the rider is climbing toward `hiRpm`. The ramp
  timer runs. The health pool is reset to full on entry.
- **`maintain`** — the rider has reached `hiRpm` at least once this phase.
  Progress accrues in the green zone; the health pool governs the punishment (see
  below).
- **`locked`** — the video is paused. Reached from an init timeout, a ramp
  timeout, or an emptied health pool. The overlay stays visible so the rider can
  see why and pedal back out. A rider who never starts — stuck in the init lock
  past a grace window — transitions to a recorded `failed`
  (`failReason: never_started`); see the transitions table.

### Transitions

| From | Condition | To |
|---|---|---|
| `init` | `rpm ≥ init.min_rpm` AND HR base-req satisfied | `ramp` (phase 0) |
| `init` | init timer expires | `locked` (`lockReason: init`) |
| `ramp` | `rpm ≥ phase.hiRpm` | `maintain` (progress starts at 0, health full) |
| `ramp` | ramp timer expires | `locked` (`lockReason: ramp`) |
| `maintain` | `rpm ≥ hiRpm` | health regenerates; progress accrues at `1 + boost` |
| `maintain` | `lo ≤ rpm < hi` | progress frozen; health holds; video dims by `dimFactor` |
| `maintain` | `rpm < loRpm` | health depletes; progress frozen |
| `maintain` | health pool reaches 0 | `locked` (`lockReason: health`) |
| `maintain` | `phaseProgress ≥ maintainSeconds` | next phase `ramp`, or outer `success` if last |
| `locked` (init) | `rpm ≥ init.min_rpm` | resume `init` (timer preserved) |
| `locked` (init) | stuck below `init.min_rpm` past the grace window | outer `status: failed` (`failReason: never_started`) — recorded, then cleared |
| `locked` (ramp) | `rpm ≥ hiRpm` | resume `maintain` (ramp skipped — they arrived) |
| `locked` (health) | `rpm ≥ hiRpm` | resume `maintain`, health reset to full |

### Rider swap window

Swap is allowed only where the rider has not yet committed:

- ✅ `init` — resets the init timer for the new rider; cooldown check applies.
- ✅ Phase-0 `ramp` (rider hasn't touched `hiRpm` yet) — reverts to `init`.
- ❌ Any `maintain`, any phase-1+ `ramp`, any `locked`.

A swapped-out rider receives **no** cooldown (they never completed). On challenge
end, every rider who actually pedaled receives the cooldown.

### Pause from outer governance

When the parent base requirement fails for any participant, the cycle challenge
**freezes**: init/ramp/health/progress timers hold, `dimFactor` is not rendered,
and no lock screen is shown. It resumes from the frozen values when the base
requirement is restored. This reuses the existing `pausedAt` / `pausedRemainingMs`
pattern.

## Health pool, progress, and dim

The health pool is the core of the as-built punishment model.

- **Capacity** is a fixed buffer (≈ 3 s of below-target riding).
- **Below `loRpm`:** depletes at 1 ms of health per 1 ms of real time; no progress.
- **In the `lo..hi` amber band:** holds; no progress; the video dims by `dimFactor`.
- **At/above `hiRpm` (green):** regenerates at 1.5× rate **and** phase progress
  accrues at `1 + boost`.
- **Empty pool:** `cycleState → locked`, `lockReason: 'health'`, video paused,
  even though the parent governance phase is otherwise unlocked.
- **Reset to full** on challenge start and on every `ramp → maintain` entry, so
  each phase starts with a fresh buffer.
- **Overlay surfacing:** the health bar is hidden by default and shown only when
  RPM is below `loRpm` during maintain, or during a health lock — a rider holding
  green sees no bar.

### Boost multiplier

Recomputed every tick (no hysteresis — zone classification is already debounced
upstream):

```
boostMultiplier = clamp(
  1 + Σ over all users (including the rider): zone_multipliers[userZone] || 0,
  1,
  max_total_multiplier
)
```

The rider's own zone counts — cranking resistance into hot/fire rewards them with
faster accrual. The contributing users are listed on the snapshot for the UI.

### Progress accrual

```
if cycleState === 'maintain' AND rpm >= hiRpm:
  phaseProgressMs += tickMs × boostMultiplier
# amber band and below-lo accrue nothing
```

### Dim factor (video filter)

```
if cycleState === 'maintain' AND lo ≤ rpm < hi:
  dimFactor = (hi - rpm) / (hi - lo)   # 0 at hi, 1 at lo
else:
  dimFactor = 0
```

The frontend binds `--cycle-dim` on the player root during maintain; the
`.fitness-player.cycle-dim` filter chain (brightness/grayscale/sepia/blur)
interpolates from it. In practice the amber band is a thin transient strip and
`dimFactor` is usually 0 — the health bar, not the dim filter, is the visible
punishment. Treat the dim filter as a soft, secondary pre-warning.

## Lock screen

A locked or failed cycle challenge does **not** show the generic governance panel.
The lock resolver promotes the **cycle overlay itself** to a centered position
(`variety: 'cycle-lock'` / `'cycle-fail'`) and pauses the video. The overlay owns
its presentation in every state — init, ramp, maintain, and locked — so the rider
always sees the same dial, with the empty health bar (or the red ring) explaining
the pause. There is no separate RPM-pill lock row.

## Overlay

A circular dial (~220 view units), placed top/middle/bottom by the shared overlay
deck. It is a pure projection of the snapshot — no timers, no state machine. It
draws:

- An outer ring whose color tracks `cycleState` (slate `init`, yellow `ramp`,
  green `maintain` at/above target, orange in the amber dim band, red `locked`).
- A top-hemisphere **RPM gauge** (0 → 120) with tick marks, green `hiRpm` and red
  `loRpm` band markers, a needle at `currentRpm` (glows green at/above target),
  and a target-RPM sign anchored to the hi tick.
- A lower-hemisphere **phase-progress arc** filling monotonically with
  `phaseProgressPct` (holds when paused; never runs backward).
- The **rider avatar** (sole identifier; loaded by rider id) with the heart-rate
  base-req gate dot pinned to it, and a ✓ during the success hold.
- A bottom stack: **phase blocks** (one per phase, completed ones lit) and a
  **current-RPM readout**.
- The **health bar** (segmented; depletes right-to-left; empty = paused).
- A **boost badge** (`×N.N`) when the multiplier exceeds 1.

The full visual contract lives in `docs/reference/fitness/cycing-challenge.md`.

## Engine → UI snapshot

When the active challenge is a cycle, the display projection emits (drawn from the
projection in the engine and what the overlay consumes):

```js
{
  type: 'cycle',
  id,
  status: 'pending' | 'success' | 'failed' | 'abandoned',
  cycleState: 'init' | 'ramp' | 'maintain' | 'locked',
  lockReason: null | 'init' | 'ramp' | 'health',

  rider: { id, name },              // avatar loaded by id, not a URL field
  currentPhase: { hiRpm, loRpm, maintainSeconds, rampSeconds },
  currentPhaseIndex, totalPhases,
  currentRpm,
  phaseProgressPct,                 // FRACTION in [0,1] (the "Pct" suffix is historical)
  dimFactor,                        // [0,1]; > 0 only in the amber band
  cycleHealthPct,                   // [0,1] health pool remaining

  boostMultiplier,                  // clamped to max_total_multiplier
  boostingUsers,                    // contributing user ids (emitted; not currently rendered)

  baseReqSatisfiedForRider,         // HR gate → avatar dot
  waitingForBaseReq,
  clockPaused,                      // rider idle below init min-rpm
  initRemainingMs, rampRemainingMs, // countdown values (emitted; not currently rendered)
  cadenceFlags: { lostSignal, stale, … },
  swapAllowed                       // only during init / phase-0 ramp
}
```

> `boostingUsers`, `initRemainingMs`, and `rampRemainingMs` are still emitted but
> the trimmed overlay no longer renders booster pips or countdown text. They are
> retained for the demo harness and any future restoration — see the audit's
> Finding 1 before relying on them.

## History

Cycle challenges push to the existing `challengeHistory` (capped) with
cycle-specific fields layered onto the shared shape:

```js
{
  id, type: 'cycle',
  status: 'success' | 'failed' | 'abandoned',
  failReason: null | 'never_started',   // set when a failure is recorded
  startedAt, completedAt, selectionLabel,
  rider, ridersUsed,               // multiple if swapped during init
  totalPhases, phasesCompleted,
  phases: [{ hiRpm, loRpm, maintainSeconds, rampMs, maintainMs, boostedMs }],
  totalLockEventsCount,            // init + ramp + health locks
  totalBoostedMs, boostContributors
}
```

`abandoned` fires when a session ends with a cycle challenge still active —
distinguishing "gave up" from "completed" / "failed".

## Audio cues

Fired on `cycleState` transitions (not per tick), through the existing governance
audio player:

| Cue id | Fires on |
|---|---|
| `cycle_challenge_init` | challenge start (`init`) |
| `cycle_phase_complete` | each phase boundary (entering the next `ramp`) |
| `cycle_success` | final phase complete |
| `cycle_locked` | any lock (init / ramp / health) |

Boost is purely visual — no boost audio.

## Manual trigger & swap API

```js
engine.triggerChallenge({ type: 'cycle', selectionId, riderId })  // riderId optional; bypasses cooldown
engine.swapCycleRider(riderId)                                    // valid only in init / phase-0 ramp
```

`swapCycleRider` validates an active cycle challenge, a swap-eligible state, an
eligible rider, and the cooldown (admin override may force). It returns
`{ success }` with a reason on failure, surfaced as a toast.

---

*Implementation: `frontend/src/hooks/fitness/GovernanceEngine.js` (state machine,
health pool, projection), `frontend/src/modules/Fitness/player/overlays/`
(overlay, `cycleOverlayVisuals.js`, `CycleHealthBar.jsx`, `resolveLockScreen.js`,
`useCycleSuccessHold.js`), and `frontend/src/modules/Fitness/player/cycleDimStyle.js`
(video dim). Overlay detail: `docs/reference/fitness/cycing-challenge.md`. Engine
detail: `docs/reference/fitness/governance-engine.md`.*
