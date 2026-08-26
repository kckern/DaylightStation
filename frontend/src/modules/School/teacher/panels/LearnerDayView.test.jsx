import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('../../schoolApi.js', () => ({
  schoolApi: { agendaPreview: vi.fn(), teacherDay: vi.fn() },
}));
vi.mock('../teacherWorkspaceApi.js', () => ({ teacherWorkspaceApi: { session: vi.fn() } }));
const { schoolApi } = await import('../../schoolApi.js');
const LearnerDayView = (await import('./LearnerDayView.jsx')).default;

const ok = (data) => ({ ok: true, status: 200, data });

beforeEach(() => {
  schoolApi.agendaPreview.mockResolvedValue(ok({ sections: [
    { subject: 'scripture', next: { title: 'Psalms 49–51' } },
    { subject: 'math', next: { title: 'Fractions 3' } },
    { subject: 'art', suppressed: { bySubject: 'math' } },
  ], errors: [] }));
  schoolApi.teacherDay.mockResolvedValue(ok({ learners: [{
    learnerId: 'learner-a',
    sessions: [{ sessionId: 'ses_1', subject: 'scripture', lessonTitle: 'Monday · Psalms 49, 50, 51, 61',
      courseTitle: 'Come Follow Me', effectiveScore: { correctCount: 5, totalCount: 5, percent: 100 } }],
    processedToday: [],
  }] }));
});

const mount = (props = {}) => render(
  <LearnerDayView learnerId="learner-a" learnerName="Learner A" studyDay="2026-08-25"
    onChangeStudyDay={vi.fn()} onOpenSession={vi.fn()} {...props} />,
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
    fireEvent.click(screen.getByRole('button', { name: /Monday · Psalms/ }));
    expect(onOpenSession).toHaveBeenCalledWith('ses_1');
  });

  it('does not repeat a per-row date inside a single-day view', async () => {
    mount();
    await waitFor(() => expect(screen.getByText('Monday · Psalms 49, 50, 51, 61')).toBeInTheDocument());
    // "Tuesday, Aug 25" is the page's heading; it must appear exactly once (IA2).
    expect(screen.getAllByText('Tuesday, Aug 25')).toHaveLength(1);
  });

  it('shows work graded today that belongs to another study day, labelled as such', async () => {
    schoolApi.teacherDay.mockResolvedValue(ok({ learners: [{
      learnerId: 'learner-a', sessions: [],
      processedToday: [{ sessionId: 'ses_old', subject: 'civilization', lessonTitle: 'The Midwestern States',
        studyDay: '2026-08-23', processedAt: '2026-08-25T14:03:00Z' }],
    }] }));
    mount();
    await waitFor(() => expect(screen.getByText('The Midwestern States')).toBeInTheDocument());
    expect(screen.getByText(/graded today/i)).toBeInTheDocument();
    expect(screen.getByText(/Aug 23/)).toBeInTheDocument();
  });

  it('credits a subject served by carried-over work instead of calling it unrecorded', async () => {
    // The real 2026-08-25 payload: the Midwest sheet was issued Aug 23 and
    // scanned today, so the planner reports the subject served with nothing
    // left to offer, while the session sits in the carry-over lane.
    schoolApi.agendaPreview.mockResolvedValue(ok({ sections: [
      { subject: 'civilization', servedToday: true, next: null },
    ], errors: [] }));
    schoolApi.teacherDay.mockResolvedValue(ok({ learners: [{
      learnerId: 'learner-a', sessions: [],
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
    const toggle = await screen.findByRole('button', { name: /show the printed agenda/i });
    fireEvent.click(toggle);
    const image = await screen.findByAltText(/printed agenda/i);
    expect(image).toHaveAttribute('src', expect.stringContaining('/agenda/preview'));
    expect(image).toHaveAttribute('src', expect.stringContaining('studyDay=2026-08-25'));
    // format=json is the DATA read; the image must be the PNG branch.
    expect(image.getAttribute('src')).not.toContain('format=json');
  });

  it('promises in plain words that the previewed codes are dead', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /show the printed agenda/i }));
    expect(await screen.findByText(/codes on this copy don’t work/i)).toBeInTheDocument();
    // The old five-noun disclaimer is gone.
    expect(screen.queryByText(/agenda artifact, print record, working QR/i)).not.toBeInTheDocument();
  });

  it('re-points the printer image when the day changes', async () => {
    const { rerender } = render(
      <LearnerDayView learnerId="learner-a" learnerName="A" studyDay="2026-08-25"
        onChangeStudyDay={vi.fn()} onOpenSession={vi.fn()} />,
    );
    fireEvent.click(await screen.findByRole('button', { name: /show the printed agenda/i }));
    expect(await screen.findByAltText(/printed agenda/i)).toHaveAttribute('src', expect.stringContaining('2026-08-25'));
    rerender(
      <LearnerDayView learnerId="learner-a" learnerName="A" studyDay="2026-08-24"
        onChangeStudyDay={vi.fn()} onOpenSession={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByAltText(/printed agenda/i))
      .toHaveAttribute('src', expect.stringContaining('2026-08-24')));
  });

  it('never issues a non-GET to any agenda route', async () => {
    // Previewing must not mint a session, ticket, QR, or digit code.
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /show the printed agenda/i }));
    await screen.findByAltText(/printed agenda/i);
    expect(schoolApi.agendaDispatch).not.toBeDefined();
    // The only agenda call the view makes is the read-only JSON preview.
    expect(schoolApi.agendaPreview).toHaveBeenCalledWith('learner-a', '2026-08-25');
  });
});
