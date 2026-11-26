import { describe, it, expect } from 'vitest';
import { plexFileVersion } from './plexFileVersion.mjs';

describe('plexFileVersion', () => {
  it('reads "<partId>:<updatedAt>" from the part the stream resolves to', () => {
    expect(plexFileVersion({ Media: [{ Part: [{ id: 99123, key: '/library/parts/99123/1690000000/file.mp3' }] }] })).toBe('99123:1690000000');
  });
  it('is null when the metadata has no such part', () => {
    expect(plexFileVersion({})).toBeNull();
    expect(plexFileVersion({ Media: [{ Part: [{ id: 1, key: '/library/parts/1/file.mp3' }] }] })).toBeNull();
    expect(plexFileVersion({ Media: [{ Part: [{ id: 2, key: '/library/parts/1/1690000000/file.mp3' }] }] })).toBeNull();
  });
});

import { vi } from 'vitest';
import { PlexAdapter } from './PlexAdapter.mjs';
import { toQueueItem } from '../../../../../playback/server/api/queue.mjs';
import { PlayResponseService } from '../../../../../playback/server/application/services/PlayResponseService.mjs';

// The play and queue answers the phone resolves carry it on each audio item, top level.
describe('fileVersion on Plex audio, through play and queue', () => {
  const logger = { info() {}, warn() {}, debug() {}, error() {}, sampled() {} };
  const plex = new PlexAdapter({ host: 'http://plex.test:32400', token: 't', logger }, { httpClient: { get: vi.fn(), post: vi.fn() }, logger });
  const track = {
    ratingKey: '352346', type: 'track', title: 'One Love', duration: 233000,
    Media: [{ Part: [{ id: 99123, key: '/library/parts/99123/1690000000/file.flac' }] }],
  };

  it('the playable carries it, and so do the queue item and the play response', () => {
    const item = plex._toPlayableItem(track);
    expect(item.fileVersion).toBe('99123:1690000000');
    expect(toQueueItem(item).fileVersion).toBe('99123:1690000000');
    const svc = new PlayResponseService({ mediaProgressMemory: null, now: () => Date.now() });
    expect(svc.toPlayResponse(item).fileVersion).toBe('99123:1690000000');
  });

  it('is omitted when unknown, and on video', () => {
    const bare = plex._toPlayableItem({ ...track, Media: undefined });
    expect('fileVersion' in bare).toBe(false);
    expect('fileVersion' in toQueueItem(bare)).toBe(false);
    const film = plex._toPlayableItem({ ratingKey: '1', type: 'movie', title: 'Film', Media: track.Media });
    expect(film.fileVersion).toBeUndefined();
  });
});
