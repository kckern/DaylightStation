import { describe, expect, it, vi } from 'vitest';
import { DeviceSessionApiService } from './DeviceSessionApiService.mjs';

const capture = { version: 1, transferId: 'transfer-1', op: 'capture' };
const logger = { info: vi.fn(), warn: vi.fn() };

describe('DeviceSessionApiService handoff', () => {
  it('forwards one validated, lossless handoff envelope and its typed terminal result', async () => {
    const terminal = { ok: false, commandId: 'handoff-1', code: 'HANDOFF_UNSUPPORTED', handoff: { transferId: 'transfer-1', phase: 'failed', code: 'HANDOFF_UNSUPPORTED' } };
    const sessions = { sendCommand: vi.fn().mockResolvedValue(terminal) };
    const api = new DeviceSessionApiService({ sessionControl: sessions, logger });

    await expect(api.handoff('tv-a', { commandId: 'handoff-1', params: capture })).resolves.toEqual(terminal);
    expect(sessions.sendCommand).toHaveBeenCalledWith({ targetDevice: 'tv-a', command: 'handoff', commandId: 'handoff-1', params: capture });
  });

  it('rejects malformed direct handoff input without falling through to scalar sendCommand validation', async () => {
    const sessions = { sendCommand: vi.fn() };
    const api = new DeviceSessionApiService({ sessionControl: sessions, logger });

    await expect(api.handoff('tv-a', { commandId: 'handoff-1', params: { ...capture, version: 2 } })).resolves.toMatchObject({ ok: false, commandId: 'handoff-1', code: 'INVALID_ENVELOPE' });
    await expect(api.handoff('tv-a', { commandId: 'handoff-1', params: capture, ignored: true })).resolves.toMatchObject({ ok: false, commandId: 'handoff-1', code: 'INVALID_ENVELOPE' });
    expect(sessions.sendCommand).not.toHaveBeenCalled();
  });
});
