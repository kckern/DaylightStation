import { describe, it, expect } from 'vitest';
import { PlexLessonCaptionSource } from './PlexLessonCaptionSource.mjs';

const ep = (key, idx, season, extra = {}) => ({
  ratingKey: key, type: 'episode', index: idx, parentIndex: season, parentRatingKey: `s${season}`, title: `Lesson ${key}`, duration: 600000, ...extra,
});
const withStreams = (streams) => ({ Media: [{ Part: [{ Stream: streams }] }] });

function client() {
  const calls = [];
  const data = {
    '/library/collections/100/items': { MediaContainer: { Metadata: [{ ratingKey: '1', type: 'show', title: 'Show One' }, { ratingKey: '2', type: 'show', title: 'Excluded' }, { ratingKey: '50', type: 'season', parentRatingKey: '5', parentTitle: 'Show Five', title: 'Season A' }] } },
    '/library/metadata/50/children': { MediaContainer: { Metadata: [{ ratingKey: '51', type: 'episode', index: 3, parentIndex: 2, parentRatingKey: '50', title: 'Five-A', duration: 120000, ...withStreams([]) }] } },
    '/library/collections/300/items': { MediaContainer: { Metadata: [{ ratingKey: '3', type: 'show', title: 'Voice' }] } },
    '/library/metadata/1/allLeaves': { MediaContainer: { Metadata: [ep('11', 1, 1), ep('12', 2, 1, withStreams([{ id: 501, streamType: 3, codec: 'srt', languageCode: 'eng' }])), ep('13', 1, 2)] } },
    '/library/metadata/4': { MediaContainer: { Metadata: [{ ratingKey: '4', type: 'show', title: 'Extra Show' }] } },
    '/library/metadata/4/allLeaves': { MediaContainer: { Metadata: [ep('41', 1, 1)] } },
    '/library/metadata/11': { MediaContainer: { Metadata: [ep('11', 1, 1, withStreams([
      { id: 900, streamType: 3, codec: 'srt', languageCode: 'fra' },
      { id: 901, streamType: 3, codec: 'srt', languageCode: 'eng' },
      { id: 902, streamType: 2 },
    ]))] } },
    '/library/metadata/41': { MediaContainer: { Metadata: [ep('41', 1, 1, withStreams([]))] } },
    '/library/streams/901': '1\n00:00:01,000 --> 00:00:02,000\nHello\n',
  };
  return {
    calls,
    request: async (p, opts) => { calls.push(p); if (!(opts?.deadline > 0)) throw new Error(`no deadline on ${p}`); if (!(p in data)) throw new Error(`unexpected ${p}`); return data[p]; },
  };
}

const videosConfig = {
  collections: [
    { label: 'Lessons', plex: ['plex:100'], shows: ['plex:4'], exclude_shows: ['plex:2'] },
    { label: 'Voice', plex: ['plex:300'], shows: ['plex:s2'], engagement_gate: false },
  ],
};

describe('PlexLessonCaptionSource', () => {
  it('lists lessons of gated tabs only (not a season a gate-off tab picks), minus excluded shows, plus config shows; picks the English srt', async () => {
    const c = client();
    const src = new PlexLessonCaptionSource({ plexClient: c, videosConfig, logger: { info() {}, warn() {} } });
    const lessons = await src.listLessons();
    expect(lessons.map((l) => l.plexId).sort()).toEqual(['11', '12', '41', '51']);
    expect(lessons.find((l) => l.plexId === '51')).toMatchObject({ showKey: '5', showTitle: 'Show Five', seasonKey: '50', season: 2, episode: 3 });
    expect(lessons.find((l) => l.plexId === '11')).toMatchObject({ showKey: '1', showTitle: 'Show One', season: 1, episode: 1, durationSec: 600, captionStreamId: '901', seasonKey: 's1' });
    expect(lessons.find((l) => l.plexId === '12').captionStreamId).toBe('501');
    expect(lessons.find((l) => l.plexId === '41').captionStreamId).toBeNull();
    expect(c.calls.some((p) => p.includes('/300/'))).toBe(false);
  });

  it('returns the caption body', async () => {
    const src = new PlexLessonCaptionSource({ plexClient: client(), videosConfig, logger: { info() {}, warn() {} } });
    expect(await src.captionText('901')).toContain('Hello');
  });
});
