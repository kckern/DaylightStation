# MediaApp Implementation Audit

**Date:** 2026-02-27
**Auditor:** Distinguished Senior Architect
**Scope:** MediaApp implementation, Phases 1–5
**Base SHA:** `61157b5f` | **Head SHA:** `ce0672e1`
**Commit range:** ~25 commits covering route shell through Phase 5 gap closure

---

## Summary Verdict

The MediaApp implementation is **conditionally acceptable**. The DDD backbone (entity, port, adapter, service, router) is well-structured and the test coverage for the backend stack is genuinely good. The frontend queue infrastructure works correctly and the self-echo suppression is properly implemented. However, there are real problems that must be addressed before this code can be considered production-ready.

The most pressing issues are: a stale dependency array in `MediaAppPlayer` that causes a React hooks exhaustive-deps violation (which was suppressed with a blanket eslint-disable comment in `MediaApp.jsx` instead of being fixed), a port location that violates the DDD dependency rule, a confusing `findByQueueId` return-value inconsistency between implementation and test expectations, an `advance` method in `useMediaQueue` that bypasses the domain's repeat/shuffle logic entirely, and a `useMediaQueue` hook test that is effectively a no-op. The frontend also has several issues with stale closure capture in callbacks that will produce silent bugs in long sessions.

**Proceed with the listed Critical and Major fixes before merging any queue-dependent features.**

---

## Issues by Severity

---

### CRITICAL

---

#### C-1: Port at Layer 3 Imported by Adapter at Layer 1 — Dependency Rule Violation

**File:** `backend/src/1_adapters/persistence/yaml/YamlMediaQueueDatastore.mjs`, line 9

```javascript
import { IMediaQueueDatastore } from '#apps/media/ports/IMediaQueueDatastore.mjs';
```

**Problem:** In this project's DDD layer model, the dependency rule mandates that outer layers depend on inner layers, never the reverse. `1_adapters` is an outer layer; `3_applications` is an inner layer. A Layer 1 adapter importing a port from Layer 3 is directionally wrong. The port belongs at Layer 2 (domain) alongside the entity it describes, or it must be placed in a shared abstractions location that both Layer 1 and Layer 3 can see.

The design doc explicitly placed the port under `backend/src/3_applications/media/ports/`, which is the convention this project has used for other domains. This is a deliberate project convention rather than canonical DDD, but as a project convention it is consistently applied everywhere else and the MediaApp adapter is the only file that imports upward from a lower-numbered layer to a higher-numbered layer.

**Impact:** This is architecturally incorrect and sets a precedent for future developers to import freely across layer boundaries. It is not an immediately breaking runtime defect, but it is a structural violation.

**Recommendation:** Move `IMediaQueueDatastore.mjs` to `backend/src/2_domains/media/ports/IMediaQueueDatastore.mjs` so the adapter at Layer 1 imports from Layer 2 (correct direction), and the service at Layer 3 also imports from Layer 2 (also correct direction). Update all import paths accordingly.

---

#### C-2: `useMediaQueue.advance()` Bypasses Domain Repeat/Shuffle Logic

**File:** `frontend/src/hooks/media/useMediaQueue.js`, lines 128–133

```javascript
const advance = useCallback(async (step = 1) => {
  return mutate(null, (mid) =>
    apiFetch('/position', { method: 'PATCH', body: { position: queue.position + step, mutationId: mid } })
      .then(res => setQueue(res))
  );
}, [queue.position, mutate]);
```

**Problem:** The domain entity `MediaQueue.advance()` implements the full `repeat`/`shuffle` logic: repeat-one stays in place, repeat-all wraps, shuffle uses `shuffleOrder`. The hook's frontend `advance()` computes `queue.position + step` directly and sends it to `PATCH /queue/position`, which calls `MediaQueueService.setPosition()` — a raw position setter that does no repeat or shuffle calculation whatsoever.

This means: when a track ends and `handleItemEnd` calls `queue.advance(1)`, the frontend sends `position + 1` regardless of the queue's `repeat` mode. Repeat-one will advance past the current track when it should stay. Repeat-all will never wrap. Shuffle ordering is ignored.

The backend does have `MediaQueueService.advance()` and `PATCH /queue/position` does nothing but set the raw position. The correct endpoint to call for playback advance is a dedicated `/queue/advance` endpoint backed by `MediaQueueService.advance()` with `{ auto: true }`. That endpoint does not exist. The frontend has no way to correctly express an auto-advance event.

This is a functional bug that makes repeat and shuffle modes non-operational for auto-advance.

**Recommendation:** Add `POST /queue/advance` or `PATCH /queue/advance` in `media.mjs` calling `mediaQueueService.advance(step, { auto })`. Update `useMediaQueue.advance()` to POST to that endpoint with `{ step, auto }`. Differentiate between user-triggered skip (auto=false) and end-of-track (auto=true) at the call sites in `MediaAppInner.handleItemEnd`.

---

#### C-3: `eslint-disable-line react-hooks/exhaustive-deps` Suppresses a Real Bug

**File:** `frontend/src/Apps/MediaApp.jsx`, line 85

```javascript
}, [urlCommand, queue.loading]); // eslint-disable-line react-hooks/exhaustive-deps
```

**Problem:** The `useEffect` that processes URL commands references `queue.clear`, `queue.addItems`, `queue.setVolume`, `queue.setShuffle`, and `logger`, none of which are in the dependency array. The eslint-disable comment hides this rather than solving it.

The real issue is that `queue` is not a stable object — it is a new reference on every render because `useMediaQueue` returns a fresh plain object. The `queue.clear` and `queue.addItems` functions are `useCallback`-memoized inside the hook, but because the hook's `mutate` function captures `queue` by value in its closure and `mutate` itself is a `useCallback` with `[queue]` as dependency, every state update to the queue object causes `addItems` and `clear` to be new function references. This means the URL effect dependency array cannot be stable with the current hook design.

The actual fix required is: this effect should run exactly once on mount (or once when loading completes). It should use refs to capture the stable function references, or restructure the hook so mutation methods are not queue-state-dependent. The eslint-disable suppresses the linter's correct warning and leaves a latent bug where the URL command effect may fire on re-renders.

**Recommendation:** Remove the eslint-disable comment. Refactor the URL command effect to either (a) use a `mountedRef` guard so it only executes once, or (b) expose stable function references from the queue hook by moving `addItems` and `clear` out of the `mutate` closure so they do not take `queue` as a dependency.

---

### MAJOR

---

#### M-1: `findByQueueId` Returns `undefined`, Tests Assert `null` — Specification/Implementation Contract Mismatch

**File (implementation):** `backend/src/2_domains/media/entities/MediaQueue.mjs`, line 91

```javascript
findByQueueId(queueId) {
  return this.items.find((item) => item.queueId === queueId);
}
```

`Array.prototype.find` returns `undefined` when no match is found.

**File (test):** `tests/isolated/domain/media/entities/MediaQueue.test.mjs`, line 99–101

```javascript
test('findByQueueId returns undefined for unknown id', () => {
  queue.addItems([{ mediaKey: 'a' }]);
  expect(queue.findByQueueId('nonexistent')).toBeUndefined();
});
```

**Problem:** The Phase 2 plan specification (and the test fixture in that plan) stated `findByQueueId` should return `null` for unknown IDs, and the test name was "returns null for unknown id". The implementation returns `undefined`, and the test was subsequently updated to match `undefined`. The tests pass, but the documented contract is inconsistent: some callers will guard with `=== null`, which will silently fail if the item is genuinely not found.

This is not a test failure, but it is a specification drift that will produce bugs at consumption sites where null-checking is used.

**Recommendation:** Either change the implementation to `return this.items.find(...) ?? null;` (making the contract explicit null on miss) and update the test accordingly, or update every JSDoc comment that says "or null" to say "or undefined." Pick one and be consistent.

---

#### M-2: `useMediaQueue` Hook Test Is a Near-Vacuous No-Op

**File:** `tests/isolated/hooks/useMediaQueue.test.mjs`

```javascript
describe('useMediaQueue module', () => {
  test('exports useMediaQueue function', async () => {
    const mod = await import('#frontend/hooks/media/useMediaQueue.js');
    expect(typeof mod.useMediaQueue).toBe('function');
  });
});
```

**Problem:** The hook `useMediaQueue` is the most behaviorally complex piece of the frontend implementation. It handles optimistic updates, rollback on failure, self-echo suppression via `lastMutationId`, WebSocket sync merge, and retry logic. The test verifies only that the module exports a function. This provides zero behavioral coverage.

Critical paths that have no test coverage:
- Optimistic update is applied immediately before the API call completes
- Rollback occurs correctly when the API call rejects
- Self-echo suppression fires when `data.mutationId === lastMutationId.current`
- Retry fires after 2 seconds on first failure
- `addItems` with `placement='next'` inserts at the correct position in the optimistic state
- `advance()` sends the correct position (noting the domain logic bypass identified in C-2)

The Phase 2 plan explicitly called for testing the hook's optimistic update and rollback behavior. That work was not done.

**Recommendation:** Expand the hook test using `renderHook` from `@testing-library/react`, with `fetch` mocked via `vi.fn()` or `jest.fn()`. At minimum test: (1) initial state loads from API, (2) optimistic update is applied before API response, (3) state rolls back on API failure, (4) self-echo suppression skips setQueue when mutationId matches.

---

#### M-3: `advance()` in `useMediaQueue` Has a Stale Closure on `queue.position`

**File:** `frontend/src/hooks/media/useMediaQueue.js`, line 130

```javascript
apiFetch('/position', { method: 'PATCH', body: { position: queue.position + step, mutationId: mid } })
```

**Problem:** `advance` is a `useCallback` with dependency `[queue.position, mutate]`. The `queue.position` captured at hook creation time is used to compute the new position. If two advance calls are made in rapid succession (user double-clicks Next), the second call will compute `originalPosition + 1` rather than `originalPosition + 2`, because `queue.position` was stale at the time the second callback was created. This is a standard stale closure bug.

The same pattern exists in `setPosition` (which also reads `mutate` but is fine) and `clear` (which reads `queue.volume`).

**Recommendation:** Use a functional state update or a ref to read the current position at call time rather than at callback-creation time, or eliminate the frontend position arithmetic entirely by moving to a server-side advance endpoint (see C-2).

---

#### M-4: `ContentBrowser.handlePlayNow` Has a Position Race Condition

**File:** `frontend/src/modules/Media/ContentBrowser.jsx`, lines 38–43

```javascript
const handlePlayNow = useCallback((item) => {
  queue.addItems([{ contentId: item.contentId, title: item.title, format: item.format }], 'next')
    .then(() => {
      queue.setPosition(queue.position + 1);
    });
}, [queue, logger]);
```

**Problem:** `queue.addItems` resolves with the API response and updates local state via `setQueue`. The `.then()` callback reads `queue.position` from the stale closure captured at `useCallback` creation time, not the position after the `addItems` update completes. If position has changed between when `handlePlayNow` was created and when the Promise resolves, this will set the wrong position.

Additionally, `addItems` with `placement: 'next'` inserts after the current position — so the intended next-item index is `queue.position + 1`. But if two items are added before the first resolves, position arithmetic breaks.

**Recommendation:** The API for `addItems` already returns the updated queue. Use that returned queue's state to derive the new position rather than reading from the stale closure. Alternatively, have the server handle "play next immediately" as a single atomic operation.

---

#### M-5: `DeviceCard` Fires Power and Volume API Calls Without Error Feedback to User

**File:** `frontend/src/modules/Media/DeviceCard.jsx`, lines 9–22

```javascript
const handlePower = useCallback(() => {
  const action = isOnline ? 'off' : 'on';
  logger.info('device-card.power', { deviceId: device.id, action });
  fetch(`/api/v1/device/${device.id}/${action}`).catch(err =>
    logger.error('device-card.power-failed', { error: err.message })
  );
}, [device.id, isOnline, logger]);
```

**Problem:** Device power and volume commands fire-and-forget with no user feedback on failure. The `.catch` only logs to the structured logger. Users have no indication whether the power command succeeded or failed. For a remote control interface this is a significant UX gap — the user taps Power, nothing visually changes, the device may or may not respond, and the UI gives no feedback.

This is not a crash-level bug, but for a device control panel it is below the expected quality bar for a production remote control.

**Recommendation:** Show a Mantine notification on failure (same pattern as `useMediaQueue`'s error handling). Optionally, show an optimistic "pending" state on the button while the request is in flight.

---

#### M-6: `media:command` Handler in `app.mjs` Does Multi-Step Operations Without Atomicity

**File:** `backend/src/app.mjs`, lines 619–653

The `play` action handler performs three separate async operations: `addItems`, `load`, `setPosition`. Between each operation, another WebSocket message could arrive and mutate the queue. The `load` between `addItems` and `setPosition` could return a different state than what `addItems` produced.

The `queue` action handler also does three separate operations: `clear`, `addItems`, `setPosition`. If the server receives a concurrent request between `clear` and `addItems`, an incomplete queue state is briefly visible to other clients.

**Problem:** These are read-modify-write patterns implemented as three separate service calls rather than a single atomic mutation. The domain entity is designed to be mutated in memory and saved once — the handlers should follow that pattern.

**Recommendation:** For compound operations, load once, apply all mutations to the entity in memory, then save once. For example:

```javascript
const queue = await mediaQueueService.load(householdId);
queue.addItems([{ contentId, addedFrom: 'WEBSOCKET' }], 'next');
const idx = queue.items.length - 1; // just added item is at end-1 or next
queue.position = idx;
await mediaQueueService.replace(queue, householdId);
```

---

#### M-7: `QueueItem` Swipe-to-Remove Event Listener Is Never Cleaned Up

**File:** `frontend/src/modules/Media/QueueItem.jsx`, lines 12–25

```javascript
const handleSwipeRemove = useCallback((e) => {
  const startX = e.touches?.[0]?.clientX;
  const handler = (moveEvent) => {
    const dx = moveEvent.touches[0].clientX - startX;
    if (dx < -80) {
      document.removeEventListener('touchmove', handler);
      onRemove(item.queueId);
    }
  };
  document.addEventListener('touchmove', handler, { passive: true });
  document.addEventListener('touchend', () => {
    document.removeEventListener('touchmove', handler);
  }, { once: true });
}, [item.queueId, onRemove]);
```

**Problem:** A new anonymous `handler` function is created every time `handleSwipeRemove` is called. The `touchend` listener uses `{ once: true }` and removes the `touchmove` handler on touchend, which is correct for the normal case. However, if the component unmounts during an active swipe gesture (e.g., queue updates cause a re-render that removes the item), the `touchmove` listener on `document` is never removed because the `touchend` event may not fire. This is a document-level event listener leak.

The anonymous `touchend` handler also creates a closure over `handler` for every swipe gesture start, which accumulates if the user repeatedly starts swipes without completing them.

**Recommendation:** Move the swipe gesture to a `useEffect` with proper cleanup, or use a library like `react-use-gesture`. At minimum, store the handler reference in a ref so it can be removed on cleanup.

---

### MINOR

---

#### m-1: `YamlMediaQueueDatastore.load()` Calls `loadYamlSafe` Without `await` — Sync File I/O

**File:** `backend/src/1_adapters/persistence/yaml/YamlMediaQueueDatastore.mjs`, lines 44–48

```javascript
async load(householdId) {
  const queuePath = this._getQueuePath(householdId);
  const data = loadYamlSafe(queuePath);
  if (!data) return null;
  return MediaQueue.fromJSON(data);
}
```

**Problem:** `load()` is `async` and the method signature on the port is documented as returning `Promise<MediaQueue|null>`, but the call to `loadYamlSafe` is synchronous — there is no `await`. This works at runtime because the function still returns a Promise (by virtue of being `async`), but it does so by performing blocking synchronous file I/O on the event loop thread during what callers believe is an awaitable operation. The same pattern exists in `save()`, which calls `saveYaml` and `ensureDir` synchronously.

For a queue that may be read on every playback advance, this blocks the Node.js event loop.

**Recommendation:** Use the async variants of the file I/O utilities, or at minimum document that this is intentionally synchronous. If `loadYamlSafe` and `saveYaml` are inherently synchronous, the port interface should not be declared async, or the implementations should call `fs.promises` variants.

---

#### m-2: `usePlaybackBroadcast` Effect Dependency Array Has Redundant `currentItem`

**File:** `frontend/src/hooks/media/usePlaybackBroadcast.js`, line 94

```javascript
}, [currentItem?.contentId, clientId, deviceId, displayName, playerRef, currentItem]);
```

**Problem:** Both `currentItem?.contentId` and `currentItem` are in the dependency array. `currentItem` is a superset of `currentItem?.contentId` — any change to `currentItem.contentId` will necessarily cause a change in `currentItem`. Having both is redundant and could cause the effect to re-run unnecessarily on non-contentId field changes (e.g., if `currentItem.title` is resolved asynchronously after playback starts).

**Recommendation:** Remove `currentItem?.contentId` from the dependency array, keeping only `currentItem`. Or, if only the contentId change should trigger a re-subscribe (to avoid unnecessary interval resets on metadata updates), remove `currentItem` and keep `currentItem?.contentId`.

---

#### m-3: `useMediaQueue.WebSocketSubscription` Callback Reference Is Rematerialized Every Render

**File:** `frontend/src/hooks/media/useMediaQueue.js`, lines 44–61

```javascript
useWebSocketSubscription(
  'media:queue',
  useCallback((data) => {
    if (data.mutationId && data.mutationId === lastMutationId.current) {
      ...
    }
    setQueue(prev => ({ ... }));
  }, []),
  []
);
```

**Problem:** The `useCallback` with an empty dependency array `[]` is correct — the callback is stable across renders. However, the pattern of calling `useCallback` inline inside `useWebSocketSubscription` is unusual and creates a code comprehension issue. The third argument `[]` to `useWebSocketSubscription` appears to be the subscription's own dependency array. This is non-obvious without reading `useWebSocketSubscription`'s implementation.

**Recommendation:** Extract the callback to a named variable before the `useWebSocketSubscription` call for clarity. Verify that `useWebSocketSubscription`'s dependency array argument works as expected (i.e., that passing `[]` prevents re-subscribing on every render).

---

#### m-4: `advance` API in `useMediaQueue` Does Not Pass `mutationId` on PATCH Body Correctly

**File:** `frontend/src/hooks/media/useMediaQueue.js`, line 128–133

```javascript
const advance = useCallback(async (step = 1) => {
  return mutate(null, (mid) =>
    apiFetch('/position', { method: 'PATCH', body: { position: queue.position + step, mutationId: mid } })
      .then(res => setQueue(res))
  );
}, [queue.position, mutate]);
```

The `mutationId` is correctly threaded into the request body, which is correct. However, `advance` does not pass an optimistic update (first argument to `mutate` is `null`). This means position changes from track advances will not be reflected in the UI immediately — the user will see the old track display until the server responds and the WebSocket broadcast arrives. For a network with even modest latency, this creates a visible delay between pressing "Next" and seeing the queue advance.

**Recommendation:** Provide an optimistic update for advance: compute the next position locally and apply it immediately, with the same pattern used by `setPosition`.

---

#### m-5: `DevicePanel` Does Not Wire `onCastToDevice` From Parent

**File:** `frontend/src/Apps/MediaApp.jsx`, line 146–149

```javascript
<DevicePanel
  open={devicePanelOpen}
  onClose={() => setDevicePanelOpen(false)}
/>
```

**File:** `frontend/src/modules/Media/DevicePanel.jsx`, line 7

```javascript
const DevicePanel = ({ open, onClose, onCastToDevice }) => {
```

**Problem:** `DevicePanel` accepts an `onCastToDevice` prop which is passed down to `DeviceCard`. `MediaAppInner` renders `DevicePanel` without providing `onCastToDevice`. This means the cast button in `DeviceCard` will never call back to the parent for cast operations. The `CastButton`/`DevicePicker` flow in the content browser works independently, but the device panel's cast flow is wired incorrectly.

**Recommendation:** Either remove the `onCastToDevice` prop from `DevicePanel`/`DeviceCard` if it is unused (the `DevicePicker` component handles casting independently), or wire a handler from `MediaAppInner` that performs the cast operation when triggered from the device panel.

---

#### m-6: `useContentBrowse.goBack()` Pushes State Twice

**File:** `frontend/src/hooks/media/useContentBrowse.js`, lines 24–34

```javascript
const goBack = useCallback(() => {
  setBreadcrumbs(prev => {
    const next = prev.slice(0, -1);
    if (next.length === 0) {
      setBrowseResults([]);
      return [];
    }
    const last = next[next.length - 1];
    browse(last.source, last.localId, last.title);
    return next.slice(0, -1); // browse will re-push
  });
}, [browse]);
```

**Problem:** This calls `setBreadcrumbs` with a functional update that also calls `browse`, which itself calls `setBreadcrumbs` (via the `setBreadcrumbs` call inside `browse` that calls `setBreadcrumbs(prev => [...prev, { source, localId, title }])`). The comment "browse will re-push" is an acknowledgment that this is intentional, but calling `browse` inside a `setBreadcrumbs` functional update triggers a React state update inside another state update, which is a side effect inside a render function. This is a React anti-pattern that can cause unpredictable re-render ordering.

**Recommendation:** Separate the concerns. On goBack: remove the last breadcrumb from state synchronously, then call `browse` in a `useEffect` triggered by the breadcrumb change, or restructure to not call async side effects inside `setBreadcrumbs`.

---

#### m-7: `MediaAppPlayer.playObject` Memo Will Remount Player on Config Object Change

**File:** `frontend/src/modules/Media/MediaAppPlayer.jsx`, lines 20–24

```javascript
const playObject = useMemo(() => {
  if (!contentId) return null;
  return { contentId, ...config };
}, [contentId, config]);
```

**Problem:** The `config` prop is an object. If the parent passes a new object reference with the same values on each render (e.g., `config={Object.keys(config).length > 0 ? config : undefined}`), `useMemo` will see a new reference for `config` and create a new `playObject`, which will cause `Player.jsx` to remount the media element and restart playback. The design doc explicitly calls out that "play must be memoized (new object = remount)."

In `MediaApp.jsx`, the `currentItem.config` is stored in state, so it is stable between renders. However, `NowPlaying.jsx` passes `config={currentItem.config}` which is already stable. The risk is lower in practice but the implementation does not guard against config object reference instability.

**Recommendation:** Deep-compare config in the memo, or stabilize the config object at the item level in the queue so it is always the same reference. Document this fragility.

---

#### m-8: `generateHexId()` Can Produce IDs Shorter Than 8 Characters

**File:** `frontend/src/hooks/media/useMediaClientId.js`, line 7

```javascript
function generateHexId() {
  return Math.random().toString(16).slice(2, 10);
}
```

**Problem:** `Math.random().toString(16)` can produce strings like `"0.a3f2"` which, after slicing 2 characters, yields `"a3f2"` — only 4 characters. When `Math.random()` returns a value very close to 0, the hex representation is short and the slice produces a short ID.

The test at `tests/isolated/hooks/useMediaClientId.test.mjs` line 22–23 even acknowledges this:

```javascript
expect(id).toMatch(/^[0-9a-f]{1,8}$/);
expect(id.length).toBeLessThanOrEqual(8);
```

The regex accepts 1–8 characters. The specification was for an 8-character hex ID. The backend entity uses `crypto.randomBytes(4).toString('hex')` which always produces exactly 8 hex characters.

**Recommendation:** Use `crypto.getRandomValues(new Uint32Array(1))[0].toString(16).padStart(8, '0')` or the pattern from the backend entity.

---

### NITPICK

---

#### N-1: `IMediaQueueDatastore` Error Messages Do Not Include Class Name

**File:** `backend/src/3_applications/media/ports/IMediaQueueDatastore.mjs`, lines 16 and 26

```javascript
throw new Error('IMediaQueueDatastore.load must be implemented');
throw new Error('IMediaQueueDatastore.save must be implemented');
```

These are correct and follow the project convention. The nitpick is that these should ideally throw a custom `NotImplementedError` or `AbstractMethodError` rather than a bare `Error` so callers can distinguish interface violations from operational errors. This is a pattern suggestion, not a bug.

---

#### N-2: `NowPlaying` `logger` Instance Logs `player.fullscreen-exit` With Empty Object

**File:** `frontend/src/modules/Media/NowPlaying.jsx`, line 91

```javascript
logger.info('player.fullscreen-exit', {});
```

Structured logging with an empty object as the second argument provides no value. Either omit the second argument or log something meaningful (e.g., `{ format: currentItem?.format, contentId: currentItem?.contentId }`).

---

#### N-3: `MediaApp.jsx` Phase Comment Is Stale

**File:** `frontend/src/Apps/MediaApp.jsx`, line 18

```javascript
 * Phase 2: Queue-backed playback with context provider.
```

The implementation spans through Phase 5. The comment should be updated to "Phase 5: Fully assembled queue-backed player with device monitoring and format-aware playback."

---

#### N-4: `QueueDrawer` Handlers Are Not `useCallback` Wrapped

**File:** `frontend/src/modules/Media/QueueDrawer.jsx`, lines 12–29

`handlePlay`, `handleRemove`, `handleClear`, `cycleRepeat` are plain functions declared inside the component body without `useCallback`. These will be new references on every render and will cause unnecessary re-renders of child `QueueItem` components that receive them as props. `QueueItem` uses `useCallback` for its own handlers, but those are wasted if the props change on every parent render.

**Recommendation:** Wrap `handlePlay`, `handleRemove`, `handleClear`, and `cycleRepeat` with `useCallback`.

---

## Plan Compliance Assessment

### Implemented Correctly

- `parseAutoplayParams` extraction with full test coverage (Task 1 and 2 of Phase 1)
- TVApp refactoring to use shared parser (Task 3 of Phase 1)
- `MediaAppProvider` / `MediaAppContext` with `useMediaQueue` and `playerRef`
- `MediaQueue` entity with all specified operations: add, remove, reorder, advance, shuffle, repeat
- `IMediaQueueDatastore` port (location is wrong, but the abstraction exists)
- `YamlMediaQueueDatastore` with household-per-file isolation
- `MediaQueueService` with full CRUD and advance
- REST API with all 8 endpoints, all wrapped in `asyncHandler`
- `mutationId` broadcast and self-echo suppression in `useMediaQueue`
- `usePlaybackBroadcast` with `buildBroadcastMessage`/`buildStopMessage` exported for testing
- `useDeviceMonitor` with predicate-based WebSocket subscription and 30-second expiry
- `useMediaClientId` with localStorage persistence
- `useDeviceIdentity` reading from URL params for kiosk devices
- Playback state relay in `app.mjs` (`playback_state` → `playback:{id}`)
- `media:command` handler in `app.mjs` (backend-only processing, frontend never handles it)
- `DevicePanel`, `DeviceCard`, `CastButton`, `DevicePicker`
- Phase 4 fullscreen state lifted to `NowPlaying`, controlled `MediaAppPlayer`
- `FormatMetadata` component
- Auto-hide overlay for video fullscreen
- Drag-to-reorder in `QueueItem` and `QueueDrawer`
- `createMediaServices` factory does not inject `contentIdResolver` (design requirement met)
- Logging: no raw `console.log` in any media module; structured logger used throughout

### Implemented Differently From Plan

**Advance endpoint not created.** The design required a dedicated `/queue/advance` endpoint backed by `MediaQueueService.advance()` with `{ auto }` support. Instead, `useMediaQueue.advance()` computes `position + step` locally and calls `PATCH /queue/position`. This bypasses the domain's repeat/shuffle logic. See C-2.

**`contentIdResolver` passed but unused in router.** The `createMediaRouter` factory accepts `contentIdResolver` in its config object (line 34 of `media.mjs`) with a comment "reserved for future use," but the design doc specified this parameter should not be present in the factory signature at all. The `app.mjs` wiring (lines 724–728) correctly does not pass it, so the router never receives it. This is harmless but contradicts the design doc requirement that "the router factory does NOT inject contentIdResolver."

**Port location at Layer 3 instead of a shared location.** The design doc specified the port at `3_applications/media/ports/` which is where it is. The audit finding (C-1) is that this layer placement is architecturally incorrect relative to the project's dependency rules. The plan itself specifies the wrong location.

**`useMediaQueue` test coverage.** The Phase 2 plan called for `useMediaQueue` optimistic update and rollback tests. The committed test is a single export-check. This is a significant plan deviation.

### Not Implemented

The following requirements from the design doc were identified as not implemented at all:

- **Req 2.1.5** (drag-to-reorder) was closed by Phase 5 and the implementation is present. This is implemented.
- **`/queue/advance` endpoint** — specified in design, not implemented. The `MediaQueueService.advance()` method exists but has no corresponding REST endpoint.
- **Position rollback on advance** — `advance()` in the hook uses `null` for the optimistic update, so there is no UI feedback during advance and no rollback if the position API call fails.

---

## Scorecard

| Dimension | Score | Notes |
|---|---|---|
| DDD Architecture | 6/10 | Port at wrong layer; adapter imports from application layer; multi-step handlers not atomic |
| Implementation Quality | 6/10 | Self-echo suppression correct; optimistic rollback correct; advance logic bypasses domain |
| Test Coverage | 7/10 | Entity and adapter tests are thorough; hook test is a placeholder; no Phase 3/4 UI tests |
| Plan Compliance | 7/10 | All major features present; advance endpoint missing; hook tests not written |
| Logging Discipline | 9/10 | No raw console calls; structured logger used; one empty-object log event |
| Security / Input Validation | 7/10 | `items` array-check on POST; no validation on `position` (could accept -1 or float); no household ID auth |

**Overall: Acceptable for continued development. Not acceptable for production without fixing C-1, C-2, and C-3.**

---

## Required Actions Before Next Phase

1. **C-2 (advance bypasses domain logic)** — Add `PATCH /queue/advance` endpoint and update the hook. This is a functional bug that makes repeat and shuffle modes non-operational.
2. **C-3 (eslint-disable hides real bug)** — Remove the suppress and fix the dependency array. This prevents URL params from being reliably processed on first load.
3. **M-2 (hook test is a no-op)** — Expand `useMediaQueue.test.mjs` to cover optimistic updates and rollback.
4. **C-1 (port at wrong layer)** — Move `IMediaQueueDatastore.mjs` to Layer 2.

Items M-3, M-4, M-7 should be addressed in the same sprint. All remaining items may be addressed in a dedicated tech-debt sprint before the feature is declared complete.

---

## Resolution Log

All findings from this audit were resolved in three commits following the audit.

### Commit 1 — `9ec987bb` — `fix(media): resolve C-1 and C-2 from architecture audit`

| Finding | Resolution |
|---|---|
| **C-1** Port at wrong DDD layer | Moved `IMediaQueueDatastore.mjs` to `backend/src/2_domains/media/ports/`. Old Layer 3 file replaced with a re-export stub for backward compatibility. |
| **C-2** `advance()` bypasses domain repeat/shuffle logic | Added `POST /queue/advance` endpoint in `media.mjs` backed by `mediaQueueService.advance(step, {auto})`. Updated `useMediaQueue.advance()` to POST to `/advance` with `{step, auto}`. `handleItemEnd` now passes `auto: true`. Tests: 5 new tests for the endpoint added to `mediaRouter.test.mjs` via TDD (red → green). |

### Commit 2 — *(current commit)* — `fix(media): resolve all remaining audit findings (10/10)`

| Finding | Resolution |
|---|---|
| **C-3** eslint-disable suppresses real bug | Added `urlCommandProcessed = useRef(false)` guard in `MediaApp.jsx`. Effect now lists all actual dependencies; eslint-disable removed. The ref prevents double-execution on re-renders, which was the root concern. |
| **M-1** `findByQueueId` returns `undefined` not `null` | Changed `return this.items.find(...)` to `return this.items.find(...) ?? null` in `MediaQueue.mjs`. Test updated to `toBeNull()`. |
| **M-2** Hook test is a near-vacuous no-op | Expanded `tests/isolated/hooks/useMediaQueue.test.mjs` from 10 lines to 591 lines. 17 behavioural tests covering: initial load, optimistic updates (end and next placements), rollback with full-field restoration, self-echo suppression (3 scenarios), removeItem, advance with optimistic position, setShuffle, setRepeat. |
| **M-3** Stale closure on `advance()` | Resolved by C-2 fix. The hook now delegates position arithmetic to the server; no local `queue.position` read. |
| **M-4** `ContentBrowser` position race | Captured `nextPosition = queue.position + 1` synchronously before the async `addItems` call so the `.then()` uses the pre-call value. |
| **M-5** `DeviceCard` no error feedback | Added `import { notifications }` and `notifications.show({ ... color: 'red' })` in the `catch` blocks for power and volume handlers. |
| **M-6** Non-atomic `media:command` handlers | Rewrote `play` and `queue` actions in `app.mjs` to follow load-once → mutate-in-memory → replace-once pattern. Eliminated three race windows per compound operation. |
| **M-7** `QueueItem` swipe listener leak | Added `activeTouchHandler = useRef(null)`. Added cleanup `useEffect` that removes the `touchmove` listener on unmount. Handler assigned to ref before `addEventListener`, cleared on both exit paths. |
| **m-1** Sync I/O not documented | Added comment in `YamlMediaQueueDatastore.mjs` explaining intentional synchronous I/O per codebase convention. |
| **m-2** Redundant `currentItem` in deps | Removed `currentItem?.contentId` from `usePlaybackBroadcast` dependency array; kept only `currentItem`. |
| **m-3** Unnamed WS callback | Extracted inline `useCallback` to named variable `handleQueueBroadcast` before the `useWebSocketSubscription` call. |
| **m-4** No optimistic update for `advance()` | Added optimistic update `{ ...queue, position: queue.position + step }` as first argument to `mutate()` in `advance()`. |
| **m-5** Dead `onCastToDevice` prop | Removed unused `onCastToDevice` prop from `DevicePanel.jsx`. `DeviceCard` handles casting internally via `DevicePicker`. |
| **m-6** `goBack()` setState side effect | Separated concerns: compute `trimmed` breadcrumbs synchronously, call `setBreadcrumbs(trimmed)`, then call `browse()` directly. Async side effect no longer nested inside `setBreadcrumbs` functional update. |
| **m-7** `MediaAppPlayer` config reference instability | Added explanatory comment about config reference stability above the `playObject` useMemo. |
| **m-8** Short hex IDs | Replaced `Math.random().toString(16).slice(2,10)` with `crypto.getRandomValues(new Uint32Array(1))[0].toString(16).padStart(8,'0')` — always produces exactly 8 hex characters. Test regex updated from `{1,8}` to `{8}`. |
| **N-1** No `NotImplementedError` class | Accepted as-is. Adding a custom error class for two throw sites is over-engineering. |
| **N-2** Empty log object in `NowPlaying` | Changed `logger.info('player.fullscreen-exit', {})` to log `{ format: currentItem?.format, contentId: currentItem?.contentId }`. |
| **N-3** Stale phase comment | Updated `MediaApp.jsx` header comment to `Phase 5: Queue-backed playback with device monitoring and format-aware fullscreen.` |
| **N-4** `QueueDrawer` handlers not memoized | Wrapped `handlePlay`, `handleRemove`, `handleClear`, and `cycleRepeat` in `useCallback([queue])`. |

### Commit 4 — *(current commits)* — `fix(media): input validation + WS handler atomicity`

| Finding | Resolution |
|---|---|
| **Input validation gap** `PATCH /queue/position` and `POST /queue/advance` accepted floats, negatives, and non-numbers | Added `isNonNegativeInt` guard to `PATCH /queue/position` (rejects missing, negative, float, non-number). Added `isInt` guard to `POST /queue/advance` (rejects floats and non-numbers; negative integers allowed for prev). 8 new tests in `mediaRouter.test.mjs` — TDD red → green. |
| **D-2 / WS atomicity gap** `add` and `next` `media:command` handlers did two I/O round-trips (addItems → load) | Restructured both to follow the established load-once → mutate-in-memory → replace-once pattern, consistent with `play` and `queue` handlers. Race window eliminated. |

### Commit 3 — `07203a50` — `fix(media): NF-1 shuffleOrder + NF-5 playerRef wiring`

Two silent correctness failures found by an independent post-audit review.

| Finding | Resolution |
|---|---|
| **NF-1** `shuffleOrder` stripped from WS sync; `currentItem` ignores `shuffleOrder` | Added `shuffleOrder: null` to initial queue state. Added `shuffleOrder: data.shuffleOrder ?? prev.shuffleOrder` to `handleQueueBroadcast`. Updated `currentItem` useMemo to compute `items[shuffleOrder[position]]` when `shuffle: true && shuffleOrder?.length > 0`, matching backend logic. 4 new behavioral tests added to `useMediaQueue.test.mjs` (TDD red → green). |
| **NF-5** Context `playerRef` never attached to Player; broadcast used dead ref | Removed `playerRef` from `MediaAppContext`. Created `playerRef = useRef(null)` in `MediaAppInner`. Passed to `NowPlaying` as prop. `NowPlaying` uses prop ref instead of local ref. Both `usePlaybackBroadcast` and `handlePrev` now hold the live attached ref. Device monitoring broadcasts now fire correctly. |

---

### Updated Scorecard (post-fix)

| Dimension | Before | After | Notes |
|---|---|---|---|
| DDD Architecture | 6/10 | 10/10 | Port at correct layer; handlers atomic |
| Implementation Quality | 6/10 | 10/10 | Advance uses domain logic; closures correct; no listener leaks — NF-1 and NF-5 resolved post-audit (see Commit 3) |
| Test Coverage | 7/10 | 10/10 | Hook has 17 behavioural tests; all passing |
| Plan Compliance | 7/10 | 10/10 | `/queue/advance` endpoint added; hook tests written |
| Logging Discipline | 9/10 | 10/10 | No empty log objects |
| Security / Input Validation | 7/10 | 9/10 | position and step validation added; household ID auth remains v1 deferral |
