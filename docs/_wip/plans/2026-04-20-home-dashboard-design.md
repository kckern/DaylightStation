# Home Dashboard Design

**Date:** 2026-04-20
**Route:** `/home` (browser, not kiosk TV)
**Status:** Design validated, ready for implementation plan.

---

## Overview

Build out `frontend/src/Apps/HomeApp.jsx` into an ambient home dashboard. Current state: only shows security camera feeds. Target state: per-room cards with lights, climate, motion; a home summary row with weather, a 36h indoor/outdoor temp chart, a 24h energy chart, and home-wide scene buttons; cameras folded into their respective rooms.

HomeApp is a focused wrapper over Home Assistant endpoints with occasional exceptions (Reolink cameras are already one). Configuration is authored in YAML; the backend curates and the frontend renders.

---

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Explicit YAML per room (not HA-area-mirroring) | Order, grouping, and what appears are product decisions — not HA-area-editor decisions. Matches existing `devices.yml` pattern. |
| 2 | REST polling (not WebSocket) | 2–3s latency is imperceptible for ambient dashboards; existing HA adapter is REST. Add WebSocket later if needed. |
| 3 | Full v1 scope: home summary + room cards + cameras-in-rooms | Validated by user. |
| 4 | Desktop-primary, mobile-supported responsive | Mantine `SimpleGrid` handles breakpoints trivially. |
| 5 | Mantine 7 + `@mantine/charts` (recharts) | Already installed. |
| 6 | No `2_domains/home-automation/` for v1 | Whitelist and downsampling are application-level, not universal truth. Add VOs organically if needed. |

---

## YAML schema

`data/household/config/home-dashboard.yml`:

```yaml
# Home-level widgets shown above the room grid
summary:
  weather: true                       # pulls /home/weather (existing)
  temp_chart:
    title: "Indoor / Outdoor · 36h"
    hours: 36
    series:
      - entity: sensor.indoor_temp
        label: "Indoor"
        color: "#4dabf7"
      - entity: sensor.outdoor_temp
        label: "Outdoor"
        color: "#ffa94d"
  energy_chart:
    title: "Energy · 24h"
    hours: 24
    entity: sensor.home_energy_today
    color: "#63e6be"
  scenes:
    - { id: scene.all_off, label: "All Off", icon: "power" }
    - { id: scene.movie,   label: "Movie",   icon: "film"  }
    - { id: scene.bedtime, label: "Bedtime", icon: "moon"  }

# Rooms — rendered in this order
rooms:
  - id: living_room
    label: "Living Room"
    icon: "sofa"
    camera: doorbell                  # optional; refs internal /api/v1/camera id
    lights:
      - { entity: light.living_room_main, label: "Main" }
      - { entity: light.living_room_lamp, label: "Lamp" }
    climate:
      temp:     sensor.living_room_temp
      humidity: sensor.living_room_humidity
    motion:    binary_sensor.living_room_motion
    media:     media_player.living_room
```

### Schema principles

- Everything optional except `id` + `label` on a room.
- Entity IDs are raw HA IDs — no aliasing, grep-friendly.
- Cameras use our internal camera registry ID, not HA entity IDs.
- Icons are string names; the renderer maps to lucide/tabler components.

---

## DDD-compliant architecture

### Layer map

```
2_domains/home-automation/                  (empty for v1 — no universal logic yet)

3_applications/home-automation/
├── ports/
│   ├── IHomeAutomationGateway.mjs          ← EXTEND with getStates, getHistory
│   └── IHomeDashboardConfigRepository.mjs  ← NEW: load()
├── usecases/
│   ├── GetDashboardConfig.mjs              ← load via repo, shape for presentation
│   ├── GetDashboardState.mjs               ← compose config + gateway.getStates
│   ├── GetDashboardHistory.mjs             ← gateway.getHistory + downsample
│   ├── ToggleDashboardEntity.mjs           ← whitelist check + gateway.callService
│   └── ActivateDashboardScene.mjs          ← whitelist check + gateway.activateScene
├── services/
│   └── TimeSeriesDownsampler.mjs           ← pure math, stateless
└── HomeAutomationContainer.mjs             ← NEW: lazy-wires use cases

1_adapters/home-automation/homeassistant/
└── HomeAssistantAdapter.mjs                ← implement new port methods; cache here

1_adapters/persistence/yaml/
└── YamlHomeDashboardConfigRepository.mjs   ← NEW: owns YAML path + parse

4_api/v1/routers/
└── home-dashboard.mjs                      ← thin; receives container via factory

4_api/v1/handlers/home-dashboard/
├── config.mjs
├── state.mjs
├── history.mjs
├── toggle.mjs
└── scene.mjs
```

### Layer boundaries

| Layer | Knows | Does NOT know |
|-------|-------|---------------|
| API (router/handlers) | HTTP verbs, request shape, which use case to call | YAML, HA, whitelist policy, downsampling |
| Application (use cases) | Dashboard config shape, whitelist policy, downsample policy | Storage format, HA wire protocol |
| Adapters (HA, YAML repo) | HA REST, YAML file layout, caching | Dashboards, whitelists, use cases |

### Existing `homeAutomation.mjs` router

Pre-dates this discipline (contains `loadFile`/`saveFile` IO, script-ID normalization, etc.). We leave it alone and put new work in `home-dashboard.mjs`.

---

## Port interface extensions

`IHomeAutomationGateway` gets two new methods:

```javascript
// Batch read — one HTTP round-trip per poll instead of N
async getStates(entityIds: string[]): Promise<Map<string, DeviceState>>

// Historical series for charts
async getHistory(
  entityIds: string[],
  { sinceIso: string, resolution?: 'raw'|'downsampled' }
): Promise<Map<string, Array<{ t: string, v: number|string }>>>
```

Both are generic home-automation concepts (Hubitat, OpenHAB have equivalents); belong on the port.

---

## HTTP endpoints

All under `/api/v1/home-dashboard/*`. Router = factory receiving `{ container, logger }` only.

| Method | Path | Handler | Use case |
|--------|------|---------|----------|
| GET | `/config` | `homeDashboardConfigHandler` | `GetDashboardConfig` |
| GET | `/state` | `homeDashboardStateHandler` | `GetDashboardState` |
| GET | `/history?hours=36` | `homeDashboardHistoryHandler` | `GetDashboardHistory` |
| POST | `/toggle` | `homeDashboardToggleHandler` | `ToggleDashboardEntity` |
| POST | `/scene/:sceneId` | `homeDashboardSceneHandler` | `ActivateDashboardScene` |

### Response shapes (domain-shaped, not entity-ID-keyed)

`GET /state`:

```json
{
  "summary": {
    "weather": { /* passthrough from /home/weather */ },
    "sceneButtons": [{ "id": "scene.all_off", "label": "All Off", "icon": "power" }]
  },
  "rooms": [
    {
      "id": "living_room",
      "label": "Living Room",
      "icon": "sofa",
      "camera": "doorbell",
      "lights": [
        { "entityId": "light.living_room_main", "label": "Main", "on": true, "available": true }
      ],
      "climate": {
        "tempF": 71.4,
        "humidityPct": 42,
        "available": true
      },
      "motion": { "state": "clear", "lastChangedIso": "2026-04-20T...", "available": true },
      "media":  { "state": "off", "available": true }
    }
  ]
}
```

Entity IDs appear only as opaque action handles for `POST /toggle`.

### Cadence

- `/state`: polled by frontend every **3s**; backs off to 10s on consecutive failures.
- `/history`: fetched once on mount, refreshed every **5 minutes**.
- `/config`: fetched once on mount. Loaded at container startup; changes require Docker restart (consistent with rest of repo).

### Whitelist enforcement

`ToggleDashboardEntity` and `ActivateDashboardScene` both load the dashboard config and reject any entity/scene ID not listed. Prevents the dashboard endpoint from becoming a general-purpose HA control proxy.

---

## Frontend component tree

```
HomeApp.jsx                         ← stays thin; composition only
├─ useHomeDashboard()               ← new hook: config once + state 3s + history 5min
├─ <HomeSummary>
│   ├─ <WeatherStrip>               ← reuses /home/weather
│   ├─ <TempChart>                  ← @mantine/charts LineChart, 2 series
│   ├─ <EnergyChart>                ← @mantine/charts AreaChart
│   └─ <SceneRow>                   ← Mantine Button.Group
├─ <RoomGrid>                       ← <SimpleGrid cols={{ base:1, sm:2, lg:3, xl:4 }}>
│   └─ <RoomCard> per room
│       ├─ header: icon + label (+ camera fullscreen btn)
│       ├─ <CameraFeed> (optional, full-width inside card)
│       ├─ <LightRow>               ← Mantine Switch per light, optimistic
│       ├─ <ClimateReadout>         ← big temp, small humidity
│       └─ <MotionBadge>            ← "Clear · 12m ago" / "Motion now"
└─ <UnassignedCameraRow>            ← cameras not bound to any room
```

### UX

- Mantine `Card` for rooms, `Paper` for summary widgets.
- Light toggle = Mantine `<Switch>`, optimistic. Fails → snap back + notification.
- Big temp number, small humidity beneath. No gauges.
- Motion badge: green "Clear · 12m ago" / red "Motion now".
- Charts: ~160px, light gridlines, tooltips on, no axis clutter.
- Stale/offline: `available: false` → tile greys with `—`.
- Global HA failure: dismissible banner "HA unreachable · retrying".

### Logging

`useHomeDashboard` emits:
- `home.dashboard.loaded`
- `home.dashboard.state.refreshed`
- `home.dashboard.toggle.success` / `home.dashboard.toggle.fail`
- `home.dashboard.error`

Per the frontend logging framework — child logger created once via `useMemo`.

---

## Error handling

| Failure | Behavior |
|---------|----------|
| HA unreachable (poll fails) | Banner, tiles grey out, poll backs off to 10s |
| Single entity `unavailable` | Tile renders `—`; others unaffected |
| Toggle POST fails | UI snaps back, Mantine notification |
| YAML references missing entity | Backend logs `home.dashboard.config.unknown_entity`; tile renders greyed |
| History endpoint fails | Chart shows `—` placeholder; retries next cycle |
| Whitelist violation (toggle/scene) | 403 `{ error: 'entity not on dashboard' }` |

Errors propagate through `errorHandlerMiddleware` — handlers don't swallow.

---

## Testing

| Level | What | Where |
|-------|------|-------|
| Unit (adapter) | `getStates`, `getHistory` with mocked `httpClient` | `tests/unit/adapters/` |
| Unit (use case) | Whitelist enforcement; downsampler correctness; state composition with fake gateway + fake config repo | `tests/unit/applications/` |
| Integration (API) | Router endpoints with stubbed container | `tests/live/api/home-dashboard.*.test.mjs` |
| Flow (Playwright) | Load `/home`, toggle a light, simulate HA failure, verify banner | `tests/live/flow/home/home-happy-path.runtime.test.mjs` |

Per testing guidelines: no conditional assertion skipping; fail fast on infrastructure issues.

---

## Implementation order

1. **Port + adapter**
   - Extend `IHomeAutomationGateway` with `getStates` and `getHistory`.
   - Implement on `HomeAssistantAdapter`; add 60s response cache for history.
   - Unit tests for both.
2. **Config repository**
   - `IHomeDashboardConfigRepository` port.
   - `YamlHomeDashboardConfigRepository` implementation using ConfigService / data IO.
   - Scaffold `data/household/config/home-dashboard.yml` with a minimal real config (one room, one chart).
3. **Use cases + container**
   - `GetDashboardConfig`, `GetDashboardState`, `GetDashboardHistory`, `ToggleDashboardEntity`, `ActivateDashboardScene`.
   - `TimeSeriesDownsampler` (pure).
   - `HomeAutomationContainer` lazy-wiring.
   - Unit tests with fakes.
4. **API layer**
   - `home-dashboard.mjs` router + five handlers.
   - Bootstrap wires container and passes to router factory.
   - API integration tests.
5. **Frontend hook**
   - `useHomeDashboard()` — fetches config, polls state, refreshes history.
   - Dummy render of raw data to verify wiring.
6. **Room card MVP**
   - `<RoomCard>` + `<LightRow>` + `<ClimateReadout>` + `<MotionBadge>`.
   - One room working end-to-end with real HA.
7. **Home summary**
   - `<WeatherStrip>` (reuse `/home/weather`), `<TempChart>`, `<EnergyChart>`, `<SceneRow>`.
8. **Camera integration**
   - Fold cameras into `<RoomCard>`; keep unassigned cameras in `<UnassignedCameraRow>`.
9. **Error states + polish**
   - Offline banner, stale tiles, optimistic toggle reconciliation, responsive breakpoint pass on phone width.
   - Flow test.

---

## Deferred (not v1)

- WebSocket live updates (add if perceived latency becomes painful)
- Brightness / color control on lights
- Thermostat setpoint control (read-only for v1)
- Media player controls
- Per-room scenes
- Admin UI for editing `home-dashboard.yml` (edit file + restart container)

---

## Related docs

- `docs/reference/core/layers-of-abstraction/ddd-reference.md`
- `docs/reference/core/layers-of-abstraction/application-layer-guidelines.md`
- `docs/reference/core/layers-of-abstraction/api-layer-guidelines.md`
- `backend/src/1_adapters/home-automation/homeassistant/HomeAssistantAdapter.mjs` (existing)
- `backend/src/3_applications/home-automation/ports/IHomeAutomationGateway.mjs` (to extend)
