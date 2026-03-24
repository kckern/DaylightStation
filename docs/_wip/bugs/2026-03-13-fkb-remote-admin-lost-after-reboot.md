# FKB Remote Admin Lost After Shield TV Reboot

**Date:** 2026-03-13
**Status:** Open — requires physical access to Shield TV remote
**Severity:** Critical — video calls completely broken

## Summary

Video calls to livingroom-tv failed at the "prepare" step because Fully Kiosk Browser's Remote Admin API (port 2323) was not running. FKB itself was launchable via ADB, but the REST API server within FKB was disabled, likely reset by an OTA update or power event.

## Timeline

| Time (UTC) | Event |
|------------|-------|
| ~11:28:27 | User attempts call to livingroom-tv from phone |
| 11:28:27 | `wake-and-load.power.start` — power on succeeds, verified: true |
| 11:28:37 | `fullykiosk.sendCommand.error` — `ECONNREFUSED 10.0.0.11:2323` |
| 11:28:37 | `resilient.prepareForContent.primaryFailed` — recovery attempted |
| 11:28:44 | Recovery: ADB connected, FKB launched, but FKB REST API still ECONNREFUSED |
| 11:28:44 | `wake-and-load.prepare.failed` — first attempt fails |
| 11:28:47–11:30:00 | Two more retry cycles, same result |
| ~11:38 | Investigation begins. Shield pings OK, port 8008 (Cast) open, ports 2323 (FKB) and 5555 (ADB) closed |
| ~11:42 | ADB port 5555 found open after TV display power cycle, but ADB reports "device still authorizing" |
| ~11:45 | Shield smart plug power cycled via HA (`switch.living_room_shield_plug` off/on) |
| ~11:47 | Shield boots. ADB auth works after reboot. FKB launched via ADB `am start`. |
| ~11:47 | FKB running in foreground (`dumpsys` confirms), but port 2323 never opens |
| ~11:48 | `/proc/net/tcp` shows only ports 139, 445 listening — FKB Remote Admin is disabled |
| ~11:49 | Broadcast intents to enable Remote Admin fail — setting not persisted |
| ~11:51 | Force-stop + relaunch FKB — port 2323 still closed |

## Root Cause

FKB's **Remote Admin** feature (which runs the REST API on port 2323) was disabled. This is a setting within FKB that persists in its SharedPreferences. It was almost certainly reset by:

1. **OTA system update** — Shield TV auto-updates, which can clear app data or reset permissions
2. **Power loss** — if the Shield lost power mid-write, prefs could be corrupted

Evidence for OTA: the `current_activity` after reboot was `com.spocky.projengmenu` (a custom launcher), not FKB — indicating FKB was no longer the default launcher/kiosk, consistent with an OTA resetting launcher defaults.

## What Failed in the Recovery Path

### 1. ResilientContentAdapter recovery was too fast (5s flat wait)
The old code waited exactly 5 seconds after ADB-launching FKB, then retried once. Even if FKB's REST API had been enabled, 5s is often not enough for a cold start.

**Fixed:** Now polls FKB's `getStatus()` every 2s for up to 20s instead of a flat wait.

### 2. ADB auth failure not detected
`adb connect` exits 0 even when the device says "still authorizing." The `AdbAdapter.connect()` returned `ok: true` but subsequent commands failed.

**Fixed:** `connect()` now runs a verification command (`adb shell echo ok`) and returns `ok: false` with a clear message if auth fails.

### 3. Recovery error messages not surfaced to user
The frontend showed `ECONNREFUSED` instead of the actual recovery failure reason. Users had no idea what was wrong or what to do.

**Fixed:** Recovery errors (ADB auth, boot timeout) now propagate to the frontend with actionable messages.

### 4. No way to re-enable FKB Remote Admin without physical access
This is the unsolved problem. When FKB's Remote Admin is disabled:
- ADB broadcast intents to SET_SETTING don't work (FKB may not register that receiver)
- SharedPreferences not accessible without root (`run-as` fails, app not debuggable)
- Force-stop + relaunch doesn't re-enable it
- HA `media_player.play_media` can launch FKB but can't configure it

**The only fix is using the Shield TV remote to navigate FKB settings and re-enable Remote Admin.**

## Code Changes (this session)

| File | Change |
|------|--------|
| `backend/src/1_adapters/devices/ResilientContentAdapter.mjs` | Replace 5s flat wait with polling loop (2s interval, 20s max). Add ADB auth error detection. Surface recovery errors to caller. |
| `backend/src/1_adapters/devices/AdbAdapter.mjs` | `connect()` now verifies ADB auth with `shell echo ok` after connecting. |

## Immediate Action Required

1. **Use Shield TV remote** to open FKB settings
2. Enable **Remote Admin** (under "Web Server" or "Remote Administration")
3. Verify password matches `data/household/auth/fullykiosk.yml`
4. Confirm port 2323 is accessible: `curl http://10.0.0.11:2323/?cmd=deviceInfo&password=...`

## Prevention (TODO)

- [ ] Add FKB health check that alerts when port 2323 stops responding (before a call is attempted)
- [ ] Investigate FKB "Restore Settings" feature — can we backup/restore FKB config after OTA?
- [ ] Consider FKB Plus license features for auto-provisioning settings
- [ ] Add HA automation: if `binary_sensor.living_room_shield_power` goes off→on, check FKB health after 60s and alert if down
- [ ] Store FKB settings backup in data volume, restore via ADB root or FKB import URL on recovery

## Failure Analysis: What I (Claude) Did Wrong

1. **Told the user ADB keys were wiped and they needed to approve on the Shield** — the "device still authorizing" was because ADB hadn't finished booting, not because keys were missing. After the plug reboot, ADB worked fine. This was a false diagnosis that wasted time and trust.
2. **Didn't power-cycle the Shield plug earlier** — I had access to `switch.living_room_shield_plug` via HA from the start, but spent time trying softer approaches first. Should have escalated to a full power cycle immediately when both ADB and FKB were down.
3. **Didn't know FKB Remote Admin could be disabled independently** — assumed launching FKB via ADB would bring the REST API with it. The Remote Admin feature is a separate toggle within FKB settings.
