import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createScreenPresenceService, _resetForTests } from '#composition/modules/screenPresence.mjs';

function makeBus() {
  return { onClientMessage: vi.fn(), onClientDisconnection: vi.fn() };
}
function makeHa() { return { callService: vi.fn(async () => ({ ok: true })) }; }

const DEVICES = {
  'office-tv': { type: 'linux-pc', presence: { entity: 'input_boolean.office_tv_active', ttlMs: 15000 } },
  'kitchen-tv': { type: 'linux-pc' }, // no presence block → ignored
};

beforeEach(() => { _resetForTests(); });

describe('createScreenPresenceService', () => {
  it('wires a service for devices that declare presence.entity', () => {
    const bus = makeBus();
    const { presenceService } = createScreenPresenceService({
      eventBus: bus, haGateway: makeHa(), devicesConfig: DEVICES,
    });
    expect(presenceService).toBeTruthy();
    expect(bus.onClientMessage).toHaveBeenCalledTimes(1);
    expect(bus.onClientDisconnection).toHaveBeenCalledTimes(1);
  });

  it('skips (null) when no device declares presence', () => {
    const { presenceService } = createScreenPresenceService({
      eventBus: makeBus(), haGateway: makeHa(), devicesConfig: { 'kitchen-tv': { type: 'linux-pc' } },
    });
    expect(presenceService).toBeNull();
  });

  it('skips (null) when the HA gateway is absent', () => {
    const { presenceService } = createScreenPresenceService({
      eventBus: makeBus(), haGateway: null, devicesConfig: DEVICES,
    });
    expect(presenceService).toBeNull();
  });

  it('throws without an event bus', () => {
    expect(() => createScreenPresenceService({ eventBus: null, haGateway: makeHa(), devicesConfig: DEVICES }))
      .toThrow(/eventBus/);
  });
});
