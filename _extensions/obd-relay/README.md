# obd-relay — in-car vehicle telemetry → DaylightStation event bus

> **Status (2026-07-30): hardware in hand, bench bring-up done, transport
> proven end-to-end against deployed prod. No vehicle data yet.**
>
> Working and measured on the device: boot, co-processor link (`devType=14`),
> WiFi, WebSocket, trip buffering, ack-gated upload+delete, HTTP status/pull
> plane, OTA, engine-off standby.
>
> **NOT working:** `readSample()` is still a stub under `-DUSE_FREEMATICS`, so
> trips upload as empty envelopes — no PIDs, no GNSS. And `obd.init()` did not
> link to the ECU across 2 minutes with the ignition on (`obd_ready: false`);
> unexplained, and it blocks bring-up step 1.
>
> Per `feedback_dont_assert_unverified_device_facts`, nothing about the vehicle
> or standby current is documented here as fact until measured on the car.

A **Freematics ONE+ Model B** rides in the car's OBD-II port, logs trips
(GNSS + OBD PIDs at ~1Hz) to onboard flash while driving, and **phones home
over WebSocket** to the DaylightStation backend event bus (`/ws`) whenever the
car is on home WiFi. The backend re-broadcasts the `automotive` topic and
persists trips + snapshots to `household/history/automotive/`.

Same family as [`food-scale-relay`](../food-scale-relay/) /
[`barcode-relay`](../barcode-relay/) / [`scantron-relay`](../scantron-relay/):
**firmware only**, no host daemon, config-driven from the household SSOT
(`data/household/config/vehicles.yml`). Nothing hardcoded. Unlike those, the
ESP32 is *inside* the sensor device — no separate relay MCU, no BLE hop.

```
vehicle ECU ──OBD co-processor──▶ Freematics ONE+ (ESP32, in the car)
GNSS satellites ──u-blox M9────▶   │ trips → onboard flash (LittleFS)
                                   │ on home WiFi:
                                   └──WS /ws──▶ backend event bus
                                                  │ broadcast('automotive')
                                                  ├─▶ apps (live)
                                                  └─▶ history/automotive/<vehicle-id>/
```

Design: `docs/_wip/plans/2026-07-14-obd-relay-design.md` (decisions, message
shapes, behavior model).

## Why this hardware (and not…)

- **FIXD sensor** (was in the port): proprietary BLE, likely app-layer auth —
  the barcode-relay transport wall again. Dropped unopened.
- **Garage-fixed ATOM + ELM327 dongle**: never sees the car move; two devices.
- **Freematics ONE+ Model B**: programmable ESP32 in the plug, WiFi + BLE,
  integrated 10Hz GNSS + antenna, motion sensor, microSD, 16MB flash/8MB PSRAM,
  optional 4G LTE (unused v1). Vendor's `telelogger` reference sketch already
  does log-then-transmit; we replace its Freematics-Hub protocol with our WS
  event-bus JSON.

## Behavior

- **Ignition on → device powered** (OBD port): open a trip file, sample ~1Hz
  (GNSS + speed/rpm/coolant/fuel/battery volts), read DTCs once per trip.
- **Home WiFi visible** (garage): NTP sync, upload buffered trips, stream live
  snapshots. Backend acks each trip (`trip-ack`) → device deletes its copy.
- **Ignition off = power cut mid-write, by design**: append + periodic flush;
  next boot finalizes any unfooted trip file.
- **Parked → standby.** The OBD-II port is always-hot, so without this the
  device runs flat out on the car battery and will eventually leave you with a
  car that won't start.

### Standby (battery protection)

Engine state comes from OBD-port voltage (`ATRV` via the co-processor) — **no
ECU link required**, so it works with the ignition off.

| Constant | Default | Meaning |
|---|---|---|
| `STANDBY_ENGINE_OFF_V` | 13.0 V | below this = not charging = engine off |
| `STANDBY_CONFIRM_S` | 120 s | sustained low volts before believing it |
| `STANDBY_UPLOAD_WINDOW_S` | 60 s | bounded drain window before sleeping |
| `STANDBY_CHECK_S` | 60 s | deep-sleep interval between voltage checks |
| `STANDBY_VOLT_FAULT_S` | 600 s | no readable voltage this long → sleep anyway |

Flow: sustained low voltage → close trip → bounded upload window → radio off,
co-processor to `ATLP`, ESP32 deep sleep → timer wake → **if still off, back to
sleep without ever powering the radio**.

Two deliberate choices worth knowing:

- **`getVoltage() == 0` means "no answer", not "zero volts"**, and is *not*
  treated as engine-off — a comms fault must not sleep the device mid-drive.
  `STANDBY_VOLT_FAULT_S` is the failsafe for the opposite risk: without it, a
  co-processor that stops answering would keep the device awake indefinitely,
  which is the exact drain standby exists to prevent.
- **The confirm delay is what keeps cranking from looking like switch-off** —
  the starter pulls the bus down hard, and the device does brown out and reboot
  on crank (observed).

Measured on the bench: fast-path wake stays up ~2.0 s per ~63.6 s cycle
(**~3.2 % duty**, radio off). **Actual standby current is still unmeasured** —
duty cycle is not milliamps, and the vendor's ~10 mA figure is theirs, not ours.
Checklist step 5 (48 h parked with a meter) still stands. Thresholds also need
calibration against the real car: resting and charging voltage vary by battery,
alternator and temperature.

**Tradeoff:** at a 60 s check interval, up to ~60 s at the start of a drive goes
unlogged. A MEMS motion interrupt would remove this and is the proper follow-up.

## Messages sent to the bus

```json
{"source":"obd-relay","type":"hello","id":"family-car","fw":"0.1.0","ts":123}
{"source":"obd-relay","type":"snapshot","id":"family-car","battery_v":14.2,"fuel_pct":63,"coolant_c":88,"rpm":840,"speed_kph":0,"dtc":[],"gps":{"lat":0,"lon":0,"sats":9},"ts":123}
{"source":"obd-relay","type":"trip","id":"family-car","trip_id":"7f3a","seq":0,"final":true,"meta":{"started":123,"ended":456,"samples":840},"samples":[[t,lat,lon,speed,rpm,coolant,fuel,batt]]}
{"source":"obd-relay","type":"event","id":"family-car","event":"wifi-joined","ts":123}
```

Trips may be chunked (`seq`/`final`); the backend reassembles by
`(id, trip_id)` and replies `{"type":"trip-ack","trip_id":...}`.

## HTTP plane (device serves :80)

The push path only fires when the car is home AND the bus is up AND the backend
acks. These endpoints are the pull counterpart — the only practical way to
interrogate a device sitting in a car in the garage.

| Endpoint | Purpose |
|---|---|
| `GET /` `GET /status` | health, wifi (incl. `associate_ms`, bssid, channel), ws counters, battery/standby, trip state, ring-buffered recent logs |
| `GET /trips` | manifest of buffered payloads |
| `GET /trip?id=<id>` | one payload, **same shape the push path sends**, streamed |
| `POST /update` | OTA firmware update |

```bash
curl http://<device-ip>/status
curl http://<device-ip>/trips
curl "http://<device-ip>/trip?id=<trip_id>"
curl -F "firmware=@.pio/build/freematics-oneplus-b/firmware.bin" \
     http://<device-ip>/update
```

Pulling **never deletes** — only a backend `trip-ack` frees a buffer, so a curl
can't cost you a trip. Trip ids are validated as hex+dash before touching the
filesystem (they become a path).

**OTA limitation:** the device is deep-asleep most of the time when parked, so
an update only lands while it's awake — engine running, or the ~3 min window
after switch-off. It is not a way to reach a car parked for a week.

Backend dispatch: `backend/src/3_applications/hardware/automotiveRelay.mjs`
(wired in `app.mjs`), mirroring `foodScaleRelay.mjs`. Persists:

- snapshots/events → `household/history/automotive/<vehicle-id>/<YYYY-MM-DD>.yml`
- trips → `household/history/automotive/<vehicle-id>/trips/<trip-id>.yml`

## Build & flash

Prereqs: PlatformIO (`pio`), Node. The Freematics flashes over its microUSB.

```bash
cd firmware
node tools/fetch-libs.mjs          # vendor FreematicsPlus into firmware/lib/ (gitignored)

# one shot: gen config from SSOT, build, upload (autodetects port)
node tools/flash.mjs "$DAYLIGHT_BASE_PATH/data/household/config/vehicles.yml" family-car

# or step by step
node tools/gen-config.mjs "$DAYLIGHT_BASE_PATH/data/household/config/vehicles.yml" family-car
pio run -e freematics-oneplus-b -t upload
pio device monitor -b 115200       # watch [obd]/[gps]/[wifi]/[ws] logs
```

Until the hardware arrives, the `bench-esp32` env builds the transport layer
(no FreematicsPlus) for any dev ESP32 board.

## Test the pipeline without hardware

```bash
# against a running dev backend — replays a canned trip over WS
node tools/simulate-device.mjs --host localhost --port 3112 --id family-car
```

Unit tests: `tests/unit/suite/applications/hardware/automotiveRelay.test.mjs`.

## Bring-up checklist (day the hardware arrives)

The risk is concentrated in step 1 — *which PIDs this specific car answers* —
everything else is a solved pattern. Work top to bottom; update this README
with measured facts as you go.

0. ~~**Bench boot**~~ **DONE 2026-07-30.** Measured: ESP32-D0WDQ6 rev v1.1,
   40 MHz crystal, Winbond W25Q128 = **16 MB flash**. PSRAM left OFF (matches
   vendor; chip has none in-package, external presence unverified).
   - **Boot-loop trap, cost hours — read this before touching the flash config:**
     PlatformIO writes the esptool image header from `board_upload.flash_size`,
     **not** `board_build.flash_size`. With only the build key set, the
     bootloader believed it had 4 MB, couldn't reach partitions past that
     boundary, and reset in a tight loop (`rst:0x3` SW_RESET, *no* application
     output). Both keys are now set in `platformio.ini`.
   - The LittleFS data partition **must be labelled `spiffs`** — Arduino's
     `LittleFS.begin()` defaults to that label and silently fails to mount
     otherwise.
   - USB enumerates as a CH340 (`/dev/cu.wchusbserial*`). A charge-only
     micro-USB cable shows power (LED changes) but produces **zero** USB bus
     events — check the cable before debugging anything else.
   - `obd.init()` blocks ~5 s and must never run on the Arduino loop task; it
     starved `webSocket.loop()` so the WS client failed every attempt. It now
     runs on `obdLinkTask`, pinned to core 0.
1. **Plug into car, dump supported PIDs.** Record which of speed / rpm /
   coolant / fuel level / odometer / control-module-voltage actually respond.
   Document the working set here (measured, not inferred).
2. **GNSS**: time-to-first-fix under the dash; reposition if starved.
3. **WiFi from the garage parking spot**: RSSI at the OBD port location (the
   port sits low, wrapped in car body metal — measure, don't assume).
4. **Full trip cycle**: short drive → ignition off → restart at home →
   buffered trip uploads, `trip-ack` deletes it, YAML appears in
   `history/automotive/`.
5. **Standby draw over 48h parked** before trusting long-term parking.
6. **Reconcile the simulator** (`tools/simulate-device.mjs`) with real firmware
   output — fix the simulator, not the backend.

## Config — `data/household/config/vehicles.yml`

Keyed by vehicle id (plural — a second car is another key + another device).
Holds WiFi creds, backend host/port, per-vehicle sampling/emit rates, topic,
persistence root. Schema/example: [`config.example.yml`](config.example.yml).
The generated `firmware/include/config.h` is gitignored.
