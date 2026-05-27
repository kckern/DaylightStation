# Headset Hub admin: controller + monitor in the DaylightStation admin

**Date:** 2026-05-27 (revised post-review)
**Status:** Design — pending implementation
**Scope:** New `HEADSET HUB` section in `frontend/src/modules/Admin/`, supporting backend in `backend/src/` (DDD-compliant)
**Depends on:** `2026-05-27-headset-hub-public-private-design.md` (the hub itself + its `/api/play` endpoint)

## Problem

The headset hub at `kckern-headset-hub:8080` exposes its own minimal web UI plus a REST API (`/api/play`, `/api/status`, `/api/devices`). To control playback today you either:
- Drive it from the hub's own UI (limited; no Plex-aware content browsing)
- Hit the API with raw Plex queue IDs (e.g. `670208`) — workable for HA automations, painful for humans
- SSH to the hub and edit `devices.yml` by hand for schedule / scheduled-fire changes

There's no way to **monitor** live playback state across all 5 slots from the household admin, and no way to **control** the hub without remembering Plex IDs.

The DaylightStation admin already has the right primitives — `ContentSearchCombobox` for Plex-aware media selection, `ConfirmModal` / `CrudTable` for editing collections, `wsService` for real-time updates — so we can offer a much better experience there than the hub's own UI.

## Solution

Add a `HEADSET HUB` section to the admin nav with a single page (`/admin/headset-hub`) showing one self-contained card per device. Each card:

- Shows live status (BT connected, now playing, volume, paused/playing)
- Offers transport controls (play/pause/next/prev, volume slider, Plex-aware content search → Play Now)
- Has collapsible sections for editing continuous schedules, scheduled fires, volume bounds, and Home Assistant binding (public devices only)

Status is **live via WebSocket** — DS backend polls the hub once every 3 s, publishes a full snapshot to a `headset-hub.status` topic, frontend subscribes via the existing `wsService`. No browser polling.

The backend follows DDD layering: one aggregate (`HubConfig`) for the slot+scheduled-fire collection, value objects for the units (`QueueRef`, `VolumeBounds`, `DayPattern`, etc.), one port pair (gateway + repository), one HTTP adapter, one YAML datastore, five use cases, a thin router, and one long-running broadcaster service.

## Vocabulary

| Term | Meaning | Used in |
|------|---------|---------|
| **slot** | A bound position on the hub (1-5), identified by `color` | Code, YAML, logs |
| **color** | Canonical slot identifier (`red`, `yellow`, `green`, `blue`, `white`) | API targets, YAML keys |
| **target** | Resolution scope for a command — single color, comma-list, or group (`all`, `all-private`, `all-public`) | `POST /command` |
| **class** | `private` (auto-play on BT connect) or `public` (gated; needs scheduled fire or `/play`) | YAML, BT-connect handler |
| **armed** | Slot has a pending play directive — gates public-class auto-play | `.armed.json` sentinel |
| **continuous schedule** | Time-window playback (per-device `schedules:` block — for headsets) | YAML |
| **scheduled fire** | One-shot wake event (top-level `scheduled:` block — alarm-clock pattern) | YAML, `scheduled_loop` |
| **queue** | Opaque playable identifier; sourced from any provider (Plex today) | `QueueRef`, YAML |

**Note on the bounded-context name:** the DDD context is named `headset-hub` to match the deployed system, even though slot 5 is a speaker bulb. *Headset* here is the brand, not a constraint on what slots can be. The domain models all 5 slots uniformly via `class`.

## Nav + page composition

**AdminNav addition:**
```
HEADSET HUB                          ← new top-level section
  All Devices                        → /admin/headset-hub
```

(Sections in `AdminNav.jsx` have no `icon` prop themselves — icons live on each item. The icon goes on the `All Devices` row only.)

**Page layout** — 5 device cards stacked. Each card structure:

```
┌────────────────────────────────────────────────────────────────┐
│ ● red · musiCozy · private                                     │  header
│   BT ✓ on hci4   |   Now: "Across the Sky"   |   vol 45/75    │  (always visible)
├────────────────────────────────────────────────────────────────┤
│ [⏮][⏯][⏭]   ──vol slider──   [🔍 ContentSearchCombobox]  [Play Now] │  transport row
├────────────────────────────────────────────────────────────────┤
│ ▾ Continuous schedules           ← collapsible accordion section
│    07:00–21:00 | shuffle | [combo box pre-filled with current queue]
│    [+ add window]                                              │
│ ▾ Scheduled fires                ← collapsible
│    07:00 weekdays | combo box | duration 30m (or ☐ indefinite)│
│    [+ add fire]                                                │
│ ▾ Volume limits                  ← collapsible
│    default 60   min 20   max 75                                │
│ ▸ Home Assistant (public devices only)  ← hidden for private
│    ha_entity_id: switch.1_bedroom_main_lights                  │
│    ☐ turn_off_on_stop                                          │
└────────────────────────────────────────────────────────────────┘
```

`ContentSearchCombobox` is the universal content picker. **`GetHubConfig` enriches every queue field with a resolved title and thumbnail server-side** so the combo box's bound value renders as a human-readable label (e.g. "Solo Piano Radio") instead of `plex:670208`. The enrichment lookup is fail-soft — if the content provider lookup fails, the raw ID is shown and a warning is logged. A small `headset-hub/utils/contentId.js` helper handles the source-prefix transforms on the frontend write path.

## Backend — DDD layout

**Bounded context:** `headset-hub`.

### Domain (2_domains/headset-hub/)

```
value-objects/
  SlotColor.mjs           # validated id — soft validation only (non-empty lowercase string,
                          # uniqueness is enforced at config load by validate_config). Allows
                          # future slots beyond the current red/yellow/green/blue/white set
                          # without a code change.
  SlotClass.mjs           # 'private' | 'public' — controls auto-play gate
  DayPattern.mjs          # 'all' | 'weekdays' | 'weekends' | string[] (subset of [mon..sun])
                          # matches(date) → boolean
  VolumeBounds.mjs        # { default, min, max } — invariant: 0 ≤ min ≤ default ≤ max ≤ 100
                          # clamp(value) → value
  ContinuousSchedule.mjs  # { start: 'HH:MM', end: 'HH:MM', queue: QueueRef, shuffle }
                          # activeAt(date) → boolean (handles wrap-around like 21:00→07:00)
  QueueRef.mjs            # { source: 'plex' | string, id: string }
                          # source-agnostic queue identifier; Plex specifics live in
                          # API DTO mappers + the frontend, NOT in the domain.
                          # static parse('plex:670208') / toString() / equals()
  PlayCommand.mjs         # action enum + optional QueueRef + optional volume + optional duration
                          # validate() throws on impossible combos (e.g. play without content)
  CommandResult.mjs       # { applied: SlotColor[], skipped: [{ color, reason }] }
                          # from SendHubCommand — used by API to render partial-failure responses
  SlotStatus.mjs          # transient runtime snapshot — bt_connected, now_playing, volume,
                          # paused, playlist_pos, armed_source

entities/
  HubSlot.mjs             # part of the HubConfig aggregate (NOT its own root)
                          # - color, mac (immutable)
                          # - class, ha_entity_id, ha_turn_off_on_stop, volume_bounds,
                          #   continuous_schedules[]
                          # - update({ patch }) enforces invariants:
                          #     • public class requires ha_entity_id
                          #     • volume_bounds clamp invariants
  ScheduledFire.mjs       # part of HubConfig aggregate (referenced by target color, not held)
                          # - id, time, days, target (SlotColor), queue (QueueRef),
                          #   duration_min (null = indefinite), volume_override
                          # - validate(slotsByColor) → checks target exists,
                          #     time format, volume_override is within target's bounds

  HubConfig.mjs           # AGGREGATE ROOT — the entire devices.yml as a unit
                          # - slots: HubSlot[]
                          # - scheduledFires: ScheduledFire[]
                          # - upsertScheduledFire(fire) / removeScheduledFire(id) /
                          #   patchSlot(color, patch) — all enforce cross-aggregate invariants
                          #     (e.g. scheduled fire target must reference an existing color)
                          # - findSlot(color), findScheduledFire(id) — throw EntityNotFoundError
```

**Why one aggregate, not two:** the YAML file is rewritten atomically as a single unit; there's no transaction boundary between slots and scheduled fires. Splitting them buys nothing and creates surface area (extra repo methods, scattered validation). Per DDD-reference, aggregates exist primarily to define transaction boundaries — when the boundary is the whole file, one root is correct.

**Aggregate-internal references:** `ScheduledFire.target` is a `SlotColor` value (just the string), not an object handle to a `HubSlot`. The aggregate root provides `findSlot(color)` for cross-collection lookup during validation. This honors the "reference by ID only" rule without needing two aggregates.

### Application (3_applications/headset-hub/)

```
ports/
  IHeadsetHubGateway.mjs           # talks to the running hub via REST
    getStatus() → SlotStatus[]
    sendCommand(playCommand, targets) → CommandResult

  IHeadsetHubConfigRepository.mjs  # canonical aggregate persistence
    getConfig() → HubConfig
    saveConfig(hubConfig) → void
    # That's it. No updateSlot / saveScheduledFire CRUD — use cases mutate the
    # aggregate, then call saveConfig once.

usecases/
  GetHubStatus.mjs        # composes runtime statuses, optionally enriches now-playing
                          # title via ContentMetadataGateway (fail-soft)
  GetHubConfig.mjs        # returns the validated config WITH queue metadata enriched
                          # (each QueueRef paired with { title, thumbnail } when resolvable)
  SendHubCommand.mjs      # validates target/action via PlayCommand.validate(),
                          # expands group targets ('all', 'all-private', etc.),
                          # clamps volume to per-target VolumeBounds.max,
                          # dispatches via gateway,
                          # returns CommandResult { applied, skipped }
  UpdateDeviceConfig.mjs  # config = repo.getConfig(); config.patchSlot(color, patch);
                          #   repo.saveConfig(config); returns updated HubSlot
  SaveScheduledFire.mjs   # config = repo.getConfig(); config.upsertScheduledFire(fire);
                          #   repo.saveConfig(config); returns saved ScheduledFire
                          # throws EntityNotFoundError if PUT'ing an id that doesn't exist
                          # AND has no full body to upsert with
  DeleteScheduledFire.mjs # config = repo.getConfig(); config.removeScheduledFire(id);
                          #   repo.saveConfig(config); throws EntityNotFoundError if id absent

services/
  HubStatusBroadcaster.mjs  # long-running service started by container
                            # (spec below — serial loop with bounded retry)

HeadsetHubContainer.mjs   # DI wiring — instantiates adapter + repo + use cases + broadcaster
```

### Adapters

```
1_adapters/headset-hub/
  HttpHeadsetHubAdapter.mjs            # IHeadsetHubGateway via HTTP to the hub
                                        # baseUrl from services.yml (new headset_hub: block)
                                        # maps hub JSON ↔ domain value objects
                                        # 2s per-request timeout
                                        # wraps HTTP / fetch errors as InfrastructureError

1_adapters/persistence/yaml/
  YamlHeadsetHubConfigDatastore.mjs    # IHeadsetHubConfigRepository
                                        # reads/writes headset-hub.yml in the Dropbox path
                                        # mirrors validate_config.py rules in JS (re-uses
                                        #   the same schema; consider lifting validation to
                                        #   the domain layer in a future cleanup)
                                        # atomic write: staging file + mv (same pattern
                                        #   as the existing sync_config.sh)
```

### API (4_api/v1/routers/headsetHub.mjs)

Thin router — each route resolves a use case from the container, executes with the request body, maps domain errors to HTTP codes. No direct adapter calls. No business logic.

| Method | Path | Use case |
|--------|------|----------|
| GET | `/api/v1/headset-hub/status` | `GetHubStatus` |
| GET | `/api/v1/headset-hub/config` | `GetHubConfig` |
| POST | `/api/v1/headset-hub/command` | `SendHubCommand` |
| PATCH | `/api/v1/headset-hub/devices/:color` | `UpdateDeviceConfig` |
| POST | `/api/v1/headset-hub/scheduled` | `SaveScheduledFire` (create) |
| PUT | `/api/v1/headset-hub/scheduled/:id` | `SaveScheduledFire` (upsert) |
| DELETE | `/api/v1/headset-hub/scheduled/:id` | `DeleteScheduledFire` |

**Partial-failure semantics for `POST /command`:** the use case returns `CommandResult { applied: [color], skipped: [{ color, reason }] }`.
- If `applied.length > 0` and `skipped.length === 0` → HTTP 200 + body
- If `applied.length > 0` and `skipped.length > 0` → HTTP 200 + body (caller renders skipped reasons per-card)
- If `applied.length === 0` (all targets failed) → HTTP 502 + body
We deliberately don't use 207 Multi-Status — single-status with a structured body is easier for the frontend to consume.

**Error mapping** (single error-handler middleware on the router):

| Thrown by | Class | HTTP |
|-----------|-------|------|
| Domain | `ValidationError` | 400 |
| Domain | `DomainInvariantError` | 422 |
| Application | `EntityNotFoundError` | 404 |
| Adapter | `InfrastructureError` (hub down) | 502 |
| Adapter | `InfrastructureError` (yaml IO) | 500 |

**Auth posture:** the new endpoints inherit the DS backend's existing LAN-trust model (no auth middleware on `/api/v1/*`). The admin UI is served from the same origin, so CSRF risk is bounded to LAN-resident actors. If we later expose DS beyond LAN, all these endpoints need an auth token — but that's a system-wide change, not a headset-hub one.

## Status broadcasting via WebSocket

`HubStatusBroadcaster` runs as a singleton long-running service in the DS backend (started in `HeadsetHubContainer.start()`).

**Loop semantics (serial, never concurrent):**

```javascript
async function run() {
  let consecutiveFailures = 0;
  while (this.#running) {
    const startedAt = Date.now();
    try {
      const slots = await this.#gateway.getStatus();  // gateway enforces 2s timeout
      this.#lastSnapshot = { slots, fetchedAt: new Date() };
      this.#publish({ topic: 'headset-hub.status', type: 'headset-hub.status.snapshot',
                      data: this.#lastSnapshot });
      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures++;
      this.#logger.warn?.('headset-hub.broadcaster.fetch_failed',
                          { consecutiveFailures, error: err.message });
    }
    const elapsed = Date.now() - startedAt;
    // Backoff: 3 s normal; on consecutive failures: 5, 10, 20, 30 (capped) seconds.
    const target = consecutiveFailures === 0 ? 3000
                 : Math.min(30000, 3000 * 2 ** Math.min(consecutiveFailures, 4));
    await sleep(Math.max(0, target - elapsed));
  }
}
```

The serial-loop pattern guarantees no overlap: even if the hub hangs for 30 s, only one request is in flight at a time, and the next iteration honors the new timeout / backoff. Compared to `setInterval`, this prevents pileup.

**One event shape, snapshots only** — diff events are deliberately not used. With 5 slots × ~6 fields, a full snapshot is ~2 KB; cheap. Diff events add merge complexity in the hook for no measurable bandwidth saving on a one-household system.

```json
{
  "topic": "headset-hub.status",
  "type": "headset-hub.status.snapshot",
  "data": {
    "slots": [
      { "color": "red", "bt_connected": true, "paused": false,
        "now_playing": { "queue": { "source": "plex", "id": "670208" }, "title": "..." },
        "volume": 45, "playlist_pos": 12, "playlist_count": 30 },
      ...
    ],
    "fetchedAt": "2026-05-27T17:32:01.234Z"
  }
}
```

**Replay-on-subscribe:** `HubStatusBroadcaster` keeps `#lastSnapshot` and replays it as a snapshot event to any new subscriber on the bus. A freshly opened admin tab gets the latest status within milliseconds, not after waiting up to 3 s for the next loop tick.

**Why this beats browser polling:**
- Hub gets polled exactly once every 3 s, ever, regardless of admin tab count
- Multiple admin tabs receive updates simultaneously
- Hidden tabs incur no extra hub load
- Covered by `wsService`'s reconnect / degraded-mode / auto-reload behavior — kiosk resilience for free

## Frontend layout

```
frontend/src/modules/Admin/HeadsetHub/
  index.js
  HeadsetHubPage.jsx                # the route entry — renders 5 device cards
  HeadsetHubPage.scss

  hooks/
    useHubStatus.js                 # WS subscriber → returns Map<color, SlotStatus>
    useHubConfig.js                 # returns { config, revalidate } — pure read
    useHubMutations.js              # returns { updateDevice, saveFire, deleteFire,
                                    #            sendCommand } — write helpers that
                                    #            POST then call revalidate()
                                    # (split from useHubConfig so the read hook isn't
                                    #  conflated with write helpers — "mutate" was
                                    #  ambiguous in the previous draft)

  components/
    DeviceCard.jsx
    DeviceCard.scss
    DeviceHeader.jsx                # color avatar, BT state, current track, vol gauge
    TransportRow.jsx                # ⏮ ⏯ ⏭ + vol slider + content combo + Play Now
    SchedulesSection.jsx            # continuous time-window CRUD (private only)
    ScheduledFiresSection.jsx       # one-shot scheduled-fire CRUD;
                                    #   "duration_min: null" rendered as ☐ indefinite
    VolumeLimitsSection.jsx         # default/min/max inputs
    HomeAssistantSection.jsx        # entity binding (public only)

  utils/
    contentId.js                    # splitContentId('plex:670208') → { source, id }
                                    # toContentId('plex', '670208')  → 'plex:670208'
                                    # plexIdOnly(value)              → '670208'
```

**`useHubStatus.js`** — single event type, single setState:

```javascript
export function useHubStatus() {
  const [snapshot, setSnapshot] = useState(null);
  useEffect(() => {
    return wsService.subscribe('headset-hub.status', (msg) => {
      if (msg.type === 'headset-hub.status.snapshot') {
        setSnapshot(msg.data);
      }
    });
  }, []);
  const byColor = useMemo(() => {
    const m = new Map();
    (snapshot?.slots || []).forEach(s => m.set(s.color, s));
    return m;
  }, [snapshot]);
  return byColor;
}
```

**Page composition:**

```jsx
function HeadsetHubPage() {
  const status = useHubStatus();
  const { config, revalidate } = useHubConfig();
  const mutations = useHubMutations({ onChange: revalidate });

  if (!config) return <Loader />;

  return (
    <Stack gap="md" p="md">
      {config.slots.map(slot => (
        <DeviceCard
          key={slot.color}
          slot={slot}
          status={status.get(slot.color)}
          scheduledFires={config.scheduledFires.filter(f => f.target === slot.color)}
          mutations={mutations}
        />
      ))}
    </Stack>
  );
}
```

**Existing-component reuse:**
- `ContentSearchCombobox` — used in TransportRow, SchedulesSection, ScheduledFiresSection. Its bound value renders as the resolved title because `GetHubConfig` returns enriched `{ queue: { id, title, thumbnail } }` payloads. Frontend never sees a bare `plex:670208` in the input.
- Mantine `Slider` for volume; `TimeInput` for HH:MM; `Chip.Group` for day patterns
- `shared/ConfirmModal` for destructive deletes
- `shared/CrudTable` for the schedule + scheduled-fire row lists (optional — could be plain `<Table>`)

**Single nav line addition (`AdminNav.jsx`):**

```jsx
{ label: 'HEADSET HUB', items: [
    { label: 'All Devices', icon: IconHeadphones, to: '/admin/headset-hub' }
]},
```

(Section level has no `icon` prop in the current `AdminNav.jsx`. Icon lives on the item only.)

## Data flow

**Read path (status):**
```
Hub status changes
  → hub /api/status reflects new state
  → DS HubStatusBroadcaster fetches on next 3 s tick (serial, bounded by 2 s timeout)
  → publishes snapshot to message bus
  → wsService.subscribe('headset-hub.status', ...) on each admin tab
  → useHubStatus updates byColor Map
  → DeviceCard re-renders
```

**Read path (config):**
```
Admin page mount
  → useHubConfig fetches GET /api/v1/headset-hub/config
  → GetHubConfig use case (resolves queue titles via ContentMetadataGateway, fail-soft)
  → YamlHeadsetHubConfigDatastore.getConfig() reads Dropbox YAML
  → returns HubConfig aggregate with enriched queue metadata
  → cards render with human-readable titles in every ContentSearchCombobox
```

**Write path (command):**
```
User clicks Play Now / volume slider / pause / next / prev
  → useHubMutations.sendCommand({ target, action, contentId?, volume? })
  → POST /api/v1/headset-hub/command
  → SendHubCommand use case:
      • expands group targets via HubConfig
      • clamps volume to per-target VolumeBounds.max
      • dispatches via gateway
      • returns CommandResult { applied, skipped }
  → HTTP 200 + body (or 502 if all targets failed)
  → status changes flow back via the read path above (≤3 s lag visible in UI)
```

**Write path (config):**
```
User edits a schedule / scheduled fire / HA binding / volume bounds
  → useHubMutations.updateDevice(color, patch) | saveFire(fire) | deleteFire(id)
  → PATCH /api/v1/headset-hub/devices/:color | POST/PUT/DELETE /api/v1/headset-hub/scheduled[/:id]
  → use case loads HubConfig aggregate, mutates via aggregate method, repo.saveConfig()
  → YamlHeadsetHubConfigDatastore writes Dropbox YAML (atomic: staging + mv)
  → revalidate() — frontend re-fetches config, shows new values immediately
  → Hub's existing sync_config.sh systemd timer pulls within 60 s
  → Hub's refresh_loop picks up the new content on its next tick
```

**Multi-tab staleness:** the WS broadcaster only delivers status. Config edits do NOT broadcast — a second admin tab won't see another tab's edit until it manually navigates away and back (or the user clicks somewhere that triggers a revalidate). Tradeoff: last write wins; conflict window is "until the next revalidate." Acceptable for a one-household tool. If two tabs are open and one user is editing, the design assumes they coordinate.

## Logging & observability

Per `CLAUDE.md`'s logging rules. Use `getChildLogger({ component })`. Required structured events:

| Event | Layer | When |
|-------|-------|------|
| `headset-hub.command.received` | API | `POST /command` entry |
| `headset-hub.command.dispatched` | use case | After `gateway.sendCommand` returns |
| `headset-hub.config.updated` | use case | After `repo.saveConfig` succeeds; data: `{ what: 'slot'|'fire', id }` |
| `headset-hub.broadcaster.tick` | service | Each loop iteration; `debug` level |
| `headset-hub.broadcaster.fetch_failed` | service | Caught error; `warn` level; includes `consecutiveFailures` |
| `headset-hub.config.validation_failed` | adapter | YAML rejection at save time; `error` level |

Frontend uses `getChildLogger({ component: 'HeadsetHubPage', app: 'admin', sessionLog: true })` (matches `ContentSearchCombobox`'s pattern). Log events at `useHubMutations` call sites: `headset-hub.admin.play_now`, `headset-hub.admin.config_save`, etc.

## Retrofit (do alongside this work, not after)

Phase 1 of P/P added `POST /v1/home-automation/ha/call` by calling `haGateway.callService` directly from the router. The router-direct-adapter pattern violates the layering rule (`4_api` → `3_applications` → `1_adapters`). This admin work is a good moment to fix it:

- Add `CallHomeAssistantService` use case in `3_applications/home-automation/usecases/`
- Refactor the `/ha/call` route to delegate to the use case
- No new functionality — just brings the prior code in line with the layering rules

This is in the same PR / phase as the admin backend, not deferred to later.

## YAGNI / Out of scope

- **Per-device routes** (e.g. `/admin/headset-hub/red`) — single page with all cards is sufficient
- **Aggregated cross-device fires view** ("what's set to fire today?") — defer until per-card view feels insufficient
- **Edit history / audit log** of who changed what
- **Drag-to-reorder** for schedule windows or scheduled fires
- **Multi-tab edit-conflict resolution** — last write wins; YAML validation refuses obviously bad output; staleness window is "until next revalidate" (typically the next page action). Documented above in Data flow.
- **Pushover / ntfy alert config UI** — the `alerts:` block stays YAML-only in v1
- **Hub adapter introspection UI** (BT scan, pair from admin) — keep that on the hub's own web UI
- **Voice notes / text-to-speech announcements** as command targets
- **Per-tab config-change WS broadcast** — config edits don't push to other tabs; user revalidates by interacting
- **Hub timing constants** (`SCHEDULE_TICK_INTERVAL`, `BT_WAKE_TIMEOUT`, `DUPE_FIRE_WINDOW`) — stay shell-script-only, not exposed in admin
- **Slot-level diff events** on the WS bus — full snapshots every 3 s are simpler and cheap enough for 5 slots

## Configuration

**New `services.yml` entry** (alongside the existing `homeassistant: docker: http://...`):

```yaml
services:
  homeassistant:
    docker: http://homeassistant:8123
  headset_hub:
    docker: http://kckern-headset-hub:8080
    request_timeout_sec: 2
```

`HttpHeadsetHubAdapter` reads its base URL from this block at container startup. The 2 s timeout is the per-request budget for the gateway (any call exceeding it throws `InfrastructureError`).

## Testing strategy

| Layer | Test type | Examples |
|-------|-----------|----------|
| Domain | Unit (pure) | `VolumeBounds` invariant, `DayPattern.matches`, `ScheduledFire.validate`, `HubConfig.upsertScheduledFire` |
| Application | Integration (fake adapters) | `SendHubCommand` with `FakeHeadsetHubGateway`, `SaveScheduledFire` with `FakeConfigRepository` |
| Adapter | Integration | `HttpHeadsetHubAdapter` against a **mock HTTP server fixture** (not a real hub — keeps CI hermetic); `YamlHeadsetHubConfigDatastore` against tmp YAML files. Real-hub smoke is a manual step only. |
| API | E2E | Smoke each route against a fake container; assert HTTP codes on each error class; verify `POST /command` returns 200 with partial-skip body, 502 with all-fail body |
| Frontend | Component | `DeviceCard` snapshot with mock status/config; mock `wsService` for `useHubStatus` |
| Frontend | Integration | `HeadsetHubPage` mount with mocked fetch + WS; click play, verify mutation fires; verify `ContentSearchCombobox` shows resolved title from `GetHubConfig` payload |

## Open items deferred to implementation

- Exact placement of `HubStatusBroadcaster` start-up: in `HeadsetHubContainer.start()` (parity with other long-running services).
- Hub base URL config location resolved: `services.yml` under `headset_hub:` (per Configuration section above).
- Icon for `All Devices` nav item: `IconHeadphones` is the placeholder; settle when wiring.
- Whether `validate_config.py`'s rules should be lifted into the JS domain layer for true co-location (currently planned to mirror the rules; future cleanup could share a JSON Schema).
