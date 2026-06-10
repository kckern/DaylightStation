import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockSearch = vi.fn();
let innerState = { results: [], pending: [], isSearching: false, search: mockSearch };
vi.mock('../../../hooks/useStreamingSearch.js', () => ({
  useStreamingSearch: vi.fn(() => innerState),
}));

vi.mock('../logging/mediaLog.js', () => ({
  default: { searchIssued: vi.fn() },
}));

import { useLiveSearch } from './useLiveSearch.js';
import mediaLog from '../logging/mediaLog.js';

beforeEach(() => {
  mockSearch.mockClear();
  mediaLog.searchIssued.mockClear();
  innerState = { results: [], pending: [], isSearching: false, search: mockSearch };
});

describe('useLiveSearch', () => {
  it('exposes snapshot of inner streaming hook', () => {
    innerState = { results: [{ id: 'plex:1' }], pending: ['abs'], isSearching: true, search: mockSearch };
    const { result } = renderHook(() => useLiveSearch({ scopeParams: '' }));
    expect(result.current.results).toEqual([{ id: 'plex:1' }]);
    expect(result.current.pending).toEqual(['abs']);
    expect(result.current.isSearching).toBe(true);
  });

  it('setQuery invokes inner search with the query string and scope params (after debounce)', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useLiveSearch({ scopeParams: 'source=plex&mediaType=video' }));
    act(() => { result.current.setQuery('lonesome'); });
    act(() => { vi.advanceTimersByTime(300); });
    expect(mockSearch).toHaveBeenCalledWith('lonesome', 'source=plex&mediaType=video');
    vi.useRealTimers();
  });

  it('setQuery with empty string clears the inner search immediately (no debounce)', () => {
    const { result } = renderHook(() => useLiveSearch({ scopeParams: '' }));
    act(() => { result.current.setQuery(''); });
    expect(mockSearch).toHaveBeenCalledWith('', '');
  });

  it('retry re-routes through setQuery so mediaLog.searchIssued fires for both the original call and the retry', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useLiveSearch({ scopeParams: 'source=plex' }));
    act(() => { result.current.setQuery('cosmos'); });
    act(() => { vi.advanceTimersByTime(300); });
    expect(mediaLog.searchIssued).toHaveBeenCalledTimes(1);
    expect(mediaLog.searchIssued).toHaveBeenCalledWith({ text: 'cosmos', scopeParams: 'source=plex' });
    act(() => { result.current.retry(); });
    act(() => { vi.advanceTimersByTime(300); });
    expect(mediaLog.searchIssued).toHaveBeenCalledTimes(2);
    expect(mediaLog.searchIssued).toHaveBeenNthCalledWith(2, { text: 'cosmos', scopeParams: 'source=plex' });
    expect(mockSearch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('retry is a no-op when no query has been set', () => {
    const { result } = renderHook(() => useLiveSearch({ scopeParams: '' }));
    act(() => { result.current.retry(); });
    expect(mediaLog.searchIssued).not.toHaveBeenCalled();
    expect(mockSearch).not.toHaveBeenCalled();
  });
});

describe('debounce', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('coalesces rapid keystrokes into one search dispatch', () => {
    const { result } = renderHook(() => useLiveSearch({ scopeParams: '' }));
    act(() => {
      result.current.setQuery('ch');
      result.current.setQuery('chr');
      result.current.setQuery('chri');
      result.current.setQuery('chris');
    });
    expect(mockSearch).not.toHaveBeenCalledWith('chris', '');
    act(() => { vi.advanceTimersByTime(300); });
    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(mockSearch).toHaveBeenCalledWith('chris', '');
  });

  it('clears immediately (no debounce) when query drops below 2 chars', () => {
    const { result } = renderHook(() => useLiveSearch({ scopeParams: '' }));
    act(() => { result.current.setQuery(''); });
    expect(mockSearch).toHaveBeenCalledWith('', '');
  });

  it('reports isSearching=true during the debounce window', () => {
    const { result } = renderHook(() => useLiveSearch({ scopeParams: '' }));
    act(() => { result.current.setQuery('chris'); });
    expect(result.current.isSearching).toBe(true);
  });
});
