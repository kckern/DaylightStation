import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

vi.mock("../schoolApi.js", () => ({ schoolApi: {
  lifecycleReview: vi.fn(), printPending: vi.fn(), quizRequests: vi.fn(),
} }));
const { schoolApi } = await import("../schoolApi.js");
const { useBacklog } = await import("./useBacklog.js");
const ok = (data) => ({ ok: true, status: 200, data });

beforeEach(() => {
  vi.clearAllMocks();
  schoolApi.lifecycleReview.mockResolvedValue(ok({ items: [{}, {}] }));
  schoolApi.printPending.mockResolvedValue(ok([{}]));
  schoolApi.quizRequests.mockResolvedValue(ok([{}, {}, {}]));
});

describe('useBacklog', () => {
  it('counts review, prints and quiz requests into one total', async () => {
    const { result } = renderHook(() => useBacklog({ pollMs: 0 }));
    await waitFor(() => expect(result.current.total).toBe(6));
    expect(result.current).toMatchObject({ review: 2, prints: 1, quizzes: 3, failed: false });
  });
  it('treats a missing endpoint as absent, not as a failure', async () => {
    schoolApi.quizRequests.mockResolvedValue({ ok: false, status: 404, data: null });
    const { result } = renderHook(() => useBacklog({ pollMs: 0 }));
    await waitFor(() => expect(result.current.total).toBe(3));
    expect(result.current).toMatchObject({ quizzes: null, failed: false });
  });
  it('flags a real failure', async () => {
    schoolApi.printPending.mockResolvedValue({ ok: false, status: 500, data: null });
    const { result } = renderHook(() => useBacklog({ pollMs: 0 }));
    await waitFor(() => expect(result.current.failed).toBe(true));
  });
  it('refresh() re-reads at once', async () => {
    const { result } = renderHook(() => useBacklog({ pollMs: 0 }));
    await waitFor(() => expect(result.current.total).toBe(6));
    schoolApi.lifecycleReview.mockResolvedValue(ok({ items: [] }));
    await act(() => result.current.refresh());
    expect(result.current.total).toBe(4);
  });
});
