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

const makeApp = ({ items, surroundStore, logger = makeLogger() }) => {
  const app = express();
  const adapter = { resolvePlayables: vi.fn().mockResolvedValue({ items }) };
  app.use('/api/v1/queue', createQueueRouter({
    contentExpression: { fromQuery: () => ({ options: {} }) },
    contentIdResolver: { resolve: () => ({ adapter, source: 'plex', localId: 'eroica' }) },
    queueService: { resolveQueue: vi.fn().mockResolvedValue(items) },
    surroundStore,
    logger
  }));
  return app;
};

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
