import { describe, it, expect } from 'vitest';
import { joinLearnerDay, SESSION_PROGRESS_STATES } from './learnerDay.js';

// Shapes mirror the real read models — a section's plan lives at
// `next.title`/`next.unitId`; a session summary carries its own unitId.
const section = (subject, extra = {}) => ({ subject, next: { title: `${subject} lesson`, unitId: `${subject}.01` }, ...extra });
// `state` is now load-bearing: the join reads it to decide progress, so the
// default here is a FINISHED session. A fixture with no state would make every
// existing "done" assertion pass for the wrong reason.
const session = (subject, sessionId, extra = {}) => ({
  subject, sessionId, unitId: `${subject}.01`, lessonTitle: `${subject} done`,
  state: 'graded', ...extra,
});

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
    expect(rows[0].detail).toMatch(/its own program/i);
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

  it('flags a session whose subject was never planned as unplanned, keeping its progress', () => {
    const { rows } = joinLearnerDay({ sections: [], sessions: [session('piano', 'ses_9')] });
    expect(rows[0]).toMatchObject({ subject: 'piano', status: 'done', unplanned: true });
    // Provenance is the flag; the detail slot stays free for the paper note.
    expect(rows[0].detail).toBeNull();
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
    // `counts` is keyed by STATUS, and unplanned is not one — the stray piano
    // session counts as the `done` work it actually is.
    expect(counts).toMatchObject({ done: 2, planned: 1, deferred: 1, total: 4 });
    expect(counts.extra).toBeUndefined();
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
      sessions: [{ subject: 'piano', sessionId: 'ses_p', unitId: 'piano.03', lessonTitle: 'Piano Lesson 3', state: 'graded' }],
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

  // -------------------------------------------------------------------------
  // Progress is read from the session's STATE, never from its existence.
  //
  // The bug these pin: a session minted at agenda-build time and never touched
  // rendered as "Done" on the teacher dashboard, hiding the one thing the day
  // still owed. Both payloads carried the truth; the join ignored them.
  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // A served subject still knows what it served. The planner drops `next` once
  // a subject is done, which is why a finished lesson used to render as
  // "No work offered" beneath its own DONE chip.
  // -------------------------------------------------------------------------
  it('carries the curriculum work a served section credited', () => {
    const { rows } = joinLearnerDay({
      sections: [{
        subject: 'civilization', servedToday: true, next: null,
        servedWork: [{ unitId: 'atlas-p088', title: 'Ohio' }],
        progressLabel: 'Unit 7 of 58',
      }],
      sessions: [],
    });
    expect(rows[0].served).toMatchObject({ work: [{ title: 'Ohio' }], progressLabel: 'Unit 7 of 58' });
  });

  it('carries a program-served subject’s own progress copy and unit label', () => {
    // Arts/piano complete outside a work session: servedWork is empty and the
    // only identity in the payload is the program's own wording.
    const { rows } = joinLearnerDay({
      sections: [{
        subject: 'arts', servedToday: true, next: null, servedWork: [],
        progressLabel: 'Done today — Rhythm Improvisation with Chords · 35/366',
        progressRows: [
          { scope: 'course', label: 'Course' },
          { scope: 'module', label: 'Unit 2 · Chords & the Grand Staff' },
        ],
      }],
      sessions: [],
    });
    expect(rows[0]).toMatchObject({ status: 'done', detail: 'Completed in its own program' });
    expect(rows[0].served).toMatchObject({
      work: [],
      progressLabel: 'Done today — Rhythm Improvisation with Chords · 35/366',
      moduleLabel: 'Unit 2 · Chords & the Grand Staff',
    });
  });

  it('leaves `served` null on a subject the day still owes', () => {
    const { rows } = joinLearnerDay({ sections: [section('math')], sessions: [] });
    expect(rows[0].served).toBeNull();
  });

  it('does not call a minted-but-untouched session done', () => {
    const { rows } = joinLearnerDay({
      sections: [section('scripture', { servedToday: false })],
      sessions: [session('scripture', 'ses_created', { state: 'created' })],
    });
    expect(rows[0]).toMatchObject({ status: 'planned' });
    // The session stays attached: the card still links to its record.
    expect(rows[0].session.sessionId).toBe('ses_created');
  });

  it('calls work that is out in the world in-progress', () => {
    for (const state of ['issued', 'reprinted', 'submitted', 'media_dispatched']) {
      const { rows } = joinLearnerDay({
        sections: [section('math')],
        sessions: [session('math', 'ses_1', { state })],
      });
      expect(rows[0].status, `state ${state}`).toBe('in-progress');
    }
  });

  it('treats every finished state as done', () => {
    for (const state of ['graded', 'outcome_recorded', 'rewarded', 'media_completed', 'external_activity_assessed']) {
      const { rows } = joinLearnerDay({
        sections: [section('math')],
        sessions: [session('math', 'ses_1', { state })],
      });
      expect(rows[0].status, `state ${state}`).toBe('done');
    }
  });

  it('trusts a recorded score over an absent state field', () => {
    // Marks exist only for work that was done and graded. A payload that omits
    // `state` but carries 5/5 has told us the lesson is finished.
    const { rows } = joinLearnerDay({
      sections: [section('math')],
      sessions: [session('math', 'ses_1', {
        state: undefined, effectiveScore: { correctCount: 5, totalCount: 5, percent: 100 },
      })],
    });
    expect(rows[0].status).toBe('done');
  });

  it('lets the planner overrule the session state when it says the day is served', () => {
    const { rows } = joinLearnerDay({
      sections: [section('arts', { servedToday: true })],
      sessions: [session('arts', 'ses_1', { state: 'created' })],
    });
    expect(rows[0].status).toBe('done');
  });

  it('confers no progress on an abandoned or failed session', () => {
    for (const state of ['abandoned', 'failed', undefined]) {
      const { rows } = joinLearnerDay({
        sections: [section('math')],
        sessions: [session('math', 'ses_1', { state })],
      });
      expect(rows[0].status, `state ${state}`).toBe('planned');
    }
  });

  it('keeps unplanned work honest about its own progress', () => {
    const { rows } = joinLearnerDay({
      sections: [],
      sessions: [
        session('piano', 'ses_done', { state: 'rewarded' }),
        session('art', 'ses_idle', { state: 'created' }),
      ],
    });
    expect(rows.find((r) => r.session.sessionId === 'ses_done')).toMatchObject({ status: 'done', unplanned: true });
    expect(rows.find((r) => r.session.sessionId === 'ses_idle')).toMatchObject({ status: 'planned', unplanned: true });
  });

  it('never emits the retired `extra` status', () => {
    const { rows } = joinLearnerDay({
      sections: [section('math'), section('art', { servedToday: true })],
      sessions: [session('math', 'ses_1'), session('piano', 'ses_stray')],
    });
    expect(rows.every((row) => row.status !== 'extra')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // The join authors the footer's explanatory sentences, so the card has one
  // voice for them and no second slot to keep in sync.
  // -------------------------------------------------------------------------
  it('says so when finished work left no paper behind', () => {
    const { rows } = joinLearnerDay({
      sections: [section('arts')],
      sessions: [session('arts', 'ses_1', { state: 'media_completed', artifacts: { worksheet: null, receipt: null } })],
    });
    expect(rows[0].detail).toBe('No worksheet for this one');
  });

  it('stays quiet about paper on work that has one, or has not started', () => {
    const withPaper = joinLearnerDay({
      sections: [section('math')],
      sessions: [session('math', 'ses_1', { artifacts: { worksheet: { originalPdfUrl: '/a.pdf' }, receipt: null } })],
    });
    expect(withPaper.rows[0].detail).toBeNull();

    // Issued work HAS a worksheet; the note would be a lie.
    const issued = joinLearnerDay({
      sections: [section('math')],
      sessions: [session('math', 'ses_1', { state: 'issued', artifacts: { worksheet: null, receipt: null } })],
    });
    expect(issued.rows[0].detail).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Drift guard. DONE_STATES/IN_FLIGHT_STATES are a hand-copy of the backend's
  // TRANSITIONS map; nothing at runtime keeps them honest, so this does.
  // -------------------------------------------------------------------------
  it('classifies every state the backend session machine can produce', () => {
    // Mirror of `backend/src/2_domains/school/sessions/sessionEvents.mjs`
    // TRANSITIONS. If the backend grows a state, add it BOTH there and to
    // DONE_STATES / IN_FLIGHT_STATES in learnerDay.js — an unknown state falls
    // through to 'planned', which silently understates a child's day.
    const BACKEND_STATES = [
      'created', 'issued', 'reprinted', 'submitted', 'graded', 'outcome_recorded', 'rewarded',
      'media_dispatched', 'media_stalled', 'media_completed',
      'launch_dispatched', 'program_dispatched',
      'external_activity_dispatched', 'external_activity_assessed',
      'abandoned', 'failed',
    ];
    const { DONE_STATES, IN_FLIGHT_STATES } = SESSION_PROGRESS_STATES;
    const unclassified = BACKEND_STATES.filter(
      (state) => !DONE_STATES.has(state) && !IN_FLIGHT_STATES.has(state)
        && !['created', 'abandoned', 'failed'].includes(state),
    );
    expect(unclassified).toEqual([]);
    // And nothing classified that the backend cannot produce.
    const invented = [...DONE_STATES, ...IN_FLIGHT_STATES].filter((s) => !BACKEND_STATES.includes(s));
    expect(invented).toEqual([]);
  });

  it('still flags a genuinely unplanned session', () => {
    const { rows } = joinLearnerDay({
      sections: [{ subject: 'math', next: { title: 'A', unitId: 'math.01' } }],
      sessions: [{ subject: 'art', sessionId: 'ses_x', unitId: 'art.09' }],
    });
    expect(rows.find((row) => row.unplanned).session.sessionId).toBe('ses_x');
    expect(rows.find((row) => row.status === 'planned')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // The join carries agenda.mjs's own obligation verdict onto every row a
  // section produces — a pass-through, never a second opinion computed from
  // `next`/`servedToday`. `status` (per-row progress) and `obligation`
  // (per-subject owing) are different questions and neither one collapses
  // into the other: a row can be `planned` under `excused`, or `done` under
  // `served`.
  // -------------------------------------------------------------------------
  it('carries the same obligation onto every row a section produces, even across several sessions', () => {
    const { rows } = joinLearnerDay({
      sections: [section('scripture', { obligation: { state: 'obligated', reason: null } })],
      sessions: [session('scripture', 'ses_1'), session('scripture', 'ses_2')],
    });
    expect(rows).toHaveLength(2);
    rows.forEach((row) => {
      expect(row.obligation).toEqual({ state: 'obligated', reason: null, needsGrownUp: false });
    });
  });

  it('yields a null obligation, never a fabricated default, when the section never computed one', () => {
    const { rows } = joinLearnerDay({ sections: [section('math')], sessions: [] });
    expect(rows[0].obligation).toBeNull();
  });

  it('leaves obligation null on an unplanned session — no section judged it', () => {
    const { rows } = joinLearnerDay({ sections: [], sessions: [session('piano', 'ses_9')] });
    expect(rows[0].obligation).toBeNull();
  });

  it('pins status and obligation as independent facts: planned+excused, and done+served', () => {
    const excusedButPlanned = joinLearnerDay({
      sections: [section('reading', { obligation: { state: 'excused', reason: 'not_due_yet' } })],
      sessions: [],
    });
    expect(excusedButPlanned.rows[0]).toMatchObject({
      status: 'planned',
      obligation: { state: 'excused', reason: 'not_due_yet' },
    });

    const servedAndDone = joinLearnerDay({
      sections: [section('math', { obligation: { state: 'served', reason: null } })],
      sessions: [session('math', 'ses_1')],
    });
    expect(servedAndDone.rows[0]).toMatchObject({
      status: 'done',
      obligation: { state: 'served', reason: null },
    });
  });

  // Table-driven: all thirteen state/reason pairs `agenda.mjs` can produce
  // (verified against `agenda.mjs:355-410` and its FAULT_REASONS set), so a
  // future reason added to either side of the ladder shows up here as a gap
  // rather than silently defaulting to "no grown-up needed".
  it.each([
    ['served', null, false],
    ['obligated', null, false],
    ['excused', 'elective_only', false],
    ['faulted', 'program_unavailable', true],
    ['excused', 'blocked_no_offer', false],
    ['faulted', 'blocked_unreachable', true],
    ['excused', 'awaiting_grown_up', true],
    ['excused', 'opens_later', false],
    ['excused', 'caught_up', true],
    ['excused', 'optional_backlog', false],
    ['excused', 'not_due_yet', false],
    ['excused', 'not_a_school_day', false],
    ['excused', 'suppressed_by_focus', false],
  ])('classifies %s · %s as needing a grown-up: %s', (state, reason, needsGrownUp) => {
    const { rows } = joinLearnerDay({
      sections: [section('math', { obligation: { state, reason } })],
      sessions: [],
    });
    expect(rows[0].obligation).toMatchObject({ state, reason, needsGrownUp });
  });
});
