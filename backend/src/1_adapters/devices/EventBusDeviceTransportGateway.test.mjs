import { describe, expect, it, vi } from 'vitest';
import { EventBusDeviceTransportGateway } from './EventBusDeviceTransportGateway.mjs';

describe('EventBusDeviceTransportGateway', () => {
  it('arms correlation before publishing and resolves only the matching ack', async () => {
    let subscription;
    const eventBus = {
      subscribePattern: vi.fn((predicate, handler) => {
        subscription = { predicate, handler };
        return vi.fn();
      }),
      broadcast: vi.fn((topic, command) => {
        expect(subscription.predicate('device-ack:tv')).toBe(true);
        subscription.handler({ commandId: 'other', ok: true });
        subscription.handler({ commandId: command.commandId, ok: true, appliedAt: 'now' });
      }),
    };
    const gateway = new EventBusDeviceTransportGateway({ eventBus });
    const command = gateway.buildCommand({ targetDevice: 'tv', command: 'transport', commandId: 'cmd-1', params: { action: 'pause' } });

    await expect(gateway.sendCommand('tv', command)).resolves.toEqual({
      ok: true, commandId: 'cmd-1', appliedAt: 'now',
    });
    expect(eventBus.subscribePattern.mock.invocationCallOrder[0])
      .toBeLessThan(eventBus.broadcast.mock.invocationCallOrder[0]);
    expect(eventBus.broadcast).toHaveBeenCalledWith('screen:tv', command);
  });

  it('owns acknowledgement timeout settlement and cleanup', async () => {
    let timeout;
    const unsubscribe = vi.fn();
    const eventBus = {
      subscribePattern: vi.fn(() => unsubscribe),
      broadcast: vi.fn(),
    };
    const gateway = new EventBusDeviceTransportGateway({
      eventBus,
      setTimer: (callback, ms) => { timeout = { callback, ms }; return 7; },
      clearTimer: vi.fn(),
    });
    const command = gateway.buildCommand({ targetDevice: 'tv', command: 'transport', commandId: 'cmd-2', params: { action: 'pause' } });
    const result = gateway.sendCommand('tv', command, { timeoutMs: 1234 });
    expect(timeout.ms).toBe(1234);
    timeout.callback();
    await expect(result).resolves.toMatchObject({ ok: false, commandId: 'cmd-2', error: 'Timeout waiting for ack' });
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
