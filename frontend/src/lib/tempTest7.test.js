import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useState, useEffect } from 'react';

const api = vi.fn();
vi.mock('./api.mjs', () => ({ DaylightAPI: (...a) => api(...a) }));

beforeEach(() => api.mockReset());

// Check: does just calling api().then().catch() inside a renderHook effect work?
function useWithRejection() {
  const [done, setDone] = useState(false);
  const [caught, setCaught] = useState(false);
  
  useEffect(() => {
    api('test')
      .then(() => setDone(true))
      .catch(() => { setCaught(true); setDone(true); });
  }, []);
  
  return { done, caught };
}

describe('raw api rejection test', () => {
  it('catches rejection via .then().catch()', async () => {
    api.mockRejectedValue(new Error('fail'));
    const { result } = renderHook(() => useWithRejection());
    await waitFor(() => expect(result.current.done).toBe(true));
    expect(result.current.caught).toBe(true);
  });
});
