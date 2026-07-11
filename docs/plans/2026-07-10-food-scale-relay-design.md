# food-scale-relay — design

**Date:** 2026-07-10
**Status:** IMPLEMENTED — firmware built + flashed to the ATOM, backend handler wired.
**Owner:** KC

## Implementation notes (2026-07-10)

- **Firmware** `_extensions/food-scale-relay/firmware/` (PlatformIO, `m5-atom` env).
  Built + flashed to the ATOM Lite; verified live: WiFi (`10.0.0.153`) → WS
  (`/ws`) connected → BLE found `SENSSUN FOOD` (**scale MAC `e0:e5:cf:0f:34:13`**)
  → subscribed to `0xFFB2`.
- **Two build gotchas fixed:** (1) default 1.25 MB app partition overflows —
  use `huge_app.csv`. (2) NimBLE 1.4.x needs Arduino core 2.x, so pin
  `platform = espressif32@6.5.0`; on core 3.x it aborts at
  `esp_bt_controller_init`. Also init BLE **before** WiFi and DON'T disable WiFi
  modem-sleep, or WiFi/BLE coexistence aborts at `coex_core_enable`.
- **Backend** `backend/src/3_applications/hardware/foodScaleRelay.mjs`, wired in
  `app.mjs`. Ingest + settle-dedup persistence unit-tested (serialized appends —
  a naive async read-modify-write races and loses records).
- **Deploy note:** the flashed device points at PROD (`daylightlocal.kckern.net:
  3111`). The backend handler must be deployed to prod for its stream to be
  broadcast/persisted there (pushed to main; deploy is a separate step).

## Summary

`_extensions/food-scale-relay/` is an **ESP32 firmware project** (no host daemon).
An M5Stack ATOM Lite (ESP32-PICO-D4) BLE-connects to a KitchenIQ 50797 kitchen
scale, decodes weight frames, and **streams them over WebSocket to the
DaylightStation backend**, which re-broadcasts them on the eventbus topic
`food-scale`. The ATOM's physical button emits button events over the same
socket. All instance config (Wi-Fi, backend, scale targeting, decode params)
lives in the household SSOT at `data/household/config/scales.yml` — **nothing is
hardcoded in firmware**; a build tool generates a gitignored `config.h` from it,
mirroring `_extensions/eink-panel`.

```
BLE scale ──BLE notify(FFB2)──▶ ATOM Lite (firmware) ──WS──▶ backend eventbus
                                     │ button (GPIO39)          │ broadcast('food-scale')
                                     └──────────────────────────┘   ├─▶ apps / displays (live)
                                                                     └─▶ persistence subscriber
                                                                          → history/nutrition/<id>/ (configurable)
```

## Phase 0 — BLE discovery results (verified on this Mac via `bleak`)

Device advertises as **`SENSSUN FOOD`** (KitchenIQ 50797 is a Senssun OEM unit).

- **GATT:** service `0000ffb0-0000-1000-8000-00805f9b34fb` (`0xFFB0`)
  - char `0xFFB1` — `write-without-response, notify`
  - char `0xFFB2` — `write-without-response, notify` ← **weight streams here**
  - device-info service `0x180A` (read-only metadata, unused)
- **No handshake needed** — `FFB2` streams ~4 Hz on its own after subscribe.
- **Frame = 10 bytes, verified:**

  | field | bytes | meaning |
  |---|---|---|
  | header | b0–b1 | fixed `FF A5` |
  | weight | b2–b3 | **uint16 big-endian, grams (÷1)** |
  | mirror | b4–b5 | copy of weight |
  | stable | b6 | `0xAA` = settled, `0xA0` = changing |
  | flag7 | b7 | `00`/`01` (secondary; not needed) |
  | unit | b8 | `0x00` = g, `0x02` = ml |
  | checksum | b9 | `sum(b2..b8) & 0xFF` |

- **Calibration (measured):** display 39 g → raw 39; display 40 g → raw 40 ⇒
  **divisor = 1, raw is grams directly** when unit byte = `0x00`.
- **Unit byte confirmed by cause:** switching the scale ml→g changed b8 `0x02`→`0x00`.
- **Targeting:** macOS exposes only a CoreBluetooth UUID, not the MAC. The ESP32
  sees the real MAC, but firmware should **scan by advertised name `SENSSUN FOOD`
  and/or service `0xFFB0`** — more robust than a MAC and survives a battery swap.

Discovery scripts kept under the session scratchpad (`scan.py`, `probe.py`,
`decode.py`) — port the decode logic verbatim into firmware.

## Transport decision — WebSocket (not HTTP POST, not batch) — CONFIRMED

The scale is a continuous ~4 Hz stream; the value is watching grams move live and
catching the settled reading. Evaluated:

- **POST-per-reading** — ~4 req/s, TLS setup each time; wasteful on ESP32, latency
  jitter. Rejected for a live stream.
- **Batch POST** — adds up to a batch-window of latency; fights the "live" goal.
  Rejected.
- **WebSocket** — one persistent connection, ~40-byte JSON/frame, sub-100ms,
  carries button events too. **Chosen.** Decisive factor: the backend eventbus
  *is* a WebSocket bus (`WebSocketEventBus`), so WS ingest is native — the ESP is
  just another device client (precedent: `eventbus/btRelay.mjs`), and re-broadcast
  is the bus's core job.

**Noise control (ESP-side throttle):** emit a frame only on **Δ ≥ 1 g** or a
**stable-flag transition**; collapse idle-repeat frames to a **~0.5 Hz heartbeat**
so subscribers can tell the link is alive.

## Config SSOT — `data/household/config/scales.yml`

Plural + keyed by scale id, so a second scale can be added without schema change.
Secrets (Wi-Fi) live here (household data is private, Dropbox-synced, NOT in repo).
The firmware build reads this; the running backend reads it for the topic/label.

```yaml
# data/household/config/scales.yml
# Single source of truth for BLE kitchen scales bridged by an ESP32 relay.
# The firmware build (gen-config) reads provisioning/backend/device/ble.
# The backend reads `topic` + scale metadata for the food-scale eventbus.

provisioning:
  wifi_ssid: "REDACTED"
  wifi_password: "REDACTED"

backend:
  host: 10.0.0.68          # DaylightStation backend host (LAN)
  port: 3111               # eventbus WS port (env.ports)
  ws_path: /ws             # eventbus websocket path (confirm in composition root)

scales:
  kitchen:
    label: "Kitchen scale"
    device:                # the relay hardware
      board: m5-atom-lite  # ESP32-PICO-D4; button on GPIO39, RGB LED on GPIO27
      mac: "14:08:08:53:94:84"
    ble:
      match_name: "SENSSUN FOOD"                       # scan target (preferred)
      service_uuid: "0000ffb0-0000-1000-8000-00805f9b34fb"
      notify_char:  "0000ffb2-0000-1000-8000-00805f9b34fb"
      decode:
        weight_offset: 2      # byte index of uint16 weight
        endian: big
        divisor: 1            # raw → grams
        stable_byte: 6        # b6
        stable_value: 0xAA    # settled
        unit_byte: 8          # b8
        units: { 0x00: g, 0x02: ml }
    emit:
      min_delta_g: 1
      heartbeat_hz: 0.5
    topic: food-scale         # eventbus topic to broadcast on
```

`config.example.yml` (committed, in the extension) documents this schema with
placeholder secrets. The real file lives only in household data.

## Firmware — `_extensions/food-scale-relay/firmware/`

Structure mirrors `eink-panel/firmware` (PlatformIO + Arduino):

```
firmware/
  platformio.ini            # env: m5stack-atom / esp32; libs: NimBLE-Arduino, arduinoWebSockets, ArduinoJson
  include/
    config.h                # GENERATED, gitignored
    config.example.h
  src/
    main.cpp                # BLE client + WS client + button + LED status
  tools/
    gen-config.mjs          # scales.yml → include/config.h
    flash.mjs               # pio run -t upload (port autodetect)
    (fetch-deps.mjs if any vendored libs)
```

**`main.cpp` responsibilities:**
1. Wi-Fi connect (creds from `config.h`); RGB LED status (red=no wifi, blue=no
   scale, green=streaming).
2. NimBLE scan for `match_name`/`service_uuid`, connect, subscribe `notify_char`.
3. On each notification: verify header + checksum, decode weight/stable/unit per
   `decode` params. Apply throttle (min_delta_g / stable transition / heartbeat).
4. WS client to `backend.host:port ws_path`; on connect send an `identify`
   (role `scale`, id `kitchen`); stream frames as JSON:
   `{ "type":"scale", "id":"kitchen", "grams":40, "stable":true, "unit":"g", "ts":<ms> }`
5. Button (GPIO39): debounce; short vs long press →
   `{ "type":"button", "id":"kitchen", "press":"short"|"long", "ts":<ms> }`
6. Reconnect logic for both BLE and WS (exponential backoff); log via Serial.

**`gen-config.mjs`** (mirrors eink): reads `scales.yml`, validates required
fields, writes bootstrap-only `config.h` (Wi-Fi, backend, one scale's ble +
decode + emit). Gitignored, `0600`. Everything else is compile-time from YAML;
changing a decode param or Wi-Fi = edit YAML + reflash.

## Backend ingest — eventbus scale handler

Register a handler in the composition root (near where the eventbus + WS server
are wired) via `eventBus.onClientMessage((clientId, message) => …)`:

- On `message.type === 'scale'`: validate (grams is number, id known), then
  `eventBus.broadcast('food-scale', { id, grams, stable, unit, ts, source:'ble-relay' })`.
- On `message.type === 'button'`: `eventBus.broadcast('food-scale',
  { id, event:'button', press, ts })` (same topic; discriminated by `event`).
- Ignore/deny unknown ids; log connect/disconnect for observability (structured
  logging per project rules).

No new HTTP route required. If the eventbus `identify`/envelope validation proves
strict for a non-browser client, fall back to a dedicated `/ws/scale` ingest that
does nothing but validate → `broadcast('food-scale', …)`; confirm during impl.

**Consumers** subscribe to `food-scale` (browser apps via the existing WS client
`subscribe('food-scale', …)`), e.g. a live cooking/nutrition weight display.

## Persistence — backend-owned, decoupled from the relay

The relay/ingest is deliberately dumb: it **streams live events onto the bus and
persists nothing**. Persistence is a **separate backend concern** — a subscriber
to the scale's topic decides *what* and *how* to store under the configured root
(`data/household/history/nutrition/` by default). This keeps the high-rate live
stream ephemeral (on the bus) while durable storage records only what's meaningful.

**Recommended policy (backend's call, not the firmware's):**

- **Do NOT persist the raw ~4 Hz stream** — it's for live display only.
- **Persist discrete measurements:** when a reading *settles* (b6 → `0xAA` and
  holds ≥ ~1 s at a non-zero weight), append one record. This is the "you weighed
  something" event a nutrition log actually wants.
- **Persist button events** verbatim (short/long press).
- **Layout** — config-driven root (`scales.yml` → `persistence.dir`, default
  `household/history/nutrition`), then `<id>/<YYYY-MM-DD>.yml` (append-only day log):
  ```
  {persistence.dir}/{scale-id}/{YYYY-MM-DD}.yml
  # default: household/history/nutrition/kitchen-food-scale/2026-07-11.yml
  ```
  ```yaml
  - ts: 2026-07-11T14:03:21Z
    grams: 240
    unit: g
    kind: settled
  - ts: 2026-07-11T14:03:40Z
    event: button
    press: short
  ```
- **Broadcast topic** is per-scale configurable too (`scales.<id>.topic`, default
  `food-scale`); the persistence subscriber listens on every configured topic.
- Implement via a `food-scale` subscriber in the composition root writing through
  the existing datastore/`io` layer (append semantics; beware the
  `DataService.ensureExtension` dotted-filename gotcha — keep ids dot-free or add
  `.yml` explicitly).

The **ingest** (broadcast) and the **persistence** (subscribe → write) are two
independent handlers on the same bus, so persistence policy can change (sampling,
retention, format) without touching the relay or the firmware.

## Testing / verification

- **Decode unit test** (backend or firmware host build): the 10-byte frames
  captured in Phase 0 → expected `{grams, stable, unit}`; checksum verification.
- **Ingest test:** feed a fake `scale`/`button` client message → assert
  `broadcast('food-scale', …)` shape.
- **Live bring-up:** flash ATOM, watch Serial for BLE-connect + WS-connect;
  subscribe to `food-scale` from a browser console and confirm grams track the
  scale display; press the button and confirm the event.
- **Discipline:** no vacuous skips — if BLE or WS won't connect, fail loudly.

## Open items / follow-ups

- Confirm eventbus WS `ws_path` + whether a non-browser client must pass the
  `identify` envelope validation (drives ingest-reuse vs dedicated `/ws/scale`).
- `oz` / `fl oz` unit codes unmapped (only g=`0x00`, ml=`0x02` observed) — add to
  `decode.units` if those modes are ever used; firmware passes unit through.
- Negative/tare readings not characterized; treat weight as unsigned for now.
- Second scale later = add another key under `scales:` + flash another ATOM.
```
