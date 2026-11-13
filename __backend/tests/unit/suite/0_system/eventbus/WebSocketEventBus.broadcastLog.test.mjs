/**
 * WebSocketEventBus — the broadcast log line names the event and learner,
 * so the log store can say which pushes reached the tablets, not just how
 * many went out on a topic.
 */
import { describe, it, expect, vi } from 'vitest';
import { WebSocketEventBus } from '#adapters/eventbus/WebSocketEventBus.mjs';

function makeBus() {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const bus = new WebSocketEventBus({ logger });
  bus._testSetServerAttached();
  return { bus, logger };
}

const broadcastLine = (logger) => logger.info.mock.calls.find(([event]) => event === 'eventbus.broadcast')?.[1];

describe('WebSocketEventBus — broadcast log line', () => {
  it('logs the event name and learner of each broadcast', () => {
    const { bus, logger } = makeBus();
    bus.broadcast('school', { event: 'story-read', learnerId: 'kid' });
    expect(broadcastLine(logger)).toMatchObject({ topic: 'school', event: 'story-read', learnerId: 'kid' });
  });

  it('names an envelope by its kind, and leaves both null when the payload has neither', () => {
    const { bus, logger } = makeBus();
    bus.broadcast('state-gates', { kind: 'GateStateChanged' });
    expect(broadcastLine(logger)).toMatchObject({ topic: 'state-gates', event: 'GateStateChanged', learnerId: null });
  });
});
