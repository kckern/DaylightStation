# Bug: Living room TV auto-powers off during wake-and-load prepare phase

**Date:** 2026-03-24
**Severity:** Critical — morning program never plays; video starts then Shield dies
**Affected:** livingroom-tv (Shield TV + FKB)
**Deployed build:** `5dd6953a`

---

## Summary

The wake-and-load sequence turns the TV on, then spends 24 seconds in the FKB prepare phase (foreground verification, ADB checks, companion app launches). During this window, the TV auto-powers off (CEC or built-in auto-sleep) because no active content is displayed. By the time FKB loads the morning program URL, the TV is off and the Shield is entering standby. Content loads and briefly plays, then the Shield dies.

## Reproduction

```bash
curl "http://localhost:3111/api/v1/device/livingroom-tv/load?queue=morning-program"
```

Returns `ok: true` but the morning program never plays through.

## Evidence

### Backend timeline (UTC, 2026-03-24)

| Time | Event | Detail |
|------|-------|--------|
| 16:26:55.990 | `device.router.load.start` | `deviceId: livingroom-tv, queue: morning-program` |
| 16:26:55.997 | `wake-and-load.power.done` | TV on, verified in 7ms (was already on from boot) |
| 16:26:56.001 | `wake-and-load.prepare.start` | FKB foreground, ADB, companion apps |
| **16:27:19** | **TV auto-powers off** | HA: `media_player.living_room_tv → off` (no script triggered) |
| 16:27:20.596 | `wake-and-load.prepare.done` | 24s prepare cycle completes |
| 16:27:21.380 | `wake-and-load.load.start` | FKB loadURL fires (TV already off) |
| 16:27:24.964 | `wake-and-load.complete` | `ok: true`, 28974ms |

### HA logbook — no automation or script turned the TV off

```
16:26:55 script.living_room_tv_on        → started → off  (completed)
16:26:55 script.living_room_tv_volume    → started → off  (completed)
16:27:19 media_player.living_room_tv     → off             ← SELF-POWERED OFF
16:27:24 media_player.shield_android_tv  → off             ← CEC followed
16:27:25 binary_sensor.living_room_tv_power → off
```

No `script.living_room_tv_off` appears in the logbook. The TV turned itself off.

### Frontend — content loaded and played briefly on dying Shield

```
16:27:25 screen-autoplay.parsed { keys: ["queue"] }
16:27:28 queue-track-changed    { title: "Good Morning", queueLength: 7 }
16:27:29 playback.started       { mediaKey: "files:sfx/intro", mediaType: "audio" }  ← PLAYED
16:27:43 queue-advance          { step: 1, prevLength: 7, newLength: 6 }
16:27:43 queue-track-changed    { title: "20260324", queueLength: 6 }
16:27:43 playback.started       { mediaKey: "files:video/news/world_az/20260324.mp4", mediaType: "video" }  ← PLAYED
16:27:50 menu-perf.snapshot     { fps: 0, nodeCount: 119 }  ← Shield dead, WebView gone
```

Both audio intro and video **did start playing**. The Shield ran on residual power for ~25s after TV off, then died.

## Root Cause

The prepare phase takes 24 seconds. During this time, FKB shows its start URL (the idle living room screen — no video, no activity). The TV's auto-sleep or HDMI-CEC idle detection powers off the TV after ~24s of no active content. The wake-and-load service doesn't re-verify TV power after prepare.

### Code path

`WakeAndLoadService.mjs` executes steps sequentially:
1. **Power on** → verifies TV is on ✓
2. **Volume** → sets volume ✓
3. **Prepare** → 24 seconds of FKB foreground/ADB work (TV turns off during this)
4. **Prewarm** → no-op for `files:` content
5. **Load** → FKB loadURL (TV already off)

There is no TV power re-check between steps 3 and 5.

## Fix

After `prepare.done` and before `load.start`, re-check the TV power state and power on again if it turned off during prepare.

### Location

`backend/src/3_applications/devices/services/WakeAndLoadService.mjs` — between prepare.done and prewarm/load.

## Impact

- Morning program has never reliably played on living room TV
- The prepare phase length (24s) is variable — depends on ADB reconnect time, companion apps, FKB state
- Any wake-and-load where prepare exceeds the TV's auto-sleep threshold (~20s) will fail
- The service reports `ok: true` despite the TV being off — false positive
