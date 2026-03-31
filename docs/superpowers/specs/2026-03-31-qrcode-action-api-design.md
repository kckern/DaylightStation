# QR Code Action-Based API

**Date:** 2026-03-31
**Status:** Approved

## Problem

The current QR code API uses `?content=plex:595103&options=shuffle` which doesn't express the action (queue vs play vs open) and requires a separate `options` param with `+` delimiters. The encoded barcode string also doesn't include the action, so the barcode handler has to guess intent.

Additionally, thumbnails don't appear for some content IDs (e.g., `plex:595103`) despite the content adapter supporting them — likely a wiring issue in the content resolution path.

## Solution

Action-based API params where the action key (`queue`, `play`, `open`) is the param name, bare keys are boolean options, and the default screen comes from device config.

## API Shape

```
GET /api/v1/qrcode?queue=plex:595103&shuffle
GET /api/v1/qrcode?play=plex:62450&loop
GET /api/v1/qrcode?open=weekly-review
GET /api/v1/qrcode?queue=plex:595103&shuffle&screen=office
```

### Params

| Param | Required | Description |
|-------|----------|-------------|
| `queue` | One of queue/play/open | Content ID to queue |
| `play` | One of queue/play/open | Content ID to play |
| `open` | One of queue/play/open | Menu/app to open |
| `screen` | No | Target screen override. Default: `target_screen` from barcode scanner device in `devices.yml` |
| `shuffle`, `loop`, `continuous`, etc. | No | Bare keys parsed as boolean options |
| `label` | No | Override label text |
| `sublabel` | No | Override sublabel text |
| `size`, `style`, `fg`, `bg`, `logo` | No | Existing rendering params, unchanged |

### Backward Compatibility

The existing `?content=` and `?data=` params continue to work unchanged. The new action params are an alternative entry point into the same rendering pipeline.

## Encoded Barcode String

Format: `[screen:]action:contentId[+option1+option2]`

| API Call | Encoded String |
|----------|---------------|
| `?queue=plex:595103&shuffle` | `queue:plex:595103+shuffle` |
| `?play=plex:62450` | `play:plex:62450` |
| `?open=weekly-review` | `open:weekly-review` |
| `?queue=plex:595103&shuffle&screen=office` | `office:queue:plex:595103+shuffle` |

The default screen (from `devices.yml`) is **not** included in the encoded string — the barcode scanner already knows its target. Only an explicit non-default screen is prepended.

## Content Resolution

The action and options only affect the encoded barcode string. Content metadata (title, sublabel, thumbnail) is resolved the same way as today:

1. Extract contentId from the action param value
2. Call `contentIdResolver.resolve(contentId)` → get adapter + localId
3. Call `adapter.getItem(localId)` → get title, metadata, thumbnail
4. If thumbnail exists, fetch as base64 → use cover layout

The thumbnail issue with `plex:595103` needs to be debugged during implementation — `getItem` should return thumbnails for albums/collections. If the resolver or adapter isn't finding the item, that's the bug to fix.

## Option Detection

Bare query params (keys with no value or empty value) are parsed as boolean options:

```
?queue=plex:595103&shuffle&continuous
```

Express parses `&shuffle` as `req.query.shuffle = ''`. Any query param that:
- Is not a known param (`queue`, `play`, `open`, `screen`, `label`, `sublabel`, `size`, `style`, `fg`, `bg`, `logo`, `data`, `content`, `options`)
- Has an empty string value

...is treated as a boolean option and appended to the encoded string as `+option`.

## Default Screen

The default screen comes from the barcode scanner device config in `devices.yml`:

```yaml
symbol-scanner:
  type: barcode-scanner
  target_screen: living-room
```

The QR code router needs access to this value. Pass it as `defaultScreen` when creating the router, resolved from `devicesConfig` at bootstrap time.

## Changes

| File | Change |
|------|--------|
| `backend/src/4_api/v1/routers/qrcode.mjs` | Add action param parsing: detect `queue`/`play`/`open`, extract options from bare keys, build encoded string, resolve default screen. Delegate to existing `resolveContent` for metadata. |
| Bootstrap/wiring (where QR router is created) | Pass `defaultScreen` to the QR code router config, derived from the barcode scanner's `target_screen` in `devicesConfig` |

### No Changes

- `QRCodeRenderer.mjs` — already handles cover layout when `coverData` is provided
- `BarcodeCommandMap.mjs` — the encoded string format is already parseable by the existing scanner handler
- `WebSocketContentAdapter` / `FullyKioskContentAdapter` — content delivery is unchanged
