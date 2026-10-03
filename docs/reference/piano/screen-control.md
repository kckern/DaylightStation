# Piano Tablet Screen Control

Who turns the piano tablet's backlight on and off, and how a manual hold works.

## Writers

| Writer | Where | Does |
|---|---|---|
| Browser screensaver | `frontend/src/modules/Piano/PianoKiosk/usePianoScreensaverHooks.js` | Wakes on MIDI/touch, sleeps after `screensaver.timeoutMinutes` idle or during quiet hours. Calls `GET /api/v1/device/:id/screen/{on,off}`. |
| Manual "Turn off screen" | `usePianoScreenOff.js` → `useScreenControl.js` | FKB JS bridge `turnScreenOff()`, then `POST …/screen/suppress-wake` to open an **off hold**. |
| Physical piano button | `DeviceScreenControlService.toggle` / `setOverride` | Toggles the panel; ON opens an **on hold** (`button.onHoldMinutes`). |
| MIDI wake (backend) | `PianoMidiWakeService` | Pokes FKB `screenOn` on a note, unless an off hold is live. Relays the hold deadline to the bridge APK's on-device waker. |
| Power authority | `PianoScreenAuthorityService` | Piano power OFF ⇒ screen OFF. While a hold is live, its reconcile tick (~45s) **enforces the hold's state** on the real panel. |

## Holds (`ScreenOverrideService`)

A hold is `{state:'on'|'off', until}` per device, in memory on the backend.

- `GET  /api/v1/device/:id/screen/override` — read it (the browser polls every 15s).
- `POST /api/v1/device/:id/screen/override {state}` — open one.
- `POST /api/v1/device/:id/screen/suppress-wake {minutes}` — open an off hold (manual screen-off path; default `screensaver.offCooldownMinutes`, 30).
- `DELETE /api/v1/device/:id/screen/override` — release it early. Releasing an off hold also unmutes MIDI wake on the backend and on the APK.

**A touch on the panel releases an off hold.** The browser calls `DELETE` whenever a touch or keypress lands while either its local cooldown or a server off hold is live. Before this (fixed 2026-10-02), a touch cleared only the browser's cooldown. The server hold stayed, and the authority reconcile blacked the panel out every ~45s, mid-play, until the 30 minutes ran out.

## Diagnosing "the screen keeps turning off"

1. `curl -s localhost:3111/api/v1/device/yellow-room-tablet/screen/override`: a live `off` explains forced blackouts.
2. Log store: `piano-screen-authority.reconcile.override` lines whose times match `page.visibility hidden` mean the authority is enforcing a hold.
3. `piano.screen state:off` from `piano-kiosk` is the browser screensaver's normal idle sleep.
4. FKB `deviceInfo`: `isPlugged`, `screenOn`. FKB's own timers (`timeToScreenOffV2`, `screensaverTimeout`) are 0 by design.
