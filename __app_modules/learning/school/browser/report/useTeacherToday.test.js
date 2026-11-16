import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useTeacherToday } from "./useTeacherToday.js";

const teacherTodayMock = vi.fn();
vi.mock("../schoolApi.js", () => ({ schoolApi: {
  teacherToday: (...a) => teacherTodayMock(...a),
} }));

const teacherTodayError = vi.fn();
vi.mock("../schoolLog.js", () => ({ schoolLog: {
  teacherToday: vi.fn(),
  teacherTodayError: (...a) => teacherTodayError(...a),
} }));

const row = (over = {}) => ({
  learnerId: 'kid1', attemptsToday: 3, correctToday: 2,
  sessionsToday: [{ unitId: 'math-fractions.03', state: 'active' }],
  pendingReview: 1, ...over,
});

beforeEach(() => { vi.clearAllMocks(); });

describe('useTeacherToday', () => {
  it('indexes the digest by learnerId', async () => {
    teacherTodayMock.mockResolvedValue({ ok: true, status: 200, data: [row(), row({ learnerId: 'kid2', attemptsToday: 0, sessionsToday: [], pendingReview: 0 })] });
    const { result } = renderHook(() => useTeacherToday());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.byLearner.get('kid1')).toEqual(row());
    expect(result.current.byLearner.get('kid2')?.attemptsToday).toBe(0);
    expect(result.current.byLearner.get('nobody')).toBeUndefined();
  });

  it('reports and logs a failed fetch, never throwing', async () => {
    teacherTodayMock.mockResolvedValue({ ok: false, status: 500, data: null });
    const { result } = renderHook(() => useTeacherToday());
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.byLearner.size).toBe(0);
    expect(teacherTodayError).toHaveBeenCalledWith('fetch-failed', {});
  });

  it('treats a malformed (non-array) body as a failure', async () => {
    teacherTodayMock.mockResolvedValue({ ok: true, status: 200, data: { learners: [row()] } });
    const { result } = renderHook(() => useTeacherToday());
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.byLearner.size).toBe(0);
  });
});

vi.mock('../../../../../frontend/src/services/WebSocketService.js', async () => {
  const { createSchoolRealtimeSource } = await import('#testlib/school/realtimeSource.mjs');
  return { wsService: createSchoolRealtimeSource() };
});
import { wsService } from '../../../../../frontend/src/services/WebSocketService.js';

it('updates mounted teacher evidence after an external scan and reconnect', async () => {
  teacherTodayMock.mockResolvedValue({ ok: true, status: 200, data: [row()] });
  const { result } = renderHook(() => useTeacherToday());
  await waitFor(() => expect(result.current.byLearner.get('kid1')?.attemptsToday).toBe(3));
  teacherTodayMock.mockResolvedValue({ ok: true, status: 200, data: [row({ attemptsToday: 4 })] });
  act(() => wsService.emit({ topic: 'school', event: 'assessment-changed', learnerId: 'kid1' }));
  await waitFor(() => expect(result.current.byLearner.get('kid1')?.attemptsToday).toBe(4));
  teacherTodayMock.mockResolvedValue({ ok: true, status: 200, data: [row({ attemptsToday: 5 })] });
  act(() => { wsService.status(false); wsService.status(true); });
  await waitFor(() => expect(result.current.byLearner.get('kid1')?.attemptsToday).toBe(5));
});
it('retains verified teacher data and timestamp when a refresh fails', async () => {
  teacherTodayMock.mockResolvedValue({ ok: true, status: 200, data: [row()] });
  const { result } = renderHook(() => useTeacherToday());
  await waitFor(() => expect(result.current.status).toBe('ready'));
  const verified = result.current.lastSuccessAt;
  expect(verified).toEqual(expect.any(Number));
  teacherTodayMock.mockResolvedValue({ ok: false, status: 503, data: null });
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.error).toMatchObject({ status: 503 }));
  expect(result.current.byLearner.get('kid1')?.attemptsToday).toBe(3);
  expect(result.current.lastSuccessAt).toBe(verified);
  expect(result.current.stale).toBe(true);
});
