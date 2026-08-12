# obd-relay — in-car vehicle telemetry → DaylightStation event bus

> **Status (2026-07-30): hardware in hand, bench bring-up done, transport
> proven end-to-end against deployed prod. No vehicle data yet.**
>
> Working and measured on the device: boot, co-processor link (`devType=14`),
> WiFi, WebSocket, trip buffering, ack-gated upload+delete, HTTP status/pull
> plane, OTA, engine-off standby.
>
> Sampling is now implemented: PIDs + GNSS + DTCs, all read on core 0 and
> handed to the loop task. GNSS starts (`gps_ready: true`).
>
> **BLOCKED:** `obd.init()` has never reached the ECU — `obd_ready: false`
> across 2 minutes with the ignition on. Until that links, `/pids` returns an
> all-false table and trips still upload as empty envelopes. Everything
> downstream (which PIDs this car answers, whether the odometer is reachable,
> what a diagnostics view can show) is gated on it. **This is the next thing to
> debug**, and it is a vehicle/protocol question, not a transport one.
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
| `GET /obd/probe?start=1` | **walk every OBD protocol, report which links** |
| `GET /pids` | **which PIDs this car actually answers** (bring-up step 1) |
| `GET /diagnostics` | check-engine codes + slow-moving vehicle state |
| `POST /update` | OTA firmware update |
| `GET /standby/inhibit?minutes=N` | hold standby off (bounded, max 30 min) |
| `GET /standby/release` | drop the inhibit |

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
after switch-off. It is not a way to reach a car parked for a week. On the bench
this bites immediately (USB rail reads ~5V, so the device decides "engine off"
and sleeps): hold it awake first, or just use USB.

```bash
curl "http://<device-ip>/standby/inhibit?minutes=10"   # then OTA
curl "http://<device-ip>/standby/release"
```

The inhibit is **bounded at 30 minutes and never persisted** — a forgotten
inhibit would silently reintroduce the exact drain standby exists to prevent.

## Debugging the ECU link (`obd_ready: false`)

**Target vehicle: 2021 Chrysler Pacifica Touring L (FCA Canada, 3.6 V6).**

The co-processor answers `ATRV` (that's where `battery_v` comes from), so the
OBD hardware path is alive — what fails is protocol negotiation. Rather than
guess-and-reflash, sweep every protocol in one visit to the car:

```bash
curl "http://<device-ip>/obd/probe?start=1"   # kick off (runs on core 0)
curl "http://<device-ip>/obd/probe"           # poll — takes a few minutes
```

Ignition must be in **RUN** (not accessory). The sweep auto-inhibits standby so
it can't be cut in half.

A protocol only counts as a winner if it **links AND answers a Mode 01 PID** —
`init()` can succeed while the ECU never actually replies, and `linked:true`
with `pid_answered:false` is the interesting failure, not a pass. On success the
link is left established on the winner and normal sampling resumes.

If **nothing** links while `ATRV` works, the leading suspects are:

1. **FCA Security Gateway (SGW).** 2018+ FCA/Stellantis vehicles put a gateway
   between the OBD-II port and the vehicle buses. Generic Mode 01 reads usually
   pass it, so this is a hypothesis to test, not a certainty.
2. **Ignition not fully in RUN** — some vehicles don't power the data pins in
   accessory.
3. Wiring/pin issue on the port itself.

Note the Pacifica has **direct TPMS** (real pressure sensors), but those values
are manufacturer-specific CAN traffic, not generic OBD-II PIDs. The library does
expose `sniff()` / `setHeaderFilter()` / `receiveData()`, so CAN sniffing is a
possible future route to TPMS and odometer — untested, and an SGW may filter
what reaches the port anyway.

## Diagnostics — what OBD-II can and cannot give you

`GET /pids` is the instrument: it reports, per PID, whether **this** car
answered. Run it with the ignition on before believing anything below.
`tried:false` means "not attempted yet" and is distinct from `supported:false`
— with no ECU link the whole table reads false, which is not the same claim as
"this car supports nothing", so the response says so explicitly.

| Want | Reality |
|---|---|
| Check-engine / DTCs | **Yes.** Standard Mode 03, reliable on any OBD-II car. Also distance & time with MIL on, warm-ups and distance since codes cleared. |
| Odometer | **Probably not.** `PID_ODOMETER` (0xA6) is in later J1979 revisions but rarely implemented; usually needs manufacturer-specific requests. Probed anyway — `/pids` will say. |
| Oil life / oil change | **No.** Not standard OBD-II; manufacturer-specific. Engine oil *temperature* (0x5C) is standard and is probed. |
| Tyre pressure (TPMS) | **No.** Not on generic OBD-II at all — separate module, manufacturer-specific. |

`/diagnostics` omits unsupported readings rather than reporting a fake `0`, and
lists them under `unsupported` so absence is visible rather than implied.

Backend dispatch: `backend/src/3_applications/hardware/automotiveRelay.mjs`
(wired in `app.mjs`), mirroring `foodScaleRelay.mjs`. Persists:

- snapshots/events → `household/history/automotive/<vehicle-id>/<YYYY-MM-DD>.yml`
- trips → `household/history/automotive/<vehicle-id>/trips/<YYYY-MM>/<YYYY-MM-DD>_<HHMM>_<trip-id>.yml`

Both are keyed by the **household-local day** (`system.yml` → `timezone`),
threaded in from `configService.getHouseholdTimezone()`. A UTC key filed every
evening drive under tomorrow and split any drive that crossed 00:00Z.

### History file format

The device's own trip id is `esp_random()-millis()` — collision-free but
unsortable — so it becomes a filename *suffix* under a month shard. Trips whose
clock is unrecoverable get an `unknown_` prefix and are dated by arrival, so
they sort together instead of interleaving with real timestamps.

Samples are keyed objects, one per line. **A reading that was never taken is an
absent key, never a sentinel** — the firmware emits `rpm`/`coolant_c` 0 for "no
ECU session", `fuel_pct` -1 for "no reading", and `lat`/`lon` 0 before GNSS
lock, all of which read as plausible data if persisted verbatim (`rpm: 0` looks
like idling; `(0,0)` plots in the Gulf of Guinea).

```yaml
meta:
  vehicle: family-car
  trip_id: 3d6d2738-4b0d          # device id, kept for trip-ack correlation
  started: '2026-07-31T17:20:47-07:00'
  ended: '2026-07-31T17:37:56-07:00'
  time_source: device             # device | rebased | boot-relative
  duration_s: 1029
  samples: 206
  distance_km: 7.45               # haversine over fixed samples
  max_speed_kph: 73
  gps_fix_pct: 69
  ecu: true                       # did the engine bus ever answer?
  dtc: []
  received: '2026-07-31T17:37:59-07:00'
units: {t: s, lat: deg, lon: deg, speed_kph: km/h, rpm: rpm, coolant_c: C, fuel_pct: '%', batt_v: V}
samples:
  - {t: 0, speed_kph: 0, rpm: 1509, coolant_c: 38, fuel_pct: 43, batt_v: 14.7}
  - {t: 6, speed_kph: 0, batt_v: 14.6}     # bus dropped out for this sample
```

- `t` is **seconds from trip start**, not the raw boot-relative ms. Sampling is
  irregular (1s and 5s gaps observed in the same trip), so `t` is carried per
  row rather than implied by position.
- `meta` carries a derived summary so a trip list or monthly rollup never parses
  the sample block.
- The bus drops in and out *within* a trip, so `ecu` is trip-level while each
  row is checked separately: rpm 0 **and** coolant 0 **and** fuel < 0 is a gap
  in the session, not an engine stalled at 0 °C. A genuine idle at a stoplight
  still reports warm coolant and a fuel level, so it keeps its fields.
- `persistence.min_trip_samples` suppresses ignition-blip trips. They are still
  `trip-ack`'d (or the device re-uploads them forever) and leave a
  `trip-dropped` breadcrumb in the day log.

Migrating history written before this format:

```bash
node cli/automotive.cli.mjs migrate            # dry run, prints the plan
node cli/automotive.cli.mjs migrate --apply
```

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

Unit tests: `tests/unit/suite/applications/hardware/automotiveRelay.test.mjs`
(relay + file format) and `cli/automotive.cli.test.mjs` (history migration).

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
