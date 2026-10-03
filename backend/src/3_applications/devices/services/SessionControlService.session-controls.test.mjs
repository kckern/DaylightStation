import { describe, expect, it, vi } from 'vitest';
import { SessionControlService } from './SessionControlService.mjs';
import { DeviceSessionApiService } from './DeviceSessionApiService.mjs';
import { EventBusDeviceTransportGateway } from '../../../1_adapters/devices/EventBusDeviceTransportGateway.mjs';
import { buildCommandEnvelope, validateCommandEnvelope } from '#shared-contracts/media/envelopes.mjs';

function makeService({ ack = { ok: true }, snapshot = { online: true, snapshot: { state: 'playing' } } } = {}) {
  const transportGateway = {
    buildCommand: vi.fn(buildCommandEnvelope),
    validateCommand: vi.fn(validateCommandEnvelope),
    sendCommand: vi.fn(async (_target, envelope) => ({ ...ack, commandId: envelope.commandId })),
    waitForStateChange: vi.fn(),
  };
  const service = new SessionControlService({
    transportGateway, livenessService: { getLastSnapshot: () => snapshot },
    clock: { now: () => 1_000 }, logger: { info: vi.fn(), warn: vi.fn() },
  });
  return { service, transportGateway };
}

const sent = (gw) => gw.sendCommand.mock.calls.at(-1)[1];
const origin = { kind: 'device', id: 'browser:abc', name: "Dad's phone" };

describe('SessionControlService — session commands', () => {
  it('sends a session command with its params and origin', async () => {
    const { service, transportGateway } = makeService();
    const result = await service.session('tv', { action: 'sleep-timer', params: { minutes: 20 }, commandId: 'c1', origin });
    expect(result).toMatchObject({ ok: true, commandId: 'c1' });
    expect(sent(transportGateway)).toMatchObject({
      targetDevice: 'tv', command: 'session', commandId: 'c1',
      params: { action: 'sleep-timer', minutes: 20 }, origin,
    });
  });

  it('refuses an invalid session command before publishing', async () => {
    const { service, transportGateway } = makeService();
    const result = await service.session('tv', { action: 'sleep-timer', params: {}, commandId: 'c1' });
    expect(result).toMatchObject({ ok: false, code: 'INVALID_ENVELOPE' });
    expect(transportGateway.sendCommand).not.toHaveBeenCalled();
  });

  it('carries origin on transport, queue and config commands', async () => {
    const { service, transportGateway } = makeService();
    await service.transport('tv', { action: 'pause', commandId: 't1', origin });
    expect(sent(transportGateway).origin).toEqual(origin);
    await service.queue('tv', 'q1', { op: 'play-now', contentId: 'plex:1' }, origin);
    expect(sent(transportGateway).origin).toEqual(origin);
    await service.config('tv', { setting: 'addOnly', value: true, commandId: 'k1', origin });
    expect(sent(transportGateway)).toMatchObject({ command: 'config', params: { setting: 'addOnly', value: true }, origin });
  });

  it('omits origin when none is known', async () => {
    const { service, transportGateway } = makeService();
    await service.transport('tv', { action: 'pause', commandId: 't1' });
    expect(sent(transportGateway)).not.toHaveProperty('origin');
  });

  it('marks the claim stop as a move so the screen can say Moved', async () => {
    const { service, transportGateway } = makeService();
    await service.claim('tv', { commandId: 'claim-1', origin });
    expect(sent(transportGateway)).toMatchObject({ command: 'transport', params: { action: 'stop', intent: 'move' }, origin });
  });

  it('passes appliedAs through from the device ack', async () => {
    const { service } = makeService({ ack: { ok: true, appliedAs: 'add', requestedOp: 'play-now' } });
    await expect(service.queue('tv', 'q1', { op: 'play-now', contentId: 'plex:1' })).resolves
      .toMatchObject({ ok: true, appliedAs: 'add', requestedOp: 'play-now' });
  });
});

describe('DeviceSessionApiService — session commands', () => {
  it('delegates session() and forwards origin', async () => {
    const sessionControl = {
      session: vi.fn().mockResolvedValue({ ok: true }),
      transport: vi.fn().mockResolvedValue({ ok: true }),
      queue: vi.fn().mockResolvedValue({ ok: true }),
      config: vi.fn().mockResolvedValue({ ok: true }),
    };
    const api = new DeviceSessionApiService({ sessionControl, logger: { info: vi.fn() } });
    await api.session('tv', { action: 'put-back', params: {}, commandId: 'p1', origin });
    expect(sessionControl.session).toHaveBeenCalledWith('tv', { action: 'put-back', params: {}, commandId: 'p1', origin });
    await api.transport('tv', { action: 'stop', commandId: 't1', origin });
    expect(sessionControl.transport).toHaveBeenCalledWith('tv', { action: 'stop', value: undefined, commandId: 't1', origin });
    await api.queue('tv', 'q1', { op: 'add', contentId: 'plex:2' }, origin);
    expect(sessionControl.queue).toHaveBeenCalledWith('tv', 'q1', { op: 'add', contentId: 'plex:2' }, origin);
    await api.config('tv', { setting: 'endOfQueue', value: 'similar', commandId: 'k1', origin });
    expect(sessionControl.config).toHaveBeenCalledWith('tv', { setting: 'endOfQueue', value: 'similar', commandId: 'k1', origin });
  });
});

describe('EventBusDeviceTransportGateway — appliedAs on acks', () => {
  it('resolves with appliedAs / requestedOp from the device ack', async () => {
    let ackHandler = null;
    const eventBus = {
      subscribePattern: (_predicate, handler) => { ackHandler = handler; return () => {}; },
      broadcast: (_topic, command) => {
        queueMicrotask(() => ackHandler({ commandId: command.commandId, ok: true, appliedAs: 'add', requestedOp: 'play-now' }));
      },
    };
    const gateway = new EventBusDeviceTransportGateway({ eventBus });
    const command = buildCommandEnvelope({ targetDevice: 'tv', command: 'queue', commandId: 'q1', params: { op: 'play-now', contentId: 'plex:1' } });
    await expect(gateway.sendCommand('tv', command)).resolves.toMatchObject({ ok: true, appliedAs: 'add', requestedOp: 'play-now' });
  });
});
