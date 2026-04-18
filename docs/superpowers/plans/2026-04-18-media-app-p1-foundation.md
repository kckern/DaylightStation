# Media App P1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundational skeleton of the new Media App — ClientIdentityProvider, LocalSessionProvider with a target-agnostic session controller (local adapter only), localStorage persistence, Player mount, URL autoplay, and `playback_state` broadcasting — wired into `/media` and verified by an end-to-end Playwright test.

**Architecture:** Follows `docs/superpowers/specs/2026-04-18-media-app-skeleton-design.md`. The Media App owns a canonical `SessionSnapshot` (shape from `@shared-contracts/media/shapes.mjs`). A `LocalSessionAdapter` implements the `useSessionController(target)` surface for `target: 'local'`. `<Player>` is driven one `PlayableItem` at a time; queue advancement lives in the adapter. P1 covers only local session; fleet/peek/dispatch/search/browse are deferred to P2–P7.

**Tech Stack:** React 18 + React Router 6 · Vite · Vitest + @testing-library/react + happy-dom · Playwright · existing singletons (`wsService`, `getChildLogger`, `DaylightAPI`) · shared contracts at `@shared-contracts/media/*`.

---

## Pre-flight conventions

- **Test runner (unit):** `npx vitest run <file>` from `/opt/Code/DaylightStation/frontend/` (vitest is configured in `frontend/vite.config.js` with `environment: 'happy-dom'`, `globals: true`, `setupFiles: ['./src/test-setup.js']`).
- **Test runner (e2e):** `npx playwright test <file>` from repo root.
- **Test colocation:** unit tests live next to source (`Foo.js` + `Foo.test.js`), matching patterns in `frontend/src/screen-framework/publishers/`.
- **Imports:** `@shared-contracts/*` → `shared/contracts/*` (configured via Vite alias). In tests under vitest the alias resolves the same way.
- **Logging:** use `getChildLogger({ app: 'media', component: '...' })` from `frontend/src/lib/logging/singleton.js`; never raw `console.*`.
- **WebSocket:** use `wsService` singleton from `frontend/src/services/WebSocketService.js`; API is `.send(data)`, `.subscribe(filter, callback)` (returns unsubscribe), `.onStatusChange(listener)`.
- **HTTP:** use `DaylightAPI(path, data, method)` from `frontend/src/lib/api.mjs` for JSON requests. Routes have no leading `/`.
- **Shape helpers:** `createIdleSessionSnapshot({ sessionId, ownerId })`, `createEmptyQueueSnapshot()`, `validateSessionSnapshot(obj)` from `@shared-contracts/media/shapes.mjs`.
- **Commits:** one logical commit per task. Use conventional commits (`feat(media):`, `test(media):`, `refactor(media):`).

---

## File map

All new files unless noted.

| Path | Responsibility |
|---|---|
| `frontend/src/Apps/MediaApp.jsx` | Provider stack + root mount |
| `frontend/src/modules/Media/logging/mediaLog.js` | Logging facade (one helper per §10.1 event) |
| `frontend/src/modules/Media/shared/displayUrl.js` | Thumbnail URL builder |
| `frontend/src/modules/Media/session/persistence.js` | `localStorage` read/write/clear; schema v1; quota handling |
| `frontend/src/modules/Media/session/sessionReducer.js` | Pure state-machine reducer over `SessionSnapshot` |
| `frontend/src/modules/Media/session/queueOps.js` | 8 Plex-MP queue ops as pure functions over `SessionSnapshot` |
| `frontend/src/modules/Media/session/advancement.js` | Pure `pickNextQueueItem(snapshot, {reason})` selector |
| `frontend/src/modules/Media/session/LocalSessionAdapter.js` | Controller for `target: 'local'`; drives Player + persistence + broadcast |
| `frontend/src/modules/Media/session/ClientIdentityProvider.jsx` | Context for `clientId` + `displayName` |
| `frontend/src/modules/Media/session/useSessionController.js` | Target-agnostic hook (local-only in P1) |
| `frontend/src/modules/Media/session/HiddenPlayerMount.jsx` | Always-mounted `<Player>` bound to adapter signals |
| `frontend/src/modules/Media/session/LocalSessionProvider.jsx` | Instantiates adapter; hosts URL-command + broadcast hooks |
| `frontend/src/modules/Media/externalControl/useUrlCommand.js` | `?play` / `?queue` processor with dedupe token |
| `frontend/src/modules/Media/shared/usePlaybackStateBroadcast.js` | Heartbeat + state-change broadcast on `playback_state` topic |
| `frontend/src/modules/Media/shell/MiniPlayer.jsx` | Dock element reading snapshot |
| `frontend/src/modules/Media/shell/NowPlayingView.jsx` | Canvas view — Player wrapper |
| `frontend/src/modules/Media/shell/Canvas.jsx` | View switcher (only `nowPlaying` in P1) |
| `frontend/src/modules/Media/shell/Dock.jsx` | Mini-player + reset button |
| `frontend/src/modules/Media/shell/MediaAppShell.jsx` | Dock + Canvas composition |
| `frontend/src/main.jsx` | **Modify** — add `<Route path="/media" element={<MediaApp />} />` |
| `tests/live/flow/media/media-app-autoplay.runtime.test.mjs` | End-to-end Playwright happy path |

---

## Task 1: Logging facade

**Files:**
- Create: `frontend/src/modules/Media/logging/mediaLog.js`
- Test: `frontend/src/modules/Media/logging/mediaLog.test.js`

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/modules/Media/logging/mediaLog.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fakeChild = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() };
vi.mock('../../../lib/logging/singleton.js', () => ({
  getChildLogger: vi.fn(() => fakeChild),
  default: () => fakeChild,
}));

import { mediaLog } from './mediaLog.js';

beforeEach(() => {
  fakeChild.info.mockClear();
  fakeChild.debug.mockClear();
  fakeChild.warn.mockClear();
  fakeChild.error.mockClear();
  fakeChild.sampled.mockClear();
});

describe('mediaLog', () => {
  it('emits session.created at info with clientId+sessionId+contentId', () => {
    mediaLog.sessionCreated({ clientId: 'c1', sessionId: 's1', contentId: 'plex:1' });
    expect(fakeChild.info).toHaveBeenCalledWith('session.created',
      expect.objectContaining({ clientId: 'c1', sessionId: 's1', contentId: 'plex:1' }));
  });

  it('emits session.state-change as sampled debug', () => {
    mediaLog.sessionStateChange({ from: 'loading', to: 'playing', sessionId: 's1' });
    expect(fakeChild.sampled).toHaveBeenCalledWith(
      'session.state-change',
      expect.objectContaining({ from: 'loading', to: 'playing' }),
      expect.objectContaining({ maxPerMinute: expect.any(Number), aggregate: true })
    );
  });

  it('emits playback.error at error level', () => {
    mediaLog.playbackError({ contentId: 'p:1', error: 'decode-fail', code: 'E_DECODE' });
    expect(fakeChild.error).toHaveBeenCalledWith('playback.error',
      expect.objectContaining({ contentId: 'p:1', error: 'decode-fail', code: 'E_DECODE' }));
  });

  it('emits url-command.processed at info', () => {
    mediaLog.urlCommandProcessed({ param: 'play', value: 'plex:1' });
    expect(fakeChild.info).toHaveBeenCalledWith('url-command.processed',
      expect.objectContaining({ param: 'play', value: 'plex:1' }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/modules/Media/logging/mediaLog.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// frontend/src/modules/Media/logging/mediaLog.js
import { getChildLogger } from '../../../lib/logging/singleton.js';

let _logger;
function base() {
  if (!_logger) _logger = getChildLogger({ app: 'media' });
  return _logger;
}

const SAMPLED = { maxPerMinute: 20, aggregate: true };
const SAMPLED_STATE = { maxPerMinute: 30, aggregate: true };

function info(event) {
  return (data) => base().info(event, data);
}
function debug(event) {
  return (data) => base().debug(event, data);
}
function warn(event) {
  return (data) => base().warn(event, data);
}
function error(event) {
  return (data) => base().error(event, data);
}
function sampled(event, opts = SAMPLED) {
  return (data) => base().sampled(event, data, opts);
}

// Per docs/reference/media/media-app-technical.md §10.1
export const mediaLog = {
  mounted:                info('media-app.mounted'),
  unmounted:              info('media-app.unmounted'),
  sessionCreated:         info('session.created'),
  sessionReset:           info('session.reset'),
  sessionResumed:         info('session.resumed'),
  sessionStateChange:     sampled('session.state-change', SAMPLED_STATE),
  sessionPersisted:       sampled('session.persisted'),
  queueMutated:           debug('queue.mutated'),
  playbackStarted:        info('playback.started'),
  playbackStalled:        warn('playback.stalled'),
  playbackError:          error('playback.error'),
  playbackAdvanced:       info('playback.advanced'),
  searchIssued:           debug('search.issued'),
  searchResultChunk:      debug('search.result-chunk'),
  searchCompleted:        info('search.completed'),
  dispatchInitiated:      info('dispatch.initiated'),
  dispatchStep:           sampled('dispatch.step', { maxPerMinute: 30, aggregate: true }),
  dispatchSucceeded:      info('dispatch.succeeded'),
  dispatchFailed:         warn('dispatch.failed'),
  peekEntered:            info('peek.entered'),
  peekExited:             info('peek.exited'),
  peekCommand:            debug('peek.command'),
  peekCommandAck:         sampled('peek.command-ack'),
  takeoverInitiated:      info('takeover.initiated'),
  takeoverSucceeded:      info('takeover.succeeded'),
  takeoverFailed:         warn('takeover.failed'),
  handoffInitiated:       info('handoff.initiated'),
  handoffSucceeded:       info('handoff.succeeded'),
  handoffFailed:          warn('handoff.failed'),
  wsConnected:            info('ws.connected'),
  wsDisconnected:         info('ws.disconnected'),
  wsReconnected:          info('ws.reconnected'),
  wsStale:                warn('ws.stale'),
  externalControlReceived:info('external-control.received'),
  externalControlRejected:warn('external-control.rejected'),
  urlCommandProcessed:    info('url-command.processed'),
  urlCommandIgnored:      debug('url-command.ignored'),
};

export default mediaLog;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/modules/Media/logging/mediaLog.test.js`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/logging/mediaLog.js frontend/src/modules/Media/logging/mediaLog.test.js
git commit -m "feat(media): add mediaLog facade for P1 foundation

One helper per event in media-app-technical.md §10.1; high-frequency
events use logger.sampled so call sites stay terse."
```

---

## Task 2: displayUrl helper

**Files:**
- Create: `frontend/src/modules/Media/shared/displayUrl.js`
- Test: `frontend/src/modules/Media/shared/displayUrl.test.js`

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/modules/Media/shared/displayUrl.test.js
import { describe, it, expect } from 'vitest';
import { displayUrl } from './displayUrl.js';

describe('displayUrl', () => {
  it('builds /api/v1/display/:source/:localId for a content id', () => {
    expect(displayUrl('plex-main:12345')).toBe('/api/v1/display/plex-main/12345');
  });

  it('preserves slashes in localId (paths)', () => {
    expect(displayUrl('hymn-library:198/second')).toBe('/api/v1/display/hymn-library/198/second');
  });

  it('returns null for null/undefined/empty/unshaped input', () => {
    expect(displayUrl(null)).toBe(null);
    expect(displayUrl(undefined)).toBe(null);
    expect(displayUrl('')).toBe(null);
    expect(displayUrl('no-colon')).toBe(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/modules/Media/shared/displayUrl.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// frontend/src/modules/Media/shared/displayUrl.js
export function displayUrl(contentId) {
  if (typeof contentId !== 'string' || !contentId.includes(':')) return null;
  const idx = contentId.indexOf(':');
  const source = contentId.slice(0, idx);
  const localId = contentId.slice(idx + 1);
  if (!source || !localId) return null;
  return `/api/v1/display/${source}/${localId}`;
}

export default displayUrl;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/modules/Media/shared/displayUrl.test.js`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/shared/displayUrl.js frontend/src/modules/Media/shared/displayUrl.test.js
git commit -m "feat(media): add displayUrl thumbnail URL builder"
```

---

## Task 3: persistence — read/write happy path

**Files:**
- Create: `frontend/src/modules/Media/session/persistence.js`
- Test: `frontend/src/modules/Media/session/persistence.test.js`

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/modules/Media/session/persistence.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  readPersistedSession,
  writePersistedSession,
  clearPersistedSession,
  PERSIST_KEY,
  PERSIST_SCHEMA_VERSION,
} from './persistence.js';

function makeSnapshot() {
  return {
    sessionId: 's1',
    state: 'paused',
    currentItem: { contentId: 'plex:1', format: 'video', title: 'T', duration: 60 },
    position: 12.5,
    queue: { items: [], currentIndex: -1, upNextCount: 0 },
    config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1.0 },
    meta: { ownerId: 'c1', updatedAt: new Date().toISOString() },
  };
}

describe('persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  it('round-trips a SessionSnapshot under PERSIST_KEY with schemaVersion', () => {
    writePersistedSession(makeSnapshot(), { wasPlayingOnUnload: true });
    const raw = localStorage.getItem(PERSIST_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw);
    expect(parsed.schemaVersion).toBe(PERSIST_SCHEMA_VERSION);
    expect(parsed.wasPlayingOnUnload).toBe(true);
    expect(parsed.snapshot.sessionId).toBe('s1');

    const loaded = readPersistedSession();
    expect(loaded.snapshot.sessionId).toBe('s1');
    expect(loaded.wasPlayingOnUnload).toBe(true);
  });

  it('clearPersistedSession removes only media-app.session', () => {
    writePersistedSession(makeSnapshot(), { wasPlayingOnUnload: false });
    localStorage.setItem('unrelated', 'keep-me');
    clearPersistedSession();
    expect(localStorage.getItem(PERSIST_KEY)).toBeNull();
    expect(localStorage.getItem('unrelated')).toBe('keep-me');
  });

  it('read returns null when nothing is persisted', () => {
    expect(readPersistedSession()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/modules/Media/session/persistence.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// frontend/src/modules/Media/session/persistence.js
export const PERSIST_KEY = 'media-app.session';
export const PERSIST_SCHEMA_VERSION = 1;

function serialize(snapshot, { wasPlayingOnUnload }) {
  return JSON.stringify({
    schemaVersion: PERSIST_SCHEMA_VERSION,
    sessionId: snapshot.sessionId,
    updatedAt: new Date().toISOString(),
    wasPlayingOnUnload: !!wasPlayingOnUnload,
    snapshot,
  });
}

export function writePersistedSession(snapshot, { wasPlayingOnUnload } = {}) {
  const payload = serialize(snapshot, { wasPlayingOnUnload });
  try {
    localStorage.setItem(PERSIST_KEY, payload);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err };
  }
}

export function readPersistedSession() {
  const raw = localStorage.getItem(PERSIST_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.schemaVersion !== PERSIST_SCHEMA_VERSION) return 'schema-mismatch';
    if (!parsed?.snapshot) return null;
    return {
      snapshot: parsed.snapshot,
      wasPlayingOnUnload: !!parsed.wasPlayingOnUnload,
    };
  } catch {
    return null;
  }
}

export function clearPersistedSession() {
  localStorage.removeItem(PERSIST_KEY);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/modules/Media/session/persistence.test.js`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/session/persistence.js frontend/src/modules/Media/session/persistence.test.js
git commit -m "feat(media): add session persistence (localStorage schema v1)"
```

---

## Task 4: persistence — schema mismatch + quota handling

**Files:**
- Modify: `frontend/src/modules/Media/session/persistence.js`
- Modify: `frontend/src/modules/Media/session/persistence.test.js`

- [ ] **Step 1: Add failing tests**

Append to `persistence.test.js`:

```js
describe('persistence — schema + quota', () => {
  beforeEach(() => { localStorage.clear(); });

  it("returns 'schema-mismatch' when stored version does not match", () => {
    localStorage.setItem(PERSIST_KEY, JSON.stringify({ schemaVersion: 99, snapshot: {} }));
    expect(readPersistedSession()).toBe('schema-mismatch');
  });

  it('returns null on corrupt JSON', () => {
    localStorage.setItem(PERSIST_KEY, '{not-json');
    expect(readPersistedSession()).toBeNull();
  });

  it('truncates past-played items and retries on QuotaExceededError', () => {
    const originalSetItem = localStorage.setItem.bind(localStorage);
    let callCount = 0;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k, v) => {
      callCount += 1;
      if (callCount === 1) {
        const err = new Error('Quota exceeded');
        err.name = 'QuotaExceededError';
        throw err;
      }
      originalSetItem(k, v);
    });

    const snap = {
      sessionId: 's2',
      state: 'playing',
      currentItem: { contentId: 'plex:2', format: 'video' },
      position: 0,
      queue: {
        items: [
          { queueItemId: 'a', contentId: 'p:a', priority: 'queue' },
          { queueItemId: 'b', contentId: 'p:b', priority: 'queue' },
          { queueItemId: 'c', contentId: 'p:c', priority: 'queue' },
        ],
        currentIndex: 2,
        upNextCount: 0,
      },
      config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
      meta: { ownerId: 'c1', updatedAt: 'x' },
    };

    const result = writePersistedSession(snap, { wasPlayingOnUnload: true });
    expect(result.ok).toBe(true);
    expect(callCount).toBe(2);
    const loaded = readPersistedSession();
    expect(loaded.snapshot.queue.items).toHaveLength(1); // a, b truncated
    expect(loaded.snapshot.queue.items[0].queueItemId).toBe('c');
    expect(loaded.snapshot.queue.currentIndex).toBe(0);
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/modules/Media/session/persistence.test.js`
Expected: FAIL on the quota test (no truncation logic yet).

- [ ] **Step 3: Add quota handling**

Replace `writePersistedSession` in `persistence.js`:

```js
function truncatePastPlayed(snapshot) {
  const { items, currentIndex } = snapshot.queue;
  if (currentIndex <= 0) return snapshot; // nothing to truncate
  const trimmed = items.slice(currentIndex);
  return {
    ...snapshot,
    queue: { ...snapshot.queue, items: trimmed, currentIndex: 0 },
  };
}

export function writePersistedSession(snapshot, { wasPlayingOnUnload } = {}) {
  const firstPayload = serialize(snapshot, { wasPlayingOnUnload });
  try {
    localStorage.setItem(PERSIST_KEY, firstPayload);
    return { ok: true };
  } catch (err) {
    if (err?.name === 'QuotaExceededError' || /quota/i.test(err?.message || '')) {
      const truncated = truncatePastPlayed(snapshot);
      try {
        localStorage.setItem(PERSIST_KEY, serialize(truncated, { wasPlayingOnUnload }));
        return { ok: true, truncated: true };
      } catch (err2) {
        return { ok: false, error: err2 };
      }
    }
    return { ok: false, error: err };
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/modules/Media/session/persistence.test.js`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/session/persistence.js frontend/src/modules/Media/session/persistence.test.js
git commit -m "feat(media): handle schema mismatch + quota-exceeded in persistence

On QuotaExceededError, truncate past-played items and retry once.
On second failure, caller gets {ok: false}."
```

---

## Task 5: sessionReducer — state-machine transitions

**Files:**
- Create: `frontend/src/modules/Media/session/sessionReducer.js`
- Test: `frontend/src/modules/Media/session/sessionReducer.test.js`

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/modules/Media/session/sessionReducer.test.js
import { describe, it, expect } from 'vitest';
import { createIdleSessionSnapshot } from '@shared-contracts/media/shapes.mjs';
import { reduce } from './sessionReducer.js';

function snap() {
  return createIdleSessionSnapshot({ sessionId: 's1', ownerId: 'c1' });
}

describe('sessionReducer', () => {
  it('LOAD_ITEM transitions idle -> loading and sets currentItem', () => {
    const item = { contentId: 'p:1', format: 'video', title: 'T', duration: 30 };
    const next = reduce(snap(), { type: 'LOAD_ITEM', item });
    expect(next.state).toBe('loading');
    expect(next.currentItem).toEqual(item);
    expect(next.position).toBe(0);
  });

  it('PLAYER_STATE playing -> playing', () => {
    const s = reduce(snap(), { type: 'LOAD_ITEM', item: { contentId: 'p:1', format: 'video' } });
    const next = reduce(s, { type: 'PLAYER_STATE', playerState: 'playing' });
    expect(next.state).toBe('playing');
  });

  it('UPDATE_POSITION sets position but does not change state', () => {
    const s0 = reduce(snap(), { type: 'LOAD_ITEM', item: { contentId: 'p:1', format: 'video' } });
    const s1 = reduce(s0, { type: 'PLAYER_STATE', playerState: 'playing' });
    const s2 = reduce(s1, { type: 'UPDATE_POSITION', position: 5.5 });
    expect(s2.state).toBe('playing');
    expect(s2.position).toBe(5.5);
  });

  it('ITEM_ENDED transitions to ended', () => {
    const s0 = reduce(snap(), { type: 'LOAD_ITEM', item: { contentId: 'p:1', format: 'video' } });
    const s1 = reduce(s0, { type: 'PLAYER_STATE', playerState: 'playing' });
    const next = reduce(s1, { type: 'ITEM_ENDED' });
    expect(next.state).toBe('ended');
  });

  it('ITEM_ERROR transitions to error and stores lastError on meta', () => {
    const next = reduce(snap(), { type: 'ITEM_ERROR', error: 'boom', code: 'E_X' });
    expect(next.state).toBe('error');
    expect(next.meta.lastError).toEqual({ message: 'boom', code: 'E_X' });
  });

  it('RESET returns to idle', () => {
    const s = reduce(snap(), { type: 'LOAD_ITEM', item: { contentId: 'p:1', format: 'video' } });
    const next = reduce(s, { type: 'RESET' });
    expect(next.state).toBe('idle');
    expect(next.currentItem).toBeNull();
    expect(next.queue.items).toEqual([]);
  });

  it('SET_CONFIG merges config keys', () => {
    const next = reduce(snap(), { type: 'SET_CONFIG', patch: { shuffle: true, volume: 80 } });
    expect(next.config.shuffle).toBe(true);
    expect(next.config.volume).toBe(80);
    expect(next.config.repeat).toBe('off'); // untouched
  });

  it('touches meta.updatedAt on every reduction', () => {
    const before = snap();
    const after = reduce(before, { type: 'SET_CONFIG', patch: { volume: 70 } });
    expect(after.meta.updatedAt).not.toBe(before.meta.updatedAt);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/modules/Media/session/sessionReducer.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// frontend/src/modules/Media/session/sessionReducer.js
import { createIdleSessionSnapshot, createEmptyQueueSnapshot } from '@shared-contracts/media/shapes.mjs';

const PLAYER_STATE_MAP = {
  idle: 'idle',
  stopped: 'idle',
  loading: 'loading',
  ready: 'ready',
  loaded: 'ready',
  playing: 'playing',
  paused: 'paused',
  buffering: 'buffering',
  stalled: 'stalled',
  ended: 'ended',
  error: 'error',
};

function touch(snapshot, patch) {
  return {
    ...snapshot,
    ...patch,
    meta: {
      ...snapshot.meta,
      ...(patch.meta || {}),
      updatedAt: new Date().toISOString(),
    },
  };
}

export function reduce(snapshot, action) {
  switch (action.type) {
    case 'LOAD_ITEM':
      return touch(snapshot, {
        state: 'loading',
        currentItem: action.item,
        position: 0,
      });

    case 'PLAYER_STATE': {
      const mapped = PLAYER_STATE_MAP[action.playerState] ?? snapshot.state;
      return touch(snapshot, { state: mapped });
    }

    case 'UPDATE_POSITION':
      return touch(snapshot, { position: action.position });

    case 'ITEM_ENDED':
      return touch(snapshot, { state: 'ended' });

    case 'ITEM_ERROR':
      return touch(snapshot, {
        state: 'error',
        meta: { lastError: { message: action.error, code: action.code } },
      });

    case 'SET_CONFIG':
      return touch(snapshot, {
        config: { ...snapshot.config, ...action.patch },
      });

    case 'REPLACE_QUEUE':
      return touch(snapshot, { queue: action.queue });

    case 'SET_CURRENT_ITEM':
      return touch(snapshot, { currentItem: action.item, position: 0, state: 'loading' });

    case 'ADOPT_SNAPSHOT':
      return touch(action.snapshot, {});

    case 'RESET': {
      const fresh = createIdleSessionSnapshot({
        sessionId: action.newSessionId ?? snapshot.sessionId,
        ownerId: snapshot.meta.ownerId,
      });
      return fresh;
    }

    default:
      return snapshot;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/modules/Media/session/sessionReducer.test.js`
Expected: PASS (8/8).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/session/sessionReducer.js frontend/src/modules/Media/session/sessionReducer.test.js
git commit -m "feat(media): add session state-machine reducer"
```

---

## Task 6: queueOps — playNow / playNext / addUpNext / add

**Files:**
- Create: `frontend/src/modules/Media/session/queueOps.js`
- Test: `frontend/src/modules/Media/session/queueOps.test.js`

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/modules/Media/session/queueOps.test.js
import { describe, it, expect } from 'vitest';
import { createIdleSessionSnapshot } from '@shared-contracts/media/shapes.mjs';
import { playNow, playNext, addUpNext, add, clear, remove, jump, reorder } from './queueOps.js';

function emptySnap() {
  return createIdleSessionSnapshot({ sessionId: 's1', ownerId: 'c1' });
}

function item(contentId, priority = 'queue', queueItemId = contentId) {
  return {
    queueItemId,
    contentId,
    title: contentId,
    format: 'video',
    addedAt: '2026-04-18T00:00:00Z',
    priority,
  };
}

describe('queueOps — insertion ops', () => {
  it('playNow replaces current item and clears rest when clearRest=true', () => {
    const seed = playNow(emptySnap(), { contentId: 'a' }, { clearRest: true });
    expect(seed.queue.items).toHaveLength(1);
    expect(seed.queue.items[0].contentId).toBe('a');
    expect(seed.queue.currentIndex).toBe(0);
    expect(seed.currentItem?.contentId).toBe('a');
  });

  it('playNow with clearRest=false inserts-and-plays, keeping tail', () => {
    let s = add(emptySnap(), { contentId: 'a' });
    s = add(s, { contentId: 'b' });
    s = playNow(s, { contentId: 'c' }, { clearRest: false });
    expect(s.queue.items.map(i => i.contentId)).toEqual(['c', 'a', 'b']);
    expect(s.queue.currentIndex).toBe(0);
  });

  it('playNext inserts after the current item', () => {
    let s = add(emptySnap(), { contentId: 'a' });
    s = add(s, { contentId: 'b' });
    s = jump(s, s.queue.items[0].queueItemId);
    s = playNext(s, { contentId: 'x' });
    expect(s.queue.items.map(i => i.contentId)).toEqual(['a', 'x', 'b']);
    expect(s.queue.currentIndex).toBe(0);
  });

  it('addUpNext appends to Up Next sub-queue, before regular queue', () => {
    let s = add(emptySnap(), { contentId: 'a' });
    s = addUpNext(s, { contentId: 'u1' });
    s = addUpNext(s, { contentId: 'u2' });
    expect(s.queue.items.map(i => i.contentId)).toEqual(['a', 'u1', 'u2']);
    expect(s.queue.upNextCount).toBe(2);
    expect(s.queue.items[1].priority).toBe('upNext');
  });

  it('add appends to the end', () => {
    let s = add(emptySnap(), { contentId: 'a' });
    s = add(s, { contentId: 'b' });
    expect(s.queue.items.map(i => i.contentId)).toEqual(['a', 'b']);
    expect(s.queue.upNextCount).toBe(0);
  });
});

describe('queueOps — mutation ops', () => {
  it('clear empties queue and resets currentIndex', () => {
    let s = add(emptySnap(), { contentId: 'a' });
    s = add(s, { contentId: 'b' });
    s = clear(s);
    expect(s.queue.items).toEqual([]);
    expect(s.queue.currentIndex).toBe(-1);
    expect(s.queue.upNextCount).toBe(0);
  });

  it('remove drops by queueItemId and adjusts currentIndex', () => {
    let s = add(emptySnap(), { contentId: 'a' });
    s = add(s, { contentId: 'b' });
    s = jump(s, s.queue.items[1].queueItemId);
    const bId = s.queue.items[1].queueItemId;
    s = remove(s, s.queue.items[0].queueItemId);
    expect(s.queue.items.map(i => i.contentId)).toEqual(['b']);
    expect(s.queue.currentIndex).toBe(0);
    expect(s.queue.items[0].queueItemId).toBe(bId);
  });

  it('jump sets currentIndex + currentItem by queueItemId', () => {
    let s = add(emptySnap(), { contentId: 'a' });
    s = add(s, { contentId: 'b' });
    const bId = s.queue.items[1].queueItemId;
    s = jump(s, bId);
    expect(s.queue.currentIndex).toBe(1);
    expect(s.currentItem?.contentId).toBe('b');
  });

  it('reorder({from, to}) swaps positions', () => {
    let s = add(emptySnap(), { contentId: 'a' });
    s = add(s, { contentId: 'b' });
    s = add(s, { contentId: 'c' });
    s = reorder(s, { from: s.queue.items[0].queueItemId, to: s.queue.items[2].queueItemId });
    expect(s.queue.items.map(i => i.contentId)).toEqual(['b', 'c', 'a']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/modules/Media/session/queueOps.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// frontend/src/modules/Media/session/queueOps.js
function uid() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch { /* ignore */ }
  return `qi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function toQueueItem(input, { priority = 'queue' } = {}) {
  if (input && input.queueItemId && input.contentId) {
    return { ...input, priority: input.priority ?? priority };
  }
  return {
    queueItemId: uid(),
    contentId: input.contentId,
    title: input.title ?? input.contentId,
    format: input.format ?? null,
    duration: input.duration ?? null,
    thumbnail: input.thumbnail ?? null,
    addedAt: new Date().toISOString(),
    priority,
  };
}

function countUpNext(items) {
  return items.filter(i => i.priority === 'upNext').length;
}

function withQueue(snapshot, queue) {
  const currentItem = queue.currentIndex >= 0 && queue.items[queue.currentIndex]
    ? { contentId: queue.items[queue.currentIndex].contentId,
        format: queue.items[queue.currentIndex].format,
        title:  queue.items[queue.currentIndex].title,
        duration: queue.items[queue.currentIndex].duration,
        thumbnail: queue.items[queue.currentIndex].thumbnail }
    : snapshot.currentItem;
  return { ...snapshot, queue, currentItem };
}

export function playNow(snapshot, input, { clearRest = false } = {}) {
  const newItem = toQueueItem(input);
  if (clearRest) {
    return withQueue(snapshot, { items: [newItem], currentIndex: 0, upNextCount: countUpNext([newItem]) });
  }
  const items = [newItem, ...snapshot.queue.items];
  return withQueue(snapshot, { items, currentIndex: 0, upNextCount: countUpNext(items) });
}

export function playNext(snapshot, input) {
  const newItem = toQueueItem(input);
  const items = [...snapshot.queue.items];
  const after = Math.max(0, snapshot.queue.currentIndex) + 1;
  items.splice(after, 0, newItem);
  return withQueue(snapshot, {
    items,
    currentIndex: snapshot.queue.currentIndex,
    upNextCount: countUpNext(items),
  });
}

export function addUpNext(snapshot, input) {
  const newItem = toQueueItem(input, { priority: 'upNext' });
  const regularStart = snapshot.queue.items.findIndex(i => i.priority !== 'upNext');
  const insertAt = regularStart === -1 ? snapshot.queue.items.length : regularStart;
  // Find position: after current item if within items; else after last upNext
  const current = snapshot.queue.currentIndex;
  let targetIdx;
  if (current >= 0 && current < snapshot.queue.items.length) {
    // after current, but in the upNext band
    const currentItem = snapshot.queue.items[current];
    if (currentItem.priority === 'upNext') {
      targetIdx = current + 1;
    } else {
      // put into upNext band: count upNext; insert at upNextCount
      targetIdx = snapshot.queue.upNextCount;
    }
  } else {
    targetIdx = insertAt;
  }
  const items = [...snapshot.queue.items];
  items.splice(targetIdx, 0, newItem);
  const newCurrentIndex = snapshot.queue.currentIndex >= targetIdx && snapshot.queue.currentIndex !== -1
    ? snapshot.queue.currentIndex + 1
    : snapshot.queue.currentIndex;
  return withQueue(snapshot, {
    items,
    currentIndex: newCurrentIndex,
    upNextCount: countUpNext(items),
  });
}

export function add(snapshot, input) {
  const newItem = toQueueItem(input);
  const items = [...snapshot.queue.items, newItem];
  const currentIndex = snapshot.queue.currentIndex === -1 && items.length === 1 ? 0 : snapshot.queue.currentIndex;
  return withQueue(snapshot, { items, currentIndex, upNextCount: countUpNext(items) });
}

export function clear(snapshot) {
  return withQueue(snapshot, { items: [], currentIndex: -1, upNextCount: 0 });
}

export function remove(snapshot, queueItemId) {
  const idx = snapshot.queue.items.findIndex(i => i.queueItemId === queueItemId);
  if (idx === -1) return snapshot;
  const items = snapshot.queue.items.filter((_, i) => i !== idx);
  let currentIndex = snapshot.queue.currentIndex;
  if (idx < currentIndex) currentIndex -= 1;
  else if (idx === currentIndex) currentIndex = items.length > 0 ? Math.min(currentIndex, items.length - 1) : -1;
  return withQueue(snapshot, { items, currentIndex, upNextCount: countUpNext(items) });
}

export function jump(snapshot, queueItemId) {
  const idx = snapshot.queue.items.findIndex(i => i.queueItemId === queueItemId);
  if (idx === -1) return snapshot;
  return withQueue(snapshot, {
    items: snapshot.queue.items,
    currentIndex: idx,
    upNextCount: snapshot.queue.upNextCount,
  });
}

export function reorder(snapshot, input) {
  const items = [...snapshot.queue.items];
  if (Array.isArray(input?.items)) {
    // Replace ordering by queueItemId sequence
    const byId = new Map(items.map(i => [i.queueItemId, i]));
    const reordered = input.items.map(id => byId.get(id)).filter(Boolean);
    return withQueue(snapshot, {
      items: reordered,
      currentIndex: snapshot.queue.currentIndex,
      upNextCount: countUpNext(reordered),
    });
  }
  const fromIdx = items.findIndex(i => i.queueItemId === input.from);
  const toIdx = items.findIndex(i => i.queueItemId === input.to);
  if (fromIdx === -1 || toIdx === -1) return snapshot;
  const [moved] = items.splice(fromIdx, 1);
  items.splice(toIdx, 0, moved);
  return withQueue(snapshot, {
    items,
    currentIndex: snapshot.queue.currentIndex,
    upNextCount: countUpNext(items),
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/modules/Media/session/queueOps.test.js`
Expected: PASS (9/9).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/session/queueOps.js frontend/src/modules/Media/session/queueOps.test.js
git commit -m "feat(media): add Plex MP queue operations as pure functions

playNow/playNext/addUpNext/add/clear/remove/jump/reorder over
SessionSnapshot. Ops never touch state/currentItem directly — the
adapter composes them with sessionReducer."
```

---

## Task 7: advancement — pickNextQueueItem

**Files:**
- Create: `frontend/src/modules/Media/session/advancement.js`
- Test: `frontend/src/modules/Media/session/advancement.test.js`

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/modules/Media/session/advancement.test.js
import { describe, it, expect } from 'vitest';
import { pickNextQueueItem } from './advancement.js';

function snap({ items = [], currentIndex = -1, upNextCount = 0, repeat = 'off', shuffle = false } = {}) {
  return {
    sessionId: 's', state: 'playing', currentItem: null, position: 0,
    queue: { items, currentIndex, upNextCount },
    config: { shuffle, repeat, shader: null, volume: 50, playbackRate: 1 },
    meta: { ownerId: 'c', updatedAt: '' },
  };
}

const mk = (id, p = 'queue') => ({ queueItemId: id, contentId: id, format: 'video', priority: p });

describe('advancement.pickNextQueueItem', () => {
  it('returns null when queue is empty', () => {
    expect(pickNextQueueItem(snap())).toBeNull();
  });

  it('advances to the next item in order', () => {
    const s = snap({ items: [mk('a'), mk('b'), mk('c')], currentIndex: 0 });
    expect(pickNextQueueItem(s).queueItemId).toBe('b');
  });

  it('returns null at end when repeat=off', () => {
    const s = snap({ items: [mk('a'), mk('b')], currentIndex: 1, repeat: 'off' });
    expect(pickNextQueueItem(s)).toBeNull();
  });

  it('wraps to index 0 when repeat=all', () => {
    const s = snap({ items: [mk('a'), mk('b')], currentIndex: 1, repeat: 'all' });
    expect(pickNextQueueItem(s).queueItemId).toBe('a');
  });

  it('returns the same item when repeat=one', () => {
    const s = snap({ items: [mk('a'), mk('b')], currentIndex: 1, repeat: 'one' });
    expect(pickNextQueueItem(s).queueItemId).toBe('b');
  });

  it('honors upNext priority even when current is in regular band', () => {
    const items = [mk('a'), mk('u1', 'upNext'), mk('b')];
    const s = snap({ items, currentIndex: 0, upNextCount: 1 });
    expect(pickNextQueueItem(s).queueItemId).toBe('u1');
  });

  it('with shuffle=true, picks a different item from the regular band', () => {
    const items = [mk('a'), mk('b'), mk('c'), mk('d')];
    const s = snap({ items, currentIndex: 0, shuffle: true });
    const picked = pickNextQueueItem(s);
    expect(['b', 'c', 'd']).toContain(picked.queueItemId);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/modules/Media/session/advancement.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// frontend/src/modules/Media/session/advancement.js

export function pickNextQueueItem(snapshot, { randomFn = Math.random } = {}) {
  const { items, currentIndex } = snapshot.queue;
  if (!items || items.length === 0) return null;

  const { repeat, shuffle } = snapshot.config;

  if (repeat === 'one' && currentIndex >= 0 && currentIndex < items.length) {
    return items[currentIndex];
  }

  // Prefer upNext items first
  const upNextIdx = items.findIndex((it, i) => i !== currentIndex && it.priority === 'upNext');
  if (upNextIdx !== -1) return items[upNextIdx];

  if (shuffle) {
    const candidates = items
      .map((item, i) => ({ item, i }))
      .filter(({ i }) => i !== currentIndex);
    if (candidates.length === 0) {
      return repeat === 'all' && items.length > 0 ? items[0] : null;
    }
    const pick = candidates[Math.floor(randomFn() * candidates.length)];
    return pick.item;
  }

  // Sequential
  const nextIdx = currentIndex + 1;
  if (nextIdx < items.length) return items[nextIdx];
  if (repeat === 'all') return items[0];
  return null;
}

export default pickNextQueueItem;
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/modules/Media/session/advancement.test.js`
Expected: PASS (7/7).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/session/advancement.js frontend/src/modules/Media/session/advancement.test.js
git commit -m "feat(media): add queue advancement selector (repeat/shuffle/upNext)"
```

---

## Task 8: LocalSessionAdapter — constructor, subscribe, transport

**Files:**
- Create: `frontend/src/modules/Media/session/LocalSessionAdapter.js`
- Test: `frontend/src/modules/Media/session/LocalSessionAdapter.test.js`

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/modules/Media/session/LocalSessionAdapter.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalSessionAdapter } from './LocalSessionAdapter.js';

function makeDeps() {
  return {
    clientId: 'c1',
    wsSend: vi.fn(),
    httpClient: vi.fn(async () => ({})),
    persistence: {
      read: vi.fn(() => null),
      write: vi.fn(() => ({ ok: true })),
      clear: vi.fn(),
    },
    nowFn: () => new Date('2026-04-18T00:00:00Z'),
    randomUuid: () => 's-test-1',
  };
}

describe('LocalSessionAdapter — bootstrap', () => {
  it('starts with an idle snapshot when persistence returns null', () => {
    const a = new LocalSessionAdapter(makeDeps());
    expect(a.getSnapshot().state).toBe('idle');
    expect(a.getSnapshot().sessionId).toBe('s-test-1');
    expect(a.getSnapshot().meta.ownerId).toBe('c1');
  });

  it('hydrates from persistence if a prior snapshot exists', () => {
    const deps = makeDeps();
    deps.persistence.read = vi.fn(() => ({
      snapshot: { sessionId: 'old', state: 'paused', currentItem: null, position: 42,
                  queue: { items: [], currentIndex: -1, upNextCount: 0 },
                  config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
                  meta: { ownerId: 'c1', updatedAt: '' } },
      wasPlayingOnUnload: false,
    }));
    const a = new LocalSessionAdapter(deps);
    expect(a.getSnapshot().sessionId).toBe('old');
    expect(a.getSnapshot().position).toBe(42);
  });

  it('notifies subscribers on state change', () => {
    const a = new LocalSessionAdapter(makeDeps());
    const sub = vi.fn();
    const unsub = a.subscribe(sub);
    a._dispatch({ type: 'SET_CONFIG', patch: { volume: 77 } });
    expect(sub).toHaveBeenCalledTimes(1);
    expect(sub.mock.calls[0][0].config.volume).toBe(77);
    unsub();
    a._dispatch({ type: 'SET_CONFIG', patch: { volume: 44 } });
    expect(sub).toHaveBeenCalledTimes(1);
  });
});

describe('LocalSessionAdapter — transport', () => {
  let a;
  beforeEach(() => { a = new LocalSessionAdapter(makeDeps()); });

  it('pause updates snapshot.state to paused', () => {
    a._dispatch({ type: 'LOAD_ITEM', item: { contentId: 'p:1', format: 'video' } });
    a._dispatch({ type: 'PLAYER_STATE', playerState: 'playing' });
    a.transport.pause();
    expect(a.getSnapshot().state).toBe('paused');
  });

  it('stop resets to idle', () => {
    a._dispatch({ type: 'LOAD_ITEM', item: { contentId: 'p:1', format: 'video' } });
    a.transport.stop();
    expect(a.getSnapshot().state).toBe('idle');
    expect(a.getSnapshot().currentItem).toBeNull();
  });

  it('persists after every transport action', () => {
    const deps = makeDeps();
    const b = new LocalSessionAdapter(deps);
    b._dispatch({ type: 'LOAD_ITEM', item: { contentId: 'p:1', format: 'video' } });
    b.transport.pause();
    expect(deps.persistence.write).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/modules/Media/session/LocalSessionAdapter.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation (constructor + subscribe + transport)**

```js
// frontend/src/modules/Media/session/LocalSessionAdapter.js
import { createIdleSessionSnapshot } from '@shared-contracts/media/shapes.mjs';
import { reduce } from './sessionReducer.js';
import * as qOps from './queueOps.js';
import { pickNextQueueItem } from './advancement.js';

function defaultUuid() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch { /* ignore */ }
  return `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class LocalSessionAdapter {
  constructor({
    clientId,
    wsSend = () => {},
    httpClient = async () => ({}),
    persistence = { read: () => null, write: () => ({ ok: true }), clear: () => {} },
    nowFn = () => new Date(),
    randomUuid = defaultUuid,
  } = {}) {
    this._clientId = clientId;
    this._wsSend = wsSend;
    this._http = httpClient;
    this._persist = persistence;
    this._now = nowFn;
    this._randomUuid = randomUuid;
    this._subscribers = new Set();
    this._playerRequest = null; // callers (HiddenPlayerMount) read this to know what to play
    this._playerCallbacks = { onPlayRequest: () => {}, onPauseRequest: () => {}, onSeekRequest: () => {} };

    // Bootstrap: hydrate or create idle
    const persisted = this._persist.read();
    if (persisted && persisted !== 'schema-mismatch') {
      this._snapshot = persisted.snapshot;
    } else {
      this._snapshot = createIdleSessionSnapshot({
        sessionId: this._randomUuid(),
        ownerId: this._clientId,
        now: this._now(),
      });
    }
  }

  getSnapshot() {
    return this._snapshot;
  }

  subscribe(listener) {
    this._subscribers.add(listener);
    return () => this._subscribers.delete(listener);
  }

  setPlayerCallbacks(callbacks) {
    this._playerCallbacks = { ...this._playerCallbacks, ...callbacks };
  }

  _dispatch(action) {
    const prev = this._snapshot;
    const next = reduce(prev, action);
    if (next === prev) return;
    this._snapshot = next;
    this._persist.write(next, { wasPlayingOnUnload: next.state === 'playing' });
    for (const sub of this._subscribers) sub(next);
  }

  transport = {
    play: () => {
      this._playerCallbacks.onPlayRequest?.();
      this._dispatch({ type: 'PLAYER_STATE', playerState: 'playing' });
    },
    pause: () => {
      this._playerCallbacks.onPauseRequest?.();
      this._dispatch({ type: 'PLAYER_STATE', playerState: 'paused' });
    },
    stop: () => {
      this._playerCallbacks.onPauseRequest?.();
      this._dispatch({ type: 'RESET' });
    },
    seekAbs: (seconds) => {
      this._playerCallbacks.onSeekRequest?.(seconds);
      this._dispatch({ type: 'UPDATE_POSITION', position: seconds });
    },
    seekRel: (delta) => {
      const s = Math.max(0, (this._snapshot.position ?? 0) + delta);
      this.transport.seekAbs(s);
    },
    skipNext: () => this._advance('skip-next'),
    skipPrev: () => this._advanceBack(),
  };

  _advance(_reason) {
    const next = pickNextQueueItem(this._snapshot);
    if (!next) {
      this._dispatch({ type: 'PLAYER_STATE', playerState: 'ended' });
      return;
    }
    const idx = this._snapshot.queue.items.findIndex(i => i.queueItemId === next.queueItemId);
    const items = [...this._snapshot.queue.items];
    this._dispatch({
      type: 'REPLACE_QUEUE',
      queue: { items, currentIndex: idx, upNextCount: this._snapshot.queue.upNextCount },
    });
    this._dispatch({ type: 'LOAD_ITEM', item: {
      contentId: next.contentId, format: next.format, title: next.title, duration: next.duration, thumbnail: next.thumbnail,
    } });
  }

  _advanceBack() {
    const prev = Math.max(-1, this._snapshot.queue.currentIndex - 1);
    if (prev < 0) return;
    const item = this._snapshot.queue.items[prev];
    this._dispatch({
      type: 'REPLACE_QUEUE',
      queue: { items: this._snapshot.queue.items, currentIndex: prev, upNextCount: this._snapshot.queue.upNextCount },
    });
    this._dispatch({ type: 'LOAD_ITEM', item: {
      contentId: item.contentId, format: item.format, title: item.title, duration: item.duration, thumbnail: item.thumbnail,
    } });
  }
}

export default LocalSessionAdapter;
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/modules/Media/session/LocalSessionAdapter.test.js`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/session/LocalSessionAdapter.js frontend/src/modules/Media/session/LocalSessionAdapter.test.js
git commit -m "feat(media): LocalSessionAdapter bootstrap + subscribe + transport"
```

---

## Task 9: LocalSessionAdapter — queue + config + lifecycle

**Files:**
- Modify: `frontend/src/modules/Media/session/LocalSessionAdapter.js`
- Modify: `frontend/src/modules/Media/session/LocalSessionAdapter.test.js`

- [ ] **Step 1: Add failing tests**

Append to the test file:

```js
describe('LocalSessionAdapter — queue ops', () => {
  it('queue.add appends; first add sets currentItem', () => {
    const a = new LocalSessionAdapter(makeDeps());
    a.queue.add({ contentId: 'a', format: 'video', title: 'A' });
    expect(a.getSnapshot().queue.items).toHaveLength(1);
    expect(a.getSnapshot().queue.currentIndex).toBe(0);
    expect(a.getSnapshot().currentItem?.contentId).toBe('a');
  });

  it('queue.playNow replaces-and-loads', () => {
    const a = new LocalSessionAdapter(makeDeps());
    a.queue.playNow({ contentId: 'a', format: 'video' }, { clearRest: true });
    expect(a.getSnapshot().state).toBe('loading');
    expect(a.getSnapshot().currentItem?.contentId).toBe('a');
  });

  it('queue.clear empties the queue', () => {
    const a = new LocalSessionAdapter(makeDeps());
    a.queue.add({ contentId: 'a', format: 'video' });
    a.queue.add({ contentId: 'b', format: 'video' });
    a.queue.clear();
    expect(a.getSnapshot().queue.items).toEqual([]);
  });
});

describe('LocalSessionAdapter — config + lifecycle', () => {
  it('config.setVolume clamps to 0..100', () => {
    const a = new LocalSessionAdapter(makeDeps());
    a.config.setVolume(-5);
    expect(a.getSnapshot().config.volume).toBe(0);
    a.config.setVolume(150);
    expect(a.getSnapshot().config.volume).toBe(100);
  });

  it('lifecycle.reset clears persistence and returns to idle', () => {
    const deps = makeDeps();
    const a = new LocalSessionAdapter(deps);
    a.queue.add({ contentId: 'a', format: 'video' });
    a.lifecycle.reset();
    expect(a.getSnapshot().state).toBe('idle');
    expect(a.getSnapshot().queue.items).toEqual([]);
    expect(deps.persistence.clear).toHaveBeenCalled();
  });

  it('lifecycle.adoptSnapshot replaces state', () => {
    const a = new LocalSessionAdapter(makeDeps());
    const adopted = {
      sessionId: 'adopted', state: 'paused', currentItem: { contentId: 'z', format: 'audio' },
      position: 9,
      queue: { items: [], currentIndex: -1, upNextCount: 0 },
      config: { shuffle: false, repeat: 'off', shader: null, volume: 30, playbackRate: 1 },
      meta: { ownerId: 'c1', updatedAt: '' },
    };
    a.lifecycle.adoptSnapshot(adopted, { autoplay: false });
    expect(a.getSnapshot().sessionId).toBe('adopted');
    expect(a.getSnapshot().currentItem?.contentId).toBe('z');
  });
});

describe('LocalSessionAdapter — player event handlers', () => {
  it('onPlayerEnded auto-advances to next item (sequential)', () => {
    const a = new LocalSessionAdapter(makeDeps());
    a.queue.add({ contentId: 'a', format: 'video' });
    a.queue.add({ contentId: 'b', format: 'video' });
    a.onPlayerEnded();
    expect(a.getSnapshot().currentItem?.contentId).toBe('b');
    expect(a.getSnapshot().queue.currentIndex).toBe(1);
  });

  it('onPlayerEnded at end with repeat=off goes to idle', () => {
    const a = new LocalSessionAdapter(makeDeps());
    a.queue.add({ contentId: 'a', format: 'video' });
    a.onPlayerEnded();
    // No next item, state goes to 'ended' then stays
    expect(a.getSnapshot().state).toBe('ended');
  });

  it('onPlayerError auto-advances and logs error state', () => {
    const a = new LocalSessionAdapter(makeDeps());
    a.queue.add({ contentId: 'a', format: 'video' });
    a.queue.add({ contentId: 'b', format: 'video' });
    a.onPlayerError({ message: 'boom', code: 'E_X' });
    expect(a.getSnapshot().currentItem?.contentId).toBe('b');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/modules/Media/session/LocalSessionAdapter.test.js`
Expected: FAIL (new describe blocks error on `a.queue`, `a.config`, `a.lifecycle`, `a.onPlayerEnded`).

- [ ] **Step 3: Extend the adapter**

Append inside `LocalSessionAdapter` class (above the closing `}`):

```js
  queue = {
    playNow: (input, opts) => {
      const next = qOps.playNow(this._snapshot, input, opts);
      this._replaceSnapshotAndLoad(next);
    },
    playNext: (input) => {
      const next = qOps.playNext(this._snapshot, input);
      this._replaceSnapshot(next);
    },
    addUpNext: (input) => {
      const next = qOps.addUpNext(this._snapshot, input);
      this._replaceSnapshot(next);
    },
    add: (input) => {
      const wasEmpty = this._snapshot.queue.items.length === 0;
      const next = qOps.add(this._snapshot, input);
      if (wasEmpty && next.queue.currentIndex === 0) {
        this._replaceSnapshotAndLoad(next);
      } else {
        this._replaceSnapshot(next);
      }
    },
    clear: () => {
      const next = qOps.clear(this._snapshot);
      this._replaceSnapshot(next);
    },
    remove: (queueItemId) => {
      const next = qOps.remove(this._snapshot, queueItemId);
      this._replaceSnapshot(next);
    },
    jump: (queueItemId) => {
      const next = qOps.jump(this._snapshot, queueItemId);
      this._replaceSnapshotAndLoad(next);
    },
    reorder: (input) => {
      const next = qOps.reorder(this._snapshot, input);
      this._replaceSnapshot(next);
    },
  };

  config = {
    setShuffle: (enabled) => this._dispatch({ type: 'SET_CONFIG', patch: { shuffle: !!enabled } }),
    setRepeat: (mode) => {
      if (!['off', 'one', 'all'].includes(mode)) return;
      this._dispatch({ type: 'SET_CONFIG', patch: { repeat: mode } });
    },
    setShader: (shader) => this._dispatch({ type: 'SET_CONFIG', patch: { shader: shader ?? null } }),
    setVolume: (level) => {
      const clamped = Math.max(0, Math.min(100, Math.round(Number(level) || 0)));
      this._dispatch({ type: 'SET_CONFIG', patch: { volume: clamped } });
    },
  };

  lifecycle = {
    reset: () => {
      this._persist.clear();
      this._dispatch({ type: 'RESET', newSessionId: this._randomUuid() });
    },
    adoptSnapshot: (snapshot, { autoplay = true } = {}) => {
      this._dispatch({ type: 'ADOPT_SNAPSHOT', snapshot });
      if (autoplay) this.transport.play();
    },
  };

  portability = {
    snapshotForHandoff: () => JSON.parse(JSON.stringify(this._snapshot)),
    receiveClaim: (snapshot) => this.lifecycle.adoptSnapshot(snapshot, { autoplay: true }),
  };

  onPlayerEnded() {
    this._advance('item-ended');
  }

  onPlayerError({ message, code } = {}) {
    this._dispatch({ type: 'ITEM_ERROR', error: message ?? 'unknown', code: code ?? null });
    this._advance('item-error');
  }

  onPlayerStateChange(state) {
    this._dispatch({ type: 'PLAYER_STATE', playerState: state });
  }

  onPlayerProgress(positionSeconds) {
    if (typeof positionSeconds === 'number' && Number.isFinite(positionSeconds)) {
      this._dispatch({ type: 'UPDATE_POSITION', position: positionSeconds });
    }
  }

  _replaceSnapshot(next) {
    if (next === this._snapshot) return;
    this._snapshot = next;
    this._persist.write(next, { wasPlayingOnUnload: next.state === 'playing' });
    for (const sub of this._subscribers) sub(next);
  }

  _replaceSnapshotAndLoad(next) {
    this._replaceSnapshot(next);
    const current = next.queue.items[next.queue.currentIndex];
    if (current) {
      this._dispatch({ type: 'LOAD_ITEM', item: {
        contentId: current.contentId, format: current.format,
        title: current.title, duration: current.duration, thumbnail: current.thumbnail,
      } });
    }
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/modules/Media/session/LocalSessionAdapter.test.js`
Expected: PASS (12/12 total).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/session/LocalSessionAdapter.js frontend/src/modules/Media/session/LocalSessionAdapter.test.js
git commit -m "feat(media): LocalSessionAdapter queue/config/lifecycle/events"
```

---

## Task 10: ClientIdentityProvider

**Files:**
- Create: `frontend/src/modules/Media/session/ClientIdentityProvider.jsx`
- Test: `frontend/src/modules/Media/session/ClientIdentityProvider.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Media/session/ClientIdentityProvider.test.jsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClientIdentityProvider, useClientIdentity, CLIENT_ID_KEY, DISPLAY_NAME_KEY } from './ClientIdentityProvider.jsx';

function Probe() {
  const { clientId, displayName } = useClientIdentity();
  return <div>cid={clientId};dn={displayName}</div>;
}

describe('ClientIdentityProvider', () => {
  beforeEach(() => { localStorage.clear(); });

  it('generates + persists a new clientId when none present', () => {
    render(<ClientIdentityProvider><Probe /></ClientIdentityProvider>);
    const stored = localStorage.getItem(CLIENT_ID_KEY);
    expect(stored).toBeTruthy();
    expect(stored.length).toBeGreaterThan(8);
    expect(screen.getByText(new RegExp(`cid=${stored};`))).toBeInTheDocument();
  });

  it('reuses an existing clientId', () => {
    localStorage.setItem(CLIENT_ID_KEY, 'preset-id-1234');
    render(<ClientIdentityProvider><Probe /></ClientIdentityProvider>);
    expect(screen.getByText(/cid=preset-id-1234;/)).toBeInTheDocument();
  });

  it("defaults displayName to 'Client <first-8>' when none stored", () => {
    localStorage.setItem(CLIENT_ID_KEY, 'abcdef0123456789');
    render(<ClientIdentityProvider><Probe /></ClientIdentityProvider>);
    expect(screen.getByText(/dn=Client abcdef01/)).toBeInTheDocument();
  });

  it('uses stored displayName if present', () => {
    localStorage.setItem(CLIENT_ID_KEY, 'xx');
    localStorage.setItem(DISPLAY_NAME_KEY, 'My Phone');
    render(<ClientIdentityProvider><Probe /></ClientIdentityProvider>);
    expect(screen.getByText(/dn=My Phone/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/modules/Media/session/ClientIdentityProvider.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```jsx
// frontend/src/modules/Media/session/ClientIdentityProvider.jsx
import React, { createContext, useContext, useMemo } from 'react';

export const CLIENT_ID_KEY   = 'media-app.client-id';
export const DISPLAY_NAME_KEY = 'media-app.display-name';

const ClientIdentityContext = createContext(null);

function uuidV4() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch { /* ignore */ }
  // RFC4122 v4-ish fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function ClientIdentityProvider({ children }) {
  const value = useMemo(() => {
    let clientId = localStorage.getItem(CLIENT_ID_KEY);
    if (!clientId) {
      clientId = uuidV4();
      try { localStorage.setItem(CLIENT_ID_KEY, clientId); } catch { /* ignore */ }
    }
    const stored = localStorage.getItem(DISPLAY_NAME_KEY);
    const displayName = stored || `Client ${clientId.slice(0, 8)}`;
    return { clientId, displayName };
  }, []);

  return (
    <ClientIdentityContext.Provider value={value}>
      {children}
    </ClientIdentityContext.Provider>
  );
}

export function useClientIdentity() {
  const ctx = useContext(ClientIdentityContext);
  if (!ctx) throw new Error('useClientIdentity must be used within ClientIdentityProvider');
  return ctx;
}

export default ClientIdentityProvider;
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/modules/Media/session/ClientIdentityProvider.test.jsx`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/session/ClientIdentityProvider.jsx frontend/src/modules/Media/session/ClientIdentityProvider.test.jsx
git commit -m "feat(media): ClientIdentityProvider with localStorage-backed clientId/displayName"
```

---

## Task 11: useSessionController (local-only for P1)

**Files:**
- Create: `frontend/src/modules/Media/session/useSessionController.js`
- Test: `frontend/src/modules/Media/session/useSessionController.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Media/session/useSessionController.test.jsx
import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { LocalSessionContext } from './LocalSessionContext.js';
import { useSessionController } from './useSessionController.js';

function makeAdapter() {
  let snap = { state: 'idle', config: { volume: 50 } };
  const subs = new Set();
  return {
    getSnapshot: () => snap,
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
    transport: { play: () => {}, pause: () => {}, stop: () => {}, seekAbs: () => {}, seekRel: () => {}, skipNext: () => {}, skipPrev: () => {} },
    queue: { playNow: () => {}, playNext: () => {}, addUpNext: () => {}, add: () => {}, clear: () => {}, remove: () => {}, jump: () => {}, reorder: () => {} },
    config: { setShuffle: () => {}, setRepeat: () => {}, setShader: () => {}, setVolume: (v) => { snap = { ...snap, config: { ...snap.config, volume: v } }; subs.forEach(f => f(snap)); } },
    lifecycle: { reset: () => {}, adoptSnapshot: () => {} },
    portability: { snapshotForHandoff: () => ({}), receiveClaim: () => {} },
  };
}

describe('useSessionController', () => {
  it('returns snapshot + methods for target="local"', () => {
    const adapter = makeAdapter();
    const wrapper = ({ children }) => (
      <LocalSessionContext.Provider value={{ adapter }}>{children}</LocalSessionContext.Provider>
    );
    const { result } = renderHook(() => useSessionController('local'), { wrapper });
    expect(result.current.snapshot.state).toBe('idle');
    expect(typeof result.current.transport.play).toBe('function');
    expect(typeof result.current.queue.playNow).toBe('function');
  });

  it('re-renders with a fresh snapshot when adapter notifies', () => {
    const adapter = makeAdapter();
    const wrapper = ({ children }) => (
      <LocalSessionContext.Provider value={{ adapter }}>{children}</LocalSessionContext.Provider>
    );
    const { result } = renderHook(() => useSessionController('local'), { wrapper });
    expect(result.current.snapshot.config.volume).toBe(50);
    act(() => { result.current.config.setVolume(77); });
    expect(result.current.snapshot.config.volume).toBe(77);
  });

  it('throws for unsupported target in P1', () => {
    const wrapper = ({ children }) => (
      <LocalSessionContext.Provider value={{ adapter: makeAdapter() }}>{children}</LocalSessionContext.Provider>
    );
    expect(() => renderHook(() => useSessionController({ deviceId: 'x' }), { wrapper })).toThrow(/not implemented/i);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/modules/Media/session/useSessionController.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation (two files)**

```js
// frontend/src/modules/Media/session/LocalSessionContext.js
import { createContext } from 'react';

export const LocalSessionContext = createContext(null);
```

```js
// frontend/src/modules/Media/session/useSessionController.js
import { useContext, useEffect, useState } from 'react';
import { LocalSessionContext } from './LocalSessionContext.js';

export function useSessionController(target) {
  if (target !== 'local') {
    // RemoteSessionAdapter is P5. Fail fast for now.
    throw new Error('useSessionController: remote targets not implemented in P1');
  }
  const ctx = useContext(LocalSessionContext);
  if (!ctx) throw new Error('useSessionController must be inside LocalSessionProvider');
  const { adapter } = ctx;
  const [snapshot, setSnapshot] = useState(adapter.getSnapshot());

  useEffect(() => {
    setSnapshot(adapter.getSnapshot());
    return adapter.subscribe(setSnapshot);
  }, [adapter]);

  return {
    snapshot,
    transport: adapter.transport,
    queue: adapter.queue,
    config: adapter.config,
    lifecycle: adapter.lifecycle,
    portability: adapter.portability,
  };
}

export default useSessionController;
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/modules/Media/session/useSessionController.test.jsx`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/session/useSessionController.js frontend/src/modules/Media/session/useSessionController.test.jsx frontend/src/modules/Media/session/LocalSessionContext.js
git commit -m "feat(media): target-agnostic useSessionController (local only in P1)"
```

---

## Task 12: HiddenPlayerMount

**Files:**
- Create: `frontend/src/modules/Media/session/HiddenPlayerMount.jsx`
- Test: `frontend/src/modules/Media/session/HiddenPlayerMount.test.jsx`

> P1 scope: `HiddenPlayerMount` renders `<Player>` directly (no portal mechanics yet — that refactor lands in P2 when multiple canvas views appear). It reads `snapshot.currentItem` and pipes Player's `clear` (end) into `adapter.onPlayerEnded()`.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Media/session/HiddenPlayerMount.test.jsx
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { LocalSessionContext } from './LocalSessionContext.js';

// Stub Player to capture props
const playerPropsLog = [];
vi.mock('../../Player/Player.jsx', () => ({
  default: (props) => {
    playerPropsLog.push(props);
    return <div data-testid="player-stub">Player: {props.play?.contentId ?? 'none'}</div>;
  },
}));

import { HiddenPlayerMount } from './HiddenPlayerMount.jsx';

function mockAdapter(snapshot) {
  const subs = new Set();
  return {
    onPlayerEnded: vi.fn(),
    onPlayerError: vi.fn(),
    onPlayerStateChange: vi.fn(),
    onPlayerProgress: vi.fn(),
    getSnapshot: () => snapshot,
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
  };
}

describe('HiddenPlayerMount', () => {
  it('renders <Player> with play={currentItem} when snapshot has one', () => {
    playerPropsLog.length = 0;
    const adapter = mockAdapter({
      currentItem: { contentId: 'plex:1', format: 'video', title: 'T' },
      state: 'loading',
    });
    const { getByTestId } = render(
      <LocalSessionContext.Provider value={{ adapter }}>
        <HiddenPlayerMount />
      </LocalSessionContext.Provider>
    );
    expect(getByTestId('player-stub').textContent).toContain('plex:1');
    expect(playerPropsLog[0].play.contentId).toBe('plex:1');
  });

  it('does not render Player when currentItem is null', () => {
    const adapter = mockAdapter({ currentItem: null, state: 'idle' });
    const { queryByTestId } = render(
      <LocalSessionContext.Provider value={{ adapter }}>
        <HiddenPlayerMount />
      </LocalSessionContext.Provider>
    );
    expect(queryByTestId('player-stub')).toBeNull();
  });

  it('wires Player.clear to adapter.onPlayerEnded', () => {
    playerPropsLog.length = 0;
    const adapter = mockAdapter({
      currentItem: { contentId: 'plex:1', format: 'video' },
      state: 'playing',
    });
    render(
      <LocalSessionContext.Provider value={{ adapter }}>
        <HiddenPlayerMount />
      </LocalSessionContext.Provider>
    );
    playerPropsLog[0].clear();
    expect(adapter.onPlayerEnded).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/modules/Media/session/HiddenPlayerMount.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```jsx
// frontend/src/modules/Media/session/HiddenPlayerMount.jsx
import React, { useContext, useEffect, useState, useCallback } from 'react';
import Player from '../../Player/Player.jsx';
import { LocalSessionContext } from './LocalSessionContext.js';

function adaptForPlayer(currentItem) {
  if (!currentItem) return null;
  // Player expects a `play` object that it treats as PlayableItem-ish.
  // contentId + format + optional fields pass through; additional format-specific
  // fields on PlayableItem land here too.
  return { ...currentItem };
}

export function HiddenPlayerMount() {
  const ctx = useContext(LocalSessionContext);
  if (!ctx) throw new Error('HiddenPlayerMount must be inside LocalSessionProvider');
  const { adapter } = ctx;
  const [snapshot, setSnapshot] = useState(adapter.getSnapshot());

  useEffect(() => {
    setSnapshot(adapter.getSnapshot());
    return adapter.subscribe(setSnapshot);
  }, [adapter]);

  const onClear = useCallback(() => adapter.onPlayerEnded(), [adapter]);

  const playProp = adaptForPlayer(snapshot.currentItem);
  if (!playProp) return null;

  return (
    <div className="media-player-host">
      <Player play={playProp} clear={onClear} />
    </div>
  );
}

export default HiddenPlayerMount;
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/modules/Media/session/HiddenPlayerMount.test.jsx`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/session/HiddenPlayerMount.jsx frontend/src/modules/Media/session/HiddenPlayerMount.test.jsx
git commit -m "feat(media): HiddenPlayerMount renders Player wired to adapter"
```

---

## Task 13: LocalSessionProvider

**Files:**
- Create: `frontend/src/modules/Media/session/LocalSessionProvider.jsx`
- Test: `frontend/src/modules/Media/session/LocalSessionProvider.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Media/session/LocalSessionProvider.test.jsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

// Prevent real Player from rendering inside the provider
vi.mock('../../Player/Player.jsx', () => ({
  default: ({ play }) => <div data-testid="player-stub">{play?.contentId ?? 'none'}</div>,
}));

// Stub wsService to avoid real WebSocket
vi.mock('../../../services/WebSocketService.js', () => ({
  wsService: { send: vi.fn(), subscribe: vi.fn(() => () => {}), onStatusChange: vi.fn(() => () => {}) },
  default: { send: vi.fn(), subscribe: vi.fn(() => () => {}), onStatusChange: vi.fn(() => () => {}) },
}));

import { ClientIdentityProvider, CLIENT_ID_KEY } from './ClientIdentityProvider.jsx';
import { LocalSessionProvider } from './LocalSessionProvider.jsx';
import { useSessionController } from './useSessionController.js';

function Probe() {
  const ctl = useSessionController('local');
  return <div>state={ctl.snapshot.state};item={ctl.snapshot.currentItem?.contentId ?? 'none'}</div>;
}

describe('LocalSessionProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(CLIENT_ID_KEY, 'test-client-1234567890');
  });

  it('bootstraps an idle session when no localStorage', () => {
    render(
      <ClientIdentityProvider>
        <LocalSessionProvider>
          <Probe />
        </LocalSessionProvider>
      </ClientIdentityProvider>
    );
    expect(screen.getByText(/state=idle;item=none/)).toBeInTheDocument();
  });

  it('hydrates from persisted session', () => {
    localStorage.setItem('media-app.session', JSON.stringify({
      schemaVersion: 1,
      sessionId: 'old',
      updatedAt: 't',
      wasPlayingOnUnload: false,
      snapshot: {
        sessionId: 'old',
        state: 'paused',
        currentItem: { contentId: 'plex:99', format: 'video', title: 'Resumed' },
        position: 30,
        queue: { items: [], currentIndex: -1, upNextCount: 0 },
        config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
        meta: { ownerId: 'test-client-1234567890', updatedAt: '' },
      },
    }));
    render(
      <ClientIdentityProvider>
        <LocalSessionProvider>
          <Probe />
        </LocalSessionProvider>
      </ClientIdentityProvider>
    );
    expect(screen.getByText(/state=paused;item=plex:99/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/modules/Media/session/LocalSessionProvider.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```jsx
// frontend/src/modules/Media/session/LocalSessionProvider.jsx
import React, { useMemo, useEffect } from 'react';
import { LocalSessionContext } from './LocalSessionContext.js';
import { LocalSessionAdapter } from './LocalSessionAdapter.js';
import { useClientIdentity } from './ClientIdentityProvider.jsx';
import { HiddenPlayerMount } from './HiddenPlayerMount.jsx';
import {
  readPersistedSession,
  writePersistedSession,
  clearPersistedSession,
} from './persistence.js';
import { wsService } from '../../../services/WebSocketService.js';
import mediaLog from '../logging/mediaLog.js';

export function LocalSessionProvider({ children }) {
  const { clientId } = useClientIdentity();

  const adapter = useMemo(() => {
    const a = new LocalSessionAdapter({
      clientId,
      wsSend: (data) => wsService.send(data),
      persistence: {
        read: readPersistedSession,
        write: writePersistedSession,
        clear: clearPersistedSession,
      },
    });
    return a;
  }, [clientId]);

  useEffect(() => {
    mediaLog.mounted({ clientId });
    const persisted = readPersistedSession();
    if (persisted && persisted !== 'schema-mismatch') {
      mediaLog.sessionResumed({
        sessionId: persisted.snapshot.sessionId,
        resumedPosition: persisted.snapshot.position ?? 0,
      });
    }
    const onUnload = () => {
      // Best-effort final flush; adapter has already written on every change.
      try {
        wsService.send({
          topic: 'playback_state',
          clientId,
          sessionId: adapter.getSnapshot().sessionId,
          state: 'stopped',
          ts: new Date().toISOString(),
        });
      } catch { /* ignore */ }
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      mediaLog.unmounted({});
    };
  }, [adapter, clientId]);

  const value = useMemo(() => ({ adapter }), [adapter]);

  return (
    <LocalSessionContext.Provider value={value}>
      {children}
      <HiddenPlayerMount />
    </LocalSessionContext.Provider>
  );
}

export default LocalSessionProvider;
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/modules/Media/session/LocalSessionProvider.test.jsx`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/session/LocalSessionProvider.jsx frontend/src/modules/Media/session/LocalSessionProvider.test.jsx
git commit -m "feat(media): LocalSessionProvider wires adapter + persistence + hidden Player"
```

---

## Task 14: useUrlCommand

**Files:**
- Create: `frontend/src/modules/Media/externalControl/useUrlCommand.js`
- Test: `frontend/src/modules/Media/externalControl/useUrlCommand.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Media/externalControl/useUrlCommand.test.jsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useUrlCommand, URL_TOKEN_KEY } from './useUrlCommand.js';

function makeController() {
  return {
    snapshot: { state: 'idle', currentItem: null },
    queue: { playNow: vi.fn(), add: vi.fn() },
    config: { setShuffle: vi.fn(), setShader: vi.fn(), setVolume: vi.fn() },
  };
}

describe('useUrlCommand', () => {
  beforeEach(() => { localStorage.clear(); });

  it('invokes queue.playNow for ?play=<contentId>', () => {
    const ctl = makeController();
    renderHook(() => useUrlCommand(ctl, '?play=plex-main:12345'));
    expect(ctl.queue.playNow).toHaveBeenCalledWith({ contentId: 'plex-main:12345' }, { clearRest: true });
  });

  it('invokes queue.add for ?queue=<contentId>', () => {
    const ctl = makeController();
    renderHook(() => useUrlCommand(ctl, '?queue=plex:555'));
    expect(ctl.queue.add).toHaveBeenCalledWith({ contentId: 'plex:555' });
  });

  it('applies ?shuffle=1, ?shader=dark, ?volume=0.5 as config patches', () => {
    const ctl = makeController();
    renderHook(() => useUrlCommand(ctl, '?play=plex:1&shuffle=1&shader=dark&volume=0.5'));
    expect(ctl.config.setShuffle).toHaveBeenCalledWith(true);
    expect(ctl.config.setShader).toHaveBeenCalledWith('dark');
    expect(ctl.config.setVolume).toHaveBeenCalledWith(50); // 0.5 * 100
  });

  it('ignores duplicate URL command on remount (dedupe token)', () => {
    const ctl1 = makeController();
    renderHook(() => useUrlCommand(ctl1, '?play=plex:1'));
    expect(ctl1.queue.playNow).toHaveBeenCalledTimes(1);

    const ctl2 = makeController();
    renderHook(() => useUrlCommand(ctl2, '?play=plex:1'));
    expect(ctl2.queue.playNow).not.toHaveBeenCalled();
  });

  it('rejects remote-dispatch params silently (device=...)', () => {
    const ctl = makeController();
    renderHook(() => useUrlCommand(ctl, '?play=plex:1&device=livingroom-tv'));
    expect(ctl.queue.playNow).toHaveBeenCalled(); // play still honored
  });

  it('does nothing when search is empty', () => {
    const ctl = makeController();
    renderHook(() => useUrlCommand(ctl, ''));
    expect(ctl.queue.playNow).not.toHaveBeenCalled();
    expect(ctl.queue.add).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/modules/Media/externalControl/useUrlCommand.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// frontend/src/modules/Media/externalControl/useUrlCommand.js
import { useEffect, useRef } from 'react';
import mediaLog from '../logging/mediaLog.js';

export const URL_TOKEN_KEY = 'media-app.url-command-token';

function tokenFor(search) {
  // Cheap stable token — same string = same token
  return `v1:${search}`;
}

function parse(search) {
  if (!search) return null;
  const sp = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const play = sp.get('play');
  const queue = sp.get('queue');
  const shuffle = sp.get('shuffle') === '1';
  const shader = sp.get('shader');
  const volumeRaw = sp.get('volume');

  const unknownKeys = [];
  for (const k of sp.keys()) {
    if (!['play', 'queue', 'shuffle', 'shader', 'volume'].includes(k)) unknownKeys.push(k);
  }

  // Volume: spec says URL is 0..1 float; snapshot stores 0..100 int.
  let volume;
  if (volumeRaw != null) {
    const n = Number(volumeRaw);
    if (Number.isFinite(n)) {
      volume = n <= 1 ? Math.round(n * 100) : Math.max(0, Math.min(100, Math.round(n)));
    }
  }

  if (!play && !queue && volume == null && shader == null && !shuffle) return null;

  return { play, queue, shuffle, shader, volume, unknownKeys };
}

export function useUrlCommand(controller, searchString = typeof window !== 'undefined' ? window.location.search : '') {
  const appliedRef = useRef(false);

  useEffect(() => {
    if (appliedRef.current || !controller) return;
    const cmd = parse(searchString);
    if (!cmd) return;

    const token = tokenFor(searchString);
    const last = localStorage.getItem(URL_TOKEN_KEY);
    if (last === token) {
      mediaLog.urlCommandIgnored({ reason: 'dedupe', token });
      appliedRef.current = true;
      return;
    }

    for (const k of cmd.unknownKeys) {
      mediaLog.urlCommandIgnored({ reason: 'unknown-key', key: k });
    }

    if (cmd.shuffle) controller.config.setShuffle(true);
    if (cmd.shader != null) controller.config.setShader(cmd.shader);
    if (cmd.volume != null) controller.config.setVolume(cmd.volume);

    if (cmd.play) {
      controller.queue.playNow({ contentId: cmd.play }, { clearRest: true });
      mediaLog.urlCommandProcessed({ param: 'play', value: cmd.play });
    }
    if (cmd.queue) {
      controller.queue.add({ contentId: cmd.queue });
      mediaLog.urlCommandProcessed({ param: 'queue', value: cmd.queue });
    }

    try { localStorage.setItem(URL_TOKEN_KEY, token); } catch { /* ignore */ }
    appliedRef.current = true;
  }, [controller, searchString]);
}

export default useUrlCommand;
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/modules/Media/externalControl/useUrlCommand.test.jsx`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/externalControl/useUrlCommand.js frontend/src/modules/Media/externalControl/useUrlCommand.test.jsx
git commit -m "feat(media): URL command processor with dedupe + volume normalization"
```

---

## Task 15: usePlaybackStateBroadcast

**Files:**
- Create: `frontend/src/modules/Media/shared/usePlaybackStateBroadcast.js`
- Test: `frontend/src/modules/Media/shared/usePlaybackStateBroadcast.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Media/shared/usePlaybackStateBroadcast.test.jsx
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePlaybackStateBroadcast } from './usePlaybackStateBroadcast.js';

describe('usePlaybackStateBroadcast', () => {
  let send;
  beforeEach(() => { vi.useFakeTimers(); send = vi.fn(); });
  afterEach(() => { vi.useRealTimers(); });

  it('emits a playback_state message on mount reflecting current state', () => {
    renderHook(() => usePlaybackStateBroadcast({
      send,
      clientId: 'c1',
      displayName: 'D',
      snapshot: {
        sessionId: 's1', state: 'playing',
        currentItem: { contentId: 'p:1', format: 'video', title: 'T', duration: 60 },
        position: 2,
        config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
      },
    }));
    expect(send).toHaveBeenCalled();
    const msg = send.mock.calls[0][0];
    expect(msg.topic).toBe('playback_state');
    expect(msg.clientId).toBe('c1');
    expect(msg.sessionId).toBe('s1');
    expect(msg.state).toBe('playing');
    expect(msg.currentItem.contentId).toBe('p:1');
  });

  it('re-emits when snapshot.state changes', () => {
    const { rerender } = renderHook(({ snap }) => usePlaybackStateBroadcast({
      send, clientId: 'c1', displayName: 'D', snapshot: snap,
    }), { initialProps: { snap: { sessionId: 's1', state: 'loading', currentItem: null, position: 0, config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 } } } });
    send.mockClear();
    rerender({ snap: { sessionId: 's1', state: 'playing', currentItem: null, position: 0, config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 } } });
    expect(send).toHaveBeenCalled();
    expect(send.mock.calls[0][0].state).toBe('playing');
  });

  it('heartbeats every 5s while playing', () => {
    renderHook(() => usePlaybackStateBroadcast({
      send, clientId: 'c1', displayName: 'D',
      snapshot: { sessionId: 's1', state: 'playing', currentItem: null, position: 0, config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 } },
    }));
    send.mockClear();
    act(() => { vi.advanceTimersByTime(5100); });
    expect(send).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(5100); });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('emits terminal stopped on unmount', () => {
    const { unmount } = renderHook(() => usePlaybackStateBroadcast({
      send, clientId: 'c1', displayName: 'D',
      snapshot: { sessionId: 's1', state: 'playing', currentItem: null, position: 0, config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 } },
    }));
    send.mockClear();
    unmount();
    expect(send).toHaveBeenCalled();
    expect(send.mock.calls[send.mock.calls.length - 1][0].state).toBe('stopped');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/modules/Media/shared/usePlaybackStateBroadcast.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// frontend/src/modules/Media/shared/usePlaybackStateBroadcast.js
import { useEffect, useRef } from 'react';

function buildMessage({ clientId, sessionId, displayName, state, currentItem, position, config }) {
  return {
    topic: 'playback_state',
    clientId,
    sessionId,
    displayName,
    state,
    currentItem: currentItem ?? null,
    position: position ?? 0,
    duration: currentItem?.duration ?? null,
    config: config ?? null,
    ts: new Date().toISOString(),
  };
}

export function usePlaybackStateBroadcast({ send, clientId, displayName, snapshot }) {
  const lastStateRef = useRef(null);

  useEffect(() => {
    if (!snapshot) return;
    // Always emit on mount + every state change
    if (lastStateRef.current !== snapshot.state) {
      send(buildMessage({
        clientId, displayName,
        sessionId: snapshot.sessionId,
        state: snapshot.state,
        currentItem: snapshot.currentItem,
        position: snapshot.position,
        config: snapshot.config,
      }));
      lastStateRef.current = snapshot.state;
    }
  }, [send, clientId, displayName, snapshot?.state, snapshot?.sessionId, snapshot?.currentItem, snapshot?.position, snapshot?.config, snapshot]);

  // Heartbeat while playing
  useEffect(() => {
    if (!snapshot || snapshot.state !== 'playing') return undefined;
    const id = setInterval(() => {
      send(buildMessage({
        clientId, displayName,
        sessionId: snapshot.sessionId,
        state: snapshot.state,
        currentItem: snapshot.currentItem,
        position: snapshot.position,
        config: snapshot.config,
      }));
    }, 5000);
    return () => clearInterval(id);
  }, [send, clientId, displayName, snapshot?.state, snapshot?.sessionId, snapshot]);

  // Terminal stopped on unmount
  useEffect(() => {
    return () => {
      send({
        topic: 'playback_state',
        clientId,
        sessionId: snapshot?.sessionId,
        displayName,
        state: 'stopped',
        currentItem: null,
        position: 0,
        ts: new Date().toISOString(),
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export default usePlaybackStateBroadcast;
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/modules/Media/shared/usePlaybackStateBroadcast.test.jsx`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/shared/usePlaybackStateBroadcast.js frontend/src/modules/Media/shared/usePlaybackStateBroadcast.test.jsx
git commit -m "feat(media): usePlaybackStateBroadcast (state-change + 5s heartbeat + terminal stopped)"
```

---

## Task 16: Wire URL command + broadcast inside LocalSessionProvider

**Files:**
- Modify: `frontend/src/modules/Media/session/LocalSessionProvider.jsx`
- Modify: `frontend/src/modules/Media/session/LocalSessionProvider.test.jsx`

> This task connects Tasks 14 + 15 into the provider. A small inner component reads the controller + identity + wsService and mounts the two hooks.

- [ ] **Step 1: Add failing test (URL autoplay lands through provider)**

Append to `LocalSessionProvider.test.jsx`:

```jsx
describe('LocalSessionProvider — URL + broadcast wiring', () => {
  it('processes ?play=... on mount', () => {
    // Stash the search before rendering
    const origSearch = window.location.search;
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '?play=plex-main:77' },
      configurable: true,
    });
    try {
      render(
        <ClientIdentityProvider>
          <LocalSessionProvider>
            <Probe />
          </LocalSessionProvider>
        </ClientIdentityProvider>
      );
      expect(screen.getByText(/item=plex-main:77/)).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, 'location', {
        value: { ...window.location, search: origSearch },
        configurable: true,
      });
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/modules/Media/session/LocalSessionProvider.test.jsx`
Expected: FAIL — URL command not processed.

- [ ] **Step 3: Wire it**

Edit `LocalSessionProvider.jsx` — add an `UrlAndBroadcastMount` child and mount it inside the Provider:

```jsx
// near the top of LocalSessionProvider.jsx, add:
import { useSessionController } from './useSessionController.js';
import { useUrlCommand } from '../externalControl/useUrlCommand.js';
import { usePlaybackStateBroadcast } from '../shared/usePlaybackStateBroadcast.js';

function UrlAndBroadcastMount() {
  const { clientId, displayName } = useClientIdentity();
  const controller = useSessionController('local');
  useUrlCommand(controller);
  usePlaybackStateBroadcast({
    send: (data) => wsService.send(data),
    clientId,
    displayName,
    snapshot: controller.snapshot,
  });
  return null;
}
```

Then replace the provider return with:

```jsx
  return (
    <LocalSessionContext.Provider value={value}>
      <UrlAndBroadcastMount />
      {children}
      <HiddenPlayerMount />
    </LocalSessionContext.Provider>
  );
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/modules/Media/session/LocalSessionProvider.test.jsx`
Expected: PASS (all tests including URL wiring).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/session/LocalSessionProvider.jsx frontend/src/modules/Media/session/LocalSessionProvider.test.jsx
git commit -m "feat(media): wire URL command + playback_state broadcast into LocalSessionProvider"
```

---

## Task 17: Shell components (Dock + MiniPlayer + NowPlayingView + Canvas + MediaAppShell)

**Files:**
- Create: `frontend/src/modules/Media/shell/MiniPlayer.jsx`
- Create: `frontend/src/modules/Media/shell/NowPlayingView.jsx`
- Create: `frontend/src/modules/Media/shell/Canvas.jsx`
- Create: `frontend/src/modules/Media/shell/Dock.jsx`
- Create: `frontend/src/modules/Media/shell/MediaAppShell.jsx`
- Test: `frontend/src/modules/Media/shell/MediaAppShell.test.jsx`

> P1 shell is intentionally tiny — text only, no styling. These components will grow in P2. Tests assert render + basic interactivity only.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Media/shell/MediaAppShell.test.jsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../Player/Player.jsx', () => ({
  default: ({ play }) => <div data-testid="player-stub">Player: {play?.contentId ?? 'none'}</div>,
}));
vi.mock('../../../services/WebSocketService.js', () => ({
  wsService: { send: vi.fn(), subscribe: vi.fn(() => () => {}), onStatusChange: vi.fn(() => () => {}) },
  default: { send: vi.fn(), subscribe: vi.fn(() => () => {}), onStatusChange: vi.fn(() => () => {}) },
}));

import { ClientIdentityProvider, CLIENT_ID_KEY } from '../session/ClientIdentityProvider.jsx';
import { LocalSessionProvider } from '../session/LocalSessionProvider.jsx';
import { MediaAppShell } from './MediaAppShell.jsx';

describe('MediaAppShell', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(CLIENT_ID_KEY, 'shell-client-1');
  });

  it('renders Dock + Canvas + Player host', () => {
    render(
      <ClientIdentityProvider>
        <LocalSessionProvider>
          <MediaAppShell />
        </LocalSessionProvider>
      </ClientIdentityProvider>
    );
    expect(screen.getByTestId('media-dock')).toBeInTheDocument();
    expect(screen.getByTestId('media-canvas')).toBeInTheDocument();
  });

  it('reset button clears the session', () => {
    // Preload a session so there is something to reset
    localStorage.setItem('media-app.session', JSON.stringify({
      schemaVersion: 1, sessionId: 'old', updatedAt: 't', wasPlayingOnUnload: false,
      snapshot: {
        sessionId: 'old', state: 'paused',
        currentItem: { contentId: 'plex:42', format: 'video' },
        position: 0,
        queue: { items: [{ queueItemId: 'q1', contentId: 'plex:42', format: 'video', priority: 'queue', addedAt: '' }], currentIndex: 0, upNextCount: 0 },
        config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
        meta: { ownerId: 'shell-client-1', updatedAt: '' },
      },
    }));

    render(
      <ClientIdentityProvider>
        <LocalSessionProvider>
          <MediaAppShell />
        </LocalSessionProvider>
      </ClientIdentityProvider>
    );

    expect(screen.getByText(/now playing.*plex:42/i)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('session-reset-btn'));
    expect(screen.queryByText(/now playing.*plex:42/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/modules/Media/shell/MediaAppShell.test.jsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create the five shell files**

```jsx
// frontend/src/modules/Media/shell/MiniPlayer.jsx
import React from 'react';
import { useSessionController } from '../session/useSessionController.js';

export function MiniPlayer() {
  const { snapshot, transport } = useSessionController('local');
  const item = snapshot.currentItem;
  if (!item) return <div data-testid="media-mini-player">Idle</div>;
  return (
    <div data-testid="media-mini-player">
      <span>Now playing: {item.title ?? item.contentId}</span>
      <button onClick={transport.pause} data-testid="mini-pause">Pause</button>
      <button onClick={transport.play} data-testid="mini-play">Play</button>
    </div>
  );
}

export default MiniPlayer;
```

```jsx
// frontend/src/modules/Media/shell/NowPlayingView.jsx
import React from 'react';
import { useSessionController } from '../session/useSessionController.js';

export function NowPlayingView() {
  const { snapshot } = useSessionController('local');
  const item = snapshot.currentItem;
  return (
    <div data-testid="now-playing-view">
      <h2>Now Playing: {item?.contentId ?? 'nothing'}</h2>
      <div>state: {snapshot.state}</div>
      <div>position: {Math.round(snapshot.position ?? 0)}s</div>
    </div>
  );
}

export default NowPlayingView;
```

```jsx
// frontend/src/modules/Media/shell/Canvas.jsx
import React from 'react';
import { NowPlayingView } from './NowPlayingView.jsx';

// In P1, the canvas is always the NowPlayingView. P2 will introduce the view registry.
export function Canvas() {
  return (
    <div data-testid="media-canvas">
      <NowPlayingView />
    </div>
  );
}

export default Canvas;
```

```jsx
// frontend/src/modules/Media/shell/Dock.jsx
import React from 'react';
import { MiniPlayer } from './MiniPlayer.jsx';
import { useSessionController } from '../session/useSessionController.js';

export function Dock() {
  const { lifecycle } = useSessionController('local');
  return (
    <div data-testid="media-dock">
      <MiniPlayer />
      <button data-testid="session-reset-btn" onClick={lifecycle.reset}>Reset session</button>
    </div>
  );
}

export default Dock;
```

```jsx
// frontend/src/modules/Media/shell/MediaAppShell.jsx
import React from 'react';
import { Dock } from './Dock.jsx';
import { Canvas } from './Canvas.jsx';

export function MediaAppShell() {
  return (
    <div className="media-app-shell">
      <Dock />
      <Canvas />
    </div>
  );
}

export default MediaAppShell;
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/modules/Media/shell/MediaAppShell.test.jsx`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/shell/
git commit -m "feat(media): P1 shell (Dock + MiniPlayer + Canvas + NowPlayingView + MediaAppShell)"
```

---

## Task 18: MediaApp.jsx entry

**Files:**
- Create: `frontend/src/Apps/MediaApp.jsx`
- Test: `frontend/src/Apps/MediaApp.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/Apps/MediaApp.test.jsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../modules/Player/Player.jsx', () => ({
  default: ({ play }) => <div data-testid="player-stub">Player: {play?.contentId ?? 'none'}</div>,
}));
vi.mock('../services/WebSocketService.js', () => ({
  wsService: { send: vi.fn(), subscribe: vi.fn(() => () => {}), onStatusChange: vi.fn(() => () => {}) },
  default: { send: vi.fn(), subscribe: vi.fn(() => () => {}), onStatusChange: vi.fn(() => () => {}) },
}));

import MediaApp from './MediaApp.jsx';

describe('MediaApp', () => {
  beforeEach(() => { localStorage.clear(); });

  it('renders the shell inside the provider stack', () => {
    render(<MediaApp />);
    expect(screen.getByTestId('media-dock')).toBeInTheDocument();
    expect(screen.getByTestId('media-canvas')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/Apps/MediaApp.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the entry**

```jsx
// frontend/src/Apps/MediaApp.jsx
import React from 'react';
import { ClientIdentityProvider } from '../modules/Media/session/ClientIdentityProvider.jsx';
import { LocalSessionProvider } from '../modules/Media/session/LocalSessionProvider.jsx';
import { MediaAppShell } from '../modules/Media/shell/MediaAppShell.jsx';

export default function MediaApp() {
  return (
    <ClientIdentityProvider>
      <LocalSessionProvider>
        <MediaAppShell />
      </LocalSessionProvider>
    </ClientIdentityProvider>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/Apps/MediaApp.test.jsx`
Expected: PASS (1/1).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/Apps/MediaApp.jsx frontend/src/Apps/MediaApp.test.jsx
git commit -m "feat(media): MediaApp.jsx entry (P1: ClientIdentity + LocalSession + Shell)"
```

---

## Task 19: Register /media route in main.jsx

**Files:**
- Modify: `frontend/src/main.jsx`

- [ ] **Step 1: Add the import**

In `frontend/src/main.jsx`, add to the imports block (after the other `Apps/*` imports):

```jsx
import MediaApp from './Apps/MediaApp.jsx';
```

- [ ] **Step 2: Register the route**

Inside the `<Routes>` block, add a new route **before** the existing `/media/channels/*` line (so the more-specific channels route still wins):

```jsx
        <Route path="/media" element={<MediaApp />} />
```

The two media routes should now look like:

```jsx
        <Route path="/media" element={<MediaApp />} />
        <Route path="/media/channels/*" element={<LiveStreamApp />} />
```

- [ ] **Step 3: Verify the dev server renders /media**

Check the dev server is running: `lsof -i :3112 || ss -tlnp | grep 3112`. If not, start it per CLAUDE.md: `node backend/index.js` in one terminal; `cd frontend && npm run dev` in another.

Open `http://localhost:3112/media` in a browser. Expected:
- Page renders with text "Idle" (MiniPlayer), a "Reset session" button, and "Now Playing: nothing".

Open `http://localhost:3112/media?play=plex:100` in a browser. Expected:
- Page renders with "Now playing: plex:100" (mini-player) and "Now Playing: plex:100" (canvas).
- Network tab shows a `/api/v1/play/plex/100` request from the `<Player>` component (404 is OK for this smoke test — means the wiring reached the Player).

If any of the above fails, fix before committing.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/main.jsx
git commit -m "feat(media): register /media route to MediaApp

MediaApp handles the root /media path; /media/channels/* continues
to route to LiveStreamApp (LiveStream channel admin is a separate
surface per docs/reference/media/media-app-requirements.md)."
```

---

## Task 20: Playwright end-to-end autoplay test

**Files:**
- Create: `tests/live/flow/media/media-app-autoplay.runtime.test.mjs`

> This test runs against the actual dev server (via the Playwright config's `webServer`). It verifies the P1 happy path end-to-end.

- [ ] **Step 1: Check neighboring Playwright test for conventions**

Run (from repo root): `ls tests/live/flow/ | head`
Expected output: directories for `fitness/`, `screen/`, etc. — existing `.runtime.test.mjs` files follow a known pattern.

Open any one (e.g., `tests/live/flow/screen/office-menu.runtime.test.mjs`) and skim the import style.

- [ ] **Step 2: Write the test**

```javascript
// tests/live/flow/media/media-app-autoplay.runtime.test.mjs
import { test, expect } from '@playwright/test';

test.describe('MediaApp — P1 foundation', () => {
  test.beforeEach(async ({ page }) => {
    // Ensure a clean slate (no prior session, no prior URL dedupe token)
    await page.goto('/media');
    await page.evaluate(() => {
      localStorage.removeItem('media-app.session');
      localStorage.removeItem('media-app.url-command-token');
    });
  });

  test('renders an idle shell at /media', async ({ page }) => {
    await page.goto('/media');
    await expect(page.getByTestId('media-dock')).toBeVisible();
    await expect(page.getByTestId('media-canvas')).toBeVisible();
    await expect(page.getByText(/now playing: nothing/i)).toBeVisible();
  });

  test('autoplays content via ?play=<contentId>', async ({ page }) => {
    await page.goto('/media?play=plex-main:12345');
    await expect(page.getByText(/now playing: plex-main:12345/i)).toBeVisible({ timeout: 10000 });
  });

  test('resumes a persisted session after reload', async ({ page }) => {
    await page.goto('/media?play=plex-main:99999');
    await expect(page.getByText(/plex-main:99999/)).toBeVisible({ timeout: 10000 });

    // Navigate to a bare URL — no autoplay param
    await page.goto('/media');
    // The persisted session should re-hydrate and show the same current item
    await expect(page.getByText(/plex-main:99999/)).toBeVisible({ timeout: 5000 });
  });

  test('reset clears the persisted session', async ({ page }) => {
    await page.goto('/media?play=plex-main:abcd');
    await expect(page.getByText(/plex-main:abcd/)).toBeVisible({ timeout: 10000 });
    await page.getByTestId('session-reset-btn').click();
    await expect(page.getByText(/now playing: nothing/i)).toBeVisible();

    const persisted = await page.evaluate(() => localStorage.getItem('media-app.session'));
    expect(persisted).toBeNull();
  });
});
```

- [ ] **Step 3: Verify the dev server is up and run the test**

First check: `lsof -i :3112 || ss -tlnp | grep 3112`. If no server: start with `node backend/index.js` + `cd frontend && npm run dev`.

Then run from repo root:

```bash
npx playwright test tests/live/flow/media/media-app-autoplay.runtime.test.mjs --reporter=line
```

Expected: all 4 tests PASS.

If the autoplay test fails because the content ID does not resolve (404 from `/api/v1/play/...`), that is acceptable for this P1 test — the assertion is on the *Now Playing* text, not on actual playback success. Player will surface its own error UI; the `Now Playing: plex-main:12345` header is produced by `NowPlayingView` from `snapshot.currentItem` which comes from URL processing BEFORE any API call.

If the resume-after-reload test fails: check that `media-app.session` is actually in localStorage after the first navigate by running a quick `await page.evaluate(() => localStorage.getItem('media-app.session'))` in a debugging invocation.

- [ ] **Step 4: Commit**

```bash
git add tests/live/flow/media/media-app-autoplay.runtime.test.mjs
git commit -m "test(media): end-to-end P1 happy path (autoplay + resume + reset)"
```

---

## Task 21: Full green bar + docs ping

- [ ] **Step 1: Run the full Media App test suite**

```bash
cd frontend && npx vitest run src/modules/Media src/Apps/MediaApp.test.jsx
```

Expected: all tests PASS. Full count: ~45 tests.

- [ ] **Step 2: Run the Playwright smoke**

```bash
npx playwright test tests/live/flow/media/ --reporter=line
```

Expected: all 4 tests PASS.

- [ ] **Step 3: Verify no accidental raw console calls**

```bash
grep -RE "console\.(log|debug|warn|error)" frontend/src/modules/Media/ frontend/src/Apps/MediaApp.jsx
```

Expected: empty output. Per CLAUDE.md, diagnostic logging MUST go through the `mediaLog` facade.

- [ ] **Step 4: Confirm the design doc is up to date**

Read `docs/superpowers/specs/2026-04-18-media-app-skeleton-design.md`. For anything in P1 that diverged from the spec (e.g., simplified HiddenPlayerMount without portal), leave a short note in §13 "Open Questions for the Implementation Plan" so P2 picks up the thread.

- [ ] **Step 5: Final commit + summary**

If any doc edit is needed:

```bash
git add docs/superpowers/specs/2026-04-18-media-app-skeleton-design.md
git commit -m "docs(media): note P1 deviations for P2 pickup"
```

Report results back to the user: count of files created, count of tests passing, whether /media renders an idle shell and autoplays via URL, whether reload resumes. P1 is complete when all three hold.

---

## Requirements traceability for P1

| Spec requirement | Covered by task |
|---|---|
| C2.1 one local session | Task 8 (adapter constructor) |
| C2.2 localStorage persistence + resume | Tasks 3, 4, 8, 13 |
| C2.3 explicit reset | Task 9 (lifecycle.reset) + Task 17 (reset button) |
| C2.4 Player delegation (no format branching in app) | Task 12 (HiddenPlayerMount uses Player) |
| C3.1 Plex MP queue ops | Task 6 |
| C3.2 remove/reorder/jump/clear | Task 6 |
| C3.3 shuffle / repeat modes | Tasks 5, 7, 9 |
| C3.4 queue ops available without playback | Tasks 6, 9 |
| C8.1 URL deep-link | Task 14 |
| C8.2 reject remote-dispatch URL params | Task 14 |
| C8.3 playback_state broadcast | Task 15 |
| C9.1 survive reload | Tasks 3, 4, 13 |
| C9.3 stall / auto-advance on error | Task 9 (onPlayerError → advance) |
| C9.5 auto-advance on error + retry affordance | Task 9 |
| C10.1 structured logging | Task 1, used throughout |
| C10.2 no raw console.* | Task 21 grep |
| C10.3 5s heartbeat + terminal stopped | Task 15 |

Deferred to later phases (flagged in spec §11 as out of scope for P1):

- C1 discovery (P2), C4–C6 fleet/peek/dispatch (P3–P5), C7 portability (P6), C8.4 external control (P7), all UI-styling work.

---

## Self-review notes

- **Spec coverage:** all C2, C3, C8 (except external control), and C10 items are implemented by a numbered task. Fleet/peek/dispatch intentionally deferred per plan scope.
- **Types consistency:** `useSessionController` signature is `useSessionController(target)` everywhere (Tasks 11, 14, 17). Adapter methods named consistently (`transport.play`, `queue.playNow`, `config.setVolume`, `lifecycle.reset`, `portability.snapshotForHandoff`). `snapshot` shape matches §9.2 via `createIdleSessionSnapshot` factory.
- **No placeholders:** every task has exact file paths, actual code, runnable commands, and explicit expected outputs.
- **Known simplification for P1:** `HiddenPlayerMount` does not yet implement the portal mechanic described in the spec (portal into NowPlayingView). P2 (Discovery — introduces Browse/Detail/Home canvas views) will refactor HiddenPlayerMount to use React portals once there is more than one canvas view to teleport between. Task 12 explicitly calls this out.

---

# Appendix: Upcoming Phases (P2–P7)

This appendix is **not** a plan — it's a reminder scaffold for sub-plans that will be written in their own time. Each phase produces a working, testable milestone that slots into the P1 foundation without refactoring it.

Spec reference throughout: `docs/superpowers/specs/2026-04-18-media-app-skeleton-design.md`.

## P2 — Discovery

**Goal:** Search + Browse + Detail + Home, plus the multi-view Canvas refactor (including the HiddenPlayerMount → portal migration deferred from P1 Task 12).

**After milestone:** user can live-search the catalog, browse hierarchically, open a detail view, and dispatch Plex MP queue actions into the local session — all while local playback continues uninterrupted across canvas navigation.

**New files:**
- `frontend/src/modules/Media/search/SearchProvider.jsx` — scopes config (`/api/v1/media/config`); `media-scope-*` localStorage keys
- `frontend/src/modules/Media/search/useLiveSearch.js` — SSE consumer of `/api/v1/content/query/search/stream`
- `frontend/src/modules/Media/search/SearchBar.jsx` — dock component; always visible (C1.1)
- `frontend/src/modules/Media/search/SearchResults.jsx` — inline-actionable results (C1.1a)
- `frontend/src/modules/Media/browse/useListBrowse.js` — paginated `/api/v1/list/*`
- `frontend/src/modules/Media/browse/useContentInfo.js` — `/api/v1/info/:source/*`
- `frontend/src/modules/Media/browse/BrowseView.jsx`, `DetailView.jsx`, `HomeView.jsx`

**Refactors in P1 modules:**
- `shell/Canvas.jsx` — introduce view registry (`home | browse | detail | nowPlaying`) and nav state (still client-side for v1; URL-backed routing is a further follow-up)
- `session/HiddenPlayerMount.jsx` — refactor to be truly hidden + portal-target-driven so Player survives view changes. Add `usePlayerHost()` in `LocalSessionProvider` exposing a setter that `NowPlayingView` calls to claim the Player, falling back to the hidden container on unmount.
- `shell/Dock.jsx` — wire `SearchBar` into the dock

**Spec §:** C1.1–C1.4, C3 (Plex MP actions from search/detail into controller). Technical: §2.1, §2.2.

**Open v1 question to resolve in P2:** HomeView config source — extend `/api/v1/media/config` with a `home` block, or hardcode v1 paths? (Listed in spec §13.)

---

## P3 — Fleet Observation

**Goal:** Enumerate devices, live-observe per-device session state, surface offline/stale state.

**After milestone:** user can see the full remote fleet with live status and current-item summary. Read-only — no transport or queue control yet.

**New files:**
- `frontend/src/modules/Media/fleet/FleetProvider.jsx` — `GET /api/v1/device/config` on mount; subscribes to `device-state:<id>`, `device-ack:<id>`, `client-control:<clientId>` for every device
- `frontend/src/modules/Media/fleet/subscriptions.js` — WS topic wiring + `device-ack` routing
- `frontend/src/modules/Media/fleet/useDevice.js`, `useFleetSummary.js`
- `frontend/src/modules/Media/shell/FleetView.jsx`, `FleetIndicator.jsx`

**Refactors:**
- `MediaApp.jsx` — insert `<FleetProvider>` below `<LocalSessionProvider>`
- `shell/Dock.jsx` — add `FleetIndicator`
- `shell/Canvas.jsx` — add `fleet` view

**Spec §:** C4.1, C4.2, C4.4, C9.4, C9.6, N2.1. Technical: §2.3, §4.1, §6.4, §7.2–§7.4, §9.5, §9.7.

**Key behaviors:**
- WS reconnect logic; mark all devices stale on drop; backend replays last snapshots on re-subscribe
- Poll `/device/config` on `visibilitychange:visible` for config drift
- `device-ack:<id>` routing pipe ready for P5 (RemoteSessionAdapter will hook into it)

**Deferred:** C4.3 remote history — see spec §3 ("Deferred — out of scope for v1").

---

## P4 — Cast / Dispatch

**Goal:** User picks a target (device or multi-select) and dispatches content with Transfer/Fork mode. Dispatch progress is live. Idempotent, retryable.

**After milestone:** J3 fully satisfied (dispatch to remote). Local session unaffected (fork) or stopped on confirmed success (transfer).

**New files:**
- `frontend/src/modules/Media/cast/CastTargetProvider.jsx` — `{ mode, targets[] }`, persisted to `media-app.cast-target`
- `frontend/src/modules/Media/cast/useCastTarget.js`
- `frontend/src/modules/Media/cast/CastButton.jsx`, `CastTargetChip.jsx`, `CastPopover.jsx`
- `frontend/src/modules/Media/cast/DispatchProvider.jsx` — `Map<dispatchId, {steps, status, ...}>`
- `frontend/src/modules/Media/cast/useDispatch.js` — fan-out (§4.8), per-op `homeline:<id>` subscribe/unsubscribe, idempotency cache
- `frontend/src/modules/Media/cast/DispatchProgressTray.jsx`

**Refactors:**
- `MediaApp.jsx` — insert `<CastTargetProvider>` + `<DispatchProvider>`
- `shell/Dock.jsx` — add `CastTargetChip` + `DispatchProgressTray`
- `browse/DetailView.jsx` + `search/SearchResults.jsx` — add `CastButton`

**Spec §:** C6.*, C9.8 (idempotency). Technical: §2.3 (`/device/:id/load`), §4.7, §4.8, §7.2, §9.9, §10.1 (dispatch events).

**Key behaviors:**
- `dispatchId` generated per target; reused if identical params arrive within 60s (idempotency)
- On all-success with mode=transfer: call local `transport.stop()`
- On any failure: retry affordance via `lastAttempt`

---

## P5 — Peek (remote control)

**Goal:** `useSessionController({deviceId})` works — the target-agnostic interface, same shape as local, but backed by REST + ack lifecycle + reconciliation with `device-state` feed.

**After milestone:** J5 fully satisfied. UI components (transport bar, queue panel) that were authored for local now work for remote too with zero changes.

**New files:**
- `frontend/src/modules/Media/session/RemoteSessionAdapter.js` — same controller surface as LocalSessionAdapter; reads snapshot from FleetProvider; writes via `POST /device/:id/session/{transport,queue/:op}` + `PUT /device/:id/session/{shuffle,repeat,shader,volume}`; `commandId` lifecycle; ack timeout
- `frontend/src/modules/Media/peek/PeekProvider.jsx` — `Map<deviceId, {controller, enteredAt, savedLocalIntent}>`
- `frontend/src/modules/Media/peek/usePeek.js`
- `frontend/src/modules/Media/peek/PeekPanel.jsx`

**Refactors:**
- `session/useSessionController.js` — remove the P1 "not implemented" throw; route `{deviceId}` target through `PeekProvider`
- `MediaApp.jsx` — insert `<PeekProvider>`
- `shell/Canvas.jsx` — add `peek` view keyed by `deviceId`
- `shell/FleetView.jsx` — add "Peek" entry button per device

**Spec §:** C5.*, N4.1 (concurrency), N4.2 (last-writer-wins at device). Technical: §4.1, §4.3, §4.4, §4.5, §6.3, §9.8.

**Open policy question from spec §13:** default for C5.6 (pause local on peek entry) — implicit or configurable?

---

## P6 — Session Portability

**Goal:** Take Over (remote → local) and Hand Off (local → remote, Transfer + Fork).

**After milestone:** J6 + J7 satisfied. A session can move atomically between any two surfaces.

**New files (minimal — mostly wiring):**
- `frontend/src/modules/Media/cast/useHandOff.js` — local→remote, composes `snapshotForHandoff()` + `DispatchProvider.dispatchToTarget({mode:'adopt', snapshot})`
- `frontend/src/modules/Media/cast/useTakeOver.js` — remote→local, calls `POST /device/:id/session/claim` then `LocalSessionAdapter.portability.receiveClaim(snapshot)`

**UI additions:**
- `shell/FleetView.jsx` — add "Take Over" per device
- `shell/MiniPlayer.jsx` or `NowPlayingView.jsx` — add "Hand Off to…" with device picker

**Spec §:** C7.*, C9.8. Technical: §4.6 (claim endpoint), §4.7 (adopt-mode dispatch), §6.2.4 (`adopt-snapshot` command).

**Key behaviors:**
- Atomicity (C7.4): if claim returns 502 `ATOMICITY_VIOLATION`, local untouched, hard error (no auto-retry)
- Hand Off Transfer: stop local only after target confirms `playing` via `device-state`
- 2-second position tolerance (C7.3) — primarily a backend concern, asserted here

---

## P7 — External Integration

**Goal:** External systems drive the local session over WebSocket.

**After milestone:** C8.4 satisfied — other browsers, home automation, dashboards, etc. can issue `transport`/`queue`/`config`/`adopt-snapshot`/`system` commands targeting this client's local session.

**New files:**
- `frontend/src/modules/Media/externalControl/useExternalControl.js` — subscribes to `client-control:<clientId>` (via FleetProvider's existing subscription); validates `CommandEnvelope` (`validateCommandEnvelope` from `@shared-contracts/media/envelopes.mjs`); dispatches to local controller

**Refactors:**
- `session/LocalSessionProvider.jsx` — mount `useExternalControl` alongside `useUrlCommand` + `usePlaybackStateBroadcast` inside the inner `UrlAndBroadcastMount` (rename to `SessionSideEffects`)
- Fleet subscription needs to route `client-control:<clientId>` payloads into a handler registered by LocalSession

**Spec §:** C8.4, §6.2 (CommandEnvelope), §7.2 (`client-control:<clientId>` topic), §10.1 (`external-control.*` events).

**Open contract question from spec §13:** is there a separate `client-ack:<clientId>` topic, or does external-control ack piggy-back? Resolve with the contract author before starting P7.

---

## Cross-phase invariants

These MUST stay true across all phases — any violation is a foundation bug that needs fixing before the phase that introduced it:

1. **P1 files never regress.** P2–P7 may extend or refactor in place, but existing tests keep passing.
2. **`useSessionController` interface is frozen.** The shape landed in P1; P5 only changes which adapter fulfills `{deviceId}` targets. No consumer of the hook should ever care whether `target` is local or remote.
3. **No raw `console.*`.** Every diagnostic event goes through `mediaLog` (extend the facade when new events land).
4. **No format branching outside Player.** The Media App remains format-agnostic (C2.4); new formats add to the Playable Format Registry only.
5. **Contract-shaped payloads.** Every new WS message validated via the `shared/contracts/media/*` validators before sending and on receipt.

---

## Phase ordering & dependencies

```
P1 (Foundation) ─┬─ P2 (Discovery)
                 ├─ P3 (Fleet) ─┬─ P4 (Cast) ─┬─ P6 (Portability)
                 │              └─ P5 (Peek) ─┘
                 └─ P7 (External Control, needs Fleet's client-control sub)
```

- P2 is independent of P3–P7 (doesn't touch remote surfaces).
- P3 unblocks P4 and P5.
- P4 + P5 both unblock P6 (needs claim + adopt-mode dispatch wiring).
- P7 depends on P3 (for the `client-control:<clientId>` subscription).

Safe build order when context allows: **P1 → P2 → P3 → P4 → P5 → P6 → P7**. P2 can slot anywhere after P1.
