import { describe, it, expect } from 'vitest';
import { buildDispatchUrl } from './dispatchUrl.js';

describe('buildDispatchUrl', () => {
  it('builds a minimal URL for play only', () => {
    const url = buildDispatchUrl({ deviceId: 'lr', play: 'plex:1', dispatchId: 'd1' });
    expect(url).toBe('api/v1/device/lr/load?play=plex%3A1&dispatchId=d1');
  });

  it('appends shader, volume, shuffle params when provided', () => {
    const url = buildDispatchUrl({
      deviceId: 'lr', play: 'plex:1', dispatchId: 'd1',
      shader: 'dark', volume: 50, shuffle: true,
    });
    expect(url).toContain('shader=dark');
    expect(url).toContain('volume=50');
    expect(url).toContain('shuffle=1');
  });

  it('uses queue= instead of play= when mode is queue', () => {
    const url = buildDispatchUrl({ deviceId: 'lr', queue: 'plex:coll', dispatchId: 'd1' });
    expect(url).toContain('queue=plex%3Acoll');
    expect(url).not.toContain('play=');
  });

  it('throws when deviceId is missing', () => {
    expect(() => buildDispatchUrl({ play: 'plex:1', dispatchId: 'd1' })).toThrow(/deviceId/i);
  });

  it('throws when dispatchId is missing', () => {
    expect(() => buildDispatchUrl({ deviceId: 'lr', play: 'plex:1' })).toThrow(/dispatchId/i);
  });

  it('throws when neither play nor queue is provided', () => {
    expect(() => buildDispatchUrl({ deviceId: 'lr', dispatchId: 'd1' })).toThrow(/play|queue/i);
  });
});
