import { describe, expect, it, vi } from 'vitest';
import { fetchMediaInfo } from './api.js';
import { DaylightAPI } from '../../../../../frontend/src/lib/api.mjs';

vi.mock('../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));

describe('browser quality intent survives metadata resolution', () => {
  it.each([false, true])('sends and retains explicit quality for shuffle=%s', async shuffle => {
    let requested;
    DaylightAPI.mockImplementation(async url => {
      requested = new URL(url, 'http://app.test/');
      return { id: 'plex:42', mediaUrl: '/video.m3u8' };
    });
    const info = await fetchMediaInfo({ contentId: 'plex:42', shuffle, maxResolution: '720p', maxVideoBitrate: 4000, transcode: 'force', adaptive: false });
    expect(requested.searchParams.get('maxResolution')).toBe('720');
    expect(requested.searchParams.get('transcode')).toBe('force');
    expect(requested.searchParams.get('adaptive')).toBe('false');
    expect(info).toMatchObject({ maxResolution: '720', maxVideoBitrate: 4000, transcode: 'force', adaptive: false });
  });
});
