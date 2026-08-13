# Auto app — design

> Status: **v1 built 2026-08-12.** Domain, adapters, use cases, API, and a
> mobile-first UI at `/auto` are working against real history. The firmware
> odometer change compiles but is **unverified on the car**.
> Data source: `_extensions/obd-relay` (Freematics ONE+ in the OBD-II port).
>
> Open questions for KC: `2026-08-12-auto-app-open-questions.md`.

A per-vehicle record system: a file cabinet plus a timeline. Trips arrive
automatically from the OBD relay; maintenance and fill-ups are entered by hand;
purchase/sale documents, the manual, and diagnoses join against the same vehicle.

**Reference feature set: [Wainwright](https://wainwright.app/)** — digital glove
box, deadline alerts for renewals and expirations, maintenance records with
photos, fuel tracking with MPG trends and spend reports, multi-vehicle fleet.
That is the shape of the product. The differentiator here is that the OBD relay
**auto-ingests what Wainwright makes you type**: trips, distance, and (once the
ECU links) mileage arrive without data entry.

**Mobile-first, desktop-compatible.** This is the one DaylightStation app that is
*not* a kiosk surface — it gets consulted in a driveway, at a shop counter, or in
a parts aisle. Single-column base layout, touch-sized targets, progressive
widening at breakpoints. Never a TV layout scaled down.

---

## What the data can actually support

Measured from the history tree on 2026-08-12, not assumed:

| Signal | State |
|---|---|
| GPS track, distance, max speed | Available. `gps_fix_pct` observed 69–100%. |
| Battery voltage | Available, every sample (it drives standby, so it never depends on the ECU). |
| Timestamps | Often absent. Several trips are `time_source: boot-relative` and file as `unknown_*`. |
| RPM / coolant / fuel | Intermittent. `ecu: false` on both recent trips; `fuel_pct: null` in the latest snapshot. |
| Odometer | Not yet reaching history at all. See [Mileage](#mileage). |

Two consequences the design must absorb rather than paper over:

1. **Raw device trips are ignition-cycle artifacts, not errands.** Several trip
   files are sub-kilometre garage shuffles (`distance_km: 0.012`,
   `max_speed_kph: 0`). The ~60s standby wake interval also fragments one outing
   into several trips. A literal trip list reads as noise.
2. **Absence is the norm, and must render as absence.** The relay already
   encodes this correctly — a reading never taken is an *absent key*, never a
   sentinel. The app must not fill those with zeros or dashes that imply a
   measurement happened.

---

## Domain model

New domain `automotive`, **Level 2 (Features)** in the DDD domain hierarchy.
Added to the level table in `ddd-reference.md` in the same change that creates it.

### Ubiquitous language

| Term | Meaning |
|---|---|
| **Trip** | One uploaded device recording, bounded by an ignition cycle. Raw. |
| **Journey** | One outing: consecutive trips merged across a short dwell. The unit the timeline presents. |
| **Leg** | A trip as it appears inside a journey. |
| **Place** | A named lat/lon + radius (home, school, the usual gas station). |
| **Stop** | A dwell between legs, resolved to a Place or left unnamed. |
| **Service record** | One maintenance entry: date, type, vendor, cost, notes, optional odometer. |
| **Fuel log** | One fill-up: date, odometer, volume, price, station, partial-fill flag. |
| **Document** | A glove-box item: insurance card, registration, title, manual. May expire. |
| **Reminder** | A computed due/overdue item, from a service interval or a document expiry. |
| **Odometer reading** | A mileage value plus its provenance (`dash`, `pid_31`, `speed_integration`). |

### Building blocks

```
2_domains/automotive/
├── entities/
│   ├── Journey.mjs          aggregate root: legs, stops, distance, span
│   ├── ServiceRecord.mjs    a maintenance entry + its recurrence
│   ├── FuelLog.mjs          a fill-up; knows whether it can close an MPG interval
│   └── Document.mjs         a glove-box item + optional expiry
├── value-objects/
│   ├── Place.mjs            lat/lon/radius, contains(fix)
│   ├── GeoFix.mjs           a validated coordinate
│   ├── Volume.mjs           litres at rest, gallons at the edge
│   └── OdometerReading.mjs  value + source + observedAt
└── services/
    ├── JourneyStitchService.mjs   trips → journeys
    ├── PlaceResolverService.mjs   fix → Place | null
    ├── OdometerService.mjs        0x31 deltas + dash anchors → mileage
    ├── FuelEconomyService.mjs     fill-ups → MPG, spend, trends
    └── ReminderService.mjs        intervals + expiries → what's due
```

All pure. No I/O, no dates from the ambient clock — time is passed in.

---

## Journey stitching

Two trips belong to the same journey when the gap between them is shorter than a
dwell threshold **and** the car did not meaningfully move between them.

- Default dwell threshold: **20 minutes** (decided 2026-08-12). A whole errand
  run — bank, store, school — reads as one journey with several stops rather
  than four separate outings.
- **Sub-minute leg gaps record no stop.** The recorder rotates its trip file for
  its own reasons: one 25-minute drive arrived as four legs separated by 1s, 2s
  and 2s. Merging them is right; calling them stops would claim "3 stops" for a
  drive that had none and offer each artifact for naming as a place.
- Trips with **no recoverable wall clock** (`time_source: boot-relative`) cannot
  be ordered against others and are never stitched — they surface as standalone
  journeys flagged `clock: unrecoverable`.
- Journeys whose total distance falls below a floor (default **0.2 km**) are
  classified `shuffle` and collapsed out of the default timeline view, reachable
  behind a toggle. This is a *presentation* classification, not deletion —
  nothing is dropped from history.

All three thresholds are config, not constants — there was barely a dozen trips
of real data when they were set. Revisit once the deep-sleep clock fix means
journeys can actually be ordered against each other.

---

## Places

A curated `places.yml` keyed by place id, matched locally by radius. **No
coordinates leave the network** — consistent with this repo's PII posture, and
home/school/church would get street addresses rather than the names actually
used anyway.

```yaml
places:
  home:
    label: Home
    lat: 00.00000
    lon: -000.00000
    radius_m: 120
    kind: home          # home | school | church | fuel | store | service | other
```

Unrecognized stops render as **"Unnamed stop"** with a one-tap *name it* action
that appends to the list. The registry learns from actual driving instead of
demanding up-front data entry.

`kind: fuel` is what makes "gas station trips" fall out for free — a stop at a
fuel-kind place is a fill-up event on the timeline, with no fuel-level PID
required.

---

## Mileage

**Route chosen: PID 0x31 delta, with speed integration as fallback.**

`PID_DISTANCE` (0x31, "distance since codes cleared") and `PID_ODOMETER` (0xA6)
are *already probed* by the firmware (`src/main.cpp:134-139`). Two gaps:

1. The diagnostic PIDs are read **once per ECU link** (`main.cpp:719`, gated on
   `g_dtcCount < 0`), not at trip start *and* end.
2. Their values **never leave the device** — they surface on `/pids` and
   `/diagnostics` (the HTTP pull plane) but appear in neither the snapshot
   message nor trip `meta`, so nothing reaches history.

Both are fixable in the relay. See [Firmware changes](#firmware-changes).

### Why 0x31 rather than 0xA6

Inference, not measurement — `GET /pids` with the ignition on is what settles it:

- **0xA6** is in later J1979 revisions and rarely implemented. Expect a refusal.
- **0x31 is standard Mode 01**, the same request class as speed and RPM. If the
  ECU links at all, it will very likely answer. Being wheel-derived, it has
  neither the GPS undercount nor the loss during the 60s standby gap.

### Handling 0x31's two failure modes

0x31 is a **delta source anchored to one dash reading**, never an absolute
odometer:

- **16-bit, wraps at 65,535 km.** A decrease of roughly the modulus is a
  rollover, and the delta is `(65536 - prev) + next`.
- **Resets to zero when DTCs are cleared** — which a shop does routinely after a
  repair. A decrease that is *not* rollover-shaped is a reset: the accumulator
  re-anchors and the gap is recorded as an explicit `unmeasured` span rather
  than silently absorbed.

`OdometerService` returns both the estimate and its confidence, and the UI never
renders a mileage figure without showing its source.

### Where the anchor comes from

**Fill-ups are the anchor.** A fuel log naturally carries a dash odometer
reading — it is the one moment you are already standing at the car, stopped,
with the number in front of you. That makes anchoring a side effect of something
worth logging anyway, rather than a chore invented to serve the accumulator.
Service records are the secondary anchor; both feed the same
`OdometerReading(source: 'dash')` stream.

This also means the odometer **degrades gracefully to Wainwright's model**: with
no ECU link at all, fill-up readings alone still give mileage and MPG, exactly
as a manual-entry app would. The 0x31 delta improves the resolution between
fill-ups; it is not a precondition for the feature working.

### Fallback

Where 0x31 did not answer but the ECU was up, integrate the 1Hz `PID_SPEED`
samples already persisted per-trip. Vehicle-measured, no firmware change, a few
percent error from 1Hz quantization. Where neither is available, the journey
carries GPS haversine distance, labelled as such.

---

## Maintenance

A log with **date-based due**, designed so mileage-based intervals drop in
without a migration once the odometer lands.

```yaml
- id: 2026-03-14-oil
  date: '2026-03-14'
  type: oil-change
  vendor: ...
  cost: 89.42
  odometer_km: 41200      # optional, always captured when known
  interval_months: 6      # recurrence; interval_km reserved for later
  notes: ...
  attachments: [receipt.pdf]
```

The **type vocabulary is config-driven** (`service_types:` in vehicles.yml,
served by `GET /service-types`), with defaults in
`2_domains/automotive/entities/serviceTypes.mjs`. Curated rather than free text
because due-tracking groups by `type`: with free entry, "oil change" and "Oil
Change" become two recurrences and the due list quietly doubles. `other` is the
escape hatch.

`ReminderService` computes due/overdue from the most recent record of
each type plus its interval. Recurring non-mechanical items (registration,
insurance, tabs) use the same shape — they are date-driven by nature and need no
odometer at all, so they work fully from day one.

**Capture the dash reading wherever there is already typing.** It costs nothing,
and it is what makes the odometer anchor available later without a backfill.

---

## Fuel and economy

```yaml
- id: 2026-08-11-fill
  date: '2026-08-11'
  odometer_km: 41880
  volume_l: 52.3
  price_total: 61.20
  price_per_unit: 1.17
  place: costco-gas        # resolves against places.yml
  partial: false           # a partial fill cannot close an MPG interval
```

`FuelEconomyService` computes economy **between consecutive full tanks** —
the only interval where "fuel burned" is actually known. A partial fill is
recorded and counted toward spend, but carries its volume forward rather than
closing an interval, because tank-to-tank is the only honest denominator.

Economy needs two full tanks before it can report anything. Until then the UI
says so rather than showing a placeholder number.

### Detection: the gauge, not the map

**The detector is the fuel level.** A tank cannot refill itself, so a rise
between trips IS a purchase. `FuelStopDetectionService` finds them.

This replaced an earlier place-based design (a stop at a `kind: fuel` place),
which was worse on every axis and was corrected 2026-08-12:

| | fuel gauge | place |
|---|---|---|
| Setup | none | station must be named first |
| Detects | fuel was bought | car was near a pump |
| New/unknown station | works | invisible |
| Volume estimate | yes, from the rise | no |

The place-based version also had a chicken-and-egg failure: `places.yml` starts
empty, so the prompt could never fire until the household had already done
manual work. The gauge needs nothing.

**Sparse readings are sufficient.** Detection needs two readings BRACKETING the
fill, not continuous coverage — which matters because the engine bus answers
intermittently (2–3 fuel readings per ~200-sample trip, measured). And the rise
appears BETWEEN trips, since refuelling happens engine-off with the device
asleep.

Verified against live history: readings of 43, 43, 40, then 93 — the 40 → 93
jump is a real tank fill the app now surfaces as *"The car noticed a fill-up"*
with a one-tap **Log it** that pre-fills date, estimated gallons (when
`tank_capacity_l` is configured), and the partial flag.

A known place still **labels** the fill. It never gates detection. The two
signals are complementary in exactly that order.

Noise handling: a 10-point minimum rise, because fuel senders are non-linear and
slosh with cornering, gradient, and how level the car is parked.

### Tank capacity — where the volume estimate comes from

`tank_capacity_l` per vehicle in `vehicles.yml`. Absent, the estimate is
**omitted rather than guessed**: a wrong tank size produces confident wrong
gallons on every detected fill.

For the household's 2021 Pacifica it is **71.9 L / 19 gal**, from Chrysler's own
specification sheet, which also states "Specifications same for FWD/AWD unless
otherwise indicated" — the tank line carries no AWD variant, so it applies to
the AWD car. The 16.5-gal figure circulating elsewhere is the **plug-in hybrid**,
a different vehicle; worth checking rather than assuming, which is why it was.

The full spec sheet (engine, fluids, tyres, weights) lives in the vehicle's own
`vehicle.yml` record, with every figure tagged by provenance — `vin`,
`chrysler`, `web`, or `unverified`. Tyre pressures are deliberately left unset:
the driver's door placard is authoritative and depends on the tyres actually
fitted.

---

## Glove box

Documents are first-class, not attachments-to-something-else: insurance card,
registration, title, manual, purchase and sale paperwork.

```yaml
- id: insurance-2026
  kind: insurance          # insurance | registration | title | manual | purchase | sale | other
  label: Insurance card
  file: insurance-2026.pdf
  issued: '2026-01-01'
  expires: '2026-12-31'    # optional; drives reminders
```

The point of a glove box on a phone is retrieval under pressure — at a traffic
stop, at a counter, at a shop. So the document list is the one screen that must
work offline-ish and open fast: no lazy chrome, no animation, tap-to-fullscreen.

`ReminderService` treats an `expires` date exactly like a service interval, so
registration renewals and insurance expiry land in the same due list as the oil
change. One list of "what needs attention," regardless of what kind of thing it is.

---

## Layers

| Layer | Artifacts |
|---|---|
| `2_domains/automotive/` | entities, value objects, domain services (above) |
| `3_applications/automotive/ports/` | `IVehicleHistoryRepository`, `IVehicleRecordRepository`, `IPlaceRepository` |
| `3_applications/automotive/usecases/` | `GetVehicleOverview`, `ListJourneys`, `GetJourneyDetail`, `LogServiceRecord`, `LogFuel`, `GetReminders`, `GetFuelEconomy`, `ListDocuments`, `NamePlace` |
| `3_applications/automotive/AutomotiveContainer.mjs` | composition |
| `1_adapters/persistence/yaml/` | `YamlVehicleHistoryDatastore`, `YamlVehicleRecordDatastore`, `YamlPlaceDatastore` |
| `4_api/v1/routers/automotive.mjs` | HTTP |
| `frontend/src/Apps/AutoApp.jsx` + `modules/Auto/` | UI |

The existing `3_applications/hardware/automotiveRelay.mjs` (write path) is left
alone apart from persisting the new odometer fields. Read and write stay
separate: the relay owns ingest, the datastores own query.

### Storage

```
household/history/automotive/<vehicle-id>/     # relay-owned, existing
  <YYYY-MM-DD>.yml                             # day log
  trips/<YYYY-MM>/<...>.yml                    # full trips

household/automotive/places.yml                # named places, household-scoped
household/automotive/<vehicle-id>/             # app-owned, new
  vehicle.yml                                  # identity, VIN, purchase/sale
  service.yml                                  # maintenance records
  fuel.yml                                     # fill-ups
  documents.yml                                # glove box index
  files/                                       # the documents + photos themselves
```

Places are **household-scoped, not per-vehicle** — home and school don't change
when the car does.

History stays append-only and relay-owned. App-authored records live outside it
so a history migration never has to rewrite user-entered data.

---

## Firmware changes

In `_extensions/obd-relay/firmware/src/main.cpp`:

1. Re-probe the distance PIDs at **trip open and trip close**, not only on ECU
   link. They are two UART round trips at moments that are not in the 1Hz path,
   so the sampling budget is unaffected.
2. Add `distance_since_cleared` and `odometer` to the **snapshot message** and
   to **trip `meta`** (as `distance_start_km` / `distance_end_km`).
3. Backend relay persists them into trip meta, omitting absent readings —
   absent key, never a sentinel, matching the existing contract.

**None of this is verifiable without the car.** It is also entirely gated on the
ECU link, which is the standing blocker (`ecu: false` on both recent trips).
Until `GET /pids` returns a measured table, treat every claim about which PID
answers as a hypothesis.

---

## Testing

| Layer | Approach |
|---|---|
| Domain | Pure unit tests. Stitching, rollover/reset detection, place radius matching, due computation. Fixtures derived from the real trip files, with identifiers scrubbed. |
| Application | Use cases against fake repositories. |
| Adapter | Round-trip YAML against a temp dir. |
| API | Router tests alongside the existing `4_api/v1/routers/*.test.mjs` pattern. |

Per `feedback_no_pii_in_test_fixtures`: fixture coordinates are offset and
vehicle ids are `test-vehicle`, never the household's real values.

---

## Deliberately out of scope (v1)

- **Depreciation and resale valuation** — needs a purchase price and a market
  data source. The `vehicle.yml` schema reserves purchase/sale fields so the
  data is captured now and the analysis lands later.
- **OEM factory service schedule** — mileage-gated, inert until the odometer
  lands.
- **Live "where is the car now"** — the relay only reaches the bus on home WiFi,
  so live position is only ever "in the garage". Not a gap; a property of the
  transport.
- **Document upload from mobile** — the glove box schema and read path ship in
  v1; camera capture and upload are a second pass. See open question 6.
- **Multi-vehicle switching UI** — see open question 1. Every route and
  repository is keyed by `vehicleId` from the start, so this is additive.

### Explicitly in scope, because Wainwright proves they matter

Cost-per-mile is *not* deferred: fuel spend and service spend are both known
from entered records, so spend-over-time and MPG trends work without the
odometer. Only the per-mile denominator waits on mileage.
