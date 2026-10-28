# Home dashboard (`/home`)

The household's Home Assistant view, built around two questions: *what has
the house been doing today*, and *what is every device doing right now?* It
opens on **Today** — one sentence about the house, then the day as lanes —
and keeps every device one tab away on **Mosaic**.

| View | What it shows |
|---|---|
| **Today** (default) | A live status sentence ("The house is drawing 505 W, with 9 lights on and a door open in the garage. Someone is in the office." — it names only rooms with someone in them right now; otherwise "The last movement was in the kitchen, 8 minutes ago."), then a **Today / Yesterday / Week** switch (remembered per viewer) over the household's timeline lanes: **power** as a filled area with the day's kWh, **events** (a doorbell's rings) as dots at mid-height with a ring count (a dot, not a full-height tick, so a ring never reads as the now line), **occupancy** (a room's presence) as bars with hours occupied, **screen** (a TV plug) as bars with hours on and kWh. A day strip runs midnight to midnight with 6-hour guides (12a / 6a / 12p / 6p); today's strip carries a **now** line and the hours still to come are dimmed. Week is seven thin rows per lane, oldest first, today last, each with a two-letter weekday (Su Mo Tu …); eight lanes of a week fit a 900 px-tall screen. A day has data only when the lane's entity held a known value somewhere inside that day (a value carried in from before midnight counts; a day before its first point, or one it spent unavailable, does not). A lane with no history on any day says "No history" and claims no total — never "0 rings" or "0 h". Today re-reads every minute while the page is visible; Yesterday and Week are settled and read once. |
| **Mosaic** | Every device as one small square carrying an icon for its kind, grouped **by room** or **by type** (remembered per viewer). The colour is what it is doing: amber on, blue someone there, orange open, a cool-to-warm round **dot** for a temperature (55 °F blue to 85 °F red; °C converted), dark for quiet. Attention is graded: a red outline on top of any fill for **needs attention** (stuck "on", low battery); a device **not answering** (unavailable) is dimmed (45 %) with a faint red hairline instead, and its tooltip and label say "not answering" — a large install has dozens of sleeping sensors, and a red ring on each would drown the stuck one. Squares are 22 px (34 px with 20 px icons and 4 px gaps on a coarse pointer). A group header counts what is lively ("3 on"). The only words on the board are group names: a square explains itself in a tooltip ("Kitchen light · On · changed 8:29 pm") on hover, keyboard focus or a first tap, and opens its drawer on a click or a second tap. A legend names the colours, "Not answering" included. |
| **Rooms** | One row per room: name, lights ("2 on" with an amber dot; a dark room says nothing), temperature, last motion — a cell is a figure or blank, never a dash. Tap a row to open the room in place: lights with switches (and a room-level "Turn off all N"), then plugs / doors / media / fans, then "Show all N readings and switches" for sensors, batteries, meters and automation flags. Roomless entities gather under "Elsewhere", last. |
| **Cameras** | The camera grid, unchanged. |

**Where the old views went.** **Now**'s sentence heads Today; its On list and
room-level "Turn off all" are in Rooms; Open, Motion, Needs attention and
Climate are the Mosaic's orange, blue, red-outline (or dimmed, for not answering) and temperature squares.
**Power** is the Power lane's drawer. **Browse** (the dense list by type, room
or state) is the Mosaic. A viewer whose saved tab was `now` or `power` opens on
Today, `browse` / `type` / `state` on Mosaic, `room` on Rooms.

**Drawers.** Tapping a device (a Mosaic square, a Rooms entity) opens the
**entity drawer**, a panel at the right of the page (`Sheet placement="side"`):
the state in large type with the switch at the end of that line when the
household allows one, its **history** with a **24 h / 7 d** switch (a reading
as an area chart — watts labelled in W / kW — an on/off entity as a solid amber
band, rings as dots; axis labels speak the Today scale's clock, "6 pm" and
"Wed 28", in the household's zone), the room (omitted when there is none; in
italic, the app's convention, when guessed from the entity id), when it last
changed, the "Open in Home Assistant" link (HA's history page for the entity —
only here), and the entity id last, small and muted. **"No history in this
range"** means the entity held no known value in the range (`hasData: false`);
a lamp off all day draws a flat band, a door kept shut the same, and a doorbell
nobody rang an empty axis over "No rings in this range". Highcharts is lazy-loaded, so it stays out of the home
bundle until a drawer opens.

Tapping a **lane** opens the same drawer for the lane's primary entity, plus
what the lane adds below the history: the Power lane gets **where the power
goes** (the draw, today's and this month's kWh in a sentence, then the top
circuits ranked with proportional bars — never the whole-house meter or its
energy counters, nor a meter reading as much as the whole house, which is a
second panel total rather than a circuit); a doorbell lane with a `camera` gets the **rings** in the
shown range, newest first, each with the camera's recorded clip. A doorbell
opened from anywhere else (its history names the camera) shows the same rings.
The drawer follows the shown range and each poll, not the lane as tapped.

**Rings and clips.** A ring is matched to the clip nearest it, measured to the
clip's nearest **edge** (zero inside the clip), within **120 s**: the camera
records on motion, so the clip with the visitor may end just before the button
or start just after. No clip that close reads "No recording near this ring",
never a broken player. Clips are read per local day the rings could fall in
(including a day just across midnight), one request per day; a failed day costs
only its own clips. When every day fails, every ring is still listed with its
time, under "Clips could not be loaded." and a Retry. The **4 newest** matched
clips load eagerly; older ones offer **Show clip**. A clip is a picture until
tapped: its first frame (no native controls, at most 12 rem tall) under one play
button; the controls appear once it plays. A matched clip the camera then
fails to serve reads **"Recording could not be loaded"** with a Retry that
mounts a fresh player — never a broken video element.

**Escape** closes the topmost layer anywhere in the app: `HomeApp` mounts one
`DismissStackProvider`, the drawers register on it, and an open Mosaic
tooltip is a layer of its own, so Escape hides it first.

Design rules the views follow: one type family (IBM Plex Sans, tabular figures
in columns); one colour with one meaning, shared by the lanes and the Mosaic
(`--ds-warning` amber = on/lit); sections separated by a single hairline, rows
by space; sentence case throughout; no cards except camera tiles; controls only
where control is allowed *and* plausibly wanted.

## Layers

| Layer | File | Job |
|---|---|---|
| Domain | `__app_modules/household/home/server/domain/home-automation/EntityCatalogPolicy.mjs` | Value object built from the YAML `entities:` section: which entities are shown, each one's type, which are switchable. Defaults when the section is absent. |
| Domain | `…/domain/home-automation/HomeEntity.mjs` | Value object for one entity: id, name, state, **state class** (`on` / `off` / `reading` / `unavailable`), type, room, controllable. Getters only; no `toJSON` (serialization is the API's job). |
| Domain | `…/domain/home-automation/HouseSummary.mjs` | `HouseSummaryPolicy` (value object from the YAML `now:` and `power:` sections: low-battery threshold, motion window, which types count as "on", entities never reported, which meter is the whole house, meters left out of the ranking) and `summarizeHouse(entities, policy, {now})`, a pure function returning entity **ids** — what is on, open, moving, low or silent, and the power figures. Presentation joins the ids back. |
| Domain | `…/domain/home-automation/resolveRoom.mjs` | Pure room resolution, by authority: `config` (YAML override) → `provider` (HA area, including through the device) → `inferred` (the entity id starts with a room's id, name or alias, e.g. `switch.den_tv_plug` → Den). |
| Domain | `…/domain/home-automation/historySeries.mjs` | Pure history shaping over ascending step-function series `[{t, v}]` (`v: null` = unavailable): `localMidnight` and `dayWindows` (DST-safe local days for `today` / `yesterday` / `week`), `bucketLine` (time-weighted mean and peak per bucket, unavailable time excluded), `toIntervals` (on-spans, gaps ≤ 2 min bridged), `risingEdges` (off → on strictly inside the window; already-on and unknown → on are not edges), `sumIntervalsMs`, `dailyCounterTotal` (a counter that resets at midnight, tolerating a reset in the last 10 minutes), `counterDelta` (a `total_increasing` meter's growth, a decrease read as a reset), `integrateKwh`, `hasKnownValue` (a non-null value held somewhere inside a window, carried-in included). No clock, no I/O. |
| Domain | `…/domain/home-automation/TimelinePolicy.mjs` | Value object from the YAML `timeline:` section (validated lanes, with a Power-lane fallback from `power.whole_house`), `laneForEntity` (an entity's first lane), and `buildLaneDay(lane, history, window, {buckets})`: one lane's day as `points` / `marks` / `intervals` plus a total, or `hasData: false` with null totals when the lane's primary series holds no known value inside that day's window (`hasKnownValue`). |
| Domain | `…/domain/home-automation/MosaicPolicy.mjs` | Value object from the YAML `mosaic:` section (hidden globs, room order, room merges, type groups, type order) and `arrangeMosaic(entities, policy, {types})`, returning `{byRoom, byType}` as ordered groups of entity ids. Merges are keyed apart from rooms, so a real room that shares a merge's id keeps its own group (the merge's group id then reads `merge:<id>`); `mergeShadows(policy, roomIds)` names such merges. |
| Application | `…/application/home-automation/ports/IHomeEntityGateway.mjs` | Port: `listReadings()` returns provider-neutral `EntityReading`s (`name`, `deviceClass`, `unit`, `detail` — no platform attribute keys) and throws when the platform is unreachable; `listRooms()` is empty, never failing, when room data is unavailable. |
| Application | `…/application/home-automation/ports/IHomeHistoryGateway.mjs` | Port: `readHistory(entityIds, {startMs, endMs})` returns `Map<entityId, [{t: epochMs, v}]>`, `v: null` for no value; `endMs: null` means "until now"; an unreachable platform yields an empty Map. No ISO strings or platform non-value states cross it. |
| Application | `…/application/home-automation/usecases/GetHomeEntities.mjs` | Applies the catalog policy to every reading; lists only the rooms (alphabetically) and types that hold something; asks for rooms only after the readings succeed; then applies the summary policy (`summary`) and the mosaic policy (`mosaic`); a merge whose id is also a platform room id is logged (`home.mosaic.merge_shadows_room`, warn, once per load) and drawn apart — never a failed page, since the platform can add a room at any time. Takes an injectable `clock` for the motion window. A `ValidationError` from any YAML section surfaces as `ConfigurationError` with the offending key; any other error is left as it is. |
| Application | `…/usecases/GetHomeTimeline.mjs` | Validates the range (`InvalidInputError` → 400), loads the timeline policy, makes **one** history read for every lane entity across the whole range (open-ended for today and week, closed at midnight for yesterday), builds each lane's days, and sums each total over the days that have data (null when none do). Days are the household's local days (`configService.getHouseholdTimezone()`). |
| Application | `…/usecases/GetEntityHistory.mjs` | One entity's last 24 h or 7 d for the drawer. Readable only if it is a timeline lane entity or the catalog policy admits it (else `MissingResourceError` → 404); the `entities:` section is parsed only for a non-lane entity, so a malformed one never blocks a lane's drawer. Shapes the answer as `events` (the primary entity of an events lane, with the lane's `camera`), `line` (every known value numeric; with no history, a `sensor`/reading state class decides) or `state` (on-intervals by the domain's on-states). |
| Application | `…/usecases/ToggleDashboardEntity.mjs` | Allows a configured room light, or a real entity (checked with `getState`) that the policy makes controllable. A room-level "Turn off all" is one explicit `off` per lamp from the browser, not a new endpoint. |
| Adapter | `…/adapters/HomeAssistantEntityGateway.mjs` | The anti-corruption layer: implements the entity port over the injected `IHomeAutomationGateway`, in the shape of `HomeAssistantDeviceAdapter` (no HTTP client of its own), and translates HA's attribute bag (`friendly_name`, `brightness` 0–255…) into `EntityReading`. Caches room data for 5 minutes (a failed lookup for 1 minute); treats an empty state read as unreachable. |
| Adapter | `…/adapters/HomeAssistantHistoryGateway.mjs` | Implements the history port over the same injected gateway: ISO times → epoch ms, `unavailable` / `unknown` / empty → `null`. An open window still sends an end — the **next whole minute** — because HA's history endpoint ends a request without `end_time` one day after its start (a week "until now" came back as its first day). The composition hands it the use cases' clock, so a window's start and its open end agree. |
| Adapter | `…/adapters/persistence/YamlHomeDashboardConfigRepository.mjs` | Reads `household/home/dashboard.yml` through `DataService`; hands the `entities`, `now`, `power`, `timeline` and `mosaic` sections on as plain objects (each `{}` when absent). |
| Capability | `__capabilities/home-control/server/adapters/homeassistant/HomeAssistantAdapter.mjs` | `listAreaAssignments()` renders one Jinja template (`area_id()` / `area_name()`), because HA's REST API has no area registry. `getHistory(entityIds, {sinceIso, endIso})` calls `/api/history/period` with `minimal_response` and caches each answer for 60 s by window and entity set. |
| Camera | `__app_modules/household/camera/server/adapters/CameraClipLibrary.mjs` | A camera's recorded clips for a day (ledger, else a live camera search) and one clip's bytes, cached on disk. See [camera-feed.md](../camera-feed.md#recorded-clips). |
| API | `__backend/src/4_api/v1/handlers/home-dashboard/entities.mjs` | `GET /api/v1/home-dashboard/entities`; presents each `HomeEntity` as the response DTO and passes `summary` and `mosaic` through; `Cache-Control: no-store`. |
| API | `__backend/src/4_api/v1/handlers/home-dashboard/timeline.mjs` | `GET /api/v1/home-dashboard/timeline` and `GET /api/v1/home-dashboard/entities/:entityId/history`; pass the range (default `today` / `24h`) through — validation and the 400/404 mapping live in the use cases; `Cache-Control: no-store`. |
| Browser | `__app_modules/household/home/browser/` | `HomeApp` (AppChrome: Today / Mosaic / Rooms / Cameras; bottom tabs on mobile, rail on tablet-up; one `DismissStackProvider`), `entities/useHomeEntities` (10 s poll while visible; a toggle sends an explicit `on`/`off`, shows the expected state until a reading agrees or 5 s pass, and blocks a second tap meanwhile; `turnOff(list)` fans out; `summary`, `mosaic` and `fetchedAt`), `entities/formatEntityState`, `now/composeStatus` (pure: the status sentence), `today/` (`TodayView`, `useTimeline`, `TimelineLane`, `laneGeometry` — time onto a 0..1000 viewBox, `dayWindow` running a day to its coming midnight with `nowMs`, `hourTicks` — `formatLaneTotal`, `LaneDetailSheet`, `PowerBreakdown`), `mosaic/` (`MosaicView`, `squareTone` — the one colour rule — `mosaicIcons`), `history/` (`useEntityHistory`, `historyChart` pure options, `HistoryChart`), `doorbell/` (`RingClips`, `useRingClips`, `matchRingToClip`), `rooms/summarizeRooms` (pure) + `rooms/RoomsView`, and `ui/` (`Disclosure`, `EntityRow`, `EntityDetailSheet`, `useEntityDetail`, `turnOffLabel`, `home-ui.scss` — the shared vocabulary). |

## API

### `GET /api/v1/home-dashboard/entities`

```
{ entities: [...], rooms: [{id, name}], types: [{id, label}], stateClasses: [{id, label}], haUrl,
  summary: {
    power: { wholeHouse: {entityId, watts}|null, energyToday: {entityId, kwh}|null,
             energyThisMonth: {entityId, kwh}|null, topConsumers: [{entityId, watts}] },
    on: [entityId], open: [entityId], motion: [entityId], stuck: [entityId],
    lowBattery: [{entityId, pct}], unavailable: [entityId],
    thresholds: { lowBatteryPct, motionWindowMinutes, motionStaleHours } },
  mosaic: {
    byRoom: [{id, label, entityIds}],   // rooms, then type groups (id "type:<type>"), then "_elsewhere"
    byType: [{id, label, entityIds}] } }
```

`summary` and `mosaic` hold ids and numbers only. A browser that receives a
payload without `mosaic` (an older server) says so on the Mosaic tab.

### `GET /api/v1/home-dashboard/timeline?range=today|yesterday|week`

```
{ range, timeZone, generatedAt,
  days: [{day: "YYYY-MM-DD", startIso, endIso}],      // oldest first; today ends at "now"
  lanes: [{ id, kind, label, camera, entityIds: {primary, energy},
            days: [{ day, hasData,
                     points?:    [{t, v, max}],        // power (v, max null = no reading)
                     marks?:     [epochMs],            // events
                     intervals?: [{from, to}],         // occupancy, screen
                     total: {kwh} | {count} | {hours} | {hours, kwh} }],
            total }] }                                 // summed over days with data; null when none
```

Default range `today`; anything else is 400. No lanes configured is
`lanes: []` (the view says where to add them).

### `GET /api/v1/home-dashboard/entities/:entityId/history?range=24h|7d`

```
{ entityId, range, timeZone, hasData, sinceIso, endIso, camera,
  kind: "line"   → points: [{t, v, max}]
      | "state"  → intervals: [{from, to}]
      | "events" → marks: [epochMs] }
```

Default range `24h`; anything else is 400; an entity the dashboard does not
show is 404. `hasData` is false when the entity held no known (non-null)
value anywhere in the window — a value carried in from before it counts; only
points after it, or unavailable throughout, do not;
`timeZone` is the household's, so a client files rings under household days.
`camera` is set only for an events lane's primary entity.

### Camera clips (`GET /api/v1/camera/:id/clips`, `/clips/file`)

`?day=YYYY-MM-DD` lists `{camera, day, clips: [{start, end, name, labels}]}`,
ascending; `/clips/file?name=…` serves one clip as range-aware MP4
(`Cache-Control: private, max-age=3600`). 404 unknown camera, 400 bad `day` or
`name`, 503 when no clip library is wired, 502 when the camera fetch fails.
Full contract in [camera-feed.md](../camera-feed.md#recorded-clips).

## Configuration — `household/home/dashboard.yml`

Read through `DataService` by `YamlHomeDashboardConfigRepository` (the same
file also holds the older `summary` / `rooms` dashboard config). Every key in
every section is optional. A value that breaks a rule is a `ConfigurationError`
naming its key (e.g. `timeline.lanes[2].on_watts`), not a silent default.
A bad `mosaic:` section fails `/entities` with a `ConfigurationError` exactly
as a bad `entities:`, `now:` or `power:` section does.

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

now:                                        # the status sentence and the Mosaic's flags
  low_battery_pct: 20                       # a battery at or below this is "low"
  motion_window_minutes: 15                 # presence cleared this recently still counts as motion
  motion_stale_hours: 24                    # presence "on" for longer than this is a stuck sensor:
                                            #   a red outline, not counted as motion
  on_types: [light, power, media]           # types whose "on" is news (not switch flags)
  ignore: []                                # globs never reported (an always-on plug);
                                            #   "*_plug" also matches the part after the domain.
                                            #   Not for a stuck sensor — that is a fault to see

power:                                      # the sentence's draw and the Power lane's drawer
  whole_house: null                         # a power sensor id; default: the largest W reading
  energy_today: null                        # default: <whole_house>_power → _energy_today, if present
  energy_this_month: null                   # default: … → _energy_this_month, if present
  exclude: []                               # globs left out of the top-consumers ranking
                                            #   (a UPS inside a monitored circuit);
                                            #   "*_nominal_*" is always excluded — a rating is not a reading
  top: 5                                    # how many circuits to rank

timeline:                                   # the Today lanes, drawn in this order
  lanes:                                    # default: absent → one "Power" lane from
                                            #   power.whole_house (+ power.energy_today) if set,
                                            #   else no lanes. A present list replaces it.
    - id: power                             # required; a slug [a-z0-9_-], unique among lanes
      kind: power                           # required; power | events | occupancy | screen
      label: Power                          # default: the id; a non-empty string
      power: sensor.panel_power             # power, screen: required — a watts sensor
      energy: sensor.panel_energy_today     # optional; power: a counter that resets at midnight
                                            #   (else kWh is integrated from the watts)
    - id: doorbell
      kind: events                          # rising edges of a binary entity: rings
      entity: binary_sensor.porch_visitor   # events, occupancy: required
      camera: doorbell                      # events only; a camera id (slug) → clips in the drawer
    - id: den
      kind: occupancy                       # spans the entity was "on"
      entity: binary_sensor.den_presence
    - id: den-tv
      kind: screen                          # spans the plug drew at least on_watts
      power: sensor.den_tv_plug_power
      energy: sensor.den_tv_plug_energy     # optional; screen: a total_increasing meter
      on_watts: 5                           # default 5; a number from 0 to 5000
  # Every entity id must look like domain.object_id ([a-z_]+.[a-z0-9_]+).
  # Keys a kind does not use are ignored (an events lane's `power`).

mosaic:                                     # how the Mosaic groups squares
  hide: []                                  # globs never drawn; matched against the entity id
                                            #   and the part after the domain
  room_order: []                            # room (or merge) ids first, in this order;
                                            #   the rest alphabetically after them. Slugs
  merge_rooms: []                           # rooms drawn as one group:
                                            #   - { id: downstairs, label: Downstairs, rooms: [den, hall] }
                                            #   id: required slug, unique; rooms: required non-empty
                                            #   list of room slugs; label: default the id.
                                            #   A room may sit in one merge only, and a merge id may
                                            #   not be a room some merge lists (both config errors).
                                            #   A merge id that matches a real room is not an error:
                                            #   the two draw as separate groups, with a warning.
  type_groups: []                           # types pulled out of their rooms into one group each
                                            #   (after the rooms, before "Elsewhere"), e.g. [battery]
  type_order: []                            # types listed first; the rest keep the default order:
                                            #   light, power, climate, presence, openings, media,
                                            #   battery, switch, sensor, other
  # type_groups / type_order entries must be one of the built-in types above.
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
  circuit under it. On an Emporia install that is the panel-total power sensor,
  not the `balance_*` sensor (the unmetered remainder). Name it if the
  heuristic picks wrong. The timeline's fallback Power lane needs it named.
  Any other meter reading as much as the whole house or more (a mirror of the
  panel total, the feed) is left out of the top consumers.
- **A room's temperature** (Rooms): the room's thermostat reading if it has
  one, else its first temperature sensor that is not a device internal
  (`*device_temperature*`, `*internal*`, `*_outdoor_*`).
- **`on_watts`:** set it between the plug's standby draw and its on draw —
  read a week of the plug's history (`/entities/<power id>/history?range=7d`)
  for the two clusters. 5 W is right when standby is near zero.
- **Mosaic order:** in By room, each group's squares run by type order, then
  name; in By type, roomed devices come first, by room then name.

## Bounds

- **One history read per request.** The timeline asks for every lane entity
  over the whole range at once; the drawer asks for one entity.
- **Bucket budgets.** Power lines: 288 buckets for a single day (5 min), 96 per
  day across a week (15 min, 672 in all). The drawer: 288 across 24 h (5 min),
  336 across 7 d (30 min). Each bucket carries the time-weighted mean and the
  peak; marks and intervals are not bucketed.
- **Interval merge.** On-spans separated by a gap of 2 minutes or less are one
  span, so a flapping sensor draws one bar.
- **Minute-aligned windows.** The drawer's window starts on a whole minute (now
  − 24 h or − 7 d, floored); an open window ends at the next whole minute. Both
  keep repeat requests inside a minute on one cache key.
- **HA cache.** `getHistory` answers are cached 60 s per window and entity
  set, so the 1-minute Today poll and several open drawers cost HA one
  request a minute each.
- **Polling.** Entities every 10 s while visible; the Today timeline every
  60 s while visible (and on becoming visible); Yesterday, Week and drawer
  history are fetched once and cached per path (stale-while-revalidate), so
  flipping back paints at once.
- **Clips.** At most 4 players load eagerly; the clip cache holds the 40
  most recently used clips per camera. A clip someone is waiting on is fetched
  with the short interactive policy — 30 s idle, one retry — not the archive
  job's 300 s / 4 retries (see camera-feed.md).

## Observability

Backend: `home.entities.listed` (debug: readings, shown, rooms, unroomed, on,
open, motion, lowBattery, unavailable, wholeHouse), `home.entities.rooms.loaded`
(debug), `home.mosaic.merge_shadows_room` (warn: mergeId, roomId), `home.entities.rooms.failed`, `ha.listAreaAssignments.error`,
`home.dashboard.toggle`, `home.timeline.built` (debug: range, lanes, entities,
ms), `home.history.read` (debug: entityId, range, kind, points),
`home.history.empty` (warn: the platform returned nothing for a non-empty
request — usually unreachable), `ha.getHistory.error`. Camera clips:
`camera.clips.listed` (debug: camera, day, source `ledger`|`camera`, count),
`camera.clips.fetched` (info: camera, name, bytes),
`camera.clips.ledger_unreadable`, `camera.clips.search_failed`,
`camera.clips.source_unavailable`, `camera.clips.fetch_failed`,
`camera.clips.send_failed` (warn).

Browser (`context.app:home`): `home.mount` / `home.unmount`, `home.view.change`,
`home.entities.loaded` (count, rooms, summary), `home.entities.toggle`,
`home.entities.toggle.failed`, `home.entities.turn-off-many`, `home.room.off`,
`home.room.expand`, `home.room.more`, `home.entity.detail`;
Today: `home.today.mount` / `home.today.unmount`, `home.today.range`,
`home.timeline.loaded` (debug: range, lanes), `home.timeline.failed`,
`home.lane.open` (laneId, kind); drawer: `home.history.loaded` (debug: entityId,
range, kind), `home.history.range`, `home.history.failed`; rings:
`home.ring.list` (debug), `home.ring.clips` (debug: camera, days, clips,
failedDays), `home.ring.clips.failed`, `home.ring.clips.retry`,
`home.ring.play`, `home.ring.clip.failed` (warn: camera, ringMs, clip, attempt,
media error code), `home.ring.clip.retry`; Mosaic: `home.mosaic.mount` / `home.mosaic.unmount`,
`home.mosaic.mode`.
