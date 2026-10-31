# Fitness ambience tabs

An **ambience** is a fitness-menu tab that turns the garage into a scene rather
than a workout: one looping muted video, a music playlist over it, and a Home
Assistant script that owns the room (lights, heat). The first one is the
Halloween tab.

## Config

`nav_items` entry in the household fitness config (`plex.nav_items`):

```yaml
- type: ambience
  name: Halloween
  icon: pumpkin              # media/img/icons/<icon>.svg
  order: 5
  dates: ['10-31']           # optional — see "Date gating"
  target:
    id: halloween            # URL: /fitness/ambience/halloween
    video: plex:<episode-id> # single item, loops
    playlist: plex:<playlist-id>
    ha_script: script.<name> # optional
    shuffle: true            # optional, default true
```

## Date gating

Any nav item may carry `days` (0=Sun … 6=Sat) and/or `dates`:

- `'MM-DD'` recurs every year; `'YYYY-MM-DD'` is that one day.
- With both set, the item must match both.
- Missing or empty arrays mean "always shown".

The filter is `filterNavItemsByDay` (`browser/lib/navigationUtils.js`), fed by
`useDayOfWeek` + `useLocalDate`, both of which roll over at local midnight
without a reload. A deep link to `/fitness/ambience/:id` on a day the tab is
hidden goes back to `/fitness`.

## Runtime

- The tab opens the Dance Party widget in ambience mode
  (`config.ambience`): the video loops via `queue.continuous`, the playlist
  plays, and the party extras (strobe, BPM publishing, accents,
  video-advance-per-song) are off.
- `useAmbienceLighting` posts `POST /api/v1/fitness/ambience/:id/start` on
  mount and `/stop` on unmount; the lights button in the now-playing bar
  toggles the same two calls.
- `AmbienceController` (server) looks the id up in config and calls
  `script.turn_on` on that item's `ha_script` with
  `variables: { command: start | stop }`. The client never names the entity.
- While an ambience is running, `AmbientLedAdapter` skips heart-rate zone
  scenes (`reason: ambience_active`).

Log events: `fitness.ambience.start_request` / `stop_request` (browser),
`fitness.ambience.start` / `stop` / `*_failed` / `unknown` (server).

## Home Assistant script contract

The script receives `command` and owns everything, including cleanup:

- `start` — claim `input_select.garage_led_scene` (its own option, e.g.
  "Halloween"), run the room, loop while that option is selected.
- `stop` — hand the room back (lights off, selector to "Off").
- Use `mode: restart` so a stop cancels a running loop.

A new ambience option in `garage_led_scene` must be excluded where Dance Party
is: the LED watchdog, LED state sync, restart cleanup, dark mode and
`garage_deactivate`. Otherwise those automations fight the loop within seconds.
The Halloween script (`script.garage_led_halloween`) is the worked example:
5 s orange/purple crossfade, heat on with the heater override renewed every
30 min, auto-end at midnight, and a 60 s wedge guard (the ceiling strip only
reports every ~25 s).
