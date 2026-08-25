import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
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
    lifecycleReview: vi.fn(),
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
const { teacherWorkspaceApi } = await import('../teacherWorkspaceApi.js');

const KIDS = [{ id: 'felix', name: 'Felix' }, { id: 'milo', name: 'Milo' }];
const ok = (data) => ({ ok: true, status: 200, data });
const fail = (status) => ({ ok: false, status, data: null });

// The shell owns the PinPrompt and the picker; the harness mirrors that
// composition so tab-level mutation flows exercise the real affordances.
function ShellProbe() {
  const { pickerOpen, currentTeacher } = useTeacherProfile();
  return <><span data-testid="claimed-teacher" hidden>{currentTeacher?.id ?? 'none'}</span>{pickerOpen ? <div>Who's teaching?</div> : null}</>;
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
    { learnerId: 'felix', effectiveScoreTotals: { correct: 5, total: 7 }, sessions: [{ sessionId: 'ses_1', lessonTitle: 'Illinois', subject: 'civilization', courseTitle: 'United States Regions and States', moduleTitle: 'Midwest', posterUrl: '/course-poster.jpg', studyDay: '2026-08-24', effectiveScore: { correctCount: 5, totalCount: 7, percent: 71 }, state: 'graded' }], pendingReview: 2 },
    { learnerId: 'milo', attemptsToday: 0, correctToday: 0, sessionsToday: [], pendingReview: 0 },
  ]));
  schoolApi.lifecycleReview.mockResolvedValue(ok({ items: [
    { sessionId: 'ses_1', itemId: 'q3', learnerId: 'felix', prompt: 'Explain photosynthesis', given: 'plants eat light', questionNumber: 3 },
  ] }));
  teacherWorkspaceApi.session.mockResolvedValue(ok({
    sessionId: 'ses_1', taxonomy: { subject: 'civilization', courseTitle: 'United States Regions and States', moduleTitle: 'Midwest', lessonTitle: 'Illinois', posterUrl: '/course-poster.jpg' },
    artifacts: [
      { artifactId: 'worksheet-1', kind: 'assignment', availability: 'exact', originalPdfUrl: '/issued/illinois.pdf' },
      { artifactId: 'receipt-1', kind: 'result-receipt', availability: 'exact', originalUrl: '/issued/illinois-receipt.png' },
    ],
  }));
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

  it('drill-in fetches the canonical session and exposes its issued files', async () => {
    mount(<TodayTab kids={KIDS} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Felix/ })).toBeTruthy());
    act(() => { fireEvent.click(screen.getByRole('button', { name: /Felix/ })); });
    await waitFor(() => expect(teacherWorkspaceApi.session).toHaveBeenCalledWith('ses_1'));
    expect(screen.getByText('Illinois')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open worksheet' }).getAttribute('href')).toBe('/issued/illinois.pdf');
    expect(screen.getByRole('link', { name: 'Download PDF' }).getAttribute('download')).toBe('');
    expect(screen.getByRole('link', { name: 'Open receipt' }).getAttribute('href')).toBe('/issued/illinois-receipt.png');
    expect(screen.queryByText(/Print selected worksheets/i)).toBeNull();
    expect(screen.queryByText(/No printable lessons/i)).toBeNull();
    expect(screen.queryByText(/^assessment$/i)).toBeNull();
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
    await waitFor(() => expect(screen.getByRole('button', { name: /Felix/ })).toBeTruthy());
    expect(screen.queryByText(/lifecycle is not enabled/i)).toBe(null);
  });

  it('pending prints and quiz requests render their rows (queue)', async () => {
    mount(<QueueView kids={KIDS} />);
    await waitFor(() => expect(screen.getByText(/US State Capitals/)).toBeTruthy());
    expect(screen.getByText(/Fractions Ep\. 4/)).toBeTruthy();
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
      { at: 't', userId: 'milo', unitId: 'plex:123', unitTitle: 'Fractions Ep. 4', materialTitle: 'Math Course', fulfilled: true },
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
      { unitId: 'plex:123', bankId: null, kind: null, sessionId: null, userId: 'milo', dismissedBy: 'kckern', pin: null, reason: 'We will do this one together' }));
  });

  it('a kid-filed retake ask renders with its badge and want-another-try copy', async () => {
    await claim();
    schoolApi.quizRequests.mockResolvedValue(ok([
      { at: 't', kind: 'retake', userId: 'milo', bankId: 'science/creature-basics/01-quiz', title: 'Creature Basics Quiz' },
    ]));
    mount(<QueueView kids={KIDS} />);
    await waitFor(() => expect(screen.getByText('retake')).toBeTruthy());
    expect(screen.getByText('Creature Basics Quiz')).toBeTruthy();
    expect(screen.getByText(/wants another try — asked by Milo/)).toBeTruthy();
  });
});

describe('advocacy wave 6A', () => {

  it('review items show rubric, reason, and wait-age', async () => {
    sessionStorage.setItem('school-teacher-claim', 'kckern');
    schoolApi.lifecycleReview.mockResolvedValue(ok({ items: [{
      sessionId: 'ses_1', itemId: 'q3', learnerId: 'felix', prompt: 'Explain photosynthesis',
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
