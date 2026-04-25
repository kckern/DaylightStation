# Trigger Endpoint

Generic HTTP entry point for any physical input device (NFC reader, barcode scanner, voice mic, button, door sensor, biometric reader). The reader fires a single GET; the server resolves the `(location, type, value)` tuple against a registry and dispatches a configured action.

## URL Shape

```
GET /api/v1/trigger/<location>/<type>/<value>
```

| Segment | Meaning | Example |
|---------|---------|---------|
| `<location>` | Where the device is installed | `livingroom`, `office`, `frontdoor` |
| `<type>` | Modality of the reader | `nfc`, `barcode`, `voice`, `keycard`, `fingerprint` |
| `<value>` | Modality-specific identifier (lowercased server-side) | NFC tag UID, barcode payload, keyword |

## Query Params

| Param | Required | Effect |
|-------|----------|--------|
| `token` | Only if the location declares `auth_token` | Must match exactly; otherwise 401 |
| `dryRun=1` (or `true`) | No | Resolves the intent and emits the event but skips the action handler; returns `dryRun: true` |

## Status Codes

| Code | `code` field | Meaning |
|------|--------------|---------|
| 200 | (none, `ok: true`) | Trigger fired, action dispatched (or dry-run resolved) |
| 400 | `INVALID_INTENT` | `resolveIntent` rejected the entry (missing required fields) |
| 400 | `UNKNOWN_ACTION` | Resolved action name has no registered handler |
| 401 | `AUTH_FAILED` | Location requires `auth_token` and query `token` did not match |
| 404 | `LOCATION_NOT_FOUND` | No top-level entry for `<location>` in the registry |
| 404 | `TRIGGER_NOT_REGISTERED` | Location exists but `<value>` not in its entries |
| 502 | `DISPATCH_FAILED` | Handler threw at runtime (HA down, target device unreachable, etc.) |

Successful response shape:

```json
{
  "ok": true,
  "location": "livingroom",
  "type": "nfc",
  "value": "04a1b2c3d4",
  "action": "play",
  "target": "tv",
  "dispatchId": "…uuid…",
  "dispatch": { /* handler-specific result */ },
  "elapsedMs": 12
}
```

## Config File

`data/household/config/nfc.yml` (the NFC modality file; future modalities live in their own files — see below). Bootstrap is permissive: if the file is missing or malformed, a warning is logged and the registry is empty — every trigger returns 404 `LOCATION_NOT_FOUND`, but the rest of the app boots normally.

Location-rooted shape:

```yaml
livingroom:
  target: tv                 # default device for this location (required)
  action: play               # default action for this location
  auth_token: s3cret         # optional; if set, ?token=… must match
  tags:                      # entries key for type=nfc (barcode → codes, voice → keywords)
    "04a1b2c3d4":
      plex: 12345            # shorthand: resolves via ContentIdResolver to "plex:12345"
    "04ffeeddcc":
      action: scene
      scene: scene.movie_night
    "04112233aa":
      action: open
      target: kitchen-display
      path: /weather
office:
  target: monitor
  action: queue
  tags:
    "04beefcafe":
      content: youtube:dQw4w9WgXcQ
```

Per-tag entries inherit `target` and `action` from the location and may override either. Reserved keys: `action`, `target`, `content`, `scene`, `service`, `entity`, `data`. Any other key becomes a member of `intent.params`. If exactly one non-reserved key is present and no explicit `content`, that key is treated as a content prefix and joined as `prefix:value` (e.g. `plex: 12345` → `content: "plex:12345"`).

## Adding a New Tag

Append under the location's entries map:

```yaml
livingroom:
  tags:
    "04newtaguid":
      plex: 67890
```

## Adding a New Location

Add a top-level key with a `target` (required) and optional `action`/`auth_token`:

```yaml
frontdoor:
  target: doorbell-display
  action: scene
  auth_token: door-secret
  tags:
    "04doorkey1":
      scene: scene.welcome_home
```

## Action Types

| Action | What it does | Example tag entry |
|--------|--------------|-------------------|
| `play` | `wakeAndLoadService.execute(target, { play: content, ...params })` — wake target device and play content immediately | `{ action: play, target: tv, content: plex:12345 }` |
| `queue` | Same as `play` but uses `queue` key — appends to target's queue | `{ action: queue, target: tv, plex: 12345 }` |
| `open` | `device.loadContent(path, params)` — load an arbitrary URL/path on target | `{ action: open, target: kitchen, path: /weather }` |
| `scene` | `haGateway.callService('scene', 'turn_on', { entity_id: scene })` | `{ action: scene, scene: scene.movie_night }` |
| `ha-service` | `haGateway.callService(domain, service, { ...data, entity_id: entity })` — `service` is `domain.service` | `{ action: ha-service, service: light.turn_on, entity: light.kitchen, data: { brightness: 200 } }` |

## ESP32 Firmware Contract

Single fire-and-forget GET. The reader knows its own `<location>` and `<type>`; firmware only supplies `<uid>`:

```
http://<host>:<port>/api/v1/trigger/<location>/<type>/<uid>
```

Server responds within ~50ms with JSON. Reader does not need to keep the connection open or parse the body — non-200 status is sufficient signal for an LED/buzzer feedback. Example:

```bash
curl "http://homeserver.local:3111/api/v1/trigger/livingroom/nfc/04a1b2c3d4"
curl "http://homeserver.local:3111/api/v1/trigger/frontdoor/nfc/04doorkey1?token=door-secret"
curl "http://homeserver.local:3111/api/v1/trigger/livingroom/nfc/04a1b2c3d4?dryRun=1"
```

## Future Modalities

`barcode`, `voice`, etc. are reserved `type` values for when those readers come online. Each lives in its own YAML file (`barcode.yml`, `voice.yml`) and feeds the same location-rooted registry under a different entries key (`codes` for barcode, `keywords` for voice — see `ENTRIES_KEY_BY_TYPE` in `TriggerConfig.mjs`).
