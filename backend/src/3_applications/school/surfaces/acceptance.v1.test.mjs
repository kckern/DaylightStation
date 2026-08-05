// backend/src/3_applications/school/surfaces/acceptance.v1.test.mjs
/**
 * Acceptance sweep for Learning Surfaces v1 (spec §12) — the two items not
 * already proven task-by-task:
 *
 *  - §12.2 calculator parity: certify() agrees with the codec's own
 *    supports()/compile() exactly — same yes/no answer, same reason set.
 *  - §12.3 offer soundness: the two production consumers of the
 *    certification projection (PrintService's paper gate, and the screen
 *    app's buildVerdictMap/moduleLaunchAllowed launch gate) each exclude
 *    exactly the (bank|module, surface) pairs whose verdict is non-render —
 *    not a blanket cross-surface verdict.
 *
 * §12.1 (golden-digest/bundle suites), §12.4 (paper capture, proven in
 * Task 7), §12.5 (real-corpus inventory), §12.6 (determinism), and §12.7
 * (contract + architecture coverage) are recorded in
 * docs/_wip/audits/2026-08-04-learning-surfaces-acceptance.md rather than
 * re-asserted here — they are op/process checks, not new unit behavior.
 */
import { describe, expect, it, vi } from 'vitest';
import { Ti86SchoolCalcCodec } from '#adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';
import { bundle as ti86Bundle } from '#adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.test.mjs';
import { Ti86SurfaceCertification, ti86CodecBaselineProfile } from '#adapters/schoolcalc/ti86/Ti86SurfaceCertification.mjs';
import { PaperCertification } from '#adapters/school/paper/PaperCertification.mjs';
import { paperProfile, choiceBank } from '#adapters/school/paper/PaperCertification.test.mjs';
import { ScreenCertification } from '#adapters/school/screen/ScreenCertification.mjs';
import { BuildLearningLesson, createCoreLearningModuleRegistry } from '#apps/school/catalog/index.mjs';
import { listCatalogLessons } from '#domains/school/catalog/index.mjs';
import { PrintService } from '../PrintService.mjs';
import { SurfaceRegistry } from './SurfaceRegistry.mjs';
import { GetSurfaceCertification } from './GetSurfaceCertification.mjs';
// Frontend helper, imported by relative path (per task brief) — it is a pure
// module with no React/DOM dependency, so it loads fine under the backend
// vitest project too.
import { buildVerdictMap, moduleLaunchAllowed } from '../../../../../frontend/src/modules/School/catalog/certification.js';

// ---------------------------------------------------------------------------
// §12.2 — calculator parity: certify() agrees with supports()/compile().
// ---------------------------------------------------------------------------

/**
 * Mirrors Ti86SurfaceCertification's private profile -> codec-report
 * translation (spec §7.1), so this test can call the codec directly, the
 * same way the port does internally, for an apples-to-apples comparison.
 */
function toCodecReport(profile) {
  const limits = {};
  if (profile.limits?.maxArtifactBytes !== undefined) limits.maxArtifactBytes = profile.limits.maxArtifactBytes;
  return {
    platformId: 'ti86',
    capabilities: profile.capabilities.filter((id) => !id.startsWith('return.')),
    limits,
  };
}

describe('§12.2 calculator parity — certify() agrees with supports()/compile() (spec §12.2)', () => {
  const codec = new Ti86SchoolCalcCodec();
  const port = new Ti86SurfaceCertification({ codec });
  const profile = ti86CodecBaselineProfile();
  const report = toCodecReport(profile);

  it('a renderable bundle: verdict is full iff supports().compatible && compile() does not throw', () => {
    const supports = codec.supports(ti86Bundle, report);
    expect(supports.compatible).toBe(true);
    expect(() => codec.compile(ti86Bundle, report)).not.toThrow();

    const certified = port.certify(ti86Bundle, profile);
    expect(certified.lesson.verdict).toBe('full');
  });

  it('a capability-incompatible variant: verdict is not full, and certify() reasons equal supports().reasons exactly (compile is never attempted)', () => {
    const incompatible = structuredClone(ti86Bundle);
    incompatible.capabilities = [...incompatible.capabilities, 'image@1'];

    const supports = codec.supports(incompatible, report);
    expect(supports.compatible).toBe(false);
    expect(supports.reasons.length).toBeGreaterThan(0);

    const certified = port.certify(incompatible, profile);
    expect(certified.lesson.verdict).not.toBe('full');
    const certifiedReasons = new Set(certified.modules.flatMap((m) => m.reasons));
    expect(certifiedReasons).toEqual(new Set(supports.reasons));
  });

  it('a compile-throw variant: capability-compatible but over the byte ceiling; certify() reasons equal supports().reasons (empty) union the compile error message', () => {
    const oversized = structuredClone(ti86Bundle);
    oversized.lesson.modules = [{
      moduleId: 'notes',
      type: 'lecture_notes',
      document: {
        blocks: Array.from({ length: 400 }, (_, i) => ({
          blockId: `p${i}`, type: 'prose', text: `Filler paragraph ${i} `.repeat(10),
        })),
      },
    }];

    const supports = codec.supports(oversized, report);
    expect(supports.compatible).toBe(true);
    expect(supports.reasons).toEqual([]);

    let compileError = null;
    try {
      codec.compile(oversized, report);
    } catch (error) {
      compileError = error.message;
    }
    expect(compileError).toBeTruthy();

    const certified = port.certify(oversized, profile);
    expect(certified.lesson.verdict).not.toBe('full');
    const certifiedReasons = new Set(certified.modules.flatMap((m) => m.reasons));
    expect(certifiedReasons).toEqual(new Set([...supports.reasons, compileError]));
  });
});

// ---------------------------------------------------------------------------
// §12.2b — corpus-wide TI-86 parity (F4a, 2026-08-04 acceptance audit
// follow-up). §12.2 above proves parity on three hand-picked bundles; this
// walks every RESOLVABLE lesson in a small multi-lesson fixture corpus
// (in-memory stubs — NOT the real content mount) through BuildLearningLesson
// (the same resolution path the CLI/API use), then compares the codec's own
// supports()/compile() against Ti86SurfaceCertification.certify() for each
// one. A real-corpus-wide run (walking every lesson under the actual
// published mount) is blocked on a pre-existing data-mount schema error —
// see §12.5 in the acceptance evidence doc — so this in-memory corpus is the
// closest available proof this branch can produce that parity holds across
// more than a handful of hand-picked cases.
// ---------------------------------------------------------------------------

function corpusWideParityFixture() {
  const documents = new Map([
    ['notes-doc', {
      schema: 'school.learning-document/v1', documentId: 'notes-doc', title: 'Notes',
      blocks: [{ blockId: 'intro', type: 'prose', text: 'Read this carefully.' }],
    }],
    ['big-doc', {
      schema: 'school.learning-document/v1', documentId: 'big-doc', title: 'Big',
      blocks: Array.from({ length: 400 }, (_, i) => ({
        blockId: `p${i}`, type: 'prose', text: `Filler paragraph ${i} `.repeat(10),
      })),
    }],
  ]);
  const banks = new Map([
    ['mc-bank', {
      id: 'mc-bank', title: 'Multiple choice', audience: 'assigned',
      items: [{ id: 'q1', type: 'multiple_choice', prompt: 'Pick one', choices: ['A', 'B'], answer: 'A' }],
    }],
    ['sa-bank', {
      id: 'sa-bank', title: 'Short answer', audience: 'assigned',
      items: [{ id: 'q1', type: 'short_answer', prompt: 'Answer', answer: 'x' }],
    }],
  ]);
  const catalog = {
    schema: 'school.catalog/v1', catalogId: 'parity', title: 'Parity corpus',
    subjects: [{
      subjectId: 'core', title: 'Core', courses: [{
        courseId: 'c1', title: 'Course 1', units: [{
          unitId: 'u1', title: 'Unit 1', lessons: [
            { lessonId: 'quiz-lesson', title: 'Quiz', modules: [{ moduleId: 'q', type: 'quiz', bankId: 'mc-bank' }] },
            { lessonId: 'notes-lesson', title: 'Notes', modules: [{ moduleId: 'n', type: 'lecture_notes', documentId: 'notes-doc' }] },
            { lessonId: 'flash-lesson', title: 'Flash', modules: [{ moduleId: 'f', type: 'flashcards', bankId: 'mc-bank' }] },
            // Renders on the codec (multiple_choice), but is TI-86
            // v0-assessment-incompatible via a DIFFERENT axis than §12.2's
            // capability-mismatch case: short_answer items have no TI-86
            // projection at all (ti86ProjectionReasons), so supports()
            // itself rejects it, not a capability diff.
            { lessonId: 'text-lesson', title: 'Text', modules: [{ moduleId: 's', type: 'quiz', bankId: 'sa-bank' }] },
            // Compile-throw case (byte ceiling), same shape as §12.2's third case.
            { lessonId: 'oversized-lesson', title: 'Oversized', modules: [{ moduleId: 'b', type: 'lecture_notes', documentId: 'big-doc' }] },
          ],
        }],
      }],
    }],
  };
  const catalogs = { getCatalog: async () => catalog };
  const content = {
    getDocument: async (documentId) => documents.get(documentId),
    getQuestionBank: async (bankId) => banks.get(bankId),
    getLearningAction: async () => null,
  };
  return { catalog, catalogs, content };
}

describe('§12.2b corpus-wide TI-86 parity — every resolvable lesson in a fixture corpus (F4a)', () => {
  const codec = new Ti86SchoolCalcCodec();
  const port = new Ti86SurfaceCertification({ codec });
  const profile = ti86CodecBaselineProfile();
  const report = toCodecReport(profile);
  const { catalog, catalogs, content } = corpusWideParityFixture();
  const buildLesson = new BuildLearningLesson({ catalogs, content, modules: createCoreLearningModuleRegistry() });
  const addresses = listCatalogLessons(catalog).map(({ address }) => address);

  it('the fixture corpus actually has more than one resolvable lesson to walk', () => {
    expect(addresses.length).toBeGreaterThan(1);
  });

  it.each(addresses)('certify() agrees with supports()/compile() for %s', async (address) => {
    const [catalogId, subjectId, courseId, unitId, lessonId] = address.split('/');
    const bundle = await buildLesson.execute({
      catalogId, subjectId, courseId, unitId, lessonId,
    });

    const supports = codec.supports(bundle, report);
    let compileError = null;
    if (supports.compatible) {
      try {
        codec.compile(bundle, report);
      } catch (error) {
        compileError = error.message;
      }
    }
    const expectedFull = supports.compatible && compileError === null;
    const expectedReasons = new Set([...supports.reasons, ...(compileError ? [compileError] : [])]);

    const certified = port.certify(bundle, profile);
    expect(certified.lesson.verdict === 'full').toBe(expectedFull);
    const certifiedReasons = new Set(certified.modules.flatMap((m) => m.reasons));
    expect(certifiedReasons).toEqual(expectedReasons);
  });
});

// ---------------------------------------------------------------------------
// §12.3 — offer soundness as a matrix property over a two-lesson fixture
// corpus, asserted at the application layer (the same use cases the routes
// call: PrintService.listPrintables with the paper gate bound the way
// app.mjs wires it, and the screen app's buildVerdictMap/moduleLaunchAllowed).
// ---------------------------------------------------------------------------

/** Screen surface profile — mirrors GetSurfaceCertification.test.mjs's fixture. */
const screenProfile = {
  surfaceId: 'screen-office',
  family: 'screen',
  liveness: 'static',
  capabilities: ['quiz@1', 'response.choice@1', 'response.text@1', 'return.session@1'],
  limits: {},
};

/** Never invoked in this suite (no schoolcalc profile/baseline registered) — satisfies SurfaceRegistry's port-per-family requirement. */
function inertSchoolcalcPort() {
  return {
    certify: () => ({ modules: [], lesson: { verdict: 'none' } }),
    certifyBank: () => ({ verdict: 'incompatible', reasons: [], warnings: [] }),
  };
}

describe('§12.3 offer soundness — matrix property over a two-lesson fixture corpus (spec §12.3)', () => {
  // One bank/module rendering everywhere (multiple-choice: both paper and
  // screen support response.choice@1), one paper-incompatible (short-answer:
  // paper lacks response.text@1, screen has it).
  const renderEverywhereBank = choiceBank;
  const paperIncompatibleBank = { id: 'sa-bank', items: [
    { id: 'q1', type: 'short_answer', prompt: 'p', answer: 'x' },
  ] };

  const lessonFull = { lesson: { modules: [
    { moduleId: 'render-me', type: 'quiz', bank: renderEverywhereBank },
  ] } };
  const lessonPaperIncompatible = { lesson: { modules: [
    { moduleId: 'text-me', type: 'quiz', bank: paperIncompatibleBank },
  ] } };

  const ADDRESS_FULL = 'main/core/module/set/full';
  const ADDRESS_PAPER_INCOMPATIBLE = 'main/core/module/set/paperbad';

  function makeRegistry() {
    return new SurfaceRegistry({
      profiles: [paperProfile, screenProfile],
      ports: {
        paper: new PaperCertification(),
        screen: new ScreenCertification(),
        schoolcalc: inertSchoolcalcPort(),
      },
    });
  }

  function makeCatalog() {
    return {
      subjects: [{
        subjectId: 'core',
        courses: [{
          courseId: 'module',
          units: [{
            unitId: 'set',
            lessons: [
              { lessonId: 'full', title: 'Full', modules: lessonFull.lesson.modules },
              { lessonId: 'paperbad', title: 'Paper incompatible', modules: lessonPaperIncompatible.lesson.modules },
            ],
          }],
        }],
      }],
    };
  }

  function makeCertification(registry) {
    const catalog = makeCatalog();
    const buildLesson = { execute: async ({ lessonId }) => (lessonId === 'full' ? lessonFull : lessonPaperIncompatible) };
    const catalogs = { getCatalog: async () => catalog };
    const banks = {
      getBank: async (id) => (id === 'mc-bank' ? renderEverywhereBank : (id === 'sa-bank' ? paperIncompatibleBank : null)),
    };
    return new GetSurfaceCertification({
      buildLesson, catalogs, banks, registry,
    });
  }

  it('the paper-incompatible lesson really is non-render on paper (fixture sanity)', async () => {
    const registry = makeRegistry();
    const certification = makeCertification(registry);
    const rows = await certification.lesson(ADDRESS_PAPER_INCOMPATIBLE);
    const paperRow = rows.find((row) => row.surfaceId === 'paper-letter-mono');
    expect(paperRow.verdict).not.toBe('full');
    expect(paperRow.moduleVerdicts.find((m) => m.moduleId === 'text-me').verdict).toBe('incompatible');
  });

  it('PrintService.listPrintables, with the paper gate bound the way app.mjs wires it, excludes exactly the non-render bank', async () => {
    const registry = makeRegistry();
    const paperProfiles = registry.list().filter((profile) => profile.family === 'paper');
    // Same composition as backend/src/app.mjs's paperCertifyBank: render if
    // ANY registered paper profile can render it.
    const paperCertifyBank = (bank) => {
      const results = paperProfiles.map((profile) => registry.portFor(profile).certifyBank(bank, profile));
      if (results.some((r) => r.verdict === 'render')) return { verdict: 'render', reasons: [] };
      return { verdict: 'incompatible', reasons: results.flatMap((r) => r.reasons || []) };
    };

    const svc = new PrintService({
      config: {
        printables: [
          { id: 'mc', label: 'Render everywhere', type: 'bank', bankId: 'mc-bank' },
          { id: 'sa', label: 'Paper incompatible', type: 'bank', bankId: 'sa-bank' },
        ],
      },
      datastore: {
        readPrintLog: () => [], appendPrintLog: () => {}, readPrintPending: () => [], savePrintPending: () => {},
      },
      printerAdapter: { printPdf: vi.fn() },
      worksheetRenderer: { renderBankWorksheet: vi.fn(async () => ({ pdf: Buffer.from('%PDF-1.4'), pageCount: 1 })) },
      bankReader: { getBank: (id) => (id === 'mc-bank' ? renderEverywhereBank : (id === 'sa-bank' ? paperIncompatibleBank : null)) },
      pdfReader: { read: () => null },
      userService: { getHouseholdRoster: () => [] },
      logger: { info() {}, warn() {}, error() {} },
      paperCertifyBank,
    });

    const list = await svc.listPrintables();
    // Exactly the non-render (bank, paper) pair is excluded — 'sa' — nothing else.
    expect(list.map((p) => p.id)).toEqual(['mc']);
  });

  it('the screen launch gate (buildVerdictMap + moduleLaunchAllowed) is render-exact per lesson, independent of the paper verdict', async () => {
    const registry = makeRegistry();
    const certification = makeCertification(registry);

    const rowsFull = await certification.lesson(ADDRESS_FULL);
    const screenRowsFull = rowsFull.filter((row) => row.surfaceId === screenProfile.surfaceId);
    const mapFull = buildVerdictMap(screenRowsFull);
    expect(moduleLaunchAllowed(mapFull, 'render-me')).toBe(true);

    const rowsBad = await certification.lesson(ADDRESS_PAPER_INCOMPATIBLE);
    const screenRowsBad = rowsBad.filter((row) => row.surfaceId === screenProfile.surfaceId);
    const mapBad = buildVerdictMap(screenRowsBad);
    // 'text-me' is paper-incompatible (previous test), but screen supports
    // response.text@1 — launch stays allowed. The gate excludes exactly the
    // non-render (module, surface) pairs, never a blanket cross-surface verdict.
    expect(moduleLaunchAllowed(mapBad, 'text-me')).toBe(true);

    // Fail-closed sanity: an unrelated moduleId is never allowed.
    expect(moduleLaunchAllowed(mapFull, 'unknown-module')).toBe(false);
  });
});
