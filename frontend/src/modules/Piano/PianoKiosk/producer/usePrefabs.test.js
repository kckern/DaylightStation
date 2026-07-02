/**
 * usePrefabs — read-only prefab loader tests (Task 9.1). The only seam is
 * `fetch` (the local-stream route serving YAML), mocked here; every assertion
 * is about listing shape, lazy payload caching, read-onlyness, and error paths.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePrefabs } from './usePrefabs.js';

const MANIFEST = `
stacks:
  - { id: pop, title: Pop, author: curated, kind: stack, layerCount: 2 }
songs:
  - { id: sunset, title: Sunset, author: curated, kind: song, sectionCount: 2 }
`;
const STACK_YAML = `
id: pop
title: Pop
kind: stack
layers:
  - { slug: c-g-am-f, path: chords/c-g-am-f.mid, role: chords, gain: 1 }
`;

/** Route the mocked fetch by URL to the right YAML text (or a 404). */
function mockFetch(map) {
  return vi.fn((url) => {
    const hit = Object.entries(map).find(([frag]) => url.includes(frag));
    if (!hit) return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') });
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(hit[1]) });
  });
}

async function mount() {
  const hook = renderHook(() => usePrefabs());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

beforeEach(() => { vi.restoreAllMocks(); });

describe('listing fetch on mount', () => {
  it('fetches the manifest and exposes stacks + songs', async () => {
    global.fetch = mockFetch({ 'prefabs/index.yml': MANIFEST });
    const { result } = await mount();
    expect(result.current.error).toBeNull();
    expect(result.current.stacks).toEqual([{ id: 'pop', title: 'Pop', author: 'curated', kind: 'stack', layerCount: 2 }]);
    expect(result.current.songs).toEqual([{ id: 'sunset', title: 'Sunset', author: 'curated', kind: 'song', sectionCount: 2 }]);
  });

  it('hits the manifest at the local-stream prefabs path', async () => {
    const f = mockFetch({ 'prefabs/index.yml': MANIFEST });
    global.fetch = f;
    await mount();
    expect(f).toHaveBeenCalledWith('/api/v1/local/stream/midi/prefabs/index.yml');
  });
});

describe('getFull (lazy payload + cache)', () => {
  it('fetches a payload on demand and caches it (one network call)', async () => {
    const f = mockFetch({ 'prefabs/index.yml': MANIFEST, 'stacks/pop.yml': STACK_YAML });
    global.fetch = f;
    const { result } = await mount();
    const callsAfterMount = f.mock.calls.length;

    let payload;
    await act(async () => { payload = await result.current.getFull('stacks', 'pop'); });
    expect(payload.id).toBe('pop');
    expect(payload.layers).toHaveLength(1);
    expect(f).toHaveBeenCalledWith('/api/v1/local/stream/midi/prefabs/stacks/pop.yml');
    const afterFirst = f.mock.calls.length;

    // second call served from cache — no new fetch
    await act(async () => { await result.current.getFull('stacks', 'pop'); });
    expect(f.mock.calls.length).toBe(afterFirst);
    expect(afterFirst).toBe(callsAfterMount + 1);
  });
});

describe('read-only surface', () => {
  it('exposes no write methods (save/remove/rename/create)', async () => {
    global.fetch = mockFetch({ 'prefabs/index.yml': MANIFEST });
    const { result } = await mount();
    for (const verb of ['save', 'saveSong', 'saveCrateItem', 'remove', 'rename', 'create', 'delete']) {
      expect(result.current[verb]).toBeUndefined();
    }
  });
});

describe('error handling', () => {
  it('sets error when the manifest fetch fails', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('') }));
    const { result } = await mount();
    expect(result.current.error).toMatch(/500/);
    expect(result.current.stacks).toEqual([]);
    expect(result.current.songs).toEqual([]);
  });

  it('rejects getFull for a missing payload', async () => {
    global.fetch = mockFetch({ 'prefabs/index.yml': MANIFEST }); // no stack file → 404
    const { result } = await mount();
    await expect(result.current.getFull('stacks', 'ghost')).rejects.toThrow(/404/);
  });
});
