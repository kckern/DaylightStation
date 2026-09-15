import { describe, expect, it, vi } from 'vitest';
import { SessionControlService } from './SessionControlService.mjs';

const capture = { version: 1, transferId: 'transfer-1', op: 'capture' };

describe('SessionControlService handoff envelope', () => {
  it('replays an identical handoff and rejects a conflicting payload without a second transport dispatch', async () => {
    const result = { ok: false, commandId: 'handoff-1', code: 'HANDOFF_UNSUPPORTED', handoff: { transferId: 'transfer-1', phase: 'failed', code: 'HANDOFF_UNSUPPORTED' } };
    const transportGateway = {
      buildCommand: vi.fn(),
      validateCommand: vi.fn(() => ({ valid: true, errors: [] })),
      sendCommand: vi.fn().mockResolvedValue(result),
      waitForStateChange: vi.fn(),
    };
    const control = new SessionControlService({ transportGateway, livenessService: { getLastSnapshot: () => null }, logger: { info: vi.fn(), warn: vi.fn() } });
    const envelope = { targetDevice: 'tv-a', command: 'handoff', commandId: 'handoff-1', params: capture };

    await expect(control.sendCommand(envelope)).resolves.toEqual(result);
    await expect(control.sendCommand({ ...envelope, params: { ...capture } })).resolves.toEqual(result);
    await expect(control.sendCommand({ ...envelope, params: { ...capture, transferId: 'transfer-2' } })).resolves.toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
    expect(transportGateway.sendCommand).toHaveBeenCalledOnce();
  });
});
