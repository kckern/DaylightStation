import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { TeacherProfileProvider, useTeacherProfile } from './TeacherProfileContext.jsx';
import PinPrompt from './panels/PinPrompt.jsx';

vi.mock('../schoolApi.js', () => ({ schoolApi: { teachers: vi.fn() } }));
vi.mock('./teacherWorkspaceApi.js', () => ({ teacherWorkspaceApi: {
  authStatus: vi.fn(async () => ({ ok: true, status: 200, data: { active: false } })),
  unlock: vi.fn(async (userId) => ({ ok: true, status: 200, data: { active: true, userId } })),
  lock: vi.fn(async () => ({ ok: true, status: 200, data: { locked: true } })),
  stepUp: vi.fn(async ({ action, resource }) => ({ ok: true, status: 200, data: { grantToken: 'grant', action, resource } })),
} }));
const { schoolApi } = await import('../schoolApi.js');
const { teacherWorkspaceApi } = await import('./teacherWorkspaceApi.js');

function Probe() {
  const p = useTeacherProfile();
  return (
    <div>
      <span data-testid="status">{p.status}</span>
      <span data-testid="configured">{String(p.configured)}</span>
      <span data-testid="teachers">{p.teachers.map((t) => t.id).join(',')}</span>
      <span data-testid="current">{p.currentTeacher?.id ?? 'none'}</span>
      <span data-testid="authorized">{String(p.authorization.active)}</span>
      <button type="button" onClick={() => p.claim('kckern')}>claim</button>
      <button type="button" onClick={() => p.release()}>release</button>
      <button type="button" onClick={() => p.requestAuthorization()}>authorize</button>
      <button type="button" onClick={() => p.requestAuthorization({ action: 'artifact.postview', resource: 'art_1' })}>step-up</button>
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
      data: { configured: true, teachers: [{ id: 'kckern', name: 'KC' }, { id: 'liz', name: 'Elizabeth' }] },
    });
    mount();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    expect(screen.getByTestId('teachers').textContent).toBe('kckern,liz');
    expect(screen.getByTestId('configured').textContent).toBe('true');
  });

  it('claim persists to sessionStorage and restores on remount', async () => {
    schoolApi.teachers.mockResolvedValue({
      ok: true, status: 200, data: { configured: true, teachers: [{ id: 'kckern', name: 'KC' }] },
    });
    const { unmount } = mount();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    act(() => screen.getByText('claim').click());
    expect(screen.getByTestId('current').textContent).toBe('kckern');
    expect(sessionStorage.getItem('school-teacher-claim')).toBe('kckern');
    unmount();
    mount();
    await waitFor(() => expect(screen.getByTestId('current').textContent).toBe('kckern'));
  });

  it('a persisted id no longer in the list is dropped', async () => {
    sessionStorage.setItem('school-teacher-claim', 'departed');
    schoolApi.teachers.mockResolvedValue({
      ok: true, status: 200, data: { configured: true, teachers: [{ id: 'kckern', name: 'KC' }] },
    });
    mount();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    expect(screen.getByTestId('current').textContent).toBe('none');
    expect(sessionStorage.getItem('school-teacher-claim')).toBe(null);
  });

  it('release clears the claim and the persisted key', async () => {
    schoolApi.teachers.mockResolvedValue({
      ok: true, status: 200, data: { configured: true, teachers: [{ id: 'kckern', name: 'KC' }] },
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
    sessionStorage.setItem('school-teacher-claim', 'liz');
    schoolApi.teachers.mockResolvedValue({ ok: true, status: 200,
      data: { configured: true, teachers: [{ id: 'kckern', name: 'KC' }, { id: 'liz', name: 'Elizabeth' }] } });
    teacherWorkspaceApi.authStatus.mockResolvedValueOnce({ ok: true, status: 200,
      data: { active: true, userId: 'kckern', idleExpiresAt: 'idle', absoluteExpiresAt: 'absolute' } });
    mount();
    await waitFor(() => expect(screen.getByTestId('current').textContent).toBe('kckern'));
    expect(screen.getByTestId('authorized').textContent).toBe('true');
    expect(sessionStorage.getItem('school-teacher-claim')).toBe('kckern');
  });

  it('unlocks with a memory-only PIN and reports a refused unlock in the dialog', async () => {
    schoolApi.teachers.mockResolvedValue({ ok: true, status: 200,
      data: { configured: true, teachers: [{ id: 'kckern', name: 'KC' }] } });
    teacherWorkspaceApi.unlock
      .mockResolvedValueOnce({ ok: false, status: 403, data: { error: 'Wrong PIN.' } })
      .mockResolvedValueOnce({ ok: true, status: 200, data: { active: true, userId: 'kckern' } });
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
    expect(teacherWorkspaceApi.unlock).toHaveBeenLastCalledWith('kckern', '4321');
    expect(JSON.stringify(sessionStorage)).not.toContain('4321');
  });

  it('mints a resource-scoped step-up grant even while the ordinary session is active', async () => {
    sessionStorage.setItem('school-teacher-claim', 'kckern');
    schoolApi.teachers.mockResolvedValue({ ok: true, status: 200,
      data: { configured: true, teachers: [{ id: 'kckern', name: 'KC' }] } });
    teacherWorkspaceApi.authStatus.mockResolvedValueOnce({ ok: true, status: 200,
      data: { active: true, userId: 'kckern' } });
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
