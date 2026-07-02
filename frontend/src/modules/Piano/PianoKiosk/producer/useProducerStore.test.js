/**
 * useProducerStore — API client + cache tests (Task 8.2).
 *
 * fetch is exercised through a mocked DaylightAPI (the only network seam), so
 * every assertion is about request SHAPE and cache behavior — not transport.
 * usePianoUser is mocked to control the author tag.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ── mocks ────────────────────────────────────────────────────────────────────
const api = vi.fn();
vi.mock('../../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => api(...a) }));

let currentUser = 'kc';
vi.mock('../PianoUserContext.jsx', () => ({ usePianoUser: () => ({ currentUser }) }));

import { useProducerStore, FALLBACK_AUTHOR } from './useProducerStore.js';

/** Default: the three list GETs resolve empty; tests override per call. */
function mockLists({ loops = [], crate = [], songs = [] } = {}) {
  api.mockImplementation((path, _data, method = 'GET') => {
    if (method === 'GET' || method === undefined) {
      if (path.endsWith('/producer/loops')) return Promise.resolve({ items: loops });
      if (path.endsWith('/producer/crate')) return Promise.resolve({ items: crate });
      if (path.endsWith('/producer/songs')) return Promise.resolve({ items: songs });
    }
    return Promise.resolve({});
  });
}

/** renderHook + wait for the mount lists to settle (loading → false). */
async function mountStore() {
  const hook = renderHook(() => useProducerStore());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

beforeEach(() => {
  api.mockReset();
  currentUser = 'kc';
});

// ── list fetch + cache ────────────────────────────────────────────────────────
describe('list fetch on mount', () => {
  it('fetches all three families and exposes them', async () => {
    mockLists({
      loops: [{ id: 'l1', kind: 'groove' }],
      crate: [{ id: 'c1', kind: 'stack' }],
      songs: [{ id: 's1', sectionCount: 2 }],
    });
    const { result } = await mountStore();
    expect(result.current.loops).toEqual([{ id: 'l1', kind: 'groove' }]);
    expect(result.current.crate).toEqual([{ id: 'c1', kind: 'stack' }]);
    expect(result.current.songs).toEqual([{ id: 's1', sectionCount: 2 }]);
    // Three GETs, one per family.
    const gets = api.mock.calls.filter(([p]) => p.startsWith('api/v1/piano/producer/'));
    expect(gets).toHaveLength(3);
  });

  it('sets error state on a failed list fetch without crashing', async () => {
    api.mockRejectedValue(new Error('HTTP 500'));
    const { result } = await mountStore();
    expect(result.current.error).toMatch(/500/);
    expect(result.current.loops).toEqual([]);
  });

  it('refresh() re-fetches the lists', async () => {
    mockLists({ songs: [{ id: 's1' }] });
    const { result } = await mountStore();
    mockLists({ songs: [{ id: 's1' }, { id: 's2' }] });
    await act(async () => { await result.current.refresh(); });
    expect(result.current.songs).toHaveLength(2);
  });
});

// ── author from context ───────────────────────────────────────────────────────
describe('author tagging', () => {
  it('tags saves with the current player', async () => {
    mockLists();
    const { result } = await mountStore();
    api.mockResolvedValueOnce({ id: 'l9', kind: 'idea', author: 'kc' }); // POST loop
    await act(async () => {
      await result.current.saveLoop({ notes: [{ ticks: 0, durationTicks: 1, midi: 60 }], ppq: 480, lengthBars: 2, kind: 'idea' });
    });
    const post = api.mock.calls.find(([, , m]) => m === 'POST');
    expect(post[2]).toBe('POST');
    expect(post[1].author).toBe('kc');
  });

  it('falls back to the household author when no player is selected', async () => {
    currentUser = null;
    mockLists();
    const { result } = await mountStore();
    api.mockResolvedValueOnce({ id: 'l9', kind: 'idea' });
    await act(async () => {
      await result.current.saveLoop({ notes: [{ ticks: 0, durationTicks: 1, midi: 60 }], ppq: 480, lengthBars: 2, kind: 'idea' });
    });
    const post = api.mock.calls.find(([, , m]) => m === 'POST');
    expect(post[1].author).toBe(FALLBACK_AUTHOR);
  });
});

// ── saveSong crystallize ──────────────────────────────────────────────────────
describe('saveSong crystallize', () => {
  const libraryLayer = (id) => ({
    id, role: 'chords', channel: 0, gmProgram: 0, gain: 1, muted: false, soloed: false, carried: false,
    source: { kind: 'library', entry: { path: id, slug: id, barSpan: 4 } },
  });
  const takeLayer = (takeId) => ({
    id: takeId, role: 'bass', channel: 1, gmProgram: 33, gain: 1, muted: false, soloed: false, carried: false,
    source: { kind: 'take', takeId, notes: [{ ticks: 0, durationTicks: 480, midi: 40 }], ppq: 480, lengthBars: 2, drumMode: false },
  });
  const draftWith = (stack, extra = {}) => ({
    sections: [{ id: 'sec-1', name: 'A', lengthBars: 4, stack }],
    arrangement: [{ sectionId: 'sec-1', repeats: 1 }],
    carriedLayers: {},
    meta: { title: null, author: 'kc', keyShift: 2, bpm: 96 },
    ...extra,
  });

  it('POSTs the structural payload verbatim (library-only draft)', async () => {
    mockLists();
    const { result } = await mountStore();
    api.mockResolvedValueOnce({ id: 'song1', author: 'kc' }); // POST song
    const draft = draftWith([libraryLayer('loops/a.mid')]);
    await act(async () => { await result.current.saveSong(draft, { title: 'Tune' }); });
    const post = api.mock.calls.find(([p, , m]) => m === 'POST' && p.endsWith('/producer/songs'));
    expect(post[1].sections).toEqual(draft.sections);
    expect(post[1].arrangement).toEqual(draft.arrangement);
    expect(post[1].carriedLayers).toEqual({});
    expect(post[1].meta.keyShift).toBe(2);
    expect(post[1].meta.bpm).toBe(96);
    expect(post[1].meta.title).toBe('Tune'); // title merged into meta
    expect(post[1].title).toBe('Tune'); // and surfaced top-level for the light listing
  });

  it('round-trips carriedLayers into the payload', async () => {
    mockLists();
    const { result } = await mountStore();
    api.mockResolvedValueOnce({ id: 'song1' });
    const carried = libraryLayer('grooves/rock.mid');
    const draft = draftWith(
      [{ carriedRef: 'grooves/rock.mid' }, libraryLayer('loops/a.mid')],
      { carriedLayers: { 'grooves/rock.mid': carried } },
    );
    await act(async () => { await result.current.saveSong(draft); });
    const post = api.mock.calls.find(([p, , m]) => m === 'POST' && p.endsWith('/producer/songs'));
    expect(post[1].carriedLayers['grooves/rock.mid']).toEqual(carried);
    // The carriedRef placeholder survives in the stack unchanged.
    expect(post[1].sections[0].stack[0]).toEqual({ carriedRef: 'grooves/rock.mid' });
  });

  it('auto-persists embedded takes as loops then rewrites to loop refs', async () => {
    mockLists();
    const { result } = await mountStore();
    // First POST = the loop, second = the song.
    api.mockResolvedValueOnce({ id: 'loop-xyz', kind: 'bass' });
    api.mockResolvedValueOnce({ id: 'song1' });
    const draft = draftWith([takeLayer('take-1')]);
    await act(async () => { await result.current.saveSong(draft); });

    const posts = api.mock.calls.filter(([, , m]) => m === 'POST');
    expect(posts).toHaveLength(2);
    const [loopPost, songPost] = posts;
    // Loop POST carries the take's notes.
    expect(loopPost[0]).toMatch(/\/producer\/loops$/);
    expect(loopPost[1].notes).toEqual([{ ticks: 0, durationTicks: 480, midi: 40 }]);
    expect(loopPost[1].kind).toBe('bass');
    // Song POST references the freshly minted loop, NOT the embedded notes.
    expect(songPost[0]).toMatch(/\/producer\/songs$/);
    const savedLayer = songPost[1].sections[0].stack[0];
    expect(savedLayer.source).toEqual({ kind: 'loop', loopId: 'loop-xyz' });
    expect(savedLayer.source.notes).toBeUndefined();
  });

  it('dedupes a take shared across sections into one loop', async () => {
    mockLists();
    const { result } = await mountStore();
    api.mockResolvedValueOnce({ id: 'loop-1', kind: 'bass' }); // one loop only
    api.mockResolvedValueOnce({ id: 'song1' });
    const draft = {
      sections: [
        { id: 'sec-1', name: 'A', lengthBars: 4, stack: [takeLayer('take-1')] },
        { id: 'sec-2', name: 'B', lengthBars: 4, stack: [takeLayer('take-1')] },
      ],
      arrangement: [{ sectionId: 'sec-1', repeats: 1 }, { sectionId: 'sec-2', repeats: 1 }],
      carriedLayers: {},
      meta: { keyShift: 0, bpm: 100 },
    };
    await act(async () => { await result.current.saveSong(draft); });
    const loopPosts = api.mock.calls.filter(([p, , m]) => m === 'POST' && p.endsWith('/producer/loops'));
    expect(loopPosts).toHaveLength(1); // deduped
    const songPost = api.mock.calls.find(([p, , m]) => m === 'POST' && p.endsWith('/producer/songs'));
    expect(songPost[1].sections[0].stack[0].source).toEqual({ kind: 'loop', loopId: 'loop-1' });
    expect(songPost[1].sections[1].stack[0].source).toEqual({ kind: 'loop', loopId: 'loop-1' });
  });
});

// ── loadSong resolves refs ────────────────────────────────────────────────────
describe('loadSong', () => {
  it('resolves loop refs back into embedded-note take sources for HYDRATE', async () => {
    mockLists();
    const { result } = await mountStore();
    const songRec = {
      id: 'song1',
      sections: [{
        id: 'sec-1', name: 'A', lengthBars: 4,
        stack: [{ id: 'take-1', role: 'bass', channel: 1, gain: 1, source: { kind: 'loop', loopId: 'loop-1' } }],
      }],
      arrangement: [{ sectionId: 'sec-1', repeats: 2 }],
      carriedLayers: {},
      meta: { title: 'Tune', keyShift: 3, bpm: 90 },
    };
    const loopRec = {
      id: 'loop-1', kind: 'bass', ppq: 480, lengthBars: 2, drumMode: false,
      notes: [{ ticks: 0, durationTicks: 480, midi: 40 }],
    };
    api.mockImplementation((path) => {
      if (path.endsWith('/producer/songs/song1')) return Promise.resolve(songRec);
      if (path.endsWith('/producer/loops/loop-1')) return Promise.resolve(loopRec);
      return Promise.resolve({});
    });
    let loaded;
    await act(async () => { loaded = await result.current.loadSong('song1'); });
    const layer = loaded.draft.sections[0].stack[0];
    expect(layer.source.kind).toBe('take');
    expect(layer.source.takeId).toBe('loop-1');
    expect(layer.source.notes).toEqual([{ ticks: 0, durationTicks: 480, midi: 40 }]);
    expect(loaded.draft.arrangement).toEqual([{ sectionId: 'sec-1', repeats: 2 }]);
    expect(loaded.draft.meta.bpm).toBe(90);
    expect(loaded.draft.meta.keyShift).toBe(3);
  });

  it('leaves a ref intact (no crash) when the referenced loop is gone', async () => {
    mockLists();
    const { result } = await mountStore();
    api.mockImplementation((path) => {
      if (path.endsWith('/producer/songs/song1')) {
        return Promise.resolve({
          id: 'song1',
          sections: [{ id: 'sec-1', name: 'A', lengthBars: 4, stack: [{ id: 'x', source: { kind: 'loop', loopId: 'gone' } }] }],
          arrangement: [], carriedLayers: {}, meta: {},
        });
      }
      if (path.endsWith('/producer/loops/gone')) return Promise.reject(new Error('HTTP 404'));
      return Promise.resolve({});
    });
    let loaded;
    await act(async () => { loaded = await result.current.loadSong('song1'); });
    expect(loaded.draft.sections[0].stack[0].source).toEqual({ kind: 'loop', loopId: 'gone' });
  });
});

// ── save→load round trip through HYDRATE (take path) ─────────────────────────
describe('saveSong → loadSong round trip', () => {
  it('a recorded-take draft survives persist + reload with notes restored', async () => {
    mockLists();
    const { result } = await mountStore();
    const takeLayer = {
      id: 'take-1', role: 'bass', channel: 1, gmProgram: 33, gain: 0.8, muted: false, soloed: false, carried: false,
      source: { kind: 'take', takeId: 'take-1', notes: [{ ticks: 0, durationTicks: 480, midi: 40 }], ppq: 480, lengthBars: 2, drumMode: false },
    };
    const draft = {
      sections: [{ id: 'sec-1', name: 'A', lengthBars: 4, stack: [takeLayer] }],
      arrangement: [{ sectionId: 'sec-1', repeats: 1 }],
      carriedLayers: {},
      meta: { title: null, author: 'kc', keyShift: 0, bpm: 100 },
    };

    // Capture what saveSong sends, then serve it back as the stored records.
    let savedSong; let savedLoop;
    api.mockImplementation((path, data, method) => {
      if (method === 'POST' && path.endsWith('/producer/loops')) {
        savedLoop = { id: 'loop-1', ...data }; return Promise.resolve(savedLoop);
      }
      if (method === 'POST' && path.endsWith('/producer/songs')) {
        savedSong = { id: 'song1', ...data }; return Promise.resolve(savedSong);
      }
      if (path.endsWith('/producer/songs/song1')) return Promise.resolve(savedSong);
      if (path.endsWith('/producer/loops/loop-1')) return Promise.resolve(savedLoop);
      return Promise.resolve({});
    });

    await act(async () => { await result.current.saveSong(draft); });
    let loaded;
    await act(async () => { loaded = await result.current.loadSong('song1'); });
    const restored = loaded.draft.sections[0].stack[0];
    expect(restored.source.notes).toEqual(takeLayer.source.notes);
    expect(restored.gain).toBe(0.8);
    expect(loaded.draft.meta.bpm).toBe(100);
  });
});

// ── remove / rename ───────────────────────────────────────────────────────────
describe('remove and rename', () => {
  it('remove() DELETEs and drops the item from the list', async () => {
    mockLists({ songs: [{ id: 's1' }, { id: 's2' }] });
    const { result } = await mountStore();
    api.mockResolvedValueOnce({ ok: true, id: 's1' });
    await act(async () => { await result.current.remove('songs', 's1'); });
    const del = api.mock.calls.find(([, , m]) => m === 'DELETE');
    expect(del[0]).toMatch(/\/producer\/songs\/s1$/);
    expect(result.current.songs).toEqual([{ id: 's2' }]);
  });

  it('rename() PATCHes the title and updates the list entry', async () => {
    mockLists({ songs: [{ id: 's1', title: 'Old' }] });
    const { result } = await mountStore();
    api.mockResolvedValueOnce({ id: 's1', title: 'New', favorite: false });
    await act(async () => { await result.current.rename('songs', 's1', 'New'); });
    const patch = api.mock.calls.find(([, , m]) => m === 'PATCH');
    expect(patch[1]).toEqual({ title: 'New' });
    expect(result.current.songs[0].title).toBe('New');
  });
});
