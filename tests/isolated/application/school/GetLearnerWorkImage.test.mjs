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
const done = { completedStudyDay: '2026-11-18' };
const issuances = {
  'kid-a': [
    { issuanceId: 'iss-1', platform: 'beeloo', externalId: 'x1', ...done },
    { issuanceId: 'iss-open', platform: 'beeloo', externalId: 'x4' },
    { issuanceId: 'iss-void', platform: 'beeloo', externalId: 'x5', ...done, voidedAt: '2026-11-19T10:00:00Z' },
    { issuanceId: 'iss-evil', platform: 'beeloo', externalId: '../../x', ...done },
  ],
  'kid-b': [
    { issuanceId: 'iss-2', platform: 'elsewhere', externalId: 'x2', ...done },
    { issuanceId: 'iss-3', platform: 'beeloo', externalId: 'x3', ...done },
    { issuanceId: 'iss-trace', platform: 'beeloo', externalId: 'x6', ...done },
  ],
};
const printedActivities = { listForLearner: async (id) => issuances[id] ?? [] };
const POSTER = Buffer.from('jpeg-bytes');
const PDF = Buffer.from('%PDF');
const PNG = Buffer.from('png-bytes');
const PRINTABLE = Buffer.from('%PDF-printable');
const PROGRAM_POSTER = Buffer.from('program-jpeg');

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
  const posterCalls = [];
  const printableCalls = [];
  const beeloo = {
    getSolution: async (externalId) => { solutionCalls.push(externalId); return ['x3', 'x6'].includes(externalId) ? null : PDF; },
    getPrintable: async (externalId) => {
      printableCalls.push(externalId);
      if (externalId === 'x6') return PRINTABLE;
      throw new Error(`no printable for ${externalId}`);
    },
  };
  const cache = memoryCache();
  const deps = {
    learners,
    curriculum: {
      getCoursePoster: async (courseId) => (courseId === 'c-math' ? POSTER : null),
      getProgramPoster: async (programId, instanceId) => {
        posterCalls.push([programId, instanceId]);
        return programId === 'card-ladder' && instanceId === 'korean' ? PROGRAM_POSTER : null;
      },
    },
    printedActivities,
    platforms: new Map([['beeloo', beeloo]]),
    renderPdfFirstPagePng: async (pdf, opts) => { renderCalls.push({ pdf, opts }); return PNG; },
    cache,
    logger,
    ...overrides,
  };
  return { uc: new GetLearnerWorkImage(deps), logger, solutionCalls, printableCalls, posterCalls, renderCalls, cache: deps.cache };
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
    expect(ev).toMatchObject({ level: 'info', data: { issuanceId: 'iss-1', cached: false, source: 'solution' } });
    expect(typeof ev.data.ms).toBe('number');
  });

  it('finds an issuance on any learner', async () => {
    const { uc, solutionCalls } = setup();
    expect(await uc.execute('activity:iss-3')).toBeNull(); // no solution, no printable
    expect(solutionCalls).toEqual(['x3']);
  });

  it('renders the printable when the page has no solution', async () => {
    const { uc, cache, renderCalls, printableCalls, logger } = setup();
    expect(await uc.execute('activity:iss-trace')).toEqual({ bytes: PNG, contentType: 'image/png' });
    expect(printableCalls).toEqual(['x6']);
    expect(renderCalls).toEqual([{ pdf: PRINTABLE, opts: { width: 800 } }]);
    expect(cache.writes).toEqual(['beeloo-x6.png']);
    const ev = logger.events.find((e) => e.event === 'school.printed-activity.page-render');
    expect(ev.data).toMatchObject({ issuanceId: 'iss-trace', cached: false, source: 'printable' });
  });

  it('returns null when neither solution nor printable exists', async () => {
    const { uc, cache, renderCalls, printableCalls, logger } = setup();
    expect(await uc.execute('activity:iss-3')).toBeNull();
    expect(printableCalls).toEqual(['x3']);
    expect(renderCalls).toEqual([]);
    expect(cache.writes).toEqual([]);
    expect(logger.events.some((e) => e.level === 'warn')).toBe(false);
  });

  it('does not ask for the printable when the solution exists', async () => {
    const { uc, printableCalls } = setup();
    await uc.execute('activity:iss-1');
    expect(printableCalls).toEqual([]);
  });

  it('serves a program instance poster as JPEG', async () => {
    const { uc, posterCalls } = setup();
    expect(await uc.execute('program:card-ladder:korean')).toEqual({ bytes: PROGRAM_POSTER, contentType: 'image/jpeg' });
    expect(posterCalls).toEqual([['card-ladder', 'korean']]);
  });

  it('returns null for a program without a poster', async () => {
    const { uc } = setup();
    expect(await uc.execute('program:card-ladder:spanish')).toBeNull();
  });

  it('refuses malformed or unsafe program refs before asking curriculum', async () => {
    const { uc, posterCalls } = setup();
    for (const ref of ['program:card-ladder', 'program:card-ladder:', 'program::korean', 'program:card-ladder:ko:extra',
      'program:card-ladder:../x', 'program:card.ladder:korean', `program:card-ladder:${'a'.repeat(129)}`]) {
      expect(await uc.execute(ref)).toBeNull();
    }
    expect(posterCalls).toEqual([]);
  });

  it('returns null and warns when the program poster read throws', async () => {
    const curriculum = { getProgramPoster: async () => { throw new Error('EACCES'); } };
    const { uc, logger } = setup({ curriculum });
    expect(await uc.execute('program:card-ladder:korean')).toBeNull();
    const warn = logger.events.find((e) => e.event === 'school.program-poster.read-failed');
    expect(warn).toMatchObject({ level: 'warn', data: { programId: 'card-ladder', instanceId: 'korean', error: 'EACCES' } });
  });

  it('returns null for a program ref when curriculum is absent', async () => {
    const { uc } = setup({ curriculum: undefined });
    expect(await uc.execute('program:card-ladder:korean')).toBeNull();
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

  it('refuses ids unsafe as a cache file name before touching the cache', async () => {
    const reads = [];
    const cache = { read: (key) => { reads.push(key); return null; }, write: async () => {} };
    const { uc, solutionCalls } = setup({ cache });
    expect(await uc.execute('activity:iss-evil')).toBeNull();
    expect(reads).toEqual([]);
    expect(solutionCalls).toEqual([]);
  });

  it('serves no solution for a page that is still open', async () => {
    const { uc, solutionCalls } = setup();
    expect(await uc.execute('activity:iss-open')).toBeNull();
    expect(solutionCalls).toEqual([]);
  });

  it('serves no solution for a voided page', async () => {
    const { uc, solutionCalls } = setup();
    expect(await uc.execute('activity:iss-void')).toBeNull();
    expect(solutionCalls).toEqual([]);
  });

  it('still serves the page when the cache write fails', async () => {
    const cache = { read: () => null, write: async () => { throw new Error('disk full'); } };
    const { uc, logger } = setup({ cache });
    expect(await uc.execute('activity:iss-1')).toEqual({ bytes: PNG, contentType: 'image/png' });
    const warn = logger.events.find((e) => e.event === 'school.printed-activity.page-cache-write-failed');
    expect(warn).toMatchObject({ level: 'warn', data: { issuanceId: 'iss-1', error: 'disk full' } });
  });

  it('treats a failing cache read as a miss', async () => {
    const cache = { read: () => { throw new Error('EIO'); }, write: async () => {} };
    const { uc, logger, solutionCalls } = setup({ cache });
    expect(await uc.execute('activity:iss-1')).toEqual({ bytes: PNG, contentType: 'image/png' });
    expect(solutionCalls).toEqual(['x1']);
    expect(logger.events.some((e) => e.level === 'warn' && e.event === 'school.printed-activity.page-cache-read-failed')).toBe(true);
  });

  it('renders a page once for two concurrent misses', async () => {
    const { uc, solutionCalls, renderCalls } = setup();
    const [a, b] = await Promise.all([uc.execute('activity:iss-1'), uc.execute('activity:iss-1')]);
    expect(a).toEqual({ bytes: PNG, contentType: 'image/png' });
    expect(b).toEqual({ bytes: PNG, contentType: 'image/png' });
    expect(solutionCalls).toEqual(['x1']);
    expect(renderCalls).toHaveLength(1);
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

describe('GetLearnerWorkImage — the sentence ladder poster', () => {
  it('serves the ref a sentence ladder item points at from the corpus poster on the media mount', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { YamlCurriculumDatastore } = await import('../../../../__app_modules/learning/school/server/adapters/persistence/YamlCurriculumDatastore.mjs');
    const { sentenceLadderToWork } = await import('../../../../__app_modules/learning/school/server/domain/learnerWork.mjs');
    const media = fs.mkdtempSync(path.join(os.tmpdir(), 'sentence-ladder-poster-'));
    try {
      const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02]);
      const dir = path.join(media, 'school', 'programs', 'sentence-ladder', 'glossika-korean');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'poster.jpg'), jpeg);
      const curriculum = new YamlCurriculumDatastore({ configService: { getMediaDir: () => media, getDataDir: () => media } });
      const [item] = sentenceLadderToWork([{ at: '2026-11-18T20:00:00Z', seq: 1 }], {
        learnerId: 'kid-a', from: '2026-11-16', to: '2026-11-23', corpusId: 'glossika-korean',
      });
      const ref = decodeURIComponent(new URL(item.imageUrl, 'http://x').searchParams.get('ref'));
      expect(ref).toBe('program:sentence-ladder:glossika-korean');
      const uc = new GetLearnerWorkImage({ learners, curriculum, logger: recordingLogger() });
      expect(await uc.execute(ref)).toEqual({ bytes: jpeg, contentType: 'image/jpeg' });
    } finally {
      fs.rmSync(media, { recursive: true, force: true });
    }
  });
});
