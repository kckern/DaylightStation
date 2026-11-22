/**
 * ListLearnerWork — each learner's school week as work items, read from every
 * store in parallel. One failing source for one learner costs only that
 * source; an absent store is skipped.
 */
import { describe, it, expect } from 'vitest';
import { ListLearnerWork } from '../../../../__app_modules/learning/school/server/application/usecases/ListLearnerWork.mjs';
import { WORK_ITEM_KEYS } from '../../../../__app_modules/learning/school/server/domain/learnerWork.mjs';

const FROM = '2026-11-16';
const TO = '2026-11-23';

function recordingLogger() {
  const events = [];
  const at = (level) => (event, data) => events.push({ level, event, data });
  return { events, info: at('info'), warn: at('warn'), debug: at('debug'), error: at('error') };
}

const learners = () => [{ id: 'kid-a', name: 'Kid A' }, { id: 'kid-b', name: 'Kid B' }];

const readings = {
  'kid-a': [{ id: 'r1', status: 'reading', book: { isbn: '111' }, openedOn: '2026-11-17' }],
  'kid-b': [
    { id: 'r2', status: 'finished', book: { isbn: '222' }, openedOn: '2026-11-01', finishedOn: '2026-11-18', entries: [] },
    { id: 'r3', status: 'reading', book: { isbn: '333' }, openedOn: '2026-11-10' }, // outside window
  ],
};
const bookLog = { listForLearner: async (id) => readings[id] ?? [] };
const books = { 111: { title: 'Owl Moon', authors: ['Jane Yolen'] }, 222: { title: 'Frog and Toad', authors: ['Arnold Lobel'] } };
const bookRepository = { findByIsbn: async (isbn) => books[isbn] ?? null };
const coverUrlFor = (isbn) => `/covers/${isbn}`;

const sessionRows = {
  'kid-a': [
    { unitId: 'u1', terminal: true, studyDay: '2026-11-19', outcome: { result: 'passed', at: '2026-11-19T15:00:00Z' } },
    { unitId: 'u1', terminal: false, studyDay: '2026-11-19' },
    { unitId: 'u2', terminal: true, studyDay: '2026-11-01', outcome: { result: 'passed', at: '2026-11-01T15:00:00Z' } },
  ],
  'kid-b': [{ unitId: 'u3', terminal: true, studyDay: '2026-11-20', outcome: { result: 'passed', at: '2026-11-20T15:00:00Z' } }],
};
const sessions = { listForLearner: async (id) => sessionRows[id] ?? [] };
const units = {
  u1: { unitId: 'u1', title: 'Lesson 4', subject: 'math', courseId: 'c-math', courseTitle: 'Math 2' },
  u3: { unitId: 'u3', title: 'Lesson 1', subject: 'science', courseId: 'c-sci', courseTitle: 'Science' },
};
const curriculum = { getUnitSummary: (unitId) => units[unitId] ?? null };

const issuances = {
  'kid-a': [{ issuanceId: 'iss-1', platform: 'beeloo', externalId: 'x1', kind: 'maze', level: 2, completedStudyDay: '2026-11-18', completedAt: '2026-11-18T16:00:00Z' }],
  'kid-b': [],
};
const printedActivities = { listForLearner: async (id) => issuances[id] ?? [] };

const ladderDays = {
  'kid-a': {
    'korean-vocab': { '2026-11-15': { items: { a: 1 } }, '2026-11-17': { items: { a: 1, b: 2 }, doneAt: '2026-11-17T18:00:00Z' } },
    'spanish-vocab': { '2026-11-21': { items: { a: 1 } } },
  },
  'kid-b': {},
};
const cardLadder = {
  listPackages: (id) => Object.keys(ladderDays[id] ?? {}).sort(),
  listDays: (id, pkg) => Object.keys(ladderDays[id]?.[pkg] ?? {}).sort(),
  readDay: (id, pkg, day) => ({ schema: 'day', day, ...ladderDays[id][pkg][day] }),
};

const allDeps = (overrides = {}) => ({
  learners, bookLog, bookRepository, coverUrlFor, sessions, curriculum, printedActivities, cardLadder, logger: recordingLogger(), ...overrides,
});

const of = (items, learnerId, kind) => items.filter((i) => i.learnerId === learnerId && (!kind || i.kind === kind));

describe('ListLearnerWork', () => {
  it('projects every source for every learner, inside the window', async () => {
    const logger = recordingLogger();
    const { items } = await new ListLearnerWork(allDeps({ logger })).execute({ from: FROM, to: TO });

    const aBooks = of(items, 'kid-a', 'book');
    expect(aBooks).toHaveLength(1);
    expect(aBooks[0]).toMatchObject({ verb: 'started', title: 'Owl Moon', subtitle: 'Jane Yolen', imageUrl: '/covers/111', learnerName: 'Kid A' });
    const bBooks = of(items, 'kid-b', 'book');
    expect(bBooks.map((b) => b.verb)).toEqual(['finished']);
    expect(bBooks[0].title).toBe('Frog and Toad');

    const aCourses = of(items, 'kid-a', 'course');
    expect(aCourses).toHaveLength(1);
    expect(aCourses[0]).toMatchObject({ title: 'Math 2', subtitle: 'Lesson 4', verb: 'completed', subject: 'math' });
    expect(aCourses[0].imageUrl).toContain(encodeURIComponent('course:c-math'));
    expect(of(items, 'kid-b', 'course')[0].title).toBe('Science');

    const aActs = of(items, 'kid-a', 'activity');
    expect(aActs).toHaveLength(1);
    expect(aActs[0].imageUrl).toContain(encodeURIComponent('activity:iss-1'));

    const aProgram = of(items, 'kid-a', 'program');
    expect(aProgram.map((p) => [p.groupKey, p.studyDay, p.weight])).toEqual([
      ['program:card-ladder:korean-vocab', '2026-11-17', 2],
      ['program:card-ladder:spanish-vocab', '2026-11-21', 1],
    ]);
    expect(aProgram[0].title).toBe('korean-vocab');
    expect(of(items, 'kid-b', 'program')).toEqual([]);

    for (const item of items) expect(Object.keys(item).sort()).toEqual([...WORK_ITEM_KEYS].sort());

    const listed = logger.events.find((e) => e.event === 'school.learner-work.listed');
    expect(listed.level).toBe('info');
    expect(listed.data).toMatchObject({ from: FROM, to: TO, learners: 2, items: items.length });
    expect(typeof listed.data.ms).toBe('number');
  });

  it('uses a package title when one is resolvable', async () => {
    const cardLadderTitleFor = async (pkg) => (pkg === 'korean-vocab' ? 'Korean words' : null);
    const { items } = await new ListLearnerWork(allDeps({ cardLadderTitleFor })).execute({ from: FROM, to: TO });
    const titles = of(items, 'kid-a', 'program').map((p) => p.title);
    expect(titles).toEqual(['Korean words', 'spanish-vocab']);
  });

  it('isolates a failing source to that learner and that source', async () => {
    const logger = recordingLogger();
    const flakyBookLog = {
      listForLearner: async (id) => { if (id === 'kid-a') throw new Error('corrupt log'); return readings[id]; },
    };
    const { items } = await new ListLearnerWork(allDeps({ bookLog: flakyBookLog, logger })).execute({ from: FROM, to: TO });

    expect(of(items, 'kid-a', 'book')).toEqual([]);
    expect(of(items, 'kid-a', 'course')).toHaveLength(1);
    expect(of(items, 'kid-a', 'activity')).toHaveLength(1);
    expect(of(items, 'kid-a', 'program')).toHaveLength(2);
    expect(of(items, 'kid-b', 'book')).toHaveLength(1);

    const warns = logger.events.filter((e) => e.event === 'school.learner-work.source-failed');
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatchObject({ level: 'warn', data: { learnerId: 'kid-a', source: 'books', error: 'corrupt log' } });
  });

  it('isolates a failing card-ladder day read the same way', async () => {
    const logger = recordingLogger();
    const broken = { ...cardLadder, readDay: () => { throw new Error('bad yaml'); } };
    const { items } = await new ListLearnerWork(allDeps({ cardLadder: broken, logger })).execute({ from: FROM, to: TO });
    expect(of(items, 'kid-a', 'program')).toEqual([]);
    expect(of(items, 'kid-a', 'course')).toHaveLength(1);
    expect(logger.events.some((e) => e.event === 'school.learner-work.source-failed' && e.data.source === 'cardLadder')).toBe(true);
  });

  it('skips absent stores', async () => {
    const { items } = await new ListLearnerWork({ learners, logger: recordingLogger() }).execute({ from: FROM, to: TO });
    expect(items).toEqual([]);

    const onlySessions = await new ListLearnerWork({ learners, sessions, curriculum }).execute({ from: FROM, to: TO });
    expect(onlySessions.items.map((i) => i.kind)).toEqual(['course', 'course']);
  });

  it('falls back to plain titles when book or unit lookups throw', async () => {
    const logger = recordingLogger();
    const throwingRepo = { findByIsbn: async () => { throw new Error('cache down'); } };
    const throwingCurriculum = { getUnitSummary: async () => { throw new Error('catalog down'); } };
    const { items } = await new ListLearnerWork(allDeps({ bookRepository: throwingRepo, curriculum: throwingCurriculum, logger }))
      .execute({ from: FROM, to: TO });
    expect(of(items, 'kid-a', 'book')[0].title).toBe('A book');
    expect(of(items, 'kid-a', 'course')[0]).toMatchObject({ title: 'Schoolwork', imageUrl: null });
    const lookups = logger.events.filter((e) => e.event === 'school.learner-work.lookup-failed');
    expect(lookups.every((e) => e.level === 'warn')).toBe(true);
    expect(lookups.map((e) => e.data)).toContainEqual({ source: 'books', key: '111', error: 'cache down' });
    expect(lookups.map((e) => e.data)).toContainEqual({ source: 'sessions', key: 'u1', error: 'catalog down' });
    expect(logger.events.some((e) => e.event === 'school.learner-work.source-failed')).toBe(false);
  });

  it('looks each distinct ISBN and unit up once, and only in-window units', async () => {
    const isbnCalls = [];
    const unitCalls = [];
    const repo = { findByIsbn: async (isbn) => { isbnCalls.push(isbn); return books[isbn] ?? null; } };
    const cur = { getUnitSummary: (u) => { unitCalls.push(u); return units[u] ?? null; } };
    await new ListLearnerWork(allDeps({ bookRepository: repo, curriculum: cur })).execute({ from: FROM, to: TO });
    expect(unitCalls.sort()).toEqual(['u1', 'u3']);
    expect(new Set(isbnCalls).size).toBe(isbnCalls.length);
  });

  it('accepts a sync roster', async () => {
    const { items } = await new ListLearnerWork(allDeps({ learners: () => [{ id: 'kid-b', name: 'Kid B' }] })).execute({ from: FROM, to: TO });
    expect(new Set(items.map((i) => i.learnerId))).toEqual(new Set(['kid-b']));
  });

  it('accepts an async roster', async () => {
    const { items } = await new ListLearnerWork(allDeps({ learners: async () => [{ id: 'kid-b', name: 'Kid B' }] })).execute({ from: FROM, to: TO });
    expect(items.every((i) => i.learnerName === 'Kid B')).toBe(true);
  });

  it('rejects a malformed window', async () => {
    const uc = new ListLearnerWork(allDeps());
    await expect(uc.execute({ from: '2026-11', to: TO })).rejects.toThrow(/from/);
    await expect(uc.execute({ from: FROM })).rejects.toThrow(/to/);
    await expect(uc.execute()).rejects.toThrow();
  });

  it('requires a roster', () => {
    expect(() => new ListLearnerWork({})).toThrow(/learners/);
  });
});
