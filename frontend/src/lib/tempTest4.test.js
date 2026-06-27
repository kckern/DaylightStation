import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock('./api.mjs', () => ({
  DaylightAPI: (...args) => apiMock(...args),
}));

import { useTempHook } from './tempHook.js';

beforeEach(() => { apiMock.mockReset(); });

describe('external hook test', () => {
  it('handles rejection', async () => {
    apiMock.mockRejectedValue(new Error('fail'));
    const { result } = renderHook(() => useTempHook('test'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('fail');
  });
});
