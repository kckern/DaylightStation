import { describe, expect, it, vi } from 'vitest';
import { SessionControlService } from './SessionControlService.mjs';

describe('SessionControlService offline characterization', () => {
  it('does not publish an offline command or replay it after liveness returns', async () => {
    let online = false;
    const transportGateway = {
      validateCommand: vi.fn(() => ({ valid: true, errors: [] })),
      sendCommand: vi.fn().mockResolvedValue({ ok: true, commandId: 'new-command' }),
      buildCommand: vi.fn(),
      waitForStateChange: vi.fn(),
    };
    const livenessService = {
      getLastSnapshot: () => ({
        online,
        snapshot: { state: 'paused', currentItem: { contentId: 'plex:arrival' } },
      }),
    };
    const control = new SessionControlService({
      transportGateway,
      livenessService,
      logger: { info: vi.fn(), warn: vi.fn() },
    });
    const rejected = {
      targetDevice: 'tv-a', command: 'transport', commandId: 'offline-command', params: { action: 'pause' },
    };

    await expect(control.sendCommand(rejected)).resolves.toMatchObject({
      ok: false, code: 'DEVICE_OFFLINE',
    });
    expect(transportGateway.sendCommand).not.toHaveBeenCalled();

    online = true;
    // Liveness changing alone cannot enqueue or resurrect the rejected intent.
    await Promise.resolve();
    expect(transportGateway.sendCommand).not.toHaveBeenCalled();

    const explicitNewCommand = { ...rejected, commandId: 'new-command' };
    await expect(control.sendCommand(explicitNewCommand)).resolves.toMatchObject({ ok: true, commandId: 'new-command' });
    expect(transportGateway.sendCommand).toHaveBeenCalledOnce();
    expect(transportGateway.sendCommand).toHaveBeenCalledWith('tv-a', explicitNewCommand, expect.any(Object));
  });
});
