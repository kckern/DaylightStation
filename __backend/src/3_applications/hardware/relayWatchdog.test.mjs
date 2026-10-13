// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { createRelayWatchdog } from './relayWatchdog.mjs';
import { RelayWatchdogFirmwareGateway } from '#adapters/hardware/firmware/EventBusFirmwareRelayGateways.mjs';

const NOOP_LOGGER = { warn() {}, info() {}, debug() {}, error() {} };
const HOUR = 3600_000;

// Minimal in-memory bus exposing only what the watchdog needs: the raw client
// message hook (same seam the relays use).
function makeBus() {
  let clientHandler = null;
  return {
    onClientMessage(fn) { clientHandler = fn; return () => { clientHandler = null; }; },
    emit(message) { clientHandler?.('relay-client', message); },
  };
}

function makeClock(startMs = 0) {
  let t = startMs;
  return { now: () => t, advance(ms) { t += ms; } };
}

describe('createRelayWatchdog', () => {
  let bus;
  let clock;
  let alerts;

  beforeEach(() => {
    bus = makeBus();
    clock = makeClock(1_000_000);
    alerts = [];
  });

  function build(overrides = {}) {
    return createRelayWatchdog({
      relayGateway: new RelayWatchdogFirmwareGateway({ eventBus: bus }),
      sources: { 'kitchen-relay': { label: 'Kitchen relay', thresholdMs: 3 * HOUR } },
      clock,
      onStale: (evt) => { alerts.push(evt); },
      logger: NOOP_LOGGER,
      ...overrides,
    });
  }

  it('alerts when a seen relay goes silent past its threshold', () => {
    const wd = build();
    bus.emit({ source: 'kitchen-relay', type: 'scale', id: 'kitchen-food-scale', grams: 481 });

    clock.advance(3 * HOUR + 1000);
    wd.check();

    expect(alerts).toHaveLength(1);
    expect(alerts[0].source).toBe('kitchen-relay');
    expect(alerts[0].label).toBe('Kitchen relay');
    expect(alerts[0].silentMs).toBeGreaterThanOrEqual(3 * HOUR);
  });

  it('stays quiet while a relay is silent but still inside its threshold', () => {
    const wd = build();
    bus.emit({ source: 'kitchen-relay', type: 'scale', id: 'kitchen-food-scale', grams: 481 });

    clock.advance(3 * HOUR - 1000);
    wd.check();

    expect(alerts).toEqual([]);
  });

  it('never alerts for a configured relay that has never reported', () => {
    // The OBD relay lives in a car and is absent for days at a time; a board that
    // has never connected at all must not page anyone. Watch what stopped, not
    // what never started.
    const wd = build({
      sources: {
        'kitchen-relay': { label: 'Kitchen relay', thresholdMs: 3 * HOUR },
        'obd-relay': { label: 'Car OBD relay', thresholdMs: HOUR },
      },
    });

    clock.advance(30 * HOUR);
    wd.check();

    expect(alerts).toEqual([]);
  });

  it('alerts once per outage, not once per check', () => {
    // The check runs on an interval. A 12-day outage must not become 17k pages.
    const wd = build();
    bus.emit({ source: 'kitchen-relay', type: 'scale', id: 'kitchen-food-scale', grams: 481 });

    clock.advance(4 * HOUR);
    wd.check();
    clock.advance(HOUR);
    wd.check();
    clock.advance(24 * HOUR);
    wd.check();

    expect(alerts).toHaveLength(1);
  });

  it('re-arms once the relay reports again, so a later outage alerts too', () => {
    // Without this the watchdog is single-shot: the kitchen board would page on
    // its first death and stay silent through every one after.
    const wd = build();
    bus.emit({ source: 'kitchen-relay', type: 'scale', id: 'kitchen-food-scale', grams: 481 });
    clock.advance(4 * HOUR);
    wd.check();

    clock.advance(HOUR);
    bus.emit({ source: 'kitchen-relay', type: 'scale', id: 'kitchen-food-scale', grams: 12 });
    clock.advance(4 * HOUR);
    wd.check();

    expect(alerts).toHaveLength(2);
  });

  it('reports the recovery, with how long the relay was gone', () => {
    const recoveries = [];
    const wd = build({ onRecover: (evt) => recoveries.push(evt) });
    bus.emit({ source: 'kitchen-relay', type: 'scale', id: 'kitchen-food-scale', grams: 481 });
    clock.advance(4 * HOUR);
    wd.check();

    clock.advance(2 * HOUR);
    bus.emit({ source: 'kitchen-relay', type: 'scan', device: 'nutribot-upc', code: '012345678905' });

    expect(recoveries).toHaveLength(1);
    expect(recoveries[0].source).toBe('kitchen-relay');
    expect(recoveries[0].silentMs).toBe(6 * HOUR);
  });

  it('reports a relay reboot once per boot, not once per heartbeat', () => {
    // The firmware's hello frame carries the post-mortem (esp_reset_reason +
    // an NVS boot counter). It repeats every 60s, so it must be reported on the
    // boot COUNT changing — otherwise prod logs get the same reboot 1440x/day.
    const boots = [];
    const wd = build({ onBoot: (evt) => boots.push(evt) });

    const hello = { source: 'kitchen-relay', type: 'hello', id: 'kitchen-food-scale', boot_count: 48, last_reset: 'TASK_WDT' };
    bus.emit(hello);
    clock.advance(60_000);
    bus.emit(hello);
    clock.advance(60_000);
    bus.emit({ ...hello, boot_count: 49, last_reset: 'BROWNOUT' });

    expect(boots).toHaveLength(2);
    expect(boots[0]).toMatchObject({ source: 'kitchen-relay', bootCount: 48, lastReset: 'TASK_WDT' });
    expect(boots[1]).toMatchObject({ bootCount: 49, lastReset: 'BROWNOUT' });
  });

  it('keeps watching after a failing alert handler', () => {
    // onStale reaches the notification stack, which reaches Telegram. A network
    // blip there must not take the watchdog down with it — and must not eat the
    // recovery either.
    const recoveries = [];
    const wd = build({
      onStale: () => { throw new Error('telegram unreachable'); },
      onRecover: (evt) => recoveries.push(evt),
    });
    bus.emit({ source: 'kitchen-relay', type: 'scale', id: 'kitchen-food-scale', grams: 481 });

    clock.advance(4 * HOUR);
    expect(() => wd.check()).not.toThrow();

    clock.advance(HOUR);
    bus.emit({ source: 'kitchen-relay', type: 'scale', id: 'kitchen-food-scale', grams: 12 });
    expect(recoveries).toHaveLength(1);
  });

  it('does not announce a recovery for a relay that was never declared stale', () => {
    const recoveries = [];
    build({ onRecover: (evt) => recoveries.push(evt) });

    bus.emit({ source: 'kitchen-relay', type: 'scale', id: 'kitchen-food-scale', grams: 481 });
    clock.advance(HOUR);
    bus.emit({ source: 'kitchen-relay', type: 'scale', id: 'kitchen-food-scale', grams: 490 });

    expect(recoveries).toEqual([]);
  });
});
