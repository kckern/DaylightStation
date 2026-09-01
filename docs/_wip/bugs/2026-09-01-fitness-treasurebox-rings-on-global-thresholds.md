# Fitness: the treasure box pays rings on GLOBAL zone thresholds while everything on screen uses the learner's personal ones

**Date:** 2026-09-01
**Found by:** field observation — a parent watched the agenda board's ring count for a learner climb while the learner's roster tile, zone series, and garage LED all still said "cool"
**Status:** root cause located in code and confirmed against the persisted session; not fixed
**Severity:** medium. Rings are the currency the school agenda and the weekly State Gate count. A learner with personal thresholds *above* the global ones is over-paid for the whole session; one with thresholds *below* the global ones (the 80-bpm grown-ups in `fitness/config.yml`) is under-paid. Both silently.
**Reference:** `docs/reference/fitness/`, `docs/reference/state-gates/README.md` (`fitness.weekly-rings`), `docs/_wip/bugs/2026-04-20-fitness-user-sort-hysteresis-mismatch.md` (a sibling zone-source mismatch)

---

## The evidence — one session file, three series

Session `fs_20260901100054` (Insanity Max:30 · Modified—Cardio Challenge), learner `milo`, 5 s ticks. From `household/fitness/log/2026-09-01/20260901100054.yml`, RLE-decoded:

| tick | HR | `milo:zone` | `milo:rings` | note |
|---|---|---|---|---|
| 0–1 | 90, 90 | c | 0, 0 | |
| 2 | 101 | c | 0 | interval not yet complete |
| 3–7 | 108, 108, 109, 104, 100 | c | 1, 1, 2, 3, 4 | **paying** at HR ≥ 100 |
| 8–16 | 88, 88, 90, 94, 84, 85, 90, 94, 99 | c | 5 ×9 | **frozen** at HR < 100 |
| 17–20 | 105, 110, 112, 118 | c | 6, 7, 8, 9 | paying again |
| 21 → | 120, 122, 126 … | a | 11, 13, 15 … | 2/tick — personal *warm* is 140, so this is still wrong, just less visibly |

The ring series switches on and off at **100 bpm** to the tick. That is the global `active.min` (`household/fitness/config.yml:669`). Milo's personal zones — the ones the zone series, the roster tile, the LED scene (`fitness.zone_led.activated zoneIds=["cool"]` until 17:02:36) and `ZoneProfileStore` (`build_profile userId=milo hasCustomZones=true warmThreshold=140`) all used — are `active: 120, warm: 140, hot: 160`.

Two zone tables were live in one session. The one that pays used the wrong one.

Downstream: `WeeklyMeasuresStateGatesProducer` publishes only when the ring value **changes** (`WeeklyMeasuresStateGatesProducer.mjs:103-104`), and it published `fitness:weekly-rings:milo:…` every 15 s from 17:01:51 (`state-gates.assertion.corrected`, householdRevision 1237 → 1264+). Each one repainted the agenda board (`school.selfservice.status-board.refresh source=state-gates`). That climbing number, ninety seconds before the tile turned green, is what was observed.

---

## Root cause

`frontend/src/hooks/fitness/TreasureBox.js`, `resolveZone(userId, hr)` (lines 472–503):

```
priority is usersConfigOverrides > ZoneProfileStore > global
```

1. **`usersConfigOverrides` is empty.** `FitnessSession.js:1738` configures the box with `{ zones: baseZoneConfig }` only. The `users` argument that would populate the overrides (`TreasureBox.js:117-133`) is never passed. First tier: skipped.
2. **The ZoneProfileStore tier has a write-once, never-invalidated cache.**
   ```js
   if (this._zoneProfileOverrideCache.has(userId)) {        // line 480
     overrides = this._zoneProfileOverrideCache.get(userId);
   } else {
     const profile = this._zoneProfileStore.getProfile(userId);
     if (profile?.zoneConfig) { …build map… }
     this._zoneProfileOverrideCache.set(userId, overrides || null);   // line 494 — caches a MISS
   }
   if (!overrides) overrides = {};                            // → global thresholds
   ```
   A `null` is cached and `.has()` returns true for it. Nothing clears the cache when the profile store learns about the user: only `setZoneProfileStore()` (session start, line 70) and `reset()` (line 182). `ZoneProfileStore.syncFromUsers()` — which rebuilds profiles ~4×/s all session (`build_profile.aggregated … milo=233 … window=60s`) — has no way to tell the box.
3. **The race was lost by one millisecond.** Milo's first `treasurebox.record_heart_rate` is at 17:00:54.**915**; the store's first `zoneprofilestore.build_profile userId=milo` is at 17:00:54.**916**. `getProfile('milo')` returned null, `null` went into the cache, and the box used `{}` — global thresholds — for the remaining 3 000+ HR samples.

Whether the box loses the race by 1 ms or 1 s, the shape of the defect is the same: the tier that is supposed to carry per-user thresholds is consulted exactly once per user per session, at the earliest and least-informed moment.

### Why the display was right and the box was wrong

The box already asks `ZoneProfileStore.getZoneState()` for **colour** (`TreasureBox.js:589-593`, "prefer committed zone from ZoneProfileStore") on every sample, uncached. Only the **award** path went through the cached override map. The roster, LED and zone series all read the store directly.

---

## Fix (proposed)

Any one of these closes it; the first two together are the right shape.

1. **Pass the users into `configure`.** `FitnessSession` has the roster and their `zoneConfig`; call `treasureBox.configure({ users })` whenever `_syncZoneProfiles` reports a change. Tier 1 then wins and the race is moot.
2. **Never cache a miss.** In `resolveZone`, only `set()` the cache when an override map was actually built; on a null profile, fall through *this time* and try again next sample.
3. **Invalidate on sync.** Give `ZoneProfileStore` a change callback (it already returns `changed` from `syncFromUsers`) and have the box clear `_zoneProfileOverrideCache` on it.

Test to add (`TreasureBox.test.js`): record HR 105 for a user *before* the profile store has their profile, then sync a profile with `active: 120`, then record HR 105 again → second sample must resolve to `cool` and award 0.

Add a `warn`-level `treasurebox.zone_override_miss { userId }` on the null branch so the next occurrence is visible in the log store; today every `treasurebox.*` line is `debug` and never leaves the browser.

---

## Blast radius

Every user whose personal thresholds differ from the global table — that is every `users:` block with a `zones:` override in `fitness/config.yml` (all of them). Over-payment for the kids at 120, under-payment for the 80-bpm grown-ups. It has presumably been this way since the cache was introduced; the 2026-04-20 hysteresis-mismatch report describes the same two-zone-sources smell from the sorting side.

---

## Non-findings

- Global `cool` really is 0 rings (`coins: 0`, and `configure` reads `rings ?? coins`). Rings did not come from the cool zone; they came from the wrong *definition* of active.
- `ZoneProfileStore` hysteresis (`HYSTERESIS_COOLDOWN_MS=5000`) is entry-instant on a first transition — the LED going green at 17:02:36 is HR crossing 120, not a display lag.
- `fitnessRingsProvider` sums `participants[learner].rings` off the stored session; it is a faithful reporter of a wrong number, not a second bug.
