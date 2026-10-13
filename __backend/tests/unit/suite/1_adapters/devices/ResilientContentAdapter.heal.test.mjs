import { describe, it, expect, vi } from 'vitest';
import { ResilientContentAdapter } from '#adapters/devices/ResilientContentAdapter.mjs';

function makeAdb() {
  return { connect: vi.fn(async () => ({ ok: true })), getMetrics: vi.fn(() => ({})) };
}

describe('ResilientContentAdapter.healAudioBridge', () => {
  it('delegates to primary.healAudioBridge with opts', async () => {
    const primary = {
      healAudioBridge: vi.fn(async () => ({ ok: true, companions: [] })),
    };
    const adapter = new ResilientContentAdapter(
      { primary, recovery: makeAdb(), launchActivity: 'x/.Y' },
      { logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }
    );

    const result = await adapter.healAudioBridge({ force: true });

    expect(primary.healAudioBridge).toHaveBeenCalledWith({ force: true });
    expect(result).toEqual({ ok: true, companions: [] });
  });

  it('returns unsupported when primary lacks healAudioBridge', async () => {
    const primary = {};
    const adapter = new ResilientContentAdapter(
      { primary, recovery: makeAdb(), launchActivity: 'x/.Y' },
      { logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }
    );

    const result = await adapter.healAudioBridge();
    expect(result).toEqual({ ok: false, reason: 'unsupported' });
  });
});
