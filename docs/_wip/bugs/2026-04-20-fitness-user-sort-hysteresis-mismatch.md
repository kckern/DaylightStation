# Fitness User Card Sort / Progress-Bar Hysteresis Mismatch

**Date:** 2026-04-20
**Reported by:** user (FRD Q2 item 5.3)
**Status:** documented, not fully fixed

## Symptom

User progress bars in the Fitness sidebar don't always match the user's
actual heart rate. The user originally framed this as a sort issue
(Primary = zone, Secondary = HR-within-zone %) but on closer look
suspected it might not be HR — "maybe hysteresis".

## Finding

The sort logic at `frontend/src/modules/Fitness/player/panels/FitnessUsers.jsx`
already reads LIVE (non-hysteresis-smoothed) values for both primary and
secondary keys, so the sort ordering matches live HR. The FRD's sort
requirement is effectively already satisfied.

**The real mismatch is between card COLOR and progress BAR:**

- `ZoneProfileStore.#applyHysteresis` (`frontend/src/hooks/fitness/ZoneProfileStore.js:237`)
  computes a smoothed `committedZoneId` + `rawZoneId` per user. The
  committed zone only advances when the raw zone has been stable for
  a dwell window, preventing zone thrash around boundaries.
- `calculateZoneProgress` in `frontend/src/hooks/fitness/types.js:290-331`
  picks `currentZoneIndex` from the LIVE HR and computes `progress =
  (liveHR - liveZone.min) / (liveZone.max - liveZone.min)`.
- UserManager (`frontend/src/hooks/fitness/UserManager.js:76,98`) then
  stores `progressToNextZone = zoneSnapshot.progress` — live-based.
- The user card's color class, however, is driven by the COMMITTED
  zoneId. So briefly (at zone transitions) the card is colored for the
  committed zone but the bar fill is computed against the live zone's
  range. Visually, a "warm" card can show a bar that's 10% full from
  the "hot" perspective, and the sort puts the user among the hot group
  while the color says warm.

## What this PR did

- Documented the two-zone reality inline at the sort site so future
  maintainers see which zone each key reads.
- Left sort + progress computation alone (both already honor live HR).

## What's still needed (NOT in this PR)

Pick one of the following end-to-end fixes:

1. **Use raw zone for display too.** Card color reads `displayZoneId` /
   `displayZoneColor` (the raw zone) from the ZoneProfileStore snapshot.
   Hysteresis still drives governance behavior but the UI becomes
   consistent: color, bar, and sort all track live HR. Simplest.

2. **Drive the bar off the committed zone.** Recompute `progress`
   against the committed zone's rangeMin/rangeMax. The bar matches the
   card color but lags the live HR. Keeps the governance-stability
   signal visible.

3. **Remove hysteresis.** Cleanest semantically but risks destabilizing
   the governance logic that depends on zone commits — needs a separate
   governance audit first.

Recommendation: option 1, since the user's mental model ("bars should
match HR") aligns with live-zone-everywhere.

## Files to touch when fixing

- `frontend/src/modules/Fitness/player/panels/FitnessUsers.jsx` — the
  `zoneClass` (line ~1009) uses `getDeviceZoneId` which reads committed.
  Swap to a raw-zone variant, OR read `participantEntry?.displayZoneId`.
- `frontend/src/hooks/fitness/ZoneProfileStore.js` — expose `displayZoneId`
  / `displayZoneColor` cleanly if the current API doesn't already.
- `frontend/src/hooks/fitness/UserManager.js` — decide whether
  `currentData.zone` / `currentData.color` should be committed or raw,
  or whether to expose both explicitly.

Add a regression test that constructs a user whose raw zone and
committed zone differ, then asserts card color, bar fill, and sort
position all reflect the raw zone.
