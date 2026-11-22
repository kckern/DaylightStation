/**
 * ListLearnerWork — each learner's school week as work items, read from every
 * store in parallel. One failing source for one learner costs only that
 * source; an absent store is skipped.
 */
import { describe, it, expect } from 'vitest';
import { ListLearnerWork } from '../../../../__app_modules/learning/school/server/application/usecases/ListLearnerWork.mjs';
import { WORK_ITEM_KEYS } from '../../../../__app_modules/learning/school/server/domain/learnerWork.mjs';
import { studyDayForInstant } from '../../../../__app_modules/learning/school/server/domain/studyDay.mjs';

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

  it('looks each package title up once per call, however many learners study it', async () => {
    const shared = {
      listPackages: async () => ['korean-vocab'],
      listDays: async () => ['2026-11-17'],
      readDay: async () => ({ items: { a: 1 } }),
    };
    let calls = 0;
    const cardLadderTitleFor = async () => { calls += 1; return 'Korean words'; };
    const useCase = new ListLearnerWork(allDeps({ cardLadder: shared, cardLadderTitleFor }));
    const { items } = await useCase.execute({ from: FROM, to: TO });
    expect(items.filter((i) => i.kind === 'program').map((p) => p.title)).toEqual(['Korean words', 'Korean words']);
    expect(calls).toBe(1);
    await useCase.execute({ from: FROM, to: TO });
    expect(calls).toBe(2); // not cached across calls: a renamed package shows next time
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

describe('ListLearnerWork — piano lessons and the sentence ladder', () => {
  const laDayOf = (iso) => studyDayForInstant(Date.parse(iso), { timezone: 'America/Los_Angeles' });
  const pianoRow = (learnerId, lessonId, occurredAt) => ({
    evidenceId: `piano-lesson:${learnerId}:${lessonId}:${occurredAt}`,
    learnerId, occurredAt,
    activity: { kind: 'piano_lesson', itemId: lessonId },
    learning: { courseId: 'plex:694771', lessonId },
    measures: { correct: 0, completions: 1 },
  });
  const evidenceRows = [
    pianoRow('kid-a', 'plex:694833', '2026-11-20T01:20:23.354Z'), // LA study day 2026-11-19
    pianoRow('kid-a', 'plex:694834', '2026-11-16T06:00:00Z'), // LA 2026-11-15 → out
    pianoRow('kid-b', 'plex:694836', '2026-11-21T18:00:00Z'),
    { evidenceId: 'other', learnerId: 'kid-a', occurredAt: '2026-11-18T18:00:00Z', activity: { kind: 'video_lesson' } },
  ];
  function evidenceRepo(calls = []) {
    return {
      listEvidence: ({ learnerIds, from, to }) => {
        calls.push({ learnerIds, from, to });
        return evidenceRows.filter((r) => learnerIds.includes(r.learnerId) && r.occurredAt >= from && r.occurredAt < to);
      },
    };
  }
  const sittings = {
    'kid-a': [{ plexId: 'plex:694833', title: 'Lesson 50 | Jingle Bells', score: 87.654, percent: 77, outcome: 'already-counted', startedAt: '2026-11-20T01:10:00Z' }],
    'kid-b': [],
  };
  function sittingLog(calls = []) {
    return { list: (userId, opts) => { calls.push({ userId, ...opts }); return sittings[userId] ?? null; } };
  }
  const glossikaDays = {
    'kid-a': {
      'glossika-korean': {
        '2026-11-15': [{ at: '2026-11-15T20:00:00Z', seq: 1 }], // LA 15th → out
        '2026-11-18': [{ at: '2026-11-18T20:00:00Z', seq: 2, accuracy: 0.87654, heard: 'x' }, { at: '2026-11-18T21:00:00Z', seq: 3 }],
        '2026-11-19': [{ at: '2026-11-19T03:00:00Z', seq: 4 }], // LA evening of the 18th
      },
    },
    'kid-b': { 'glossika-korean': { '2026-11-21': [{ at: '2026-11-21T18:00:00Z', seq: 9 }] } },
  };
  function languageStudy({ reads = [], corpusReads = [] } = {}) {
    return {
      listCorpusIds: () => ['glossika-korean', 'unused-corpus'],
      readCorpus: (id) => { corpusReads.push(id); return { id, label: id === 'glossika-korean' ? 'Glossika Korean' : 'Unused' }; },
      readEventDay: (userId, corpusId, day) => { reads.push(`${userId}/${corpusId}/${day}`); return glossikaDays[userId]?.[corpusId]?.[day] ?? []; },
    };
  }
  const deps = (over = {}) => ({
    learners, learningEvidence: evidenceRepo(), lessonSittingLog: sittingLog(),
    pianoCourseTitleFor: async (id) => (id === 'plex:694771' ? 'Piano Adventures' : null),
    languageStudy: languageStudy(), dayOf: laDayOf, logger: recordingLogger(), ...over,
  });

  it('lists piano lessons by household study day with sitting titles, never scores', async () => {
    const evidenceCalls = [];
    const sittingCalls = [];
    const { items } = await new ListLearnerWork(deps({
      learningEvidence: evidenceRepo(evidenceCalls), lessonSittingLog: sittingLog(sittingCalls),
    })).execute({ from: FROM, to: TO });
    const aPiano = of(items, 'kid-a', 'course');
    expect(aPiano).toEqual([{
      learnerId: 'kid-a', learnerName: 'Kid A', kind: 'course', verb: 'completed',
      title: 'Piano Adventures', subtitle: 'Lesson 50 · Jingle Bells',
      at: '2026-11-20T01:20:23.354Z', studyDay: '2026-11-19',
      imageUrl: '/api/v1/display/plex/694771', groupKey: 'course:plex:694771', weight: 1, subject: 'music',
    }]);
    expect(of(items, 'kid-b', 'course')).toMatchObject([{ title: 'Piano Adventures', subtitle: null, studyDay: '2026-11-21' }]);
    // The UTC query is a day wider either side; the projection trims by study day.
    expect(evidenceCalls[0]).toEqual({ learnerIds: ['kid-a'], from: '2026-11-15T00:00:00.000Z', to: '2026-11-25T00:00:00.000Z' });
    expect(sittingCalls.find((c) => c.userId === 'kid-a').sinceIso).toBe('2026-11-14T00:00:00.000Z');
    const text = JSON.stringify(items);
    expect(text).not.toContain('87.654');
    expect(text).not.toContain('already-counted');
    for (const item of items) expect(Object.keys(item).sort()).toEqual([...WORK_ITEM_KEYS].sort());
  });

  it('keeps evening work on the last study day of the window (to - 1)', async () => {
    // The last study day is 2026-11-22. In Los Angeles it runs until 04:00 on
    // the 23rd local, 12:00Z; in UTC-12 until 16:00Z on the 23rd.
    const rows = [
      pianoRow('kid-a', 'plex:1', '2026-11-23T07:30:00Z'), // 23:30 on the 22nd in LA → in
      pianoRow('kid-a', 'plex:2', '2026-11-23T11:59:00Z'), // 03:59 on the 23rd in LA → still the 22nd
      pianoRow('kid-a', 'plex:3', '2026-11-23T12:01:00Z'), // 04:01 on the 23rd → out
    ];
    const repo = { listEvidence: ({ from, to }) => rows.filter((r) => r.occurredAt >= from && r.occurredAt < to) };
    const { items } = await new ListLearnerWork(deps({ learningEvidence: repo, learners: () => [{ id: 'kid-a', name: 'Kid A' }] }))
      .execute({ from: FROM, to: TO });
    expect(items.filter((i) => i.kind === 'course').map((i) => i.at)).toEqual(['2026-11-23T07:30:00Z', '2026-11-23T11:59:00Z']);

    const far = [pianoRow('kid-a', 'plex:4', '2026-11-23T15:59:00Z')]; // 03:59 on the 23rd in UTC-12
    const farRepo = { listEvidence: ({ from, to }) => far.filter((r) => r.occurredAt >= from && r.occurredAt < to) };
    const farDayOf = (iso) => studyDayForInstant(Date.parse(iso), { timezone: 'Etc/GMT+12' });
    const farWork = await new ListLearnerWork(deps({ learningEvidence: farRepo, dayOf: farDayOf, learners: () => [{ id: 'kid-a' }] }))
      .execute({ from: FROM, to: TO });
    expect(farWork.items.filter((i) => i.kind === 'course').map((i) => i.studyDay)).toEqual(['2026-11-22']);
  });

  it('reads sentence ladder shards from the day before from through the day after to', async () => {
    // Evening of the last study day (the 22nd) lands in UTC shard 2026-11-23;
    // a far-west zone's first study day starts in shard 2026-11-16 and a
    // far-east zone's in 2026-11-15.
    const days = {
      '2026-11-23': [{ at: '2026-11-23T07:30:00Z', seq: 1 }, { at: '2026-11-23T11:59:00Z', seq: 2 }, { at: '2026-11-23T12:01:00Z', seq: 3 }],
    };
    const reads = [];
    const store = {
      listCorpusIds: () => ['glossika-korean'],
      readCorpus: () => ({ label: 'Glossika Korean' }),
      readEventDay: (u, c, day) => { reads.push(day); return days[day] ?? []; },
    };
    const { items } = await new ListLearnerWork(deps({ languageStudy: store, learningEvidence: null, learners: () => [{ id: 'kid-a' }] }))
      .execute({ from: FROM, to: TO });
    expect(items).toMatchObject([{ studyDay: '2026-11-22', subtitle: '2 sentences', at: '2026-11-23T11:59:00Z' }]);
    expect(reads[0]).toBe('2026-11-15');
    expect(reads.at(-1)).toBe('2026-11-24');
    expect(reads).toHaveLength(10);
  });

  it('looks each piano course title up once per call', async () => {
    let calls = 0;
    const pianoCourseTitleFor = async () => { calls += 1; return 'Piano Adventures'; };
    const useCase = new ListLearnerWork(deps({ pianoCourseTitleFor }));
    await useCase.execute({ from: FROM, to: TO });
    expect(calls).toBe(1);
    await useCase.execute({ from: FROM, to: TO });
    expect(calls).toBe(2);
  });

  it('falls back to "Piano" when the course title lookup throws', async () => {
    const logger = recordingLogger();
    const { items } = await new ListLearnerWork(deps({
      pianoCourseTitleFor: async () => { throw new Error('plex down'); }, logger,
    })).execute({ from: FROM, to: TO });
    expect(of(items, 'kid-a', 'course')[0].title).toBe('Piano');
    expect(logger.events.some((e) => e.event === 'school.learner-work.lookup-failed' && e.data.source === 'piano')).toBe(true);
  });

  it('still lists piano lessons without a sitting log or course titles', async () => {
    const { items } = await new ListLearnerWork(deps({ lessonSittingLog: null, pianoCourseTitleFor: null })).execute({ from: FROM, to: TO });
    expect(of(items, 'kid-a', 'course')).toMatchObject([{ title: 'Piano', subtitle: null }]);
  });

  it('counts sentence ladder sentences per study day, reading a shard either side', async () => {
    const reads = [];
    const corpusReads = [];
    const { items } = await new ListLearnerWork(deps({ languageStudy: languageStudy({ reads, corpusReads }) })).execute({ from: FROM, to: TO });
    const aProgram = of(items, 'kid-a', 'program');
    expect(aProgram).toEqual([{
      learnerId: 'kid-a', learnerName: 'Kid A', kind: 'program', verb: 'worked',
      title: 'Glossika Korean', subtitle: '3 sentences', at: '2026-11-19T03:00:00Z', studyDay: '2026-11-18',
      imageUrl: '/api/v1/weekly-review/school/image?ref=' + encodeURIComponent('program:sentence-ladder:glossika-korean'),
      groupKey: 'program:sentence-ladder:glossika-korean', weight: 3, subject: 'language',
    }]);
    expect(of(items, 'kid-b', 'program')).toMatchObject([{ studyDay: '2026-11-21', subtitle: '1 sentence' }]);
    const aDays = reads.filter((r) => r.startsWith('kid-a/glossika-korean/')).map((r) => r.split('/')[2]);
    expect(aDays[0]).toBe('2026-11-15');
    expect(aDays.at(-1)).toBe('2026-11-24');
    expect(aDays).toHaveLength(10);
    // Labels are read once per call, and only for corpora someone worked.
    expect(corpusReads).toEqual(['glossika-korean']);
    expect(JSON.stringify(items)).not.toContain('0.87654');
  });

  it('prefers an injected corpus title over reading the corpus file', async () => {
    const corpusReads = [];
    const titleCalls = [];
    const { items } = await new ListLearnerWork(deps({
      languageStudy: languageStudy({ corpusReads }),
      sentenceLadderTitleFor: async (id) => { titleCalls.push(id); return 'Korean sentences'; },
    })).execute({ from: FROM, to: TO });
    expect(items.filter((i) => i.kind === 'program').map((i) => i.title)).toEqual(['Korean sentences', 'Korean sentences']);
    expect(titleCalls).toEqual(['glossika-korean']);
    expect(corpusReads).toEqual([]);
  });

  it('isolates a failing piano or sentence ladder source to that learner', async () => {
    const logger = recordingLogger();
    const brokenEvidence = {
      listEvidence: (q) => { if (q.learnerIds.includes('kid-a')) throw new Error('evidence corrupt'); return evidenceRepo().listEvidence(q); },
    };
    const brokenLanguage = {
      ...languageStudy(),
    };
    brokenLanguage.readEventDay = (userId, corpusId, day) => {
      if (userId === 'kid-b') throw new Error('bad shard');
      return glossikaDays[userId]?.[corpusId]?.[day] ?? [];
    };
    const { items } = await new ListLearnerWork(deps({ learningEvidence: brokenEvidence, languageStudy: brokenLanguage, logger }))
      .execute({ from: FROM, to: TO });
    expect(of(items, 'kid-a', 'course')).toEqual([]);
    expect(of(items, 'kid-a', 'program')).toHaveLength(1);
    expect(of(items, 'kid-b', 'course')).toHaveLength(1);
    expect(of(items, 'kid-b', 'program')).toEqual([]);
    const failed = logger.events.filter((e) => e.event === 'school.learner-work.source-failed').map((e) => e.data);
    expect(failed).toContainEqual({ learnerId: 'kid-a', source: 'pianoLessons', error: 'evidence corrupt' });
    expect(failed).toContainEqual({ learnerId: 'kid-b', source: 'sentenceLadder', error: 'bad shard' });
  });

  it('skips both sources when their stores are absent', async () => {
    const { items } = await new ListLearnerWork({ learners }).execute({ from: FROM, to: TO });
    expect(items).toEqual([]);
  });
});
