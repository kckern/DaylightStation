# Playback Hub admin: controller + monitor in the DaylightStation admin

**Date:** 2026-05-27 (third revision — post second review)
**Status:** Design — pending implementation
**Scope:** New `PLAYBACK HUB` section in `frontend/src/modules/Admin/`, supporting backend in `backend/src/` (DDD-compliant)
**Depends on:** `2026-05-27-playback-hub-public-private-design.md` (the hub itself + its `/api/play` endpoint)

## Problem

The playback hub at `kckern-playback-hub:8080` exposes its own minimal web UI plus a REST API (`/api/play`, `/api/status`, `/api/devices`). To control playback today you either:
- Drive it from the hub's own UI (limited; no Plex-aware content browsing)
- Hit the API with raw Plex queue IDs (e.g. `670208`) — workable for HA automations, painful for humans
- SSH to the hub and edit `devices.yml` by hand for schedule / scheduled-fire changes

There's no way to **monitor** live playback state across all 5 slots from the household admin, and no way to **control** the hub without remembering Plex IDs.

The DaylightStation admin already has the right primitives — `ContentSearchCombobox` for Plex-aware media selection, `ConfirmModal` / `CrudTable` for editing collections, `wsService` for real-time updates — so we can offer a much better experience there than the hub's own UI.

## Solution

Add a `PLAYBACK HUB` section to the admin nav with a single page (`/admin/playback-hub`) showing one self-contained card per device. Each card:

- Shows live status (BT connected, now playing, volume, paused/playing)
- Offers transport controls (play/pause/next/prev, volume slider, Plex-aware content search → Play Now)
- Has collapsible sections for editing continuous schedules, scheduled fires, volume bounds, and Home Assistant binding (public devices only)

Status is **live via WebSocket** — DS backend polls the hub once every 3 s, publishes a full snapshot to a `playback-hub.status` topic, frontend subscribes via the existing `wsService`. The hook also does a one-shot `GET /api/v1/playback-hub/status` on mount so the first paint is immediate; subsequent updates flow over WS.

The backend follows DDD layering: one aggregate (`HubConfig`) for the slot+scheduled-fire collection, value objects for the units (`QueueRef`, `VolumeBounds`, `DayPattern`, etc.), one port pair (gateway + repository), one HTTP adapter, one YAML datastore, five use cases, a thin router, and one long-running broadcaster service.

## Vocabulary

| Term | Meaning | Used in |
|------|---------|---------|
| **slot** (shell, hub-side) | Numeric position 1-5. The hub-side bash variable `$slot` and filesystem path `~/playback-hub/slots/$N/` use this meaning exclusively. | Hub paths, logs |
| **`SlotPosition`** (domain VO) | The same numeric position, in the DDD domain. Matches hub's "slot." | Domain value object |
| **`SlotColor`** (domain VO) | Canonical string identifier (`red`, `yellow`, `green`, `blue`, `white`). The API target identity. | API targets, YAML keys |
| **`HubDevice`** (domain entity) | The aggregate-member entity with both `position` and `color`. **Not** called `HubDevice` — the bare word "slot" is reserved for position in shell code, so the entity name uses "device" to avoid ambiguity in JS↔shell context. | Domain entity name |
| **target** | Resolution scope for a command — single color, comma-list, or group (`all`, `all-private`, `all-public`) | `POST /command` |
| **class** | `private` (auto-play on BT connect) or `public` (gated; needs scheduled fire or `/play`) | YAML, BT-connect handler |
| **armed** | Slot has a pending play directive — gates public-class auto-play | `.armed.json` sentinel |
| **continuous schedule** | Time-window playback (per-device `schedules:` block — for headsets) | YAML |
| **scheduled fire** | One-shot wake event (top-level `scheduled:` block — alarm-clock pattern) | YAML, `scheduled_loop` |
| **queue** | Opaque playable identifier; sourced from any provider (Plex today) | `QueueRef`, YAML |

Position and color are **distinct** concepts: the hub uses position as the filesystem-path index, color as the API identifier. The domain models both.

## Nav + page composition

**AdminNav addition:**
```
PLAYBACK HUB                          ← new top-level section
  All Devices                         → /admin/playback-hub
```

Add the `IconHeadphones` import to `AdminNav.jsx`'s existing `@tabler/icons-react` import line. Sections in `AdminNav.jsx` have no `icon` prop themselves — icons live on each item. The icon goes on the `All Devices` row only.

**Page layout** — 5 device cards stacked. Each card structure:

```
┌────────────────────────────────────────────────────────────────┐
│ ● red · musiCozy · private                                     │  header
│   BT ✓ on hci4   |   Now: "Across the Sky"   |   vol 45/75    │  (always visible)
├────────────────────────────────────────────────────────────────┤
│ [⏮][⏯][⏭]   ──vol slider──   [🔍 LabeledContentPicker]  [Play Now] │  transport row
├────────────────────────────────────────────────────────────────┤
│ ▾ Continuous schedules           ← collapsible accordion section
│    07:00–21:00 | shuffle | [LabeledContentPicker showing "Pokémon Snap…"]
│    [+ add window]                                              │
│ ▾ Scheduled fires                ← collapsible
│    07:00 weekdays | LabeledContentPicker | ☐ indefinite [30] min
│    [+ add fire]                                                │
│ ▾ Volume limits                  ← collapsible
│    default 60   min 20   max 75                                │
│ ▸ Home Assistant (public devices only)  ← hidden for private
│    ha_entity_id: switch.1_bedroom_main_lights                  │
│    ☐ turn_off_on_stop                                          │
└────────────────────────────────────────────────────────────────┘
```

**`LabeledContentPicker`** is a new thin wrapper around `ContentSearchCombobox`. The combobox itself binds to `value`/`onChange` only and renders the raw `plex:670208` string in its input when no editing is in progress — there's no `valueLabel` prop today. To avoid touching the shared component, the wrapper:
1. Accepts `value` (the queue ID string) and optional `initialLabel` (the resolved title from server)
2. On mount, if `value` is set and no label is in local state, calls `GET /api/v1/info/:source/:id` to resolve the title
3. Renders `<Stack><Text>{label}</Text><ContentSearchCombobox ... /></Stack>` — label above the combo box, so the user sees "Pokémon Snap Guitar Medley" plainly even before opening the dropdown
4. Caches the label via a module-level `Map<contentId, title>` so each unique queue resolves once per page load

This is the simplest path that uses the existing `ContentSearchCombobox` without touching it. Future cleanup could push a `valueLabel` prop into the combo box; not required for v1.

The duration-min UI: a controlled checkbox "☐ Indefinite" disables the number input when checked and sets the value to `null` on save. Mantine `<NumberInput disabled={isIndefinite}>`. State conflict (both filled) is prevented by the disable.

## Backend — DDD layout

**Bounded context:** `playback-hub`.

### Domain (2_domains/playback-hub/)

```
value-objects/
  SlotPosition.mjs        # integer 1..N (currently 5); validates positive integer
  SlotColor.mjs           # validated id — soft validation only (non-empty lowercase string)
                          # uniqueness enforced at config load by the JS validator
  SlotClass.mjs           # 'private' | 'public' — controls auto-play gate
  DayPattern.mjs          # 'all' | 'weekdays' | 'weekends' | string[] (subset of [mon..sun])
                          # matches(date) → boolean
  VolumeBounds.mjs        # { default, min, max } — accepts partial inputs with defaults
                          #   that mirror validate_config.py (default=60, min=0, max=100)
                          # invariant: 0 ≤ min ≤ default ≤ max ≤ 100
                          # clamp(value) → value
                          # toYaml() preserves sparse representation — only writes
                          #   keys the user originally set, doesn't materialize defaults
  ContinuousSchedule.mjs  # { start: 'HH:MM', end: 'HH:MM', queue: QueueRef, shuffle }
                          # activeAt(date) → boolean (handles wrap-around like 21:00→07:00)
  QueueRef.mjs            # { source: 'plex' | string, id: string }
                          # source-agnostic queue identifier
                          # static parse('plex:670208') / toString() / equals()
                          # Plex specifics live in API DTOs + frontend, NOT in the domain
  PlayCommand.mjs         # action enum + optional QueueRef + optional volume + optional duration
                          # validate() throws on impossible combos (e.g. play without content)
  CommandResult.mjs       # { applied: SlotColor[], skipped: [{ color, reason }] }
                          # reason enum: 'not-found' | 'unreachable' | 'contention'
                          #            | 'volume-out-of-bounds' | 'invalid-target'
  SlotStatus.mjs          # transient runtime snapshot — bt_connected, now_playing, volume,
                          # paused, playlist_pos, armed_source

entities/
  HubDevice.mjs             # part of HubConfig aggregate
                          # - position (SlotPosition, immutable)
                          # - color (SlotColor, immutable identity)
                          # - mac (immutable)
                          # - class, ha_entity_id, ha_turn_off_on_stop, volume_bounds,
                          #   continuous_schedules[]
                          # - update({ patch }) enforces invariants
  ScheduledFire.mjs       # part of HubConfig aggregate
                          # - id, time, days, target (SlotColor), queue (QueueRef),
                          #   duration_min (null = indefinite), volume_override
                          # - validate(slotsByColor) → checks target exists, etc.

  HubConfig.mjs           # AGGREGATE ROOT — the entire devices.yml as a unit
                          # - devices: HubDevice[]
                          # - scheduledFires: ScheduledFire[]
                          # - findDevice(color) → throws EntityNotFoundError
                          # - findScheduledFire(id) → throws EntityNotFoundError
                          # - upsertScheduledFire(fire), removeScheduledFire(id),
                          #   patchDevice(color, patch) — enforce cross-collection invariants
                          # - toYaml() preserves sparse user-written YAML where possible
```

**Why one aggregate, not two:** the YAML file is rewritten atomically as a single unit; there's no transaction boundary between slots and scheduled fires. Per DDD-reference, aggregates exist to define transaction boundaries — when the boundary is the whole file, one root is correct.

**Aggregate-internal references:** `ScheduledFire.target` is a `SlotColor` value (just the string), not an object handle to a `HubDevice`. The aggregate root provides `findDevice(color)` for cross-collection lookup. This honors the "reference by ID only" rule without two aggregates.

### Application (3_applications/playback-hub/)

```
ports/
  IPlaybackHubGateway.mjs           # talks to the running hub via REST
    getStatus() → SlotStatus[]
    sendCommand(playCommand, targets) → CommandResult

  IHubConfigRepository.mjs          # canonical aggregate persistence
    getConfig() → HubConfig
    saveConfig(hubConfig) → void
    # Single-aggregate load/save model. Use cases mutate the aggregate
    # in memory, then call saveConfig once.

usecases/
  GetHubStatus.mjs        # returns runtime SlotStatus[] from gateway
                          # NO title enrichment — frontend resolves titles per row
                          # via the existing /api/v1/info/:source/:id endpoint
                          # (see frontend section). Keeps this bounded context
                          # free of cross-context content-metadata dependency.
  GetHubConfig.mjs        # returns the validated HubConfig aggregate
  SendHubCommand.mjs      # validates target/action via PlayCommand.validate(),
                          # expands group targets ('all', 'all-private', etc.),
                          # clamps volume to per-target VolumeBounds.max,
                          # dispatches via gateway,
                          # maps gateway 409 to skipped[{reason: 'contention'}]
                          # rather than throwing — caller can retry safely.
  UpdateDeviceConfig.mjs  # config = repo.getConfig(); config.patchDevice(color, patch);
                          #   repo.saveConfig(config); returns updated HubDevice
                          # IMPORTANT — saving new volume bounds does NOT retroactively
                          # clamp a running mpv. The new bounds take effect on the next
                          # start_playback (e.g. headset reconnect, scheduled fire, or
                          # explicit Play Now via the API). This matches the hub-side
                          # behavior where --volume / --volume-max are mpv launch args.
                          # Frontend should communicate this to the user (e.g. info
                          # tooltip "applies on next playback start").
  SaveScheduledFire.mjs   # upsert by id; throws EntityNotFoundError on PUT with
                          # unknown id and no full body
  DeleteScheduledFire.mjs # throws EntityNotFoundError if id absent

runtime/
  HubStatusBroadcaster.mjs  # long-running service started by container at boot
                            # (folder is `runtime/`, not `services/`, to avoid
                            #  collision with `2_domains/*/services/` semantics)

PlaybackHubContainer.mjs  # DI wiring; exposes start() and stop() — start() launches
                          # HubStatusBroadcaster.run(); stop() sets #running=false and
                          # awaits the in-flight loop iteration so test teardown is
                          # clean. Both are invoked from backend/src/0_system/bootstrap.mjs.
```

### Adapters

```
1_adapters/playback-hub/
  HttpPlaybackHubAdapter.mjs           # IPlaybackHubGateway via HTTP to the hub
                                        # baseUrl from services.yml: services.playback_hub.docker
                                        # maps hub JSON ↔ domain value objects
                                        # 2s per-request timeout
                                        # wraps HTTP 4xx/5xx as InfrastructureError
                                        # EXCEPT 409 → returns CommandResult with
                                        #   skipped[{reason: 'contention'}] so the
                                        #   use case can pass it through instead of throwing

1_adapters/persistence/yaml/
  YamlHubConfigDatastore.mjs           # IHubConfigRepository
                                        # path: <dataRoot>/household/config/playback-hub.yml
                                        # serial write path guarded by an async-mutex
                                        #   (single-process, in-memory lock) — two
                                        #   simultaneous PATCH/PUT requests are
                                        #   serialized; second sees the first's writes
                                        # atomic write: staging file + mv
                                        # validation: see Validation strategy below
```

### API (4_api/v1/routers/playbackHub.mjs)

Thin router — each route resolves a use case from the container, executes with the request body, maps domain errors to HTTP codes. No direct adapter calls. No business logic.

| Method | Path | Use case |
|--------|------|----------|
| GET | `/api/v1/playback-hub/status` | `GetHubStatus` |
| GET | `/api/v1/playback-hub/config` | `GetHubConfig` |
| POST | `/api/v1/playback-hub/command` | `SendHubCommand` |
| PATCH | `/api/v1/playback-hub/devices/:color` | `UpdateDeviceConfig` |
| POST | `/api/v1/playback-hub/scheduled` | `SaveScheduledFire` (create) |
| PUT | `/api/v1/playback-hub/scheduled/:id` | `SaveScheduledFire` (upsert) |
| DELETE | `/api/v1/playback-hub/scheduled/:id` | `DeleteScheduledFire` |

**Partial-failure semantics for `POST /command`:** the use case returns `CommandResult { applied: [color], skipped: [{ color, reason }] }`. `reason` is the closed enum spec'd in `CommandResult.mjs`.
- All targets applied: HTTP 200 + body
- Some applied, some skipped: HTTP 200 + body (caller renders skipped reasons per-card)
- All skipped: HTTP 200 + body if skip reasons are user-recoverable (e.g. `contention`, `volume-out-of-bounds`); HTTP 502 + body only when all skips are `unreachable` or `not-found` (truly nothing worked)
- The frontend uses `skipped[].reason` to decide whether to auto-retry (`contention`) or surface to the user.

**Error mapping** (single error-handler middleware):

| Thrown by | Class | HTTP |
|-----------|-------|------|
| Domain | `ValidationError` | 400 |
| Domain | `DomainInvariantError` | 422 |
| Application | `EntityNotFoundError` | 404 |
| Adapter | `InfrastructureError` (hub down) | 502 |
| Adapter | `InfrastructureError` (yaml IO) | 500 |

**Auth posture:** this design inherits DS's system-wide LAN-trust policy — no auth middleware on `/api/v1/*`. The decision is system-wide and not re-litigated here. If LAN trust is ever revised, all these endpoints follow that revision.

## HA-call retrofit (carried in this PR)

The current `homeAutomation.mjs` router has two endpoints that call `haGateway.callService` directly — `POST /ha/call` (added in P/P-design phase 1, lines 358-369) and `POST /ha/script/:scriptId` (lines 331-350). Both violate the layering rule. As of this design's authoring **no `CallHomeAssistantService` use case exists** under `3_applications/home-automation/usecases/`; the retrofit is net-new and creates the file. The use case accepts `{ domain, service, data }`; the `/ha/script/:scriptId` handler simply pre-fills `domain='script', service='turn_on', data={entity_id}`.

No functional change. Just brings the prior code in line with the layering rules.

## Validation strategy

The hub-side `validate_config.py` enforces eight rules (color uniqueness, MAC uniqueness, class enum, public-requires-ha_entity_id, volume bounds, scheduled target referential integrity, days enum/list, daylight_station.base_url present). The JS-side `YamlHubConfigDatastore` must enforce the same rules — otherwise DS accepts a save that the hub rejects 60s later with no UI feedback.

The hub-side `validate_config.py` enforces eleven rules (top-level is a mapping; `devices` is a non-empty list; color uniqueness; MAC uniqueness when present; class enum; public-requires-ha_entity_id; volume bounds with `min ≤ default ≤ max` all in `[0,100]`; scheduled target referential integrity; scheduled has `time` + `queue`; `days` is a known string or list of valid day names; `daylight_station.base_url` required if block present). The JS-side `YamlHubConfigDatastore` must enforce the same rules — otherwise DS accepts a save that the hub rejects 60 s later with no UI feedback.

**Plan:** the JS datastore re-implements the same eleven rules. To prevent drift, two parallel fixture sets:

- `tests/fixtures/playback-hub/invalid/*.yml` — one YAML per rule violation (~11+ files; rule-id in filename, e.g. `01-not-a-mapping.yml`, `04-duplicate-mac.yml`)
- `tests/fixtures/playback-hub/valid/*.yml` — minimal-and-typical-and-edge-case-valid configs paired with `*.expected.json` files showing the canonical normalized runtime form (e.g. sparse volume bounds get default-filled in the runtime JSON — both validators must produce the SAME canonical JSON for the same input)

Two test suites both consume both sets:
- Python: `tests/playback-hub/test_validate_config.py` — asserts every `invalid/*.yml` is rejected; asserts every `valid/*.yml` produces the matching `*.expected.json` after passing through `validate_config.py`
- JS: `tests/playback-hub/test_yaml_datastore.mjs` — same assertions against `YamlHubConfigDatastore.saveConfig()` and its in-memory canonicalization path

Adding a new rule = adding fixtures in both sets + a rejection (or normalization) in both validators. CI catches both **rejection-direction drift** (one accepts what the other rejects) and **normalization drift** (e.g. one fills in `volume.min: 0` and the other doesn't).

(Future cleanup could replace both validators with a JSON Schema; out of scope for v1.)

## Status broadcasting via WebSocket

`HubStatusBroadcaster` runs as a singleton long-running service in the DS backend (started in `PlaybackHubContainer.start()`, invoked from `backend/src/0_system/bootstrap.mjs`).

**Always running** — even with zero WebSocket subscribers. Tradeoff: one extra HTTP request to the hub every 3s when no admin tab is open. Acceptable on a one-household system; avoids cold-start latency on first subscribe.

**Loop semantics (serial, never concurrent):**

```javascript
async function run() {
  let consecutiveFailures = 0;
  while (this.#running) {
    const startedAt = Date.now();
    try {
      const devices = await this.#gateway.getStatus();  // gateway enforces 2s timeout
      this.#lastSnapshot = { devices, fetchedAt: new Date() };
      this.#publish({ topic: 'playback-hub:status', type: 'playback-hub.status.snapshot',
                      data: this.#lastSnapshot });
      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures++;
      this.#logger.warn?.('playback-hub.broadcaster.fetch_failed',
                          { consecutiveFailures, error: err.message });
    }
    const elapsed = Date.now() - startedAt;
    const target = consecutiveFailures === 0 ? 3000
                 : Math.min(30000, 3000 * 2 ** Math.min(consecutiveFailures, 4));
    await sleep(Math.max(0, target - elapsed));
  }
}
```

The serial-loop pattern guarantees no overlap.

**Initial paint:** new admin tabs do NOT rely on the bus to deliver a snapshot. The `useHubStatus` hook performs a `GET /api/v1/playback-hub/status` on mount for immediate first paint, then subscribes to the WS topic for live updates. This sidesteps the fact that the existing `WebSocketEventBus.mjs` only replays events for `device-state` topics (via `#maybeReplayDeviceState`, line 499) — wiring our broadcaster into that replay path is a real piece of infrastructure work we're deferring.

**Event shape** (snapshots only — no diff events):

```json
{
  "topic": "playback-hub:status",
  "type": "playback-hub.status.snapshot",
  "data": {
    "devices": [
      { "position": 1, "color": "red", "bt_connected": true, "paused": false,
        "now_playing": { "queue": { "source": "plex", "id": "670208" } },
        "volume": 45, "playlist_pos": 12, "playlist_count": 30 },
      ...
    ],
    "fetchedAt": "2026-05-27T17:32:01.234Z"
  }
}
```

Snapshot includes `position` AND `color` so the frontend can render either label-style. The `now_playing.queue` payload is always the `{source, id}` object shape (matches the `QueueRef` value-object format) — never a `"plex:670208"` string. Frontend code converts when it needs the string form (e.g. passing into `LabeledContentPicker.value`). Note: snapshots do NOT include titles — the frontend resolves them per row via `/api/v1/info/:source/:id`.

## Frontend layout

```
frontend/src/modules/Admin/PlaybackHub/
  index.js
  PlaybackHubPage.jsx               # the route entry — renders 5 device cards
  PlaybackHubPage.scss

  hooks/
    useHubStatus.js                 # GET /status on mount (immediate first paint)
                                    # + WS subscribe('playback-hub:status') for live updates
                                    # returns Map<color, SlotStatus>
    useHubConfig.js                 # GET /config; returns { config, revalidate } — pure read
    useHubMutations.js              # accepts { revalidate } at construction;
                                    # returns { updateDevice, saveFire, deleteFire,
                                    #            sendCommand } — write helpers that
                                    #            POST then call revalidate()

  components/
    DeviceCard.jsx
    DeviceCard.scss
    DeviceHeader.jsx                # color avatar, BT state, current track, vol gauge.
                                    # NOTE: this component consumes BOTH useHubStatus
                                    # (for current volume, BT state) AND useHubConfig
                                    # (for volume.max so the gauge shows "45/75").
                                    # Cross-source render is intentional.
    TransportRow.jsx                # ⏮ ⏯ ⏭ + vol slider + LabeledContentPicker + Play Now
    LabeledContentPicker.jsx        # wraps ContentSearchCombobox; resolves + caches title
                                    # via /api/v1/info/:source/:id on mount
    SchedulesSection.jsx            # continuous time-window CRUD (private only)
    ScheduledFiresSection.jsx       # one-shot scheduled-fire CRUD;
                                    #   "Indefinite" checkbox disables NumberInput
    VolumeLimitsSection.jsx         # default/min/max inputs
    HomeAssistantSection.jsx        # entity binding (public only)

  utils/
    contentId.js                    # splitContentId('plex:670208') → { source, id }
                                    # toContentId('plex', '670208')  → 'plex:670208'
                                    # plexIdOnly(value)              → '670208'
    titleCache.js                   # module-level Map<contentId, title> for LabeledContentPicker
```

**`LabeledContentPicker` sketch:**

The wrapper has to handle two `onChange` shapes that `ContentSearchCombobox` actually emits:
- `onChange(item.id, item)` on dropdown selection (item carries `.title`) — `ContentSearchCombobox.jsx:395`
- `onChange(search)` on freeform commit (no item) — `ContentSearchCombobox.jsx:584, :601`

When the combobox supplies `item.title`, we prime the cache and our local state directly — no refetch, no flicker. Only freeform commits trigger a resolve.

```jsx
// utils/titleCache.js (module-level, shared across all picker instances)
export const titleCache = new Map();

// components/LabeledContentPicker.jsx
import { titleCache } from '../utils/titleCache';

export function LabeledContentPicker({ value, onChange, ...rest }) {
  const [title, setTitle] = useState(() => titleCache.get(value) || null);

  // Resolve title on mount / value change when we don't already have one.
  useEffect(() => {
    if (!value || title) return;
    const cached = titleCache.get(value);
    if (cached) { setTitle(cached); return; }
    const [source, id] = value.split(':');
    if (!source || !id) return;
    let cancelled = false;
    fetch(`/api/v1/info/${source}/${encodeURIComponent(id)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled) return;
        const t = data?.title ?? null;
        if (t) titleCache.set(value, t);
        setTitle(t);
      })
      .catch(() => { /* fail-soft — leave label blank */ });
    return () => { cancelled = true; };
  }, [value, title]);

  return (
    <Stack gap={4}>
      {title && <Text size="sm" c="dimmed">{title}</Text>}
      <ContentSearchCombobox
        value={value}
        onChange={(id, item) => {
          // Combobox calls onChange(id, item) for dropdown picks (item has .title)
          // and onChange(search) for freeform commit (no item).
          if (item?.title) {
            titleCache.set(id, item.title);
            setTitle(item.title);
          } else {
            // Freeform commit — let the useEffect resolve it
            setTitle(null);
          }
          onChange(id, item);
        }}
        {...rest}
      />
    </Stack>
  );
}
```

This avoids the flicker the naive sketch would cause: on a dropdown selection, the title appears instantly (cache + local state primed before the parent re-renders); on a freeform Plex-ID paste, the effect resolves the title within ~300 ms.

**`useHubStatus.js`** with initial GET + WS overlay:

The GET on mount and the first WS message race. The GET response (~100-500 ms) can land *after* a WS snapshot (broadcaster ticks every 3 s but a tick may be in flight when we mount). A naive `setSnapshot(data)` on each path would clobber the newer message with the older. We guard with `fetchedAt`:

```javascript
export function useHubStatus() {
  const [snapshot, setSnapshot] = useState(null);

  // Merge helper: only accept payloads strictly newer than what we already have.
  const accept = useCallback((data) => {
    if (!data?.fetchedAt) return;
    setSnapshot(prev =>
      (prev?.fetchedAt && prev.fetchedAt >= data.fetchedAt) ? prev : data
    );
  }, []);

  // 1. Initial GET — immediate first paint, no waiting for the next 3 s broadcaster tick.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/v1/playback-hub/status')
      .then(r => r.json())
      .then(data => { if (!cancelled) accept(data); })
      .catch(() => { /* WS will deliver shortly */ });
    return () => { cancelled = true; };
  }, [accept]);

  // 2. WS overlay — applies snapshots if newer than the latest accepted.
  useEffect(() => {
    return wsService.subscribe('playback-hub:status', (msg) => {
      if (msg.type === 'playback-hub.status.snapshot') accept(msg.data);
    });
  }, [accept]);

  return useMemo(() => {
    const m = new Map();
    (snapshot?.devices || []).forEach(d => m.set(d.color, d));
    return m;
  }, [snapshot]);
}
```

Note the topic is `playback-hub:status` (colon-separated, matching the rest of the bus's topic naming convention like `device-state:<id>`, `media:queue`, `playback:<id>`) — the broadcaster publishes with the same colon-style topic.

**Existing-component reuse:**
- `ContentSearchCombobox` — wrapped by `LabeledContentPicker`, used in TransportRow, SchedulesSection, ScheduledFiresSection
- Mantine `Slider` for volume; `TimeInput` for HH:MM; `Chip.Group` for day patterns; `NumberInput` with `disabled={isIndefinite}` for `duration_min`
- `shared/ConfirmModal` for destructive deletes
- `shared/CrudTable` for the schedule + scheduled-fire row lists (optional — could be plain `<Table>`)

**`AdminNav.jsx` addition:**

```jsx
// Add to existing icon import line at the top of the file:
import { ..., IconBroadcast } from '@tabler/icons-react';

// Add to the sections array:
{ label: 'PLAYBACK HUB', items: [
    { label: 'All Devices', icon: IconBroadcast, to: '/admin/playback-hub' }
]},
```

`IconBroadcast` is more accurate than `IconHeadphones` given slot 5 is a speaker bulb — keeps the icon name consistent with the bounded-context rename. Final icon choice can change at coding time; placeholder noted here.

## Data flow

**Read path (status):**
```
Initial mount:
  useHubStatus → GET /api/v1/playback-hub/status → SlotStatus[] → first paint
Then on every 3 s broadcaster tick:
  Hub /api/status changes → HubStatusBroadcaster (2 s timeout, serial loop)
   → publishes snapshot to message bus
   → wsService.subscribe('playback-hub:status', ...) on each admin tab
   → useHubStatus replaces snapshot → cards re-render
```

**Read path (config):**
```
Admin page mount
  → useHubConfig fetches GET /api/v1/playback-hub/config
  → GetHubConfig use case → YamlHubConfigDatastore.getConfig()
  → returns HubConfig aggregate (raw QueueRef IDs, no enriched titles)
  → cards render; LabeledContentPicker fetches each title from /api/v1/info/:source/:id
```

**Write path (command):**
```
User clicks Play Now / volume slider / pause / next / prev
  → useHubMutations.sendCommand({ target, action, contentId?, volume? })
  → POST /api/v1/playback-hub/command
  → SendHubCommand use case (expands targets, clamps volume, dispatches via gateway)
  → returns CommandResult { applied, skipped }
  → if any skipped[].reason === 'contention', frontend auto-retries once after 500ms
  → status changes flow back via the read path above
```

**Write path (config):**
```
User edits a schedule / scheduled fire / HA binding / volume bounds
  → useHubMutations.updateDevice(color, patch) | saveFire(fire) | deleteFire(id)
  → PATCH /api/v1/playback-hub/devices/:color | POST/PUT/DELETE /api/v1/playback-hub/scheduled[/:id]
  → use case loads HubConfig, mutates via aggregate method, repo.saveConfig()
  → datastore acquires in-process mutex on the YAML file path before writing
  → YamlHubConfigDatastore writes Dropbox YAML (atomic: staging + mv)
  → revalidate() — frontend re-fetches config
  → Hub's existing sync_config.sh systemd timer pulls within 60 s
  → Hub's refresh_loop picks up the new content on its next tick
```

**Multi-tab safety:** the JS datastore guards `saveConfig` with an in-process async mutex, so simultaneous PATCH/PUT requests are serialized within DS. Two admin tabs writing different fields of the same slot won't lose either write at the YAML level (the second read-modify-write sees the first's changes). Cross-tab visibility still has a "until next revalidate" window — a tab not actively editing won't see another tab's edits until the next config GET. Acceptable for one-household use.

## Logging & observability

Per `CLAUDE.md`'s logging rules. Use `getChildLogger({ component })`. Structured events:

| Event | Layer | When |
|-------|-------|------|
| `playback-hub.command.received` | API | `POST /command` entry |
| `playback-hub.command.dispatched` | use case | After `gateway.sendCommand` returns |
| `playback-hub.config.updated` | use case | After `repo.saveConfig`; data: `{ what: 'slot'|'fire', id }` |
| `playback-hub.broadcaster.tick` | service | Each loop iteration; `debug` level |
| `playback-hub.broadcaster.publish` | service | Each successful snapshot publish; `debug` level |
| `playback-hub.broadcaster.fetch_failed` | service | Caught error; `warn` level; includes `consecutiveFailures` |
| `playback-hub.config.validation_failed` | adapter | YAML rejection at save time; `error` level |

Frontend uses `getChildLogger({ component: 'PlaybackHubPage', app: 'admin', sessionLog: true })` (matches `ContentSearchCombobox`'s pattern). Log events at `useHubMutations` call sites: `playback-hub.admin.play_now`, `playback-hub.admin.config_save`, etc.

## Configuration

**New `services.yml` entry** (alongside the existing `homeassistant:`):

```yaml
services:
  homeassistant:
    docker: http://homeassistant:8123
  playback_hub:                      # snake_case key matches services.yml convention
    docker: http://kckern-playback-hub:8080
    request_timeout_sec: 2
```

`HttpPlaybackHubAdapter` reads its base URL + timeout from this block at container startup. The kebab-case `playback-hub` appears everywhere else (route paths, WS topics, filesystem); the snake_case `playback_hub` is reserved for the YAML key here to match the existing `homeassistant` flat-naming convention in `services.yml`.

## YAGNI / Out of scope

- **Per-device routes** (e.g. `/admin/playback-hub/red`) — single page with all cards is sufficient
- **Aggregated cross-device fires view** ("what's set to fire today?") — defer until per-card view feels insufficient
- **Edit history / audit log** of who changed what
- **Drag-to-reorder** for schedule windows or scheduled fires
- **WS replay-on-subscribe** for `playback-hub.status` — frontend GET on mount covers cold-start adequately; integrating into the existing `device-state` replay path is real infrastructure work, deferred
- **`ContentMetadataGateway` port** for server-side title enrichment — frontend per-row `/api/v1/info/:source/:id` lookups with module-level caching are simpler and avoid cross-context coupling
- **Pushover / ntfy alert config UI** — the `alerts:` block stays YAML-only in v1
- **Hub adapter introspection UI** (BT scan, pair from admin) — keep that on the hub's own web UI
- **Voice notes / text-to-speech announcements** as command targets
- **Per-tab config-change WS broadcast** — config edits don't push to other tabs; user revalidates by interacting (next config GET)
- **Hub timing constants** (`SCHEDULE_TICK_INTERVAL`, `BT_WAKE_TIMEOUT`, `DUPE_FIRE_WINDOW`) — stay shell-script-only, not exposed in admin
- **Slot-level diff events** on the WS bus — full snapshots are cheap enough for 5 slots
- **JSON Schema as cross-language validator source** — Python + JS validators sharing a fixture set is enough for v1
- **ETag-based optimistic concurrency** on config writes — the in-process mutex covers the realistic write race; cross-tab staleness is documented

## Testing strategy

| Layer | Test type | Examples |
|-------|-----------|----------|
| Domain | Unit (pure) | `VolumeBounds` invariant (including sparse-input handling), `DayPattern.matches`, `ScheduledFire.validate`, `HubConfig.upsertScheduledFire`, `QueueRef.parse` |
| Application | Integration (fake adapters) | `SendHubCommand` with `FakeHubGateway`, `SaveScheduledFire` with `FakeConfigRepository` |
| Adapter | Integration | `HttpPlaybackHubAdapter` against a **mock HTTP server fixture** (not a real hub — keeps CI hermetic). `YamlHubConfigDatastore` against tmp YAML files. **Cross-validator parity:** the same fixture set under `tests/fixtures/playback-hub/invalid/` is asserted-rejected by both `validate_config.py` and `YamlHubConfigDatastore`. |
| API | E2E | Smoke each route against a fake container; assert HTTP codes; verify `POST /command` 200 with partial-skip body, 502 only when nothing applies |
| Frontend | Component | `DeviceCard` snapshot with mock status/config; mock `wsService` for `useHubStatus`; verify `LabeledContentPicker` shows resolved title after async fetch |
| Frontend | Integration | `PlaybackHubPage` mount with mocked fetch + WS; click play, verify mutation fires; verify contention auto-retry path |

## Open items deferred to implementation

- Mantine icon for `All Devices` nav item: design picks `IconBroadcast`; substitute at coding time if a better-fitting icon exists.
- Whether the in-process YAML mutex needs to be a cross-process file lock (`flock`) instead — only matters if DS is ever clustered. Not in v1.
- Whether the `contention`-retry attempt fires a small toast ("retrying…") or stays silent. Auto-retry path itself is decided (once, 500 ms delay); only the UX affordance is open.
- Whether `LabeledContentPicker` should evolve into a generic `frontend/src/modules/Admin/shared/` component once a second consumer needs it (likely; not in v1 scope).
