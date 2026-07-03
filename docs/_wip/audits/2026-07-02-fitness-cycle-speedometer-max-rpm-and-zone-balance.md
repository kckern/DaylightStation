# Speedometer max RPM too low (120→180) and cadence zones need rebalancing

- **Source:** voice feedback `fitness/20260702215307_J0bvRU` · route `/fitness/menu/app_menu1` · reported `2026-07-02T21:53:07.949Z`
- **Audio:** `media/audio/feedback/fitness/20260702215307_J0bvRU.webm`
- **Type:** improvement (config change)
- **Area:** Cycle Game — equipment/cadence-zone config (`data/household/config/fitness.yml`)

## What the user said
> Also, this is a config change. It looks like at a default we're maxing out at 120 RPM on the speedometer but let's up that to 180. Then, let's reset our green, yellow, red zone so it's more evenly balanced.

## Problem / opportunity
The bike equipment's gauge scale caps at 120 RPM by default, which the user finds too low (real sprint cadence can exceed it, pinning the needle). The cadence-zone bands (warmup/cruising/pushing/sprint) are also unevenly spaced relative to that ceiling and should be rebalanced once the max changes.

## Desired outcome
- Speedometer gauge scale (`max_rpm`) raised from 120 to 180 for the relevant equipment (confirm whether this applies to `cycle_ace` only, or all bikes — the user said "at a default," suggesting the shared default, so check every equipment entry's `max_rpm`).
- The cadence-zone bands (`cadence_zones` — currently `warmup:0 / cruising:40 / pushing:70 / sprint:90`, all under the old 120 ceiling) rebalanced to spread evenly across the new 180 ceiling, so the gauge's colored bands still make visual sense (not all crammed into the bottom two-thirds of the dial).

## Actionable tasks
- [ ] Confirm scope: is `max_rpm: 120` set per-equipment (currently `cycle_ace` and `niceday` both show `120` in config) or should the change apply to all stationary bikes?
- [ ] Update `max_rpm` to 180 for the confirmed equipment entries in `data/household/config/fitness.yml`.
- [ ] Recompute `cadence_zones` band minimums so they're evenly spaced across 0-180 (e.g. roughly quarters: ~0/45/90/135, exact values are a product/feel call, not just math — should be tuned by ear/feel once deployed, not just interpolated).
- [ ] Verify the gauge's tick spacing (`tickStepsFor` in `speedometerGeometry.js`) still reads cleanly at the new max (it scales tick/label step by `maxRpm`, so this should adapt automatically — confirm, don't assume).
- [ ] Restart/reload so the config change takes effect (household app config is cached in-memory at startup per project convention) and verify on the actual gauge.

## Acceptance criteria
- The gauge no longer pins at real achievable sprint cadence.
- The four color bands are visually evenly distributed around the dial, not bunched in one region.
- No test regressions in `speedometerGeometry.test.js` / `CycleSpeedometer.test.jsx` (update fixtures if they hardcode the old 120 max or old zone boundaries).

## Where to look
- `data/household/config/fitness.yml` — `equipment[].max_rpm` (cycle_ace, niceday, and any other affected bike) and the `cadence_zones` block (~line 825).
- `frontend/src/modules/Fitness/lib/cycleGame/speedometerGeometry.js` — `tickStepsFor`, `scaleBands`, `DEFAULT_CADENCE_BANDS` (the code-level fallback default bands, separate from the config-driven ones — check whether this needs updating too if it's ever used as a live fallback rather than pure test scaffolding).
- `frontend/src/modules/Fitness/widgets/CycleGame/CycleSpeedometer.jsx` — where `cadenceBands`/`maxRpm` props flow in from equipment config.

## Context / evidence
None in `logs.recent` — a config/tuning request, not diagnosable from logs. `null`.
