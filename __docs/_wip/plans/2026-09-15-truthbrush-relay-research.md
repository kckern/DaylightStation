# Truthbrush toothbrush tracker — integration research

**Date:** 2026-09-15
**Status:** RESEARCH — no hardware bought, nothing captured over the air yet.
**Roadmap:** [`roadmap/2026-09-15-truthbrush-brushing-integration.md`](../../roadmap/2026-09-15-truthbrush-brushing-integration.md)
**Goal:** get per-kid brushing events (who, when, how long, coverage) into
DaylightStation, the way `food-scale-relay` did for the kitchen scale.

## Sources

- Product pages, FAQ (answers live in the page's JSON-LD, not the rendered
  accordion), compliance page, user manual.
- FCC filings: tracker Classic `2AS6G-T1` (2020), tracker Pro `2AS6G-T2` (2022).
  Hub "Contains FCC ID 2AC7Z-ESPWROOM32D" — a stock Espressif ESP32 module.
- Candibell Inc (the maker) public GitHub repo `candibell-inc/mobile-sdk-android`
  (5 commits, May 2019, pre-Truthbrush packaging sensors).
- Decompiled current Android app `com.candibell.brush` (jadx). All protocol
  facts below come from the app unless marked otherwise.

No GitHub projects, Home Assistant integrations, or forum threads about hacking
Truthbrush exist (searched GitHub code/repos, HA community, Reddit).

## Hardware

| Part | Silicon | Radio |
|---|---|---|
| Tracker Classic (T1) | Nordic nRF52832 per a 2019 Nordic press release; later SKUs exist | BLE |
| Tracker Pro (T2) | "64MHz Cortex-M4F, 256KB flash" per the site; app knows Nordic, SiLabs and "China" builds of T1/T2 | BLE, CR1620 |
| Hub | ESP32-D0WD, 4MB flash | BLE + 2.4GHz WiFi |

## Does the hub expose anything locally?

**No evidence of any local interface.** The app never talks to the hub over the
LAN — no local IPs, no mDNS/NSD, no plain-http. The hub is provisioned over BLE
and then talks only to Candibell's cloud. Hub setup is one GATT write (`0xF2`
command) carrying WiFi SSID, WiFi password and `prod/<hex(account email)>` in
cleartext.

## Encryption

- **No BLE pairing/bonding** anywhere in the app or the 2019 SDK.
- **No app-layer crypto** in the app's own code (no `javax.crypto`, AES, HMAC).
  An enum value `READ_CHARACTERISTIC_FOR_ENCRYPTION` exists but only reads the
  notify characteristic; it is a leftover, not a cipher.
- The "AES-128/ECB/CCM" line on candibell.com matches the nRF52's hardware
  crypto blocks — likely a datasheet line, not a protocol description (inference).
- **Unknown:** whether the tracker's session payload is itself obfuscated. The
  app never parses it — it forwards the raw hex to the cloud. Only an
  over-the-air capture settles this.
- The site's legal footer prohibits reverse-engineering and cites patents
  US11,457,291, US12,256,182, CN113243658.

## What the payload contains — raw motion, not teeth

From the patents (US11,457,291 and its continuation US12,256,182; the
continuation's claims are about the cloud reassembling out-of-order packets per
session):

- The tracker outputs **raw 3-axis accelerometer X/Y/Z**, over-sampled,
  low-pass filtered (to kill electric-brush vibration), then compressed/packed.
  "The tracker does not perform complicated data processing, such as
  orientation modeling" — the design intent is an MCU without floating point.
- **No quadrants, no orientation, no mouth mapping on the tracker.** Quadrant
  coverage is computed from the raw signal: transform to vectors along the
  handle axis, bin by angle theta into sections, re-section ("split") a
  quadrant when its statistics vary (patent figs. 13, 14, 21, 22).
- The relay "can forward data as-is … or perform additional pre-processing".
  The patent allows the algorithm to run "on the relay or in the cloud", but the
  shipped product says all signal processing happens in the cloud, and the
  app's phone-as-relay path forwards the bytes untouched. The hub uploading the
  same `a7`/`a8` format with its own address is the likely reading (the app
  uses `ffffffffffff` as a stand-in hub address) — **inference, unverified**.

Consequence: the teeth/coverage mapping exists **only in the cloud**. Tapping
the hub's uplink would yield the same raw blobs as sniffing the tracker, behind
TLS. The only level with pre-mapped data is the cloud API (`datafileurl` →
eight quadrant values, duration, scores). `A0` is probably the session summary
(`sessioncounter` / `ticktimer` show up on cloud records), so a local relay
could plausibly get "a session happened, roughly how long" — not coverage.

## No-hub feasibility

The owner's goal is no vendor hub, cloud, or subscription. Evidence it can work:

- **The app never configures a tracker over BLE.** Across the whole app, the only
  writes to a tracker are the sync acks (A0/A1/A2) and `B5` (beep timer). Hub setup
  (`F2`) goes to the hub, not trackers. `POST /device` registration and
  `/device/{id}/activate/{code}` are cloud-only.
- **Patent on setup:** "There is no pairing and Bluetooth setup required when adding
  the tracker … as simple as pressing on the tracker's button to transition it out of
  the shelf-mode." Ownership lives server-side: the server sends a "digitally signed
  list of tracker IDs to the relay" — an allowlist for the relay, not a key on the
  tracker.
- **Patent on security:** tracker↔relay security is "Bluetooth pairing, as well as
  business level security logic embedded in the protocol and data structure"
  (optional wording). The app does no pairing; whether the payload carries such logic
  is the phase 0 go/no-go.
- **Patent on packets:** data can include "a timestamp, ID of the sensor, ID of the
  relay, a sequence number, and/or some auxiliary information"; packets carry a
  monotonically increasing index and a last-packet flag. The tracker "does not
  require flash memory" in one embodiment — retention without a relay is unknown.
- **Patent on analysis** (a reimplementable recipe): rotate XYZ so Y′ runs along the
  handle; low-pass `L = 0.8·L_prev + 0.2·x`, high-pass `x − L`; roll angle
  `θ = acos(x/√(x²+z²))·sign(z)` from low-pass; overlapping sliding windows of
  max(θ)−min(θ), Δθ and high-pass amplitude stats; start/stop from θ range and
  amplitude; duration = (end − start index) / sample rate; false-positive decision
  tree; sections split at θ spikes, re-split on high-pass changes, then classified to
  quadrants "through a deterministic algorithm or … a classifier trained via machine
  learning"; an A* search over quadrant transitions; up-down fraction from high-pass.

Unknown until capture: A1 encoding (compression, rate, scaling), A0 fields, time
base, payload obfuscation.

## BLE protocol (from the app)

**Advertisement** — manufacturer data, company ID `0x00BF` (raw bytes `BF 00`
at scan-record index 5–6). Indices below are into the full scan record:

| Index | Meaning |
|---|---|
| 9 | protocol id: `00`/`01` tracker, `10` hub |
| 20 | temperature |
| 21 | firmware version |
| 23 | product id: 2/3 = T1, 4 = T2, 5/6 = SiLabs T1/T2, 7/8 = China T1/T2 |
| 24–25 | manufacture YYWW |
| 26–29 | tick counter, uint32 big-endian (`0xFFFFFFFF` = unknown) |
| last byte of mfr data | high bit **clear** = tracker has data to sync ("connectable") |

The app treats a change in tick counter as "tracker did something" (it drives
a sync animation). Whether it increments once per brushing session is
**unverified**.

**GATT** — service `B0F50200-C788-5791-8533-0D22318D5C56`,
write `…0201` (write-without-response), notify `…0202`. The app scans with a
service-UUID filter on `…0200`.

**Sync session** (phone "virtual hub" mode; the real hub presumably does the same):

1. Connect (no bonding), request MTU, enable notify on `…0202`.
2. Tracker notifies frames starting `F0`. Byte 1 bit 7 set = more fragments
   follow. Byte 3 = packet type. Payload = bytes 3..len-1 (last byte dropped),
   concatenated across fragments.
   - `A1` — one per chunk, repeated (raw session data). Ack: `F0 00 03 A1 00 5F 0D`
   - `A0` — session summary. Ack: `F0 00 03 A0 00 60 0D`, then send `B5`,
     then ack A2: `F0 00 03 A2 00 5E 0D`
   - `A2` — end of sync; disconnect.
3. `B5` sets the buzzer: `F0 00 04 B5 <hi> <lo> <75-hi-lo> 0C` where
   value = profile beep timer seconds + 30.
4. Upload: `a8ffffffffffff<trackerMac><A0 payload with RSSI inserted at byte 1>`
   → `POST /sensor/measurements1`; `a7ffffffffffff<trackerMac><count u16><A1…>`
   → `POST /sensor/measurements3`. `ffffffffffff` is the stand-in hub address.

The ack is what tells the tracker the data was taken, so **anything that
completes a sync consumes the session** — a custom relay doing this would
starve the official hub/app of that brush.

The app only enables phone-as-hub for "China" T1/T2 trackers above a firmware
threshold; other trackers need the physical hub.

## Cloud API (unofficial)

Base `https://prod.api.candibell.com`, AWS Cognito user-pool login (standard
SRP; pool and client IDs are embedded in the APK), Cognito ID token sent as
`Authorization`.

- `GET /records/profile/{profileId}?start=&end=` → list of activity records:
  `profileid`, `deviceid`, `hubid`, `createdtime`, `sessioncounter`,
  `ticktimer`, `verdict`, `manualentry`, `datafileurl`, …
- `GET <datafileurl>` → per-session detail: `brushinglength`, `start`/`end`,
  eight quadrant coverage values (`in|out`_`up|down`_`left|right`),
  `overallscore`, `movementscore`, `consistencyscore`, `efficiencyscore`,
  `engagement[]`, `tip_*`, `verdict`.
- Also `GET /device/user/{userId}`, `GET /profile/user/{userId}`, badges, etc.

Units, from how the app renders them:

- `start`, `end`, `brushinglength`, `loglength` — seconds.
- `overallscore`, `quadrantscore`, `movementscore`, … — 0..1 fractions; the app
  shows `× 100` capped at 100, quadrant score green ≥ 0.85, yellow ≥ 0.60.
- `quadrantColor` — 8 chars, order: out-top-right, out-top-left,
  out-bottom-right, out-bottom-left, in-top-right, in-top-left,
  in-bottom-right, in-bottom-left. The app flags each area whose char is not
  `g`. Other letters unconfirmed.
- The eight `in_*`/`out_*` doubles are mapped into the app model but not shown
  directly; their scale is unconfirmed.

All scoring (duration, coverage, engagement) is computed server-side
("All signal processing performed securely in the cloud").

## Options

| | Gets | Cost / risk |
|---|---|---|
| **A. Hub + cloud poll** | Everything the app shows, already scored | Unofficial API can change; cloud dependency; needs account login |
| **B. Passive BLE scan** (any ESP32/BLE proxy, never connects) | Near-instant "tracker activity" from tick counter; per tracker | Semantics unverified; no duration/coverage |
| **C. ESP32 as replacement hub** | Raw A0/A1 blobs | Must decode payload yourself; coverage = reimplementing their algorithm; consumes sessions so the app goes blind |

**Decision (owner, 2026-09-15): C** — no vendor hub, cloud, or subscription.
DaylightStation relays, archives, decodes, and scores raw sessions itself. See the
roadmap; A remains the fallback if phase 0 finds the payload obfuscated.

## First steps once hardware arrives

1. nRF Connect / `bleak` scan: confirm company ID, watch whether bytes 26–29
   change once per brush.
2. Let the official hub sync; log in to the API from a script; confirm
   `/records/profile` returns the session with `brushinglength` + quadrants.
3. Optional: capture one A0/A1 sync (phone virtual hub + Android HCI snoop log)
   to judge whether the payload is plaintext sensor data.
