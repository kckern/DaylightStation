# Cycle Challenge Design

**Status:** Design — ready for implementation planning
**Date:** 2026-04-17
**Scope:** New challenge type for the fitness governance engine; RPM-based single-user multi-phase workout with social boost.

## Summary

A new governance challenge type `cycle` that extends the existing zone/vibration challenge framework. Unlike existing challenges (which evaluate all participants against a shared target), a cycle challenge assigns a single rider to a specific piece of bike-like equipment and requires them to complete a sequence of RPM phases. The challenge slots into the existing weighted random selection pool, reuses the existing tick/heartbeat and pause/resume infrastructure, and integrates with the existing lock-screen and audio-cue systems.

Novel behaviors:

- **Procedurally generated phase sequences** (random / progressive / regressive / constant RPM profiles)
- **Three-threshold per-phase model** (`hi_rpm` = target, `lo_rpm` = hard floor, anything in between = dim)
- **Progressive video degradation** via CSS filter vars interpolated from dim factor
- **Social boost mechanic** — users in `hot`/`fire` zones accelerate progress accrual (rider self-boost also counts)
- **Rider swap** during init and phase-1 ramp only; swap modal patterned after `VoiceMemoOverlay`
- **Per-user cooldown** to prevent back-to-back cycle assignments to the same rider

## Architecture & Integration

### Dispatch model

Cycle challenges are a new `type` value on challenge selections (peer to implicit `zone` and existing `vibration`). They live in the same `selections[]` array under `policies.*.challenges[0]`, drawn by the same weighted-random/cyclic selector. Only one challenge is ever active at a time — cycle, zone, and vibration are mutually exclusive via the single `activeChallenge` slot.

### Touched components

1. **`GovernanceEngine._normalizePolicies`** — accept new cycle selection shape and new top-level fields (`type: cycle`, `init`, segment/sequence generation fields, `phases[]` (explicit), `boost`, `user_cooldown_seconds`).
2. **`GovernanceEngine._evaluateChallenges`** — branch by selection `type`; existing zone logic unchanged; new `_evaluateCycleChallenge` method added.
3. **`GovernanceEngine._buildChallengeSnapshot`** — emit cycle-specific fields when `activeChallenge.type === 'cycle'`.
4. **Session layer** — `FitnessSession` exposes a new `getEquipmentCadence(equipmentId)` method returning `{ rpm, connected }`. Engine consumes this via `update({ equipmentCadenceMap, ... })`.
5. **Equipment config** — new optional `eligible_users: [userId]` array per equipment entry in `fitness.yml`.
6. **Frontend overlay pipeline** — new `CycleChallengeOverlay` component selected when `governanceState.challenge.type === 'cycle'`.

### Untouched

Preview scheduling, interval mechanics, warning cooldown, base_requirement evaluation, `videoLocked` flag semantics, existing zone/vibration behavior, challenge history structure (fields added, pattern preserved), `triggerChallenge` call signature (extended, not broken).

## Config Schema

### Cycle challenge selection

Authoring supports two modes: explicit `phases[]` (hand-authored) or procedural generation from ranges. When both are present, explicit wins and a warning is logged.

```yaml
governance:
  policies:
    default:
      challenges:
        - interval: [30, 120]
          selection_type: random
          selections:
            # existing zone / vibration selections...

            # new cycle challenge
            - type: cycle
              label: "Cycle sprints"
              equipment: cycle_ace           # references equipment.cycle_ace
              weight: 1
              user_cooldown_seconds: 600     # per-user cooldown (default 600)

              init:
                min_rpm: 30
                time_allowed_seconds: 60

              # Mode A: procedural generation
              segment_count: [3, 5]                # random phase count
              segment_duration_seconds: [20, 45]   # maintain_seconds range per phase
              ramp_seconds: [10, 20]               # ramp per phase (scalar or [min,max])
              hi_rpm_range: [50, 90]               # hi_rpm drawn from range
              lo_rpm_ratio: 0.75                   # lo = round(hi * ratio); default 0.75
              sequence_type: progressive           # random | progressive | regressive | constant

              # Mode B: explicit phases (overrides procedural if present)
              # phases:
              #   - hi_rpm: 60
              #     lo_rpm: 45
              #     ramp_seconds: 15
              #     maintain_seconds: 30

              boost:
                zone_multipliers:
                  hot: 0.5                     # each user at hot adds 0.5x (includes rider)
                  fire: 1.0                    # each user at fire adds 1.0x (includes rider)
                max_total_multiplier: 3.0
```

### Equipment whitelist

```yaml
equipment:
  - id: cycle_ace
    name: CycleAce
    type: stationary_bike
    cadence: 49904
    eligible_users: [kckern, felix, milo]   # new field; required for cycle challenges
    rpm:
      min: 30
      med: 60
      high: 80
      max: 100
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

### Sequence generation semantics

At challenge **start time** (not preview — per design decision in brainstorming Q16):

- **`random`** — N values drawn uniformly from `hi_rpm_range`, in random order.
- **`progressive`** — N evenly-spaced values ascending from range min to range max, with small per-value jitter (±5% of range width).
- **`regressive`** — same as progressive, descending.
- **`constant`** — one value drawn from range, repeated N times.

`maintain_seconds` and `ramp_seconds` drawn independently per phase from their configured ranges (scalar configs become single-element ranges). `lo_rpm = round(hi_rpm × lo_rpm_ratio)`.

## State Machine

Cycle challenge extends the existing `activeChallenge` object with a sub-state machine. Outer `status` (`pending | success | failed`) still applies; inner `cycleState` drives phase-level logic.

### `cycleState` values

- **`init`** — rider selected, waiting for rider to reach `init.min_rpm` AND satisfy `base_requirement` for their own HR. Ticks `init.time_allowed_seconds` timer.
- **`ramp`** — a phase has begun. Rider climbing toward `phase.hi_rpm`. Video clean (no dim). Ticks `phase.ramp_seconds` timer.
- **`maintain`** — rider touched `hi_rpm` at least once in the current phase. Progress bar fills toward `phase.maintain_seconds` at rate `1.0 + boost`.
- **`locked`** — rider below threshold for too long (init-lock, ramp-lock, or maintain-lock). Video paused. Rider must reach a threshold to exit.

### Transitions (per tick)

| From | Condition | To |
|---|---|---|
| `init` | RPM ≥ `init.min_rpm` AND base_req satisfied for rider | `ramp` (phase 1) |
| `init` | `init.time_allowed_seconds` expired | `locked` (init-lock) |
| `ramp` (any phase) | RPM ≥ `phase.hi_rpm` | `maintain` (ramp ends; phase progress starts at 0) |
| `ramp` (any phase) | `phase.ramp_seconds` expired | `locked` (ramp-lock) |
| `maintain` | RPM ≥ `hi_rpm` | progress accrues at `1.0 + boost` rate |
| `maintain` | `lo_rpm` ≤ RPM < `hi_rpm` | progress **paused**, dim applied |
| `maintain` | RPM < `lo_rpm` | `locked` (maintain-lock) |
| `maintain` | `phase_progress ≥ maintain_seconds` | next phase's `ramp` OR outer `success` if last phase |
| `locked` (init) | RPM ≥ `init.min_rpm` | resume in `init` (with time remaining) |
| `locked` (ramp) | RPM ≥ current `hi_rpm` | resume in `maintain` (ramp is skipped — they've arrived) |
| `locked` (maintain) | RPM ≥ current `hi_rpm` | resume in `maintain` (preserved phase progress) |

### Rider swap windows

- ✅ `init` — resets init timer for new rider; cooldown check applies to new rider.
- ✅ Phase-1 `ramp` (rider hasn't touched `hi_rpm` yet) — reverts to `init`.
- ❌ Any `maintain` state.
- ❌ Phase 2+ `ramp` (they already committed during phase 1).
- ❌ `locked` in any form.

Swap mechanics:

- Swapped-out user receives **no cooldown penalty** (never completed).
- New rider receives a cooldown on challenge end (success/fail/abandon).
- If `ridersUsed` array has multiple entries on completion, each receives cooldown.

### Pause from outer governance

When `base_requirement` fails for any user (brainstorming Q10, option C), the cycle challenge freezes. Implementation reuses existing `pausedAt` / `pausedRemainingMs` pattern (`GovernanceEngine.js:2129-2145`). All active cycle timers (`initElapsedMs`, `rampElapsedMs`, `phaseProgressMs`) are frozen; dim is not rendered; lock screen not shown. When base_requirement is restored, timers resume from their frozen values.

## Progress & Dim Math

### Boost multiplier

Recomputed every engine tick, no hysteresis (zone classification upstream already debounced):

```
boostMultiplier = clamp(
  1.0 + Σ over all users (INCLUDING rider):
    zone_multipliers[userZone] || 0,
  1.0,
  max_total_multiplier
)
```

Rider self-boost is included — cranking resistance on the bike pushing them into hot/fire rewards them with faster progress accrual. `boostingUsers` array in the state snapshot lists all users currently contributing (for UI).

### Maintain progress accrual

```
tickDurationMs = now - lastPulseAt
if cycleState === 'maintain' AND currentRpm >= phase.hi_rpm:
  phaseProgressMs += tickDurationMs × boostMultiplier
# Otherwise: no accrual (dim zone pauses; below lo_rpm triggers lock)
```

### Dim factor (for video filter vars)

```
if cycleState === 'maintain' AND lo_rpm ≤ currentRpm < hi_rpm:
  dimFactor = (hi_rpm - currentRpm) / (hi_rpm - lo_rpm)   # 0 at hi, 1 at lo
else:
  dimFactor = 0   # clean above hi; full lock screen below lo (not dim)
```

### Video CSS application

Frontend binds an inline CSS var on the fitness player root:

```jsx
<div
  className="fitness-player cycle-dim"
  style={{ '--cycle-dim': String(dimFactor) }}
>
```

```scss
.fitness-player.cycle-dim {
  video, dash-video, .video-player {
    filter:
      brightness(calc(1 - var(--cycle-dim, 0) * 0.4))
      grayscale(calc(var(--cycle-dim, 0) * 1))
      sepia(calc(var(--cycle-dim, 0) * 0.4))
      blur(calc(var(--cycle-dim, 0) * 4px));
    transition: filter 0.3s ease;
  }
}
```

Values match the existing `.governance-filter-critical` class at `dimFactor: 1.0` (`grayscale(1) brightness(0.6)`) — continuous visual language with existing governance warnings.

### Lock screen

Uses existing `GovernanceStateOverlay`. One new pill variant `&__pill--rpm` added to render RPM targets styled by current-HR zone hue. The lock row shows:

- Rider avatar
- Current RPM pill (colored by their HR zone — gives urgency cue)
- Target RPM pill (`hi_rpm`)
- Progress bar showing RPM climb toward target

Video `pause()` is called (same path as existing `videoLocked: true`).

### Tick cadence

Cycle challenge evaluation lives inside `_evaluateChallenges` dispatch. **Uses the existing engine heartbeat** — no `setInterval`, no separate timer entries in `this.timers`. Self-schedules via existing `_schedulePulse(delayMs)`:

- During `maintain`: `~200ms` (smooth dim/progress rendering).
- During `init`, `ramp`, `locked`: `~500ms` (matches existing challenge-pause cadence).

## UI Components

### CycleChallengeOverlay

~220px circular widget. Same footprint and tap-to-cycle positioning (`top | middle | bottom`) as existing `ChallengeOverlay`. Uses dedicated localStorage key `fitness.cycleChallengeOverlay.position`.

Layered composition (inside the 220px circle):

1. **Outer status ring** — SVG circle; stroke color maps to `cycleState`:
   - `init` → slate blue
   - `ramp` → warm yellow
   - `maintain` at/above `hi_rpm` → green
   - `maintain` in dim band → orange (brightness pulses with `dimFactor`)
   - `locked` → red
2. **Phase progress sweep** — outer ring stroke-dashoffset animates 0→full as `phaseProgressMs / maintain_seconds` fills. Reset to 0 on new phase.
3. **Top-hemisphere RPM gauge arc** — 180° arc spanning `[0, gaugeMaxRpm]` (default 120). Tick marks every 10 RPM. Prominent colored ticks at `lo_rpm` (red) and `hi_rpm` (green). Needle rotates to `currentRpm`; needle glows green when ≥ `hi_rpm`.
4. **Rider avatar** — 70px circular, centered. Border in rider's HR zone color. Clickable when `swapAllowed`; shows swap icon on hover. Non-interactive otherwise.
5. **Rider HR text** — small number below avatar, e.g., "142 bpm", colored by zone.
6. **Target RPM sign** — bold number near the `hi_rpm` tick on the gauge. Pulses briefly on phase change.
7. **Segment counter** — small pill at bottom center, e.g., "2 / 4".
8. **Booster avatars** — up to 4 small (24px) circular avatars positioned in the four quadrants outside the main ring. Each glows in their zone color. Appear/disappear as users enter/leave qualifying zones.

### CycleRiderSwapModal

Full-screen modal via `ReactDOM.createPortal`, patterned after `VoiceMemoOverlay`:

```
┌───────────────────────────────┐
│  Switch rider                ×│
├───────────────────────────────┤
│  [avatar] Felix    (available)│
│  [avatar] Milo     (last: 2m) │
│  [avatar] kckern   (cooldown) │
├───────────────────────────────┤
│         [Cancel]              │
└───────────────────────────────┘
```

- Eligible users from `equipment.eligible_users`, minus current rider.
- Users on cooldown shown greyed out (non-selectable).
- Confirm tap → calls `engine.swapCycleRider(userId)`.
- Cancel tap / scrim click → close.

### Component files

- `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx`
- `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.scss`
- `frontend/src/modules/Fitness/player/overlays/CycleRiderSwapModal.jsx`
- `frontend/src/modules/Fitness/player/overlays/CycleRiderSwapModal.scss`

### Reused

- Modal shell pattern from `VoiceMemoOverlay.jsx`.
- Lock-screen shell from `GovernanceStateOverlay.jsx` (add RPM pill variant).
- Dim filter precedent from `.governance-filter-critical` class.

## Engine → UI Contract

New fields on the state snapshot when `activeChallenge.type === 'cycle'`:

```js
{
  type: 'cycle',
  rider: {
    id: 'felix',
    name: 'Felix',
    avatar: '...',
    hrZone: 'warm',
    hr: 142
  },
  cycleState: 'init' | 'ramp' | 'maintain' | 'locked',
  currentPhaseIndex: 0,
  totalPhases: 4,
  currentPhase: { hiRpm, loRpm, maintainSeconds, rampSeconds },
  generatedPhases: [...],          // full list for pager UI
  currentRpm: 58,
  phaseProgressPct: 0.62,          // 0-1 for current phase
  allPhasesProgress: [1.0, 1.0, 0.62, 0.0],
  rampRemainingMs: 7200,
  rampTotalMs: 15000,
  initRemainingMs: null,
  initTotalMs: null,
  dimFactor: 0.34,
  boostMultiplier: 1.5,
  boostingUsers: ['soren', 'kckern'],
  lockReason: null | 'init' | 'ramp' | 'maintain',
  swapAllowed: true,
  swapEligibleUsers: [...]         // equipment.eligible_users minus cooldown minus current
}
```

## History

Cycle challenges push to `challengeHistory` (existing 20-entry cap at `GovernanceEngine.js:2167`). New fields added; existing pattern preserved.

```js
{
  id: 'default_challenge_0_1713456789000',
  type: 'cycle',                    // NEW; existing entries lack this (implicit 'zone')
  status: 'success' | 'failed' | 'abandoned',
  startedAt: 1713456789000,
  completedAt: 1713457023000,
  selectionLabel: 'Cycle sprints',

  // cycle-specific
  rider: 'felix',
  ridersUsed: ['milo', 'felix'],    // if swapped during init
  totalPhases: 4,
  phasesCompleted: 3,
  phases: [
    { hiRpm: 60, loRpm: 45, maintainSeconds: 30, rampMs: 8200, maintainMs: 30000, boostedMs: 4100 }
  ],
  totalLockEventsCount: 2,
  totalBoostedMs: 12400,
  boostContributors: ['kckern', 'soren']
}
```

**New status `abandoned`** — fires if session ends with cycle challenge still active. Distinguishes "gave up" from "completed" / "failed" for post-session analytics.

## Audio Cues

New cue IDs consumed by existing `GovernanceAudioPlayer`. No new audio infrastructure:

```yaml
governance:
  audio:
    cycle_challenge_init: "audio/cycle-start.mp3"
    cycle_phase_complete: "audio/cycle-phase-done.mp3"
    cycle_success: "audio/cycle-victory.mp3"
    cycle_locked: "audio/cycle-locked.mp3"
```

Fires on `cycleState` transitions, not per-tick. No boost-related audio (boost is purely visual).

## Manual Trigger

Existing `triggerChallenge(payload)` extended:

```js
engine.triggerChallenge({
  type: 'cycle',
  selectionId: 'default_challenge_0_0',
  riderId: 'felix'            // optional; overrides random pick
});
```

- `riderId` provided → bypasses cooldown (manual admin override).
- `riderId` omitted → normal random pick from `eligible_users` minus cooldown.
- `riderId` not in `eligible_users` → rejected, logged error.

New public method for swap:

```js
engine.swapCycleRider(riderId)
```

Validates:

1. Active cycle challenge exists.
2. `cycleState ∈ {init, phase-1 ramp}`.
3. `riderId` in `equipment.eligible_users`.
4. `riderId` not on cooldown (admin UI could pass `force: true` to bypass).

Returns `{ success: true }` or `{ success: false, reason: '...' }`. UI surfaces failure as a toast.

## Data Flow

### New engine input

```js
engine.update({
  activeParticipants,
  userZoneMap,
  totalCount,
  equipmentCadenceMap: {              // NEW
    cycle_ace: { rpm: 72, connected: true },
    tricycle: { rpm: 0, connected: true }
  }
});
```

`FitnessSession` exposes `getEquipmentCadence(equipmentId)` or a bulk `getAllEquipmentCadence()` method. The session already tracks per-equipment cadence via the existing cadence sensors (see `data/household/config/fitness.yml` cadence mappings); we surface a cleaner accessor.

`activeRiderId` is **not** supplied by the session — it's maintained by the engine itself (set when cycle challenge starts, cleared when it ends, updated on swap).

## Testing Strategy

Given the complexity (multi-phase state machine × boost math × pause-resume × swap windows × procedural generation × lock recovery), testing must be sophisticated and layered.

### Unit Tests (`tests/unit/governance/`)

**`GovernanceEngine.cycle.stateMachine.test.js`** — state transitions. Deterministic mock clock. Table-driven:

| Scenario | Setup | Tick inputs | Expected cycleState transition |
|---|---|---|---|
| Init→ramp on min_rpm reached | cycleState=init, rpm=0 | rpm=30, base_req satisfied | ramp (phase 0) |
| Init timeout → locked | cycleState=init, elapsed=60s | tick after 61s | locked (init) |
| Ramp→maintain on hi touch | cycleState=ramp, hi=60 | rpm=60 | maintain, phaseProgress=0 |
| Ramp timeout → locked | cycleState=ramp, elapsed=15s | tick after 16s | locked (ramp) |
| Maintain at hi accrues | cycleState=maintain, rpm=65 (hi=60) | tick 1000ms | phaseProgress += 1000 (×1 if no boost) |
| Maintain dim pauses | cycleState=maintain, rpm=50 (hi=60, lo=45) | tick 1000ms | phaseProgress unchanged, dim=0.66 |
| Maintain below lo → locked | cycleState=maintain, rpm=40 (lo=45) | tick | locked (maintain) |
| Locked (maintain) → resume | cycleState=locked, rpm climbs to hi | tick at rpm=65 | maintain, phaseProgress preserved |
| Phase completion advances | phaseProgress=maintain_seconds | tick | ramp (phase N+1) |
| Final phase complete → success | phaseProgress=maintain_seconds, lastPhase=true | tick | outer status=success |
| Base req pause freezes timers | maintain, rpm=65, other user=cool | tick 1000ms | all timers paused, dim=0 |
| Base req resume restores | paused state, other user recovers | tick 1000ms | timers resume from saved values |

**`GovernanceEngine.cycle.boost.test.js`** — boost multiplier math:

- Zero boosters → 1.0x
- Rider self-boost hot (while riding): 1.5x
- Rider self-boost fire: 2.0x
- Rider + 1 external hot booster: 1.5x + 0.5x = 2.0x
- Rider fire + 2 external fire boosters: 1.0 + 1.0 + 1.0 + 1.0 = 4.0 → clamped to `max_total_multiplier` (3.0)
- Booster leaves zone → multiplier drops next tick
- Booster in cool zone contributes 0
- Progress rate verification: at rpm≥hi with 2x boost, `phaseProgressMs` advances 2000ms per 1000ms real-time tick.

**`GovernanceEngine.cycle.generation.test.js`** — procedural phase generation. Seed randomness via injected RNG:

- `random` type: N values in `hi_rpm_range`, no ordering guarantee
- `progressive`: phase[0].hiRpm ≤ phase[1].hiRpm ≤ ... (within jitter tolerance)
- `regressive`: descending
- `constant`: all equal
- `segment_count: [3, 5]` → count always in range
- `segment_duration_seconds` independent per phase
- `lo_rpm` correctly derived from `lo_rpm_ratio`
- Explicit `phases[]` overrides procedural (warning emitted)

**`GovernanceEngine.cycle.swap.test.js`** — swap logic:

- Swap during init: rider changes, init timer resets
- Swap during phase-1 ramp: state reverts to init
- Swap during phase-1 maintain: rejected
- Swap during phase-2 ramp: rejected
- Swap during locked: rejected
- Swap to user on cooldown: rejected (unless `force: true`)
- Swap to user not in `eligible_users`: rejected
- Swapped-out user does NOT receive cooldown
- All riders who pedaled receive cooldown on challenge end

**`GovernanceEngine.cycle.cooldown.test.js`** — cooldown behavior:

- After success, rider on cooldown for `user_cooldown_seconds`
- After failure/abandon, rider also on cooldown
- `eligible_users` filtered for next cycle pick
- All eligible on cooldown → cycle selection re-rolls the bag (no cycle fires; zone/vibration draws instead)
- Cooldown expires at correct timestamp

**`GovernanceEngine.cycle.recovery.test.js`** — lock recovery paths:

- init-lock: recover requires rpm ≥ `init.min_rpm`
- ramp-lock: recover requires rpm ≥ phase `hi_rpm`, resumes directly in `maintain`
- maintain-lock: recover requires rpm ≥ `hi_rpm`, resumes in `maintain` with preserved `phaseProgressMs`
- Multiple lock/recover cycles in one phase: `totalLockEventsCount` increments correctly

### Integration Tests (`tests/integrated/governance/`)

Real `GovernanceEngine` + real `FitnessSession` + mock HR sensor + mock cadence sensor + deterministic clock.

**`cycle-challenge.happy-path.test.mjs`**

Full flow:
1. Policy config has 1 cycle selection + 3 zone selections.
2. Initial conditions: governed media playing, 3 users all in active zone.
3. Seed RNG so cycle selection is drawn.
4. Assert: rider assigned, cycleState=init, overlay state emitted.
5. Drive mock cadence: rpm climbs from 0 to 30 over 20s → state → ramp.
6. Drive cadence to 60 (hi) → state → maintain.
7. Hold 60 for maintain_seconds → phase advance.
8. Complete all phases → status=success, history entry recorded.
9. Assert: rider added to cooldown map.

**`cycle-challenge.boost-stacking.test.mjs`**

1. Cycle challenge active, rider at rpm=hi.
2. Snapshot `phaseProgressMs` accrual rate at 1.0x.
3. Move booster B into hot zone. Assert rate = 1.5x.
4. Move booster C into fire zone. Assert rate = 2.5x (capped at max).
5. B drops to warm. Assert rate = 2.0x.
6. Rider enters fire themselves. Assert rate includes self-boost.

**`cycle-challenge.base-req-pause.test.mjs`**

1. Cycle challenge active, rider in maintain at rpm=hi, phaseProgress accruing.
2. Other user drops to cool, violating `base_requirement: active: all`.
3. Assert: all cycle timers pause, dimFactor=0, no new lock.
4. Other user returns to active.
5. Assert: timers resume from saved values (within 100ms tolerance).

**`cycle-challenge.swap-flow.test.mjs`**

1. Cycle challenge fires, rider = Felix.
2. During init, call `swapCycleRider('milo')`.
3. Assert: rider = Milo, init timer reset, history doesn't yet have Felix in cooldown.
4. Milo completes challenge.
5. Assert: only Milo on cooldown (Felix unaffected).

**`cycle-challenge.ramp-lock-recovery.test.mjs`**

1. Cycle at phase 2, ramp active (hi=70).
2. Mock cadence never reaches 70 within `ramp_seconds`.
3. Assert: cycleState=locked (ramp), video paused.
4. Rider cranks resistance, rpm→75.
5. Assert: cycleState=maintain (ramp skipped), video resumed.

### Live Flow Tests (`tests/live/flow/fitness/`)

Playwright-driven against the running dev server. Reuses existing mock HR + mock cadence harnesses.

**`cycle-challenge-happy-path.runtime.test.mjs`**

- Start governed video.
- Inject cycle challenge via admin trigger endpoint.
- Assert `CycleChallengeOverlay` visible in DOM.
- Assert rider avatar rendered, target RPM sign shows expected value.
- Drive mock cadence, verify gauge needle position updates.
- Drive to success, assert lock/history/state.

**`cycle-challenge-swap-modal.runtime.test.mjs`**

- Cycle challenge in init state.
- Click rider avatar.
- Assert `CycleRiderSwapModal` opens via portal.
- Assert eligible users list correct.
- Select alternate rider, confirm.
- Assert modal closes, overlay rider updates.

**`cycle-challenge-dim-progression.runtime.test.mjs`**

- Cycle challenge in maintain, rpm=hi. Assert video has no filter.
- Drop rpm to midpoint between hi and lo. Assert CSS var `--cycle-dim` ≈ 0.5.
- Drop rpm to lo+1. Assert var ≈ 1.0.
- Drop rpm below lo. Assert `videoLocked` state; lock overlay visible.

**`cycle-challenge-lock-screen.runtime.test.mjs`**

- Force ramp timeout.
- Assert `GovernanceStateOverlay` with RPM pill variant visible.
- Assert rider row shows current RPM (red/urgent styled) and target RPM.
- Recover rpm to hi.
- Assert lock dismisses, maintain phase begins.

### Property-Based / Fuzz Tests

**`GovernanceEngine.cycle.fuzz.test.js`** — random state-machine walk:

- Generate random sequence of `tick` inputs (rpm values, HR zone assignments, timeouts) for 100+ steps.
- Invariants the engine must preserve:
  - `phaseProgressMs ∈ [0, maintain_seconds × 1000]`.
  - `boostMultiplier ∈ [1.0, max_total_multiplier]`.
  - `currentPhaseIndex` monotonically non-decreasing until reset.
  - `cycleState` only transitions along valid edges.
  - Total time across states + pauses = wall clock time (within tolerance).
  - `videoLocked` iff `cycleState === 'locked'` OR base_req violated.

### Snapshot Tests

**`GovernanceEngine.cycle.snapshot.test.js`** — golden-snapshot the engine state snapshot at key moments:

- Init start
- First phase ramp start
- First phase maintain start, midpoint, completion
- Phase 2 ramp
- Lock
- Recovery
- Success

Protects against inadvertent snapshot contract changes. Comparison excludes timestamps.

### Test Harness Requirements

To support the above, the following test utilities must exist or be built:

- **Deterministic clock** for `GovernanceEngine` — engine should accept an injectable `now()` function, defaulting to `Date.now`.
- **Injectable RNG** for `GovernanceEngine._normalizePolicies` and phase generation — accept a seeded RNG (e.g., `seedrandom`).
- **Mock cadence feed** — test-only method `session.setEquipmentCadence(equipmentId, { rpm, connected })` for integration tests.
- **Mock HR feed** — already exists in existing test infrastructure; verify it supports zone-level sets (`setUserZone(userId, zoneName)`).
- **Admin trigger route** — `/api/v1/fitness/admin/trigger-challenge` accepting cycle payloads (for live tests to kick off cycle challenges deterministically).

## Implementation Order

1. **Config normalization** (`_normalizePolicies`) — accept `type: cycle` selections, procedural + explicit phases, equipment `eligible_users`.
2. **Engine state machine** (`_evaluateCycleChallenge`) — full transition table with unit test coverage.
3. **Phase generation** — procedural variants with injectable RNG.
4. **Equipment cadence wiring** — `FitnessSession.getEquipmentCadence()` + engine input.
5. **State snapshot emission** — all fields in the Engine→UI contract section.
6. **Pause/resume integration** — hook cycle timers into existing base-req pause logic.
7. **History recording** — cycle-specific fields, `abandoned` status.
8. **Audio cue wiring** — `cycle_*` IDs in `GovernanceAudioPlayer`.
9. **`triggerChallenge` + `swapCycleRider` methods** — public API.
10. **Frontend: CSS dim vars** — apply `--cycle-dim` on fitness player root.
11. **Frontend: `CycleChallengeOverlay`** — custom SVG widget.
12. **Frontend: `CycleRiderSwapModal`** — portal modal.
13. **Frontend: `GovernanceStateOverlay` RPM pill variant** — for lock screen.
14. **Test suite** — unit, integration, live flow, fuzz, snapshot.

## Open Questions / Deferred

- **Grace period on base-req pause during ramp/init** — current design pauses indefinitely. Consider whether a max pause duration should abort the challenge. Deferred: wait for real-world signal.
- **Cross-equipment cycle challenges** — could a single session config support cycle challenges on multiple bikes simultaneously? Current design: one `activeChallenge` slot, so only one cycle at a time. Multi-bike = future extension.
- **Pre-challenge "warning" countdown** — existing system has `nextChallenge` preview for zone challenges ("challenge in 30s"). Cycle preview shows generic "cycle challenge coming" (no rider, per Q16). Consider if equipment name should be shown in preview.
- **Admin "skip phase" / "end now"** — useful for debugging but potentially abusable. Deferred.
