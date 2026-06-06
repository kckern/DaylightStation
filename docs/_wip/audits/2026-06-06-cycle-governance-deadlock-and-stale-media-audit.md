# Cycle Governance Audit — Lock Deadlock After Rider Swap + Stale Governance Media During Race

> **Resolved 2026-06-06** on branch `fix/cycle-governance-deadlock-and-stale-media`.
> Issue 1: locked cycle now exempt from the base-req pause gate (recovers from cadence).
> Issue 2: `GovernanceEngine.setSuspended()` added; `CycleGameContainer` parks governance
> while the race owns the screen. Plan: `docs/superpowers/plans/2026-06-06-cycle-governance-fixes.md`.
> Pending: live ride verification on the garage display (see plan Task 4 Steps 4–5).

**Date:** 2026-06-06
**Scope:** `frontend/src/hooks/fitness/GovernanceEngine.js`, `frontend/src/modules/Fitness/player/FitnessPlayer.jsx`, `frontend/src/context/FitnessContext.jsx`, `frontend/src/modules/Fitness/widgets/CycleGame/`
**Evidence:** prod fitness session logs (garage display, Firefox, IP 172.18.0.70)
`media/logs/fitness/2026-06-06T18-06-23.jsonl` and `media/logs/fitness/2026-06-06T18-02-13.jsonl`

Two distinct, confirmed bugs were found while investigating "the video locked and wouldn't
resume even though the rider pedalled past green" and "an HR challenge overlay appeared around
the (ungoverned) cycle race game."

---

## Issue 1 — Cycle lock deadlocks after a rider swap (base-req gate starves cadence recovery)

### Symptom
A cycle challenge locked the video. The rider exceeded the green (hi-RPM) threshold but playback
never resumed. The lock persisted until the session ended.

### Log timeline (`2026-06-06T18-06-23.jsonl`)
| Time (UTC) | Event |
|------------|-------|
| 18:18:35 | **Rider swap** `milo → alan` (`governance.cycle.swap_completed`, `force:true`). Kept `currentPhaseIndex:2` (hardest phase, hiRpm **72**); reset to `init→ramp`. |
| 18:18:59 | Alan's ramp times out at **45 RPM** (needed 72) → `governance.cycle.locked` (`lockReason:'ramp'`); `playback.paused`, `cycle-lock-shown`. |
| 18:19:01 | Governance phase flips `unlocked → warning`; **same ms** `governance.cycle.paused_by_base_req` fires. |
| 18:19:01 → 18:19:29 | Cycle stays `locked`. **No `governance.cycle.recovered`.** Session ends locked. |

The first lock that session (milo, health-lock at 18:17:42) *did* recover 5s later — because at
that moment governance phase was still `unlocked`.

### Root cause
In `GovernanceEngine._updateCycleChallenge`, the base-requirement pause gate sits **above** the
lock-recovery branch:

- **`GovernanceEngine.js:2779-2793`** — `if (ctx.baseReqSatisfiedGlobal === false && !active.manualTrigger) { … return; }`
  early-returns the entire cycle update.
- **`GovernanceEngine.js:2997-3015`** — the locked→maintain recovery
  (`if (ctx.equipmentRpm >= phase.hiRpm) { unlock }`) lives *below* that return and is never reached.
- **`GovernanceEngine.js:3456`** — `baseReqSatisfiedGlobal = (this.phase === 'unlocked')`.

So once the global HR base-requirement is unmet (governance phase ≠ `unlocked`), the cycle update
returns every tick **before** evaluating cadence. A freshly swapped-in rider whose heart rate has
not yet climbed into the required zone trips this gate immediately — and can never pedal out of the
lock no matter how fast they spin. **The cadence-based recovery is gated behind an HR-based gate,
and the HR gate wins → deadlock.**

The user's intuition ("because the rider changed midway through") is correct: the swap introduces a
rider with no established HR zone, which flips the governance phase out of `unlocked` and starves
the cadence recovery path.

### Contributing factor
`swapCycleRider` (**`GovernanceEngine.js:3938-4013`**) changes `active.rider` and resets to `init`
but **inherits the current `currentPhaseIndex`** (here phase 2, the hardest, hiRpm 72) instead of
restarting the new rider at an easier phase. That is *why* alan locked out at all — he was dropped
straight into the hardest phase with a 72-RPM ramp target.

### Recommended fix (direction — not yet applied)
- Let the `locked`-state cadence recovery branch run even when `baseReqSatisfiedGlobal === false`.
  A locked cycle should always be escapable by pedalling. Move the recovery check above the
  base-req pause gate, or exempt `cycleState === 'locked'` from the gate.
- Reconsider what phase a swapped-in rider inherits (restart at phase 0, or re-ramp).

---

## Issue 2 — Governance keeps running during/after the (ungoverned) CycleGame race (stale `this.media`)

### Symptom
An HR-zone `ChallengeOverlay` (`governance.challenge.*`) surfaced around the cycle **race game**,
which is not supposed to be governed.

### Log evidence
- `2026-06-06T18-02-13.jsonl`: race window `race_started 18:03:57 → race_finished 18:05:58`.
  `governance.challenge.started` fired at **18:06:13** (~15s after the race ended), and
  governance `phase_change` events (`unlocked→warning→locked`) fired **throughout** the race window.
- **`governance.evaluate.media_not_governed` fired 0 times** the entire session →
  `_mediaIsGoverned()` returned `true` continuously, including during and after the race.
- Playback log shows the governed video "Cakes, Pies, & Flat Earth Guys" was `playback.started`
  then `playback.paused` before the race — i.e. **paused, never cleared.**

A full scan of all 9 race sessions on 2026-06-06 found **no** `governance.challenge.*` or
`governance.cycle.*` event landing *strictly inside* a race window — they fire just before/after,
while the engine still believes the paused video is the active governed media.

### Root cause
Governance is gated on `this.media` only:
- **`GovernanceEngine.js:2087-2095`** — `evaluate()` bails to idle (no challenges, no phase
  machine) when `!_mediaIsGoverned()`.
- **`GovernanceEngine.js:823-841`** — `_mediaIsGoverned()` is purely a function of `this.media`
  (governed label or governed type).
- **`GovernanceEngine.js:1182-1189`** — `setMedia()` is the only writer of `this.media`.

`setMedia` is driven from the **video player**, keyed to `currentItem`:
- **`FitnessPlayer.jsx:356-368`** — effect calls `setGovernanceMedia(null)` only when
  `currentItem` is null, otherwise sets it to the current video.
- **`FitnessContext.jsx:1122-1133`** — `setGovernanceMedia` → `session.governanceEngine.setMedia`.

The **CycleGame race widget does not touch governance media at all** (no `setMedia` /
`setGovernanceMedia` / `governanceEngine` references anywhere under
`modules/Fitness/widgets/CycleGame/`). When a race launches over a *paused* governed video,
`currentItem` is still that video, so `this.media` stays set, `_mediaIsGoverned()` stays `true`,
and the GovernanceEngine keeps evaluating HR zones, changing phase (incl. `locked`), and generating
challenges — even though the ungoverned race game (and later its recap) is what's actually on
screen.

So "CycleGame is not governed" is true at the widget level, but the engine is never told the game
took over; it keeps governing the stale paused video.

### Recommended fix (direction — not yet applied)
- When the CycleGame race takes over the screen, clear governance media
  (`setGovernanceMedia(null)`) for the duration of the race, and restore it when the race/recap
  closes. (Or have the engine treat a paused/superseded video as ungoverned.)
- Confirm the desired product behaviour: should governance pause entirely while a race is up? If
  so, gate `evaluate()` on an explicit "race active" flag in addition to `_mediaIsGoverned()`.

---

## Cross-cutting note
Both bugs share a theme: **governance state outliving the context that justifies it.** Issue 1 is a
gate-ordering inversion (HR gate starves cadence recovery); Issue 2 is stale media ownership (engine
keeps governing a video that is no longer the active surface). Neither is in the overlay components
themselves — `CycleChallengeOverlay.jsx` and `ChallengeOverlay.jsx` are faithful renderers of
upstream engine state.
