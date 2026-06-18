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
  arming:                            # hardware hedge for the always-armed reader
    inter_arm_idle_ms: 1000          # rest between re-arms (0 = continuous)
    # active_hours: { start: 6, end: 24 }   # optional: only arm 6am–midnight local
```

### Arming hedge

The reader is kept armed in the background. Two config knobs reduce its duty
cycle without code changes:
- **`inter_arm_idle_ms`** (default `1000`): a rest between re-arms so the reader
  isn't armed 100% of the time, and a normal unlock gets a wider gap to claim it.
  A press landing in the brief idle gap is caught on the next arm — hold a beat
  longer. Set `0` for fully continuous arming.
- **`active_hours`** (default unset = armed 24/7): `{ start, end }` local hours;
  the detector only arms within `[start, end)`. Supports an overnight window
  (e.g. `{ start: 22, end: 6 }`). Use this to spare the sensor overnight if
  desired — at the cost of no emergency coverage outside the window.

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

Structured log events at every state change / junction (component `emergency` on
the frontend; module `fitness-emergency` on the backend).

**Backend — detector:** `detector_started`/`detector_stopped`, `standing_down`
(reason: `foreground-unlock` | `lockdown-active` | `outside-active-hours` |
`no-candidates`) / `arming_resumed`, `armed`, `detected`, `pending_consumed` /
`pending_expired` / `pending_absent`, `detector_error`.

**Backend — routes/use cases:** `state_query`, `scan_start` / `scan_result` /
`scan_unavailable`, `commit_accepted` / `commit_rejected` (reason) / `committed`,
`cancelled` / `cancel_denied`, `released` / `release_denied`, `ha_fired`,
`locked`.

**Frontend — hook (`useEmergencyLockdown`):** `seam_forced`, `status_clear` /
`status_failed`, `detected` / `detected_ignored`, `triggering`, `committed` /
`commit_no_lock` / `commit_failed`, `cancelled` / `cancel_denied`, `released` /
`release_denied` / `release_requested`, `locked` / `lock_extended`, `expired` /
`expiry_check_failed`, `normal` (with `reason`).

**Frontend — overlay:** `triggering`, `audio_playing` / `audio_blocked` /
`audio_threw`, `ceremony_end` (reason), `cancel_armed` / `cancel_scan` /
`cancel_denied`, `hold_start` / `hold_cancel` / `release_hold`.

Every return-to-`normal` carries a `reason` (`ws-released`, `expiry`,
`expiry-check-failed`, `commit-failed`, `cancel-confirmed`, `release-confirmed`),
so a state transition can always be traced to its cause.

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
stresses the sensor, use the **arming hedge** above (`inter_arm_idle_ms`,
`active_hours`) — both are live config knobs (default: 1s inter-arm gap, 24/7).
