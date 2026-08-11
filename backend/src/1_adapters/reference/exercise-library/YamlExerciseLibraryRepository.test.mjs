// backend/src/1_adapters/reference/exercise-library/YamlExerciseLibraryRepository.test.mjs
//
// The fixture manifest below is written as raw YAML TEXT rather than dumped from a JS
// object, for two reasons. It exercises the real load path (fileExists -> loadYamlSafe
// -> js-yaml) end to end, and it is the only way to write a mapping key of `__proto__`
// without the fixture builder itself falling into the prototype trap under test.
//
// Key order is deliberately NOT alphabetical, so any assertion about ordering is really
// about "manifest order preserved" rather than "happens to be sorted".

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  YamlExerciseLibraryRepository,
  DEFAULT_MEDIA_BASE,
} from './YamlExerciseLibraryRepository.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const MANIFEST = `
exercises:
  zebra-press:
    id: ex-1
    slug: zebra-press
    name: Zebra Press
    description: A press.
    instructions:
      - Set up.
      - Press.
    imageId: uuid-1
    image: assets/uuid-1.gif
    stills:
      - 'exercises/zebra press_1.png'
      - 'exercises/100%_effort_2.png'
    video: 'hevy_videos/Zebra-Press-(wide)_Chest.mp4'
    targetMuscles:
      - pectorals
    targetGroups:
      - chest
    groups:
      - chest
    equipment:
      - barbell
  alpha-curl:
    id: ex-2
    slug: alpha-curl
    name: Alpha Curl
    description: A curl.
    instructions:
      - Curl.
    imageId: uuid-2
    image: assets/uuid-2.gif
    stills: []
    video: null
    targetMuscles:
      - biceps
    targetGroups:
      - arms
    groups:
      - arms
    equipment:
      - dumbbell
  constructor:
    id: ex-3
    slug: constructor
    name: Constructor Crunch
    description: A hostile slug that the corpus is free to contain.
    instructions:
      - Crunch.
    imageId: uuid-3
    image: assets/uuid-3.gif
    stills: []
    video: null
    targetMuscles:
      - pectorals
    targetGroups:
      - chest
    groups:
      - chest
    equipment:
      - barbell
  ghost-hold:
    id: ex-4
    slug: ghost-hold
    name: Ghost Hold
    description: Names an image uuid that resolved to no file.
    instructions:
      - Hold.
    imageId: uuid-missing
    image: null
    stills: []
    video: null
    targetMuscles:
      - pectorals
      - biceps
    targetGroups:
      - chest
    groups:
      - chest
      - arms
    equipment:
      - barbell
      - dumbbell
muscles:
  pectorals:
    id: m-1
    slug: pectorals
    name: Pectorals
    group: chest
    description: Chest muscle.
    fullDescription: |-
      The pectoralis major is a thick, fan-shaped muscle of the anterior chest wall.

      It has a clavicular head and a sternocostal head, which act together in horizontal
      adduction and separately in flexion and extension of the humerus.
    imageId: uuid-m1
    image: assets/uuid-m1.png
  __proto__:
    id: m-2
    slug: __proto__
    name: Proto Muscle
    group: chest
    description: The slug that vanishes from a plain object.
    fullDescription: Written only to prove the map survives it.
    imageId: null
    image: null
  biceps:
    id: m-3
    slug: biceps
    name: Biceps
    group: arms
    description: Arm muscle.
    fullDescription: The biceps brachii is a two-headed muscle of the anterior arm.
    imageId: null
    image: null
muscleGroups:
  chest:
    id: g-1
    slug: chest
    name: Chest
    description: The chest.
    muscles:
      - pectorals
  arms:
    id: g-2
    slug: arms
    name: Arms
    description: The arms.
    muscles:
      - biceps
equipment:
  barbell:
    id: eq-1
    slug: barbell
    name: Barbell
    description: A bar.
  dumbbell:
    id: eq-2
    slug: dumbbell
    name: Dumbbell
    description: A short bar.
byGroup:
  chest:
    - constructor
    - ghost-hold
    - zebra-press
  arms:
    - alpha-curl
    - ghost-hold
byMuscle:
  pectorals:
    - constructor
    - ghost-hold
    - zebra-press
  biceps:
    - alpha-curl
    - ghost-hold
  constructor:
    - zebra-press
byEquipment:
  barbell:
    - constructor
    - ghost-hold
    - zebra-press
  dumbbell:
    - alpha-curl
    - ghost-hold
warnings:
  - kind: unmatched-video
    subject: Nothing_Waist.mp4
    referrer: hevy-video
    referencedBy: null
    count: 1
assetsResolved: true
builtAt: '2026-08-11T23:02:13.178Z'
version: 1
`;

/** Every slug in the fixture, in the order the manifest writes them. */
const MANIFEST_ORDER = ['zebra-press', 'alpha-curl', 'constructor', 'ghost-hold'];

function slugsOf(exercises) {
  return exercises.map((exercise) => exercise.slug);
}

function makeLogger() {
  const events = { debug: [], info: [], warn: [], error: [] };
  const record = (level) => (event, data) => events[level].push({ event, data });
  return {
    events,
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    warnEvents: () => events.warn.map((entry) => entry.event),
  };
}

describe('YamlExerciseLibraryRepository', () => {
  let tmpDir;
  let indexPath;
  let logger;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exercise-library-'));
    indexPath = path.join(tmpDir, 'exercise-index.yml');
    fs.writeFileSync(indexPath, MANIFEST, 'utf8');
    logger = makeLogger();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const build = (overrides = {}) => new YamlExerciseLibraryRepository({
    indexPath,
    logger,
    ...overrides,
  });

  // ------------------------------------------------------------------------
  // taxonomies
  // ------------------------------------------------------------------------

  describe('taxonomies', () => {
    it('lists muscle groups as domain objects in manifest order', () => {
      const groups = build().listGroups();
      // 'arms' sorts before 'chest'; the manifest writes chest first. Asserting the
      // manifest's order (not the sorted one) is what makes this catch a stray sort.
      expect(groups.map((group) => group.slug)).toEqual(['chest', 'arms']);
      expect(groups[0]).toEqual({
        id: 'g-1',
        slug: 'chest',
        name: 'Chest',
        description: 'The chest.',
        muscles: ['pectorals'],
      });
      expect(Object.isFrozen(groups[0])).toBe(true);
    });

    it('lists muscles in manifest order, including the essay School renders', () => {
      const muscles = build().listMuscles();
      expect(muscles.map((muscle) => muscle.slug)).toEqual(['pectorals', '__proto__', 'biceps']);
      expect(muscles[0].fullDescription).toContain('pectoralis major is a thick, fan-shaped');
      expect(muscles[0].fullDescription).toContain('clavicular head');
      expect(muscles[0].group).toBe('chest');
    });

    it('lists equipment in manifest order', () => {
      expect(build().listEquipment().map((item) => item.slug)).toEqual(['barbell', 'dumbbell']);
    });

    it('reports load state and counts through meta', () => {
      const meta = build().meta;
      expect(meta.available).toBe(true);
      expect(meta.builtAt).toBe('2026-08-11T23:02:13.178Z');
      expect(meta.version).toBe(1);
      expect(meta.assetsResolved).toBe(true);
      expect(meta.warningCount).toBe(1);
      expect(meta.counts).toEqual({
        exercises: 4, muscles: 3, muscleGroups: 2, equipment: 2,
      });
    });
  });

  // ------------------------------------------------------------------------
  // media paths
  // ------------------------------------------------------------------------

  describe('media paths', () => {
    it('resolves corpus-relative paths against the default media base', () => {
      const exercise = build().getExercise('zebra-press');
      expect(exercise.image).toBe(`${DEFAULT_MEDIA_BASE}/assets/uuid-1.gif`);
      expect(exercise.video).toBe(`${DEFAULT_MEDIA_BASE}/hevy_videos/Zebra-Press-(wide)_Chest.mp4`);
      expect(exercise.imageId).toBe('uuid-1');
    });

    it('percent-encodes each path segment but not the separators', () => {
      const exercise = build().getExercise('zebra-press');
      expect(exercise.stills).toEqual([
        `${DEFAULT_MEDIA_BASE}/exercises/zebra%20press_1.png`,
        `${DEFAULT_MEDIA_BASE}/exercises/100%25_effort_2.png`,
      ]);
    });

    it('resolves muscle plates too', () => {
      expect(build().getMuscle('pectorals').image)
        .toBe(`${DEFAULT_MEDIA_BASE}/assets/uuid-m1.png`);
    });

    it('leaves an unresolved asset null instead of fabricating a path from imageId', () => {
      // The builder writes image:null when an image uuid resolved to no file on disk.
      // Reconstructing `assets/<imageId>.gif` here would put a permanently broken <img>
      // in front of the user for every content gap in the corpus.
      const exercise = build().getExercise('ghost-hold');
      expect(exercise.imageId).toBe('uuid-missing');
      expect(exercise.image).toBeNull();
      expect(exercise.video).toBeNull();
      expect(exercise.stills).toEqual([]);
    });

    it('honours an injected media base and trims its trailing slash', () => {
      const repo = build({ mediaBase: '/api/v1/proxy/media/library/exercise/' });
      expect(repo.getExercise('alpha-curl').image)
        .toBe('/api/v1/proxy/media/library/exercise/assets/uuid-2.gif');
    });

    it('falls back to the default media base when none is supplied', () => {
      const repo = new YamlExerciseLibraryRepository({ indexPath, mediaBase: '   ', logger });
      expect(repo.getExercise('alpha-curl').image).toBe(`${DEFAULT_MEDIA_BASE}/assets/uuid-2.gif`);
    });
  });

  // ------------------------------------------------------------------------
  // filtering
  // ------------------------------------------------------------------------

  describe('findExercises', () => {
    it('returns the whole corpus in manifest order for an empty filter', () => {
      expect(slugsOf(build().findExercises())).toEqual(MANIFEST_ORDER);
      expect(slugsOf(build().findExercises({}))).toEqual(MANIFEST_ORDER);
    });

    it('filters on a scalar facet', () => {
      expect(slugsOf(build().findExercises({ group: 'arms' })))
        .toEqual(['alpha-curl', 'ghost-hold']);
    });

    it('ORs the members of a list facet', () => {
      // A `String(filter.group)` anywhere on the way through would make this
      // 'chest,arms', which matches nothing at all.
      expect(slugsOf(build().findExercises({ group: ['chest', 'arms'] })))
        .toEqual(MANIFEST_ORDER);
      expect(slugsOf(build().findExercises({ muscle: ['biceps'] })))
        .toEqual(['alpha-curl', 'ghost-hold']);
      expect(slugsOf(build().findExercises({ equipment: ['dumbbell', 'barbell'] })))
        .toEqual(MANIFEST_ORDER);
    });

    it('ANDs across facets', () => {
      expect(slugsOf(build().findExercises({ group: ['chest', 'arms'], equipment: 'dumbbell' })))
        .toEqual(['alpha-curl', 'ghost-hold']);
      expect(slugsOf(build().findExercises({ group: 'chest', muscle: 'biceps' })))
        .toEqual(['ghost-hold']);
    });

    it('matches free text against name and slug', () => {
      expect(slugsOf(build().findExercises({ q: 'zebra press' }))).toEqual(['zebra-press']);
      expect(slugsOf(build().findExercises({ q: 'ghost-hold' }))).toEqual(['ghost-hold']);
      // Description and instruction text are deliberately not searched: 'resolved'
      // appears only in ghost-hold's description, and 'press.' only in an instruction.
      expect(slugsOf(build().findExercises({ q: 'resolved' }))).toEqual([]);
      expect(slugsOf(build().findExercises({ q: 'set up' }))).toEqual([]);
    });

    it('returns an empty list rather than everything for a filter nothing satisfies', () => {
      expect(build().findExercises({ group: 'no-such-group' })).toEqual([]);
    });
  });

  // ------------------------------------------------------------------------
  // hostile slugs — the null-prototype contract
  // ------------------------------------------------------------------------

  describe('hostile slugs', () => {
    it('returns null for inherited property names that are not corpus records', () => {
      const repo = build();
      for (const slug of ['toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf']) {
        expect(repo.getExercise(slug), slug).toBeNull();
        expect(repo.getMuscle(slug), slug).toBeNull();
      }
    });

    it('serves an exercise whose slug is `constructor`', () => {
      const exercise = build().getExercise('constructor');
      expect(exercise).not.toBeNull();
      expect(typeof exercise).toBe('object');
      expect(exercise.slug).toBe('constructor');
      expect(exercise.name).toBe('Constructor Crunch');
      expect(slugsOf(build().findExercises({ q: 'constructor crunch' }))).toEqual(['constructor']);
    });

    it('serves a muscle whose slug is `__proto__`', () => {
      // On a plain object `map['__proto__'] = record` invokes the prototype setter and
      // creates no own property at all, so this record would silently disappear — and
      // take the map's prototype with it.
      const muscle = build().getMuscle('__proto__');
      expect(muscle).not.toBeNull();
      expect(muscle.slug).toBe('__proto__');
      expect(muscle.name).toBe('Proto Muscle');
      expect(build().listMuscles().map((m) => m.slug)).toContain('__proto__');
    });

    it('reads the inverted indexes safely', () => {
      const repo = build();
      expect(repo.listExerciseSlugsBy('muscle', 'pectorals'))
        .toEqual(['constructor', 'ghost-hold', 'zebra-press']);
      expect(repo.listExerciseSlugsBy('muscle', 'constructor')).toEqual(['zebra-press']);
      expect(repo.listExerciseSlugsBy('muscle', 'toString')).toEqual([]);
      expect(repo.listExerciseSlugsBy('group', 'arms')).toEqual(['alpha-curl', 'ghost-hold']);
      expect(repo.listExerciseSlugsBy('equipment', 'dumbbell')).toEqual(['alpha-curl', 'ghost-hold']);
    });

    it('rejects a hostile facet name instead of dereferencing a prototype member', () => {
      const repo = build();
      expect(repo.listExerciseSlugsBy('constructor', 'pectorals')).toEqual([]);
      expect(repo.listExerciseSlugsBy('__proto__', 'pectorals')).toEqual([]);
      expect(repo.listExerciseSlugsBy('nope', 'pectorals')).toEqual([]);
    });

    it('ignores non-string slugs', () => {
      const repo = build();
      expect(repo.getExercise(undefined)).toBeNull();
      expect(repo.getExercise({ slug: 'zebra-press' })).toBeNull();
      expect(repo.getMuscle(null)).toBeNull();
      expect(repo.listExerciseSlugsBy('muscle', null)).toEqual([]);
    });

    it('does not coerce a non-string slug into a key', () => {
      // `req.query.slug` is whatever the client sent. A value that explodes when
      // stringified must produce a 404-shaped null, not a 500 out of the repository —
      // and property access would stringify it before the lookup.
      const repo = build();
      const hostile = { toString() { throw new Error('boom'); } };
      expect(() => repo.getExercise(hostile)).not.toThrow();
      expect(repo.getExercise(hostile)).toBeNull();
      expect(repo.getMuscle(hostile)).toBeNull();
      expect(repo.listExerciseSlugsBy('muscle', hostile)).toEqual([]);
    });
  });

  // ------------------------------------------------------------------------
  // degraded manifests — boot must survive all of these
  // ------------------------------------------------------------------------

  describe('degraded manifests', () => {
    const expectEmptyCorpus = (repo) => {
      expect(repo.listGroups()).toEqual([]);
      expect(repo.listMuscles()).toEqual([]);
      expect(repo.listEquipment()).toEqual([]);
      expect(repo.findExercises()).toEqual([]);
      expect(repo.findExercises({ group: 'chest' })).toEqual([]);
      expect(repo.getExercise('zebra-press')).toBeNull();
      expect(repo.getMuscle('pectorals')).toBeNull();
      expect(repo.listExerciseSlugsBy('muscle', 'pectorals')).toEqual([]);
      expect(repo.meta.available).toBe(false);
      expect(repo.meta.counts).toEqual({
        exercises: 0, muscles: 0, muscleGroups: 0, equipment: 0,
      });
    };

    it('serves an empty corpus and warns when the manifest does not exist', () => {
      const repo = new YamlExerciseLibraryRepository({
        indexPath: path.join(tmpDir, 'nope', 'exercise-index.yml'),
        logger,
      });
      expect(() => repo.load()).not.toThrow();
      expectEmptyCorpus(repo);
      expect(logger.warnEvents()).toContain('exercise-library.manifest.missing');
    });

    it('serves an empty corpus and warns when no indexPath is configured', () => {
      const repo = new YamlExerciseLibraryRepository({ logger });
      expectEmptyCorpus(repo);
      expect(logger.warnEvents()).toContain('exercise-library.manifest.unconfigured');
    });

    it('serves an empty corpus and warns when the manifest is truncated mid-document', () => {
      // A half-copied file: valid up to the cut, then a mapping that never closes.
      fs.writeFileSync(indexPath, MANIFEST.slice(0, 900).concat('\n  - [unclosed\n'), 'utf8');
      const repo = build();
      expectEmptyCorpus(repo);
      expect(logger.warnEvents()).toContain('exercise-library.manifest.unreadable');
    });

    it('serves an empty corpus and warns when the manifest is not a mapping', () => {
      fs.writeFileSync(indexPath, '- exercises\n- muscles\n', 'utf8');
      const repo = build();
      expectEmptyCorpus(repo);
      expect(logger.warnEvents()).toContain('exercise-library.manifest.malformed');
    });

    it('serves an empty corpus when the manifest is empty', () => {
      fs.writeFileSync(indexPath, '', 'utf8');
      const repo = build();
      expectEmptyCorpus(repo);
      expect(logger.warnEvents()).toContain('exercise-library.manifest.unreadable');
    });

    it('serves whatever collections a partial manifest does carry', () => {
      fs.writeFileSync(indexPath, [
        'exercises:',
        '  solo:',
        '    slug: solo',
        '    name: Solo',
        '    groups: [chest]',
        '    targetMuscles: []',
        '    equipment: []',
        'version: 1',
      ].join('\n'), 'utf8');
      const repo = build();
      expect(slugsOf(repo.findExercises())).toEqual(['solo']);
      expect(repo.listMuscles()).toEqual([]);
      expect(repo.listGroups()).toEqual([]);
      expect(repo.meta.available).toBe(true);
    });

    it('skips collection entries that are not mappings', () => {
      fs.writeFileSync(indexPath, [
        'exercises:',
        '  good:',
        '    slug: good',
        '    name: Good',
        '    groups: []',
        '    targetMuscles: []',
        '    equipment: []',
        '  broken: null',
        '  alsoBroken:',
        '    - not',
        '    - a mapping',
        'version: 1',
      ].join('\n'), 'utf8');
      const repo = build();
      expect(slugsOf(repo.findExercises())).toEqual(['good']);
      expect(repo.getExercise('broken')).toBeNull();
      expect(repo.getExercise('alsoBroken')).toBeNull();
    });

    it('lets the map key, not the record body, decide a record identity', () => {
      // A real corpus defect: the builder reports `slug-mismatch` when a record's own
      // `slug:` disagrees with its filename, and keys the manifest by the filename
      // because every cross-reference in the corpus is written against paths. Honouring
      // the record body instead would hand back an object whose `slug` no longer
      // addresses it — a detail link that 404s on the thing it was just rendered from.
      fs.writeFileSync(indexPath, [
        'exercises:',
        '  renamed-row:',
        '    slug: old-row-name',
        '    name: Renamed Row',
        '    groups: [back]',
        '    targetMuscles: []',
        '    equipment: []',
        'muscles:',
        '  renamed-lat:',
        '    slug: old-lat-name',
        '    name: Renamed Lat',
        '    group: back',
        'version: 1',
      ].join('\n'), 'utf8');
      const repo = build();

      expect(repo.getExercise('renamed-row')?.slug).toBe('renamed-row');
      expect(repo.getExercise('old-row-name')).toBeNull();
      expect(repo.getMuscle('renamed-lat')?.slug).toBe('renamed-lat');
      expect(repo.getMuscle('old-lat-name')).toBeNull();
      // ...and a browse hit still addresses itself.
      const [found] = repo.findExercises({ q: 'renamed row' });
      expect(repo.getExercise(found.slug)).toBe(found);
    });

    it('serves a manifest whose schema version it does not recognize, with a warning', () => {
      fs.writeFileSync(indexPath, MANIFEST.replace('version: 1', 'version: 99'), 'utf8');
      const repo = build();
      expect(slugsOf(repo.findExercises())).toEqual(MANIFEST_ORDER);
      expect(repo.meta.version).toBe(99);
      expect(logger.warnEvents()).toContain('exercise-library.manifest.version');
    });
  });

  // ------------------------------------------------------------------------
  // caching and isolation
  // ------------------------------------------------------------------------

  describe('caching', () => {
    it('parses the manifest once and never re-reads it', () => {
      const repo = build();
      expect(slugsOf(repo.findExercises())).toEqual(MANIFEST_ORDER);

      // If any read re-parsed, this would collapse the corpus to empty.
      fs.rmSync(indexPath);
      fs.writeFileSync(indexPath, 'exercises: [unclosed\n', 'utf8');

      expect(slugsOf(repo.findExercises())).toEqual(MANIFEST_ORDER);
      expect(repo.getExercise('zebra-press').name).toBe('Zebra Press');
      expect(repo.listMuscles()).toHaveLength(3);
      expect(repo.meta.counts.exercises).toBe(4);
    });

    it('load() is idempotent and chainable', () => {
      const repo = build();
      expect(repo.load()).toBe(repo);
      const before = repo.getExercise('zebra-press');
      repo.load();
      repo.load();
      // Same frozen instance: a second parse would produce a structurally equal but
      // distinct object, and would have logged a second load.
      expect(repo.getExercise('zebra-press')).toBe(before);
      expect(logger.events.info.filter((e) => e.event === 'exercise-library.loaded'))
        .toHaveLength(1);
    });

    it('hands out copies, so a caller cannot corrupt the shared corpus', () => {
      const repo = build();

      const groups = repo.listGroups();
      groups.pop();
      expect(repo.listGroups()).toHaveLength(2);

      const muscles = repo.listMuscles();
      muscles.length = 0;
      expect(repo.listMuscles()).toHaveLength(3);

      const equipment = repo.listEquipment();
      equipment.push('junk');
      expect(repo.listEquipment()).toHaveLength(2);

      const found = repo.findExercises();
      found.length = 0;
      expect(repo.findExercises()).toHaveLength(4);

      const slugs = repo.listExerciseSlugsBy('muscle', 'pectorals');
      slugs.pop();
      expect(repo.listExerciseSlugsBy('muscle', 'pectorals')).toHaveLength(3);
    });

    it('freezes the domain objects it serves', () => {
      const exercise = build().getExercise('zebra-press');
      expect(Object.isFrozen(exercise)).toBe(true);
      expect(Object.isFrozen(exercise.instructions)).toBe(true);
      expect(() => { exercise.name = 'mutated'; }).toThrow(TypeError);
    });
  });

  // ------------------------------------------------------------------------
  // constraint 1 — the corpus is never walked
  // ------------------------------------------------------------------------

  describe('corpus isolation', () => {
    it('reaches the filesystem only through fileExists/loadYamlSafe on the manifest', () => {
      // The corpus is 437 MB of online-only cloud placeholders; one cold read has
      // measured >120s. This is a structural assertion because the failure mode it
      // guards against is a *new* call added later, not a wrong answer today.
      const source = fs.readFileSync(
        path.join(HERE, 'YamlExerciseLibraryRepository.mjs'),
        'utf8',
      );
      const imports = source.match(/import\s*\{([^}]*)\}\s*from\s*'#system\/utils\/FileIO\.mjs'/);
      expect(imports, 'FileIO import block').not.toBeNull();
      expect(imports[1].split(',').map((name) => name.trim()).filter(Boolean).sort())
        .toEqual(['fileExists', 'loadYamlSafe']);

      for (const forbidden of [
        'node:fs', 'from \'fs\'', 'readdir', 'listFiles', 'listEntries', 'listDirs',
        'dirExists', 'listYamlFiles', 'statSync', 'globSync',
      ]) {
        expect(source.includes(forbidden), `must not reference ${forbidden}`).toBe(false);
      }
    });
  });
});
