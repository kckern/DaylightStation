/**
 * Bootstrap wiring for PlaybackStallDetector.
 *
 * Mirrors DeviceLivenessService.bootstrap.test.mjs: the factory must construct,
 * start (i.e. subscribe), stay a singleton across repeat calls, and tear down
 * cleanly. It also has to pass the alert handlers through — a detector composed
 * without its `onStall` is exactly the dead-end this tier exists to remove.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createPlaybackStallDetector,
  getPlaybackStallDetector,
  stopPlaybackStallDetector,
} from '#composition/modules/playbackStall.mjs';
import { DEVICE_STATE_TOPIC } from '#shared-contracts/media/topics.mjs';

function makeFakeBus() {
  const patternHandlers = [];
  return {
    subscribePattern: vi.fn((predicate, handler) => {
      const entry = { predicate, handler };
      patternHandlers.push(entry);
      return () => {
        const i = patternHandlers.indexOf(entry);
        if (i !== -1) patternHandlers.splice(i, 1);
      };
    }),
    broadcast: vi.fn(),
    publish: vi.fn(),
    _deliver(topic, payload) {
      for (const { predicate, handler } of patternHandlers) {
        if (predicate(topic)) handler(payload, topic);
      }
    },
    _patternHandlers: patternHandlers,
  };
}

describe('bootstrap.createPlaybackStallDetector', () => {
  let bus, logger;

  beforeEach(() => {
    stopPlaybackStallDetector();
    bus = makeFakeBus();
    logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  });

  afterEach(() => {
    stopPlaybackStallDetector();
  });

  it('constructs and starts the detector', () => {
    const { stallDetector } = createPlaybackStallDetector({ eventBus: bus, logger });

    expect(typeof stallDetector.isStalled).toBe('function');
    expect(bus.subscribePattern).toHaveBeenCalledTimes(1);
    expect(bus._patternHandlers.length).toBe(1);
  });

  it('returns the same singleton on repeated calls (no double-subscribe)', () => {
    const first = createPlaybackStallDetector({ eventBus: bus, logger });
    const second = createPlaybackStallDetector({ eventBus: bus, logger });

    expect(second.stallDetector).toBe(first.stallDetector);
    expect(bus.subscribePattern).toHaveBeenCalledTimes(1);
  });

  it('getPlaybackStallDetector returns the current singleton (or null)', () => {
    expect(getPlaybackStallDetector()).toBeNull();
    const { stallDetector } = createPlaybackStallDetector({ eventBus: bus, logger });
    expect(getPlaybackStallDetector()).toBe(stallDetector);
  });

  it('stopPlaybackStallDetector tears down the singleton and unsubscribes', () => {
    createPlaybackStallDetector({ eventBus: bus, logger });
    stopPlaybackStallDetector();

    expect(getPlaybackStallDetector()).toBeNull();
    expect(bus._patternHandlers.length).toBe(0);
  });

  it('passes onStall through to the detector', () => {
    const onStall = vi.fn();
    let now = 1_700_000_000_000;
    createPlaybackStallDetector({
      eventBus: bus,
      logger,
      clock: { now: () => now },
      stallThresholdMs: 60_000,
      onStall,
    });

    const item = { contentId: 'plex:1', format: 'video', title: 'A lecture', duration: 1800 };
    const send = () => bus._deliver(DEVICE_STATE_TOPIC('piano-tablet'), {
      deviceId: 'piano-tablet',
      reason: 'heartbeat',
      ts: new Date(now).toISOString(),
      snapshot: {
        sessionId: 's', state: 'playing', currentItem: item, position: 0,
        queue: { items: [], currentIndex: -1, upNextCount: 0 },
        config: { shuffle: false, repeat: 'off', shader: null, volume: 50 },
        meta: { ownerId: 'piano-tablet', updatedAt: new Date(now).toISOString() },
      },
    });

    send();
    for (let i = 0; i < 13; i += 1) { now += 5000; send(); }

    expect(onStall).toHaveBeenCalledTimes(1);
    expect(onStall.mock.calls[0][0].deviceId).toBe('piano-tablet');
  });

  it('requires an event bus', () => {
    expect(() => createPlaybackStallDetector({ logger })).toThrow(/eventBus/);
  });
});
