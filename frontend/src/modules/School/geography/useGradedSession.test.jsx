import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useGradedSession } from './useGradedSession.js';

vi.mock('../schoolApi.js', () => ({ schoolApi: {
  openSession: vi.fn(async () => ({ ok: true, status: 200, data: { sessionId: 'ses_1' } })),
  answer: vi.fn(async () => ({ ok: true, status: 200, data: { correct: true, expected: 'NV' } })),
} }));
let profile = { status: 'ready', currentUser: { id: 'u1' }, isGuest: false };
vi.mock('../identity/SchoolProfileContext.jsx', () => ({
  useSchoolProfile: () => profile,
}));
import { schoolApi } from '../schoolApi.js';

const bank = { id: 'geo:us-state-locations', title: 'Loc', items: [{ id: 'i1' }] };

beforeEach(() => {
  schoolApi.openSession.mockClear();
  schoolApi.answer.mockClear();
  profile = { status: 'ready', currentUser: { id: 'u1' }, isGuest: false };
});

it('opens exactly one session and returns a grade on submit', async () => {
  const onExit = vi.fn();
  const { result } = renderHook(() => useGradedSession({ bank, mode: 'drill', onExit }));
  await waitFor(() => expect(result.current.sessionId).toBe('ses_1'));
  expect(schoolApi.openSession).toHaveBeenCalledTimes(1);
  let verdict;
  await act(async () => { verdict = await result.current.submit('i1', 'NV'); });
  expect(verdict).toEqual({ correct: true, expected: 'NV' });
});

it('surfaces unrecorded on a 500', async () => {
  schoolApi.answer.mockResolvedValueOnce({ ok: false, status: 500, data: null });
  const { result } = renderHook(() => useGradedSession({ bank, mode: 'drill', onExit: vi.fn() }));
  await waitFor(() => expect(result.current.sessionId).toBe('ses_1'));
  let verdict;
  await act(async () => { verdict = await result.current.submit('i1', 'NV'); });
  expect(verdict).toEqual({ unrecorded: true });
});

it('exits on a 410', async () => {
  schoolApi.answer.mockResolvedValueOnce({ ok: false, status: 410, data: null });
  const onExit = vi.fn();
  const { result } = renderHook(() => useGradedSession({ bank, mode: 'drill', onExit }));
  await waitFor(() => expect(result.current.sessionId).toBe('ses_1'));
  await act(async () => { await result.current.submit('i1', 'NV'); });
  expect(onExit).toHaveBeenCalled();
});

it('abandons the session and blocks submit when identity changes mid-session', async () => {
  profile = { status: 'ready', currentUser: { id: 'u1' }, isGuest: false };
  const onExit = vi.fn();
  const { result, rerender } = renderHook(() => useGradedSession({ bank, mode: 'drill', onExit }));
  await waitFor(() => expect(result.current.sessionId).toBe('ses_1'));
  profile = { status: 'ready', currentUser: { id: 'u2' }, isGuest: false };
  rerender();
  expect(onExit).toHaveBeenCalled();
  let verdict;
  await act(async () => { verdict = await result.current.submit('i1', 'NV'); });
  expect(verdict).toBeNull();
});
