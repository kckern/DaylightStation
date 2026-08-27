import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import RosterStrip from './RosterStrip.jsx';

// RosterStrip's only network dependency is the agenda preview read (per
// learner, GET-only) that `joinLearnerDay` needs to compute `obligation`.
vi.mock('../../schoolApi.js', () => ({ schoolApi: { agendaPreview: vi.fn() } }));
const { schoolApi } = await import('../../schoolApi.js');

const ok = (data) => ({ ok: true, status: 200, data });
const KIDS = [{ id: 'learner-a', name: 'Learner A' }];
const ROW = { learnerId: 'learner-a', sessions: [], pendingReview: 0 };

// A minimal section: no session claims it (no `next`/`lockedRemedy`/
// `suppressed`/`servedToday`), so it lands on the join's terminal `planned`
// row with `detail: null` — the shape that puts obligation copy entirely on
// trial, uncontaminated by a backend-authored `detail` string.
const section = (obligation) => ({ subject: 'math', next: null, obligation });

async function mountExpanded(sectionFixture) {
  schoolApi.agendaPreview.mockResolvedValue(ok({ sections: sectionFixture ? [sectionFixture] : [] }));
  render(<RosterStrip rows={[ROW]} kids={KIDS} studyDay="2026-08-26" />);
  fireEvent.click(await screen.findByRole('button', { name: /Learner A/ }));
  return within(await screen.findByTestId('lesson-grid'));
}

describe('RosterStrip — a faulted subject looks like a fault (plan 3.2)', () => {
  it.each([
    ['program_unavailable', 'This program can’t start'],
    ['blocked_unreachable', 'Locked behind work nothing can reach'],
  ])('renders the fault card treatment and the Operations link for %s', async (reason, headline) => {
    const grid = await mountExpanded(section({ state: 'faulted', reason }));
    const card = grid.getByTestId('lesson-card');
    expect(card.className).toMatch(/teacher-lesson-card--faulted/);
    expect(grid.getByText(headline)).toBeInTheDocument();
    const link = grid.getByRole('link', { name: 'School → Operations' });
    expect(link).toHaveAttribute('href', '/school/teacher/operations');
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
    expect(link).toHaveAttribute('href', '/school/teacher/students/learner-a/courses');
  });

  it('awaiting_grown_up links to School → Operations, using the dormant-unit sentence', async () => {
    const grid = await mountExpanded(section({ state: 'excused', reason: 'awaiting_grown_up' }));
    const card = grid.getByTestId('lesson-card');
    expect(card.className).not.toMatch(/--faulted/);
    expect(grid.getByText('Ask a grown-up to continue or reschedule this work.')).toBeInTheDocument();
    expect(grid.getByRole('link', { name: 'School → Operations' })).toBeInTheDocument();
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
    const grid = await mountExpanded(section({ state: 'excused', reason: 'not_due_yet' }));
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
  it('counts faults and actionable excuses across every learner, and links to the first in roster order', async () => {
    const kids = [{ id: 'learner-a', name: 'Learner A' }, { id: 'learner-b', name: 'Learner B' }];
    const rows = [{ learnerId: 'learner-a', sessions: [] }, { learnerId: 'learner-b', sessions: [] }];
    schoolApi.agendaPreview.mockImplementation(async (learnerId) => (learnerId === 'learner-a'
      ? ok({ sections: [section({ state: 'excused', reason: 'not_due_yet' })] }) // no grown-up needed
      : ok({ sections: [section({ state: 'faulted', reason: 'program_unavailable' })] })));
    const onNeedsGrownUp = vi.fn();
    render(<RosterStrip rows={rows} kids={kids} studyDay="2026-08-26" onNeedsGrownUp={onNeedsGrownUp} />);
    await screen.findByRole('button', { name: /Learner A/ });
    await screen.findByRole('button', { name: /Learner B/ });
    // Both learners' agenda reads settle asynchronously; the LAST report,
    // once both have landed, must count only learner-b's fault and link to
    // the first (in roster order) learner who has one.
    await waitFor(() => expect(onNeedsGrownUp).toHaveBeenLastCalledWith({
      count: 1, href: '/school/teacher/operations',
    }));
  });

  it('reports zero when nothing needs a grown-up', async () => {
    schoolApi.agendaPreview.mockResolvedValue(ok({ sections: [section({ state: 'excused', reason: 'not_due_yet' })] }));
    const onNeedsGrownUp = vi.fn();
    render(<RosterStrip rows={[ROW]} kids={KIDS} studyDay="2026-08-26" onNeedsGrownUp={onNeedsGrownUp} />);
    await screen.findByRole('button', { name: /Learner A/ });
    await waitFor(() => expect(onNeedsGrownUp).toHaveBeenLastCalledWith({ count: 0, href: null }));
  });
});
