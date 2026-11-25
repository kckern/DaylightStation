// tests/isolated/adapter/content/query/QueryAdapter.surroundSegments.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { QueryAdapter } from "../../../../../__capabilities/content-catalog/server/adapters/providers/query/QueryAdapter.mjs";
import { SavedQueryService } from "../../../../../__capabilities/content-catalog/server/application/SavedQueryService.mjs";

const SIDECARS = [
  {
    contentId: 'plex:1001', title: 'Winter Concert', year: 2001,
    segments: [
      { n: 1, name: 'Opening Carol', kind: 'song', song: 'opening', start: 10, end: 200, confidence: 'derived' },
      { n: 2, name: 'Introduction', kind: 'introduction', start: 210, end: 260, confidence: 'derived' },
      { n: 3, name: 'Second Carol', kind: 'song', song: 'second', start: 270, end: 500, confidence: 'guessed' },
    ],
  },
  {
    contentId: 'plex:1002', title: 'Snow Concert', year: 2002,
    segments: [
      { n: 1, name: 'Snow Song', kind: 'song', song: 'snow', start: 5, end: 150, confidence: 'verified' },
    ],
  },
];

// The query file as authored: a flat `type:` query normalized by the service.
const QUERY = {
  title: 'Winter Songs',
  type: 'surround-segments',
  params: { works: 'season/choir', kinds: ['song'], confidence: ['verified', 'derived'], noRepeatSong: true },
};

const plexItem = (id) => ({
  id, source: 'plex', localId: id.replace(/^plex:/, ''), title: `Full ${id}`,
  mediaType: 'video', mediaUrl: `/api/v1/proxy/plex/stream/${id.replace(/^plex:/, '')}`,
  duration: 5000, resumable: true, resumePosition: 1234, thumbnail: `/thumb/${id}`,
  metadata: { type: 'movie' },
});

function makeAdapter({ sidecars = SIDECARS, missing = [] } = {}) {
  const plex = { getItem: vi.fn(async (localId) => (missing.includes(`plex:${localId}`) ? null : plexItem(`plex:${localId}`))) };
  const registry = {
    get: vi.fn(() => null),
    resolve: vi.fn((id) => (id.startsWith('plex:') ? { adapter: plex, localId: id.slice(5) } : null)),
  };
  const surroundSegments = { read: vi.fn(() => sidecars) };
  const savedQueryService = new SavedQueryService({ readQuery: (name) => (name === 'winter-songs' ? QUERY : null) });
  const adapter = new QueryAdapter({ savedQueryService, registry, surroundSegments, random: () => 0.5 });
  return { adapter, plex, registry, surroundSegments };
}

describe('QueryAdapter surround-segments source', () => {
  it('reads the named works folder through the injected reader', async () => {
    const { adapter, surroundSegments } = makeAdapter();
    await adapter.resolvePlayables('query:winter-songs');
    expect(surroundSegments.read).toHaveBeenCalledWith('season/choir');
  });

  it('emits one playable clip per matching segment, on the recording it cuts from', async () => {
    const { adapter } = makeAdapter();
    const items = await adapter.resolvePlayables('query:winter-songs');
    expect(items.map((i) => i.id).sort()).toEqual(['plex:1001#1', 'plex:1002#1']);
    const clip = items.find((i) => i.id === 'plex:1001#1');
    expect(clip).toMatchObject({
      id: 'plex:1001#1',
      contentId: 'plex:1001',
      title: 'Opening Carol',
      subtitle: 'Winter Concert (2001)',
      segment: { start: 10, end: 200 },
      duration: 190,
      song: 'opening',
      source: 'plex',
      mediaType: 'video',
      mediaUrl: '/api/v1/proxy/plex/stream/1001',
      thumbnail: '/thumb/plex:1001',
    });
  });

  it('never resumes a clip at the full recording\'s saved position', async () => {
    const { adapter } = makeAdapter();
    const [clip] = await adapter.resolvePlayables('query:winter-songs');
    expect(clip.resumable).toBe(false);
    expect(clip.resumePosition).toBeNull();
  });

  it('fetches each recording once however many clips it gives', async () => {
    const sidecars = [{
      ...SIDECARS[0],
      segments: SIDECARS[0].segments.map((s) => ({ ...s, confidence: 'derived' })),
    }];
    const { adapter, plex } = makeAdapter({ sidecars });
    const items = await adapter.resolvePlayables('query:winter-songs');
    expect(items).toHaveLength(2);
    expect(plex.getItem).toHaveBeenCalledTimes(1);
  });

  it('drops the clips of a recording that does not resolve', async () => {
    const { adapter } = makeAdapter({ missing: ['plex:1001'] });
    const items = await adapter.resolvePlayables('query:winter-songs');
    expect(items.map((i) => i.id)).toEqual(['plex:1002#1']);
  });

  it('returns nothing without a reader', async () => {
    const savedQueryService = new SavedQueryService({ readQuery: () => QUERY });
    const adapter = new QueryAdapter({ savedQueryService, registry: { resolve: () => null } });
    expect(await adapter.resolvePlayables('query:winter-songs')).toEqual([]);
  });
});
