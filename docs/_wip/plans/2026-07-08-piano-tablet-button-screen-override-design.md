# Piano tablet button → screen override

**Date:** 2026-07-08
**Status:** Design, not yet implemented
**Depends on:** [2026-07-01-piano-tablet-screen-power-sync.md](2026-07-01-piano-tablet-screen-power-sync.md)

## Goal

Bind the physical Zigbee button mounted at the yellow-room piano to the tablet's
Fully Kiosk Browser backlight:

- **Single press** toggles the screen.
- **Double press** turns the screen off and holds it off for a configured
  duration (30 min), immune to the automatic wake paths.

## The device

| | |
|---|---|
| Friendly name | `Yellow Room Tablet Button` |
| Model | Third Reality 3RSB22BZ |
| IEEE | `0x282c02bfffe3ed16` |
| Broker topic | `zigbee2mqtt-usb/Yellow Room Tablet Button/action` |
| Actions | `single`, `double`, `hold`, `release` |
| HA entities | `sensor.yellow_room_tablet_button_battery`, `update.yellow_room_tablet_button` |

Presses arrive as MQTT actions, not as an HA entity state. Both presses we need
are native to the firmware, so no HA-side double-click timing logic is required.

Four sibling 3RSB22BZ buttons already exist (office desk ×4, kitchen table).

## Why this isn't just an HTTP call

The HTTP surface already exists in `4_api/v1/routers/device.mjs`:

- `GET /device/:deviceId/screen/on|off` → FKB `screenOn`/`screenOff`
- `POST /device/:deviceId/screen/suppress-wake` `{minutes}` → mutes MIDI wakes

What's missing is not a route. It's that **three independent writers already
drive this screen**, and a naive press loses to all of them.

1. `PianoScreenAuthorityService` enforces `piano OFF ⇒ screen OFF`, re-asserting
   every 45 s, and pulses the screen ON on a piano OFF→ON power edge.
2. `PianoMidiWakeService` pokes `screenOn` on any BLE-MIDI note-on.
3. The browser's `usePianoScreensaver` wakes the screen on MIDI activity; its
   `midiSuppressedRef` is a **local ref**, armed only by the in-browser
   "Who's Playing" screen-off button.

So: a single press turning the screen ON dies within 45 s of reconcile whenever
the piano is off (which is most of the time). And a double press turning it OFF
is undone by the next played note, or by someone flipping the piano on.

The button needs standing among those writers, not a fourth uncoordinated voice.

## Where the override lives

A new **`ScreenOverrideService`** in `3_applications/devices/services/`. It is a
`Map<deviceId, {state, until}>` with `set(deviceId, state, minutes)`,
`get(deviceId)` (returns `null` once expired), and `clear(deviceId)`, plus an
injected `clock` for testability. It knows nothing about pianos, FKB, or Home
Assistant. It answers exactly one question: *is there a live manual screen
intent for this device, and what is it?*

### Rejected: the FKB adapter

`FullyKioskContentAdapter` is a transport implementing the `IContentControl`
port. Putting the override there fails three ways:

- **It would have to lie.** `screenOff()` would sometimes return ok without
  acting. `PianoScreenAuthorityService#applyScreen` then calls `#verify()`, sees
  a mismatch, retries three times with backoff, escalates to `loadStartUrl()`,
  and fires an HA notification. A suppressed call is indistinguishable from a
  broken tablet.
- **It can't tell callers apart.** A manual press and a reconcile force-OFF both
  arrive as `screenOff()`. Distinguishing them means a caller-identity parameter
  on the port — policy leaking into the transport. `IContentControl` is also
  implemented by `WebSocketContentAdapter` and `ResilientContentAdapter`, which
  would never honor it.
- **It's shared with the living room.** `livingroom-tv` uses the same adapter
  class (`devices.yml`, `provider: fully-kiosk`, `10.0.0.12:2323`). Timed screen
  policy in a class that also drives the Shield is a footgun.

### Rejected: a private field on `PianoScreenAuthorityService`

Fewer files, but it buries a generic concept behind a piano-specific name and
couples `PianoMidiWakeService` to the authority service to read it.

### The invariant

`setScreen` remains the only thing that talks to FKB, and it never lies. The
override gates *whether a caller decides to call it* — never what the adapter
does once called. This is what lets the existing verify → retry → `loadStartUrl`
→ notify ladder keep working untouched.

## Components

```
  Zigbee button
       │  MQTT: zigbee2mqtt-usb/Yellow Room Tablet Button/action
       ▼
  HA automation (trigger only — no state, no timers)
       │  rest_command → daylight-station:3111
       ▼
  device.mjs router
       │  set/clear
       ▼
  ScreenOverrideService  ◄── read ──  PianoScreenAuthorityService
       ▲                  ◄── read ──  PianoMidiWakeService
       │  GET (15s poll)
  usePianoScreensaver (browser)
```

### Routes (`4_api/v1/routers/device.mjs`)

| Route | Behavior |
|---|---|
| `GET /:deviceId/screen/toggle` | Read `getStatus().screenOn`, flip it, set the override (`on` → `onHoldMinutes`; `off` → clear), call `setScreen(next)`. Returns `{screenOn, override}`. |
| `POST /:deviceId/screen/override` `{state, minutes}` | Set the window, call `setScreen(state === 'on')`, relay to `pianoMidiWakeService.suppressWakeUntil()`. |
| `GET /:deviceId/screen/override` | Read the live window. Polled by the browser. |

Existing `screen/:state` and `suppress-wake` routes are unchanged.

### Service changes

- **`PianoScreenAuthorityService`** takes an injected `screenOverrideService`.
  In `#tickPoll`, a live window returns early — no OFF→ON edge pulse, no
  continuous-off debounce fire. In `#tickReconcile`, a live window enforces *the
  override's* state rather than piano power.
- **`PianoMidiWakeService`** replaces its private `#suppressUntil` with a read of
  the shared window. `suppressWakeUntil()` survives as a thin setter so the
  existing route and the APK relay keep working.
- **`usePianoScreensaver.jsx`** folds `GET screen/override` into its existing
  15 s poll and drives `midiSuppressedRef` from
  `override?.state === 'off' || localArmedCooldown`.
- **`useScreenControl.js`** — the on-screen "Turn off screen" action POSTs the
  override instead of a bare `screen/off`, so browser, button, and HA all write
  one window.

## Behavior

Given `onHoldMinutes: 10` and `offCooldownMinutes: 30`:

| Press | Screen was | Override after | FKB call | What can re-light it |
|---|---|---|---|---|
| `single` | off | `{on, +10m}` | `screenOn` | — (reconcile can't kill it) |
| `single` | on | cleared | `screenOff` | MIDI note, piano power-on, touch |
| `double` | either | `{off, +30m}` | `screenOff` | touch only |
| `hold` / `release` | — | — | — | unbound |

The asymmetry is the point: single-press-off is soft, so a played note wakes the
tablet right away; double-press-off is sticky.

**Expiry is not a wake.** When the window lapses, `PianoScreenAuthorityService`
resumes normal control: piano off → reconcile re-asserts OFF (already off,
no-op); piano on → the screensaver owns the screen, so it stays dark until a note
or a touch. Nothing lights up on its own at minute 30.

## Config

`data/household/config/piano.yml` gains a `button:` block. The off-hold is *not*
declared there — it inherits `screensaver.offCooldownMinutes`, which already
means "min NO-input gap before a played note re-wakes after a manual screen-off"
and is what the on-screen action already uses. The physical double press is the
twin of that action, so the two must not be able to drift apart.

```yaml
screensaver:
  deviceId: yellow-room-tablet
  timeoutMinutes: 3
  offCooldownMinutes: 30   # double press reuses this

button:
  enabled: true
  deviceId: yellow-room-tablet
  onHoldMinutes: 10        # new: single-press-ON override TTL
  # offHoldMinutes omitted → inherits screensaver.offCooldownMinutes
```

## Failure modes

**DS restarts mid-hold.** The `Map` is in-memory, so the window is lost and the
authority service resumes piano-power control on the next poll. The piano is
usually off when you'd double-press, so the screen stays off regardless.
Accepted — persistence isn't worth it for a 30-minute window.

**FKB unreachable when the press lands.** The router's `setScreen` may fail, but
the override is already set, so the 45 s reconcile tick sees the mismatch and
re-applies, escalating through the existing retry ladder. The override makes the
press self-healing, which the current bare `screen/off` route is not.

**`getStatus()` fails during a toggle.** We can't read `screenOn`. Fail-safe to
*assume off* and turn the screen ON, matching the authority service's existing
"unknown power ⇒ treat as ON, leave the tablet usable" posture. A press must
never be a no-op.

**Touch always wins.** FKB `screenOff` kills the backlight; a physical touch
wakes the panel at the OS level and nothing here can prevent it. Correct — touch
is unambiguous intent. The hold protects against notes and piano power, not
against a person tapping the glass.

## Open question to verify on-device

Does a double press emit `double` alone, or `single` followed by `double`? Z2M
exposes both values. If `single` fires first, the screen flicks on before going
off, and the `single` automation needs a short debounce that a subsequent
`double` cancels. Confirm with a read-only `mosquitto_sub` on the action topic
before writing the automations.

## Change list

### DaylightStation — backend

| File | Change |
|---|---|
| `3_applications/devices/services/ScreenOverrideService.mjs` | New. ~40 lines. |
| `3_applications/devices/services/PianoScreenAuthorityService.mjs` | Read the override in `#tickPoll` and `#tickReconcile`. |
| `3_applications/devices/services/PianoMidiWakeService.mjs` | Read the shared window instead of `#suppressUntil`. |
| `4_api/v1/routers/device.mjs` | Three new routes. |
| `5_composition/modules/pianoScreenPowerSync.mjs` | Construct the shared service, inject into both piano services and the router. |

### DaylightStation — frontend

| File | Change |
|---|---|
| `PianoKiosk/usePianoScreensaver.jsx` | Read the override in the existing 15 s poll. |
| `PianoKiosk/useScreenControl.js` | On-screen off action POSTs the override. |

### Home Assistant (`Home/homeassistant/_includes/`)

- `rest_commands/devices.yaml` — add `yellow_room_tablet_screen_toggle` and
  `yellow_room_tablet_screen_override`.
- `automations/yellow_room_tablet_button_single.yaml` and
  `automations/yellow_room_tablet_button_double.yaml` — MQTT-topic triggers on
  `zigbee2mqtt-usb/Yellow Room Tablet Button/action`, each firing one
  `rest_command`. No state, no timers, no `choose:`.
- `reload_config.sh` afterward. No `input_*` domains touched, so no extra
  `<domain>.reload` call is needed.
- Regenerate `home_inventory.yaml` via `home_inventory.sh` — the button was
  paired 2026-07-08 and is absent from the current inventory.

### Tests

- New `ScreenOverrideService` unit tests: expiry, replace, clear.
- `tests/isolated/application/devices/PianoScreenAuthorityService.test.mjs` —
  live override suppresses the edge pulse; reconcile enforces override state, not
  piano power; expired override restores piano-power control.
- `PianoMidiWakeService.test.mjs` — shared-window read.
- Router tests for `screen/toggle`, including the `getStatus()`-fails-assume-off
  path.

## Sequencing

The backend is deployable and verifiable on its own. `curl` the toggle and
override routes against `yellow-room-tablet` and watch the panel before Home
Assistant ever sees the button. Wire the automations last.

Nothing in this design touches `livingroom-tv` or the Shield's FKB at
`10.0.0.12`.
