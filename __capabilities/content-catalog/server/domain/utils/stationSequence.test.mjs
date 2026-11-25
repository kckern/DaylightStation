import { describe, it, expect, vi } from 'vitest';
import {
  normalizeSequence,
  splitHead,
  interleaveIdents,
  shuffleItems,
  sequenceQueue,
} from './stationSequence.mjs';

const item = (id) => ({ id });
const ids = (items) => items.map((it) => it.id);
// Deterministic random: cycles through the given values.
const seeded = (...values) => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe('normalizeSequence', () => {
  it('defaults head to 1 with no idents', () => {
    expect(normalizeSequence({})).toEqual({ sequence: { head: 1, idents: null }, problems: [] });
  });

  it('accepts a head count and a head id list', () => {
    expect(normalizeSequence({ head: 3 }).sequence.head).toBe(3);
    expect(normalizeSequence({ head: 0 }).sequence.head).toBe(0);
    expect(normalizeSequence({ head: ['plex:1', 'plex:2'] }).sequence.head).toEqual(['plex:1', 'plex:2']);
  });

  it('normalizes every: integer → [n, n], range → sorted pair', () => {
    const fixed = normalizeSequence({ idents: { every: 4, pool: ['plex:9'] } });
    expect(fixed.sequence.idents).toEqual({ every: [4, 4], minutes: null, count: [1, 1], order: 'shuffle', pool: ['plex:9'] });
    const range = normalizeSequence({ idents: { every: [5, 3], pool: ['plex:9'] } });
    expect(range.sequence.idents.every).toEqual([3, 5]);
  });

  it('reports bad shapes and falls back to the safe default', () => {
    expect(normalizeSequence('nope')).toEqual({ sequence: null, problems: ['sequence-not-a-mapping'] });
    const badHead = normalizeSequence({ head: -1 });
    expect(badHead.sequence.head).toBe(1);
    expect(badHead.problems).toContain('head-invalid');
    const badEntry = normalizeSequence({ head: ['plex:1', 42] });
    expect(badEntry.sequence.head).toEqual(['plex:1']);
    expect(badEntry.problems).toContain('head-entry-invalid');
    const badEvery = normalizeSequence({ idents: { every: 0, pool: ['plex:9'] } });
    expect(badEvery.sequence.idents).toBeNull();
    expect(badEvery.problems).toContain('idents-every-invalid');
    const badPool = normalizeSequence({ idents: { every: 3, pool: 'plex:9' } });
    expect(badPool.sequence.idents).toBeNull();
    expect(badPool.problems).toContain('idents-pool-not-a-list');
    const emptyPool = normalizeSequence({ idents: { every: 3, pool: [] } });
    expect(emptyPool.sequence.idents).toBeNull();
    expect(emptyPool.problems).toContain('idents-pool-empty');
  });
});

describe('normalizeSequence — breaks', () => {
  it('reads breaks: as the general name, with a time trigger, a count per break and an order', () => {
    const { sequence, problems } = normalizeSequence({
      head: 0,
      breaks: { minutes: 15, count: [1, 3], order: 'sequential', pool: ['immich:album:a', 'plex:778766'] },
    });
    expect(problems).toEqual([]);
    expect(sequence.idents).toEqual({
      every: null, minutes: 15, count: [1, 3], order: 'sequential', pool: ['immich:album:a', 'plex:778766'],
    });
  });

  it('takes both triggers, whichever comes first', () => {
    expect(normalizeSequence({ breaks: { every: 4, minutes: 20, pool: ['plex:9'] } }).sequence.idents)
      .toMatchObject({ every: [4, 4], minutes: 20 });
  });

  it('needs a trigger, and reports a bad minutes, count or order', () => {
    const none = normalizeSequence({ breaks: { pool: ['plex:9'] } });
    expect(none.sequence.idents).toBeNull();
    expect(none.problems).toContain('breaks-trigger-missing');
    const bad = normalizeSequence({ breaks: { every: 2, minutes: -1, count: 0, order: 'random', pool: ['plex:9'] } });
    expect(bad.problems).toEqual(expect.arrayContaining(['breaks-minutes-invalid', 'breaks-count-invalid', 'breaks-order-invalid']));
    expect(bad.sequence.idents).toEqual({ every: [2, 2], minutes: null, count: [1, 1], order: 'shuffle', pool: ['plex:9'] });
  });

  it('prefers breaks: when a file also carries the older idents:', () => {
    const both = normalizeSequence({ breaks: { every: 2, pool: ['plex:b'] }, idents: { every: 9, pool: ['plex:i'] } });
    expect(both.sequence.idents.pool).toEqual(['plex:b']);
    expect(both.problems).toContain('breaks-and-idents');
  });
});

describe('interleaveIdents — breaks', () => {
  const long = (n, seconds) => Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, duration: seconds }));
  const shape = (out) => out.map((it) => (it.id.startsWith('s') ? 's' : 'b')).join('');

  it('breaks on time before the item count when the songs are long', () => {
    const out = interleaveIdents(long(6, 600), { every: [5, 5], minutes: 15 }, [item('b1')], seeded(0));
    expect(shape(out)).toBe('ssbssbss');
  });

  it('times a clip by its segment window, and an item with no length as nothing', () => {
    const clips = [1, 2, 3, 4].map((n) => ({ id: `s${n}`, duration: 7200, segment: { start: 100, end: 400 } }));
    expect(shape(interleaveIdents(clips, { minutes: 10 }, [item('b1')], seeded(0)))).toBe('ssbss');
    const unknown = [1, 2, 3].map((n) => ({ id: `s${n}` }));
    expect(shape(interleaveIdents(unknown, { minutes: 1 }, [item('b1')], seeded(0)))).toBe('sss');
  });

  it('plays count items per break, never one twice in the same break', () => {
    const pool = ['b1', 'b2', 'b3', 'b4', 'b5'].map(item);
    const out = interleaveIdents(long(4, 60), { every: [1, 1], count: [2, 2] }, pool, Math.random);
    expect(shape(out)).toBe('sbbsbbsbbs');
    for (let i = 1; i < out.length; i += 3) expect(out[i].id).not.toBe(out[i + 1].id);
  });

  it('walks the pool in its own order across breaks when sequential', () => {
    const pool = ['b1', 'b2', 'b3'].map(item);
    const out = interleaveIdents(long(5, 60), { every: [1, 1], order: 'sequential' }, pool, seeded(0.5));
    expect(ids(out).filter((id) => id.startsWith('b'))).toEqual(['b1', 'b2', 'b3', 'b1']);
  });
});

describe('splitHead', () => {
  const list = ['a', 'b', 'c', 'd'].map(item);

  it('pins the first N by count', () => {
    const { head, rest } = splitHead(list, 1);
    expect(head).toEqual([{ id: 'a', item: list[0] }]);
    expect(ids(rest)).toEqual(['b', 'c', 'd']);
  });

  it('pins nothing for 0 and everything when N exceeds the list', () => {
    expect(splitHead(list, 0).head).toEqual([]);
    const all = splitHead(list, 10);
    expect(all.head).toHaveLength(4);
    expect(all.rest).toEqual([]);
  });

  it('pins named ids in listed order and reports ids not in the list', () => {
    const { head, rest } = splitHead(list, ['c', 'zz', 'a']);
    expect(head).toEqual([
      { id: 'c', item: list[2] },
      { id: 'zz', item: null },
      { id: 'a', item: list[0] },
    ]);
    expect(ids(rest)).toEqual(['b', 'd']);
  });

  it('tolerates a non-array', () => {
    expect(splitHead(null, 1)).toEqual({ head: [], rest: [] });
  });
});

describe('shuffleItems', () => {
  it('is an in-place permutation driven by the injected random', () => {
    const list = ['a', 'b', 'c', 'd'].map(item);
    const out = shuffleItems(list, seeded(0));
    expect(out).toBe(list);
    expect(ids(out).sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('interleaveIdents', () => {
  const songs = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'].map(item);

  it('places an ident after every N songs, never after the last', () => {
    const out = interleaveIdents(songs, [3, 3], [item('j')], seeded(0));
    expect(ids(out)).toEqual(['s1', 's2', 's3', 'j', 's4', 's5', 's6', 'j', 's7']);
  });

  it('does not end on an ident when songs divide evenly', () => {
    const out = interleaveIdents(songs.slice(0, 6), [3, 3], [item('j')], seeded(0));
    expect(ids(out)).toEqual(['s1', 's2', 's3', 'j', 's4', 's5', 's6']);
  });

  it('draws each gap from the range', () => {
    // random 0 → min (2); random 0.99 → max (4)
    const out = interleaveIdents(songs, [2, 4], [item('j')], seeded(0, 0.99));
    // gaps drawn: 2, then 4 → s1 s2 j s3 s4 s5 s6 j s7
    expect(ids(out)).toEqual(['s1', 's2', 'j', 's3', 's4', 's5', 's6', 'j', 's7']);
  });

  it('never plays the same ident twice in a row when the pool has more than one', () => {
    const many = Array.from({ length: 60 }, (_, i) => item(`s${i}`));
    const pool = [item('j1'), item('j2'), item('j3')];
    const out = interleaveIdents(many, [1, 1], pool, Math.random);
    const idents = out.filter((it) => it.id.startsWith('j')).map((it) => it.id);
    expect(idents.length).toBe(59);
    for (let i = 1; i < idents.length; i++) expect(idents[i]).not.toBe(idents[i - 1]);
    expect(new Set(idents)).toEqual(new Set(['j1', 'j2', 'j3']));
  });

  it('returns a copy of songs when there is no pool', () => {
    const out = interleaveIdents(songs, [3, 3], [], seeded(0));
    expect(out).toEqual(songs);
    expect(out).not.toBe(songs);
  });
});

describe('sequenceQueue', () => {
  const playlist = ['j1', 's1', 's2', 's3', 's4'].map(item);

  it('pins the head, orders only the rest, and interleaves resolved idents', async () => {
    const orderRest = vi.fn(async (rest) => [...rest].reverse());
    const resolveIds = vi.fn(async (wanted) => new Map(wanted.map((id) => [id, item(id)])));
    const { items, stats } = await sequenceQueue({
      items: playlist,
      sequence: { head: 1, idents: { every: [2, 2], pool: ['j2'] } },
      orderRest,
      resolveIds,
      random: seeded(0),
    });
    expect(ids(orderRest.mock.calls[0][0])).toEqual(['s1', 's2', 's3', 's4']);
    expect(ids(items)).toEqual(['j1', 's4', 's3', 'j2', 's2', 's1']);
    expect(stats).toEqual({ head: 1, songs: 4, idents: 1, unresolved: [] });
  });

  it('resolves head ids that are not in the playlist and reports unresolved ones', async () => {
    const resolveIds = vi.fn(async (wanted) => new Map(wanted.map((id) => [id, id === 'gone' ? null : item(id)])));
    const { items, stats } = await sequenceQueue({
      items: playlist,
      sequence: { head: ['intro', 'j1'], idents: { every: [2, 2], pool: ['gone'] } },
      orderRest: async (rest) => rest,
      resolveIds,
      random: seeded(0),
    });
    expect(resolveIds).toHaveBeenCalledWith(['intro', 'gone']);
    expect(ids(items)).toEqual(['intro', 'j1', 's1', 's2', 's3', 's4']);
    expect(stats.unresolved).toEqual(['gone']);
    expect(stats.idents).toBe(0);
  });

  it('plays a pool member the playlist also holds only as an ID, never as a song', async () => {
    const withJingles = ['j1', 's1', 'j2', 's2', 's3', 's4'].map(item);
    const orderRest = vi.fn(async (rest) => rest);
    const { items, stats } = await sequenceQueue({
      items: withJingles,
      sequence: { head: 1, idents: { every: [2, 2], pool: ['j1', 'j2'] } },
      orderRest,
      resolveIds: async (wanted) => new Map(wanted.map((id) => [id, item(id)])),
      random: seeded(0),
    });
    expect(ids(orderRest.mock.calls[0][0])).toEqual(['s1', 's2', 's3', 's4']);
    expect(stats.songs).toBe(4);
    expect(ids(items).filter((id) => id.startsWith('s'))).toEqual(['s1', 's2', 's3', 's4']);
  });

  it('keeps non-pool tracks among the songs when there are no idents', async () => {
    const orderRest = vi.fn(async (rest) => rest);
    await sequenceQueue({
      items: ['j1', 's1', 'j2'].map(item),
      sequence: { head: 1, idents: null },
      orderRest,
      resolveIds: vi.fn(),
      random: seeded(0),
    });
    expect(ids(orderRest.mock.calls[0][0])).toEqual(['s1', 'j2']);
  });

  it('expands a pool container into every item it holds (a commercial break between each song)', async () => {
    const breaks = ['c1', 'c2', 'c3'].map(item);
    const { items, stats } = await sequenceQueue({
      items: ['s1', 's2', 's3', 's4'].map(item),
      sequence: { head: 0, idents: { every: [1, 1], pool: ['show:ads'] } },
      orderRest: async (rest) => rest,
      // A container resolves to all of its playables, not only the first.
      resolveIds: async (wanted) => new Map(wanted.map((id) => [id, breaks])),
      random: seeded(0),
    });
    expect(ids(items).filter((id) => id.startsWith('s'))).toEqual(['s1', 's2', 's3', 's4']);
    const ads = ids(items).filter((id) => id.startsWith('c'));
    expect(ads).toHaveLength(3);
    expect(new Set(ads)).toEqual(new Set(['c1', 'c2', 'c3']));
    expect(ids(items).map((id) => id[0]).join('')).toBe('scscscs');
    expect(stats.idents).toBe(3);
  });

  it('takes a list-resolved head id as its first item only', async () => {
    const { items } = await sequenceQueue({
      items: ['s1'].map(item),
      sequence: { head: ['intro'], idents: null },
      orderRest: async (rest) => rest,
      resolveIds: async (wanted) => new Map(wanted.map((id) => [id, [item('i1'), item('i2')]])),
      random: seeded(0),
    });
    expect(ids(items)).toEqual(['i1', 's1']);
  });

  it('does not call resolveIds when nothing needs resolving', async () => {
    const resolveIds = vi.fn();
    const { items } = await sequenceQueue({
      items: playlist,
      sequence: { head: 1, idents: null },
      orderRest: async (rest) => rest,
      resolveIds,
      random: seeded(0),
    });
    expect(resolveIds).not.toHaveBeenCalled();
    expect(ids(items)).toEqual(['j1', 's1', 's2', 's3', 's4']);
  });
});
