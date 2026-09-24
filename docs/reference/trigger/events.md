# Trigger Events — Domain & Screen Integration

How a trigger fires, what the server does with it, and how a screen-framework display can react. The HTTP/URL contract lives in [`../trigger-endpoint.md`](../trigger-endpoint.md); this doc focuses on **what happens after** a trigger arrives.

---

## Two Output Paths, One Event

A single `GET /api/v1/trigger/<location>/<type>/<value>` produces **two parallel side effects**:

| Path | Mechanism | Audience |
|------|-----------|----------|
| **Direct dispatch** | `actionHandlers[intent.action]` runs server-side (calls `wakeAndLoadService`, `haGateway`, or `deviceService`) | The configured `target` device (TV, kitchen display, light, etc.) |
| **Event broadcast** | WebSocket message published on topic `trigger:<location>:<modality>` with `type: 'trigger.fired'` | Anyone subscribed — typically a screen-framework display |

The direct dispatch is what the user *intended* (play this video; activate this scene). The broadcast is an open hook for *observers* — a dashboard that wants to flash a toast, a kiosk that wants to surface a PIP, an analytics sink, etc. Observers don't need any new server code; they just declare a `subscriptions:` block in their screen YAML.

---

## Event Lifecycle

```
ESP32/scanner          backend                                    WebSocket             screen-framework
─────────────          ────────────────────────────────           ─────────             ────────────────
GET /trigger/X/Y/Z ─→  triggerRouter
                        │
                        ▼
                       TriggerDispatchService.handleTrigger()
                        │
                        ├─ lookup config[location]  ──→ 404 LOCATION_NOT_FOUND
                        ├─ check auth_token         ──→ 401 AUTH_FAILED
                        ├─ lookup entries[value]    ──→ 404 TRIGGER_NOT_REGISTERED
                        │                                          │
                        │                                  (also broadcasts
                        │                                   unregistered fires
                        │                                   so observers know
                        │                                   a tag was seen)
                        ▼
                       resolveIntent(locationConfig, valueEntry, contentIdResolver)
                        │   merges defaults+overrides, expands {plex: 12345} shorthand
                        ▼
                       dispatchAction(intent, deps)              broadcast({
                        │                                          topic: 'trigger:X:Y',
                        ├─ play/queue → wakeAndLoadService          type: 'trigger.fired',
                        ├─ open       → device.loadContent          location, modality, value,
                        ├─ scene      → haGateway.callService       action, target,
                        └─ ha-service → haGateway.callService       dispatchId, ok
                                                                  })           │
                                                                               ▼
                                                                       useScreenSubscriptions
                                                                        matches topic, checks
                                                                        on.event === 'trigger.fired',
                                                                        resolves response.overlay
                                                                        from widget registry,
                                                                        calls showOverlay(...)
```

The two paths run **independently**. A failed dispatch (e.g. HA down) still broadcasts an event with `ok: false, error: '...'` so observers can show a failure toast.

---

## Broadcast Payload

Every trigger emits exactly one WS message. Topic and payload:

```js
{
  topic: 'trigger:livingroom:nfc',  // routing key — screens subscribe by this name
  type: 'trigger.fired',            // event kind — screens filter by this
  location: 'livingroom',
  modality: 'nfc',                  // 'nfc' | 'barcode' | 'voice' | future...
  value: '04a1b2c3d4',              // lowercased tag UID / barcode / keyword
  action: 'play',                   // resolved action (omitted on registry-miss)
  target: 'livingroom-tv',          // resolved target (omitted on registry-miss)
  dispatchId: '…uuid…',             // matches HTTP response + downstream logs
  ok: true,                         // true on success, false on dispatch failure
  // ok: false branch adds: error: '<message>'
  // dryRun branch adds:    dryRun: true
}
```

Two field names overlap deliberately:
- `modality` is the **trigger source** (`nfc` is the modality of the reader).
- `type` is the **event kind** at the WS bus level (`trigger.fired`). Subscribers filter messages by `data.type === 'trigger.fired'`.

---

## Screen Integration Recipe

Any screen YAML in `data/household/screens/<id>.yml` can subscribe. The handler lives at `frontend/src/screen-framework/subscriptions/useScreenSubscriptions.js`; each entry maps `topic → response → dismiss`.

```yaml
subscriptions:
  trigger:livingroom:nfc:        # WS topic
    on:
      event: trigger.fired       # filter — only react to fire events
    response:
      overlay: <widget>          # widget registry key
      mode: fullscreen|pip|panel|toast
      timeout: 5000              # toast/pip auto-dismiss (ms)
    dismiss:
      inactivity: 30             # seconds of silence on this topic → dismiss
```

When the message arrives, the handler:
1. Matches on `data.topic === 'trigger:livingroom:nfc'`
2. Filters by `data.event === 'trigger.fired'` (or fall through if no filter)
3. Resolves `response.overlay` from the widget registry
4. Calls `showOverlay(Component, data, { mode, priority, timeout })` — the **full event payload** lands in the component's props, so it can render `data.action`, `data.target`, `data.value`, etc.

---

## Examples

### 1. NFC tag plays a Plex movie on the TV (canonical)

**`data/household/config/triggers/nfc/locations.yml`:**

```yaml
livingroom:
  target: livingroom-tv
  action: play
```

**`data/household/config/triggers/nfc/tags.yml`:**

```yaml
"04a1b2c3d4":
  plex: 642120          # shorthand → content: "plex:642120"
```

**Tap the tag** → ESP32 fires `GET /api/v1/trigger/livingroom/nfc/04a1b2c3d4` → dispatch path runs `wakeAndLoadService.execute('livingroom-tv', { play: 'plex:642120' })`. The TV wakes, FKB navigates to the loader URL, the Player overlay mounts. **No screen subscription needed for this — the action handler does the work.**

### 2. Office dashboard shows a toast when any living-room tag fires

The office screen is *not* the target, but its operator wants to see what's happening in the living room.

**`data/household/screens/office.yml`** (add):

```yaml
subscriptions:
  trigger:livingroom:nfc:
    on:
      event: trigger.fired
    response:
      overlay: trigger-toast    # widget that renders "🎬 Now playing on TV"
      mode: toast
      timeout: 4000
```

The toast widget receives the full event payload, so it can render `Now playing ${data.value} on ${data.target}` or look up the human-readable title from a content cache.

### 3. PIP camera pops up when a "doorbell" NFC is tapped at the front door

Reuses the existing PIP machinery (same as the doorbell ring example in `living-room.yml`).

**`data/household/config/triggers/nfc/locations.yml`** (add):

```yaml
frontdoor:
  target: kitchen-display
  action: scene
  auth_token: door-secret
```

**`data/household/config/triggers/nfc/tags.yml`** (add):

```yaml
"04doorkey1":
  scene: scene.welcome_home
```

**`living-room.yml`** (add):

```yaml
subscriptions:
  trigger:frontdoor:nfc:
    on:
      event: trigger.fired
    response:
      overlay: camera
      mode: pip
      pip:
        timeout: 30
    dismiss:
      inactivity: 30
```

Tap the front-door tag → HA fires the welcome scene **and** the living-room TV PIPs the front-door camera for 30s. One trigger, two effects.

### 4. Voice routes to the Player overlay

Voice is a live modality (`modality: voice` in `triggers/sources.yml`). Two ways in:

- **Exact keyword:** `GET /api/v1/trigger/kitchen/voice/play_jazz` — the keyword must equal a
  configured command id after normalization (lowercase, non-alphanumerics → `_`). No model involved.
- **Transcript:** `POST /api/v1/trigger/kitchen/voice` with `{"transcript": "put some jazz on"}`.
  The exact keyword is tried first; otherwise the decision model (Jev) picks one of the location's
  commands or `none`. See [`schema.md` → Voice sources](./schema.md#voice-sources) for modes.

Either way the dispatch broadcasts on `trigger:kitchen:voice` with `value` = the command id, so a
kitchen-display screen subscribed to that topic shows whatever overlay you wire up. A proposal in
`confirm` mode broadcasts nothing until it is confirmed.

Speech-to-text is not part of the backend: the caller (HA Assist sentence trigger, a phone
shortcut's dictation) sends text.

### 5. Dry-run for tag onboarding

```bash
curl "http://homeserver.local:3111/api/v1/trigger/livingroom/nfc/04a1b2c3d4?dryRun=1"
```

Skips the action handler, but **still broadcasts** with `dryRun: true`. Useful for verifying tag UIDs land on the expected screen without actually waking the TV.

---

## What the Handler Actually Does Per Action

These are the side effects of the **direct dispatch** path (independent of any subscription). All defined in `backend/src/3_applications/trigger/actionHandlers.mjs`.

| Action | Handler call | Effect on `target` |
|--------|--------------|-------------------|
| `play` | `wakeAndLoadService.execute(target, { play: content, ...params })` | Wake target, load content, autoplay |
| `queue` | `wakeAndLoadService.execute(target, { queue: content, ...params })` | Wake target, append to queue |
| `open` | `device.loadContent(path, params)` | Navigate target browser to arbitrary path |
| `scene` | `haGateway.callService('scene', 'turn_on', { entity_id })` | Activate HA scene (target ignored) |
| `ha-service` | `haGateway.callService(domain, service, data)` | Arbitrary HA call (lights, switches, scripts) |

`params` = any non-reserved key on the YAML entry (e.g. `volume: 10`, `shuffle: 1`). They flow as query string into the load URL.

---

## Failure Modes (and how observers see them)

| HTTP code | Broadcast emitted? | Observer sees |
|-----------|-------------------|----------------|
| 404 LOCATION_NOT_FOUND | No | Nothing — the location isn't on the registry, so there's no topic to broadcast to |
| 404 TRIGGER_NOT_REGISTERED | **Yes** (`registered: false, error: 'trigger-not-registered'`) | A toast like "Unknown tag 04xxxx tapped at livingroom" — useful for onboarding |
| 401 AUTH_FAILED | No | Nothing |
| 400 INVALID_INTENT | **Yes** (`ok: false, error: '<msg>'`) | A failure toast |
| 502 DISPATCH_FAILED | **Yes** (`ok: false, error: '<msg>'`) | A failure toast — useful when the TV is unreachable |

Subscribed dashboards become a free observability surface for the trigger system — a tag tapped and registered always shows up on the dashboard whether the dispatch succeeded or not.

---

## Reloading the Registry

The trigger config is parsed once at boot from `data/household/config/triggers/`. There is **no in-process reload endpoint** today — picking up edits requires restarting the container (`sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight`).

**One bad entry disables only itself** (2026-09-24). At boot each source in `sources.yml` and each NFC tag is parsed on its own. A source with an unknown `modality`, a source that fails its modality's validation (for example, no `target`), or a tag that is malformed, duplicates another spelling of the same uid, or names an override reader that did not load, is left out. Each one is logged at `error` as `trigger.config.entry.skipped` with `{ kind: 'source'|'tag', id, code, message }`, and everything else registers normally. Before this, any single bad entry emptied the whole registry.

If a whole file is unusable (unreadable YAML, or a root that isn't a map), the registry still falls back to an empty shape (`{ nfc: { locations: {}, tags: {} }, state: { locations: {} } }`) and logs `trigger.config.parse.failed` (`impact: all-tags-unregistered`). The API stays up but no triggers will resolve.

## Files

- **Adapter (parsers + I/O):** `backend/src/1_adapters/trigger/{YamlTriggerConfigRepository,parsers/*}.mjs`
- **Domain (resolvers):** `backend/src/2_domains/trigger/services/{NfcResolver,StateResolver,ResolverRegistry}.mjs`
- **Application (dispatcher + actions):** `backend/src/3_applications/trigger/{TriggerDispatchService,actionHandlers}.mjs`
- **API:** `backend/src/4_api/v1/routers/trigger.mjs`
- **Bootstrap:** `createTriggerApiRouter` in `backend/src/5_composition/bootstrap.mjs`
- **Screen consumer:** `frontend/src/screen-framework/subscriptions/useScreenSubscriptions.js`
- **Tests:** `tests/isolated/{adapter,domain,application}/trigger/`
- **Schema reference:** [`schema.md`](./schema.md)

## See also

- [`schema.md`](./schema.md) — canonical YAML schema, precedence chain, and adding-a-new-modality guide
- [`../trigger-endpoint.md`](../trigger-endpoint.md) — HTTP contract, status codes, ESP32 firmware contract
- [`../core/screen-framework.md`](../core/screen-framework.md) — overlay slots, subscription handler, widget registry
- [`../screen-configs.md`](../screen-configs.md) — full screen YAML reference
