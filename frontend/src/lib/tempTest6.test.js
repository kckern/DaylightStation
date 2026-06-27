import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useState, useEffect } from 'react';

// Replicate EXACTLY what happens in the failing test
const api = vi.fn();
vi.mock('../modules/Piano/PianoKiosk/modes/Videos/../../../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => api(...a) }));

import { DaylightAPI } from '../modules/Piano/PianoKiosk/modes/Videos/../../../../../lib/api.mjs';

beforeEach(() => api.mockReset());

function useHook(courseId, userId) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(!!courseId);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!courseId) { setData(null); setLoading(false); setError(null); return; }
    let cancelled = false;
    setLoading(true); setError(null);
    const url = userId
      ? `api/v1/piano/courses/${courseId}/playable?userId=${encodeURIComponent(userId)}`
      : `api/v1/fitness/show/${courseId}/playable`;
    DaylightAPI(url)
      .then((r) => { if (cancelled) return; setData(r || { items: [] }); setLoading(false); })
      .catch((err) => { if (cancelled) return; setError(err.message); setLoading(false); });
    return () => { cancelled = true; };
  }, [courseId, userId]);

  return { data, loading, error, items: data?.items ?? null, info: data?.info ?? {}, parents: data?.parents ?? null, isSequential: data?.isSequential ?? false };
}

describe('exact replica in lib dir', () => {
  it('handles rejection', async () => {
    api.mockRejectedValue(new Error('network error'));
    const { result } = renderHook(() => useHook('12345', 'alice'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('network error');
  });
});
