import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useContentTitle, clearTitleCache, rememberTitle } from "./useContentTitle.js";

describe('useContentTitle', () => {
  beforeEach(() => {
    clearTitleCache();
    vi.restoreAllMocks();
  });

  it('returns null for empty contentId without fetching', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { result } = renderHook(() => useContentTitle(''));
    expect(result.current).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns cached title synchronously when present', () => {
    rememberTitle('plex:42', 'Cached Title');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { result } = renderHook(() => useContentTitle('plex:42'));
    expect(result.current).toBe('Cached Title');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches and primes cache on first miss', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ title: 'Fetched Title' }),
    });
    const { result } = renderHook(() => useContentTitle('plex:99'));
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe('Fetched Title'));
    const second = renderHook(() => useContentTitle('plex:99'));
    expect(second.result.current).toBe('Fetched Title');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('fails soft (returns null) on fetch error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useContentTitle('plex:404'));
    await waitFor(() => {}, { timeout: 50 });
    expect(result.current).toBeNull();
  });
});
