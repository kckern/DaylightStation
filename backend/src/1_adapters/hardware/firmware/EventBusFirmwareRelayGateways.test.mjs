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
});
