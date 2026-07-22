# ESP Fleet Diagnostic CLI — Design

**Date:** 2026-07-22
**Status:** v1 built (`cli/esp.cli.mjs`), firmware changes proposed but not made

## Problem

The ESP relays do invisible work. When a barcode scan doesn't reach nutribot, every
failure in the chain presents identically — nothing happens — and there is no way to
tell which link broke without walking over and guessing.

```
DS6878 scanner  --ClassicBT/SPP-->  ATOM Lite  --WiFi/WS-->  backend  -->  handler
SENSSUN scale   --BLE----------->   ATOM Lite  --WiFi/WS-->  backend  -->  handler
```

Any one of: scanner out of range, scanner unpaired, ESP rebooted, BT stack wedged,
WiFi dropped, backend WS down. Same symptom.

The tool answers one question — **"if I scan right now, does it land?"** — and, when
the answer is no, names the broken link and the remedy.

## What the firmware already answers

Verified against `_extensions/food-scale-relay/firmware/src/main.cpp:544-630` and a
live device (`10.0.0.47`, 2026-07-22).

| Question | Field |
|---|---|
| Is it on? | HTTP responds at all, plus `uptime_s` |
| Is it connected now? | `barcode.connected`, `scale.connected` |
| Is it bound? | `barcode.bonds`, `barcode.bound_mac` |
| Did it drop? | `barcode.open_count` / `close_count`, `last_event` |
| Would a scan land? | `barcode.listening` + `websocket.connected` + `pending_scans` / `dropped_scans` |
| Last scan? | `barcode.last_scan`, `last_scan_age_s` |
| Link health | `wifi.rssi`, `websocket.drops` / `down_s` / `retries` |

`/simulate/barcode` (`main.cpp:767`) injects a synthetic scan — an active probe of
ESP→WS→backend→handler that needs no physical scanner.

**This was the surprise: the firmware is already well instrumented.** The gap was never
telemetry, it was that nothing consumed it. v1 of the CLI required no firmware change.

## Gaps

### 1. "Is it in range?" is not answerable — and may not be fixable

The ESP is an SPP **acceptor** (`barcode.mode = "spp-acceptor"`): the scanner initiates,
the ESP listens. An out-of-range scanner, a sleeping scanner and a dead scanner are all
the same observation — silence. There is no RSSI for a link that was never established.

Whether ESP-IDF can surface *failed inbound paging attempts* is **not determined**. If it
can, a `last_page_attempt_age_s` field would distinguish "the scanner is trying and
failing" from "the scanner is not trying at all" — which is the difference between a range
problem and a pairing problem. This needs investigation before it can be promised.

### 2. `last_event` has no timestamp

You can see *that* the link dropped, not *when*. One-line fix: stamp it alongside the
text and emit `last_event_age_s`.

### 3. The log ring is self-flooding

`recent_logs` is 24 entries with no dedup. Observed on the live device: **all 24 slots
held the same `[ble] scan watchdog — restarting a stalled scan` line**, emitted every
~45s whenever the scale is off. That is ~18 minutes of history in which nothing else can
survive, so a barcode link drop from an hour ago is unrecoverable.

Two candidate fixes, both firmware-side:
- **Coalesce on write** — if the incoming message equals the newest entry, bump a repeat
  counter instead of consuming a slot. Cheap, and preserves the flood as a signal.
- **Rate-limit the watchdog itself** — log the first stall, then every Nth. Simpler, but
  loses the distinction between one stall and two hundred.

Preference: coalesce on write. It fixes the class of problem rather than one instance.

The CLI collapses runs at render time as a stopgap, but it can only collapse what
survived the ring.

## The CLI

`cli/esp.cli.mjs`, following the `pbctl`/`pkctl`/`fkb.cli.mjs` idiom (command table +
argv destructure) rather than `dscli`'s strict-JSON contract — this output is read by a
human deciding whether to walk into the kitchen.

```
esp check   [device]        would a scan/weight land right now?
esp status  [device]        raw /status JSON
esp log     [device]        on-device log ring, runs collapsed
esp test    [device] [code] inject a synthetic barcode
esp reset   [device]        drop the scanner link so it re-initiates
esp unbond  [device]        clear BT bonds, forcing fresh pairing
esp blescan [device] on|off toggle the BLE scale scan
esp list                    known devices
```

`check` exits non-zero when anything would not land, so it composes into scripts and
health checks.

### The verdict is the product

`assessFoodScale()` is pure and separately tested (11 cases) so the reasoning can be
exercised without a device. Its branch order matters: it names the **nearest cause**, not
the first red light. A scanner that is linked while the WS is down blames transport, not
the scanner. A scanner that has never connected (`open_count === 0`) gets "likely
unpaired" and is pointed at `unbond`; one that connected and dropped gets "out of range
or asleep" and is pointed at the trigger. Same red light, different remedies.

### Registry and discovery

The unresolved problem. `10.0.0.47` and `10.0.0.153` are DHCP leases with no reservations
and no mDNS — they exist as prose in READMEs. A lease change silently breaks the tool.

v1 ships a built-in registry plus an `ESP_HOST` override so it works today. That is a
stopgap, not a design.

**Recommendation: add mDNS to the relay firmware.** `ir-blaster` already does it
(`MDNS.begin("ir-" + BLASTER_ID)`), so the pattern is proven in-tree and costs a few
lines. Then every ESP is self-registering and the hardcoded IPs can go.

Alternative: DHCP reservations on the router. Works, but the knowledge lives outside the
repo where nothing can verify it.

## Out of scope for v1

- The wider fleet (`playback-hub` :8080, `fitness` :3000, `document-processor` :8190)
  have control planes and no CLI. The registry shape here should absorb them later.
- `piano-bridge` and `portal-keys` already have `pbctl`/`pkctl`. Not worth rewriting.
- `scantron-relay` and `eink-panel` run no server — the eink panel deliberately, since a
  deep-sleeping panel cannot answer a query (`eink-panel/firmware/src/main.cpp:175`).
