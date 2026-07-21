import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { SchoolProfileProvider, useSchoolProfile } from './SchoolProfileContext.jsx';
import { schoolApi } from '../schoolApi.js';

vi.mock('../schoolApi.js', () => ({
  schoolApi: { roster: vi.fn(async () => ({ ok: true, status: 200, data: [{ id: 'kid1', name: 'Alpha' }, { id: 'kid2', name: 'Beta' }] })) },
}));

let ctx;
function Probe() { ctx = useSchoolProfile(); return <div data-testid="user">{ctx.currentUser?.id || (ctx.isGuest ? 'guest' : 'none')}</div>; }
const mount = () => render(<SchoolProfileProvider><Probe /></SchoolProfileProvider>);

beforeEach(() => { localStorage.clear(); vi.useRealTimers(); });

describe('SchoolProfileContext', () => {
  it('loads roster; starts unclaimed with no stored user', async () => {
    mount();
    await waitFor(() => expect(ctx.status).toBe('ready'));
    expect(ctx.roster).toHaveLength(2);
    expect(screen.getByTestId('user').textContent).toBe('none');
  });
  it('claim persists to localStorage["school:user"]; guest clears it and never persists', async () => {
    mount();
    await waitFor(() => expect(ctx.status).toBe('ready'));
    act(() => ctx.claim('kid1'));
    expect(localStorage.getItem('school:user')).toBe('kid1');
    act(() => ctx.continueAsGuest());
    expect(screen.getByTestId('user').textContent).toBe('guest');
    expect(localStorage.getItem('school:user')).toBe(null);
  });
  it('restores a stored id still on the roster; clears one that is not', async () => {
    localStorage.setItem('school:user', 'kid2');
    mount();
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('kid2'));
    localStorage.setItem('school:user', 'departed');
    mount();
    await waitFor(() => expect(ctx.status).toBe('ready'));
    expect(ctx.currentUser).toBe(null);
    expect(localStorage.getItem('school:user')).toBe(null);
  });
  it('a failed roster fetch does not wipe a persisted claim; still reaches ready', async () => {
    localStorage.setItem('school:user', 'kid1');
    schoolApi.roster.mockResolvedValueOnce({ ok: false, status: 0, data: null });
    mount();
    await waitFor(() => expect(ctx.status).toBe('ready'));
    expect(localStorage.getItem('school:user')).toBe('kid1');
  });
  it('lapses after a 10-minute idle gap on the next interaction; activity inside the window does not lapse', async () => {
    vi.useFakeTimers();
    mount();
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    act(() => ctx.claim('kid1'));
    // interaction inside the window keeps identity
    act(() => { vi.advanceTimersByTime(5 * 60_000); fireEvent.pointerDown(window); });
    expect(screen.getByTestId('user').textContent).toBe('kid1');
    // a >=10-minute gap: the NEXT interaction triggers the lapse
    act(() => { vi.advanceTimersByTime(10 * 60_000 + 1); fireEvent.pointerDown(window); });
    expect(screen.getByTestId('user').textContent).toBe('none');
    expect(localStorage.getItem('school:user')).toBe(null);
  });
});
