import { describe, expect, it, vi } from 'vitest';
import { ClientIngressService } from './ClientIngressService.mjs';

function fixture(overrides = {}) {
  const publications = {
    sendAuthorizationAck: vi.fn(), publishCall: vi.fn(), publishFitness: vi.fn(),
    publishMidi: vi.fn(), publishHomeline: vi.fn(), publishDeviceState: vi.fn(),
    publishDeviceAck: vi.fn(), publishRelay: vi.fn(), clientMetadata: vi.fn(() => ({ ip: '127.0.0.1' })),
  };
  return {
    publications,
    service: new ClientIngressService({ publications, ...overrides }),
  };
}

describe('ClientIngressService', () => {
  it('fails closed when homeline leases are unavailable', () => {
    const { service } = fixture();
    expect(service.canSubscribe('c1', 'homeline-call:room')).toBe(false);
    expect(service.authorizeMessage('c1', { topic: 'homeline-call:room' }))
      .toEqual({ ok: false, code: 'LEASES_NOT_READY' });
  });

  it('projects valid MIDI frames onto the semantic publication', () => {
    const { service, publications } = fixture();
    service.handle('c1', { source: 'piano', topic: 'midi', type: 'noteon', timestamp: 12, data: [60] });
    expect(publications.publishMidi).toHaveBeenCalledWith({
      source: 'piano', type: 'noteon', timestamp: 12, sessionId: undefined, data: [60],
    });
  });

  it('normalizes device-state publications', () => {
    const { service, publications } = fixture();
    service.handle('c1', { topic: 'device-state', deviceId: 'screen-1', snapshot: { online: true } });
    expect(publications.publishDeviceState).toHaveBeenCalledWith('screen-1', {
      deviceId: 'screen-1', snapshot: { online: true }, reason: 'change', ts: undefined,
    });
  });
});
