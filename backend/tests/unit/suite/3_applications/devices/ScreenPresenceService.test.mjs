import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ScreenPresenceService } from '#apps/devices/services/ScreenPresenceService.mjs';

function makeClock() {
  let now = 1_700_000_000_000;
  return { now: () => now, advance: (ms) => { now += ms; } };
}

function makeBus() {
  const bus = {
    msgHandler: null,
    discHandler: null,
    onClientMessage(cb) { bus.msgHandler = cb; },
    onClientDisconnection(cb) { bus.discHandler = cb; },
  };
  return bus;
}

function makeHa() {
  return { callService: vi.fn(async () => ({ ok: true })) };
}

const PRESENCE = { 'office-tv': { entity: 'input_boolean.office_tv_active', ttlMs: 15000 } };
const calls = (ha) => ha.callService.mock.calls.map(([d, s, data]) => `${s}:${data.entity_id}`);

let clock, bus, ha, svc;
beforeEach(() => {
  vi.useFakeTimers();
  clock = makeClock(); bus = makeBus(); ha = makeHa();
  svc = new ScreenPresenceService({ haGateway: ha, presenceByDevice: PRESENCE, clock });
  svc.start(bus);
});
afterEach(() => { svc.stop(); vi.useRealTimers(); });

describe('ScreenPresenceService', () => {
  it('asserts OFF for every configured device on startup', () => {
    expect(calls(ha)).toEqual(['turn_off:input_boolean.office_tv_active']);
  });

  it('turns the boolean ON when an active presence message arrives', () => {
    bus.msgHandler('c1', { type: 'screen.presence', deviceId: 'office-tv', active: true });
    expect(calls(ha).at(-1)).toBe('turn_on:input_boolean.office_tv_active');
  });

  it('is idempotent — repeated active messages do not re-call HA', () => {
    bus.msgHandler('c1', { type: 'screen.presence', deviceId: 'office-tv', active: true });
    const n = ha.callService.mock.calls.length;
    bus.msgHandler('c1', { type: 'screen.presence', deviceId: 'office-tv', active: true });
    expect(ha.callService.mock.calls.length).toBe(n);
  });

  it('turns OFF on a clean inactive transition', () => {
    bus.msgHandler('c1', { type: 'screen.presence', deviceId: 'office-tv', active: true });
    bus.msgHandler('c1', { type: 'screen.presence', deviceId: 'office-tv', active: false });
    expect(calls(ha).at(-1)).toBe('turn_off:input_boolean.office_tv_active');
  });

  it('forces OFF via the TTL watchdog when heartbeats stop', () => {
    bus.msgHandler('c1', { type: 'screen.presence', deviceId: 'office-tv', active: true });
    clock.advance(16000);
    vi.advanceTimersByTime(5000); // watchdog tick
    expect(calls(ha).at(-1)).toBe('turn_off:input_boolean.office_tv_active');
  });

  it('turns OFF immediately when the client disconnects', () => {
    bus.msgHandler('c1', { type: 'screen.presence', deviceId: 'office-tv', active: true });
    bus.discHandler('c1');
    expect(calls(ha).at(-1)).toBe('turn_off:input_boolean.office_tv_active');
  });

  it('ignores presence for unconfigured devices', () => {
    const before = ha.callService.mock.calls.length;
    bus.msgHandler('c9', { type: 'screen.presence', deviceId: 'kitchen-tv', active: true });
    expect(ha.callService.mock.calls.length).toBe(before);
  });

  it('reconcile re-asserts the desired state (self-heals a lost call)', () => {
    bus.msgHandler('c1', { type: 'screen.presence', deviceId: 'office-tv', active: true });
    const n = ha.callService.mock.calls.length;
    vi.advanceTimersByTime(60000); // reconcile tick
    expect(ha.callService.mock.calls.length).toBeGreaterThan(n);
    expect(calls(ha).at(-1)).toBe('turn_on:input_boolean.office_tv_active');
  });
});
