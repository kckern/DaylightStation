import { describe, it, expect } from 'vitest';
import { planLearnerWork, PLAN_STATUSES } from '#domains/school/planner.mjs';

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

describe('shape and totality', () => {
  it('is total over junk input', () => {
    const result = planLearnerWork();
    expect(result.entries).toEqual([]);
    expect(result.next).toBeNull();
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
    expect(result.next.unitId).toBe('math-fractions.02');
  });

  it('falls back to the first available unit', () => {
    expect(plan().next.unitId).toBe('math-fractions.01');
  });

  it('is null when everything assigned is finished', () => {
    const result = plan({
      sessions: ['math-fractions.01', 'math-fractions.02', 'math-fractions.03'].map((id) => passed(id)),
    });
    expect(result.next).toBeNull();
    expect(result.completed).toHaveLength(3);
  });

  it('is null when everything left is locked', () => {
    // Reachable only through a corrupt catalog (two units claiming sequence 1
    // with neither complete cannot both lock), so it is asserted rather than
    // assumed: a plan with no next move must say so, not invent one.
    const result = plan({ assignment: { units: ['math-fractions.03'] } });
    expect(result.next).toBeNull();
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
      learnerId: 'felix',
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
});
