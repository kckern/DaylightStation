# Truthbrush Brushing Integration

**Status:** Proposed — no hardware bought; phase 0 is a go/no-go capture
**Created:** 2026-09-15 (revised same day: vendor hub and cloud dropped)
**Owners:** Household hardware, State Gates, Economy
**Research:** [`_wip/plans/2026-09-15-truthbrush-relay-research.md`](../_wip/plans/2026-09-15-truthbrush-relay-research.md)
**Decision:** DaylightStation owns the whole path. A bathroom ESP32 relay replaces
the vendor hub, pulls raw sessions from the trackers over BLE, and hands them to the
backend, which archives the raw bytes, decodes them to accelerometer samples, and
scores them locally. No vendor hub, account, cloud, or subscription in production.

---

## 1. Summary

A Truthbrush tracker is a 3-axis accelerometer, BLE radio, button, buzzer, and coin
cell that straps to any toothbrush. It detects a brushing session, packs the motion
samples, and waits for a relay to download them. The vendor's hub is a plain ESP32
that forwards those bytes to the vendor cloud, which does all the scoring.

DaylightStation takes the hub's place, the way the kitchen scale relay replaced its
app (`docs/plans/2026-07-10-food-scale-relay-design.md`). The difference is effort:
the scale sent grams; the tracker sends compressed raw motion, so this roadmap
includes building a decoder and an analyzer.

Outputs, per kid and session: start time, duration, active brushing time, a
brushed/not-brushed decision, and — once the analyzer matures — mouth-region
coverage. These feed State Gates ("brushed tonight") and the coin economy.

---

## 2. Why this is feasible

Established from the vendor app (decompiled) and patents US11,457,291 / US12,256,182:

| Question | Answer |
|---|---|
| BLE pairing or bonding? | None. |
| App-layer encryption in the app? | None. The app forwards tracker bytes untouched. |
| Does the tracker need a setup command? | No. After factory "shelf mode" the only writes the app ever sends a tracker are sync acks and the buzzer-timer command. Setup is a button press; ownership lives in the vendor cloud, not on the tracker. |
| Sync protocol known? | Yes — service UUID, characteristics, frame layout, packet types, ack bytes (research doc). |
| Scoring method known? | Described in the patent: coordinate transform, filters, roll angle, sliding windows, sectioning, classification. |

What is **not** known is the work of phase 0 and 1: the A1 payload encoding
(compression, sample rate, axis scaling), what A0 carries, the tracker's time base,
and whether the payload is obfuscated. The patent mentions optional "business level
security logic embedded in the protocol and data structure"; phase 0 is the kill test
for that.

---

## 3. Goals and non-goals

### Goals

- Sessions captured without any vendor hardware or service.
- Every raw session archived forever, so analysis can be re-run as it improves.
- Robust duration and brushed/not-brushed decisions first; region coverage later.
- AM/PM brushing facts in State Gates; coin earns through `economy.yml`.
- Relay failure never loses a session that reached the relay.

### Non-goals

- Matching the vendor's scores or its eight-area coverage exactly.
- The vendor app. Once a tracker is on our relay, the vendor app no longer sees it.
- Tracker firmware changes.
- Brush brand/type modeling beyond per-tracker calibration.

---

## 4. Architecture

```text
 tracker ──BLE──▶ bathroom-relay (ESP32)
   advertise "has data"      connect · reassemble F0 frames · ack · B5 timer
                             store session to flash until backend confirms
                                   │ WS event bus (device client)
                                   ▼
                  truthbrushRelay ingest (3_applications/hardware)
                    validate · archive raw · confirm to relay
                                   │
                                   ▼
          raw archive: household/history/hygiene/truthbrush/raw/…   (immutable)
                                   │
                                   ▼
            decoder (2_domains, pure):  A0/A1 hex → samples + metadata
                                   │
                                   ▼
            analyzer (2_domains, pure, versioned): samples → BrushingSession
                                   │
                                   ▼
               per-user lifelog: truthbrush sessions (derived, re-buildable)
                                   │
                     ┌─────────────┴─────────────┐
                     ▼                           ▼
          State Gates assertion            economy earn
          hygiene.teeth-brushed            teeth-brushed
```

### 4.1 bathroom-relay firmware (`_extensions/bathroom-relay/`)

PlatformIO + NimBLE, structured like `_extensions/kitchen-relay`. Provisioning comes
from household config through a generated, gitignored `config.h`.

1. **Scan** for service `B0F50200-C788-5791-8533-0D22318D5C56`, manufacturer data
   company `0x00BF`. Ignore trackers not in the configured allowlist.
2. **Connect** only when the advertisement's has-data flag is set (last
   manufacturer-data byte, high bit clear). Never connect to idle trackers — every
   connection costs coin-cell charge.
3. **Sync**: request MTU, enable notify on `…0202`, reassemble `F0` frames
   (byte 1 bit 7 = more fragments; byte 3 = type), ack each `A1`, and on `A0` send
   the A0 ack, `B5` (per-tracker beep timer), and the A2 ack; disconnect on `A2`.
4. **Store before forward**: write the complete session (A0 + ordered A1 list + RSSI
   + relay uptime) to LittleFS **before** it is gone from the tracker's side. The
   tracker-side ack consumes the session; the relay's flash is now the only copy.
5. **Forward** over the WS event bus:
   `{ type: 'truthbrush-session', relay, tracker, key, a0, a1: [...], rssi, uptime_ms }`.
   Delete from flash only on backend `truthbrush-session-ack { key }`. Retry with
   backoff; flash holds days of sessions.
6. **Heartbeat/hello** frames for `relayWatchdog`; LED shows WiFi / backend / last sync.

The session `key` is derived from tracker id + A0 bytes so a retransmit is
recognizable.

### 4.2 Backend ingest (`3_applications/hardware/truthbrushRelay.mjs`)

Mirrors `foodScaleRelay.mjs`: validate source and tracker allowlist, write the raw
session **atomically and immutably**, then send the ack. A duplicate `key` is
acknowledged again without a second write. Ingest never decodes; decode or analysis
failures cannot cause a lost session.

```yaml
# household/history/hygiene/truthbrush/raw/<tracker>/<YYYY-MM-DD>/<key>.yml
key: <key>
tracker: <tracker id>
relay: bathroom
received_at: 2026-09-20T19:44:02-07:00
rssi: -61
a0: "a0…"
a1: ["a1…", "a1…"]
```

`received_at` is the wall-clock anchor. The analyzer derives the session start from it
and the tracker's timing fields once phase 1 identifies them.

### 4.3 Decoder (`2_domains/hygiene/truthbrush/decode`)

Pure function: raw session → `{ sampleRateHz, samples: [{ i, x, y, z }] (g), meta }`,
where `meta` carries whatever A0 is found to contain (packet index, last-packet flag,
tick timer, session counter). It is specified entirely from phase 0 captures and
tested against them as fixtures. It has a `decoder_version`.

### 4.4 Analyzer (`2_domains/hygiene/truthbrush/analyze`)

Pure, deterministic, versioned. Implements the patent's published pipeline, adapted
and calibrated on our own captures:

1. Rotate XYZ into X′Y′Z′ with Y′ along the handle (per-tracker mount calibration).
2. Low-pass: exponential moving average, coefficient 0.8; high-pass = signal − low-pass.
3. Roll angle θ = acos(x′ / √(x′² + z′²)) · sign(z′) from the low-pass signal.
4. Overlapping sliding windows: max(θ) − min(θ), Δθ extremes, high-pass amplitude
   mean / std / median.
5. Start/stop detection from θ range and amplitude; duration = (end − start) / rate.
6. False-positive rules: too short, too little high-pass energy, no orientation
   transitions ("pulled from the drawer and waved").
7. Sectioning at θ jumps; split sections whose high-pass statistics shift.
8. Classify sections into mouth regions.

Staging:

| Analyzer | Output | Confidence |
|---|---|---|
| **v1** | started_at, duration_s, active_s, counted (bool), reason | High — timing and energy only |
| **v2** | + upper/lower and left/right split, up-down motion fraction | Medium — roll angle is well-defined; left/right from roll is an inference |
| **v3** | + inner/outer (eight areas) | Experimental — the patent itself falls back to a trained classifier here |

Every derived record stores `decoder_version` and `analyzer_version`. Re-running over
the raw archive rebuilds the lifelog and issues corrected State Gates assertions (a
higher source revision); nothing is hand-edited.

```yaml
# derived lifelog entry
- key: <raw key>
  tracker: <tracker id>
  started_at: 2026-09-20T19:42:10-07:00
  duration_s: 131
  active_s: 118
  counted: true
  period: pm
  regions: null            # v2+
  versions: { decoder: 1, analyzer: 1 }
```

### 4.5 Configuration

Registered in `shared/contracts/householdConfig.mjs` as
`truthbrush: 'hardware/truthbrush'`. Relay WiFi/backend provisioning follows
`hardware/scales` (secrets in household data only).

```yaml
# data/household/config/hardware/truthbrush.yml
relay:
  id: bathroom
trackers:
  <tracker-id>:            # MAC without colons, as the vendor app does
    user: <household-user-id>
    beep_timer_s: 120
    mount: { rotation_deg: [0, 0, 0] }   # filled by calibration
periods:
  am: { from: "04:00", to: "11:59" }
  pm: { from: "17:00", to: "23:59" }
counting:
  min_duration_s: 60
```

### 4.6 State Gates and economy

Unchanged in shape from the cloud design:

- Claim `hygiene.teeth-brushed`, boolean, subject = user, period = local day + `am|pm`,
  publisher = the Truthbrush application. The assertion id is `(user, date, period)`.
  A re-analysis issues a correction. A missing session before the window closes is
  `indeterminate`.
- `economy.yml` earn `teeth-brushed` (`per: completion`, `daily_cap: 2`),
  `ref: truthbrush:{raw key}`, so re-analysis never double-pays.

---

## 5. Phases

| Phase | Work | Exit criterion |
|---|---|---|
| **0. Capture (go/no-go)** | Buy one Pro tracker, no hub. From the Mac with `bleak` (as the scale's Phase 0): wake the tracker, run the sync handshake, dump A0/A1 hex. Scripted sessions: stationary on each of six faces; timed 30/60/120 s brushing; each mouth region held separately. | Sync works with no vendor software. A1 shows structure: stationary faces produce distinguishable ±1 g patterns. **No-go:** uniform high-entropy payload with no structure → stop. |
| **1. Decode** | Decoder spec + fixtures: sample format, scaling, rate, A0 fields, time base. | Six-face captures decode to ±1 g on the right axes; timed sessions decode to within 2 s. |
| **2. Relay + archive** | `bathroom-relay` firmware, `truthbrushRelay` ingest, raw archive, watchdog registration. | A week of real sessions archived; a pulled-WiFi day loses nothing. |
| **3. Analyzer v1 + consumers** | Duration, active time, counted; lifelog; State Gates claim; economy earn. | Evening brush → gate satisfied → one coin. The false-positive "wave the brush" test does not count. |
| **4. Analyzer v2/v3** | Regions, calibrated against scripted region captures. | v2 agrees with scripted region sessions ≥ 80% of time; v3 only if it earns its keep. |

Optional, development only, off by default: to borrow labels, a tracker could be
registered in the vendor app and the backend could POST an archived session's raw
bytes to the vendor's measurement endpoints, then read back the vendor's scores for
the same session. This needs a free vendor account and is never part of production.
Skip it unless v2/v3 calibration stalls.

---

## 6. Observability

| Event | Level | When |
|---|---|---|
| `truthbrush.relay.hello` / heartbeat | info / debug | Relay boot and liveness (`relayWatchdog`) |
| `truthbrush.relay.session.received` | info | tracker, key, a1 count, rssi |
| `truthbrush.relay.session.duplicate` | debug | Retransmit of an archived key |
| `truthbrush.decode.fail` | warn | key, decoder_version, reason |
| `truthbrush.analyze.done` | info | key, user, period, duration_s, counted |
| `truthbrush.analyze.discarded` | info | key, reason (too short / no energy / no transitions) |
| `truthbrush.tracker.unknown` | warn | Session from a tracker not in config |

Raw motion and region values are household health data about children. They are
archived, never logged.

---

## 7. Risks

| Risk | Posture |
|---|---|
| Payload obfuscated | Phase 0 go/no-go before any build. Fallback: the vendor-cloud option (A) in the research doc. |
| Encoding hard to reverse | Scripted captures (six faces, timed, per-region) give ground truth without the vendor. |
| Relay down, tracker memory fills or is volatile | Measure tracker retention in phase 0; relay stores before forwarding; watchdog alerts. |
| Coin-cell drain from relay behavior | Connect only on the has-data flag; one sync per session; measure battery over phase 2. |
| Our regions differ from the vendor's | Accepted. Gates and coins run on duration (v1), which is robust. |
| Bathroom range / ESP32 placement | BLE range ~10 m; a relay per bathroom if needed (allowlist per relay). |
| Vendor terms prohibit reverse-engineering (site footer cites the patents) | Household use of owned devices, nothing redistributed; owner accepts before phase 0. |
| Vendor app still syncs a tracker (a phone nearby with the app) | Don't install the vendor app in production. A session the app grabs never reaches the relay. |

---

## 8. Testing

- **Decoder:** captured hex fixtures → expected samples/metadata; malformed frames and
  missing A1 packets fail loudly with a reason.
- **Analyzer:** synthetic signals (constant orientation, known rotations, known
  duration, pure noise) with exact expected outputs; captured scripted sessions as
  golden tests pinned to `analyzer_version`.
- **Ingest:** retransmitted key → one archive file, two acks; unknown tracker →
  rejected, warned, no ack (the relay keeps it).
- **Firmware host tests:** frame reassembly and ack sequencing against captured
  notification streams.
- **Live:** one real evening brush → raw file → lifelog entry → gate → coin.
- Fixture ids are `test-user` / `test-tracker`; no real names.

---

## 9. Open questions

1. Does the tracker offer its session to any central, or only to relays it has seen?
   (App code says no whitelist on the tracker; phase 0 confirms.)
2. Sample rate, bit depth, and compression of A1.
3. Does A0 carry a timestamp, tick timer, packet index, or last-packet flag?
4. How many unsynced sessions does a tracker retain, and does it survive a battery swap?
5. Does the Pro tracker include a gyroscope in the payload?
6. One relay enough for the house's bathrooms?
