# Fix Office-Program Trigger — Envelope Migration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make office-program (and all other WS-delivered content commands) actually play when triggered. Fix the silent drop caused by the 2026-04-17 envelope migration leaving backend producers unconverted.

**Architecture:** Three changes stitched together:
1. **Frontend:** `ScreenActionHandler` grows a `media:queue-op` handler that bridges `op: play-now` into the existing `handleMediaQueue` (mount Player with contentId + options). This wires the envelope `queue` command to actually mount a Player.
2. **Backend adapter:** `WebSocketContentAdapter.load()` stops broadcasting `{...query, timestamp}` (flat legacy) and starts broadcasting a `CommandEnvelope` built via `buildCommandEnvelope({ command: 'queue', params: { op: 'play-now', contentId, ...options } })`. Requires threading `deviceId` through to the adapter so `targetDevice` can be set.
3. **Backend orchestrator:** `WakeAndLoadService` WS-first and WS-fallback broadcasts produce the same envelope, and `waitForMessage` is updated to match the new `device-ack` topic + matching `commandId` (the frontend already sends these via `useCommandAckPublisher`; the old `content-ack` predicate never matches anymore).

Livingroom-TV is unaffected because FullyKioskContentAdapter navigates URLs via REST, not WS. The scope here is narrowly the WS content delivery path that office-tv (and any future WS-only device) uses. Barcode scanner flat-shape producers (also in the 2026-04-17 audit) are **out of scope** for this plan — separate fix.

**Tech Stack:**
- Backend: Node ESM, jest (tests in `backend/tests/unit/suite/...`)
- Frontend: React, jest + Testing Library (tests colocated as `.test.jsx`)
- Shared: `@shared-contracts/media/envelopes.mjs` already provides `buildCommandEnvelope` and `validateCommandEnvelope`

---

## File Structure

**Frontend:**
- Modify: `frontend/src/screen-framework/actions/ScreenActionHandler.jsx` — add `handleMediaQueueOp` + `useScreenAction` binding
- Modify: `frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx` — add tests for new handler

**Backend adapter:**
- Modify: `backend/src/1_adapters/devices/WebSocketContentAdapter.mjs` — swap flat broadcast for envelope; accept `deviceId` in constructor config
- Modify: `backend/src/3_applications/devices/DeviceFactory.mjs` (or wherever WebSocketContentAdapter is instantiated) — pass `deviceId` into the adapter config
- Create: `backend/tests/unit/suite/1_adapters/devices/WebSocketContentAdapter.test.mjs` — unit test for envelope broadcast

**Backend orchestrator:**
- Modify: `backend/src/3_applications/devices/services/WakeAndLoadService.mjs` — swap both flat WS broadcasts for envelopes; update `waitForMessage` predicate
- Modify: `backend/tests/unit/suite/3_applications/devices/WakeAndLoadService.test.mjs` — update ack fixture to new shape; add tests for new envelope broadcasts

**No schema changes needed.** The envelope contract already exists in `shared/contracts/media/envelopes.mjs` and supports `{ command: 'queue', params: { op: 'play-now', contentId } }`.

---

## Preflight

- [ ] **Step 0.1: Create worktree (recommended)**

Run:
```bash
cd /opt/Code/DaylightStation
git worktree add -b fix/office-program-envelope-migration /tmp/ds-office-envelope main
cd /tmp/ds-office-envelope
```

Expected: new worktree at `/tmp/ds-office-envelope`, branch `fix/office-program-envelope-migration`.

All subsequent edits happen in this worktree. Skip if the user wants to work on the existing branch.

- [ ] **Step 0.2: Confirm baseline tests pass**

Run:
```bash
cd /tmp/ds-office-envelope
npm test -- --testPathPattern="ScreenActionHandler|WebSocketContentAdapter|WakeAndLoadService" 2>&1 | tail -30
```

Expected: all existing tests pass. If any existing test is already failing, stop and investigate before proceeding.

---

## Task 1: Bridge `media:queue-op` → Player mount (frontend)

**Files:**
- Modify: `frontend/src/screen-framework/actions/ScreenActionHandler.jsx:117-124` (add new handler), `:343` (add binding)
- Modify: `frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx`

The envelope `command: 'queue'` with `params: { op: 'play-now', contentId }` currently emits `media:queue-op` on the ActionBus, but **nothing listens for it** — this is the reason office-program silently drops. We bridge `op: 'play-now'` into the existing `handleMediaQueue` (which mounts the Player). Other ops (`add`, `play-next`, `clear`, …) are logged as unhandled for now; they'll be wired in a follow-up when the Media App ships queue-ops UI.

- [ ] **Step 1.1: Write failing test for `op: play-now`**

Open `frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx`. Find the `describe('ScreenActionHandler', ...)` block (near line 1-80). Add this test alongside the existing `media:queue` test (around line 68-85):

```jsx
it('mounts Player overlay on media:queue-op with op=play-now', () => {
  const showOverlay = jest.fn();
  const dismissOverlay = jest.fn();

  render(
    <MockScreenOverlayProvider value={{ showOverlay, dismissOverlay, hasOverlay: false, escapeInterceptorRef: { current: null } }}>
      <ScreenActionHandler />
    </MockScreenOverlayProvider>
  );

  act(() => getActionBus().emit('media:queue-op', {
    op: 'play-now',
    contentId: 'plex:777',
    shader: 'dark',
    shuffle: true,
    commandId: 'cmd-abc',
  }));

  expect(dismissOverlay).toHaveBeenCalledTimes(1);
  expect(showOverlay).toHaveBeenCalledTimes(1);
  const [Component, props] = showOverlay.mock.calls[0];
  expect(Component).toBe(Player);
  expect(props.queue).toMatchObject({
    contentId: 'plex:777',
    shader: 'dark',
    shuffle: true,
  });
});

it('ignores media:queue-op with non play-now op (logs debug)', () => {
  const showOverlay = jest.fn();
  const dismissOverlay = jest.fn();

  render(
    <MockScreenOverlayProvider value={{ showOverlay, dismissOverlay, hasOverlay: false, escapeInterceptorRef: { current: null } }}>
      <ScreenActionHandler />
    </MockScreenOverlayProvider>
  );

  act(() => getActionBus().emit('media:queue-op', {
    op: 'clear',
    commandId: 'cmd-xyz',
  }));

  expect(showOverlay).not.toHaveBeenCalled();
  expect(dismissOverlay).not.toHaveBeenCalled();
});
```

Check the imports at the top of the test file match — `MockScreenOverlayProvider`, `ScreenActionHandler`, `Player`, `getActionBus`, `act`, `render`. If any of these aren't imported, add them (copy from the existing `media:queue` test pattern).

- [ ] **Step 1.2: Run the test to verify it fails**

Run:
```bash
cd /tmp/ds-office-envelope
npx jest frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx -t "play-now" --no-coverage 2>&1 | tail -30
```

Expected: FAIL — `showOverlay` is not called because nothing handles `media:queue-op`.

- [ ] **Step 1.3: Implement `handleMediaQueueOp`**

Open `frontend/src/screen-framework/actions/ScreenActionHandler.jsx`. After `handleMediaQueue` (ends around line 124), add:

```jsx
  // --- Queue ops (envelope command=queue) ---
  // For `op: play-now`, mount the Player with the contentId (same as media:queue).
  // Other ops (add, play-next, remove, clear, jump, reorder) will be wired when
  // the Media App ships queue manipulation UI.
  const handleMediaQueueOp = useCallback((payload) => {
    const op = payload?.op;
    if (op === 'play-now') {
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

Then scroll to the `useScreenAction` bindings block (around line 340-349) and add the binding alongside the others:

```jsx
  useScreenAction('media:queue', handleMediaQueue);
  useScreenAction('media:queue-op', handleMediaQueueOp);  // ← ADD THIS LINE
  useScreenAction('media:playback', handleMediaPlayback);
```

- [ ] **Step 1.4: Run test to verify it passes**

Run:
```bash
npx jest frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx -t "play-now" --no-coverage 2>&1 | tail -20
```

Expected: PASS for both the `play-now` test and the `ignores...non play-now op` test.

- [ ] **Step 1.5: Run the full ScreenActionHandler suite**

Run:
```bash
npx jest frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx --no-coverage 2>&1 | tail -20
```

Expected: all tests pass. If the existing `media:queue` test still asserts `lastMediaRef` dedup behavior, `op: 'play-now'` will also participate in that dedup window (intentional — same content within 3s should not re-mount twice).

- [ ] **Step 1.6: Commit**

```bash
git add frontend/src/screen-framework/actions/ScreenActionHandler.jsx frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx
git commit -m "$(cat <<'EOF'
feat(screen-framework): bridge media:queue-op play-now → Player mount

Envelope command=queue op=play-now now mounts the Player via handleMediaQueue.
Fixes silent drop of office-program and all other WS-delivered content
commands since the 2026-04-17 envelope migration.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Thread `deviceId` into `WebSocketContentAdapter`

**Files:**
- Modify: `backend/src/1_adapters/devices/WebSocketContentAdapter.mjs`
- Modify: Adapter instantiation site (see Step 2.1 below — find via grep)

The adapter currently knows only its `topic` (e.g., `'office'`). The envelope needs `targetDevice` (e.g., `'office-tv'`). Add a `deviceId` constructor config field and thread it from wherever the adapter is built.

- [ ] **Step 2.1: Find where `WebSocketContentAdapter` is instantiated**

Run:
```bash
cd /tmp/ds-office-envelope
grep -rn "new WebSocketContentAdapter\|WebSocketContentAdapter(" backend/src backend/tests 2>/dev/null
```

Expected: one or two production sites (likely in a factory under `backend/src/3_applications/devices/` or `backend/src/0_system/`) plus test sites. **Record the exact file paths** — they're needed in Step 2.4.

- [ ] **Step 2.2: Write failing test for envelope broadcast**

Create `backend/tests/unit/suite/1_adapters/devices/WebSocketContentAdapter.test.mjs`:

```javascript
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import WebSocketContentAdapter from '../../../../../src/1_adapters/devices/WebSocketContentAdapter.mjs';
import { validateCommandEnvelope } from '#shared-contracts/media/envelopes.mjs';

describe('WebSocketContentAdapter', () => {
  let wsBus;
  let adapter;

  beforeEach(() => {
    wsBus = { broadcast: jest.fn().mockResolvedValue(undefined), getSubscribers: jest.fn().mockReturnValue([]) };
    adapter = new WebSocketContentAdapter(
      { topic: 'office', deviceId: 'office-tv', daylightHost: 'http://localhost:3111' },
      { wsBus, logger: { info: jest.fn(), error: jest.fn() } }
    );
  });

  it('load() broadcasts a valid CommandEnvelope (command=queue, op=play-now)', async () => {
    const result = await adapter.load('/tv', { queue: 'office-program', shader: 'dark', shuffle: '1' });

    expect(result.ok).toBe(true);
    expect(wsBus.broadcast).toHaveBeenCalledTimes(1);
    const [topic, payload] = wsBus.broadcast.mock.calls[0];
    expect(topic).toBe('office');
    expect(payload.type).toBe('command');
    expect(payload.command).toBe('queue');
    expect(payload.targetDevice).toBe('office-tv');
    expect(payload.params).toMatchObject({
      op: 'play-now',
      contentId: 'office-program',
      shader: 'dark',
      shuffle: '1',
    });
    expect(typeof payload.commandId).toBe('string');
    expect(payload.commandId.length).toBeGreaterThan(0);

    // Envelope must validate against the shared contract
    expect(validateCommandEnvelope(payload).valid).toBe(true);
  });

  it('load() resolves contentId from query.queue|play|plex|hymn|contentId in that order', async () => {
    await adapter.load('/tv', { plex: 'plex:12345', shader: 'dark' });
    const [, payload] = wsBus.broadcast.mock.calls[0];
    expect(payload.params.contentId).toBe('plex:12345');
  });

  it('load() returns {ok:false} and logs error when no contentId can be resolved', async () => {
    const logger = { info: jest.fn(), error: jest.fn() };
    const a = new WebSocketContentAdapter(
      { topic: 'office', deviceId: 'office-tv' },
      { wsBus, logger }
    );
    const result = await a.load('/tv', { shader: 'dark' });  // no queue/play/plex/etc.
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/content/i);
    expect(wsBus.broadcast).not.toHaveBeenCalled();
  });

  it('load() propagates commandId into result so caller can correlate acks', async () => {
    const result = await adapter.load('/tv', { queue: 'office-program' });
    const [, payload] = wsBus.broadcast.mock.calls[0];
    expect(result.commandId).toBe(payload.commandId);
  });
});
```

- [ ] **Step 2.3: Run test to verify failure**

Run:
```bash
npx jest backend/tests/unit/suite/1_adapters/devices/WebSocketContentAdapter.test.mjs --no-coverage 2>&1 | tail -40
```

Expected: FAIL — either the file doesn't compile, or broadcast is being called with the flat shape. Confirm at least one test fails with a message about envelope shape.

- [ ] **Step 2.4: Rewrite `WebSocketContentAdapter.load()` to emit an envelope**

Open `backend/src/1_adapters/devices/WebSocketContentAdapter.mjs`. Replace the whole file contents with:

```javascript
/**
 * WebSocketContentAdapter - Content control via WebSocket broadcast
 *
 * Implements IContentControl port for devices connected via WebSocket.
 * Broadcasts structured CommandEnvelopes (shared-contracts §6.2) to a topic
 * the target device is subscribed to.
 *
 * @module adapters/devices
 */

import { randomUUID } from 'node:crypto';
import { buildCommandEnvelope } from '#shared-contracts/media/envelopes.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * Keys in a query that identify a content reference, in priority order.
 * The first one present becomes the envelope's `params.contentId`.
 */
const CONTENT_ID_KEYS = ['queue', 'play', 'plex', 'hymn', 'primary', 'scripture', 'contentId'];

export class WebSocketContentAdapter {
  #topic;
  #deviceId;
  #wsBus;
  #daylightHost;
  #logger;
  #metrics;

  /**
   * @param {Object} config
   * @param {string} config.topic - WebSocket topic to broadcast to
   * @param {string} config.deviceId - Device this adapter controls (for `targetDevice` in envelope)
   * @param {string} [config.daylightHost] - Informational; not used in envelope broadcasts
   * @param {Object} deps
   * @param {Object} deps.wsBus - WebSocket broadcast service
   * @param {Object} [deps.logger]
   */
  constructor(config, deps = {}) {
    if (!deps.wsBus) {
      throw new InfrastructureError('WebSocketContentAdapter requires wsBus', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'wsBus',
      });
    }
    if (!config?.deviceId) {
      throw new InfrastructureError('WebSocketContentAdapter requires deviceId', {
        code: 'MISSING_CONFIG',
        field: 'deviceId',
      });
    }

    this.#topic = config.topic;
    this.#deviceId = config.deviceId;
    this.#wsBus = deps.wsBus;
    this.#daylightHost = config.daylightHost;
    this.#logger = deps.logger || console;

    this.#metrics = { startedAt: Date.now(), loads: 0, errors: 0 };
  }

  async prepareForContent() {
    return { ok: true };
  }

  /**
   * Load content by broadcasting a CommandEnvelope to the device's topic.
   *
   * Resolves a contentId from common legacy query keys (`queue`, `play`, `plex`,
   * `hymn`, `primary`, `scripture`, `contentId`) and wraps them in a
   * `command=queue, op=play-now` envelope. All other query fields are spread
   * into `params` so shader/volume/shuffle/prewarm tokens still flow.
   */
  async load(path, query = {}) {
    const startTime = Date.now();
    this.#metrics.loads++;

    let contentId = null;
    let resolvedFromKey = null;
    for (const key of CONTENT_ID_KEYS) {
      if (typeof query[key] === 'string' && query[key].length > 0) {
        contentId = query[key];
        resolvedFromKey = key;
        break;
      }
    }

    if (!contentId) {
      this.#metrics.errors++;
      const error = `WebSocketContentAdapter.load: no contentId could be resolved from query keys ${CONTENT_ID_KEYS.join(', ')}`;
      this.#logger.error?.('websocket.load.missing-contentId', { topic: this.#topic, deviceId: this.#deviceId, queryKeys: Object.keys(query) });
      return { ok: false, topic: this.#topic, error };
    }

    // Strip the content-reference key out of the options so it doesn't duplicate
    // inside params (contentId is already at the top level).
    const options = { ...query };
    delete options[resolvedFromKey];

    try {
      const commandId = randomUUID();
      const envelope = buildCommandEnvelope({
        targetDevice: this.#deviceId,
        command: 'queue',
        commandId,
        params: { op: 'play-now', contentId, ...options },
      });

      this.#logger.info?.('websocket.load', {
        topic: this.#topic,
        deviceId: this.#deviceId,
        commandId,
        contentId,
        optionKeys: Object.keys(options),
      });

      await this.#wsBus.broadcast(this.#topic, envelope);

      return {
        ok: true,
        topic: this.#topic,
        commandId,
        loadTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      this.#metrics.errors++;
      this.#logger.error?.('websocket.load.error', {
        topic: this.#topic,
        deviceId: this.#deviceId,
        error: error.message,
      });
      return { ok: false, topic: this.#topic, error: error.message };
    }
  }

  async getStatus() {
    const subscribers = this.#wsBus.getSubscribers?.(this.#topic) || [];
    return {
      ready: subscribers.length > 0,
      provider: 'websocket',
      topic: this.#topic,
      subscriberCount: subscribers.length,
    };
  }

  getMetrics() {
    return {
      provider: 'websocket',
      topic: this.#topic,
      deviceId: this.#deviceId,
      uptime: Date.now() - this.#metrics.startedAt,
      loads: this.#metrics.loads,
      errors: this.#metrics.errors,
    };
  }
}

export default WebSocketContentAdapter;
```

- [ ] **Step 2.5: Update adapter instantiation site(s) to pass `deviceId`**

For each file found in Step 2.1, find the `new WebSocketContentAdapter({ topic: ... }, ...)` call and add `deviceId: <the device's id>` to the config object. If the device id is on the enclosing device object (likely — this adapter is created inside a device factory), pass it like:

```javascript
new WebSocketContentAdapter(
  { topic: device.topic, deviceId: device.id, daylightHost: config.daylightHost },
  { wsBus, logger }
)
```

If you can't find an obvious `device.id` in scope, look at how `FullyKioskContentAdapter` receives its device context — mirror that pattern.

- [ ] **Step 2.6: Run adapter tests**

Run:
```bash
npx jest backend/tests/unit/suite/1_adapters/devices/WebSocketContentAdapter.test.mjs --no-coverage 2>&1 | tail -20
```

Expected: all four tests PASS.

- [ ] **Step 2.7: Run the full adapter suite to catch instantiation-site regressions**

Run:
```bash
npx jest backend/tests/unit/suite/1_adapters/devices/ --no-coverage 2>&1 | tail -30
```

Expected: all adapter tests pass. If a test fails with `MISSING_CONFIG: deviceId`, that instantiation site was missed in Step 2.5 — fix it there, not by loosening the validation.

- [ ] **Step 2.8: Commit**

```bash
git add backend/src/1_adapters/devices/WebSocketContentAdapter.mjs backend/tests/unit/suite/1_adapters/devices/WebSocketContentAdapter.test.mjs <instantiation-site-files-from-step-2.1>
git commit -m "$(cat <<'EOF'
feat(adapters): WebSocketContentAdapter emits CommandEnvelope instead of flat payload

Replaces the legacy {...query, timestamp} flat broadcast (rejected by the
frontend since the 2026-04-17 envelope migration) with a structured
CommandEnvelope: command=queue, params={op:play-now, contentId, ...options}.
Adds a required deviceId constructor field so targetDevice is correctly set.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: WakeAndLoadService — WS-first envelope broadcast + `device-ack` matching

**Files:**
- Modify: `backend/src/3_applications/devices/services/WakeAndLoadService.mjs:361-389` (WS-first block)
- Modify: `backend/tests/unit/suite/3_applications/devices/WakeAndLoadService.test.mjs`

WS-first currently broadcasts flat `{ topic, targetDevice, ...contentQuery }` and waits for `type: 'content-ack'` — neither shape is produced or consumed anymore. Replace the broadcast with a CommandEnvelope and match on the `device-ack` topic from `useCommandAckPublisher`.

- [ ] **Step 3.1: Write failing test — WS-first emits envelope**

Open `backend/tests/unit/suite/3_applications/devices/WakeAndLoadService.test.mjs`. Find the existing test that asserts the WS-first broadcast (grep for `content-ack` or `ws-first` inside the file). Add a new test alongside it:

```javascript
it('WS-first broadcast emits a valid CommandEnvelope (command=queue, op=play-now)', async () => {
  // Arrange: a warm-prepare scenario with WS subscribers present
  const broadcast = jest.fn();
  const eventBus = {
    getTopicSubscriberCount: jest.fn().mockReturnValue(1),
    waitForMessage: jest.fn().mockResolvedValue({
      topic: 'device-ack',
      deviceId: 'office-tv',
      commandId: 'CMD_ID_PLACEHOLDER',  // replaced below after we capture it
      ok: true,
    }),
  };
  const service = new WakeAndLoadService({
    deviceService: makeMockDeviceService({ id: 'office-tv', coldWake: false, hasContentControl: true }),
    readinessPolicy: { isReady: jest.fn().mockResolvedValue({ ready: true }) },
    broadcast,
    eventBus,
  });

  // Act
  const result = await service.execute('office-tv', { queue: 'office-program', shader: 'dark' });

  // Assert: the WS-first broadcast is a CommandEnvelope
  const wsFirstBroadcast = broadcast.mock.calls.find(([payload]) => payload?.type === 'command');
  expect(wsFirstBroadcast).toBeDefined();
  const [payload] = wsFirstBroadcast;
  expect(payload.topic).toBe('homeline:office-tv');
  expect(payload.command).toBe('queue');
  expect(payload.targetDevice).toBe('office-tv');
  expect(payload.params).toMatchObject({
    op: 'play-now',
    contentId: 'office-program',
    shader: 'dark',
  });
  expect(typeof payload.commandId).toBe('string');

  // waitForMessage was called with a predicate that matches device-ack with same commandId
  expect(eventBus.waitForMessage).toHaveBeenCalled();
  const [predicate] = eventBus.waitForMessage.mock.calls[0];
  expect(predicate({ topic: 'device-ack', deviceId: 'office-tv', commandId: payload.commandId, ok: true })).toBe(true);
  expect(predicate({ topic: 'device-ack', deviceId: 'other', commandId: payload.commandId, ok: true })).toBe(false);
  expect(predicate({ topic: 'content-ack', screen: 'office' })).toBe(false);
});
```

If `makeMockDeviceService` doesn't already exist in the test file, use whatever fixture the existing tests use — copy the pattern from the neighboring tests rather than inventing a new mock shape.

- [ ] **Step 3.2: Run test to verify failure**

Run:
```bash
npx jest backend/tests/unit/suite/3_applications/devices/WakeAndLoadService.test.mjs -t "WS-first broadcast emits" --no-coverage 2>&1 | tail -30
```

Expected: FAIL — the broadcast is still flat, or the predicate still matches `content-ack`.

- [ ] **Step 3.3: Implement WS-first envelope broadcast**

Open `backend/src/3_applications/devices/services/WakeAndLoadService.mjs`. Locate the WS-first block (around line 361-389). Replace:

```javascript
      if (subscriberCount > 0) {
        try {
          // Broadcast content command (targeted to this device)
          this.#broadcast({ topic, targetDevice: deviceId, ...contentQuery });

          // Wait for ack from the screen (frontend sends screen name, not device ID)
          const ackStart = Date.now();
          await this.#eventBus.waitForMessage(
            (msg) => msg.type === 'content-ack' && msg.screen === screenName,
            4000
          );
```

With:

```javascript
      if (subscriberCount > 0) {
        try {
          // Resolve contentId from the query using the same priority as
          // WebSocketContentAdapter. If nothing resolves, skip WS-first entirely.
          const contentIdKeys = ['queue', 'play', 'plex', 'hymn', 'primary', 'scripture', 'contentId'];
          let resolvedContentId = null;
          let resolvedKey = null;
          for (const k of contentIdKeys) {
            if (typeof contentQuery[k] === 'string' && contentQuery[k].length > 0) {
              resolvedContentId = contentQuery[k];
              resolvedKey = k;
              break;
            }
          }
          if (!resolvedContentId) {
            throw new Error('ws-first.no-contentId');
          }

          const opts = { ...contentQuery };
          delete opts[resolvedKey];

          // Reuse dispatchId as commandId — matches the adopt-snapshot pattern
          // a few lines up and keeps all correlated logs tied to one id.
          const envelope = buildCommandEnvelope({
            targetDevice: deviceId,
            command: 'queue',
            commandId: dispatchId,
            params: { op: 'play-now', contentId: resolvedContentId, ...opts },
          });
          this.#broadcast({ topic, ...envelope });

          // Wait for ack from the frontend (useCommandAckPublisher emits
          // device-ack with matching commandId once the command reaches a handler).
          const ackStart = Date.now();
          await this.#eventBus.waitForMessage(
            (msg) =>
              msg?.topic === 'device-ack' &&
              msg?.deviceId === deviceId &&
              msg?.commandId === dispatchId,
            4000
          );
```

Keep the rest of the `try` block (the `ackMs` logging and `wsDelivered = true`) as-is. Do not remove the `warn` / `fall through` catch block — on timeout (or no contentId), we still want the FKB fallback path to run.

- [ ] **Step 3.4: Run the WS-first test to verify it passes**

Run:
```bash
npx jest backend/tests/unit/suite/3_applications/devices/WakeAndLoadService.test.mjs -t "WS-first broadcast emits" --no-coverage 2>&1 | tail -20
```

Expected: PASS.

- [ ] **Step 3.5: Update or delete the legacy `content-ack` fixture test**

Existing test fixtures in this file set up `ackMessage: { type: 'content-ack', screen: 'living-room', ... }`. These fixtures should either:
- (a) be updated to `{ topic: 'device-ack', deviceId: 'living-room-tv', commandId: <captured>, ok: true }`, or
- (b) be left asserting the legacy shape is **no longer expected** — if the test's intent was "ensure content-ack completes the flow", it now documents a broken state; rewrite it to assert `device-ack` completes the flow instead.

Run the existing test suite and read each failure:

```bash
npx jest backend/tests/unit/suite/3_applications/devices/WakeAndLoadService.test.mjs --no-coverage 2>&1 | tail -40
```

For each failure, update the fixture to use the new ack shape (matching what `useCommandAckPublisher` actually emits). Do **not** introduce a compat shim — the goal is to complete the migration, not preserve two shapes.

- [ ] **Step 3.6: Commit**

```bash
git add backend/src/3_applications/devices/services/WakeAndLoadService.mjs backend/tests/unit/suite/3_applications/devices/WakeAndLoadService.test.mjs
git commit -m "$(cat <<'EOF'
feat(devices): WakeAndLoadService WS-first uses CommandEnvelope + device-ack

Replaces the flat {topic, targetDevice, ...contentQuery} broadcast with a
CommandEnvelope (command=queue, op=play-now), and matches the ack via the
device-ack topic emitted by useCommandAckPublisher instead of the obsolete
content-ack shape.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: WakeAndLoadService — WS-fallback envelope broadcast

**Files:**
- Modify: `backend/src/3_applications/devices/services/WakeAndLoadService.mjs:428-433` (WS-fallback block inside the URL-load-failed branch)
- Modify: `backend/tests/unit/suite/3_applications/devices/WakeAndLoadService.test.mjs`

Symmetry with Task 3: the fallback path also broadcasts flat. Same fix.

- [ ] **Step 4.1: Write failing test for fallback envelope broadcast**

In `WakeAndLoadService.test.mjs`, find or add a test that forces the FKB `loadContent` to fail and asserts the WS-fallback payload shape. Add:

```javascript
it('WS-fallback broadcast (after FKB loadContent fails) emits a valid CommandEnvelope', async () => {
  const broadcast = jest.fn();
  const eventBus = {
    getTopicSubscriberCount: jest.fn().mockReturnValue(0),  // force ws-first skip
    waitForMessage: jest.fn(),
  };
  const loadContent = jest.fn()
    .mockResolvedValueOnce({ ok: false, error: 'URL load failed' })  // primary fails
    .mockResolvedValueOnce({ ok: true });                              // base URL succeeds
  const device = makeMockDeviceService({ id: 'office-tv', coldWake: true, hasContentControl: true });
  device.get('office-tv').loadContent = loadContent;

  const service = new WakeAndLoadService({
    deviceService: device,
    readinessPolicy: { isReady: jest.fn().mockResolvedValue({ ready: true }) },
    broadcast,
    eventBus,
  });

  await service.execute('office-tv', { queue: 'office-program' });

  // Find the fallback envelope (the one without `topic` key spread by #emitProgress)
  const fallbackBroadcasts = broadcast.mock.calls
    .map(([p]) => p)
    .filter((p) => p?.type === 'command' && p.command === 'queue');
  expect(fallbackBroadcasts.length).toBeGreaterThanOrEqual(1);

  const envelope = fallbackBroadcasts[fallbackBroadcasts.length - 1];
  expect(envelope.targetDevice).toBe('office-tv');
  expect(envelope.params).toMatchObject({ op: 'play-now', contentId: 'office-program' });
});
```

Adjust the mock-device-service helper to match the codebase's existing fixture shape if needed.

- [ ] **Step 4.2: Run to verify failure**

Run:
```bash
npx jest backend/tests/unit/suite/3_applications/devices/WakeAndLoadService.test.mjs -t "WS-fallback" --no-coverage 2>&1 | tail -30
```

Expected: FAIL.

- [ ] **Step 4.3: Implement WS-fallback envelope**

In `WakeAndLoadService.mjs`, locate the fallback block (around line 428-433):

```javascript
        // Broadcast content command via WebSocket (targeted to this device)
        this.#broadcast({ targetDevice: deviceId, ...contentQuery });
        this.#logger.info?.('wake-and-load.load.wsFallbackSent', {
          deviceId, dispatchId, contentQuery
        });
```

Replace with:

```javascript
        // Broadcast content command via CommandEnvelope (targeted to this device)
        const fallbackContentIdKeys = ['queue', 'play', 'plex', 'hymn', 'primary', 'scripture', 'contentId'];
        let fbContentId = null;
        let fbResolvedKey = null;
        for (const k of fallbackContentIdKeys) {
          if (typeof contentQuery[k] === 'string' && contentQuery[k].length > 0) {
            fbContentId = contentQuery[k];
            fbResolvedKey = k;
            break;
          }
        }
        if (!fbContentId) {
          this.#logger.warn?.('wake-and-load.load.wsFallback.no-contentId', {
            deviceId, dispatchId, queryKeys: Object.keys(contentQuery),
          });
        } else {
          const fbOpts = { ...contentQuery };
          delete fbOpts[fbResolvedKey];

          // Reuse dispatchId as commandId (same rationale as the WS-first path).
          const fbEnvelope = buildCommandEnvelope({
            targetDevice: deviceId,
            command: 'queue',
            commandId: dispatchId,
            params: { op: 'play-now', contentId: fbContentId, ...fbOpts },
          });
          this.#broadcast({ topic, ...fbEnvelope });
          this.#logger.info?.('wake-and-load.load.wsFallbackSent', {
            deviceId, dispatchId, contentId: fbContentId,
          });
        }
```

Note: the `topic` variable (`homeline:${deviceId}`) is already in scope from earlier in `#executeInner`. The fallback broadcast originally relied on the `#broadcast` wrapper implicitly routing via `targetDevice`; we explicitly pass `topic` for correctness.

- [ ] **Step 4.4: Run to verify pass**

Run:
```bash
npx jest backend/tests/unit/suite/3_applications/devices/WakeAndLoadService.test.mjs -t "WS-fallback" --no-coverage 2>&1 | tail -20
```

Expected: PASS.

- [ ] **Step 4.5: Run the full WakeAndLoadService suite**

Run:
```bash
npx jest backend/tests/unit/suite/3_applications/devices/WakeAndLoadService.test.mjs --no-coverage 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 4.6: Commit**

```bash
git add backend/src/3_applications/devices/services/WakeAndLoadService.mjs backend/tests/unit/suite/3_applications/devices/WakeAndLoadService.test.mjs
git commit -m "$(cat <<'EOF'
feat(devices): WakeAndLoadService WS-fallback uses CommandEnvelope

Mirrors Task 3 for the fallback path triggered when FKB loadContent fails.
Completes the migration of all three WS content-command producers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Full-suite regression check

**Files:** none modified — verification only.

- [ ] **Step 5.1: Run full backend test suite**

Run:
```bash
cd /tmp/ds-office-envelope
npm test -- --testPathPattern="backend" 2>&1 | tail -40
```

Expected: all tests pass. If anything unrelated broke, investigate — do not skip or mark tests pending. Common culprits: another place calls `device.loadContent` and now sees `{ok: false, error: 'no contentId'}` because it was calling with non-content-key queries. Adjust the caller or the adapter's legacy-key list accordingly, with a targeted test.

- [ ] **Step 5.2: Run full frontend test suite**

Run:
```bash
npm test -- --testPathPattern="frontend" 2>&1 | tail -40
```

Expected: all tests pass.

- [ ] **Step 5.3: Lint**

Run:
```bash
npm run lint 2>&1 | tail -20
```

Expected: clean, or warnings unrelated to this change. Address any new errors introduced by these edits.

---

## Task 6: Manual end-to-end verification on prod

**Files:** none. Deploys a build; exercises the trigger; reads logs.

Per `CLAUDE.md` rule — user runs the deploy; Claude reads logs and reports results. Don't auto-deploy.

- [ ] **Step 6.1: Build and deploy (USER EXECUTES)**

User runs (or approves you to run):
```bash
cd /opt/Code/DaylightStation
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

- [ ] **Step 6.2: Force-reload the office-tv browser**

The office-tv browser is on an always-on Linux PC. After deploy, cached JS will be stale. Reload via the mechanism documented in `CLAUDE.md` (WS `{'action':'reset'}` on the `office` topic, or manual refresh via SSH to `172.17.0.1`).

```bash
curl -s -X POST http://localhost:3111/api/v1/ws/broadcast \
  -H 'Content-Type: application/json' \
  -d '{"topic":"office","payload":{"action":"reset"}}'
```

Then wait 10s for the reload to settle before Step 6.3.

- [ ] **Step 6.3: Trigger the office program**

```bash
curl -s "http://localhost:3111/api/v1/device/office-tv/load?queue=office-program&shader=dark"
```

Expected: HTTP 200 with `{"ok": true, "totalElapsedMs": ~15000-25000, ...}`.

- [ ] **Step 6.4: Verify from logs — playback actually started**

```bash
sudo docker logs daylight-station --since 3m 2>&1 | grep -E "office-program|queue.resolve|playback.started|device-ack|wake-and-load.load" | tail -30
```

Expected log progression:
1. `device.router.load.start ... query:{queue:'office-program'}`
2. `wake-and-load.power.done verified:true`
3. `wake-and-load.prewarm.done` (or `skipped`)
4. `wake-and-load.load.start`
5. `wake-and-load.load.ws-check subscriberCount:>=1`
6. **`wake-and-load.load.ws-ack ackMs:<4000`** — this is the success signal. Previously this was `wake-and-load.load.ws-failed`.
7. `GET /api/v1/queue/office-program` → backend resolves queue to N items
8. `playback.started ... mediaType:(audio|video)`
9. `wake-and-load.complete totalElapsedMs:<25000`

If `wake-and-load.load.ws-ack` is missing, the ack round-trip is still broken — the failure mode is now "hangs on ack" rather than "silently drops command". Investigate by reading the frontend console (via `ingestFrontendLogs` backend logs) for `CommandAckPublisher` events.

- [ ] **Step 6.5: Verify on-screen**

Walk into the office. The TV should be showing the morning program. If it's on the dashboard but not playing, check `playback.started` was logged — if yes, the issue is a display-layer bug (not what this plan fixes). If no, return to Step 6.4 diagnosis.

- [ ] **Step 6.6: If all green, merge and close the worktree**

```bash
cd /opt/Code/DaylightStation
git checkout main
git merge --no-ff fix/office-program-envelope-migration
git worktree remove /tmp/ds-office-envelope
```

(Skip auto-merge if the user wants to review the combined diff first — merging is a user decision per `CLAUDE.md`.)

- [ ] **Step 6.7: Update audit doc**

Append a "Resolved 2026-04-20" section to `docs/_wip/audits/2026-04-17-backend-flat-command-producers.md` noting which producers are now migrated (WebSocketContentAdapter, WakeAndLoadService WS-first, WakeAndLoadService WS-fallback) and which remain (BarcodeCommandMap, BarcodeScanService#handleCommand, BarcodeScanService#handleContent). Commit as `docs(audit): mark WS content producers migrated; barcode producers still pending`.

---

## Out of Scope (separate plans)

- Barcode command migration (`BarcodeCommandMap`, `BarcodeScanService` — items 1 and 2 in the audit's "Recommended action")
- Handling queue-ops other than `play-now` (add, play-next, remove, clear, jump, reorder) on the frontend — these have no current trigger
- The `adopt-snapshot` path's `SessionSnapshot` seeding (already works — out-of-scope per Task 3 description)
- Office-tv WebSocket reconnect instability (pre-existing, noted in `docs/_wip/bugs/2026-04-04-office-program-queue-empty-after-double-command.md` §Additional Context — not this plan's problem)
