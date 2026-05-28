import { describe, it, expect, beforeEach } from 'vitest';
import { HubStatusBroadcaster } from '../../../backend/src/3_applications/playback-hub/runtime/HubStatusBroadcaster.mjs';
import { FakeHubGateway } from '../../../backend/src/3_applications/playback-hub/test/FakeHubGateway.mjs';
import { SlotStatus } from '../../../backend/src/2_domains/playback-hub/value-objects/SlotStatus.mjs';

/**
 * In-memory event publisher: captures every publish() call with topic/payload
 * arity-2 OR object arity-1; tests inspect `.events` array.
 */
class RecordingEventPublisher {
  events = [];
  publish(...args) {
    if (args.length === 1 && args[0] && typeof args[0] === 'object') {
      this.events.push(args[0]);
    } else {
      this.events.push({ topic: args[0], data: args[1] });
    }
  }
}

/**
 * In-memory logger: captures every level/event/data triple.
 */
class RecordingLogger {
  records = [];
  debug(event, data) { this.records.push({ level: 'debug', event, data }); }
  info(event, data)  { this.records.push({ level: 'info',  event, data }); }
  warn(event, data)  { this.records.push({ level: 'warn',  event, data }); }
  error(event, data) { this.records.push({ level: 'error', event, data }); }
}

/**
 * Test sleepFn: records the requested ms, yields to the event loop via
 * setImmediate so other awaits resolve, then continues. Lets the loop run
 * "freely" through iterations without burning real wall time, while still
 * letting setTimeout-based test waits and broadcaster.stop() interleave.
 *
 * `maxCalls` is a safety valve — once exceeded, the fn resolves but stops
 * incrementing. We assert on the EARLY calls only so the cap is irrelevant
 * to the assertion.
 */
function makeFakeSleepFn(maxCalls = 100) {
  const calls = [];
  const fn = (ms) => {
    if (calls.length < maxCalls) calls.push(ms);
    return new Promise(r => setImmediate(r));
  };
  fn.calls = calls;
  return fn;
}

const makeStatus = (color = 'red') => SlotStatus.fromHubJson({
  slot: 1, color, bt_connected: true, paused: false, now_playing: null,
  volume: 50, playlist_pos: 0, playlist_count: 0, armed_source: null
});

describe('HubStatusBroadcaster', () => {
  let gateway, eventPublisher, logger, sleepFn;
  beforeEach(() => {
    gateway = new FakeHubGateway();
    eventPublisher = new RecordingEventPublisher();
    logger = new RecordingLogger();
    sleepFn = makeFakeSleepFn();
  });

  it('start() then stop() cleanly terminates within 100ms', async () => {
    gateway.setStatusFixture([makeStatus('red')]);
    const broadcaster = new HubStatusBroadcaster({
      gateway, eventPublisher, logger, intervalMs: 3000, sleepFn
    });
    broadcaster.start();
    // Let a few iterations elapse.
    await new Promise(r => setTimeout(r, 20));
    const stopStart = Date.now();
    await broadcaster.stop();
    const stopDuration = Date.now() - stopStart;
    expect(stopDuration).toBeLessThan(100);
  });

  it('start() is idempotent', async () => {
    gateway.setStatusFixture([makeStatus('red')]);
    const broadcaster = new HubStatusBroadcaster({
      gateway, eventPublisher, logger, intervalMs: 3000, sleepFn
    });
    broadcaster.start();
    broadcaster.start(); // no-op
    await new Promise(r => setTimeout(r, 10));
    await broadcaster.stop();
    // No errors thrown, single loop.
    expect(gateway.maxConcurrentCalls).toBeLessThanOrEqual(1);
  });

  it('after one successful fetch, publishes a snapshot event and getLastSnapshot returns it', async () => {
    gateway.setStatusFixture([makeStatus('red')]);
    const broadcaster = new HubStatusBroadcaster({
      gateway, eventPublisher, logger, intervalMs: 3000, sleepFn
    });
    broadcaster.start();
    // Wait until at least one snapshot has been published.
    await new Promise(r => setTimeout(r, 20));
    await broadcaster.stop();

    expect(eventPublisher.events.length).toBeGreaterThanOrEqual(1);
    const ev = eventPublisher.events[0];
    expect(ev.topic).toBe('playback-hub:status');
    expect(ev.type).toBe('playback-hub.status.snapshot');
    expect(ev.data).toMatchObject({
      devices: [expect.objectContaining({ color: 'red' })],
      fetchedAt: expect.any(Date)
    });
    expect(broadcaster.getLastSnapshot()).not.toBeNull();
    expect(broadcaster.getLastSnapshot().devices[0].color).toBe('red');
  });

  it('after 3 consecutive failures, backoff sequence matches expected schedule', async () => {
    gateway.setError(new Error('hub down'));
    // Use a custom sleepFn that records each requested ms.
    const broadcaster = new HubStatusBroadcaster({
      gateway, eventPublisher, logger,
      intervalMs: 3000, maxBackoffMs: 30000, sleepFn
    });
    broadcaster.start();
    // Allow enough iterations for >=3 backoff sleeps.
    await new Promise(r => setTimeout(r, 40));
    await broadcaster.stop();

    const warnEvents = logger.records.filter(r =>
      r.level === 'warn' && r.event === 'playback-hub.broadcaster.fetch_failed'
    );
    expect(warnEvents.length).toBeGreaterThanOrEqual(3);

    // Sleep schedule for failures 1..3: 3000*2^1=6000, 3000*2^2=12000, 3000*2^3=24000
    // (subtracting tiny elapsed time, so we expect "close to" these values).
    expect(sleepFn.calls.length).toBeGreaterThanOrEqual(3);
    // Inspect the first three sleeps. Allow a fudge for elapsed-time subtraction.
    const within = (actual, expected) => actual >= expected - 50 && actual <= expected;
    expect(within(sleepFn.calls[0], 6000)).toBe(true);
    expect(within(sleepFn.calls[1], 12000)).toBe(true);
    expect(within(sleepFn.calls[2], 24000)).toBe(true);
  });

  it('backoff caps at maxBackoffMs', async () => {
    gateway.setError(new Error('hub down'));
    const broadcaster = new HubStatusBroadcaster({
      gateway, eventPublisher, logger,
      intervalMs: 3000, maxBackoffMs: 30000, sleepFn
    });
    broadcaster.start();
    await new Promise(r => setTimeout(r, 40));
    await broadcaster.stop();

    // At failure 4: 3000 * 2^4 = 48000 → capped at 30000.
    // We may not have hit 4 iterations reliably without real timer; check
    // every recorded sleep stays within the cap.
    for (const sleep of sleepFn.calls) {
      expect(sleep).toBeLessThanOrEqual(30000);
    }
  });

  it('serial loop: never two concurrent gateway calls', async () => {
    // Stall each getStatus() ~5ms via the gateway's hook to widen the race
    // window — pure async resolution would already serialize, but a hook makes
    // the assertion meaningful.
    gateway.statusHook = () => new Promise(r => setTimeout(r, 5));
    gateway.setStatusFixture([makeStatus('red')]);
    const broadcaster = new HubStatusBroadcaster({
      gateway, eventPublisher, logger, intervalMs: 3000, sleepFn
    });
    broadcaster.start();
    await new Promise(r => setTimeout(r, 40));
    await broadcaster.stop();
    expect(gateway.maxConcurrentCalls).toBe(1);
  });

  it('after a successful fetch following failures, resets consecutiveFailures to 0', async () => {
    // First call fails, second succeeds.
    let callCount = 0;
    gateway.statusHook = async () => {
      callCount += 1;
      if (callCount === 1) throw new Error('transient');
    };
    gateway.setStatusFixture([makeStatus('red')]);
    const broadcaster = new HubStatusBroadcaster({
      gateway, eventPublisher, logger, intervalMs: 3000, sleepFn
    });
    broadcaster.start();
    await new Promise(r => setTimeout(r, 40));
    await broadcaster.stop();

    // After failure 1: sleep ~6000. After success 2: sleep ~3000. After
    // success 3: sleep ~3000. Confirm sleeps[0] ~6000 and sleeps[1] ~3000.
    expect(sleepFn.calls.length).toBeGreaterThanOrEqual(2);
    expect(sleepFn.calls[0]).toBeGreaterThan(5000);
    expect(sleepFn.calls[1]).toBeLessThan(3500);
  });

  it('getLastSnapshot returns null before any successful fetch', async () => {
    const broadcaster = new HubStatusBroadcaster({
      gateway, eventPublisher, logger, intervalMs: 3000, sleepFn
    });
    expect(broadcaster.getLastSnapshot()).toBeNull();
  });

  it('throws when constructed without required dependencies', () => {
    expect(() => new HubStatusBroadcaster({})).toThrow(/gateway/);
    expect(() => new HubStatusBroadcaster({ gateway })).toThrow(/eventPublisher/);
  });
});
