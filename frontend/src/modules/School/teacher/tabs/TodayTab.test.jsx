import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import TodayTab from './TodayTab.jsx';
import { TeacherProfileProvider, useTeacherProfile } from '../TeacherProfileContext.jsx';
import PinPrompt from '../panels/PinPrompt.jsx';

vi.mock('../../schoolApi.js', () => ({
  schoolApi: {
    teacherToday: vi.fn(),
    lifecycleReview: vi.fn(),
    learnerSessions: vi.fn(),
    progress: vi.fn(),
    printPending: vi.fn(),
    quizRequests: vi.fn(),
    teachers: vi.fn(),
    resolveReview: vi.fn(),
    printApprove: vi.fn(),
    printDeny: vi.fn(),
    quizRequestDismiss: vi.fn(),
  },
}));
const { schoolApi } = await import('../../schoolApi.js');

const KIDS = [{ id: 'felix', name: 'Felix' }, { id: 'milo', name: 'Milo' }];
const ok = (data) => ({ ok: true, status: 200, data });
const fail = (status) => ({ ok: false, status, data: null });

// The shell owns the PinPrompt and the picker; the harness mirrors that
// composition so tab-level mutation flows exercise the real affordances.
function ShellProbe() {
  const { pickerOpen } = useTeacherProfile();
  return pickerOpen ? <div>Who's teaching?</div> : null;
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
  schoolApi.teacherToday.mockResolvedValue(ok([
    { learnerId: 'felix', attemptsToday: 7, correctToday: 5, sessionsToday: [{ unitId: 'math.01', state: 'graded' }], pendingReview: 2 },
    { learnerId: 'milo', attemptsToday: 0, correctToday: 0, sessionsToday: [], pendingReview: 0 },
  ]));
  schoolApi.lifecycleReview.mockResolvedValue(ok({ items: [
    { sessionId: 'ses_1', itemId: 'q3', learnerId: 'felix', prompt: 'Explain photosynthesis', given: 'plants eat light', questionNumber: 3 },
  ] }));
  schoolApi.learnerSessions.mockResolvedValue(ok({ sessions: [{ sessionId: 'ses_1', state: 'graded', unitId: 'math.01' }] }));
  schoolApi.progress.mockResolvedValue(ok({ recentScores: [] }));
  schoolApi.printPending.mockResolvedValue(ok([
    { id: 'pr_1', userId: 'felix', printableId: 'state-capitals', label: 'US State Capitals', pages: 6, copies: 1 },
  ]));
  schoolApi.quizRequests.mockResolvedValue(ok([
    { at: '2026-08-06T10:00:00Z', userId: 'milo', unitId: 'plex:123', unitTitle: 'Fractions Ep. 4', materialTitle: 'Math Course' },
  ]));
});

describe('TodayTab', () => {
  it('joins digest rows with roster names and shows the day numbers', async () => {
    mount(<TodayTab kids={KIDS} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Felix/ })).toBeTruthy());
    expect(screen.getByRole('button', { name: /Milo/ })).toBeTruthy();
    expect(screen.getByText(/5\s*\/\s*7/)).toBeTruthy(); // correct/attempts
  });

  it('drill-in fetches the learner sessions with the study-day window', async () => {
    mount(<TodayTab kids={KIDS} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Felix/ })).toBeTruthy());
    act(() => { fireEvent.click(screen.getByRole('button', { name: /Felix/ })); });
    await waitFor(() => expect(schoolApi.learnerSessions).toHaveBeenCalledWith('felix', { window: 'today' }));
  });

  it('one failing panel leaves its siblings rendered', async () => {
    schoolApi.printPending.mockResolvedValue(fail(500));
    mount(<TodayTab kids={KIDS} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Felix/ })).toBeTruthy());
    expect(screen.getByText(/Explain photosynthesis/)).toBeTruthy();
    expect(screen.getAllByText(/couldn.t load/i).length).toBe(1);
  });

  it('all lifecycle panels unavailable -> exactly one banner, no per-panel noise', async () => {
    schoolApi.lifecycleReview.mockResolvedValue(fail(404));
    schoolApi.teacherToday.mockResolvedValue(ok([])); // empty beside a non-empty roster = unwired tell
    mount(<TodayTab kids={KIDS} />);
    await waitFor(() => expect(screen.getAllByText(/lifecycle is not enabled/i).length).toBe(1));
    expect(screen.queryByText(/couldn.t load/i)).toBe(null);
  });

  it('mixed availability -> no banner; the healthy panel still renders', async () => {
    schoolApi.lifecycleReview.mockResolvedValue(fail(404));
    mount(<TodayTab kids={KIDS} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Felix/ })).toBeTruthy());
    expect(screen.queryByText(/lifecycle is not enabled/i)).toBe(null);
  });

  it('pending prints and quiz requests render their rows', async () => {
    mount(<TodayTab kids={KIDS} />);
    await waitFor(() => expect(screen.getByText(/US State Capitals/)).toBeTruthy());
    expect(screen.getByText(/Fractions Ep\. 4/)).toBeTruthy();
  });
});

describe('wave-2 mutations', () => {
  const claim = async () => {
    // Claim the teacher via the persisted-session path the provider restores.
    sessionStorage.setItem('school-teacher-claim', 'kckern');
  };

  it('resolving posts the claimed teacher stamp (null pin until entered) and refreshes server-side', async () => {
    await claim();
    mount(<TodayTab kids={KIDS} />);
    await waitFor(() => expect(screen.getByText(/Explain photosynthesis/)).toBeTruthy());
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
    mount(<TodayTab kids={KIDS} />);
    await waitFor(() => expect(screen.getByText(/Explain photosynthesis/)).toBeTruthy());
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Incorrect' })); });
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Teacher PIN' })).toBeTruthy());
    expect(screen.getByText(/PIN is missing or wrong/)).toBeTruthy();
  });

  it('with no claimed teacher, a write opens the picker instead of posting', async () => {
    mount(<TodayTab kids={KIDS} />);
    await waitFor(() => expect(screen.getByText(/Explain photosynthesis/)).toBeTruthy());
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Correct' })); });
    await waitFor(() => expect(screen.getByText("Who's teaching?")).toBeTruthy());
    expect(schoolApi.resolveReview).not.toHaveBeenCalled();
  });

  it('a note rides the resolve, trimmed', async () => {
    await claim();
    mount(<TodayTab kids={KIDS} />);
    await waitFor(() => expect(screen.getByText(/Explain photosynthesis/)).toBeTruthy());
    act(() => {
      fireEvent.change(screen.getByLabelText('Note for q3'), { target: { value: '  Nice work!  ' } });
    });
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Correct' })); });
    await waitFor(() => expect(schoolApi.resolveReview).toHaveBeenCalledWith('ses_1', 'q3',
      expect.objectContaining({ note: 'Nice work!' })));
  });

  it('print approve/deny post the approver and refresh', async () => {
    await claim();
    mount(<TodayTab kids={KIDS} />);
    await waitFor(() => expect(screen.getByText(/US State Capitals/)).toBeTruthy());
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Approve' })); });
    await waitFor(() => expect(schoolApi.printApprove).toHaveBeenCalledWith('pr_1',
      { approver: 'kckern', pin: null }));
    await waitFor(() => expect(schoolApi.printPending.mock.calls.length).toBeGreaterThan(1));
  });

  it('a quiz request can be dismissed; fulfilled requests carry the badge', async () => {
    await claim();
    schoolApi.quizRequests.mockResolvedValue(ok([
      { at: 't', userId: 'milo', unitId: 'plex:123', unitTitle: 'Fractions Ep. 4', materialTitle: 'Math Course', fulfilled: true },
    ]));
    mount(<TodayTab kids={KIDS} />);
    await waitFor(() => expect(screen.getByText(/bank authored/)).toBeTruthy());
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Dismiss' })); });
    await waitFor(() => expect(schoolApi.quizRequestDismiss).toHaveBeenCalledWith(
      { unitId: 'plex:123', userId: 'milo', dismissedBy: 'kckern', pin: null }));
  });
});
