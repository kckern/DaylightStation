# Bug Report: Fitness RPM Cadence Freeze and Post-Session Ghost Devices

**Date:** 2026-05-28
**Severity:** High (user-reported)
**Component:** `frontend/src/hooks/fitness/DeviceManager.js`, `frontend/src/context/FitnessContext.jsx`, RPM avatar widgets
**Status:** Fixed (2026-05-28) — Bug 1 in commit `fbdbe74a9`, Bug 2 in commit `737f0ca76`. Plan: `docs/superpowers/plans/2026-05-28-fitness-rpm-freeze-and-ghost-device-fix.md`. Manual verification (next real cycling session) pending.

---

## Summary

Two related defects in cadence (RPM) handling, both visible across many recent fitness sessions:

1. **Within-session freeze.** When a rider stops pedaling, the displayed RPM and underlying `device.cadence` value remain pinned at the last broadcast value for tens of seconds — up to **125 seconds** observed — instead of dropping to 0 within the documented ~6 s window (`FITNESS_TIMEOUTS.rpmZero` = 3 s plus the 3 s prune interval).

2. **Post-session ghost devices.** After a session ends, an ANT+ packet that arrives later registers a new device in `DeviceManager.devices` that is **never pruned**. The device map grows without bound across the lifetime of the tab/page. One observed instance persisted for **90+ minutes** with no session active.

Both have the same root location (`DeviceManager.pruneStaleDevices` and its `useEffect` driver in `FitnessContext`). The first is the source of the user-reported "RPM frozen at last value, never goes to zero" complaint.

---

## User-Visible Symptom

> "After [a rider stops], some [meters] seem frozen in time at the last known RPM and never go to zero, even when there's no action going on."

Confirmed reproducible across **every cycling session in the past two weeks** that was inspected.

---

## How RPM Currently Flows

Background for readers unfamiliar with the path:

1. **ANT+ cadence sensors** broadcast `CalculatedCadence` + `CumulativeCadenceRevolutionCount` frames. When pedaling stops, sensors **stop broadcasting entirely** — they do not transmit "RPM 0".
2. `DeviceManager.updateDevice()` (`frontend/src/hooks/fitness/DeviceManager.js:134-171`) normalizes raw ANT+ fields into `device.cadence` / `device.revolutionCount`.
3. `DeviceManager.pruneStaleDevices()` (`DeviceManager.js:233-297`) runs every 3 s while a session is active (`FitnessContext.jsx:1286-1296`) and is supposed to:
   - Zero `device.cadence`/`power`/`speed` after `rpmZero` (3 s) without significant activity (line 260-265).
   - Flag the device inactive after `inactive` (60 s) and remove it after `remove` (30 min).
4. RPM avatar widgets (`RpmDeviceCard.jsx:31`, `FullscreenVitalsOverlay.jsx:184`, `FitnessUsers.jsx:822-824`) read `device.cadence` raw and compute `spinDuration = 270 / max(rpm, 1)` for CSS animation.

A staleness-aware reader exists at `FitnessSession.getEquipmentCadence()` (`FitnessSession.js:1103-1136`) that returns `{rpm: 0, connected: false}` when the last activity is older than `rpmZero`. **It is not consumed by any widget today** — this is acknowledged in `docs/superpowers/plans/2026-05-16-fitness-rpm-freeze-fix.md` but the plan is not yet executed.

---

## Evidence

### Bug 1: Within-Session Cadence Freeze

**Data source:** RLE-encoded RPM series stored at end of session in
`data/household/history/fitness/YYYY-MM-DD/<sessionId>.yml` (5-second tick interval).
Format: `[X, N]` means value X repeated N consecutive ticks.

A run of identical RPM values for many ticks at the **tail of a session** is the signature: humans do not pedal at a perfectly constant integer RPM for tens of seconds. Every recent cycling session shows this:

| Session | Device | Frozen value | Held duration | Then |
|---|---|---|---|---|
| 2026-05-21 19:38 | bike:7138 | 16 RPM | 25 ticks = **125 s** | → 0, then `null` |
| 2026-05-21 19:38 | bike:7153 | 172 RPM | 12 ticks = 60 s | → 0, then `null` |
| 2026-05-21 19:38 | bike:7183 | 151 RPM | 19 ticks = 95 s | → 0, then `null` |
| 2026-05-22 17:47 | bike:7138 | 31 RPM | 23 ticks = **115 s** | → 0, then `null` |
| 2026-05-22 17:47 | bike:49904 | 57 RPM | 14 ticks = 70 s | → 0, then `null` |
| 2026-05-26 19:28 | bike:7138 | 33 RPM | 21 ticks = 105 s | → 0, then `null` |
| 2026-05-26 19:28 | bike:7153 | 50 RPM | 21 ticks = 105 s | → 0, then `null` |
| 2026-05-26 19:28 | bike:49904 | 65 RPM | 13 ticks = 65 s | → 0, then `null` |
| 2026-05-27 19:28 | bike:7138 | 57 RPM | **22 ticks = 110 s** | → 0, then `null` |
| 2026-05-27 19:28 | bike:49904 | 55 RPM | 8 ticks = 40 s | → single `0`, then **55 again for 20 s**, then `0`, then `null` |

#### Cross-check against rotation count

The cumulative revolution count is the strongest corroborating signal — it can only increase, so a plateau means **no new revolutions were broadcast**.

Session `2026-05-27 19:28`, `bike:49904`, last few seconds:

```
rpm:       …,75,72,69,67,68,67,68,69,66,64,65,66,67,70,[55,8],0,[55,4],[0,6],[null,14]
rotations: …,                                            2069.2,[2073.7,7],[null,14]
```

Rotation count plateaus at `2073.7` for **7 ticks (35 s)** — the sensor was silent. During the same window `device.cadence` shows 55 RPM, not zero. **This proves the cadence value is stale, not a real reading.**

#### The "bounce-back" sub-pattern

In session `2026-05-27 19:28`, `bike:49904`, the tail sequence is:

```
…,[55,8], 0, [55,4], [0,6], [null,14]
```

A single `0` sample appears between two `55` stretches. This is consistent with one prune cycle successfully running (producing the `0`) before some other write path restored the previous `cadence` value. **Not yet confirmed**, but it is hard to explain otherwise — a coasting rider could not produce a single tick of true 0 sandwiched between two stretches of exactly 55.

### Bug 2: Post-Session Ghost Devices

**Data source:** `fitness-profile` periodic snapshots in
`media/logs/fitness/<timestamp>.jsonl` (every ~30 s). These don't carry per-device cadence values but do record `deviceCount`, `rosterSize`, `seriesPts`, `sessionActive`.

Session `fs_20260528022210` (a ~37-min cycling session), log `2026-05-28T02-28-13.jsonl`:

```
ts (UTC)              elapsed   sessActive   devCount   roster
02:28:43  +30s        true      3            2          ← session starts
…
03:04:29  +2175s      true      0            0          ← end of activity
03:05:29  +2235s      false     0            0          ← session ended cleanly
…
03:16:29  +2895s      false     1            0          ← GHOST DEVICE APPEARS, ~11 min after end
03:17:00–03:43:29     false     1            0          ← persists for 26+ min, never decreases
```

The next log file (`2026-05-28T04-23-29.jsonl`) continues from the same browser instance and still shows `deviceCount: 1, sessActive: false` at `elapsedSec: 6915` — **more than 90 minutes after the session ended, with one phantom device that has never been pruned.**

---

## Code Locations

| What | Where |
|---|---|
| Raw ANT+ → normalized fields | `frontend/src/hooks/fitness/DeviceManager.js:134-171` |
| Device staleness sweep | `frontend/src/hooks/fitness/DeviceManager.js:233-297` |
| RPM zero-out logic | `frontend/src/hooks/fitness/DeviceManager.js:260-265` |
| `lastSignificantActivity` bump on update | `frontend/src/hooks/fitness/DeviceManager.js:76-86` |
| Prune scheduler (gated by sessionId) | `frontend/src/context/FitnessContext.jsx:1286-1296` |
| Staleness-aware read (unused by widgets) | `frontend/src/hooks/fitness/FitnessSession.js:1103-1136` |
| Widget consumers reading raw `device.cadence` | `RpmDeviceCard.jsx:31`, `FullscreenVitalsOverlay.jsx:184`, `FitnessUsers.jsx:822-824` |

---

## Root Cause Analysis

### Bug 2 (ghost devices): **CONFIRMED**

`FitnessContext.jsx:1286-1296`:

```js
useEffect(() => {
  const session = fitnessSessionRef.current;
  if (!currentSessionId) return;          // ← gates prune by active session

  const interval = setInterval(() => {
    const timeouts = getFitnessTimeouts();
    session.deviceManager.pruneStaleDevices(timeouts);
    batchedForceUpdate();
  }, 3000);
  return () => clearInterval(interval);
}, [batchedForceUpdate, currentSessionId]);
```

When the session ends, `currentSessionId` clears and the prune interval is torn down. Any subsequent ANT+ packet (a sensor that comes back briefly, an old fob still broadcasting in another room) hits `DeviceManager.updateDevice()` → `registerDevice()` → new entry in `this.devices`. Because the prune is no longer running, the entry is never removed. The telemetry timeline above matches this exactly.

This explains the 90-minute ghost. Easy to verify locally by ending a session and then triggering a single fake device update.

### Bug 1 (within-session freeze): **CONFIRMED** — stale-cadence self-perpetuation

The defect is the interaction between **two facts**:

**Fact 1 — `Device.update()` bumps `lastSignificantActivity` from post-merge state, not from the payload** (`DeviceManager.js:67-86`):

```js
update(data = {}) {
  // ...
  if (Number.isFinite(data.cadence)) this.cadence = data.cadence;  // only updates IF data carries cadence
  // ...

  const hasCadence = Number.isFinite(this.cadence) && this.cadence > 0;
  // ...
  if (hasHeartRate || hasCadence || hasPower || hasSpeed) {
    this.lastSignificantActivity = Date.now();  // ← bumped based on persisted device state
  }
}
```

`hasCadence` reads `this.cadence` (the persisted state after the merge), not `data.cadence` (the incoming payload). If the incoming `data` does not contain `cadence`, `this.cadence` retains its old non-zero value, `hasCadence` evaluates to true, and `lastSignificantActivity` gets bumped to `now`.

**Fact 2 — ANT+ sensors broadcast non-cadence pages constantly** (`_extensions/fitness/src/ant.mjs:208-214`):

```js
this.broadcastFitnessData({
  type: 'ant',
  profile,
  deviceId,
  dongleIndex: deviceIndex,
  data  // every raw ANT+ frame, regardless of page type
});
```

Every raw ANT+ frame is forwarded to the frontend WebSocket. ANT+ sensors cycle through multiple page types (cadence pages, battery pages, manufacturer pages, ANT+ common pages 80-82). Only cadence pages contain `CalculatedCadence`.

The normalization at `DeviceManager.js:153-154`:

```js
if (Number.isFinite(rawData.CalculatedCadence)) {
  normalized.cadence = rawData.CalculatedCadence;
}
```

drops the cadence field entirely when the incoming frame is a non-cadence page. Result: `device.update()` is called with no `cadence`, the stale value is preserved, and `lastSignificantActivity` is bumped anyway.

#### End-to-end timeline that produces the freeze

1. Rider pedals at 55 RPM. Cadence page arrives → `device.cadence = 55`, `lastSignificantActivity = t0`.
2. Rider stops pedaling. No more cadence pages.
3. Sensor continues broadcasting battery / manufacturer / common pages every ~250 ms.
4. Each such packet: `device.update({lastSeen: now, profile: '...', /* no cadence field */ })`.
5. `this.cadence` stays at 55. `hasCadence = (55 > 0) = true`. `lastSignificantActivity = now`.
6. `pruneStaleDevices` sees `now - lastSignificantActivity < 3000ms`. Never resets.
7. Continues until the sensor genuinely stops broadcasting (battery cycling between pages ends, sensor sleeps) — 60–120 s, matching the observed freeze durations.

The freeze duration is **how long the sensor keeps broadcasting *any* page after pedaling stops**, not the 3 s `rpmZero` window.

#### Why "55 → 0 → 55" can happen

The bounce pattern (session 2026-05-27 19:28, bike:49904) is consistent with: sensor goes silent long enough for prune to fire → `resetMetrics()` sets `cadence = 0` → then a single late ANT+ frame arrives. If that frame contains `CalculatedCadence` (a cadence page that was buffered or arrived after a brief reconnect), `device.cadence` is set back to its computed value — which the sensor may briefly report as the previous coast value before fully zeroing.

#### Verification path

Hypothesis A is the only one consistent with all the evidence:
- Explains why the freeze lasts 60–125 s (sensor-broadcast duration, not the 3 s rpmZero window)
- Explains why the value stays exactly constant (cadence field never overwritten)
- Explains why rotation count plateaus during the freeze (no rotation packets arrive — only non-cadence pages)
- Matches the code paths under inspection

Hypotheses B and C are no longer needed to explain the observation, but a final confirmation would be to add `logger.debug('device.update.bump', { id, hadCadenceInPayload: Number.isFinite(data.cadence), hasPersistedCadence: this.cadence > 0 })` and observe whether `hadCadenceInPayload: false, hasPersistedCadence: true` fires during the freeze window.

---

## Reproduction

### Bug 1
1. Start a fitness session with a cadence sensor / ANT+ bike.
2. Pedal at any RPM for ~30 s.
3. Stop pedaling completely. Do NOT move the crank.
4. **Expected:** RPM avatar drops to 0 and stops spinning within ~6 s.
5. **Actual:** Avatar continues displaying the last RPM and spinning for tens of seconds (observed up to 125 s).

### Bug 2
1. Start and complete a fitness session.
2. After session end, leave the tab open.
3. Allow time for any ANT+ packet to arrive (room sensors, leftover bike fob).
4. **Expected:** Device count stays at 0; or any late device registers and is pruned within `remove` (30 min).
5. **Actual:** Device registers, persists indefinitely (90+ min observed), never pruned.

---

## Suggested Investigation Next Steps

Both root causes are now identified. Remaining diagnostic step before fix design:

1. **Final live confirmation of Bug 1** — add `logger.debug('device.update.bump', { id, hadCadenceInPayload: Number.isFinite(data.cadence), persistedCadence: this.cadence })` in `Device.update()` and observe a real cycling session. Expect to see `hadCadenceInPayload: false, persistedCadence: > 0` events fire repeatedly throughout the post-pedal freeze window. This confirms Hypothesis A directly.

### Design considerations for the eventual fix

These are *not* prescriptions — just constraints any fix must respect:

- For Bug 1: `lastSignificantActivity` must be driven by the **incoming payload's significance**, not the device's persisted state. Options include (a) gating the bump on `Number.isFinite(data.cadence) && data.cadence > 0` (and the equivalent for hr/power/speed), or (b) tracking a separate `lastCadenceFrameTs` that only advances when a cadence reading actually arrives, and using that for the rpmZero check.
- For Bug 2: the prune sweeper needs to keep running (or a new device must be unable to register) when no session is active. Don't pick option B in isolation — devices need to be pruneable in both modes so a session can start cleanly.
- The existing `FitnessSession.getEquipmentCadence()` does correct staleness handling and is consumer-side. Wiring widgets to it (per `docs/superpowers/plans/2026-05-16-fitness-rpm-freeze-fix.md`) mitigates Bug 1's user-visible symptom but leaves the underlying `DeviceManager` state corruption in place — that state still feeds `userManager`, `zoneProfileStore`, and the persisted series, so the freeze still shows up in saved session data even if the live UI is fixed.

---

## Related Work

- `docs/superpowers/plans/2026-05-16-fitness-rpm-freeze-fix.md` — proposes a `useEquipmentCadence` hook that polls `FitnessSession.getEquipmentCadence()` (which already implements correct staleness). This would mitigate Bug 1 at the consumer side but does **not** address the underlying `DeviceManager` defect or Bug 2.
- `FitnessSession.getEquipmentCadence()` (`FitnessSession.js:1103-1136`) — already exists, already correctly returns `{rpm: 0, connected: false}` past `rpmZero`. Currently unused by avatar widgets.

---

## Sessions Inspected

Session YAMLs at `data/household/history/fitness/`:
- `2026-05-21/20260521193852.yml`
- `2026-05-22/20260522174700.yml`
- `2026-05-23/20260523132554.yml`
- `2026-05-25/{20260525133145,20260525142744}.yml`
- `2026-05-26/20260526192839.yml`
- `2026-05-27/{20260527131210,20260527192814}.yml`
- `2026-05-28/20260528055423.yml`

Telemetry log:
- `media/logs/fitness/2026-05-28T02-28-13.jsonl` (37-min cycling session + post-end ghost device)
- `media/logs/fitness/2026-05-28T04-23-29.jsonl` (continued idle, ghost device still present)
