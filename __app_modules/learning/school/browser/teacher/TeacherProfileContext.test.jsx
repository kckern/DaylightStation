import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { TeacherProfileProvider, useTeacherProfile } from "./TeacherProfileContext.jsx";

vi.mock("../schoolApi.js", () => ({ schoolApi: { teachers: vi.fn() } }));
const { schoolApi } = await import("../schoolApi.js");

function Probe() {
  const p = useTeacherProfile();
  return (
    <div>
      <span data-testid="status">{p.status}</span>
      <span data-testid="configured">{String(p.configured)}</span>
      <span data-testid="teachers">{p.teachers.map((t) => t.id).join(',')}</span>
      <span data-testid="current">{p.currentTeacher?.id ?? 'none'}</span>
      <button type="button" onClick={() => p.claim('teacher_1')}>claim</button>
      <button type="button" onClick={() => p.release()}>release</button>
    </div>
  );
}

const mount = () => render(<TeacherProfileProvider><Probe /></TeacherProfileProvider>);

beforeEach(() => {
  localStorage.clear();
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

  it('claim persists to localStorage and restores on remount (a new tab or reload keeps the pick)', async () => {
    schoolApi.teachers.mockResolvedValue({
      ok: true, status: 200, data: { configured: true, teachers: [{ id: 'teacher_1', name: 'Teacher One' }] },
    });
    const { unmount } = mount();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    act(() => screen.getByText('claim').click());
    expect(screen.getByTestId('current').textContent).toBe('teacher_1');
    expect(localStorage.getItem('school-teacher-claim')).toBe('teacher_1');
    unmount();
    mount();
    await waitFor(() => expect(screen.getByTestId('current').textContent).toBe('teacher_1'));
  });

  it('a persisted id no longer in the list is dropped', async () => {
    localStorage.setItem('school-teacher-claim', 'departed');
    schoolApi.teachers.mockResolvedValue({
      ok: true, status: 200, data: { configured: true, teachers: [{ id: 'teacher_1', name: 'Teacher One' }] },
    });
    mount();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    expect(screen.getByTestId('current').textContent).toBe('none');
    expect(localStorage.getItem('school-teacher-claim')).toBe(null);
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
    expect(localStorage.getItem('school-teacher-claim')).toBe(null);
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
