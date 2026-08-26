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

  it('claims the carried-over session that made a section servedToday', () => {
    // The seam this closes: `servedToday` is computed from work GRADED today,
    // but the day's `sessions` lane is filtered by studyDay. A sheet issued on
    // an earlier day and scanned today therefore sets servedToday while living
    // in the carried-over lane — and the join used to answer "Completed — no
    // session record" about a session it was holding all along.
    const carried = session('civilization', 'ses_carry', { studyDay: '2026-08-23' });
    const { rows } = joinLearnerDay({
      sections: [section('civilization', { servedToday: true, next: null })],
      sessions: [],
      carriedOver: [carried],
      studyDay: '2026-08-25',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'done', carriedOver: true });
    expect(rows[0].session.sessionId).toBe('ses_carry');
    expect(rows[0].detail).toBeNull();
  });

  it('leaves an unclaimed carried-over session out of the rows entirely', () => {
    // It belongs to the "Also marked on this date" block, which owns it. It is
    // not "extra" — that word means unplanned work done on THIS study day.
    const { rows } = joinLearnerDay({
      sections: [section('math')],
      sessions: [],
      carriedOver: [session('civilization', 'ses_carry', { studyDay: '2026-08-23' })],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ subject: 'math', status: 'planned' });
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

  it('matches an "other"-bucketed section to its session by unit, not subject', () => {
    // The planner buckets non-canonical subjects into 'other'; the day
    // projection keeps the raw subject. One activity must yield ONE row.
    const { rows, counts } = joinLearnerDay({
      sections: [{ subject: 'other', next: { title: 'Piano Lesson 3', unitId: 'piano.03' } }],
      sessions: [{ subject: 'piano', sessionId: 'ses_p', unitId: 'piano.03', lessonTitle: 'Piano Lesson 3' }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'done', matchedOn: 'unit' });
    expect(rows[0].session.sessionId).toBe('ses_p');
    expect(counts.total).toBe(1);
    expect(counts.extra).toBeUndefined();
  });

  it('lets two sections sharing a subject each claim their own unit', () => {
    const { rows } = joinLearnerDay({
      sections: [
        { subject: 'math', next: { title: 'A', unitId: 'math.01' } },
        { subject: 'math', next: { title: 'B', unitId: 'math.02' } },
      ],
      sessions: [
        { subject: 'math', sessionId: 'ses_2', unitId: 'math.02' },
        { subject: 'math', sessionId: 'ses_1', unitId: 'math.01' },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ planned: 'A' });
    expect(rows[0].session.sessionId).toBe('ses_1');
    expect(rows[1]).toMatchObject({ planned: 'B' });
    expect(rows[1].session.sessionId).toBe('ses_2');
  });

  it('never lets two sections claim the same session', () => {
    const { rows } = joinLearnerDay({
      sections: [
        { subject: 'math', next: { title: 'A', unitId: 'math.01' } },
        { subject: 'math', next: { title: 'B', unitId: 'math.01' } },
      ],
      sessions: [{ subject: 'math', sessionId: 'ses_1', unitId: 'math.01' }],
    });
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.session).length).toBe(1);
    expect(rows[1]).toMatchObject({ status: 'planned', session: null });
  });

  it('still treats a genuinely unplanned session as extra', () => {
    const { rows } = joinLearnerDay({
      sections: [{ subject: 'math', next: { title: 'A', unitId: 'math.01' } }],
      sessions: [{ subject: 'art', sessionId: 'ses_x', unitId: 'art.09' }],
    });
    expect(rows.find((row) => row.status === 'extra').session.sessionId).toBe('ses_x');
    expect(rows.find((row) => row.status === 'planned')).toBeTruthy();
  });
});
