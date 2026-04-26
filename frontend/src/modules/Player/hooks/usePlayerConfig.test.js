import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePlayerConfig } from './usePlayerConfig.js';

vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(),
}));

import { DaylightAPI } from '../../../lib/api.mjs';

describe('usePlayerConfig', () => {
  beforeEach(() => {
    DaylightAPI.mockReset();
  });

  it('fetches /api/v1/config/player and exposes on_deck', async () => {
    DaylightAPI.mockResolvedValue({ on_deck: { preempt_seconds: 15, displace_to_queue: false } });
    const { result } = renderHook(() => usePlayerConfig());
    await waitFor(() => expect(result.current.onDeck).toBeTruthy());
    expect(result.current.onDeck.preempt_seconds).toBe(15);
    expect(result.current.onDeck.displace_to_queue).toBe(false);
  });

  it('returns defaults if fetch fails', async () => {
    DaylightAPI.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => usePlayerConfig());
    await waitFor(() => expect(result.current.onDeck).toBeTruthy());
    expect(result.current.onDeck.preempt_seconds).toBe(15);
  });
});
