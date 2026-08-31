import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent, within } from '@testing-library/react';
import TodayTab from './TodayTab.jsx';
import { QueueView } from '../WorkspaceViews.jsx';
import { TeacherProfileProvider, useTeacherProfile } from '../TeacherProfileContext.jsx';
import PinPrompt from '../panels/PinPrompt.jsx';

vi.mock('../teacherWorkspaceApi.js', () => ({ teacherWorkspaceApi: {
  authStatus: vi.fn(async () => {
    const userId = sessionStorage.getItem('school-teacher-claim');
    return { ok: true, status: 200, data: userId ? { active: true, userId } : { active: false } };
  }),
  unlock: vi.fn(async (userId) => ({ ok: true, status: 200, data: { active: true, userId } })),
  lock: vi.fn(async () => ({ ok: true, status: 200, data: { locked: true } })),
  stepUp: vi.fn(async () => ({ ok: true, status: 200, data: { grantToken: 'grant' } })),
  session: vi.fn(),
} }));

vi.mock('../../schoolApi.js', () => ({
  schoolApi: {
    teacherDay: vi.fn(),
    agendaPreview: vi.fn(),
    lifecycleReview: vi.fn(),
    printPending: vi.fn(),
    printQuota: vi.fn(async () => ({ ok: true, status: 200, data: { pagesInWindow: 0, pagesPerWindow: 5, remaining: 5, windowMinutes: 60 } })),
    printablePreviewUrl: (printableId) => `/api/v1/school/print/printables/${printableId}/preview`,
    quizRequests: vi.fn(),
    teachers: vi.fn(),
    resolveReview: vi.fn(),
    printApprove: vi.fn(),
    printDeny: vi.fn(),
    quizRequestDismiss: vi.fn(),
  },
}));
const { schoolApi } = await import('../../schoolApi.js');
const { teacherWorkspaceApi } = await import('../teacherWorkspaceApi.js');

const KIDS = [{ id: 'learner-a', name: 'Learner A' }, { id: 'learner-b', name: 'Learner B' }];
const ok = (data) => ({ ok: true, status: 200, data });
const fail = (status) => ({ ok: false, status, data: null });

// The shell owns the PinPrompt and the picker; the harness mirrors that
// composition so tab-level mutation flows exercise the real affordances.
function ShellProbe() {
  const { pickerOpen, currentTeacher } = useTeacherProfile();
  return <><span data-testid="claimed-teacher" hidden>{currentTeacher?.id ?? 'none'}</span>{pickerOpen ? <div>Who&apos;s teaching?</div> : null}</>;
}
const mount = (ui) => render(
  <TeacherProfileProvider>{ui}<PinPrompt /><ShellProbe /></TeacherProfileProvider>,
);

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  schoolApi.teachers.mockResolvedValue(ok({ configured: true, teachers: [{ id: 'kckern', name: 'KC' }] }));
  schoolApi.resolveReview.mockResolvedValue(ok({ verdict: 'correct' }));
  schoolApi.printApprove.mockResolvedValue(ok({ decision: 'printed' }));
  schoolApi.printDeny.mockResolvedValue(ok({ decision: 'denied' }));
  schoolApi.quizRequestDismiss.mockResolvedValue(ok({ dismissed: true }));
  schoolApi.teacherDay.mockResolvedValue(ok([
    { learnerId: 'learner-a', effectiveScoreTotals: { correct: 5, total: 7 }, sessions: [{ sessionId: 'ses_1', unitId: 'unit-illinois', lessonTitle: 'Illinois', subject: 'civilization', courseTitle: 'United States Regions and States', moduleTitle: 'Midwest', posterUrl: '/course-poster.jpg', studyDay: '2026-08-24', effectiveScore: { correctCount: 5, totalCount: 7, percent: 71 }, state: 'graded',
      // The digest itself carries the paper-record refs (GetTeacherToday) —
      // this is what lets the grid show them with zero per-session fetches.
      artifacts: {
        worksheet: { artifactId: 'worksheet-1', originalPdfUrl: '/issued/illinois.pdf', thumbnailUrl: '/issued/illinois-thumb.png' },
        receipt: { artifactId: 'receipt-1', originalUrl: '/issued/illinois-receipt.png' },
      } }], pendingReview: 2 },
    { learnerId: 'learner-b', attemptsToday: 0, correctToday: 0, sessionsToday: [], pendingReview: 0 },
  ]));
  // The day's plan, for the "not yet started" cards: Illinois is claimed by
  // the recorded session (unit match); the math offer has no session yet.
  schoolApi.agendaPreview.mockResolvedValue(ok({ sections: [
    { subject: 'civilization', next: { unitId: 'unit-illinois', title: 'Illinois' } },
    { subject: 'math', next: { unitId: 'unit-fractions', title: 'Fractions Intro' } },
  ] }));
  schoolApi.lifecycleReview.mockResolvedValue(ok({ items: [
    { sessionId: 'ses_1', itemId: 'q3', learnerId: 'learner-a', prompt: 'Explain photosynthesis', given: 'plants eat light', questionNumber: 3 },
  ] }));
  teacherWorkspaceApi.session.mockResolvedValue(ok({
    sessionId: 'ses_1', taxonomy: { subject: 'civilization', courseTitle: 'United States Regions and States', moduleTitle: 'Midwest', lessonTitle: 'Illinois', posterUrl: '/course-poster.jpg' },
    artifacts: [
      { artifactId: 'worksheet-1', kind: 'assignment', availability: 'exact', originalPdfUrl: '/issued/illinois.pdf' },
      { artifactId: 'receipt-1', kind: 'result-receipt', availability: 'exact', originalUrl: '/issued/illinois-receipt.png' },
    ],
  }));
  schoolApi.printPending.mockResolvedValue(ok([
    { id: 'pr_1', userId: 'learner-a', printableId: 'state-capitals', label: 'US State Capitals', pages: 6, copies: 1 },
  ]));
  schoolApi.quizRequests.mockResolvedValue(ok([
    { at: '2026-08-06T10:00:00Z', userId: 'learner-b', unitId: 'plex:123', unitTitle: 'Fractions Ep. 4', materialTitle: 'Math Course' },
  ]));
});

describe('TodayTab', () => {
  it('joins digest rows with roster names and counts the day, not one lesson', async () => {
    mount(<TodayTab kids={KIDS} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Learner A/ })).toBeTruthy());
    expect(screen.getByRole('button', { name: /Learner B/ })).toBeTruthy();
    // "5 / 7 correct" was one worksheet's marks standing for a whole
    // student-day. The row is scoped to a day, so it counts lessons.
    await waitFor(() => expect(screen.getByText('1 of 2 lessons done')).toBeInTheDocument());
    expect(screen.queryByText(/\d+\s*\/\s*\d+\s*correct/)).toBeNull();
    expect(screen.queryByText(/5\s*\/\s*7/)).toBeNull();
  });

  it('draws one dot per assigned lesson, toned by what actually happened', async () => {
    mount(<TodayTab kids={KIDS} />);
    // Scoped to ONE learner's row: every learner draws their own day.
    const dots = await waitFor(() => {
      const entry = document.querySelectorAll('.teacher-roster__entry')[0];
      const found = entry.querySelectorAll('.teacher-roster__dot');
      expect(found.length).toBe(2);   // Illinois (graded) + Fractions (not started)
      return found;
    });
    expect(dots[0].className).toMatch(/--failed/);   // 71% is under the 80% bar
    expect(dots[1].className).toMatch(/--idle/);     // never started
  });

  // The entry resolved a studyDay (prop → row → local today) and then handed
  // the grid the RAW `row.studyDay`, which a v1 digest does not carry — so the
  // link navigated with no date at all.
  it('links the day record to the day it is showing', async () => {
    // The digest's v2 object shape names the day; the ROW does not, in either
    // shape — which is the whole bug. The entry resolved it correctly and then
    // passed the raw row value down anyway.
    schoolApi.teacherDay.mockResolvedValue(ok({ studyDay: '2026-08-26', learners: [
      { learnerId: 'learner-a', effectiveScoreTotals: { correct: 0, total: 0 }, pendingReview: 0, sessions: [] },
    ] }));
    mount(<TodayTab kids={KIDS} />);
    fireEvent.click(await screen.findByRole('button', { name: /Learner A/ }));
    const link = await screen.findByRole('link', { name: /Open the full day record/ });
    expect(link.getAttribute('href')).toContain('2026-08-26');
  });

  // Both used to sit absolutely positioned in the same corner of the row,
  // 20px apart, over a button whose whole surface is the toggle.
  it('keeps the agenda link outside the row toggle', async () => {
    mount(<TodayTab kids={KIDS} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Learner A/ })).toBeTruthy());
    const agenda = screen.getAllByRole('link', { name: /printed agenda/i })[0];
    const toggle = screen.getByRole('button', { name: /Learner A/ });
    expect(toggle.contains(agenda)).toBe(false);
    // The chevron, by contrast, belongs to the surface it describes.
    expect(toggle.querySelector('.teacher-roster__disclosure')).not.toBeNull();
  });

  it('drill-in names the lesson and costs no session fetch', async () => {
    // The grid shows every lesson AND its paper-record icons straight from
    // the digest — the per-session document fetch (the audited N+1) must
    // never come back. The one extra read is the agenda preview, ONE PER
    // LEARNER: the collapsed roster card draws the day as dots, so it needs
    // the plan whether or not anyone expands it. Two learners, two reads —
    // never one per session, which is the N+1 that stays dead.
    mount(<TodayTab kids={KIDS} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Learner A/ })).toBeTruthy());
    act(() => { fireEvent.click(screen.getByRole('button', { name: /Learner A/ })); });
    expect(await screen.findByRole('link', { name: /Open the full day record/i })).toBeInTheDocument();
    expect(screen.getByText('Illinois')).toBeTruthy();
    // The course and unit ride the card's header band as one breadcrumb.
    expect(screen.getByText('United States Regions and States › Midwest')).toBeTruthy();
    expect(await screen.findByRole('link', { name: /Open the worksheet/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open the result receipt/i })).toBeInTheDocument();
    expect(teacherWorkspaceApi.session).not.toHaveBeenCalled();
    expect(schoolApi.agendaPreview).toHaveBeenCalledTimes(KIDS.length);
    expect(screen.queryByText(/Print selected worksheets/i)).toBeNull();
    expect(screen.queryByText(/No printable lessons/i)).toBeNull();
    expect(screen.queryByText(/^assessment$/i)).toBeNull();
  });

  it('shows the day as a grid: done work beside planned-but-unstarted lessons', async () => {
    mount(<TodayTab kids={KIDS} />);
    fireEvent.click(await screen.findByRole('button', { name: /Learner A/ }));
    const grid = await screen.findByTestId('lesson-grid');
    await waitFor(() => expect(within(grid).getAllByTestId('lesson-card').length).toBe(2));
    // Done: the recorded Illinois session claims its planned section (unit
    // match). It carries a SCORE, so it carries no "Done" chip — 5 checks, 2
    // crosses and 71% cannot be the state of unstarted work, and a chip
    // saying so is a label for something already said.
    expect(within(grid).getByTestId('score-marks')).toBeInTheDocument();
    expect(within(grid).queryByText('Done')).not.toBeInTheDocument();
    // Not yet started: the math offer with no session gets its own card.
    expect(within(grid).getByText('Not started')).toBeInTheDocument();
    expect(within(grid).getByText('Fractions Intro')).toBeInTheDocument();
  });

  it('an artifact icon IS the artifact — no interstitial, from digest data alone', async () => {
    // There is one destination behind each icon, so there is nothing for a
    // modal to disambiguate: the worksheet icon is the PDF link itself, and
    // the receipt icon opens the PNG. Neither costs a session fetch.
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    mount(<TodayTab kids={KIDS} />);
    fireEvent.click(await screen.findByRole('button', { name: /Learner A/ }));
    expect(await screen.findByRole('link', { name: /Open the worksheet/i }))
      .toHaveAttribute('href', '/issued/illinois.pdf');
    expect(screen.getByRole('link', { name: /Open the worksheet/i })).toHaveAttribute('target', '_blank');
    fireEvent.click(screen.getByRole('button', { name: /Open the result receipt/i }));
    expect(open).toHaveBeenCalledWith('/issued/illinois-receipt.png', '_blank', 'noopener');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(teacherWorkspaceApi.session).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('keeps a failed prior-day receipt visible beside the active retry', async () => {
    schoolApi.agendaPreview.mockResolvedValue(ok({ sections: [
      { subject: 'math', servedToday: false, next: { unitId: 'place-value', title: 'Place Value Retry', sessionId: 'ses_retry' } },
    ] }));
    schoolApi.teacherDay.mockResolvedValue(ok({ studyDay: '2026-08-31', learners: [{
      learnerId: 'learner-a', pendingReview: 0,
      sessions: [{ sessionId: 'ses_retry', unitId: 'place-value', lessonTitle: 'Place Value Retry',
        subject: 'math', state: 'issued', studyDay: '2026-08-31', artifacts: { worksheet: null, receipt: null },
        remediation: { ofSessionId: 'ses_original', activeSessionId: null, variant: 1 } }],
      processedToday: [{ sessionId: 'ses_original', unitId: 'place-value', lessonTitle: 'Place Value to 1,000',
        subject: 'math', state: 'remediation_opened', studyDay: '2026-08-30',
        effectiveScore: { correctCount: 1, totalCount: 6, percent: 16.67 },
        remediation: { ofSessionId: null, activeSessionId: 'ses_retry', variant: 0 },
        artifacts: { worksheet: null, receipt: { originalUrl: '/issued/failed-receipt.png', printed: true, printReason: 'unverified' } } }],
    }] }));
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    mount(<TodayTab kids={KIDS} />);
    fireEvent.click(await screen.findByRole('button', { name: /Learner A/ }));
    expect(await screen.findByRole('heading', { name: 'Marked today' })).toBeInTheDocument();
    expect(screen.getAllByTestId('lesson-card')).toHaveLength(2);
    expect(screen.getByRole('link', { name: /Open active retry/ })).toHaveAttribute('href', expect.stringContaining('ses_retry'));
    fireEvent.click(screen.getByRole('button', { name: /Open the result receipt/ }));
    expect(open).toHaveBeenCalledWith('/issued/failed-receipt.png', '_blank', 'noopener');
    expect(screen.getByText(/Sent to printer; printer confirmation unavailable/)).toBeInTheDocument();
    open.mockRestore();
  });

  it('the agenda is one tap from the roster card, outside the accordion', async () => {
    mount(<TodayTab kids={KIDS} />);
    const open = vi.spyOn(window, 'open').mockImplementation(() => ({}));
    const link = await screen.findByRole('link', { name: /Open Learner A's printed agenda/i });
    expect(link.getAttribute('href')).toContain('/learners/learner-a/agenda/preview');
    // Not behind the disclosure: it is there before anything is expanded.
    expect(screen.queryByTestId('lesson-grid')).not.toBeInTheDocument();
    // A window sized to the sheet, not a whole tab for a 580px column.
    fireEvent.click(link);
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining('/agenda/preview'),
      'agenda-learner-a',
      expect.stringContaining('width=620'),
    );
    open.mockRestore();
  });

  it('a failed agenda read degrades to recorded work, never a dead drill-in', async () => {
    schoolApi.agendaPreview.mockResolvedValue(fail(500));
    mount(<TodayTab kids={KIDS} />);
    fireEvent.click(await screen.findByRole('button', { name: /Learner A/ }));
    const grid = await screen.findByTestId('lesson-grid');
    expect(within(grid).getByText('Illinois')).toBeInTheDocument();
    expect(await screen.findByText(/Couldn’t load the day’s plan/)).toBeInTheDocument();
  });

  it('offers one route into the full day record instead of re-rendering it', async () => {
    mount(<TodayTab kids={KIDS} />);
    fireEvent.click(await screen.findByRole('button', { name: /Learner A/ }));
    expect(await screen.findByRole('link', { name: /Open the full day record/i }))
      .toHaveAttribute('href', expect.stringContaining('/day'));
    expect(screen.queryByText('Today’s paper and results')).not.toBeInTheDocument();
    expect(screen.queryByText('Processed today')).not.toBeInTheDocument();
  });

  it('points an idle learner at their plan rather than dead-ending', async () => {
    mount(<TodayTab kids={KIDS} />);
    expect(await screen.findByRole('link', { name: /See today’s plan/i })).toBeInTheDocument();
  });

  // `reviewStatus` is read ONLY from `submitted` onward. The digest defaults it
  // to 'complete' on sessions that were never worked, so asking any earlier
  // answers a different question than the card is posing — that default is what
  // made this label look permanently dead.
  it('says a session is awaiting review once it has been submitted', async () => {
    schoolApi.teacherDay.mockResolvedValue(ok([
      { learnerId: 'learner-a', effectiveScoreTotals: { correct: 0, total: 1 }, pendingReview: 1, sessions: [
        { sessionId: 'ses_2', lessonTitle: 'Photosynthesis', subject: 'science', state: 'submitted', reviewStatus: 'pending' },
      ] },
    ]));
    mount(<TodayTab kids={KIDS} />);
    fireEvent.click(await screen.findByRole('button', { name: /Learner A/ }));
    expect(await screen.findByText(/Awaiting review/)).toBeInTheDocument();
    expect(screen.queryByText(/Not graded/)).not.toBeInTheDocument();
  });

  // The arts card from the reported screenshot: DONE, and in the same breath
  // "No work offered", above an empty grey frame. Three contradictions on one
  // card, all from the join discarding what the served section still knew.
  it('names the work a program completed on its own, instead of saying none was offered', async () => {
    schoolApi.agendaPreview.mockResolvedValue(ok({ sections: [
      { subject: 'arts', servedToday: true, next: null,
        // The program's own status now names the lesson it credited, so the
        // card no longer has to wear the whole "Done today — …" sentence.
        servedWork: [{ unitId: 'piano-l35', title: 'Rhythm Improvisation with Chords' }],
        progressLabel: 'Done today — Rhythm Improvisation with Chords · 35/366',
        progressRows: [{ scope: 'module', label: 'Unit 2 · Chords & the Grand Staff' }] },
    ] }));
    schoolApi.teacherDay.mockResolvedValue(ok([
      { learnerId: 'learner-a', effectiveScoreTotals: { correct: 0, total: 0 }, pendingReview: 0, sessions: [] },
    ]));
    mount(<TodayTab kids={KIDS} />);
    fireEvent.click(await screen.findByRole('button', { name: /Learner A/ }));
    expect(await screen.findByText('Rhythm Improvisation with Chords')).toBeInTheDocument();
    expect(screen.queryByText('No work offered')).toBeNull();
    // The title is the lesson's name, not the sentence about it.
    expect(screen.queryByText(/Done today —/)).toBeNull();
    expect(screen.getByText(/Unit 2 · Chords & the Grand Staff/)).toBeInTheDocument();
    expect(screen.getByText('Completed in its own program')).toBeInTheDocument();
    // The reserved frame is not left blank: the subject's mark stands in.
    expect(document.querySelector('.teacher-lesson-card__poster-glyph')).toBeInTheDocument();
  });

  // The card's reading order is subject → lesson → locator. The breadcrumb
  // sat in the header band and out-weighed the title it was there to locate.
  it('keeps the breadcrumb out of the header band, under the lesson name', async () => {
    mount(<TodayTab kids={KIDS} />);
    fireEvent.click(await screen.findByRole('button', { name: /Learner A/ }));
    const crumb = await screen.findByText('United States Regions and States › Midwest');
    expect(crumb.closest('.teacher-lesson-card__header')).toBeNull();
    expect(crumb.closest('.teacher-lesson-card__copy')).not.toBeNull();
    // …and it sits after the title inside that column, not before it.
    const copy = crumb.closest('.teacher-lesson-card__copy');
    expect(copy.firstElementChild).toHaveClass('teacher-lesson-card__title');
  });

  it('names the curriculum work a served section credited', async () => {
    schoolApi.agendaPreview.mockResolvedValue(ok({ sections: [
      { subject: 'civilization', servedToday: true, next: null,
        servedWork: [{ unitId: 'atlas-p088', title: 'Ohio' }] },
    ] }));
    schoolApi.teacherDay.mockResolvedValue(ok([
      { learnerId: 'learner-a', effectiveScoreTotals: { correct: 0, total: 0 }, pendingReview: 0, sessions: [] },
    ]));
    mount(<TodayTab kids={KIDS} />);
    fireEvent.click(await screen.findByRole('button', { name: /Learner A/ }));
    expect(await screen.findByText('Ohio')).toBeInTheDocument();
    expect(screen.queryByText('No work offered')).toBeNull();
  });

  it('does not ask for a review of work that was never started', async () => {
    // The bug: a session minted at agenda-build time carries state 'created'
    // AND reviewStatus 'complete'. It used to render "DONE / Not graded".
    // Shapes copied from the live payload that produced the bug: the planner
    // still counts the subject as owed (`servedToday:false`) and its own
    // `next` names the very session that has not been touched.
    schoolApi.agendaPreview.mockResolvedValue(ok({ sections: [
      { subject: 'scripture', servedToday: false, obligation: { state: 'obligated' },
        next: { unitId: 'unit-psalms', title: 'Psalms 62–66', sessionId: 'ses_3', status: 'in_progress' } },
    ] }));
    schoolApi.teacherDay.mockResolvedValue(ok([
      { learnerId: 'learner-a', effectiveScoreTotals: { correct: 0, total: 0 }, pendingReview: 0, sessions: [
        { sessionId: 'ses_3', unitId: 'unit-psalms', lessonTitle: 'Psalms 62–66', subject: 'scripture',
          state: 'created', reviewStatus: 'complete', effectiveScore: null,
          artifacts: { worksheet: null, receipt: null } },
      ] },
    ]));
    mount(<TodayTab kids={KIDS} />);
    fireEvent.click(await screen.findByRole('button', { name: /Learner A/ }));
    expect(await screen.findByText('Psalms 62–66')).toBeInTheDocument();
    expect(screen.getByText('Not started')).toBeInTheDocument();
    expect(screen.queryByText(/Not graded/)).toBeNull();
    expect(screen.queryByText(/Awaiting review/)).toBeNull();
    expect(screen.queryByText('Done')).toBeNull();
    // …and its dot is not green.
    const dot = document.querySelector('.teacher-roster__dot');
    expect(dot.className).not.toMatch(/--passed/);
  });

  it('scores render as marks plus a percent, stating the count only once (as the marks’ label)', async () => {
    mount(<TodayTab kids={KIDS} />);
    fireEvent.click(await screen.findByRole('button', { name: /Learner A/ }));
    const marks = await screen.findByTestId('score-marks');
    // 5 green checks + 2 red crosses — the count lives in the marks and their
    // accessible name; percent appears once as text, never "5 of 7 · 71%".
    expect(marks.querySelectorAll('.teacher-mark--check').length).toBe(5);
    expect(marks.querySelectorAll('.teacher-mark--cross').length).toBe(2);
    expect(marks).toHaveAccessibleName('5 of 7 correct');
    expect(within(marks).getByText('71%')).toBeInTheDocument();
    expect(screen.queryByText(/5 of 7 correct/)).toBeNull();
  });

  it('one failing panel leaves its siblings rendered (queue)', async () => {
    schoolApi.printPending.mockResolvedValue(fail(500));
    mount(<QueueView kids={KIDS} />);
    await waitFor(() => expect(screen.getByText(/Explain photosynthesis/)).toBeTruthy());
    expect(screen.getAllByText(/couldn.t load/i).length).toBe(1);
  });

  it('all lifecycle panels unavailable -> exactly one banner, no per-panel noise', async () => {
    schoolApi.lifecycleReview.mockResolvedValue(fail(404));
    schoolApi.teacherDay.mockResolvedValue(ok([])); // empty beside a non-empty roster = unwired tell
    mount(<TodayTab kids={KIDS} />);
    await waitFor(() => expect(screen.getAllByText(/lifecycle is not enabled/i).length).toBe(1));
    expect(screen.queryByText(/couldn.t load/i)).toBe(null);
  });

  it('mixed availability -> no banner; the healthy panel still renders', async () => {
    schoolApi.lifecycleReview.mockResolvedValue(fail(404));
    mount(<TodayTab kids={KIDS} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Learner A/ })).toBeTruthy());
    expect(screen.queryByText(/lifecycle is not enabled/i)).toBe(null);
  });

  it('hides the backlog strip when there is no backlog', async () => {
    schoolApi.lifecycleReview.mockResolvedValue(ok({ items: [] }));
    schoolApi.printPending.mockResolvedValue(ok([]));
    schoolApi.quizRequests.mockResolvedValue(ok([]));
    schoolApi.teacherDay.mockResolvedValue(ok({ learners: [] }));
    mount(<TodayTab kids={KIDS} onOpenQueue={vi.fn()} />);
    // Gate on the three backlog reads having SETTLED — asserting absence on
    // the first paint would pass vacuously, before the strip could exist.
    await waitFor(() => expect(schoolApi.quizRequests).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId('backlog-strip')).not.toBeInTheDocument();
  });

  it('shows the backlog strip as soon as anything is waiting', async () => {
    schoolApi.lifecycleReview.mockResolvedValue(ok({ items: [{ id: 'r1' }] }));
    schoolApi.printPending.mockResolvedValue(ok([]));
    schoolApi.quizRequests.mockResolvedValue(ok([]));
    schoolApi.teacherDay.mockResolvedValue(ok({ learners: [] }));
    mount(<TodayTab kids={KIDS} onOpenQueue={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('backlog-strip')).toHaveTextContent('1 to review'));
  });

  it('pending prints and quiz requests render their rows (queue)', async () => {
    mount(<QueueView kids={KIDS} />);
    await waitFor(() => expect(screen.getByText(/US State Capitals/)).toBeTruthy());
    expect(screen.getByText(/Fractions Ep\. 4/)).toBeTruthy();
  });

  // Plan 3.4: the dashboard names a structurally broken day ONCE, above the
  // roster, instead of a teacher finding it lesson by lesson.
  describe('"N subjects need a grown-up" (plan 3.4)', () => {
    it('renders nothing when no subject needs a grown-up', async () => {
      // The default beforeEach fixture carries no `obligation` on either
      // section — the ordinary, healthy-day shape.
      mount(<TodayTab kids={KIDS} />);
      await waitFor(() => expect(screen.getByRole('button', { name: /Learner A/ })).toBeTruthy());
      await waitFor(() => expect(schoolApi.agendaPreview).toHaveBeenCalledTimes(KIDS.length));
      expect(screen.queryByTestId('grownup-strip')).not.toBeInTheDocument();
    });

    it('counts a fault and an actionable excuse across BOTH learners, and links to the first', async () => {
      schoolApi.agendaPreview.mockImplementation(async (learnerId) => ok({ sections: learnerId === 'learner-a'
        ? [
          { subject: 'civilization', next: { unitId: 'unit-illinois', title: 'Illinois' } },
          { subject: 'science', next: null, obligation: { state: 'faulted', reason: 'program_unavailable' } },
        ]
        : [{ subject: 'math', next: null, obligation: { state: 'excused', reason: 'caught_up' } }] }));
      mount(<TodayTab kids={KIDS} />);
      const strip = await screen.findByTestId('grownup-strip');
      expect(strip).toHaveTextContent('2 subjects need a grown-up');
      // learner-a's own fault is first in roster order, so the strip lands
      // on School Operations, not learner-b's Courses page.
      expect(strip).toHaveAttribute('href', '/school/teacher/operations');
    });

    // A DOWN PLANNER MUST NOT LOOK LIKE A QUIET MORNING.
    //
    // The "couldn't load the day's plan" notice lives in the day grid, which a
    // collapsed roster never mounts, and the roster card's own PanelFrame is
    // `ok` because the DIGEST read succeeded — the agenda is a separate
    // per-learner read. This strip is the only place on a collapsed dashboard
    // where a failed planner read can be seen at all.
    it('cautions instead of falling silent when no learner\u2019s plan could be read', async () => {
      schoolApi.agendaPreview.mockResolvedValue(fail(500));
      mount(<TodayTab kids={KIDS} />);
      const caution = await screen.findByTestId('grownup-strip-unknown');
      expect(caution).toHaveTextContent('We couldn\u2019t read the plan for 2 learners');
      // No tally: zero is not a fact here, and must not be printed as one.
      expect(screen.queryByTestId('grownup-strip')).not.toBeInTheDocument();
    });

    it('shows the tally AND the caution when one learner reads and another does not', async () => {
      schoolApi.agendaPreview.mockImplementation(async (learnerId) => (learnerId === 'learner-a'
        ? ok({ sections: [{ subject: 'science', next: null, obligation: { state: 'faulted', reason: 'program_unavailable' } }] })
        : fail(500)));
      mount(<TodayTab kids={KIDS} />);
      expect(await screen.findByTestId('grownup-strip')).toHaveTextContent('1 subject needs a grown-up');
      expect(await screen.findByTestId('grownup-strip-unknown'))
        .toHaveTextContent('We couldn\u2019t read the plan for 1 learner');
    });

    it('uses singular copy for exactly one subject', async () => {
      schoolApi.agendaPreview.mockImplementation(async (learnerId) => ok({ sections: learnerId === 'learner-a'
        ? [
          { subject: 'civilization', next: { unitId: 'unit-illinois', title: 'Illinois' } },
          { subject: 'math', next: null, obligation: { state: 'excused', reason: 'awaiting_grown_up' } },
        ]
        : [] }));
      mount(<TodayTab kids={KIDS} />);
      const strip = await screen.findByTestId('grownup-strip');
      expect(strip).toHaveTextContent('1 subject needs a grown-up');
    });
  });
});

describe('wave-2 mutations', () => {
  const claim = async () => {
    // Claim the teacher via the persisted-session path the provider restores.
    sessionStorage.setItem('school-teacher-claim', 'kckern');
  };

  const waitForClaim = () => waitFor(() => expect(screen.getByTestId('claimed-teacher').textContent).toBe('kckern'));

  it('resolving posts the claimed teacher stamp (null pin until entered) and refreshes server-side', async () => {
    await claim();
    mount(<QueueView kids={KIDS} />);
    await waitFor(() => expect(screen.getByText(/Explain photosynthesis/)).toBeTruthy());
    await waitForClaim();
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Correct' })); });
    await waitFor(() => expect(schoolApi.resolveReview).toHaveBeenCalledWith('ses_1', 'q3',
      { verdict: 'correct', note: null, gradedBy: 'kckern', pin: null }));
    await waitFor(() => expect(schoolApi.lifecycleReview.mock.calls.length).toBeGreaterThan(1));
  });

  it('a 403 opens the PIN prompt and marks only that item', async () => {
    await claim();
    // The REAL lifecycle 403 body (app-level object-shape handler): the error
    // field is an OBJECT — the UI must normalize it, never render it raw.
    schoolApi.resolveReview.mockResolvedValue({ ok: false, status: 403, data: {
      ok: false, error: { type: 'GuestForbiddenError', message: 'The teacher PIN is missing or wrong.' }, traceId: 'unknown',
    } });
    mount(<QueueView kids={KIDS} />);
    await waitFor(() => expect(screen.getByText(/Explain photosynthesis/)).toBeTruthy());
    await waitForClaim();
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Incorrect' })); });
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Teacher PIN' })).toBeTruthy());
    expect(screen.getByText('Unlock teacher tools')).toBeTruthy();
  });

  it('with no claimed teacher, a write opens the picker instead of posting', async () => {
    mount(<QueueView kids={KIDS} />);
    await waitFor(() => expect(screen.getByText(/Explain photosynthesis/)).toBeTruthy());
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Correct' })); });
    await waitFor(() => expect(screen.getByText("Who's teaching?")).toBeTruthy());
    expect(schoolApi.resolveReview).not.toHaveBeenCalled();
  });

  it('a note rides the resolve, trimmed', async () => {
    await claim();
    mount(<QueueView kids={KIDS} />);
    await waitFor(() => expect(screen.getByText(/Explain photosynthesis/)).toBeTruthy());
    await waitForClaim();
    act(() => {
      fireEvent.change(screen.getByLabelText('Note for q3'), { target: { value: '  Nice work!  ' } });
    });
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Correct' })); });
    await waitFor(() => expect(schoolApi.resolveReview).toHaveBeenCalledWith('ses_1', 'q3',
      expect.objectContaining({ note: 'Nice work!' })));
  });

  it('print approve/deny post the approver and refresh', async () => {
    await claim();
    mount(<QueueView kids={KIDS} />);
    await waitFor(() => expect(screen.getByText(/US State Capitals/)).toBeTruthy());
    await waitForClaim();
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Approve' })); });
    await waitFor(() => expect(schoolApi.printApprove).toHaveBeenCalledWith('pr_1',
      { approver: 'kckern', pin: null }));
    await waitFor(() => expect(schoolApi.printPending.mock.calls.length).toBeGreaterThan(1));
  });

  it('dismissing a quiz request demands a reason and sends it (advocacy A5)', async () => {
    await claim();
    schoolApi.quizRequests.mockResolvedValue(ok([
      { at: 't', userId: 'learner-b', unitId: 'plex:123', unitTitle: 'Fractions Ep. 4', materialTitle: 'Math Course', fulfilled: true },
    ]));
    mount(<QueueView kids={KIDS} />);
    await waitFor(() => expect(screen.getByText(/bank authored/)).toBeTruthy());
    await waitForClaim();
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Dismiss…' })); });
    // Reason empty -> the confirm stays disabled; the child is never told nothing.
    const confirm = screen.getByRole('button', { name: /Dismiss & tell them/ });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Dismissal reason'), {
      target: { value: 'We will do this one together' },
    });
    act(() => { fireEvent.click(screen.getByRole('button', { name: /Dismiss & tell them/ })); });
    await waitFor(() => expect(schoolApi.quizRequestDismiss).toHaveBeenCalledWith(
      { unitId: 'plex:123', bankId: null, kind: null, sessionId: null, userId: 'learner-b', dismissedBy: 'kckern', pin: null, reason: 'We will do this one together' }));
  });

  it('a kid-filed retake ask renders with its badge and want-another-try copy', async () => {
    await claim();
    schoolApi.quizRequests.mockResolvedValue(ok([
      { at: 't', kind: 'retake', userId: 'learner-b', bankId: 'science/creature-basics/01-quiz', title: 'Creature Basics Quiz' },
    ]));
    mount(<QueueView kids={KIDS} />);
    await waitFor(() => expect(screen.getByText('retake')).toBeTruthy());
    expect(screen.getByText('Creature Basics Quiz')).toBeTruthy();
    expect(screen.getByText(/wants another try — asked by Learner B/)).toBeTruthy();
  });
});

describe('advocacy wave 6A', () => {

  it('review items show rubric, reason, and wait-age', async () => {
    sessionStorage.setItem('school-teacher-claim', 'kckern');
    schoolApi.lifecycleReview.mockResolvedValue(ok({ items: [{
      sessionId: 'ses_1', itemId: 'q3', learnerId: 'learner-a', prompt: 'Explain photosynthesis',
      given: 'plants eat light', questionNumber: 3, reason: 'free_response',
      rubric: 'Full credit for light + chlorophyll + sugar', enqueuedAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
    }] }));
    mount(<QueueView kids={KIDS} />);
    await waitFor(() => expect(screen.getByText(/Marking guide: Full credit/)).toBeTruthy());
    expect(screen.getByText(/written answer needs a human mark/)).toBeTruthy();
    expect(screen.getByText(/waiting 3h/)).toBeTruthy();
  });

  it('an expired capability REPLAYS once after unlock without retaining the PIN', async () => {
    sessionStorage.setItem('school-teacher-claim', 'kckern');
    schoolApi.resolveReview
      .mockResolvedValueOnce({ ok: false, status: 403, data: { ok: false, error: { type: 'GuestForbiddenError', message: 'The teacher PIN is missing or wrong.' } } })
      .mockResolvedValue(ok({ verdict: 'correct' }));
    mount(<QueueView kids={KIDS} />);
    await waitFor(() => expect(screen.getByText(/Explain photosynthesis/)).toBeTruthy());
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Correct' })); });
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Teacher PIN' })).toBeTruthy());
    act(() => {
      fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '7410' } });
    });
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Continue' })); });
    await waitFor(() => expect(schoolApi.resolveReview).toHaveBeenCalledTimes(2));
    expect(teacherWorkspaceApi.unlock).toHaveBeenCalledWith('kckern', '7410');
    expect(schoolApi.resolveReview).toHaveBeenLastCalledWith('ses_1', 'q3',
      expect.objectContaining({ pin: null }));
  });
});
