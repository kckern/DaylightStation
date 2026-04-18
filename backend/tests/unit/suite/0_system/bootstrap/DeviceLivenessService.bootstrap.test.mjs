/**
 * Bootstrap wiring for DeviceLivenessService.
 *
 * Verifies that createDeviceLivenessService:
 *   - constructs and starts the service (subscribes to the event bus)
 *   - wires the service into the bus via setLivenessService
 *   - returns the same singleton on repeated calls
 *   - is torn down cleanly by stopDeviceLivenessService
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createDeviceLivenessService,
  getDeviceLivenessService,
  stopDeviceLivenessService,
} from '#system/bootstrap/deviceLiveness.mjs';

function makeFakeBus() {
  let liveness = null;
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
    setLivenessService: vi.fn((svc) => { liveness = svc; }),
    getLivenessService: () => liveness,
    broadcast: vi.fn(),
    publish: vi.fn(),
    _patternHandlers: patternHandlers,
  };
}

describe('bootstrap.createDeviceLivenessService', () => {
  let bus, logger;

  beforeEach(() => {
    stopDeviceLivenessService(); // clear any leftover singleton
    bus = makeFakeBus();
    logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  });

  afterEach(() => {
    stopDeviceLivenessService();
  });

  it('constructs, starts, and wires the service into the bus', () => {
    const { livenessService } = createDeviceLivenessService({
      eventBus: bus,
      logger,
    });

    expect(livenessService).toBeDefined();
    expect(typeof livenessService.getLastSnapshot).toBe('function');

    // Service started → subscribed via pattern.
    expect(bus.subscribePattern).toHaveBeenCalledTimes(1);
    expect(bus._patternHandlers.length).toBe(1);

    // Wired into the bus for replay-on-subscribe.
    expect(bus.setLivenessService).toHaveBeenCalledWith(livenessService);
    expect(bus.getLivenessService()).toBe(livenessService);
  });

  it('returns the same singleton on repeated calls (no double-start)', () => {
    const first = createDeviceLivenessService({ eventBus: bus, logger });
    const second = createDeviceLivenessService({ eventBus: bus, logger });

    expect(second.livenessService).toBe(first.livenessService);
    expect(bus.subscribePattern).toHaveBeenCalledTimes(1);
  });

  it('getDeviceLivenessService returns the current singleton (or null)', () => {
    expect(getDeviceLivenessService()).toBeNull();
    const { livenessService } = createDeviceLivenessService({ eventBus: bus, logger });
    expect(getDeviceLivenessService()).toBe(livenessService);
  });

  it('stopDeviceLivenessService tears down the singleton', () => {
    createDeviceLivenessService({ eventBus: bus, logger });
    expect(getDeviceLivenessService()).not.toBeNull();

    stopDeviceLivenessService();
    expect(getDeviceLivenessService()).toBeNull();

    // After stop, pattern handlers must be cleaned up.
    expect(bus._patternHandlers.length).toBe(0);
  });

  it('throws when eventBus is missing', () => {
    expect(() => createDeviceLivenessService({ logger })).toThrow(/eventBus/);
  });
});
