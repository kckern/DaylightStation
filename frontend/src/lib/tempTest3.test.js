import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useState, useEffect } from 'react';

const apiMock = vi.fn();
vi.mock('./api.mjs', () => ({
  DaylightAPI: (...args) => apiMock(...args),
}));

import { DaylightAPI } from './api.mjs';

beforeEach(() => { apiMock.mockReset(); });

// Inline hook but uses mocked module
function useInlineHook(id) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  useEffect(() => {
    DaylightAPI(id).then(() => setLoading(false)).catch(err => { setError(err.message); setLoading(false); });
  }, [id]);
  return { loading, error };
}

describe('inline hook with module mock', () => {
  it('handles rejection', async () => {
    apiMock.mockRejectedValue(new Error('fail'));
    const { result } = renderHook(() => useInlineHook('test'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('fail');
  });
});
