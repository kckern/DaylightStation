// backend/src/4_api/v1/routers/play.surround.test.mjs

import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createPlayRouter } from './play.mjs';
import { PlayResponseService } from '#apps/content/services/PlayResponseService.mjs';
import { PlaybackReadService } from '#apps/content/services/PlaybackReadService.mjs';
import { RegistryContentCatalogGateway } from '#adapters/content/RegistryContentCatalogGateway.mjs';

// The real service, not a spy: this file exists to prove the ROUTER hands the
// container context down. Asserting on a mock's arguments would pass just as
// happily if `containerId` were spelled `container_id` on both sides, and the
// feature would still be dead in production.

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
const EPISODE = { id: 'concert-hall', piece: { title: 'Études, Op. 10' } };

const episodeItem = (id) => ({
  id, title: `item ${id}`, mediaUrl: `/api/v1/proxy/plex/stream/${id}`,
  mediaType: 'video', duration: 1800, resumable: true, metadata: {}
});

const makeLogger = () => {
  const l = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), child: vi.fn() };
  l.child.mockReturnValue(l);
  return l;
};

// Every episode owns a standalone sidecar, and the season claims all three —
// the live shape, and the only one in which the two readings can be told apart.
const surroundStore = {
  lookup: vi.fn((id) => (id === 'plex:696233' ? SEASON : (String(id).startsWith('plex:6962') ? EPISODE : null))),
  lookupByPart: vi.fn((id) => {
    const slot = SEASON.timeline.parts.find((p) => p.contentId === id);
    return slot ? { payload: SEASON, part: slot.index } : null;
  })
};

const makeApp = () => {
  const app = express();
  const adapter = {
    source: 'plex',
    getItem: vi.fn(async (localId) => (localId === '696233'
      // The season: a container, so the router resolves it to a playable.
      ? { id: 'plex:696233', title: 'Études', itemType: 'container' }
      : episodeItem(`plex:${localId}`))),
    resolvePlayables: vi.fn(async () => [episodeItem('plex:696234'), episodeItem('plex:696235')])
  };
  const playResponseService = new PlayResponseService({
      mediaProgressMemory: { findProgress: () => null }, surroundStore, logger: makeLogger()
    });
  const registry = { get: () => adapter };
  const contentCatalog = new RegistryContentCatalogGateway({ registry });
  const contentIdResolver = {
      resolve: (compoundId) => {
        const [source, localId] = String(compoundId).split(':');
        return { adapter, source, localId };
      }
    };
  app.use('/api/v1/play', createPlayRouter({
    playbackReadService: new PlaybackReadService({ contentCatalog, playResponseService, contentIdResolver }),
    logger: makeLogger()
  }));
  return app;
};

describe('play router container context', () => {
  // Both container branches: bare compound id, and the splat form. The wiring
  // was duplicated across them, so it can rot on one and not the other.
  for (const [label, url] of [['bare compound id', '/api/v1/play/plex:696233'], ['path segments', '/api/v1/play/plex/696233']]) {
    it(`frames a season's first episode as part 0 of the season (${label})`, async () => {
      const res = await request(makeApp()).get(url);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('plex:696234');
      // The CONTAINER's payload — the episode's own says "Études, Op. 10".
      expect(res.body.surround.piece.title).toBe('Études');
      expect(res.body.surroundPart).toBe(0);
    });
  }

  it('gives the same episode its own frame when played directly', async () => {
    const res = await request(makeApp()).get('/api/v1/play/plex:696234');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('plex:696234');
    expect(res.body.surround.piece.title).toBe('Études, Op. 10');
    expect('surroundPart' in res.body).toBe(false);
  });
});
