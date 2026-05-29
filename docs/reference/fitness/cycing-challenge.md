# Cycle Challenge Overlay

The cycle challenge overlay is the circular ~220-unit widget shown during a fitness
cycling challenge. It visualises everything the rider needs to read at a glance: how
fast they are pedalling, the target band they must hold, how far through the current
phase they are, how many phases remain, who else is boosting them, and — most
urgently — whether they are about to be locked out.

It is a pure presentational component. All of its logic is *derivation*: it takes a
single `challenge` snapshot produced by the governance engine each tick and turns it
into geometry, colours, and text. It owns no timers, no state machine, and no
placement — `ChallengeOverlayDeck` decides whether it sits top, middle, or bottom of
the screen.

---

## The data contract

The overlay reads one prop, `challenge`, a per-tick snapshot. The snapshot is built
in the governance engine's display projection and carries:

| Field | Meaning |
|-------|---------|
| `type` / `cycleState` | Discriminator (`'cycle'`) and lifecycle state (`init` → `ramp` → `maintain` → `locked`, plus terminal `success`). |
| `currentPhase` | The active phase's `{ hiRpm, loRpm, maintainSeconds, … }`. Drives the gauge band and target. |
| `currentRpm` | Live smoothed cadence. Drives the needle and the bottom RPM readout. |
| `currentPhaseIndex` / `totalPhases` | Position within the phase sequence. Drives the phase blocks and the aria phase count. |
| `phaseProgressPct` | Fraction `[0,1]` of the current phase's maintain time elapsed (the "Pct" suffix is historical — the value is a fraction, not 0–100). Drives the lower-hemisphere progress arc. |
| `dimFactor` | `[0,1]` dim amount during maintain; > 0 means the rider has slipped into the orange "dimming" band. |
| `cycleHealthPct` | Fraction `[0,1]` of the health pool remaining. Depletes at 1ms/ms while RPM is below loRpm; regenerates at 1.5ms/ms in the green zone (≥ hiRpm). At zero the video pauses (`videoLocked`). Shown as a compact horizontal bar in the lower stack. |
| `clockPaused` / `initRemainingMs` / `rampRemainingMs` | Countdown text for the `init` and `ramp` states; `clockPaused` is set when the rider is below the init min-RPM threshold. |
| `boostingUsers` / `boostMultiplier` | Corner booster pips and the `×N.N` multiplier pill. |
| `baseReqSatisfiedForRider` / `waitingForBaseReq` | Heart-rate gate status, shown as a dot on the rider avatar. |
| `swapAllowed` | Whether tapping the rider avatar may request a swap (engine allows it only during `init`, or `ramp` while on phase 0). |
| `cadenceFlags` | `{ lostSignal, stale, … }` — surfaced as overlay modifier classes. |

`getCycleOverlayVisuals(challenge)` (in `cycleOverlayVisuals.js`) is the first
gatekeeper. It returns `{ visible: false, … }` for anything that is not a cycle
challenge with a recognised `cycleState`, and otherwise maps the snapshot to ring
colour, ring opacity, the dim pulse flag, and the clamped progress/danger values. If
`visible` is false — or `challenge` is null — the component renders nothing.

---

## What the component draws

### Ring colour and the dim pulse

Colour is decided entirely by `cycleState` and `dimFactor`:

- `init` → slate blue, opacity 0.9
- `ramp` → warm yellow
- `maintain`, holding at/above target (`dimFactor === 0`) → green
- `maintain`, slipping (`dimFactor > 0`) → orange, with `dimPulse` set and ring
  opacity scaled down by `dimFactor` (floored at 0.35 so it never disappears)
- `maintain`, below lo (failing) → health meter depletes; video pauses when empty
- `locked` → red

`dimPulse` adds the `--dim-pulse` modifier class, and `lostSignal` / `stale`
add their own modifier classes for the CSS to react to.

### RPM gauge (top hemisphere)

The top half of the ring is a speedometer-style gauge spanning 0 → `CYCLE_GAUGE_MAX_RPM`
(120), mapped 9 o'clock → 12 → 3 o'clock by `rpmToAngle`/`polarToCartesian`:

- A faint arc with tick marks every 10 RPM.
- A **green hi marker** at `currentPhase.hiRpm` and a **red lo marker** at
  `currentPhase.loRpm` — the band the rider must stay in.
- A **needle** rotated to `currentRpm`. The needle and hub turn green
  (`--at-hi`) once `currentRpm >= hiRpm`.
- A **target sign** anchored just outside the hi tick, showing the rounded
  target RPM. It falls back to top-centre when there is no hi value.

### Phase progress arc (lower hemisphere)

The bottom half of the ring is a progress arc sweeping 9 → 6 → 3 o'clock, drawn with
`stroke-dasharray`/`stroke-dashoffset` so the fill fraction animates. It shows
**phase progress only** — the `phaseProgressPct` fraction in the ring colour —
and is monotonic: it holds when the clock is paused and never jumps backward.
It is not repurposed into a danger countdown.

### Health meter

A compact horizontal bar in the lower stack (first child of `__stack`) shows the
rider's remaining health:

- **Depletes** at 1 ms health per 1 ms real time while RPM is below `loRpm`.
- **Holds** when RPM is in the amber `lo..hi` band.
- **Regenerates** at 1.5× rate when RPM is in the green zone (`≥ hiRpm`).
- When the pool hits zero the engine sets `cycleState: 'locked'` with
  `lockReason: 'health'`, which flips `videoLocked: true` — pausing the video —
  even though the parent governance phase is `unlocked`. The cycle overlay stays
  visible with an empty meter so the rider can see exactly why playback stopped.
- Recovery: reaching the green zone (`≥ hiRpm`) transitions back to `maintain`
  with the health pool reset to full.
- The pool resets to full on challenge start and on each `ramp → maintain` phase
  entry, so riders start each phase with a fresh buffer.

The separate danger ring and numeric countdown are removed; the health bar is the
sole punishment affordance.

### Rider, phases, countdown, RPM readout

Below/around the ring, all stacked in one bottom-anchored flex column
(`__stack`) so nothing overlaps regardless of rendered size:

- **Rider avatar** centred, loaded from `/api/v1/static/img/users/{riderId}`,
  with an initials fallback. The avatar is the sole rider identifier — no
  persistent name label is shown. The avatar is a `<button>`; when `swapAllowed`
  it is clickable and invokes `onRequestSwap`, logging a `swap-requested` event.
  The `CycleBaseReqIndicator` heart-rate gate dot (inactive / waiting / satisfied)
  is rendered on the avatar itself — it costs no additional row.
- **Boost pill** (`×2.5` etc.), shown only when `boostMultiplier > 1`.
- **Phase blocks** via `CompletionCountBlocks` — one rounded square per phase,
  the first `currentPhaseIndex` of them lit (phases before the current one are
  complete).
- **Countdown text** for `init` ("Start in 8s") and `ramp` ("Reach target in 5s"),
  prefixed with "Paused —" when `clockPaused`.
- **Current RPM readout** (large number + "RPM").

### Booster pips

`getBoosterAvatarSlots` returns up to four corner pips (NE/SE/SW/NW) at fixed
percentage offsets so they scale with the overlay and sit on the ring's diagonals.
Caps at four with no overflow indicator.

### Accessibility & logging

The root carries an `aria-label` summarising state and phase ("Cycle challenge — maintain, phase 2 of 4"); the SVG is `aria-hidden`; the health meter exposes a `meter` role; the base-req dot is a `status`. The component logs `mounted`, `state-change`, and `swap-requested` through the structured logger child `cycle-challenge-overlay`.

---

## Implementation

- `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx` — the component
- `frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.js` — visual/geometry/booster pure helpers
- `frontend/src/modules/Fitness/player/overlays/CycleBaseReqIndicator.jsx` — heart-rate gate dot
- `frontend/src/modules/Fitness/player/overlays/CompletionCountBlocks.jsx` — phase block strip
- `frontend/src/modules/Fitness/player/overlays/ChallengeOverlayDeck.jsx` — placement owner
- `frontend/src/hooks/fitness/GovernanceEngine.js` — produces the `challenge` snapshot (see `governance-engine.md`)
- `frontend/src/modules/Fitness/widgets/CycleChallengeDemo/CycleChallengeDemo.jsx` — `?cycle-demo` visual harness
