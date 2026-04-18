# Media App — Skeleton Design

**Status:** Approved design; ready for implementation plan.
**Source requirements:** `docs/reference/media/media-app-requirements.md`
**Source contracts:** `docs/reference/media/media-app-technical.md`, `shared/contracts/media/`
**Date:** 2026-04-18

## 1. Purpose & Scope

This document defines the structural skeleton of the new `frontend/src/Apps/MediaApp.jsx` and its supporting module tree. It covers:

- Component hierarchy and the provider tree
- Per-provider state shape, mount/unmount lifecycles, and subscriptions
- Hook surfaces and cross-provider wiring
- API, WebSocket, SSE, localStorage, and logging integration points
- File manifest for all new modules

It does **not** cover: CSS/SCSS, visual layout, specific interaction details, accessibility, unit-test structure beyond the contract dependencies already cited in the technical doc. It is not an implementation plan; a separate plan will sequence the work.

All capability numbers (C1–C10, N1–N6) and section numbers (§4.x, §9.x) reference the authoritative requirements and technical contract documents.

## 2. Shape Decisions (answered during brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Surface decomposition | **Dock + Canvas** | Matches C1.1 (search always available), C3.4 (queue ops always available), N4.1 (concurrent capabilities), "never forces a mode switch." |
| Local session ownership | **Media App owns session; Player is a dumb render primitive** | `SessionSnapshot` (§9.2) is the portable, broadcast, persisted, snapshotable unit the whole system speaks. Binding it to Player internals creates impedance with every integration. |
| Controller abstraction | **Target-agnostic `useSessionController(target)`** | Contracts are already unified (`SessionSnapshot`, `CommandEnvelope`). Lets queue/transport UI be authored once and reused for local + peek. |
| Provider granularity | **Thin, purpose-scoped providers** | One concern per provider; each has a clear mount/unmount story; consumer re-render surface is minimized. |
| File layout | **Flat with cohesive folders** (`modules/Media/<concern>/…`) | Matches repo convention (Player, Feed, LiveStream); one-to-one mapping from capabilities to directories. |

## 3. Provider Tree & Mount Lifecycle

### 3.1 Provider stack

```jsx
// frontend/src/Apps/MediaApp.jsx
<ClientIdentityProvider>          {/* clientId, displayName (localStorage) */}
  <LocalSessionProvider>          {/* hidden <Player>, URL cmd, external ctl, broadcast, persistence */}
    <FleetProvider>               {/* GET /device/config; device-state:* + device-ack:* + client-control:* subs */}
      <PeekProvider>              {/* Map<deviceId, RemoteSessionController> */}
        <CastTargetProvider>      {/* { mode, targets[] }, localStorage-backed */}
          <DispatchProvider>      {/* Map<dispatchId, {step, status, deviceId}> */}
            <SearchProvider>      {/* scopes config + current query state */}
              <MediaAppShell />   {/* dock + canvas layout */}
            </SearchProvider>
          </DispatchProvider>
        </CastTargetProvider>
      </PeekProvider>
    </FleetProvider>
  </LocalSessionProvider>
</ClientIdentityProvider>
```

### 3.2 Per-provider mount behavior

| Provider | On mount | On unmount |
|---|---|---|
| ClientIdentity | Read/generate `clientId` + `displayName` from `localStorage` | — |
| LocalSession | Hydrate from `localStorage['media-app.session']` (schema v1 check, discard on mismatch); boot `idle` if absent; emit `media-app.mounted`, `session.resumed` if hydrated; attach beforeunload flush | Flush final snapshot; emit terminal `playback_state: stopped`; emit `media-app.unmounted` |
| Fleet | `GET /api/v1/device/config`; subscribe `device-state:<id>` + `device-ack:<id>` for every device; subscribe `client-control:<clientId>` | Unsubscribe all topics |
| Peek | (no mount effects — user-initiated) | Exit all active peeks; restore any saved local intents |
| CastTarget | Read `media-app.cast-target` from localStorage | Flush |
| Dispatch | (no mount effects — per-dispatch subscribes to `homeline:<id>`) | Cancel in-flight; unsubscribe all homeline topics |
| Search | `GET /api/v1/media/config` (for `searchScopes`) | — |

### 3.3 Mount order rationale

- LocalSession must hydrate **before** the URL command is processed so `?play=…` can either replace or append against the hydrated state per §8 precedence rules.
- Fleet must be mounted **before** Peek/Cast/Dispatch because those three read from Fleet state; wrapping them inside Fleet guarantees availability.
- Search is innermost because nothing else depends on it — keeps its re-render surface tiny.

### 3.4 WebSocket subscription ownership

| Topic | Owned by | Lifetime |
|---|---|---|
| `device-state:<id>` (every device) | Fleet | App lifetime |
| `device-ack:<id>` (every device) | Fleet (routed to whichever adapter issued the `commandId`) | App lifetime |
| `client-control:<clientId>` | Fleet (routes inbound into LocalSession `useExternalControl`) | App lifetime |
| `homeline:<deviceId>` | Dispatch | Per in-flight op only |

Reconnect handling (C9.4) lives in Fleet: on WS drop, mark all devices stale; on reconnect, re-subscribe and backend replays last snapshots (§7.4).

## 4. Local Session

### 4.1 State shape

```js
// Canonical — matches §9.2 SessionSnapshot
snapshot = {
  sessionId,
  state: 'idle' | 'ready' | 'loading' | 'playing' | 'paused'
       | 'buffering' | 'stalled' | 'ended' | 'error',
  currentItem: PlayableItem | null,
  position: seconds,
  queue: { items: QueueItem[], currentIndex, upNextCount },
  config: { shuffle, repeat, shader, volume, playbackRate },
  meta: { updatedAt, ownerId: clientId }
}

// Transient (not persisted, not broadcast)
transient = {
  resilienceState,      // from useMediaResilience inside <Player>
  autoplayBlocked,      // surfaced via PlayerOverlayAutoplayBlocked
  lastError,            // display-only
  dispatchingFromLocal  // dock indicator when user triggered a cast
}
```

### 4.2 Controller surface

`useSessionController(target)` where `target` is `'local'` or `{ deviceId }` — the **same** shape in both cases.

```js
{
  snapshot,
  transport: {
    play(), pause(), stop(),
    seekAbs(seconds), seekRel(deltaSeconds),
    skipNext(), skipPrev()
  },
  queue: {
    playNow(contentId, { clearRest }),
    playNext(contentId),
    addUpNext(contentId),
    add(contentId),
    reorder({ from, to } | { items }),
    remove(queueItemId),
    jump(queueItemId),
    clear()
  },
  config: {
    setShuffle(bool),
    setRepeat('off' | 'one' | 'all'),
    setShader(string | null),
    setVolume(int 0..100)
  },
  lifecycle: {
    reset(),
    adoptSnapshot(snapshot, { autoplay })
  },
  portability: {
    snapshotForHandoff(),
    receiveClaim(snapshot)   // used by Take Over flow
  }
}
```

### 4.3 `LocalSessionAdapter`

Behind `target: 'local'`. Drives:

- `<Player>` mounted via `<HiddenPlayerMount>` (single-item mode — we do not use Player's internal `useQueueController`)
- `localStorage` persistence (§11 of the contract)
- Outbound `playback_state` broadcast (C8.3, §9.10)
- Queue advancement loop (below)

### 4.4 Queue advancement loop (`advancement.js`)

Triggers: `<Player> onEnded`, `<Player> onError` after resilience exhaustion (C9.5), explicit `skipNext/skipPrev`, `playNow/jump`.

Algorithm:

1. Consult `snapshot.config.repeat` + `snapshot.config.shuffle` + `queue.items` + `queue.currentIndex` + `upNextCount`.
2. Compute next `queueItemId` (upNext items before regular queue items; shuffle reorders regular queue only; repeat-one loops current item; repeat-all wraps at end).
3. If none → `snapshot.state = 'ended'`, then `'idle'` per configured timeout.
4. Otherwise: resolve `PlayableItem` via `GET /api/v1/play/:source/*` if not in per-session cache; update `snapshot.currentItem` + `currentIndex`; Player receives new item and loads.

Stall detection (C9.3) and error advancement (C9.5) both route through this loop.

### 4.5 `<Player>` wrapping strategy

- `<HiddenPlayerMount>` renders `<Player>` unconditionally inside `LocalSessionProvider` so audio and playback continue across canvas navigation (J1).
- `<NowPlayingView>` teleports the Player tree into its visible slot via React portal when the canvas is on "Now Playing." When on Browse/Fleet/Peek/Home, the Player stays in its hidden container.
- Player is fed a **single** `PlayableItem` at a time — `snapshot.currentItem`. Its own `useQueueController` is bypassed (we don't pass `queue=` props).
- Player's `onEnded`, `onError`, `onProgress`, `onStateChange` are all routed back into `LocalSessionAdapter`, which is the single source of truth for `snapshot.state` and `snapshot.position`.

### 4.6 Persistence (§11.2)

```js
// modules/Media/session/persistence.js
writePersistedSession(snapshot, wasPlayingOnUnload)   // throttled to ≤ 1 per 500ms
readPersistedSession() -> { snapshot, wasPlayingOnUnload } | null | 'schema-mismatch'
clearPersistedSession()
```

Rules:

- Write on every state transition and every 5s while playing.
- Atomic `JSON.stringify` → `setItem`. Never partial.
- `schemaVersion: 1`. Mismatch → discard + log `session.reset` with `reason: "schema-mismatch"`.
- On `QuotaExceededError`: truncate `queue.items` up to `currentIndex` (past-played), retry once; on second failure, fall back to in-memory-only and surface a warning.
- Reset (C2.3) removes `media-app.session` + `media-app.url-command-token`. Other keys preserved.

### 4.7 `beforeunload` behavior

`LocalSessionProvider` attaches a `beforeunload` listener that:

1. Flushes the final snapshot synchronously (no throttle).
2. Publishes a terminal `playback_state` broadcast with `state: 'stopped'`.
3. Unsubscribes from WS topics where possible (best-effort; browser may tear down first).

## 5. Fleet, Peek, Dispatch

### 5.1 `FleetProvider`

```js
state = {
  devices: DeviceConfig[],                          // §9.5
  snapshotByDevice: Map<deviceId, SessionSnapshot>, // latest from device-state:*
  reasonByDevice:   Map<deviceId, 'change' | 'heartbeat' | 'initial' | 'offline'>,
  lastSeenByDevice: Map<deviceId, ISOString>,
  isStale: Map<deviceId, boolean>                   // WS disconnected OR >15s no heartbeat
}

selectors = { useDevice(id), useFleetSummary(), useIsStale(id) }
```

- On WS drop: mark every device stale; preserve last snapshots (C9.6). On reconnect: re-subscribe; backend replays last snapshot (§7.4); stale flag clears on first fresh snapshot.
- Device-config refresh: poll `GET /api/v1/device/config` on `visibilitychange:visible`. No live push for config in v1.
- Offline synthesis arrives as `reason: 'offline'` broadcasts from the backend (§7.4) — the provider treats them like any other state update.

### 5.2 `PeekProvider`

```js
state = {
  activePeeks: Map<deviceId, {
    controller: RemoteSessionController,
    enteredAt: ISOString,
    savedLocalIntent: 'playing' | 'paused' | null  // for C5.6 restoration
  }>
}

api = {
  enterPeek(deviceId) -> controller,
  exitPeek(deviceId),
  useActivePeeks()
}
```

- `RemoteSessionAdapter(deviceId)` is the peek controller; see §5.3.
- On `enterPeek`: capture local playing/paused intent; optionally pause local per C5.6 (policy configurable). Entering does not re-subscribe — Fleet already has the state feed.
- On `exitPeek`: restore saved local intent. Content state never modified.
- Multiple concurrent peeks (C5.5): `activePeeks` is a Map; no singleton.

### 5.3 `RemoteSessionAdapter`

Implements the same `useSessionController` interface as `LocalSessionAdapter`, backed by REST + WS:

- **Read:** `snapshot = FleetProvider.snapshotByDevice.get(deviceId)`. No direct REST fetch — the live feed is authoritative.
- **Transport:** `POST /api/v1/device/:id/session/transport` → await matching `commandId` on `device-ack:<id>` → reconcile with next `device-state:<id>`.
- **Queue ops:** `POST /api/v1/device/:id/session/queue/:op` — same lifecycle.
- **Config:** `PUT /api/v1/device/:id/session/{shuffle|repeat|shader|volume}` — same lifecycle.
- **Claim (Take Over):** `POST /api/v1/device/:id/session/claim` → on success, call `LocalSessionAdapter.receiveClaim(snapshot)` → local atomically adopts (C7.4).
- **commandId lifecycle:** every mutation generates a UUID, caches it for 60s. Retry with same `commandId` is a no-op server-side (C9.8 idempotency).
- **Ack timeout:** 5s per §6.3 — if no ack, mark command failed, surface retryable error.

### 5.4 `DispatchProvider`

```js
state = {
  inFlight: Map<dispatchId, {
    deviceId, contentId, mode,         // mode: 'transfer' | 'fork' | 'adopt'
    steps: StepEvent[],
    status: 'running' | 'success' | 'failed',
    error?: string
  }>,
  lastAttempt: { params, targets }     // for retry (C6.4)
}

api = {
  dispatchToTarget({ targets, params, mode, snapshot? }) -> dispatchId[],
  retryLast(),
  useDispatch(dispatchId),
  useAllDispatches()
}
```

- On `dispatchToTarget`: generate one `dispatchId` per target (§4.8 — client-side fan-out, no new API), subscribe to `homeline:<deviceId>` **only for the duration of each op**, then `POST /api/v1/device/:id/load`. On terminal step, unsubscribe that specific topic.
- Adopt-mode (Hand Off, §4.7): same API; body includes `{dispatchId, snapshot, mode:'adopt'}`.
- Idempotency (C9.8): if the user re-clicks with identical params within 60s, reuse the existing `dispatchId` rather than creating a new one.
- `dispatch.*` events logged per §10.1.

### 5.5 Cross-provider flows

**User clicks Cast Transfer on a content card:**

```
CastButton onClick
  → useCastTarget() — read { mode, targets[] }
  → useDispatch().dispatchToTarget({ targets, params: {play: contentId}, mode: 'transfer' })
  → returns dispatchId[]
  → DispatchProgressTray reads useDispatch(id) for each
  → on all success with mode='transfer':
      useSessionController('local').transport.stop()
  → on any failure: log dispatch.failed; retry affordance surfaces in the tray
```

**User clicks Take Over on a device:**

```
TakeOverButton onClick
  → RemoteSessionAdapter(deviceId).lifecycle  — issues POST /device/:id/session/claim
  → on 200: LocalSessionAdapter.receiveClaim(snapshot)
      - If local was playing, it stops first (atomic replace)
      - Local adopts snapshot.queue, snapshot.config, snapshot.currentItem
      - Seeks to snapshot.position (within 2s tolerance per C7.3)
      - Resumes playback
  → on 502 ATOMICITY_VIOLATION (C7.4): local state is untouched; surface hard error; no retry
```

**User clicks Hand Off (Transfer) to a device:**

```
HandOffButton onClick
  → snapshot = LocalSessionAdapter.portability.snapshotForHandoff()
  → DispatchProvider.dispatchToTarget({ targets: [deviceId], mode: 'adopt', snapshot })
  → on target reporting 'playing' via device-state:<id>:
      mode === 'transfer' → LocalSessionAdapter.transport.stop()
      mode === 'fork'     → local continues unchanged
  → on failure: local unchanged (C7.4)
```

## 6. Search, Browse, Detail

### 6.1 `SearchProvider`

```js
state = {
  scopes: SearchScope[],           // from GET /api/v1/media/config
  currentScopeKey: string,         // persisted: media-scope-last
  recents: string[],               // media-scope-recents (last 5 that produced results)
  favorites: string[]              // media-scope-favorites
}
```

### 6.2 `useLiveSearch({ scopeKey, minChars: 2, debounceMs: 200 })`

```js
{ query, setQuery, results, loading, error, sourcesPending }
```

- SSE stream via `EventSource` against `GET /api/v1/content/query/search/stream`.
- Event handlers:
  - `pending` → update `sourcesPending`
  - `results` → merge (dedupe by `contentId`, preserve earliest source order)
  - `complete` → `loading = false`; log `search.completed`
  - `error` → close stream; surface recoverable error; log via `mediaLog`
- New keystroke after debounce closes the existing `EventSource` and opens a new one. Logs `search.issued`.
- Search bar lives in `<Dock>`, not in a canvas route, so it is always available (C1.1).
- Each result is directly actionable (C1.1a): `{ playNow, playNext, addUpNext, add, castTo(target) }`. These methods call the local session controller or `CastTargetProvider` directly — no navigation into detail view required.

### 6.3 `useListBrowse(path, { modifiers, take, skip })`

- `GET /api/v1/list/<path>[/playable][/shuffle][/recent_on_top]?take=&skip=`
- Returns `{ items, total, modifiers, loading, error, loadMore }` where `loadMore` appends the next page.
- Items may be `ListItem` (container — navigable) or `PlayableItem` (leaf — actionable).

### 6.4 `useContentInfo(contentId)` + `<DetailView>`

- `GET /api/v1/info/:source/*` — returns `{ info, loading, error }`.
- `<DetailView contentId={...}>` is a canvas route composing metadata + thumbnail + actions (same Plex MP action set as `SearchResults` + `CastButton`).

### 6.5 Thumbnails

Every thumbnail is `GET /api/v1/display/:source/*`. A small helper `displayUrl(contentId)` builds the URL; no hook needed.

### 6.6 `<HomeView>` (C1.3)

Canvas route that composes several `<BrowseView>` instances against config-driven paths (`recent`, `continue-where-you-left-off`, etc.). Path list is loaded from `/api/v1/media/config` (extended for home) or hardcoded for v1 — resolved during planning.

### 6.7 API error mapping (§12)

Single helper `useApiError(response)` converts `{ok, error, code, retryable}` into display + retry affordance. Special cases:

- `DEVICE_OFFLINE` → **not** an error; feeds Fleet's offline indicator instead (C9.6).
- `ATOMICITY_VIOLATION` → hard error, no auto-retry (§12.3).
- `retryable: true` → surface a retry affordance.

## 7. Side-effect Subsystems

These are mount-once side-effect hooks, not providers. They attach state that already has a home.

### 7.1 `useUrlCommand()` — inside `LocalSessionProvider`

Processes `window.location.search` once after session hydration (§8):

- Dedupe token = hash of search-string; compare against `localStorage['media-app.url-command-token']`. Same token → skip + log `url-command.ignored`.
- Normalizes `volume` (contract says `0..1` float in URL, `0..100` int in snapshot — convert at boundary).
- Unknown params: logged, ignored, never forwarded.
- Remote-dispatch params (e.g. `device=<id>`) are explicitly rejected per C8.2.
- Precedence: `play` wins over `queue`; `queue` appended **after** the played item.
- Reset (C2.3) clears the token so the next URL can act again.

### 7.2 `useExternalControl()` — inside `LocalSessionProvider`

Subscribes to `client-control:<clientId>` (the subscription itself is owned by Fleet; this hook just routes inbound envelopes). For each valid `CommandEnvelope` (§6.2, validated via existing `shared/contracts/media/envelopes.mjs`):

| Command | Dispatch |
|---|---|
| `transport` | `controller.transport[action](value)` |
| `queue` | `controller.queue[op](...)` |
| `config` | `controller.config.set<Setting>(value)` |
| `adopt-snapshot` | `controller.lifecycle.adoptSnapshot(snapshot, { autoplay })` |
| `system` (`reset`, `reload`, `sleep`, `wake`) | routed to matching handler; `reload` uses `guardedReload` |

Publishes ack on a paired `client-ack:<clientId>` topic within 5s of receipt. Logs `external-control.received` / `external-control.rejected`.

### 7.3 `usePlaybackStateBroadcast()` — inside `LocalSessionProvider`

Publishes `playback_state` broadcast per §9.10:

- On every state transition (reactive)
- Every 5s while state is `playing` (heartbeat — C10.3)
- Once with `state: 'stopped'` on unmount/reset
- Includes `clientId`, `sessionId`, `displayName`
- Sub-second progress updates rate-limited via `logger.sampled`

### 7.4 `mediaLog.js` — logging facade

```js
// modules/Media/logging/mediaLog.js
const baseLogger = getLogger().child({ app: 'media' });

export const mediaLog = {
  sessionCreated, sessionReset, sessionResumed, sessionStateChange, sessionPersisted,
  queueMutated,
  playbackStarted, playbackStalled, playbackError, playbackAdvanced,
  searchIssued, searchResultChunk, searchCompleted,
  dispatchInitiated, dispatchStep, dispatchSucceeded, dispatchFailed,
  peekEntered, peekExited, peekCommand, peekCommandAck,
  takeoverInitiated, takeoverSucceeded, takeoverFailed,
  handoffInitiated, handoffSucceeded, handoffFailed,
  wsConnected, wsDisconnected, wsReconnected, wsStale,
  externalControlReceived, externalControlRejected,
  urlCommandProcessed, urlCommandIgnored,
};
```

- Context (`clientId`, `sessionId`, and `deviceId|dispatchId|commandId` when available) is injected automatically.
- High-frequency events (`dispatch.step`, `session.state-change`, `session.persisted`, `peek.command-ack`) use `logger.sampled({ maxPerMinute: 20-30, aggregate: true })`.
- No call site in the new tree uses raw `console.*` per CLAUDE.md rule.

## 8. Component Hierarchy

### 8.1 `MediaApp.jsx`

```jsx
export default function MediaApp() {
  return (
    <ClientIdentityProvider>
      <LocalSessionProvider>
        <FleetProvider>
          <PeekProvider>
            <CastTargetProvider>
              <DispatchProvider>
                <SearchProvider>
                  <MediaAppShell />
                </SearchProvider>
              </DispatchProvider>
            </CastTargetProvider>
          </PeekProvider>
        </FleetProvider>
      </LocalSessionProvider>
    </ClientIdentityProvider>
  );
}
```

### 8.2 `MediaAppShell` — dock + canvas layout

```jsx
export default function MediaAppShell() {
  return (
    <>
      <Dock>
        <SearchBar />              {/* always visible (C1.1) */}
        <CastTargetChip />         {/* cast target + popover */}
        <FleetIndicator />         {/* fleet-at-a-glance; click → FleetView */}
        <MiniPlayer />             {/* tiny now-playing; click → NowPlayingView */}
        <DispatchProgressTray />   {/* live strip of in-flight dispatches */}
      </Dock>
      <Canvas />                   {/* swappable view */}
      <HiddenPlayerMount />        {/* always-mounted <Player>; portaled into NowPlayingView */}
    </>
  );
}
```

### 8.3 `<Canvas>` view registry

Client-side switcher (not URL-routed in v1):

```js
const CANVAS_VIEWS = {
  home:       <HomeView />,
  browse:     <BrowseView path={...} />,
  detail:     <DetailView contentId={...} />,
  fleet:      <FleetView />,
  peek:       <PeekPanel deviceId={...} />,
  nowPlaying: <NowPlayingView controller={localController} />,
};
```

View state lives in `MediaAppShell` local state. URL-level `?play=…` is consumed by `useUrlCommand` and does **not** change canvas view; local playback happens in the background on whatever view you are on.

URL-backed canvas routing (`/media/fleet`, `/media/peek/:deviceId`) is a deliberate non-goal for v1 and can be layered on later via a small `NavProvider`.

## 9. File Manifest

```
frontend/src/Apps/MediaApp.jsx                                      ← main entry
frontend/src/modules/Media/
├── session/
│   ├── ClientIdentityProvider.jsx
│   ├── LocalSessionProvider.jsx         ← owns <Player> mount; hosts URL/ExternalControl/Broadcast hooks
│   ├── LocalSessionAdapter.js           ← useSessionController surface for 'local'
│   ├── RemoteSessionAdapter.js          ← useSessionController surface for {deviceId}
│   ├── useSessionController.js          ← target-agnostic hook (picks adapter)
│   ├── sessionReducer.js                ← SessionSnapshot + state-machine reducer
│   ├── queueOps.js                      ← Plex MP ops (playNow/playNext/addUpNext/add, reorder/remove/jump/clear)
│   ├── advancement.js                   ← end/error → next-item selection (repeat/shuffle/upNext)
│   ├── persistence.js                   ← localStorage read/write/clear, schema v1, quota handling
│   └── HiddenPlayerMount.jsx            ← always-mounted <Player>; portal target for NowPlayingView
├── fleet/
│   ├── FleetProvider.jsx
│   ├── useDevice.js
│   ├── useFleetSummary.js
│   └── subscriptions.js                 ← device-state:* + device-ack:* + client-control:* wiring
├── peek/
│   ├── PeekProvider.jsx
│   ├── usePeek.js
│   └── PeekPanel.jsx
├── cast/
│   ├── CastTargetProvider.jsx
│   ├── useCastTarget.js
│   ├── CastButton.jsx
│   ├── CastTargetChip.jsx
│   ├── CastPopover.jsx
│   ├── DispatchProvider.jsx
│   ├── useDispatch.js                   ← fan-out, homeline:* sub lifecycle, retry
│   └── DispatchProgressTray.jsx
├── search/
│   ├── SearchProvider.jsx
│   ├── useLiveSearch.js                 ← SSE consumer
│   ├── SearchBar.jsx
│   └── SearchResults.jsx
├── browse/
│   ├── useListBrowse.js
│   ├── useContentInfo.js
│   ├── BrowseView.jsx
│   ├── DetailView.jsx
│   └── HomeView.jsx
├── shell/
│   ├── MediaAppShell.jsx
│   ├── Dock.jsx
│   ├── Canvas.jsx
│   ├── MiniPlayer.jsx
│   ├── NowPlayingView.jsx
│   ├── FleetView.jsx
│   └── FleetIndicator.jsx
├── externalControl/
│   ├── useUrlCommand.js
│   └── useExternalControl.js
├── shared/
│   ├── usePlaybackStateBroadcast.js
│   ├── useApiError.js
│   └── displayUrl.js                    ← thumbnail URL builder
└── logging/
    └── mediaLog.js                      ← one helper per event in §10.1 of the contract
```

## 10. Existing Dependencies (consumed, not duplicated)

- `frontend/src/modules/Player/Player.jsx` — rendering primitive (single-item mode).
- `frontend/src/modules/Player/lib/registry.js` — Playable Format Registry (the sole extension point per C2.4 and N5.1).
- `shared/contracts/media/*` — shape, envelope, command, topic, error validators.
- `frontend/src/lib/api.mjs` — `DaylightAPI` HTTP helper.
- `frontend/src/lib/logging/` — structured logger.
- `frontend/src/lib/ws.js` (or equivalent singleton) — WebSocket manager.
- `frontend/src/lib/reloadGuard.js` — guarded reload for `system: reload` external commands.

## 11. Out of Scope for the Skeleton

Explicitly deferred or handled elsewhere:

- **Remote play history** (C4.3) — deferred per §3 of the technical contract.
- **Accessibility specifics** (N6.1) — a separate spec per the requirements.
- **LiveStream channel administration** — separate surface (`frontend/src/Apps/LiveStreamApp.jsx`).
- **Camera / surveillance UI** — separate surface (`modules/CameraFeed/`).
- **CSS / SCSS / visual design** — not in this skeleton.
- **URL-backed canvas routing** — v1 uses client-side switcher state; URL routing is a follow-up.

## 12. Requirements Traceability (skeleton coverage)

| Requirement cluster | Where in the skeleton |
|---|---|
| C1 Content discovery | `search/` + `browse/` + `SearchBar` in Dock (always available) |
| C2 Local session | `session/LocalSessionProvider` + `LocalSessionAdapter` + `persistence.js` |
| C3 Queue management | `session/queueOps.js` + `useSessionController.queue` (target-agnostic, satisfies C3.5) |
| C4 Fleet observation | `fleet/FleetProvider` + `FleetView` + `FleetIndicator` |
| C5 Remote control (peek) | `peek/PeekProvider` + `PeekPanel` consuming `RemoteSessionAdapter` |
| C6 Dispatch | `cast/DispatchProvider` + `CastButton` + `DispatchProgressTray` |
| C7 Session portability | `LocalSessionAdapter.portability` + `RemoteSessionAdapter.claim` + Dispatch adopt-mode |
| C8 External integration | `externalControl/useUrlCommand` + `useExternalControl` + `shared/usePlaybackStateBroadcast` |
| C9 Resilience | Persistence + Fleet stale handling + advancement.js on error/stall + idempotency-aware dispatch/peek controllers |
| C10 Observability | `logging/mediaLog.js` facade injected at every event site |
| N1 Performance | Dock is static (fast paint); SSE search delivers incremental results; Dispatch progress is non-blocking |
| N2 Memory & scale | Fleet uses pagination for history (deferred); persistence truncates under quota; session cache is per-session only |
| N3 Reliability | Stale indicators + retry affordances + per-device failure isolation in Fleet |
| N4 Concurrency | Peek Map + Dispatch Map both allow arbitrary concurrency |
| N5 Extensibility | Playable Format Registry untouched; new devices require only `devices.yml`; new queue ops pass through `useSessionController.queue` |

## 13. Open Questions for the Implementation Plan

Items the plan will resolve:

- ~~`<HomeView>` config source — extended `/media/config` or v1 hardcoded paths?~~ **Resolved in P2:** uses existing `/api/v1/media/config` `browse` entries as the source of card labels and derived paths. No extended endpoint needed.
- ~~Exact WS client singleton name/API~~ **Resolved in P1:** `wsService` at `frontend/src/services/WebSocketService.js` (`.send` / `.subscribe(filter, cb) → unsubscribe` / `.onStatusChange`).
- Whether `PeekProvider` pauses local on entry by default (C5.6 is "MAY" — configurable or implicit?).
- Exact `client-ack:<clientId>` topic shape — the contract covers `client-control:<clientId>` (inbound) but the ack topic is an implicit pair. Confirm with the contract author or propose an addition.
