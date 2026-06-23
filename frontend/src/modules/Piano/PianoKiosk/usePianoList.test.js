import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = [];
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(async (path) => { calls.push(path); return { items: [{ id: 'a' }] }; }),
}));
import { usePianoList, __clearPianoListCache } from './usePianoList.js';

beforeEach(() => { calls.length = 0; __clearPianoListCache(); });

describe('usePianoList', () => {
  it('fetches once, then serves cache on remount (no second fetch within TTL)', async () => {
    const h1 = renderHook(() => usePianoList('api/v1/list/plex/123'));
    await waitFor(() => expect(h1.result.current.data).toEqual([{ id: 'a' }]));
    h1.unmount();
    const h2 = renderHook(() => usePianoList('api/v1/list/plex/123'));
    expect(h2.result.current.data).toEqual([{ id: 'a' }]); // instant from cache
    expect(calls.length).toBe(1);
  });

  it('returns [] for a null path without fetching', () => {
    const { result } = renderHook(() => usePianoList(null));
    expect(result.current.data).toEqual([]);
    expect(calls.length).toBe(0);
  });

  it('applies a custom select mapper', async () => {
    const { result } = renderHook(() => usePianoList('api/v1/list/plex/9', (r) => r.items.map((i) => i.id)));
    await waitFor(() => expect(result.current.data).toEqual(['a']));
  });
});
