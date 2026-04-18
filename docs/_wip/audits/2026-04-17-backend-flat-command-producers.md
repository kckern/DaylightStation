# Backend Flat-Shape Command Producers — Audit

> Generated during foundation Phase 1 Task 1.3. After Task 1.2's hard cutover,
> `useScreenCommands` no longer accepts flat-shape messages. This audit catalogs
> backend code paths that still PUBLISH flat-shape messages to devices. These
> must be migrated to the structured envelope (via `buildCommandEnvelope` from
> `@shared-contracts/media`) before any affected code path is exercised against
> a foundation-era frontend.
>
> Migration is NOT done in this phase — it belongs with Phase 3 endpoints
> (the session-control API) or later.

## Context

A "flat-shape command message" is a WebSocket payload that the legacy
`useScreenCommands` parser recognised as a device command via the presence of
one or more bare top-level keys, e.g.:

- `{ playback: 'pause' }`
- `{ play: 'plex:12345' }`
- `{ queue: 'hymn:113' }`
- `{ shader: 'dark' }`
- `{ volume: 30 }`
- `{ action: 'reset' }`  / `{ action: 'sleep' }` / `{ action: 'reload' }`
- `{ hymn: '113' }` / `{ scripture: '1-ne-1' }` / `{ primary: 42 }` (etc.)
- `{ menu: 'scripture' }`
- `{ rate: 1.5 }`

The replacement shape is a CommandEnvelope (§6.2):

```json
{
  "type": "command",
  "targetDevice": "tv-1",
  "targetScreen": "screen-a",
  "commandId": "uuid-v4",
  "command": "transport|queue|config|adopt-snapshot|system",
  "params": { /* kind-specific */ },
  "ts": "ISO-8601"
}
```

Build these via `buildCommandEnvelope(...)` from
`@shared-contracts/media/envelopes.mjs` (backend: `#shared-contracts/media/envelopes.mjs`).

## Findings

| File | Line(s) | Flat-shape keys | Notes / call path |
|------|---------|-----------------|-------------------|
| `backend/src/2_domains/barcode/BarcodeCommandMap.mjs` | 11–23 | `{ playback }`, `{ shader }`, `{ volume }`, `{ rate }`, `{ action }` | COMMAND_MAP factory — each entry returns a flat object. Consumed by `resolveCommand` (same file). |
| `backend/src/3_applications/barcode/BarcodeScanService.mjs` | 78–102 | spreads `wsPayload` (see above) + `source: 'barcode'`, `device`, `targetScreen` | `#handleCommand()` emits the flat payload via `broadcastEvent(targetScreen, { ...wsPayload, source: 'barcode', device, targetScreen })`. This is THE primary flat-command publisher for physical barcode scans. |
| `backend/src/3_applications/barcode/BarcodeScanService.mjs` | 142–149 | `{ action, contentId, ...options, source, device, targetScreen }` | `#handleContent()` — broadcasts content approval to the screen. `action` is `'play' \| 'queue' \| 'open'`; content keys like `contentId` + spread options. The legacy parser's `source === 'barcode'` branch consumed these. |
| `backend/src/3_applications/devices/services/WakeAndLoadService.mjs` | 262–264 | `{ topic, targetDevice, ...contentQuery }` | WS-first content delivery. `contentQuery` contains the same flat content keys (`queue`, `shuffle`, `prewarmToken`, …) that the legacy parser extracted via LEGACY_COLLECTION_KEYS / CONTENT_KEYS. |
| `backend/src/3_applications/devices/services/WakeAndLoadService.mjs` | 327–330 | `{ targetDevice, ...contentQuery }` | Fallback path when the REST-based loadContent fails — broadcasts the same flat payload to trigger the WS content pickup. |
| `backend/src/1_adapters/devices/WebSocketContentAdapter.mjs` | 67–99 | `{ ...query, timestamp }` | `load(path, query)` spreads the content query flat and broadcasts on its configured topic. Comment at line 72–73 explicitly calls this out: "spread query params at top level so the frontend websocketHandler can detect keys (play, queue, hymn, etc.)". This entire comment is a migration TODO. |
| `backend/src/app.mjs` | 1293 | (wrapper) | `broadcastEvent: (topic, payload) => broadcastEvent({ topic, ...payload }) || 0` — the wiring that lets BarcodeScanService's flat payload reach the screen-targeted WS topic. Not itself a producer, but a migration reference point. |

## Secondary — NOT flat-command producers (ignore during migration)

Catalogued here so that future auditors don't double-count them:

- `backend/src/app.mjs:661,667,673,676,684` — `eventBus.broadcast('media:queue', queue.toJSON())`. This is a queue _state broadcast_ on the `media:queue` topic, NOT a command envelope. It is a broadcast shape (§6.4 broadcast family), not a flat command.
- `backend/src/app.mjs:701` — `eventBus.broadcast('playback:${broadcastId}', message)`. Playback state broadcast (§9.10). Consumed by `useDeviceMonitor`; already suppressed by `useScreenCommands` via the `topic === 'playback_state'` short-circuit.
- `backend/src/4_api/v1/routers/media.mjs:57-58` — `broadcastEvent('media:queue', queue.toJSON())`. Same as above — queue state broadcast.
- `backend/src/1_adapters/notification/AppNotificationAdapter.mjs:20` — `notification` topic broadcast. Not a device command.
- `backend/src/2_domains/barcode/BarcodePayload.mjs:93` and `backend/src/1_adapters/telegram/TelegramWebhookParser.mjs:155` — internal `type: 'command'` fields on DOMAIN payloads, not WS envelopes. These feed `BarcodeScanService#handleCommand` which is already catalogued above.
- `backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs` / `.../kiosk/KioskAdapter.mjs` / `.../tasker/TaskerAdapter.mjs` — all `sendCommand(...)` methods are HTTP calls to external device REST APIs (Fully Kiosk Browser, Tasker, Kiosk Browser), NOT WS messages. Out of scope.

## Recommended action

When Phase 3 (the session-control API) lands, each producer listed in
"Findings" above must be rewritten to emit a CommandEnvelope:

1. **Barcode command path** (`BarcodeCommandMap` + `BarcodeScanService#handleCommand`) —
   Replace `COMMAND_MAP` entries with functions returning CommandEnvelope
   params:
   - `pause/play/stop/next/prev/ffw/rew` → `{ command: 'transport', params: { action: 'pause' | ... } }` (note: map `next`→`skipNext`, `prev`→`skipPrev`, `ffw`/`rew` → `seekRel` with value)
   - `off` → `{ command: 'system', params: { action: 'sleep' } }`
   - `stop` → `{ command: 'system', params: { action: 'reset' } }`
   - `blackout` → `{ command: 'config', params: { setting: 'shader', value: 'blackout' } }`
   - `volume` → `{ command: 'config', params: { setting: 'volume', value: N } }`
   - `speed` → (no direct equivalent yet; see Phase 3 design — likely `transport.seekRel` is wrong; design a `playbackRate` setting)
   Wrap the return via `buildCommandEnvelope({ targetDevice, targetScreen, commandId, command, params })`.

2. **Barcode content path** (`BarcodeScanService#handleContent`) —
   Replace the flat `{ action, contentId, ...options }` broadcast with a
   queue-op envelope:
   - `action: 'play'` → `command: 'queue'`, `params: { op: 'play-now', contentId, ...options }`
   - `action: 'queue'` → `command: 'queue'`, `params: { op: 'add', contentId, ...options }`
   - `action: 'open'` — not a queue op; likely becomes a `system` or a dedicated `menu:open` envelope (out of scope for this pass; revisit in Phase 3).

3. **WakeAndLoadService WS-first / WS-fallback content broadcast** —
   Replace the two `{ targetDevice, ...contentQuery }` broadcasts with an
   `adopt-snapshot` envelope carrying a `SessionSnapshot` that seeds the
   device to the desired content/queue. This is the natural fit for the
   "cold start, then hand over state" flow.

4. **WebSocketContentAdapter.load()** —
   Replace the flat-query broadcast with a structured envelope. The exact
   kind depends on what `query` contains; in practice this is always
   queue-adjacent, so most calls become `{ command: 'queue', params: { op: 'play-now', contentId, ... } }` or `adopt-snapshot`.

5. **Tests** —
   Each migration should update its consumer tests AND add a backend-side
   assertion that the envelope is `validateCommandEnvelope().valid === true`
   before it's broadcast.

See `docs/plans/2026-04-17-media-foundation.md` §Phase 3 for the canonical
sequence.
