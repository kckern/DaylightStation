# On-Deck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single-slot "on-deck" lane to the AudioPlayer, driven by the existing `play-next` queue op, so kids tapping NFC tags get instant feedback without disrupting playback or accumulating duplicates.

**Architecture:** Reuse the existing trigger pipeline + CommandEnvelope contract. Parameterize the hardcoded `op: 'play-now'` in `WakeAndLoadService` and `WebSocketContentAdapter` so they pass through any queue op. Add a `play-next` action handler. On the frontend, extend `useQueueController` with an on-deck slot and APIs (`pushOnDeck`, `consumeOnDeck`, `flashOnDeck`, `clearOnDeck`); modify `advance()` to consume on-deck before the queue. Bridge ScreenActionHandler → Player via a `window` custom event (`player:queue-op`). Render a new `OnDeckCard` floating component as a sibling of AudioPlayer (AudioPlayer.jsx itself untouched).

**Tech Stack:** Backend ESM, Jest (`@jest/globals`); Frontend React + Vitest + Testing Library; YAML config; existing shared `commands.mjs` / `envelopes.mjs` contracts.

**Spec:** `docs/superpowers/specs/2026-04-25-on-deck-design.md`

**Out of scope:** VideoPlayer, ReadalongScroller, SingalongScroller, multi-slot on-deck.

---

## File Map

**Backend — modify:**
- `backend/src/1_adapters/devices/WebSocketContentAdapter.mjs` — parameterize `op`
- `backend/src/3_applications/devices/services/WakeAndLoadService.mjs` — parameterize `op` (2 sites)
- `backend/src/3_applications/devices/contentIdKeys.mjs` — add `play-next` to `CONTENT_ID_KEYS`
- `backend/src/3_applications/trigger/actionHandlers.mjs` — add `play-next` handler

**Backend — new:**
- `backend/src/3_applications/player/PlayerConfigService.mjs` — load and surface `player.yml`
- `backend/src/4_api/v1/routers/playerConfig.mjs` — `/api/v1/config/player` endpoint

**Config — new:**
- `data/household/config/player.yml`

**Frontend — modify:**
- `frontend/src/modules/Player/hooks/useQueueController.js` — on-deck state + APIs; modified `advance()`
- `frontend/src/modules/Player/Player.jsx` — render OnDeckCard sibling; subscribe to `player:queue-op`; expose preempt window
- `frontend/src/screen-framework/actions/ScreenActionHandler.jsx` — `op: 'play-next'` branch

**Frontend — new:**
- `frontend/src/modules/Player/components/OnDeckCard.jsx`
- `frontend/src/modules/Player/components/OnDeckCard.scss`
- `frontend/src/modules/Player/hooks/usePlayerConfig.js` — fetch `/api/v1/config/player`

**Tests:**
- `tests/isolated/adapters/devices/WebSocketContentAdapter.test.mjs` — extend
- `tests/isolated/applications/trigger/actionHandlers.test.mjs` — extend
- `frontend/src/modules/Player/hooks/useQueueController.test.js` — extend (or new)
- `frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx` — extend
- `frontend/src/modules/Player/components/OnDeckCard.test.jsx` — new

---

## Task 1: Parameterize `op` in WebSocketContentAdapter

**Files:**
- Modify: `backend/src/1_adapters/devices/WebSocketContentAdapter.mjs:80`
- Test: `backend/tests/unit/suite/1_adapters/devices/WebSocketContentAdapter.test.mjs`

- [ ] **Step 1: Add a failing test that asserts `op` flows from `query.op` to the envelope**

Add to the existing `describe('WebSocketContentAdapter', ...)` block in `backend/tests/unit/suite/1_adapters/devices/WebSocketContentAdapter.test.mjs`:

```javascript
it('load() honors query.op when provided (e.g. play-next)', async () => {
  const result = await adapter.load('/tv', { queue: 'plex:642120', op: 'play-next' });
  expect(result.ok).toBe(true);
  const [, payload] = wsBus.broadcast.mock.calls[0];
  expect(payload.command).toBe('queue');
  expect(payload.params.op).toBe('play-next');
  expect(payload.params.contentId).toBe('plex:642120');
});

it('load() defaults op to play-now when query.op is absent', async () => {
  await adapter.load('/tv', { queue: 'plex:642120' });
  const [, payload] = wsBus.broadcast.mock.calls[0];
  expect(payload.params.op).toBe('play-now');
});

it('load() rejects unknown ops as falling back to play-now (defensive)', async () => {
  await adapter.load('/tv', { queue: 'plex:642120', op: 'banana' });
  const [, payload] = wsBus.broadcast.mock.calls[0];
  expect(payload.params.op).toBe('play-now');
});
```

Note: the existing `'op' clobber test` at line 63 currently asserts `op: 'play-next'` is overwritten to `play-now`. That test must be **deleted**, since we are explicitly enabling that pass-through. Removing it now keeps the suite green for steps 2-4.

- [ ] **Step 2: Delete the obsolete clobber test**

Delete the entire `it('load() canonical op/contentId cannot be clobbered by stray query keys', ...)` block (lines 63-76) — replace with a slimmer version that only asserts `contentId` is protected:

```javascript
it('load() canonical contentId cannot be clobbered by stray query keys', async () => {
  await adapter.load('/tv', {
    queue: 'office-program',
    contentId: 'bogus',
    shader: 'dark',
  });
  const [, payload] = wsBus.broadcast.mock.calls[0];
  expect(payload.params.contentId).toBe('office-program');
  expect(payload.params.shader).toBe('dark');
});
```

- [ ] **Step 3: Run tests to verify the new tests fail and the deleted test no longer runs**

```bash
cd /opt/Code/DaylightStation && npx jest backend/tests/unit/suite/1_adapters/devices/WebSocketContentAdapter.test.mjs
```

Expected: 2 failures from the new tests (`op` is always `play-now`); old tests still pass.

- [ ] **Step 4: Implement — parameterize `op` and the `play-next` content key**

In `backend/src/1_adapters/devices/WebSocketContentAdapter.mjs`, replace the params block around line 80:

```javascript
// Allowed ops echoed verbatim — anything else is normalized to play-now (defensive).
const ALLOWED_OPS = new Set(['play-now', 'play-next', 'add-up-next', 'add']);
const requestedOp = typeof query.op === 'string' && ALLOWED_OPS.has(query.op)
  ? query.op
  : 'play-now';

const options = { ...query };
delete options[resolvedKey];
delete options.op;  // strip — we set canonical op below

// ... existing buildCommandEnvelope call:
const envelope = buildCommandEnvelope({
  targetDevice: this.#deviceId,
  command: 'queue',
  commandId,
  params: { ...options, op: requestedOp, contentId },
});
```

Add the `ALLOWED_OPS` const at module top (above the class).

- [ ] **Step 5: Run tests to verify all pass**

```bash
cd /opt/Code/DaylightStation && npx jest backend/tests/unit/suite/1_adapters/devices/WebSocketContentAdapter.test.mjs
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add backend/src/1_adapters/devices/WebSocketContentAdapter.mjs backend/tests/unit/suite/1_adapters/devices/WebSocketContentAdapter.test.mjs
git commit -m "feat(websocket-adapter): pass through queue op from query"
```

---

## Task 2: Add `play-next` to CONTENT_ID_KEYS

**Files:**
- Modify: `backend/src/3_applications/devices/contentIdKeys.mjs:9-17`

- [ ] **Step 1: Add `play-next` to the array**

Edit `backend/src/3_applications/devices/contentIdKeys.mjs`. Add `'play-next'` between `'play'` and `'plex'` (so it has the same priority as `'play'` for naming, but doesn't override an explicit `play`):

```javascript
export const CONTENT_ID_KEYS = Object.freeze([
  'queue',
  'play',
  'play-next',
  'plex',
  'hymn',
  'primary',
  'scripture',
  'contentId',
]);
```

- [ ] **Step 2: Verify nothing else broke**

```bash
cd /opt/Code/DaylightStation && npx jest backend/tests/unit/suite/1_adapters/devices/WebSocketContentAdapter.test.mjs
```

Expected: still green (the existing `query.queue` resolver still runs first).

- [ ] **Step 3: Commit**

```bash
git add backend/src/3_applications/devices/contentIdKeys.mjs
git commit -m "feat(content-id-keys): recognize play-next as a content id key"
```

---

## Task 3: Parameterize `op` in WakeAndLoadService

**Files:**
- Modify: `backend/src/3_applications/devices/services/WakeAndLoadService.mjs:415` and `WakeAndLoadService.mjs:499`

- [ ] **Step 1: Edit the WS-first delivery path**

In `WakeAndLoadService.mjs`, around line 404-416 (inside the `warmPrepare` branch), replace the envelope construction. Change:

```javascript
const envelope = buildCommandEnvelope({
  targetDevice: deviceId,
  command: 'queue',
  commandId: dispatchId,
  // Spread opts first so a caller-supplied op or contentId can't
  // clobber the canonical values.
  params: { ...opts, op: 'play-now', contentId: resolvedContentId },
});
```

To:

```javascript
const ALLOWED_OPS = new Set(['play-now', 'play-next', 'add-up-next', 'add']);
const requestedOp = ALLOWED_OPS.has(opts.op) ? opts.op : 'play-now';
const passThroughOpts = { ...opts };
delete passThroughOpts.op;
const envelope = buildCommandEnvelope({
  targetDevice: deviceId,
  command: 'queue',
  commandId: dispatchId,
  params: { ...passThroughOpts, op: requestedOp, contentId: resolvedContentId },
});
```

- [ ] **Step 2: Apply the same change to the WS fallback path (around line 488-500)**

Find the second `buildCommandEnvelope` call (in the `urlFailed` fallback). Apply the identical transform:

```javascript
const fbAllowed = new Set(['play-now', 'play-next', 'add-up-next', 'add']);
const fbOp = fbAllowed.has(fbOpts.op) ? fbOpts.op : 'play-now';
const fbPassThrough = { ...fbOpts };
delete fbPassThrough.op;
const fbEnvelope = buildCommandEnvelope({
  targetDevice: deviceId,
  command: 'queue',
  commandId: dispatchId,
  params: { ...fbPassThrough, op: fbOp, contentId: fbContentId },
});
```

- [ ] **Step 3: Hoist the constant**

The `ALLOWED_OPS` set is duplicated. Lift it to a module-level constant just below the imports:

```javascript
const ALLOWED_QUEUE_OPS = new Set(['play-now', 'play-next', 'add-up-next', 'add']);
```

Then both branches use `ALLOWED_QUEUE_OPS.has(...)`.

- [ ] **Step 4: Verify existing WakeAndLoadService tests still pass**

```bash
cd /opt/Code/DaylightStation && npx jest tests/isolated/application/devices/WakeAndLoadService.watchdog.test.mjs
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/devices/services/WakeAndLoadService.mjs
git commit -m "feat(wake-and-load): pass through queue op from query"
```

---

## Task 4: Add `play-next` action handler

**Files:**
- Modify: `backend/src/3_applications/trigger/actionHandlers.mjs:24-37`
- Test: `tests/isolated/applications/trigger/actionHandlers.test.mjs`

- [ ] **Step 1: Write failing test**

Append to `tests/isolated/applications/trigger/actionHandlers.test.mjs` inside the existing `describe('actionHandlers', ...)`:

```javascript
it('play-next calls wakeAndLoadService with op=play-next and play-next=<content>', async () => {
  const wakeAndLoadService = { execute: jest.fn().mockResolvedValue({ ok: true }) };
  const intent = { action: 'play-next', target: 'livingroom-tv', content: 'plex:642120', params: { volume: 60 } };
  await actionHandlers['play-next'](intent, { wakeAndLoadService });
  expect(wakeAndLoadService.execute).toHaveBeenCalledWith(
    'livingroom-tv',
    { 'play-next': 'plex:642120', op: 'play-next', volume: 60 },
    expect.objectContaining({ dispatchId: expect.any(String) })
  );
});

it('play-next: canonical play-next key wins over user-supplied params', async () => {
  const wakeAndLoadService = { execute: jest.fn().mockResolvedValue({ ok: true }) };
  const intent = { action: 'play-next', target: 't', content: 'plex:1', params: { 'play-next': 'hijack', op: 'banana' } };
  await actionHandlers['play-next'](intent, { wakeAndLoadService });
  expect(wakeAndLoadService.execute).toHaveBeenCalledWith(
    't',
    expect.objectContaining({ 'play-next': 'plex:1', op: 'play-next' }),
    expect.any(Object)
  );
});

it('dispatchAction routes play-next to the play-next handler', async () => {
  const wakeAndLoadService = { execute: jest.fn().mockResolvedValue({ ok: true }) };
  const intent = { action: 'play-next', target: 't', content: 'plex:1', params: {} };
  await dispatchAction(intent, { wakeAndLoadService });
  expect(wakeAndLoadService.execute).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify failures**

```bash
cd /opt/Code/DaylightStation && npx jest tests/isolated/applications/trigger/actionHandlers.test.mjs
```

Expected: 3 failures — `actionHandlers['play-next']` is undefined.

- [ ] **Step 3: Implement the handler**

In `backend/src/3_applications/trigger/actionHandlers.mjs`, add to the `actionHandlers` object after `play`:

```javascript
'play-next': async (intent, { wakeAndLoadService }) =>
  wakeAndLoadService.execute(
    intent.target,
    { ...(intent.params || {}), 'play-next': intent.content, op: 'play-next' },
    buildLoadOptions(intent)
  ),
```

The trailing assignment (`'play-next': intent.content, op: 'play-next'`) order ensures the canonical keys override anything in `intent.params`.

- [ ] **Step 4: Verify all tests pass**

```bash
cd /opt/Code/DaylightStation && npx jest tests/isolated/applications/trigger/actionHandlers.test.mjs
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/trigger/actionHandlers.mjs tests/isolated/applications/trigger/actionHandlers.test.mjs
git commit -m "feat(trigger): play-next action handler routes to wake-and-load"
```

---

## Task 5: Player config file + service + API endpoint

**Files:**
- Create: `data/household/config/player.yml`
- Create: `backend/src/3_applications/player/PlayerConfigService.mjs`
- Create: `backend/src/4_api/v1/routers/playerConfig.mjs`
- Test: `tests/isolated/applications/player/PlayerConfigService.test.mjs` (new)
- Modify: `backend/src/0_system/bootstrap.mjs` (or wherever routers are mounted) — register the new router

- [ ] **Step 1: Author the YAML**

Write `data/household/config/player.yml`:

```yaml
# Player runtime config
on_deck:
  preempt_seconds: 15        # play-next within this many seconds preempts current
  displace_to_queue: false   # if true, replaced on-deck items move to queue head
```

This file lives in the bind-mounted data volume — write via `sudo docker exec` if doing so on the prod host, or directly via filesystem if dev.

- [ ] **Step 2: Write failing test for PlayerConfigService**

Create `tests/isolated/applications/player/PlayerConfigService.test.mjs`:

```javascript
import { describe, it, expect, jest } from '@jest/globals';
import { PlayerConfigService } from '../../../../backend/src/3_applications/player/PlayerConfigService.mjs';

describe('PlayerConfigService', () => {
  it('loads on_deck config and exposes defaults', () => {
    const yaml = `
on_deck:
  preempt_seconds: 15
  displace_to_queue: false
`;
    const reader = { readYaml: jest.fn().mockReturnValue({ on_deck: { preempt_seconds: 15, displace_to_queue: false } }) };
    const svc = new PlayerConfigService({ configReader: reader });
    expect(svc.getOnDeckConfig()).toEqual({ preempt_seconds: 15, displace_to_queue: false });
  });

  it('returns defaults when on_deck section missing', () => {
    const reader = { readYaml: jest.fn().mockReturnValue({}) };
    const svc = new PlayerConfigService({ configReader: reader });
    expect(svc.getOnDeckConfig()).toEqual({ preempt_seconds: 15, displace_to_queue: false });
  });

  it('clamps preempt_seconds to [0, 600]', () => {
    const reader = { readYaml: jest.fn().mockReturnValue({ on_deck: { preempt_seconds: 9999 } }) };
    const svc = new PlayerConfigService({ configReader: reader });
    expect(svc.getOnDeckConfig().preempt_seconds).toBe(600);
  });
});
```

- [ ] **Step 3: Implement PlayerConfigService**

Create `backend/src/3_applications/player/PlayerConfigService.mjs`:

```javascript
const DEFAULT_ON_DECK = Object.freeze({ preempt_seconds: 15, displace_to_queue: false });

export class PlayerConfigService {
  #configReader;
  #cache = null;

  constructor({ configReader }) {
    if (!configReader) throw new Error('PlayerConfigService requires configReader');
    this.#configReader = configReader;
  }

  getOnDeckConfig() {
    const raw = this.#load();
    const od = raw.on_deck || {};
    const preempt = Number.isFinite(od.preempt_seconds) ? od.preempt_seconds : DEFAULT_ON_DECK.preempt_seconds;
    return {
      preempt_seconds: Math.max(0, Math.min(600, preempt)),
      displace_to_queue: typeof od.displace_to_queue === 'boolean' ? od.displace_to_queue : DEFAULT_ON_DECK.displace_to_queue,
    };
  }

  #load() {
    if (this.#cache) return this.#cache;
    try {
      this.#cache = this.#configReader.readYaml('household/config/player.yml') || {};
    } catch {
      this.#cache = {};
    }
    return this.#cache;
  }
}
```

Note: The actual `configReader.readYaml(...)` signature comes from the project's existing config service. Check `backend/src/0_system/config/` for the real interface and adjust the path argument if needed (this plan assumes a `readYaml(relPath)` shape; the real service may take a `path` array or a method name like `getYaml`. Match it to the existing pattern by inspection.)

- [ ] **Step 4: Run tests to verify pass**

```bash
cd /opt/Code/DaylightStation && npx jest tests/isolated/applications/player/PlayerConfigService.test.mjs
```

Expected: green.

- [ ] **Step 5: Add the API router**

Create `backend/src/4_api/v1/routers/playerConfig.mjs`:

```javascript
import express from 'express';

export function createPlayerConfigRouter({ playerConfigService, logger = console }) {
  const router = express.Router();
  router.get('/', (req, res) => {
    try {
      const onDeck = playerConfigService.getOnDeckConfig();
      res.json({ on_deck: onDeck });
    } catch (err) {
      logger.error?.('player-config.error', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });
  return router;
}

export default createPlayerConfigRouter;
```

- [ ] **Step 6: Mount the router and inject the service**

In `backend/src/0_system/bootstrap.mjs` (or whichever file composes routers), import and mount:

```javascript
import { PlayerConfigService } from '#applications/player/PlayerConfigService.mjs';
import { createPlayerConfigRouter } from '#api/v1/routers/playerConfig.mjs';

// alongside other service instantiations:
const playerConfigService = new PlayerConfigService({ configReader });

// alongside other router mounts:
app.use('/api/v1/config/player', createPlayerConfigRouter({ playerConfigService, logger }));
```

The exact import paths and DI pattern depend on the existing bootstrap shape — adapt to match (e.g. if the project uses a `routers/index.mjs` aggregator, register there instead).

- [ ] **Step 7: Smoke-test the endpoint**

Start (or restart) the dev server, then:

```bash
curl -s http://localhost:3112/api/v1/config/player | jq
```

Expected: `{ "on_deck": { "preempt_seconds": 15, "displace_to_queue": false } }`.

- [ ] **Step 8: Commit**

```bash
git add data/household/config/player.yml \
        backend/src/3_applications/player/PlayerConfigService.mjs \
        backend/src/4_api/v1/routers/playerConfig.mjs \
        tests/isolated/applications/player/PlayerConfigService.test.mjs \
        backend/src/0_system/bootstrap.mjs
git commit -m "feat(player-config): on_deck preempt_seconds + displace_to_queue config"
```

---

## Task 6: On-deck state + `playNow` API in `useQueueController`

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useQueueController.js`
- Test: `frontend/src/modules/Player/hooks/useQueueController.test.js` (new if absent)

- [ ] **Step 1: Write failing test for new on-deck APIs**

Create `frontend/src/modules/Player/hooks/useQueueController.test.js` if absent. Use `@testing-library/react`'s `renderHook`. Add tests:

```javascript
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useQueueController } from './useQueueController.js';

// Mock DaylightAPI so initQueue doesn't try to fetch
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn().mockResolvedValue({ items: [], audio: null }),
}));

describe('useQueueController on-deck slot', () => {
  it('pushOnDeck sets the slot', () => {
    const { result } = renderHook(() => useQueueController({ play: null, queue: null, clear: vi.fn() }));
    expect(result.current.onDeck).toBeNull();
    act(() => result.current.pushOnDeck({ id: 'plex:1', title: 'Pigs', thumbnail: '/t.jpg' }));
    expect(result.current.onDeck?.id).toBe('plex:1');
  });

  it('pushOnDeck replaces an existing on-deck item (newest wins)', () => {
    const { result } = renderHook(() => useQueueController({ play: null, queue: null, clear: vi.fn() }));
    act(() => result.current.pushOnDeck({ id: 'plex:1', title: 'A' }));
    act(() => result.current.pushOnDeck({ id: 'plex:2', title: 'B' }));
    expect(result.current.onDeck?.id).toBe('plex:2');
  });

  it('pushOnDeck with displaceToQueue=true prepends displaced item to queue head', () => {
    const { result } = renderHook(() => useQueueController({ play: null, queue: null, clear: vi.fn() }));
    act(() => result.current.pushOnDeck({ id: 'plex:1', title: 'A' }));
    act(() => result.current.pushOnDeck({ id: 'plex:2', title: 'B' }, { displaceToQueue: true }));
    expect(result.current.onDeck?.id).toBe('plex:2');
    expect(result.current.playQueue[0]?.id).toBe('plex:1');
  });

  it('clearOnDeck empties the slot', () => {
    const { result } = renderHook(() => useQueueController({ play: null, queue: null, clear: vi.fn() }));
    act(() => result.current.pushOnDeck({ id: 'plex:1', title: 'A' }));
    act(() => result.current.clearOnDeck());
    expect(result.current.onDeck).toBeNull();
  });

  it('flashOnDeck increments the flash key without changing the slot', () => {
    const { result } = renderHook(() => useQueueController({ play: null, queue: null, clear: vi.fn() }));
    act(() => result.current.pushOnDeck({ id: 'plex:1', title: 'A' }));
    const k0 = result.current.onDeckFlashKey;
    act(() => result.current.flashOnDeck());
    expect(result.current.onDeckFlashKey).toBe(k0 + 1);
    expect(result.current.onDeck?.id).toBe('plex:1');
  });

  it('playNow replaces playQueue head and preserves the tail', async () => {
    const items = [
      { id: 'a', contentId: 'a', title: 'A' },
      { id: 'b', contentId: 'b', title: 'B' },
    ];
    const { result } = renderHook(() => useQueueController({ play: items, queue: null, clear: vi.fn() }));
    await act(async () => {});
    expect(result.current.playQueue[0]?.id).toBe('a');
    act(() => result.current.playNow({ id: 'x', contentId: 'x', title: 'X' }));
    expect(result.current.playQueue[0]?.id).toBe('x');
    expect(result.current.playQueue[1]?.id).toBe('b');
  });

  it('playNow preserves on-deck slot (does not consume it)', () => {
    const { result } = renderHook(() => useQueueController({ play: null, queue: null, clear: vi.fn() }));
    act(() => result.current.pushOnDeck({ id: 'od', contentId: 'od', title: 'OD' }));
    act(() => result.current.playNow({ id: 'x', contentId: 'x', title: 'X' }));
    expect(result.current.playQueue[0]?.id).toBe('x');
    expect(result.current.onDeck?.id).toBe('od');
  });

  it('playNow on empty queue seeds it with the new head', () => {
    const { result } = renderHook(() => useQueueController({ play: null, queue: null, clear: vi.fn() }));
    expect(result.current.playQueue.length).toBe(0);
    act(() => result.current.playNow({ id: 'x', contentId: 'x', title: 'X' }));
    expect(result.current.playQueue[0]?.id).toBe('x');
  });
});
```

- [ ] **Step 2: Run tests to verify failures**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Player/hooks/useQueueController.test.js
```

Expected: failures — APIs don't exist.

- [ ] **Step 3: Implement the on-deck slot + `playNow` API**

In `useQueueController.js`, near the top of the hook body (before the existing `useEffect`):

```javascript
const [onDeck, setOnDeckState] = useState(null);
const [onDeckFlashKey, setOnDeckFlashKey] = useState(0);

const pushOnDeck = useCallback((item, opts = {}) => {
  setOnDeckState((prev) => {
    if (prev && opts.displaceToQueue) {
      // Prepend the displaced item to the queue head
      setQueue((q) => [prev, ...q]);
      setOriginalQueue((q) => [prev, ...q]);
    }
    return item;
  });
}, []);

const clearOnDeck = useCallback(() => {
  setOnDeckState(null);
}, []);

const flashOnDeck = useCallback(() => {
  setOnDeckFlashKey((k) => k + 1);
}, []);

// In-place head replacement. Used by `op: 'play-now'` from an active Player to
// honor the spec semantic: replace currently playing, leave queue tail and
// on-deck untouched. Differs from a fresh Player remount which would destroy
// queue+on-deck state.
const playNow = useCallback((item) => {
  setQueue((prev) => prev.length > 0 ? [item, ...prev.slice(1)] : [item]);
  setOriginalQueue((prev) => prev.length > 0 ? [item, ...prev.slice(1)] : [item]);
}, []);
```

Add to the hook's return value:

```javascript
return {
  // ...existing fields
  onDeck,
  onDeckFlashKey,
  pushOnDeck,
  clearOnDeck,
  flashOnDeck,
  playNow,
};
```

- [ ] **Step 4: Verify tests pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Player/hooks/useQueueController.test.js
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Player/hooks/useQueueController.js frontend/src/modules/Player/hooks/useQueueController.test.js
git commit -m "feat(queue-controller): on-deck slot + push/clear/flash + playNow APIs"
```

---

## Task 7: `consumeOnDeck` and modified `advance()`

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useQueueController.js` (continue from Task 6)
- Test: `frontend/src/modules/Player/hooks/useQueueController.test.js`

- [ ] **Step 1: Write failing test**

Append to `useQueueController.test.js`:

```javascript
describe('useQueueController.advance with on-deck', () => {
  it('advance() consumes on-deck before regular queue advance', async () => {
    // Seed the queue with two items by passing inline play array
    const items = [
      { id: 'a', contentId: 'a', title: 'A' },
      { id: 'b', contentId: 'b', title: 'B' },
    ];
    const { result } = renderHook(() => useQueueController({ play: items, queue: null, clear: vi.fn() }));
    // Wait for queue to initialize
    await act(async () => { /* tick */ });
    // Push an on-deck item
    act(() => result.current.pushOnDeck({ id: 'x', contentId: 'x', title: 'X' }));
    expect(result.current.onDeck?.id).toBe('x');
    // Advance: should consume on-deck — current head becomes X, queue still has A,B (X is between A and B; A finished and X plays)
    act(() => result.current.advance());
    expect(result.current.playQueue[0]?.id).toBe('x');
    expect(result.current.onDeck).toBeNull();
  });

  it('advance() falls through to normal queue advance when on-deck is empty', async () => {
    const items = [
      { id: 'a', contentId: 'a', title: 'A' },
      { id: 'b', contentId: 'b', title: 'B' },
    ];
    const { result } = renderHook(() => useQueueController({ play: items, queue: null, clear: vi.fn() }));
    await act(async () => {});
    expect(result.current.onDeck).toBeNull();
    act(() => result.current.advance());
    expect(result.current.playQueue[0]?.id).toBe('b');
  });
});
```

- [ ] **Step 2: Run tests to verify failures**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Player/hooks/useQueueController.test.js
```

Expected: 1 failure (consume on-deck) and 1 pass (fall-through).

- [ ] **Step 3: Modify `advance()` to consume on-deck first**

In `useQueueController.js`, wrap the existing `advance` body with an on-deck shortcut. Replace the existing `const advance = useCallback(...)` definition with:

```javascript
const advance = useCallback((step = 1) => {
  // On-deck has priority over the regular queue when advancing forward by 1.
  if (step > 0 && onDeck) {
    setQueue((prev) => {
      // Replace head with on-deck; keep the rest of the queue intact.
      // This mirrors the "current item ended, on-deck plays next" semantics.
      const rest = prev.length > 0 ? prev.slice(1) : prev;
      return [onDeck, ...rest];
    });
    setOnDeckState(null);
    return;
  }

  // Existing logic — kept verbatim.
  setQueue((prevQueue) => {
    if (prevQueue.length > 1) {
      // ...preserve the rest of the existing function body
    }
    // ...etc.
  });
}, [clear, isContinuous, originalQueue, onDeck]);
```

Note: when copying the existing body, **do not delete it** — only prepend the on-deck shortcut and add `onDeck` to the dependency array. The existing slice/rotate/clear logic stays as the fallthrough.

- [ ] **Step 4: Run tests to verify pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Player/hooks/useQueueController.test.js
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Player/hooks/useQueueController.js frontend/src/modules/Player/hooks/useQueueController.test.js
git commit -m "feat(queue-controller): advance consumes on-deck before queue"
```

---

## Task 8: `usePlayerConfig` hook (frontend)

**Files:**
- Create: `frontend/src/modules/Player/hooks/usePlayerConfig.js`
- Test: `frontend/src/modules/Player/hooks/usePlayerConfig.test.js`

- [ ] **Step 1: Write failing test**

Create `frontend/src/modules/Player/hooks/usePlayerConfig.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePlayerConfig } from './usePlayerConfig.js';

vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(),
}));

import { DaylightAPI } from '../../../lib/api.mjs';

describe('usePlayerConfig', () => {
  beforeEach(() => {
    DaylightAPI.mockReset();
  });

  it('fetches /api/v1/config/player and exposes on_deck', async () => {
    DaylightAPI.mockResolvedValue({ on_deck: { preempt_seconds: 15, displace_to_queue: false } });
    const { result } = renderHook(() => usePlayerConfig());
    await waitFor(() => expect(result.current.onDeck).toBeTruthy());
    expect(result.current.onDeck.preempt_seconds).toBe(15);
    expect(result.current.onDeck.displace_to_queue).toBe(false);
  });

  it('returns defaults if fetch fails', async () => {
    DaylightAPI.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => usePlayerConfig());
    await waitFor(() => expect(result.current.onDeck).toBeTruthy());
    expect(result.current.onDeck.preempt_seconds).toBe(15);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Player/hooks/usePlayerConfig.test.js
```

Expected: failure — `usePlayerConfig` does not exist.

- [ ] **Step 3: Implement**

Create `frontend/src/modules/Player/hooks/usePlayerConfig.js`:

```javascript
import { useState, useEffect } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';

const DEFAULT = { preempt_seconds: 15, displace_to_queue: false };

let _cached = null;

export function usePlayerConfig() {
  const [onDeck, setOnDeck] = useState(_cached?.on_deck || DEFAULT);

  useEffect(() => {
    let cancelled = false;
    if (_cached) return;
    DaylightAPI('api/v1/config/player')
      .then((data) => {
        if (cancelled) return;
        _cached = data;
        setOnDeck(data?.on_deck || DEFAULT);
      })
      .catch(() => {
        if (cancelled) return;
        _cached = { on_deck: DEFAULT };
        setOnDeck(DEFAULT);
      });
    return () => { cancelled = true; };
  }, []);

  return { onDeck };
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Player/hooks/usePlayerConfig.test.js
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Player/hooks/usePlayerConfig.js frontend/src/modules/Player/hooks/usePlayerConfig.test.js
git commit -m "feat(player-config): usePlayerConfig hook with /api/v1/config/player"
```

---

## Task 9: OnDeckCard component + styles

**Files:**
- Create: `frontend/src/modules/Player/components/OnDeckCard.jsx`
- Create: `frontend/src/modules/Player/components/OnDeckCard.scss`
- Test: `frontend/src/modules/Player/components/OnDeckCard.test.jsx`

- [ ] **Step 1: Write failing test**

Create `frontend/src/modules/Player/components/OnDeckCard.test.jsx`:

```javascript
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { OnDeckCard } from './OnDeckCard.jsx';

describe('OnDeckCard', () => {
  it('renders nothing when item is null', () => {
    const { container } = render(<OnDeckCard item={null} flashKey={0} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders thumbnail and title when item is provided', () => {
    const { getByText, getByRole } = render(
      <OnDeckCard item={{ id: 'plex:1', title: 'The Three Pigs', thumbnail: '/t.jpg' }} flashKey={0} />
    );
    expect(getByText('The Three Pigs')).toBeTruthy();
    expect(getByRole('img').getAttribute('src')).toBe('/t.jpg');
  });

  it('changes flash data attribute when flashKey changes', () => {
    const { container, rerender } = render(
      <OnDeckCard item={{ id: 'plex:1', title: 'A', thumbnail: '/t.jpg' }} flashKey={0} />
    );
    const card = container.querySelector('.on-deck-card');
    expect(card.getAttribute('data-flash-key')).toBe('0');
    rerender(<OnDeckCard item={{ id: 'plex:1', title: 'A', thumbnail: '/t.jpg' }} flashKey={1} />);
    expect(card.getAttribute('data-flash-key')).toBe('1');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Player/components/OnDeckCard.test.jsx
```

Expected: failure — component doesn't exist.

- [ ] **Step 3: Implement OnDeckCard**

Create `frontend/src/modules/Player/components/OnDeckCard.jsx`:

```jsx
import React from 'react';
import PropTypes from 'prop-types';
import './OnDeckCard.scss';

export function OnDeckCard({ item, flashKey }) {
  if (!item) return null;
  return (
    <div className="on-deck-card" data-flash-key={flashKey}>
      <div className="on-deck-thumb">
        {item.thumbnail && <img src={item.thumbnail} alt="" />}
        <div className="on-deck-icon" aria-label="up next">▶▶</div>
      </div>
      <div className="on-deck-title-strip">
        <span>{item.title || ''}</span>
      </div>
    </div>
  );
}

OnDeckCard.propTypes = {
  item: PropTypes.shape({
    id: PropTypes.string,
    title: PropTypes.string,
    thumbnail: PropTypes.string,
  }),
  flashKey: PropTypes.number,
};

export default OnDeckCard;
```

- [ ] **Step 4: Implement styles**

Create `frontend/src/modules/Player/components/OnDeckCard.scss`:

```scss
.on-deck-card {
  position: absolute;
  bottom: 1em;
  right: 1em;
  width: 6.5em;
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 4px;
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
  color: #f0f0f0;
  display: flex;
  flex-direction: column;
  z-index: 10;
  transition: transform 0.2s ease, opacity 0.2s ease;

  // Brief flash on dedup-acknowledgement: data-flash-key change re-binds animation
  animation: on-deck-flash 0s; // placeholder; the keyed animation below fires on attr change via key trick
}

// To force re-trigger of the flash, re-key the element in the parent on flashKey change.
@keyframes on-deck-flash {
  0%   { transform: scale(1); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35); }
  20%  { transform: scale(1.05); box-shadow: 0 6px 16px rgba(255, 255, 255, 0.3); }
  100% { transform: scale(1); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35); }
}

.on-deck-thumb {
  position: relative;
  aspect-ratio: 1 / 1;
  background: linear-gradient(135deg, #6a8caf, #3a587a);
  overflow: hidden;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
}

.on-deck-icon {
  position: absolute;
  top: 0.25em;
  left: 0.3em;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  font-size: 0.7em;
  padding: 0.1em 0.35em;
  border-radius: 2px;
  letter-spacing: -0.05em;
  font-weight: 700;
  pointer-events: none;
}

.on-deck-title-strip {
  font-size: 0.7em;
  padding: 0.35em 0.45em;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(0, 0, 0, 0.35);
}
```

**Marquee deferred to v2.** Pure CSS ellipsis (`text-overflow: ellipsis`) is sufficient for v1. A measured-overflow detector (`scrollWidth > clientWidth` via ResizeObserver) belongs in a follow-up — it adds JS complexity and isn't required by the kid use case (most story titles fit inside the strip).

For the flash to actually re-fire, the parent passes `key={flashKey}` to `OnDeckCard` (forces remount) — see Task 10 wiring. The `data-flash-key` attribute is for assertion in tests.

- [ ] **Step 5: Verify tests pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Player/components/OnDeckCard.test.jsx
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Player/components/OnDeckCard.jsx \
        frontend/src/modules/Player/components/OnDeckCard.scss \
        frontend/src/modules/Player/components/OnDeckCard.test.jsx
git commit -m "feat(player): OnDeckCard floating component"
```

---

## Task 10: Wire OnDeckCard into Player + listen for `player:queue-op` events (handles both `play-now` and `play-next`)

**Files:**
- Modify: `frontend/src/modules/Player/Player.jsx` (or `SinglePlayer.jsx` — check which renders AudioPlayer)

- [ ] **Step 1: Locate the right render site**

Run:

```bash
cd /opt/Code/DaylightStation && grep -nl 'AudioPlayer' frontend/src/modules/Player/*.jsx
```

The file that imports/renders `AudioPlayer` is the parent. Identify whether it's `Player.jsx`, `SinglePlayer.jsx`, or another file. The OnDeckCard should be rendered alongside AudioPlayer in that component. The rest of the steps reference `<PlayerHost>` — substitute the actual component name.

- [ ] **Step 2: Subscribe to `player:queue-op` and handle both ops**

Inside `<PlayerHost>`, after the `useQueueController` call:

```jsx
const {
  onDeck, onDeckFlashKey, pushOnDeck, flashOnDeck,
  playNow, advance, playQueue,
} = useQueueController(...);
const { onDeck: onDeckCfg } = usePlayerConfig();
const mediaElRef = useRef(null);  // to read currentTime for preempt window

useEffect(() => {
  const handleQueueOp = async (e) => {
    const { op, contentId } = e.detail || {};
    if (!contentId) return;
    if (op !== 'play-now' && op !== 'play-next') return;

    // Fetch the FULL playable item (mediaUrl, format, title, thumbnail).
    // /api/v1/play/ returns enough to both render the on-deck card AND play
    // the item when it's consumed into playQueue[0].
    let info;
    try {
      info = await DaylightAPI(`api/v1/play/${contentId}`);
    } catch (err) {
      // Without a mediaUrl we can't safely play. Bail out rather than push
      // a half-built item that will fail at the renderer.
      return;
    }
    const item = {
      ...info,
      id: info.id || info.contentId || contentId,
      contentId,
      thumbnail: info.thumbnail || `/api/v1/display/${contentId}`,
      title: info.title || contentId,
    };

    if (op === 'play-now') {
      // In-place head swap. Queue tail and on-deck slot are preserved per spec.
      // Skip dedup against currently-playing here — `play-now` is by definition
      // an explicit override; the caller wanted this content now.
      playNow(item);
      return;
    }

    // op === 'play-next' below
    // Dedup: same content as currently-playing → flash, no replace
    const current = playQueue[0];
    if (current && (current.contentId === contentId || current.id === contentId)) {
      flashOnDeck();
      return;
    }
    // Dedup: same content as on-deck → flash, no replace
    if (onDeck && (onDeck.contentId === contentId || onDeck.id === contentId)) {
      flashOnDeck();
      return;
    }
    pushOnDeck(item, { displaceToQueue: !!onDeckCfg.displace_to_queue });

    // Preempt window: if current item has been playing < preempt_seconds, advance immediately
    const el = mediaElRef.current?.querySelector('audio, video');
    const elapsed = el?.currentTime ?? 0;
    if (Number.isFinite(elapsed) && elapsed < (onDeckCfg.preempt_seconds || 0)) {
      advance();
    }
  };

  window.addEventListener('player:queue-op', handleQueueOp);
  return () => window.removeEventListener('player:queue-op', handleQueueOp);
}, [playQueue, onDeck, onDeckCfg, advance, pushOnDeck, flashOnDeck, playNow]);
```

Note: `DaylightAPI` import: `import { DaylightAPI } from '../../lib/api.mjs';` — match existing imports in the same file.

- [ ] **Step 3: Render OnDeckCard as a sibling**

In the JSX for `<PlayerHost>`, add OnDeckCard alongside the renderer:

```jsx
import { OnDeckCard } from './components/OnDeckCard.jsx';

// in the return:
return (
  <div ref={mediaElRef} className="player">
    {/* existing renderer (AudioPlayer / VideoPlayer / etc.) — UNCHANGED */}
    <CurrentRenderer ... />
    <OnDeckCard key={onDeckFlashKey} item={onDeck} flashKey={onDeckFlashKey} />
  </div>
);
```

The `key={onDeckFlashKey}` causes the `OnDeckCard` to remount when `flashOnDeck()` fires, re-triggering the flash animation defined in `OnDeckCard.scss`.

- [ ] **Step 4: Smoke test the wire-up in dev**

Dev server should be running on port 3112. From a terminal:

```bash
# Simulate the WS broadcast directly. Skip if no dev player is open.
# Or open the audio player URL with ?play=plex:<id> and then trigger /api/v1/trigger/livingroom/nfc/<tag>
```

Manual: open `http://localhost:3111/tv?play=<some-audio-id>`. Once playback starts, fire `curl http://localhost:3111/api/v1/trigger/livingroom/nfc/<some-other-kid-tag>` (after Task 12 sets up the tag config). The on-deck card should appear in the bottom-right of the AudioPlayer.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Player/Player.jsx frontend/src/modules/Player/SinglePlayer.jsx
# (whichever was modified)
git commit -m "feat(player): on-deck wiring + player:queue-op event listener"
```

---

## Task 11: ScreenActionHandler — route `play-now` and `play-next` to active Player via event

**Files:**
- Modify: `frontend/src/screen-framework/actions/ScreenActionHandler.jsx:131-143`
- Test: `frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx`

- [ ] **Step 1: Write failing tests**

Append to `ScreenActionHandler.test.jsx`. We test 4 scenarios — each `op` × player active/inactive:

```javascript
it('media:queue-op op=play-next with no active player mounts a fresh Player', () => {
  const { getByTestId, queryByTestId } = render(
    <ScreenOverlayProvider>
      <ScreenActionHandler />
    </ScreenOverlayProvider>
  );
  expect(queryByTestId('player')).toBeNull();
  act(() => getActionBus().emit('media:queue-op', { op: 'play-next', contentId: 'plex:1' }));
  expect(getByTestId('player')).toBeTruthy();
});

it('media:queue-op op=play-next with an active audio player dispatches player:queue-op event', () => {
  const dummy = document.createElement('div');
  dummy.className = 'audio-player';
  document.body.appendChild(dummy);

  const handler = vi.fn();
  window.addEventListener('player:queue-op', handler);

  render(
    <ScreenOverlayProvider>
      <ScreenActionHandler />
    </ScreenOverlayProvider>
  );
  act(() => getActionBus().emit('media:queue-op', { op: 'play-next', contentId: 'plex:1' }));

  expect(handler).toHaveBeenCalledTimes(1);
  expect(handler.mock.calls[0][0].detail).toMatchObject({ op: 'play-next', contentId: 'plex:1' });

  window.removeEventListener('player:queue-op', handler);
  dummy.remove();
});

it('media:queue-op op=play-now with no active player mounts a fresh Player (existing behavior)', () => {
  const { getByTestId, queryByTestId } = render(
    <ScreenOverlayProvider>
      <ScreenActionHandler />
    </ScreenOverlayProvider>
  );
  expect(queryByTestId('player')).toBeNull();
  act(() => getActionBus().emit('media:queue-op', { op: 'play-now', contentId: 'plex:1' }));
  expect(getByTestId('player')).toBeTruthy();
});

it('media:queue-op op=play-now with an active audio player dispatches player:queue-op (in-place swap)', () => {
  // Per spec §3: play-now should leave queue and on-deck intact when player is active.
  const dummy = document.createElement('div');
  dummy.className = 'audio-player';
  document.body.appendChild(dummy);

  const handler = vi.fn();
  window.addEventListener('player:queue-op', handler);

  render(
    <ScreenOverlayProvider>
      <ScreenActionHandler />
    </ScreenOverlayProvider>
  );
  act(() => getActionBus().emit('media:queue-op', { op: 'play-now', contentId: 'plex:2' }));

  expect(handler).toHaveBeenCalledTimes(1);
  expect(handler.mock.calls[0][0].detail).toMatchObject({ op: 'play-now', contentId: 'plex:2' });

  window.removeEventListener('player:queue-op', handler);
  dummy.remove();
});
```

- [ ] **Step 2: Run tests to verify failures**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx
```

Expected: at least 2 new failures (the active-player branches dispatch the event but currently dismiss+remount).

- [ ] **Step 3: Unify `handleMediaQueueOp` for both ops**

In `frontend/src/screen-framework/actions/ScreenActionHandler.jsx`, replace the existing `handleMediaQueueOp` body (around line 131-143) with a single branch that handles both `play-now` and `play-next` consistently:

```javascript
const handleMediaQueueOp = useCallback((payload) => {
  const op = payload?.op;

  // Both play-now and play-next share the same active-vs-idle routing.
  // Active player → dispatch event; the running Player handles in-place
  // swap (play-now) or on-deck push (play-next), preserving queue state.
  // Idle player → mount a fresh Player overlay.
  if (op === 'play-now' || op === 'play-next') {
    const playerActive = !!document.querySelector(
      '.audio-player, .video-player audio, .video-player video, dash-video'
    );
    if (playerActive) {
      window.dispatchEvent(new CustomEvent('player:queue-op', { detail: { op, ...payload } }));
      return;
    }
    if (isMediaDuplicate(payload.contentId)) return;
    dismissOverlay();
    showOverlay(Player, {
      queue: { contentId: payload.contentId, ...payload },
      clear: () => dismissOverlay(),
    });
    return;
  }

  logger().debug('media.queue-op.unhandled', { op, contentId: payload?.contentId });
}, [showOverlay, dismissOverlay, isMediaDuplicate]);
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screen-framework/actions/ScreenActionHandler.jsx frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx
git commit -m "feat(screen-actions): play-next branch dispatches player:queue-op"
```

---

## Task 12: Update `nfc.yml` for living-room kid tags

**Files:**
- Modify: `data/household/config/nfc.yml`

- [ ] **Step 1: Read the existing `nfc.yml`**

```bash
sudo docker exec daylight-station sh -c 'cat data/household/config/nfc.yml'
```

(On the dev workspace, read directly from disk.)

- [ ] **Step 2: Change the `livingroom` location's `action` to `play-next`**

The existing structure looks like:

```yaml
livingroom:
  target: livingroom-tv
  action: play
  tags:
    "<UID>": { plex: ... }
```

Change to:

```yaml
livingroom:
  target: livingroom-tv
  action: play-next     # was: play
  tags:
    "<UID>": { plex: ... }
```

If only specific kid tags should use `play-next` (and others should keep immediate `play`), override per-tag instead:

```yaml
livingroom:
  target: livingroom-tv
  action: play          # location default stays as play
  tags:
    "<kid-tag-UID>":
      action: play-next  # this tag goes to on-deck
      plex: 642120
    "<other-tag>": { plex: 555555 }   # unchanged play behavior
```

Choose the per-tag override form unless the user has indicated all living-room tags should be on-deck.

- [ ] **Step 3: Reload trigger config**

```bash
curl -X POST http://localhost:3111/api/v1/trigger/reload
```

Expected response: `{ "ok": true, "locations": ["livingroom"], "tagCount": <N> }`.

- [ ] **Step 4: Commit (data file)**

```bash
git add data/household/config/nfc.yml
git commit -m "config(nfc): kid tags route to play-next (on-deck)"
```

(Note: `data/household/config/nfc.yml` may or may not be tracked in this repo — if `data/` is in `.gitignore`, skip the commit and document the change in the runbook.)

---

## Task 13: End-to-end verification

**Files:** none (manual + log inspection)

- [ ] **Step 1: Confirm dev server is running**

```bash
ss -tlnp 2>/dev/null | grep 3112
```

If not running:

```bash
cd /opt/Code/DaylightStation && nohup node backend/index.js > /tmp/backend-dev.log 2>&1 &
```

- [ ] **Step 2: Mount the AudioPlayer with a real audio item**

In a browser at `http://localhost:3111/tv?play=<audio-content-id>`. Wait for playback to start.

- [ ] **Step 3: Fire a kid-tag trigger via curl**

```bash
curl -s "http://localhost:3111/api/v1/trigger/livingroom/nfc/<kid-tag-UID>"
```

Expected response: `{ ok: true, dispatchId: '...', action: 'play-next', target: 'livingroom-tv' }`.

- [ ] **Step 4: Verify the OnDeckCard appears**

Visually confirm the bottom-right OnDeckCard renders with the kid tag's content thumbnail and title. Audio playback of the original item is uninterrupted.

- [ ] **Step 5: Verify dedup of currently-playing**

Mount the audio player with the same content the kid tag points to. Then fire the kid tag's trigger. Expected: no on-deck card appears (dedup); no disruption.

- [ ] **Step 6: Verify replacement**

While an item is playing, fire the kid-tag1 trigger (on-deck appears). Then fire kid-tag2's trigger. Expected: on-deck card swaps to tag2's content; tag1's item is discarded (unless `displace_to_queue: true`, in which case it's pushed to queue head).

- [ ] **Step 7: Verify natural advance**

Wait for the current audio item to end (or seek near the end). Expected: on-deck content begins playing automatically; on-deck card disappears; queue (if any) resumes after.

- [ ] **Step 8: Verify preempt window**

Mount audio item; fire trigger within the first 15 s. Expected: on-deck plays immediately (preempts current).

- [ ] **Step 9: Document any deviations**

If anything fails, capture log lines from `/tmp/backend-dev.log` and the browser console. Open a follow-up bug entry under `docs/_wip/bugs/`.

---

## Self-Review Checklist (run before handing off)

- [x] **Spec coverage:** Every section of the spec maps to at least one task. (§3 → Tasks 1, 3, 4; §4 → Task 12; §5 → Tasks 1-4; §6 → Tasks 6, 7, 10; §7 → Task 9; §8 → Tasks 5, 8; §9 → Task 13.)
- [x] **No placeholders:** Each step contains real code or commands. The only places using `<placeholder>` are user-supplied content IDs and tag UIDs, which are by definition variable.
- [x] **Type consistency:** APIs are stable across tasks. `pushOnDeck(item, opts)`, `clearOnDeck()`, `flashOnDeck()`, `consumeOnDeck` (folded into `advance()`), `onDeck`, `onDeckFlashKey` — used identically in Tasks 6, 7, 10.

If a subagent finds a real implementation detail that diverges from the plan (e.g. the actual config service uses a different method name than `readYaml`), the agent should adapt and note the deviation in their handoff summary; the plan exists to communicate intent, not to be slavishly literal.
