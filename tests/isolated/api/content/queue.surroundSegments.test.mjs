// tests/isolated/api/content/queue.surroundSegments.test.mjs
//
// A surround-segments query queued through the real path: QueryAdapter →
// QueueService ordering → QueuePresentationService enrichment → the queue
// router's projection. Each clip must reach the player with both its window
// (`segment`) and the frame of the recording it was cut from (`surround`).
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { QueryAdapter } from "../../../../__capabilities/content-catalog/server/adapters/providers/query/QueryAdapter.mjs";
import { SavedQueryService } from "../../../../__capabilities/content-catalog/server/application/SavedQueryService.mjs";
import { QueueService } from "../../../../__capabilities/playback/server/application/services/QueueService.mjs";
import { createQueueRouter } from "../../../../__capabilities/playback/server/api/queue.mjs";
import { QueuePresentationService } from "../../../../__capabilities/playback/server/application/QueuePresentationService.mjs";
import { planSurroundQueue } from "../../../../__capabilities/playback/server/application/services/surroundQueuePlan.mjs";

const SIDECARS = [
  {
    contentId: 'plex:1001', title: 'Winter Concert', year: 2001,
    segments: [
      { n: 1, name: 'Opening Carol', kind: 'song', song: 'carol', start: 10, end: 200, confidence: 'derived' },
      { n: 2, name: 'Second Carol', kind: 'song', song: 'second', start: 270, end: 500, confidence: 'derived' },
    ],
  },
  {
    contentId: 'plex:1002', title: 'Snow Concert', year: 2002,
    segments: [
      { n: 1, name: 'Opening Carol', kind: 'song', song: 'carol', start: 5, end: 150, confidence: 'verified' },
      { n: 2, name: 'Snow Song', kind: 'song', song: 'snow', start: 160, end: 300, confidence: 'verified' },
    ],
  },
];

const QUERY = {
  title: 'Winter Songs',
  type: 'surround-segments',
  params: { works: 'season/choir', kinds: ['song'], noRepeatSong: true },
};

const payloadFor = (contentId) => ({
  id: 'test-hall',
  definition: { regions: {}, clip: { bottom: [{ module: 'clip-band' }] } },
  piece: { title: `Concert ${contentId}` },
  segments: [],
  timeline: { totalSounding: 0, parts: [{ contentId, index: 0, sounding: 0 }] },
});

const makeLogger = () => {
  const l = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), child: vi.fn() };
  l.child.mockReturnValue(l);
  return l;
};

function makeApp({ random = () => 0.3 } = {}) {
  const plex = {
    getItem: vi.fn(async (localId) => ({
      id: `plex:${localId}`, source: 'plex', localId, title: `Full ${localId}`,
      mediaType: 'video', mediaUrl: `/api/v1/proxy/plex/stream/${localId}`,
      duration: 5000, resumable: true, thumbnail: `/thumb/${localId}`, metadata: { type: 'movie' },
    })),
  };
  const registry = { resolve: (id) => (id.startsWith('plex:') ? { adapter: plex, localId: id.slice(5) } : null) };
  const queryAdapter = new QueryAdapter({
    savedQueryService: new SavedQueryService({ readQuery: (n) => (n === 'winter-songs' ? QUERY : null) }),
    registry,
    surroundSegments: { read: () => SIDECARS },
    random,
  });
  // The queue service shuffles hard (always reverses) so a lost order shows.
  const queueService = new QueueService({ random: () => 0 });
  const contentAccessService = {
    queue: vi.fn(async ({ compoundId, shuffle }) => {
      const playables = await queryAdapter.resolvePlayables(compoundId);
      const items = await queueService.resolveQueue(playables, 'query', { shuffle });
      return { kind: 'found', source: 'query', finalId: compoundId, audio: null, thumbnail: null, items };
    }),
  };
  const surroundStore = {
    lookup: vi.fn((id) => (['plex:1001', 'plex:1002'].includes(id) ? payloadFor(id) : null)),
  };
  const logger = makeLogger();
  const app = express();
  app.use('/api/v1/queue', createQueueRouter({
    contentExpression: { fromQuery: (q) => ({ options: { shuffle: q.shuffle } }) },
    contentAccessService,
    queuePresentationService: new QueuePresentationService({ surroundStore, surroundPlanner: planSurroundQueue, logger }),
    logger,
  }));
  return { app, surroundStore, queryAdapter };
}

describe('queueing a surround-segments query', () => {
  it('gives every clip its window and its recording\'s surround', async () => {
    const { app, surroundStore } = makeApp();
    const res = await request(app).get('/api/v1/queue/query:winter-songs');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(4);
    for (const item of res.body.items) {
      const recording = item.id.split('#')[0];
      expect(item.segment.end).toBeGreaterThan(item.segment.start);
      expect(item.duration).toBe(item.segment.end - item.segment.start);
      expect(item.surround?.piece?.title).toBe(`Concert ${recording}`);
      expect(item.mediaUrl).toBe(`/api/v1/proxy/plex/stream/${recording.slice(5)}`);
      expect(item.subtitle).toMatch(/Concert \(\d{4}\)$/);
    }
    expect(surroundStore.lookup).toHaveBeenCalledWith('plex:1001', expect.anything());
  });

  it('points the rail at the recording, not at the clip id', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/v1/queue/query:winter-songs');
    for (const item of res.body.items) expect(item.surroundPart).toBe(0);
  });

  it('keeps the query\'s own order when the queue is asked to shuffle', async () => {
    const { app, queryAdapter } = makeApp();
    const own = (await queryAdapter.resolvePlayables('query:winter-songs')).map((i) => i.id);
    const res = await request(app).get('/api/v1/queue/query:winter-songs?shuffle=1');
    expect(res.body.items.map((i) => i.id)).toEqual(own);
    for (let i = 1; i < res.body.items.length; i += 1) {
      expect(res.body.items[i].title === 'Opening Carol' && res.body.items[i - 1].title === 'Opening Carol').toBe(false);
    }
  });
});
