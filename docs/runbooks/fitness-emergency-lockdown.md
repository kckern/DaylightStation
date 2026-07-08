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

### Automatic trip on scanner abuse

To stop an unauthorized person overheating the reader by mashing fingers, the
backend counts **failed** scans (unrecognized, OR a recognized identity that
holds no locks). On `emergency.abuse.threshold` failures within
`emergency.abuse.window_sec` it auto-runs the same ceremony as an admin press —
DEFCON screen, cancel window, then commit + `garage_deactivate`. An **admin scan
during the ceremony still aborts it**, so a false positive is recoverable. A
recognized member holding ≥1 lock (incl. admins) is "safe" and resets the streak.

The trip is decided server-side: the relay **arms a server-authoritative commit**
and broadcasts `fitness.emergency.ceremony` to start the overlay. The lock no
longer depends on the browser finishing its ceremony — if the kiosk commits first
(normal case) it locks immediately; otherwise the relay commits the lockdown
itself `emergency.abuse.server_commit_delay_ms` after the trip (default 25s). An
admin abort during the ceremony disarms this server commit — but only if it lands
within `server_commit_delay_ms`; a slow abort (e.g. dithering in the cancel modal
past that window) locks anyway, which is the safe direction and recoverable by an
admin re-scan to release. The lock records `lockedBy: abuse-protection`.
`/emergency/commit` is idempotent (an already-active lock returns the current
state, never a 409), so a late or duplicate browser commit can never bounce the
kiosk out of LOCKED.

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
- **Release early:** press-and-hold anywhere for **3 seconds**. The screen shows
  "Scanning…" and **the backend actively re-arms the garage reader** for an admin
  fingerprint (the detector is stood down during a lockdown, so without this the
  reader would be idle and the press would do nothing). Press an admin finger;
  a match → returns to normal. The arm window is the unlock service's capture
  timeout (~15s); if it times out or a non-admin finger is read, the screen stays
  LOCKED and you can hold again to retry.
- The release re-arm is scoped to **emergency-admin candidates only** (the same
  `buildAuthz().admin` set that may trigger the lockdown), so it can never match a
  non-admin finger — re-opening the reader during LOCKED doesn't weaken the lock.
- **Auto-release:** the lock clears itself once `duration_sec` elapses (the
  screen drops back to normal on its own).

## Configuration

Household fitness config (`data/household/config/fitness.yml`):

```yaml
locks:
  emergency: [user_1, user_9]     # admins allowed to trigger AND release
emergency:
  duration_sec: 1800                 # lockdown length (default 30 min)
  ha_script: garage_deactivate       # HA script.<name> fired on commit
  audio: apps/fitness/ux/powerdown.mp3
  abuse:                             # scanner-abuse auto-lockdown (default ON)
    enabled: true                    # set false to disable entirely
    threshold: 3                     # failed scans to trip
    window_sec: 30                   # sliding window for the count
    server_commit_delay_ms: 25000    # server-side fallback commit delay after a trip
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
| `POST /emergency/release` | Re-arm the reader + release an active lock via admin scan → `{released}`; `503 {error:'unlock-service-unavailable'}` if no reader is wired |

WebSocket broadcasts: `fitness.emergency.detected`, `fitness.emergency.ceremony`
(auto-trip → start ceremony), `fitness.emergency.locked`,
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
`cancelled` / `cancel_denied`, `release_scan_start` (re-arm fired) /
`release_scan_error`, `released` / `release_denied` (reason:
`unlock-service-unavailable` | `no-admin-candidates` | `no-match`), `ha_fired`,
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
- **Press-and-hold to release does nothing / reader feels dead while LOCKED.**
  The detector stands down during a lockdown, so the reader is only armed for the
  ~15s window the 3s hold opens. Press your admin finger *after* "Scanning…"
  appears, and hold a beat — `release_scan_start` in the logs confirms the re-arm
  fired. A `503 unlock-service-unavailable` means the garage unlock service isn't
  wired (dev mode / bridge down) — there's no reader to arm.
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
