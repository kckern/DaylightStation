import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock('./api.mjs', () => ({
  DaylightAPI: (...args) => apiMock(...args),
}));

import { useTempHook2 } from './tempHook2.js';

beforeEach(() => { apiMock.mockReset(); });

describe('useTempHook2 with 3 vars', () => {
  it('handles rejection with 3-var hook', async () => {
    apiMock.mockRejectedValue(new Error('network error'));
    const { result } = renderHook(() => useTempHook2('12345', 'alice'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('network error');
  });
});
