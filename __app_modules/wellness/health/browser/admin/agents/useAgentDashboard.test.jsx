import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { resource } = vi.hoisted(() => ({ resource: vi.fn() }));
vi.mock('../../../../../../frontend/src/lib/hooks/useApiResource.js', () => ({
  useApiResource: (...args) => resource(...args),
}));
vi.mock('../../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));

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
