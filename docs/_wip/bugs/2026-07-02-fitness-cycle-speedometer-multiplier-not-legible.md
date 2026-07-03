# Speedometer boost multiplier is no longer clearly legible — just a colored dot

- **Source:** voice feedback `fitness/20260702215307_J0bvRU` · route `/fitness/menu/app_menu1` · reported `2026-07-02T21:53:07.949Z`
- **Audio:** `media/audio/feedback/fitness/20260702215307_J0bvRU.webm`
- **Type:** bug (regression)
- **Area:** Cycle Game — speedometer (`CycleSpeedometer.jsx`)

## What the user said
> The RPM meter is better but when we're boosting, it looks like we just have a yellow circle and we're not saying the multiplier. We used to have that so check the git commit. It used to show that much more clearly like 1.2, 1.5, 2, whatever the multiplier was it would show it there.

## Problem / opportunity
This is a direct, identifiable regression from the same-day 10-foot-type-scale work: commit `9ecf31f80` moved the multiplier number out of the circular badge (which shrinks to ~11-12px at the documented wide-mode gauge floor — too small to hold floor-legible text per the audit's 1.1rem rule) and into a small inline text run in the lower readout (`· ×1.4`, next to the RPM digits). The badge itself became a color-only dot. Functionally the number is still rendered (`cycle-speedometer__multiplier-text`), but it reads to the user as "just a yellow circle, no number" — the inline text is too small/easy-to-miss at a glance, especially mid-race on a moving display. The fix traded legibility-at-small-sizes for prominence, and the user wants prominence back.

## Desired outcome
The active multiplier is shown as clearly and prominently as it was before the 10-foot-type-scale pass — sized so it's readable at a glance during a race, not just technically present in small text. The commit history (`3552a247a` original dual-gauge widget, through `9ecf31f80`) has the "before" version to reference for exactly how it read at the higher-legibility size.

## Actionable tasks
- [ ] Diff `CycleSpeedometer.jsx`/`.scss` between `3552a247a` (or just before `9ecf31f80`) and current to see exactly how the old badge rendered the number (size, position, color treatment).
- [ ] Find a layout that keeps BOTH constraints satisfied: multiplier legible at a glance (bigger / more prominent than the current inline `· ×1.4`) AND compliant with the 1.1rem race-screen floor from the same-day type-scale pass — these are not actually incompatible, the prior fix just picked the simplest resolution (shrink into inline text) rather than finding room for a bigger badge.
- [ ] Consider: a larger badge that's allowed to grow independent of the 30%-of-avatar cap (that cap was the reason it became too small to hold text — revisit whether that specific ratio is the right constraint), or promote the multiplier to its own dedicated readout line at hero size, similar to speed/rpm.
- [ ] Re-run `CycleSpeedometer.test.jsx`'s multiplier tests and update/extend to lock in the new, more-legible presentation.

## Acceptance criteria
- During an active zone-multiplier boost, a rider (and an observer standing at normal garage viewing distance) can read the exact multiplier value (e.g. "1.4×") at a glance, not just notice a colored dot.
- No regression to the 1.1rem race-screen text floor established the same day.

## Where to look
- `frontend/src/modules/Fitness/widgets/CycleGame/CycleSpeedometer.jsx` — `showBadge`/`badgePx`/`cycle-speedometer__multiplier` (the dot) and `cycle-speedometer__multiplier-text` (the current small inline number) around lines 209-249.
- `frontend/src/modules/Fitness/lib/cycleGame/speedometerOverlayLayout.js` — `BADGE_RATIO` (currently 30% of avatar diameter) — the constraint that forced the number out of the badge.
- Git history: `git log --oneline -S "cycle-speedometer__multiplier" -- frontend/src/modules/Fitness/widgets/CycleGame/CycleSpeedometer.jsx` (the user explicitly asked to "check the git commit" — this is the command to run).
- `frontend/src/modules/Fitness/widgets/CycleGame/CycleSpeedometer.test.jsx` — existing multiplier badge/text test to extend.

## Context / evidence
None in `logs.recent` — a visual/design regression, not diagnosable from logs. `null`.
