import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: (...args) => api(...args) }));

import { useAdminAgents } from './useAdminAgents.js';

describe('useAdminAgents resource read', () => {
  beforeEach(() => api.mockReset());

  it('loads the roster when the directory mounts', async () => {
    api.mockResolvedValue({ agents: [{ id: 'coach', description: 'Daily coach' }] });

    const { result } = renderHook(() => useAdminAgents());

    await waitFor(() => expect(result.current.agents).toEqual([
      { id: 'coach', description: 'Daily coach' },
    ]), { timeout: 1000 });
    expect(api).toHaveBeenCalledTimes(1);
    expect(api).toHaveBeenCalledWith('/api/v1/agents');
  });

});
