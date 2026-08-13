import { describe, it, expect } from 'vitest';
import {
  ExerciseLibraryCatalogSource,
  buildAnatomyCatalog,
  buildMuscleDocument,
  buildEquipmentDocument,
  toParagraphs,
  toSafeId,
  muscleDocumentId,
} from './ExerciseLibraryCatalogSource.mjs';
import {
  validateLearningCatalog,
  validateLearningDocument,
} from '#domains/school/catalog/index.mjs';
import { BuildLearningLesson } from '#apps/school/catalog/BuildLearningLesson.mjs';

// ---------------------------------------------------------------------------
// A fake corpus with the SHAPES the real manifest has: single-newline essays,
// an over-long exercise slug, an exercise with no instructions.
// ---------------------------------------------------------------------------

const LONG_SLUG = 'dumbbell-seated-biceps-curl-on-exercise-ball-with-leg-raised-single-arm';

function makeLibrary(overrides = {}) {
  const groups = overrides.groups ?? [
    { slug: 'upper-arms', name: 'Upper Arms', description: 'The arm between shoulder and elbow.' },
    { slug: 'core', name: 'Core', description: '' },
  ];
  const muscles = overrides.muscles ?? [
    {
      slug: 'biceps',
      name: 'Biceps',
      group: 'upper-arms',
      description: 'Front of the upper arm.',
      fullDescription: 'The biceps brachii has two heads.\nThe long head crosses the shoulder.\n\nIt supinates the forearm.',
    },
    {
      slug: 'triceps',
      name: 'Triceps',
      group: 'upper-arms',
      description: '',
      fullDescription: 'The triceps brachii extends the elbow.',
    },
    { slug: 'abs', name: 'Abs', group: 'core', fullDescription: 'The rectus abdominis flexes the trunk.' },
  ];
  const equipment = overrides.equipment ?? [
    { slug: 'barbell', name: 'Barbell', description: 'A long metal bar with plates.' },
    { slug: 'band', name: 'Band', description: 'An elastic band providing resistance.' },
  ];
  const exercises = overrides.exercises ?? {
    biceps: [
      { slug: 'barbell-curl', name: 'Barbell Curl', description: 'A biceps builder.', instructions: ['Stand tall.', 'Curl the bar.'] },
      { slug: 'no-steps-exercise', name: 'Broken', description: 'x', instructions: [] },
      { slug: LONG_SLUG, name: 'Seated Ball Curl', description: '', instructions: ['Sit on the ball.'] },
    ],
    triceps: [],
    abs: [{ slug: 'sit-up', name: 'Sit-Up', instructions: ['Lie down.', 'Sit up.'] }],
  };
  const byId = new Map();
  for (const list of Object.values(exercises)) for (const e of list) byId.set(e.slug, e);

  return {
    listGroups: () => groups,
    listMuscles: () => muscles,
    listEquipment: () => equipment,
    listExerciseSlugsBy: (facet, slug) => (facet === 'muscle' ? (exercises[slug] ?? []).map((e) => e.slug) : []),
    getExercise: (slug) => byId.get(slug) ?? null,
    ...overrides.methods,
  };
}

const silentLogger = { info() {}, warn() {}, error() {} };

function recordingLogger() {
  const events = [];
  const push = (level) => (event, data) => events.push({ level, event, data });
  return { events, info: push('info'), warn: push('warn'), error: push('error') };
}

// ---------------------------------------------------------------------------

describe('toParagraphs', () => {
  it('splits on SINGLE newlines, not only blank lines', () => {
    // 21 of the 38 real essays use single newlines; splitting on /\n\n/ alone
    // collapses them into one multi-thousand-character block.
    const paragraphs = toParagraphs('One.\nTwo.\n\nThree.');
    expect(paragraphs).toEqual(['One.', 'Two.', 'Three.']);
  });

  it('drops blank and whitespace-only lines', () => {
    expect(toParagraphs('A.\n\n   \n\nB.')).toEqual(['A.', 'B.']);
  });

  it('returns an empty list for absent prose', () => {
    expect(toParagraphs(null)).toEqual([]);
    expect(toParagraphs('   ')).toEqual([]);
  });
});

describe('toSafeId', () => {
  it('keeps a corpus slug that is already a valid id', () => {
    expect(toSafeId('barbell-curl', 'fallback')).toBe('barbell-curl');
  });

  it('shortens an over-long slug without colliding near-identical variants', () => {
    const a = `${LONG_SLUG}`;
    const b = `${LONG_SLUG}-variation`;
    const idA = toSafeId(a, 'f1');
    const idB = toSafeId(b, 'f2');
    expect(idA.length).toBeLessThanOrEqual(64);
    expect(idB.length).toBeLessThanOrEqual(64);
    expect(idA).not.toBe(idB); // truncation alone would have collided these
    expect(idA).toMatch(/^[a-z0-9][a-z0-9-]{0,63}$/);
  });
});

describe('buildMuscleDocument', () => {
  it('renders the essay as one prose block per paragraph, and validates', () => {
    const document = buildMuscleDocument({
      slug: 'biceps', name: 'Biceps',
      fullDescription: 'First paragraph.\nSecond paragraph.',
    });
    expect(document.schema).toBe('school.learning-document/v1');
    expect(document.documentId).toBe('anatomy:biceps');
    expect(document.title).toBe('Biceps');
    expect(document.blocks).toEqual([
      { blockId: 'p1', type: 'prose', text: 'First paragraph.' },
      { blockId: 'p2', type: 'prose', text: 'Second paragraph.' },
    ]);
    expect(validateLearningDocument(document).errors).toEqual([]);
  });

  it('carries the ACTUAL prose, not just a well-formed shell', () => {
    // Guards the "drop fullDescription" mutation: a document of the right shape
    // whose blocks lost the essay text must not pass.
    const essay = 'The biceps brachii has two heads and supinates the forearm.';
    const document = buildMuscleDocument({ slug: 'biceps', name: 'Biceps', fullDescription: essay });
    const rendered = document.blocks.map((b) => b.text).join('\n');
    expect(rendered).toContain('supinates the forearm');
    expect(document.blocks.every((b) => typeof b.text === 'string' && b.text.length > 0)).toBe(true);
  });

  it('uses only block types LearningContentReader can display', () => {
    // The reader falls through to <p>{block.text}</p>, so `definition` and
    // `asset` blocks would validate but render BLANK.
    const document = buildMuscleDocument({ slug: 'abs', name: 'Abs', fullDescription: 'Text.' });
    const renderable = new Set(['prose', 'heading', 'table', 'worked_example', 'formula', 'callout']);
    for (const block of document.blocks) expect(renderable.has(block.type)).toBe(true);
  });

  it('returns null when the muscle carries no prose', () => {
    expect(buildMuscleDocument({ slug: 'x', name: 'X', fullDescription: '' })).toBeNull();
  });
});

describe('buildEquipmentDocument', () => {
  it('builds a validating guide with a heading and prose per item', () => {
    const document = buildEquipmentDocument([
      { slug: 'barbell', name: 'Barbell', description: 'A long metal bar.' },
    ]);
    expect(validateLearningDocument(document).errors).toEqual([]);
    expect(document.documentId).toBe('anatomy:equipment');
    expect(document.blocks).toEqual([
      { blockId: 'b1', type: 'heading', level: 2, text: 'Barbell' },
      { blockId: 'b2', type: 'prose', text: 'A long metal bar.' },
    ]);
  });

  it('skips items missing a name or description rather than emitting empty blocks', () => {
    const document = buildEquipmentDocument([
      { slug: 'barbell', name: 'Barbell', description: 'Real.' },
      { slug: 'ghost', name: 'Ghost', description: '' },
    ]);
    expect(document.blocks).toHaveLength(2);
    expect(validateLearningDocument(document).errors).toEqual([]);
  });

  it('returns null when nothing is describable', () => {
    expect(buildEquipmentDocument([{ slug: 'x', name: 'X', description: '' }])).toBeNull();
  });
});

describe('buildAnatomyCatalog', () => {
  const library = makeLibrary();
  const catalog = buildAnatomyCatalog({
    groups: library.listGroups(),
    muscles: library.listMuscles(),
    equipment: library.listEquipment(),
    examplesByMuscle: (slug) => library.listExerciseSlugsBy('muscle', slug).map(library.getExercise),
  });

  it('passes the REAL school.catalog/v1 validator', () => {
    expect(validateLearningCatalog(catalog).errors).toEqual([]);
  });

  it('maps muscle groups to units and muscles to lessons', () => {
    const course = catalog.subjects[0].courses.find((c) => c.courseId === 'muscles');
    expect(course.units.map((u) => u.unitId)).toEqual(['upper-arms', 'core']);
    const upperArms = course.units[0];
    expect(upperArms.title).toBe('Upper Arms');
    expect(upperArms.lessons.map((l) => l.lessonId)).toEqual(['biceps', 'triceps']);
  });

  it('gives every muscle lesson a lecture_notes module pointing at its document', () => {
    const biceps = catalog.subjects[0].courses[0].units[0].lessons[0];
    const notes = biceps.modules.find((m) => m.type === 'lecture_notes');
    expect(notes.documentId).toBe(muscleDocumentId('biceps'));
  });

  it('adds an examples module built from real instruction steps', () => {
    const biceps = catalog.subjects[0].courses[0].units[0].lessons[0];
    const examples = biceps.modules.find((m) => m.type === 'examples');
    expect(examples.examples.length).toBeGreaterThan(0);
    const curl = examples.examples.find((e) => e.exampleId === 'barbell-curl');
    expect(curl.prompt).toContain('Barbell Curl');
    expect(curl.steps).toEqual(['Stand tall.', 'Curl the bar.']);
  });

  it('omits exercises that have no usable steps', () => {
    const biceps = catalog.subjects[0].courses[0].units[0].lessons[0];
    const examples = biceps.modules.find((m) => m.type === 'examples');
    expect(examples.examples.map((e) => e.exampleId)).not.toContain('no-steps-exercise');
  });

  it('omits the examples module entirely when a muscle has no exercises', () => {
    const triceps = catalog.subjects[0].courses[0].units[0].lessons[1];
    expect(triceps.modules.map((m) => m.type)).toEqual(['lecture_notes']);
  });

  it('caps examples per muscle', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      slug: `ex-${i}`, name: `Exercise ${i}`, instructions: ['Do it.'],
    }));
    const capped = buildAnatomyCatalog({
      groups: [{ slug: 'core', name: 'Core' }],
      muscles: [{ slug: 'abs', name: 'Abs', group: 'core', fullDescription: 'Prose.' }],
      equipment: [],
      examplesByMuscle: () => many,
      maxExamples: 4,
    });
    const examples = capped.subjects[0].courses[0].units[0].lessons[0].modules[1];
    expect(examples.examples).toHaveLength(4);
    expect(validateLearningCatalog(capped).errors).toEqual([]);
  });

  it('publishes equipment as its own course', () => {
    const equipmentCourse = catalog.subjects[0].courses.find((c) => c.courseId === 'equipment');
    expect(equipmentCourse.units[0].lessons[0].modules[0].documentId).toBe('anatomy:equipment');
  });

  it('drops a group that has no muscles instead of emitting an invalid empty unit', () => {
    const built = buildAnatomyCatalog({
      groups: [{ slug: 'core', name: 'Core' }, { slug: 'ghost', name: 'Ghost' }],
      muscles: [{ slug: 'abs', name: 'Abs', group: 'core', fullDescription: 'Prose.' }],
      equipment: [],
    });
    expect(built.subjects[0].courses[0].units.map((u) => u.unitId)).toEqual(['core']);
    expect(validateLearningCatalog(built).errors).toEqual([]);
  });

  it('returns null — not an invalid husk — when the corpus is empty', () => {
    expect(buildAnatomyCatalog({ groups: [], muscles: [], equipment: [] })).toBeNull();
  });

  it('omits an empty description rather than emitting one the header rule rejects', () => {
    const core = catalog.subjects[0].courses[0].units[1];
    expect(core).not.toHaveProperty('description');
    expect(validateLearningCatalog(catalog).errors).toEqual([]);
  });
});

describe('ExerciseLibraryCatalogSource', () => {
  it('publishes a catalog with REAL lessons — an empty list is a failure, not "no content yet"', async () => {
    const source = new ExerciseLibraryCatalogSource({ exerciseLibrary: makeLibrary(), logger: silentLogger });
    const listed = await source.listCatalogs();
    expect(listed).toEqual([{ catalogId: 'anatomy', title: 'Anatomy & Movement' }]);

    const catalog = await source.getCatalog('anatomy');
    expect(catalog).not.toBeNull();
    // The distinguishing assertion: a source that silently returns nothing looks
    // identical to a working one unless the CONTENT is asserted.
    const lessons = catalog.subjects
      .flatMap((s) => s.courses).flatMap((c) => c.units).flatMap((u) => u.lessons);
    expect(lessons.length).toBeGreaterThanOrEqual(4);
    expect(lessons.map((l) => l.lessonId)).toContain('biceps');
    expect(lessons.every((l) => l.modules.length > 0)).toBe(true);
  });

  it('serves each muscle document with its prose intact', async () => {
    const source = new ExerciseLibraryCatalogSource({ exerciseLibrary: makeLibrary(), logger: silentLogger });
    const document = await source.getDocument('anatomy:biceps');
    expect(document.blocks.map((b) => b.text).join(' ')).toContain('supinates the forearm');
    expect(validateLearningDocument(document).errors).toEqual([]);
  });

  it('serves every documentId its own catalog references', async () => {
    // The integration invariant: BuildLearningLesson throws if a referenced
    // document is missing, so every lecture_notes module must resolve.
    const source = new ExerciseLibraryCatalogSource({ exerciseLibrary: makeLibrary(), logger: silentLogger });
    const catalog = await source.getCatalog('anatomy');
    const referenced = catalog.subjects
      .flatMap((s) => s.courses).flatMap((c) => c.units).flatMap((u) => u.lessons)
      .flatMap((l) => l.modules).filter((m) => m.type === 'lecture_notes').map((m) => m.documentId);
    expect(referenced.length).toBeGreaterThan(0);
    for (const documentId of referenced) {
      // eslint-disable-next-line no-await-in-loop
      expect(await source.getDocument(documentId), `missing ${documentId}`).not.toBeNull();
    }
  });

  it('returns null for an unknown catalog or document', async () => {
    const source = new ExerciseLibraryCatalogSource({ exerciseLibrary: makeLibrary(), logger: silentLogger });
    expect(await source.getCatalog('something-else')).toBeNull();
    expect(await source.getDocument('anatomy:nope')).toBeNull();
    expect(await source.getQuestionBank('any')).toBeNull();
  });

  it('hands back copies, so a caller cannot corrupt the shared projection', async () => {
    const source = new ExerciseLibraryCatalogSource({ exerciseLibrary: makeLibrary(), logger: silentLogger });
    const first = await source.getCatalog('anatomy');
    first.subjects.length = 0;
    const second = await source.getCatalog('anatomy');
    expect(second.subjects.length).toBeGreaterThan(0);
  });

  it('publishes NOTHING (never an invalid catalog) when the corpus is unavailable', async () => {
    const logger = recordingLogger();
    const empty = makeLibrary({ groups: [], muscles: [], equipment: [] });
    const source = new ExerciseLibraryCatalogSource({ exerciseLibrary: empty, logger });
    expect(await source.listCatalogs()).toEqual([]);
    expect(await source.getCatalog('anatomy')).toBeNull();
    expect(logger.events.some((e) => e.event === 'school.catalog.exercise-library.empty')).toBe(true);
  });

  it('degrades to nothing, without throwing, when the corpus itself throws', async () => {
    const logger = recordingLogger();
    const broken = makeLibrary({
      methods: { listGroups() { throw new Error('manifest exploded'); } },
    });
    const source = new ExerciseLibraryCatalogSource({ exerciseLibrary: broken, logger });
    await expect(source.listCatalogs()).resolves.toEqual([]);
    const failure = logger.events.find((e) => e.event === 'school.catalog.exercise-library.failed');
    expect(failure.data.error).toBe('manifest exploded');
  });

  it('refuses to construct without a corpus repository', () => {
    expect(() => new ExerciseLibraryCatalogSource({})).toThrow(/requires an exercise library/);
  });

  it('warns rather than silently relocating the shelf on a typo\'d catalog id', async () => {
    const logger = recordingLogger();
    const source = new ExerciseLibraryCatalogSource({
      exerciseLibrary: makeLibrary(), logger, catalogId: 'Not A Valid Id',
    });
    const warning = logger.events.find((e) => e.event === 'school.catalog.exercise-library.catalog-id-invalid');
    expect(warning.data).toMatchObject({ configured: 'Not A Valid Id', using: 'anatomy' });
    expect(await source.getCatalog('anatomy')).not.toBeNull();
  });

  it('honours a valid configured catalog id without warning', async () => {
    const logger = recordingLogger();
    const source = new ExerciseLibraryCatalogSource({
      exerciseLibrary: makeLibrary(), logger, catalogId: 'body-basics', title: 'Body Basics',
    });
    expect(await source.listCatalogs()).toEqual([{ catalogId: 'body-basics', title: 'Body Basics' }]);
    expect(logger.events.some((e) => e.event === 'school.catalog.exercise-library.catalog-id-invalid')).toBe(false);
  });

  it('builds the projection once and reuses it', async () => {
    let calls = 0;
    const library = makeLibrary();
    const counted = { ...library, listMuscles: () => { calls += 1; return library.listMuscles(); } };
    const source = new ExerciseLibraryCatalogSource({ exerciseLibrary: counted, logger: silentLogger });
    await source.listCatalogs();
    await source.getCatalog('anatomy');
    await source.getDocument('anatomy:biceps');
    const afterFirstBuild = calls;
    await source.getCatalog('anatomy');
    expect(calls).toBe(afterFirstBuild);
  });
});

describe('end to end through BuildLearningLesson', () => {
  it('hydrates a muscle lesson with the reader-ready document the real pipeline expects', async () => {
    const source = new ExerciseLibraryCatalogSource({ exerciseLibrary: makeLibrary(), logger: silentLogger });
    const build = new BuildLearningLesson({ catalogs: source, content: source });
    const bundle = await build.execute({
      catalogId: 'anatomy', subjectId: 'anatomy', courseId: 'muscles',
      unitId: 'upper-arms', lessonId: 'biceps',
    });

    expect(bundle.schema).toBe('school.learning-lesson/v1');
    expect(bundle.address).toBe('anatomy/anatomy/muscles/upper-arms/biceps');

    // This is what SchoolApp.jsx:259 dispatches on and what
    // LearningContentReader({ module }) reads.
    const notes = bundle.lesson.modules.find((m) => m.type === 'lecture_notes');
    expect(notes.document.blocks[0].type).toBe('prose');
    expect(notes.document.blocks.map((b) => b.text).join(' ')).toContain('two heads');
    expect(bundle.capabilities).toContain('reader@1');

    const examples = bundle.lesson.modules.find((m) => m.type === 'examples');
    expect(examples.examples[0].steps.length).toBeGreaterThan(0);
    expect(bundle.capabilities).toContain('examples@1');
  });

  it('hydrates the equipment guide lesson', async () => {
    const source = new ExerciseLibraryCatalogSource({ exerciseLibrary: makeLibrary(), logger: silentLogger });
    const build = new BuildLearningLesson({ catalogs: source, content: source });
    const bundle = await build.execute({
      catalogId: 'anatomy', subjectId: 'anatomy', courseId: 'equipment',
      unitId: 'equipment-guide', lessonId: 'equipment-guide',
    });
    expect(bundle.lesson.modules[0].document.title).toBe('Equipment Guide');
    expect(bundle.lesson.modules[0].document.blocks.length).toBeGreaterThan(0);
  });
});
