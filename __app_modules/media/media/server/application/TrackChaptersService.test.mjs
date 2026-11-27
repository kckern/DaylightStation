import { describe, it, expect, vi } from 'vitest';
import { TrackChaptersService, CHAPTERS_MISS_TTL_MS } from './TrackChaptersService.mjs';

const quiet = { info() {}, debug() {}, warn() {} };
const track = { title: 'Consolations', album: 'Consolations', artist: 'David Whyte', durationMs: 120000,
  file: '/data/media/audio/audiobooks/David Whyte/2014 Consolations/c.mp3' };
const absChapters = [{ start: 0, end: 60, title: 'One' }, { start: 60, end: 120, title: 'Two' }];

function memCache() {
  const m = new Map();
  return { get: async (s, i) => m.get(`${s}/${i}`), set: async (s, i, value, at) => m.set(`${s}/${i}`, { value, at }), m };
}
function service({ plex = { track, chapters: null }, books, cache = memCache(), now = () => 1000 } = {}) {
  const adapter = { getTrackChapters: vi.fn(async () => plex) };
  const registry = { get: (s) => (s === 'plex' ? adapter : undefined) };
  return { svc: new TrackChaptersService({ registry, books, cache, logger: quiet, now }), adapter, cache };
}
const book = (over = {}) => ({ id: 'b1', path: '/audiobooks/Authors/David Whyte/2014 Consolations', durationMs: 120400, audioFiles: 1, ...over });

describe('TrackChaptersService', () => {
  it('uses the file\'s own chapters first', async () => {
    const books = { find: vi.fn(), chapters: vi.fn() };
    const { svc } = service({ plex: { track, chapters: [{ startMs: 0, endMs: 60000, title: 'a' }, { startMs: 60000, endMs: 120000, title: 'b' }] }, books });
    const out = await svc.chapters('plex', '1');
    expect(out).toMatchObject({ kind: 'ok', provider: 'plex' });
    expect(books.find).not.toHaveBeenCalled();
  });

  it('finds the same book in Audiobookshelf by folder, one file and length', async () => {
    const books = { find: vi.fn(async () => [book({ id: 'other', path: '/audiobooks/Someone/Else' }), book()]), chapters: vi.fn(async () => absChapters) };
    const { svc } = service({ books });
    const out = await svc.chapters('plex', '1');
    expect(out).toEqual({ kind: 'ok', provider: 'audiobookshelf', durationMs: 120000, chapters: [
      { startMs: 0, endMs: 60000, title: 'One' }, { startMs: 60000, endMs: 120000, title: 'Two' }] });
    expect(books.chapters).toHaveBeenCalledWith('b1');
  });

  it('gives none for a multi-file book, a length mismatch, or no folder match, and remembers the miss', async () => {
    for (const found of [[book({ audioFiles: 12 })], [book({ durationMs: 200000 })], [book({ path: '/x/y' })]]) {
      const books = { find: async () => found, chapters: vi.fn(async () => absChapters) };
      const { svc, cache } = service({ books });
      expect(await svc.chapters('plex', '1')).toEqual({ kind: 'none' });
      expect(books.chapters).not.toHaveBeenCalled();
      expect(cache.m.get('plex/1')).toEqual({ value: null, at: 1000 });
    }
  });

  it('does not cache a failed lookup, so the next play asks again', async () => {
    const books = { find: async () => { throw Object.assign(new Error('down'), { status: 503 }); }, chapters: vi.fn() };
    const { svc, cache } = service({ books });
    expect(await svc.chapters('plex', '1')).toEqual({ kind: 'none' });
    expect(cache.m.size).toBe(0);
  });

  it('answers from the cache until it expires', async () => {
    const cache = memCache();
    await cache.set('plex', '1', null, 0);
    const books = { find: vi.fn(async () => [book()]), chapters: async () => absChapters };
    let now = 10;
    const { svc } = service({ books, cache, now: () => now });
    expect(await svc.chapters('plex', '1')).toEqual({ kind: 'none' });
    expect(books.find).not.toHaveBeenCalled();
    now = CHAPTERS_MISS_TTL_MS + 1;
    expect((await svc.chapters('plex', '1')).kind).toBe('ok');
  });

  it('404s an unknown item and answers none for a source without chapters', async () => {
    const { svc } = service({ plex: null });
    expect(await svc.chapters('plex', '9')).toEqual({ kind: 'not_found' });
    expect(await svc.chapters('files', 'a.mp3')).toEqual({ kind: 'none' });
  });
});
