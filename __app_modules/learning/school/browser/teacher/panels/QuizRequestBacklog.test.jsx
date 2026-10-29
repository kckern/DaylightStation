import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import QuizRequestBacklog from "./QuizRequestBacklog.jsx";
import { TeacherProfileProvider, useTeacherProfile } from "../TeacherProfileContext.jsx";
import PinPrompt from "./PinPrompt.jsx";

vi.mock("../teacherWorkspaceApi.js", () => ({ teacherWorkspaceApi: {
  authStatus: vi.fn(async () => {
    const userId = localStorage.getItem('school-teacher-claim');
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
const waitForClaim = () => waitFor(() => expect(screen.getByTestId('claimed-teacher').textContent).toBe('teacher_1'));

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  localStorage.setItem('school-teacher-claim', 'teacher_1');
  schoolApi.teachers.mockResolvedValue(ok({ configured: true, teachers: [{ id: 'teacher_1', name: 'Teacher One' }] }));
  schoolApi.quizRequests.mockResolvedValue(ok([{ kind: 'retake', userId: 'user_4', unitId: 'unit-a', sessionId: 'ses_7', title: 'Fractions' }]));
  schoolApi.quizRequestDismiss.mockResolvedValue(ok({ dismissed: true }));
});

// 2026-10-21: on-screen quizzes retake until passed, so the runner files no
// new retake asks. Rows already on file are cleared like any other — a
// Dismiss with a reason — and the queue no longer opens retries itself.
describe('QuizRequestBacklog — legacy retake rows are dismiss-only', () => {
  it('offers no grant on a retake row', async () => {
    mount(<QuizRequestBacklog kids={KIDS} />);
    await screen.findByText('Fractions');
    expect(screen.getByText(/wants another try — asked by User_4/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Offer another try' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Dismiss…' })).toBeTruthy();
  });

  it('dismisses exactly that retake row with the reason, then refreshes the dashboard', async () => {
    const onChanged = vi.fn();
    mount(<QuizRequestBacklog kids={KIDS} onChanged={onChanged} />);
    await screen.findByText('Fractions');
    await waitForClaim();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss…' }));
    fireEvent.change(screen.getByLabelText('Dismissal reason'), { target: { value: 'Quizzes retake on their own now.' } });
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Dismiss & tell them' })); });
    await waitFor(() => expect(schoolApi.quizRequestDismiss).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'retake', sessionId: 'ses_7', userId: 'user_4', unitId: 'unit-a',
      dismissedBy: 'teacher_1', reason: 'Quizzes retake on their own now.',
    })));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(schoolApi.learnerSessions).not.toHaveBeenCalled();
    expect(schoolApi.offerRetake).not.toHaveBeenCalled();
  });
});
