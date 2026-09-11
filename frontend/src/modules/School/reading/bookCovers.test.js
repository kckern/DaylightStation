import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bookCover, __resetBookCovers } from './bookCovers.js';

const ok = (body) => ({ ok: true, json: async () => body });

beforeEach(() => __resetBookCovers());

describe('bookCover', () => {
  it('reads the cover off the same /info endpoint the pick uses', async () => {
    const fetchImpl = vi.fn(async () => ok({ image: '/art/corduroy.jpg' }));
    expect(await bookCover('plex:1', fetchImpl)).toBe('/art/corduroy.jpg');
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/v1/info/plex%3A1');
  });

  it('falls back through thumbnail and imageUrl', async () => {
    expect(await bookCover('a', async () => ok({ thumbnail: '/t.jpg' }))).toBe('/t.jpg');
    expect(await bookCover('b', async () => ok({ imageUrl: '/u.jpg' }))).toBe('/u.jpg');
  });

  it('asks once per book, however many cards show it', async () => {
    const fetchImpl = vi.fn(async () => ok({ image: '/c.jpg' }));
    await bookCover('plex:1', fetchImpl);
    await bookCover('plex:1', fetchImpl);
    await bookCover('plex:1', fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('shares one request between concurrent callers', async () => {
    const fetchImpl = vi.fn(async () => ok({ image: '/c.jpg' }));
    const [a, b] = await Promise.all([bookCover('x', fetchImpl), bookCover('x', fetchImpl)]);
    expect(a).toBe('/c.jpg');
    expect(b).toBe('/c.jpg');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('runs lookups one at a time — Plex serializes them anyway', async () => {
    let live = 0;
    let peak = 0;
    const fetchImpl = vi.fn(async () => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 5));
      live -= 1;
      return ok({ image: '/c.jpg' });
    });
    await Promise.all(['a', 'b', 'c', 'd'].map((id) => bookCover(id, fetchImpl)));
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(peak).toBe(1);
  });

  it('caches a miss so a coverless book is not retried on every render', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false }));
    expect(await bookCover('nope', fetchImpl)).toBe(null);
    expect(await bookCover('nope', fetchImpl)).toBe(null);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('a throwing lookup yields null and does not stall the ones behind it', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes('bad')) throw new Error('network gone');
      return ok({ image: '/good.jpg' });
    });
    const [bad, good] = await Promise.all([bookCover('bad', fetchImpl), bookCover('good', fetchImpl)]);
    expect(bad).toBe(null);
    expect(good).toBe('/good.jpg');
  });

  it('asks Plex for the shelf-sized image rather than the original poster', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true, json: async () => ({ image: '/api/v1/proxy/plex/library/metadata/620705/thumb/1779295360' }),
    }));
    const url = await bookCover('plex:620707', fetchImpl);
    expect(url).toContain('/photo/:/transcode');
    expect(url).toContain('width=');
  });

  it('leaves a non-Plex cover exactly as it arrived', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ image: '/img/local-cover.jpg' }) }));
    expect(await bookCover('plex:620999', fetchImpl)).toBe('/img/local-cover.jpg');
  });

  it('answers null for no id without asking anything', async () => {
    const fetchImpl = vi.fn();
    expect(await bookCover(null, fetchImpl)).toBe(null);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
