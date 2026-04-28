import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandHandlerLivenessService } from '#apps/devices/services/CommandHandlerLivenessService.mjs';

function makeBus() {
  const handlers = [];
  return {
    handlers,
    onClientMessage(cb) { handlers.push(cb); },
    // Helper for tests to simulate an inbound client message.
    _ingest(message, clientId = 'client-1') {
      handlers.forEach((cb) => cb(clientId, message));
    },
  };
}

describe('CommandHandlerLivenessService', () => {
  let bus;
  let svc;
  let now;

  beforeEach(() => {
    bus = makeBus();
    now = 1_000_000;
    svc = new CommandHandlerLivenessService({
      eventBus: bus,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      clock: { now: () => now },
      freshnessMs: 30_000,
    });
    svc.start();
  });

  it('isFresh returns false for unknown device', () => {
    expect(svc.isFresh('tv')).toBe(false);
  });

  it('records lastSeenAt on inbound device-ack', () => {
    bus._ingest({ topic: 'device-ack', deviceId: 'tv', commandId: 'c1', ok: true });
    expect(svc.isFresh('tv')).toBe(true);
  });

  it('records lastSeenAt on inbound command-handler-presence beacon (online: true)', () => {
    bus._ingest({ topic: 'command-handler-presence:tv', deviceId: 'tv', online: true });
    expect(svc.isFresh('tv')).toBe(true);
  });

  it('isFresh returns false once the freshness window expires', () => {
    bus._ingest({ topic: 'device-ack', deviceId: 'tv', commandId: 'c1', ok: true });
    expect(svc.isFresh('tv')).toBe(true);
    now += 30_001;
    expect(svc.isFresh('tv')).toBe(false);
  });

  it('isFresh respects an explicit windowMs argument', () => {
    bus._ingest({ topic: 'device-ack', deviceId: 'tv', commandId: 'c1', ok: true });
    now += 5_000;
    expect(svc.isFresh('tv', 1_000)).toBe(false);
    expect(svc.isFresh('tv', 10_000)).toBe(true);
  });

  it('immediately downgrades on offline presence beacon', () => {
    bus._ingest({ topic: 'command-handler-presence:tv', deviceId: 'tv', online: true });
    expect(svc.isFresh('tv')).toBe(true);
    bus._ingest({ topic: 'command-handler-presence:tv', deviceId: 'tv', online: false });
    expect(svc.isFresh('tv')).toBe(false);
  });

  it('ignores unrelated inbound messages', () => {
    bus._ingest({ topic: 'fitness', source: 'fitness', heart_rate: 120 });
    bus._ingest({ topic: 'midi', type: 'note_on', data: { note: 60 } });
    expect(svc.isFresh('tv')).toBe(false);
  });

  it('ignores ack/presence messages with no deviceId', () => {
    bus._ingest({ topic: 'device-ack', commandId: 'c1', ok: true });
    bus._ingest({ topic: 'command-handler-presence:', online: true });
    expect(svc.isFresh('tv')).toBe(false);
  });

  it('snapshot returns a frozen view of lastSeenAt', () => {
    bus._ingest({ topic: 'device-ack', deviceId: 'tv', commandId: 'c1', ok: true });
    bus._ingest({ topic: 'device-ack', deviceId: 'kitchen', commandId: 'c2', ok: true });
    const snap = svc.snapshot();
    expect(snap.tv).toBe(now);
    expect(snap.kitchen).toBe(now);
    expect(Object.isFrozen(snap)).toBe(true);
  });

  it('stop() prevents further ingestion', () => {
    svc.stop();
    bus._ingest({ topic: 'device-ack', deviceId: 'tv', commandId: 'c1', ok: true });
    expect(svc.isFresh('tv')).toBe(false);
  });
});
