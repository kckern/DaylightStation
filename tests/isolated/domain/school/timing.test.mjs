import { describe, expect, it } from 'vitest';
import { evaluateDatedModule, evaluateTiming, materializeTiming, normalizeTiming, studyDate } from '#domains/school/timing.mjs';
import { planLearnerWork } from '#domains/school/planner.mjs';
import { planDailyAgenda } from '#domains/school/agenda.mjs';

const TODAY = '2026-07-01';
const urgentTiming = {
  schema: 'school.timing/v1',
  availability: { opensOn: '2026-06-20', closesOn: '2026-07-10' },
  target: { dueOn: '2026-07-03', strength: 'firm' },
  basePriority: 'high', flexibility: 'flexible',
  agenda: { normalBlocks: 1, urgentBlocks: 3 }, urgencyLeadDays: 3,
};

describe('School timing', () => {
  it('uses the same 4am study-day boundary as the daily agenda', () => {
    // 03:00 PDT is still the prior study day.
    expect(studyDate('2026-07-01T10:00:00.000Z', 'America/Los_Angeles')).toBe('2026-06-30');
  });

  it('materializes an annual anchor as stable local plan dates', () => {
    const timing = materializeTiming({
      schema: 'school.timing-template/v1', defaultAnchorId: 'fourth-of-july',
      opensBeforeDays: 21, closesAfterDays: 1, targetOffsetDays: -1,
      targetStrength: 'firm', basePriority: 'high', flexibility: 'flexible',
      normalBlocks: 1, urgentBlocks: 3, urgencyLeadDays: 10,
    }, { anchorId: 'fourth-of-july', label: 'Fourth of July', kind: 'annual_date', month: 7, day: 4 }, { today: TODAY });
    expect(timing).toMatchObject({
      anchor: { anchorId: 'fourth-of-july', resolvedOn: '2026-07-04' },
      availability: { opensOn: '2026-06-13', closesOn: '2026-07-05' },
      target: { dueOn: '2026-07-03', strength: 'firm' },
    });
  });

  it('derives upcoming, urgent, aspirational-missed, and firm-dormant states without mutating timing', () => {
    expect(evaluateTiming({ ...urgentTiming, availability: { opensOn: '2026-07-02' } }, { today: TODAY }).state).toBe('upcoming');
    expect(evaluateTiming(urgentTiming, { today: TODAY })).toMatchObject({ state: 'urgent', priority: 1 });
    expect(evaluateTiming({ ...urgentTiming, target: { dueOn: '2026-06-30', strength: 'aspirational' } }, { today: TODAY }).state).toBe('missed_target');
    expect(evaluateTiming({ ...urgentTiming, target: { dueOn: '2026-06-30', strength: 'firm' } }, { today: TODAY }).state).toBe('dormant');
  });

  it('does not strand issued work after a firm window closes', () => {
    expect(evaluateTiming({ ...urgentTiming, availability: { closesOn: '2026-06-30' } }, { today: TODAY, inProgress: true }))
      .toMatchObject({ state: 'in_progress', priority: 0 });
  });

  it('gates a normal plan entry, but leaves its open worksheet resumable', () => {
    const units = [
      { unitId: 'science.01', title: 'Science', subject: 'science', courseId: 'science', sequence: 1 },
    ];
    const assignment = { courses: [{ courseId: 'science', timing: { ...urgentTiming, availability: { closesOn: '2026-06-30' } } }] };
    expect(planLearnerWork({ learnerId: 'learner3', assignment, units, sessions: [], now: `${TODAY}T12:00:00Z` }).entries[0].status).toBe('dormant');
    expect(planLearnerWork({ learnerId: 'learner3', assignment, units, sessions: [{ sessionId: 's1', unitId: 'science.01', terminal: false, state: 'issued', updatedAt: `${TODAY}T12:00:00Z` }], now: `${TODAY}T12:00:00Z` }).entries[0].status).toBe('in_progress');
  });

  it('fails closed on malformed parent-authored timing', () => {
    const units = [{ unitId: 'read.01', title: 'Read', subject: 'english' }];
    const result = planLearnerWork({
      learnerId: 'learner3', assignment: { units: [{ unitId: 'read.01', timing: 'soonish' }] }, units, sessions: [], now: `${TODAY}T12:00:00Z`,
    });
    expect(result.entries[0]).toMatchObject({ status: 'dormant', timingReasons: expect.arrayContaining(['invalid_timing']) });
  });
});

describe('focus-day agenda allocation', () => {
  const entry = (over) => ({
    unitId: 'u', title: 'Lesson', subject: 'math', courseId: 'course', status: 'available',
    timingState: 'available', timingPriority: 3, timingReasons: ['medium_base_priority'],
    timing: { flexibility: 'protected', agenda: { normalBlocks: 1, urgentBlocks: 1 } },
    ...over,
  });

  it('lets an urgent course chain after a pass and displaces only flexible subjects', () => {
    const scienceOne = entry({ unitId: 'science.01', subject: 'science', courseId: 'science', status: 'completed', timingState: 'urgent', timingPriority: 1, timing: urgentTiming });
    const scienceTwo = entry({ unitId: 'science.02', subject: 'science', courseId: 'science', timingState: 'urgent', timingPriority: 1, timing: urgentTiming });
    const math = entry({ unitId: 'math.01', subject: 'math', courseId: 'math', timingPriority: 4, timing: { ...urgentTiming, basePriority: 'low', agenda: { normalBlocks: 1, urgentBlocks: 1 } } });
    const english = entry({ unitId: 'english.01', subject: 'english', courseId: 'english', timingPriority: 3, timing: { ...urgentTiming, flexibility: 'protected', agenda: { normalBlocks: 1, urgentBlocks: 1 } } });
    const { sections } = planDailyAgenda({
      plan: { entries: [math, scienceOne, scienceTwo, english] },
      sessions: [{ unitId: 'science.01', outcome: { result: 'passed', at: '2026-07-01T12:00:00Z' }, updatedAt: '2026-07-01T12:00:00Z', gradedPercent: 90 }],
      now: '2026-07-01T16:00:00Z', timezone: 'UTC',
    });
    expect(sections.find((section) => section.subject === 'science')).toMatchObject({
      servedToday: false, next: { unitId: 'science.02' }, focus: { blocksCompleted: 1, blockBudget: 3 },
    });
    expect(sections.find((section) => section.subject === 'math')).toMatchObject({ next: null, suppressed: { bySubject: 'science' } });
    expect(sections.find((section) => section.subject === 'english').next.unitId).toBe('english.01');
  });

  it('explains a dormant or upcoming subject instead of silently dropping it', () => {
    const { sections } = planDailyAgenda({
      plan: { entries: [entry({ unitId: 'history.01', subject: 'history', status: 'dormant', timing: { availability: { closesOn: '2026-06-30' } } })] },
      now: '2026-07-01T16:00:00Z', timezone: 'UTC',
    });
    expect(sections[0]).toMatchObject({ next: null, timingNotice: 'Ask a grown-up to continue or reschedule this work.' });
  });
});

describe('evaluateDatedModule', () => {
  const moduleWindow = { opensOn: '2026-09-14', closesOn: '2026-09-20' };
  const shift = (day, offset) => new Date(Date.parse(`${day}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);

  it('is upcoming before the window opens', () => {
    expect(evaluateDatedModule(moduleWindow, { today: '2026-09-13' }))
      .toMatchObject({ state: 'upcoming', reasons: ['opens_later'] });
  });

  it('is available on the first and last day of the window', () => {
    expect(evaluateDatedModule(moduleWindow, { today: '2026-09-14' }))
      .toMatchObject({ state: 'available', reasons: ['current_module'] });
    expect(evaluateDatedModule(moduleWindow, { today: '2026-09-20' }))
      .toMatchObject({ state: 'available', reasons: ['current_module'] });
  });

  it('is catch_up after the window closes, however long ago', () => {
    expect(evaluateDatedModule(moduleWindow, { today: '2026-09-21' }))
      .toMatchObject({ state: 'catch_up', reasons: ['window_closed'] });
    expect(evaluateDatedModule(moduleWindow, { today: '2027-04-01' }))
      .toMatchObject({ state: 'catch_up', reasons: ['window_closed'] });
  });

  it('opens and closes a single-day window on the same day', () => {
    const oneDay = { opensOn: '2026-09-14', closesOn: '2026-09-14' };
    expect(evaluateDatedModule(oneDay, { today: '2026-09-13' }).state).toBe('upcoming');
    expect(evaluateDatedModule(oneDay, { today: '2026-09-14' }).state).toBe('available');
    expect(evaluateDatedModule(oneDay, { today: '2026-09-15' }).state).toBe('catch_up');
  });

  it('offers one of exactly three states across the whole calendar — dated backlog never expires', () => {
    // Sweeps opensOn-3 .. closesOn+60. Guards a FUTURE branch sneaking in a
    // `dormant` or `missed_target`, which is the regression the design fears.
    const seen = new Set();
    const last = shift(moduleWindow.closesOn, 60);
    for (let day = shift(moduleWindow.opensOn, -3); day <= last; day = shift(day, 1)) {
      const { state } = evaluateDatedModule(moduleWindow, { today: day });
      expect(['upcoming', 'available', 'catch_up']).toContain(state);
      seen.add(state);
    }
    expect([...seen].sort()).toEqual(['available', 'catch_up', 'upcoming']);
  });

  it('rejects a malformed or incomplete window rather than guessing', () => {
    expect(() => evaluateDatedModule({ opensOn: 'nope', closesOn: '2026-09-20' }, { today: '2026-09-15' }))
      .toThrow(/opensOn and closesOn/);
    expect(() => evaluateDatedModule({ opensOn: '2026-09-14' }, { today: '2026-09-15' }))
      .toThrow(/opensOn and closesOn/);
    expect(() => evaluateDatedModule({ closesOn: '2026-09-20' }, { today: '2026-09-15' }))
      .toThrow(/opensOn and closesOn/);
  });

  it('rejects a window that is not a mapping', () => {
    for (const notAWindow of [null, undefined, ['2026-09-14', '2026-09-20'], '2026-09-14']) {
      expect(() => evaluateDatedModule(notAWindow, { today: '2026-09-15' })).toThrow(/opensOn and closesOn/);
    }
  });

  it('rejects a missing or malformed today', () => {
    expect(() => evaluateDatedModule(moduleWindow, { today: 'nope' })).toThrow(/today/);
    expect(() => evaluateDatedModule(moduleWindow)).toThrow(/today/);
  });

  it('rejects an inverted window', () => {
    expect(() => evaluateDatedModule({ opensOn: '2026-09-20', closesOn: '2026-09-14' }, { today: '2026-09-15' }))
      .toThrow(/window closes before it opens/);
  });

});

describe('isDay rejects dates that do not exist', () => {
  it('rejects a rolled-over day through evaluateDatedModule', () => {
    expect(() => evaluateDatedModule({ opensOn: '2026-11-01', closesOn: '2026-11-31' }, { today: '2026-11-15' }))
      .toThrow(/opensOn and closesOn/);
    expect(() => evaluateDatedModule({ opensOn: '2026-02-30', closesOn: '2026-03-05' }, { today: '2026-03-01' }))
      .toThrow(/opensOn and closesOn/);
  });

  it('rejects a rolled-over day through normalizeTiming', () => {
    const { errors } = normalizeTiming({
      schema: 'school.timing/v1',
      availability: { opensOn: '2026-01-01', closesOn: '2026-06-31' },
    });
    expect(errors.join()).toMatch(/closesOn/);
  });

  it('still accepts a real leap day', () => {
    expect(evaluateDatedModule({ opensOn: '2028-02-29', closesOn: '2028-03-01' }, { today: '2028-02-29' }).state)
      .toBe('available');
  });

  it('rejects Feb 29 in a non-leap year', () => {
    expect(() => evaluateDatedModule({ opensOn: '2026-02-29', closesOn: '2026-03-05' }, { today: '2026-03-05' }))
      .toThrow(/opensOn and closesOn/);
  });

  it('REPORTS an out-of-range month instead of throwing', () => {
    // isDay is a boolean predicate: normalizeTiming calls it expecting false and
    // pushes an error string. A naive round-trip check throws RangeError here
    // ('2026-13-01' is an Invalid Date, and toISOString() on that throws), which
    // would crash manifest validation on a plausible typo instead of failing it.
    expect(() => evaluateDatedModule({ opensOn: '2026-13-01', closesOn: '2026-12-05' }, { today: '2026-12-01' }))
      .toThrow(/opensOn and closesOn/);
    const { timing, errors } = normalizeTiming({
      schema: 'school.timing/v1', availability: { opensOn: '2026-13-01' },
    });
    expect(timing).toBeNull();
    expect(errors.join()).toMatch(/opensOn must be YYYY-MM-DD/);
  });
});
