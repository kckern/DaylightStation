/**
 * GetLearnerWorkImage — serves the image refs learner work items point at:
 * a course poster, or the first page of a solved printed activity rendered
 * once to PNG and cached.
 */
import { describe, it, expect } from 'vitest';
import { GetLearnerWorkImage } from '../../../../__app_modules/learning/school/server/application/usecases/GetLearnerWorkImage.mjs';

function recordingLogger() {
  const events = [];
  const at = (level) => (event, data) => events.push({ level, event, data });
  return { events, info: at('info'), warn: at('warn'), debug: at('debug'), error: at('error') };
}

const learners = () => [{ id: 'kid-a', name: 'Kid A' }, { id: 'kid-b', name: 'Kid B' }];
const issuances = {
  'kid-a': [{ issuanceId: 'iss-1', platform: 'beeloo', externalId: 'x1' }],
  'kid-b': [{ issuanceId: 'iss-2', platform: 'elsewhere', externalId: 'x2' }, { issuanceId: 'iss-3', platform: 'beeloo', externalId: 'x3' }],
};
const printedActivities = { listForLearner: async (id) => issuances[id] ?? [] };
const POSTER = Buffer.from('jpeg-bytes');
const PDF = Buffer.from('%PDF');
const PNG = Buffer.from('png-bytes');

function memoryCache(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    writes: [],
    read(key) { return store.get(key) ?? null; },
    async write(key, buf) { this.writes.push(key); store.set(key, buf); },
  };
}

function setup(overrides = {}) {
  const logger = recordingLogger();
  const solutionCalls = [];
  const renderCalls = [];
  const beeloo = { getSolution: async (externalId) => { solutionCalls.push(externalId); return externalId === 'x3' ? null : PDF; } };
  const cache = memoryCache();
  const deps = {
    learners,
    curriculum: { getCoursePoster: async (courseId) => (courseId === 'c-math' ? POSTER : null) },
    printedActivities,
    platforms: new Map([['beeloo', beeloo]]),
    renderPdfFirstPagePng: async (pdf, opts) => { renderCalls.push({ pdf, opts }); return PNG; },
    cache,
    logger,
    ...overrides,
  };
  return { uc: new GetLearnerWorkImage(deps), logger, solutionCalls, renderCalls, cache: deps.cache };
}

describe('GetLearnerWorkImage', () => {
  it('serves a course poster as JPEG', async () => {
    const { uc } = setup();
    expect(await uc.execute('course:c-math')).toEqual({ bytes: POSTER, contentType: 'image/jpeg' });
  });

  it('returns null for a course without a poster', async () => {
    const { uc } = setup();
    expect(await uc.execute('course:c-none')).toBeNull();
  });

  it('serves a cached activity page without asking the platform', async () => {
    const cache = memoryCache({ 'beeloo-x1.png': PNG });
    const { uc, solutionCalls, logger } = setup({ cache });
    expect(await uc.execute('activity:iss-1')).toEqual({ bytes: PNG, contentType: 'image/png' });
    expect(solutionCalls).toEqual([]);
    const ev = logger.events.find((e) => e.event === 'school.printed-activity.page-render');
    expect(ev.data).toMatchObject({ issuanceId: 'iss-1', cached: true });
  });

  it('renders, caches and serves an uncached activity page', async () => {
    const { uc, cache, renderCalls, logger } = setup();
    expect(await uc.execute('activity:iss-1')).toEqual({ bytes: PNG, contentType: 'image/png' });
    expect(renderCalls).toEqual([{ pdf: PDF, opts: { width: 800 } }]);
    expect(cache.writes).toEqual(['beeloo-x1.png']);
    const ev = logger.events.find((e) => e.event === 'school.printed-activity.page-render');
    expect(ev).toMatchObject({ level: 'info', data: { issuanceId: 'iss-1', cached: false } });
    expect(typeof ev.data.ms).toBe('number');
  });

  it('finds an issuance on any learner', async () => {
    const { uc, solutionCalls } = setup();
    expect(await uc.execute('activity:iss-3')).toBeNull(); // getSolution → null
    expect(solutionCalls).toEqual(['x3']);
  });

  it('returns null for an unknown issuance', async () => {
    const { uc, solutionCalls } = setup();
    expect(await uc.execute('activity:iss-404')).toBeNull();
    expect(solutionCalls).toEqual([]);
  });

  it('returns null when the platform is not wired', async () => {
    const { uc } = setup();
    expect(await uc.execute('activity:iss-2')).toBeNull();
  });

  it('returns null and warns when rendering throws', async () => {
    const { uc, cache, logger } = setup({ renderPdfFirstPagePng: async () => { throw new Error('pdftoppm missing'); } });
    expect(await uc.execute('activity:iss-1')).toBeNull();
    expect(cache.writes).toEqual([]);
    const warn = logger.events.find((e) => e.event === 'school.printed-activity.page-render-failed');
    expect(warn).toMatchObject({ level: 'warn', data: { issuanceId: 'iss-1', error: 'pdftoppm missing' } });
  });

  it('works with no cache', async () => {
    const { uc } = setup({ cache: undefined });
    expect(await uc.execute('activity:iss-1')).toEqual({ bytes: PNG, contentType: 'image/png' });
  });

  it('returns null for unknown or malformed refs', async () => {
    const { uc } = setup();
    for (const ref of [undefined, null, '', 'course:', 'activity:', 'poster:c-math', 'nonsense', 42]) {
      expect(await uc.execute(ref)).toBeNull();
    }
  });

  it('returns null for a course ref when curriculum is absent', async () => {
    const { uc } = setup({ curriculum: undefined });
    expect(await uc.execute('course:c-math')).toBeNull();
  });
});
