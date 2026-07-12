# Barcode → Screen Pipeline

> ⚠️ **Superseded ingest (2026-07-11).** The MQTT front-end (`MQTTBarcodeAdapter`) was retired
> (commit `f9418c018`). `BarcodeScanService`/`BarcodeGatekeeper` still apply, but scans now enter
> via the BLE relay + event bus — see [Barcode Scanning](../barcode-scanning/README.md).

How scanned barcodes flow from MQTT into the screen-framework to trigger media playback, control commands, and display changes.

**Depends on:** [Barcode Scanner](barcode-scanner.md) (USB HID capture → MQTT), Mosquitto MQTT broker, screen-framework WebSocket commands

---

## How It Fits

```
USB Scanner (Symbol Technologies)
       │  evdev grab + keystroke assembly (scanner.py)
       ▼
MQTT: daylight/scanner/barcode
       │  { barcode, timestamp, device }
       ▼
MQTTBarcodeAdapter
       │  validate JSON → parse via BarcodePayload
       │  detect type: command or content
       ▼
BarcodeScanService
       │
       ├─► command ──► BarcodeCommandMap → WS broadcast (skip gatekeeper)
       │
       └─► content ──► BarcodeGatekeeper → WS broadcast (if approved)
                              ▼
                    useScreenCommands (frontend)
                              │
                              ├─► media:play / media:queue → Player overlay
                              ├─► media:playback → play/pause/next/prev
                              ├─► display:shader / display:volume / display:sleep
                              └─► media:rate → playback speed
```

---

## Barcode Formats

Delimiters are forgiving — colon (`:`), semicolon (`;`), or space all work. Dashes are preserved (they appear in screen names like `living-room`).

### Content Barcodes

Load media onto a screen.

| Format | Example | Screen | Action | ContentId |
|--------|---------|--------|--------|-----------|
| `source:id` | `plex:12345` | scanner default | pipeline default | `plex:12345` |
| `action:source:id` | `queue:plex:12345` | scanner default | `queue` | `plex:12345` |
| `screen:source:id` | `office:plex:12345` | `office` | pipeline default | `plex:12345` |
| `screen:action:source:id` | `office:play:plex:12345` | `office` | `play` | `plex:12345` |

**Actions:** `queue` (append to queue), `play` (replace and start), `open` (open in menu)

Content barcodes pass through the **gatekeeper** before broadcasting.

### Command Barcodes

Control playback, volume, and display. No content loaded.

| Barcode | Effect |
|---------|--------|
| `pause` | Pause playback |
| `play` | Resume playback |
| `next` | Next track |
| `prev` | Previous track |
| `ffw` | Fast forward |
| `rew` | Rewind |
| `stop` | Dismiss player |
| `off` | Sleep display |
| `blackout` | Blackout shader |
| `volume:30` | Set volume to 30 |
| `speed:1.5` | Set playback speed to 1.5x |

Prefix with screen name to target a specific screen: `office:pause`, `living-room:volume:20`.

Commands **skip the gatekeeper** — no approval needed for playback controls.

### Parse Priority

The parser checks commands before content. Disambiguation rules:

1. Barcodes with **4+ segments** skip command detection → always content
2. Barcodes with **1-3 segments** check against the known commands list first
3. For **2-segment** barcodes: if the first segment is a command → `command:arg` (e.g. `volume:30`); if the second is a command → `screen:command` (e.g. `office:pause`); otherwise → content `source:id` (e.g. `plex:12345`)
4. For **3-segment** barcodes: if the second segment is a command → `screen:command:arg`; otherwise → content `action:source:id`

This means `play` alone is a command (resume playback), but `play:plex:12345` falls through to content (play this content). And `office:play:plex:12345` (4 segments) is always content.

---

## Architecture

### Domain Layer

| File | Purpose |
|------|---------|
| `backend/src/2_domains/barcode/BarcodePayload.mjs` | Value object — parses barcode strings, detects type (command vs content), exposes structured fields |
| `backend/src/2_domains/barcode/BarcodeCommandMap.mjs` | Maps command names to WS payloads. Exports `COMMAND_MAP`, `KNOWN_COMMANDS`, `resolveCommand()` |
| `backend/src/2_domains/barcode/BarcodeGatekeeper.mjs` | Strategy-pattern approve/deny for content scans. Runs ordered strategies, first denial wins |
| `backend/src/2_domains/barcode/strategies/AutoApproveStrategy.mjs` | Default strategy — approves everything |

### Adapter Layer

| File | Purpose |
|------|---------|
| `backend/src/1_adapters/hardware/mqtt-barcode/MQTTBarcodeAdapter.mjs` | MQTT subscription to `daylight/scanner/barcode`. Validates JSON, parses via `BarcodePayload`, calls `onScan` callback |

### Application Layer

| File | Purpose |
|------|---------|
| `backend/src/3_applications/barcode/BarcodeScanService.mjs` | Orchestrator. Resolves target screen from barcode or device config. Routes commands directly to broadcast, routes content through gatekeeper first |

### Frontend

| File | Purpose |
|------|---------|
| `frontend/src/screen-framework/commands/useScreenCommands.js` | Handles WS messages → ActionBus events. Supports `playback`, `shader`, `volume`, `rate`, `action` (reset/reload/sleep), and `source: 'barcode'` content messages |

---

## Configuration

### barcode.yml

Pipeline-level config at `data/household/config/barcode.yml`:

```yaml
topic: daylight/scanner/barcode
default_action: play

actions:
  - queue
  - play
  - open

gatekeeper:
  default_policy: auto-approve
  policies:
    auto-approve:
      strategies: []
```

- `topic` — MQTT topic to subscribe to
- `default_action` — action when content barcode doesn't include one
- `actions` — valid action names (used by parser for disambiguation)
- `gatekeeper.policies` — named policy groups with ordered strategy lists

### devices.yml

Per-scanner config in `data/household/config/devices.yml`:

```yaml
symbol-scanner:
  type: barcode-scanner
  target_screen: living-room
  policy_group: default
```

- `type: barcode-scanner` — identifies device as a barcode scanner
- `target_screen` — default screen when barcode doesn't specify one
- `policy_group` — which gatekeeper policy to apply for content scans

Multiple scanners can target different screens with different policies.

---

## Command Map Reference

Defined in `BarcodeCommandMap.mjs`. Each command maps to a WS payload shape:

| Command | WS Payload | ActionBus Event |
|---------|-----------|-----------------|
| `pause` | `{ playback: 'pause' }` | `media:playback` |
| `play` | `{ playback: 'play' }` | `media:playback` |
| `next` | `{ playback: 'next' }` | `media:playback` |
| `prev` | `{ playback: 'prev' }` | `media:playback` |
| `ffw` | `{ playback: 'fwd' }` | `media:playback` |
| `rew` | `{ playback: 'rew' }` | `media:playback` |
| `stop` | `{ action: 'reset' }` | `escape` |
| `off` | `{ action: 'sleep' }` | `display:sleep` |
| `blackout` | `{ shader: 'blackout' }` | `display:shader` |
| `volume:N` | `{ volume: N }` | `display:volume` |
| `speed:N` | `{ rate: N }` | `media:rate` |

Adding a new command requires:
1. Add entry to `COMMAND_MAP` in `BarcodeCommandMap.mjs`
2. Ensure `useScreenCommands.js` handles the WS payload shape
3. Print new barcode card

---

## Gatekeeper

Content barcodes (not commands) pass through the `BarcodeGatekeeper` before broadcasting. The gatekeeper runs an ordered list of async strategy functions. First denial wins. If all approve (or no strategies configured), the scan is approved.

**Current strategy:** `AutoApproveStrategy` — approves everything.

**Future strategies** (interface supports, not built):
- `HomeAssistantConfirmStrategy` — push HA notification, await response
- `TimeWindowStrategy` — approve only during configured hours
- `ContentRatingStrategy` — deny based on content metadata

Each scanner device references a `policy_group` in `devices.yml`, which maps to a named policy in `barcode.yml`.

---

## Testing

### Unit Tests

```bash
# All barcode tests (54 tests across 5 suites)
npx jest tests/isolated/domain/barcode/ tests/isolated/assembly/adapters/barcode/ tests/isolated/assembly/barcode/ --no-coverage
```

| Suite | Tests | Covers |
|-------|-------|--------|
| `BarcodePayload.test.mjs` | 22 | Content parsing, command parsing, delimiter normalization, validation |
| `BarcodeCommandMap.test.mjs` | 7 | Command resolution, parameterized commands, unknown commands |
| `BarcodeGatekeeper.test.mjs` | 5 | Strategy ordering, approve/deny, empty strategies |
| `MQTTBarcodeAdapter.test.mjs` | 8 | Constructor, message validation, status |
| `BarcodeScanService.test.mjs` | 12 | Content flow, command flow, gatekeeper bypass, unknown device |

### Manual MQTT Testing

```bash
# Content barcode — play Plex item on living room
mosquitto_pub -h localhost -t "daylight/scanner/barcode" \
  -m '{"barcode":"plex:12345","timestamp":"2026-03-30T12:00:00Z","device":"symbol-scanner"}'

# Content barcode with screen override
mosquitto_pub -h localhost -t "daylight/scanner/barcode" \
  -m '{"barcode":"office;plex;12345","timestamp":"2026-03-30T12:00:00Z","device":"symbol-scanner"}'

# Command barcode — pause playback
mosquitto_pub -h localhost -t "daylight/scanner/barcode" \
  -m '{"barcode":"pause","timestamp":"2026-03-30T12:00:00Z","device":"symbol-scanner"}'

# Command barcode — set volume on office screen
mosquitto_pub -h localhost -t "daylight/scanner/barcode" \
  -m '{"barcode":"office;volume;30","timestamp":"2026-03-30T12:00:00Z","device":"symbol-scanner"}'
```

### Checking Logs

```bash
# Container logs (production)
sudo docker logs daylight-station 2>&1 | grep barcode

# Key log events:
# barcode.mqtt.scan        — adapter received and parsed a barcode
# barcode.command           — command dispatched to screen
# barcode.approved          — content scan approved by gatekeeper
# barcode.denied            — content scan denied by gatekeeper
# barcode.unknownDevice     — scanner not in devices.yml
# barcode.unknownCommand    — command not in COMMAND_MAP
```

---

## QR Code Generation

Generate styled SVG QR codes for barcode cards via the API. Supports raw data encoding, content metadata resolution with auto-generated labels/thumbnails, and command icon auto-detection.

### API

```bash
# Raw mode — encode any string
curl "http://localhost:3111/api/v1/qrcode?data=office;plex;595104+shuffle&label=My+Album"

# Content mode — auto-resolve metadata (title, thumbnail, artist)
curl "http://localhost:3111/api/v1/qrcode?content=plex:595084&screen=office&options=shuffle"

# Command auto-detect — uses matching icon as logo
curl "http://localhost:3111/api/v1/qrcode?data=pause"
curl "http://localhost:3111/api/v1/qrcode?data=office;volume;30"
```

Response: `Content-Type: image/svg+xml` with all images base64-embedded (works for print, PDF, and screen).

### Parameters

| Param | Default | Description |
|-------|---------|-------------|
| `data` | — | Raw string to encode |
| `content` | — | ContentId to resolve metadata |
| `options` | — | Content options (`shuffle`, `shader=dark`) |
| `screen` | — | Screen prefix to prepend |
| `label` | auto | Override label text |
| `sublabel` | auto | Override sublabel text |
| `logo` | favicon | Logo path or `false` to disable |
| `size` | 300 | QR size in pixels |
| `style` | dots | `dots` (circles) or `squares` |
| `fg` | #000 | Foreground color |
| `bg` | #fff | Background color |

### Architecture

| File | Purpose |
|------|---------|
| `backend/src/1_rendering/qrcode/QRCodeRenderer.mjs` | SVG renderer — dots, finder patterns, logo, frame, labels |
| `backend/src/1_rendering/qrcode/qrcodeTheme.mjs` | Theme constants |
| `backend/src/4_api/v1/routers/qrcode.mjs` | Express router — raw/content/command modes |
