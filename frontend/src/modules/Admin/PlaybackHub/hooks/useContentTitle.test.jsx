import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useContentTitle } from './useContentTitle.js';
import { titleCache } from '../utils/titleCache.js';

describe('useContentTitle', () => {
  beforeEach(() => {
    titleCache.clear();
    vi.restoreAllMocks();
  });

  it('returns null for empty contentId without fetching', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { result } = renderHook(() => useContentTitle(''));
    expect(result.current).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns cached title synchronously when present', () => {
    titleCache.set('plex:42', 'Cached Title');
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
    expect(titleCache.get('plex:99')).toBe('Fetched Title');
  });

  it('fails soft (returns null) on fetch error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useContentTitle('plex:404'));
    await waitFor(() => {}, { timeout: 50 });
    expect(result.current).toBeNull();
  });
});
