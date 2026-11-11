import { describe, it, expect } from 'vitest';
import { planLearnerWork } from "../../../../__app_modules/learning/school/server/domain/planner.mjs";

const unit = (over = {}) => ({
  unitId: 'x', title: 'X', subject: 'civilization', courseId: 'civ', sequence: 1,
  objectives: [], passing: { percent: 80 }, ...over,
});
const passed = (unitId) => ({
  sessionId: `ses_${unitId}`, unitId, state: 'rewarded', terminal: true,
  outcome: { outcomeId: `out:${unitId}`, result: 'passed' }, updatedAt: '2026-11-01T08:00:00.000Z',
});
const byId = (result, unitId) => result.entries.find((e) => e.unitId === unitId);

describe('date-bound units', () => {
  const units = () => [
    unit({ unitId: 'u1', title: 'One', sequence: 1 }),
    unit({ unitId: 'hol', title: 'Holiday', sequence: 2, onDays: [{ from: '2026-11-11', to: '2026-11-11' }] }),
    unit({ unitId: 'u2', title: 'Two', sequence: 3 }),
  ];
  const at = (day, sessions = [], over = {}) => planLearnerWork({
    learnerId: 'kid1', assignment: { courses: ['civ'] }, units: units(), sessions, now: `${day}T17:00:00.000Z`, ...over,
  });

  it('is absent before its day, and never locks the next lesson', () => {
    const result = at('2026-11-10', [passed('u1')]);
    expect(byId(result, 'hol')).toBeUndefined();
    expect(byId(result, 'u2').status).toBe('available');
  });

  it('is available on its day even though earlier lessons are not passed', () => {
    const entry = byId(at('2026-11-11'), 'hol');
    expect(entry).toMatchObject({ status: 'available', dateBound: { onDays: [{ from: '2026-11-11', to: '2026-11-11' }] } });
    expect(entry.lockReason).toBeNull();
  });

  it('is absent after its day when never done — not dormant, not catch-up', () => {
    expect(byId(at('2026-11-12'), 'hol')).toBeUndefined();
  });

  it('reads completed on its day once passed', () => {
    expect(byId(at('2026-11-11', [passed('hol')]), 'hol').status).toBe('completed');
  });

  it('is never named as what a pass unlocks', () => {
    expect(byId(at('2026-11-11'), 'u1').unlocks).toBe('u2');
  });

  it('a standalone assigned date-bound unit follows the same rules, and carries placeholder', () => {
    const stub = {
      unitId: 'holiday-x', title: 'Holiday (to be written)', subject: 'scripture', objectives: [],
      onDays: [{ from: '2026-11-26', to: '2026-11-26' }], placeholder: true,
    };
    const run = (day) => planLearnerWork({
      learnerId: 'kid1', assignment: { units: ['holiday-x'] }, units: [stub], now: `${day}T17:00:00.000Z`,
    });
    expect(byId(run('2026-11-25'), 'holiday-x')).toBeUndefined();
    expect(byId(run('2026-11-26'), 'holiday-x')).toMatchObject({ status: 'available', placeholder: true });
    expect(byId(run('2026-11-27'), 'holiday-x')).toBeUndefined();
  });

  it('joins a course with frozen membership without being listed in it', () => {
    const enrollment = { lessonOrder: { m: ['u1', 'u2'] } };
    const result = at('2026-11-11', [], { assignment: { courses: [{ courseId: 'civ', enrollment }] } });
    expect(byId(result, 'hol')?.status).toBe('available');
  });

  it('an ordinary entry carries neither field', () => {
    const entry = byId(at('2026-11-11'), 'u1');
    expect(entry.dateBound).toBeUndefined();
    expect(entry.placeholder).toBeUndefined();
  });
});
