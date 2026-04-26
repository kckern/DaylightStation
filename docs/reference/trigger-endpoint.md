# Trigger Endpoint

Generic HTTP entry point for any physical input device (NFC reader, barcode scanner, voice mic, button, door sensor, biometric reader). The reader fires a single GET; the server resolves the `(location, type, value)` tuple against a registry and dispatches a configured action.

**Config layout:** Trigger configs live under `data/household/config/triggers/<modality>/`. See [`trigger/schema.md`](./trigger/schema.md) for the full schema reference.

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

## Config Files

Config is split across two files per modality under `data/household/config/triggers/`. Bootstrap is permissive: missing or malformed files log a warning and produce an empty registry — every trigger returns 404 `LOCATION_NOT_FOUND`, but the rest of the app boots normally.

**`triggers/nfc/locations.yml`** — reader locations and per-reader defaults:

```yaml
livingroom:
  target: livingroom-tv      # device that receives the resolved load command (required)
  action: play               # default action for tags scanned at this reader
  auth_token: s3cret         # optional; if set, ?token=… must match
office:
  target: office-monitor
  action: queue
```

**`triggers/nfc/tags.yml`** — universal tag registry (tags recognized at any reader):

```yaml
"04a1b2c3d4":
  plex: 12345                # shorthand: resolves to content: "plex:12345"
"04ffeeddcc":
  action: scene
  scene: scene.movie_night
"04112233aa":
  action: open
  target: kitchen-display
  path: /weather
  livingroom:                # per-reader override (key must match a reader ID)
    shader: blackout
"04beefcafe":
  content: youtube:dQw4w9WgXcQ
```

Per-tag entries inherit `target` and `action` from the matching location and may override either. Reserved keys: `action`, `target`, `content`, `scene`, `service`, `entity`, `data`. Any other scalar key becomes a load-query param. If exactly one non-reserved scalar key is present and no explicit `content`, that key is treated as a content prefix joined as `prefix:value` (e.g. `plex: 12345` → `content: "plex:12345"`). Object-valued keys are treated as per-reader override blocks — the key must match a registered reader ID or a `ValidationError` is thrown.

See [`trigger/schema.md`](./trigger/schema.md) for the complete field reference and disambiguation rules.

## Adding a New Tag

Append to `triggers/nfc/tags.yml`:

```yaml
"04newtaguid":
  plex: 67890
```

The tag is recognized at every reader listed in `nfc/locations.yml`. To override behavior at a specific reader, add a per-reader block:

```yaml
"04newtaguid":
  plex: 67890
  office:                    # only applies when scanned at the office reader
    shader: focused
```

## Adding a New Location

Add a top-level entry to `triggers/nfc/locations.yml` with a `target` (required) and optional `action`/`auth_token`:

```yaml
frontdoor:
  target: doorbell-display
  action: scene
  auth_token: door-secret
```

Then add any tags for that reader in `triggers/nfc/tags.yml` (using per-reader override blocks if the behavior differs from other readers):

```yaml
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

`barcode`, `voice`, etc. are reserved `type` values for when those readers come online. Each modality lives in its own subdirectory under `triggers/` (e.g. `triggers/barcode/`, `triggers/voice/`) with its own `locations.yml` and modality-specific registry file. See [`trigger/schema.md`](./trigger/schema.md) for the layout conventions.
