# Pressure Mat Relay

DaylightStation firmware for the Applied Sensor Co. **TrampleTek Blue** pressure
mat. The unit is a WEMOS LOLIN C3 Mini (ESP32-C3, 4 MB flash) with the textile
pressure divider connected to ADC GPIO0.

## What the sensor measures

The mat is a resistive analog pressure surface. Pressure lowers its voltage. It
provides much more than a dry-contact on/off switch, but it is **not a calibrated
scale**:

- `voltage`: smoothed ADC voltage
- `delta_v`: drop from the pre-press voltage
- `gradient_vps`: speed and direction of the pressure change
- `occupied`: derived, hysteretic on/off state
- `steps`: press-transition count since boot
- `stomps`: high-impact step count since boot (heuristic, separately tunable)

ASC documents substantial unit-to-unit variation and a nonlinear response. The
mat is most sensitive below roughly 20 lb and can struggle to distinguish high
loads. Do not label `delta_v` as pounds without collecting a per-mat calibration
curve; even then, treat the result as an estimate.

## Wire protocol

The relay connects to the DaylightStation `/ws` event bus and emits:

```json
{"source":"pressure-mat-relay","protocol_version":2,"type":"presence","event":"pressed","id":"garage-step-mat","voltage":2.31,"rest_voltage":2.73,"delta_v":0.42,"gradient_vps":-1.8,"occupied":true,"steps":1,"ts":1234}
{"source":"pressure-mat-relay","protocol_version":2,"type":"presence","event":"stomped","id":"garage-step-mat","voltage":1.82,"rest_voltage":2.73,"delta_v":0.90,"gradient_vps":-2.1,"occupied":true,"steps":1,"stomps":1,"ts":1284}
{"source":"pressure-mat-relay","protocol_version":2,"type":"presence","event":"released","id":"garage-step-mat","voltage":2.68,"rest_voltage":2.73,"delta_v":0,"gradient_vps":0.8,"occupied":false,"steps":1,"stomps":1,"peak_delta_v":0.94,"peak_gradient_vps":2.4,"press_duration_ms":810,"classified_stomp":true,"ts":2044}
{"source":"pressure-mat-relay","protocol_version":2,"type":"reading","id":"garage-step-mat","voltage":2.31,"rest_voltage":2.73,"delta_v":0.42,"gradient_vps":0.0,"occupied":true,"steps":1,"ts":2234}
{"source":"pressure-mat-relay","protocol_version":2,"type":"hello","id":"garage-step-mat","uptime_s":60,"boot_count":2,"last_reset":"POWERON"}
```

The backend re-broadcasts all three on the configured `pressure-mat` topic.

## Detection

Every 50 ms the firmware averages 100 GPIO0 ADC readings, then smooths seven
frames. A sufficiently fast voltage drop arms a press threshold; crossing the
threshold latches occupancy. A rising voltage and a smaller recovery threshold
release it. Defaults match ASC's published approximately-one-pound preset:
`0.12 V` pressure change and `0.08 V/s` gradient.

A press is counted once as a step. If that same press also crosses the default
`0.48 V` and `0.20 V/s` impact thresholds, it increments `stomps` and emits
`stomped`; it does not become a second step. Those are classification
thresholds, not force or weight measurements, and should be tuned in place.

Protocol v2 accumulates the whole occupied interval and adds one authoritative
summary to `released`: `peak_delta_v`, positive-magnitude
`peak_gradient_vps`, `press_duration_ms`, and `classified_stomp`. These are the
fields to use for distributions. The instantaneous values on `pressed` and
`stomped` describe threshold-crossing frames and are not substitutes for the
per-press maxima.

This gradient gate matters: the textile drifts and recovers slowly, so treating
one fixed voltage as a switch produces false events.

## Build and flash

Create the private SSOT from `config.example.yml`, then:

```bash
cd _extensions/pressure-mat-relay/firmware
node tools/flash.mjs \
  "$DAYLIGHT_BASE_PATH/data/household/hardware/pressure-mats/config.yml" \
  garage-step-mat \
  --port /dev/cu.usbmodem11201
```

Generated `include/config.h` is gitignored. The flash tool deliberately uses
115200 because this physical unit dropped long reads after switching its native
USB CDC link to higher baud rates.

### OTA updates

The house ESP OTA pattern is supported through password-gated ArduinoOTA. Add a
private per-mat block to `config.yml` before the bootstrap flash:

```yaml
ota:
  enabled: true
  password: "<long private password>"
```

Or generate and store a private per-mat credential without printing it:

```bash
node tools/enable-ota.mjs \
  "$DAYLIGHT_BASE_PATH/data/household/hardware/pressure-mats/config.yml" \
  garage-step-mat
```

Then subsequent updates do not require USB:

```bash
cd _extensions/pressure-mat-relay/firmware
node tools/ota.mjs \
  "$DAYLIGHT_BASE_PATH/data/household/hardware/pressure-mats/config.yml" \
  garage-step-mat \
  --via garage
```

Rotate the private OTA credential without returning to USB:

```bash
node tools/ota.mjs \
  "$DAYLIGHT_BASE_PATH/data/household/hardware/pressure-mats/config.yml" \
  garage-step-mat --via garage --rotate-credential
```

The rotation uses the current credential to authenticate an image containing a
new credential. If build or delivery fails, the private config is rolled back.

`--via garage` builds on the development machine but originates the espota
exchange from the garage kiosk on the mat's LAN. `ota.mjs` reads the password
from private config and sends it to a non-debug uploader over stdin rather than
putting it in the invoking shell command, process argv, or uploader logs. It
also sanitizes subprocess failures so Node cannot echo the secret.
OTA is compile-time disabled unless both `enabled: true` and a password are
present. During a transfer the firmware quiesces WebSocket and HTTP work, feeds
the watchdog per received chunk, and reboots into the previous image after an
OTA error. The existing `default.csv` has two 1.25 MiB application slots; this
image fits. The currently deployed protocol-v1 image has no ArduinoOTA listener,
so enabling OTA still requires exactly one USB bootstrap flash.

## Operations

The board advertises `http://<mat-id>.local/` when mDNS is available.

| Endpoint | Effect |
|---|---|
| `GET /status` | Wi-Fi, WebSocket, voltage, state, counts, thresholds |
| `POST /recalibrate` | Clear state and refill the smoothing window unloaded |
| `POST /threshold?delta=0.12&gradient=0.08` | Persist detection tuning in NVS |
| `GET /reboot` | Restart the board |

Backend maintenance commands use the mat's subscribed
`pressure-mat-control:<id>` WebSocket topic, so normal administration does not
depend on mDNS or a fixed IP. The HTTP endpoints remain available for direct
bring-up and recovery.

The backend also appends transition events to history under
`household/history/pressure-mats/<mat-id>/<YYYY-MM-DD>.yml` (append-only) by
default:

- `event`: `pressed`, `stomped`, or `released`
- `ts`: local timestamp
- `occupied`, `steps`, `stomps`
- `voltage`, `delta_v`, `gradient_vps`
- `device_ts` (mat uptime-derived milliseconds)

Protocol-v2 `released` rows additionally retain `rest_voltage`,
`peak_delta_v`, `peak_gradient_vps`, `press_duration_ms`,
`classified_stomp`, and `metrics_source`. While a v1 board is still deployed,
the backend derives the best available values from transition frames and marks
them `metrics_source: transition_fallback`; after the board is flashed, exact
whole-press maxima are marked `firmware_summary`.

Each completed press also emits one backend structured event,
`pressure_mat.press.completed`, containing the same analysis fields. This is
the canonical VictoriaLogs event: unlike `fitness.pressure-mat`, it is emitted
once by the backend and is not duplicated for every open browser client.

The directory can be overridden with `persistence.dir` in the pressure-mat
`config.yml` (same shape as `scales.yml` and `omr-readers.yml` persistence
blocks).

The Daylight backend mounts an administrator-only management API at
`/api/v1/pressure-mats`:

| Endpoint | Effect |
|---|---|
| `GET /` | List configured mats and their latest WebSocket snapshots |
| `GET /:id` | Read one cached mat snapshot |
| `GET /:id/device` | Read the ESP's live `/status` response |
| `POST /:id/recalibrate` | Re-zero the unloaded mat |
| `POST /:id/threshold` | Tune step and optional stomp thresholds |
| `POST /:id/reboot` | Restart the ESP |

Fitness clients subscribe to the `pressure-mat` WebSocket topic. Each physical
press produces `pressure-mat:step` in `FitnessContext`; high-impact presses also
produce `pressure-mat:stomp` without incrementing the step count twice. The
current totals are available as `pressureMatState[matId].steps` and `.stomps`.

During an active Fitness session, the configured equipment tracker reconciles
those device counters into session totals, rolling steps/minute, and per-user
totals based on the touchscreen assignment at each rep. The realtime step-mat
card appears after the first session step and remains present (dormant or sensor
unavailable) until the session ends. The workout timeline samples totals and SPM
every five seconds; it does not duplicate the raw transition stream already
stored here. Typed `activity_rate` governance and `step` challenges are documented
in [the governance engine reference](../../docs/reference/fitness/governance-engine.md#step-mat-lifecycle).

The original pre-Daylight app partition was backed up before flashing to
`/tmp/daylight-step-esp32c3-original-app0.bin` with SHA-256
`38157130d1c2ec6b6d4c530104add85520f77d060e31d55faf53020dd38afeb9`.

## References

- [ASC TrampleTek Blue UI and pressure-voltage documentation](https://docs.asc.com/usingHAui.html)
- [ASC published ESPHome configuration and detection algorithm](https://github.com/AppliedSensorCo/ASC-product-code/blob/main/TrampleTekBlue/TrampleTek_WebUSB_ESPHome.yaml)
- [WEMOS LOLIN C3 Mini hardware documentation](https://www.wemos.cc/en/latest/c3/c3_mini.html)
