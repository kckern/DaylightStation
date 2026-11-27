import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ContentAccessService } from '../../../content-catalog/server/application/ContentAccessService.mjs';
import { QueuePresentationService } from '../application/QueuePresentationService.mjs';
import { createQueueRouter } from './queue.mjs';

function makeApp({ kinds, sequenced = new Set() } = {}) {
  const libraries = [
    { id: 'plex:library/sections/9/all', title: 'Audiobooks', metadata: { sectionId: 9 } },
    { id: 'plex:library/sections/18/all', title: 'Education', metadata: { sectionId: 18 } },
    { id: 'plex:library/sections/5/all', title: 'Music', metadata: { sectionId: 5 } },
    { id: 'plex:library/sections/11/all', title: 'Children’s Stories', metadata: { sectionId: 11 } },
  ];
  const asked = [];
  const catalog = new ContentAccessService({
    contentIdResolver: { resolve: (id) => ({ source: id.split(':')[0], localId: id.slice(id.indexOf(':') + 1) }) },
    audioListConfig: () => ({
      sources: [{ id: 'menu:', title: 'Lists' }],
      library_kinds: kinds,
    }),
    contentCatalog: {
      audioListSources: () => [{ id: 'menu:', title: 'Menus' }],
      getItem: async () => null,
      getList: async (resolution, ref) => {
        asked.push([resolution.source, ref]);
        if (resolution.source === 'plex') return libraries;
        return [{ id: 'menu:radio', title: 'Radio' }, { id: 'menu:mix', title: 'Mix' }];
      },
      resolvePlayables: async () => [{ id: 'files:song', mediaType: 'audio', mediaUrl: '/song' }],
    },
    queueService: { resolveQueue: async (items) => items },
    sequenceStore: { lookup: (ref) => (sequenced.has(ref) ? { ids: ['x'] } : null) },
    random: () => 0,
  });
  const app = express();
  app.use('/api/v1/queue', createQueueRouter({
    contentExpression: { fromQuery: () => ({ options: {} }) },
    contentAccessService: catalog,
    queuePresentationService: new QueuePresentationService(),
    logger: {},
  }));
  return { app: request(app), asked };
}

describe('audio libraries and their kinds', () => {
  it('names each audio library with the kind the household config gives it; others are music', async () => {
    const { app, asked } = makeApp({ kinds: { Audiobooks: 'books', 18: 'talks', 'Children’s Stories': 'Books', Music: 'opera' } });
    const result = await app.get('/api/v1/queue/catalog/audio-libraries?profile=audio-only').expect(200);
    expect(result.body.default).toBe('music');
    expect(result.body.items).toEqual([
      { id: 'plex:library/sections/9/all', title: 'Audiobooks', sectionId: '9', kind: 'books' },
      { id: 'plex:library/sections/18/all', title: 'Education', sectionId: '18', kind: 'talks' },
      // An unknown kind ("opera") is not a kind: the library is music.
      { id: 'plex:library/sections/5/all', title: 'Music', sectionId: '5', kind: 'music' },
      { id: 'plex:library/sections/11/all', title: 'Children’s Stories', sectionId: '11', kind: 'books' },
    ]);
    // The audio libraries only (Plex's "audio" alias), never every section.
    expect(asked).toContainEqual(['plex', 'audio']);
  });

  it('is music throughout with no config, and refuses another profile', async () => {
    const { app } = makeApp({});
    const result = await app.get('/api/v1/queue/catalog/audio-libraries?profile=audio-only').expect(200);
    expect(result.body.items.every((l) => l.kind === 'music')).toBe(true);
    await app.get('/api/v1/queue/catalog/audio-libraries').expect(400);
  });

  it('marks a radio-station playlist (a station sequence) so the phone plays it whole', async () => {
    const { app } = makeApp({ sequenced: new Set(['menu:radio']) });
    const result = await app.get('/api/v1/queue/catalog/audio-lists?profile=audio-only&source=menu').expect(200);
    const byId = Object.fromEntries(result.body.items.map((i) => [i.id, i]));
    expect(byId['menu:radio'].station).toBe(true);
    expect(byId['menu:mix']).not.toHaveProperty('station');
  });
});
