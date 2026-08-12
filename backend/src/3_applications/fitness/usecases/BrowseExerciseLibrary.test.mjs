// backend/src/3_applications/fitness/usecases/BrowseExerciseLibrary.test.mjs
//
// The use case against the REAL repository and the REAL domain, over a small synthetic
// manifest written to a temp file. Nothing is stubbed but the corpus content, because
// the thing most worth protecting here is that a filter survives the trip from a query
// object into `exerciseMatchesFilter` unchanged — which a mocked repository would hide.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { BrowseExerciseLibrary, pickFacets } from './BrowseExerciseLibrary.mjs';
import { YamlExerciseLibraryRepository } from '#adapters/reference/exercise-library/index.mjs';

const silentLogger = { error() {}, warn() {}, info() {}, debug() {} };

// Five exercises across THREE groups and two equipment types, keyed in slug order the
// way the builder writes them. Three groups, not two, so that the union of two facet
// values is strictly narrower than the corpus — with two groups a broken OR that
// returned everything would still pass.
const MANIFEST = {
  version: 1,
  builtAt: '2026-08-11T00:00:00.000Z',
  assetsResolved: true,
  warnings: [],
  exercises: {
    'back-squat': {
      id: 'e1', name: 'Back Squat', description: 'A leg press under a bar.',
      instructions: ['Unrack.', 'Sit down and stand up.'], image: 'exercises/back-squat.png',
      targetMuscles: ['quads'], targetGroups: ['legs'],
      groups: ['legs'], equipment: ['barbell'],
    },
    'barbell-row': {
      id: 'e2', name: 'Barbell Row', description: 'A back pull.',
      instructions: ['Hinge.', 'Row the bar.'], image: 'exercises/barbell-row.png',
      targetMuscles: ['lats'], targetGroups: ['back'],
      groups: ['back'], equipment: ['barbell'],
    },
    'bench-press': {
      id: 'e3', name: 'Bench Press', description: 'A chest press.',
      instructions: ['Lie on the bench.', 'Press the bar up.'],
      image: 'exercises/bench-press.png', stills: ['exercises/bench-press_1.png'],
      video: 'hevy_videos/bench-press.mp4',
      targetMuscles: ['pectorals'], targetGroups: ['chest'],
      groups: ['chest'], equipment: ['barbell'],
    },
    'chest-fly': {
      id: 'e4', name: 'Chest Fly', description: 'A chest isolation.',
      instructions: ['Open the arms.'], image: 'exercises/chest-fly.png',
      targetMuscles: ['pectorals'], targetGroups: ['chest'],
      groups: ['chest'], equipment: ['dumbbell'],
    },
    'renegade-row': {
      id: 'e5', name: 'Renegade Row', description: 'A back pull from a plank.',
      instructions: ['Plank.', 'Row one arm.'], image: 'exercises/renegade-row.png',
      targetMuscles: ['lats', 'pectorals'], targetGroups: ['back'],
      groups: ['back', 'chest'], equipment: ['dumbbell'],
    },
  },
  muscles: {
    lats: {
      id: 'm1', name: 'Latissimus Dorsi', group: 'back',
      description: 'The broad muscle of the back.',
      fullDescription: 'A LONG ANATOMY ESSAY that School renders as reader content.',
      image: 'muscles/lats.png',
    },
    pectorals: {
      id: 'm2', name: 'Pectorals', group: 'chest',
      description: 'The chest muscles.',
      fullDescription: 'ANOTHER LONG ANATOMY ESSAY.',
      image: 'muscles/pectorals.png',
    },
    quads: {
      id: 'm3', name: 'Quadriceps', group: 'legs',
      description: 'The front of the thigh.',
      fullDescription: 'A THIRD LONG ANATOMY ESSAY.',
      image: 'muscles/quads.png',
    },
  },
  muscleGroups: {
    back: { id: 'g1', name: 'Back', description: 'The back.', muscles: ['lats'] },
    chest: { id: 'g2', name: 'Chest', description: 'The chest.', muscles: ['pectorals'] },
    legs: { id: 'g3', name: 'Legs', description: 'The legs.', muscles: ['quads'] },
  },
  equipment: {
    barbell: { id: 'q1', name: 'Barbell', description: 'A bar with plates.' },
    dumbbell: { id: 'q2', name: 'Dumbbell', description: 'A short handled weight.' },
  },
  byGroup: {
    back: ['barbell-row', 'renegade-row'],
    chest: ['bench-press', 'chest-fly', 'renegade-row'],
    legs: ['back-squat'],
  },
  byMuscle: {
    lats: ['barbell-row', 'renegade-row'],
    pectorals: ['bench-press', 'chest-fly', 'renegade-row'],
    quads: ['back-squat'],
  },
  byEquipment: {
    barbell: ['back-squat', 'barbell-row', 'bench-press'],
    dumbbell: ['chest-fly', 'renegade-row'],
  },
};

let tmpDir;
let browse;
let emptyBrowse;

/** Slugs of the matches, so an assertion reads as the answer rather than as objects. */
const slugsOf = (result) => result.exercises.map((e) => e.slug);

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exercise-browse-'));
  const indexPath = path.join(tmpDir, 'exercise-index.yml');
  fs.writeFileSync(indexPath, yaml.dump(MANIFEST), 'utf8');
  browse = new BrowseExerciseLibrary({
    exerciseLibrary: new YamlExerciseLibraryRepository({ indexPath, logger: silentLogger }).load(),
    logger: silentLogger,
  });
  // No manifest was ever built — the degraded state, from the real adapter.
  emptyBrowse = new BrowseExerciseLibrary({
    exerciseLibrary: new YamlExerciseLibraryRepository({
      indexPath: path.join(tmpDir, 'never-built.yml'), logger: silentLogger,
    }).load(),
    logger: silentLogger,
  });
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('BrowseExerciseLibrary construction', () => {
  it('refuses to be built without a library rather than failing per request', () => {
    expect(() => new BrowseExerciseLibrary({})).toThrow(/exerciseLibrary/);
  });
});

describe('filterFromQuery', () => {
  it('keeps the four facets and drops everything else', () => {
    const filter = pickFacets({
      group: 'chest', muscle: 'lats', equipment: 'barbell', q: 'row',
      household: 'main', _: '1729', limit: '10',
    });
    expect(filter).toEqual({ group: 'chest', muscle: 'lats', equipment: 'barbell', q: 'row' });
  });

  it('passes a repeated key through as the ARRAY qs produced, not a joined string', () => {
    const filter = pickFacets({ group: ['chest', 'back'] });
    expect(filter.group).toEqual(['chest', 'back']);
    expect(typeof filter.group).not.toBe('string');
  });

  it('passes a non-scalar facet through untouched, so the domain can reject it', () => {
    // `?group[x]=y`. Dropping it here would silently widen the query to the whole corpus.
    const filter = pickFacets({ group: { x: 'y' } });
    expect(filter).toHaveProperty('group');
    expect(filter.group).toEqual({ x: 'y' });
  });

  it('omits a facet the caller never sent, and ignores inherited keys', () => {
    expect(pickFacets({})).toEqual({});
    // A prototype-backed query object: `constructor` exists but was not sent.
    expect(Object.hasOwn(pickFacets({ q: 'row' }), 'group')).toBe(false);
  });

  it('survives a missing or non-object query', () => {
    expect(pickFacets()).toEqual({});
    expect(pickFacets(null)).toEqual({});
    expect(pickFacets('group=chest')).toEqual({});
  });

  it('is reachable from an instance, so a handler needs no import of this layer', () => {
    expect(browse.filterFromQuery({ group: ['chest', 'back'], household: 'main' }))
      .toEqual({ group: ['chest', 'back'] });
  });
});

describe('BrowseExerciseLibrary.listExercises', () => {
  it('returns the whole corpus for an empty filter', () => {
    const result = browse.listExercises({});
    expect(result.total).toBe(5);
    expect(slugsOf(result))
      .toEqual(['back-squat', 'barbell-row', 'bench-press', 'chest-fly', 'renegade-row']);
  });

  it('ORs within a facet: two groups is their union, still NARROWER than the corpus', () => {
    const chest = slugsOf(browse.listExercises({ group: 'chest' }));
    const back = slugsOf(browse.listExercises({ group: 'back' }));
    const both = slugsOf(browse.listExercises({ group: ['chest', 'back'] }));
    expect(chest).toEqual(['bench-press', 'chest-fly', 'renegade-row']);
    expect(back).toEqual(['barbell-row', 'renegade-row']);
    expect(both).toEqual(['barbell-row', 'bench-press', 'chest-fly', 'renegade-row']);
    // The union is the point, and so is what it EXCLUDES: a list facet that leaked
    // through as "no constraint" would drag back-squat in with everything else.
    expect(both).not.toContain('back-squat');
    expect(both.length).toBeLessThan(browse.listExercises({}).total);
  });

  it('treats a single-element list exactly like the bare scalar', () => {
    // The trap: reading "it's an array" as "not a scalar, so ignore it" answers this
    // with all five records instead of three.
    expect(slugsOf(browse.listExercises({ group: ['chest'] })))
      .toEqual(slugsOf(browse.listExercises({ group: 'chest' })));
    expect(browse.listExercises({ group: ['chest'] }).total).toBe(3);
  });

  it('ANDs across facets', () => {
    expect(slugsOf(browse.listExercises({ group: 'chest', equipment: 'barbell' })))
      .toEqual(['bench-press']);
    expect(slugsOf(browse.listExercises({ group: ['chest', 'back'], equipment: 'dumbbell' })))
      .toEqual(['chest-fly', 'renegade-row']);
    expect(slugsOf(browse.listExercises({ muscle: 'lats', equipment: 'dumbbell' })))
      .toEqual(['renegade-row']);
  });

  it('matches nothing — never everything — for an uninterpretable facet', () => {
    const result = browse.listExercises({ group: { evil: 'yes' } });
    expect(result.total).toBe(0);
    expect(result.exercises).toEqual([]);
  });

  it('matches nothing for a facet joined into one comma string, the classic transit bug', () => {
    // This is what `String(['chest','back'])` produces. Asserted so that a future
    // "normalization" that reintroduces it is visibly wrong rather than plausible.
    expect(browse.listExercises({ group: 'chest,back' }).total).toBe(0);
  });

  it('searches name and slug with q, folding separators', () => {
    expect(slugsOf(browse.listExercises({ q: 'row' })))
      .toEqual(['barbell-row', 'renegade-row']);
    expect(slugsOf(browse.listExercises({ q: 'BENCH press' }))).toEqual(['bench-press']);
    // q does NOT reach instruction prose: 'plank' appears only in renegade-row's steps.
    expect(browse.listExercises({ q: 'plank' }).total).toBe(0);
  });

  it('projects cards, not bodies: no instructions, description, stills or video', () => {
    const [card] = browse.listExercises({ q: 'bench' }).exercises;
    expect(card).toEqual({
      slug: 'bench-press',
      name: 'Bench Press',
      image: 'media/library/exercise/exercises/bench-press.png',
      groups: ['chest'],
      targetMuscles: ['pectorals'],
      equipment: ['barbell'],
    });
    for (const heavy of ['instructions', 'description', 'stills', 'video']) {
      expect(card).not.toHaveProperty(heavy);
    }
  });

  it('reports the corpus as available, with counts for an "N of M" header', () => {
    const { library } = browse.listExercises({ group: 'chest' });
    expect(library.available).toBe(true);
    expect(library.builtAt).toBe('2026-08-11T00:00:00.000Z');
    expect(library.counts).toEqual({ exercises: 5, muscles: 3, muscleGroups: 3, equipment: 2 });
    expect(library).not.toHaveProperty('hint');
  });
});

describe('BrowseExerciseLibrary.taxonomy', () => {
  it('returns all three rails in manifest order', () => {
    const tax = browse.taxonomy();
    expect(tax.groups.map((g) => g.slug)).toEqual(['back', 'chest', 'legs']);
    expect(tax.muscles.map((m) => m.slug)).toEqual(['lats', 'pectorals', 'quads']);
    expect(tax.equipment.map((e) => e.slug)).toEqual(['barbell', 'dumbbell']);
    expect(tax.library.available).toBe(true);
  });

  it('leaves the long-form anatomy essays out of the rail', () => {
    const [lats] = browse.taxonomy().muscles;
    expect(lats).toEqual({
      slug: 'lats',
      name: 'Latissimus Dorsi',
      group: 'back',
      description: 'The broad muscle of the back.',
      image: 'media/library/exercise/muscles/lats.png',
    });
    expect(lats).not.toHaveProperty('fullDescription');
  });
});

describe('BrowseExerciseLibrary.getExercise', () => {
  it('returns the full record, instructions and media included', () => {
    const exercise = browse.getExercise('bench-press');
    expect(exercise.instructions).toEqual(['Lie on the bench.', 'Press the bar up.']);
    expect(exercise.description).toBe('A chest press.');
    expect(exercise.video).toBe('media/library/exercise/hevy_videos/bench-press.mp4');
    expect(exercise.stills).toEqual(['media/library/exercise/exercises/bench-press_1.png']);
  });

  it('returns null for an unknown slug, including hostile ones', () => {
    expect(browse.getExercise('no-such-exercise')).toBeNull();
    expect(browse.getExercise('constructor')).toBeNull();
    expect(browse.getExercise('__proto__')).toBeNull();
    expect(browse.getExercise(undefined)).toBeNull();
  });
});

describe('BrowseExerciseLibrary with an unbuilt corpus', () => {
  it('serves an empty browse that says how to fix it', () => {
    const result = emptyBrowse.listExercises({});
    expect(result.exercises).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.library.available).toBe(false);
    expect(result.library.hint).toMatch(/npm run exercise:index/);
  });

  it('serves empty rails with the same hint rather than failing', () => {
    const tax = emptyBrowse.taxonomy();
    expect(tax).toMatchObject({ groups: [], muscles: [], equipment: [] });
    expect(tax.library.hint).toMatch(/npm run exercise:index/);
  });

  it('never puts the server-side index path in a payload bound for a browser', () => {
    expect(emptyBrowse.libraryStatus()).not.toHaveProperty('indexPath');
    expect(browse.libraryStatus()).not.toHaveProperty('indexPath');
  });
});
