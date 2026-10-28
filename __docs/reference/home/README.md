# Home dashboard (`/home`)

The household's Home Assistant view: every entity worth a glance (lights,
power, climate, presence, doors, media, batteries, sensors), grouped **by
type**, **by room** or **by state**, with a switch on the ones the household
lets the dashboard control and a link to each entity in Home Assistant. The
camera grid is the fourth view.

## Layers

| Layer | File | Job |
|---|---|---|
| Domain | `__app_modules/household/home/server/domain/home-automation/EntityCatalogPolicy.mjs` | Value object built from the YAML `entities:` section: which entities are shown, each one's type, which are switchable. Defaults when the section is absent. |
| Domain | `…/domain/home-automation/HomeEntity.mjs` | Value object for one entity: id, name, state, **state class** (`on` / `off` / `reading` / `unavailable`), type, room, controllable. Getters only; no `toJSON` (serialization is the API's job). |
| Domain | `…/domain/home-automation/resolveRoom.mjs` | Pure room resolution, by authority: `config` (YAML override) → `provider` (HA area, including through the device) → `inferred` (the entity id starts with a room's id, name or alias, e.g. `switch.office_tv_plug` → Office). |
| Application | `…/application/home-automation/ports/IHomeEntityGateway.mjs` | Port: `listReadings()` returns provider-neutral `EntityReading`s (`name`, `deviceClass`, `unit`, `detail` — no platform attribute keys) and throws when the platform is unreachable; `listRooms()` is empty, never failing, when room data is unavailable. |
| Application | `…/application/home-automation/usecases/GetHomeEntities.mjs` | Applies the policy to every reading; lists only the rooms (alphabetically) and types that hold something; asks for rooms only after the readings succeed. A `ValidationError` from the YAML surfaces as `ConfigurationError`; any other error is left as it is. |
| Application | `…/usecases/ToggleDashboardEntity.mjs` | Allows a configured room light, or a real entity (checked with `getState`) that the policy makes controllable. |
| Adapter | `…/adapters/HomeAssistantEntityGateway.mjs` | The anti-corruption layer: implements the port over the injected `IHomeAutomationGateway`, in the shape of `HomeAssistantDeviceAdapter` (no HTTP client of its own), and translates HA's attribute bag (`friendly_name`, `brightness` 0–255…) into `EntityReading`. Caches room data for 5 minutes (a failed lookup for 1 minute); treats an empty state read as unreachable. |
| Capability | `__capabilities/home-control/server/adapters/homeassistant/HomeAssistantAdapter.mjs` | `listAreaAssignments()` renders one Jinja template (`area_id()` / `area_name()`), because HA's REST API has no area registry. |
| API | `__backend/src/4_api/v1/handlers/home-dashboard/entities.mjs` | `GET /api/v1/home-dashboard/entities`; presents each `HomeEntity` as the response DTO; `Cache-Control: no-store`. |
| Browser | `__app_modules/household/home/browser/entities/` | `groupEntities` / `filterEntities` / `formatEntityState` (pure), `useHomeEntities` (10 s poll while visible; a toggle sends an explicit `on`/`off`, shows the expected state until a reading agrees or 5 s pass, and blocks a second tap meanwhile), `EntityTile`, `EntityDashboard`. `HomeApp` uses `AppChrome`: bottom tabs on mobile, rail on tablet-up. |

## Configuration — `household/home/dashboard.yml`

Read through `DataService` by `YamlHomeDashboardConfigRepository` (the same
file also holds the older `summary` / `rooms` dashboard config). Every key under
`entities:` is optional.

```yaml
entities:
  ha_url: https://<home-assistant-host>   # enables "open in Home Assistant" links
  room_aliases: { <id prefix>: <area_id> } # names that don't match an area id/name
  exclude: ["switch.*_ftp_upload"]          # added to the built-in noise filter
  include: [sensor.some_unclassed_sensor]   # always shown
  controllable_types: [light]               # default: lights only
  controllable: [switch.some_plug]          # opt individual entities in
  names: { light.x: "Kitchen ceiling" }
  rooms: { binary_sensor.y: garage }        # override room placement
  # domains, sensor_device_classes, binary_sensor_device_classes,
  # infer_rooms (default true), types (extra rules, tried before the built-ins)
```

**Defaults worth knowing:**
- **Shown:** on/off devices, covers, climate, media, locks, plus sensors whose
  device class is something a person reads (temperature, humidity, power,
  energy, battery, illuminance, air quality…). Voltage, frequency, signal
  strength and unclassed sensors are hidden unless HA put them in a room.
- **Types:** a `switch` named for a light, by whole word (`*_light`, `*_lights`,
  `*_light_switch`, `*_lamp`, `*_sconce`…), is a light; one named `*plug*` /
  `*outlet*` is power. Camera IR emitters, backlights, status LEDs, LED rings
  and volume levels exposed as lights are excluded by default.
- **Control:** only lights. A plug can be feeding a TV, a set-top box or a
  speaker someone is using, so plugs need `controllable` or `controllable_types`.
  Only on/off domains can ever be switched; a lock or cover named in
  `controllable` stays read-only.

## Observability

Backend: `home.entities.listed` (debug: readings, shown, rooms, unroomed),
`home.entities.rooms.failed`, `ha.listAreaAssignments.error`, `home.dashboard.toggle`.
Browser (`context.app:home`): `home.mount` / `home.unmount`, `home.view.change`,
`home.entities.loaded`, `home.entities.toggle`, `home.entities.toggle.failed`.
