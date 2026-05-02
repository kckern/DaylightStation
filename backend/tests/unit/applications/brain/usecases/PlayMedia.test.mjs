import { describe, it } from 'node:test';
import assert from 'node:assert';
import { PlayMediaUseCase, orderForResolve, simplifyQuery } from '../../../../../src/3_applications/brain/usecases/PlayMedia.mjs';

const silentLogger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };
const SAT = { mediaPlayerEntity: 'media_player.office' };

function makeFakes({
  searchResults = [],
  resolveResults = {},
  playables = (items) => items,
  judgePicks = null,
  judgeThrows = null,
  callServiceResult = { ok: true },
} = {}) {
  const calls = { search: [], resolve: [], judge: [], play: [] };
  return {
    calls,
    search: async (text) => { calls.search.push(text); return { items: searchResults[calls.search.length - 1] ?? [] }; },
    resolve: async (source, localId) => {
      calls.resolve.push({ source, localId });
      return { items: resolveResults[`${source}:${localId}`] ?? [] };
    },
    filterPlayable: playables,
    gateway: {
      callService: async (domain, service, data) => {
        calls.play.push({ domain, service, data });
        return callServiceResult;
      },
    },
    urlBuilder: (playable, source, localId) => `http://test/${source}/${localId}`,
    judge: judgePicks || judgeThrows
      ? {
          pick: async (input) => {
            calls.judge.push(input);
            if (judgeThrows) throw judgeThrows;
            return judgePicks;
          },
        }
      : null,
    logger: silentLogger,
  };
}

describe('PlayMediaUseCase — basic flow', () => {
  it('returns no_media_player when satellite has no entity', async () => {
    const fakes = makeFakes();
    const uc = new PlayMediaUseCase(fakes);
    const r = await uc.execute({ query: 'x', satellite: {} });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'no_media_player');
    assert.strictEqual(fakes.calls.search.length, 0);
  });

  it('returns no_match when search yields zero items even after retry', async () => {
    const fakes = makeFakes({ searchResults: [[], []] });
    const uc = new PlayMediaUseCase(fakes);
    // "the wibble flarp" simplifies to "wibble flarp" (article stripped) → triggers retry
    const r = await uc.execute({ query: 'the wibble flarp', satellite: SAT });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'no_match');
    assert.strictEqual(fakes.calls.search.length, 2);
  });

  it('returns no_match without retry when simplifyQuery yields the same text', async () => {
    const fakes = makeFakes({ searchResults: [[]] });
    const uc = new PlayMediaUseCase(fakes);
    // No article, no "by ARTIST", no politeness — simplifyQuery is a no-op
    const r = await uc.execute({ query: 'wibble flarp', satellite: SAT });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'no_match');
    assert.strictEqual(fakes.calls.search.length, 1);
  });

  it('plays the top match when single result returned', async () => {
    const fakes = makeFakes({
      searchResults: [[{ id: 'plex:1', source: 'plex', localId: '1', title: 'Track One' }]],
      resolveResults: { 'plex:1': [{ id: 'plex:1', mediaUrl: '/file.mp3' }] },
    });
    const uc = new PlayMediaUseCase(fakes);
    const r = await uc.execute({ query: 'track one', satellite: SAT });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.title, 'Track One');
    assert.strictEqual(r.pickReason, 'top_of_rank');
    assert.strictEqual(fakes.calls.play[0].data.media_content_id, 'http://test/plex/1');
  });
});

describe('PlayMediaUseCase — retry on no_match', () => {
  it('retries with simplified query and succeeds when first search empty', async () => {
    const fakes = makeFakes({
      searchResults: [
        [], // first search "play we built this city by starship" → 0
        [{ id: 'plex:42', source: 'plex', localId: '42', title: 'WBTC' }],
      ],
      resolveResults: { 'plex:42': [{ id: 'plex:42', mediaUrl: '/x.mp3' }] },
    });
    const uc = new PlayMediaUseCase(fakes);
    const r = await uc.execute({ query: 'play we built this city by starship', satellite: SAT });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(fakes.calls.search.length, 2);
    // simplified should have stripped " by starship"
    assert.match(fakes.calls.search[1], /city/);
    assert.ok(!fakes.calls.search[1].includes('starship'));
  });
});

describe('PlayMediaUseCase — judge', () => {
  const items = [
    { id: 'a', source: 'plex', localId: 'a', title: 'A', metadata: {} },
    { id: 'b', source: 'plex', localId: 'b', title: 'B', metadata: {} },
    { id: 'c', source: 'plex', localId: 'c', title: 'C', metadata: {} },
  ];

  it('uses judge pick when judge returns valid index', async () => {
    const fakes = makeFakes({
      searchResults: [items],
      resolveResults: { 'plex:b': [{ id: 'plex:b', mediaUrl: '/b.mp3' }] },
      judgePicks: { index: 1, reason: 'best_match', latencyMs: 50 },
    });
    const uc = new PlayMediaUseCase(fakes);
    const r = await uc.execute({ query: 'something', satellite: SAT });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.sourceContentId, 'b');
    assert.match(r.pickReason, /^judge:best_match/);
  });

  it('falls back to top of rank when judge returns -1', async () => {
    const fakes = makeFakes({
      searchResults: [items],
      resolveResults: { 'plex:a': [{ id: 'plex:a', mediaUrl: '/a.mp3' }] },
      judgePicks: { index: -1, reason: 'no_confident_pick', latencyMs: 30 },
    });
    const uc = new PlayMediaUseCase(fakes);
    const r = await uc.execute({ query: 'x', satellite: SAT });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.sourceContentId, 'a');
    assert.strictEqual(r.pickReason, 'top_of_rank');
  });

  it('falls back to top of rank when judge throws', async () => {
    const fakes = makeFakes({
      searchResults: [items],
      resolveResults: { 'plex:a': [{ id: 'plex:a', mediaUrl: '/a.mp3' }] },
      judgeThrows: new Error('judge boom'),
    });
    const uc = new PlayMediaUseCase(fakes);
    const r = await uc.execute({ query: 'x', satellite: SAT });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.sourceContentId, 'a');
    assert.strictEqual(r.pickReason, 'top_of_rank');
  });

  it('does not call judge when only one candidate', async () => {
    const fakes = makeFakes({
      searchResults: [[items[0]]],
      resolveResults: { 'plex:a': [{ id: 'plex:a', mediaUrl: '/a.mp3' }] },
      judgePicks: { index: 0, reason: 'x', latencyMs: 1 },
    });
    const uc = new PlayMediaUseCase(fakes);
    await uc.execute({ query: 'x', satellite: SAT });
    assert.strictEqual(fakes.calls.judge.length, 0);
  });
});

describe('PlayMediaUseCase — walk on resolve failure', () => {
  it('walks past a candidate whose resolve returns no playable items', async () => {
    const items = [
      { id: 'plex:bad', source: 'plex', localId: 'bad', title: 'Bad' },
      { id: 'plex:good', source: 'plex', localId: 'good', title: 'Good' },
    ];
    const fakes = makeFakes({
      searchResults: [items],
      resolveResults: {
        'plex:bad': [], // empty — like an Audiobookshelf author entity
        'plex:good': [{ id: 'plex:good', mediaUrl: '/g.mp3' }],
      },
    });
    const uc = new PlayMediaUseCase(fakes);
    const r = await uc.execute({ query: 'x', satellite: SAT });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.sourceContentId, 'plex:good');
    assert.strictEqual(r.resolveAttempts.length, 2);
    assert.strictEqual(r.resolveAttempts[0].reason, 'no_playable');
    assert.strictEqual(r.resolveAttempts[1].reason, 'ok');
  });

  it('walks past a candidate whose resolve throws', async () => {
    const items = [
      { id: 'plex:err', source: 'plex', localId: 'err', title: 'Err' },
      { id: 'plex:ok', source: 'plex', localId: 'ok', title: 'OK' },
    ];
    const fakes = {
      ...makeFakes({
        searchResults: [items],
        resolveResults: { 'plex:ok': [{ id: 'plex:ok', mediaUrl: '/o.mp3' }] },
      }),
    };
    let resolveCount = 0;
    fakes.resolve = async (source, localId) => {
      resolveCount++;
      if (localId === 'err') throw new Error('boom');
      return { items: [{ id: `${source}:${localId}`, mediaUrl: '/o.mp3' }] };
    };
    const uc = new PlayMediaUseCase(fakes);
    const r = await uc.execute({ query: 'x', satellite: SAT });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.sourceContentId, 'plex:ok');
    assert.strictEqual(r.resolveAttempts[0].reason, 'error');
    assert.match(r.resolveAttempts[0].error, /boom/);
  });

  it('returns failure when ALL candidates fail to resolve', async () => {
    const items = [
      { id: 'plex:1', source: 'plex', localId: '1', title: 'A' },
      { id: 'plex:2', source: 'plex', localId: '2', title: 'B' },
    ];
    const fakes = makeFakes({
      searchResults: [items],
      resolveResults: { 'plex:1': [], 'plex:2': [] },
    });
    const uc = new PlayMediaUseCase(fakes);
    const r = await uc.execute({ query: 'x', satellite: SAT });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'no_playable');
    assert.strictEqual(r.resolveAttempts.length, 2);
  });

  it('filters playables — items rejected by filterPlayable trigger walk', async () => {
    const items = [{ id: 'plex:1', source: 'plex', localId: '1', title: 'A' }];
    const fakes = makeFakes({
      searchResults: [items],
      resolveResults: { 'plex:1': [{ id: 'p1', mediaType: 'image' }] },
      // filterPlayable that drops images:
      playables: (resolved) => resolved.filter(i => i.mediaType !== 'image'),
    });
    const uc = new PlayMediaUseCase(fakes);
    const r = await uc.execute({ query: 'x', satellite: SAT });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'no_playable');
  });
});

describe('PlayMediaUseCase — container expansion + shuffle', () => {
  const ALBUM_ITEM = { id: 'plex:74613', source: 'plex', localId: '74613', title: 'Greatest Hits',
    mediaType: 'album', metadata: { type: 'album' } };
  const ARTIST_ITEM = { id: 'plex:74612', source: 'plex', localId: '74612', title: 'Starship',
    mediaType: 'artist', metadata: { type: 'artist' } };
  const PLAYLIST_ITEM = { id: 'plex:8888', source: 'plex', localId: '8888', title: 'Workout Mix',
    mediaType: 'playlist', metadata: { type: 'playlist' } };

  function fiveTracks(prefix = 't') {
    return Array.from({ length: 5 }, (_, i) => ({
      id: `plex:${prefix}${i}`, localId: `${prefix}${i}`, mediaUrl: `/${prefix}${i}.mp3`,
      mediaType: 'track', metadata: { type: 'audio' },
    }));
  }

  it('album: plays all tracks in order, no shuffle', async () => {
    const tracks = fiveTracks('a');
    const fakes = makeFakes({
      searchResults: [[ALBUM_ITEM]],
      resolveResults: { 'plex:74613': tracks },
    });
    const uc = new PlayMediaUseCase(fakes);
    const r = await uc.execute({ query: 'greatest hits album', satellite: SAT });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.candidateType, 'album');
    assert.strictEqual(r.sequenceLength, 5);
    assert.strictEqual(r.shuffled, false);
    // 5 enqueue calls, first with 'play', rest with 'add', in original order
    const enqueues = fakes.calls.play.map(p => p.data.enqueue);
    assert.deepStrictEqual(enqueues, ['play', 'add', 'add', 'add', 'add']);
    const ids = fakes.calls.play.map(p => p.data.media_content_id);
    assert.deepStrictEqual(ids, ['http://test/plex/a0', 'http://test/plex/a1', 'http://test/plex/a2', 'http://test/plex/a3', 'http://test/plex/a4']);
  });

  it('artist: shuffles tracks before queueing', async () => {
    const tracks = fiveTracks('r');
    const fakes = makeFakes({
      searchResults: [[ARTIST_ITEM]],
      resolveResults: { 'plex:74612': tracks },
    });
    const uc = new PlayMediaUseCase(fakes);
    const r = await uc.execute({ query: 'starship', satellite: SAT });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.candidateType, 'artist');
    assert.strictEqual(r.sequenceLength, 5);
    assert.strictEqual(r.shuffled, true);
    // sequence still has all 5 ids but possibly reordered
    const ids = fakes.calls.play.map(p => p.data.media_content_id).sort();
    assert.deepStrictEqual(ids, ['http://test/plex/r0','http://test/plex/r1','http://test/plex/r2','http://test/plex/r3','http://test/plex/r4'].sort());
  });

  it('playlist: shuffles by default', async () => {
    const tracks = fiveTracks('p');
    const fakes = makeFakes({
      searchResults: [[PLAYLIST_ITEM]],
      resolveResults: { 'plex:8888': tracks },
    });
    const uc = new PlayMediaUseCase(fakes);
    const r = await uc.execute({ query: 'workout mix', satellite: SAT });
    assert.strictEqual(r.shuffled, true);
    assert.strictEqual(r.sequenceLength, 5);
  });

  it('caps queue at maxQueueSize', async () => {
    const lots = Array.from({ length: 100 }, (_, i) => ({
      id: `plex:big${i}`, localId: `big${i}`, mediaUrl: `/b${i}.mp3`,
      mediaType: 'track', metadata: { type: 'audio' },
    }));
    const fakes = makeFakes({
      searchResults: [[ARTIST_ITEM]],
      resolveResults: { 'plex:74612': lots },
    });
    const uc = new PlayMediaUseCase({ ...fakes, playbackPolicy: { maxQueueSize: 7, shuffleTypes: ['artist'] } });
    const r = await uc.execute({ query: 'huge artist', satellite: SAT });
    assert.strictEqual(r.sequenceLength, 7);
    assert.strictEqual(fakes.calls.play.length, 7);
  });

  it('track candidate plays a single item (no enqueue chain)', async () => {
    const single = { id: 'plex:99', source: 'plex', localId: '99', title: 'A track',
      mediaType: 'track', metadata: { type: 'audio' } };
    const fakes = makeFakes({
      searchResults: [[single]],
      resolveResults: { 'plex:99': [{ id: 'plex:99', localId: '99', mediaUrl: '/99.mp3', mediaType: 'track' }] },
    });
    const uc = new PlayMediaUseCase(fakes);
    const r = await uc.execute({ query: 'a track', satellite: SAT });
    assert.strictEqual(r.candidateType, 'track');
    assert.strictEqual(r.sequenceLength, 1);
    assert.strictEqual(r.shuffled, false);
    assert.strictEqual(fakes.calls.play.length, 1);
    assert.strictEqual(fakes.calls.play[0].data.enqueue, 'play');
  });

  it('first-item failure aborts the queue chain', async () => {
    const tracks = fiveTracks('f');
    const fakes = makeFakes({
      searchResults: [[ARTIST_ITEM]],
      resolveResults: { 'plex:74612': tracks },
      callServiceResult: { ok: false, error: 'ha said no' },
    });
    const uc = new PlayMediaUseCase(fakes);
    const r = await uc.execute({ query: 'artist', satellite: SAT });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'ha said no');
    // Only the first call should have been attempted
    assert.strictEqual(fakes.calls.play.length, 1);
  });

  it('honors caller-supplied shuffleTypes override', async () => {
    const tracks = fiveTracks('o');
    const fakes = makeFakes({
      searchResults: [[ALBUM_ITEM]],
      resolveResults: { 'plex:74613': tracks },
    });
    // Override: shuffle albums too
    const uc = new PlayMediaUseCase({ ...fakes, playbackPolicy: { shuffleTypes: ['album'] } });
    const r = await uc.execute({ query: 'album', satellite: SAT });
    assert.strictEqual(r.shuffled, true);
  });
});

describe('orderForResolve helper', () => {
  it('starts at picked index and walks outward', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    assert.deepStrictEqual(orderForResolve(items, 2), ['c', 'd', 'b', 'e', 'a']);
  });
  it('starts at index 0 and walks right', () => {
    assert.deepStrictEqual(orderForResolve(['a', 'b', 'c'], 0), ['a', 'b', 'c']);
  });
  it('starts at last index and walks left', () => {
    assert.deepStrictEqual(orderForResolve(['a', 'b', 'c'], 2), ['c', 'b', 'a']);
  });
  it('clamps out-of-range pickIndex to a valid one', () => {
    assert.deepStrictEqual(orderForResolve(['a', 'b'], 99), ['b', 'a']);
  });
  it('returns [] for empty input', () => {
    assert.deepStrictEqual(orderForResolve([], 0), []);
  });
});

describe('simplifyQuery helper', () => {
  it('strips "by ARTIST" suffix', () => {
    assert.strictEqual(simplifyQuery('we built this city by starship'), 'we built this city');
  });
  it('strips "from ALBUM" suffix', () => {
    assert.strictEqual(simplifyQuery('three little pigs from greatest hits'), 'three little pigs');
  });
  it('strips leading articles', () => {
    assert.strictEqual(simplifyQuery('the three little pigs'), 'three little pigs');
  });
  it('strips politeness prefixes', () => {
    assert.strictEqual(simplifyQuery('please play music'), 'play music');
    assert.strictEqual(simplifyQuery('could you play something'), 'play something');
  });
  it('strips trailing punctuation', () => {
    assert.strictEqual(simplifyQuery('play music!?'), 'play music');
  });
  it('returns null for too-short input', () => {
    assert.strictEqual(simplifyQuery(''), null);
    assert.strictEqual(simplifyQuery('a'), null);
  });
  it('returns null for non-string input', () => {
    assert.strictEqual(simplifyQuery(null), null);
    assert.strictEqual(simplifyQuery(undefined), null);
    assert.strictEqual(simplifyQuery(42), null);
  });
});
