// backend/src/3_applications/school/surfaces/GetSurfaceCertification.test.mjs
import { describe, expect, it, vi } from 'vitest';
import { PaperCertification } from '#adapters/school/paper/PaperCertification.mjs';
import { ScreenCertification } from '#adapters/school/screen/ScreenCertification.mjs';
import {
  renderableBundle, paperProfile, choiceBank,
} from '#adapters/school/paper/PaperCertification.test.mjs';
import { SurfaceRegistry } from './SurfaceRegistry.mjs';
import { GetSurfaceCertification } from './GetSurfaceCertification.mjs';

const screenProfile = {
  surfaceId: 'screen-office', family: 'screen', liveness: 'static',
  capabilities: [
    'reader@1', 'examples@1', 'problems@1', 'flashcards@1', 'quiz@1', 'learning-probe@1',
    'activity.matching@1', 'calculator@1', 'graph@1',
    'image@1', 'math@1', 'table-layout@1', 'scan-action@1',
    'response.choice@1', 'response.text@1', 'response.matching@1',
    'response.region@1', 'response.asset-choice@1',
    'return.session@1',
  ],
  limits: {},
};

/** Device-independent baseline profile — schoolcalc family, no live device needed. */
const schoolcalcBaselineProfile = {
  surfaceId: 'fake-calc-codec-baseline', family: 'schoolcalc', liveness: 'observed',
  capabilities: ['reader@1', 'quiz@1', 'response.choice@1'],
  limits: {},
};

/** A stub schoolcalc port with no certifyBank (Task 6's real port has none either). */
function stubSchoolcalcPort() {
  return {
    certify: (bundle) => {
      const modules = (bundle?.lesson?.modules ?? []).map((module) => ({
        moduleId: module.moduleId, verdict: 'render', reasons: [], warnings: [],
      }));
      return {
        modules,
        lesson: { verdict: modules.length ? 'full' : 'none' },
        // A real schoolcalc port (Ti86SurfaceCertification) reports a compiled
        // `resource` when compatible — stubbed here to exercise the
        // resource-omitted-on-declared-demotion behavior.
        ...(modules.length ? { resource: { estimatedBytes: 42 } } : {}),
      };
    },
  };
}

const ADDRESS = 'main/sci/wc/wm/evap';

function makeCatalog({ requiredCapabilities = [] } = {}) {
  return {
    subjects: [{
      subjectId: 'sci',
      courses: [{
        courseId: 'wc',
        units: [{
          unitId: 'wm',
          lessons: [{
            lessonId: 'evap',
            title: 't',
            modules: renderableBundle.lesson.modules,
            requiredCapabilities,
          }],
        }],
      }],
    }],
  };
}

function makeRegistry({ baselines } = {}) {
  return new SurfaceRegistry({
    profiles: [paperProfile, screenProfile],
    ports: {
      paper: new PaperCertification(),
      screen: new ScreenCertification(),
      schoolcalc: stubSchoolcalcPort(),
    },
    baselines: baselines ?? [{ profile: schoolcalcBaselineProfile, baseline: 'codec' }],
  });
}

function makeSut({ requiredCapabilities = [], registry, buildLessonExecute } = {}) {
  const catalog = makeCatalog({ requiredCapabilities });
  const buildLesson = { execute: buildLessonExecute ?? vi.fn(async () => renderableBundle) };
  const catalogs = { getCatalog: async () => catalog };
  const banks = { getBank: async () => choiceBank };
  return {
    sut: new GetSurfaceCertification({
      buildLesson, catalogs, banks, registry: registry ?? makeRegistry(),
    }),
    buildLesson,
  };
}

describe('GetSurfaceCertification', () => {
  it('(a) returns one row per profile plus one codec-baseline row', async () => {
    const { sut } = makeSut();
    const rows = await sut.lesson(ADDRESS);
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.surfaceId).sort()).toEqual([
      'fake-calc-codec-baseline', 'paper-letter-mono', 'screen-office',
    ]);
    const baselineRow = rows.find((row) => row.surfaceId === 'fake-calc-codec-baseline');
    expect(baselineRow.baseline).toBe('codec');
    expect(rows.filter((row) => row.baseline === undefined)).toHaveLength(2);
  });

  it('(b) paper and screen rows are full when requiredCapabilities is empty', async () => {
    const { sut } = makeSut();
    const rows = await sut.lesson(ADDRESS);
    const paperRow = rows.find((row) => row.surfaceId === 'paper-letter-mono');
    const screenRow = rows.find((row) => row.surfaceId === 'screen-office');
    expect(paperRow.verdict).toBe('full');
    expect(screenRow.verdict).toBe('full');
    expect(paperRow.address).toBe(ADDRESS);
    expect(paperRow.moduleVerdicts).toHaveLength(renderableBundle.lesson.modules.length);
    expect(typeof paperRow.contentDigest).toBe('string');
    expect(typeof paperRow.profileDigest).toBe('string');
  });

  it('(c) a declared requiredCapability the paper profile lacks demotes every module verdict', async () => {
    const { sut } = makeSut({ requiredCapabilities: ['native-program@1'] });
    const rows = await sut.lesson(ADDRESS);
    const paperRow = rows.find((row) => row.surfaceId === 'paper-letter-mono');
    expect(paperRow.verdict).toBe('none');
    expect(paperRow.moduleVerdicts.length).toBeGreaterThan(0);
    for (const module of paperRow.moduleVerdicts) {
      expect(module.reasons).toContain('missing capability native-program@1');
      expect(module.verdict).toBe('incompatible');
    }
    expect(paperRow.reasons).toContain('missing capability native-program@1');
  });

  it('(d) caches the built bundle per address; a fresh instance with changed content re-certifies', async () => {
    const buildLessonExecute = vi.fn(async () => renderableBundle);
    const { sut } = makeSut({ buildLessonExecute });

    const first = await sut.lesson(ADDRESS);
    const second = await sut.lesson(ADDRESS);
    expect(buildLessonExecute).toHaveBeenCalledTimes(1);
    expect(second[0].contentDigest).toBe(first[0].contentDigest);

    const changedBundle = {
      lesson: { modules: [...renderableBundle.lesson.modules, { moduleId: 'extra', type: 'lecture_notes', document: { blocks: [] } }] },
    };
    const { sut: sut2 } = makeSut({ buildLessonExecute: vi.fn(async () => changedBundle) });
    const third = await sut2.lesson(ADDRESS);
    expect(third[0].contentDigest).not.toBe(first[0].contentDigest);
  });

  it('(e) bank() certifies via each port\'s certifyBank; the schoolcalc stub (no certifyBank) is incompatible', async () => {
    const { sut } = makeSut();
    const rows = await sut.bank('b1');
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.address).toBe('bank:b1');
      expect(row.moduleVerdicts).toBeNull();
    }
    const paperRow = rows.find((row) => row.surfaceId === 'paper-letter-mono');
    const screenRow = rows.find((row) => row.surfaceId === 'screen-office');
    const calcRow = rows.find((row) => row.surfaceId === 'fake-calc-codec-baseline');
    expect(paperRow.verdict).toBe('render');
    expect(screenRow.verdict).toBe('render');
    expect(calcRow.verdict).toBe('incompatible');
    expect(calcRow.reasons.join()).toMatch(/standalone banks are not deliverable to calculators/);
  });

  it('invalidate(address) evicts the bundle cache so a stale address re-fetches', async () => {
    let call = 0;
    const changedBundle = {
      lesson: { modules: [...renderableBundle.lesson.modules, { moduleId: 'extra', type: 'lecture_notes', document: { blocks: [] } }] },
    };
    const bundles = [renderableBundle, changedBundle];
    const buildLessonExecute = vi.fn(async () => bundles[call++]);
    const { sut } = makeSut({ buildLessonExecute });

    const first = await sut.lesson(ADDRESS);
    const cachedAgain = await sut.lesson(ADDRESS);
    expect(buildLessonExecute).toHaveBeenCalledTimes(1);
    expect(cachedAgain[0].contentDigest).toBe(first[0].contentDigest);

    sut.invalidate(ADDRESS);
    const afterInvalidate = await sut.lesson(ADDRESS);
    expect(buildLessonExecute).toHaveBeenCalledTimes(2);
    expect(afterInvalidate[0].contentDigest).not.toBe(first[0].contentDigest);
    const paperRow = afterInvalidate.find((row) => row.surfaceId === 'paper-letter-mono');
    expect(paperRow.moduleVerdicts).toHaveLength(changedBundle.lesson.modules.length);
  });

  it('invalidate() with no address clears every cached address', async () => {
    const buildLessonExecute = vi.fn(async () => renderableBundle);
    const { sut } = makeSut({ buildLessonExecute });
    const otherAddress = 'main/sci/wc/wm/evap2';

    await sut.lesson(ADDRESS);
    await sut.lesson(otherAddress);
    expect(buildLessonExecute).toHaveBeenCalledTimes(2);

    // Both addresses are cached now — repeat calls should not re-fetch.
    await sut.lesson(ADDRESS);
    await sut.lesson(otherAddress);
    expect(buildLessonExecute).toHaveBeenCalledTimes(2);

    sut.invalidate();
    await sut.lesson(ADDRESS);
    await sut.lesson(otherAddress);
    expect(buildLessonExecute).toHaveBeenCalledTimes(4);
  });

  it('omits a stale resource when a declared capability demotes verdict to none (minor fix)', async () => {
    const { sut } = makeSut({ requiredCapabilities: ['native-program@1'] });
    const rows = await sut.lesson(ADDRESS);
    const calcRow = rows.find((row) => row.surfaceId === 'fake-calc-codec-baseline');
    expect(calcRow.verdict).toBe('none');
    expect(calcRow.resource).toBeUndefined();
  });

  it('keeps resource when the verdict is not demoted by a declared capability', async () => {
    const { sut } = makeSut();
    const rows = await sut.lesson(ADDRESS);
    const calcRow = rows.find((row) => row.surfaceId === 'fake-calc-codec-baseline');
    expect(calcRow.verdict).toBe('full');
    expect(calcRow.resource).toEqual({ estimatedBytes: 42 });
  });
});
