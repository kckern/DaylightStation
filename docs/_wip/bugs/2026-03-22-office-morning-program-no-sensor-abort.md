# Office morning program aborts: wake-and-load fails with `no_sensor` on office-tv

**Date:** 2026-03-22
**Severity:** High
**Component:** wake-and-load, HomeAssistantDeviceAdapter, device config

## Summary

The office morning program automation (`office_morning_program_auto_start`) successfully powers on the office TV via HA's IR blaster, but DaylightStation's `/api/v1/device/office-tv/load?queue=office-program` endpoint fails immediately at the verify step because `office-tv` has no `state_sensor` configured on its displays. The program content never loads — the TV turns on to a blank screen.

## Reproduction

1. Enter the office between 07:00–12:00 when `input_boolean.office_program_played_today` is `off`
2. Wait 5 minutes for presence sensor to trigger
3. Automation fires: calls `rest_command.office_program` (which hits `GET /api/v1/device/office-tv/load?queue=office-program`) **and** `script.office_tv_on` (via the device adapter)
4. HA IR blaster toggles the TV power — TV physically turns on (~10s later)
5. DaylightStation's wake-and-load completes in **10ms**, failing at verify with `no_sensor`
6. Program queue never loads; TV shows blank/last input

## Log Evidence

### DaylightStation logs (2026-03-22, 08:09 PDT)

```
08:09:53 device.router.load.start         deviceId: "office-tv", query: { queue: "office-program" }
08:09:53 wake-and-load.power.start         deviceId: "office-tv"
08:09:53 device.ha.powerOn                 displayId: "tv", script: "script.office_tv_on", maxAttempts: 2
08:09:53 device.ha.powerOn                 displayId: "monitor", script: "script.office_monitor_on", maxAttempts: 2
08:09:53 device.ha.powerOn.noSensor        displayId: "tv", attempt: 1
08:09:53 device.ha.powerOn.noSensor        displayId: "monitor", attempt: 1
08:09:53 wake-and-load.power.done          deviceId: "office-tv", verified: false, elapsedMs: 8
08:09:53 wake-and-load.verify.start        deviceId: "office-tv"
08:09:53 wake-and-load.verify.failed       deviceId: "office-tv", reason: "no_sensor"
08:09:53 device.router.load.complete       deviceId: "office-tv", ok: false, failedStep: "verify", totalElapsedMs: 10
```

### Home Assistant logbook (same timeframe)

```
08:09:53 automation.office_morning_program_auto_start  triggered by state of binary_sensor.office_presence_sensor_presence
08:09:53 script.office_tv_on                           started
08:09:53 text.office_tv_ir_blaster_ir_code_to_send     (IR power toggle sent)
08:09:53 input_boolean.office_program_played_today      turned on (by automation)
08:09:59 text.office_tv_ir_blaster_ir_code_to_send     (IR retry #2)
08:10:04 binary_sensor.office_tv_power                  → on  (TV confirmed on via power plug)
08:10:04 binary_sensor.office_tv_state                  → on
```

**Key timing gap:** DaylightStation gave up at 08:09:53 (10ms). The TV physically confirmed on at 08:10:04 (11 seconds later). The program queue was never loaded.

## Root Cause

The `office-tv` device config in `data/household/config/devices.yml` is missing `state_sensor` on both displays:

```yaml
# CURRENT (broken)
office-tv:
  type: linux-pc
  device_control:
    displays:
      tv:
        provider: homeassistant
        on_script: script.office_tv_on
        off_script: script.office_tv_off
      monitor:
        provider: homeassistant
        on_script: script.office_monitor_on
        off_script: script.office_monitor_off
```

Compare with `livingroom-tv`, which works correctly:

```yaml
# livingroom-tv (working reference)
livingroom-tv:
  type: shield-tv
  device_control:
    displays:
      tv:
        provider: homeassistant
        on_script: script.living_room_tv_on
        off_script: script.living_room_tv_off
        volume_script: script.living_room_tv_volume
        state_sensor: binary_sensor.living_room_tv_power   # ← has sensor
```

### Code path

1. `HomeAssistantDeviceAdapter.#powerOnDisplay()` (line 207) reads `config.state_sensor` → `undefined`
2. Returns `{ verified: false, verifySkipped: 'no_state_sensor' }` (line 224–234)
3. `WakeAndLoadService.execute()` (line 86) detects `noSensor` condition
4. Logs `wake-and-load.verify.failed` with reason `no_sensor` and aborts the load

**Note:** There is a logic inconsistency — lines 88–91 of `WakeAndLoadService.mjs` treat `noSensor` as a skip (should proceed), but the actual log output and API response show `ok: false, failedStep: "verify"`. The `no_sensor` path may have regressed to a hard failure somewhere downstream.

## Available HA Sensors for Office TV

These sensors exist and are functional in Home Assistant:

| Entity | Current State | Notes |
|--------|--------------|-------|
| `binary_sensor.office_tv_power` | `on` | Power monitoring via smart plug — reliable on/off |
| `binary_sensor.office_tv_state` | `on` | Derived state sensor |
| `switch.office_tv_plug` | `on` | The smart plug itself |
| `sensor.office_tv_plug_power` | `124.7W` | Wattage draw (TV drawing power = on) |

`binary_sensor.office_tv_power` is the correct sensor to use — it mirrors the pattern used by `livingroom-tv` (`binary_sensor.living_room_tv_power`).

## Fix

Add `state_sensor` to the office-tv display config in `data/household/config/devices.yml`:

```yaml
office-tv:
  type: linux-pc
  device_control:
    displays:
      tv:
        provider: homeassistant
        on_script: script.office_tv_on
        off_script: script.office_tv_off
        state_sensor: binary_sensor.office_tv_power      # ADD THIS
      monitor:
        provider: homeassistant
        on_script: script.office_monitor_on
        off_script: script.office_monitor_off
        # monitor has no power sensor — leave omitted (no_sensor skip is fine here)
```

After updating, restart the DaylightStation container to pick up the config change.

### Secondary investigation

The `WakeAndLoadService` `no_sensor` code path may have a bug of its own. Lines 88–91 suggest it should **skip** verification and proceed to content loading, but the actual behavior is `ok: false, failedStep: "verify"`. This should be investigated separately — even without a sensor, the load should degrade gracefully rather than hard-fail.

## Impact

- Office morning program has **never successfully auto-played** via DaylightStation's device load path
- The HA automation marks `office_program_played_today = on` regardless of DaylightStation's response, so it only attempts once per day — there is no retry
- The TV turns on to a blank screen every morning instead of showing the program content

## Related

- `docs/plans/2026-02-22-verified-tv-wake.md` — original verified wake implementation plan
- `automations/office_morning_program.yaml` — HA automation triggering this flow
- `rest_commands/office_apis.yaml` — REST command definition (`office_program`)
