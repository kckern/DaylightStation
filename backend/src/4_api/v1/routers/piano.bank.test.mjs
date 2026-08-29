import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createPianoRouter } from './piano.mjs';
import { withPianoRouterServices } from '../../../../../tests/_lib/pianoRouterDeps.mjs';

const TRIAD_SEED = {
  schema_version: 1,
  id: 'chords/triads',
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

// Categories nest, so the stub answers by path rather than by (collection, id).
const stubBank = (over = {}) => ({
  available: () => true,
  getIndex: () => ({ title: 'Exercise Bank', totals: { seeds: 1, instances: 48 } }),
  listCategories: (under) => (under === 'chords' ? [] : ['chords', 'drills', 'drills/hanon']),
  listCollections: () => ['chords', 'drills'],
  getCategory: (path) => (['chords', 'drills', 'drills/hanon'].includes(path) ? { title: path } : null),
  listSeeds: (path) => (path === 'chords' ? ['chords/triads'] : []),
  getSeed: (id) => (id === 'chords/triads' ? TRIAD_SEED : null),
  allSeeds: () => [TRIAD_SEED],
  ...over,
});

function app(exerciseBank) {
  const server = express();
  server.use(express.json());
  server.use('/api/v1/piano', createPianoRouter(withPianoRouterServices({
    pianoContainer: { studioDatastore: { isKnownUser: () => true }, composerSongStore: {} },
    exerciseBank,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  })));
  return server;
}

const get = (bank, path) => request(app(bank)).get(`/api/v1/piano${path}`);

describe('exercise bank API', () => {
  it('serves the root manifest', async () => {
    const response = await get(stubBank(), '/bank');
    expect(response.status).toBe(200);
    expect(response.body.totals).toEqual({ seeds: 1, instances: 48 });
  });

  it('serves a catalog projection for the learner-facing browser', async () => {
    const response = await get(stubBank(), '/bank/catalog');
    expect(response.status).toBe(200);
    expect(response.body.totals).toMatchObject({ seeds: 1, variants: 48 });
    expect(response.body.seeds[0]).toMatchObject({
      id: 'chords/triads', title: 'Triads', variants: 48,
      default_instance_id: 'chords/triads@root=C,quality=major,inversion=root',
    });
  });

  it('serves a collection with the seeds actually on disk', async () => {
    const response = await get(stubBank(), '/bank/chords');
    expect(response.status).toBe(200);
    expect(response.body.seeds).toEqual(['chords/triads']);
  });

  it('serves a seed and says how many instances it yields', async () => {
    const response = await get(stubBank(), '/bank/chords/triads');
    expect(response.status).toBe(200);
    expect(response.body.id).toBe('chords/triads');
    expect(response.body.instances).toBe(12 * 2 * 2);
  });

  it('lists instance ids without materializing them', async () => {
    const response = await get(stubBank(), '/bank/chords/triads/instances');
    expect(response.status).toBe(200);
    expect(response.body.total).toBe(48);
    expect(response.body.instance_ids).toHaveLength(48);
    expect(response.body.instance_ids[0]).toBe('chords/triads@root=C,quality=major,inversion=root');
    expect(response.body.instances).toBeUndefined();
  });

  it('expands only when asked, and respects the cap', async () => {
    const response = await get(stubBank(), '/bank/chords/triads/instances?expand=true&limit=3');
    expect(response.status).toBe(200);
    expect(response.body.instances).toHaveLength(3);
    expect(response.body.total).toBe(48, 'the cap limits the payload, not the count');
    expect(response.body.instances[0].events[0].notes.map((n) => n.midi)).toEqual([60, 64, 67]);
  });

  it('materializes one instance from its axes', async () => {
    const response = await get(stubBank(), '/bank/chords/triads/instance?root=D&quality=minor&inversion=1st');
    expect(response.status).toBe(200);
    expect(response.body.id).toBe('chords/triads@root=D,quality=minor,inversion=1st');
    // F-A-D: D minor, first inversion.
    expect(response.body.events[0].notes.map((n) => n.midi)).toEqual([65, 69, 74]);
    expect(response.body.ordering).toBe('any');
  });

  it('rejects an instance the seed cannot produce', async () => {
    const bad = await get(stubBank(), '/bank/chords/triads/instance?quality=klezmer');
    expect(bad.status).toBe(400);
    const unknownAxis = await get(stubBank(), '/bank/chords/triads/instance?tempo=fast');
    expect(unknownAxis.status).toBe(400);
  });

  it('404s an unknown collection or seed', async () => {
    expect((await get(stubBank(), '/bank/nope')).status).toBe(404);
    expect((await get(stubBank(), '/bank/chords/nope')).status).toBe(404);
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
    for (const path of ['/bank', '/bank/chords', '/bank/chords/triads', '/bank/chords/triads/instances']) {
      expect((await get(null, path)).status, path).toBe(503);
    }
  });
});
