# Distance chart: leader-anchored log-zoom view overlaps chrome, needs to be "scooted up"

- **Source:** live chat follow-up to voice feedback `fitness/20260702215307_J0bvRU` · route `/fitness/menu/app_menu1` · reported `2026-07-02` (same session, spoken as a chat follow-up rather than a recorded feedback-panel note — no separate inbox item/audio for this one)
- **Type:** bug
- **Area:** Cycle Game — distance chart, log-zoom mode (`panels/DistanceChart.jsx`)

## What the user said
> When we zoom in to log, we need to make sure that that zoomed in on leaders doesn't overlap and is scooted up properly.

## Problem / opportunity
Distinct from the separate smoothness/frame-rate complaint about zoom *motion* (already filed as `2026-07-02-fitness-cycle-chart-avatar-desync-low-framerate.md`), this is a **layout/positioning** defect specific to log-zoom mode (the leader-anchored close-racing view): when the chart switches into log scale, some element(s) — likely the terminus tags, the "zoomed on leaders" chip, or the goal-line label — overlap other chart chrome instead of being repositioned ("scooted up") to make room.

## Desired outcome
When the chart is in log-zoom mode, all overlay elements (avatar tags, log-mode chip, goal/leader labels) are positioned so nothing overlaps — repositioned/offset as needed for the compressed log-scale layout, not just left in their linear-scale positions.

## Actionable tasks
- [ ] Reproduce: get several riders into a tight leader-pack race so the chart's lin↔log hysteresis trips into log mode; screenshot/observe what overlaps what.
- [ ] Identify the specific overlapping elements (most likely candidates: terminus avatar tags crowding each other or the "zoomed on leaders" chip in the tight vertical space log mode compresses riders into; or the chip/goal-label overlapping the header/clock).
- [ ] Add log-mode-specific positioning logic (vertical offset / collision-avoidance) so overlays "scoot up" or otherwise de-collide when log scale is active, distinct from their linear-mode layout.

## Acceptance criteria
- In log-zoom mode with a tight leader pack, no two chart overlay elements (tags, chip, labels) visually overlap.

## Where to look
- `frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.jsx` — the `useLog`/log-mode branch, terminus tag layout logic, and the "zoomed on leaders" chip (`.cg-chart__log-chip`) added in the same-day chart rebuild (commit `677f45c24`).
- `frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.scss` — positioning rules for tags/chip/labels that may need a log-mode variant.

## Context / evidence
No logs — a visual/layout report, not diagnosable from logs. `null`.
