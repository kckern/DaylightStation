// Container expansion — spec: a container queue input (album/show/playlist)
// expands into its ordered playable children via GET /api/v1/list/<source>/
// <localId>; nested containers recurse ONE more level; a hard cap bounds the
// batch; every failure mode returns null so callers keep single-item behavior.
import { describe, it, expect, vi } from 'vitest';
import {
  isContainerInput,
  expandContainerInput,
  EXPANSION_LIMIT,
} from './containerExpansion.js';

const ok = (body) => ({ ok: true, json: async () => body });
const notOk = () => ({ ok: false, json: async () => ({}) });

// Mirrors the live list-router child shape (probed 2026-07-14 on
// /api/v1/list/plex/556868): leaves carry itemType:'leaf', type:'track',
// play:{contentId}, duration; containers carry itemType:'container'.
function track(n) {
  return {
    id: `plex:${n}`, title: `Track ${n}`, itemType: 'leaf', type: 'track',
    play: { contentId: `plex:${n}` }, duration: 100 + n,
    thumbnail: `/thumb/${n}`,
  };
}

describe('isContainerInput', () => {
  it('detects explicit itemType container', () => {
    expect(isContainerInput({ contentId: 'plex:1', itemType: 'container' })).toBe(true);
  });
  it('explicit leaf wins over container-ish metadata', () => {
    expect(isContainerInput({ contentId: 'plex:1', itemType: 'leaf', type: 'album', childCount: 12 })).toBe(false);
  });
  it('detects container metadata types', () => {
    for (const type of ['show', 'season', 'album', 'artist', 'collection', 'playlist']) {
      expect(isContainerInput({ contentId: 'plex:1', type })).toBe(true);
    }
    expect(isContainerInput({ contentId: 'plex:1', metadata: { type: 'album' } })).toBe(true);
  });
  it('detects childCount > 0', () => {
    expect(isContainerInput({ contentId: 'plex:1', childCount: 14 })).toBe(true);
    expect(isContainerInput({ contentId: 'plex:1', childCount: 0 })).toBe(false);
  });
  it('plain leaves and junk are not containers', () => {
    expect(isContainerInput({ contentId: 'plex:1', type: 'track' })).toBe(false);
    expect(isContainerInput({ contentId: 'plex:1' })).toBe(false);
    expect(isContainerInput(null)).toBe(false);
    expect(isContainerInput('plex:1')).toBe(false);
  });
});

describe('expandContainerInput', () => {
  it('maps an album to ordered queue inputs, preserving the container title', async () => {
    const fetchImpl = vi.fn(async () => ok({ items: [track(1), track(2), track(3)] }));
    const out = await expandContainerInput(
      { contentId: 'plex:900', title: 'Beatles For Sale', itemType: 'container' },
      { fetchImpl },
    );
    expect(fetchImpl).toHaveBeenCalledWith('/api/v1/list/plex/900');
    expect(out.map((i) => i.contentId)).toEqual(['plex:1', 'plex:2', 'plex:3']);
    expect(out[0]).toEqual({
      contentId: 'plex:1', title: 'Track 1', thumbnail: '/thumb/1',
      duration: 101, format: 'audio', containerTitle: 'Beatles For Sale',
    });
  });

  it('recurses ONE level into nested containers (show → seasons → episodes)', async () => {
    const episode = (n) => ({
      id: `plex:e${n}`, title: `Ep ${n}`, itemType: 'leaf', type: 'episode',
      play: { contentId: `plex:e${n}` }, duration: 600,
    });
    const bodies = {
      '/api/v1/list/plex/show': { items: [
        { id: 'plex:s1', title: 'Season 1', itemType: 'container', type: 'season' },
        { id: 'plex:s2', title: 'Season 2', itemType: 'container', type: 'season' },
      ] },
      '/api/v1/list/plex/s1': { items: [episode(1), episode(2)] },
      '/api/v1/list/plex/s2': { items: [episode(3)] },
    };
    const fetchImpl = vi.fn(async (url) => ok(bodies[url]));
    const out = await expandContainerInput(
      { contentId: 'plex:show', title: 'The Show', itemType: 'container' },
      { fetchImpl },
    );
    expect(out.map((i) => i.contentId)).toEqual(['plex:e1', 'plex:e2', 'plex:e3']);
    expect(out.every((i) => i.containerTitle === 'The Show')).toBe(true);
    expect(out[0].format).toBe('video');
  });

  it('stops recursing past the depth budget (containers of containers of containers)', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url === '/api/v1/list/plex/root') {
        return ok({ items: [{ id: 'plex:mid', title: 'Mid', itemType: 'container' }, track(9)] });
      }
      // depth-1 fetch returns ANOTHER container — must not be fetched again
      return ok({ items: [{ id: 'plex:deep', title: 'Deep', itemType: 'container' }] });
    });
    const out = await expandContainerInput(
      { contentId: 'plex:root', title: 'Root', itemType: 'container' },
      { fetchImpl },
    );
    expect(out.map((i) => i.contentId)).toEqual(['plex:9']); // deep container skipped
    expect(fetchImpl).toHaveBeenCalledTimes(2); // root + mid only, never deep
  });

  it('enforces the hard cap on expanded items', async () => {
    const many = Array.from({ length: EXPANSION_LIMIT + 100 }, (_, i) => track(i));
    const fetchImpl = vi.fn(async () => ok({ items: many }));
    const out = await expandContainerInput(
      { contentId: 'plex:big', title: 'Big', itemType: 'container' },
      { fetchImpl },
    );
    expect(out).toHaveLength(EXPANSION_LIMIT);
    expect(out[0].contentId).toBe('plex:0'); // order preserved from the front
  });

  it('honors a custom limit across nested containers', async () => {
    const bodies = {
      '/api/v1/list/plex/show': { items: [
        { id: 'plex:s1', itemType: 'container', title: 'S1' },
        { id: 'plex:s2', itemType: 'container', title: 'S2' },
      ] },
      '/api/v1/list/plex/s1': { items: [track(1), track(2), track(3)] },
      '/api/v1/list/plex/s2': { items: [track(4)] },
    };
    const fetchImpl = vi.fn(async (url) => ok(bodies[url]));
    const out = await expandContainerInput(
      { contentId: 'plex:show', title: 'Show', itemType: 'container' },
      { fetchImpl, limit: 2 },
    );
    expect(out.map((i) => i.contentId)).toEqual(['plex:1', 'plex:2']);
  });

  it('returns null on fetch failure, non-ok response, zero children, bad ids', async () => {
    const boom = vi.fn(async () => { throw new Error('network'); });
    expect(await expandContainerInput({ contentId: 'plex:1', title: 'X' }, { fetchImpl: boom })).toBeNull();

    const bad = vi.fn(async () => notOk());
    expect(await expandContainerInput({ contentId: 'plex:1', title: 'X' }, { fetchImpl: bad })).toBeNull();

    const empty = vi.fn(async () => ok({ items: [] }));
    expect(await expandContainerInput({ contentId: 'plex:1', title: 'X' }, { fetchImpl: empty })).toBeNull();

    const noItems = vi.fn(async () => ok({}));
    expect(await expandContainerInput({ contentId: 'plex:1', title: 'X' }, { fetchImpl: noItems })).toBeNull();

    const never = vi.fn();
    // contentId without a source prefix cannot address the list router
    expect(await expandContainerInput({ contentId: 'justanid', title: 'X' }, { fetchImpl: never })).toBeNull();
    expect(never).not.toHaveBeenCalled();
  });

  it('a failed nested branch is skipped, not fatal', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url === '/api/v1/list/plex/show') {
        return ok({ items: [
          { id: 'plex:s1', itemType: 'container', title: 'S1' },
          track(7),
        ] });
      }
      throw new Error('season fetch died');
    });
    const out = await expandContainerInput(
      { contentId: 'plex:show', title: 'Show', itemType: 'container' },
      { fetchImpl },
    );
    expect(out.map((i) => i.contentId)).toEqual(['plex:7']);
  });
});
