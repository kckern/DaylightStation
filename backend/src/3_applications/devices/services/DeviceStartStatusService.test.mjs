import { describe, expect, it, vi } from 'vitest';
import { DeviceStartStatusService } from './DeviceStartStatusService.mjs';
import { validateDeviceStartStatus } from '#shared-contracts/media/sessionControls.mjs';
import { EventBusDeviceTransportGateway } from '../../../1_adapters/devices/EventBusDeviceTransportGateway.mjs';

function makeBus() {
  const patterns = [];
  const broadcasts = [];
  return {
    broadcasts,
    subscribePattern: vi.fn((predicate, handler) => {
      const entry = { predicate, handler };
      patterns.push(entry);
      return () => patterns.splice(patterns.indexOf(entry), 1);
    }),
    broadcast: vi.fn((topic, payload) => broadcasts.push({ topic, payload })),
    emit(topic, payload) {
      for (const { predicate, handler } of [...patterns]) if (predicate(topic)) handler(payload, topic);
    },
  };
}

const progress = (dispatchId, step, status, extra = {}) => ({ type: 'wake-progress', dispatchId, step, status, ...extra });

function setup({ now = 1_000_000 } = {}) {
  const bus = makeBus();
  let clock = now;
  const service = new DeviceStartStatusService({
    progressGateway: new EventBusDeviceTransportGateway({ eventBus: bus }), clock: { now: () => clock }, logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  });
  service.start();
  return { bus, service, advance: (ms) => { clock += ms; } };
}

describe('DeviceStartStatusService', () => {
  it('tracks a dispatch from starting to started and publishes each change on device-start:<id>', () => {
    const { bus, service } = setup();
    bus.emit('homeline:tv', progress('d1', 'power', 'running'));
    expect(service.get('tv')).toMatchObject({ deviceId: 'tv', dispatchId: 'd1', phase: 'starting', step: 'power', stepStatus: 'running' });
    bus.emit('homeline:tv', progress('d1', 'load', 'done', { method: 'websocket' }));
    expect(service.get('tv').phase).toBe('delivered');
    bus.emit('homeline:tv', progress('d1', 'playback', 'confirmed', { contentId: 'plex:1' }));
    expect(service.get('tv')).toMatchObject({ phase: 'started', contentId: 'plex:1', lastFailure: null });

    const published = bus.broadcasts.filter(b => b.topic === 'device-start:tv');
    expect(published.map(b => b.payload.phase)).toEqual(['starting', 'delivered', 'started']);
    for (const { payload } of published) expect(validateDeviceStartStatus(payload).valid).toBe(true);
  });

  it('records the last failure and keeps it visible until a later start succeeds', () => {
    const { bus, service } = setup();
    bus.emit('homeline:tv', progress('d1', 'power', 'running'));
    bus.emit('homeline:tv', progress('d1', 'power', 'failed', { error: 'TV did not turn on' }));
    expect(service.get('tv')).toMatchObject({
      phase: 'failed', error: 'TV did not turn on',
      lastFailure: { dispatchId: 'd1', step: 'power', error: 'TV did not turn on' },
    });
    bus.emit('homeline:tv', progress('d2', 'power', 'running'));
    expect(service.get('tv')).toMatchObject({ phase: 'starting', dispatchId: 'd2', lastFailure: { dispatchId: 'd1' } });
    bus.emit('homeline:tv', progress('d2', 'playback', 'confirmed'));
    expect(service.get('tv').lastFailure).toBeNull();
  });

  it('treats an unconfirmed playback timeout as a failure', () => {
    const { bus, service } = setup();
    bus.emit('homeline:tv', progress('d1', 'load', 'done'));
    bus.emit('homeline:tv', progress('d1', 'playback', 'timeout', { timeoutMs: 90000 }));
    expect(service.get('tv')).toMatchObject({ phase: 'failed', error: expect.stringMatching(/not confirm/i) });
  });

  it('ignores a late terminal event from a superseded dispatch', () => {
    const { bus, service } = setup();
    bus.emit('homeline:tv', progress('d1', 'load', 'done'));
    bus.emit('homeline:tv', progress('d2', 'power', 'running'));
    bus.emit('homeline:tv', progress('d1', 'playback', 'timeout'));
    expect(service.get('tv')).toMatchObject({ dispatchId: 'd2', phase: 'starting', lastFailure: null });
  });

  it('ignores non-progress traffic on the homeline topic (commands, acks)', () => {
    const { bus, service } = setup();
    bus.emit('homeline:tv', { type: 'command', command: 'queue', commandId: 'x' });
    bus.emit('device-state:tv', progress('d1', 'power', 'running'));
    expect(service.get('tv')).toBeNull();
  });

  it('flags a non-terminal status as stale after two quiet minutes', () => {
    const { bus, service, advance } = setup();
    bus.emit('homeline:tv', progress('d1', 'power', 'running'));
    expect(service.get('tv').stale).toBe(false);
    advance(120_001);
    expect(service.get('tv').stale).toBe(true);
  });

  it('lists known devices for wildcard replay and stops listening on stop()', () => {
    const { bus, service } = setup();
    bus.emit('homeline:a', progress('d1', 'power', 'running'));
    bus.emit('homeline:b', progress('d2', 'power', 'running'));
    expect(service.knownDeviceIds().sort()).toEqual(['a', 'b']);
    service.stop();
    bus.emit('homeline:c', progress('d3', 'power', 'running'));
    expect(service.get('c')).toBeNull();
  });
});
