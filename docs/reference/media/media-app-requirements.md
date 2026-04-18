# Media App — Functional Requirements

## Purpose

The Media App is the household's **universal content front door**. It is the single
surface where a user discovers any content the system knows about and dispatches it
to any playback surface — including the user's own browser.

Anything resolvable through `GET /api/v1/play/:source/*` is in scope. The app is a
thin dispatcher over the content paradigm (`docs/reference/content/`); it adds no
content-type-specific logic. When a new content format lands in the Play API, this
app plays or dispatches it automatically.

## Scope

The app unifies five concurrent, non-mutually-exclusive capabilities on one surface:

1. **Discover** — search, browse, and navigate the full content catalog.
2. **Play locally** — play content in the user's current browser.
3. **Dispatch remotely** — send content to one or more configured playback devices.
4. **Observe remotes** — see what every configured device is currently doing.
5. **Control remotes** — drive the transport and queue of any remote session
   without necessarily playing anything locally.

## Out of Scope

- **Playback on configured devices.** Kiosks, TVs, and other configured playback
  surfaces run a separate screen-framework-based app. This app only dispatches to
  and observes them; it is never installed on them.
- **Peer-browser coordination.** Other browsers running this app are invisible to
  each other. Only configured devices (registered in `devices.yml`) appear as
  remote targets.
- **User accounts and auth.** The app is single-user per browser, no login.
- **Personalization.** No watchlists, no recommendations, no history-based ranking.
- **Content authoring or catalog management.** Read-only against the Play/Queue/
  Display APIs.
- **LiveStream channel administration.** Creating, configuring, or programming
  livestream channels (the DJBoard / per-channel queue and transport admin at
  `/media/channels/*`) is a separate surface. The Media App consumes channels
  as content sources but MUST NOT expose channel CRUD or DJ-side controls.
- **Camera / surveillance UI.** Pan/zoom, detection overlays, PTZ controls, and
  other camera-specific affordances belong to the CameraFeed module. The Media
  App may *tune in* to a camera feed as content but MUST NOT reimplement
  surveillance-oriented controls.

---

## Core Concepts

This section defines terms used throughout the rest of the document. Each concept
is functional, not UX-bound.

### Content Item
Any object resolvable to a playable by the Play API — identified by a content ID
(e.g., `plex-main:12345`, `hymn-library:198`, `app:webcam`,
`composite:app:screensaver,plex-main:99`). Items have a `format` that determines
how they render, but the Media App is format-agnostic.

### Live vs. On-Demand Content
Most content is **on-demand** — finite duration, seekable, resumable. Some
content is **live** — livestream audio channels, camera feeds, and similar
always-on sources. Live content is a first-class content source (discoverable,
queueable, castable, peekable), but session semantics degrade:

- No duration; progress/position indicators MUST render as "live" (or hide).
- No seek, no scrub, no skip-within-item; transport collapses to play/pause/stop.
- No resume-on-reload position restore; reloading a live item means re-joining
  the stream at "now."
- Position-tolerance requirements (e.g., C7.3 hand-off within 2s) do not apply.
- Stall detection (C9.3) uses a live-content-specific threshold or is suppressed
  in favor of the renderer's own reconnection behavior.

The app detects live content via a `PlayableItem.isLive` flag (or equivalent
format metadata — contract in the technical doc) and adapts affordances
accordingly. Format-specific rendering remains the responsibility of the
Playable Format Registry.

### Playback Surface
A physical place where content can render. Two kinds:

- **Local surface** — the user's current browser.
- **Remote surface** — a configured device in `devices.yml`. Always runs a separate
  screen-framework player app; never this app.

### Session
The authoritative playback state of a single surface: current item, playback
position, queue (past + upcoming), playback state (playing / paused / buffering /
stalled / idle), and configuration (shader, volume, shuffle mode, repeat mode).

Every surface has at most one active session. Sessions are independent across
surfaces. The app owns the local session; remote sessions are owned by their
respective devices and observed/controlled by the app.

### Target
The surface a user action is aimed at. An action always specifies a target:
local, one remote device, or multiple remote devices (ad-hoc multi-select).

### Dispatch Modes
When sending content *from* the app, two modes:

- **Cast (transfer)** — local session stops; target surface takes over the content.
- **Cast (fork)** — local keeps playing its own session; target surface also plays
  the dispatched content. Independent sessions run in parallel.

### Adoption Modes
When relating the local surface to an existing remote session:

- **Take over** — transfer: remote stops, local adopts the remote's session state
  (item, position, queue, config) and plays it.
- **Peek (spy mode)** — observe a remote session and drive its transport/queue
  without affecting the local session. Local queue and current item are preserved.

---

## Primary User Journeys

Each journey describes what a user can accomplish. All journeys are concurrent and
non-exclusive — the app never forces a mode switch.

### J1. Discover and play locally
A user searches or browses the catalog, selects a content item, and plays it in
the current browser. Queue interactions (J2) are available before, during, and
after playback; the user can keep browsing, adding, and reorganizing while
content plays.

### J2. Build and manage the queue (Plex MP model)
Against any content item, the user can:

- **Play Now** — replace the current item immediately; queue is preserved or
  cleared per user choice.
- **Play Next** — insert after the current item (interrupts the existing
  "up next" ordering).
- **Add to Up Next** — append to a priority sub-queue that plays before the
  rest of the queue.
- **Add to Queue** — append to the end of the queue.

At any time, against the queue itself, the user can: remove an item, reorder
items, jump to a specific item, clear the queue, toggle shuffle, toggle repeat
(off / one / all). All queue operations are available whether or not something
is currently playing, and apply equally to local sessions and to remote sessions
in peek mode (J5).

### J3. Dispatch to a remote device
A user finds content, selects one or more configured devices as the target, and
dispatches the content. The target device wakes if needed, then begins playing.
The local session is unaffected (fork) or stopped (transfer) based on the user's
explicit choice.

### J4. Observe the fleet
A user views the current state of every configured device: online/offline, idle
or playing, current item, progress, playback state, queue, and recent history.
Updates are live.

### J5. Peek and control a remote session
A user inspects a playing remote session and drives its transport (play, pause,
seek, skip, stop) and queue (add, remove, reorder, jump, clear, shuffle, repeat)
from the app — without altering the local session.

### J6. Take over a remote session
A user pulls a remote session to the local surface. The remote stops; the local
session adopts the remote's full state (current item, position, queue, config) and
resumes playback seamlessly.

### J7. Hand off local to a remote
A user pushes the local session to a remote device. The target adopts the local
session's state; local either stops (transfer) or keeps playing (fork), per the
user's choice.

### J8. Resume after disruption
After a browser refresh, tab close-and-reopen, crash, or network interruption,
the local session resumes from the last known state with minimal user action.
The user can also explicitly reset the session to a clean slate.

### J9. External trigger
An external system opens the app with a content ID in the URL. The app
autoplays that content in the current browser. (Remote dispatch from external
systems happens via API, not via this app's URL.)

---

## Capabilities

Requirements use RFC 2119 keywords (MUST, SHOULD, MAY). Each requirement is
numbered so plans and tests can reference it.

### C1. Content discovery

- **C1.1** The app MUST support **live/incremental search** across the full catalog.
  Results MUST surface inline as the user types (combobox/dropdown pattern), not
  via navigation to a dedicated results page. Search is always available without
  leaving the current context (browsing, detail view, or during playback).
- **C1.1a** Search results MUST be directly actionable from the inline result
  list — the user can Play Now, Play Next, Add to Up Next, Add to Queue, or
  Cast to a target without first navigating into a detail view.
- **C1.1b** Search scope selection (catalog-wide vs. within a specific source or
  collection) MUST be available from the search affordance itself. Scopes are
  defined by `docs/reference/media/search-scopes.md`.
- **C1.2** The app MUST support hierarchical browse navigation through any
  source/collection exposed by the List API (`/api/v1/list/*`), honoring list
  modifiers (`/playable`, `/shuffle`, `/recent_on_top`, `take`, `skip`).
- **C1.3** The app MUST provide a home/landing surface that exposes curated
  entry points (recently played, continue-where-you-left-off, quick-access
  categories). Content of the home surface is config-driven, not hard-coded.
- **C1.4** The app MUST provide a detail view for any content item resolvable
  via `GET /api/v1/info/:source/*`, showing metadata, thumbnail, and available
  actions (play now, play next, add to up next, add to queue, cast to target).

### C2. Local session

- **C2.1** The app MUST maintain at most one active local session per browser.
- **C2.2** Local session state (current item, position, queue, shader, volume,
  shuffle, repeat) MUST persist in `localStorage` and MUST resume on page reload.
- **C2.3** The app MUST expose an explicit "reset session" action that clears
  all persisted local state.
- **C2.4** The app MUST render any item whose `format` is supported by the
  Playable Format Registry (`frontend/src/modules/Player/lib/registry.js`). The
  app itself MUST NOT branch on format; all format-specific rendering is
  delegated to registered renderers.

### C3. Queue management

- **C3.1** The app MUST support the Plex MP queue-action model: Play Now,
  Play Next, Add to Up Next, Add to Queue.
- **C3.2** The app MUST support queue operations: remove item, reorder items,
  jump to item, clear queue.
- **C3.3** The app MUST support shuffle toggle and repeat modes (off, one, all).
- **C3.4** All queue operations MUST be available whether or not playback is
  active, and MUST take effect without interrupting playback unless the user's
  action implies it (e.g., Play Now).
- **C3.5** Queue operations MUST apply identically to the local session and to
  any remote session under peek control (C5).

### C4. Remote fleet observation

- **C4.1** The app MUST enumerate all remote surfaces registered in
  `devices.yml` (via `GET /api/v1/device/config`) and present a live view of
  each one's state.
- **C4.2** For each remote surface, the app MUST display: name, online/offline,
  idle/busy, current item (title + thumbnail + format), live progress
  (position + duration), playback state (playing/paused/buffering/stalled),
  the full queue, active shader, volume, shuffle, repeat.
- **C4.3** The app MUST show a lightweight play history per remote surface
  (recent items only; implementation MUST NOT bloat client memory —
  pagination or server-side retrieval expected).
- **C4.4** Remote state updates MUST arrive over a live channel (WebSocket).
  When the channel is disrupted, the app MUST display the last-known state
  with a clear "stale" indicator until the channel recovers.

### C5. Remote control (peek mode)

- **C5.1** The app MUST allow the user to enter peek mode on any remote
  surface without disturbing the local session.
- **C5.2** In peek mode, the app MUST support the full transport set:
  play, pause, seek (absolute + relative), skip next, skip previous, stop.
- **C5.3** In peek mode, the app MUST support the full queue-operation set
  defined in C3 (Plex MP actions, reorder, remove, jump, clear, shuffle,
  repeat), targeting the remote session.
- **C5.4** The app MUST support adjusting the remote surface's volume and
  shader independently of any local-session state.
- **C5.5** Multiple peek sessions MAY be active simultaneously across
  different remote surfaces.
- **C5.6** Peek mode MAY pause the local session to avoid audio collision
  (configurable or implicit), but MUST NEVER replace, clear, or reorder the
  local session's current item or queue. Exiting peek MUST leave the local
  session in the same content state it was in on entry (paused or playing is
  allowed to differ; content state is not).

### C6. Dispatch (cast from app to remote)

- **C6.1** The app MUST support dispatching a content ID (or a composed queue)
  to one or more remote surfaces in a single action. Target selection is
  ad-hoc multi-select; no persistent groups are required.
- **C6.2** Every dispatch action MUST require the user to pick between:
  **Cast Transfer** (local session stops after dispatch) and **Cast Fork**
  (local continues its own session independently).
- **C6.3** The app MUST surface live progress for a dispatch operation —
  including the wake/prepare/load steps emitted by the remote orchestration
  layer (topic `homeline:<deviceId>` with `wake-progress` events).
- **C6.4** On dispatch failure, the app MUST surface the failed step and
  error message, and MUST support user-initiated retry of the last dispatch
  to the same target(s) without re-entering parameters.
- **C6.5** Per-dispatch options MUST include shader, volume, shuffle, and any
  format-specific parameters exposed by the Play API.

### C7. Session portability

- **C7.1** The app MUST support **Take Over** on any remote surface with an
  active session: remote stops, local adopts the remote session's state
  (current item, position, queue, shader, volume, shuffle, repeat) and
  resumes playback from the captured position.
- **C7.2** The app MUST support **Hand Off** of the local session to one
  remote surface. Hand off MUST support both Transfer (local stops) and Fork
  (local continues) modes.
- **C7.3** Session portability actions MUST preserve playback position
  within a tolerance of 2 seconds across the transfer.
- **C7.4** If a portability action fails mid-flight (e.g., target unreachable
  during hand off), the originating session MUST remain intact and the user
  MUST be informed of the failure.

### C8. External integration

- **C8.1** The app MUST honor a URL deep-link protocol for autoplay on the
  local surface: `?play=<contentId>`, `?queue=<contentId>`, plus standard
  per-content options (shuffle, shader, volume).
- **C8.2** URL deep-links MUST target the local surface only. External
  systems that wish to dispatch to a remote surface MUST use the Device API
  (`/api/v1/device/:id/load`); this app MUST NOT encode remote dispatch in
  its own URL.
- **C8.3** The local session's live state MUST be emitted to a WebSocket
  topic (`playback_state` with `clientId`/`deviceId`/`displayName`
  identifiers) so that external observers (dashboards, home automation,
  analytics) can subscribe.
- **C8.4** The app MUST be controllable by external systems via a defined
  WebSocket command protocol — accepting transport and queue commands
  targeting its own local session.

### C9. Resilience

- **C9.1** The local session MUST survive a page reload. The app MUST restore
  current item, queue, position, shader, volume, shuffle, and repeat.
- **C9.2** The local session MUST survive a browser crash. After crash recovery,
  the app MUST offer (explicit or automatic, per config) to resume from the last
  persisted position.
- **C9.3** The app MUST detect local-playback stalls (no progress for a
  threshold duration while unpaused) and automatically advance to the next
  queue item. Stall events MUST be logged.
- **C9.4** The app MUST automatically reconnect a dropped live-state
  WebSocket. While disconnected, remote-surface state views MUST be marked
  stale; local playback MUST continue unaffected.
- **C9.5** If a content item fails to load or play (resolution error,
  network error, format error), the app MUST automatically advance to the
  next queue item and surface a recoverable error indicator. The user MUST
  be able to retry the failed item.
- **C9.6** If a remote surface goes offline mid-session, the app MUST keep
  the surface visible in the fleet view marked offline, preserve the last
  observed session snapshot, and resume live updates when the surface
  returns.
- **C9.7** The app SHOULD tolerate backend unavailability for already-cached
  local content: an in-progress local playback MUST continue playing as long
  as the media stream remains available, even if catalog/search APIs are
  unreachable.
- **C9.8** Dispatch operations MUST be idempotent-safe: repeating a dispatch
  with identical parameters MUST NOT produce duplicate queue entries or
  re-trigger wake sequences that are already in progress.

### C10. Observability

- **C10.1** The app MUST emit structured logs via the project's logging
  framework (`frontend/src/lib/logging/`) for: session lifecycle, queue
  mutations, dispatch attempts, remote-control actions, peek/takeover/hand-off
  transitions, portability failures, stall detection, error recovery, and
  URL-command processing.
- **C10.2** The app MUST NOT emit raw `console.log`/`console.debug` for
  diagnostic events. All diagnostic output MUST go through the logger.
- **C10.3** The app MUST emit a heartbeat `playback_state` message at a
  defined interval (≤ 5 seconds) while the local session is playing, and a
  single `stopped` message when the local session transitions to idle.
- **C10.4** All log and broadcast events MUST include the stable
  `clientId`/`deviceId`/`displayName` identifiers so that external consumers
  can correlate events across surfaces.
- **C10.5** High-frequency events (seek scrubbing, progress updates at
  sub-second granularity) MUST use sampled/rate-limited logging to avoid
  flooding the log stream.

---

## Session Model & Lifecycles

### Local session states

The local session occupies exactly one of these states at any moment:

| State       | Description |
|-------------|-------------|
| `idle`      | No current item, queue empty. |
| `ready`     | Queue has items; no current item selected (pre-start or cleared). |
| `loading`   | Current item selected; resolving, buffering, or waiting on renderer startup. |
| `playing`   | Actively rendering; progress advancing. |
| `paused`    | Position preserved; user- or system-initiated pause. |
| `buffering` | Transient stall — position not advancing, recovery expected. |
| `stalled`   | Persistent stall (exceeded C9.3 threshold); auto-advance imminent. |
| `ended`     | Current item finished; awaiting advancement. |
| `error`     | Current item failed to load/play; auto-advance imminent (C9.5). |

Permitted transitions follow natural media semantics (`idle → loading → playing →
paused → playing → ended → loading` …). Any state MAY transition to `idle` via
session reset (C2.3) or to `error` via unrecoverable failure.

### Session lifecycle

- **Creation** — a session is created the first time the user initiates playback
  in a fresh browser (no persisted state).
- **Persistence** — on every state transition and every ≥5s while playing, the
  full session state is written to `localStorage` (C2.2).
- **Resume (reload)** — on app load, if persisted state exists, the app MUST
  offer to resume from the persisted position (implicitly, per policy; or
  explicitly via prompt).
- **Recovery (crash)** — on detecting prior unclean shutdown, the app MUST
  restore persisted state (C9.2). Recovery MUST NOT start playback without
  user gesture where browser autoplay policies require one.
- **Reset** — the reset action (C2.3) clears persisted state and returns to
  `idle`. Reset MUST be explicit and confirmable.
- **Unload** — on page unload, the app MUST flush final state to `localStorage`
  and emit a `playback_state: stopped` broadcast (C8.3, C10.3).

### Dispatch operation lifecycle

Dispatch is a multi-step orchestration, observable via the
`homeline:<deviceId>` WebSocket topic. Steps:
`power → verify → volume → prepare → prewarm → load`.

- **On initiate** — app enters a `dispatching` state for the operation,
  subscribes to progress events, and surfaces the current step.
- **On step progress** — app updates the visible step.
- **On success** — operation resolves; dispatch state returns to idle; retry
  affordance is cleared.
- **On failure** — operation resolves with error; app preserves "last dispatch"
  parameters to enable retry (C6.4).

Dispatch lifecycle is independent of local session state — dispatches in flight
MUST NOT block or alter local playback (except where the user selected Cast
Transfer, in which case local stops only on confirmed success).

### Peek mode lifecycle

- **Enter peek** — app subscribes to the target remote's state feed; begins
  reflecting live state; exposes transport + queue controls bound to the remote.
  Local session MAY pause (C5.6) but MUST NOT change content.
- **Active peek** — transport and queue actions issued by the user are dispatched
  to the remote via its control API; the app reflects the remote's response.
- **Exit peek** — app unsubscribes from the remote feed. If local was implicitly
  paused on entry, the app MUST restore the prior playing/paused state.

### Takeover / hand-off lifecycles

**Take Over (remote → local):**
1. App snapshots the remote's session state.
2. App sends `stop` to the remote and awaits confirmation.
3. App adopts the snapshot as the new local session state and begins playback
   at the captured position (within C7.3 tolerance).
4. On step 2 or 3 failure, remote state MUST be unchanged and local session
   MUST be unchanged (atomicity requirement from C7.4).

**Hand Off (local → remote):**
1. App snapshots the local session state.
2. App dispatches to the target with the full snapshot (current item +
   position + queue + config).
3. On confirmed `playing` from the target, app either stops local (Transfer)
   or continues local (Fork).
4. On failure at any step, local session MUST remain intact (C7.4).

### Remote surface observation lifecycle

- **On app start** — app fetches `/api/v1/device/config`, enumerates surfaces,
  subscribes to per-surface state topics.
- **On config change** — app refreshes the surface list (mechanism:
  poll on focus, or WS push when available).
- **On surface going offline** — app marks the surface offline, preserves last
  snapshot (C9.6), and retains subscription so updates resume on reconnect.
- **On app unload** — app unsubscribes from all surface topics.

---

## External Interfaces

The app is a thin client over well-defined APIs. This section enumerates every
external surface the app consumes or exposes. No implementation detail — only
contracts.

### APIs consumed (HTTP)

| API | Route | Purpose |
|-----|-------|---------|
| Play | `GET /api/v1/play/:source/*` | Resolve a content ID to a renderable PlayableItem (C2.4). |
| Queue | `GET /api/v1/queue/:source/*` | Resolve a container ID to an ordered list of PlayableItems (C3.1, J2). |
| Info | `GET /api/v1/info/:source/*` | Detail-view metadata for a content item (C1.4). |
| Display | `GET /api/v1/display/:source/*` | Thumbnail/artwork for any content ID. |
| List | `GET /api/v1/list/*` | Hierarchical catalog browse, with modifiers `/playable`, `/shuffle`, `/recent_on_top` and params `take`/`skip` (C1.2). |
| Compose | `POST /api/v1/content/compose` | Resolve composite (visual + audio) content. |
| Device config | `GET /api/v1/device/config` | Fleet enumeration (C4.1). |
| Device dispatch | `GET /api/v1/device/:id/load` | Dispatch content to a remote surface (C6). Accepts `play`/`queue`, `shader`, `volume`, `shuffle`, and format-specific options. |
| Device volume | `GET /api/v1/device/:id/volume/:level` | Live volume control on a remote surface without re-dispatch (C5.4). |
| Device transport/queue control | *(interface required by this app)* | Transport (play/pause/seek/skip/stop) and queue-mutation commands targeting a specific remote session (C5.2, C5.3, C7). The exact endpoints are a contract deliverable alongside this app. |

### WebSocket topics

**Subscribed (inbound to app):**

| Topic | Purpose |
|-------|---------|
| `homeline:<deviceId>` with `type: wake-progress` | Dispatch orchestration step events (C6.3). |
| Per-device session state topic | Live session state of a remote surface (C4.2, C4.4). |
| External-control topic for this client | External systems issuing commands to the local session (C8.4). |

**Published (outbound from app):**

| Topic | Purpose |
|-------|---------|
| `playback_state` with `clientId`, `deviceId`, `displayName` | Local session live state heartbeat (C8.3, C10.3). |

### URL contract

| Parameter | Semantics | Notes |
|-----------|-----------|-------|
| `?play=<contentId>` | Autoplay this content in the local session on app load (C8.1, J9). | Replaces any existing local session per the user's explicit resume policy. |
| `?queue=<contentId>` | Append to local queue on app load (C8.1). | Does not auto-start playback if a session already exists. |
| `?shuffle=1` | Apply shuffle on load. | Optional modifier. |
| `?shader=<name>`, `?volume=<0-1>` | Apply playback options on load. | Optional modifiers. |

Remote-dispatch URL parameters (e.g. `?device=<id>`) MUST NOT be honored
(C8.2). Remote dispatch is an API concern, not a front-door URL concern.

### Dependencies within the frontend

The app consumes the following internal dependencies and MUST NOT duplicate
their responsibilities:

- **Playable Format Registry** (`frontend/src/modules/Player/lib/registry.js`) —
  format→renderer mapping. The app delegates all format-specific rendering.
- **Player lifecycle hook** (`frontend/src/modules/Player/hooks/usePlayableLifecycle.js`) —
  startup signal, metadata reporting, media-access registration for non-media
  renderers.
- **Media transport adapter** (`frontend/src/lib/Player/mediaTransportAdapter.js`)
  and related Player utilities — common transport controls.
- **Screen framework** (`frontend/src/screen-framework/`) — NOT a dependency of
  this app; referenced only to document that remote playback surfaces are built
  on it, not on this app.
- **Logging framework** (`frontend/src/lib/logging/`) — required for all
  diagnostic output (C10.1, C10.2).
- **Content paradigm** (`docs/reference/content/`) — the authoritative
  definition of content IDs, formats, the Playable Contract, queue semantics,
  and the Play/Queue/Display/List/Info APIs. This document extends but does
  not restate the content paradigm.

---

## Non-Functional Requirements

### N1. Performance

- **N1.1** First meaningful paint of the discovery surface MUST occur within
  1 second on a warm cache over a local network.
- **N1.2** Search results MUST begin rendering incrementally within 200ms of
  the first keystroke debounce resolving. The user MUST see partial results
  while the backend continues returning matches.
- **N1.3** Cast dispatch MUST present live step-by-step progress; it MUST NOT
  block the user from any other app action (continued browsing, local
  playback, another dispatch, peek, takeover, hand off).
- **N1.4** Local playback startup (from user action to first frame/sample)
  MUST target <3 seconds for already-resolved items; resolution latency is
  bound by the Play API.

### N2. Memory & scale

- **N2.1** Remote fleet view MUST remain lightweight regardless of fleet size.
  The app MUST NOT cache unbounded history per surface in memory; recent-items
  displays MUST use pagination, windowing, or on-demand fetch (C4.3).
- **N2.2** Local queue size MUST support at least 500 items without perceptible
  degradation in queue-operation responsiveness.
- **N2.3** Long-running tabs (hours to days) MUST NOT accumulate detectable
  memory growth from session persistence, WebSocket traffic, or dispatched
  operations.

### N3. Reliability

- **N3.1** The app MUST recover gracefully from every interface disruption
  covered in C9 without requiring a page reload. Page reload is always a
  permissible last-resort recovery, not a required one.
- **N3.2** No single failure (any device offline, any content unresolvable,
  any API 5xx) MUST render the rest of the app unusable.

### N4. Concurrency

- **N4.1** Any number of remote peek sessions MAY be active in parallel with
  local playback and an in-flight dispatch.
- **N4.2** Conflicting concurrent actions on the same remote session (two
  clients issuing control simultaneously) resolve via last-writer-wins at the
  remote; this app MUST NOT attempt coordination or locking. The remote
  session's live state is authoritative; the app reflects it.

### N5. Extensibility

- **N5.1** Adding a new playable content format MUST require zero changes to
  this app. The Playable Format Registry is the extension point.
- **N5.2** Adding a new remote surface MUST require only a `devices.yml` entry
  and backend adapter work — zero changes to this app.
- **N5.3** New queue operations, transport actions, or dispatch options
  landing in the shared APIs MUST be expressible without bespoke app-level
  branching; the app forwards structured requests, not command enums.

### N6. Accessibility (placeholder)

- **N6.1** Keyboard operability requirements, ARIA contracts, and
  screen-reader expectations are out of scope for this version of the
  requirements document. A separate accessibility spec SHOULD be authored
  before implementation.
