import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { TeacherProfileProvider, useTeacherProfile } from "./TeacherProfileContext.jsx";
import PinPrompt from "./panels/PinPrompt.jsx";

vi.mock("../schoolApi.js", () => ({ schoolApi: { teachers: vi.fn() } }));
vi.mock("./teacherWorkspaceApi.js", () => ({ teacherWorkspaceApi: {
  authStatus: vi.fn(async () => ({ ok: true, status: 200, data: { active: false } })),
  unlock: vi.fn(async (userId) => ({ ok: true, status: 200, data: { active: true, userId } })),
  lock: vi.fn(async () => ({ ok: true, status: 200, data: { locked: true } })),
  stepUp: vi.fn(async ({ action, resource }) => ({ ok: true, status: 200, data: { grantToken: 'grant', action, resource } })),
} }));
const { schoolApi } = await import("../schoolApi.js");
const { teacherWorkspaceApi } = await import("./teacherWorkspaceApi.js");

function Probe() {
  const p = useTeacherProfile();
  // Records what the caller's promise RESOLVED TO — 'pending' means it never
  // settled, which is the failure mode this suite exists to catch.
  const [settled, setSettled] = useState('pending');
  return (
    <div>
      <span data-testid="status">{p.status}</span>
      <span data-testid="configured">{String(p.configured)}</span>
      <span data-testid="teachers">{p.teachers.map((t) => t.id).join(',')}</span>
      <span data-testid="current">{p.currentTeacher?.id ?? 'none'}</span>
      <span data-testid="authorized">{String(p.authorization.active)}</span>
      <span data-testid="settled">{settled}</span>
      <button type="button" onClick={() => p.claim('teacher_1')}>claim</button>
      <button type="button" onClick={() => p.release()}>release</button>
      <button type="button" onClick={() => p.requestAuthorization()}>authorize</button>
      <button
        type="button"
        onClick={() => p.requestAuthorization({ action: 'artifact.postview', resource: 'art_1' })
          .then((result) => setSettled(JSON.stringify(result)))}
      >
        step-up
      </button>
    </div>
  );
}

const mount = () => render(<TeacherProfileProvider><Probe /><PinPrompt /></TeacherProfileProvider>);

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe('TeacherProfileContext', () => {
  it('exposes the configured teacher list verbatim — no client-side filtering added', async () => {
    schoolApi.teachers.mockResolvedValue({
      ok: true, status: 200,
      data: { configured: true, teachers: [{ id: 'teacher_1', name: 'Teacher One' }, { id: 'teacher_2', name: 'User_9' }] },
    });
    mount();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    expect(screen.getByTestId('teachers').textContent).toBe('teacher_1,teacher_2');
    expect(screen.getByTestId('configured').textContent).toBe('true');
  });

  it('claim persists to sessionStorage and restores on remount', async () => {
    schoolApi.teachers.mockResolvedValue({
      ok: true, status: 200, data: { configured: true, teachers: [{ id: 'teacher_1', name: 'Teacher One' }] },
    });
    const { unmount } = mount();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    act(() => screen.getByText('claim').click());
    expect(screen.getByTestId('current').textContent).toBe('teacher_1');
    expect(sessionStorage.getItem('school-teacher-claim')).toBe('teacher_1');
    unmount();
    mount();
    await waitFor(() => expect(screen.getByTestId('current').textContent).toBe('teacher_1'));
  });

  it('a persisted id no longer in the list is dropped', async () => {
    sessionStorage.setItem('school-teacher-claim', 'departed');
    schoolApi.teachers.mockResolvedValue({
      ok: true, status: 200, data: { configured: true, teachers: [{ id: 'teacher_1', name: 'Teacher One' }] },
    });
    mount();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    expect(screen.getByTestId('current').textContent).toBe('none');
    expect(sessionStorage.getItem('school-teacher-claim')).toBe(null);
  });

  it('release clears the claim and the persisted key', async () => {
    schoolApi.teachers.mockResolvedValue({
      ok: true, status: 200, data: { configured: true, teachers: [{ id: 'teacher_1', name: 'Teacher One' }] },
    });
    mount();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    act(() => screen.getByText('claim').click());
    act(() => screen.getByText('release').click());
    expect(screen.getByTestId('current').textContent).toBe('none');
    expect(sessionStorage.getItem('school-teacher-claim')).toBe(null);
  });

  it('configured:false surfaces as configured false with empty teachers', async () => {
    schoolApi.teachers.mockResolvedValue({ ok: true, status: 200, data: { configured: false, teachers: [] } });
    mount();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    expect(screen.getByTestId('configured').textContent).toBe('false');
    expect(screen.getByTestId('teachers').textContent).toBe('');
  });

  it('a failed fetch is ready-but-unconfigured, never a crash', async () => {
    schoolApi.teachers.mockResolvedValue({ ok: false, status: 500, data: null });
    mount();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    expect(screen.getByTestId('configured').textContent).toBe('false');
  });

  it('restores the server-authorized teacher ahead of a stale soft claim', async () => {
    sessionStorage.setItem('school-teacher-claim', 'teacher_2');
    schoolApi.teachers.mockResolvedValue({ ok: true, status: 200,
      data: { configured: true, teachers: [{ id: 'teacher_1', name: 'Teacher One' }, { id: 'teacher_2', name: 'User_9' }] } });
    teacherWorkspaceApi.authStatus.mockResolvedValueOnce({ ok: true, status: 200,
      data: { active: true, userId: 'teacher_1', idleExpiresAt: 'idle', absoluteExpiresAt: 'absolute' } });
    mount();
    await waitFor(() => expect(screen.getByTestId('current').textContent).toBe('teacher_1'));
    expect(screen.getByTestId('authorized').textContent).toBe('true');
    expect(sessionStorage.getItem('school-teacher-claim')).toBe('teacher_1');
  });

  it('unlocks with a memory-only PIN and reports a refused unlock in the dialog', async () => {
    schoolApi.teachers.mockResolvedValue({ ok: true, status: 200,
      data: { configured: true, teachers: [{ id: 'teacher_1', name: 'Teacher One' }] } });
    teacherWorkspaceApi.unlock
      .mockResolvedValueOnce({ ok: false, status: 403, data: { error: 'Wrong PIN.' } })
      .mockResolvedValueOnce({ ok: true, status: 200, data: { active: true, userId: 'teacher_1' } });
    mount();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    fireEvent.click(screen.getByText('claim'));
    fireEvent.click(screen.getByText('authorize'));
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '1111' } });
    fireEvent.click(screen.getByText('Continue'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Wrong PIN.'));
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '4321' } });
    fireEvent.click(screen.getByText('Continue'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Teacher PIN' })).toBeNull());
    expect(teacherWorkspaceApi.unlock).toHaveBeenLastCalledWith('teacher_1', '4321');
    expect(JSON.stringify(sessionStorage)).not.toContain('4321');
  });

  it('mints a resource-scoped step-up grant even while the ordinary session is active', async () => {
    sessionStorage.setItem('school-teacher-claim', 'teacher_1');
    schoolApi.teachers.mockResolvedValue({ ok: true, status: 200,
      data: { configured: true, teachers: [{ id: 'teacher_1', name: 'Teacher One' }] } });
    teacherWorkspaceApi.authStatus.mockResolvedValueOnce({ ok: true, status: 200,
      data: { active: true, userId: 'teacher_1' } });
    mount();
    await waitFor(() => expect(screen.getByTestId('authorized').textContent).toBe('true'));
    fireEvent.click(screen.getByText('step-up'));
    expect(screen.getByText('Confirm sensitive action')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '4321' } });
    fireEvent.click(screen.getByText('Continue'));
    await waitFor(() => expect(teacherWorkspaceApi.stepUp).toHaveBeenCalledWith({
      pin: '4321', action: 'artifact.postview', resource: 'art_1',
    }));
  });
});

/**
 * No terminal path may leave the caller's promise unsettled.
 *
 * The console once asked for grants under action names the server does not
 * mint (`artifact.reprint`, `curriculum-exception.apply`/`.retract`). Every
 * step-up was refused, this branch returned without settling, and three
 * buttons became a PIN dialog no PIN could close over a write that never
 * resolved. Both refusals arrive as a bare 403, so the discriminator is
 * whether the server accepted THIS PIN during THIS submission: if it did, the
 * refusal is about the action and retyping cannot help.
 */
describe('a step-up refusal always settles or stays retryable', () => {
  const activeSession = () => {
    sessionStorage.setItem('school-teacher-claim', 'teacher_1');
    schoolApi.teachers.mockResolvedValue({ ok: true, status: 200,
      data: { configured: true, teachers: [{ id: 'teacher_1', name: 'Teacher One' }] } });
    teacherWorkspaceApi.authStatus.mockResolvedValue({ ok: true, status: 200,
      data: { active: true, userId: 'teacher_1' } });
  };

  it('settles the caller and closes the dialog when the ACTION is refused', async () => {
    activeSession();
    teacherWorkspaceApi.stepUp.mockResolvedValue({ ok: false, status: 403,
      data: { error: 'A valid step-up action and resource are required.' } });
    mount();
    await waitFor(() => expect(screen.getByTestId('authorized').textContent).toBe('true'));
    fireEvent.click(screen.getByText('step-up'));
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '4321' } });
    fireEvent.click(screen.getByText('Continue'));

    await waitFor(() => expect(screen.getByTestId('settled').textContent).not.toBe('pending'));
    expect(JSON.parse(screen.getByTestId('settled').textContent)).toMatchObject({
      ok: false, refused: true, status: 403, message: 'A valid step-up action and resource are required.',
    });
    expect(screen.queryByLabelText('PIN')).toBeNull();
    expect(JSON.stringify(sessionStorage)).not.toContain('4321');
  });

  it('keeps the dialog open for another try when the PIN is what was refused', async () => {
    activeSession();
    teacherWorkspaceApi.unlock.mockResolvedValue({ ok: false, status: 403, data: { error: 'Wrong PIN.' } });
    teacherWorkspaceApi.stepUp.mockResolvedValue({ ok: false, status: 403, data: { error: 'The teacher PIN is missing or wrong.' } });
    mount();
    await waitFor(() => expect(screen.getByTestId('authorized').textContent).toBe('true'));
    fireEvent.click(screen.getByText('step-up'));
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '1111' } });
    fireEvent.click(screen.getByText('Continue'));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('The teacher PIN is missing or wrong.'));
    expect(screen.getByLabelText('PIN')).toBeTruthy();
    expect(screen.getByTestId('settled').textContent).toBe('pending');
  });
});

/**
 * With no PIN configured the console unlocks and steps up without a dialog.
 * A refusal there must still carry the server's own words as `message`,
 * because that is the field useTeacherWrite puts on screen.
 */
describe('a refused step-up with no PIN configured shows the server reason', () => {
  const noPinSession = () => {
    sessionStorage.setItem('school-teacher-claim', 'teacher_1');
    schoolApi.teachers.mockResolvedValue({ ok: true, status: 200,
      data: { configured: true, teachers: [{ id: 'teacher_1', name: 'Teacher One' }] } });
    teacherWorkspaceApi.authStatus.mockResolvedValue({ ok: true, status: 200,
      data: { active: false, pinRequired: false } });
  };

  const stepUpAndSettle = async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('current').textContent).toBe('teacher_1'));
    fireEvent.click(screen.getByText('step-up'));
    await waitFor(() => expect(screen.getByTestId('settled').textContent).not.toBe('pending'));
    expect(screen.queryByLabelText('PIN')).toBeNull();
    return JSON.parse(screen.getByTestId('settled').textContent);
  };

  it('carries data.error as message', async () => {
    noPinSession();
    teacherWorkspaceApi.unlock.mockResolvedValueOnce({ ok: true, status: 200, data: { active: true, userId: 'teacher_1' } });
    teacherWorkspaceApi.stepUp.mockResolvedValueOnce({ ok: false, status: 403,
      data: { error: 'That action is closed today.' } });
    expect(await stepUpAndSettle()).toMatchObject({
      ok: false, refused: true, status: 403,
      message: 'That action is closed today.', error: 'That action is closed today.',
    });
  });

  it('reads a nested data.error.message', async () => {
    noPinSession();
    teacherWorkspaceApi.unlock.mockResolvedValueOnce({ ok: true, status: 200, data: { active: true, userId: 'teacher_1' } });
    teacherWorkspaceApi.stepUp.mockResolvedValueOnce({ ok: false, status: 403,
      data: { error: { message: 'Nested reason.' } } });
    expect(await stepUpAndSettle()).toMatchObject({ ok: false, message: 'Nested reason.' });
  });

  it('falls back to the generic sentence when the body has no reason', async () => {
    noPinSession();
    teacherWorkspaceApi.unlock.mockResolvedValueOnce({ ok: true, status: 200, data: { active: true, userId: 'teacher_1' } });
    teacherWorkspaceApi.stepUp.mockResolvedValueOnce({ ok: false, status: 500, data: null });
    expect(await stepUpAndSettle()).toMatchObject({
      ok: false, refused: true, status: 500, message: 'Could not authorize that action.',
    });
  });

  it('a refused unlock also carries the server reason', async () => {
    noPinSession();
    teacherWorkspaceApi.unlock.mockResolvedValueOnce({ ok: false, status: 403,
      data: { message: 'The console is locked for the night.' } });
    expect(await stepUpAndSettle()).toMatchObject({
      ok: false, refused: true, status: 403,
      message: 'The console is locked for the night.', error: 'The console is locked for the night.',
    });
    expect(teacherWorkspaceApi.stepUp).not.toHaveBeenCalled();
  });
});
