import { describe, expect, it, vi } from 'vitest';
import { fetchMediaInfo, playContentId } from './api.js';
import { DaylightAPI } from '../../../../../frontend/src/lib/api.mjs';

vi.mock('../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));

// A clip id (`<contentId>#<n>`, or a videoRules `#seg<n>`) names a window of a
// recording. In a URL path its `#` starts a fragment, which would drop the
// query string (session, quality) and send a request for the wrong id.
describe('clip ids on the /play path', () => {
  it('asks /play for the recording a clip was cut from, keeping the query string', async () => {
    let requested;
    DaylightAPI.mockImplementation(async (url) => { requested = url; return { id: 'plex:1001', mediaUrl: '/v' }; });
    await fetchMediaInfo({ contentId: 'plex:1001#1', session: 'abc', maxResolution: '720p' });
    expect(requested.startsWith('api/v1/play/plex:1001?')).toBe(true);
    expect(requested).not.toContain('#');
    const params = new URL(requested, 'http://app.test/').searchParams;
    expect(params.get('session')).toBe('abc');
    expect(params.get('maxResolution')).toBe('720');
  });

  it.each([
    ['plex:1001#12', 'plex:1001'],
    ['immich:abc-def#seg3', 'immich:abc-def'],
    ['plex:1001', 'plex:1001'],
    ['files:music/Track #1.mp3', 'files:music/Track #1.mp3'],
  ])('maps %s to %s', (id, expected) => {
    expect(playContentId(id)).toBe(expected);
  });
});
