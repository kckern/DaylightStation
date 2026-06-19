# Emergency Lockdown

A panic/safety action for the garage gym: an authorized adult presses a finger on the garage
reader **in any normal context** in the Fitness app — no unlock modal open — to lock the
display and power down the equipment. It runs a deliberate "DEFCON" powerdown ceremony, then
fires a Home Assistant script that cuts the TV, speaker, fan, LEDs, and heater, and holds the
screen in a `LOCKED` state for a configured duration. Vocabulary is abstract — "authorized
user / locked / release", never role-specific.

The lock is **per-household**, persists across reboot, and is reversible by an authorized scan.

## How a touch triggers it

The garage reader runs an always-on scan loop that resolves every real touch to a user and
broadcasts it. The frontend identity router is the single owner of what a scan means in the
moment: it inspects whether an unlock modal is open and what the lockdown phase is.

In a **normal** context (no modal), only a scan from an emergency-authorized user matters — it
starts the ceremony. The same authority gates the abort and the release, so the people allowed
to trigger a lockdown are exactly the people allowed to cancel or release one. A scan from a
non-authorized finger in a normal context is ignored.

See [fingerprint-unlock.md](./fingerprint-unlock.md) for the scan/authority model and how the
reader is shared between the always-on loop and foreground unlock requests.

## The three phases

The overlay drives a three-stage state machine. Nothing is shown in the normal phase; the
other two phases each take over the whole screen.

| Phase | What's on screen | Equipment |
|-------|------------------|-----------|
| `normal` | nothing | running |
| `triggering` | DEFCON ceremony — power glyph, "SYSTEM LOCKDOWN INITIATED", progress bar, Cancel | running |
| `locked` | inert "LOCKED — Back at H:MM" screen | shut down |

### Triggering (the ceremony)

The ceremony is a deliberate window — long enough to read the screen and undo a mistake before
anything is shut down. It plays a powerdown cue and advances a time-based progress bar. The
window is the longer of the cue's duration and a **~10s minimum**, so even a short (or
autoplay-blocked) clip still leaves a readable abort window. The clock is time-based, not tied
to the audio `ended` event, so a silent kiosk still commits on schedule.

A **Cancel** affordance is shown throughout. Tapping it pauses the ceremony clock (so the
countdown can't auto-commit out from under an in-progress cancel) and opens the unlock modal
asking for a confirming scan. The original triggering scan is **not** reused — a fresh
authorized finger is required to abort. Two scans total cancel a lockdown: the trigger, then
the confirm.

- **Confirmed abort** → returns to normal; **nothing is shut down**.
- **Dismissed or denied** → the modal closes and the ceremony resumes from where it paused.
- **Window elapses without a confirmed abort** → the ceremony commits.

### Commit → shutdown

On commit the screen flips to `LOCKED` **first**, and the Home Assistant shutdown fires after a
short buffer. The order is deliberate: the kiosk shows `LOCKED` while the equipment keeps
running for a beat, so the cutover isn't jarringly instant, and every screen observes the lock
promptly. The lock state is persisted and broadcast before the buffer, so all screens flip
together.

If the Home Assistant call fails, the lock does not strand the user behind a `LOCKED` screen
while the equipment runs on: the failure compensates by clearing the lock and returning every
screen to normal, and the failure is surfaced to the caller.

A lockdown is also a **session end**. The normal end-of-session path never runs while the kiosk
is locked out, so committing a lockdown finalizes every active workout session and fires each
session's recap — done in the background so it never delays the screens flipping to `LOCKED`.

### Locked

The locked screen shows "LOCKED" and, when a window is known, the time it will lift. It is inert
to normal taps and keys. Two things end it:

- **Early release** — press and hold anywhere for ~3 seconds, then present an authorized finger
  when prompted. A confirmed scan returns the screen to normal.
- **Auto-release** — the lock clears itself once its window elapses; the screen drops back to
  normal on its own.

On app load the frontend reads the current lock state from the server, so a garage/browser
reboot lands straight back in `LOCKED` if a lock is still active. The far-future-window timer is
clamped so a long window can't misfire its expiry re-check.

## Menu music ducks during the ceremony and lockdown

While the lockdown phase is anything other than normal, the menu's background music ducks out —
the powerdown ceremony and the locked screen are not competing with menu audio. The powerdown
cue itself plays on the shared cue-audio element. The duck lifts when the phase returns to
normal. This reuses the same audio-cue plumbing the rest of the fitness UI uses; see
[audio-duck-cues.md](./audio-duck-cues.md).

## State and persistence

The single current lockdown is persisted per household as a small record — when it was locked,
who locked it, and the epoch the window lifts. There is at most one active lockdown at a time;
clearing it removes the record. A corrupt or partial record on disk is treated as unlocked
rather than crashing, and a record whose window has already passed self-clears on the next read.

## API

All under `/api/v1/fitness`. The mutating routes are gated on a **recent pending detection** —
a scan the backend is holding from the always-on loop — so an arbitrary client can't trigger,
abort, or release a lockdown without a real authorized touch.

| Method/Path | Purpose |
|---|---|
| `GET /emergency` | Current state: `{locked:false}` or `{locked:true, lockedUntil, lockedBy}` (self-clears when expired) |
| `POST /emergency/commit` | Finalize after the ceremony — `409` if no recent detection, `503` if the use case isn't wired |
| `POST /emergency/abort` | Confirm a cancel via an authorized scan → `{confirmed}` |
| `POST /emergency/release` | Release an active lock via an authorized scan → `{released}` |

WebSocket broadcasts keep every screen in sync: a lock and a release are each broadcast so all
fitness screens flip together (including the initiating one).

## Configuration

Household fitness config declares which users may trigger and release a lockdown (an emergency
lock entry naming authorized usernames, who must have enrolled fingerprints), the lockdown
duration, the Home Assistant script fired on commit, and the powerdown cue. Config is loaded at
startup; changes require a backend restart to take effect. Without a configured Home Assistant
gateway, the ceremony and lock screen still work but no devices are shut down (dev mode).

For operational procedures, troubleshooting, and the config keys, see the runbook:
[`docs/runbooks/fitness-emergency-lockdown.md`](../../runbooks/fitness-emergency-lockdown.md).

## Observability

Structured events fire at every junction (component `emergency` on the frontend, `emergency.*`
on the backend): state queries, ceremony start, audio playing/blocked, ceremony end with a
reason, commit accepted/rejected/committed, cancel confirmed/denied, release/release-denied,
the Home Assistant fire, lock/expiry, and every return-to-normal carrying a reason so a
transition can always be traced to its cause.

## Testing seam

A URL seam forces the initial phase (`?emergency=triggering` or `?emergency=locked`) so the
overlay can be exercised visually or in e2e without a real authorized scan. Only the initial
phase is forced; live websocket/HTTP transitions proceed normally afterward.

## Source map

- Backend use cases and port: `backend/src/3_applications/fitness/usecases/` (trigger / release
  / get-state) and `backend/src/3_applications/fitness/ports/`.
- Domain value object: `backend/src/2_domains/fitness/value-objects/`.
- Persistence: `backend/src/1_adapters/persistence/yaml/`.
- API routes: `backend/src/4_api/v1/routers/fitness.mjs` (emergency endpoints).
- Frontend hook + overlay: `frontend/src/modules/Fitness/hooks/` and
  `frontend/src/modules/Fitness/player/overlays/`; trigger routing in
  `frontend/src/modules/Fitness/identity/`; menu-music duck in `frontend/src/modules/Fitness/nav/`.
- Operations: [`docs/runbooks/fitness-emergency-lockdown.md`](../../runbooks/fitness-emergency-lockdown.md).
