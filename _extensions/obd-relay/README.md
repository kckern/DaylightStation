# obd-relay — in-car vehicle telemetry → DaylightStation event bus

> **Status (2026-08-24): transport is active in the vehicle and trip history is
> arriving. Firmware 0.3.0 hardens intermittent ECU links, parked wakes,
> timestamps, and odometer decoding; on-car acceptance is still required.**
>
> Working and measured on the device: boot, co-processor link (`devType=14`),
> WiFi, WebSocket, trip buffering, ack-gated upload+delete, HTTP status/pull
> plane, OTA, engine-off standby.
>
> Sampling is now implemented: PIDs + GNSS + DTCs, all read on core 0 and
> handed to the loop task. GNSS starts (`gps_ready: true`).
>
> Measured from persisted history through 2026-08-23: battery voltage is
> effectively continuous and GPS/speed are common, while RPM/coolant/fuel are
> intermittent. PID A6 answers, with its raw tenths-of-km scale corrected in
> schema 2. PID 0x31 saturates at 65,535 on this car and is treated as absent.
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
| `STANDBY_WAKE_SLEEP_V` | 13.2 V | fast-sleep only if max grace voltage stays at/below this |
| `STANDBY_WAKE_GRACE_S` | 8 s | observe voltage + motion, then try one ECU link |
| `STANDBY_CONFIRM_S` | 120 s | sustained low volts before believing it |
| `STANDBY_UPLOAD_WINDOW_S` | 60 s | bounded drain window before sleeping |
| `STANDBY_CHECK_S` | 60 s | deep-sleep interval between voltage checks |
| `STANDBY_VOLT_FAULT_S` | 600 s | no readable voltage this long → sleep anyway |

Flow: sustained low voltage → close trip → bounded upload window → radio off,
co-processor to `ATLP`, ESP32 deep sleep → timer wake → **if still off, back to
sleep without ever powering the radio**. A wake stays up when any of three
signals votes for a drive: charging voltage, motion, or an ECU response.

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
unlogged. **This still stands.** A MEMS motion interrupt would remove it, but the
sensor's INT line is not routed to any GPIO named in the board pin map — see
[Motion sensor](#motion-sensor--what-it-does-and-the-wake-it-cannot-do). The
motion *vote* added 2026-08-12 narrows the window without closing it.

## Messages sent to the bus

```json
{"source":"obd-relay","type":"hello","id":"family-car","fw":"0.1.0","ts":123}
{"source":"obd-relay","type":"snapshot","id":"family-car","battery_v":14.2,"fuel_pct":63,"coolant_c":88,"rpm":840,"speed_kph":0,"dtc":[],"gps":{"lat":0,"lon":0,"sats":9},"distance_since_cleared_km":4120,"odometer_km":-1,"diag":{"ambient_temp":22,"engine_oil_temp":95,"time_since_cleared":4300},"vin":"...","ts":123}
{"source":"obd-relay","type":"trip","id":"family-car","trip_id":"7f3a","seq":0,"final":true,"meta":{"started":123,"ended":456,"samples":840,"distance_start_km":4100,"distance_end_km":4120},"samples":[[t,lat,lon,speed,rpm,coolant,fuel,batt,alt,heading,hdop,sat]]}
{"source":"obd-relay","type":"event","id":"family-car","event":"wifi-joined","ts":123}
{"source":"obd-relay","type":"event","id":"family-car","event":"harsh-motion","g":0.42,"acc":[0.1,-0.4,0.9],"speed_kph":48,"ts":123}
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
| Odometer | **Probably not directly.** `PID_ODOMETER` (0xA6) is in later J1979 revisions but rarely implemented. But see [Mileage](#mileage-via-pid-0x31) — 0x31 gets there another way. |
| Oil life / oil change | **No.** Not standard OBD-II; manufacturer-specific. Engine oil *temperature* (0x5C) is standard and is probed. |
| Tyre pressure (TPMS) | **No.** Not on generic OBD-II at all — separate module, manufacturer-specific. |

`/diagnostics` omits unsupported readings rather than reporting a fake `0`, and
lists them under `unsupported` so absence is visible rather than implied.

### Trip clocks and the `unknown_` prefix (fixed in firmware, unverified)

A trip filed as `unknown_<date>_<time>_<id>.yml` with `time_source:
boot-relative` had no recoverable wall clock and is dated by **arrival**, not by
when it happened.

**Measured 2026-08-12: every real drive was `unknown_`, and the only two trips
with proper timestamps were the car moving 0.012 km and 0.033 km in the garage.**
That inversion is the tell.

Cause: `epochMs()` returned 0 unless `timeSynced`, a flag documented as "NTP
succeeded **this power session**" — a plain `static`, so it resets on every
boot. The device deep-sleeps while parked and re-runs `setup()` on each wake, so
starting the engine always produced `timeSynced == false`, and `tripOpen()`
stamped `started_epoch_ms = 0`. Driving away from home means NTP never runs, so
the whole drive stayed clockless. Meanwhile the ESP32's RTC had been running the
entire time, still holding a good epoch — the firmware simply refused to read it.

The boot-relative rebase can't rescue these either: it needs `upload_boot_ms >=
ended_boot_ms`, and a trip that outlives its boot has nothing left to rebase
against (`millis()` reset). That is why backlogged trips uploaded in one burst
are all clockless.

Fix: `rtcClockValid` in `RTC_DATA_ATTR` (survives deep sleep) plus a
plausibility floor, so a clock carried across sleep counts as knowing the time.
`epochMs()` still returns 0 for a genuinely unknown clock — the caller contract
is unchanged.

**Caveats.** RTC drift across a long park is **unmeasured**; if the board lacks a
32.768 kHz crystal the internal RC oscillator can drift noticeably over hours.
It re-syncs by NTP on every arrival home. And **existing `unknown_` files are not
retroactively fixable** — the wall time was never captured, so arrival remains
the only honest date for them.

### Signals added 2026-08-12 (compile-verified, UNVERIFIED on the car)

Four things the hardware was already capable of and the firmware was discarding.
Flash went 50.9% → 52.0%; RAM unchanged at 16.5%.

**GNSS extras — free, and independent of the ECU link.** `GPS_DATA`
(`FreematicsBase.h:49`) carries nine fields; the firmware read three. Now
persisted: `alt_m` (elevation profile), `heading` (direction of travel), and
`hdop` + `sat` (fix QUALITY — the difference between "no fix" and "a bad fix
that quietly shortened this trip"). Same struct, same read, previously thrown
away. The trip schema grew four columns; **8-column files buffered before the
change still parse**, with the extras left at their absent sentinels.

**Diagnostic PIDs now reach history.** Twelve of the fourteen diag PIDs were
read once per ECU link and surfaced only on `/pids` and `/diagnostics` — the
pull plane — so nothing was persisted. `refreshDistanceCounters()` now re-probes
the whole set on the same one-minute cadence and snapshots carry a `diag` object
with whatever the car answered: ambient and oil temperature, engine load,
throttle, barometric, runtime, distance and time driven with the MIL on.

**`time_since_cleared` is the quietly valuable one.** A DROP in it means someone
cleared the codes — which is exactly the event that zeroes the 0x31 distance
counter. That turns the backend's rollover-vs-reset *plausibility guess* into a
*measurement*, on the one ambiguity in the odometer design.

**VIN is persisted on snapshots.** `obd.getVIN()` was already being called and
stored in `g_vin`; it just never left the device. It is the only field that
proves WHICH car a given history belongs to, and the device is portable.

### Motion sensor — what it does, and the wake it cannot do

The board's ICM-20948 / ICM-42627 had **zero references in the firmware**. It is
now initialised and used for two things:

1. **A motion vote at each standby wake.** Voltage alone says "not charging",
   which is also true for the first seconds of a drive while the alternator
   catches up. If the accelerometer says the car is *moving*, the device stays up
   regardless of the rail reading.
2. **`harsh-motion` events** while awake, above `MEMS_EVENT_G` (0.35 g deviation
   from rest), rate-limited to one per 3 s.

**The events deliberately do NOT say "hard braking".** Classifying braking vs
acceleration vs cornering needs to know which way the dongle is pointing, and
that varies by car and by how far it was pushed into the port. Labelling an axis
"longitudinal" would be a guess dressed as a measurement, so the raw axes go out
with the magnitude and classification waits for an orientation calibration that
does not exist yet. (Gravity gives "down" at rest; "forward" could be derived by
correlating an axis against OBD speed changes over a few drives.)

> **The wake-on-motion interrupt in the standby section below is still NOT
> implemented, and cannot be from source alone.** It needs the sensor's INT line
> routed to an RTC-capable GPIO so `esp_sleep_enable_ext0_wakeup` can arm it
> during deep sleep. Searched 2026-08-12: there is no `PIN_MEMS_INT` in the board
> pin map, nothing in the vendored library names one, and no `ext0`/`ext1` wake
> is used anywhere. While the ESP32 deep-sleeps the sensor is unreachable, so
> **"up to ~60 s at the start of a drive goes unlogged" still stands.** The motion
> vote narrows that window; it does not close it. If the INT GPIO is ever
> identified, arm it at the marked hook in the standby fast path.

### Mileage via PID A6 (and PID 0x31 fallback)

PID A6 is measured on this car. The Freematics library returns tenths of a
kilometre, so firmware schema 2 divides the raw value by ten. The app will only
show A6 as the authoritative odometer after a one-time dashboard comparison is
recorded as `odometer.pid_a6_verified: true` in that vehicle's record.

The fallback mileage source is **`PID_DISTANCE` (0x31, "distance since codes cleared")**,
not the odometer PID. It is standard Mode 01 — the same request class as speed
and RPM — so if the ECU links at all it will very likely answer, where 0xA6
likely will not. Being wheel-derived it has neither the GPS undercount nor the
loss of the drive's opening span that standby sleeps through.

It is a **delta source anchored to one dash reading**, never an absolute
odometer, because it fails in two ways that both look like "the counter went
down":

- **16-bit, wraps at 65,536 km.** A value of 65,535 is the observed saturated
  response on this vehicle and is discarded, never presented as distance.
- **Resets to zero when DTCs are cleared** — routine after a shop repair.

The app separates them by a plausibility window and records a reset as an
*unmeasured span* rather than estimating into it. See
`backend/src/2_domains/automotive/services/OdometerService.mjs`.

What the firmware now does:

- Caches both counters (`g_distanceKm`, raw `g_odometerRaw`), refreshed on the OBD
  task every `COUNTER_REFRESH_MS`. **Cached, not read on demand** — every
  `obd.*` call is a UART round trip that must stay on core 0, and
  `tripOpen()`/`tripClose()` run on the loop task.
- Writes `distance_start_km` / `odometer_start_km` into the trip header, and the
  closing values into the footer as extra CSV fields (`E,<ms>,<dist>,<odo>`).
  **Old footers still parse** — the reader defaults both to -1, so trips
  buffered before the update upload unchanged.
- Emits `distance_since_cleared_km` / `odometer_km` on snapshots.
- **-1 means "no reading", never 0.** A car that genuinely reports 0 km since a
  recent code clear is a real answer and must stay distinguishable from silence.

The backend persists these into trip `meta` (absent key when unread, matching
the rest of the format).

### The LED (`/led`, fw 0.2.0)

**Unresolved — needs one measurement on the device.** Nothing in this firmware
or in FreematicsPlus ever drives the LED: the library defines `PIN_LED 4`
(`FreematicsPlus.h:44`) and never references it again, and `main.cpp` contains
no `pinMode`/`digitalWrite` of its own. So a lit LED is either **(a)** a
hardwired power indicator, which no firmware can touch, or **(b)** an
uninitialised pin floating at the lit level. Source cannot distinguish them.

`/led` settles it without spending an OTA per guess — polarity is also unknown,
so both levels are exposed rather than one being baked in:

```bash
curl "http://10.0.0.35/led?mode=low"    # then look at the car
curl "http://10.0.0.35/led?mode=high"   # if low did nothing
curl "http://10.0.0.35/led?mode=float"  # restore the as-shipped default
curl "http://10.0.0.35/led"             # read current mode (also on /status)
```

If **neither** level changes anything, it is case (a): hardwired, and the only
remaining options are physical (tape, or desolder).

Getting the build onto the device is the hard part — see
`tools/ota-when-online.mjs`, which sits on `/status` until the car turns up and
then inhibits standby, uploads, and verifies the version changed:

```bash
cd firmware && pio run -e freematics-oneplus-b && cd ..
node tools/ota-when-online.mjs          # leave it running; catches the window
```

The mode persists in NVS and is re-applied at the very top of `setup()`, ahead
of the standby fast path. That ordering matters: the device deep-sleeps between
engine-off checks, so a RAM-only setting would revert on every wake and the LED
would blink back on once a minute for the whole park.

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

Repairing pre-schema-2 telemetry is a separate, idempotent operation. Apply
mode copies the complete automotive history root to
`data/_backups/automotive/<timestamp>/` before atomically replacing any file:

```bash
node cli/automotive.cli.mjs repair-telemetry            # dry run
node cli/automotive.cli.mjs repair-telemetry --apply    # backup, then repair
```

This corrects legacy A6 scaling, removes saturated 0x31 and malformed VIN
values, and deduplicates repeated day-log trip references. New trip ingestion
is retry-safe: if the durable trip file already exists, the backend ACKs it
without appending a second reference.

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
(relay + file format), `cli/automotive.cli.test.mjs` (history migration/repair),
and `pio test -e native` (firmware decision logic).

Release acceptance for firmware 0.3.0 is three ordinary drives plus an
overnight park of at least eight hours. Verify regular GPS/battery snapshots,
ECU recovery without a reboot, A6 against the dashboard, no negative dates or
duplicate trip references, and no repeated full-radio parked wake loop.

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
