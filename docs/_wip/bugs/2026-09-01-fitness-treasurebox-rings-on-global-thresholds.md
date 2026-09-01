# Fitness: the treasure box pays rings on GLOBAL zone thresholds while everything on screen uses the learner's personal ones

**Date:** 2026-09-01
**Found by:** field observation — a parent watched the agenda board's ring count for a learner climb while the learner's roster tile, zone series, and garage LED all still said "cool"
**Status:** **fixed** on `fix/sept1-incident-remediation` (`b9b255bd9`, `2f2b91937`, `a79b5f965`), awaiting merge and deploy. The mechanism recorded below was superseded during review — see *As built* — but the evidence and the blast radius stand.
**Severity:** medium. Rings are the currency the school agenda and the weekly State Gate count. A learner with personal thresholds *above* the global ones is over-paid for the whole session; one with thresholds *below* the global ones (the 80-bpm grown-ups in `fitness/config.yml`) is under-paid. Both silently.
**Reference:** `docs/reference/fitness/`, `docs/reference/state-gates/README.md` (`fitness.weekly-rings`), `docs/_wip/bugs/2026-04-20-fitness-user-sort-hysteresis-mismatch.md` (a sibling zone-source mismatch)

---

## The evidence — one session file, three series

Session `fs_20260901100054` (Insanity Max:30 · Modified—Cardio Challenge), learner `learner-a`, 5 s ticks. From `household/fitness/log/2026-09-01/20260901100054.yml`, RLE-decoded:

| tick | HR | `learner-a:zone` | `learner-a:rings` | note |
|---|---|---|---|---|
| 0–1 | 90, 90 | c | 0, 0 | |
| 2 | 101 | c | 0 | interval not yet complete |
| 3–7 | 108, 108, 109, 104, 100 | c | 1, 1, 2, 3, 4 | **paying** at HR ≥ 100 |
| 8–16 | 88, 88, 90, 94, 84, 85, 90, 94, 99 | c | 5 ×9 | **frozen** at HR < 100 |
| 17–20 | 105, 110, 112, 118 | c | 6, 7, 8, 9 | paying again |
| 21 → | 120, 122, 126 … | a | 11, 13, 15 … | 2/tick — personal *warm* is 140, so this is still wrong, just less visibly |

The ring series switches on and off at **100 bpm** to the tick. That is the global `active.min` (`household/fitness/config.yml:669`). Learner A's personal zones — the ones the zone series, the roster tile, the LED scene (`fitness.zone_led.activated zoneIds=["cool"]` until 17:02:36) and `ZoneProfileStore` (`build_profile userId=learner-a hasCustomZones=true warmThreshold=140`) all used — are `active: 120, warm: 140, hot: 160`.

Two zone tables were live in one session. The one that pays used the wrong one.

Downstream: `WeeklyMeasuresStateGatesProducer` publishes only when the ring value **changes** (`WeeklyMeasuresStateGatesProducer.mjs:103-104`), and it published `fitness:weekly-rings:learner-a:…` every 15 s from 17:01:51 (`state-gates.assertion.corrected`, householdRevision 1237 → 1264+). Each one repainted the agenda board (`school.selfservice.status-board.refresh source=state-gates`). That climbing number, ninety seconds before the tile turned green, is what was observed.

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
   A `null` is cached and `.has()` returns true for it. Nothing clears the cache when the profile store learns about the user: only `setZoneProfileStore()` (session start, line 70) and `reset()` (line 182). `ZoneProfileStore.syncFromUsers()` — which rebuilds profiles ~4×/s all session (`build_profile.aggregated … learner-a=233 … window=60s`) — has no way to tell the box.
3. ~~**The race was lost by one millisecond.**~~ **RETRACTED — see below.** Learner A's first `treasurebox.record_heart_rate` is at 17:00:54.**915**; the store's first `zoneprofilestore.build_profile userId=learner-a` is at 17:00:54.**916**. `getProfile('learner-a')` returned null, `null` went into the cache, and the box used `{}` — global thresholds — for the remaining 3 000+ HR samples.

The two timestamps are real; the *reading* of them was wrong. Review traced the call order in `FitnessSession.recordDeviceActivity`: the `recordHeartRateForDevice` feed and the `_syncZoneProfiles` block sat in the same function behind the **same** `startupDiscarded` flag, so both opened on the same packet — and the box ran first, **unconditionally**. There was no race to lose. What varied per session was only whether a 5 s tick happened to land inside the ~3 s window before the first scored packet, i.e. whether the store had been populated by some *other* path in time: a coin flip per session, not a millisecond.

The shape of the defect is still the one the tiers describe: the tier that carries per-user thresholds was consulted exactly once per user per session, at the earliest and least-informed moment. The ordering defect is what made "the earliest moment" always too early.

### Why the display was right and the box was wrong

The box already asks `ZoneProfileStore.getZoneState()` for **colour** (`TreasureBox.js:589-593`, "prefer committed zone from ZoneProfileStore") on every sample, uncached. Only the **award** path went through the cached override map. The roster, LED and zone series all read the store directly.

---

## Fix — proposed vs. as built

### Proposed (superseded, kept for the reasoning trail)

Any one of these closes it; the first two together are the right shape.

1. ~~**Pass the users into `configure`.**~~ `FitnessSession` has the roster and their `zoneConfig`; call `treasureBox.configure({ users })` whenever `_syncZoneProfiles` reports a change. Tier 1 then wins and the race is moot. — **not taken.** It moves the same staleness into a second copy of the thresholds.
2. **Never cache a miss.** In `resolveZone`, only `set()` the cache when an override map was actually built; on a null profile, fall through *this time* and try again next sample. — **shipped** (`b9b255bd9`).
3. ~~**Invalidate on sync.**~~ Give `ZoneProfileStore` a change callback (it already returns `changed` from `syncFromUsers`) and have the box clear `_zoneProfileOverrideCache` on it. — **shipped, then replaced** (`b9b255bd9` → `a79b5f965`).

### As built

Three commits, in this order:

1. **`b9b255bd9` — never cache a miss.** `resolveZone` caches only a real threshold map; a miss re-reads on the next sample. A `warn`-level `treasurebox.zone_override_miss { userId }` fires on the miss branch, **guarded to once per user per session** (an unguarded warn would fire ~1/s per profile-less rider and bury the signal). Every other `treasurebox.*` line is `debug` and never leaves the browser; this one does.
2. **`2f2b91937` — sync before scoring.** The real repair. `_syncZoneProfiles` is hoisted **above** the `recordHeartRateForDevice` feed in `recordDeviceActivity`, so the store is populated before the box scores the packet that populated it. Verified safe: `user.updateFromDevice()` has already run, `getPresentParticipantIds()` reads only DeviceManager/UserManager, `registerDevice()` ran earlier, and `notifyZoneChange` only arms a 100 ms debounce — nothing in the hoisted block depends on the box having run. `FitnessSession.zoneSyncOrder.test.js` pins it end to end: without the reorder the first scored sample is `active` (global) and one `zone_override_miss` fires on an otherwise healthy session; with it, `cool` and no miss.
   This also narrows what the new warn *means*: it now says only "this user never reached `syncFromUsers`", not "the store was slow". A present, synced guest gets a profile carrying the base zone config and resolves normally.
3. **`a79b5f965` — the store owns a revision; the box pulls it.** `invalidateZoneOverrideCache()` and its `FitnessSession` call site are **deleted**. Two faults with the push model: every `_syncZoneProfiles` call site had to remember to invalidate and one already did not (the 5 s tick path), and `syncFromUsers` reports `changed` when *heart rate* moves — i.e. on nearly every packet — so the cache was being dropped constantly while claiming to avoid per-sample profile clones. `ZoneProfileStore` now owns a zone-config revision bumped **only** when some user's `zoneConfig` `id:min` set changes; `TreasureBox.resolveZone` reads `getZoneConfigRevision()` and clears its cache when it moves. There is no longer a call site that can forget. (`#computeSignature` is untouched — its volatile hr/zone/progress fields are what governance's `notifyZoneChange` needs.)

The test the report asked for exists in `TreasureBox.test.js`, reshaped to pin both halves: HR-only churn must not re-read the profile, and a real threshold change must be picked up with nothing telling the box.

---

## Blast radius

Every user whose personal thresholds differ from the global table — that is every `users:` block with a `zones:` override in `fitness/config.yml` (all of them). Over-payment for the kids at 120, under-payment for the 80-bpm grown-ups. It has presumably been this way since the cache was introduced; the 2026-04-20 hysteresis-mismatch report describes the same two-zone-sources smell from the sorting side.

---

## Non-findings

- Global `cool` really is 0 rings (`coins: 0`, and `configure` reads `rings ?? coins`). Rings did not come from the cool zone; they came from the wrong *definition* of active.
- `ZoneProfileStore` hysteresis (`HYSTERESIS_COOLDOWN_MS=5000`) is entry-instant on a first transition — the LED going green at 17:02:36 is HR crossing 120, not a display lag.
- `fitnessRingsProvider` sums `participants[learner].rings` off the stored session; it is a faithful reporter of a wrong number, not a second bug.

---

## Follow-up left open: the participant-id divergence

Pre-existing, out of scope for this branch, and worth a note because the new warn is what will surface it.

Two id ladders resolve "who is this HR packet for", and they disagree:

| Consumer | Ladder |
|---|---|
| Presence (`ParticipantRoster.getPresentParticipantIds`) | `resolveUserForDevice(deviceId)?.id`, else `ledger.occupantId \|\| ledger.metadata.profileId` |
| TreasureBox feed (`FitnessSession.recordDeviceActivity`) | `ledger.metadata.profileId \|\| ledger.occupantId \|\| user.id` |

The ledger fallbacks are in **opposite** precedence, and `usersForZones` is `allUsers.filter(u => presentIds.has(u.id))` — so an id the box scores under that is not a `UserManager` user (or that the two ladders resolve differently for one device) never reaches `syncFromUsers`, gets no profile built, and is scored on global thresholds for the whole session. That is exactly the condition `treasurebox.zone_override_miss` now reports, so the next occurrence will name itself rather than needing this analysis again. Reconciling the two ladders is its own change.
