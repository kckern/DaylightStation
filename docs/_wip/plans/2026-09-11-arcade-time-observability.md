# Arcade Time Observability & Metered Play — Requirements and Design

**Date:** 2026-09-11
**Status:** Requirements agreed; design proposed; no code written yet
**Related:** `docs/_wip/plans/2026-07-17-household-economy-design.md`,
`docs/reference/economy/economy.md`,
`frontend/src/modules/Fitness/widgets/EmulatorGame/`,
`frontend/src/modules/Media/` (fleet / device-state precedent)

---

## 1. Purpose

Children play emulated games on two unrelated surfaces: **RetroArch** on the
living-room Shield, and an **in-browser EmulatorJS console** inside the Fitness
app. We want play time to be *purchased with household coins and then burned
down*, with a visible countdown on screen and an enforced stop when the time is
gone.

The blocking problem is not the wallet and not the UI. It is that **nothing in
the system currently knows whether a game is actually being played right now.**
Everything else in this document follows from closing that gap.

This document records what was empirically established on the hardware
(Section 3), states the requirements (Section 4), and proposes a design that
fits the environment we actually have (Section 5).

## 2. Scope

**In scope**

- A device-scoped, real-time notion of "a game session is running", published on
  the event bus as discrete start/stop events plus progress.
- A single session contract implemented by both emulator surfaces.
- An accurate elapsed-play-time figure that the economy can consume.
- An on-screen warning/countdown surface over RetroArch gameplay.
- An enforced end-of-time shutdown that returns the screen to the kiosk.

**Out of scope (for this iteration)**

- Coin pricing, purchase flows, parental policy and caps — owned by the economy
  design doc; this document only consumes "N seconds were bought".
- Forking RetroArch (see 3.2 — it is the only path to a graceful save, and is
  explicitly deferred).
- Per-player identification on a shared couch (see 7.1).

## 3. Findings

Everything in this section was verified on the live Shield on 2026-09-11.
Claims that were **disproven** are called out, because several of them are
plausible-sounding and would otherwise be retried.

### 3.1 The emulator surfaces are epistemically different

| | RetroArch (Shield) | EmulatorJS (Fitness) |
|---|---|---|
| Ownership | Third-party app we cannot instrument | Ours, in-process |
| Session edges | **Inferred** from outside, polled | **Exact**, from lifecycle |
| Latency | Bounded by poll interval | Immediate |
| Existing metering | None | `coinMeteredGate.js` (client-side hold-and-settle) |

Any shared contract must absorb this asymmetry without pretending the inferred
signal is as good as the exact one.

### 3.2 RetroArch exposes no remote-control surface (disproven capability)

RetroArch *does* implement exactly the API this feature wants — `GET_STATUS`,
`SHOW_MSG`, `SAVE_STATE`, `CLOSE_CONTENT`, `QUIT` over UDP — but **it is not
compiled into the Android build.** `pkg/android/phoenix-common/jni/Android.mk`
defines `HAVE_NETWORKING` and `HAVE_NETWORK_CMD` but never `HAVE_COMMAND`, and
every command lives behind `HAVE_COMMAND`.

Verified three independent ways:

1. `strings` over the shipped `libretroarch-activity.so`: `GET_STATUS`,
   `SHOW_MSG`, `CLOSE_CONTENT`, `SAVE_STATE_SLOT`, `PAUSE_TOGGLE`,
   `MENU_TOGGLE`, `READ_CORE_MEMORY`, `NetCMD` are **all absent**.
   `network_cmd_enable` / `network_cmd_port` / "Network Commands" **are**
   present — they come from the menu layer, so the
   **Settings → Network → Network Commands toggle is vestigial UI that enables
   nothing.**
2. No UDP socket ever binds on the command port (`netstat -uln` on the device).
3. A full `config_save_on_exit` config dump contains no `network_cmd_*` or
   `stdin_cmd_enable` keys, because those `SETTING_BOOL` rows are
   `#ifdef HAVE_COMMAND`.

Adding `network_cmd_enable = "true"` to `retroarch.cfg` is a no-op. **Do not
retry it.**

### 3.3 Injected input does not control RetroArch (disproven capability)

`adb shell input` events *do* reach the app — RetroArch logs a new pad,
`SHIELD Virtual Controller (0000/0000)`, and runs autoconfig — but reports
`Device "SHIELD Virtual Controller" (0:0) is not reserved for any player slot`,
and the input is discarded.

Tried and failed, against a confirmed-running game: `ESC` (111,
`input_exit_emulator`), `F2` (132, `input_save_state`), `BACK` (4), `HOME` (3);
both default and explicit `keyboard` / `gamepad` sources; and rebinding the
hotkeys to joypad buttons (`input_exit_emulator_btn` / `input_save_state_btn`)
so the gamepad path could carry them. No reaction in any combination.

System-level keys such as `WAKEUP` do work, so injection itself is healthy —
RetroArch simply does not consume it.

### 3.4 There is no graceful shutdown, and therefore no forced save

- `savestate_auto_save = true` and `.state.auto` files exist across many games,
  so a **clean** RetroArch exit does save. There is no external way to trigger
  a clean exit (3.2, 3.3).
- `am force-stop` is a SIGKILL: the auto-savestate does **not** run (verified —
  `.state.auto` mtime unchanged across a kill of a running game).
- **Backgrounding does not save either.** Bringing the kiosk forward leaves the
  RetroArch process alive and emulation paused, with no savestate written.
- **The "swap the ROM to force a content-close" trick does not work.** A new
  intent delivered to a running instance is ignored
  (`Activity not started, intent has been delivered to currently running
  top-most instance`); content is not closed and no autosave fires.

**Consequence:** ending a session always costs unsaved progress. This is the
reason the warning sequence is a requirement rather than a nicety.

### 3.5 Relevant on-device configuration

| Setting | Value | Why it matters |
|---|---|---|
| `pause_nonactive` | `true` | Backgrounded game stops emulating — must not accrue time |
| `savestate_auto_save` / `_auto_load` | `true` | Clean exits save and resume; kills do not |
| `autosave_interval` | `10` | SRAM (battery saves) bounded to ~10s loss on a kill |
| `quit_on_close_content` | `1` | Closing content exits the app |
| `config_save_on_exit` | `true` | RetroArch rewrites its config on clean exit |
| `log_verbosity` / `log_to_file` | `true` | Per-session timestamped log files exist |

### 3.6 Observability channels that work

| Signal | Source | Properties |
|---|---|---|
| **`foregroundApp`** | Fully Kiosk REST `deviceInfo` | **Primary.** ADB-free, survives reboots. Reads the emulator package while a game is up, the kiosk package otherwise. Verified flipping both ways. |
| **CPU delta** | ADB `/proc/<pid>/stat` utime+stime | **Confirmer.** ~15 ticks/sec while emulating a GB title; **0** when paused, backgrounded, or stuck. |
| Process presence | ADB `pidof` | Unambiguous end-of-session signal |
| Per-session log file | RetroArch `log_dir`, timestamped filename | Start time in the filename; mtime advances while running; records core, content and save redirection |
| Focused window | ADB `dumpsys window` | Cross-check on foreground |

**Neither primary signal is sufficient alone.** A misconfigured core once left
RetroArch *foregrounded and running with zero CPU and no game loaded* — the
foreground signal alone would have billed that as play. The CPU delta is what
separates "alive" from "actually emulating".

### 3.7 On-screen messaging over gameplay

**There is no OS-level toast.** `am` offers only `force-stop` / `crash`; `cmd -l`
exposes `notification`, `overlay` and `statusbar`, where `overlay` is Runtime
Resource Overlays (theming) and `statusbar` is meaningless on a TV.

**`cmd notification post` renders nothing** on this device. Notifications post
successfully and appear in `cmd notification list`, but create **zero new
SurfaceFlinger layers** — confirmed structurally (layer-list diff before/after)
and visually (screenshot during gameplay). With the kiosk replacing the Leanback
launcher there is no notification surface. Do not build on it.

**Fully Kiosk provides three channels that do work over a fullscreen game:**

| Channel | Result |
|---|---|
| `textToSpeech` | Speaks over gameplay. Zero code. |
| `showToast` | Standard system toast pill. Not stylable. |
| **`webOverlayUrl` + `webOverlayGravity`** | **Renders an arbitrary web page as a system overlay.** |

The web overlay is the important one. Its window is
`ty=APPLICATION_OVERLAY`, `fmt=TRANSPARENT`, with flags
`NOT_FOCUSABLE NOT_TOUCHABLE NOT_TOUCH_MODAL LAYOUT_IN_SCREEN
SHOW_WHEN_LOCKED DISMISS_KEYGUARD HARDWARE_ACCELERATED`.

Those flags are exactly what this feature needs:

- `NOT_FOCUSABLE` — never steals focus, so `pause_nonactive` never pauses the
  game because of our UI.
- `NOT_TOUCHABLE` / `NOT_TOUCH_MODAL` — all input passes through to the game.
- `HARDWARE_ACCELERATED` — CSS animation is smooth.

**Verified end to end:** a transparent, full-screen, WebSocket-connected page
rendered a user avatar, a live ticking countdown, colour-coded urgency states
and a floating toast over live gameplay, driven by a backend push, while the
game continued emulating at unchanged CPU.

**Two mechanical gotchas**, both of which cost time:

- The overlay window is **fill-width / wrap-height**. A page using
  `position:fixed` collapses to zero height and renders nothing. The page must
  have natural flow height; pin it to the display height in script for a
  full-screen film.
- `webOverlayGravity` must be a real Android gravity value; the default leaves
  the overlay unplaced.

### 3.8 Launch path

- **Fully Kiosk REST `startIntent` accepts a full Android intent URI with
  extras**, so the backend can launch a game directly without going through the
  kiosk WebView.
- An `am start` from ADB is useless: the kiosk re-takes the foreground and stops
  the activity within about a second. **Kiosk-initiated launches survive.**

### 3.9 Screenshots are available (correction)

An early conclusion that the display is `FLAG_SECURE` and `screencap` always
returns black was **wrong**. Those black frames were captured while the TV was
unpowered and the panel had no active sink. With the display live, `screencap`
returns full-quality frames and is a reliable verification channel.

Related: **RetroArch cannot run without an active display.** With the TV off it
launches, never renders, ANRs on the first input event and is killed. Any
on-device test requires the panel actually on.

### 3.10 Configuration hazard found en route

The live launcher config is **`data/household/gaming/games.yml`** (registry key
`games`). A **stale twin** exists at `data/household/gaming/retroarch/config.yml`
(registry key `retroarch`) which **nothing reads** — yet `catalog.yml` *in that
same directory* **is** live. The stale file still carries absolute core paths
under a shell-owned temp directory, which the app cannot execute
(`avc: denied { execute } ... tcontext=shell_data_file`); a launch using them
leaves RetroArch idling at 0% CPU with nothing on screen and no error.

The authoritative check on what production actually sends is the launch-intent
endpoint, not any YAML on disk.

### 3.11 Event bus facts

- Clients subscribe with
  `{ type: 'bus_command', action: 'subscribe', topics: [...] }`.
- **Client-published messages are not generically relayed.** Only specific
  server-side rules rebroadcast (call signalling, a fitness-source rule, piano
  MIDI). A new topic needs a server-side producer.
- The admin broadcast route exists but currently answers
  `503 EventBus not configured`.
- The precedent to follow is **`device-state:<deviceId>`**: snapshots published
  via the ingress adapter, a liveness service that synthesises `offline` when
  heartbeats stop, a fleet bridge that feeds the Media app's device view, and a
  one-shot `waitForStateChange` helper.

## 4. Requirements

### 4.1 Functional

- **FR-1 — Session start is an observation, not an intent.** A start event is
  emitted only once emulation is *confirmed*, and carries the observed time. A
  launch request that never produces emulation must never open a billable
  session.
- **FR-2 — Session end is always emitted**, with a reason distinguishing a
  clean end, an enforced timeout, and a session that was lost.
- **FR-3 — Progress is reported continuously** while a session is open,
  carrying cumulative played time and the current play state.
- **FR-4 — Played time counts only observed play.** Paused, backgrounded, idle-
  at-a-title-screen and post-crash gaps must not accrue. Played time is never
  `end − start`.
- **FR-5 — One contract, both surfaces.** RetroArch and EmulatorJS publish the
  same events; consumers cannot tell which produced them except via a `surface`
  field and a stated confidence.
- **FR-6 — Sessions are attributed** to a user and a content item (title,
  console, content id) and scoped to a device.
- **FR-7 — Switching games ends one session and starts another**, with time
  accounted separately.
- **FR-8 — A countdown is visible on the play surface**, with escalating
  warnings as time runs out.
- **FR-9 — Expiry enforces a stop**: the game is terminated and the screen
  returns to the kiosk.
- **FR-10 — The player is warned before termination**, with enough lead time to
  save, because termination destroys unsaved progress (3.4).
- **FR-11 — The economy consumes played time**, decrementing purchased time; it
  is the book of record for the balance.
- **FR-12 — The overlay is scoped to devices that declare it.** A play overlay
  appears only on a device whose configuration declares one, only while that
  device has an open play session, and never anywhere else. Surfaces that can
  draw their own countdown in-app do not use a device overlay at all.

### 4.2 Non-functional

- **NFR-1 — Fail safe in both directions.** When play state cannot be
  determined, the system must neither bill nor terminate.
- **NFR-2 — Accuracy is bounded and declared.** Inferred sessions are accurate
  only to the poll interval; that bound travels with the data rather than being
  implied.
- **NFR-3 — Idempotent accounting.** Duplicated, retried or replayed messages
  must not double-charge.
- **NFR-4 — Restart tolerance.** A backend restart mid-session must not lose or
  double-count time already played.
- **NFR-5 — Zero gameplay impact.** Observation and overlay must not pause,
  slow, or steal input from the running game.
- **NFR-6 — No new device dependencies.** Prefer channels that survive a device
  reboot without re-authorisation.
- **NFR-7 — Observable.** Every state transition and every enforced termination
  is logged through the structured logging framework.
- **NFR-8 — Blindness is detected and recovered, not merely tolerated.** Loss of
  observation must raise an alarm, fall back through alternate channels, and be
  reconciled against on-device evidence once sight returns. Silence must never be
  indistinguishable from an idle device.

## 5. Detailed design

### 5.1 Shape

**Naming rule (non-negotiable).** `RetroArch` is a vendor word. Per
`docs/reference/core/layers-of-abstraction/ddd-reference.md` it may appear only
inside `1_adapters/`. No domain entity, use case, port, event or bus topic names
a vendor. The ubiquitous term is **play session**: a period during which a
person is actually playing a game on a device.

```
  1_adapters/gaming                         4_api (push ingress)
  RetroArchPlayObservationSource            browser emulator reports
        │  polled, inferred                       │  exact, self-reported
        └───────────────┬─────────────────────────┘
                        ▼
        3_applications/gaming/usecases
             RecordPlayObservation          ← the single convergence point
                        │
                        ▼
             2_domains/gaming
                  PlaySession               ← state machine + played-time math
                        │
        ┌───────────────┼─────────────────────────┐
        ▼               ▼                         ▼
   event bus       economy burn              overlay driver
 play-session:*   (purchased time)        (film over the game)
```

**Both surfaces converge on one use case.** The browser emulator *pushes*
observations through the API; the inferred source is *pulled* by a scheduler
that calls the same use case with the same shape. Neither the domain nor the
application layer knows that RetroArch exists — they see only observations with
a stated confidence. That is what makes FR-5 structural rather than aspirational.

### 5.2 Event contract

Published on `play-session:<deviceId>`, mirroring the `device-state:<deviceId>`
precedent so the Media fleet view can absorb it later.

```
play.session.started
  { sessionId, deviceId, surface, contentId, title, console,
    userId, startedAt, confidence }

play.session.progress
  { sessionId, state: playing|paused|unknown, playedMs, observedAt }

play.session.ended
  { sessionId, endedAt, playedMs, reason: quit|expired|lost }
```

`surface` is an opaque label (`console-emulator`, `browser-emulator`) — it
identifies the *kind* of play surface for confidence and diagnostics, never the
vendor product behind it.

**`playedMs` is a cumulative high-water mark, never a delta.** This makes every
message idempotent and safe to replay, and a dropped message costs nothing
because the next one carries the truth (NFR-3). It is deliberately the same
settle contract `coinMeteredGate.js` already uses, so both surfaces agree.

`confidence` states the accuracy bound (NFR-2): exact for the in-process
producer, the poll interval for the inferred one.

`reason: lost` is distinct on purpose — "the session vanished and we do not know
why" is a different accounting fact from a clean end, and should be settled
conservatively and surfaced, not silently treated as a quit.

### 5.3 Time accounting

`playedMs` accumulates only across intervals observed in `playing`:

```
on each observation:
    if previous == playing and now == playing:
        playedMs += (now.observedAt - previous.observedAt)
    # paused, unknown, and any gap contribute nothing
```

This yields FR-4 for free: pauses, backgrounding, title-screen idling and the
gap across a relaunch all fall out of the definition rather than needing special
cases.

For RetroArch the play/paused discriminator is the CPU delta of 3.6: sustained
non-zero means emulating; zero with the process alive means paused or stuck.
`foregroundApp` gates it — the CPU test is only consulted while the emulator
package is foreground.

Session state is persisted on every progress tick so a backend restart resumes
from the last known `playedMs` rather than zero (NFR-4), following the
append-only ledger precedent in the economy design.

### 5.4 Inferred observation (console emulator surface)

`RetroArchPlayObservationSource` in `1_adapters/gaming/` implements
`IPlayObservationSource`. A scheduler drives it, active only while a session is plausible, at a fixed interval
(≈10s: comfortably inside a minutes-long budget, well below any rate concern).

Per tick:

1. Read `foregroundApp` over the kiosk REST API (primary; ADB-free, NFR-6).
2. If the emulator is foreground, sample the process CPU delta over ADB to
   classify `playing` vs `paused`.
3. If either probe fails, emit `state: unknown` — **accrue nothing, terminate
   nothing** (NFR-1).

Edge rules:

- **Start** — first tick observing `playing` after a launch request. The
  launch's known content/user/device supply the metadata; the *time* comes from
  the observation (FR-1).
- **Stop** — process gone, or foreground left the emulator and stayed away for
  a debounce window. (A brief flip must not end a session spuriously.)
- **Switch** — content identity changes ⇒ `ended` then `started` (FR-7).
  Content identity comes from the launch we issued, cross-checked against the
  per-session log file when available.

A launch that never reaches `playing` within a timeout resolves as a failed
launch, not a session — this is precisely the SELinux-core case from 3.10.

### 5.5 Self-reported observation (browser emulator surface)

The widget already knows its own lifecycle. It emits the same three events with
`surface: emulatorjs` and exact confidence, replacing local arithmetic.

Per the decision in 6.2, `coinMeteredGate.js` stops being the book of record and
becomes a display plus a local safety stop; the server settles the balance.

### 5.6 Overlay channel — and how it is scoped

The countdown film of 3.7: a transparent, full-screen page held in the kiosk's
web overlay, connected to the event bus, rendering whatever it is told. Because
the window is `NOT_FOCUSABLE` / `NOT_TOUCHABLE`, it satisfies NFR-5 by
construction — it cannot steal focus (so `pause_nonactive` never pauses the
game) and cannot swallow a button press.

**Scoping is the dangerous part, and it is a device capability, not a feature
flag.** The kiosk's overlay URL is *durable device state*: once set it renders
over everything that kiosk shows — the art screens, the media browser,
everything — not only over games. An overlay armed carelessly, or left armed
after a crash, becomes a permanent film on the family television.

Four rules contain that:

1. **Declared, never inferred.** A device gets a play overlay only if its entry
   in the hardware device configuration declares one, exactly as `video_call:
   true` declares a call target. No declaration ⇒ no overlay, with no code path
   that can create one. Today only the living-room screen would declare it.
2. **It exists only for the duration of a play session.** The overlay is *armed*
   when a session is confirmed started and *torn down* when it ends. It is not a
   permanent fixture that happens to be blank most of the time.

   This is a resource decision as much as a safety one. The overlay is a live
   WebView holding an open WebSocket and compositing over every frame the device
   draws. Left mounted, it costs memory, a socket and GPU work around the clock —
   on a screen that spends most of its life showing art and video, not games.
   Tearing it down returns all of that.

   Arming on *confirmed* play (rather than on launch) also means a launch that
   never produces a game never arms anything, and the overlay's appearance is
   itself evidence that the session is real. The cost is that the film appears up
   to one poll interval after play begins — immaterial, since the first warning
   is minutes away.
3. **Disarmed is the safe default, and is re-asserted.** On startup and on
   reconciliation, any device with no open play session has its overlay cleared.
   A backend that died mid-session must not leave a film behind — recovery
   actively removes it rather than assuming it is absent.
4. **Transparent when idle — as a safety net, not as the plan.** While armed and
   with nothing to say, the film renders nothing at all, so a failure of rules 2
   or 3 degrades to an invisible no-op rather than to something on screen. This
   is what keeps a bug from becoming a visible fault in the living room; it is
   not a licence to leave the overlay mounted.

**Surface-appropriate rendering.** The device overlay exists because the console
surface is a foreign app we cannot draw inside. The browser emulator has no such
problem — it draws its own countdown in its own React tree and must never arm a
device overlay. Overlay arming is therefore a function of *both* the surface kind
and the device declaration, and never of the play session alone.

Design constraints inherited from 3.7:

- Natural flow height, pinned to the display height. No `position:fixed`.
- Transparent page background; every pixel not drawn shows the game.
- Self-healing socket with backoff, because it is long-lived and unattended.
- If the socket goes stale the countdown must visibly degrade rather than keep
  ticking (5.10).

**Deploy hazard.** If the overlay page 404s after a release, the kiosk paints a
broken document over the television. The page must ship as a normal build
artifact, the arming component must verify the URL resolves before setting it,
and the URL must be set as part of the release rather than by hand.

A working prototype of the film and the standalone countdown is preserved under
`docs/_wip/prototypes/2026-09-11-arcade-overlay/`.

### 5.7 Expiry sequence

Driven by `EnforcePlayBudget` from purchased-time-minus-`playedMs`:

1. Escalating warnings on the film, plus spoken warnings, with enough lead time
   to save (FR-10) — a hard requirement, not a courtesy, because of 3.4.
2. At zero: a terminal banner, a spoken notice, then terminate the emulator and
   bring the kiosk to the foreground.
3. Emit `ended` with `reason: expired`; the economy settles.

Termination is a SIGKILL with no savestate (3.4). Battery-backed saves are
bounded to ~10s by `autosave_interval`; savestate progress is lost. **The
warning is the mitigation, and that must be stated to parents rather than
discovered by a child.**

### 5.8 Placement

| Artifact | Location |
|---|---|
| `PlaySession` entity — identity, state machine, played-time accumulation | `2_domains/gaming/entities/PlaySession.mjs` |
| `PlayState` value object — `playing` / `paused` / `unknown` | `2_domains/gaming/value-objects/PlayState.mjs` |
| `ObservationConfidence` value object — exact vs bounded-by-interval | `2_domains/gaming/value-objects/ObservationConfidence.mjs` |
| `PlaySessionStarted` / `PlaySessionEnded` domain events (past tense) | `2_domains/gaming/events/` |
| `IPlayObservationSource` — "what is this device playing right now?" | `3_applications/gaming/ports/IPlayObservationSource.mjs` |
| `IPlaySessionRepository` — persistence | `3_applications/gaming/ports/IPlaySessionRepository.mjs` |
| `IPlaySessionAnnouncer` — bus publication | `3_applications/gaming/ports/IPlaySessionAnnouncer.mjs` |
| `RecordPlayObservation` — the convergence use case | `3_applications/gaming/usecases/RecordPlayObservation.mjs` |
| `EnforcePlayBudget` — warnings and expiry | `3_applications/gaming/usecases/EnforcePlayBudget.mjs` |
| `PlaySessionTracker` — the polling scheduler | `3_applications/gaming/runtime/PlaySessionTracker.mjs` |
| **`RetroArchPlayObservationSource`** — vendor name allowed here only | `1_adapters/gaming/RetroArchPlayObservationSource.mjs` |
| **`RetroArchSessionLogReader`** — reconciliation from device logs (5.10) | `1_adapters/gaming/RetroArchSessionLogReader.mjs` |
| Session reads + browser-emulator push ingress | `4_api/v1/routers/gaming.mjs` |
| The overlay film, shipped as a build artifact | `frontend/public/` |

The adapter composes existing infrastructure rather than reimplementing it: the
kiosk REST client and the ADB adapter already live in `1_adapters/devices/`, and
wiring happens in `5_composition` — the only sanctioned cross-layer zone.

Existing pieces to reuse rather than reinvent: the device-state/liveness
precedent (5.2), the kiosk REST client, the launch-intent service, and the
economy's append-only ledger.

### 5.9 Failure modes

| Condition | Behaviour |
|---|---|
| Kiosk REST unreachable | Drop to rung 2 (ADB); if that also fails, `unknown` — no accrual, no termination, alarm raised, reconcile on recovery (5.10) |
| ADB unavailable | Foreground-only at reduced confidence; CPU-based play/pause detection is lost, so treat foreground as playing and flag the session |
| Observer stops publishing | Watchdog alarm; session marked stale rather than silently left open |
| Blindness persists past threshold | No new launches granted; parent notified; running game is **not** killed |
| Backend restarts mid-session | Resume from persisted `playedMs` |
| Game killed by the OS | `ended` with `reason: lost`; settle conservatively |
| Overlay page fails to load | Session and accounting unaffected; warnings degrade to speech; alert |
| Backend died with an overlay armed | Startup reconciliation clears the overlay on any device with no open session |
| Launch never reaches `playing` | Failed launch; no session; no charge |

### 5.10 Resilience and recovery

**`unknown` is a degraded state with an escalation path, never a resting state.**
Not accruing while blind (6.1) is only safe if blindness is rare, short,
*detected*, and *reconciled*. A system that quietly stops seeing a running game —
while the child keeps playing — is the failure this section exists to prevent.

**Detecting blindness.** Silence must never look like health:

- The observer runs under a watchdog. Missing N consecutive poll intervals, or
  publishing no progress within a deadline, raises an alarm rather than simply
  producing nothing.
- Consumers track the age of the last progress message. A session with no
  progress for more than a few intervals is *stale*, and is treated as a fault,
  not as a quiet session.
- No session may sit open indefinitely on no data.

**Degrading through channels.** A single failed probe must not collapse straight
to `unknown`. The observer walks a ladder, and the event records which rung
produced it:

| Rung | Source | Confidence |
|---|---|---|
| 1 | Kiosk REST `foregroundApp` + process CPU delta | normal |
| 2 | ADB alone (`pidof`, CPU, focused window) | reduced — kiosk REST down |
| 3 | RetroArch session log file (exact start from filename, content identity from the body) | coarse — start and identity only, never an end |
| 4 | nothing | `unknown` |

**A restart is not an ending.** Startup settles what a stopped process left
open, but staleness decides the outcome, not the restart itself: a session whose
last observation is recent is RESUMED with its accumulated `playedMs` intact,
because a process that came back in thirty seconds while a child was still
playing should not orphan that session. Only a session older than the tolerance
is closed as `lost` — we cannot honestly claim to know what happened in the gap.

**Reconciling the blind window — what the device can and cannot tell us.**
RetroArch writes one timestamped log file per session, and an earlier draft of
this document claimed its mtime marks where the session ended. **That was wrong,
and measurement disproved it.** Across all 425 session logs on the device:

| Write span (start → last write) | Share |
|---|---|
| under 10s | 36.5% |
| 10–60s | 22.1% |
| 1–5 min | 14.6% |
| 5–30 min | 19.8% |
| over 30 min | 7.1% |

Median 28 seconds; **59% of sessions stop writing within a minute of starting**,
and file size barely varies with duration (median ~7.8 KB whether the session ran
two minutes or two hours). Logging is dominated by startup, and steady play
produces writes only sporadically. A session that ran ten minutes can easily show
a three-second write span — verified directly against sessions run by hand while
watching the clock.

So mtime is a **lower bound on activity, not an ending**, and reconstructing when
play stopped from it would under-report most sessions badly.

What the log IS good for, and it is worth more than the mtime idea was:

- **An exact session start**, encoded in the filename.
- **Which game was loaded.** The log records the core and the save-file
  redirection, naming the content. This is the identity the missing command
  interface would have provided (3.2), and it is the difference between "a game
  ran" and "Super Bomberman ran" — so reconciliation can confirm or correct
  attribution even when the launch intent has expired or been superseded.

**Therefore blind-window time is settled conservatively, not reconstructed.**
When observation returns, the system can say with confidence that a session
existed, when it began, and what was played — and cannot honestly say when it
ended. Unseen time is not credited by guesswork; it is recorded as a gap and
surfaced for review. A candidate heartbeat worth investigating is the SRAM
autosave (`autosave_interval = 10`), whose file mtime should advance every ten
seconds during play — but only for titles with battery saves, so it can never be
the general answer.

**Closing the abuse hole without terminating blind.** Going blind must not
become a way to play forever. Since we will not terminate on `unknown`
(6.1, NFR-1), the escalation is human: if blindness persists past a threshold
*and* purchased time would have run out, the system stops granting new launches
and notifies a parent, rather than silently either killing the game or handing
out unlimited play.

**Self-healing connections.** Everything long-lived reconnects on its own: the
observer rebuilds its probes (ADB auto-reconnect already exists in the adapter),
the overlay's socket retries with backoff, and bus subscribers re-subscribe and
take a snapshot replay on reconnect — the behaviour the device-state liveness
service already provides.

**Honest UI under staleness.** If the overlay's socket goes stale, the countdown
must visibly degrade rather than keep ticking. A frozen clock that still looks
authoritative is worse than one that plainly shows it has lost contact, because
it tells a child they have time they may not have.

### 5.10a Log vocabulary

Every transition emits one structured event. Names are stable and dotted so a
whole session, or a whole device, can be pulled out of the log store without
knowing which component wrote which line. Every event carries `sessionId` and
`deviceId` where it has them.

| Event | Level | Meaning |
|---|---|---|
| `play.session.started` | info | A confirmed PLAYING observation opened a billable session |
| `play.session.ended` | info | Session closed; carries `reason`, final `playedMs`, `switched` |
| `play.session.resumed` | info | A restart found a fresh session and continued it |
| `play.session.lost` | warn | A session could not be honestly resumed and was settled |
| `play.session.gap_truncated` | warn | The observer went quiet; unbillable remainder recorded |
| `play.session.announce_failed` | warn | A broadcast was lost; the session was not |
| `play.intent.expired` | debug | Attribution stopped; observation continued |
| `play.tracker.device_failed` | warn | One device's probe failed; others unaffected |
| `play.tracker.tick_failed` | error | The whole pass failed |
| `play.tracking.reconciled` | info | Startup settlement summary |

The warn-level events are the ones worth alerting on: each marks a place where
the meter knows it is less accurate than it would like to be. Silence on those
is the healthy state, which is what makes them useful as an alarm rather than as
noise.

### 5.11 Testing

- Unit: played-time accumulation across pause/resume/gap/switch sequences;
  idempotence under duplicated and out-of-order progress messages; restart
  resume.
- Adapter: observer edge detection against recorded probe sequences, including
  the foregrounded-but-zero-CPU case from 3.6, which must **not** open a session.
- Live: a scripted session on the Shield asserting the event sequence, the
  played-time figure against wall-clock with pauses, and that expiry returns the
  screen to the kiosk.

Per repository test discipline: a probe that cannot establish its precondition
fails; it does not skip.

## 6. Decisions taken

- **6.1 — Unknown never accrues and never terminates — but is never accepted.**
  "I could not tell" is neither "playing" nor "stopped", so while blind the
  system bills nothing and kills nothing. That is safe only alongside 5.10:
  blindness must be detected, escalated through fallback channels, reconciled
  from on-device evidence afterwards, and alerted on. Tolerating a blind spot is
  not the same as resting in one.
- **6.2 — Metering authority moves server-side for both surfaces.** RetroArch
  has no client to host a gate, and two authorities will drift. The client gate
  becomes display plus local safety.
- **6.3 — Every session says how precisely it was measured.** Plainly: because
  RetroArch is watched from outside on a timer, we only ever learn that a game
  started or stopped *at the next check*. With checks every 10 seconds, a start
  or stop can be off by up to 10 seconds. That margin travels with the data as a
  `confidence` field instead of being quietly ignored, so anything reading the
  number knows how much to trust it. Against minutes of purchased time the error
  is immaterial; what matters is that it is written down rather than implied.
- **6.4 — No RetroArch fork in this iteration.** A fork with `HAVE_COMMAND`
  would restore in-engine messaging, save-state and graceful close in one move,
  and is the only route to a graceful save. It is deferred because the kiosk
  overlay already satisfies the notification requirement and a fork is a
  permanent maintenance burden. Revisit if losing unsaved progress proves
  unacceptable in practice.

## 7. Decisions on identity, budget and surfacing

### 7.1 Attribution and authorization

**Shared or group play is attributed to an admin**, who has unlimited time. A
family movie-night equivalent — several kids on the couch, a parent present — is
authorized by the parent and burns no child's budget. That removes the need to
identify who is holding the controller: either one child owns the session, or an
adult does.

**Identity is confirmed through the existing biometric gate.** The household
already has a working fingerprint identification path (`requestUnlock` →
`{ matched, userId }`) used by the fitness rig. Gaming reuses that ceremony
rather than inventing a second notion of "prove who you are".

**The consequence that shapes the design: authorization is separated from play
in both space and time.** The only fingerprint reader in the house is on the
garage rig. Until a reader exists by the living-room screen, the real flow is:

1. A child asks to play in the living room.
2. The garage screen is woken and turned up.
3. They walk to the garage, scan, and authorize the specific thing they want.
4. They walk back and play.

So this is an **authorize-here, redeem-there** problem, not a login. That is the
same shape as the economy's pending-intent/hold pattern: a grant is created
against a user on one device, held, and redeemed by a session opening on a
different device. It follows that:

- A grant must name **what** it authorizes (this content, or this device for this
  long), not merely who requested it — a walk to the garage must not become a
  blank cheque.
- A grant must **expire** if unredeemed, or the walk becomes a way to bank
  authorizations.
- The play session records **which grant** it was opened against, so the audit
  trail survives the physical separation.
- Nothing about this changes when a reader appears in the living room; only the
  walk disappears.

**Layering note:** the existing gateway is a fitness-namespaced adapter with
`fitness.*` bus topics. Gaming must not import a peer adapter, so identity is
consumed through an application-owned port and wired in composition. The topic
names describe the hardware's location, not its purpose, and are best left
alone — renaming them means touching the garage rig for no behavioural gain.

### 7.2 Budget: the gaming domain never sees currency

Play time is earned over time — schoolwork, finishing a school day, reading,
piano — and spent on play. **The earning side is deliberately black-boxed here**
and belongs to the economy.

The household model is expected to be two-tier: universal coins are earned, and
must be **exchanged for game tokens** to be spent on play. Tokens are
**same-day** — unspent tokens convert back — and the exchange rate is
**time-varying**, so play costs more on a school night and less inside a cheap
window at the weekend. That shapes behaviour through price rather than
prohibition: a child may always choose to play, but on a Tuesday it costs them.

Caps on consumption (a daily ceiling) sit alongside that.

**None of which the gaming side knows about.** The boundary is a *grant*: the
economy answers "this session may play for N seconds, on behalf of user U,
against grant G", and gaming burns it and reports back what was actually played.
Coins, tokens, exchange rates, expiry and weekday pricing all stay on the
economy's side of that line. This keeps a pricing experiment from ever becoming a
change to the meter.

Admin-attributed sessions carry an unlimited grant, which is simply a grant with
no ceiling — not a bypass of the mechanism.

### 7.3 Surfacing: reuse the device view

Play sessions surface through the **existing Media device/fleet view**. A device
playing a game and a device playing a video are the same concept — a device, and
what is on it — and the abstractions should be shared rather than duplicated.

Concretely, the rich domain events stay on `play-session:<deviceId>` for the
economy and the overlay, and a **bridge projects them into the session-snapshot
shape already published on `device-state:<deviceId>`**, exactly as the playback
hub's fleet bridge does for speaker lanes. The fleet view needs no special case;
it renders a play session the same way it renders anything else on a device.

## 8. Build plan

Ordered so that **observation ships and proves itself before anything enforces**.
Nothing kills a game until we have watched the meter agree with reality for a
while. `[x]` is built and tested; `[ ]` is not started.

### M0 — Vendor-neutral core (done)

| | Task | Where |
|---|---|---|
| `[x]` | `PlayState` value object — playing / paused / unknown | `2_domains/gaming/value-objects/` |
| `[x]` | `PlaySession` entity — state machine, played-time accumulation, trusted-gap cap, reconcile, end reasons | `2_domains/gaming/entities/` |
| `[x]` | `IPlayObservationSource`, `IPlaySessionRepository`, `IPlaySessionAnnouncer` | `3_applications/gaming/ports/` |
| `[x]` | `RecordPlayObservation` — the single convergence use case | `3_applications/gaming/usecases/` |
| `[x]` | `EventBusPlaySessionAnnouncer` — `play-session:<deviceId>` | `1_adapters/eventbus/` |
| `[x]` | `YamlPlaySessionDatastore` — current + append-only history, no deletes | `1_adapters/persistence/yaml/` |
| `[x]` | `RetroArchPlayObservationSource` — foreground + CPU delta, debounce, degraded mode | `1_adapters/gaming/` |
| `[x]` | `PlayIntent` value object — scoped, expiring launch attribution | `2_domains/gaming/value-objects/` |
| `[x]` | `IPlayIntentRepository` + `YamlPlayIntentDatastore` | ports / `1_adapters/persistence/yaml/` |
| `[x]` | `PlaySessionTracker` — chained ticks, per-device isolation, health for the watchdog | `3_applications/gaming/runtime/` |

### M1 — Observation runs (read-only; no enforcement, no overlay)

| | Task | Notes |
|---|---|---|
| `[x]` | **T1 Launch attribution record** — persist "content X launched for user Y on device Z, against grant G" so the observer can echo identity | The source can confirm *a* game runs, never *which* (3.2). Carries the grant reference from 7.1 |
| `[x]` | **T2 `PlaySessionTracker`** — the scheduler: which devices, what interval, calls `RecordPlayObservation`, self-watchdog | `3_applications/gaming/runtime/` |
| `[x]` | **T3 Device declaration** — `play_observation` / `play_overlay` blocks in the hardware device config, plus contract/schema | Declared, never inferred (FR-12) |
| `[ ]` | **T4 Composition wiring** — kiosk client + ADB adapter + source + datastore + announcer + use case + tracker; start on boot | `5_composition/` only |
| `[x]` | **T5 Startup reconciliation** — close stale open sessions as `lost`, clear any armed overlay | Crash recovery (5.10) |
| `[x]` | **T6 Structured logging vocabulary** — one event per transition, queryable by device and session | NFR-7 |
| `[ ]` | **T7 Live verification on the console device** — scripted session asserting event sequence and `playedMs` against wall clock *with pauses* | The number must disagree with wall clock, correctly |

**M1 exit:** we can answer "what is playing, for whom, on which device, and for how long" in real time, and nothing has been shut off.

### M2 — Resilience and recovery

| | Task | Notes |
|---|---|---|
| `[x]` | **T8 Measure log write cadence during steady play** | MEASURED over 425 sessions: median 28s write-span, 59% stop writing within a minute. Logs are NOT a liveness or end signal — they give an exact start and content identity |
| `[ ]` | **T9 `RetroArchSessionLogReader`** — exact start from filename, content identity from the body | `1_adapters/gaming/` |
| `[x]` | **T10 `ReconcilePlaySessions`** — confirm a session existed and what was played; settle unseen time conservatively, never by guesswork | Ends cannot be reconstructed (5.10) |
| `[x]` | **T11 Staleness alarm** — no progress for N intervals is a fault, not silence | NFR-8 |
| `[x]` | **T12 Degraded-mode alerting** — ADB lost ⇒ reduced confidence surfaced, not swallowed | |
| `[ ]` | **T13 Prolonged-blindness policy** — stop granting launches, notify a parent; never kill blind | Closes the abuse hole (6.1) |

### M3 — Overlay (display only; still no enforcement)

| | Task | Notes |
|---|---|---|
| `[ ]` | **T14 Ship the film as a build artifact** | Prototype exists under `docs/_wip/prototypes/`; a 404 paints the TV (5.6) |
| `[ ]` | **T15 Overlay driver** — arm on confirmed start, tear down on end, verify URL first, re-assert disarmed at boot | Device-declared only |
| `[ ]` | **T16 Film runtime** — subscribe to `play-session:<deviceId>`, render remaining time, urgency states, visible degradation when the socket goes stale | |
| `[ ]` | **T17 Spoken warnings** — kiosk text-to-speech alongside the visual | A child absorbed in a game hears sooner than reads |
| `[ ]` | **T18 Verify no gameplay impact** — focus and input unaffected, emulation CPU unchanged | NFR-5 |

### M4 — Budget and enforcement

| | Task | Notes |
|---|---|---|
| `[ ]` | **T19 `EnforcePlayBudget`** — remaining time, warning thresholds, expiry decision | `3_applications/gaming/usecases/` |
| `[ ]` | **T20 Termination adapter** — stop the emulator, return the device to its kiosk | Only ever called by expiry |
| `[ ]` | **T21 Warning ladder** — lead time sufficient to save, because termination destroys unsaved progress (3.4) | FR-10; hard requirement |
| `[ ]` | **T22 Economy integration** — purchase time with coins, burn against `playedMs`, settle on end | Ledger is the book of record |
| `[ ]` | **T23 Parent controls** — grant, extend, override | |

### M5 — Second surface and parity

| | Task | Notes |
|---|---|---|
| `[ ]` | **T24 Browser-emulator reporting** — emit the same three events with exact confidence | |
| `[ ]` | **T25 Move metering authority server-side** — the in-app gate becomes display plus local safety | Decision 6.2 |
| `[ ]` | **T26 API router** — push ingress for the browser surface, session reads | `4_api/v1/routers/gaming.mjs` |
| `[ ]` | **T27 In-app countdown** — the browser surface draws its own; it must never arm a device overlay | 5.6 |

### M6 — Operations

| | Task | Notes |
|---|---|---|
| `[ ]` | **T28 Fleet visibility** — verify play sessions render correctly in the existing device view | Via T37; no new view (7.3) |
| `[ ]` | **T29 Session history / audit view** — because played time became money | |
| `[ ]` | **T30 Reference documentation** — endstate, present tense, under `docs/reference/`, plus the navigation table | |
| `[ ]` | **T31 Retire the stale launcher config twin** — `gaming/retroarch/config.yml` reads as live and is not (3.10) | Independent of this feature; found en route |

### Tasks added by Section 9

| | Task | Milestone | Notes |
|---|---|---|---|
| `[ ]` | **T38 Express play eligibility as a state-gate** — gate + entitlement definitions for "may play", with economy as one claim | M4 | Replaces a bespoke wallet check (9.2) |
| `[ ]` | **T39 Per-title play policy** — single-player versus group, attribution and cost rules per game | M4 | Pokemon and Mario Kart are not the same product (9.3) |
| `[ ]` | **T40 Payer + roster on `PlaySession`** — group play without splitting, roster recorded for later | M4 | Domain change; decide before group pricing (9.3) |
| `[ ]` | **T41 Controller census in the observation** — count connected gamepads from the input device list | M2 | Feasible over the existing channel (9.4) |
| `[ ]` | **T42 Controller ACTIVITY sampling** — bounded-window event sampling, so idle pads are not counted as players | M2 | Connected is not playing (9.4) |
| `[ ]` | **T43 Schedule and prerequisite gates** — approved play windows, "schoolwork done" style conditions | M4 | Time-bound gates already exist to build on |

### Tasks added by the Section 7 decisions

| | Task | Milestone | Notes |
|---|---|---|---|
| `[ ]` | **T32 `IPlayAuthorizationGateway`** — application-owned identity port; existing biometric gateway wired in composition | M4 | Gaming must not import a peer adapter (7.1) |
| `[ ]` | **T33 Authorize-here, redeem-there grants** — scoped to content or device, expiring if unredeemed, recorded on the session | M4 | The walk to the garage must not be a blank cheque |
| `[ ]` | **T34 Remote authorization ceremony** — wake and raise the garage screen, run the scan, return the result | M4 | Disappears if a reader ever sits by the living-room screen |
| `[ ]` | **T35 Admin-attributed sessions** — unlimited grant for shared/family play | M4 | A grant with no ceiling, not a bypass |
| `[ ]` | **T36 `IPlayTimeGrant` boundary** — economy answers "N seconds for user U against grant G"; gaming burns and reports | M4 | Keeps coins, tokens, rates and expiry out of the meter (7.2) |
| `[ ]` | **T37 Fleet bridge** — project play sessions into the `device-state:<deviceId>` snapshot shape | M6 | Replaces a bespoke arcade view (7.3) |

All three previously open questions are now decided; none block M1 or M2.

---

## 9. Eligibility is a policy decision, not a wallet check

The economy is **one input among several**, and treating "do they have coins?" as
the question would bake in a model that is already too narrow.

### 9.1 The dimensions

| Dimension | Example |
|---|---|
| **Time** | An approved schedule for when games may be played at all |
| **Prerequisites** | Schoolwork finished, the school day completed, a chore done — any external condition |
| **Game** | A single-player title attributes to one child; a four-player title does not |
| **User** | Per-child caps, overrides and earned autonomy |
| **Economy** | Coins, game tokens, weekday-versus-weekend exchange rates |
| **Live inputs** | How many controllers are connected — and how many are actually being used |

These combine. "Two children may play a co-op title together on a Saturday
afternoon, once both have finished school, sharing the cost" is a single
decision drawing on five of those six.

### 9.2 Where the decision belongs

**State-gates already is this machine.** It has gate definitions,
entitlement definitions, assertions, a policy graph, and subject and period
references — a vocabulary for "may this subject do this thing in this period,
given what is asserted about them". Eligibility to play is that question, and it
should be expressed as a gate evaluation rather than as bespoke `if` statements
inside the gaming slice.

That reframes the economy from gatekeeper to **one claim among others**. A
wallet or token balance becomes an input to a gate decision, exactly like "school
day complete" or "inside the approved window". The benefit is that a new
condition — a new chore, a new schedule, a seasonal rule — is a policy change
rather than a code change.

It also keeps the separation this whole document rests on:

> **The meter measures. The policy decides.**

`PlaySession` answers "how much was actually played" and nothing else. Whether
play may begin, what it costs, and who pays are decided elsewhere and handed to
the session as a grant (7.2). Keeping that line sharp is what lets pricing and
policy churn without ever touching the arithmetic that bills a child.

### 9.3 Group play breaks the single-user assumption

A co-op title played by three children is not one child's session. Today
`PlaySession` carries a single `userId`, which is sufficient for a solo title and
for an admin-attributed family session, and **insufficient for shared play that
should draw on more than one balance**.

The options, which need deciding before group pricing is built:

- A session has a **payer** and a **roster**: one child (or a parent) is charged,
  the others are recorded as present.
- A session **splits cost across a roster**, requiring each participant to have
  authorised and to have balance.

The first is simpler and probably right to start with — "one can spend on behalf
of the others" — with the roster recorded so the second remains possible without
rewriting history.

### 9.4 Controllers are an observability input

How many controllers are connected, and how many are *being used*, is evidence
about who is playing. It bears on attribution, on whether a title is being played
as a group, and potentially on price.

Both are obtainable from the device:

- **Connected** — the input device list enumerates every attached device with a
  source bitmask, so gamepads and joysticks can be counted and identified.
- **Active** — raw input events can be streamed from the device nodes and sampled
  over a bounded window, giving per-controller activity rather than mere presence.

**Connected is not playing**, and this is the same trap as the foreground signal
at a different level: a controller left on the couch is exactly as misleading as
an emulator foregrounded with no game loaded. A pad that is paired but idle must
not be counted as a player. The lesson generalises — **presence is never activity**
— and every signal added to this system should be read against it.

Controller counts belong in the observation payload, so they travel on the bus
and land in the session record alongside everything else that was true at the
time.

### 9.5 Consequence for the configuration model

Policy is therefore **multidimensional and data-driven**: a decision over time ×
game × user × external gates × live inputs. It must not be expressed as nested
conditionals in the gaming slice. The gaming side asks one question — "may this
subject play this title on this device now, and on what terms?" — and receives a
grant or a refusal with a reason.
