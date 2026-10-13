# Piano Kiosk Screensaver (tablet screen on/off)

**Date:** 2026-06-22
**Status:** Implemented (frontend + backend + config), pending deploy.

## Goal

The `/piano` kiosk (PianoApp, shown in FKB on a piano-mounted tablet) should sleep
its own screen when idle and wake it the instant someone plays. A BLE-MIDI note
wakes the screen; idle sleeps it (screensaver style), with guardrails.

## Behavior

- **Wake:** a fresh BLE-MIDI note (or a touch/keypress) → screen on — *unless* in
  quiet hours.
- **Sleep:** after `timeoutMinutes` of no MIDI/touch → screen off.
- **Guardrails:**
  - **Video playing** holds a wake lock → screen stays on during passive playback
    (which produces no MIDI/touch). Extensible: any mode can call
    `useKeepScreenAwake(reason, active)`.
  - **Quiet hours** (`{ start, end }`, "HH:MM", overnight ranges OK): notes/touch
    do NOT wake the screen, and an on-screen is slept on the next poll (unless a
    wake lock is held).

## Architecture

The tablet IS its own display, so this is **display-only** control via Fully
Kiosk's `screenOn`/`screenOff` REST commands — distinct from `device_control`
display power (`/on`, `/off`, which drive HA TV scripts).

### Backend
- `FullyKioskContentAdapter.screenOn()` / `screenOff()` — FKB REST `screenOn`/`screenOff`.
- `ResilientContentAdapter` delegates both to its primary (no ADB recovery — a
  screensaver wake is best-effort; the next note retries).
- `Device.setScreen(on)` — calls `contentControl.screenOn/screenOff` if present.
- Route: `GET /api/v1/device/:deviceId/screen/:state` (`state` = `on` | `off`).

### Frontend
- `usePianoScreensaver.jsx`:
  - `isWithinQuietHours(now, quietHours)` — pure helper (overnight-aware).
  - `PianoWakeLockProvider` + `useKeepScreenAwake(reason, active)` +
    `usePianoWakeLockState()` — ref-counted keep-awake registry.
  - `usePianoScreensaver({ deviceId, activeNotes, noteHistory, timeoutMinutes, quietHours })`
    — the controller (note/touch wake, idle poll → sleep). Inert until a
    `deviceId` is configured. Dedupes against believed screen state + in-flight.
- Wired in `PianoApp.jsx` (`PianoShell` under `PianoWakeLockProvider`).
- `Videos.jsx` holds `useKeepScreenAwake('video', !!selected)` while playing.

### Config
- **Device** (`data/household/config/devices.yml`): `yellow-room-tablet`,
  `content_control: { provider: fully-kiosk, host: 10.0.0.245, port: 2323,
  auth_ref: fullykiosk-piano }`. No `device_control` (display-only), no ADB fallback.
- **Auth** (`data/household/auth/fullykiosk-piano.yml`): FKB password (1Password
  "Fully Kiosk Piano"). Dedicated file — decoupled from the Shield's `fullykiosk.yml`.
- **Piano config** (`data/household/apps/piano/config.yml`): shared `screensaver`
  block (`timeoutMinutes`, `quietHours`) + per-piano `screensaver.deviceId`.
  `resolvePianoConfig` overlays per-piano over shared over defaults
  (`{ deviceId: null, timeoutMinutes: 20, quietHours: null }`).

## Verification
- `npx vitest run frontend/src/modules/Piano/PianoKiosk/` — 28 pass (incl.
  quiet-hours + screensaver-resolve tests).
- `node --check` clean on all 4 edited backend files.
- Live FKB smoke test against the tablet (10.0.0.245:2323): `deviceInfo` returns
  JSON (auth valid); `screenOff` then `screenOn` both return `{"status":"OK"}`
  and the screen physically toggled.

## Deploy note
`devices.yml` is loaded at backend startup — prod needs a container restart to
pick up the new device (per "Device Config API" memory). Piano `config.yml`
hot-reloads via the admin config route.
