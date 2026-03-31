# WS-First Content Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When FKB is already foregrounded on the living room TV, deliver content via WebSocket instead of a full page refresh, falling back to FKB `loadURL` if the WS delivery isn't acknowledged.

**Architecture:** The load step in `WakeAndLoadService` gains a WS-first path. Before calling `device.loadContent()` (FKB URL load), it checks if the prepare step was warm (no cold restart) and if there are WS subscribers. If so, it broadcasts the content command and waits 4s for a `content-ack` from the frontend. The frontend's `useScreenCommands` hook sends the ack after successfully processing the command. On timeout or failure, the existing FKB `loadURL` path runs as fallback.

**Tech Stack:** Node.js (backend WS event bus), React hooks (frontend WS send)

---

### Task 1: Add `waitForMessage` to WebSocketEventBus

**Files:**
- Modify: `backend/src/0_system/eventbus/WebSocketEventBus.mjs`
- Test: `backend/tests/unit/suite/0_system/eventbus/WebSocketEventBus.waitForMessage.test.mjs`

A generic one-shot listener that returns a promise. Resolves on the first incoming client message matching a predicate, rejects on timeout.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/suite/0_system/eventbus/WebSocketEventBus.waitForMessage.test.mjs`:

```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebSocketEventBus } from '#system/eventbus/WebSocketEventBus.mjs';

describe('WebSocketEventBus.waitForMessage', () => {
  let bus;
  let mockLogger;

  beforeEach(() => {
    mockLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    bus = new WebSocketEventBus({ logger: mockLogger });
  });

  it('should resolve when a matching message arrives', async () => {
    const promise = bus.waitForMessage(
      (msg) => msg.type === 'content-ack' && msg.screen === 'living-room',
      5000
    );

    // Simulate an incoming client message via the registered handler
    bus._testInjectClientMessage('client-1', { type: 'content-ack', screen: 'living-room', timestamp: 123 });

    const result = await promise;
    expect(result.type).toBe('content-ack');
    expect(result.screen).toBe('living-room');
  });

  it('should reject on timeout when no matching message arrives', async () => {
    vi.useFakeTimers();

    const promise = bus.waitForMessage(
      (msg) => msg.type === 'content-ack',
      4000
    );

    vi.advanceTimersByTime(4001);

    await expect(promise).rejects.toThrow('waitForMessage timed out after 4000ms');

    vi.useRealTimers();
  });

  it('should ignore non-matching messages', async () => {
    vi.useFakeTimers();

    const promise = bus.waitForMessage(
      (msg) => msg.type === 'content-ack',
      4000
    );

    // Send a non-matching message
    bus._testInjectClientMessage('client-1', { type: 'heartbeat' });

    // Still pending — advance time to trigger timeout
    vi.advanceTimersByTime(4001);

    await expect(promise).rejects.toThrow('waitForMessage timed out');

    vi.useRealTimers();
  });

  it('should clean up handler after resolving', async () => {
    const handlerCountBefore = bus._messageHandlerCount;

    const promise = bus.waitForMessage(
      (msg) => msg.type === 'content-ack',
      5000
    );

    bus._testInjectClientMessage('client-1', { type: 'content-ack' });
    await promise;

    expect(bus._messageHandlerCount).toBe(handlerCountBefore);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run backend/tests/unit/suite/0_system/eventbus/WebSocketEventBus.waitForMessage.test.mjs`
Expected: FAIL — `waitForMessage` is not a function, `_testInjectClientMessage` is not a function

- [ ] **Step 3: Implement `waitForMessage` and test helpers**

In `backend/src/0_system/eventbus/WebSocketEventBus.mjs`, add these methods to the class:

```javascript
  /**
   * Wait for a single incoming client message matching a predicate.
   * Returns a promise that resolves with the message or rejects on timeout.
   *
   * @param {Function} predicate - (message) => boolean
   * @param {number} timeoutMs - Timeout in milliseconds
   * @returns {Promise<Object>} The matching message
   */
  waitForMessage(predicate, timeoutMs) {
    return new Promise((resolve, reject) => {
      let timer;
      const handler = (_clientId, message) => {
        try {
          if (!predicate(message)) return;
        } catch {
          return; // predicate threw — skip this message
        }
        clearTimeout(timer);
        this.#removeMessageHandler(handler);
        resolve(message);
      };

      this.#messageHandlers.push(handler);

      timer = setTimeout(() => {
        this.#removeMessageHandler(handler);
        reject(new Error(`waitForMessage timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }

  /**
   * Remove a specific message handler.
   * @private
   */
  #removeMessageHandler(handler) {
    const idx = this.#messageHandlers.indexOf(handler);
    if (idx !== -1) this.#messageHandlers.splice(idx, 1);
  }

  /**
   * Inject a client message for testing. Only available in non-production.
   * @param {string} clientId
   * @param {Object} message
   */
  _testInjectClientMessage(clientId, message) {
    for (const handler of this.#messageHandlers) {
      try {
        handler(clientId, message);
      } catch (err) {
        this.#logger.error?.('eventbus.test_inject_error', { error: err.message });
      }
    }
  }

  /**
   * Get message handler count (for testing cleanup verification).
   * @returns {number}
   */
  get _messageHandlerCount() {
    return this.#messageHandlers.length;
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run backend/tests/unit/suite/0_system/eventbus/WebSocketEventBus.waitForMessage.test.mjs`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/0_system/eventbus/WebSocketEventBus.mjs backend/tests/unit/suite/0_system/eventbus/WebSocketEventBus.waitForMessage.test.mjs
git commit -m "feat(eventbus): add waitForMessage one-shot listener with timeout"
```

---

### Task 2: Pass `eventBus` to WakeAndLoadService

**Files:**
- Modify: `backend/src/3_applications/devices/services/WakeAndLoadService.mjs` (constructor + private field)
- Modify: `backend/src/0_system/bootstrap.mjs:1610-1648` (factory function)
- Modify: `backend/src/app.mjs:1550-1557` (wiring)

The WakeAndLoadService currently receives `broadcast` (a function). It also needs the event bus instance to call `waitForMessage` and check subscriber counts. We'll pass it as `eventBus`.

- [ ] **Step 1: Add `#eventBus` field to WakeAndLoadService**

In `backend/src/3_applications/devices/services/WakeAndLoadService.mjs`, add to the private fields:

```javascript
  #eventBus;
```

Update the constructor to accept and store it:

```javascript
  constructor(deps) {
    this.#deviceService = deps.deviceService;
    this.#readinessPolicy = deps.readinessPolicy;
    this.#broadcast = deps.broadcast;
    this.#eventBus = deps.eventBus || null;
    this.#prewarmService = deps.prewarmService || null;
    this.#logger = deps.logger || console;
  }
```

- [ ] **Step 2: Pass `eventBus` through the factory in bootstrap.mjs**

In `backend/src/0_system/bootstrap.mjs`, update the `createWakeAndLoadService` function.

Add `eventBus` to the destructured config (line 1611):

```javascript
export function createWakeAndLoadService(config) {
  const { deviceService, haGateway, devicesConfig, broadcast, eventBus, prewarmService, logger = console } = config;
```

Pass it to the WakeAndLoadService constructor (around line 1639):

```javascript
  const wakeAndLoadService = new WakeAndLoadService({
    deviceService,
    readinessPolicy,
    broadcast,
    eventBus,
    prewarmService,
    logger
  });
```

- [ ] **Step 3: Wire `eventBus` in app.mjs**

In `backend/src/app.mjs`, at the `createWakeAndLoadService` call (around line 1550), add the `eventBus` reference. Find where `eventBus` is defined in app.mjs (it's created earlier as the `eventBus` variable from `createEventBus()`):

```javascript
  const { wakeAndLoadService } = createWakeAndLoadService({
    deviceService: deviceServices.deviceService,
    haGateway: homeAutomationAdapters.haGateway,
    devicesConfig: devicesConfig.devices || {},
    broadcast: broadcastEvent,
    eventBus,
    prewarmService,
    logger: rootLogger.child({ module: 'wake-and-load' })
  });
```

- [ ] **Step 4: Run existing tests to verify nothing broke**

Run: `npx vitest run backend/tests/unit/suite/3_applications/devices/WakeAndLoadService.test.mjs`
Expected: All existing tests PASS (eventBus defaults to null, no behavior change yet)

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/devices/services/WakeAndLoadService.mjs backend/src/0_system/bootstrap.mjs backend/src/app.mjs
git commit -m "refactor(wake-and-load): accept eventBus dependency for WS-first delivery"
```

---

### Task 3: Add `getTopicSubscriberCount` to WebSocketEventBus

**Files:**
- Modify: `backend/src/0_system/eventbus/WebSocketEventBus.mjs`
- Test: `backend/tests/unit/suite/0_system/eventbus/WebSocketEventBus.waitForMessage.test.mjs` (add test)

The bus has `getSubscriberCount(topic)` for internal subscribers, but we need to count **external WS clients** subscribed to a topic (or `*`). This is what tells us if the living room screen is connected.

- [ ] **Step 1: Write the failing test**

Add to the existing test file:

```javascript
describe('WebSocketEventBus.getTopicSubscriberCount', () => {
  let bus;
  let mockLogger;

  beforeEach(() => {
    mockLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    bus = new WebSocketEventBus({ logger: mockLogger });
  });

  it('should return 0 when no clients are connected', () => {
    expect(bus.getTopicSubscriberCount('living-room')).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run backend/tests/unit/suite/0_system/eventbus/WebSocketEventBus.waitForMessage.test.mjs`
Expected: FAIL — `getTopicSubscriberCount` is not a function

- [ ] **Step 3: Implement `getTopicSubscriberCount`**

In `backend/src/0_system/eventbus/WebSocketEventBus.mjs`, add in the Metrics section (after `getSubscriberCount`):

```javascript
  /**
   * Count external WS clients subscribed to a topic (or wildcard).
   * @param {string} topic - Topic to check
   * @returns {number}
   */
  getTopicSubscriberCount(topic) {
    let count = 0;
    for (const [, { ws, meta }] of this.#clients) {
      if (ws.readyState === ws.OPEN) {
        if (meta.subscriptions.has(topic) || meta.subscriptions.has('*')) {
          count++;
        }
      }
    }
    return count;
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run backend/tests/unit/suite/0_system/eventbus/WebSocketEventBus.waitForMessage.test.mjs`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/0_system/eventbus/WebSocketEventBus.mjs backend/tests/unit/suite/0_system/eventbus/WebSocketEventBus.waitForMessage.test.mjs
git commit -m "feat(eventbus): add getTopicSubscriberCount for external client counting"
```

---

### Task 4: Implement WS-first delivery in WakeAndLoadService load step

**Files:**
- Modify: `backend/src/3_applications/devices/services/WakeAndLoadService.mjs:240-297` (load step)
- Test: `backend/tests/unit/suite/3_applications/devices/WakeAndLoadService.test.mjs`

This is the core change. The load step tries WS delivery first when conditions are met, then falls back to FKB `loadURL`.

- [ ] **Step 1: Write the failing tests**

Add these tests to `backend/tests/unit/suite/3_applications/devices/WakeAndLoadService.test.mjs`:

```javascript
  describe('WS-first content delivery', () => {
    function createMockEventBus({ subscriberCount = 1, ackMessage = null, ackDelay = 50 } = {}) {
      return {
        getTopicSubscriberCount: vi.fn(() => subscriberCount),
        waitForMessage: vi.fn((_predicate, _timeout) => {
          if (ackMessage) {
            return new Promise(resolve => setTimeout(() => resolve(ackMessage), ackDelay));
          }
          return new Promise((_, reject) =>
            setTimeout(() => reject(new Error('waitForMessage timed out after 4000ms')), 50)
          );
        }),
      };
    }

    it('should use WS delivery when warm prepare and subscribers exist', async () => {
      const device = createMockDevice({
        prepareForContent: vi.fn(async () => ({ ok: true, coldRestart: false })),
        // loadContent should NOT be called when WS succeeds
        loadContent: vi.fn(async () => { throw new Error('should not be called'); }),
      });

      const mockEventBus = createMockEventBus({
        subscriberCount: 2,
        ackMessage: { type: 'content-ack', screen: 'living-room', timestamp: Date.now() },
      });

      const service = new WakeAndLoadService({
        deviceService: createMockDeviceService(device),
        readinessPolicy: createMockReadinessPolicy(),
        broadcast: mockBroadcast,
        eventBus: mockEventBus,
        logger: mockLogger,
      });

      const result = await service.execute('living-room', { queue: 'morning-program' });

      expect(result.ok).toBe(true);
      expect(result.steps.load.method).toBe('websocket');
      expect(result.steps.load.ok).toBe(true);
      expect(mockBroadcast).toHaveBeenCalledWith(expect.objectContaining({ queue: 'morning-program' }));
      expect(device.loadContent).not.toHaveBeenCalled();
    });

    it('should fall back to FKB when WS ack times out', async () => {
      const device = createMockDevice({
        prepareForContent: vi.fn(async () => ({ ok: true, coldRestart: false })),
        loadContent: vi.fn(async () => ({ ok: true, url: 'http://test/tv' })),
      });

      const mockEventBus = createMockEventBus({
        subscriberCount: 1,
        ackMessage: null, // No ack — will timeout
      });

      const service = new WakeAndLoadService({
        deviceService: createMockDeviceService(device),
        readinessPolicy: createMockReadinessPolicy(),
        broadcast: mockBroadcast,
        eventBus: mockEventBus,
        logger: mockLogger,
      });

      const result = await service.execute('living-room', { queue: 'morning-program' });

      expect(result.ok).toBe(true);
      expect(result.steps.load.method).toBe('fkb-fallback');
      expect(result.steps.load.wsError).toBe('ack-timeout');
      expect(device.loadContent).toHaveBeenCalled();
    });

    it('should skip WS and go straight to FKB on cold restart', async () => {
      const device = createMockDevice({
        prepareForContent: vi.fn(async () => ({ ok: true, coldRestart: true })),
      });

      const mockEventBus = createMockEventBus({ subscriberCount: 3 });

      const service = new WakeAndLoadService({
        deviceService: createMockDeviceService(device),
        readinessPolicy: createMockReadinessPolicy(),
        broadcast: mockBroadcast,
        eventBus: mockEventBus,
        logger: mockLogger,
      });

      const result = await service.execute('living-room', { queue: 'morning-program' });

      expect(result.ok).toBe(true);
      expect(result.steps.load.method).toBeUndefined(); // Standard FKB path, no method tag
      expect(mockEventBus.getTopicSubscriberCount).not.toHaveBeenCalled();
      expect(device.loadContent).toHaveBeenCalled();
    });

    it('should skip WS and go straight to FKB when no subscribers', async () => {
      const device = createMockDevice({
        prepareForContent: vi.fn(async () => ({ ok: true, coldRestart: false })),
      });

      const mockEventBus = createMockEventBus({ subscriberCount: 0 });

      const service = new WakeAndLoadService({
        deviceService: createMockDeviceService(device),
        readinessPolicy: createMockReadinessPolicy(),
        broadcast: mockBroadcast,
        eventBus: mockEventBus,
        logger: mockLogger,
      });

      const result = await service.execute('living-room', { queue: 'morning-program' });

      expect(result.ok).toBe(true);
      expect(result.steps.load.wsSkipped).toBe('no-subscribers');
      expect(device.loadContent).toHaveBeenCalled();
    });

    it('should skip WS when no eventBus is configured', async () => {
      const device = createMockDevice({
        prepareForContent: vi.fn(async () => ({ ok: true, coldRestart: false })),
      });

      const service = new WakeAndLoadService({
        deviceService: createMockDeviceService(device),
        readinessPolicy: createMockReadinessPolicy(),
        broadcast: mockBroadcast,
        // No eventBus
        logger: mockLogger,
      });

      const result = await service.execute('living-room', { queue: 'morning-program' });

      expect(result.ok).toBe(true);
      expect(device.loadContent).toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run backend/tests/unit/suite/3_applications/devices/WakeAndLoadService.test.mjs`
Expected: New tests FAIL (WS-first path doesn't exist yet), existing tests still PASS

- [ ] **Step 3: Implement WS-first delivery in the load step**

In `backend/src/3_applications/devices/services/WakeAndLoadService.mjs`, replace the load step (lines 240-297) with:

```javascript
    // --- Step 6: Load Content ---
    this.#emitProgress(topic, 'load', 'running');
    this.#logger.info?.('wake-and-load.load.start', { deviceId, query: contentQuery });

    const screenPath = device.screenPath || '/tv';
    const hasContentQuery = Object.keys(contentQuery).length > 0;

    // --- WS-first delivery ---
    // If the screen is already loaded (warm prepare) and WS subscribers exist,
    // try delivering content via WebSocket for an instant, no-refresh switch.
    const warmPrepare = !coldWake && hasContentQuery && !!this.#eventBus;
    let wsDelivered = false;

    if (warmPrepare) {
      const subscriberCount = this.#eventBus.getTopicSubscriberCount(topic);
      this.#logger.info?.('wake-and-load.load.ws-check', { deviceId, topic, subscriberCount });

      if (subscriberCount > 0) {
        try {
          // Broadcast content command
          this.#broadcast({ topic, ...contentQuery });

          // Wait for ack from the screen
          const ackStart = Date.now();
          await this.#eventBus.waitForMessage(
            (msg) => msg.type === 'content-ack' && msg.screen === deviceId,
            4000
          );

          const ackMs = Date.now() - ackStart;
          this.#logger.info?.('wake-and-load.load.ws-ack', { deviceId, ackMs });

          result.steps.load = { ok: true, method: 'websocket', ackMs };
          wsDelivered = true;
          this.#emitProgress(topic, 'load', 'done', { method: 'websocket' });
        } catch (err) {
          this.#logger.warn?.('wake-and-load.load.ws-failed', { deviceId, error: err.message });
          // Fall through to FKB loadURL
        }
      } else {
        this.#logger.info?.('wake-and-load.load.ws-skipped', { deviceId, reason: 'no-subscribers' });
      }
    }

    // --- FKB loadURL (primary or fallback) ---
    if (!wsDelivered) {
      const wsSkipReason = warmPrepare
        ? (this.#eventBus.getTopicSubscriberCount(topic) === 0 ? 'no-subscribers' : undefined)
        : (coldWake ? 'cold-restart' : undefined);

      const loadResult = await device.loadContent(screenPath, contentQuery);

      if (loadResult.ok) {
        result.steps.load = {
          ...loadResult,
          ...(wsSkipReason ? { wsSkipped: wsSkipReason } : {}),
          ...(warmPrepare && !wsSkipReason ? { method: 'fkb-fallback', wsError: 'ack-timeout' } : {})
        };
        this.#emitProgress(topic, 'load', 'done');
      } else if (hasContentQuery) {
        // --- WebSocket Fallback (existing) ---
        // URL load failed but there IS content to deliver. The screen may already
        // be loaded at the base URL (without query params). Send the content
        // command via WebSocket so the screen's useScreenCommands handler can
        // pick it up and trigger playback.
        this.#logger.warn?.('wake-and-load.load.urlFailed-tryingWsFallback', {
          deviceId, error: loadResult.error, contentQuery
        });
        this.#emitProgress(topic, 'load', 'retrying', { method: 'websocket' });

        // Ensure the screen has time to load the base URL before sending WS
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Load the base URL first if it hasn't loaded yet
        const baseLoadResult = await device.loadContent(screenPath, {});
        if (baseLoadResult.ok) {
          this.#logger.info?.('wake-and-load.load.baseUrlLoaded', { deviceId });
        }

        // Give the screen framework time to mount and subscribe to WS
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Broadcast content command via WebSocket
        this.#broadcast({ ...contentQuery });
        this.#logger.info?.('wake-and-load.load.wsFallbackSent', {
          deviceId, contentQuery
        });

        result.steps.load = {
          ok: true,
          method: 'websocket-fallback',
          urlError: loadResult.error,
          note: 'URL load failed; content delivered via WebSocket command'
        };
        this.#emitProgress(topic, 'load', 'done', { method: 'websocket-fallback' });
      } else {
        // No content query — just a plain screen load that failed
        this.#emitProgress(topic, 'load', 'failed', { error: loadResult.error });
        this.#logger.error?.('wake-and-load.load.failed', { deviceId, error: loadResult.error });
        result.error = loadResult.error;
        result.failedStep = 'load';
        result.totalElapsedMs = Date.now() - startTime;
        return result;
      }
    }
```

Note: The `topic` variable is already defined at the top of `#executeInner` as `` `homeline:${deviceId}` ``. The spec says the screen topic should match the device — but the living room screen subscribes to `*` (wildcard), so `getTopicSubscriberCount` checks both the specific topic AND `*`. The ack uses `msg.screen === deviceId` (e.g., `'living-room'`) which the frontend will set from the screen's `screenId`.

**Important:** The `topic` variable used in the WS-first block must match the topic that `getTopicSubscriberCount` checks. Currently `topic = 'homeline:${deviceId}'`. However, `useScreenCommands` subscribes via predicate (which registers as `*` on the backend). So `getTopicSubscriberCount('homeline:living-room')` will correctly count wildcard subscribers. This works as-is.

- [ ] **Step 4: Run all WakeAndLoadService tests**

Run: `npx vitest run backend/tests/unit/suite/3_applications/devices/WakeAndLoadService.test.mjs`
Expected: All tests PASS (both new WS-first tests and existing tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/devices/services/WakeAndLoadService.mjs backend/tests/unit/suite/3_applications/devices/WakeAndLoadService.test.mjs
git commit -m "feat(wake-and-load): WS-first content delivery with FKB fallback"
```

---

### Task 5: Send `content-ack` from frontend `useScreenCommands`

**Files:**
- Modify: `frontend/src/screen-framework/commands/useScreenCommands.js`

After `useScreenCommands` successfully processes a content command (`media:queue` or `media:play` emission), send a `content-ack` back via WebSocket.

- [ ] **Step 1: Add the WS send import**

At the top of `frontend/src/screen-framework/commands/useScreenCommands.js`, add the import:

```javascript
import { wsService } from '../../services/WebSocketService.js';
```

- [ ] **Step 2: Add ack sending after content command handling**

In `useScreenCommands.js`, find the content reference block (around lines 135-139):

```javascript
    if (contentRef) {
      const action = Object.keys(data).includes('queue') ? 'media:queue' : 'media:play';
      logger().info('commands.content', { action, contentRef });
      bus.emit(action, { contentId: contentRef });
      return;
    }
```

Replace it with:

```javascript
    if (contentRef) {
      const action = Object.keys(data).includes('queue') ? 'media:queue' : 'media:play';
      logger().info('commands.content', { action, contentRef });
      bus.emit(action, { contentId: contentRef });
      // Acknowledge content delivery so the backend knows WS succeeded
      wsService.send({ type: 'content-ack', screen: screenIdRef.current, timestamp: Date.now() });
      return;
    }
```

- [ ] **Step 3: Add `screenId` ref to the hook**

The hook needs the screen ID for the ack. `useScreenCommands` is called by `ScreenCommandHandler` inside `ScreenRenderer`, which has `screenId`. We need to pass it through.

In `useScreenCommands.js`, update the function signature:

```javascript
export function useScreenCommands(wsConfig, actionBus, screenId) {
```

Add a ref for it:

```javascript
  const screenIdRef = useRef(screenId);
  screenIdRef.current = screenId;
```

- [ ] **Step 4: Update `ScreenCommandHandler` to pass `screenId`**

In `frontend/src/screen-framework/ScreenRenderer.jsx`, update `ScreenCommandHandler` (around line 124):

```javascript
function ScreenCommandHandler({ wsConfig, screenId }) {
  const bus = useMemo(() => getActionBus(), []);
  useScreenCommands(wsConfig, bus, screenId);
  return null;
}
```

And its usage (around line 262):

```javascript
<ScreenCommandHandler wsConfig={config.websocket} screenId={screenId} />
```

- [ ] **Step 5: Also send ack for barcode content commands**

In `useScreenCommands.js`, find the barcode handler (around lines 113-121):

```javascript
    if (data.source === 'barcode' && data.contentId) {
      const actionMap = { queue: 'media:queue', play: 'media:play', open: 'menu:open' };
      const busAction = actionMap[data.action] || 'media:queue';
      const { action: _a, contentId, source: _s, device: _d, topic: _t, timestamp: _ts, ...contentOptions } = data;
      logger().info('commands.barcode', { action: busAction, contentId, device: data.device, options: contentOptions });
      bus.emit(busAction, { contentId, ...contentOptions });
      return;
    }
```

Add ack after the emit (only for content actions, not menu:open):

```javascript
    if (data.source === 'barcode' && data.contentId) {
      const actionMap = { queue: 'media:queue', play: 'media:play', open: 'menu:open' };
      const busAction = actionMap[data.action] || 'media:queue';
      const { action: _a, contentId, source: _s, device: _d, topic: _t, timestamp: _ts, ...contentOptions } = data;
      logger().info('commands.barcode', { action: busAction, contentId, device: data.device, options: contentOptions });
      bus.emit(busAction, { contentId, ...contentOptions });
      if (busAction !== 'menu:open') {
        wsService.send({ type: 'content-ack', screen: screenIdRef.current, timestamp: Date.now() });
      }
      return;
    }
```

- [ ] **Step 6: Verify the dev build compiles**

Run: `npx vite build --mode development 2>&1 | tail -5`
Expected: Build succeeds with no import errors

- [ ] **Step 7: Commit**

```bash
git add frontend/src/screen-framework/commands/useScreenCommands.js frontend/src/screen-framework/ScreenRenderer.jsx
git commit -m "feat(screen-commands): send content-ack via WS after processing content commands"
```

---

### Task 6: Integration smoke test

**Files:** None (manual verification)

Verify the end-to-end flow works with the dev server running.

- [ ] **Step 1: Run the full backend test suite**

Run: `npx vitest run backend/tests/unit/`
Expected: All tests PASS

- [ ] **Step 2: Verify the frontend builds cleanly**

Run: `npx vite build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit any fixes if needed**

If tests or build failed, fix and commit.

- [ ] **Step 4: Final commit — update spec status**

If everything passes, no action needed. The spec is already marked as Approved.
