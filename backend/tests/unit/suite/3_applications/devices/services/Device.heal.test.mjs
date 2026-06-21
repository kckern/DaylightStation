import { describe, it, expect, vi } from 'vitest';
import { Device } from '#apps/devices/services/Device.mjs';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

describe('Device.healAudioBridge', () => {
  it('delegates to contentControl.healAudioBridge', async () => {
    const contentControl = {
      healAudioBridge: vi.fn(async () => ({ ok: true, companions: [] })),
    };
    const device = new Device({ id: 'shield', type: 'shield-tv' }, { contentControl }, { logger });

    const result = await device.healAudioBridge({ force: true });

    expect(contentControl.healAudioBridge).toHaveBeenCalledWith({ force: true });
    expect(result).toEqual({ ok: true, companions: [] });
  });

  it('returns supported:false when contentControl lacks healAudioBridge', async () => {
    const device = new Device({ id: 'tv', type: 'shield-tv' }, { contentControl: {} }, { logger });
    const result = await device.healAudioBridge();
    expect(result).toEqual({ ok: false, supported: false });
  });

  it('returns supported:false when no contentControl', async () => {
    const device = new Device({ id: 'pc', type: 'linux-pc' }, {}, { logger });
    const result = await device.healAudioBridge();
    expect(result).toEqual({ ok: false, supported: false });
  });
});
