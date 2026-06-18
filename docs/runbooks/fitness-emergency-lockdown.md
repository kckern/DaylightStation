# Runbook: Fitness Emergency Lockdown

**What it is:** A parent/admin can shut down the garage gym by pressing their
fingerprint on the garage reader **in any normal context** in the Fitness app
(no unlock modal open). It plays a dramatic "DEFCON" powerdown sequence, then
fires the `garage_deactivate` Home Assistant script (TV, speaker, fan, LEDs,
heater off) and locks the screen for a configured duration. State persists
server-side and survives reboot. It is reversible by an admin fingerprint.

Design: `docs/_wip/plans/2026-06-17-fitness-emergency-lockdown-design.md`.
Plan: `docs/_wip/plans/2026-06-17-fitness-emergency-lockdown-plan.md`.

---

## How to trigger

Press an **admin** fingerprint (a user listed under `locks.emergency` in fitness
config — currently the parents) on the garage reader while the Fitness app is in
a normal state (browsing, playing, etc.). The backend keeps an `emergency` scan
armed in the background; an admin match starts the sequence.

## The sequence

1. **DEFCON screen** — black/red glowing power glyph, "SYSTEM LOCKDOWN
   INITIATED", the powerdown cue plays, a progress bar tracks it.
2. **Cancel window (mistake undo)** — while the audio plays, a **Cancel** button
   is shown. Tap it → it changes to "SCAN TO CONFIRM CANCEL" → press an admin
   fingerprint again to confirm. Confirmed → returns to normal, **nothing is shut
   down**. (Two scans total to abort: trigger, then cancel-confirm.)
3. **Commit** — if the audio finishes without a confirmed cancel, the backend
   fires `garage_deactivate` and the screen enters the **LOCKED** state.

## The LOCKED state

- Shows "LOCKED — Back at H:MM" and is inert to normal taps/navigation.
- **Release early:** press-and-hold anywhere for **3 seconds**, then press an
  admin fingerprint when prompted. Confirmed → returns to normal.
- **Auto-release:** the lock clears itself once `duration_sec` elapses (the
  screen drops back to normal on its own).

## Configuration

Household fitness config (`data/household/config/fitness.yml`):

```yaml
locks:
  emergency: [kckern, elizabeth]     # admins allowed to trigger AND release
emergency:
  duration_sec: 1800                 # lockdown length (default 30 min)
  ha_script: garage_deactivate       # HA script.<name> fired on commit
  audio: apps/fitness/ux/powerdown.mp3
```

- The admins must have **enrolled fingerprints** in their user profiles for the
  trigger/release scans to match (same as the other `locks`).
- Config changes require a backend container/process restart to take effect
  (config is loaded at startup).

## Where state lives

Server-side: `household[-{hid}]/history/fitness/emergency_lock.yml`
(`{ lockedUntil, lockedBy, lockedAt }`, epoch seconds). On app load the frontend
calls `GET /api/v1/fitness/emergency`; if a lock is active it drops straight into
the LOCKED screen — so a Firefox/garage reboot stays locked. The backend reports
the lock as expired once `now ≥ lockedUntil`.

## API (under `/api/v1/fitness`)

| Method/Path | Purpose |
|---|---|
| `GET /emergency` | `{locked:false}` or `{locked:true, lockedUntil, lockedBy}` |
| `POST /emergency/commit` | Finalize after the ceremony (409 if no recent detection) |
| `POST /emergency/abort` | Confirm a cancel via admin scan → `{confirmed}` |
| `POST /emergency/release` | Release an active lock via admin scan → `{released}` |

WebSocket broadcasts: `fitness.emergency.detected`, `fitness.emergency.locked`,
`fitness.emergency.released`.

## Observability

Structured log events (component `emergency` on the frontend; module
`fitness-emergency` on the backend): `emergency.detector_started`,
`emergency.armed`, `emergency.detected`, `emergency.triggering`,
`emergency.ceremony_end`, `emergency.cancelled`/`cancel_*`, `emergency.committed`,
`emergency.ha_fired`, `emergency.locked`, `emergency.release_hold`,
`emergency.released`, `emergency.expired`.

## Troubleshooting

- **Nothing happens on an admin press while idle.** Confirm the garage bridge is
  connected (the detector logs `emergency.armed` repeatedly when arming). Confirm
  the admin has enrolled fingerprints and is listed in `locks.emergency`.
- **DEFCON screen shows but no audio (kiosk).** The garage Firefox gates audible
  autoplay until a user gesture (see `CLAUDE.local.md`). The ceremony still
  commits via a fallback timer even when audio is blocked. To get audio, set
  `media.autoplay.default = 0` in the garage Firefox profile.
- **Commit returns 409 `no-pending-detection`.** Commit must follow a real
  detection within ~30s. If the ceremony ran long or the detection expired,
  re-press the fingerprint.
- **HA script didn't fire.** `garage_deactivate` only fires if the Home
  Assistant gateway is configured for the household; without it, detection and
  the lock screen still work but no devices are shut down (dev mode).

## Known caveat (verify on real hardware)

The detector keeps the `emergency` scan **continuously re-armed** against the
garage bridge (no garage-bridge code changes were needed). Unit/e2e tests use
fakes and don't exercise the live reader. Before relying on it in production,
confirm: (a) the bridge tolerates continuous re-arming, and (b) a normal unlock
still wins the reader (the foreground arbiter pauses the detector during a normal
unlock — `unlockService.beginForeground/endForeground`). If continuous arming
stresses the sensor LED, the detector supports an inter-arm idle gap / the
arming can be gated to active hours (config-driven follow-up).
