import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { resource } = vi.hoisted(() => ({ resource: vi.fn() }));
vi.mock('../../../../../../frontend/src/lib/hooks/useApiResource.js', () => ({
  useApiResource: (...args) => resource(...args),
}));
import { useAgentDashboard } from './useAgentDashboard.js';

describe('useAgentDashboard read errors', () => {
  beforeEach(() => {
    resource.mockReset();
    resource.mockReturnValue({
      data: null,
      loading: false,
      error: new Error('Dashboard unavailable'),
      reload: vi.fn(),
    });
  });

  it('clears a dismissed resource read error from the returned view state', () => {
    const { result } = renderHook(() => useAgentDashboard('alice', '2026-11-18'));
    expect(result.current.error?.message).toBe('Dashboard unavailable');

    act(() => result.current.clearError());

    expect(result.current.error).toBeNull();
  });
});

describe('useAgentDashboard regenerate', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('POSTs the selected user to the daily dashboard assignment and clears the pending state', async () => {
    resource.mockReset();
    resource.mockReturnValue({ data: null, loading: false, error: null, reload: vi.fn() });
    let resolveResponse;
    const fetchMock = vi.fn(() => new Promise(resolve => { resolveResponse = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const outcome = { agentId: 'health-coach', assignmentId: 'daily-dashboard', status: 'complete' };
    const { result } = renderHook(() => useAgentDashboard('alice', '2026-11-18'));

    let regeneration;
    act(() => {
      regeneration = result.current.regenerate('health-coach', 'alice');
    });

    expect(result.current.regenerating).toBe(true);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      `${location.origin}/api/v1/agents/health-coach/assignments/daily-dashboard/run`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ userId: 'alice' }) }),
    );

    await act(async () => {
      resolveResponse(Response.json(outcome));
      await expect(regeneration).resolves.toEqual(outcome);
    });
    expect(result.current.regenerating).toBe(false);
    expect(result.current.error).toBeNull();
  });
});
