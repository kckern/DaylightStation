// An ordered work (a book, a talk series, a course heard as audio) is answered in
// its own order with `startIndex`; a show and a music list keep the watch-aware
// order (unwatched first, then watched by recency). See
// __docs/reference/media/queue.md and content-catalog domain/utils/orderedWork.mjs.
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ContentAccessService } from '../../../content-catalog/server/application/ContentAccessService.mjs';
import { PlayableItem } from '../../../content-catalog/server/items.mjs';
import { MediaProgress } from '../../../content-catalog/server/domain/entities/MediaProgress.mjs';
import { libraryKindMap, libraryKindOf, isOrderedWork } from '../../../content-catalog/server/queue-policy.mjs';
import { QueueService } from '../application/services/QueueService.mjs';
import { QueuePresentationService } from '../application/QueuePresentationService.mjs';
import { createQueueRouter } from './queue.mjs';

const LIBRARY_KINDS = { Audiobooks: 'books', Education: 'talks', 7: 'talks' };

const part = (n, library, { mediaType = 'audio', duration = 1800 } = {}) => new PlayableItem({
  id: `plex:${n}`, localId: String(n), source: 'plex', title: `Part ${n}`,
  mediaType, mediaUrl: `/api/v1/proxy/plex/stream/${n}`, duration, resumable: mediaType !== 'audio' || library !== 'Music',
  metadata: library == null ? {} : { librarySectionTitle: library, librarySectionID: library === 'Music' ? 3 : 9 },
});

const progress = (n, { playhead = 0, duration = 1800, playCount = 0, lastPlayed = null } = {}) => new MediaProgress({
  contentId: `plex:${n}`, playhead, duration, playCount, lastPlayed,
});

function makeApp({ items, progressRows = [], libraryKinds = LIBRARY_KINDS }) {
  const mediaProgressMemory = {
    listSourceProgress: async () => progressRows,
    listProgress: async () => [],
  };
  const queueService = new QueueService({ mediaProgressMemory, random: () => 0, libraryKinds: () => libraryKinds });
  const contentAccessService = new ContentAccessService({
    contentIdResolver: { resolve: (id) => ({ source: 'plex', localId: id.replace(/^plex:/, '') }) },
    contentCatalog: { getItem: async () => null, resolvePlayables: async () => [...items] },
    queueService,
  });
  const app = express();
  app.use('/api/v1/queue', createQueueRouter({
    contentExpression: { fromQuery: (query) => ({ options: { ...query } }) },
    contentAccessService,
    queuePresentationService: new QueuePresentationService(),
    logger: {},
  }));
  return { app: request(app), queueService };
}

const ids = (body) => body.items.map((item) => item.contentId);

describe('orderedWork', () => {
  it('reads library kinds by title or section id, case-insensitively, ignoring unknown kinds', () => {
    const kinds = libraryKindMap({ Audiobooks: 'Books', 7: 'talks', Junk: 'films' });
    expect(Object.fromEntries(kinds)).toEqual({ audiobooks: 'books', 7: 'talks' });
    expect(libraryKindOf({ metadata: { librarySectionTitle: 'AUDIOBOOKS' } }, kinds)).toBe('books');
    expect(libraryKindOf({ metadata: { librarySectionID: 7, librarySectionTitle: 'Lectures' } }, kinds)).toBe('talks');
    expect(libraryKindOf({ metadata: { librarySectionTitle: 'Music' } }, kinds)).toBe('music');
    expect(libraryKindOf({ metadata: {} }, kinds)).toBe(null);
    expect(libraryKindMap(null).size).toBe(0);
  });

  it('a list mixing a book with songs is not an ordered work', () => {
    const kinds = libraryKindMap(LIBRARY_KINDS);
    expect(isOrderedWork([part(1, 'Audiobooks'), part(2, 'Audiobooks')], kinds)).toBe(true);
    expect(isOrderedWork([part(1, 'Audiobooks'), part(2, 'Music')], kinds)).toBe(false);
    expect(isOrderedWork([part(1, null)], kinds)).toBe(false);
    expect(isOrderedWork([part(1, 'Audiobooks')], new Map())).toBe(false);
  });
});

describe('GET /api/v1/queue for an ordered work', () => {
  const book = [1, 2, 3, 4, 5].map((n) => part(n, 'Audiobooks'));

  it('keeps the book order and starts at the part in progress, at its place', async () => {
    // Henry VI Part 3 as it was on 2026-11-26: part 2 finished, part 1 re-heard to its middle
    // after that. The old answer was [p3, p4, p5, p1, p2].
    const { app } = makeApp({
      items: book,
      progressRows: [
        progress(2, { playhead: 1800, playCount: 1, lastPlayed: '2026-11-20 08:00:00' }),
        progress(1, { playhead: 948, playCount: 1, lastPlayed: '2026-11-21 08:00:00' }),
      ],
    });
    const { body } = await app.get('/api/v1/queue/plex/727787').expect(200);
    expect(ids(body)).toEqual(['plex:1', 'plex:2', 'plex:3', 'plex:4', 'plex:5']);
    expect(body.startIndex).toBe(0);
    expect(body.items[0].resumePosition).toBe(948);
  });

  it('starts at the part after the one heard to its end', async () => {
    const { app } = makeApp({
      items: book,
      progressRows: [
        progress(1, { playhead: 1800, playCount: 1, lastPlayed: '2026-11-19T08:00:00Z' }),
        progress(2, { playhead: 1799, playCount: 1, lastPlayed: '2026-11-20T08:00:00Z' }),
        progress(3, { playhead: 600, lastPlayed: '2026-11-10T08:00:00Z' }),
      ],
    });
    const { body } = await app.get('/api/v1/queue/plex/727787').expect(200);
    expect(ids(body)).toEqual(['plex:1', 'plex:2', 'plex:3', 'plex:4', 'plex:5']);
    expect(body.startIndex).toBe(2);
    expect(body.items[2].resumePosition).toBe(600);
  });

  it('a finished book starts again at part 1 from its beginning', async () => {
    const { app } = makeApp({
      items: book,
      progressRows: [1, 2, 3, 4, 5].map((n) => progress(n, {
        playhead: n === 1 ? 900 : 1800, playCount: 1, lastPlayed: `2026-11-1${n}T08:00:00Z`,
      })),
    });
    const { body } = await app.get('/api/v1/queue/plex/727787').expect(200);
    expect(ids(body)).toEqual(['plex:1', 'plex:2', 'plex:3', 'plex:4', 'plex:5']);
    expect(body.startIndex).toBe(0);
    expect(body.items[0].resumePosition ?? null).toBe(null);
  });

  it('with nothing heard, starts at 0', async () => {
    const { app } = makeApp({ items: book });
    const { body } = await app.get('/api/v1/queue/plex/727787').expect(200);
    expect(ids(body)).toEqual(['plex:1', 'plex:2', 'plex:3', 'plex:4', 'plex:5']);
    expect(body.startIndex).toBe(0);
  });

  it('shuffle is ignored for a book: same order, same start', async () => {
    const rows = [progress(3, { playhead: 600, lastPlayed: '2026-11-21T08:00:00Z' })];
    const { app } = makeApp({ items: book, progressRows: rows });
    const { body } = await app.get('/api/v1/queue/plex/727787?shuffle=true').expect(200);
    expect(ids(body)).toEqual(['plex:1', 'plex:2', 'plex:3', 'plex:4', 'plex:5']);
    expect(body.startIndex).toBe(2);
  });

  it('?limit=1 answers the part to start at (startIndex 0 in that window)', async () => {
    const rows = [progress(3, { playhead: 600, lastPlayed: '2026-11-21T08:00:00Z' })];
    const { app } = makeApp({ items: book, progressRows: rows });
    const { body } = await app.get('/api/v1/queue/plex/727787?limit=1').expect(200);
    expect(ids(body)).toEqual(['plex:3']);
    expect(body.startIndex).toBe(0);
    expect(body.items[0].resumePosition).toBe(600);
  });

  it('a talks library (keyed by section id) is an ordered work too', async () => {
    const course = [1, 2, 3].map((n) => new PlayableItem({
      ...part(n, null), metadata: { librarySectionID: 7, librarySectionTitle: 'Lectures' },
    }));
    const { app } = makeApp({ items: course, progressRows: [progress(1, { playhead: 1800, playCount: 1, lastPlayed: '2026-11-21T08:00:00Z' })] });
    const { body } = await app.get('/api/v1/queue/plex/1').expect(200);
    expect(ids(body)).toEqual(['plex:1', 'plex:2', 'plex:3']);
    expect(body.startIndex).toBe(1);
  });
});

describe('GET /api/v1/queue for a show or music (unchanged)', () => {
  it('a show: unwatched first in order, then watched by recency; no startIndex', async () => {
    const show = [1, 2, 3, 4].map((n) => part(n, 'TV Shows', { mediaType: 'video' }));
    const { app } = makeApp({
      items: show,
      progressRows: [
        progress(1, { playhead: 1800, playCount: 1, lastPlayed: '2026-11-01T08:00:00Z' }),
        progress(3, { playhead: 1800, playCount: 1, lastPlayed: '2026-11-05T08:00:00Z' }),
      ],
    });
    const { body } = await app.get('/api/v1/queue/plex/100').expect(200);
    expect(ids(body)).toEqual(['plex:2', 'plex:4', 'plex:1', 'plex:3']);
    expect('startIndex' in body).toBe(false);
  });

  it('a music playlist: songs are not resumable, so they keep the list order; no startIndex', async () => {
    const songs = [1, 2, 3].map((n) => part(n, 'Music', { duration: 200 }));
    const { app } = makeApp({
      items: songs,
      progressRows: [progress(1, { playhead: 200, duration: 200, playCount: 2, lastPlayed: '2026-11-21T08:00:00Z' })],
    });
    const { body } = await app.get('/api/v1/queue/plex/200').expect(200);
    expect(ids(body)).toEqual(['plex:1', 'plex:2', 'plex:3']);
    expect('startIndex' in body).toBe(false);
  });

  it('without library kinds configured a book keeps the old order (no startIndex)', async () => {
    const book = [1, 2, 3].map((n) => part(n, 'Audiobooks'));
    const { app } = makeApp({
      items: book, libraryKinds: null,
      progressRows: [progress(1, { playhead: 1800, playCount: 1, lastPlayed: '2026-11-21T08:00:00Z' })],
    });
    const { body } = await app.get('/api/v1/queue/plex/1').expect(200);
    expect(ids(body)).toEqual(['plex:2', 'plex:3', 'plex:1']);
    expect('startIndex' in body).toBe(false);
  });
});
