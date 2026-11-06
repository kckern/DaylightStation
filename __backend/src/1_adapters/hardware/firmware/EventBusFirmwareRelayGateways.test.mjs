import { describe, expect, it, vi } from 'vitest';
import { BarcodeFirmwareGateway } from './EventBusFirmwareRelayGateways.mjs';

function makeBus() {
  let handler;
  return {
    broadcast: vi.fn(),
    onClientMessage(callback) { handler = callback; return () => { handler = null; }; },
    ingest(frame) { handler?.('relay-client', frame); },
  };
}

describe('BarcodeFirmwareGateway', () => {
  it('gives repeated physical scans separate identities and retains explicit delivery IDs', () => {
    const eventBus = makeBus(), listener = vi.fn();
    new BarcodeFirmwareGateway({ eventBus, defaultDevice: 'kitchen', defaultRoute: 'nutribot', timezone: 'UTC' }).subscribe(listener);
    const frame = { source: 'kitchen-relay', type: 'scan', code: '012345678905' };
    eventBus.ingest(frame); eventBus.ingest(frame);
    expect(listener.mock.calls[0][0].eventId).not.toBe(listener.mock.calls[1][0].eventId);
    eventBus.ingest({ ...frame, eventId: 'delivery-123' });
    expect(listener.mock.calls[2][0].eventId).toBe('delivery-123');
  });
  it('filters firmware frames and emits the preserved semantic scan contract', () => {
    const eventBus = makeBus();
    const listener = vi.fn();
    const gateway = new BarcodeFirmwareGateway({
      eventBus, defaultDevice: 'barcode-relay', defaultRoute: 'content', timezone: 'UTC',
    });
    gateway.subscribe(listener);

    eventBus.ingest({ source: 'kitchen-relay', type: 'scale', grams: 200 });
    eventBus.ingest({ source: 'kitchen-relay', type: 'scan', code: ' 012345678905 ' });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({
      source: 'barcode-relay', device: 'barcode-relay', route: 'content', code: '012345678905',
    });
    expect(eventBus.broadcast).toHaveBeenCalledWith('barcode-relay', listener.mock.calls[0][0]);
  });
  // 2026-11-05: the firmware's capture time and hold were overwritten by the
  // receive time, so a held or batched scan looked like a fresh one.
  it('keeps the reader capture time and hold beside the receive time', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-05T03:31:56.000Z'));
    try {
      const eventBus = makeBus(), listener = vi.fn();
      new BarcodeFirmwareGateway({ eventBus, defaultDevice: 'kitchen', defaultRoute: 'nutribot', timezone: 'UTC' }).subscribe(listener);
      eventBus.ingest({ source: 'kitchen-relay', type: 'scan', code: '9780064401517', ts: 123456, delayed_ms: 4200 });
      eventBus.ingest({ source: 'kitchen-relay', type: 'scan', code: '9780064401517', ts: 123999 });
      expect(listener.mock.calls[0][0]).toMatchObject({
        receivedAt: '2026-11-05T03:31:56.000Z', capturedAt: '2026-11-05T03:31:51.800Z', delayedMs: 4200, deviceMs: 123456,
      });
      expect(listener.mock.calls[1][0]).toMatchObject({ capturedAt: '2026-11-05T03:31:56.000Z', delayedMs: 0, deviceMs: 123999 });
      // Unchanged: `ts` is still the receive time, the identity is still eventId.
      expect(typeof listener.mock.calls[0][0].ts).toBe('string');
      expect(listener.mock.calls[0][0].eventId).not.toBe(listener.mock.calls[1][0].eventId);
    } finally { vi.useRealTimers(); }
  });
});

