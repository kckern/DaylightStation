import { describe, expect, it, vi } from 'vitest';
import { DevicePlaybackPrepareService } from './DevicePlaybackPrepareService.mjs';

const clockAt = (...times) => { const t = [...times]; return { now: () => t.shift() ?? 0 }; };

describe('DevicePlaybackPrepareService', () => {
  it('warms the stream through prewarm only, for a known screen', async () => {
    const prewarm = { prewarm: vi.fn().mockResolvedValue({ status: 'ok', token: 't', contentId: 'plex:2', queueContentIds: ['plex:2'] }) };
    const configuration = { device: vi.fn(() => ({ type: 'linux-pc' })) };
    const service = new DevicePlaybackPrepareService({ prewarm, configuration, clock: clockAt(1000, 1250) });
    const result = await service.prepare('office-tv', 'plex:1');
    expect(prewarm.prewarm).toHaveBeenCalledTimes(1);
    expect(prewarm.prewarm).toHaveBeenCalledWith('plex:1', { shuffle: false, startTranscoder: false });
    expect(result).toEqual({ kind: 'prepared', status: 'ok', contentId: 'plex:2', ms: 250 });
  });

  it('an unknown screen is not found and nothing is prepared', async () => {
    const prewarm = { prewarm: vi.fn() };
    const service = new DevicePlaybackPrepareService({ prewarm, configuration: { device: () => null } });
    expect(await service.prepare('nowhere', 'plex:1')).toEqual({ kind: 'not_found' });
    expect(prewarm.prewarm).not.toHaveBeenCalled();
  });

  it('a camera is a live feed: nothing to prepare', async () => {
    const prewarm = { prewarm: vi.fn() };
    const service = new DevicePlaybackPrepareService({ prewarm, configuration: { device: () => ({}) } });
    expect(await service.prepare('office-tv', 'camera:door')).toEqual({ kind: 'prepared', status: 'skipped', contentId: null, ms: 0 });
    expect(prewarm.prewarm).not.toHaveBeenCalled();
  });

  it('reports a failed or skipped prewarm as such (no throw)', async () => {
    const prewarm = { prewarm: vi.fn().mockResolvedValue({ status: 'failed', reason: 'exception' }) };
    const service = new DevicePlaybackPrepareService({ prewarm, configuration: { device: () => ({}) }, clock: clockAt(0, 5) });
    expect(await service.prepare('office-tv', 'plex:1')).toEqual({ kind: 'prepared', status: 'failed', contentId: null, ms: 5 });
  });

  it('is unconfigured without a prewarm service', () => {
    expect(new DevicePlaybackPrepareService({ configuration: { device: () => ({}) } }).configured()).toBe(false);
  });

  it('single-flight per screen: the same item joins, another item is skipped as busy', async () => {
    let finish;
    const prewarm = { prewarm: vi.fn(() => new Promise((resolve) => { finish = resolve; })) };
    const service = new DevicePlaybackPrepareService({ prewarm, configuration: { device: () => ({}) }, clock: clockAt(0, 7) });
    const first = service.prepare('office-tv', 'plex:1');
    const joined = service.prepare('office-tv', 'plex:1');
    expect(await service.prepare('office-tv', 'plex:9')).toEqual({ kind: 'prepared', status: 'busy', contentId: null, ms: 0 });
    expect(prewarm.prewarm).toHaveBeenCalledTimes(1);
    finish({ status: 'ok', contentId: 'plex:1' });
    expect(await first).toEqual({ kind: 'prepared', status: 'ok', contentId: 'plex:1', ms: 7 });
    expect(await joined).toBe(await first);
    // Settled: the screen is free again.
    prewarm.prewarm.mockResolvedValueOnce({ status: 'ok', contentId: 'plex:9' });
    await service.prepare('office-tv', 'plex:9');
    expect(prewarm.prewarm).toHaveBeenCalledTimes(2);
  });

  it('another screen is not held up by one in flight', async () => {
    const prewarm = { prewarm: vi.fn(() => new Promise(() => {})) };
    const service = new DevicePlaybackPrepareService({ prewarm, configuration: { device: () => ({}) } });
    service.prepare('office-tv', 'plex:1');
    service.prepare('den-tv', 'plex:1');
    expect(prewarm.prewarm).toHaveBeenCalledTimes(2);
  });

  it('a failed prewarm frees the screen', async () => {
    const prewarm = { prewarm: vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ status: 'ok', contentId: 'plex:2' }) };
    const service = new DevicePlaybackPrepareService({ prewarm, configuration: { device: () => ({}) } });
    await expect(service.prepare('office-tv', 'plex:1')).rejects.toThrow('boom');
    await service.prepare('office-tv', 'plex:2');
    expect(prewarm.prewarm).toHaveBeenCalledTimes(2);
  });
});
