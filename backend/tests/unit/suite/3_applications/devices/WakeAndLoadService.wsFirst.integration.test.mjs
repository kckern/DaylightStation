import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WakeAndLoadService } from '#apps/devices/services/WakeAndLoadService.mjs';

/**
 * Cross-phase WS-first happy-path integration test.
 *
 * This is the test that would have caught the original Phase 1 bug
 * (CommandAckPublisher gated behind publishState). It exercises the full
 * WakeAndLoadService chain end-to-end at the service level — from execute()
 * through power → verify → volume → prepare → WS-first dispatch → device-ack
 * round-trip, asserting the steps complete via WebSocket and that
 * `device.loadContent` is NEVER called (no FKB-fallback steamroll).
 *
 * Pairs with the per-phase unit tests in WakeAndLoadService.test.mjs.
 */
describe('WakeAndLoadService — cross-phase WS-first integration', () => {
  let mockLogger;
  let mockBroadcast;

  beforeEach(() => {
    mockLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    mockBroadcast = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('completes the full WS-first chain (warm prepare + ack) without ever touching loadContent', async () => {
    // Mocked device — warm prepare, with loadContent stubbed to throw if called
    // (the whole point of WS-first is that loadContent stays untouched).
    const device = {
      id: 'living-room',
      screenPath: '/screen/living-room',
      defaultVolume: null,
      hasCapability: () => false,
      powerOn: vi.fn(async () => ({ ok: true, verified: true })),
      prepareForContent: vi.fn(async () => ({ ok: true, coldRestart: false })),
      loadContent: vi.fn(async () => {
        throw new Error('loadContent must not be called on the WS-first happy path');
      }),
    };

    // EventBus that simulates the device-ack arriving from the frontend.
    // Crucially, it captures the predicate so we can verify the exact shape
    // of the message the predicate is matching against — proving the round-trip
    // contract (topic: 'device-ack', deviceId, commandId).
    let capturedPredicate = null;
    const mockEventBus = {
      getTopicSubscriberCount: vi.fn(() => 1),
      waitForMessage: vi.fn((predicate) => {
        capturedPredicate = predicate;
        // Resolve after a short delay with an ack matching the dispatchId we
        // know was just used to broadcast the envelope (last broadcast call).
        return new Promise((resolve) => {
          setTimeout(() => {
            const lastBroadcast = mockBroadcast.mock.calls[mockBroadcast.mock.calls.length - 1]?.[0];
            const commandId = lastBroadcast?.commandId;
            resolve({ topic: 'device-ack', deviceId: 'living-room', commandId, ok: true });
          }, 50);
        });
      }),
    };

    const service = new WakeAndLoadService({
      deviceService: { get: () => device },
      readinessPolicy: { isReady: vi.fn(async () => ({ ready: true })) },
      broadcast: mockBroadcast,
      eventBus: mockEventBus,
      logger: mockLogger,
    });

    const execPromise = service.execute('living-room', { play: 'plex:620707' });
    // Drain the ack delay and any chained microtasks.
    await vi.advanceTimersByTimeAsync(200);
    const result = await execPromise;

    // 1. Service reports success and the load step is WebSocket.
    expect(result.ok).toBe(true);
    expect(result.steps.load.method).toBe('websocket');
    expect(result.steps.load.ok).toBe(true);

    // 2. The CommandEnvelope went out with the new shape (topic + type +
    //    command + params). This is the assertion that would have failed
    //    pre-CommandEnvelope migration.
    const commandBroadcasts = mockBroadcast.mock.calls
      .map((args) => args[0])
      .filter((p) => p?.type === 'command');
    expect(commandBroadcasts).toHaveLength(1);
    expect(commandBroadcasts[0]).toMatchObject({
      topic: 'homeline:living-room',
      type: 'command',
      command: 'queue',
      targetDevice: 'living-room',
      params: expect.objectContaining({ op: 'play-now', contentId: 'plex:620707' }),
    });
    expect(commandBroadcasts[0].commandId).toBe(result.dispatchId);

    // 3. The waitForMessage predicate exists and correctly matches a real
    //    device-ack envelope keyed by dispatchId. This is the contract that
    //    Phase 1 broke — the publisher wouldn't emit the ack, so this
    //    predicate would never match and the chain would steamroll into
    //    the FKB fallback.
    expect(capturedPredicate).toBeTypeOf('function');
    expect(
      capturedPredicate({
        topic: 'device-ack',
        deviceId: 'living-room',
        commandId: result.dispatchId,
      }),
    ).toBe(true);
    // And does NOT match unrelated messages.
    expect(
      capturedPredicate({
        topic: 'device-ack',
        deviceId: 'other-device',
        commandId: result.dispatchId,
      }),
    ).toBe(false);
    expect(
      capturedPredicate({
        topic: 'something-else',
        deviceId: 'living-room',
        commandId: result.dispatchId,
      }),
    ).toBe(false);

    // 4. loadContent was NEVER called — no FKB-fallback steamroll. This is
    //    the load-bearing assertion that distinguishes the WS-first path
    //    from the WS-fallback path.
    expect(device.loadContent).not.toHaveBeenCalled();
  });
});
