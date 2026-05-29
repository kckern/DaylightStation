# Cycle Challenge Overlay — Layout & Code Audit

**Date:** 2026-05-28
**Scope:** `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx`
and its direct helpers (`cycleOverlayVisuals.js`, `CycleBaseReqIndicator.jsx`,
`CompletionCountBlocks.jsx`, `CycleChallengeOverlay.scss`).
**Reference doc:** `docs/reference/fitness/cycing-challenge.md` (endstate behavior).

This audit captures observations from reading the current implementation. Nothing
here is a confirmed production regression — these are design-density concerns,
inefficiencies, and code smells worth addressing. Roughly ordered: layout/UX first,
then code.

---

## A. Layout & information density

The overlay is a `clamp(190px, min(24vw, 22vh), 280px)` circle. Inside that circle it
currently renders, simultaneously:

- **Gauge layer:** 13 tick marks + hi/lo band markers + needle + hub + a target RPM number
- **Center:** rider avatar (48–72px)
- **Bottom `__stack`:** *five* stacked rows — rider name + heart-rate pill, boost badge,
  phase blocks, init/ramp countdown, current-RPM pill
- **Corners:** up to 4 booster pips

That is a status panel's worth of content packed into a dial.

### A1. The bottom stack is too dense and the text is sub-legible

At the 190px floor the `__stack` is only ~110px wide and text scales down hard:

| Element | Computed size at 190px | Source |
|---------|------------------------|--------|
| Rider name | `190 * 0.05` ≈ **9.5px** | `.cycle-challenge-overlay__rider-name` |
| HR-gate label | **10px** fixed | `.cycle-base-req` |
| Countdown | `190 * 0.05` ≈ **9.5px** | `.cycle-challenge-overlay__countdown` |

At TV viewing distance (rider on a bike a few feet from a wall-mounted screen), 9–10px
text is not read — it is visual texture. So these rows spend attention and legibility
budget without delivering information, and they compete with the genuinely glanceable
parts of the widget (needle vs. colored band, the depleting danger arc, ring color).

**Recommendation:** treat this as a *dial with one optional caption*, not a status
panel. Reduce the stack from five rows to ~two (phase blocks + RPM, boost badge only
when active).

### A2. Rider name is largely redundant with the avatar

The avatar (photo, or initials fallback) already identifies the rider. On a
single-rider challenge dial, the rider knows who they are; a persistent name label
earns its keep on a *multi-rider leaderboard*, not here. The one legitimate use is
confirming **who is on the hook after a swap** (`swapAllowed`).

**Recommendation:** drop the persistent name. If swap-confirmation matters, show the
name only transiently (on mount / right after a swap, then fade), or only while
`swapAllowed` is true.

### A3. The heart-rate gate renders a "log line," not a status

`CycleBaseReqIndicator` renders a colored dot **and** a full sentence:
*"Heart-rate zone satisfied" / "Waiting for heart-rate zone" / "Heart-rate gate
inactive."* The dot already encodes all three states (grey / amber / green); the
sentence is redundant for a glanceable overlay and illegible at 10px on a TV. It reads
like a log line.

**Recommendation:** drop the text label, keep the dot — and ideally move the dot onto
the avatar ring (a colored ring/badge around the avatar) so it costs zero extra rows.

### A4. Current-RPM number partially duplicates the needle

The needle already shows current cadence against the gauge band. The big numeric RPM
pill is *somewhat* redundant — though it is legible where the needle is only
approximate, so it has a defensible reason to stay. Flagged as the next candidate to
cut if density is still too high after A1–A3.

### Keep (high glance value)

Needle + colored band + ring color (am I in the zone?); lower progress arc + danger
countdown; target RPM number; phase blocks. These are the parts that read instantly
and should be protected when trimming.

---

## B. Code issues, inefficiencies, and smells

### B1. Static gauge geometry is recomputed on every RPM tick (inefficiency)

`currentRpm` changes on essentially every governance tick, forcing a re-render. Each
render recomputes **all** gauge geometry in the function body: the 13 tick
`polarToCartesian` pairs, the arc path, and the hi/lo marker endpoints
(`CycleChallengeOverlay.jsx:149-209`). Only the needle angle depends on `currentRpm`;
everything else depends solely on `currentPhase`. This trig runs many times per
second for no reason.

**Fix:** memoise the tick/arc/marker geometry on `currentPhase` (plus the constants),
leaving only the needle angle to recompute per tick.

### B2. Avatar fallback mutates the DOM imperatively (correctness smell)

The `<img onError>` handler hides the image and reveals the initials span by writing
`style.display` directly on DOM nodes via `nextSibling`
(`CycleChallengeOverlay.jsx:412-416`). React does not own that style, so the toggle is
**sticky across re-renders**: if a rider swap replaces the avatar with a URL that
*does* load, the previously-hidden `<img>` may stay hidden (and the initials stay
visible) because nothing resets the imperative `display: none`.

**Fix:** use React state (`imgFailed`) keyed off the avatar URL so a new rider resets
it.

### B3. `phaseProgressPct` is a fraction, not a percent (naming hazard)

Upstream the engine computes `phaseProgressPct = min(1.0, ms / total)` — a value in
`[0,1]` (`GovernanceEngine.js:598`) — and `getCycleOverlayVisuals` correctly
`clamp01`s it. The `Pct` suffix strongly implies 0–100. Anyone who later "fixes" the
engine to emit a true percentage, or feeds a percentage in, would silently peg the arc
to full (`clamp01` maps everything > 1 to 1) with no error.

**Fix:** rename to `phaseProgressFraction`, or document the unit at the source.

### B4. `hiRpm` / `targetRpm` read the same field twice (duplication)

`targetRpm` (`:117`) and `hiRpm` (`:139`) both derive from
`challenge.currentPhase?.hiRpm` with near-identical finite checks; `targetRpm` is just
`Math.round(hiRpm)`. Collapse to a single derivation.

### B5. `metUsers={[]}` is always empty for phase blocks (dead capability)

`CompletionCountBlocks` supports per-block initials via `metUsers`, but the overlay
always passes `[]` (`:453`), so completed phase blocks never show who completed them.
Either wire real per-phase attribution or drop the prop to make the intent explicit.

### B6. State-change log effect reads fields it doesn't depend on (stale logging)

The `state-change` effect fires only on `cycleState`/`dimFactor` changes but logs
`phaseProgressPct` (`:74-82`), so the logged progress value is whatever it was at the
last state change — not current. With `exhaustive-deps` disabled this is silent.
Minor, but the logged number can mislead during debugging.

### B7. Terminology drift: "segment" vs "phase"

The root `aria-label` calls each unit a "segment" (`:275`) while every other surface —
phase blocks, countdown, internal naming — calls it a "phase". Pick one for
screen-reader consistency.

---

## C. Progress semicircle behavior across RPM bands (the "wonky" report)

This is the lower-hemisphere arc. It is the headline UX problem with the widget: **a
single visual channel (the bottom arc's fill fraction) is overloaded with two
semantically opposite jobs**, and the hand-off between them is discontinuous.

### C1. What the arc actually does in each band

During `maintain`, per `GovernanceEngine.js:2719-2799` (engine ticks every ~200ms in
maintain, `:3364`) and the component's `phaseArcFraction`/`phaseArcStroke`:

| RPM band | Engine behavior | Arc fill | Arc color | Opacity |
|----------|-----------------|----------|-----------|---------|
| **≥ hiRpm** (above hi) | `phaseProgressMs += dt * boost` (`:2766`) | `phaseProgress`, **grows** | ring color = **green** | 1.0 |
| **[lo, hi)** (in band) | progress **paused**, no change (`:2798`); `dimFactor = (hi−rpm)/(hi−lo)` (`:562`) | `phaseProgress`, **held** | **orange**, dim-pulse | fades to floor 0.35 as you slow |
| **< loRpm** (below lo) | grace starts; `dangerSinceMs` set (`:2724`); locks after 3s (`:2734`) | switches to `dangerProgress`, **depletes 1→0** | flashing **yellow** (`:246`) | 1.0 |

So the first two rows match your read exactly (grows above the line; holds + orange in
band). The third row is where it goes wonky.

### C2. The core defect — overloaded channel + discontinuous jump

When the rider crosses **below lo**, the arc instantly changes *meaning and value*:

- **Meaning flips:** it was "how much of this phase have I banked" (fills = progress).
  It becomes "how many seconds until I'm locked" (drains = countdown). Same arc, two
  unrelated metrics.
- **Value jumps up:** `dangerProgress` starts at ~1.0, so an arc sitting at, say, 40%
  banked progress **lurches up to ~100% full**, then rapidly retreats to 0 over 3s. A
  progress indicator that jumps *forward* and then *backward* breaks the most basic
  mapping users have for a fill bar.
- **Opacity + color jump too:** if the rider was in-band, opacity snaps from ~0.35
  back to 1.0 and color goes orange → flashing yellow in the same frame. Triple
  discontinuity, animated over a 0.15s sweep — a visible "lurch."

Then at 0 the lock overlay ("popup") appears. The 3-second grace itself is good
practice; the *representation* of it is the problem.

### C3. The arc visually erases earned progress (false loss signal)

`phaseProgressMs` is **preserved** through the grace window and through in-band slowing
— the rider does not actually lose banked progress unless they get locked. But the
danger countdown **overwrites** the progress display with a full-then-draining arc, so
the rider sees their progress apparently wiped to zero. This triggers loss aversion for
a loss that hasn't happened. If they recover within grace, the arc snaps *back* to the
held progress value — another backward jump.

### C4. Flicker + grace-reset when hovering at the lo boundary

`dangerActive` is derived directly from `dangerSinceMs`, which is **set and cleared
every tick** as RPM crosses lo (`:2724` / `:2756`) — and unlike `cycleState`, it has
**no debounce** (the 500ms debounce at `:661` covers state, not danger). A rider
bobbing right at loRpm causes:

- the arc to **flicker** between held-progress and full-draining-countdown every ~200ms;
- `dangerProgress` to **reset to ~1.0** each time danger re-arms, so the countdown never
  visibly counts down steadily;
- the grace timer to **reset on every bob above lo**, so a rider hovering at the
  threshold may never actually lock — the display thrashes while the penalty never
  fires. This is both a UX defect and arguably a fairness/logic gap.

### C5. Latent: green color computed for a failing (below-lo) state

Below lo, `dimFactor = 0` (the `:560` guard requires `rpm >= loRpm`), so
`getCycleOverlayVisuals` classifies `maintain + dimFactor === 0` as the **green**
"crushing it" state. It is only masked on the arc because `dangerActive` overrides the
stroke to yellow. But other green-keyed styling is *not* guarded — e.g. the
`--state-maintain` target-RPM value renders greenish (`#bbf7d0`) while the rider is
below lo and seconds from lockout. The helper is assigning a "you're doing great" color
to a failing state.

### C6. Comparison against UX best-practice benchmarks

| Principle / benchmark | What it says | This overlay |
|-----------------------|--------------|--------------|
| **Determinate progress is monotonic** (Material 3 progress indicators; "avoid decreasing a determinate value") | A progress fill should not jump backward; backward motion reads as data loss/error | ❌ arc jumps up to full then drains to zero, then can snap back |
| **One signifier, one meaning** (Nielsen #4, Consistency & Standards) | A control should mean the same thing throughout an interaction | ❌ same arc = progress *and* penalty timer |
| **Visibility of system status, honestly** (Nielsen #1) | Status display should reflect true state without misleading | ❌ shows progress erased when it is actually preserved (C3) |
| **Separate concerns into separate affordances** (Apple Activity rings; Zwift/Peloton zone bar + distinct countdown) | Distinct metrics get distinct, non-repurposed indicators | ❌ countdown reuses the progress track |
| **Predictable fill direction** (gauge/meter conventions) | Grow = gaining, drain = losing; don't mix on one element | ❌ grows for progress, drains for danger, on one arc |
| **Debounce noisy sensor-driven transitions** (the engine already does this for `cycleState`) | Hysteresis prevents flicker at thresholds | ❌ `dangerActive` is undebounced → flicker + grace reset (C4) |
| **Warn-before-penalize with an unambiguous timer** | Grace periods are good; the countdown must read unmistakably as time | ⚠️ grace exists (good) but is rendered as a repurposed fill, not a clear timer |

### C7. Recommended direction

1. **Stop repurposing the progress arc.** Keep the bottom arc as *phase progress only*
   — monotonic, never jumps backward. During in-band slowing, hold it (current) or let
   it gently desaturate, but do not overwrite it.
2. **Give the lockout grace its own affordance.** A distinct radial countdown (e.g. a
   thin draining ring on the *outer* track, or a numeric "3…2…1" co-located with the
   RPM readout), visually unmistakable as a timer, ideally with a "↑ pedal faster" cue.
   This preserves the rider's visible progress while making the danger unambiguous.
3. **Debounce / add hysteresis to `dangerActive`** (or apply the existing state
   debounce to it) so bobbing at lo doesn't flicker the display — and decide
   deliberately whether the grace timer should reset on every recovery or only on a
   sustained one (C4 fairness question).
4. **Fix the color classification** so below-lo is not internally "green" (C5):
   compute the danger/failing color in the helper rather than relying on the component
   to override the stroke.

---

## Suggested sequencing

1. **Progress-arc redesign (C)** — highest-impact, most-confusing defect. Split phase
   progress and lockout countdown into separate affordances, make progress monotonic,
   debounce `dangerActive`, fix the below-lo color classification. Touches both the
   component and `GovernanceEngine` (the danger/dim snapshot fields), so scope it as a
   real design change and confirm the new grace representation before coding.
2. **Layout trim (A1–A3)** — high user-visible payoff. Move HR state onto the avatar
   ring, drop the HR sentence, make the rider name transient-on-swap, collapse the
   stack. Pin down exactly when the name appears/fades before coding.
3. **B1 (memoise geometry)** and **B2 (avatar fallback as state)** — correctness +
   perf, low risk, can ride along with the above since they touch the same file.
4. **B3–B7** — cleanups; batch opportunistically. (B3 `phaseProgressPct` naming and B7
   segment/phase wording naturally fold into the C redesign.)

---

## Files

- `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx`
- `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.scss`
- `frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.js`
- `frontend/src/modules/Fitness/player/overlays/CycleBaseReqIndicator.jsx` / `.scss`
- `frontend/src/modules/Fitness/player/overlays/CompletionCountBlocks.jsx`
- `frontend/src/hooks/fitness/GovernanceEngine.js` (snapshot producer)
