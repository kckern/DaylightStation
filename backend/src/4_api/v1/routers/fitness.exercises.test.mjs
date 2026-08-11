// backend/src/4_api/v1/routers/fitness.exercises.test.mjs
//
// The three /exercises routes end to end through a real Express app: real router, real
// BrowseExerciseLibrary, real repository over a small temp manifest. Nothing is mocked,
// because the two failure modes worth catching here — a query param mangled in transit,
// and /taxonomy swallowed by /:slug — are both properties of the real stack and both
// invisible to a test that only checks status codes.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { createFitnessRouter } from './fitness.mjs';
import { BrowseExerciseLibrary } from '#apps/fitness/usecases/BrowseExerciseLibrary.mjs';
import { YamlExerciseLibraryRepository } from '#adapters/reference/exercise-library/index.mjs';

const silentLogger = { error() {}, warn() {}, info() {}, debug() {} };

/** Compact record; only the fields these assertions turn on. */
const exercise = (name, groups, muscles, equipment) => ({
  name,
  description: `About the ${name}.`,
  instructions: [`Set up for the ${name}.`, `Perform the ${name}.`],
  image: `exercises/${name.toLowerCase().replace(/ /g, '-')}.png`,
  stills: [`exercises/${name.toLowerCase().replace(/ /g, '-')}_1.png`],
  video: `hevy_videos/${name.toLowerCase().replace(/ /g, '-')}.mp4`,
  targetMuscles: muscles, targetGroups: groups, groups, equipment,
});

// Three groups so that OR-ing two of them is strictly narrower than the whole corpus —
// the shape the real corpus has (chest 157, chest+back 366, of 1,296).
const MANIFEST = {
  version: 1,
  builtAt: '2026-08-11T00:00:00.000Z',
  exercises: {
    'back-squat': exercise('Back Squat', ['legs'], ['quads'], ['barbell']),
    'barbell-row': exercise('Barbell Row', ['back'], ['lats'], ['barbell']),
    'bench-press': exercise('Bench Press', ['chest'], ['pectorals'], ['barbell']),
    'chest-fly': exercise('Chest Fly', ['chest'], ['pectorals'], ['dumbbell']),
  },
  muscles: {
    lats: { name: 'Latissimus Dorsi', group: 'back', description: 'Back.', fullDescription: 'A LONG ESSAY.' },
    pectorals: { name: 'Pectorals', group: 'chest', description: 'Chest.', fullDescription: 'A LONG ESSAY.' },
    quads: { name: 'Quadriceps', group: 'legs', description: 'Thigh.', fullDescription: 'A LONG ESSAY.' },
  },
  muscleGroups: {
    back: { name: 'Back', muscles: ['lats'] },
    chest: { name: 'Chest', muscles: ['pectorals'] },
    legs: { name: 'Legs', muscles: ['quads'] },
  },
  equipment: {
    barbell: { name: 'Barbell' },
    dumbbell: { name: 'Dumbbell' },
  },
  byGroup: { back: ['barbell-row'], chest: ['bench-press', 'chest-fly'], legs: ['back-squat'] },
  byMuscle: { lats: ['barbell-row'], pectorals: ['bench-press', 'chest-fly'], quads: ['back-squat'] },
  byEquipment: { barbell: ['back-squat', 'barbell-row', 'bench-press'], dumbbell: ['chest-fly'] },
};

let tmpDir;
let app;
let unbuiltApp;
let uncomposedApp;

/** Mount one router as a real app, exactly as the composition root does. */
function mount(router) {
  const server = express();
  server.use(express.json());
  server.use('/api/fitness', router);
  return server;
}

function buildApp({ indexPath }) {
  const exerciseLibrary = new YamlExerciseLibraryRepository({ indexPath, logger: silentLogger }).load();
  return mount(createFitnessRouter({
    logger: silentLogger,
    browseExerciseLibrary: new BrowseExerciseLibrary({ exerciseLibrary, logger: silentLogger }),
  }));
}

const slugsOf = (res) => res.body.exercises.map((e) => e.slug);

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exercise-api-'));
  const indexPath = path.join(tmpDir, 'exercise-index.yml');
  fs.writeFileSync(indexPath, yaml.dump(MANIFEST), 'utf8');
  app = buildApp({ indexPath });
  unbuiltApp = buildApp({ indexPath: path.join(tmpDir, 'never-built.yml') });
  uncomposedApp = mount(createFitnessRouter({ logger: silentLogger }));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('GET /api/fitness/exercises', () => {
  it('returns the whole corpus when nothing is filtered', async () => {
    const res = await request(app).get('/api/fitness/exercises');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(4);
    expect(slugsOf(res)).toEqual(['back-squat', 'barbell-row', 'bench-press', 'chest-fly']);
  });

  it('NARROWS on a repeated key: ?group=chest&group=back is the union of the two', async () => {
    // The assertion that matters is not the 200 — it is that the result is smaller than
    // the corpus and holds exactly the union. `String(req.query.group)` in the handler
    // yields the term 'chest,back' and answers 0; treating the array as "no constraint"
    // answers 4. Only forwarding it intact answers 3, with back-squat excluded.
    const res = await request(app).get('/api/fitness/exercises?group=chest&group=back');
    expect(res.status).toBe(200);
    expect(slugsOf(res)).toEqual(['barbell-row', 'bench-press', 'chest-fly']);
    expect(res.body.total).toBe(3);
    expect(slugsOf(res)).not.toContain('back-squat');
    expect(res.body.total).toBeLessThan(
      (await request(app).get('/api/fitness/exercises')).body.total,
    );
  });

  it('treats a one-value array exactly like the bare scalar', async () => {
    // A UI that lights one chip and re-sends it can produce this. If "not a string"
    // reads as "no constraint" anywhere in transit, this answers 4 instead of 2.
    const repeated = await request(app).get('/api/fitness/exercises?group=chest&group=chest');
    const scalar = await request(app).get('/api/fitness/exercises?group=chest');
    expect(slugsOf(repeated)).toEqual(['bench-press', 'chest-fly']);
    expect(slugsOf(repeated)).toEqual(slugsOf(scalar));
  });

  it('answers an unknown-but-well-formed term with nothing, never with everything', async () => {
    const res = await request(app).get('/api/fitness/exercises?group=no-such-group');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    // A term nobody has does not widen the query: one that is present in a list still
    // constrains the rest of it.
    expect(slugsOf(await request(app).get('/api/fitness/exercises?group=chest&group=no-such-group')))
      .toEqual(['bench-press', 'chest-fly']);
  });

  it('ANDs across facets', async () => {
    const res = await request(app).get('/api/fitness/exercises?group=chest&equipment=barbell');
    expect(slugsOf(res)).toEqual(['bench-press']);
    const wider = await request(app)
      .get('/api/fitness/exercises?group=chest&group=back&equipment=barbell');
    expect(slugsOf(wider)).toEqual(['barbell-row', 'bench-press']);
  });

  it('searches with q, and ignores query params that are not facets', async () => {
    expect(slugsOf(await request(app).get('/api/fitness/exercises?q=row')))
      .toEqual(['barbell-row']);
    // `household` is not a facet; forwarding it would filter on a field that does not
    // exist and return nothing.
    expect((await request(app).get('/api/fitness/exercises?household=main')).body.total).toBe(4);
  });

  // An OBJECT-shaped facet (`?group[bad]=chest`) cannot arrive here: Express 5 defaults
  // to the simple query parser, which yields only strings and arrays of strings, and the
  // bracketed name lands as a param called `group[bad]` — not a facet at all. The domain
  // still reads an object as matching nothing, and that is covered where such a value can
  // actually be constructed: BrowseExerciseLibrary.test.mjs.

  it('ships cards, not bodies: no instructions or video on the list', async () => {
    const res = await request(app).get('/api/fitness/exercises?q=bench');
    expect(res.body.exercises[0]).toEqual({
      slug: 'bench-press',
      name: 'Bench Press',
      image: 'media/library/exercise/exercises/bench-press.png',
      groups: ['chest'],
      targetMuscles: ['pectorals'],
      equipment: ['barbell'],
    });
    for (const heavy of ['instructions', 'description', 'stills', 'video']) {
      expect(res.body.exercises[0]).not.toHaveProperty(heavy);
    }
  });
});

describe('GET /api/fitness/exercises/taxonomy', () => {
  it('is NOT swallowed by /exercises/:slug', async () => {
    const res = await request(app).get('/api/fitness/exercises/taxonomy');
    expect(res.status).toBe(200);
    // Declared below /:slug this would be a 404 for the "taxonomy" exercise, so assert
    // the payload, not merely the status.
    expect(res.body.groups.map((g) => g.slug)).toEqual(['back', 'chest', 'legs']);
    expect(res.body.equipment.map((e) => e.slug)).toEqual(['barbell', 'dumbbell']);
    expect(res.body).not.toHaveProperty('exercise');
  });

  it('leaves the long-form anatomy essays out of the rail', async () => {
    const res = await request(app).get('/api/fitness/exercises/taxonomy');
    expect(res.body.muscles.map((m) => m.slug)).toEqual(['lats', 'pectorals', 'quads']);
    for (const muscle of res.body.muscles) expect(muscle).not.toHaveProperty('fullDescription');
  });
});

describe('GET /api/fitness/exercises/:slug', () => {
  it('returns the FULL record — instructions, stills and video', async () => {
    const res = await request(app).get('/api/fitness/exercises/bench-press');
    expect(res.status).toBe(200);
    expect(res.body.exercise.name).toBe('Bench Press');
    expect(res.body.exercise.instructions)
      .toEqual(['Set up for the Bench Press.', 'Perform the Bench Press.']);
    expect(res.body.exercise.video).toBe('media/library/exercise/hevy_videos/bench-press.mp4');
    expect(res.body.exercise.stills)
      .toEqual(['media/library/exercise/exercises/bench-press_1.png']);
  });

  it('404s an unknown slug, and a hostile one', async () => {
    const missing = await request(app).get('/api/fitness/exercises/no-such-thing');
    expect(missing.status).toBe(404);
    expect(missing.body.slug).toBe('no-such-thing');
    expect((await request(app).get('/api/fitness/exercises/constructor')).status).toBe(404);
  });
});

describe('exercise routes with an unbuilt corpus', () => {
  it('reports the empty browse as unavailable, with the command that fixes it', async () => {
    const res = await request(unbuiltApp).get('/api/fitness/exercises');
    expect(res.status).toBe(200);
    expect(res.body.exercises).toEqual([]);
    expect(res.body.library.available).toBe(false);
    expect(res.body.library.hint).toMatch(/npm run exercise:index/);
  });

  it('says the same on the rails and on a 404 deep link', async () => {
    const tax = await request(unbuiltApp).get('/api/fitness/exercises/taxonomy');
    expect(tax.status).toBe(200);
    expect(tax.body.library.hint).toMatch(/npm run exercise:index/);

    const detail = await request(unbuiltApp).get('/api/fitness/exercises/bench-press');
    expect(detail.status).toBe(404);
    expect(detail.body.library.hint).toMatch(/npm run exercise:index/);
  });

  it('never leaks the server-side index path to a browser', async () => {
    const res = await request(unbuiltApp).get('/api/fitness/exercises');
    expect(res.body.library).not.toHaveProperty('indexPath');
    expect(JSON.stringify(res.body)).not.toContain(tmpDir);
  });
});

describe('exercise routes when browse was not composed', () => {
  it('reports 503 on all three rather than 404-ing or crashing', async () => {
    for (const url of ['/api/fitness/exercises', '/api/fitness/exercises/taxonomy',
      '/api/fitness/exercises/bench-press']) {
      expect((await request(uncomposedApp).get(url)).status).toBe(503);
    }
  });
});
