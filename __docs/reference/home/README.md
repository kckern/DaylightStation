# Home dashboard (`/home`)

The household's Home Assistant view, built around one question: *what is
going on in the house right now, and is anything left on, open or broken that
I should deal with?* It opens on **Now** — a sentence and only the sections
that are not empty — and keeps the full inventory one tab away.

| View | What it shows |
|---|---|
| **Now** (default) | A live status sentence ("The house is drawing 505 W, with 9 lights on and a door open in the garage. Someone is in the office."), then sections that render only when they have something: **On** (lit lamps by room, each with a plain "Off" and a room-level "Turn off all N"; plugs and other devices that are on behind a disclosure, no switches), **Open** (doors, windows, covers, with when they opened), **Motion** (rooms with someone in them now, then the most recently seen), **Needs attention** (low batteries and devices not answering — counts first, lists on demand), **Climate** (one line per room with a temperature; the thermostat's action and humidity beside it; the outdoor reading in the heading). |
| **Rooms** | One row per room: name, lights ("2 on" with an amber dot, "dark", or "no lights"), temperature, last motion. Tap a row to open the room in place: lights with switches (and a room-level off), then plugs / doors / media / fans, then "Show all N readings and switches" for sensors, batteries, meters and automation flags. Roomless entities gather under "Elsewhere", last. |
| **Power** | One sentence of totals (current draw, today's and this month's kWh, and which meter says so), the top circuits as a ranked list with a proportional bar, plugs that are on, and every meter behind a disclosure. |
| **Browse** | The inventory as a dense searchable list, grouped by **type**, **room** or **state** (remembered per viewer). Hairline rows, state right-aligned, inline switches on lights only. Unavailable entities are hidden until "Show N not answering" (never hidden in the state grouping). |
| **Cameras** | The camera grid, unchanged. |

Tapping any row (except a room row) opens a **detail sheet**: the state in
large type, the room and how it was placed, when it last changed, the entity
id, a switch when the household allows one, and — only here — the "Open in
Home Assistant" link.

Design rules the views follow: one type family (IBM Plex Sans, tabular figures
in columns); one colour with one meaning (`--ds-warning` amber = lit); sections
separated by a single hairline, rows by space (hairlines per row only in the
dense lists); sentence case throughout; no cards except camera tiles; controls
only where control is allowed *and* plausibly wanted.

## Layers

| Layer | File | Job |
|---|---|---|
| Domain | `__app_modules/household/home/server/domain/home-automation/EntityCatalogPolicy.mjs` | Value object built from the YAML `entities:` section: which entities are shown, each one's type, which are switchable. Defaults when the section is absent. |
| Domain | `…/domain/home-automation/HomeEntity.mjs` | Value object for one entity: id, name, state, **state class** (`on` / `off` / `reading` / `unavailable`), type, room, controllable. Getters only; no `toJSON` (serialization is the API's job). |
| Domain | `…/domain/home-automation/HouseSummary.mjs` | `HouseSummaryPolicy` (value object from the YAML `now:` and `power:` sections: low-battery threshold, motion window, which types count as "on", entities never reported, which meter is the whole house, meters left out of the ranking) and `summarizeHouse(entities, policy, {now})`, a pure function returning entity **ids** — what is on, open, moving, low or silent, and the power figures. Presentation joins the ids back. |
| Domain | `…/domain/home-automation/resolveRoom.mjs` | Pure room resolution, by authority: `config` (YAML override) → `provider` (HA area, including through the device) → `inferred` (the entity id starts with a room's id, name or alias, e.g. `switch.office_tv_plug` → Office). |
| Application | `…/application/home-automation/ports/IHomeEntityGateway.mjs` | Port: `listReadings()` returns provider-neutral `EntityReading`s (`name`, `deviceClass`, `unit`, `detail` — no platform attribute keys) and throws when the platform is unreachable; `listRooms()` is empty, never failing, when room data is unavailable. |
| Application | `…/application/home-automation/usecases/GetHomeEntities.mjs` | Applies the catalog policy to every reading; lists only the rooms (alphabetically) and types that hold something; asks for rooms only after the readings succeed; then applies the summary policy (`summary`). Takes an injectable `clock` for the motion window. A `ValidationError` from either YAML section surfaces as `ConfigurationError` with the offending key; any other error is left as it is. |
| Application | `…/usecases/ToggleDashboardEntity.mjs` | Allows a configured room light, or a real entity (checked with `getState`) that the policy makes controllable. A room-level "Turn off all" is one explicit `off` per lamp from the browser, not a new endpoint. |
| Adapter | `…/adapters/HomeAssistantEntityGateway.mjs` | The anti-corruption layer: implements the port over the injected `IHomeAutomationGateway`, in the shape of `HomeAssistantDeviceAdapter` (no HTTP client of its own), and translates HA's attribute bag (`friendly_name`, `brightness` 0–255…) into `EntityReading`. Caches room data for 5 minutes (a failed lookup for 1 minute); treats an empty state read as unreachable. |
| Adapter | `…/adapters/persistence/YamlHomeDashboardConfigRepository.mjs` | Reads `household/home/dashboard.yml` through `DataService`; hands the `entities`, `now` and `power` sections on as plain objects (each `{}` when absent). |
| Capability | `__capabilities/home-control/server/adapters/homeassistant/HomeAssistantAdapter.mjs` | `listAreaAssignments()` renders one Jinja template (`area_id()` / `area_name()`), because HA's REST API has no area registry. |
| API | `__backend/src/4_api/v1/handlers/home-dashboard/entities.mjs` | `GET /api/v1/home-dashboard/entities`; presents each `HomeEntity` as the response DTO and passes `summary` through; `Cache-Control: no-store`. |
| Browser | `__app_modules/household/home/browser/` | `HomeApp` (AppChrome: Now / Rooms / Power / Browse / Cameras; bottom tabs on mobile, rail on tablet-up), `entities/useHomeEntities` (10 s poll while visible; a toggle sends an explicit `on`/`off`, shows the expected state until a reading agrees or 5 s pass, and blocks a second tap meanwhile; `turnOff(list)` fans out; `summary` and `fetchedAt`), `entities/formatEntityState` (`formatEntityState`, `displayName` — an opening the platform named after its state is named after its room — `formatWatts`, `formatKwh`, `formatSince`, `formatAge`), `entities/groupEntities` (`BROWSE_MODES`, `groupEntities`, `filterEntities`), `now/composeStatus` (pure: the sentence and the Now sections from entities + summary), `now/NowView`, `rooms/summarizeRooms` (pure) + `rooms/RoomsView`, `power/PowerView`, `browse/BrowseView`, and `ui/` (`HomeSection`, `Disclosure`, `EntityRow`, `EntityDetailSheet`, `useEntityDetail`, `home-ui.scss` — the shared vocabulary). |

## API — `GET /api/v1/home-dashboard/entities`

```
{ entities: [...], rooms: [{id, name}], types: [{id, label}], stateClasses: [{id, label}], haUrl,
  summary: {
    power: { wholeHouse: {entityId, watts}|null, energyToday: {entityId, kwh}|null,
             energyThisMonth: {entityId, kwh}|null, topConsumers: [{entityId, watts}] },
    on: [entityId], open: [entityId], motion: [entityId],
    lowBattery: [{entityId, pct}], unavailable: [entityId],
    thresholds: { lowBatteryPct, motionWindowMinutes } } }
```

`summary` holds ids and numbers only. A browser that receives a payload
without it (an older server) still renders Rooms and Browse and says so on Now.

## Configuration — `household/home/dashboard.yml`

Read through `DataService` by `YamlHomeDashboardConfigRepository` (the same
file also holds the older `summary` / `rooms` dashboard config). Every key in
every section is optional.

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

now:                                        # what the Now view reports
  low_battery_pct: 20                       # a battery at or below this is "low"
  motion_window_minutes: 15                 # presence cleared this recently still counts as motion
  on_types: [light, power, media]           # types whose "on" is news (not switch flags)
  ignore: []                                # globs never reported on Now (an always-on plug,
                                            #   a stuck occupancy sensor); "*_plug" also matches
                                            #   the part after the domain

power:                                      # the Power view and the sentence's draw
  whole_house: null                         # a power sensor id; default: the largest W reading
  energy_today: null                        # default: <whole_house>_power → _energy_today, if present
  energy_this_month: null                   # default: … → _energy_this_month, if present
  exclude: []                               # globs left out of the top-consumers ranking
                                            #   (a UPS inside a monitored circuit);
                                            #   "*_nominal_*" is always excluded — a rating is not a reading
  top: 5                                    # how many circuits to rank
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
- **Whole house:** with no `power.whole_house`, the largest live power reading
  is taken as the house — a panel total is by construction at least every
  circuit under it. On an Emporia install that is `sensor.panel_total_power`,
  not the `balance_*` sensor (the unmetered remainder). Name it if the
  heuristic picks wrong.
- **A room's temperature** (Now and Rooms): the room's thermostat reading if
  it has one, else its first temperature sensor that is not a device internal
  (`*device_temperature*`, `*internal*`, `*_outdoor_*`). The outdoor sensor is
  shown in the Climate heading instead.

## Observability

Backend: `home.entities.listed` (debug: readings, shown, rooms, unroomed, on,
open, motion, lowBattery, unavailable, wholeHouse), `home.entities.rooms.failed`,
`ha.listAreaAssignments.error`, `home.dashboard.toggle`.
Browser (`context.app:home`): `home.mount` / `home.unmount`, `home.view.change`,
`home.entities.loaded` (count, rooms, summary), `home.entities.toggle`,
`home.entities.toggle.failed`, `home.entities.turn-off-many`, `home.now.rendered`
(the Now counts, each poll), `home.now.disclose`, `home.room.off`,
`home.room.expand`, `home.room.more`, `home.power.meters`, `home.browse.mode`,
`home.browse.search` (sampled), `home.browse.show-unavailable`,
`home.entity.detail`.
