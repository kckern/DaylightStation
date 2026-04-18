# Media App — Technical Contracts

## 1. Scope & Conventions

This document defines every external contract the Media App relies on: HTTP
endpoints, WebSocket protocols, URL parameters, data shapes, event schemas,
log event taxonomy, and client-side persistence schemas.

This document does **not** cover: UI layout, component structure, rendering
logic, or internal state-management mechanisms. For user-facing behavior and
requirements, see [`media-app-requirements.md`](./media-app-requirements.md).
For the content paradigm (content IDs, formats, Playable Contract), see
[`docs/reference/content/`](../content/).

### Conventions

- **"Exists"** — the contract is already implemented and can be consumed as-is.
- **"Required"** — the contract is a deliverable of this app's implementation.
- **"Amended"** — the contract exists but needs additions or behavioral
  changes.
- All HTTP endpoints are rooted at `/api/v1/` unless otherwise stated.
- All JSON uses `camelCase` field names.
- All timestamps are ISO-8601 UTC strings unless otherwise marked.
- All durations in playback contexts are seconds (number, may be fractional).
- All content IDs follow the content paradigm format (`<source>:<localId>`).

### Identifiers

| Identifier | Shape | Source | Purpose |
|---|---|---|---|
| `contentId` | `<source>:<localId>` | Content paradigm | Any playable/browsable item. |
| `deviceId` | string | `devices.yml` keys | Remote surface identity. |
| `clientId` | UUID v4 | Generated per-browser, persisted in `localStorage` | Stable identity for this browser across sessions. |
| `sessionId` | UUID v4 | Generated when a session is created | Unique identifier for a single session instance; rotates on reset. |
| `displayName` | string | User-assigned in settings, falls back to `"Client <first-8-of-clientId>"` | Human-readable client label. |
| `dispatchId` | UUID v4 | Generated per dispatch action | Correlates dispatch progress events with the initiating action. |
| `commandId` | UUID v4 | Generated per command | Enables ack/idempotency correlation. |

---

## 2. HTTP APIs — Existing, Consumed

### 2.1 Content resolution

#### `GET /api/v1/play/:source/*`
Resolves a content ID to a renderable `PlayableItem`. The `*` portion is the
`localId` (may contain slashes). Supports optional query params: `shuffle`,
`shader`, `volume`, and format-specific options.

**Response (200):** `PlayableItem` — see §9.1.

#### `GET /api/v1/queue/:source/*`
Resolves a container ID to an ordered list of `PlayableItem`s.

**Query:** `shuffle` (bool), `limit` (int), `skip` (int).

**Response (200):**
```json
{
  "source": "plex-main",
  "id": "plex-main:67890",
  "count": 10,
  "totalDuration": 13200,
  "items": [ /* PlayableItem[] */ ]
}
```

#### `GET /api/v1/info/:source/*`
Returns detail metadata for a content item. Not assumed-playable.

**Response (200):** `ContentInfo` — see §9.13.

#### `GET /api/v1/display/:source/*`
Returns an image (thumbnail or generated placeholder SVG). Always 200.

**Response (200):** binary image (`image/jpeg`, `image/png`, or `image/svg+xml`).

#### `GET /api/v1/list/*`
Hierarchical catalog browse. Path modifiers `/playable`, `/shuffle`,
`/recent_on_top`. Query: `take`, `skip`.

**Response (200):** `ListResponse` — see §9.12.

#### `POST /api/v1/content/compose`
Resolves composite (visual + audio) content.

**Request:** `{ sources: string[] }`

**Response (200):** `{ visual: ...; audio: ... }`

### 2.2 Search

#### `GET /api/v1/content/query/search`
Unified non-streaming search.

**Query:**
| Param | Type | Notes |
|---|---|---|
| `text` | string | Minimum 2 characters. |
| `source` | string | Source/provider filter. |
| `mediaType` | string | `video` \| `audio` \| `image`. |
| `capability` | string | `playable` \| `displayable` \| `readable`. |
| `person` | string | Canonical name; adapters translate. |
| `creator` | string | Creator/author filter. |
| `time` | string | `2025`, `2025-06`, `2024..2025`, season keyword. |
| `take` | int | Default 50. |
| `skip` | int | For pagination. |
| `{adapter}.{key}` | string | Adapter-specific (e.g., `plex.libraryId=6,12`). |

**Response (200):** `{ query, items: SearchResult[], _perf: {...} }`

#### `GET /api/v1/content/query/search/stream`
Incremental search via Server-Sent Events.

**Event stream:**

| Event | Payload | When |
|---|---|---|
| `pending` | `{ sources: string[] }` | First, lists adapters about to run. |
| `results` | `{ source, items: SearchResult[], remaining: string[] }` | Once per adapter as it completes. |
| `complete` | `{ totalMs, resultCount }` | Final event. |
| `error` | `{ message }` | Fatal stream error. |

**App behavior requirement:** the app MUST use `/stream` for live search.

#### `GET /api/v1/media/config`
Returns media-app configuration including `searchScopes`.

**Response (200):**
```json
{
  "searchScopes": [
    {
      "label": "Movies",
      "key": "video-movies",
      "params": "source=plex&plex.libraryId=6,12",
      "children": [ /* same shape */ ]
    }
  ]
}
```

### 2.3 Device / remote surface

#### `GET /api/v1/device/config`
Returns the fleet.

**Response (200):**
```json
{
  "devices": {
    "<deviceId>": {
      "id": "<deviceId>",
      "name": "Living Room TV",
      "location": "living_room",
      "capabilities": { "wake": true, "volume": true, "shader": true },
      "defaultVolume": 50
    }
  }
}
```

#### `GET /api/v1/device/:id/load`
Dispatches content to a remote surface.

**Query:**
| Param | Type | Notes |
|---|---|---|
| `play` | contentId | Replace-and-play on the target. |
| `queue` | contentId | Build queue from container. |
| `shader` | string | Apply shader. |
| `volume` | int 0–100 | Initial volume. |
| `shuffle` | `1` | Enable shuffle. |
| `repeat` | `1` | Enable repeat. |
| `open` | path | Route the target to a specific app surface before dispatching. |
| `dispatchId` | UUID | **(amended)** Correlates WS `wake-progress` events. |

**Response (200):**
```json
{
  "ok": true,
  "deviceId": "<id>",
  "dispatchId": "<uuid>",
  "totalElapsedMs": 2418,
  "steps": [ { "step": "power", "elapsedMs": 120, "status": "success" } ]
}
```

#### `GET /api/v1/device/:id/volume/:level` *(deprecated)*
Live volume on a remote surface without re-dispatch. **Deprecated** — use
§4.5 `PUT /api/v1/device/:id/session/volume` instead. The handler is
retained for backward compatibility and emits a `device.volume.deprecated`
warn on every call.

---

## 3. Contract Gap Analysis

| Requirement | Existing? | Gap |
|---|---|---|
| C1.* (discovery, search) | ✅ | — |
| C2.* (local session) | Client | — |
| C3.1–C3.4 (local queue) | Client | — |
| C3.5 (queue ops on remote) | ❌ | Required: remote queue-control API. |
| C4.1 (fleet enumeration) | ✅ | Amended: support live config updates. |
| C4.2 (live remote state) | ⚠️ | Required: per-device state topic. |
| C4.3 (remote history) | ❌ | **Deferred** — out of scope for v1. |
| C4.4 (stale indicator) | Client | — |
| C5.2 (remote transport) | ❌ | Required: remote transport-control API. |
| C5.3 (remote queue ops) | ❌ | Required (same as C3.5). |
| C5.4 (remote volume, shader) | ⚠️ | Required: shader-set API; amend volume. |
| C6.1 (multi-target dispatch) | ⚠️ | Client-side fan-out (§4.8). |
| C6.3 (dispatch progress stream) | ✅ | Amended: include `dispatchId`. |
| C7.1 (Take Over snapshot) | ❌ | Required: `claim` endpoint (§4.6). |
| C7.2 (Hand Off full state) | ⚠️ | Required: amended dispatch with `SessionSnapshot`. |
| C8.1 (URL deep-link) | Client routing | Formal contract (§8). |
| C8.3 (local state broadcast) | ⚠️ | Required: formal `PlaybackStateBroadcast` (§9.10). |
| C8.4 (external control) | ❌ | Required: external-control WS channel + command schema. |
| C9.8 (dispatch idempotency) | ❌ | Required: `dispatchId` idempotency. |
| C10.* (observability) | Framework | Required: log taxonomy (§10). |

---

## 4. Required HTTP APIs

### 4.1 `GET /api/v1/device/:id/session`

Returns a snapshot of the remote surface's current session state.

**Response (200):** `SessionSnapshot` (§9.2)

**Response (204):** empty body when the surface is idle.

**Response (503):** offline; includes last-known snapshot:
```json
{
  "offline": true,
  "lastKnown": { /* SessionSnapshot */ },
  "lastSeenAt": "<ISO-8601>"
}
```

**Consistency requirement.** The returned snapshot MUST reflect state
already broadcast on `device-state:<id>` (§7) within 500ms.

**Verified by:**
- `backend/tests/unit/suite/4_api/v1/routers/device.session.test.mjs` — all response codes + consistency-with-liveness
- `backend/tests/unit/suite/4_api/v1/routers/device.session.integration.test.mjs` — end-to-end round trip

### 4.2 Device history — **Deferred** (see §3, C4.3)

### 4.3 `POST /api/v1/device/:id/session/transport`

Drives transport on the remote session.

**Request body:**
```json
{ "action": "play" | "pause" | "stop" | "seekAbs" | "seekRel" | "skipNext" | "skipPrev",
  "value": <number, optional>,
  "commandId": "<uuid>" }
```

**Response (200):** `{ ok: true, commandId, appliedAt }`
**Response (404):** unknown device.
**Response (409):** device offline (last-known snapshot in body).
**Response (502):** device refused/errored — `{ ok: false, error, code }`.

Retrying with the same `commandId` within 60s MUST be a no-op.

**Verified by:**
- `backend/tests/unit/suite/4_api/v1/routers/device.session-transport.test.mjs` — request validation + result mapping
- `backend/tests/unit/suite/4_api/v1/routers/device.session.integration.test.mjs` — envelope dispatch + ack round trip
- `backend/tests/unit/suite/3_applications/devices/SessionControlService.test.mjs` — idempotency (replay + conflict)

### 4.4 `POST /api/v1/device/:id/session/queue/:op`

Mutates the remote session's queue.

**`:op` values:**
| Op | Body | Semantics |
|---|---|---|
| `play-now` | `{ contentId, clearRest?: bool, commandId }` | Replace current item; queue cleared iff `clearRest` is true. |
| `play-next` | `{ contentId, commandId }` | Insert after current item. |
| `add-up-next` | `{ contentId, commandId }` | Append to Up Next sub-queue. |
| `add` | `{ contentId, commandId }` | Append to end. |
| `reorder` | `{ from, to, commandId }` OR `{ items: queueItemId[], commandId }` | Move one item or replace ordering. |
| `remove` | `{ queueItemId, commandId }` | Remove an item. |
| `jump` | `{ queueItemId, commandId }` | Jump to a specific queue item. |
| `clear` | `{ commandId }` | Clear entire queue. |

**Response (200):** `{ ok: true, commandId, queue: QueueSnapshot }`

**Verified by:**
- `backend/tests/unit/suite/4_api/v1/routers/device.session-queue.test.mjs` — per-op validation for all 8 ops
- `shared/contracts/media/envelopes.test.mjs` — envelope validator accepts each op shape

### 4.5 Session configuration setters

| Endpoint | Body |
|---|---|
| `PUT /api/v1/device/:id/session/shuffle` | `{ enabled: bool, commandId }` |
| `PUT /api/v1/device/:id/session/repeat` | `{ mode: "off" \| "one" \| "all", commandId }` |
| `PUT /api/v1/device/:id/session/shader` | `{ shader: string \| null, commandId }` |
| `PUT /api/v1/device/:id/session/volume` | `{ level: int 0-100, commandId }` |

**Verified by:**
- `backend/tests/unit/suite/4_api/v1/routers/device.session-config.test.mjs` — all four PUTs: validation + config envelope shape

### 4.6 `POST /api/v1/device/:id/session/claim`

Atomic Take Over: stops the remote session and returns its snapshot.

**Request body:** `{ commandId: "<uuid>" }`

**Response (200):**
```json
{
  "ok": true,
  "commandId": "<uuid>",
  "snapshot": { /* SessionSnapshot captured immediately before stop */ },
  "stoppedAt": "<ISO-8601>"
}
```

**Atomicity requirement (C7.4).** Server MUST guarantee that either the
snapshot is captured *and* the remote is stopped, or neither. On partial
failure, server MUST restore the remote's prior state and return 502
(`ATOMICITY_VIOLATION`).

**Verified by:**
- `backend/tests/unit/suite/4_api/v1/routers/device.session-claim.test.mjs` — router-level validation + mapping
- `backend/tests/unit/suite/4_api/v1/routers/device.session-claim.integration.test.mjs` — happy + refused paths; liveness cache unchanged on refusal
- `backend/tests/unit/suite/3_applications/devices/SessionControlService.test.mjs` — claim algorithm (snapshot-then-stop)

### 4.7 `POST /api/v1/device/:id/load` (amended)

**Request (existing, supported):** query params as documented in §2.3.

**Request (amended, new):**
```
POST /api/v1/device/:id/load
Content-Type: application/json
```
```json
{
  "dispatchId": "<uuid>",
  "snapshot": { /* SessionSnapshot */ },
  "mode": "adopt"
}
```

`"mode": "adopt"` tells the target to adopt the provided snapshot.

**Response (200):** same as existing dispatch response + `"adopted": true`.

**Idempotency (C9.8).** Repeating a dispatch with the same `dispatchId`
within 60s MUST be a no-op.

**Verified by:**
- `backend/tests/unit/suite/4_api/v1/routers/device.load-adopt.test.mjs` — adopt body validation + idempotency-conflict mapping
- `backend/tests/unit/suite/3_applications/devices/DispatchIdempotencyService.test.mjs` — 60s TTL cache semantics
- `backend/tests/unit/suite/3_applications/devices/WakeAndLoadService.test.mjs` — adoptSnapshot wake path

### 4.8 Multi-target dispatch

**Decision: Option A — client-side fan-out.** No new API. App issues N
parallel `POST /api/v1/device/:id/load` calls with independent `dispatchId`s.
Failure isolation is per-device.

---

## 5. Reserved

---

## 6. Screen-framework Contract (Device-side)

### 6.1 Authority model

- The **device** is authoritative for its own session state. Broadcasts on
  `device-state:<id>` are ground truth; controllers and the backend treat
  them as read-only.
- The **backend** is a relay. It forwards commands to devices, fans out
  device broadcasts, and synthesizes offline signals. It does not maintain
  its own copy of session state.
- On conflict (two controllers issuing commands concurrently), the device
  applies in receive order. No locking (N4.2).

### 6.2 Subscribed topic — inbound commands

All commands arrive in a structured envelope (replacing the existing flat
shape consumed by `useScreenCommands`):

```json
{
  "type": "command",
  "targetDevice": "<deviceId>",
  "targetScreen": "<screenId>",
  "commandId": "<uuid>",
  "command": "transport" | "queue" | "config" | "adopt-snapshot" | "system",
  "params": { /* command-specific */ },
  "ts": "<ISO-8601>"
}
```

- `targetDevice` / `targetScreen` MUST be validated by the device; mismatches
  ignored.
- `commandId` is required. The device MUST ack every valid command on
  `device-ack:<deviceId>`.
- Retried commands with the same `commandId` within 60s MUST be idempotent.

**Verified by:**
- `shared/contracts/media/envelopes.test.mjs` — `validateCommandEnvelope` covers all five command kinds + per-kind param validation
- `shared/contracts/media/commands.test.mjs` — enum guards for transport/queue/config/system actions
- `frontend/src/screen-framework/publishers/useCommandAckPublisher.test.jsx` — device ack publication on ActionBus completion
- `frontend/src/screen-framework/commands/useScreenCommands.test.jsx` — structured envelope consumer

#### 6.2.1 `command: "transport"`
```json
{ "action": "play" | "pause" | "stop" | "seekAbs" | "seekRel" | "skipNext" | "skipPrev",
  "value": <number> }
```
Device routes to the active renderer via the ActionBus. Seek values in seconds.

#### 6.2.2 `command: "queue"`
```json
{ "op": "play-now" | "play-next" | "add-up-next" | "add" | "reorder" | "remove" | "jump" | "clear",
  "contentId": "<contentId>",
  "queueItemId": "<id>",
  "from": "<queueItemId>", "to": "<queueItemId>",
  "items": ["<queueItemId>", ...],
  "clearRest": <bool>
}
```

#### 6.2.3 `command: "config"`
```json
{ "setting": "shuffle" | "repeat" | "shader" | "volume",
  "value": <per-setting> }
```

#### 6.2.4 `command: "adopt-snapshot"`
Used for Hand Off (C7.2). Atomic replace of current session.
```json
{ "snapshot": { /* SessionSnapshot */ },
  "autoplay": <bool, default true> }
```
Device MUST:
1. Stop any current playback; clear queue.
2. Load snapshot's queue, shader, volume, shuffle, repeat.
3. Select current item; seek to `snapshot.position` once renderer ready.
4. Resume playback if `autoplay: true`.
5. Broadcast adopted snapshot.

On any failure mid-adoption, device MUST reset to idle and ack with error.

#### 6.2.5 `command: "system"`
`reset`, `reload`, `sleep`, `wake`. Ported from existing `useScreenCommands`
into the envelope.

### 6.3 Published topic — device acks

```json
{
  "topic": "device-ack",
  "deviceId": "<id>",
  "commandId": "<uuid>",
  "ok": <bool>,
  "error": "<string>",
  "code": "<string>",
  "appliedAt": "<ISO-8601>"
}
```
Acks MUST be sent within 5 seconds of receiving the command. For long
operations, ack indicates acceptance; completion observable via state feed.

**Verified by:**
- `shared/contracts/media/envelopes.test.mjs` — `buildCommandAck` + `validateCommandAck`
- `frontend/src/screen-framework/publishers/useCommandAckPublisher.test.jsx` — ActionBus completion → ack emission
- `backend/tests/unit/suite/3_applications/devices/SessionControlService.test.mjs` — ack timeout → DEVICE_REFUSED

### 6.4 Published topic — device state

Hybrid model:

- **Reactive push** on any state change (play/pause/stop, seek, item advance,
  queue mutation, config change, adoption completion). Debounced 500ms.
- **Heartbeat** every 5s while in any non-idle state. Every 30s (or suppressed)
  while idle.
- **On subscription**: backend MUST replay the last known snapshot.

Payload:
```json
{
  "topic": "device-state",
  "deviceId": "<id>",
  "snapshot": { /* SessionSnapshot */ },
  "reason": "change" | "heartbeat" | "initial" | "offline",
  "ts": "<ISO-8601>"
}
```

**Verified by:**
- `shared/contracts/media/envelopes.test.mjs` — `buildDeviceStateBroadcast` + `validateDeviceStateBroadcast`
- `frontend/src/screen-framework/publishers/useSessionStatePublisher.test.jsx` — reactive + heartbeat + debounce
- `frontend/src/screen-framework/publishers/SessionSource.test.js` — source factory contract
- `backend/tests/unit/suite/3_applications/devices/DeviceLivenessService.test.mjs` — last-snapshot cache + replay on subscribe
- `backend/tests/unit/suite/3_applications/devices/DeviceLiveness.integration.test.mjs` — end-to-end reason:offline + reason:initial synthesis

### 6.5 Required screen-framework additions

| Addition | Purpose |
|---|---|
| Replace `useScreenCommands` parser with the structured envelope (§6.2). | Uniform command surface. |
| Extend ActionBus with: `media:seek-abs`, `media:seek-rel`, `media:queue-op`, `media:config-set`, `media:adopt-snapshot`. | Route structured commands to handlers. |
| New hook: `useSessionStatePublisher(sessionSource)` — subscribes to local session and publishes on `device-state:<id>` per §6.4. | State publication. |
| New hook: `useCommandAckPublisher()` — publishes acks on `device-ack:<id>` when ActionBus handlers complete. | Per-command acknowledgement. |
| `sessionSource` contract — device's queue controller and player expose a stable read interface the publisher subscribes to. | Decouple publisher from player internals. |

---

## 7. WebSocket — Topics & Envelope

### 7.1 Common envelope

```json
{
  "topic": "<topic-name>",
  "type": "<sub-type, optional>",
  "ts": "<ISO-8601>"
  /* topic-specific payload at the top level */
}
```
Unknown fields MUST be ignored.

### 7.2 Topic summary

| Topic | Direction | Publisher | Payload | Notes |
|---|---|---|---|---|
| `device-state:<deviceId>` | backend → subscribers | device (via relay) | `DeviceStateBroadcast` | Reactive + heartbeat per §6.4. Replay last snapshot to new subscribers. |
| `device-ack:<deviceId>` | backend → subscribers | device (via relay) | `CommandAck` | Ack for every command. |
| `homeline:<deviceId>` | backend → subscribers | backend | `WakeProgressEvent` | Dispatch orchestration steps. |
| `screen:<deviceId>` | backend → device | backend | `CommandEnvelope` (§6.2) | Only targeted device subscribes. |
| `playback_state` | broadcast | controller app | `PlaybackStateBroadcast` | Local (browser) session heartbeat. |
| `client-control:<clientId>` | backend → controller app | external systems | `CommandEnvelope` (§6.2) targeted at `clientId` | Inbound commands targeting this browser's local session (C8.4). |

**Verified by:**
- `shared/contracts/media/topics.test.mjs` — topic constructors + `parseDeviceTopic`
- `backend/tests/unit/suite/0_system/eventbus/WebSocketEventBus.routing.test.mjs` — per-device topic routing
- `backend/tests/unit/suite/0_system/eventbus/WebSocketEventBus.clientControl.test.mjs` — identity-scoped client-control routing

### 7.3 Subscription lifecycle

- Controller subscribes to `device-state:<id>` and `device-ack:<id>` for
  every device in the fleet config on app mount; to `homeline:<id>` only
  during an active dispatch; and to `client-control:<clientId>` on mount.
- Controller unsubscribes on app unload.
- On reconnect after a drop, the controller MUST re-subscribe. The backend
  replays the last `device-state` snapshot per topic.

### 7.4 Backend liveness synthesis

Backend tracks heartbeats per device. When a device misses heartbeats
>15 seconds, backend emits one synthesized `device-state:<id>` message with
`reason: "offline"` and the last known snapshot. On reconnect, backend
emits `reason: "initial"` with a fresh snapshot.

**Verified by:**
- `backend/tests/unit/suite/3_applications/devices/DeviceLivenessService.test.mjs` — timer-driven offline + re-online synthesis (unit)
- `backend/tests/unit/suite/3_applications/devices/DeviceLiveness.integration.test.mjs` — end-to-end against the real event bus
- `backend/tests/unit/suite/0_system/eventbus/WebSocketEventBus.routing.test.mjs` — last-snapshot replay on subscribe

---

## 8. URL Contract

| Parameter | Type | Semantics |
|---|---|---|
| `play` | contentId | On load, replace any current local session with this content and autoplay. |
| `queue` | contentId | On load, resolve via Queue API and append to the local queue. No auto-start. |
| `shuffle` | `1` | Apply shuffle when starting from `play` or `queue`. |
| `shader` | string | Initial shader. |
| `volume` | `0..1` float | Initial volume. |

**Unsupported parameters MUST be ignored, logged, and never forwarded.**
Remote-dispatch parameters (e.g., `device=<id>`) MUST NOT be honored (C8.2).

**Precedence.** If both `play` and `queue` are supplied, `play` wins;
`queue` is appended after the played item.

**Idempotency.** URL-command processing MUST be idempotent across refreshes.
The app persists `media-app.url-command-token` in `localStorage` and dedupes
by it.

---

## 9. Canonical Data Shapes

**Verified by:**
- `shared/contracts/media/shapes.test.mjs` — validators for `PlayableItem` (§9.1), `SessionSnapshot` (§9.2), `QueueSnapshot` (§9.3), `QueueItem` (§9.4)
- `shared/contracts/media/envelopes.test.mjs` — validators for `DeviceStateBroadcast` (§9.7), `CommandAck` (§9.8), `PlaybackStateBroadcast` (§9.10), `CommandEnvelope` (§9.11)
- `shared/contracts/media/commands.test.mjs` — enum membership for session state + repeat mode + command kinds

### 9.1 `PlayableItem`
Shape returned by `GET /api/v1/play/:source/*`. Authoritative definition:
`docs/reference/content/content-playback.md`.

```json
{
  "contentId": "<source>:<localId>",
  "format": "video" | "dash_video" | "audio" | "singalong" | "readalong" | "readable_paged" | "readable_flow" | "app" | "image" | "composite",
  "title": "<string>",
  "duration": <seconds, optional>,
  "thumbnail": "<url, optional>"
  /* format-specific fields */
}
```

### 9.2 `SessionSnapshot`
Central portable type.

```json
{
  "sessionId": "<uuid>",
  "state": "idle" | "ready" | "loading" | "playing" | "paused" | "buffering" | "stalled" | "ended" | "error",
  "currentItem": { /* PlayableItem */ } | null,
  "position": <seconds>,
  "queue": { /* QueueSnapshot */ },
  "config": {
    "shuffle": <bool>,
    "repeat": "off" | "one" | "all",
    "shader": "<string>" | null,
    "volume": <0..100 int>,
    "playbackRate": <float, default 1.0>
  },
  "meta": {
    "updatedAt": "<ISO-8601>",
    "ownerId": "<deviceId>" | "<clientId>"
  }
}
```

### 9.3 `QueueSnapshot`
```json
{
  "items": [ { /* QueueItem */ } ],
  "currentIndex": <int, -1 if none>,
  "upNextCount": <int>
}
```

### 9.4 `QueueItem`
```json
{
  "queueItemId": "<uuid>",
  "contentId": "<contentId>",
  "title": "<string>",
  "thumbnail": "<url, optional>",
  "format": "<format>",
  "duration": <seconds, optional>,
  "addedAt": "<ISO-8601>",
  "priority": "upNext" | "queue"
}
```

### 9.5 `DeviceConfig`
```json
{
  "id": "<deviceId>",
  "name": "<string>",
  "location": "<string>",
  "capabilities": {
    "wake": <bool>,
    "volume": <bool>,
    "shader": <bool>,
    "compositeVisual": <bool>
  },
  "defaultVolume": <0..100 int>,
  "screens": ["<screenId>", ...]
}
```

### 9.6 `SearchResult`
```json
{
  "contentId": "<source>:<localId>",
  "title": "<string>",
  "source": "<adapterName>",
  "mediaType": "video" | "audio" | "image",
  "capabilities": ["playable", "displayable", ...],
  "thumbnail": "<url, optional>",
  "duration": <seconds, optional>,
  "meta": { /* adapter-specific */ }
}
```

### 9.7 `DeviceStateBroadcast`
```json
{
  "topic": "device-state",
  "deviceId": "<id>",
  "reason": "change" | "heartbeat" | "initial" | "offline",
  "snapshot": { /* SessionSnapshot */ },
  "ts": "<ISO-8601>"
}
```

### 9.8 `CommandAck`
```json
{
  "topic": "device-ack",
  "deviceId": "<id>",
  "commandId": "<uuid>",
  "ok": <bool>,
  "error": "<string, optional>",
  "code": "<string, optional>",
  "appliedAt": "<ISO-8601>"
}
```

### 9.9 `WakeProgressEvent`
```json
{
  "topic": "homeline:<deviceId>",
  "type": "wake-progress",
  "dispatchId": "<uuid>",
  "step": "power" | "verify" | "volume" | "prepare" | "prewarm" | "load",
  "status": "running" | "success" | "failed",
  "error": "<string, optional>",
  "elapsedMs": <int>,
  "ts": "<ISO-8601>"
}
```

### 9.10 `PlaybackStateBroadcast`
```json
{
  "topic": "playback_state",
  "clientId": "<uuid>",
  "sessionId": "<uuid>",
  "displayName": "<string>",
  "state": "playing" | "paused" | "buffering" | "stalled" | "stopped" | "idle",
  "currentItem": { /* PlayableItem, or null */ },
  "position": <seconds>,
  "duration": <seconds>,
  "config": { /* SessionSnapshot.config */ },
  "ts": "<ISO-8601>"
}
```

Published per §6.4 rates. Terminal `state: "stopped"` on session unload.

### 9.11 `CommandEnvelope`
See §6.2. Used on `screen:<deviceId>` (to devices) and on
`client-control:<clientId>` (to this browser's own session).

### 9.12 `ListResponse`
```json
{
  "path": "/<list-path>",
  "modifiers": { "playable": <bool>, "shuffle": <bool>, "recent_on_top": <bool> },
  "total": <int>,
  "take": <int>, "skip": <int>,
  "items": [ /* ListItem or PlayableItem */ ]
}
```

### 9.13 `ContentInfo`
Not a strict shape — adapter-specific. Minimum:
```json
{
  "contentId": "<contentId>",
  "title": "<string>",
  "thumbnail": "<url, optional>"
  /* adapter-specific */
}
```

---

## 10. Log Event Taxonomy

All diagnostic output via `frontend/src/lib/logging/`. Event names use
dot-delimited namespaces. Every event SHOULD include `clientId`,
`sessionId`, and (when relevant) `deviceId` / `dispatchId` / `commandId`.

> Backend-side events are not asserted by tests (they are a convention).
> The backing services that emit them are covered by the tests linked
> under the corresponding §4/§6/§7 subsections — notably
> `SessionControlService.test.mjs` (peek.command-ack equivalents),
> `DeviceLivenessService.test.mjs` (ws.stale equivalents), and
> `WakeAndLoadService.test.mjs` (dispatch.step / dispatch.succeeded).

### 10.1 Required events

| Event | Level | Emitted when | Key fields |
|---|---|---|---|
| `media-app.mounted` | info | App mounts. | `clientId`, `displayName` |
| `media-app.unmounted` | info | App unmounts. | — |
| `session.created` | info | New local session started. | `sessionId`, `contentId` |
| `session.reset` | info | User explicitly reset session. | — |
| `session.resumed` | info | Session restored from localStorage. | `sessionId`, `resumedPosition` |
| `session.state-change` | debug | Session state transition. | `from`, `to` |
| `session.persisted` | debug | State flushed. | `size` |
| `queue.mutated` | debug | Queue modified. | `op`, `queueItemId?`, `contentId?`, `queueSize` |
| `playback.started` | info | First progress after load. | `contentId`, `format`, `ttfpMs` |
| `playback.stalled` | warn | Stall detected. | `contentId`, `stalledAt`, `stallDurationMs` |
| `playback.error` | error | Load/play error. | `contentId`, `error`, `code` |
| `playback.advanced` | info | Auto-advance fired. | `reason`, `fromContentId`, `toContentId` |
| `search.issued` | debug | Search query sent. | `text`, `scopeKey` |
| `search.result-chunk` | debug | One SSE results event. | `source`, `itemCount` |
| `search.completed` | info | Search stream ended. | `totalMs`, `resultCount` |
| `dispatch.initiated` | info | Dispatch started. | `dispatchId`, `deviceId`, `contentId`, `mode` |
| `dispatch.step` | debug | Wake-progress event. | `dispatchId`, `step`, `status`, `elapsedMs` |
| `dispatch.succeeded` | info | Dispatch succeeded. | `dispatchId`, `totalElapsedMs` |
| `dispatch.failed` | warn | Dispatch failed. | `dispatchId`, `failedStep`, `error` |
| `peek.entered` / `peek.exited` | info | Peek lifecycle. | `deviceId` |
| `peek.command` | debug | Command issued in peek. | `deviceId`, `command`, `commandId` |
| `peek.command-ack` | debug | Ack received. | `deviceId`, `commandId`, `ok`, `error?` |
| `takeover.initiated` | info | Take Over started. | `deviceId`, `sessionId` |
| `takeover.succeeded` | info | Take Over completed. | `deviceId`, `sessionId`, `position` |
| `takeover.failed` | warn | Take Over failed. | `deviceId`, `error` |
| `handoff.initiated` | info | Hand Off started. | `deviceId`, `mode` |
| `handoff.succeeded` | info | Hand Off completed. | `deviceId`, `mode` |
| `handoff.failed` | warn | Hand Off failed. | `deviceId`, `error` |
| `ws.connected` / `ws.disconnected` / `ws.reconnected` | info | WS lifecycle. | `attempt?` |
| `ws.stale` | warn | No heartbeat >15s. | `topic`, `deviceId` |
| `external-control.received` | info | Inbound command. | `commandId`, `command` |
| `external-control.rejected` | warn | Rejected command. | `commandId`, `reason` |
| `url-command.processed` | info | URL param triggered action. | `param`, `value` |
| `url-command.ignored` | debug | Duplicate or unsupported URL param. | `param` |

### 10.2 Sampling

High-frequency events MUST use
`logger.sampled(event, data, { maxPerMinute: 20, aggregate: true })`.

### 10.3 Correlation

All events emitted during a single local session MUST carry that session's
`sessionId`. External consumers correlate by `clientId` + `sessionId`.

---

## 11. localStorage Persistence Schema

### 11.1 Keys

| Key | Purpose | Shape |
|---|---|---|
| `media-app.client-id` | Stable per-browser identity. | UUID v4 string. |
| `media-app.display-name` | Human-readable client label. | string. |
| `media-app.session` | Persisted local session. | `PersistedSession` — §11.2 |
| `media-app.url-command-token` | Dedup token for URL-command processing. | string. |
| `media-scope-last` | Last-used search scope key. | string. |
| `media-scope-recents` | Last 5 scope keys that produced results. | `string[]`. |
| `media-scope-favorites` | Starred scope keys. | `string[]`. |

### 11.2 `PersistedSession` shape

```json
{
  "schemaVersion": 1,
  "sessionId": "<uuid>",
  "updatedAt": "<ISO-8601>",
  "wasPlayingOnUnload": <bool>,
  "snapshot": { /* SessionSnapshot */ }
}
```

### 11.3 Read/write rules

- **Write cadence:** on every state transition and every 5s while playing
  (C2.2). Writes throttled to ≤ 1 per 500ms.
- **Atomicity:** single `JSON.stringify` → single `setItem`. No partial state.
- **Size bound:** persisted session MUST fit in 1 MB. If queue grows larger,
  truncate past-played items first.
- **Versioning:** on load, mismatched `schemaVersion` → discard and start fresh
  (log `session.reset` with `reason: "schema-mismatch"`).
- **Reset:** C2.3 reset removes `media-app.session` and
  `media-app.url-command-token`. Other keys preserved.
- **Quota errors:** on `QuotaExceededError`, retry once after clearing
  past-played items. On second failure, surface warning and fall back to
  in-memory-only state.

---

## 12. Error Envelopes

### 12.1 HTTP error body

All 4xx/5xx JSON responses from the APIs defined in §2 and §4 MUST use:

```json
{
  "ok": false,
  "error": "<human-readable message>",
  "code": "<machine-readable code, optional>",
  "details": [ /* optional field-level errors */ ],
  "retryable": <bool, optional>
}
```

### 12.2 Known error codes

| Code | HTTP | Meaning |
|---|---|---|
| `CONTENT_NOT_FOUND` | 404 | Content ID does not resolve. |
| `SEARCH_TEXT_TOO_SHORT` | 400 | Search query < 2 chars. |
| `DEVICE_NOT_FOUND` | 404 | Unknown device ID. |
| `DEVICE_OFFLINE` | 503 / 409 | Device unreachable; last-known snapshot included. |
| `DEVICE_REFUSED` | 502 | Device reached, command rejected/errored. |
| `DEVICE_BUSY` | 409 | Device in a state that cannot accept the command. |
| `WAKE_FAILED` | 502 | Dispatch failed at a step; `failedStep` identifies which. |
| `ATOMICITY_VIOLATION` | 502 | `claim` or atomic op failed to restore state. |
| `IDEMPOTENCY_CONFLICT` | 409 | Repeated command ID with different payload. |

**Verified by:**
- `shared/contracts/media/errors.test.mjs` — `ERROR_CODES` frozen + `buildErrorBody` shape
- `backend/tests/unit/suite/4_api/v1/routers/device.session-transport.test.mjs` — DEVICE_OFFLINE (409), DEVICE_REFUSED (502) mapping
- `backend/tests/unit/suite/4_api/v1/routers/device.load-adopt.test.mjs` — IDEMPOTENCY_CONFLICT (409) mapping

### 12.3 App behavior

- Errors with `retryable: true` SHOULD surface a retry affordance.
- `ATOMICITY_VIOLATION` is a hard error — app MUST NOT retry without
  explicit user action.
- `DEVICE_OFFLINE` MUST NOT be surfaced as an app-breaking error — the
  device is marked offline and observation continues (C9.6).
