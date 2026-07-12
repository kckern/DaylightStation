# Barcode Scanning (BLE relay → event bus)

How a physical barcode scan reaches the DaylightStation backend and drives a screen.

As of 2026-07-11 the ingest path is a **Zebra DS2278 bridged over Bluetooth LE by an ESP32**
(`_extensions/barcode-relay`) that streams scans into the **WebSocket event bus**. The previous
**USB HID → MQTT** path (`_extensions/barcode-scanner` + `scanner.py` + Mosquitto) has been
**retired** (commit `f9418c018`). The old integration docs are kept but marked superseded:
[`integrations/barcode-scanner.md`](../integrations/barcode-scanner.md),
[`integrations/barcode-processing.md`](../integrations/barcode-processing.md),
[`integrations/barcode-screen-pipeline.md`](../integrations/barcode-screen-pipeline.md).

---

## End-to-end flow

```
Zebra DS2278  (HID Bluetooth Low Energy, Discoverable)
     │  BLE HID keyboard reports (service 0x1812)
     ▼
ESP32  M5Stack ATOM Lite  — NimBLE HID *central*        [_extensions/barcode-relay/firmware]
     │  connects by MAC, bonds, decodes keystrokes, flushes on a 150ms idle gap
     │  WS message: { source:'barcode-relay', type:'scan', device:'ds2278', code, ts }
     ▼
WebSocketEventBus  (/ws)  .onClientMessage
     ▼
createBarcodeRelay()                          [backend/src/3_applications/hardware/barcodeRelay.mjs]
     ├─ broadcast('barcode-relay', payload)    → live subscribers
     ├─ PERSIST → household/history/barcode/<device>/<YYYY-MM-DD>.yml
     └─ onScan(payload)  (wired in app.mjs)
            ▼
        BarcodePayload.parse(code, knownActions, KNOWN_COMMANDS)   [2_domains/barcode]
            ▼
        BarcodeScanService.handle(payload)     [3_applications/barcode/BarcodeScanService.mjs]
            ├─ command → resolveCommand() → broadcast to target screen (skips gatekeeper)
            └─ content → BarcodeGatekeeper.evaluate() → if approved:
                   ├─ broadcast contentId to the target-screen topic
                   ├─ onContentApproved → HA display on_script (TV wake)
                   └─ waitForAck(2s); no ack → loadFallback (direct device load)
```

The event bus is only the transport. The scan is *handled* by `BarcodeScanService` +
`BarcodeGatekeeper`. A scan whose `device` id is not present in `scannerDeviceConfig` (a
`type: barcode-scanner` entry in `devices.yml`) is broadcast on the `barcode-relay` topic but
**dropped by the pipeline** with a `barcode.unknownDevice` warning.

---

## Barcode code grammar

Parsed by `BarcodePayload.parse`. Delimiters are forgiving — **colon, semicolon, or space** all
work; **dashes are NOT delimiters** (they appear in screen names like `living-room`). Options are
appended to the content id with `+`.

**Command barcodes** (1–3 segments, checked first against `KNOWN_COMMANDS`):

| Form | Example | Effect |
|------|---------|--------|
| `command` | `pause` | bare command |
| `command:arg` | `volume:30` | parameterized command |
| `screen:command` | `living-room:pause` | command on a specific screen |
| `screen:command:arg` | `living-room:volume:30` | parameterized, specific screen |

Known commands (`BarcodeCommandMap.mjs`): `pause`, `play`, `next`, `prev`, `ffw`, `rew`, `stop`,
`off`, `blackout`, `volume:<n>`, `speed:<n>`.

**Content barcodes** (2–4 segments, if no command match):

| Form | Example |
|------|---------|
| `source:id` | `plex:594036` |
| `action:source:id` | `play:plex:594036` |
| `screen:source:id` | `living-room:plex:594036` |
| `screen:action:source:id` | `living-room:play:plex:594036` |

**Content options** (appended with `+`): `plex:594036+shuffle` → `{ shuffle: true }`;
`plex:594036+shader=dark` → `{ shader: 'dark' }`; combine with more `+`.
Actions come from `barcode.yml` (`actions`, default `queue`/`play`/`open`; `default_action`
when none is given).

---

## History persistence

Every scan is appended to an append-only day log — same shape as the food-scale history under
`household/history/nutrition/<scale>/`:

```
{dataDir}/household/history/barcode/<device>/<YYYY-MM-DD>.yml
```

```yaml
- ts: '2026-07-12T01:02:38.704Z'
  code: living-room:plex:594036+shuffle
- ts: '2026-07-12T01:03:12.115Z'
  code: kitchen:menu:breakfast
```

- Written by the PERSIST subscriber in `barcodeRelay.mjs` (subscribes to the `barcode-relay`
  topic). Appends are **serialized** through one promise chain (read-modify-write safety).
- `<device>` is the relay's `device` field (e.g. `ds2278`). Day boundary is **UTC**.
- Persistence is active only when the relay is given a `dataDir` (unit tests omit it → no disk).
- Root dir override: `barcode.yml` → `persistence.dir` (default `household/history/barcode`).

---

## Configuration

| File | Keys | Purpose |
|------|------|---------|
| `data/household/config/devices.yml` | `type: barcode-scanner`, `target_screen`, `policy_group`, `content_control.topic`, `device_control.displays.*.on_script` | Registers the scanner **by device id** (must match the relay's `device`) → pipeline acts on it. `on_script` wakes the TV via Home Assistant on approved content. |
| `data/household/config/barcode.yml` | `default_action`, `actions`, `persistence.dir` | Pipeline actions + history root. |

> Household app config is loaded once at startup and cached — edit + restart the backend for
> changes to take effect (see `docs/reference/core/configuration.md`).

---

## Hardware / firmware

Full firmware detail: [`_extensions/barcode-relay/DEV-STATUS.md`](../../../_extensions/barcode-relay/DEV-STATUS.md).

- **One-time scanner setup:** scan the **"HID Bluetooth Low Energy (Discoverable)"** barcode from
  the DS2278 Product Reference Guide (p.6-6 — the *Low Energy* one, not Classic). The scanner then
  advertises as a BLE HID keyboard: name `DS2278 <serial>`, MAC `C8:1C:FE:FD:CE:90`, appearance
  `0x03C1`, service `0x1812`. That MAC is `TARGET_MAC` in the firmware.
- **ESP32** (M5 ATOM Lite) runs a NimBLE HID central: bonds (LE SC, Just Works), reads keyboard
  reports, and relays each barcode over WiFi/WS. Fill real WiFi creds before flashing (committed
  with placeholders); repoint `WS_HOST`/`WS_PORT`/`WS_PATH` at the real backend for production.
- **Coexistence:** the scanner also charges in its USB cradle and stays USB-enumerated; the BLE
  and USB interfaces run simultaneously. Do **not** unplug the cradle to "force BLE" — BLE works
  while cabled.

### Firmware decode gotchas (why it "connected but got nothing" for hours)
- The DS2278 streams on the **BOOT keyboard input report `0x2A22`**, not the Report characteristic
  `0x2A4D`, even in Report protocol mode → **subscribe to both**.
- **No CR/Enter terminator** over BLE HID → flush on a **~150 ms idle gap** (matches the old USB
  service's `timeout=150ms`), not on Enter.

---

## Component reference

| Concern | File |
|---------|------|
| Relay ingest + broadcast + persist | `backend/src/3_applications/hardware/barcodeRelay.mjs` |
| Pipeline wiring (`onScan` → parse → handle) | `backend/src/app.mjs` (`createBarcodeRelay({ dataDir, onScan })`) |
| Parse grammar | `backend/src/2_domains/barcode/BarcodePayload.mjs` |
| Command map | `backend/src/2_domains/barcode/BarcodeCommandMap.mjs` |
| Handling (gatekeeper → screen) | `backend/src/3_applications/barcode/BarcodeScanService.mjs` |
| Approval policy | `backend/src/2_domains/barcode/BarcodeGatekeeper.mjs` |
| Event bus | `backend/src/0_system/eventbus/` |
| Firmware | `_extensions/barcode-relay/firmware/src/main.cpp` |

---

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Scan beeps (good decode) but nothing happens | Is the relay's `device` id registered in `devices.yml` as `type: barcode-scanner`? Unknown ids are dropped after broadcast. |
| No scans reach the backend at all | ESP UDP log on `:9999` — is `ble=1` (bonded) and `ws=1` (bus connected)? Is `WS_HOST` pointed at the backend? |
| History file not written | Persistence needs `dataDir` (it's passed in `app.mjs`); check `barcode_relay.persist.failed` logs and dir permissions. |
| Content approved but screen doesn't change | TV off / FKB down → the 2 s ack times out and `loadFallback` runs; verify the screen's `on_script` in `devices.yml`. |
