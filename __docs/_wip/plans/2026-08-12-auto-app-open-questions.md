# Auto app — open questions: RESOLVED

> Companion to `2026-08-12-auto-app-design.md`. All 12 answered in a review
> session on 2026-08-12. Kept as the decision record; the two remaining items
> are jobs, not questions.

## Decisions

| # | Question | Decision | Status |
|---|---|---|---|
| 1 | Multi-vehicle scope | **Garage index as home.** A list of vehicles that holds one today; skipped when there's exactly one, so a single-car household never taps through a list of one. | Built |
| 2 | Units | **Store km/litres, display miles/mph/gallons.** Conversion at the presentation edge only. | Built |
| 3 | Dwell threshold | **20 minutes**, up from 10 — a whole errand run reads as one journey. Plus a 60s floor below which leg gaps record no stop. | Built |
| 4 | Maintenance types | **Curated list + `other`**, moved out of the frontend into config (`service_types:` in vehicles.yml, served by `GET /service-types`). | Built |
| 5 | Maintenance backfill | **Some records exist; deal with it later.** No importer now — the YAML shape is plain enough that a CLI import is a small follow-up. | Deferred |
| 6 | Glove box ingest | **Drop-in + index.** Files land in `<vehicle>/files/`, `documents.yml` indexes them. Camera capture is the first follow-up. | Built |
| 7 | Sub-km shuffles | **Hidden by default, toggle to reveal.** Never deleted — a view classification only. | Built |
| 8 | OBD device health | **Inline notes only.** A row explains its own thinness ("no engine data"); no device dashboard. | Built |
| 9 | Firmware changes | **Yes.** Two changes written, both compile, both **unverified on the car**. | Needs OTA |
| 10 | Fuel logging friction | **Detection by fuel gauge**, superseding the place-based prompt (KC, 2026-08-12). A rise between trips is a purchase — no place needs naming. Surfaces on the Fuel tab with one-tap Log it. No notifications. | Built |
| 11 | History migration | Not a question — a job. See below. | **Waiting on you** |
| 12 | ECU link | Not a question — the standing blocker. See below. | **Waiting on you** |

---

## Two firmware changes, both awaiting an OTA and a drive

`pio run -e freematics-oneplus-b` succeeds (RAM 16.5%, flash 50.9%). Neither is
verified on the vehicle, and per `feedback_dont_assert_unverified_device_facts`
no claim is made that they work until measured.

### Odometer counters (PID 0x31)

- Cached `g_distanceKm` / `g_odometerKm`, refreshed on the OBD task. **Cached
  rather than read on demand**, because `tripOpen()`/`tripClose()` run on the
  Arduino loop task and every `obd.*` call must stay on core 0 — the same
  constraint that made `obd.init()` starve `webSocket.loop()`.
- Trip header gains `distance_start_km` / `odometer_start_km`; the footer gains
  the closing values (`E,<ms>,<dist>,<odo>`). **Old footers still parse.**
- Snapshots gain `distance_since_cleared_km` / `odometer_km`.
- Backend relay persists all of it into trip `meta`, absent-key when unread.

### The deep-sleep clock (why every drive was `unknown_`)

Found 2026-08-12. `epochMs()` gated on `timeSynced`, a flag scoped to the
**power session**. The device deep-sleeps while parked and re-runs `setup()` on
wake, so starting the engine always reset it and `tripOpen()` stamped
`started_epoch_ms = 0` — while the ESP32 RTC held a perfectly good epoch the
whole time.

The tell: every real drive was `unknown_`, and the only two trips with
timestamps were 0.012 km and 0.033 km garage shuffles.

Fixed with `rtcClockValid` in `RTC_DATA_ATTR` (survives deep sleep) plus a
plausibility floor. **RTC drift over a long park is unmeasured.** Existing
`unknown_` files cannot be retroactively dated — the time was never captured.

---

## 11. The history migration has never been run

Measured against the live tree 2026-08-12: **55 of 59** `kind: trip` day-log
records are pre-migration stubs (`time_approx: true`, no `file`, no
`distance_km`). Only the current-format records carry usable data.

The app **skips** them (mapped naively they render as 55 rows reading "0 mi,
time unknown") and logs the count with the remedy. Skipping is not fixing:

```bash
node cli/automotive.cli.mjs migrate            # dry run, prints the plan
node cli/automotive.cli.mjs migrate --apply
```

Worth doing before judging the timeline — some stubs carry real sample counts
(`samples: 398`), so there may be recoverable drives in there. **Not run: it
rewrites your history tree, which is your call.**

## 12. The standing blocker — ECU link

Nothing about mileage or fuel level resolves until `obd.init()` reaches the ECU.
`ecu: false` on most trips, with FCA's Security Gateway the leading suspect.

One visit to the car with the ignition in **RUN**:

```bash
curl "http://<device-ip>/obd/probe?start=1"   # kick off
curl "http://<device-ip>/obd/probe"           # poll, takes a few minutes
curl "http://<device-ip>/pids"                # the measured table
```

That `/pids` output is the single most valuable input to this design — it turns
"0x31 will probably answer" into a fact, or reveals that neither PID does and
pushes us to speed integration only.

---

## Follow-ups, in rough priority order

1. **Set `tank_capacity_l`** for the vehicle in `vehicles.yml`. Fill-up
   detection works without it, but the volume estimate is omitted rather than
   guessed, so the form can't pre-fill gallons. This is the single highest-value
   one-line config change available.
2. **Name places** to label journeys and fills. Optional now — detection no
   longer depends on it — but every stop reads "Unnamed stop" until you do.
3. **Camera capture for the glove box** (deferred from Q6).
4. **CLI importer for existing maintenance records** (deferred from Q5).
5. **Re-tune the dwell threshold** once the clock fix lands and journeys can
   actually be ordered.
