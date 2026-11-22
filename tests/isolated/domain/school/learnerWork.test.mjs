import { describe, it, expect } from 'vitest';
import {
  inWindow,
  booksToWork,
  sessionsToWork,
  activitiesToWork,
  activityKindLabel,
  cardLadderToWork,
  pianoLessonsToWork,
  sentenceLadderToWork,
  WORK_ITEM_KEYS,
  tidyTitle,
} from "../../../../__app_modules/learning/school/server/domain/learnerWork.mjs";
import { studyDayForInstant } from "../../../../__app_modules/learning/school/server/domain/studyDay.mjs";

const BASE = { learnerId: 'kid-a', learnerName: 'Kid A', from: '2026-11-16', to: '2026-11-23' };
const CONTRACT = [
  'learnerId', 'learnerName', 'kind', 'verb', 'title', 'subtitle', 'at', 'studyDay',
  'imageUrl', 'groupKey', 'weight', 'subject',
].sort();
const expectContract = (items) => {
  for (const item of items) expect(Object.keys(item).sort()).toEqual(CONTRACT);
};
const SENTINEL = { gradedPercent: 87.654, gradedCorrectCount: 7654 };
const expectNoGraded = (items) => {
  expect(items.length).toBeGreaterThan(0);
  for (const item of items) {
    const values = Object.values(item);
    expect(values).not.toContain(87.654);
    expect(values).not.toContain(7654);
    for (const k of Object.keys(item)) expect(k).not.toMatch(/graded|percent|score|correct|coin|streak|answer/i);
  }
};

describe('inWindow', () => {
  it('is from-inclusive and to-exclusive', () => {
    expect(inWindow('2026-11-16', '2026-11-16', '2026-11-23')).toBe(true);
    expect(inWindow('2026-11-22', '2026-11-16', '2026-11-23')).toBe(true);
    expect(inWindow('2026-11-23', '2026-11-16', '2026-11-23')).toBe(false);
    expect(inWindow('2026-11-15', '2026-11-16', '2026-11-23')).toBe(false);
    expect(inWindow(null, '2026-11-16', '2026-11-23')).toBe(false);
  });
  it('exports the contract key set', () => {
    expect([...WORK_ITEM_KEYS].sort()).toEqual(CONTRACT);
  });
});

describe('booksToWork', () => {
  const books = { '111': { title: 'Frog and Toad', authors: ['Arnold Lobel', 'Other'] } };
  const deps = {
    ...BASE,
    bookFor: (isbn) => books[isbn] ?? null,
    coverUrlFor: (isbn) => `/cover/${isbn}`,
  };
  const reading = (over) => ({
    id: 'rdg_1', learnerId: 'kid-a', book: { isbn: '111', pageCount: 64 },
    progressMode: 'pages', status: 'reading', openedOn: '2026-11-01', entries: [], revisions: [],
    ...over,
  });

  it('tolerates null input', () => {
    expect(booksToWork(null, deps)).toEqual([]);
    expect(booksToWork(undefined, deps)).toEqual([]);
  });

  it('emits a started item when openedOn is in the window', () => {
    const items = booksToWork([reading({ openedOn: '2026-11-16', openedRecordedAt: '2026-11-16T18:00:00Z' })], deps);
    expect(items).toEqual([{
      learnerId: 'kid-a', learnerName: 'Kid A', kind: 'book', verb: 'started',
      title: 'Frog and Toad', subtitle: 'Arnold Lobel', at: '2026-11-16T18:00:00Z',
      studyDay: '2026-11-16', imageUrl: '/cover/111', groupKey: 'book:rdg_1:started',
      weight: 1, subject: 'reading',
    }]);
  });

  it('defaults started at to noon UTC of openedOn', () => {
    const [item] = booksToWork([reading({ openedOn: '2026-11-20' })], deps);
    expect(item.at).toBe('2026-11-20T12:00:00Z');
  });

  it('skips openedOn on the exclusive end of the window', () => {
    expect(booksToWork([reading({ openedOn: '2026-11-23' })], deps)).toEqual([]);
  });

  it('finished via finishedOn uses the matching entry at', () => {
    const items = booksToWork([reading({
      status: 'finished', finishedOn: '2026-11-18',
      entries: [
        { id: 'e1', on: '2026-11-17', at: '2026-11-17T20:00:00Z', kind: 'progress', page: 30, source: 'card' },
        { id: 'e2', on: '2026-11-18', at: '2026-11-18T21:00:00Z', kind: 'finished', source: 'card' },
      ],
    })], deps);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ verb: 'finished', studyDay: '2026-11-18', at: '2026-11-18T21:00:00Z', groupKey: 'book:rdg_1:finished' });
  });

  it('finished via finishedOn with no matching entry falls back to noon UTC', () => {
    const [item] = booksToWork([reading({ status: 'finished', finishedOn: '2026-11-19' })], deps);
    expect(item).toMatchObject({ verb: 'finished', at: '2026-11-19T12:00:00Z', studyDay: '2026-11-19' });
  });

  it('finished via the latest finished entry when finishedOn is absent', () => {
    const [item] = booksToWork([reading({
      entries: [
        { id: 'e1', on: '2026-11-17', at: '2026-11-17T20:00:00Z', kind: 'finished', source: 'card' },
        { id: 'e2', on: '2026-11-21', at: '2026-11-21T20:00:00Z', kind: 'finished', source: 'card' },
        { id: 'e3', on: '2026-11-25', at: '2026-11-25T20:00:00Z', kind: 'finished', source: 'card' },
      ],
    })], deps);
    expect(item).toMatchObject({ verb: 'finished', studyDay: '2026-11-21', at: '2026-11-21T20:00:00Z' });
  });

  it('finishedOn outside the window falls through to an in-window finished entry', () => {
    const [item] = booksToWork([reading({
      finishedOn: '2026-11-10',
      entries: [{ id: 'e1', on: '2026-11-17', at: '2026-11-17T20:00:00Z', kind: 'finished', source: 'card' }],
    })], deps);
    expect(item).toMatchObject({ verb: 'finished', studyDay: '2026-11-17' });
  });

  it('emits both started and finished in one week', () => {
    const items = booksToWork([reading({ openedOn: '2026-11-16', finishedOn: '2026-11-20', status: 'finished' })], deps);
    expect(items.map((i) => i.verb)).toEqual(['started', 'finished']);
  });

  it('skips unread readings', () => {
    expect(booksToWork([reading({ status: 'unread', openedOn: '2026-11-17' })], deps)).toEqual([]);
  });

  it('missing book metadata becomes "A book" with no author', () => {
    const [item] = booksToWork([reading({ book: { isbn: '999' }, openedOn: '2026-11-17' })], deps);
    expect(item).toMatchObject({ title: 'A book', subtitle: null, imageUrl: '/cover/999' });
  });

  it('every item carries exactly the contract keys', () => {
    expectContract(booksToWork([reading({ openedOn: '2026-11-16', finishedOn: '2026-11-20' })], deps));
  });

  it('never copies graded fields from the reading', () => {
    expectNoGraded(booksToWork([reading({ ...SENTINEL, openedOn: '2026-11-16', finishedOn: '2026-11-20' })], deps));
  });

  it('falls back to the ISBN for groupKey when the reading has no id', () => {
    const items = booksToWork([reading({ id: undefined, openedOn: '2026-11-16', finishedOn: '2026-11-20' })], deps);
    expect(items.map((i) => i.groupKey)).toEqual(['book:111:started', 'book:111:finished']);
  });

  it('skips a reading with neither id nor ISBN', () => {
    expect(booksToWork([reading({ id: undefined, book: {}, openedOn: '2026-11-16' })], deps)).toEqual([]);
  });
});

describe('sessionsToWork', () => {
  const summaries = {
    u1: { unitId: 'u1', title: 'Fractions 1', subject: 'math', courseId: 'math-3', courseTitle: 'Math 3' },
    u2: { unitId: 'u2', title: 'Loose unit', subject: 'science', courseId: null, courseTitle: null },
  };
  const deps = { ...BASE, unitSummary: (unitId) => summaries[unitId] ?? null };
  const session = (over) => ({
    sessionId: 's1', learnerId: 'kid-a', unitId: 'u1', state: 'graded', terminal: true,
    outcome: { result: 'passed', at: '2026-11-17T19:00:00Z' }, ...SENTINEL,
    studyDay: '2026-11-17', updatedAt: '2026-11-17T19:05:00Z',
    ...over,
  });

  it('tolerates null input', () => {
    expect(sessionsToWork(null, deps)).toEqual([]);
  });

  it('projects a passed terminal session as a completed course item', () => {
    expect(sessionsToWork([session()], deps)).toEqual([{
      learnerId: 'kid-a', learnerName: 'Kid A', kind: 'course', verb: 'completed',
      title: 'Math 3', subtitle: 'Fractions 1', at: '2026-11-17T19:00:00Z',
      studyDay: '2026-11-17', groupKey: 'course:math-3', weight: 1, subject: 'math',
      imageUrl: '/api/v1/weekly-review/school/image?ref=' + encodeURIComponent('course:math-3'),
    }]);
  });

  it('any terminal session reads "completed", and at falls back to updatedAt', () => {
    const [item] = sessionsToWork([session({ outcome: null })], deps);
    expect(item).toMatchObject({ verb: 'completed', at: '2026-11-17T19:05:00Z' });
  });

  it('a failed session reads exactly like a passed one: nothing about the result leaks', () => {
    const [passed] = sessionsToWork([session({ outcome: { result: 'passed', at: '2026-11-17T19:01:00Z' } })], deps);
    const [failed] = sessionsToWork([session({ outcome: { result: 'failed', at: '2026-11-17T19:01:00Z' } })], deps);
    expect(failed).toMatchObject({ verb: 'completed', at: '2026-11-17T19:01:00Z' });
    expect(failed).toEqual(passed);
    expect(Object.keys(failed).sort()).toEqual([...WORK_ITEM_KEYS].sort());
    expect(JSON.stringify(failed)).not.toMatch(/fail|pass|result/i);
  });

  it('uses the last path segment of a subject/course id for groupKey and image', () => {
    const nested = { u3: { unitId: 'u3', title: 'Long division', subject: 'math', courseId: 'math/saxon-5', courseTitle: 'Saxon 5' } };
    const [item] = sessionsToWork([session({ unitId: 'u3' })], { ...BASE, unitSummary: (id) => nested[id] ?? null });
    expect(item.groupKey).toBe('course:saxon-5');
    expect(item.imageUrl).toBe('/api/v1/weekly-review/school/image?ref=' + encodeURIComponent('course:saxon-5'));
  });

  it('skips non-terminal sessions', () => {
    expect(sessionsToWork([session({ terminal: false }), session({ terminal: undefined })], deps)).toEqual([]);
  });

  it('respects window edges', () => {
    const items = sessionsToWork([
      session({ sessionId: 'a', studyDay: '2026-11-16' }),
      session({ sessionId: 'b', studyDay: '2026-11-23' }),
      session({ sessionId: 'c', studyDay: '2026-11-15' }),
    ], deps);
    expect(items.map((i) => i.studyDay)).toEqual(['2026-11-16']);
  });

  it('unit without a course uses unit title, no subtitle, unit groupKey, no image', () => {
    const [item] = sessionsToWork([session({ unitId: 'u2' })], deps);
    expect(item).toMatchObject({ title: 'Loose unit', subtitle: null, groupKey: 'course:u2', imageUrl: null, subject: 'science' });
  });

  it('missing unit summary becomes "Schoolwork"', () => {
    const [item] = sessionsToWork([session({ unitId: 'gone' })], deps);
    expect(item).toMatchObject({ title: 'Schoolwork', subtitle: null, groupKey: 'course:gone', imageUrl: null, subject: null });
  });

  it('never carries graded fields: keys equal the contract exactly', () => {
    const items = sessionsToWork([session(), session({ unitId: 'u2' }), session({ unitId: 'gone' })], deps);
    expect(items).toHaveLength(3);
    expectContract(items);
    expectNoGraded(items);
  });
});

describe('activitiesToWork', () => {
  const issuance = (over) => ({
    issuanceId: 'iss-1', learnerId: 'kid-a', programId: 'printed-activity', corpusId: 'beeloo',
    platform: 'beeloo', externalId: 'x1', title: 'Australia Maze', kind: 'maze', level: 5,
    issuedAt: '2026-11-16T15:00:00Z', issuedStudyDay: '2026-11-16',
    completedAt: '2026-11-16T22:00:00Z', completedStudyDay: '2026-11-16', completedVia: 'scan',
    voidedAt: null, voidReason: null, lastPrintedAt: '2026-11-16T15:00:00Z',
    ...over,
  });

  it('tolerates null input', () => {
    expect(activitiesToWork(undefined, BASE)).toEqual([]);
  });

  it('projects a completed issuance', () => {
    expect(activitiesToWork([issuance()], BASE)).toEqual([{
      learnerId: 'kid-a', learnerName: 'Kid A', kind: 'activity', verb: 'completed',
      title: 'Australia Maze', subtitle: 'Maze · level 5', at: '2026-11-16T22:00:00Z',
      studyDay: '2026-11-16', groupKey: 'activity:iss-1', weight: 1, subject: 'activity',
      imageUrl: '/api/v1/weekly-review/school/image?ref=' + encodeURIComponent('activity:iss-1'),
    }]);
  });

  it('omits the level part when level is not a number', () => {
    const [item] = activitiesToWork([issuance({ kind: 'sudoku', level: null })], BASE);
    expect(item.subtitle).toBe('Sudoku');
  });

  it('names Beeloo kinds as a person reads them', () => {
    const [item] = activitiesToWork([issuance({ kind: 'colorbynumber', level: 3 })], BASE);
    expect(item.subtitle).toBe('Color by number · level 3');
  });

  it('skips voided and incomplete issuances', () => {
    expect(activitiesToWork([
      issuance({ voidedAt: '2026-11-17T00:00:00Z', voidReason: 'reprint' }),
      issuance({ completedAt: null, completedStudyDay: null }),
    ], BASE)).toEqual([]);
  });

  it('respects window edges', () => {
    const items = activitiesToWork([
      issuance({ issuanceId: 'a', completedStudyDay: '2026-11-22' }),
      issuance({ issuanceId: 'b', completedStudyDay: '2026-11-23' }),
    ], BASE);
    expect(items.map((i) => i.groupKey)).toEqual(['activity:a']);
  });

  it('every item carries exactly the contract keys', () => {
    expectContract(activitiesToWork([issuance()], BASE));
  });

  it('never copies graded fields from the issuance', () => {
    expectNoGraded(activitiesToWork([issuance(SENTINEL)], BASE));
  });

  it('never leaves the title blank', () => {
    const [fromKind, bare] = activitiesToWork([
      issuance({ issuanceId: 'a', title: '', kind: 'maze', level: 3 }),
      issuance({ issuanceId: 'b', title: null, kind: null, level: null }),
    ], BASE);
    expect(fromKind.title).toBe('Maze · level 3');
    expect(bare.title).toBe('A printed page');
  });
});

describe('cardLadderToWork', () => {
  const deps = { ...BASE, packageId: 'korean', packageTitle: 'Korean' };
  const day = (over) => ({
    day: '2026-11-18', items: { c1: { box: 2 }, c2: { box: 1 }, c3: { box: 1 } },
    sittings: 1, activeMs: 120000, doneAt: '2026-11-18T23:00:00Z', rounds: 2, drills: [],
    ...over,
  });

  it('tolerates null input', () => {
    expect(cardLadderToWork(null, deps)).toEqual([]);
  });

  it('projects a worked day', () => {
    expect(cardLadderToWork([day()], deps)).toEqual([{
      learnerId: 'kid-a', learnerName: 'Kid A', kind: 'program', verb: 'worked',
      title: 'Korean', subtitle: '3 words', at: '2026-11-18T23:00:00Z', studyDay: '2026-11-18',
      imageUrl: '/api/v1/weekly-review/school/image?ref=' + encodeURIComponent('program:card-ladder:korean'),
      groupKey: 'program:card-ladder:korean', weight: 3, subject: 'language',
    }]);
  });

  it('has no image without a package id', () => {
    for (const packageId of [undefined, null, '', 42]) {
      const [item] = cardLadderToWork([day()], { ...deps, packageId });
      expect(item.imageUrl).toBeNull();
    }
  });

  it('uses "1 word" for a single card and noon UTC without doneAt', () => {
    const [item] = cardLadderToWork([day({ items: { c1: {} }, doneAt: undefined })], deps);
    expect(item).toMatchObject({ subtitle: '1 word', weight: 1, at: '2026-11-18T12:00:00Z' });
  });

  it('falls back to packageId, then a generic title', () => {
    const [item] = cardLadderToWork([day()], { ...deps, packageTitle: undefined });
    expect(item.title).toBe('korean');
    const [bare] = cardLadderToWork([day()], { ...deps, packageTitle: undefined, packageId: undefined });
    expect(bare.title).toBe('Language practice');
  });

  it('skips empty days and respects window edges', () => {
    const items = cardLadderToWork([
      day({ day: '2026-11-17', items: {} }),
      day({ day: '2026-11-19', items: undefined }),
      day({ day: '2026-11-16' }),
      day({ day: '2026-11-23' }),
    ], deps);
    expect(items.map((i) => i.studyDay)).toEqual(['2026-11-16']);
  });

  it('every item carries exactly the contract keys', () => {
    expectContract(cardLadderToWork([day()], deps));
  });
});

describe('JSON round trip', () => {
  it('every projection keeps the full contract key set after JSON', () => {
    const W = { ...BASE };
    const items = [
      ...booksToWork([{ id: 'r', book: {}, status: 'reading', openedOn: '2026-11-16', finishedOn: '2026-11-17' }], { ...W }),
      ...sessionsToWork([{ sessionId: 's', unitId: 'u', terminal: true, studyDay: '2026-11-17' }], { ...W }),
      ...activitiesToWork([{ issuanceId: 'i', completedStudyDay: '2026-11-17' }], W),
      ...cardLadderToWork([{ day: '2026-11-17', items: { a: {} } }], { ...W }),
      ...booksToWork([{ id: 'r2', book: {}, status: 'reading', openedOn: '2026-11-18' }], { learnerId: undefined, from: BASE.from, to: BASE.to }),
    ];
    expect(items).toHaveLength(6);
    for (const item of items) {
      const copy = JSON.parse(JSON.stringify(item));
      expect(Object.keys(copy).sort()).toEqual([...WORK_ITEM_KEYS].sort());
      expect(typeof copy.title).toBe('string');
      expect(copy.title.length).toBeGreaterThan(0);
      expect(Number.isFinite(copy.weight)).toBe(true);
    }
  });
});

describe('activityKindLabel', () => {
  it.each([
    ['maze', 'Maze'], ['sudoku', 'Sudoku'], ['coloring', 'Coloring'], ['colorbynumber', 'Color by number'],
    ['tracing', 'Tracing'], ['wordsearch', 'Word search'], ['dottodot', 'Dot to dot'], ['crossword', 'Crossword'],
    ['ColorByNumber', 'Color by number'],
  ])('known kind %j → %j', (kind, label) => {
    expect(activityKindLabel(kind)).toBe(label);
  });

  it.each([
    ['spotTheDifference', 'Spot the difference'], ['word_find', 'Word find'],
    ['connect-the-dots', 'Connect the dots'], ['MATH_facts', 'Math facts'], ['puzzle', 'Puzzle'],
  ])('unknown kind %j splits into sentence case %j', (kind, label) => {
    expect(activityKindLabel(kind)).toBe(label);
  });

  it.each([null, undefined, '', '   ', '---', 42])('no label for %j', (kind) => {
    expect(activityKindLabel(kind)).toBeNull();
  });
});

describe('tidyTitle', () => {
  it('title-cases all-caps catalog titles', () => {
    expect(tidyTitle('PSALMS OF PRAISE')).toBe('Psalms of Praise');
    expect(tidyTitle('THE CAT IN THE HAT')).toBe('The Cat in the Hat');
    expect(tidyTitle('WAR: AND PEACE OF THE')).toBe('War: And Peace of The');
  });
  it('removes space before punctuation and collapses whitespace', () => {
    expect(tidyTitle('Wow in the World : the How and Wow of the Human Body'))
      .toBe('Wow in the World: the How and Wow of the Human Body');
    expect(tidyTitle('  Hello ,   world !  ')).toBe('Hello, world!');
  });
  it('leaves mixed-case titles alone', () => {
    expect(tidyTitle('iPhone')).toBe('iPhone');
    expect(tidyTitle('Mrs. Granger Is in Danger!')).toBe('Mrs. Granger Is in Danger!');
  });
  it('cannot tell acronyms in all-caps titles (documented limitation)', () => {
    expect(tidyTitle('THE BFG')).toBe('The Bfg');
  });
  it('leaves short all-caps strings and non-strings alone', () => {
    expect(tidyTitle('ABC')).toBe('ABC');
    expect(tidyTitle('1984')).toBe('1984');
    expect(tidyTitle(null)).toBe(null);
  });
  it('booksToWork tidies titles but not authors', () => {
    const [item] = booksToWork([{ id: 'r', book: { isbn: '5' }, status: 'reading', openedOn: '2026-11-17' }], {
      ...BASE, bookFor: () => ({ title: 'PSALMS OF PRAISE', authors: ['JOHN DOE'] }), coverUrlFor: () => null,
    });
    expect(item.title).toBe('Psalms of Praise');
    expect(item.subtitle).toBe('JOHN DOE');
  });
});

// Household study day: Los Angeles, 4am boundary (the composition's dayOf).
const laDayOf = (iso) => studyDayForInstant(Date.parse(iso), { timezone: 'America/Los_Angeles' });

describe('pianoLessonsToWork', () => {
  const evidence = (over = {}) => ({
    schema: 'school.learning-evidence/v1',
    evidenceId: `piano-lesson:kid-a:${over.lessonId ?? 'plex:694833'}:${over.occurredAt ?? ''}`,
    learnerId: 'kid-a',
    occurredAt: '2026-11-20T01:20:23.354Z',
    verification: 'verified',
    activity: { id: 'plex:694833', kind: 'piano_lesson', graded: false, itemId: 'plex:694833', action: 'complete' },
    learning: { subjectId: 'arts', courseId: 'plex:694771', unitId: '694771', lessonId: over.lessonId ?? 'plex:694833' },
    measures: { engagements: 1, responses: 0, correct: 0, completions: 1, durationMs: 0, ...SENTINEL },
    ...over,
  });
  const titles = { 'plex:694833': 'Lesson 50 | Jingle Bells: Simple Version (Right Hand)' };
  const deps = {
    ...BASE,
    dayOf: laDayOf,
    lessonTitleFor: (id) => titles[id] ?? null,
    courseTitleFor: (id) => (id === 'plex:694771' ? 'PIANO ADVENTURES PRIMER' : null),
  };

  it('tolerates null input', () => {
    expect(pianoLessonsToWork(null, deps)).toEqual([]);
  });

  it('projects a finished lesson as a completed course session', () => {
    // 01:20Z on the 20th is the evening of the 19th in Los Angeles.
    expect(pianoLessonsToWork([evidence()], deps)).toEqual([{
      learnerId: 'kid-a', learnerName: 'Kid A', kind: 'course', verb: 'completed',
      title: 'Piano Adventures Primer', subtitle: 'Lesson 50 · Jingle Bells: Simple Version (Right Hand)',
      at: '2026-11-20T01:20:23.354Z', studyDay: '2026-11-19',
      imageUrl: '/api/v1/display/plex/694771',
      groupKey: 'course:plex:694771', weight: 1, subject: 'music',
    }]);
  });

  it('assigns study days by household time, not the UTC date, at both window edges', () => {
    const items = pianoLessonsToWork([
      evidence({ lessonId: 'a', occurredAt: '2026-11-16T06:00:00Z' }), // 22:00 on the 15th in LA → out
      evidence({ lessonId: 'b', occurredAt: '2026-11-16T13:00:00Z' }), // 05:00 on the 16th → in
      evidence({ lessonId: 'c', occurredAt: '2026-11-23T07:00:00Z' }), // 23:00 on the 22nd → in
      evidence({ lessonId: 'd', occurredAt: '2026-11-23T11:30:00Z' }), // 03:30 on the 23rd → still the 22nd
      evidence({ lessonId: 'e', occurredAt: '2026-11-23T12:30:00Z' }), // 04:30 on the 23rd → out
    ], deps);
    expect(items.map((i) => i.studyDay)).toEqual(['2026-11-16', '2026-11-22', '2026-11-22']);
  });

  it('ignores other evidence kinds and other learners', () => {
    const items = pianoLessonsToWork([
      evidence({ activity: { kind: 'video_lesson' } }),
      evidence({ learnerId: 'kid-b' }),
      evidence(),
    ], deps);
    expect(items).toHaveLength(1);
  });

  it('emits the same evidence row only once', () => {
    expect(pianoLessonsToWork([evidence(), evidence()], deps)).toHaveLength(1);
  });

  it('falls back to "Piano" with no subtitle when neither title is known', () => {
    const [item] = pianoLessonsToWork([evidence({ lessonId: 'plex:1' })], { ...deps, courseTitleFor: () => null });
    expect(item).toMatchObject({ title: 'Piano', subtitle: null, groupKey: 'course:plex:694771' });
    const [bare] = pianoLessonsToWork([evidence()], { ...BASE, dayOf: laDayOf });
    expect(bare).toMatchObject({ title: 'Piano', subtitle: null });
  });

  it('has no image and a generic group without a Plex course id', () => {
    const [item] = pianoLessonsToWork([evidence({ learning: { lessonId: 'plex:694833' } })], deps);
    expect(item).toMatchObject({ imageUrl: null, groupKey: 'course:piano' });
  });

  it('falls back to the UTC date without a dayOf', () => {
    const [item] = pianoLessonsToWork([evidence({ occurredAt: '2026-11-18T20:00:00Z' })], { ...BASE });
    expect(item.studyDay).toBe('2026-11-18');
  });

  it('never carries a score from the evidence or the sitting', () => {
    const items = pianoLessonsToWork([evidence()], {
      ...deps,
      lessonTitleFor: () => ({ title: 'x', score: 87.654, percent: 7654 }).title,
    });
    expectNoGraded(items);
    expectContract(items);
  });
});

describe('sentenceLadderToWork', () => {
  const ev = (at, seq, over = {}) => ({
    at, day: 35, seq, rung: 'dictation', attributedTo: 'kid-a',
    expected: '몇 살이에요?', given: '몇 살', heard: '몇', accuracy: 0.87654, method: 'typed', ...over,
  });
  const deps = { ...BASE, corpusId: 'glossika-korean', corpusTitle: 'Glossika Korean', dayOf: laDayOf };

  it('tolerates null input', () => {
    expect(sentenceLadderToWork(null, deps)).toEqual([]);
  });

  it('counts distinct sentences per study day', () => {
    expect(sentenceLadderToWork([
      ev('2026-11-18T20:00:00Z', 1, { rung: 'repetition' }),
      ev('2026-11-18T20:01:00Z', 2),
      ev('2026-11-18T20:02:00Z', 1),
    ], deps)).toEqual([{
      learnerId: 'kid-a', learnerName: 'Kid A', kind: 'program', verb: 'worked',
      title: 'Glossika Korean', subtitle: '2 sentences', at: '2026-11-18T20:02:00Z', studyDay: '2026-11-18',
      imageUrl: '/api/v1/weekly-review/school/image?ref=' + encodeURIComponent('program:sentence-ladder:glossika-korean'),
      groupKey: 'program:sentence-ladder:glossika-korean', weight: 2, subject: 'language',
    }]);
  });

  it('assigns events across UTC midnight to the household study day', () => {
    // 03:41Z on the 21st is the evening of the 20th in Los Angeles; the two
    // events share a study day though their UTC dates (and log shards) differ.
    const items = sentenceLadderToWork([
      ev('2026-11-20T23:00:00Z', 5),
      ev('2026-11-21T03:41:09Z', 6),
    ], deps);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ studyDay: '2026-11-20', subtitle: '2 sentences', at: '2026-11-21T03:41:09Z' });
  });

  it('respects window edges by study day and uses "1 sentence"', () => {
    const items = sentenceLadderToWork([
      ev('2026-11-16T06:00:00Z', 1), // 15th in LA → out
      ev('2026-11-16T13:00:00Z', 2), // 16th → in
      ev('2026-11-23T11:30:00Z', 3), // 03:30 on the 23rd → the 22nd
      ev('2026-11-23T12:30:00Z', 4), // 23rd → out
    ], deps);
    expect(items.map((i) => [i.studyDay, i.subtitle])).toEqual([['2026-11-16', '1 sentence'], ['2026-11-22', '1 sentence']]);
  });

  it('skips events without a sentence number or a timestamp', () => {
    expect(sentenceLadderToWork([ev('2026-11-18T20:00:00Z', null), ev(null, 4), { seq: 5 }], deps)).toEqual([]);
  });

  it('falls back to the corpus id when there is no title', () => {
    const [item] = sentenceLadderToWork([ev('2026-11-18T20:00:00Z', 1)], { ...deps, corpusTitle: undefined });
    expect(item.title).toBe('glossika-korean');
  });

  it('never carries accuracy or what was heard', () => {
    const items = sentenceLadderToWork([ev('2026-11-18T20:00:00Z', 1)], deps);
    expectContract(items);
    for (const item of items) {
      const values = Object.values(item);
      expect(values).not.toContain(0.87654);
      expect(values).not.toContain('몇');
      expect(values).not.toContain('몇 살');
    }
  });
});
