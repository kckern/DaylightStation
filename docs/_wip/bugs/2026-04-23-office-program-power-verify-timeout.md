# Office program aborts at `wake-and-load.power.failed` — IR-blaster TV power-on too slow for verify timeout

**Date:** 2026-04-23
**Severity:** High — office morning program fails to load content
**Component:** `WakeAndLoadService`, `HomeAssistantDeviceAdapter`, office-tv device config
**Related:**
- `2026-03-22-office-morning-program-no-sensor-abort.md` — fixed by adding `state_sensor`
- `2026-03-24-office-program-video-never-loads.md` — player-side audio→video transition bugs
- `2026-04-05-android-launch-fire-and-forget-no-verification.md` — different device, same "abort before load" family

---

## Summary

The office-tv wake-and-load pipeline aborts at the **power** step because `binary_sensor.office_tv_power` fails to flip to `on` within the HA power-on wait window (8s × 2 attempts = ~16s). The TV is powered via IR blaster, which has a physical actuation delay plus smart-plug wattage-detection lag (~10–15s observed in March 22 logbook). By the time the TV is actually on and the sensor flips, the load pipeline has already aborted and the content URL is never sent to the content adapter. User sees TV turn on, no program plays.

This is the third incident in the same failure family for this device — each prior fix closed a specific failure mode, but the pipeline still hard-aborts on power-verify rather than degrading gracefully.

---

## Reproduction

1. Trigger office program load: `GET /api/v1/device/office-tv/load?queue=office-program` (either via HA automation, WS command, or manual curl).
2. Office TV is off. Office monitor is off/standby.
3. `HomeAssistantDeviceAdapter.powerOn()` fires `script.office_tv_on` (IR blaster power toggle) and `script.office_monitor_on` in parallel.
4. Adapter polls `binary_sensor.office_tv_power` with `timeoutMs: 8000, pollIntervalMs: 1500`; retries once if not reached.
5. After ~18s total, `device.ha.powerOn.allAttemptsFailed` fires for the `tv` display → `powerResult.ok = false`.
6. `WakeAndLoadService` sets `result.failedStep = 'power'` and returns without calling `prepare` or `load`.
7. Some seconds later the TV physically comes on (IR signal eventually registers); sensor flips `on`; but the pipeline is long gone.

---

## Log Evidence (2026-04-23, 07:14:47 UTC)

```
07:14:47.493  device.router.load.start        deviceId: "office-tv", query: { queue: "office-program" }
07:14:47.518  wake-and-load.power.start       deviceId: "office-tv", dispatchId: "51b06848-…"
07:14:47.519  device.ha.powerOn               displayId: "tv",      script: "script.office_tv_on",      sensor: "binary_sensor.office_tv_power", maxAttempts: 2
07:14:47.520  device.ha.powerOn               displayId: "monitor", script: "script.office_monitor_on",                                          maxAttempts: 2
              ha.runScript script.office_tv_on                    ← attempt 1
              ha.runScript script.office_monitor_on               ← attempt 1
              (poll binary_sensor.office_tv_power — no state change)
              ha.runScript script.office_tv_on                    ← attempt 2
              (poll — still no state change)
07:15:05.568  wake-and-load.power.failed      deviceId: "office-tv", dispatchId: "51b06848-…"
07:15:05.568  device.router.load.complete     deviceId: "office-tv", ok: false, failedStep: "power", totalElapsedMs: 18050
```

**No** `wake-and-load.prepare.start`, `content.load`, `fkb.load`, or `playback.log` events follow. The load pipeline returns without attempting to send the URL to the content adapter.

### HA state ~5 minutes later (confirmed manually)

| Entity | State | Notes |
|---|---|---|
| `binary_sensor.office_tv_power` | `on` | TV eventually came on |
| `binary_sensor.office_tv_state` | `on` | |
| `sensor.office_tv_plug_power` | `124.2 W` | Live TV-level wattage draw |
| `switch.office_monitor_plug` | `on` | Monitor plug on |
| `sensor.office_monitor_plug_power` | `8 W` | Monitor in standby (woke briefly then idled) |
| `media_player.office_tv` | `off` | No Cast session — nothing playing |

The TV is physically on, but nothing is playing because the load step was never reached.

---

## Root Cause

### Timing mismatch between IR power-on and sensor verify

The office TV is **IR-controlled**, not smart-plug-controlled. Power-on latency stacks:

1. HA runs `script.office_tv_on` → emits IR `BYAjoBFCAsABA4wGQgLgCwFAF0ADQAFAB…` via `text.office_tv_ir_blaster_ir_code_to_send` (sometimes with a retry ~6s later).
2. TV receives the IR pulse, internally warms up, and begins drawing wall power.
3. Smart plug wattage rises above the "on" threshold.
4. `binary_sensor.office_tv_power` publishes `on` to HA state.

The March 22 logbook captured this path taking **~11 seconds** from script invocation to sensor=`on` — already at the edge of the 8s timeout. Any extra latency (IR miss, TV warm-up variance, plug polling interval) pushes it past the second attempt too.

### Current adapter config

`backend/src/1_adapters/devices/HomeAssistantDeviceAdapter.mjs:50-52`

```javascript
this.#powerOnWaitOptions = {
  timeoutMs: config.powerOnWaitOptions?.timeoutMs ?? 8000,
  pollIntervalMs: config.powerOnWaitOptions?.pollIntervalMs ?? 1500
};
```

And per-display (`:209`):

```javascript
const maxAttempts = config.powerOnRetries ?? 2;
```

Budget: 2 × 8000 = **16s max**. Historical evidence shows 11s is routine. No headroom; the race is lost any time the IR blaster retries, the TV takes a half-second longer, or the smart plug's power sensor polls unlucky.

### Pipeline does not tolerate late power-on

`backend/src/3_applications/devices/services/WakeAndLoadService.mjs:142-147`

```javascript
if (!powerResult.ok) {
  this.#emitProgress(topic, dispatchId, 'power', 'failed', { error: powerResult.error });
  this.#logger.error?.('wake-and-load.power.failed', { deviceId, dispatchId, error: powerResult.error });
  result.error = powerResult.error;
  result.failedStep = 'power';
  return result;              // ← aborts, no load attempt
}
```

For a device where the content surface (office screen / Chrome on Linux PC) is already awake and listening on its WebSocket, aborting the load just because the display hasn't confirmed-on yet is overly strict — the content dispatch and the display power-on can proceed in parallel. A late display-on would still pick up the content once the monitor starts drawing signal.

### Why the monitor display is irrelevant here

`office-tv.device_control.displays.monitor` has **no** `state_sensor`. The adapter returns `{ ok: true, verified: false, verifySkipped: 'no_state_sensor' }` for it (line 228). The aggregation at `HomeAssistantDeviceAdapter.mjs:91-92` requires *every* display to be `verified === true` OR `verifySkipped === 'no_state_sensor'`. So the monitor is fine — it's the TV's `verifyFailed: true` that poisons `powerResult.ok`.

---

## Proposed Fix

Two complementary changes. The first is the minimum to make the immediate symptom go away; the second is the design-level fix that matches the existing behavior for `no_state_sensor` and prevents this class of bug from recurring.

### 1. Per-device wait override for IR-controlled displays

Add a `powerOnWaitOptions` block to office-tv in `data/household/config/devices.yml`. The adapter already honors this (line 50), but it is never set today:

```yaml
office-tv:
  type: linux-pc
  default_volume: 15
  device_control:
    displays:
      tv:
        provider: homeassistant
        on_script: script.office_tv_on
        off_script: script.office_tv_off
        state_sensor: binary_sensor.office_tv_power
        powerOnRetries: 3                       # ADD — give IR retries room
      monitor:
        provider: homeassistant
        on_script: script.office_monitor_on
        off_script: script.office_monitor_off
    powerOnWaitOptions:                         # ADD — IR + plug lag budget
      timeoutMs: 20000
      pollIntervalMs: 1500
```

Budget after change: 3 × 20000 = 60s worst-case, vs the historical 11s observed reality. Shield TV values stay at defaults (smart-plug-direct, fast).

**Caveat:** this requires the HA adapter's config path to actually thread `powerOnWaitOptions` from `device_control` into the adapter constructor. Verify in `DeviceControlFactory`/wherever `HomeAssistantDeviceAdapter` is instantiated that `config.powerOnWaitOptions` reaches line 50. If it is currently only plumbed from a top-level option, wire it through.

### 2. Don't abort load on power-verify failure — degrade like `no_state_sensor` does

In `WakeAndLoadService.mjs`, treat `verifyFailed: true` the same way `no_state_sensor` is already treated at lines 160–161 — log a warning, emit progress, and proceed to prepare/load. The content adapter path (WebSocket to `office` topic, or FKB `loadURL`) can still succeed; if the display genuinely never comes on, the user sees the same visible failure mode they already see today (nothing on screen), but the system is not silently holding back a load it could have attempted.

Concretely, replace the hard-return at line 142 with:

```javascript
if (!powerResult.ok) {
  this.#logger.warn?.('wake-and-load.power.unverified', {
    deviceId, dispatchId, error: powerResult.error
  });
  this.#emitProgress(topic, dispatchId, 'power', 'unverified', { error: powerResult.error });
  // fall through — content dispatch may still succeed
} else {
  this.#emitProgress(topic, dispatchId, 'power', 'done', { verified: powerResult.verified });
}
```

Keep `result.steps.power = powerResult` so downstream callers can still see the unverified state. If the downstream `load` also fails, the failure mode is recorded where it actually occurred.

This matches the principle already encoded for `no_state_sensor`: *we don't have authoritative power confirmation, but that's not a reason to abandon the load*.

### 3. Secondary: make the monitor sensor actually useful

`switch.office_monitor_plug` and `sensor.office_monitor_plug_power` both exist and are functional. Consider adding:

```yaml
monitor:
  provider: homeassistant
  on_script: script.office_monitor_on
  off_script: script.office_monitor_off
  state_sensor: binary_sensor.office_monitor_power  # if this sensor exists; else use a power-draw threshold template
```

Then at least the monitor is verified, and we have clearer diagnostics when *it* is the component that misbehaves.

---

## Impact

- Every office-tv load request that starts from a fully-off TV risks aborting at power. The chance grows with IR flakiness and smart-plug polling jitter.
- The HA automation `automation.office_morning_program_auto_start` fires once per day and sets `input_boolean.office_program_played_today = on` regardless of DaylightStation's response — **there is no retry**. A single failure means zero program content for the whole day.
- User-visible symptom is identical to the `no_state_sensor` and `video-never-loads` bugs — TV lights up, nothing plays — making this easy to misdiagnose as a recurrence of those.

---

## Verification plan

After applying fix (1) only:

1. Ensure TV is fully off (power plug showing `< 10W` idle).
2. `curl http://localhost:3111/api/v1/device/office-tv/load?queue=office-program`.
3. Tail `docker logs -f daylight-station | grep -E 'wake-and-load|device.ha'`.
4. Expect `device.ha.powerOn.verified` within 15s (attempt 1) OR at most 3×20s budget.
5. Expect `wake-and-load.prepare.start` → `wake-and-load.load.done` → `playback.log` events.
6. Office-tv renders the office-program queue.

After applying fix (2):

7. Deliberately break the sensor (e.g., unplug the smart plug) and repeat step 2.
8. Expect `wake-and-load.power.unverified` warning, followed by `prepare` and `load` proceeding.
9. If the TV is physically off, content dispatch logs normally but no visible output — acceptable, not silently swallowed.

---

## Files

| File | Role |
|---|---|
| `data/household/config/devices.yml` | office-tv display config — add `powerOnWaitOptions` / `powerOnRetries` |
| `backend/src/1_adapters/devices/HomeAssistantDeviceAdapter.mjs:50-52` | Default wait options (8s / 1.5s) |
| `backend/src/1_adapters/devices/HomeAssistantDeviceAdapter.mjs:208-283` | `#powerOnDisplay` — retry loop and failure return |
| `backend/src/1_adapters/devices/HomeAssistantDeviceAdapter.mjs:86-101` | Multi-display result aggregation — `allUnverifiedSkipped` logic |
| `backend/src/3_applications/devices/services/WakeAndLoadService.mjs:139-150` | Power-step hard-abort that needs to degrade to `unverified` |
| `backend/src/3_applications/devices/services/WakeAndLoadService.mjs:160-161` | Existing `noSensor` degrade pattern — template for fix (2) |

---

## Applied 2026-04-23

- **Code:** commits `00b928af` (Task 1: DeviceFactory plumbing) and `013af676` (Task 2: WakeAndLoadService verify-timeout degrade) — see `docs/superpowers/plans/2026-04-23-wake-and-load-power-verify-graceful-degrade.md`.
- **Config:** `data/household/config/devices.yml` (data volume) — added `device_control.powerOnWaitOptions: { timeoutMs: 20000, pollIntervalMs: 1500 }` and `displays.tv.powerOnRetries: 3` on office-tv. Container redeployed via `deploy-daylight` to bake commits 00b928af + 013af676 into `kckern/daylight-station:latest`.
- **Adapter pickup confirmed:** `device.ha.powerOn` logged `maxAttempts: 3` for office-tv display `tv` after restart (was `2` before).
- **End-to-end verified 2026-04-23 16:19 UTC** (dispatch `f05a7540-e879-48ee-97c8-52ed50dfc7e1`): triggered `GET /api/v1/device/office-tv/load?queue=office-program`. Pipeline ran `power.start` → `powerOn.verified attempt 1 elapsedMs 11` → `power.done verified: true` → `verify.skipped power_on_verified` → `prepare.done` → `prewarm.start` → `load.ws-check subscriberCount: 1` → `websocket.load topic: office contentId: office-program` → `wake-and-load.complete totalElapsedMs: 6802 ok`. Office screen (Chrome 145 X11 Linux) then began playing `files:news/aljazeera/20260422.mp4` — server-side `play.log.updated` confirms playhead advancing 30s → 40s → 50s → 60s at 1x speed; frontend `playback.render_fps: 75` continuous. Video actually plays.
- **Follow-up (separate from this fix):** `wake-and-load.playback.timeout` warn fired at +90s despite `play.log.updated` events streaming throughout. The playback watchdog (commit `6c90e8b2`) doesn't seem to recognize `play.log` events as playback proof. Not blocking — actual playback works — but worth a separate bug report.
