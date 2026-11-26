import { describe, expect, it, vi } from 'vitest';
import { SessionControlService } from './SessionControlService.mjs';
import { buildCommandEnvelope, validateCommandEnvelope } from '#shared-contracts/media/envelopes.mjs';

function make({ online = true } = {}) {
  const transportGateway = {
    buildCommand: buildCommandEnvelope, validateCommand: validateCommandEnvelope,
    sendCommand: vi.fn(async (_target, envelope) => ({ ok: true, commandId: envelope.commandId })),
    waitForStateChange: vi.fn(),
  };
  const service = new SessionControlService({
    transportGateway,
    livenessService: { getLastSnapshot: () => (online ? null : { online: false, snapshot: null }) },
    clock: { now: () => 1_000 }, logger: { info: vi.fn(), warn: vi.fn() },
  });
  return { service, transportGateway };
}

describe('SessionControlService.input (a phone D-pad press)', () => {
  it('sends an input envelope to the screen with the direction only for navigate', async () => {
    const { service, transportGateway } = make();
    await service.input('livingroom-tv', { action: 'navigate', direction: 'up', commandId: 'p1', origin: { kind: 'device', id: 'fleet:phone' } });
    await service.input('livingroom-tv', { action: 'select', direction: 'up', commandId: 'p2' });
    const [target, first] = transportGateway.sendCommand.mock.calls[0];
    expect(target).toBe('livingroom-tv');
    expect(first).toMatchObject({ command: 'input', targetDevice: 'livingroom-tv', params: { action: 'navigate', direction: 'up' }, origin: { id: 'fleet:phone' } });
    expect(transportGateway.sendCommand.mock.calls[1][1].params).toEqual({ action: 'select' });
  });

  it('does not send to a screen known to be off', async () => {
    const { service, transportGateway } = make({ online: false });
    await expect(service.input('tv', { action: 'select', commandId: 'p1' })).resolves.toMatchObject({ ok: false, code: 'DEVICE_OFFLINE' });
    expect(transportGateway.sendCommand).not.toHaveBeenCalled();
  });

  it('refuses an invalid press before it reaches the bus', async () => {
    const { service, transportGateway } = make();
    await expect(service.input('tv', { action: 'navigate', commandId: 'p1' })).resolves.toMatchObject({ ok: false, code: 'INVALID_ENVELOPE' });
    expect(transportGateway.sendCommand).not.toHaveBeenCalled();
  });
});
