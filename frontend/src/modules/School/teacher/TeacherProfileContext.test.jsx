import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { TeacherProfileProvider, useTeacherProfile } from './TeacherProfileContext.jsx';

vi.mock('../schoolApi.js', () => ({ schoolApi: { teachers: vi.fn() } }));
const { schoolApi } = await import('../schoolApi.js');

function Probe() {
  const p = useTeacherProfile();
  return (
    <div>
      <span data-testid="status">{p.status}</span>
      <span data-testid="configured">{String(p.configured)}</span>
      <span data-testid="teachers">{p.teachers.map((t) => t.id).join(',')}</span>
      <span data-testid="current">{p.currentTeacher?.id ?? 'none'}</span>
      <button type="button" onClick={() => p.claim('kckern')}>claim</button>
      <button type="button" onClick={() => p.release()}>release</button>
    </div>
  );
}

const mount = () => render(<TeacherProfileProvider><Probe /></TeacherProfileProvider>);

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
});
