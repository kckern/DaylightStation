# obd-relay — in-car vehicle telemetry → DaylightStation event bus

> **Status: scaffold — hardware ordered, not arrived.** Target device is a
> **Freematics ONE+ Model B** (ESP32 + GNSS + 4G + OBD co-processor in an
> OBD-II plug). The transport layer (WiFi + WS + trip buffering) is real code;
> everything touching the vehicle (OBD PIDs, GNSS, standby current) is stubbed
> behind `-DUSE_FREEMATICS` and marked VERIFY-ON-ARRIVAL. Per
> `feedback_dont_assert_unverified_device_facts`, no vehicle facts get
> documented here until measured on the car.

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
- **Parked**: telelogger-style low-power standby (motion/voltage wake).
  Standby draw is a **VERIFY-ON-ARRIVAL** number — measure before trusting it
  for weeks-long parking.

## Messages sent to the bus

```json
{"source":"obd-relay","type":"hello","id":"family-car","fw":"0.1.0","ts":123}
{"source":"obd-relay","type":"snapshot","id":"family-car","battery_v":14.2,"fuel_pct":63,"coolant_c":88,"rpm":840,"speed_kph":0,"dtc":[],"gps":{"lat":0,"lon":0,"sats":9},"ts":123}
{"source":"obd-relay","type":"trip","id":"family-car","trip_id":"7f3a","seq":0,"final":true,"meta":{"started":123,"ended":456,"samples":840},"samples":[[t,lat,lon,speed,rpm,coolant,fuel,batt]]}
{"source":"obd-relay","type":"event","id":"family-car","event":"wifi-joined","ts":123}
```

Trips may be chunked (`seq`/`final`); the backend reassembles by
`(id, trip_id)` and replies `{"type":"trip-ack","trip_id":...}`.

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

0. **Bench boot** (microUSB, no car): `pio device monitor` — confirm boot,
   flash size/partitions, then `fetch-libs` + `-DUSE_FREEMATICS` compiles
   against the real board. Fix the VERIFY-ON-ARRIVAL notes in `platformio.ini`
   against the vendor's `firmware_v5` settings.
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
