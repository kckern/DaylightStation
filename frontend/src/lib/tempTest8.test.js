import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const api = vi.fn();
vi.mock('@/lib/api.mjs', () => ({ DaylightAPI: (...a) => api(...a) }));

import { useTempHook3 } from './tempHook3.js';

beforeEach(() => api.mockReset());

describe('external hook with alias', () => {
  it('handles rejection', async () => {
    api.mockRejectedValue(new Error('network error'));
    const { result } = renderHook(() => useTempHook3('12345', 'alice'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('network error');
  });
});
