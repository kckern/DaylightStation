import { describe, expect, it, vi } from 'vitest';
import { createSchoolAchievementProvider, SCHOOL_ACHIEVEMENT_ACTIVITIES } from "./SchoolAchievementProvider.mjs";
import { masteryMilestones, isPerfectSheet, firstFinishes, daysOfWeek } from "../domain/achievements.mjs";

const WEEK = { from: '2026-11-02', to: '2026-11-08' };
// A Pacific 4am-boundary study day, as the economy hands it in.
const studyDay = (ms) => new Date(ms - (8 + 4) * 3_600_000).toISOString().slice(0, 10);
const logger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

const signOffs = (n, day = '2026-10-01') => Array.from({ length: n }, (_, i) => ({ wordId: `w${String(i).padStart(2, '0')}`, day }));

function deps(overrides = {}) {
  return {
    cardLadder: {
      achievementRecord: vi.fn(async ({ userId }) => (userId === 'kidB' ? { packages: [
        { package: 'korean-vocab', doneDays: ['2026-11-03', '2026-11-04'], signOffs: [...signOffs(18), { wordId: 'z1', day: '2026-11-03' }, { wordId: 'z2', day: '2026-11-04' }] },
        { package: 'korean-3-2', doneDays: ['2026-11-04', '2026-11-01'], signOffs: [] },
      ] } : { packages: [] })),
    },
    readingLog: { listForDay: vi.fn(async (id, day) => (id === 'kidC' && (day === '2026-11-03' || day === '2026-11-04') ? [{ title: 'ABC' }] : [])) },
    bookLog: {
      listForLearner: vi.fn(async (id) => (id === 'kidC' ? [
        { id: 'rdg_1', status: 'finished', finishedOn: '2026-11-05', book: { isbn: '111' }, entries: [] },
        { id: 'rdg_2', status: 'finished', finishedOn: '2026-11-05', book: { isbn: '111' }, entries: [] },
        { id: 'rdg_3', status: 'finished', finishedOn: '2026-11-06', book: { isbn: '222' }, entries: [] },
        { id: 'rdg_4', status: 'finished', finishedOn: '2026-10-01', book: { isbn: '222' }, entries: [] },
        { id: 'rdg_5', status: 'reading', finishedOn: null, book: { isbn: '333' }, entries: [] },
      ] : [])),
    },
    books: { findByIsbn: vi.fn(async (isbn) => (isbn === '111' ? { title: 'Hop on Pop' } : null)) },
    sessions: {
      execute: vi.fn(async ({ learnerId }) => (learnerId === 'kidB' ? [
        { sessionId: 'ses_a', unitId: 'math-1', gradedAt: '2026-11-03T20:00:00Z', gradedCorrectCount: 3, gradedTotalCount: 3, gradedPercent: 100, studyDay: '2026-11-03' },
        { sessionId: 'ses_b', unitId: 'math-2', gradedAt: '2026-11-03T21:00:00Z', gradedCorrectCount: 2, gradedTotalCount: 3, gradedPercent: 67 },
        // Graded Monday 2am Pacific: still Sunday's study day, last week.
        { sessionId: 'ses_c', unitId: 'math-3', gradedAt: '2026-11-02T10:00:00Z', gradedCorrectCount: 4, gradedTotalCount: 4 },
        { sessionId: 'ses_d', unitId: 'sentence-ladder:ko', gradedAt: '2026-11-04T20:00:00Z', gradedCorrectCount: 4, gradedTotalCount: 4 },
        { sessionId: 'ses_e', unitId: 'cfm-1', gradedAt: '2026-11-05T20:00:00Z', gradedPercent: 100 },
      ] : [])),
    },
    curriculum: { getUnitSummary: vi.fn(async (id) => (id === 'math-1' ? { title: 'Adding tens' } : null)) },
    logger: logger(),
    ...overrides,
  };
}

const run = (d, learnerIds = ['kidB', 'kidC']) => createSchoolAchievementProvider(d).week({ learnerIds, week: WEEK, studyDay, today: '2026-11-05' });

describe('createSchoolAchievementProvider', () => {
  it('names its activities', () => {
    const p = createSchoolAchievementProvider(deps());
    expect(p.name).toBe('school');
    expect(p.activities).toEqual(SCHOOL_ACHIEVEMENT_ACTIVITIES);
  });

  it('reads every activity for every learner', async () => {
    const out = await run(deps());
    expect(out.unavailable).toEqual([]);
    expect(out.contests).toEqual({});
    expect(out.learners.kidB.days['card-goal']).toEqual(['2026-11-03', '2026-11-04']);
    expect(out.learners.kidB.milestones['cards-mastered']).toEqual([{ key: '20', day: '2026-11-04', label: '20 words mastered' }]);
    expect(out.learners.kidB.milestones['perfect-sheet']).toEqual([
      { key: 'ses_a', day: '2026-11-03', label: 'Adding tens' },
      { key: 'ses_e', day: '2026-11-05', label: 'cfm-1' },
    ]);
    expect(out.learners.kidC.days['story-read']).toEqual(['2026-11-03', '2026-11-04']);
    // 111 once (two readings, one book); 222 was first finished in October.
    expect(out.learners.kidC.milestones['book-finished']).toEqual([{ key: '111', day: '2026-11-05', label: 'Hop on Pop' }]);
    expect(out.learners.kidC.days['card-goal']).toEqual([]);
    expect(out.learners.kidC.milestones['cards-mastered']).toEqual([]);
  });

  it('a failing source makes only its activities unavailable, for everyone', async () => {
    const d = deps({ bookLog: { listForLearner: vi.fn(async (id) => { if (id === 'kidC') throw new Error('corrupt shelf'); return []; }) } });
    const out = await run(d);
    expect(out.unavailable).toEqual(['book-finished']);
    expect(out.learners.kidB.milestones['book-finished']).toBeUndefined();
    expect(out.learners.kidC.milestones['book-finished']).toBeUndefined();
    expect(out.learners.kidC.days['story-read']).toEqual(['2026-11-03', '2026-11-04']);
    expect(d.logger.warn).toHaveBeenCalledWith('school.achievements.source-failed', expect.objectContaining({ learnerId: 'kidC', activities: ['book-finished'] }));
  });

  it('an unwired dependency is unavailable, not empty', async () => {
    const out = await run(deps({ cardLadder: null, sessions: null }));
    expect(out.unavailable.sort()).toEqual(['card-goal', 'cards-mastered', 'perfect-sheet']);
    expect(out.learners.kidB.days['card-goal']).toBeUndefined();
  });

  it('a label lookup failing does not fail the activity', async () => {
    const d = deps({ books: { findByIsbn: async () => { throw new Error('cache cold'); } }, curriculum: { getUnitSummary: async () => { throw new Error('x'); } } });
    const out = await run(d);
    expect(out.unavailable).toEqual([]);
    expect(out.learners.kidC.milestones['book-finished'][0].label).toBe('A book');
    expect(out.learners.kidB.milestones['perfect-sheet'][0].label).toBe('math-1');
  });
});

describe('achievement rules', () => {
  it('masteryMilestones: every 10th sign-off by day, ties by word id', () => {
    const rows = [...signOffs(9, '2026-10-01'), { wordId: 'b', day: '2026-10-05' }, { wordId: 'a', day: '2026-10-05' }];
    expect(masteryMilestones(rows)).toEqual([{ key: '10', day: '2026-10-05', label: '10 words mastered' }]);
    expect(masteryMilestones(signOffs(9))).toEqual([]);
    expect(masteryMilestones(signOffs(30)).map((m) => m.key)).toEqual(['10', '20', '30']);
  });
  it('isPerfectSheet needs a real graded event and full marks', () => {
    expect(isPerfectSheet({ unitId: 'u', gradedAt: 'x', gradedCorrectCount: 3, gradedTotalCount: 3 })).toBe(true);
    expect(isPerfectSheet({ unitId: 'u', gradedAt: 'x', gradedCorrectCount: 3, gradedTotalCount: 3, evidenceInvalidated: true })).toBe(false);
    expect(isPerfectSheet({ unitId: 'u', gradedAt: null, gradedPercent: 100 })).toBe(false); // external assessment
    expect(isPerfectSheet({ unitId: 'u', gradedAt: 'x', gradedCorrectCount: 0, gradedTotalCount: 0, gradedPercent: 0 })).toBe(false);
    expect(isPerfectSheet({ unitId: 'p:i', gradedAt: 'x', gradedPercent: 100 })).toBe(false);
  });
  it('firstFinishes keeps each book\'s earliest finish', () => {
    const map = firstFinishes([
      { status: 'finished', finishedOn: '2026-11-05', bookId: 'b' }, { status: 'finished', finishedOn: '2026-10-01', bookId: 'b' },
      { status: 'reading', finishedOn: '2026-09-01', bookId: 'b' },
    ]);
    expect(map.get('b').day).toBe('2026-10-01');
  });
  it('daysOfWeek spans the week inclusive', () => {
    expect(daysOfWeek(WEEK)).toHaveLength(7);
    expect(daysOfWeek(WEEK)[6]).toBe('2026-11-08');
  });
});
