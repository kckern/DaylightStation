import { describe, it, expect, vi } from 'vitest';
import { FullyKioskVolumeAdapter } from './FullyKioskVolumeAdapter.mjs';
import { isVolumeControl } from '#apps/devices/ports/IVolumeControl.mjs';

const restClient = (command) => ({ command });

describe('FullyKioskVolumeAdapter', () => {
  it('implements IVolumeControl', () => {
    const adapter = new FullyKioskVolumeAdapter({}, { restClient: restClient(vi.fn()) });
    expect(isVolumeControl(adapter)).toBe(true);
    expect(adapter.hasVolumeControl()).toBe(true);
  });

  it('sends setAudioVolume for the configured stream', async () => {
    const command = vi.fn().mockResolvedValue({ ok: true, data: { status: 'OK' } });
    const adapter = new FullyKioskVolumeAdapter({ stream: 3 }, { restClient: restClient(command) });

    const result = await adapter.setVolume(55);

    expect(command).toHaveBeenCalledWith('setAudioVolume', { level: 55, stream: 3 });
    expect(result.ok).toBe(true);
    expect(result.level).toBe(55);
  });

  it('defaults to STREAM_MUSIC when no stream is configured', async () => {
    const command = vi.fn().mockResolvedValue({ ok: true, data: {} });
    const adapter = new FullyKioskVolumeAdapter({}, { restClient: restClient(command) });

    await adapter.setVolume(40);

    expect(command).toHaveBeenCalledWith('setAudioVolume', { level: 40, stream: 3 });
  });

  it('rejects a level outside 0..100 without calling the device', async () => {
    const command = vi.fn();
    const adapter = new FullyKioskVolumeAdapter({}, { restClient: restClient(command) });

    for (const bad of [-1, 101, 'loud', null, 12.5, NaN]) {
      const result = await adapter.setVolume(bad);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/0..100|integer/i);
    }
    expect(command).not.toHaveBeenCalled();
  });

  it('propagates a rejected command as a failure', async () => {
    const command = vi.fn().mockResolvedValue({ ok: false, code: 'AUTH_REJECTED', error: 'nope' });
    const adapter = new FullyKioskVolumeAdapter({}, { restClient: restClient(command) });

    const result = await adapter.setVolume(30);

    expect(result.ok).toBe(false);
    expect(result.code).toBe('AUTH_REJECTED');
  });

  // deviceInfo reports audioVolumes as a list of single-key objects keyed by
  // stream id, e.g. [{"4":82},{"3":55}] — not a map, and not in stream order.
  it('reads back the configured stream from deviceInfo', async () => {
    const command = vi.fn().mockResolvedValue({
      ok: true,
      data: { audioVolumes: [{ 4: 82 }, { 8: 55 }, { 3: 56 }, { 0: 50 }] },
    });
    const adapter = new FullyKioskVolumeAdapter({ stream: 3 }, { restClient: restClient(command) });

    const result = await adapter.getVolume();

    expect(command).toHaveBeenCalledWith('deviceInfo', {});
    expect(result).toMatchObject({ ok: true, level: 56, stream: 3 });
  });

  it('reports not-found when the stream is absent from deviceInfo', async () => {
    const command = vi.fn().mockResolvedValue({ ok: true, data: { audioVolumes: [{ 4: 82 }] } });
    const adapter = new FullyKioskVolumeAdapter({ stream: 3 }, { restClient: restClient(command) });

    const result = await adapter.getVolume();

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/stream 3/);
  });
});
