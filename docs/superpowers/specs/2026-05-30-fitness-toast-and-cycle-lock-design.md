# Fitness Toast Tweaks + Cycle Health-Lock Redesign — Design

**Date:** 2026-05-30
**Status:** Approved (design)
**Audit:** `docs/_wip/audits/2026-05-30-fitness-toast-and-cycle-lock-audit.md`

Four areas, ordered small → large. A/B/C are contained UI changes. D is a behavioral
redesign with a new abstraction and is the bulk of the work.

---

## A. Toast countdown direction + tap-to-dismiss

**Files:** `frontend/src/modules/Fitness/player/overlays/FitnessToast.jsx`, `FitnessToast.scss`

### A1. Countdown bar left → right
The bar currently depletes right→left (`transform-origin: left center` + `scaleX(1→0)`).
Change `__countdown-bar` to `transform-origin: right center` so the fill recedes toward the
right, reading left→right. CSS-only.

### A2. Tap / click to dismiss
- Root `.fitness-toast` becomes pointer-interactive: keep the overlay non-blocking
  elsewhere, but allow the toast itself to receive taps. Set `pointer-events: auto` on the
  root (the toast is small and centered; this is acceptable).
- Add an `onClick`/`onPointerDown` handler in `FitnessToast.jsx`: on activation, run the
  same exit path the hide-timer uses — `setExiting(true)` immediately, then `onDone(id)`
  after `TOAST_EXIT_MS` — so the fade/collapse still plays and the slot clears via
  `dismissFitnessToast(id)`. Clear the component's pending timers on manual dismiss to avoid
  a double `onDone`.
- Add `cursor: pointer` and a `role`/`aria` affordance; keep keyboard a11y minimal (the
  target is a touchscreen). Log `fitness.toast.dismissed` with a `reason: 'tap'` field to
  distinguish from timer dismissal.

---

## B. Challenge toast wording: "riders" → "people"

**File:** `frontend/src/modules/Fitness/player/overlays/buildChallengeToast.js` (+ test)

Zone challenges are satisfied by any activity (cycling, jumping jacks, walking in place), so
"riders" is wrong. Rename the word helper to use **"people" / "person"**:
- start: `Get 3 people to Active` / `Get 1 person to Active`
- end: `3 of 3 people reached Active` / `1 of 1 person reached Active`

Update `buildChallengeToast.test.js` strings accordingly. The **rider** toast
(`buildRiderToast`, "is riding the X") is a genuine bike assignment and is unchanged.

---

## C. Cycle overlay UX cleanup

**Files:** `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx`,
`CycleChallengeOverlay.scss`, `cycleOverlayVisuals.js`

The lower content is a bottom-anchored flex column (`__stack`) that grows upward, so any
conditional child shifts everything above it. Three changes:

### C1. Boost multiplier badge → float underneath (no reflow)
Keep the badge but remove it from `__stack` flow. Render it **absolutely positioned**,
centered horizontally, floating just **below** the overlay circle (e.g. `position:absolute;
top:100%; left:50%; transform:transl(-50%, …)`), so its appearance never reflows the stack.
Keep the pulse animation and `×N.N` text gated on `boostMultiplier > 1`.

### C2. Remove the init/ramp countdown status text
Delete the `__countdown` block (`CycleChallengeOverlay.jsx:431-447`) and its SCSS
(`CycleChallengeOverlay.scss:220-226`). This is the small "Start in Ns" / "Reach target in
Ns" label that bumped the layout. The init/ramp **ring color** still communicates phase;
only the text is removed.

### C3. Remove the booster avatars (the top-right circle-with-a-letter)
Delete the booster avatar map (`CycleChallengeOverlay.jsx:458-467`), the
`getBoosterAvatarSlots` import/usage, and the `&__booster` SCSS (`309-326`). These NE/SE/SW/
NW circular single-letter pips are what appeared near the top-right alongside the multiplier.
`getBoosterAvatarSlots` in `cycleOverlayVisuals.js` becomes dead — remove it and its tests.

### C4. Unchanged
Outer ring, RPM gauge (arc/ticks/needle/target sign), centered rider avatar + HR gate dot,
health meter, phase-count blocks, current-RPM readout, lower-hemisphere phase arc.

---

## D. Cycle health-lock redesign (the core)

### Problem (from audit)
On health-zero the engine sets `cycleState:'locked', lockReason:'health'` and forces
`videoLocked:true`. Today three independent booleans across two files decide what shows:
`CycleChallengeOverlay` visibility (`FitnessPlayerOverlay`), `GovernanceStateOverlay`
visibility (`useGovernanceDisplay.show`), and the audio (mounted only inside
`GovernanceStateOverlay`). The result: a blank generic lock sometimes renders (empty rows),
the cycle overlay vanishes, it's intermittent (200ms state cache + microtask render race),
and **no lock music plays** (the audio host is suppressed for this case).

### Intended behavior
On cycle health-lock: the **`CycleChallengeOverlay` itself becomes the lock screen** —
centered, ~2× scale, dimmed background hiding everything else; the **`locked` music plays**
(ducking media audio like the governance lock); it is a **real lock** (video stays paused,
play attempts re-pause); the generic `GovernanceStateOverlay` does **not** render. Recovery:
rider pedals back above `loRpm` → unlock, music stops, overlay returns to its normal
in-deck size.

### D1. Single owner: a lock-screen-variety resolver (pure, testable)
Add a pure function (new file under `frontend/src/modules/Fitness/player/overlays/`, e.g.
`resolveLockScreen.js`) that takes the governance state + active challenge snapshot and
returns one descriptor:

```
resolveLockScreen({ governanceState, governanceDisplay, activeChallenge }) → {
  variety: 'none' | 'governance' | 'cycle-health',
  showGovernanceOverlay: boolean,   // render GovernanceStateOverlay?
  showCycleOverlay: boolean,        // render CycleChallengeOverlay?
  promoteCycle: boolean,            // center + 2x + dim (cycle-health only)
  audioTrack: null | 'init' | 'locked',
  videoLocked: boolean
}
```

Rules:
- **cycle-health** (`type==='cycle' && cycleState==='locked' && lockReason==='health'`):
  `{ variety:'cycle-health', showGovernanceOverlay:false, showCycleOverlay:true,
  promoteCycle:true, audioTrack:'locked', videoLocked:true }`.
- **governance** (existing governance lock/pending/warning where `governanceDisplay.show`):
  delegate to existing behavior — `showGovernanceOverlay:true`, `audioTrack` per current
  `GovernanceStateOverlay` logic, `promoteCycle:false`.
- **none**: defaults; cycle overlay shows in-deck per the normal (non-terminal, non-lock)
  rule.

`FitnessPlayerOverlay` calls this once and renders from the single descriptor, eliminating
the split-brain. This is the fix for the blank screen (D2), the vanish (D3), and the
intermittency (D4): one source of truth means the two overlays can't independently lose, and
the cycle-health branch is keyed on the same primitives regardless of governance phase.

### D2. Promote presentation (center + 2× + dim)
When `promoteCycle` is true, wrap the `CycleChallengeOverlay` in a fixed, full-screen
**lock wrapper** (new element/class, e.g. `.cycle-lock-screen`): dim/scrim background
(`background: rgba(0,0,0,0.6)`), high z-index above the deck and governance overlays,
centered, with the overlay scaled ~2× (CSS `transform: scale(2)` on a centered container, or
a `--cycle-overlay-size` bump). The deck/other overlays are not rendered (or visually
covered) while promoted. When not promoted, the overlay renders inside
`ChallengeOverlayDeck` exactly as today.

### D3. Audio
Mount the lock audio for the cycle-health variety using the existing `GovernanceAudioPlayer`
with `trackKey='locked'`, driven by the resolver's `audioTrack`. Lifecycle: starts on
health-lock enter, stops on recover/unmount. Media-audio ducking/pause follows the same
mechanism the governance lock uses (the video is already paused via `videoLocked`; ensure
parity). The audio player should live where it survives the overlay being promoted — mount
it in `FitnessPlayerOverlay` keyed off the descriptor, not buried inside
`GovernanceStateOverlay`.

### D4. Real lock enforcement
`videoLocked` already flows to the pause arbiter (`pauseArbiter.js` via
`FitnessPlayer.jsx`). Verify (and add a test for) the invariant that while
`videoLocked` is true, a user play attempt re-pauses — i.e. the lock is continuous, not
one-shot. Keep `videoLocked` asserted by the existing engine clause until the rider recovers
above `loRpm`. No new pause path; reuse `videoLocked`.

### D5. Observability
Add structured logs so the next live occurrence is debuggable:
`governance.cycle.health_lock.enter` / `.recover` (engine or overlay), and a
`fitness.cyclelock.shown` / `.audio` from the overlay layer. Per project logging rules
(no raw console).

### D6. `useGovernanceDisplay` adjustment
The existing health-lock branch (`useGovernanceDisplay.js:42-53`) already returns
`show:false` for the clean case. Keep it, but the **resolver becomes the authority** — the
generic overlay renders only when the resolver says `showGovernanceOverlay`. This prevents
the "status flipped to pending → blank rows" failure: even if governance briefly reports a
non-unlocked status during a cycle health-lock, the resolver still classifies it as
`cycle-health` (challenge fields take precedence) and suppresses the generic panel.

---

## Testing strategy

- **A1/A2:** component test — countdown bar origin class; tap fires `onDone(id)` after
  `TOAST_EXIT_MS` and only once (timers cleared).
- **B:** `buildChallengeToast.test.js` — "people"/"person" copy, singular/plural, fallbacks.
- **C:** `CycleChallengeOverlay` render test — boost badge present but outside `__stack`;
  no `__countdown` text; no booster pips. Remove `getBoosterAvatarSlots` tests.
- **D1/D6:** `resolveLockScreen.test.js` (pure) — cycle-health descriptor; governance
  descriptor; none; and the precedence case (cycle health-lock while governance status is
  momentarily `pending` still yields `cycle-health`, `showGovernanceOverlay:false`).
- **D4:** pause-arbiter/lock test — `videoLocked` true ⇒ play attempt re-pauses.
- Promote presentation (D2) and audio (D3) verified by render test (wrapper class +
  `GovernanceAudioPlayer trackKey='locked'` mounted when descriptor says cycle-health) plus
  a manual on-device check, since exact scale/scrim is visual.

## Files touched (anticipated)
- `FitnessToast.jsx`, `FitnessToast.scss` (A)
- `buildChallengeToast.js` + test (B)
- `CycleChallengeOverlay.jsx`, `CycleChallengeOverlay.scss`, `cycleOverlayVisuals.js` (+tests) (C)
- `resolveLockScreen.js` + test (new) (D1)
- `FitnessPlayerOverlay.jsx` (render from descriptor, promote wrapper, audio) (D2/D3/D6)
- `FitnessPlayerOverlay`/cycle-lock SCSS (D2)
- `useGovernanceDisplay.js` (defer authority to resolver) (D6)
- Logging additions (D5); pause-arbiter test (D4)

## Out of scope
- Rider toast wording ("is riding the X") — correct as-is.
- Non-health cycle locks (init/ramp) and the standard governance lock UX — unchanged except
  that their render decision now flows through the resolver.
