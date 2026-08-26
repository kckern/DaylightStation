import { describe, it, expect, vi } from 'vitest';
import { planDailyAgenda } from '#domains/school/agenda.mjs';
import { resolveDayCompletion } from '#domains/school/completion.mjs';

const NOW = '2026-07-29T16:00:00Z'; // 09:00 PDT
const TZ = 'America/Los_Angeles';
const entry = (over) => ({
  unitId: 'u1', title: 'Unit One', subject: 'math', courseId: 'c', sequence: 1,
  elective: false, status: 'available', sessionId: null, state: null,
  lockReason: null, remedy: null, unlocks: null, program: null, cadence: null,
  timing: null, timingState: 'available', timingPriority: 3, timingReasons: ['default_priority'],
  ...over,
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

  it('a launcher error blanks only the erroring program entry, not a live curriculum sibling in the same subject', () => {
    const { sections } = planDailyAgenda(args({
      plan: plan([
        entry({ unitId: 'language-daily', subject: 'language', courseId: null, sequence: null, program: 'language', cadence: 'daily' }),
        entry({ unitId: 'lang-writing', subject: 'language', courseId: null, sequence: null }),
      ]),
      programStatuses: { language: { error: true } },
    }));
    const lang = sections.find((s) => s.subject === 'language');
    expect(lang.programUnavailable).toBe(true);
    expect(lang.next.unitId).toBe('lang-writing');
  });

  it('scopes launcher status and failure to one program instance', () => {
    const { sections } = planDailyAgenda(args({
      plan: plan([
        entry({ unitId: 'korean', subject: 'language', program: 'language', programInstance: 'korean' }),
        entry({ unitId: 'spanish', subject: 'language', program: 'language', programInstance: 'spanish', sequence: 2 }),
      ]),
      programStatuses: {
        'language::korean': { error: true },
        'language::spanish': { doneToday: false, progressLabel: 'Day 4', score: null },
      },
    }));
    expect(sections[0]).toMatchObject({ programUnavailable: true, progressLabel: 'Day 4' });
    expect(sections[0].next.unitId).toBe('spanish');
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

describe('obligation', () => {
  it('rule 1: a non-elective pass today serves, ignoring the focus multi-block term', () => {
    const { sections } = planDailyAgenda(args({
      plan: plan([entry({ unitId: 'u1', subject: 'math', status: 'completed' })]),
      sessions: [{ sessionId: 's1', unitId: 'u1', state: 'closed', terminal: true,
        outcome: { result: 'passed', at: '2026-07-29T15:00:00Z' }, gradedPercent: 90, updatedAt: '2026-07-29T15:00:00Z' }],
    }));
    expect(sections[0].obligation).toEqual({ state: 'served', reason: null });
  });

  it('rule 1: an elective pass today does NOT serve a subject whose required entry is untouched', () => {
    const { sections } = planDailyAgenda(args({
      plan: plan([
        entry({ unitId: 'required', subject: 'math', sequence: 1 }),
        entry({ unitId: 'elective', subject: 'math', sequence: 2, courseId: null, elective: true, status: 'completed' }),
      ]),
      sessions: [{ sessionId: 's1', unitId: 'elective', state: 'closed', terminal: true,
        outcome: { result: 'passed', at: '2026-07-29T15:00:00Z' }, gradedPercent: 100, updatedAt: '2026-07-29T15:00:00Z' }],
    }));
    expect(sections[0].obligation).toEqual({ state: 'obligated', reason: null });
  });

  it('rule 1: an elective program done today does NOT serve required work', () => {
    const { sections } = planDailyAgenda(args({
      plan: plan([
        entry({ unitId: 'required', subject: 'language' }),
        entry({
          unitId: 'elective-language', subject: 'language', sequence: 2,
          courseId: null, elective: true, program: 'language', programInstance: 'korean',
        }),
      ]),
      programStatuses: {
        'language::korean': { doneToday: true, progressLabel: 'Day 4', score: null },
      },
    }));
    expect(sections[0].obligation).toEqual({ state: 'obligated', reason: null });
  });

  it('rule 2: a section suppressed by a focus day excuses as suppressed_by_focus, not obligated', () => {
    const urgentTiming = {
      schema: 'school.timing/v1', availability: {}, target: { dueOn: '2026-07-31', strength: 'firm' },
      basePriority: 'high', flexibility: 'protected', agenda: { normalBlocks: 1, urgentBlocks: 3 }, urgencyLeadDays: 7,
    };
    const flexibleTiming = {
      schema: 'school.timing/v1', availability: {}, basePriority: 'low', flexibility: 'flexible',
      agenda: { normalBlocks: 1, urgentBlocks: 1 }, urgencyLeadDays: 7,
    };
    const { sections } = planDailyAgenda(args({
      plan: plan([
        entry({ unitId: 'focus1', subject: 'math', timing: urgentTiming, timingState: 'urgent', timingPriority: 1, timingReasons: ['due_on_2026-07-31'] }),
        entry({ unitId: 'flex1', subject: 'science', timing: flexibleTiming, timingState: 'available', timingPriority: 4 }),
      ]),
    }));
    const science = sections.find((s) => s.subject === 'science');
    expect(science.suppressed).not.toBeNull();
    expect(science.obligation).toEqual({ state: 'excused', reason: 'suppressed_by_focus' });
    const math = sections.find((s) => s.subject === 'math');
    expect(math.obligation).toEqual({ state: 'obligated', reason: null });
  });

  it('rule 3: elective_only when a subject holds only elective work', () => {
    const { sections } = planDailyAgenda(args({
      plan: plan([entry({ unitId: 'e1', subject: 'art', courseId: null, elective: true })]),
    }));
    expect(sections[0].obligation).toEqual({ state: 'excused', reason: 'elective_only' });
  });

  it('rule 3: awaiting_grown_up when the only non-elective entry is dormant', () => {
    const { sections } = planDailyAgenda(args({
      plan: plan([entry({ unitId: 'd1', subject: 'math', status: 'dormant' })]),
    }));
    expect(sections[0].obligation).toEqual({ state: 'excused', reason: 'awaiting_grown_up' });
  });

  it('rule 3: opens_later when the only non-elective entry is upcoming', () => {
    const { sections } = planDailyAgenda(args({
      plan: plan([entry({ unitId: 'u1', subject: 'math', status: 'upcoming' })]),
    }));
    expect(sections[0].obligation).toEqual({ state: 'excused', reason: 'opens_later' });
  });

  it('rule 3: caught_up when the only non-elective entry is already completed and nothing new is offered', () => {
    const { sections } = planDailyAgenda(args({
      plan: plan([entry({ unitId: 'done1', subject: 'math', status: 'completed' })]),
    }));
    expect(sections[0].obligation).toEqual({ state: 'excused', reason: 'caught_up' });
  });

  it('rule 4: optional_backlog when every actionable non-elective entry is catch-up backlog', () => {
    const { sections } = planDailyAgenda(args({
      plan: plan([entry({ unitId: 'w1', subject: 'scripture', timingState: 'catch_up' })]),
    }));
    expect(sections[0].obligation).toEqual({ state: 'excused', reason: 'optional_backlog' });
  });

  it('rule 5: not_due_yet when an available entry carries a future target and is not yet urgent', () => {
    const quietTiming = {
      schema: 'school.timing/v1', availability: { opensOn: '2026-07-27' }, target: { dueOn: '2026-08-07', strength: 'firm' },
      basePriority: 'medium', flexibility: 'protected', agenda: { normalBlocks: 1, urgentBlocks: 1 }, urgencyLeadDays: 1,
    };
    const { sections } = planDailyAgenda(args({
      plan: plan([entry({ unitId: 'w1', subject: 'writing', timing: quietTiming, timingState: 'available', timingPriority: 3 })]),
    }));
    expect(sections[0].obligation).toEqual({ state: 'excused', reason: 'not_due_yet' });
  });

  it('rule 6: obligated once an urgent entry (inside its lead window) is the only actionable work', () => {
    const urgentTiming = {
      schema: 'school.timing/v1', availability: { opensOn: '2026-07-27' }, target: { dueOn: '2026-07-31', strength: 'firm' },
      basePriority: 'medium', flexibility: 'protected', agenda: { normalBlocks: 1, urgentBlocks: 1 }, urgencyLeadDays: 7,
    };
    const { sections } = planDailyAgenda(args({
      plan: plan([entry({ unitId: 'w1', subject: 'writing', timing: urgentTiming, timingState: 'urgent', timingPriority: 1 })]),
    }));
    expect(sections[0].obligation).toEqual({ state: 'obligated', reason: null });
  });
});

describe('the school-day calendar', () => {
  // 09:00 PDT on each; the study day is the calendar key those resolve to.
  const SATURDAY = '2026-08-29T16:00:00Z';
  const WEDNESDAY = '2026-08-26T16:00:00Z';
  const WEEKDAYS = { daysOfWeek: [1, 2, 3, 4, 5] };
  const on = (now, over = {}) => planDailyAgenda(args({ now, ...over }));

  it('excuses an obligated section on a non-school day', () => {
    const { sections } = on(SATURDAY, {
      plan: plan([entry({ unitId: 'u1', subject: 'math', schedule: WEEKDAYS })]),
    });
    expect(sections[0].obligation).toEqual({ state: 'excused', reason: 'not_a_school_day' });
  });

  it('still obligates on a school day', () => {
    const { sections } = on(WEDNESDAY, {
      plan: plan([entry({ unitId: 'u1', subject: 'math', schedule: WEEKDAYS })]),
    });
    expect(sections[0].obligation).toEqual({ state: 'obligated', reason: null });
  });

  it('honours a makeup day over the weekend rule', () => {
    const { sections } = on(SATURDAY, {
      plan: plan([entry({ unitId: 'u1', subject: 'math', schedule: { ...WEEKDAYS, also: ['2026-08-29'] } })]),
    });
    expect(sections[0].obligation).toEqual({ state: 'obligated', reason: null });
  });

  it('a whole day of non-school sections rolls up to no_work_today, not incomplete', () => {
    const { sections } = on(SATURDAY, {
      plan: plan([
        entry({ unitId: 'u1', subject: 'math', schedule: WEEKDAYS }),
        entry({ unitId: 'u2', subject: 'language', courseId: 'c2', schedule: WEEKDAYS }),
      ]),
    });
    expect(resolveDayCompletion({ sections }).state).toBe('no_work_today');
  });

  it('a non-school day never HIDES completed work — a child who read anyway still shows served', () => {
    const { sections } = on(SATURDAY, {
      plan: plan([entry({ unitId: 'u1', subject: 'math', status: 'completed', schedule: WEEKDAYS })]),
      sessions: [{ sessionId: 's1', unitId: 'u1', state: 'closed', terminal: true,
        outcome: { result: 'passed', at: '2026-08-29T15:00:00Z' }, gradedPercent: 90, updatedAt: '2026-08-29T15:00:00Z' }],
    });
    expect(sections[0].obligation).toEqual({ state: 'served', reason: null });
    expect(resolveDayCompletion({ sections }).state).toBe('complete');
  });

  it('an unscheduled sibling keeps the section obligated — one course off does not excuse another', () => {
    const { sections } = on(SATURDAY, {
      plan: plan([
        entry({ unitId: 'u1', subject: 'math', schedule: WEEKDAYS }),
        entry({ unitId: 'u2', subject: 'math', courseId: 'c2', sequence: 2 }),
      ]),
    });
    expect(sections[0].obligation).toEqual({ state: 'obligated', reason: null });
  });

  it('a focus day does not spend a block on a section that was not in session at all', () => {
    const urgentTiming = {
      schema: 'school.timing/v1', availability: {}, target: { dueOn: '2026-08-31', strength: 'firm' },
      basePriority: 'high', flexibility: 'protected', agenda: { normalBlocks: 1, urgentBlocks: 2 }, urgencyLeadDays: 7,
    };
    const flexibleTiming = {
      schema: 'school.timing/v1', availability: {}, basePriority: 'low', flexibility: 'flexible',
      agenda: { normalBlocks: 1, urgentBlocks: 1 }, urgencyLeadDays: 7,
    };
    const { sections } = on(SATURDAY, {
      plan: plan([
        entry({ unitId: 'focus1', subject: 'math', timing: urgentTiming, timingState: 'urgent', timingPriority: 1 }),
        // Lowest priority, so it is the FIRST thing a focus block would reach
        // for — and it is a course that is not in session today.
        entry({ unitId: 'off1', subject: 'science', courseId: 'c-sci', timing: flexibleTiming, timingPriority: 5, schedule: WEEKDAYS }),
        entry({ unitId: 'flex1', subject: 'arts', courseId: 'c-art', timing: flexibleTiming, timingPriority: 4 }),
      ]),
    });
    const science = sections.find((s) => s.subject === 'science');
    expect(science.obligation).toEqual({ state: 'excused', reason: 'not_a_school_day' });
    expect(science.suppressed).toBeNull();
    // The single extra block lands on the subject that WAS in session.
    const arts = sections.find((s) => s.subject === 'arts');
    expect(arts.obligation).toEqual({ state: 'excused', reason: 'suppressed_by_focus' });
  });

  it('an elective-only subject still reads elective_only, not not_a_school_day', () => {
    const { sections } = on(SATURDAY, {
      plan: plan([entry({ unitId: 'u1', subject: 'math', elective: true, schedule: WEEKDAYS })]),
    });
    expect(sections[0].obligation).toEqual({ state: 'excused', reason: 'elective_only' });
  });

  it('warns with the validator errors when a schedule is malformed — a typo must be findable', () => {
    const logger = { warn: vi.fn() };
    on(SATURDAY, {
      logger,
      plan: { learnerId: 'learner-a', entries: [entry({ unitId: 'u1', subject: 'math', courseId: 'c1', schedule: { except: ['Christmas'] } })], errors: [] },
    });
    expect(logger.warn).toHaveBeenCalledWith('school.agenda.invalid-schedule', {
      learnerId: 'learner-a',
      subject: 'math',
      unitId: 'u1',
      courseId: 'c1',
      errors: ['except has an invalid date: Christmas'],
    });
  });

  it('warns once per unit per build', () => {
    const logger = { warn: vi.fn() };
    const broken = { schedule: { daysofweek: [1, 2, 3, 4, 5] } };
    on(SATURDAY, {
      logger,
      plan: plan([
        entry({ unitId: 'u1', subject: 'math', ...broken }),
        entry({ unitId: 'u1', subject: 'math', ...broken }),
      ]),
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('warns about an ELECTIVE entry too — an inert schedule is still a typo', () => {
    const logger = { warn: vi.fn() };
    on(SATURDAY, {
      logger,
      plan: plan([entry({ unitId: 'u1', subject: 'math', elective: true, schedule: { holidays: [] } })]),
    });
    expect(logger.warn).toHaveBeenCalledWith('school.agenda.invalid-schedule', expect.objectContaining({ unitId: 'u1' }));
  });

  it('still reports a broken curriculum on a non-school day — an excuse is not a silence', () => {
    const logger = { warn: vi.fn() };
    const { sections } = on(SATURDAY, {
      logger,
      plan: plan([entry({
        unitId: 'u2', subject: 'math', status: 'locked',
        lockReason: 'Finish “ghost” first',
        remedy: { unitId: 'ghost', title: 'ghost', action: 'start' },
        schedule: WEEKDAYS,
      })]),
    });
    // The verdict is right — a Saturday must not fault — but the diagnostic
    // that detects a broken unlock chain has to keep firing.
    expect(sections[0].obligation).toEqual({ state: 'excused', reason: 'not_a_school_day' });
    expect(logger.warn).toHaveBeenCalledWith('school.agenda.blocked-unreachable', expect.objectContaining({
      subject: 'math', unitIds: ['u2'],
    }));
  });

  it('a malformed schedule leaves the obligation intact — it never excuses a term', () => {
    const { sections } = on(SATURDAY, {
      plan: plan([entry({ unitId: 'u1', subject: 'math', schedule: { daysOfWeek: 'weekdays' } })]),
    });
    expect(sections[0].obligation).toEqual({ state: 'obligated', reason: null });
  });
});
