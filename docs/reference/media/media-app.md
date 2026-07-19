# Media App — Intent & Design

This is the design source-of-truth for the Media App: why it exists, what a user
can accomplish with it, and the high-level shape of the experience. It is written
to be sufficient to rebuild the app from scratch. Normative capability
requirements live in [`media-app-requirements.md`](./media-app-requirements.md);
wire-level contracts live in [`media-app-technical.md`](./media-app-technical.md).

---

## What This App Is

The Media App is the household's **universal content front door and universal
remote**. It is one surface — opened in any browser at `/media` — where a person
can:

- find **anything** the system knows how to play (movies, shows, music, hymns,
  audiobooks, photos, livestream channels, camera feeds, apps),
- play it **right here** in this browser,
- or send it **anywhere** in the house,
- while seeing — and controlling — **everything** that is currently playing on
  every screen and speaker the household owns.

The app adds no content knowledge of its own. It is a thin dispatcher over the
content paradigm (`docs/reference/content/`): anything resolvable by the Play
API is in scope, and a new content format landing in the platform appears in
this app with zero app changes.

## Objectives

1. **One front door.** A user never needs to know which backend system holds a
   piece of content. Search and browse span the entire catalog.
2. **The browser is a first-class playback surface.** Local playback is not a
   preview mode — it is a full session with a queue, transport, volume,
   shuffle/repeat, and persistence.
3. **Every screen in the house is one tap away.** Dispatching content to a TV
   or kiosk is as easy as playing it locally, including waking the device.
4. **Total session awareness.** The fleet view answers "what is playing in my
   house right now?" at a glance, live.
5. **Control without disruption.** A user can pause, seek, or re-queue any
   device's session from this app without touching what they themselves are
   playing (peek), and without walking to the device.
6. **Sessions are portable.** What's playing on the TV can be pulled to a
   laptop (take over); what's playing on a laptop can be pushed to the TV
   (hand off) — position, queue, and settings travel with it.
7. **Nothing is lost, nothing blocks.** Reloads and crashes resume where the
   user left off. A dead device, a failed dispatch, or an unreachable backend
   never takes the rest of the app down with it.

## Non-Goals

- **Running on the TVs themselves.** Kiosks and TVs run a separate
  screen-framework player app. This app dispatches to them and observes them;
  it is never installed on them.
- **Peer-browser awareness.** Other browsers running this app are invisible.
  Only configured devices appear as remote targets.
- **Accounts, profiles, personalization.** No login, no watchlists, no
  recommendation engine. (A per-browser display name exists purely so external
  observers can label this client.)
- **Catalog management.** Read-only against the content APIs.
- **Livestream channel administration.** Programming a channel (DJ board,
  per-channel queue admin at `/media/channels/*`) is a separate app. This app
  consumes channels as tunable content only.
- **Surveillance UI.** Camera feeds are tunable content; PTZ, detection
  overlays, and other camera-specific controls belong elsewhere.

---

## User Stories

### Discover
- As a household member, I want to type a few characters and see live results
  from every source at once, so I can find content without knowing where it
  lives.
- I want to narrow a search to a scope ("Movies", "Music", "Books") from the
  search box itself, and have the app remember my last scope.
- I want a home screen with my in-progress item, recent plays, and curated
  category cards, so the common case is zero typing.
- I want to drill into any category, folder, or collection and page through
  it, with containers and playable items distinguished.
- I want a detail page for any item showing artwork, description, and every
  action I can take on it.

### Play locally
- I want to play anything in this browser immediately, and keep browsing,
  searching, and queueing while it plays.
- I want playback to continue uninterrupted no matter which view I navigate
  to — a persistent mini player tells me what's playing and lets me
  pause/stop from anywhere.
- I want a full Now Playing view with seek, transport, volume, the queue,
  and a hand-off control.

### Queue
- Against any search result, browse row, or detail page, I want the four
  Plex-style actions — **Play Now**, **Play Next**, **Up Next**, **Add to
  Queue** — without leaving where I am, with instant visual confirmation.
- I want to see the queue, jump to any item, remove items, clear it, and
  toggle shuffle and repeat (off/one/all) — whether or not anything is
  playing.

### Cast
- I want to send any item to one or more devices in a single action, choosing
  per dispatch whether my local playback **transfers** (stops here) or
  **forks** (keeps playing here too).
- I want to watch the dispatch progress live (wake → prepare → load), and
  retry a failed dispatch without re-entering anything.
- I want to set a preferred cast target once so subsequent casts are one tap.

### Observe and control the fleet
- I want one view listing every configured device with its live state:
  online/offline, what's playing, position, and queue — marked stale when the
  connection drops rather than silently lying.
- I want to open a remote-control panel for any device (peek) and drive its
  transport, seek, volume, and queue — and have controls respond instantly
  even though the device confirms asynchronously.
- I want to pull a device's session to this browser (take over) and have the
  device stop while I continue from the same position with the same queue.
- I want to push my local session to a device (hand off) with everything
  intact.

### Trust it
- When I refresh or my browser crashes, I want my session — item, position,
  queue, settings — exactly where I left it, with an explicit, confirmable
  way to reset to a clean slate when I want one.
- When something fails to play, I want the app to move on to the next queue
  item and tell me, not freeze.
- As a home-automation author, I want to open the app with `?play=…`/
  `?queue=…` deep links and to observe/control the browser session over
  WebSocket, so the app composes with the rest of the house.

---

## Primary User Journeys

All journeys are concurrent and non-exclusive — the app never forces a mode
switch. (These J-numbers are referenced by the requirements doc.)

### J1. Discover and play locally
Search or browse → pick an item → it plays in this browser. Browsing,
searching, and queueing remain available before, during, and after playback.

### J2. Build and manage the queue
From any item: Play Now / Play Next / Add to Up Next / Add to Queue. Against
the queue: remove, jump, clear, shuffle, repeat (off/one/all). Available at
all times, for the local session and for any peeked remote session alike.

### J3. Dispatch to a remote device
Find content → pick target device(s) → choose Transfer or Fork → dispatch.
The device wakes if needed; progress streams live; failures are retryable.

### J4. Observe the fleet
One view, every device, live: state, current item, progress, queue. Offline
devices stay visible with their last-known snapshot.

### J5. Peek and control a remote session
Open a device's remote-control panel and drive its transport and queue
without altering the local session in any way.

### J6. Take over a remote session
Pull a device's session to this browser: the device stops, the local session
adopts its item, position, queue, and config, and resumes seamlessly.

### J7. Hand off local to a remote
Push the local session to a device, Transfer or Fork. The device adopts the
full session state and resumes within seconds of where local was.

### J8. Resume after disruption
Refresh, crash, or network blip → the session restores from persisted state.
An explicit reset action (with confirmation) returns to a clean slate.

### J9. External trigger
An external system opens `/media?play=<contentId>` (plus optional shuffle/
shader/volume) and the content autoplays locally — exactly once, idempotent
across refreshes. Remote dispatch from external systems goes through the
Device API, never through this app's URL.

---

## High-Level Design

### One shell, three regions

The app is a single-page shell with a persistent **dock**, a primary **nav**,
and a **canvas** that shows exactly one view at a time:

```
┌────────────────────────────────────────────────────────────┐
│ DOCK   [ search…          ▾scope ]  fleet● cast▸ ♪mini ⚙   │
├──────┬─────────────────────────────────────────────────────┤
│ NAV  │  CANVAS                                             │
│ Home │    one of: Home · Browse · Detail · Now Playing ·   │
│ Devs │            Fleet · Peek                             │
│Browse│                                                     │
└──────┴─────────────────────────────────────────────────────┘
```

**The dock is the app's constant.** It carries:

- the **search bar** with scope selector — search is always one keystroke
  away, never a destination page; results drop down inline and every result
  row carries the full action set (queue actions + cast),
- the **fleet indicator** — an at-a-glance summary of what's playing in the
  house, linking to the fleet view,
- the **cast target chip** — the currently-preferred dispatch target. It
  governs the search bar too: with a target configured, picking a search
  result casts there in the chip's mode rather than playing locally. Peek
  view is the one exception — while remote-controlling a device, selections
  always go to that device (forked, never transferred),
- the **mini player** — current local item, queue position counter,
  play/pause/stop; tapping the title opens Now Playing,
- the **settings menu** — session reset (confirmed) and client identity,
- the **dispatch progress tray** — live step-by-step progress of in-flight
  casts, with retry on failure.

### Views

| View | Purpose | Reached from |
|---|---|---|
| **Home** | Landing surface: resume card (current session), recents row, config-driven category cards. | Default; nav; breadcrumb. |
| **Browse** | Hierarchical catalog listing with breadcrumb, container drill-down, inline Play Now/Add per playable row, paging ("load more"). | Home cards; nav; container rows. |
| **Detail** | One item: artwork, description, full action row (Play Now / Play Next / Up Next / Add / Cast). | Browse rows; search results. |
| **Now Playing** | Full local transport: seek bar, prev/play-pause/next/stop, volume, the queue panel, and the hand-off picker. Hosts the visual output of the player. | Mini player; Escape/Back returns. |
| **Fleet** | All devices, live state cards, with Peek always and Take Over when a session is active. | Nav; fleet indicator. |
| **Peek** | Remote control for one device: transport, seek, volume, and the same queue panel bound to the remote session. Optimistic — controls reflect the predicted state instantly and lock until the device confirms. | Fleet cards. |

The queue panel is **one component used twice**: bound to the local session in
Now Playing, bound to a remote session in Peek. Queue semantics are identical
either way — that symmetry is a core design intent, not an implementation
convenience.

### Navigation model and paths

The app owns a single route, `/media`. Views are addressed by **URL query
state**, not by sub-routes, so navigation state and playback deep-link
parameters coexist in one URL:

| URL | Shows |
|---|---|
| `/media` | Home |
| `/media?view=browse&path=<source/segment>` | Browse at a catalog path |
| `/media?view=detail&contentId=<source:id>` | Item detail |
| `/media?view=nowPlaying` | Now Playing |
| `/media?view=fleet` | Fleet |
| `/media?view=peek&deviceId=<id>` | Remote control for a device |
| `/media?play=<contentId>&shuffle=1&shader=<s>&volume=<v>` | Deep-link autoplay (J9) |
| `/media?queue=<contentId>` | Deep-link queue append, no autostart |

Rules of the navigation model:

- In-app navigation is a **stack** (push/pop) mirrored to the URL, so the
  browser Back button, sharing a URL, and refreshing all do the right thing.
- Navigation parameters (`view`, `path`, `contentId`, `deviceId`) and playback
  parameters (`play`, `queue`, `shuffle`, `shader`, `volume`) are disjoint
  namespaces; writing one never clobbers the other.
- Deep-link playback parameters are processed **once** — a dedupe token makes
  refreshes idempotent. Unknown parameters are ignored and logged.
- Remote-dispatch parameters (e.g. `device=`) are deliberately **not** part of
  the URL contract; external remote dispatch uses the Device API.
- `/media/channels/*` belongs to the separate livestream-admin app.

### Playback is ambient, not modal

The defining architectural intent: **playback belongs to the session layer,
not to any view.** The player renders into a hidden mount that lives above
the view layer; navigating between Home, Browse, Fleet, or Peek never
unmounts or interrupts it. The Now Playing view doesn't *own* playback — it
merely re-hosts the player's visual output while open. The mini player is the
always-visible handle on the ambient session.

Consequences this design must preserve in any rebuild:

- Audio continues across all navigation.
- The session (item, position, queue, config) outlives every view.
- Format-specific rendering is delegated entirely to the platform's playable
  format registry; the app never branches on content format.

### Concurrency: nothing blocks anything

Every capability runs in parallel with every other: search while playing,
dispatch while browsing, peek one device while local plays and a second
dispatch is in flight. There are no modal "now casting…" states; long-running
operations surface in the dock tray and the user keeps working.

### Remote control feels local

Every remote command takes a network round trip before the device's
broadcast state reflects it. The peek surface therefore renders
**optimistically**: the affected control flips to the predicted state
immediately and locks (visually pending) until the device's real state
arrives or a short timeout expires. Conflicts between concurrent controllers
resolve by last-writer-wins at the device; the device's broadcast state is
always ground truth and the app always converges to it.

### Config-driven surfaces

What the home screen offers and what scopes search exposes are household
configuration, not code: both come from the media app config
(`data/household/apps/media/config.yml`, served at `/api/v1/media/config` —
`browse` entries become home cards, `searchScopes` becomes the scope tree;
see [`search-scopes.md`](./search-scopes.md)). Adding a category card or a
search scope is a config edit, not a deploy.

### Conceptual subsystems

A rebuild should preserve these seams (each is an independent concern with a
narrow interface):

| Subsystem | Responsibility |
|---|---|
| **Client identity** | Stable per-browser `clientId` + display name, so logs, broadcasts, and external control can address this browser. |
| **Local session** | The playback engine: queue state machine, transport, config, persistence to `localStorage`, stall detection, auto-advance, position heartbeat. |
| **Fleet observation** | Device roster + live per-device session snapshots over WebSocket, with staleness and offline synthesis. |
| **Peek control** | Command issuance to one remote session (transport/queue/config) with ack correlation and optimistic overlay. |
| **Cast / dispatch** | Target selection, fork/transfer choice, multi-target fan-out, wake-progress tracking, retry. |
| **Session portability** | Take over (claim remote snapshot → adopt locally) and hand off (push local snapshot → device adopts). |
| **Search** | Streamed multi-source search with scope filtering and inline-actionable results. |
| **External control** | URL deep-link command processing and inbound WebSocket commands targeting the local session. |
| **Shell & navigation** | Dock, nav, canvas, view stack ↔ URL sync. |

The local session and each peeked remote session present the **same
controller interface** (snapshot + transport + queue + config) to the UI;
panels like the queue and transport are written once against that interface
and bound to either side. This symmetry is what makes J2/J5 "identical
semantics" cheap, and it should survive any rebuild.

### Platform relationships

- **Content paradigm** (`docs/reference/content/`) — defines content IDs,
  formats, the Playable Contract, and the Play/Queue/Info/Display/List APIs
  this app consumes. This app restates none of it.
- **Playable format registry** — renders every format; the extension point
  for new content types (N5.1: new format = zero app changes).
- **Screen framework** — what the *devices* run. Not a dependency of this
  app; it is the other end of the command/state contracts in the technical
  doc.
- **Device session APIs & WebSocket topics** — transport/queue/config/claim
  endpoints and `device-state` / `device-ack` / `homeline` / `playback_state`
  / `client-control` topics, specified in
  [`media-app-technical.md`](./media-app-technical.md).
- **Logging framework** — all diagnostics are structured events per the log
  taxonomy in the technical doc; no raw console output.

---

## Code & Doc Pointers

- App entry: `frontend/src/Apps/MediaApp.jsx` (route `/media` in
  `frontend/src/main.jsx`)
- Modules: `frontend/src/modules/Media/` — `shell/` (dock, nav, canvas,
  views), `session/` (local session), `fleet/`, `peek/`, `cast/`, `search/`,
  `browse/`, `externalControl/`, `logging/`
- Requirements: [`media-app-requirements.md`](./media-app-requirements.md)
- Contracts: [`media-app-technical.md`](./media-app-technical.md)
- Search scopes: [`search-scopes.md`](./search-scopes.md)
- Content paradigm: `docs/reference/content/`
