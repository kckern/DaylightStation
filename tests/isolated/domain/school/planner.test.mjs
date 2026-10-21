import { describe, it, expect } from 'vitest';
import { planLearnerWork, PLAN_STATUSES } from "../../../../__app_modules/learning/school/server/domain/planner.mjs";
import { planDailyAgenda } from "../../../../__app_modules/learning/school/server/domain/agenda.mjs";
import { resolveDayCompletion } from "../../../../__app_modules/learning/school/server/domain/completion.mjs";

const NOW = '2026-07-27T09:00:00.000Z';

const unit = (over = {}) => ({
  unitId: 'math-fractions.01',
  title: 'Equivalent Fractions',
  subject: 'math',
  courseId: 'math-fractions',
  sequence: 1,
  objectives: [],
  passing: { percent: 80 },
  ...over,
});

const course = () => [
  unit({ unitId: 'math-fractions.01', title: 'Unit One', sequence: 1 }),
  unit({ unitId: 'math-fractions.02', title: 'Unit Two', sequence: 2 }),
  unit({ unitId: 'math-fractions.03', title: 'Unit Three', sequence: 3 }),
];

const session = (over = {}) => ({
  sessionId: 'ses_a', unitId: 'math-fractions.01', state: 'created',
  terminal: false, outcome: null, updatedAt: '2026-07-27T08:00:00.000Z', ...over,
});

const passed = (unitId, sessionId = `ses_${unitId}`) => session({
  sessionId, unitId, state: 'rewarded', terminal: true,
  outcome: { outcomeId: `out:${sessionId}`, result: 'passed' },
});

const plan = (over = {}) => planLearnerWork({
  learnerId: 'kid1',
  assignment: { courses: ['math-fractions'] },
  units: course(),
  sessions: [],
  now: NOW,
  ...over,
});

const byId = (result, unitId) => result.entries.find((e) => e.unitId === unitId);
/**
 * The planner's ordering contract: an open session outranks an untouched unit,
 * and `available` is already sorted by `byEffectivePriority`.
 *
 * Derived here rather than read off the plan. `planLearnerWork` used to publish
 * this as `plan.next`; nothing consumed it, and a global "one thing to do" that
 * ignores served-today, program status and subject sectioning is wrong for
 * every real surface — so it was deleted rather than left looking canonical.
 * The ORDERING it summarised is still a real contract, which is what these
 * cases assert.
 */
const topOfPlan = (result) => [...result.inProgress, ...result.available][0] ?? null;

describe('shape and totality', () => {
  it('is total over junk input', () => {
    const result = planLearnerWork();
    expect(result.entries).toEqual([]);
    expect(topOfPlan(result)).toBeNull();
    expect(result.learnerId).toBeNull();
  });

  it('stamps the injected now rather than reading a clock', () => {
    expect(plan().generatedAt).toBe(NOW);
  });

  it('reads no clock at all — two calls with the same inputs are identical', () => {
    expect(JSON.stringify(plan())).toBe(JSON.stringify(plan()));
  });

  it('only ever emits statuses from the closed set', () => {
    const result = plan({ sessions: [passed('math-fractions.01'), session({ unitId: 'math-fractions.02', state: 'issued' })] });
    result.entries.forEach((e) => expect(PLAN_STATUSES).toContain(e.status));
  });
});

describe('assignment', () => {
  it('expands an assigned course into its units in sequence order', () => {
    expect(plan().entries.map((e) => e.unitId)).toEqual([
      'math-fractions.01', 'math-fractions.02', 'math-fractions.03',
    ]);
  });

  it('ignores catalog units nobody assigned', () => {
    const result = plan({ units: [...course(), unit({ unitId: 'art.01', courseId: 'art', sequence: 1 })] });
    expect(byId(result, 'art.01')).toBeUndefined();
  });

  it('accepts an individually assigned standalone unit', () => {
    const result = plan({
      assignment: { units: ['read.01'] },
      units: [unit({ unitId: 'read.01', courseId: undefined, sequence: undefined, title: 'Read Aloud' })],
    });
    expect(byId(result, 'read.01').status).toBe('available');
  });

  it('reports an assignment the catalog cannot satisfy instead of dropping it', () => {
    const result = plan({ assignment: { units: ['ghost.01'] }, units: [] });
    expect(result.entries).toEqual([]);
    expect(result.errors).toEqual(['ghost.01: assigned but not in the published catalog']);
  });

  it('reports an assigned course with no published units', () => {
    const result = plan({ assignment: { courses: ['history'] }, units: course() });
    expect(result.errors).toEqual(['history: assigned but no published units belong to it']);
  });

  it('orders electives after required work', () => {
    const result = plan({
      assignment: { courses: ['math-fractions'], units: [{ unitId: 'art.01', elective: true }] },
      units: [...course(), unit({ unitId: 'art.01', courseId: undefined, sequence: undefined })],
    });
    expect(result.entries.map((e) => e.unitId).at(-1)).toBe('art.01');
    expect(byId(result, 'art.01').elective).toBe(true);
  });

  it('does not duplicate a unit assigned both by course and by name', () => {
    const result = plan({ assignment: { courses: ['math-fractions'], units: ['math-fractions.02'] } });
    expect(result.entries.filter((e) => e.unitId === 'math-fractions.02')).toHaveLength(1);
  });
});

describe('gating', () => {
  it('locks every course unit after the first incomplete one', () => {
    const result = plan();
    expect(byId(result, 'math-fractions.01').status).toBe('available');
    expect(byId(result, 'math-fractions.02').status).toBe('locked');
    expect(byId(result, 'math-fractions.03').status).toBe('locked');
  });

  it('unlocks the next unit when its predecessor passes', () => {
    const result = plan({ sessions: [passed('math-fractions.01')] });
    expect(byId(result, 'math-fractions.01').status).toBe('completed');
    expect(byId(result, 'math-fractions.02').status).toBe('available');
    expect(byId(result, 'math-fractions.03').status).toBe('locked');
  });

  it('a graded-but-failed session does not unlock the next unit', () => {
    const result = plan({
      sessions: [session({
        unitId: 'math-fractions.01', state: 'remediation_opened', terminal: true,
        outcome: { outcomeId: 'out:ses_a', result: 'needs_remediation' },
      })],
    });
    expect(byId(result, 'math-fractions.02').status).toBe('locked');
  });

  it('never locks a standalone unit — only sequential courses gate', () => {
    const result = plan({
      assignment: { units: ['read.01', 'read.02'] },
      units: [
        unit({ unitId: 'read.01', courseId: undefined, sequence: undefined }),
        unit({ unitId: 'read.02', courseId: undefined, sequence: undefined }),
      ],
    });
    expect(result.entries.every((e) => e.status === 'available')).toBe(true);
  });

  it('EVERY lock names a remedy pointing at the unit that clears it', () => {
    const result = plan({ sessions: [] });
    const locked = result.locked;
    expect(locked.length).toBeGreaterThan(0);
    locked.forEach((entry) => {
      expect(entry.remedy?.unitId).toBeTruthy();
      expect(entry.remedy.title).toBeTruthy();
      // The printed sentence has to carry the remedy, not merely accompany it.
      expect(entry.lockReason).toEqual(expect.stringContaining(entry.remedy.title));
    });
  });

  it('names the NEAREST blocker, not the first in the course', () => {
    const result = plan({ sessions: [passed('math-fractions.01')] });
    expect(byId(result, 'math-fractions.03').remedy.unitId).toBe('math-fractions.02');
  });

  it('the remedy says resume when the blocker is already started', () => {
    const result = plan({ sessions: [session({ unitId: 'math-fractions.01', state: 'issued' })] });
    expect(byId(result, 'math-fractions.02').remedy).toMatchObject({ unitId: 'math-fractions.01', action: 'resume' });
    // Unit three's nearest blocker is unit two, which nobody has opened yet.
    expect(byId(result, 'math-fractions.03').remedy).toMatchObject({ unitId: 'math-fractions.02', action: 'start' });
  });

  it('a course unit whose predecessor is unassigned still gates on it', () => {
    // Assigning unit 2 alone must not smuggle the child past unit 1: the course
    // sequence is a property of the curriculum, not of what a parent ticked.
    const result = plan({ assignment: { units: ['math-fractions.02'] } });
    expect(byId(result, 'math-fractions.02').status).toBe('locked');
    expect(byId(result, 'math-fractions.02').remedy.unitId).toBe('math-fractions.01');
  });
});

describe('open work', () => {
  it('reports an open session as in_progress and carries its id', () => {
    const result = plan({ sessions: [session({ unitId: 'math-fractions.01', state: 'issued' })] });
    expect(byId(result, 'math-fractions.01')).toMatchObject({ status: 'in_progress', sessionId: 'ses_a', state: 'issued' });
  });

  it('an open session beats a lock — a child may finish what they started', () => {
    const result = plan({ sessions: [session({ unitId: 'math-fractions.02', state: 'issued', sessionId: 'ses_b' })] });
    expect(byId(result, 'math-fractions.02').status).toBe('in_progress');
    expect(byId(result, 'math-fractions.02').lockReason).toBeNull();
  });

  it('prefers the most recently updated of several open sessions', () => {
    const result = plan({
      sessions: [
        session({ sessionId: 'ses_old', state: 'created', updatedAt: '2026-07-26T08:00:00.000Z' }),
        session({ sessionId: 'ses_new', state: 'issued', updatedAt: '2026-07-27T08:30:00.000Z' }),
      ],
    });
    expect(byId(result, 'math-fractions.01').sessionId).toBe('ses_new');
  });

  it('a terminal session is not open work', () => {
    const result = plan({ sessions: [passed('math-fractions.01')] });
    expect(byId(result, 'math-fractions.01').sessionId).toBeNull();
  });
});

describe('next', () => {
  it('picks the open session over an untouched unit', () => {
    const result = plan({
      sessions: [passed('math-fractions.01'), session({ unitId: 'math-fractions.02', state: 'issued', sessionId: 'ses_b' })],
    });
    expect(topOfPlan(result).unitId).toBe('math-fractions.02');
  });

  it('falls back to the first available unit', () => {
    expect(topOfPlan(plan()).unitId).toBe('math-fractions.01');
  });

  it('is null when everything assigned is finished', () => {
    const result = plan({
      sessions: ['math-fractions.01', 'math-fractions.02', 'math-fractions.03'].map((id) => passed(id)),
    });
    expect(topOfPlan(result)).toBeNull();
    expect(result.completed).toHaveLength(3);
  });

  it('is null when everything left is locked', () => {
    // Reachable only through a corrupt catalog (two units claiming sequence 1
    // with neither complete cannot both lock), so it is asserted rather than
    // assumed: a plan with no next move must say so, not invent one.
    const result = plan({ assignment: { units: ['math-fractions.03'] } });
    expect(topOfPlan(result)).toBeNull();
    expect(result.locked).toHaveLength(1);
  });
});

describe('unlocking report', () => {
  it('names the unit a pass would unlock', () => {
    expect(plan().entries[0].unlocks).toBe('math-fractions.02');
  });

  it('reports no unlock for the last unit in a course', () => {
    const result = plan({ sessions: [passed('math-fractions.01'), passed('math-fractions.02')] });
    expect(byId(result, 'math-fractions.03').unlocks).toBeNull();
  });
});

describe('program units', () => {
  it('a program unit flows through: always available, never locked or completed', () => {
    const units = [
      { unitId: 'language-daily', title: 'Language', subject: 'language', program: 'language', cadence: 'daily' },
    ];
    const result = planLearnerWork({
      learnerId: 'learner4',
      assignment: { units: ['language-daily'] },
      units,
      sessions: [],
      now: NOW,
    });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      unitId: 'language-daily', status: 'available', program: 'language', cadence: 'daily',
      sessionId: null, lockReason: null,
    });
  });

  it('carries a non-terminal program session so the child can resume it', () => {
    const units = [
      { unitId: 'language-daily', title: 'Language', subject: 'language', program: 'language', cadence: 'daily' },
    ];
    const result = planLearnerWork({
      learnerId: 'learner4',
      assignment: { units: ['language-daily'] },
      units,
      sessions: [session({ unitId: 'language-daily', state: 'issued', sessionId: 'ses_stray' })],
      now: NOW,
    });
    expect(result.entries[0]).toMatchObject({
      unitId: 'language-daily', status: 'in_progress', program: 'language', cadence: 'daily',
      sessionId: 'ses_stray', state: 'issued', lockReason: null,
    });
  });

  it('a passed session against a program unit does not mark it completed', () => {
    const units = [
      { unitId: 'language-daily', title: 'Language', subject: 'language', program: 'language', cadence: 'daily' },
    ];
    const result = planLearnerWork({
      learnerId: 'learner4',
      assignment: { units: ['language-daily'] },
      units,
      sessions: [passed('language-daily')],
      now: NOW,
    });
    expect(result.entries[0]).toMatchObject({
      unitId: 'language-daily', status: 'available', program: 'language', cadence: 'daily',
      sessionId: null, state: null, lockReason: null,
    });
  });

  it('preserves the program instance needed for instance-scoped status', () => {
    const units = [
      {
        unitId: 'language-daily', title: 'Korean', subject: 'language',
        program: 'language', programInstance: 'test-korean', cadence: 'daily',
      },
    ];
    const result = planLearnerWork({
      learnerId: 'learner4', assignment: { units: ['language-daily'] }, units, sessions: [], now: NOW,
    });
    expect(result.entries[0].programInstance).toBe('test-korean');
  });
});

describe('dated_modules gating', () => {
  const modules = ['w1', 'w2', 'w3'];
  const datedUnits = () => modules.flatMap((module, week) => [1, 2, 3].map((day) => unit({
    unitId: `cfm.${module}.d${day}`, title: `${module} day ${day}`, subject: 'scripture',
    courseId: 'cfm', module, sequence: week * 10 + day,
  })));
  const schedule = {
    w1: { opensOn: '2026-08-24', closesOn: '2026-08-30' },
    w2: { opensOn: '2026-08-31', closesOn: '2026-09-06' },
    w3: { opensOn: '2026-09-07', closesOn: '2026-09-13' },
  };
  const datedAssignment = () => ({ courses: [{ courseId: 'cfm', enrollment: {
    moduleOrder: modules, optionalModules: [], moduleSchedule: schedule,
    lessonOrder: Object.fromEntries(modules.map((module) => [module, [1, 2, 3].map((day) => `cfm.${module}.d${day}`)])),
  } }] });
  const datedPlan = (now, sessions = []) => planLearnerWork({
    learnerId: 'learner3', assignment: datedAssignment(), units: datedUnits(), sessions, now,
    coursePolicies: { cfm: { mode: 'dated_modules', lesson_order: 'sequence' } },
  });

  it('offers the current week even though an earlier week is unfinished', () => {
    expect(topOfPlan(datedPlan('2026-09-01T09:00:00.000Z')).unitId).toBe('cfm.w2.d1');
  });

  it('still chains lessons inside a week and never offers a future week', () => {
    const result = datedPlan('2026-09-01T09:00:00.000Z');
    expect(byId(result, 'cfm.w2.d2').status).toBe('locked');
    expect(byId(result, 'cfm.w3.d1').status).toBe('upcoming');
  });

  it('falls back to catch-up after completing the current week', () => {
    const completed = [1, 2, 3].map((day) => passed(`cfm.w2.d${day}`));
    const result = datedPlan('2026-09-01T09:00:00.000Z', completed);
    expect(topOfPlan(result).unitId).toBe('cfm.w1.d1');
    expect(topOfPlan(result).timingState).toBe('catch_up');
  });

  it('falls back to the newest unfinished closed week', () => {
    const completed = [1, 2, 3].flatMap((day) => passed(`cfm.w3.d${day}`));
    const result = datedPlan('2026-09-08T09:00:00.000Z', completed);
    expect(topOfPlan(result).unitId).toBe('cfm.w2.d1');
    expect(topOfPlan(result).timingState).toBe('catch_up');
  });

  it('keeps a closed in-progress worksheet resumable', () => {
    const result = datedPlan('2026-09-08T09:00:00.000Z', [session({ unitId: 'cfm.w1.d1' })]);
    expect(byId(result, 'cfm.w1.d1').status).toBe('in_progress');
    expect(topOfPlan(result).unitId).toBe('cfm.w1.d1');
    expect(topOfPlan(result).timing.mode).toBe('catch_up');
  });

  it('keeps an in-progress catch-up worksheet optional through agenda and completion', () => {
    const finishedRecentWeeks = ['w2', 'w3'].flatMap((module) => (
      [1, 2, 3].map((day) => passed(`cfm.${module}.d${day}`))
    ));
    const work = datedPlan('2026-09-08T09:00:00.000Z', [
      ...finishedRecentWeeks,
      session({ unitId: 'cfm.w1.d1' }),
    ]);
    const agenda = planDailyAgenda({
      plan: work,
      sessions: [],
      now: '2026-09-08T09:00:00.000Z',
      timezone: 'UTC',
    });
    expect(agenda.sections[0].obligation).toEqual({
      state: 'excused', reason: 'optional_backlog',
    });
    expect(resolveDayCompletion({ sections: agenda.sections }).state).toBe('no_work_today');
  });

  it('does not offer work once every assigned dated module is complete', () => {
    const completed = modules.flatMap((module) => [1, 2, 3].map((day) => passed(`cfm.${module}.d${day}`)));
    expect(datedPlan('2026-09-08T09:00:00.000Z', completed).available).toEqual([]);
  });

  it('does not resurrect modules omitted by a mid-course enrollment', () => {
    const enrollment = {
      moduleOrder: ['w3'], optionalModules: [],
      moduleSchedule: { w3: schedule.w3 },
      lessonOrder: { w3: [1, 2, 3].map((day) => `cfm.w3.d${day}`) },
    };
    const result = planLearnerWork({
      learnerId: 'learner3',
      assignment: { courses: [{ courseId: 'cfm', enrollment }] },
      units: datedUnits(), sessions: [], now: '2026-09-08T09:00:00.000Z',
      coursePolicies: { cfm: { mode: 'dated_modules', lesson_order: 'sequence' } },
    });

    expect(result.entries.map((entry) => entry.unitId)).toEqual([
      'cfm.w3.d1', 'cfm.w3.d2', 'cfm.w3.d3',
    ]);
    expect(result.entries.some((entry) => entry.timingReasons.includes('not_scheduled'))).toBe(false);
  });

  it('never turns old dated backlog dormant', () => {
    const result = datedPlan('2027-01-05T09:00:00.000Z');
    expect(result.entries.every((entry) => entry.status !== 'dormant')).toBe(true);
    expect(result.available.map((entry) => entry.unitId)).toEqual(['cfm.w3.d1', 'cfm.w2.d1', 'cfm.w1.d1']);
  });

  it('does not promise that completing a dated module unlocks a future module', () => {
    const result = datedPlan('2026-09-01T09:00:00.000Z');
    expect(byId(result, 'cfm.w2.d3').unlocks).toBeNull();
  });
});

describe('the enrollment school-day calendar', () => {
  const SCHEDULE = { daysOfWeek: [1, 2, 3, 4, 5], except: [{ from: '2026-12-21', to: '2027-01-01' }] };
  const enrolled = (now) => planLearnerWork({
    learnerId: 'user_4',
    assignment: { courses: [{ courseId: 'math-fractions', enrollment: { schedule: SCHEDULE } }] },
    units: course(), sessions: [], now,
  });

  it('carries the enrollment schedule onto every entry of that course', () => {
    expect(byId(enrolled(NOW), 'math-fractions.01').schedule).toEqual(SCHEDULE);
  });

  it('leaves an unenrolled course entry unscheduled — every day is a school day', () => {
    expect(byId(plan(), 'math-fractions.01').schedule).toBeNull();
  });

  it('reaches the agenda: a Saturday is excused, the Wednesday before is not', () => {
    const saturday = planDailyAgenda({ plan: enrolled('2026-08-29T16:00:00Z'), now: '2026-08-29T16:00:00Z' });
    expect(saturday.sections[0].obligation).toEqual({ state: 'excused', reason: 'not_a_school_day' });
    expect(resolveDayCompletion({ sections: saturday.sections }).state).toBe('no_work_today');

    const wednesday = planDailyAgenda({ plan: enrolled('2026-08-26T16:00:00Z'), now: '2026-08-26T16:00:00Z' });
    expect(wednesday.sections[0].obligation).toEqual({ state: 'obligated', reason: null });
  });

  it('reaches the agenda: a vacation weekday is excused too', () => {
    const { sections } = planDailyAgenda({
      plan: enrolled('2026-12-23T16:00:00Z'), now: '2026-12-23T16:00:00Z',
    });
    expect(sections[0].obligation).toEqual({ state: 'excused', reason: 'not_a_school_day' });
  });
});

describe('remediation holds: two rounds, or three idle school days, then a grown-up', () => {
  // A chain of failed sheets on one unit: the original and `rounds` retries,
  // the newest still open at `outcome_recorded`. Every failure is dated the
  // same Monday so only depth separates them; the idle rule has its own block.
  const failed = (sessionId, remediationOf, { open = false, at = '2026-09-28T16:00:00.000Z' } = {}) => session({
    sessionId, remediationOf: remediationOf ?? null,
    state: open ? 'outcome_recorded' : 'remediation_opened', terminal: !open,
    outcome: { result: 'needs_remediation', at }, gradedPercent: 16.67, updatedAt: at,
  });
  const chain = (rounds) => {
    const rows = [failed('ses_0', null, { open: rounds === 0 })];
    for (let r = 1; r <= rounds; r += 1) rows.push(failed(`ses_${r}`, `ses_${r - 1}`, { open: r === rounds }));
    return rows;
  };
  const MONDAY_NOON = '2026-09-28T19:00:00.000Z';
  const planAt = (over) => plan({ now: MONDAY_NOON, timezone: 'America/Los_Angeles', ...over });

  it.each([[0, null], [1, null], [2, 'cap']])('depth %i → hold reason %s', (rounds, reason) => {
    const entry = byId(planAt({ sessions: chain(rounds), remediationMaxRounds: 2 }), 'math-fractions.01');
    expect(entry.status).toBe('in_progress');
    expect(entry.remediation).toEqual({ depth: rounds, maxRounds: 2, idleStudyDays: 0, held: reason != null, reason });
  });

  it('defaults the cap to two when none is configured', () => {
    expect(byId(planAt({ sessions: chain(2) }), 'math-fractions.01').remediation.reason).toBe('cap');
  });

  it('carries no remediation block for work that is not a settled failure', () => {
    expect(byId(planAt({ sessions: [session({ state: 'issued' })] }), 'math-fractions.01').remediation).toBeNull();
  });

  it('a retry whose parent row is missing still counts the link it holds', () => {
    const rows = chain(2).filter((row) => row.sessionId !== 'ses_0');
    expect(byId(planAt({ sessions: rows }), 'math-fractions.01').remediation.depth).toBe(2);
  });

  it('a lineage that loops back on itself ends the walk instead of hanging', () => {
    const rows = [failed('ses_a', 'ses_b'), failed('ses_b', 'ses_c'), failed('ses_c', 'ses_a', { open: true })];
    expect(byId(planAt({ sessions: rows, remediationMaxRounds: 9 }), 'math-fractions.01').remediation.depth).toBe(3);
  });

  it('a unit passed on another session is never held, whatever an old failure says', () => {
    const rows = [...chain(2), passed('math-fractions.01', 'ses_pass')];
    const entry = byId(planAt({ sessions: rows }), 'math-fractions.01');
    expect(entry.status).toBe('completed');
    expect(entry.remediation.held).toBe(false);
  });

  it('judges only the newest open session on a unit', () => {
    const rows = [
      failed('ses_old', 'ses_x', { open: true, at: '2026-09-01T16:00:00.000Z' }),
      failed('ses_x', 'ses_y'),
      failed('ses_new', null, { open: true }),
    ];
    const entry = byId(planAt({ sessions: rows }), 'math-fractions.01');
    expect(entry.sessionId).toBe('ses_new');
    expect(entry.remediation).toMatchObject({ depth: 0, held: false });
  });

  it('the held unit excuses its section and the day completes on the rest', () => {
    const result = planAt({
      assignment: { courses: ['math-fractions'], units: ['lang.01'] },
      units: [...course(), unit({ unitId: 'lang.01', subject: 'language', courseId: undefined, sequence: undefined })],
      sessions: [...chain(2), passed('lang.01', 'ses_lang')].map((row) => (row.sessionId === 'ses_lang'
        ? { ...row, outcome: { ...row.outcome, at: MONDAY_NOON }, updatedAt: MONDAY_NOON } : row)),
    });
    const { sections } = planDailyAgenda({
      plan: result, sessions: [...chain(2), { ...passed('lang.01', 'ses_lang'), outcome: { result: 'passed', at: MONDAY_NOON }, updatedAt: MONDAY_NOON }],
      now: MONDAY_NOON, timezone: 'America/Los_Angeles',
    });
    expect(sections.find((s) => s.subject === 'math').obligation).toEqual({ state: 'excused', reason: 'teacher_hold' });
    expect(resolveDayCompletion({ sections }).state).toBe('complete');
  });

  describe('stale: an unretried failure', () => {
    // The 2026-09-26 incident's shape: a failure at depth 0 (that day was a
    // Saturday) which the child never retried, while the agenda offered the
    // retry 9/29–10/02. Weekdays-only enrollment, Pacific household.
    const FAILED_AT = '2026-09-26T16:00:00.000Z';
    const weekdays = { courses: [{ courseId: 'math-fractions', enrollment: { schedule: { daysOfWeek: [1, 2, 3, 4, 5] } } }] };
    const at = (iso, over = {}) => byId(plan({
      assignment: weekdays, sessions: [failed('ses_0', null, { open: true, at: FAILED_AT })],
      now: iso, timezone: 'America/Los_Angeles', ...over,
    }), 'math-fractions.01').remediation;

    it('the weekend does not count, nor does today', () => {
      expect(at('2026-09-29T19:00:00.000Z')).toMatchObject({ idleStudyDays: 1, held: false }); // Tue: Mon passed
      expect(at('2026-10-01T19:00:00.000Z')).toMatchObject({ idleStudyDays: 3, held: true, reason: 'stale' }); // Thu
    });

    it('honours a configured window', () => {
      expect(at('2026-10-01T19:00:00.000Z', { remediationHoldAfterStudyDays: 4 })).toMatchObject({ held: false });
    });

    it('a household day off is not a school day either', () => {
      const householdSchedule = { except: [{ from: '2026-09-29', to: '2026-09-29', label: 'Field day' }] };
      expect(at('2026-10-01T19:00:00.000Z', { householdSchedule })).toMatchObject({ idleStudyDays: 2, held: false });
    });

    it('reads both ends on the 4am study-day boundary', () => {
      // 02:30 Pacific on Tue 9/29 is still Monday's study day; 03:30 on Fri
      // 10/2 is still Thursday's. Calendar dates would say 1 and 3.
      const failedLate = [failed('ses_0', null, { open: true, at: '2026-09-29T09:30:00.000Z' })];
      expect(at('2026-10-01T19:00:00.000Z', { sessions: failedLate })).toMatchObject({ idleStudyDays: 2, held: false });
      const failedMonday = [failed('ses_0', null, { open: true, at: '2026-09-28T19:00:00.000Z' })];
      expect(at('2026-10-02T10:30:00.000Z', { sessions: failedMonday })).toMatchObject({ idleStudyDays: 2, held: false });
    });

    it('a pass rewritten to needs_remediation for a practice gate is never a hold', () => {
      // PlanProjection rewrites a passed session whose linked card practice is
      // unfinished; still at `outcome_recorded` (coins awaiting sign-off), it
      // must not read as a failure nobody retried.
      const rewritten = [{ ...failed('ses_0', null, { open: true, at: FAILED_AT }), gradedPercent: 100, practiceRewrittenPass: true }];
      expect(at('2026-10-02T19:00:00.000Z', { sessions: rewritten })).toBeNull();
    });

    it('cap wins when both apply', () => {
      const rows = [failed('ses_a', null, { at: FAILED_AT }), failed('ses_b', 'ses_a', { at: FAILED_AT }),
        failed('ses_c', 'ses_b', { open: true, at: FAILED_AT })];
      expect(at('2026-10-02T19:00:00.000Z', { sessions: rows }).reason).toBe('cap');
    });
  });
});
