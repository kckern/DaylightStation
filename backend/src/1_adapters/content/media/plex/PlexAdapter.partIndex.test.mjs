import { describe, it, expect, vi } from 'vitest';
import { PlexAdapter } from './PlexAdapter.mjs';

// 2026-10-07: the index only filled in loadMediaUrl, so URLs built by
// getItem/toPlayable and the queue builders were never mapped and every restart
// emptied it -> media.source.heal.proxy-unmapped. Every builder now indexes, and
// an unknown part is resolved through Plex (`media.part.id`, NOT `part.id`).

function adapter(request) {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const plex = new PlexAdapter(
    { host: 'http://plex.test:32400', token: 't', logger },
    { httpClient: { get: vi.fn(), post: vi.fn() }, logger },
  );
  if (request) plex.client.request = request;
  return { plex, logger };
}

const episode = (ratingKey, partIds) => ({
  ratingKey: String(ratingKey), type: 'episode', title: 'Ticklecrabs', duration: 420000,
  Media: partIds.map((id) => ({
    videoCodec: 'h264', audioCodec: 'aac', container: 'mp4', videoProfile: 'high', bitrate: 2000, width: 1280, height: 720,
    Part: [{ id, key: `/library/parts/${id}/1599193403/file.mp4`, file: '/data/x.mp4', container: 'mp4' }],
  })),
});

describe('part index', () => {
  it('_toPlayableItem indexes every part it hands out (all Media versions)', () => {
    const { plex } = adapter();
    plex._toPlayableItem(episode(59546, [494586, 494587]));
    expect(plex.ratingKeyForPart('494586')).toBe('59546');
    expect(plex.ratingKeyForPart(494587)).toBe('59546');
  });

  it('indexes container-less queue children too (same builder)', () => {
    const { plex } = adapter();
    for (const [rk, part] of [[1, 11], [2, 22], [3, 33]]) plex._toPlayableItem(episode(rk, [part]));
    expect(['11', '22', '33'].map((p) => plex.ratingKeyForPart(p))).toEqual(['1', '2', '3']);
  });

  it('is bounded: oldest entries fall off', () => {
    const { plex } = adapter();
    for (let i = 1; i <= 5100; i += 1) plex._toPlayableItem(episode(i, [100000 + i]));
    expect(plex.ratingKeyForPart('100001')).toBeNull();
    expect(plex.ratingKeyForPart('105100')).toBe('5100');
  });
});

describe('resolveRatingKeyForPart', () => {
  it('answers from the index without asking Plex', async () => {
    const request = vi.fn();
    const { plex } = adapter(request);
    plex._toPlayableItem(episode(59546, [494586]));
    expect(await plex.resolveRatingKeyForPart('494586')).toBe('59546');
    expect(request).not.toHaveBeenCalled();
  });

  it('falls back to /library/all?type=4&media.part.id=, caches, and logs heal.part-resolved', async () => {
    const request = vi.fn(async () => ({ MediaContainer: { Metadata: [{ ratingKey: '59546', type: 'episode' }] } }));
    const { plex, logger } = adapter(request);
    expect(await plex.resolveRatingKeyForPart('494586')).toBe('59546');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe('/library/all?type=4&media.part.id=494586');
    expect(logger.info).toHaveBeenCalledWith('media.source.heal.part-resolved', expect.objectContaining({ partId: '494586', ratingKey: '59546', via: 'type-4' }));
    // second time: cached
    expect(await plex.resolveRatingKeyForPart('494586')).toBe('59546');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('tries movies (type 1) then tracks (type 10) when episodes have no match', async () => {
    const request = vi.fn(async (path) => (path.includes('type=10')
      ? { MediaContainer: { Metadata: [{ ratingKey: '777' }] } }
      : { MediaContainer: { Metadata: [] } }));
    const { plex } = adapter(request);
    expect(await plex.resolveRatingKeyForPart('9')).toBe('777');
    expect(request.mock.calls.map(([p]) => p)).toEqual([
      '/library/all?type=4&media.part.id=9',
      '/library/all?type=1&media.part.id=9',
      '/library/all?type=10&media.part.id=9',
    ]);
  });

  it('returns null when Plex has no such part or errors (and does not hammer: brief negative cache)', async () => {
    const request = vi.fn(async () => { throw new Error('boom'); });
    const { plex } = adapter(request);
    expect(await plex.resolveRatingKeyForPart('5')).toBeNull();
    const calls = request.mock.calls.length;
    expect(await plex.resolveRatingKeyForPart('5')).toBeNull();
    expect(request.mock.calls.length).toBe(calls);
  });
});

describe('resolveRatingKeyForPath', () => {
  it('maps a direct-play part path', async () => {
    const { plex } = adapter();
    plex._toPlayableItem(episode(59546, [494586]));
    expect(await plex.resolveRatingKeyForPath('/library/parts/494586/1599193403/file.mp4')).toBe('59546');
  });

  // Plex's segment path carries ITS transcode session uuid
  // (TranscodeSession.key), not the X-Plex-Session-Identifier we mint.
  const UUID = '3ce6d0bd-bd37-4f34-8970-15453917f177';
  const statusSessions = (rows) => ({ MediaContainer: { size: rows.length, Metadata: rows } });

  it('maps a transcode segment path via GET /status/sessions (TranscodeSession.key -> ratingKey)', async () => {
    const request = vi.fn(async () => statusSessions([
      { ratingKey: '111', Session: { id: 'x' } },
      { ratingKey: '59546', TranscodeSession: { key: UUID } },
    ]));
    const { plex } = adapter(request);
    expect(await plex.resolveRatingKeyForPath(`/video/:/transcode/universal/session/${UUID}/base/00012.ts`)).toBe('59546');
    expect(request.mock.calls[0][0]).toBe('/status/sessions');
    // positive answer is cached
    expect(await plex.resolveRatingKeyForPath(`/video/:/transcode/universal/session/${UUID}/base/00013.ts`)).toBe('59546');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('accepts a key written as a path (/transcode/sessions/<uuid>)', async () => {
    const request = vi.fn(async () => statusSessions([{ ratingKey: '42', TranscodeSession: { key: `/transcode/sessions/${UUID}` } }]));
    const { plex } = adapter(request);
    expect(await plex.resolveRatingKeyForPath(`/video/:/transcode/universal/session/${UUID}/base/00012.ts`)).toBe('42');
  });

  it('an unmatched session is a 30s negative cache (no hammering), then asks again', async () => {
    vi.useFakeTimers();
    try {
      const request = vi.fn(async () => statusSessions([{ ratingKey: '1', TranscodeSession: { key: 'other' } }]));
      const { plex } = adapter(request);
      const path = `/video/:/transcode/universal/session/${UUID}/base/00012.ts`;
      expect(await plex.resolveRatingKeyForPath(path)).toBeNull();
      expect(await plex.resolveRatingKeyForPath(path)).toBeNull();
      expect(request).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(31_000);
      expect(await plex.resolveRatingKeyForPath(path)).toBeNull();
      expect(request).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });

  it('a failing /status/sessions resolves to null, never throws', async () => {
    const { plex } = adapter(vi.fn(async () => { throw new Error('boom'); }));
    expect(await plex.resolveRatingKeyForPath(`/video/:/transcode/universal/session/${UUID}/base/1.ts`)).toBeNull();
  });

  it('returns null for paths that are neither', async () => {
    const { plex } = adapter();
    expect(await plex.resolveRatingKeyForPath('/library/metadata/1/thumb/2')).toBeNull();
  });
});
