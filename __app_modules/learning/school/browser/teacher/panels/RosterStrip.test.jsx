import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import RosterStrip from "./RosterStrip.jsx";
import { teacherLog } from "../teacherLog.js";

// RosterStrip's only network dependency is the agenda preview read (per
// learner, GET-only) that `joinLearnerDay` needs to compute `obligation`.
vi.mock("../../schoolApi.js", () => ({ schoolApi: { agendaPreview: vi.fn() } }));
const { schoolApi } = await import("../../schoolApi.js");

const ok = (data) => ({ ok: true, status: 200, data });

// The open card lives in the URL (`?open=`); a test that expanded a learner
// must not hand the next one a card that is already open.
beforeEach(() => { window.history.replaceState({}, '', window.location.pathname); });
const KIDS = [{ id: 'user_4', name: 'User_4' }];
const ROW = { learnerId: 'user_4', sessions: [], pendingReview: 0 };

// A minimal section: no session claims it (no `next`/`lockedRemedy`/
// `suppressed`/`servedToday`), so it lands on the join's terminal `planned`
// row with `detail: null` — the shape that puts obligation copy entirely on
// trial, uncontaminated by a backend-authored `detail` string.
const section = (obligation) => ({ subject: 'math', next: null, obligation });

async function mountExpanded(sectionFixture) {
  schoolApi.agendaPreview.mockResolvedValue(ok({ sections: sectionFixture ? [sectionFixture] : [] }));
  render(<RosterStrip rows={[ROW]} kids={KIDS} studyDay="2026-08-26" />);
  fireEvent.click(await screen.findByRole('button', { name: /User_4/ }));
  return within(await screen.findByTestId('lesson-grid'));
}

describe('RosterStrip — a faulted subject looks like a fault (plan 3.2)', () => {
  it.each([
    ['program_unavailable', 'This program can’t start'],
    ['blocked_unreachable', 'Locked behind work nothing can reach'],
  ])('renders the fault card treatment and the learner\'s own repair tools for %s', async (reason, headline) => {
    const grid = await mountExpanded(section({ state: 'faulted', reason }));
    const card = grid.getByTestId('lesson-card');
    expect(card.className).toMatch(/teacher-lesson-card--faulted/);
    expect(grid.getByText(headline)).toBeInTheDocument();
    // The learner's own Operations page, told the reason and subject — not
    // the generic school page that knew neither.
    const link = grid.getByRole('link', { name: 'Open repair tools' });
    expect(link).toHaveAttribute('href', `/school/teacher/students/user_4/operations?reason=${reason}&subject=math&day=2026-08-26`);
    // Never the schema's own word for itself.
    expect(grid.queryByText(reason)).toBeNull();
  });
});

describe('RosterStrip — actionable excuses say so (plan 3.3)', () => {
  it('caught_up links to the learner\'s own Courses page', async () => {
    const grid = await mountExpanded(section({ state: 'excused', reason: 'caught_up' }));
    const card = grid.getByTestId('lesson-card');
    expect(card.className).not.toMatch(/--faulted/);
    expect(grid.getByText('This course has no more lessons')).toBeInTheDocument();
    const link = grid.getByRole('link', { name: 'Open Courses' });
    expect(link).toHaveAttribute('href', '/school/teacher/students/user_4/courses');
  });

  it('awaiting_grown_up links to the learner\'s repair tools, using the dormant-unit sentence', async () => {
    const grid = await mountExpanded(section({ state: 'excused', reason: 'awaiting_grown_up' }));
    const card = grid.getByTestId('lesson-card');
    expect(card.className).not.toMatch(/--faulted/);
    expect(grid.getByText('Ask a grown-up to continue or reschedule this work.')).toBeInTheDocument();
    expect(grid.getByRole('link', { name: 'Open repair tools' }))
      .toHaveAttribute('href', '/school/teacher/students/user_4/operations?reason=awaiting_grown_up&subject=math&day=2026-08-26');
  });

  // Table-driven, and the absence of a link is asserted as deliberately as
  // the presence of the sentence — "do not give every excuse a button" only
  // means something if a passing test could have caught a stray one.
  it.each([
    ['elective_only', 'Only elective work is offered today.'],
    ['blocked_no_offer', 'Locked behind other work.'],
    ['opens_later', 'Opens later.'],
    ['optional_backlog', 'Optional catch-up work — nothing owed today.'],
    ['not_due_yet', 'Offered, but not due yet.'],
    ['not_a_school_day', 'Not a school day.'],
    ['suppressed_by_focus', 'Deferred for another subject today.'],
  ])('renders %s muted, with no affordance', async (reason, sentence) => {
    const grid = await mountExpanded(section({ state: 'excused', reason }));
    const card = grid.getByTestId('lesson-card');
    expect(card.className).not.toMatch(/--faulted/);
    expect(grid.getByText(sentence)).toBeInTheDocument();
    expect(grid.queryByRole('link')).toBeNull();
    expect(grid.queryByRole('button')).toBeNull();
  });
});

describe('RosterStrip — obligation is a separate fact from status (plan 3.2/3.3)', () => {
  it('renders nothing extra for a null obligation (older payload, or a subject the planner never judged)', async () => {
    const grid = await mountExpanded({ subject: 'math', next: null }); // no `obligation` key at all
    const card = grid.getByTestId('lesson-card');
    expect(card.className).not.toMatch(/--faulted/);
    expect(card.querySelector('.teacher-lesson-card__obligation')).toBeNull();
    expect(card.querySelector('.teacher-lesson-card__pending')).toBeNull();
    expect(grid.queryByRole('link')).toBeNull();
  });

  it('shows a planned row’s status chip AND its excused obligation — two facts, not a merged badge', async () => {
    const grid = await mountExpanded({
      subject: 'math',
      next: { title: 'Place value practice' },
      obligation: { state: 'excused', reason: 'not_due_yet' },
    });
    const card = grid.getByTestId('lesson-card');
    expect(within(card).getByText('Not started')).toBeInTheDocument();
    expect(within(card).getByText('Offered, but not due yet.')).toBeInTheDocument();
  });
});

describe('RosterStrip — the collapsed roster row (DayDots)', () => {
  it('gives a subject that needs a grown-up its own dot tone, even under a status a reachable lock also uses', async () => {
    schoolApi.agendaPreview.mockResolvedValue(ok({
      sections: [{ subject: 'math', next: null, lockedRemedy: 'Waiting on Unit 3', obligation: { state: 'faulted', reason: 'blocked_unreachable' } }],
    }));
    render(<RosterStrip rows={[ROW]} kids={KIDS} studyDay="2026-08-26" />);
    const dots = await screen.findByTestId('day-dots');
    const dotEl = dots.querySelector('.teacher-roster__dot');
    expect(dotEl).not.toBeNull();
    expect(dotEl.className).toMatch(/--needs-grownup/);
  });
});

describe('RosterStrip — reports the dashboard’s "needs a grown-up" tally (plan 3.4)', () => {
  it('counts faults and actionable excuses across every learner, one named link per affected subject', async () => {
    const kids = [{ id: 'user_4', name: 'User_4' }, { id: 'user_2', name: 'User_2' }];
    const rows = [{ learnerId: 'user_4', sessions: [] }, { learnerId: 'user_2', sessions: [] }];
    schoolApi.agendaPreview.mockImplementation(async (learnerId) => (learnerId === 'user_4'
      ? ok({ sections: [section({ state: 'excused', reason: 'not_due_yet' })] }) // no grown-up needed
      : ok({ sections: [section({ state: 'faulted', reason: 'program_unavailable' })] })));
    const onNeedsGrownUp = vi.fn();
    render(<RosterStrip rows={rows} kids={kids} studyDay="2026-08-26" onNeedsGrownUp={onNeedsGrownUp} />);
    await screen.findByRole('button', { name: /User_4/ });
    await screen.findByRole('button', { name: /User_2/ });
    // Both learners' agenda reads settle asynchronously; the LAST report,
    // once both have landed, must count only user_2's fault and carry one
    // link to that child's own repair tools, named.
    await waitFor(() => expect(onNeedsGrownUp).toHaveBeenLastCalledWith({
      count: 1, unknown: 0, items: [{
        learnerId: 'user_2', name: 'User_2', reason: 'program_unavailable', subject: 'math',
        headline: 'This program can’t start',
        href: '/school/teacher/students/user_2/operations?reason=program_unavailable&subject=math&day=2026-08-26',
      }],
    }));
  });

  it('reports zero when nothing needs a grown-up', async () => {
    schoolApi.agendaPreview.mockResolvedValue(ok({ sections: [section({ state: 'excused', reason: 'not_due_yet' })] }));
    const onNeedsGrownUp = vi.fn();
    render(<RosterStrip rows={[ROW]} kids={KIDS} studyDay="2026-08-26" onNeedsGrownUp={onNeedsGrownUp} />);
    await screen.findByRole('button', { name: /User_4/ });
    await waitFor(() => expect(onNeedsGrownUp).toHaveBeenLastCalledWith({ count: 0, unknown: 0, items: [] }));
  });

  // A FAILED PLANNER READ IS NOT A ZERO.
  //
  // On an `error`/`unavailable` agenda, `agenda.data` is null, the join runs
  // over zero sections, and every row's obligation is `null` — which
  // `learnerDay.js` defines as "the planner didn't say", not "the planner said
  // fine". Reporting that as an empty tally makes the one screen built to
  // catch a broken day say all-clear. The "couldn't load the day's plan"
  // notice lives in the grid, which a collapsed card never mounts, so nothing
  // else on this screen would say otherwise.
  it.each([['error', 500], ['unavailable', 404]])(
    'reports a %s agenda read as unknown, never as zero subjects', async (_state, status) => {
    schoolApi.agendaPreview.mockResolvedValue({ ok: false, status, data: null });
    const onNeedsGrownUp = vi.fn();
    render(<RosterStrip rows={[ROW]} kids={KIDS} studyDay="2026-08-26" onNeedsGrownUp={onNeedsGrownUp} />);
    await screen.findByRole('button', { name: /User_4/ });
    await waitFor(() => expect(onNeedsGrownUp).toHaveBeenLastCalledWith({ count: 0, unknown: 1, items: [] }));
  });

  it('counts a readable learner and an unreadable one separately', async () => {
    const kids = [{ id: 'user_4', name: 'User_4' }, { id: 'user_2', name: 'User_2' }];
    const rows = [{ learnerId: 'user_4', sessions: [] }, { learnerId: 'user_2', sessions: [] }];
    schoolApi.agendaPreview.mockImplementation(async (learnerId) => (learnerId === 'user_4'
      ? ok({ sections: [section({ state: 'faulted', reason: 'program_unavailable' })] })
      : { ok: false, status: 500, data: null }));
    const onNeedsGrownUp = vi.fn();
    render(<RosterStrip rows={rows} kids={kids} studyDay="2026-08-26" onNeedsGrownUp={onNeedsGrownUp} />);
    await screen.findByRole('button', { name: /User_2/ });
    await waitFor(() => expect(onNeedsGrownUp).toHaveBeenLastCalledWith({
      count: 1, unknown: 1, items: [expect.objectContaining({
        learnerId: 'user_4', href: '/school/teacher/students/user_4/operations?reason=program_unavailable&subject=math&day=2026-08-26',
      })],
    }));
  });

  // The count, the unknowns and the links are one set: a learner who has
  // left the roster must drop out of all three, not only the links.
  it('drops a learner who left the roster from the count and the unknowns, not only the links', async () => {
    const kids = [{ id: 'user_4', name: 'User_4' }, { id: 'user_2', name: 'User_2' }];
    const both = [{ learnerId: 'user_4', sessions: [] }, { learnerId: 'user_2', sessions: [] }];
    schoolApi.agendaPreview.mockImplementation(async (learnerId) => (learnerId === 'user_4'
      ? ok({ sections: [section({ state: 'faulted', reason: 'program_unavailable' })] })
      : { ok: false, status: 500, data: null }));
    const onNeedsGrownUp = vi.fn();
    const view = render(<RosterStrip rows={both} kids={kids} studyDay="2026-08-26" onNeedsGrownUp={onNeedsGrownUp} />);
    await waitFor(() => expect(onNeedsGrownUp).toHaveBeenLastCalledWith(expect.objectContaining({ count: 1, unknown: 1 })));
    view.rerender(<RosterStrip rows={[both[1]]} kids={kids} studyDay="2026-08-26" onNeedsGrownUp={onNeedsGrownUp} />);
    await waitFor(() => expect(onNeedsGrownUp).toHaveBeenLastCalledWith({ count: 0, unknown: 1, items: [] }));
  });

  it('renames a child in the strip when the roster renames them', async () => {
    schoolApi.agendaPreview.mockResolvedValue(ok({ sections: [section({ state: 'faulted', reason: 'program_unavailable' })] }));
    const onNeedsGrownUp = vi.fn();
    const view = render(<RosterStrip rows={[ROW]} kids={KIDS} studyDay="2026-08-26" onNeedsGrownUp={onNeedsGrownUp} />);
    await waitFor(() => expect(onNeedsGrownUp).toHaveBeenLastCalledWith(expect.objectContaining({
      items: [expect.objectContaining({ name: 'User_4' })],
    })));
    view.rerender(<RosterStrip rows={[ROW]} kids={[{ id: 'user_4', name: 'Renamed' }]} studyDay="2026-08-26" onNeedsGrownUp={onNeedsGrownUp} />);
    await waitFor(() => expect(onNeedsGrownUp).toHaveBeenLastCalledWith(expect.objectContaining({
      items: [expect.objectContaining({ name: 'Renamed' })],
    })));
  });

  it('suppresses the collapsed card summary and dots when the plan could not be read', async () => {
    schoolApi.agendaPreview.mockResolvedValue({ ok: false, status: 500, data: null });
    render(<RosterStrip rows={[{ learnerId: 'user_4', sessions: [
      { subject: 'math', sessionId: 'ses_1', unitId: 'm1', lessonTitle: 'Math A', state: 'graded' },
    ] }]} kids={KIDS} studyDay="2026-08-26" />);
    const card = await screen.findByRole('button', { name: /User_4/ });
    // With no sections every session falls to `unplanned`, so the summary
    // would read "1 extra" for an ordinary day and the dots would show a
    // one-lesson day. Both are guesses dressed as facts.
    await waitFor(() => expect(schoolApi.agendaPreview).toHaveBeenCalled());
    expect(card.querySelector('.teacher-roster__stats')).toBeNull();
    expect(card.querySelector('.teacher-roster__dots')).toBeNull();
  });
});

// A section is judged ONCE by the planner; a section that produces MULTIPLE
// rows (two matched sessions under one subject) shares the SAME `obligation`
// object across every row it produces (task 7). Neither the tally nor the
// card may count/print that verdict once per ROW — code review caught this:
// every other fixture in this file has exactly one row per section, so
// nothing here previously exercised the multi-row case at all.
describe('RosterStrip — a section\'s obligation is stated once, not once per row (plan 3.4 fix)', () => {
  // `caught_up` is the reason that most plausibly co-occurs with finished
  // work: the course ran out of lessons AFTER the child did two of them
  // today. No `next.unitId` on the section, so both sessions claim it by
  // SUBJECT match (`claimFor`), producing two rows sharing one obligation.
  const rowWithTwoSessions = {
    learnerId: 'user_4',
    sessions: [
      { subject: 'math', sessionId: 'ses_1', unitId: 'm1', lessonTitle: 'Math A', state: 'graded' },
      { subject: 'math', sessionId: 'ses_2', unitId: 'm2', lessonTitle: 'Math B', state: 'graded' },
    ],
  };
  const twoSessionSection = section({ state: 'excused', reason: 'caught_up' });

  it('counts a multi-session subject ONCE in the dashboard tally, not once per session', async () => {
    schoolApi.agendaPreview.mockResolvedValue(ok({ sections: [twoSessionSection] }));
    const onNeedsGrownUp = vi.fn();
    render(<RosterStrip rows={[rowWithTwoSessions]} kids={KIDS} studyDay="2026-08-26" onNeedsGrownUp={onNeedsGrownUp} />);
    await screen.findByRole('button', { name: /User_4/ });
    await waitFor(() => expect(onNeedsGrownUp).toHaveBeenLastCalledWith({
      count: 1, unknown: 0, items: [expect.objectContaining({
        learnerId: 'user_4', reason: 'caught_up', href: '/school/teacher/students/user_4/courses',
      })],
    }));
  });

  it('prints the notice on only the FIRST of the two cards, never duplicated on the second', async () => {
    schoolApi.agendaPreview.mockResolvedValue(ok({ sections: [twoSessionSection] }));
    render(<RosterStrip rows={[rowWithTwoSessions]} kids={KIDS} studyDay="2026-08-26" />);
    fireEvent.click(await screen.findByRole('button', { name: /User_4/ }));
    const grid = within(await screen.findByTestId('lesson-grid'));
    const cards = grid.getAllByTestId('lesson-card');
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText('This course has no more lessons')).toBeInTheDocument();
    expect(within(cards[0]).getByRole('link', { name: 'Open Courses' })).toBeInTheDocument();
    // The second card gets no repeat of the sentence, and no obligation link
    // standing in for it either — the slot is deliberately quiet, not
    // silently different. (Each card DOES carry its own "open this session"
    // link, unrelated to the obligation — scope to the obligation link itself.)
    expect(within(cards[1]).queryByText('This course has no more lessons')).toBeNull();
    expect(within(cards[1]).queryByRole('link', { name: 'Open Courses' })).toBeNull();
    expect(cards[1].querySelector('.teacher-lesson-card__obligation')).toBeNull();
  });
});

// Task 7's `NEEDS_GROWN_UP` (`learnerDay.js`) is the source of truth for
// WHICH reasons need a grown-up; this file's `GROWN_UP_ACTION` /
// `MUTED_EXCUSE_FALLBACK` only supply the WORDS for the ones it already
// knows about. If the two drift apart the slot must still say something —
// never blank — and must warn so the drift gets noticed and fixed.
describe('RosterStrip — a copy-gap never renders blank (drift safety net)', () => {
  it('a FAULTED reason with no matching GROWN_UP_ACTION entry still gets a headline and a link, and warns', async () => {
    const warn = vi.spyOn(teacherLog, 'copyGap').mockImplementation(() => {});
    // `state: 'faulted'` on its own (task 7's ladder guarantees only two
    // reasons ever produce it today, but the card must not rely on that
    // holding forever) — a fault reason this file has never heard of.
    const grid = await mountExpanded(section({ state: 'faulted', reason: 'unforeseen_fault' }));
    const card = grid.getByTestId('lesson-card');
    expect(card.className).toMatch(/--faulted/);
    expect(grid.queryByText('unforeseen_fault')).toBeNull();
    expect(grid.getByText('This needs a grown-up (Unforeseen Fault).')).toBeInTheDocument();
    expect(grid.getByRole('link', { name: 'Open repair tools' }))
      .toHaveAttribute('href', '/school/teacher/students/user_4/operations?reason=unforeseen_fault&subject=math&day=2026-08-26');
    expect(warn).toHaveBeenCalledWith('grown-up-reason-unmapped', { reason: 'unforeseen_fault' });
    warn.mockRestore();
  });

  it('an EXCUSED reason with no matching MUTED_EXCUSE_FALLBACK entry still gets a sentence (labelized, no link), and warns', async () => {
    const warn = vi.spyOn(teacherLog, 'copyGap').mockImplementation(() => {});
    const grid = await mountExpanded(section({ state: 'excused', reason: 'unforeseen_excuse' }));
    const card = grid.getByTestId('lesson-card');
    expect(card.className).not.toMatch(/--faulted/);
    expect(grid.queryByText('unforeseen_excuse')).toBeNull();
    expect(grid.getByText('Unforeseen Excuse')).toBeInTheDocument();
    expect(grid.queryByRole('link')).toBeNull();
    expect(warn).toHaveBeenCalledWith('excuse-reason-unmapped', { reason: 'unforeseen_excuse' });
    warn.mockRestore();
  });
});

describe('RosterStrip — teacher hold (remediation cap)', () => {
  it('teacher_hold with no session on the row falls back to the learner\'s History', async () => {
    const grid = await mountExpanded(section({ state: 'excused', reason: 'teacher_hold' }));
    const card = grid.getByTestId('lesson-card');
    expect(card.className).not.toMatch(/--faulted/);
    expect(grid.getByText('Stuck on a failed lesson — this one needs you.')).toBeInTheDocument();
    expect(grid.getByRole('link', { name: 'Open the lesson' }))
      .toHaveAttribute('href', '/school/teacher/students/user_4/history');
    expect(grid.queryByText('teacher_hold')).toBeNull();
  });

  // The real shape of a hold: agenda.mjs makes the held entry the section's
  // `next`, and its failed attempt is from an earlier day, so no session of
  // today's joins the row. The digest's `attention` item for that unit is
  // what still knows the session — the link used to stop at History.
  it('teacher_hold links to the failed session the attention item names', async () => {
    schoolApi.agendaPreview.mockResolvedValue(ok({ sections: [{
      subject: 'math', next: { unitId: 'm1', title: 'Math A' }, obligation: { state: 'excused', reason: 'teacher_hold' },
    }] }));
    const row = { ...ROW, attention: [{ kind: 'remediation-cap', learnerId: 'user_4', unitId: 'm1', sessionId: 'ses_9', unitTitle: 'Math A' }] };
    const onNeedsGrownUp = vi.fn();
    render(<RosterStrip rows={[row]} kids={KIDS} studyDay="2026-08-26" onNeedsGrownUp={onNeedsGrownUp} />);
    fireEvent.click(await screen.findByRole('button', { name: /User_4/ }));
    const grid = within(await screen.findByTestId('lesson-grid'));
    expect(grid.getByRole('link', { name: 'Open the lesson' }))
      .toHaveAttribute('href', '/school/teacher/students/user_4/history/sessions/ses_9?from=today');
    await waitFor(() => expect(onNeedsGrownUp).toHaveBeenLastCalledWith({
      count: 1, unknown: 0, items: [expect.objectContaining({
        reason: 'teacher_hold', href: '/school/teacher/students/user_4/history/sessions/ses_9?from=today',
      })],
    }));
  });

  it('names each remediation-cap item on the card, linked to the session that can offer another try', async () => {
    schoolApi.agendaPreview.mockResolvedValue(ok({ sections: [] }));
    const row = { ...ROW, attention: [{
      kind: 'remediation-cap', learnerId: 'user_4', sessionId: 'ses_2', unitId: 'math.01', unitTitle: 'Place Value',
      depth: 2, maxRounds: 2, lastScore: { percent: 16.67, correctCount: 1, totalCount: 6 }, since: '2026-09-30T16:02:00.000Z',
    }] };
    render(<RosterStrip rows={[row]} kids={KIDS} studyDay="2026-10-02" />);
    const list = await screen.findByTestId('attention');
    const link = within(list).getByRole('link', { name: /Place Value/ });
    expect(link).toHaveTextContent('Place Value — 2 retries, last 17% →');
    expect(link).toHaveAttribute('href', '/school/teacher/students/user_4/history/sessions/ses_2?from=today');
  });

  it('words a stale hold by the school days it has sat unretried', async () => {
    schoolApi.agendaPreview.mockResolvedValue(ok({ sections: [] }));
    const row = { ...ROW, attention: [{
      kind: 'remediation-stale', learnerId: 'user_4', sessionId: 'ses_0', unitId: 'math.03', unitTitle: 'Mastery Quiz',
      depth: 0, maxRounds: 2, idleStudyDays: 4, lastScore: { percent: 16.67, correctCount: 1, totalCount: 6 }, since: null,
    }, {
      kind: 'remediation-cap', learnerId: 'user_4', sessionId: 'ses_9', unitId: 'math.04', unitTitle: 'Fractions',
      depth: 1, maxRounds: 1, idleStudyDays: 0, lastScore: null, since: null,
    }] };
    render(<RosterStrip rows={[row]} kids={KIDS} studyDay="2026-10-02" />);
    const list = await screen.findByTestId('attention');
    expect(within(list).getByRole('link', { name: /Mastery Quiz/ }))
      .toHaveTextContent('Mastery Quiz — not retried in 4 school days, last 17% →');
    expect(within(list).getByRole('link', { name: /Fractions/ })).toHaveTextContent('Fractions — 1 retry →');
  });

  it('renders no attention list when there is nothing waiting', async () => {
    schoolApi.agendaPreview.mockResolvedValue(ok({ sections: [] }));
    render(<RosterStrip rows={[{ ...ROW, attention: [] }]} kids={KIDS} studyDay="2026-10-02" />);
    await screen.findByRole('button', { name: /User_4/ });
    expect(screen.queryByTestId('attention')).toBeNull();
  });
});

describe('RosterStrip — the open card follows the URL', () => {
  it('re-reads `?open=` on popstate, so back/forward and same-page links move it', async () => {
    schoolApi.agendaPreview.mockResolvedValue(ok({ sections: [] }));
    window.history.replaceState({}, '', `${window.location.pathname}?open=user_4`);
    render(<RosterStrip rows={[ROW]} kids={KIDS} studyDay="2026-08-26" />);
    const card = await screen.findByRole('button', { name: /User_4/ });
    expect(card).toHaveAttribute('aria-expanded', 'true');
    window.history.pushState({}, '', window.location.pathname);
    window.dispatchEvent(new PopStateEvent('popstate'));
    await waitFor(() => expect(card).toHaveAttribute('aria-expanded', 'false'));
  });
});
