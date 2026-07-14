# obd-relay — in-car vehicle telemetry → `history/automotive` (design)

**Date:** 2026-07-14
**Status:** validated design; scaffold committed, **hardware ordered, not arrived**
(Freematics ONE+ Model B). Same pre-hardware posture as scantron-relay.

## Goal

Periodically phone home car stats and diagnostics to
`{dataDir}/household/history/automotive/`. One device, in the car, no garage
relay box, no FIXD dependency.

## Decisions made (brainstorm 2026-07-14)

| Question | Decision | Why |
|----------|----------|-----|
| FIXD sensor as data source? | **Dropped.** | Proprietary BLE, likely app-layer auth; same transport wall that stalled barcode-relay's SSI attempt. |
| Garage-fixed ATOM + ELM327 dongle? | **Dropped.** | Two devices; no driving data ever; arrival-window race for ignition-on PIDs. |
| In-car hardware | **Freematics ONE+ Model B** (ordered) | Programmable ESP32 *inside* an OBD-II plug: WiFi + BLE, integrated u-blox GNSS + antenna (10Hz), 4G LTE (unused v1 — needs SIM), motion sensor, microSD, battery-voltage read, 16MB flash / 8MB PSRAM. Reference "telelogger" sketch already does log-then-transmit. |
| Phone-home transport | **WS to the backend event bus (`/ws`)**, JSON with `source: "obd-relay"` | Identical to food-scale-relay / barcode-relay; the backend sees just another ESP32 device client. Freematics' own Hub/UDP protocol not used. |
| Backend layer | `3_applications/hardware/automotiveRelay.mjs` | Inbound device streams are application services on the event bus (foodScaleRelay pattern), NOT `1_adapters/` — no foreign protocol to adapt since we own the firmware. |
| GPS in payload | **Yes** — built into Model B; lat/lon/alt/speed alongside PID samples. | Was the deciding factor for Model B over Model A / WiCAN Pro. |
| LTE | Out of scope v1 (hardware keeps the option open). | Needs SIM + plan; WiFi-at-home covers the use case. |

## Behavior model

The device is powered by the OBD port (always-hot on most cars) but follows the
telelogger's standby discipline: **active while the engine runs, low-power
standby (~10mA, motion/voltage wake) while parked.** That spec comes from the
Freematics docs — verify actual draw on arrival before trusting it for
multi-week airport parking.

Per ignition-on session:

1. Boot, connect to vehicle ECU, open a new **trip file** on flash/microSD.
2. Sample at ~1Hz: GNSS fix + OBD PIDs (speed, RPM, coolant, engine load,
   fuel level, battery/charging voltage, throttle) + DTCs once per trip.
3. In parallel, try home WiFi. Association succeeds ⇒ car is at home:
   - NTP-sync the clock,
   - emit an `event` (`arrival` on power-up-at-home… see note below),
   - upload every buffered trip file, then delete on backend ack,
   - stream live `snapshot` messages while powered.
4. Power cut mid-write is normal (ignition off). Trip files are
   append-with-periodic-flush; an unfooted file is finalized on next boot as
   "ended at last sample".

**Timestamps:** trips starting at home get real time (NTP during warm-up).
Trips starting away are stamped relative to boot millis; the backend
reconstructs wall time at upload (same power session ⇒ exact; older buffered
trips ⇒ marked `time_approx: true`).

**Arrival vs departure:** a power-up that joins home WiFi = departure-imminent
(warm-up in garage); a WiFi association appearing mid-trip = arrival. The
firmware just reports `event: wifi-joined` with trip state; the backend derives
arrival/departure semantics.

## Message shapes (device → bus)

```json
{"source":"obd-relay","type":"hello","id":"<vehicle-id>","fw":"0.1.0","rssi":-52,"ts":1720000000000}
{"source":"obd-relay","type":"snapshot","id":"<vehicle-id>","battery_v":14.2,"fuel_pct":63,"coolant_c":88,"rpm":840,"speed_kph":0,"dtc":["P0301"],"gps":{"lat":0,"lon":0,"alt":0,"sats":9},"ts":...}
{"source":"obd-relay","type":"trip","id":"<vehicle-id>","trip_id":"<boot-epoch-or-seq>","seq":0,"final":true,"time_approx":false,"meta":{"started":...,"ended":...,"samples":840,"distance_km":12.4,"max_speed_kph":72,"dtc":[]},"samples":[[t,lat,lon,speed,rpm,coolant,fuel,batt],...]}
{"source":"obd-relay","type":"event","id":"<vehicle-id>","event":"wifi-joined"|"trip-start"|"trip-end","ts":...}
```

- `trip` payloads may be **chunked** (`seq` increments, `final` on last chunk)
  to keep WS frames small; the backend reassembles by `(id, trip_id)`.
- `samples` is a compact positional array (schema fixed in `samples_schema` of
  the meta) rather than per-sample objects — 1Hz × 30min × objects is needless
  bloat in YAML and on the wire.

## Backend

`backend/src/3_applications/hardware/automotiveRelay.mjs`, wired in `app.mjs`
next to `createFoodScaleRelay` (config app name: **`vehicles`** →
`data/household/config/vehicles.yml`).

1. **INGEST:** `eventBus.onClientMessage` filtered on `source === "obd-relay"`;
   rebroadcast on topic `automotive` (per-vehicle override in config).
2. **PERSIST** (decoupled subscriber, serialized write chain like foodScale):
   - `snapshot` / `event` → append to
     `household/history/automotive/<vehicle-id>/<YYYY-MM-DD>.yml`
     (throttled: snapshots at most every `persistence.snapshot_min_s`).
   - `trip` (reassembled) → write
     `household/history/automotive/<vehicle-id>/trips/<trip-id>.yml`, then send
     `{"type":"trip-ack","trip_id":...}` back to the device client so it can
     delete its buffered copy.

## Config — `data/household/config/vehicles.yml`

Registry keyed by vehicle id (see `_extensions/obd-relay/config.example.yml`):
provisioning WiFi creds, backend host/port, per-vehicle sampling rates, topic,
persistence root. `gen-config.mjs` renders `firmware/include/config.h`
(gitignored) — nothing hardcoded, same SSOT discipline as scales.yml.

## Firmware

`_extensions/obd-relay/firmware/` — PlatformIO. Two build-time layers:

- **Transport layer (buildable today):** WiFi + WS client + JSON + trip buffer
  on LittleFS — compiles and runs on any ESP32 for bench testing.
- **Vehicle layer (needs hardware):** FreematicsPlus library (OBD co-processor
  UART, GNSS, motion sensor) — vendored by `tools/fetch-libs.mjs` from
  `stanleyhuangyc/Freematics` (`libraries/FreematicsPlus`), enabled with
  `-DUSE_FREEMATICS`. Board/partition values in `platformio.ini` are marked
  VERIFY-ON-ARRIVAL against the vendor's `firmware_v5` project settings.

Per `feedback_dont_assert_unverified_device_facts`: PID availability (odometer,
fuel level), standby current, and GNSS cold-fix time are **inferred from vendor
docs, not measured** — confirm during bring-up before documenting as fact.

## Bring-up checklist (day the hardware arrives)

0. Bench-power via microUSB, `pio device monitor` — confirm boot, flash layout,
   FreematicsPlus compiles against the real board (fix `platformio.ini` VERIFYs).
1. `tools/fetch-libs.mjs` → build with `-DUSE_FREEMATICS` → plug into car:
   confirm ECU link, dump supported PIDs, note which of
   speed/rpm/coolant/fuel/odometer respond. Document in README.
2. GNSS: time-to-first-fix in the driveway; antenna orientation under the dash.
3. WiFi RSSI from the OBD port in the garage parking spot (body metal matters).
4. Trip cycle test: short drive, ignition off, restart at home → buffered trip
   uploads, `trip-ack` deletes it, YAML lands in history/automotive.
5. Standby draw measurement over 48h parked (multimeter or battery monitor)
   before trusting it long-term.
6. Verify simulator payloads (tools/simulate-device.mjs) match real firmware
   output; fix the simulator, not the backend.

## Testing before hardware

- `tests/unit/suite/applications/hardware/automotiveRelay.test.mjs` — ingest,
  rebroadcast, chunk reassembly, trip persist + ack, snapshot throttle.
- `_extensions/obd-relay/tools/simulate-device.mjs` — real WS client that
  replays a canned trip against a running dev backend end-to-end.
