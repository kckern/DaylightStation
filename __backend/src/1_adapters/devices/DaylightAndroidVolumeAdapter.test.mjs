import { describe, it, expect, vi } from 'vitest';
import { DaylightAndroidVolumeAdapter } from './DaylightAndroidVolumeAdapter.mjs';
import { isVolumeControl } from '#apps/devices/ports/IVolumeControl.mjs';

const restClient = ({ get = vi.fn(), post = vi.fn() } = {}) => ({ get, post, delete: vi.fn() });
const ok = data => ({ ok: true, data: { ok: true, ...data } });

describe('DaylightAndroidVolumeAdapter', () => {
  it('implements IVolumeControl', () => {
    const adapter = new DaylightAndroidVolumeAdapter({}, { restClient: restClient() });
    expect(isVolumeControl(adapter)).toBe(true);
    expect(adapter.hasVolumeControl()).toBe(true);
  });

  it('requires a transport', () => {
    expect(() => new DaylightAndroidVolumeAdapter({}, {})).toThrow(/httpClient or restClient/);
  });

  it('posts the level for the configured stream and reports where it landed', async () => {
    const post = vi.fn().mockResolvedValue(ok({ stream: 4, level: 55, index: 9, maxIndex: 18 }));
    const adapter = new DaylightAndroidVolumeAdapter({ stream: 4 }, { restClient: restClient({ post }) });

    const result = await adapter.setVolume(55);

    expect(post).toHaveBeenCalledWith('/volume', { level: 55, stream: 4 });
    expect(result).toEqual({ ok: true, level: 55, stream: 4, appliedIndex: 9, maxIndex: 18 });
  });

  it('defaults to STREAM_MUSIC when no stream is configured', async () => {
    const post = vi.fn().mockResolvedValue(ok({ stream: 3, level: 40, index: 7, maxIndex: 18 }));
    const adapter = new DaylightAndroidVolumeAdapter({}, { restClient: restClient({ post }) });

    await adapter.setVolume(40);

    expect(post).toHaveBeenCalledWith('/volume', { level: 40, stream: 3 });
    expect(adapter.stream).toBe(3);
  });

  it('rejects a level outside 0..100 without calling the device', async () => {
    const post = vi.fn();
    const adapter = new DaylightAndroidVolumeAdapter({}, { restClient: restClient({ post }) });

    for (const bad of [-1, 101, 'loud', null, 12.5, NaN]) {
      const result = await adapter.setVolume(bad);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/0..100|integer/i);
    }
    expect(post).not.toHaveBeenCalled();
  });

  it('reports a rejected command instead of throwing', async () => {
    const post = vi.fn().mockResolvedValue({ ok: false, code: 'COMMAND_REJECTED', error: 'Command was rejected' });
    const logger = { warn: vi.fn(), info: vi.fn() };
    const adapter = new DaylightAndroidVolumeAdapter({}, { restClient: restClient({ post }), logger });

    const result = await adapter.setVolume(50);

    expect(result).toEqual({ ok: false, code: 'COMMAND_REJECTED', error: 'Command was rejected' });
    expect(logger.warn).toHaveBeenCalledWith('daylightandroid.volume.set.failed', expect.objectContaining({
      stream: 3, level: 50, code: 'COMMAND_REJECTED',
    }));
  });

  it('reads the level for the configured stream', async () => {
    const get = vi.fn().mockResolvedValue(ok({ stream: 3, level: 55, index: 9, maxIndex: 18 }));
    const adapter = new DaylightAndroidVolumeAdapter({ stream: 3 }, { restClient: restClient({ get }) });

    const result = await adapter.getVolume();

    expect(get).toHaveBeenCalledWith('/volume', { query: { stream: 3 } });
    expect(result).toEqual({ ok: true, level: 55, stream: 3, appliedIndex: 9, maxIndex: 18 });
  });

  it('getVolume fails when the device does not report a level', async () => {
    const get = vi.fn().mockResolvedValue(ok({ stream: 3 }));
    const adapter = new DaylightAndroidVolumeAdapter({}, { restClient: restClient({ get }) });

    const result = await adapter.getVolume();

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/level/);
  });

  it('getVolume passes a transport failure through', async () => {
    const get = vi.fn().mockResolvedValue({ ok: false, code: 'UNREACHABLE', error: 'connect ECONNREFUSED' });
    const adapter = new DaylightAndroidVolumeAdapter({}, { restClient: restClient({ get }) });
    await expect(adapter.getVolume()).resolves.toEqual({
      ok: false, code: 'UNREACHABLE', error: 'connect ECONNREFUSED',
    });
  });
});
