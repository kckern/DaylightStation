import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import LearningCatalogBrowser from './LearningCatalogBrowser.jsx';
import { moduleLaunchAllowed } from './certification.js';

const learningCatalogs = vi.fn();
const learningLesson = vi.fn();
const continuationCode = vi.fn();
const certification = vi.fn();
vi.mock('../schoolApi.js', () => ({ schoolApi: {
  learningCatalogs: (...args) => learningCatalogs(...args),
  learningLesson: (...args) => learningLesson(...args),
  continuationCode: (...args) => continuationCode(...args),
  certification: (...args) => certification(...args),
} }));
vi.mock('../identity/SchoolProfileContext.jsx', () => ({
  useSchoolProfile: () => ({ status: 'ready', currentUser: { id: 'kid-a' }, isGuest: false }),
}));

const catalog = {
  schema: 'school.catalog/v1', catalogId: 'core', title: 'Core', subjects: [{
    subjectId: 'quant', title: 'Quantitative', courses: [{
      courseId: 'rates', title: 'Rates', units: [{ unitId: 'intro', title: 'Introduction', lessons: [{
        lessonId: 'unit-rate', title: 'Unit rates', modules: [{ moduleId: 'check', type: 'learning_probe', continuationCode: '012345' }],
      }] }],
    }],
  }],
};

beforeEach(() => {
  learningCatalogs.mockReset().mockResolvedValue({ ok: true, data: { schema: 'school.catalog-index/v1', catalogs: [catalog] } });
  learningLesson.mockReset().mockResolvedValue({ ok: true, data: {
    schema: 'school.learning-lesson/v1',
    context: { catalog: { catalogId: 'core' }, subject: { subjectId: 'quant' }, course: { courseId: 'rates' }, unit: { unitId: 'intro' } },
    lesson: { lessonId: 'unit-rate', title: 'Unit rates', objectives: ['Compare rates'], modules: [{
      moduleId: 'check', type: 'learning_probe', title: 'Check it', continuationCode: '012345', conceptIds: ['unit-rate'], bank: { id: 'rate-check', items: [] },
    }] },
  } });
  continuationCode.mockReset().mockResolvedValue({
    ok: true, data: { schema: 'school.continuation-code/v1', code: '654321' },
  });
});

describe('LearningCatalogBrowser', () => {
  it('walks Catalog → subject → course → unit → lesson and launches a hydrated module', async () => {
    const onLaunch = vi.fn();
    render(<LearningCatalogBrowser onLaunch={onLaunch} />);
    for (const label of ['Core', 'Quantitative', 'Rates', 'Introduction', 'Unit rates']) {
      fireEvent.click(await screen.findByRole('button', { name: new RegExp(label, 'i') }));
    }
    expect(await screen.findByText('Compare rates')).toBeInTheDocument();
    expect(await screen.findByText('Continue on calculator · Code: 654321')).toBeInTheDocument();
    expect(continuationCode).toHaveBeenCalledWith({ learnerId: 'kid-a', moduleCode: '012345' });
    fireEvent.click(screen.getByRole('button', { name: /Check it/ }));
    expect(learningCatalogs).toHaveBeenCalledWith('kid-a');
    expect(learningLesson).toHaveBeenCalledWith({
      catalogId: 'core', subjectId: 'quant', courseId: 'rates', unitId: 'intro', lessonId: 'unit-rate',
    }, 'kid-a');
    expect(onLaunch).toHaveBeenCalledWith(expect.objectContaining({
      module: expect.objectContaining({ type: 'learning_probe' }),
      learning: expect.objectContaining({ courseId: 'rates', lessonId: 'unit-rate', conceptIds: ['unit-rate'] }),
    }));
  });

  it('keeps browsing available when the Catalog is empty', async () => {
    learningCatalogs.mockResolvedValueOnce({ ok: true, data: { schema: 'school.catalog-index/v1', catalogs: [] } });
    render(<LearningCatalogBrowser onLaunch={() => {}} />);
    expect(await screen.findByText('Nothing here yet.')).toBeInTheDocument();
  });

  // Task 16 (debt W7b): a quiz module's authored `passingPercent` must reach
  // QuizRunner via `learning` — otherwise a catalog-launched quiz can never
  // register `passed === false` and the failed-summary review link never has
  // anything to gate on (moduleValidation.mjs validates `passingPercent` only
  // on `type: 'quiz'` modules).
  it('carries an authored passingPercent onto the learning payload for a quiz module', async () => {
    learningLesson.mockResolvedValueOnce({ ok: true, data: {
      schema: 'school.learning-lesson/v1',
      context: { catalog: { catalogId: 'core' }, subject: { subjectId: 'quant' }, course: { courseId: 'rates' }, unit: { unitId: 'intro' } },
      lesson: { lessonId: 'unit-rate', title: 'Unit rates', modules: [{
        moduleId: 'gate', type: 'quiz', title: 'Gate quiz', passingPercent: 75, bank: { id: 'rate-quiz', items: [] },
      }] },
    } });
    const onLaunch = vi.fn();
    render(<LearningCatalogBrowser onLaunch={onLaunch} />);
    for (const label of ['Core', 'Quantitative', 'Rates', 'Introduction', 'Unit rates']) {
      fireEvent.click(await screen.findByRole('button', { name: new RegExp(label, 'i') }));
    }
    fireEvent.click(await screen.findByRole('button', { name: /Gate quiz/ }));
    expect(onLaunch).toHaveBeenCalledWith(expect.objectContaining({
      learning: expect.objectContaining({ unitId: 'intro', passingPercent: 75 }),
    }));
  });

  it('leaves passingPercent off the learning payload when the module has none', async () => {
    const onLaunch = vi.fn();
    render(<LearningCatalogBrowser onLaunch={onLaunch} />);
    for (const label of ['Core', 'Quantitative', 'Rates', 'Introduction', 'Unit rates']) {
      fireEvent.click(await screen.findByRole('button', { name: new RegExp(label, 'i') }));
    }
    fireEvent.click(await screen.findByRole('button', { name: /Check it/ }));
    const [launch] = onLaunch.mock.calls.at(-1);
    expect(launch.learning.passingPercent).toBeUndefined();
  });
});

// Two lessons reusing the same generic moduleId ('check') — the shape the
// catalog actually authors (module ids are only unique WITHIN a lesson) —
// under one unit, so a learner can open one and quickly move to the other
// before the first lesson's certification request has resolved.
const TWO_LESSON_CATALOG = {
  schema: 'school.catalog/v1', catalogId: 'core', title: 'Core', subjects: [{
    subjectId: 'quant', title: 'Quantitative', courses: [{
      courseId: 'rates', title: 'Rates', units: [{ unitId: 'intro', title: 'Introduction', lessons: [
        { lessonId: 'lesson-a', title: 'Lesson A', modules: [{ moduleId: 'check', type: 'learning_probe' }] },
        { lessonId: 'lesson-b', title: 'Lesson B', modules: [{ moduleId: 'check', type: 'learning_probe' }] },
      ] }],
    }],
  }],
};

function lessonPayload(lessonId, title) {
  return {
    ok: true, data: {
      schema: 'school.learning-lesson/v1',
      context: { catalog: { catalogId: 'core' }, subject: { subjectId: 'quant' }, course: { courseId: 'rates' }, unit: { unitId: 'intro' } },
      lesson: { lessonId, title, modules: [{ moduleId: 'check', type: 'learning_probe', title: `Check (${title})` }] },
    },
  };
}

describe('LearningCatalogBrowser — certification request staleness', () => {
  it('drops a slower Lesson A certification response that resolves after Lesson B is already open', async () => {
    learningCatalogs.mockResolvedValue({ ok: true, data: { schema: 'school.catalog-index/v1', catalogs: [TWO_LESSON_CATALOG] } });
    learningLesson.mockImplementation(async (address) => (
      address.lessonId === 'lesson-a' ? lessonPayload('lesson-a', 'Lesson A') : lessonPayload('lesson-b', 'Lesson B')
    ));
    // Lesson A's certification request never resolves on its own — this test
    // controls exactly when it lands, after Lesson B is already open. Lesson
    // A's (eventual) verdict is 'render' -- if the stale-response guard were
    // missing, this would wrongly clear Lesson B's same-named 'check' module.
    let resolveLessonA;
    const lessonAResponse = new Promise((resolve) => { resolveLessonA = resolve; });
    certification.mockImplementation(async ({ address }) => (
      address.endsWith('lesson-a')
        ? lessonAResponse
        : {
          ok: true, data: [{
            address, surfaceId: 'screen-test', verdict: 'partial', reasons: [], warnings: [],
            moduleVerdicts: [{ moduleId: 'check', verdict: 'incompatible', reasons: ['missing-capability:x'] }],
          }],
        }
    ));

    const onLaunch = vi.fn();
    render(<LearningCatalogBrowser onLaunch={onLaunch} surfaceId="screen-test" />);
    for (const label of ['Core', 'Quantitative', 'Rates', 'Introduction']) {
      fireEvent.click(await screen.findByRole('button', { name: new RegExp(label, 'i') }));
    }
    // Open Lesson A — its certification request is now in flight and pending.
    fireEvent.click(await screen.findByRole('button', { name: /^Lesson A$/ }));
    await screen.findByText('Check (Lesson A)');
    expect(certification).toHaveBeenCalledTimes(1);

    // Move on to Lesson B before A's certification response ever arrives.
    // "Introduction" is the unit-level breadcrumb — goTo() back to the lesson list.
    fireEvent.click(screen.getByRole('button', { name: /^Introduction$/ }));
    fireEvent.click(await screen.findByRole('button', { name: /^Lesson B$/ }));
    await screen.findByText('Check (Lesson B)');
    expect(certification).toHaveBeenCalledTimes(2);
    // Lesson B's own (fast) response already landed: its badge shows Partial.
    expect(await screen.findByText('Partial')).toBeInTheDocument();

    // NOW Lesson A's slower response resolves, well after Lesson B is open.
    // Wrapped in act + a macrotask tick so the resolved-promise chain (and,
    // if the stale-response guard were missing, the clobbering setCertRows)
    // has fully run before the assertions below.
    await act(async () => {
      resolveLessonA({
        ok: true, data: [{
          address: 'core/quant/rates/intro/lesson-a', surfaceId: 'screen-test', verdict: 'full', reasons: [], warnings: [],
          moduleVerdicts: [{ moduleId: 'check', verdict: 'render', reasons: [], warnings: [] }],
        }],
      });
      await new Promise((resolve) => { setTimeout(resolve, 0); });
    });

    // Still Lesson B's own verdict — Lesson A's stale 'full'/'render' response
    // was dropped, not applied.
    expect(screen.getByText('Partial')).toBeInTheDocument();
    expect(screen.queryByText('Full')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Check \(Lesson B\)/ }));
    const launch = onLaunch.mock.calls.at(-1)[0];
    // Lesson B's module is NOT launchable off Lesson A's leaked 'render' verdict.
    expect(moduleLaunchAllowed(launch.certification, 'check')).toBe(false);
  });
});
