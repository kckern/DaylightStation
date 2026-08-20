// backend/src/4_api/v1/routers/queue.surround.test.mjs

import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createQueueRouter } from './queue.mjs';

const PAYLOAD = {
  id: 'concert-hall',
  definition: { regions: { right: { module: 'composer-card' } } },
  piece: { title: 'Symphony No. 3' },
  movements: [{ n: 1, name: 'Allegro con brio', start: 0 }],
  cues: [],
  facts: [],
  composer: { name: 'Ludwig van Beethoven' },
  assetBase: 'surround/classical'
};

const makeItem = (id, title) => ({
  id, title, source: 'plex',
  mediaUrl: `/api/v1/proxy/plex/stream/${id}`,
  mediaType: 'video', duration: 3223, thumbnail: '/thumb.jpg',
  resumable: true, metadata: {}
});

const makeLogger = () => {
  const l = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), child: vi.fn() };
  l.child.mockReturnValue(l);
  return l;
};

const makeApp = ({ items, surroundStore, logger = makeLogger(), localId = 'eroica', ...rest }) => {
  const app = express();
  const adapter = { resolvePlayables: vi.fn().mockResolvedValue({ items }) };
  app.use('/api/v1/queue', createQueueRouter({
    contentExpression: { fromQuery: () => ({ options: {} }) },
    contentIdResolver: { resolve: () => ({ adapter, source: 'plex', localId }) },
    queueService: { resolveQueue: vi.fn().mockResolvedValue(items) },
    surroundStore,
    logger,
    ...rest
  }));
  return app;
};

// The live container: season plex:696233 composing three étude episodes.
const SEASON = {
  id: 'concert-hall',
  piece: { title: 'Études' },
  timeline: {
    totalSounding: 3738,
    parts: [
      { contentId: 'plex:696234', index: 0, sounding: 1800 },
      { contentId: 'plex:696235', index: 1, sounding: 1550 },
      { contentId: 'plex:696236', index: 2, sounding: 388 }
    ]
  }
};

// Each episode also has a perfectly good standalone sidecar — the thing the
// container's claim has to beat, and the thing the mismatch refusal must NOT
// fall back to.
const seasonStore = () => ({
  lookup: vi.fn((id) => (id === 'plex:696233' ? SEASON : (id?.startsWith?.('plex:6962') ? PAYLOAD : null)))
});

const shuffledEpisodes = [
  makeItem('plex:696235', 'Études, Op. 25'),
  makeItem('plex:696236', 'Trois nouvelles études'),
  makeItem('plex:696234', 'Études, Op. 10')
];

describe('queue router surround attachment', () => {
  const items = [makeItem('plex:663134', 'Beethoven: 3. Sinfonie')];

  it('attaches the payload verbatim to a matching queue item', async () => {
    const logger = makeLogger();
    const surroundStore = { lookup: vi.fn().mockReturnValue(PAYLOAD) };
    const res = await request(makeApp({ items, surroundStore, logger })).get('/api/v1/queue/plex:eroica');

    expect(res.status).toBe(200);
    expect(surroundStore.lookup).toHaveBeenCalledWith('plex:663134', 'Beethoven: 3. Sinfonie');
    expect(res.body.items[0].surround).toEqual(PAYLOAD);
    const attached = logger.debug.mock.calls.find((c) => c[0] === 'surround.attach');
    expect(attached).toBeDefined();
    expect(attached[1]).toMatchObject({ contentId: 'plex:663134', surroundId: 'concert-hall', path: 'queue' });
  });

  it('returns a response identical to the no-store response when the store misses', async () => {
    const bare = await request(makeApp({ items })).get('/api/v1/queue/plex:eroica');
    const surroundStore = { lookup: vi.fn().mockReturnValue(null) };
    const missed = await request(makeApp({ items, surroundStore })).get('/api/v1/queue/plex:eroica');

    expect(surroundStore.lookup).toHaveBeenCalled();
    expect(missed.body).toEqual(bare.body);
    expect('surround' in missed.body.items[0]).toBe(false);
  });

  it('still returns 200 when the store violates its never-throw contract', async () => {
    const logger = makeLogger();
    const surroundStore = { lookup: vi.fn(() => { throw new Error('index corrupt'); }) };
    const res = await request(makeApp({ items, surroundStore, logger })).get('/api/v1/queue/plex:eroica');

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect('surround' in res.body.items[0]).toBe(false);
    const warned = logger.warn.mock.calls.find((c) => c[0] === 'surround.attach.failed');
    expect(warned).toBeDefined();
    expect(warned[1]).toMatchObject({ contentId: 'plex:663134', error: 'index corrupt' });
  });

  it('enriches only the item with a sidecar and leaves its neighbours untouched', async () => {
    const multi = [
      makeItem('plex:1', 'Unenriched A'),
      makeItem('plex:663134', 'Beethoven: 3. Sinfonie'),
      makeItem('plex:3', 'Unenriched B')
    ];
    const bare = await request(makeApp({ items: multi })).get('/api/v1/queue/plex:eroica');
    const surroundStore = { lookup: vi.fn((id) => (id === 'plex:663134' ? PAYLOAD : null)) };
    const res = await request(makeApp({ items: multi, surroundStore })).get('/api/v1/queue/plex:eroica');

    expect(res.body.items).toHaveLength(3);
    expect(res.body.items[1].surround).toEqual(PAYLOAD);
    expect('surround' in res.body.items[0]).toBe(false);
    expect('surround' in res.body.items[2]).toBe(false);
    expect(res.body.items[0]).toEqual(bare.body.items[0]);
    expect(res.body.items[2]).toEqual(bare.body.items[2]);
  });
});

describe('queue router container expansion', () => {
  const get = (opts) => request(makeApp({ localId: '696233', ...opts })).get('/api/v1/queue/plex:696233');

  it('plays a container in its authored order and frames every part with it', async () => {
    const logger = makeLogger();
    const res = await get({ items: shuffledEpisodes, surroundStore: seasonStore(), logger });

    expect(res.status).toBe(200);
    expect(res.body.items.map((i) => i.contentId))
      .toEqual(['plex:696234', 'plex:696235', 'plex:696236']);
    expect(res.body.items.map((i) => i.surroundPart)).toEqual([0, 1, 2]);
    // The CONTAINER's payload, not each episode's own — both exist.
    expect(res.body.items.every((i) => i.surround.piece.title === 'Études')).toBe(true);

    const enforced = logger.info.mock.calls.find((c) => c[0] === 'surround.order.enforced');
    expect(enforced[1]).toMatchObject({ containerId: 'plex:696233', parts: 3, reordered: true });
  });

  it('refuses to attach a rail when the queue order does not match and enforcement is off', async () => {
    const logger = makeLogger();
    const res = await get({
      items: shuffledEpisodes,
      surroundStore: seasonStore(),
      surroundEnforceOrder: false,
      logger
    });

    expect(res.status).toBe(200);
    // A frame with no rail — and specifically NOT each episode's own sidecar,
    // which the store would happily have supplied.
    expect(res.body.items.every((i) => i.surround === undefined)).toBe(true);
    expect(res.body.items.map((i) => i.contentId))
      .toEqual(['plex:696235', 'plex:696236', 'plex:696234']);
    const mismatch = logger.warn.mock.calls.find((c) => c[0] === 'surround.order.mismatch');
    expect(mismatch[1]).toMatchObject({
      containerId: 'plex:696233',
      enforceOrder: false,
      authored: ['plex:696234', 'plex:696235', 'plex:696236'],
      queued: ['plex:696235', 'plex:696236', 'plex:696234']
    });
  });

  it('orders before truncating, so a limited queue keeps the programme\'s first parts', async () => {
    const app = express();
    const adapter = { resolvePlayables: vi.fn().mockResolvedValue({ items: shuffledEpisodes }) };
    app.use('/api/v1/queue', createQueueRouter({
      contentExpression: { fromQuery: () => ({ options: { limit: '2' } }) },
      contentIdResolver: { resolve: () => ({ adapter, source: 'plex', localId: '696233' }) },
      queueService: { resolveQueue: vi.fn().mockResolvedValue(shuffledEpisodes) },
      surroundStore: seasonStore(),
      logger: makeLogger()
    }));
    const res = await request(app).get('/api/v1/queue/plex:696233');

    expect(res.body.items.map((i) => i.contentId)).toEqual(['plex:696234', 'plex:696235']);
  });
});
