# Distance chart: avatar tags untether from the line during zoom, and zoom itself looks low-frame-rate

- **Source:** voice feedback `fitness/20260702215307_J0bvRU` · route `/fitness/menu/app_menu1` · reported `2026-07-02T21:53:07.949Z`
- **Audio:** `media/audio/feedback/fitness/20260702215307_J0bvRU.webm`
- **Type:** bug
- **Area:** Cycle Game — distance chart (`panels/DistanceChart.jsx`, `lib/cycleGame/motionClock.js`)

## What the user said
> On our chart on the top of the race, the avatars move at a different rate. The animation rate doesn't... they need to be locked onto the point of the line. Whatever framework we're using for animating the chart is not aligned with the pace that the avatars move at. The chart will zoom and then all of a sudden the avatars look untethered and it takes them a while to then get back into place. Those need to be locked into place. Let's figure out what the transition time is and make that match. Also, the zoom scale, it looks like a very low frame rate, a low refresh rate. We need to increase that refresh rate of the chart so that it looks like it's zooming very smooth, very naturally, not on a beat or a pulse.

## Problem / opportunity
This is a direct field report against the same-day "unified motion clock" (commit `004f8b7cc`) and chart rebuild (commit `677f45c24`) work, whose entire stated purpose was to eliminate exactly this kind of desync — avatar tags should lerp on the same shared clock as the line they sit on, and the window/zoom transitions were supposed to become continuous rather than steppy. The user is reporting the fix isn't holding, specifically: (1) avatar tags visibly detach from the line during a zoom event and take a beat to re-settle, and (2) the zoom/rescale motion itself still looks low-frame-rate / stepped ("on a beat or a pulse") rather than smooth. Since this was reviewed and approved as working in isolated testing, the likely gap is in how the zoom-window transition (`continuousWindow`, the ~400ms lin↔log tween, or the tag reprojection during an active zoom ease) interacts with the tag/tip lerp, not the base per-tick motion clock itself.

## Desired outcome
During a zoom/rescale event, avatar tags stay visually locked to their point on the line at all times — no detach-and-catch-up. The zoom/rescale motion itself reads as smooth continuous easing at full frame rate, not a stepped or pulsing transition.

## Actionable tasks
- [ ] Reproduce with a live or simulated multi-rider race that triggers a Y-window or lin↔log zoom transition; record/observe the chart during the transition specifically (not just steady-state per-tick motion, which was the part already verified in review).
- [ ] Check whether tag/connector reprojection reads the CURRENT (mid-ease) window bounds every animation frame, or only recomputes on the next 1Hz tick — if tags reproject only per-tick while the underlying SVG line eases continuously via its own transform, that's the exact "untethered, catches up" symptom described.
- [ ] Verify the zoom ease itself is driven by `requestAnimationFrame` at full display refresh rate, not a lower-rate interval or a CSS transition with a perceptible step (the audit's own notes flagged a "1-frame overshoot" risk in the motion-clock design — confirm this isn't compounding into a visible stutter here).
- [ ] Fix so both the line/tip AND the tags/connectors/markers read from the exact same per-frame window transform during a zoom ease — one clock, one frame, no lag between them.
- [ ] Extend `DistanceChart.test.jsx` (or add a focused test) to assert tag position is derived from the same eased-window value as the line geometry at a given frame, not from a stale pre-zoom value.

## Acceptance criteria
- Watching a live race through a zoom/rescale event, avatar tags never visibly separate from their point on the line.
- The zoom transition itself reads as smooth continuous motion at the display's frame rate — no perceptible stepping, pulsing, or "beat."

## Where to look
- `frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.jsx` — the tag/connector/marker imperative positioning inside the `motionClock.subscribe` callback vs. wherever the zoom-window ease (`continuousWindow`, lin↔log tween) is computed; confirm both read the SAME per-frame source of truth.
- `frontend/src/modules/Fitness/lib/cycleGame/motionClock.js` — the shared `createTickLerp` — confirm it's the actual driver for the zoom ease too, not a second, separate rAF loop that could drift out of phase with it.
- `frontend/src/modules/Fitness/lib/cycleGame/chartScale.js` / `chartZoom.js` (or their T7-era replacements — `continuousWindow`, `pickAxisTicks`) — the window-easing math.
- Prior review notes flagging a related risk: `docs/_wip/audits/2026-07-01-cycle-game-audit.md` (finding C4) and the Phase 1+2 plan's T6/T7 sections in `docs/superpowers/plans/2026-07-01-cycle-phase1-2.md` — read these first, the acceptance criteria they were built against are the baseline this report says isn't being met.

## Context / evidence
None in `logs.recent` — a visual/animation-timing report, not something current logging captures (frame-level chart geometry isn't logged; `cycle_game.render_pacing` covers the POV GL loop, not the DOM/SVG chart). `null`.
