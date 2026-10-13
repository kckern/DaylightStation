# Drop-in call fails: no heartbeat after cold wake

**Date:** 2026-03-04
**Severity:** High
**Component:** wake-and-load, fullykiosk, useHomeline

## Summary

Drop-in calls to `livingroom-tv` fail with a connect timeout when the TV and Shield are woken from a cold/sleep state. The TV powers on successfully, Fully Kiosk is force-stopped and relaunched, but the DaylightStation frontend inside Fully Kiosk never sends a heartbeat back to the caller within the 10s window.

## Reproduction

1. Shield is awake but TV is off (or both are off/asleep)
2. Initiate a drop-in call from mobile to `livingroom-tv`
3. Wake sequence runs: `script.living_room_tv_on` fires, TV powers on
4. DaylightStation force-stops Fully Kiosk via ADB and relaunches it
5. Fully Kiosk REST API is slow to come online (ECONNREFUSED for ~2s, then 500s)
6. By attempt 3, Fully Kiosk foreground is confirmed
7. Caller sends `ready-sent` but never receives a heartbeat
8. `connect-timeout` at 10s, `connect-timeout-user-visible` at 15s
9. Call fails

## Log Evidence

### Run 1 (05:34 PST) — First successful wake after HA script fix
```
05:34:06 device.ha.powerOn.verified          (TV already on, 1ms)
05:34:06 wake-and-load.prepare.start
05:34:09 fullykiosk.adbForceStop              ok: true
05:34:09 fullykiosk.adbRelaunch               ok: true
05:34:09 fullykiosk.sendCommand.error         ECONNREFUSED 10.0.0.11:2323
05:34:10 fullykiosk.notInForeground           attempt: 1  (ECONNREFUSED)
05:34:10 fullykiosk.notInForeground           attempt: 2  (500 ERR_BAD_RESPONSE)
05:34:12 fullykiosk.foregroundConfirmed       attempt: 3  (4.8s after relaunch)
05:34:13 wake-and-load.prepare.done
```

### Run 2 (05:42 PST) — Full wake-and-load succeeds, heartbeat still fails
```
05:42:33 device.ha.powerOn.verified          (1ms — TV was pre-woken by HA script)
05:42:35 fullykiosk.adbForceStop              ok: true
05:42:36 fullykiosk.adbRelaunch               ok: true
05:42:36 fullykiosk.sendCommand.error         ECONNREFUSED (12ms after relaunch)
05:42:36 fullykiosk.notInForeground           attempt: 1
05:42:38 fullykiosk.foregroundConfirmed       attempt: 2  (4.8s after relaunch)
05:42:40 wake-and-load.prepare.done
05:42:40 fullykiosk.load.start                url: daylightlocal.kckern.net/tv?open=videocall/livingroom-tv
05:42:46 fullykiosk.load.success              loadTimeMs: 6012
05:42:46 wake-and-load.complete               totalElapsedMs: 12367  ← backend done

13:42:46 ready-sent                           target: livingroom-tv
13:42:56 connect-timeout                      waitedMs: 10000  ← NO HEARTBEAT
13:43:01 connect-timeout-user-visible         elapsed: 15s     ← call fails
```

### Key timing
- Backend `wake-and-load.complete` to `ready-sent`: **0ms** (immediate)
- Page load time: **6s**
- Time from page load to heartbeat timeout: **10s**
- **Total budget for JS init + WebSocket connect + first heartbeat: 10s — not enough**

## Root Cause

The HA wake and DaylightStation backend wake-and-load pipeline both work correctly. The failure is in the **caller-to-TV heartbeat handshake** after the page loads.

After `fullykiosk.load.success`, the DaylightStation frontend page inside Fully Kiosk must:
1. Parse and execute JavaScript
2. Establish a WebSocket/Homeline connection
3. Send a heartbeat to the caller

The caller starts the 10s heartbeat timer immediately after `wake-and-load.complete`. But the page was *just* loaded — JS init + WebSocket negotiation on the Shield (Android TV, not a fast browser) takes longer than 10s.

**The 10s heartbeat timeout is too short for cold-wake scenarios.** Under normal conditions (Fully Kiosk already running, page already loaded), heartbeats arrive instantly. After a force-stop/relaunch + fresh page load, the JS cold start exceeds the timeout.

## Suggested Fixes

1. **Increase heartbeat timeout after cold wake** -- When the wake sequence involved a force-stop/relaunch of Fully Kiosk, increase the connect timeout to 30s instead of 10s. The caller already knows this is a cold wake scenario.

2. **Wait for Fully Kiosk page load before sending `ready-sent`** -- After `wake-and-load.prepare.done`, poll the Fully Kiosk REST API to confirm the page has finished loading (e.g., `cmd=getPageInfo` or check `currentPage`) before signaling the caller to start waiting.

3. **Add heartbeat retry** -- If the first 10s heartbeat window times out after a cold wake, retry once with a fresh 15s window rather than immediately failing.

## Context

Originally discovered after the daily 4 AM Shield power cycle automation (`living_room_timer_power_cycle_shield`). The HA-side wake script (`script.living_room_tv_on`) has since been fixed to use ADB `WAKEUP`+`HOME` key events instead of `media_player.turn_on` (which was a no-op when Shield was already awake). The TV now wakes reliably and the full wake-and-load pipeline completes in ~12s. The remaining issue is purely the caller-side heartbeat timeout.
