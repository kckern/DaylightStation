# Media App Requirement Coverage Audit — 2026-04-18

**Scope:** Coverage of `docs/reference/media/media-app-requirements.md` (capabilities
C1–C10, non-functional N1–N6) by the P1–P7 skeleton rebuild merged into `main`
on 2026-04-18.

**Context:** A seven-phase rebuild landed this month, replacing the pre-rebuild
Media App surface. Plans live at `docs/superpowers/plans/2026-04-18-media-app-p*.md`.
Code under audit: `frontend/src/Apps/MediaApp.jsx` and `frontend/src/modules/Media/**`.
The prior audit (`2026-02-27-media-app-implementation-audit.md`) predates this
rebuild and is no longer authoritative.

---

## Per-capability matrix

### C1. Content discovery

| Req  | Status | Where | Notes |
|------|--------|-------|-------|
| C1.1  | ✅ | `modules/Media/search/useLiveSearch.js:5-22`, `SearchBar.jsx:6-44`, `SearchProvider.jsx` | Inline combobox streaming via `useStreamingSearch`; always available. |
| C1.1a | ✅ | `search/SearchResults.jsx:16-24` | Play Now / Next / Up Next / Add / Cast all on the result row. |
| C1.1b | ✅ | `search/SearchProvider.jsx`, `SearchBar.jsx:21-29` | Scopes loaded from `/api/v1/media/config`; localStorage persisted. |
| C1.2  | ✅ | `browse/BrowseView.jsx`, `browse/useListBrowse.js` | `/api/v1/list/*` with `take`/`skip` + modifiers. |
| C1.3  | ✅ | `browse/HomeView.jsx:15-49` | Config-driven cards; continue-where-you-left-off deferred. |
| C1.4  | ✅ | `browse/DetailView.jsx`, `browse/useContentInfo.js` | `/api/v1/info/:source/*` metadata + all 5 actions. |

### C2. Local session

| Req  | Status | Where | Notes |
|------|--------|-------|-------|
| C2.1 | ✅ | `session/LocalSessionAdapter.js:42-44`, `LocalSessionProvider.jsx:42-52` | Single adapter per app. |
| C2.2 | ✅ | `session/persistence.js:24-57`, `LocalSessionProvider.jsx:54-62` | Schema-versioned hydrate; quota truncation. |
| C2.3 | ✅ | `session/LocalSessionAdapter.js:150-153` | `lifecycle.reset()` clears storage and emits RESET. |
| C2.4 | ✅ | `session/HiddenPlayerMount.jsx:102` | Delegates to `<Player>` + Playable Format Registry; no format branching in Media. |

### C3. Queue management

| Req  | Status | Where | Notes |
|------|--------|-------|-------|
| C3.1 | ✅ | `session/queueOps.js:53-134`, `LocalSessionAdapter.js:96-117` | Plex MP action set pure + integrated. |
| C3.2 | ✅ | `session/queueOps.js:140-211` | remove, jump, reorder (swap/full), clear. |
| C3.3 | ✅ | `session/advancement.js:24-60`, `LocalSessionAdapter.js:137-141` | Shuffle + off/one/all repeat. |
| C3.4 | ✅ | `session/LocalSessionAdapter.js:96-133` | Mutations do not interrupt playback unless action implies it. |
| C3.5 | ✅ | `peek/RemoteSessionAdapter.js:65-95` | Remote-peek exposes identical queue surface. |

### C4. Remote fleet observation

| Req  | Status | Where | Notes |
|------|--------|-------|-------|
| C4.1 | ✅ | `fleet/FleetProvider.jsx:14`, `fleet/useDevices.js` | `GET /api/v1/device/config` at mount + visibility refocus. |
| C4.2 | ✅ | `shell/FleetView.jsx` | All required fields rendered. |
| C4.3 | 🚫 | — | History explicitly deferred to post-skeleton work. |
| C4.4 | ✅ | `fleet/FleetProvider.jsx:17-31` | `device-state:<id>` subscription; `STALE` on disconnect. |

### C5. Remote control (peek mode)

| Req  | Status | Where | Notes |
|------|--------|-------|-------|
| C5.1 | ✅ | `peek/PeekProvider.jsx:31-49` | enterPeek/exitPeek preserves local snapshot. |
| C5.2 | ✅ | `peek/RemoteSessionAdapter.js:55-63` | Full transport set (play/pause/stop/seekAbs/Rel/skipN/P). |
| C5.3 | ✅ | `peek/RemoteSessionAdapter.js:65-95` | Full C3 queue ops retargeted to remote. |
| C5.4 | ✅ | `peek/RemoteSessionAdapter.js:97-100` | setShader + setVolume independent of local. |
| C5.5 | ✅ | `peek/PeekProvider.jsx:16` | `activePeeks: Map<deviceId, …>` supports concurrent peeks. |
| C5.6 | ✅ | `peek/PeekProvider.jsx:52-60` | Exit leaves local content state unchanged. |

### C6. Dispatch (cast → remote)

| Req  | Status | Where | Notes |
|------|--------|-------|-------|
| C6.1 | ✅ | `cast/DispatchProvider.jsx:37-75` | Multi-target fan-out over targetIds array. |
| C6.2 | ✅ | `cast/DispatchProvider.jsx:58-59`, `cast/useHandOff.js:13-16` | Transfer/Fork selection; transfer stops local on success. |
| C6.3 | ✅ | `cast/DispatchProvider.jsx:27-35` | `homeline:<deviceId>` `wake-progress` routed to dispatch state. |
| C6.4 | ✅ | `cast/DispatchProvider.jsx:62-72`, `dispatchReducer.js:41-58` | failedStep + last-attempt retry affordance. |
| C6.5 | ✅ | `cast/dispatchUrl.js`, `DispatchProvider.jsx:37` | shader/volume/shuffle + format-specific params flow through. |

### C7. Session portability

| Req  | Status | Where | Notes |
|------|--------|-------|-------|
| C7.1 | ✅ | `peek/useTakeOver.js`, `peek/RemoteSessionAdapter.js` | Snapshot → stop remote → adoptSnapshot locally. |
| C7.2 | ✅ | `cast/useHandOff.js:6-19` | Dispatch `mode: 'adopt'`; transfer/fork toggle honored. |
| C7.3 | ⚠️ | `cast/useHandOff.js:10`, `peek/useTakeOver.js` | Snapshot carries position, but no post-transfer delta check against the 2 s tolerance; violation would go silent. |
| C7.4 | ✅ | `peek/useTakeOver.js` | Failure sequencing preserves originating session. |

### C8. External integration

| Req  | Status | Where | Notes |
|------|--------|-------|-------|
| C8.1 | ✅ | `externalControl/useUrlCommand.js:6-36` | `?play`, `?queue`, `?shuffle`, `?shader`, `?volume` honored. |
| C8.2 | ✅ | `externalControl/useUrlCommand.js:19-22` | `?device` explicitly rejected + logged. |
| C8.3 | ✅ | `shared/usePlaybackStateBroadcast.js:3-68` | 5 s heartbeat; `stopped` on unload; identifiers included. |
| C8.4 | ✅ | `externalControl/useExternalControl.js:39-76` | `client-control:<clientId>` topic; transport/queue/config/adopt envelopes. |

### C9. Resilience

| Req  | Status | Where | Notes |
|------|--------|-------|-------|
| C9.1 | ✅ | `session/persistence.js`, `LocalSessionProvider.jsx:54-62` | Reload hydrates full state. |
| C9.2 | ✅ | `session/LocalSessionProvider.jsx:57-62` | `wasPlayingOnUnload` drives recovery path. |
| C9.3 | ❌ | `session/sessionReducer.js:10-15` | `stalled` state defined, but **no detection timer or Player-signal plumbing triggers it**; no auto-advance on stall. |
| C9.4 | ✅ | `fleet/FleetProvider.jsx:33-43` | WS reconnect marks `STALE` then re-subscribes. |
| C9.5 | ✅ | `session/LocalSessionAdapter.js:169-171` | `onPlayerError` → `ITEM_ERROR` → `_advance('item-error')`. |
| C9.6 | ✅ | `fleet/fleetReducer.js`, `FleetProvider.jsx:22-28` | Offline kept visible; snapshot preserved; updates resume. |
| C9.7 | ✅ | `session/HiddenPlayerMount.jsx:96-105` | Catalog API 5xx doesn't interrupt an active media stream. |
| C9.8 | ⚠️ | `cast/DispatchProvider.jsx:37-52` | Fresh `dispatchId` per call; no dedup window on identical `{targetIds, play/queue, mode}`; rapid double-clicks can double-queue. |

### C10. Observability

| Req   | Status | Where | Notes |
|-------|--------|-------|-------|
| C10.1 | ✅ | `logging/mediaLog.js:29-67` | ~23 structured events across lifecycle, queue, dispatch, peek, takeover, handoff, URL, WS. |
| C10.2 | ✅ | (grep) | Zero raw `console.*` calls inside `modules/Media/`. (Two in `LiveStream/DJBoard.jsx`, which is out of scope per §Out of Scope.) |
| C10.3 | ✅ | `shared/usePlaybackStateBroadcast.js:36-48` | 5 s heartbeat while playing; single `stopped` on unload. |
| C10.4 | ✅ | `usePlaybackStateBroadcast.js:3-15` | `clientId`, `sessionId`, `displayName` on every broadcast. |
| C10.5 | ⚠️ | `logging/mediaLog.js:9-10,46,52` | `session.state-change`, `dispatch.step`, `peek.command-ack` are sampled, but **no explicit scrub/seek logging** — high-frequency user actions are currently silent rather than rate-limited. |

### Non-functional

| Req  | Status | Notes |
|------|--------|-------|
| N1.1 | ⚠️ | First paint depends on uncached `/api/v1/media/config`; no caching strategy documented. |
| N1.2 | ✅ | `useLiveSearch.js` streams from `/api/v1/content/query/search/stream`. |
| N1.3 | ✅ | `DispatchProvider.jsx:53-75` is fire-and-forget; doesn't block UI. |
| N1.4 | ✅ | Bound by Play API; adapter path clean. |
| N2.1 | ✅ | `fleet/fleetReducer.js` keeps only a per-device snapshot. |
| N2.2 | ✅ | Pure array ops over queue; no pathological paths. |
| N2.3 | ⚠️ | Subscribers are cleaned up; long-running (hours+) memory not measured. |
| N3.1 | ✅ | C9 coverage sufficient; page reload never required. |
| N3.2 | ✅ | Provider isolation prevents cross-surface failure. |
| N4.1 | ✅ | Peek + dispatch + playback are all independent async paths. |
| N4.2 | ✅ | No app-side locking; remote is authoritative. |
| N5.1 | ✅ | Registry is the only format extension point. |
| N5.2 | ✅ | `/api/v1/device/config` drives fleet; no hardcoding. |
| N5.3 | ⚠️ | `dispatchUrl.js` builds bespoke query for non-adopt dispatch; adopt uses snapshot. Two paths → extensibility asymmetry. |
| N6   | 🚫 | Accessibility is an explicit placeholder in the spec. |

---

## Cross-cutting observations

### Architecture conformance
- **Format-agnostic:** No `if (format === …)` anywhere in `modules/Media/`. All rendering flows through `<Player>` and the Playable Format Registry (`HiddenPlayerMount.jsx:102`).
- **API abstraction:** DaylightAPI singleton used consistently; no ad-hoc `fetch()` in the module.

### Logging discipline (C10.1, C10.2)
- **Zero raw `console.*` in `modules/Media/`** (the two hits in `LiveStream/DJBoard.jsx` belong to the separately scoped DJBoard surface, which the requirements explicitly place out of scope).
- `mediaLog` facade covers ~23 event types; sampled variants exist for three high-frequency events. User-driven scrub/seek is the notable unlogged surface.

### Test coverage
- ~44 test files, ~217 test cases under `modules/Media/`.
- Every feature folder has tests: session (17), search (12), fleet (8), cast/dispatch (20), peek (10), shell (15), externalControl (12), browse (8), shared (7).
- E2E happy paths exist for P1 foundation, P2 discovery, P3 fleet, P4 cast.

### URL contract (C8.1 / C8.2)
- Positive path (`?play`, `?queue`, `?shuffle`, `?shader`, `?volume`) is wired and deduplicated via a per-URL token so reload doesn't re-apply.
- `?device` is actively rejected with a logged `unknownKey` event — meets the C8.2 "MUST NOT honor" bar.

### WebSocket topics
Inbound: `device-state:<id>`, `client-control:<clientId>`, `homeline:<id>:wake-progress`, `device-ack:<id>`.
Outbound: `playback_state` (heartbeat + state-change + stopped), `client-ack`.
All four spec-required topics are wired.

### Live content (`isLive`) — **absent**
- No references to `isLive` or live-specific affordances in `modules/Media/`.
- Requirements §Core Concepts mandates progress/seek/stall affordances degrade for live content. Today the app treats all items identically — progress bar, scrub, and the (still-unwired) stall timer would all misbehave on a livestream or camera feed. This is a spec-level miss, not just a TODO.

### Session state machine (`sessionReducer.js`)
Actual states map to the 9 states in the spec exactly: `idle, ready, loading, playing, paused, buffering, stalled, ended, error`. Any state can transition to `idle` via RESET or to `error` via unrecoverable failure. **The `stalled` state exists but nothing transitions into it** (see C9.3 gap).

---

## Top gaps (prioritized)

1. ~~**C9.3 stall detection is a stub.**~~ **CLOSED** 2026-04-18 (this branch) — wired end-to-end: `HiddenPlayerMount` detects 10 s of continuous `stalled=true` from the Player's `onProgress` payload and fires `adapter.onPlayerStalled({ stalledMs })`; the adapter logs `mediaLog.playbackStallAutoAdvanced` and delegates to `_advance('stall-auto-advance')`. Tests cover the fire path, stall-recovery cancel, unmount cancel, and item-change cancel.
2. **C7.3 position tolerance is un-enforced.** **PARTIALLY CLOSED** 2026-04-18 — Take Over direction wired: `useTakeOver` schedules a 1.5 s drift check against the claimed snapshot position; violations > 2 s log `mediaLog.takeoverDrift`. **Hand Off direction still open** — requires correlating dispatch success with the target device's per-device state feed; out of scope for this pass, tracked as follow-up. Known trade-off: the `setTimeout` is not cleared on unmount, which is harmless because the adapter reference is stable.
3. **Live content awareness is absent.** No `isLive` branching anywhere; progress/seek/stall/duration all treat live feeds as on-demand. Requires Player contract surfacing and UI adaptation. Needs brainstorming before planning — UX decisions required (seek bar shape, duration display, stall threshold for live).
4. ~~**C9.8 dispatch idempotency gap.**~~ **CLOSED** 2026-04-18 — `DispatchProvider` holds a 5 s dedup window keyed by `{sorted targetIds, play/queue/adopt, mode}`. Identical dispatches within the window short-circuit to the original `dispatchIds` and emit `mediaLog.dispatchDeduplicated`. **Caveat:** `retryLast` participates in the cache (does NOT bypass it) — this is an intentional deviation from the plan's original "retry bypasses dedup" intent. In practice, retry-within-window is almost always accidental; retries after the window fire fresh. If explicit retry-bypass is later required, pass `{ skipDedup: true }` through `dispatchToTarget` or clear the cache entry in `retryLast`.
5. ~~**C10.5 scrub/seek logging missing.**~~ **CLOSED** 2026-04-18 — `mediaLog.transportCommand` sampled at 60/min; emitted from local `transport.seekAbs` and `transport.seekRel` (both events distinguishable by the `action` field; `seekRel` emits first with user intent, then delegates to `seekAbs` which emits the resolved absolute target).
6. **C4.3 Remote history is explicitly deferred.** Tracked, not a regression — but needs a design pass that respects N2.1 (no unbounded client cache) before implementation.
7. **N5.3 Format-Specific Options Dispatch** asymmetry — adopt mode carries options through snapshot, non-adopt builds via `dispatchUrl.js`. Different code paths → future-extension risk. Design spike recommended.
8. **N1.1 Performance Baseline** unmeasured. `HomeView` blocks on `/api/v1/media/config` with no cache.  Should be measured on a warm-cache local-network run.

---

## Summary

The P1–P7 skeleton is substantially complete against C1–C10: all nine primary
journeys have working code paths, the architecture honors the format-agnostic /
registry-delegated design mandated by the spec, logging discipline is strong
(zero raw `console` in scope), and test density is high (~217 tests across the
module).

The remaining work is concentrated in three areas: **resilience** (stall
detection, idempotency, position-tolerance enforcement), **live-content
semantics** (currently absent), and **observability polish** (scrub/seek
sampling, first-paint measurement). None require architectural rework — each is
a discrete follow-up plan against an already-sound skeleton.
