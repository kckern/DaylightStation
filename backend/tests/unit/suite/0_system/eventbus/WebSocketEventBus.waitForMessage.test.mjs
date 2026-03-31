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

    bus._testInjectClientMessage('client-1', { type: 'heartbeat' });

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
