import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createPianoRouter } from './piano.mjs';

const TRIAD_SEED = {
  schema_version: 1,
  id: 'triads/all',
  title: 'Triads',
  key: 'C',
  staff: 'treble',
  ordering: 'any',
  supports: ['free', 'cued'],
  events: [{ notes: [{ midi: 60, hand: 'right' }, { midi: 64, hand: 'right' }, { midi: 67, hand: 'right' }] }],
  expansion: {
    axes: {
      root: { values: 'all' },
      quality: { values: [{ id: 'major', intervals: [0, 4, 7] }, { id: 'minor', intervals: [0, 3, 7] }] },
      inversion: { values: ['root', '1st'] },
    },
  },
};

const stubBank = (over = {}) => ({
  available: () => true,
  getIndex: () => ({ title: 'Exercise Bank', totals: { seeds: 1, instances: 48 } }),
  listCollections: () => ['triads'],
  getCollection: (c) => (c === 'triads' ? { title: 'Triads' } : null),
  listSeeds: (c) => (c === 'triads' ? ['all'] : []),
  getSeed: (c, id) => (c === 'triads' && id === 'all' ? TRIAD_SEED : null),
  ...over,
});

function app(exerciseBank) {
  const server = express();
  server.use(express.json());
  server.use('/api/v1/piano', createPianoRouter({
    pianoContainer: { studioDatastore: { isKnownUser: () => true }, composerSongStore: {} },
    exerciseBank,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }));
  return server;
}

const get = (bank, path) => request(app(bank)).get(`/api/v1/piano${path}`);

describe('exercise bank API', () => {
  it('serves the root manifest', async () => {
    const response = await get(stubBank(), '/bank');
    expect(response.status).toBe(200);
    expect(response.body.totals).toEqual({ seeds: 1, instances: 48 });
  });

  it('serves a collection with the seeds actually on disk', async () => {
    const response = await get(stubBank(), '/bank/triads');
    expect(response.status).toBe(200);
    expect(response.body.seeds).toEqual(['all']);
  });

  it('serves a seed and says how many instances it yields', async () => {
    const response = await get(stubBank(), '/bank/triads/all');
    expect(response.status).toBe(200);
    expect(response.body.id).toBe('triads/all');
    expect(response.body.instances).toBe(12 * 2 * 2);
  });

  it('lists instance ids without materializing them', async () => {
    const response = await get(stubBank(), '/bank/triads/all/instances');
    expect(response.status).toBe(200);
    expect(response.body.total).toBe(48);
    expect(response.body.instance_ids).toHaveLength(48);
    expect(response.body.instance_ids[0]).toBe('triads/all@root=C,quality=major,inversion=root');
    expect(response.body.instances).toBeUndefined();
  });

  it('expands only when asked, and respects the cap', async () => {
    const response = await get(stubBank(), '/bank/triads/all/instances?expand=true&limit=3');
    expect(response.status).toBe(200);
    expect(response.body.instances).toHaveLength(3);
    expect(response.body.total).toBe(48, 'the cap limits the payload, not the count');
    expect(response.body.instances[0].events[0].notes.map((n) => n.midi)).toEqual([60, 64, 67]);
  });

  it('materializes one instance from its axes', async () => {
    const response = await get(stubBank(), '/bank/triads/all/instance?root=D&quality=minor&inversion=1st');
    expect(response.status).toBe(200);
    expect(response.body.id).toBe('triads/all@root=D,quality=minor,inversion=1st');
    // F-A-D: D minor, first inversion.
    expect(response.body.events[0].notes.map((n) => n.midi)).toEqual([65, 69, 74]);
    expect(response.body.ordering).toBe('any');
  });

  it('rejects an instance the seed cannot produce', async () => {
    const bad = await get(stubBank(), '/bank/triads/all/instance?quality=klezmer');
    expect(bad.status).toBe(400);
    const unknownAxis = await get(stubBank(), '/bank/triads/all/instance?tempo=fast');
    expect(unknownAxis.status).toBe(400);
  });

  it('404s an unknown collection or seed', async () => {
    expect((await get(stubBank(), '/bank/nope')).status).toBe(404);
    expect((await get(stubBank(), '/bank/triads/nope')).status).toBe(404);
  });

  it('400s a path segment that tries to escape the bank', async () => {
    // Express decodes %2F, so this reaches the handler as one segment.
    const response = await get(stubBank(), '/bank/..%2F..%2Fhousehold');
    expect([400, 404]).toContain(response.status);
  });

  it('503s when the bank is not present, rather than pretending it is empty', async () => {
    const response = await get(stubBank({ available: () => false }), '/bank');
    expect(response.status).toBe(503);
  });

  it('503s every bank route when the adapter is not wired at all', async () => {
    for (const path of ['/bank', '/bank/triads', '/bank/triads/all', '/bank/triads/all/instances']) {
      expect((await get(null, path)).status, path).toBe(503);
    }
  });
});
