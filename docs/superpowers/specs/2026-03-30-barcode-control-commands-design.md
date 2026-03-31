# Barcode Control Commands Design

Extend the barcode → screen pipeline to support playback control commands (pause, next, volume, etc.) triggered by scanning physical barcode cards.

**Date:** 2026-03-30

---

## Overview

```
Barcode scan: "office;pause"
    │
    ▼
MQTTBarcodeAdapter (existing)
    │  parse → BarcodePayload (type: 'command')
    ▼
BarcodeScanService (existing)
    │  type === 'command' → look up COMMAND_MAP → broadcast
    │  (skip gatekeeper — commands don't need approval)
    ▼
WS broadcast to target screen
    │  { playback: 'pause' }
    ▼
useScreenCommands (existing)
    │  data.playback → bus.emit('media:playback')
    ▼
Player pauses
```

---

## Barcode Formats

The parser distinguishes **commands** from **content** by checking segments against a known commands list. Commands are checked first — if no match, fall through to existing content parsing.

### Command Barcodes

| Barcode | Screen | Command | Arg |
|---------|--------|---------|-----|
| `pause` | default | `pause` | — |
| `office:pause` | `office` | `pause` | — |
| `office:volume:30` | `office` | `volume` | `30` |
| `speed:1.5` | default | `speed` | `1.5` |
| `living-room:blackout` | `living-room` | `blackout` | — |

### Content Barcodes (unchanged)

| Barcode | Screen | Action | ContentId |
|---------|--------|--------|-----------|
| `plex:12345` | default | default | `plex:12345` |
| `office:play:plex:12345` | `office` | `play` | `plex:12345` |

### Parse Flow

1. Normalize delimiters (`;` and spaces → `:`)
2. Split into segments
3. **Command check (only for 1-3 segments):** Commands have at most 3 segments (`screen:command:arg`). Barcodes with 4+ segments skip command detection and go straight to content parsing. This avoids ambiguity where `play` is both a command and an action — `play:plex:12345` (4 segments after action expansion) falls through to content parsing.
4. For 1 segment: if it's a known command → command, no screen, no arg
5. For 2 segments: if first is a known command → command + arg. If second is a known command → screen + command.
6. For 3 segments: second must be a known command → screen + command + arg
7. If no command match → existing content parsing logic (2-4 segments)

---

## BarcodePayload Changes

New properties:
- `.type` — `'command'` or `'content'`
- `.command` — command name (e.g. `pause`, `volume`), null for content
- `.commandArg` — parameter value (e.g. `30`, `1.5`), null if no arg or content type

For command barcodes, `.contentId` and `.action` are null.
For content barcodes, `.command` and `.commandArg` are null.

`BarcodePayload.parse()` signature adds `knownCommands` parameter:
```javascript
static parse(message, knownActions = [], knownCommands = [])
```

---

## BarcodeCommandMap

**File:** `backend/src/2_domains/barcode/BarcodeCommandMap.mjs`

Hardcoded mapping from command names to WS broadcast payloads. Functions to support parameterized commands.

```javascript
const COMMAND_MAP = {
  pause:    () => ({ playback: 'pause' }),
  play:     () => ({ playback: 'play' }),
  next:     () => ({ playback: 'next' }),
  prev:     () => ({ playback: 'prev' }),
  ffw:      () => ({ playback: 'fwd' }),
  rew:      () => ({ playback: 'rew' }),
  stop:     () => ({ action: 'reset' }),
  off:      () => ({ action: 'sleep' }),
  blackout: () => ({ shader: 'blackout' }),
  volume:   (arg) => ({ volume: Number(arg) }),
  speed:    (arg) => ({ rate: Number(arg) }),
};

export const KNOWN_COMMANDS = Object.keys(COMMAND_MAP);
```

Single source of truth — the known commands list is derived from the map keys.

---

## BarcodeScanService Changes

`handle()` branches on `payload.type`:

- **`content`** → existing flow (resolve screen/action → gatekeeper → broadcast)
- **`command`** → look up `COMMAND_MAP[payload.command]`, call with `payload.commandArg`, broadcast result to target screen. Skip gatekeeper — control commands don't need approval.

Unknown commands (not in map) are logged and dropped.

---

## Frontend — useScreenCommands Additions

The existing hook handles `data.playback` and `data.action` (reset/reload). New handlers needed for command payloads that use keys not yet handled:

| WS key | ActionBus event | Payload |
|--------|-----------------|---------|
| `shader` | `display:shader` | `{ shader: value }` |
| `volume` | `display:volume` | `{ level: value }` |
| `rate` | `media:rate` | `{ rate: value }` |
| `action: 'sleep'` | `display:sleep` | `{}` |

Add these as handler blocks in `useScreenCommands`, and add `msg.shader`, `msg.volume`, `msg.rate` to the WS filter predicate.

---

## MQTTBarcodeAdapter Changes

Accept `knownCommands` in options and pass to `BarcodePayload.parse()` alongside `knownActions`.

---

## Bootstrap Wiring Changes

- Import `KNOWN_COMMANDS` from `BarcodeCommandMap.mjs`
- Import `COMMAND_MAP` into `BarcodeScanService` (or pass via constructor)
- Pass `knownCommands` through adapter config in `bootstrap.mjs` and `app.mjs`

---

## File Summary

| Layer | File | Change |
|-------|------|--------|
| Domain | `backend/src/2_domains/barcode/BarcodePayload.mjs` | Add `type`, `command`, `commandArg`. Parse commands before content. Accept `knownCommands`. |
| Domain | `backend/src/2_domains/barcode/BarcodeCommandMap.mjs` | New — command → WS payload map, exports `COMMAND_MAP` and `KNOWN_COMMANDS` |
| Application | `backend/src/3_applications/barcode/BarcodeScanService.mjs` | Branch on `payload.type`. Command path: map lookup → broadcast, skip gatekeeper. |
| Adapter | `backend/src/1_adapters/hardware/mqtt-barcode/MQTTBarcodeAdapter.mjs` | Accept `knownCommands`, pass to `BarcodePayload.parse()` |
| Frontend | `frontend/src/screen-framework/commands/useScreenCommands.js` | Add `shader`, `volume`, `rate`, `sleep` handlers. Update WS filter. |
| System | `backend/src/0_system/bootstrap.mjs` | Import `KNOWN_COMMANDS`, pass to adapter config |
| System | `backend/src/app.mjs` | Pass `knownCommands` in barcode config |
| Test | `tests/isolated/domain/barcode/BarcodePayload.test.mjs` | Add command parsing tests |
| Test | `tests/isolated/domain/barcode/BarcodeCommandMap.test.mjs` | New — command map tests |
| Test | `tests/isolated/assembly/barcode/BarcodeScanService.test.mjs` | Add command handling tests |
