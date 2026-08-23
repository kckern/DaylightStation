import { describe, it, expect } from 'vitest';
import { planDailyAgenda } from '#domains/school/agenda.mjs';

const NOW = '2026-07-29T16:00:00Z'; // 09:00 PDT
const TZ = 'America/Los_Angeles';
const entry = (over) => ({
  unitId: 'u1', title: 'Unit One', subject: 'math', courseId: 'c', sequence: 1,
  elective: false, status: 'available', sessionId: null, state: null,
  lockReason: null, remedy: null, unlocks: null, program: null, cadence: null, ...over,
});
const plan = (entries) => ({ entries, errors: [] });
const args = (over = {}) => ({ plan: plan([]), sessions: [], programStatuses: {}, now: NOW, timezone: TZ, ...over });

describe('dated module ranking', () => {
  it('picks the current dated module over an older one at equal priority', () => {
    const entries = [
      entry({ unitId: 'cfm.w1.d1', subject: 'scripture', courseId: 'cfm', timingPriority: 3, timingRank: 1, timingState: 'catch_up' }),
      entry({ unitId: 'cfm.w2.d1', subject: 'scripture', courseId: 'cfm', timingPriority: 3, timingRank: 0, timingState: 'available' }),
    ];
    const { sections } = planDailyAgenda({ plan: { entries }, now: '2026-09-01T09:00:00.000Z' });
    expect(sections.find((section) => section.subject === 'scripture').next.unitId).toBe('cfm.w2.d1');
  });
});

describe('planDailyAgenda', () => {
  it('groups by subject in the nine-subject order, then other', () => {
    const { sections } = planDailyAgenda(args({ plan: plan([
      entry({ unitId: 'a', subject: 'language' }),
      entry({ unitId: 'b', subject: 'math' }),
      entry({ unitId: 'c', subject: null }),
    ]) }));
    expect(sections.map((s) => s.subject)).toEqual(['math', 'language', 'other']);
  });

  it('servedToday on a PASSING outcome this study day — and picks no next', () => {
    const { sections } = planDailyAgenda(args({
      plan: plan([entry({ unitId: 'u1', status: 'completed' }), entry({ unitId: 'u2', sequence: 2 })]),
      sessions: [{ sessionId: 's1', unitId: 'u1', state: 'closed', terminal: true,
        outcome: { result: 'passed', at: '2026-07-29T15:00:00Z' }, gradedPercent: 90, updatedAt: '2026-07-29T15:00:00Z' }],
    }));
    expect(sections[0].servedToday).toBe(true);
    expect(sections[0].next).toBeNull();
  });

  it('a FAILED outcome today does NOT serve — the retry stays offered', () => {
    const { sections } = planDailyAgenda(args({
      plan: plan([entry({ unitId: 'u1', status: 'in_progress', sessionId: 's1', state: 'outcome_recorded' })]),
      sessions: [{ sessionId: 's1', unitId: 'u1', state: 'outcome_recorded', terminal: false,
        outcome: { result: 'needs_remediation', at: '2026-07-29T15:00:00Z' }, gradedPercent: 40, updatedAt: '2026-07-29T15:00:00Z' }],
    }));
    expect(sections[0].servedToday).toBe(false);
    expect(sections[0].next.unitId).toBe('u1');
  });

  it("yesterday's pass does not serve today (1am boundary honoured)", () => {
    const { sections } = planDailyAgenda(args({
      plan: plan([entry({ unitId: 'u1', status: 'completed' }), entry({ unitId: 'u2', sequence: 2 })]),
      // 2026-07-29T08:00Z = 1am PDT → previous study day
      sessions: [{ sessionId: 's1', unitId: 'u1', state: 'closed', terminal: true,
        outcome: { result: 'passed', at: '2026-07-29T08:00:00Z' }, gradedPercent: 90, updatedAt: '2026-07-29T08:00:00Z' }],
    }));
    expect(sections[0].servedToday).toBe(false);
    expect(sections[0].next.unitId).toBe('u2');
  });

  it('program doneToday serves its subject; progressLabel comes from the launcher', () => {
    const { sections } = planDailyAgenda(args({
      plan: plan([entry({ unitId: 'language-daily', subject: 'language', courseId: null, sequence: null, program: 'language', cadence: 'daily' })]),
      programStatuses: { language: { doneToday: true, progressLabel: 'Day 61', score: null } },
    }));
    expect(sections[0]).toMatchObject({ subject: 'language', servedToday: true, next: null, progressLabel: 'Day 61' });
  });

  it('a launcher error marks the section unavailable without touching others', () => {
    const { sections } = planDailyAgenda(args({
      plan: plan([
        entry({ unitId: 'language-daily', subject: 'language', courseId: null, sequence: null, program: 'language', cadence: 'daily' }),
        entry({ unitId: 'm1', subject: 'math' }),
      ]),
      programStatuses: { language: { error: true } },
    }));
    const lang = sections.find((s) => s.subject === 'language');
    expect(lang.programUnavailable).toBe(true);
    expect(lang.next).toBeNull();
    expect(sections.find((s) => s.subject === 'math').next.unitId).toBe('m1');
  });

  it('next = first in_progress, else first available; all-locked yields the remedy line', () => {
    const { sections } = planDailyAgenda(args({ plan: plan([
      entry({ unitId: 'u2', sequence: 2, status: 'locked', lockReason: 'Finish “Unit One” first',
        remedy: { unitId: 'u1', title: 'Unit One', action: 'start' } }),
    ]) }));
    expect(sections[0].next).toBeNull();
    expect(sections[0].lockedRemedy).toBe('Finish “Unit One” first');
  });

  it('carries the validated SchoolCalc descriptor through section.next without side effects', () => {
    const schoolcalc = {
      mode: 'adaptive_flashcards',
      study: { cardCount: 12, maxExposuresPerCard: 4 },
      quiz: { itemCount: 10 },
    };
    const input = entry({ schoolcalc });
    const { sections } = planDailyAgenda(args({ plan: plan([input]) }));
    expect(sections[0].next.schoolcalc).toEqual(schoolcalc);
    expect(sections[0].next.schoolcalc).toBe(schoolcalc);
  });

  it('progress: single course → Unit N of M; complete → Course complete; multi-course → x of y done', () => {
    const single = planDailyAgenda(args({ plan: plan([
      entry({ unitId: 'u1', status: 'completed' }), entry({ unitId: 'u2', sequence: 2 }),
      entry({ unitId: 'u3', sequence: 3 }), entry({ unitId: 'u4', sequence: 4 }),
    ]) }));
    expect(single.sections[0].progressLabel).toBe('Unit 2 of 4');
    const done = planDailyAgenda(args({ plan: plan([entry({ unitId: 'u1', status: 'completed' })]) }));
    expect(done.sections[0].progressLabel).toBe('Course complete');
    const multi = planDailyAgenda(args({ plan: plan([
      entry({ unitId: 'a1', courseId: 'a', status: 'completed' }),
      entry({ unitId: 'b1', courseId: 'b' }),
    ]) }));
    expect(multi.sections[0].progressLabel).toBe('1 of 2 done');
  });

  it('progress: a real course mixed with a standalone entry is "done" counting, not "Unit N of M"', () => {
    const { sections } = planDailyAgenda(args({ plan: plan([
      entry({ unitId: 'u1', status: 'completed', courseId: 'c' }),
      entry({ unitId: 'u2', courseId: null, sequence: null }),
    ]) }));
    expect(sections[0].progressLabel).toBe('1 of 2 done');
  });

  it('grade: mean of latest gradedPercent per attempted unit, program score blended; no evidence → null', () => {
    const { sections } = planDailyAgenda(args({
      plan: plan([entry({ unitId: 'u1', status: 'completed' }), entry({ unitId: 'u2', sequence: 2 })]),
      sessions: [
        { sessionId: 's0', unitId: 'u1', state: 'closed', terminal: true,
          outcome: { result: 'needs_remediation', at: '2026-07-20T15:00:00Z' }, gradedPercent: 40, updatedAt: '2026-07-20T15:00:00Z' },
        { sessionId: 's1', unitId: 'u1', state: 'closed', terminal: true,
          outcome: { result: 'passed', at: '2026-07-21T15:00:00Z' }, gradedPercent: 90, updatedAt: '2026-07-21T15:00:00Z' },
      ],
    }));
    expect(sections[0].gradePercent).toBe(90); // latest attempt only, u2 unattempted is NOT a zero
    const none = planDailyAgenda(args({ plan: plan([entry({})]) }));
    expect(none.sections[0].gradePercent).toBeNull();
  });

  it('grade: a later millisecond-precision timestamp beats an earlier one numerically, not lexically', () => {
    const { sections } = planDailyAgenda(args({
      plan: plan([entry({ unitId: 'u1', status: 'completed' })]),
      sessions: [
        { sessionId: 's0', unitId: 'u1', state: 'closed', terminal: true,
          outcome: { result: 'needs_remediation', at: '2026-07-21T15:00:00Z' }, gradedPercent: 40, updatedAt: '2026-07-21T15:00:00Z' },
        { sessionId: 's1', unitId: 'u1', state: 'closed', terminal: true,
          outcome: { result: 'passed', at: '2026-07-21T15:00:00.001Z' }, gradedPercent: 90, updatedAt: '2026-07-21T15:00:00.001Z' },
      ],
    }));
    expect(sections[0].gradePercent).toBe(90);
  });
});
