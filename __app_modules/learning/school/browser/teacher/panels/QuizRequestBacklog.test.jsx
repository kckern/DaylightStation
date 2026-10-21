import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import QuizRequestBacklog from "./QuizRequestBacklog.jsx";
import { TeacherProfileProvider, useTeacherProfile } from "../TeacherProfileContext.jsx";
import PinPrompt from "./PinPrompt.jsx";

vi.mock("../teacherWorkspaceApi.js", () => ({ teacherWorkspaceApi: {
  authStatus: vi.fn(async () => {
    const userId = sessionStorage.getItem('school-teacher-claim');
    return { ok: true, status: 200, data: userId ? { active: true, userId } : { active: false } };
  }),
  unlock: vi.fn(async (userId) => ({ ok: true, status: 200, data: { active: true, userId } })),
  lock: vi.fn(async () => ({ ok: true, status: 200, data: { locked: true } })),
  stepUp: vi.fn(async () => ({ ok: true, status: 200, data: { grantToken: 'grant' } })),
} }));

vi.mock("../../schoolApi.js", () => ({
  schoolApi: {
    teachers: vi.fn(),
    quizRequests: vi.fn(),
    learnerSessions: vi.fn(),
    offerRetake: vi.fn(),
    quizRequestDismiss: vi.fn(),
  },
}));
const { schoolApi } = await import("../../schoolApi.js");

const KIDS = [{ id: 'user_4', name: 'User_4' }];
const ok = (data, status = 200) => ({ ok: true, status, data });

function ShellProbe() {
  const { currentTeacher } = useTeacherProfile();
  return <span data-testid="claimed-teacher" hidden>{currentTeacher?.id ?? 'none'}</span>;
}
const mount = (ui) => render(<TeacherProfileProvider>{ui}<PinPrompt /><ShellProbe /></TeacherProfileProvider>);
const waitForClaim = () => waitFor(() => expect(screen.getByTestId('claimed-teacher').textContent).toBe('kckern'));

// Rows as `GET /lifecycle/learners/:id/sessions` serves them
// (YamlWorkSessionDatastore.listForLearner): no `remediation` field — an
// attempt already given another try reads `state: 'remediation_opened'`.
const failed = (sessionId, updatedAt, extra = {}) => ({
  sessionId, learnerId: 'user_4', unitId: 'unit-a', state: 'outcome_recorded', terminal: false,
  outcome: { result: 'needs_remediation', at: updatedAt }, updatedAt, remediationOf: null, ...extra,
});

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  sessionStorage.setItem('school-teacher-claim', 'kckern');
  schoolApi.teachers.mockResolvedValue(ok({ configured: true, teachers: [{ id: 'kckern', name: 'KC' }] }));
  schoolApi.quizRequests.mockResolvedValue(ok([{ kind: 'retake', userId: 'user_4', unitId: 'unit-a', title: 'Fractions' }]));
  schoolApi.offerRetake.mockResolvedValue(ok({ status: 'opened', newSessionId: 's9' }, 201));
  schoolApi.quizRequestDismiss.mockResolvedValue(ok({ dismissed: true }));
});

describe('QuizRequestBacklog — granting a retake from the queue', () => {
  it('opens another try on the latest failed attempt, then tells the child yes', async () => {
    schoolApi.learnerSessions.mockResolvedValue(ok({ sessions: [
      failed('s0', '2026-10-18T10:00:00Z'),
      failed('s1', '2026-10-20T10:00:00Z'),
      failed('s2', '2026-10-21T10:00:00Z', { unitId: 'unit-b' }),
      { sessionId: 's3', unitId: 'unit-a', state: 'outcome_recorded', outcome: { result: 'passed' }, updatedAt: '2026-10-21T11:00:00Z' },
    ] }));
    const onChanged = vi.fn();
    mount(<QuizRequestBacklog kids={KIDS} onChanged={onChanged} />);
    await screen.findByText('Fractions');
    await waitForClaim();
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Offer another try' })); });
    await waitFor(() => expect(schoolApi.quizRequestDismiss).toHaveBeenCalled());
    expect(schoolApi.learnerSessions).toHaveBeenCalledWith('user_4');
    expect(schoolApi.offerRetake).toHaveBeenCalledWith('s1', expect.objectContaining({ openedBy: 'kckern' }));
    expect(schoolApi.quizRequestDismiss).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'retake', userId: 'user_4', unitId: 'unit-a', dismissedBy: 'kckern', reason: expect.stringMatching(/another try/),
    }));
    expect(schoolApi.offerRetake.mock.invocationCallOrder[0])
      .toBeLessThan(schoolApi.quizRequestDismiss.mock.invocationCallOrder[0]);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('says to open the lesson from History when no failed attempt of the unit exists', async () => {
    schoolApi.learnerSessions.mockResolvedValue(ok({ sessions: [failed('s2', '2026-10-21T10:00:00Z', { unitId: 'unit-b' })] }));
    mount(<QuizRequestBacklog kids={KIDS} />);
    await screen.findByText('Fractions');
    await waitForClaim();
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Offer another try' })); });
    expect(await screen.findByText(/open the lesson from History/)).toBeTruthy();
    expect(schoolApi.offerRetake).not.toHaveBeenCalled();
    expect(schoolApi.quizRequestDismiss).not.toHaveBeenCalled();
  });

  // OpenRemediation answers 201 even when it opened nothing; telling the
  // child "yes" then would be a promise with no sheet behind it.
  it('keeps the request, and says why, when the server opened no retry', async () => {
    schoolApi.learnerSessions.mockResolvedValue(ok({ sessions: [failed('s1', '2026-10-20T10:00:00Z')] }));
    schoolApi.offerRetake.mockResolvedValue(ok({ status: 'unavailable', message: 'This lesson is paused: field trip.' }, 201));
    mount(<QuizRequestBacklog kids={KIDS} />);
    await screen.findByText('Fractions');
    await waitForClaim();
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Offer another try' })); });
    expect(await screen.findByText('This lesson is paused: field trip.')).toBeTruthy();
    expect(schoolApi.quizRequestDismiss).not.toHaveBeenCalled();
  });

  it('offers no grant on a request that is not a retake', async () => {
    schoolApi.quizRequests.mockResolvedValue(ok([{ userId: 'user_4', unitId: 'unit-a', unitTitle: 'Fractions' }]));
    mount(<QuizRequestBacklog kids={KIDS} />);
    await screen.findByText('Fractions');
    expect(screen.queryByRole('button', { name: 'Offer another try' })).toBeNull();
  });
});
