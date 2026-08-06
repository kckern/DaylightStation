import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useLearnerFeedback } from './useLearnerFeedback.js';

const reviewLearnerMock = vi.fn();
vi.mock('../schoolApi.js', () => ({ schoolApi: {
  reviewLearner: (...a) => reviewLearnerMock(...a),
} }));

const feedbackError = vi.fn();
vi.mock('../schoolLog.js', () => ({ schoolLog: {
  feedback: vi.fn(),
  feedbackError: (...a) => feedbackError(...a),
} }));

const item = (over = {}) => ({
  itemId: 'q1', sessionId: 'ses_1', unitId: 'math-fractions.02', verdict: 'incorrect',
  note: 'Carry the remainder', gradedBy: 'parent', gradedAt: '2026-07-27T09:00:00.000Z',
  prompt: 'What is 5/4 as a mixed number?', questionNumber: 3, ...over,
});

beforeEach(() => { vi.clearAllMocks(); });

describe('useLearnerFeedback', () => {
  it('fetches and reports ready when items come back', async () => {
    reviewLearnerMock.mockResolvedValue({ ok: true, status: 200, data: [item()] });
    const { result } = renderHook(() => useLearnerFeedback('kid1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.items).toEqual([item()]);
    expect(reviewLearnerMock).toHaveBeenCalledWith('kid1', { limit: 20 });
  });

  it('is the empty zero-state (not an error) when there is nothing resolved', async () => {
    reviewLearnerMock.mockResolvedValue({ ok: true, status: 200, data: [] });
    const { result } = renderHook(() => useLearnerFeedback('kid1'));
    await waitFor(() => expect(result.current.status).toBe('empty'));
    expect(result.current.items).toEqual([]);
  });

  it('never fetches with no learnerId — the unclaimed panel has nobody to ask for', () => {
    const { result } = renderHook(() => useLearnerFeedback(null));
    expect(result.current.status).toBe('empty');
    expect(result.current.items).toEqual([]);
    expect(reviewLearnerMock).not.toHaveBeenCalled();
  });

  it('reports and logs a failed fetch, never throwing', async () => {
    reviewLearnerMock.mockResolvedValue({ ok: false, status: 500, data: null });
    const { result } = renderHook(() => useLearnerFeedback('kid1'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.items).toEqual([]);
    expect(feedbackError).toHaveBeenCalledWith('fetch-failed', { learnerId: 'kid1' });
  });

  it('treats a malformed (non-array) body as a failure', async () => {
    reviewLearnerMock.mockResolvedValue({ ok: true, status: 200, data: { items: [item()] } });
    const { result } = renderHook(() => useLearnerFeedback('kid1'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.items).toEqual([]);
  });
});
