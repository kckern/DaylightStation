import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ContentAccessService } from '../../../content-catalog/server/application/ContentAccessService.mjs';
import { QueuePresentationService } from '../application/QueuePresentationService.mjs';
import { createQueueRouter } from './queue.mjs';

function makeApp() {
  const lists = ['gallery', 'music', 'talks', 'television', 'weekend'].map(name => ({
    id: `menu:${name}`, title: name, thumbnail: `/art/${name}`,
  }));
  const entries = {
    'menu:gallery': [{ id: 'files:photo', mediaType: 'image', mediaUrl: '/photo' }],
    'menu:music': [
      { id: 'files:song', mediaType: 'audio', mediaUrl: '/song' },
      { id: 'files:video', mediaType: 'video', mediaUrl: '/video' },
      { id: 'app:game', mediaType: 'app' },
    ],
    'menu:weekend': [{ id: 'files:other', mediaType: 'audio', mediaUrl: '/other' }],
  };
  const catalog = new ContentAccessService({
    contentIdResolver: { resolve: id => ({ source: 'list', localId: id }) },
    audioListConfig: () => ({
      sources: [{ id: 'menu:', title: 'Household lists' }, 'unknown:'],
      browse: [{ id: 'menu:music', title: 'Music' }, { id: 'menu:television' }],
    }),
    contentCatalog: {
      audioListSources: () => [{ id: 'menu:', title: 'Menus' }, { id: 'library:albums', title: 'Albums' }],
      getItem: async () => null,
      getList: async () => lists,
      resolvePlayables: async (_, id) => entries[id.replace(/^list:/, '')] || [],
      audioRendition: async item => item.id === 'files:video'
        ? { mediaUrl: '/video?stream=audio', format: 'mp3' }
        : null,
    },
    queueService: { resolveQueue: async items => items },
  });
  const app = express();
  app.use('/api/v1/queue', createQueueRouter({
    contentExpression: { fromQuery: () => ({ options: {} }) },
    contentAccessService: catalog,
    queuePresentationService: new QueuePresentationService(),
    logger: {},
  }));
  return request(app);
}

describe('audio-only list playback', () => {
  it('exposes only configured catalogs declared by registered adapters', async () => {
    const app = makeApp();
    const result = await app.get('/api/v1/queue/catalog/audio-sources?profile=audio-only').expect(200);
    expect(result.body.items).toEqual([{ id: 'menu:', title: 'Household lists' }]);
    await app.get('/api/v1/queue/catalog/audio-lists?profile=audio-only&source=library:albums').expect(400);
  });

  it('uses configured listening destinations as the audio Browse root', async () => {
    const result = await makeApp().get('/api/v1/queue/catalog/audio-browse?profile=audio-only').expect(200);
    expect(result.body.items).toEqual([{ id: 'menu:music', title: 'Music' }]);
  });

  it('discovers lists that produce audio and advances over filtered candidates', async () => {
    const app = makeApp();
    const catalogUrl = '/api/v1/queue/catalog/audio-lists?profile=audio-only&source=menu';
    const first = await app.get(catalogUrl).expect(200);
    expect(first.body).toEqual({
      items: [{ id: 'menu:music', title: 'music', thumbnail: '/art/music' }],
      nextCursor: 4,
    });
    const next = await app.get(catalogUrl + '&skip=4').expect(200);
    expect(next.body.items.map(item => item.id)).toEqual(['menu:weekend']);
    expect(next.body).not.toHaveProperty('nextCursor');
    await app.get(catalogUrl.replace('source=menu', 'source=external')).expect(400);
  });

  it('returns audio URLs for the candidate queue and preserves regular playback', async () => {
    const app = makeApp();
    const path = '/api/v1/queue/menu/music';
    const audio = await app.get(path + '?profile=audio-only').expect(200);
    expect(audio.body.items.map(item => [item.mediaType, item.mediaUrl])).toEqual([
      ['audio', '/song'], ['audio', '/video?stream=audio'],
    ]);
    const normal = await app.get(path).expect(200);
    expect(normal.body.items.map(item => item.mediaType)).toEqual(['audio', 'video', 'app']);
  });
});
