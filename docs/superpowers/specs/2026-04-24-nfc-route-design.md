# NFC Route — Design

**Date:** 2026-04-24
**Status:** Approved, ready for implementation

## Goal

Register physical NFC tags (stickers etc.) so kids can tap them on a reader to trigger an action — usually playing content on a screen, sometimes a home-automation action. Multiple readers across rooms, with reader-level defaults and per-tag overrides.

## URL

```
GET /api/v1/nfc/:readerId/:tagUid
GET /api/v1/nfc/:readerId/:tagUid?dryRun=1
```

GET (not POST) so an ESP32 can fire a single `wget`/`curl` line. NFC readers are *trigger sources*, not display devices, so they live under `/nfc/`, not under `/device/`.

## Config — `data/household/config/nfc.yml`

```yaml
readers:
  livingroom-nfc:
    target: livingroom-tv      # default playback target
    action: queue              # default action type
    location: livingroom       # informational
    auth_token: null           # optional shared secret
  office-nfc:
    target: office-tv
    action: play

tags:
  # Shorthand — single content-prefix key, inherits reader defaults
  83_8e_68_06:
    plex: 620707

  # Verbose override
  aa_bb_cc_dd:
    action: play
    target: kitchen-speaker
    content: hymn:166
    volume: 60

  # Home automation
  ee_ff_00_11:
    action: scene
    scene: scene.movie_night

  22_33_44_55:
    action: ha-service
    service: light.turn_off
    entity: light.livingroom
```

**Resolution rule:** merge `readers[readerId]` defaults under `tags[tagUid]` overrides. Shorthand expansion: if a tag has exactly one key matching a known content prefix (verified via `ContentIdResolver`), expand it to `{ content: '<prefix>:<value>', action: <reader default> }`.

## Action types (Phase 1)

| Action | Effect |
|---|---|
| `queue` | `WakeAndLoadService.execute(target, { queue: contentId, ...params })` |
| `play` | `WakeAndLoadService.execute(target, { play: contentId, ...params })` |
| `open` | `device.loadContent(path, query)` — open an app screen without media |
| `scene` | `haGateway.callService('scene', 'turn_on', { entity_id })` |
| `ha-service` | `haGateway.callService(domain, service, { entity_id, ...data })` — generic escape hatch |

Unknown action → 400. Adding a new type is a one-line registry addition; no route change.

## Request flow

```
1. Look up reader        → readers[readerId]   else 404 reader-not-found
2. Auth                  → if reader.auth_token set, require ?token= match  else 401
3. Look up tag           → tags[tagUid]         else 404 tag-not-registered (logged for register flow)
4. Merge + expand        → reader defaults <- tag overrides; shorthand → content
5. Validate intent       → action ∈ registry, required fields present  else 400
6. Dispatch              → handlers[intent.action](intent, deps)
7. Respond               → { ok, readerId, tagUid, action, target?, dispatch, dispatchId }
```

Status codes: `200` (handler dispatched, even if sub-step failed — mirrors `/device/:id/load`), `400` (validation), `401` (auth), `404` (unknown reader/tag), `502` (handler threw).

## Observability

- Every scan emits structured log `nfc.scan` with `{readerId, tagUid, registered, action, target, dispatchId, ok, elapsedMs}`. Unregistered scans still log so a future "register a tag" UI can surface them.
- WS broadcast on topic `nfc:<readerId>` with the same payload, for phone UIs.
- Reuses `wakeAndLoadService`'s `dispatchId` so the wake-progress events for an NFC-triggered load correlate end-to-end.

## File layout

```
backend/src/
├── 2_domains/nfc/
│   ├── NfcConfig.mjs              parseNfcConfig() validation
│   └── NfcIntent.mjs              resolveIntent() merge + shorthand expansion
├── 3_applications/nfc/
│   ├── actionHandlers.mjs         registry: queue/play/open/scene/ha-service
│   └── NfcService.mjs             handleScan() orchestrator
└── 4_api/v1/routers/
    └── nfc.mjs                    GET /:readerId/:tagUid route
```

## Out of scope (Phase 1)

- Tag registration UI (a YAML edit + container restart is fine for now)
- Idempotency / debounce (kids re-tapping is a feature; revisit if it bites)
- Live config reload (see if it falls out of `ConfigService`; otherwise document boot-only)
- Frontend phone UI for `nfc.scan` events
