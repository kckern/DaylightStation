import { describe, expect, it, vi } from 'vitest';
import { SessionControlService } from './SessionControlService.mjs';

describe('SessionControlService routine dedupe', () => {
  it('deduplicates a routine by trigger and target for 10s without suppressing later human action', async () => {
    let now = 1_000;
    const transportGateway = {
      buildCommand: vi.fn(), validateCommand: vi.fn(() => ({ valid: true, errors: [] })),
      sendCommand: vi.fn(async (_target, envelope) => ({ ok: true, commandId: envelope.commandId })),
      waitForStateChange: vi.fn(),
    };
    const service = new SessionControlService({
      transportGateway, livenessService: { getLastSnapshot: () => null },
      clock: { now: () => now }, logger: { info: vi.fn(), warn: vi.fn() },
    });
    const routine = commandId => ({
      targetDevice: 'kitchen', command: 'queue', commandId,
      params: { op: 'play-now', contentId: 'plex:1' },
      origin: { kind: 'routine', name: 'Breakfast', triggerId: 'daily-0700' },
    });

    await service.sendCommand(routine('routine-1'));
    now += 9_999;
    await expect(service.sendCommand(routine('routine-2'))).resolves.toMatchObject({ ok: true, deduplicated: true });
    const human = { ...routine('human-1'), origin: { kind: 'device', id: 'browser:human' } };
    await service.sendCommand(human);
    expect(transportGateway.sendCommand).toHaveBeenCalledTimes(2);
  });
});
