import { describe, it, expect } from 'vitest';
import { joinLearnerDay } from './learnerDay.js';

// Shapes mirror the real read models — a section's plan lives at
// `next.title`/`next.unitId`; a session summary carries its own unitId.
const section = (subject, extra = {}) => ({ subject, next: { title: `${subject} lesson`, unitId: `${subject}.01` }, ...extra });
const session = (subject, sessionId, extra = {}) => ({ subject, sessionId, unitId: `${subject}.01`, lessonTitle: `${subject} done`, ...extra });

describe('joinLearnerDay', () => {
  it('marks a planned subject with a recorded session as done', () => {
    const { rows } = joinLearnerDay({ sections: [section('math')], sessions: [session('math', 'ses_1')] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ subject: 'math', status: 'done', planned: 'math lesson' });
    expect(rows[0].session.sessionId).toBe('ses_1');
  });

  it('matches the session to the planned UNIT, not merely the subject', () => {
    // Both sessions are "math"; only one is the unit the planner offered.
    const { rows } = joinLearnerDay({
      sections: [section('math')],
      sessions: [session('math', 'ses_other', { unitId: 'math.99' }), session('math', 'ses_planned')],
    });
    const planned = rows.find((row) => row.planned);
    expect(planned.session.sessionId).toBe('ses_planned');
    expect(planned.matchedOn).toBe('unit');
  });

  it('falls back to a subject match when the session carries no unit', () => {
    const { rows } = joinLearnerDay({
      sections: [section('math')],
      sessions: [session('math', 'ses_1', { unitId: undefined })],
    });
    expect(rows[0]).toMatchObject({ status: 'done', matchedOn: 'subject' });
  });

  it('marks a planned subject with no session as planned', () => {
    const { rows } = joinLearnerDay({ sections: [section('math')], sessions: [] });
    expect(rows[0]).toMatchObject({ subject: 'math', status: 'planned', session: null });
  });

  it('explains a deferred subject with the subject it yielded to', () => {
    const { rows } = joinLearnerDay({ sections: [section('art', { suppressed: { bySubject: 'math' } })], sessions: [] });
    expect(rows[0]).toMatchObject({ status: 'deferred', detail: 'Deferred for math focus' });
  });

  it('marks a locked subject as blocked and carries the remedy', () => {
    const { rows } = joinLearnerDay({ sections: [section('math', { lockedRemedy: 'Finish Unit 2 first' })], sessions: [] });
    expect(rows[0]).toMatchObject({ status: 'blocked', detail: 'Finish Unit 2 first' });
  });

  it('trusts servedToday when the planner says the day is complete but no session is linked', () => {
    const { rows } = joinLearnerDay({ sections: [section('math', { servedToday: true })], sessions: [] });
    expect(rows[0]).toMatchObject({ status: 'done', session: null });
    expect(rows[0].detail).toMatch(/no session record/i);
  });

  it('lists a session whose subject was never planned as extra', () => {
    const { rows } = joinLearnerDay({ sections: [], sessions: [session('piano', 'ses_9')] });
    expect(rows[0]).toMatchObject({ subject: 'piano', status: 'extra' });
    expect(rows[0].detail).toMatch(/not on/i);
  });

  it('emits one row per session when a subject has two', () => {
    const { rows } = joinLearnerDay({
      sections: [section('scripture')],
      sessions: [session('scripture', 'ses_1'), session('scripture', 'ses_2')],
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === 'done')).toBe(true);
    // The planned title is stated once, not repeated per session (IA1).
    expect(rows.map((row) => row.planned)).toEqual(['scripture lesson', null]);
  });

  it('counts every status and the total', () => {
    const { counts } = joinLearnerDay({
      sections: [section('math'), section('art', { suppressed: { bySubject: 'math' } }), section('reading')],
      sessions: [session('math', 'ses_1'), session('piano', 'ses_2')],
    });
    expect(counts).toMatchObject({ done: 1, planned: 1, deferred: 1, extra: 1, total: 4 });
  });

  it('survives empty input', () => {
    expect(joinLearnerDay({})).toMatchObject({ rows: [], counts: { total: 0 } });
  });

  it('keeps a subjectless session rather than dropping it', () => {
    const { rows } = joinLearnerDay({ sections: [], sessions: [{ sessionId: 'ses_x' }] });
    expect(rows).toHaveLength(1);
    expect(rows[0].subject).toBeNull();
  });
});
