import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useState, useEffect } from 'react';

const api = vi.fn();
beforeEach(() => api.mockReset());

function useHook(id) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  useEffect(() => {
    api(id).then(() => setLoading(false)).catch(err => { setError(err.message); setLoading(false); });
  }, [id]);
  return { loading, error };
}

describe('rejection in lib dir', () => {
  it('handles rejection', async () => {
    api.mockRejectedValue(new Error('fail'));
    const { result } = renderHook(() => useHook('test'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('fail');
  });
});
