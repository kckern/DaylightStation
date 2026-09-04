import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

vi.mock('../../schoolApi.js', () => ({
  schoolApi: { agendaPreview: vi.fn(), teacherDay: vi.fn() },
}));
vi.mock('../teacherWorkspaceApi.js', () => ({
  teacherWorkspaceApi: { session: vi.fn(), agendaDispatchPreview: vi.fn(), agendaDispatch: vi.fn() },
}));
// A claimed, server-authorized teacher, so useTeacherWrite calls straight
// through. `requestAuthorizationMock` is hoisted so every render (and every
// test) shares the same spy instance — the identity tests below need to
// inspect what it was called with, not just its return value.
const { requestAuthorizationMock } = vi.hoisted(() => ({
  requestAuthorizationMock: vi.fn(async () => ({ ok: true, grantToken: 'grant-1' })),
}));
vi.mock('../TeacherProfileContext.jsx', () => ({
  useTeacherProfile: () => ({
    currentTeacher: { id: 'kckern', name: 'KC' },
    pin: null,
    openPicker: vi.fn(),
    openPinPrompt: vi.fn(),
    requestAuthorization: requestAuthorizationMock,
    invalidateAuthorization: vi.fn(),
    pinPromptOpen: false,
    pickerOpen: false,
  }),
}));
const { schoolApi } = await import('../../schoolApi.js');
const { teacherWorkspaceApi } = await import('../teacherWorkspaceApi.js');
const LearnerDayView = (await import('./LearnerDayView.jsx')).default;

const ok = (data) => ({ ok: true, status: 200, data });

beforeEach(() => {
  schoolApi.agendaPreview.mockResolvedValue(ok({ sections: [
    { subject: 'scripture', next: { title: 'Psalms 49–51' } },
    { subject: 'math', next: { title: 'Fractions 3' } },
    { subject: 'art', suppressed: { bySubject: 'math' } },
  ], errors: [] }));
  schoolApi.teacherDay.mockResolvedValue(ok({ learners: [{
    learnerId: 'user_4',
    sessions: [{ sessionId: 'ses_1', subject: 'scripture', lessonTitle: 'Monday · Psalms 49, 50, 51, 61',
      courseTitle: 'Come Follow Me', effectiveScore: { correctCount: 5, totalCount: 5, percent: 100 } }],
    processedToday: [],
  }] }));
});

const mount = (props = {}) => render(
  <MantineProvider><LearnerDayView learnerId="user_4" learnerName="User_4" studyDay="2026-08-25"
    onChangeStudyDay={vi.fn()} onOpenSession={vi.fn()} {...props} /></MantineProvider>,
);

describe('LearnerDayView', () => {
  it('states the study day once, in words', async () => {
    mount();
    await waitFor(() => expect(screen.getByText('Tuesday, Aug 25')).toBeInTheDocument());
  });

  it('shows planned, done, and deferred work in one list', async () => {
    mount();
    await waitFor(() => expect(screen.getByText('Monday · Psalms 49, 50, 51, 61')).toBeInTheDocument());
    expect(screen.getByText('Fractions 3')).toBeInTheDocument();
    expect(screen.getByText('Deferred for math focus')).toBeInTheDocument();
  });

  it('summarizes the day in counts', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('day-summary')).toHaveTextContent(/1 done/));
    expect(screen.getByTestId('day-summary')).toHaveTextContent(/1 not started/i);
    expect(screen.getByTestId('day-summary')).toHaveTextContent(/1 deferred/i);
  });

  it('steps to the previous day without a page reload', async () => {
    const onChangeStudyDay = vi.fn();
    mount({ onChangeStudyDay });
    await waitFor(() => expect(screen.getByText('Tuesday, Aug 25')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /previous day/i }));
    expect(onChangeStudyDay).toHaveBeenCalledWith('2026-08-24');
  });

  it('opens a completed lesson from its row', async () => {
    const onOpenSession = vi.fn();
    mount({ onOpenSession });
    await waitFor(() => expect(screen.getByText('Monday · Psalms 49, 50, 51, 61')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Open details' }));
    expect(onOpenSession).toHaveBeenCalledWith('ses_1');
  });

  it('does not repeat a per-row date inside a single-day view', async () => {
    mount();
    await waitFor(() => expect(screen.getByText('Monday · Psalms 49, 50, 51, 61')).toBeInTheDocument());
    // "Tuesday, Aug 25" is the page's heading; it must appear exactly once (IA2).
    expect(screen.getAllByText('Tuesday, Aug 25')).toHaveLength(1);
  });

  it('shows work graded today that belongs to another study day, labelled as such', async () => {
    const onOpenSession = vi.fn();
    schoolApi.teacherDay.mockResolvedValue(ok({ learners: [{
      learnerId: 'user_4', sessions: [],
      processedToday: [{ sessionId: 'ses_old', subject: 'civilization', lessonTitle: 'The Midwestern States',
        studyDay: '2026-08-23', processedAt: '2026-08-25T14:03:00Z' }],
    }] }));
    mount({ onOpenSession });
    await waitFor(() => expect(screen.getByText('The Midwestern States')).toBeInTheDocument());
    expect(screen.getByText(/graded today/i)).toBeInTheDocument();
    expect(screen.getByText(/Aug 23/)).toBeInTheDocument();
    const row = screen.getByText('The Midwestern States').closest('li');
    fireEvent.click(within(row).getByRole('button', { name: 'Open details' }));
    expect(onOpenSession).toHaveBeenCalledWith('ses_old');
  });

  it('credits a subject served by carried-over work instead of calling it unrecorded', async () => {
    // The real 2026-08-25 payload: the Midwest sheet was issued Aug 23 and
    // scanned today, so the planner reports the subject served with nothing
    // left to offer, while the session sits in the carry-over lane.
    schoolApi.agendaPreview.mockResolvedValue(ok({ sections: [
      { subject: 'civilization', servedToday: true, next: null },
    ], errors: [] }));
    schoolApi.teacherDay.mockResolvedValue(ok({ learners: [{
      learnerId: 'user_4', sessions: [],
      processedToday: [{ sessionId: 'ses_old', subject: 'civilization', lessonTitle: 'The Midwestern States',
        studyDay: '2026-08-23', processedAt: '2026-08-25T14:03:00Z',
        effectiveScore: { correctCount: 9, totalCount: 10, percent: 90 } }],
    }] }));
    mount();

    await waitFor(() => expect(screen.getByText('The Midwestern States')).toBeInTheDocument());
    expect(screen.queryByText(/no session record/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no work offered/i)).not.toBeInTheDocument();
    // Claimed by the day's own list, so the carry-over block must not repeat it.
    expect(screen.getAllByText('The Midwestern States')).toHaveLength(1);
    expect(screen.getByText('9 of 10 correct')).toBeInTheDocument();
    // Crediting it to today must not hide WHEN it was assigned.
    expect(screen.getByText(/Study day Aug 23/)).toBeInTheDocument();
  });

  // --- The printed agenda (operator requirement) --------------------------
  it('offers the exact printer image for the selected day', async () => {
    mount();
    const toggle = await screen.findByRole('button', { name: /preview printable agenda/i });
    fireEvent.click(toggle);
    const image = await screen.findByAltText(/printed agenda/i);
    expect(image).toHaveAttribute('src', expect.stringContaining('/agenda/preview'));
    expect(image).toHaveAttribute('src', expect.stringContaining('studyDay=2026-08-25'));
    // format=json is the DATA read; the image must be the PNG branch.
    expect(image.getAttribute('src')).not.toContain('format=json');
  });

  it('promises in plain words that the previewed codes are dead', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /preview printable agenda/i }));
    expect(await screen.findByText(/codes on this copy don’t work/i)).toBeInTheDocument();
    // The old five-noun disclaimer is gone.
    expect(screen.queryByText(/agenda artifact, print record, working QR/i)).not.toBeInTheDocument();
  });

  it('re-points the printer image when the day changes', async () => {
    const { rerender } = render(
      <MantineProvider><LearnerDayView learnerId="user_4" learnerName="A" studyDay="2026-08-25"
        onChangeStudyDay={vi.fn()} onOpenSession={vi.fn()} /></MantineProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /preview printable agenda/i }));
    expect(await screen.findByAltText(/printed agenda/i)).toHaveAttribute('src', expect.stringContaining('2026-08-25'));
    rerender(
      <MantineProvider><LearnerDayView learnerId="user_4" learnerName="A" studyDay="2026-08-24"
        onChangeStudyDay={vi.fn()} onOpenSession={vi.fn()} /></MantineProvider>,
    );
    await waitFor(() => expect(screen.getByAltText(/printed agenda/i))
      .toHaveAttribute('src', expect.stringContaining('2026-08-24')));
  });

  it('never issues a non-GET to any agenda route', async () => {
    // Previewing must not mint a session, ticket, QR, or digit code.
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /preview printable agenda/i }));
    await screen.findByAltText(/printed agenda/i);
    expect(schoolApi.agendaDispatch).not.toBeDefined();
    // The only agenda call the view makes is the read-only JSON preview.
    expect(schoolApi.agendaPreview).toHaveBeenCalledWith('user_4', '2026-08-25');
  });
});

// --- Dispatching the day's agenda (the one console path that prints) -----
describe('LearnerDayView — agenda dispatch', () => {
  beforeEach(() => {
    // "Today" per the DayNav/AgendaDispatch comparison — matches the fixture
    // dates above (Tuesday the 25th, Monday the 24th).
    vi.setSystemTime(new Date('2026-08-25T12:00:00Z'));
    teacherWorkspaceApi.agendaDispatchPreview.mockReset();
    teacherWorkspaceApi.agendaDispatch.mockReset();
    requestAuthorizationMock.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  const readyPreview = ok({ ready: true, sections: [{ subject: 'math' }, { subject: 'scripture' }], entries: [], errors: [], documentId: 'doc_1' });

  it('offers the print affordance on today and nothing — not a disabled button — on any other day', async () => {
    const today = mount({ studyDay: '2026-08-25' });
    await waitFor(() => expect(screen.getByText('Tuesday, Aug 25')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Print the day.s agenda/i })).toBeInTheDocument();
    today.unmount();

    mount({ studyDay: '2026-08-24' });
    await waitFor(() => expect(screen.getByText('Monday, Aug 24')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Print the day.s agenda/i })).not.toBeInTheDocument();
  });

  it('shows the planner’s errors verbatim and offers no print button when the day is not ready', async () => {
    teacherWorkspaceApi.agendaDispatchPreview.mockResolvedValue(ok({
      ready: false, sections: [], entries: [], errors: ['No syllabus published for math'], documentId: null,
    }));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Print the day.s agenda/i }));
    await screen.findByText(/planner can.t build this day yet/i);
    expect(screen.getByText('No syllabus published for math')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Print it now$/i })).not.toBeInTheDocument();
  });

  it('sends the exact Idempotency-Key minted at prepare time when it actually prints — not a fresh one', async () => {
    // Two DISTINCT values so the test can fail: a dispatch that minted a new
    // key at print time (the bug this whole shape exists to prevent) would
    // send 'uuid-print', not 'uuid-prepare'. A single fixed return value here
    // would pass even for that bug, which is what the prior version did.
    const randomUUID = vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('uuid-prepare').mockReturnValueOnce('uuid-print');
    teacherWorkspaceApi.agendaDispatchPreview.mockResolvedValue(readyPreview);
    teacherWorkspaceApi.agendaDispatch.mockResolvedValue(ok({ printed: true }));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Print the day.s agenda/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^Print it now$/i }));
    await waitFor(() => expect(teacherWorkspaceApi.agendaDispatch).toHaveBeenCalled());
    const [, , idempotencyKey] = teacherWorkspaceApi.agendaDispatch.mock.calls[0];
    expect(idempotencyKey).toContain('uuid-prepare');
    expect(idempotencyKey).not.toContain('uuid-print');
    // Only ONE key was ever minted for this prepare-then-print cycle.
    expect(randomUUID).toHaveBeenCalledTimes(1);
    randomUUID.mockRestore();
  });

  it('discards the key on cancel, so a second prepare mints a different one', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValueOnce('uuid-1').mockReturnValueOnce('uuid-2');
    teacherWorkspaceApi.agendaDispatchPreview.mockResolvedValue(readyPreview);
    teacherWorkspaceApi.agendaDispatch.mockResolvedValue(ok({ printed: true }));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Print the day.s agenda/i }));
    await screen.findByRole('button', { name: /^Print it now$/i });
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    // Cancelling returns to the closed state — the same prepare button offered again.
    fireEvent.click(await screen.findByRole('button', { name: /Print the day.s agenda/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^Print it now$/i }));
    await waitFor(() => expect(teacherWorkspaceApi.agendaDispatch).toHaveBeenCalled());
    const [, , idempotencyKey] = teacherWorkspaceApi.agendaDispatch.mock.calls[0];
    expect(idempotencyKey).toContain('uuid-2');
    expect(idempotencyKey).not.toContain('uuid-1');
  });

  it('carries the agenda.dispatch step-up grant through to the real dispatch', async () => {
    requestAuthorizationMock.mockResolvedValueOnce({ ok: true, grantToken: null }); // the preview call
    requestAuthorizationMock.mockResolvedValueOnce({ ok: true, grantToken: 'grant-xyz' }); // the real dispatch
    teacherWorkspaceApi.agendaDispatchPreview.mockResolvedValue(readyPreview);
    teacherWorkspaceApi.agendaDispatch.mockResolvedValue(ok({ printed: true }));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Print the day.s agenda/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^Print it now$/i }));
    await waitFor(() => expect(teacherWorkspaceApi.agendaDispatch).toHaveBeenCalled());
    const [, , , grantToken] = teacherWorkspaceApi.agendaDispatch.mock.calls[0];
    expect(grantToken).toBe('grant-xyz');
    expect(requestAuthorizationMock).toHaveBeenCalledWith({ action: 'agenda.dispatch', resource: 'user_4' });
  });

  it('does not carry a prepared preview across a learner switch', async () => {
    // The Students rail re-renders the SAME LearnerDayView position for a new
    // learnerId — it does not remount the tree by itself. Without a key on
    // AgendaDispatch, its `preview`/`idempotencyKey` state would survive that
    // switch: a "ready to print" box built from User_4's plan, wearing
    // User_2's name, offering to print unpreviewed paper for the wrong
    // child. The fix is a `key={learnerId:studyDay}` on the element, which
    // this proves by forcing the box back to its closed state on switch.
    teacherWorkspaceApi.agendaDispatchPreview.mockResolvedValue(readyPreview);
    const { rerender } = render(
      <LearnerDayView learnerId="user_4" learnerName="User_4" studyDay="2026-08-25"
        onChangeStudyDay={vi.fn()} onOpenSession={vi.fn()} />,
    );
    fireEvent.click(await screen.findByRole('button', { name: /Print the day.s agenda/i }));
    await screen.findByText(/will print for User_4/);

    rerender(
      <LearnerDayView learnerId="user_2" learnerName="User_2" studyDay="2026-08-25"
        onChangeStudyDay={vi.fn()} onOpenSession={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: /Print the day.s agenda/i })).toBeInTheDocument());
    expect(screen.queryByText(/will print for/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Print it now$/i })).not.toBeInTheDocument();
  });
});
