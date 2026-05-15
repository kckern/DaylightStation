import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const innerSearch = vi.fn();
let innerState = { results: [], pending: [], isSearching: false, search: innerSearch };
vi.mock('../../../hooks/useStreamingSearch.js', () => ({
  useStreamingSearch: vi.fn(() => innerState),
}));

vi.mock('../logging/mediaLog.js', () => ({
  default: { searchIssued: vi.fn() },
}));

import { useLiveSearch } from './useLiveSearch.js';
import mediaLog from '../logging/mediaLog.js';

beforeEach(() => {
  innerSearch.mockClear();
  mediaLog.searchIssued.mockClear();
  innerState = { results: [], pending: [], isSearching: false, search: innerSearch };
});

describe('useLiveSearch', () => {
  it('exposes snapshot of inner streaming hook', () => {
    innerState = { results: [{ id: 'plex:1' }], pending: ['abs'], isSearching: true, search: innerSearch };
    const { result } = renderHook(() => useLiveSearch({ scopeParams: '' }));
    expect(result.current.results).toEqual([{ id: 'plex:1' }]);
    expect(result.current.pending).toEqual(['abs']);
    expect(result.current.isSearching).toBe(true);
  });

  it('setQuery invokes inner search with the query string and scope params', () => {
    const { result } = renderHook(() => useLiveSearch({ scopeParams: 'source=plex&mediaType=video' }));
    act(() => { result.current.setQuery('lonesome'); });
    expect(innerSearch).toHaveBeenCalledWith('lonesome', 'source=plex&mediaType=video');
  });

  it('setQuery with empty string clears the inner search', () => {
    const { result } = renderHook(() => useLiveSearch({ scopeParams: '' }));
    act(() => { result.current.setQuery(''); });
    expect(innerSearch).toHaveBeenCalledWith('', '');
  });

  it('retry re-routes through setQuery so mediaLog.searchIssued fires for both the original call and the retry', () => {
    const { result } = renderHook(() => useLiveSearch({ scopeParams: 'source=plex' }));
    act(() => { result.current.setQuery('cosmos'); });
    expect(mediaLog.searchIssued).toHaveBeenCalledTimes(1);
    expect(mediaLog.searchIssued).toHaveBeenCalledWith({ text: 'cosmos', scopeParams: 'source=plex' });
    act(() => { result.current.retry(); });
    expect(mediaLog.searchIssued).toHaveBeenCalledTimes(2);
    expect(mediaLog.searchIssued).toHaveBeenNthCalledWith(2, { text: 'cosmos', scopeParams: 'source=plex' });
    expect(innerSearch).toHaveBeenCalledTimes(2);
  });

  it('retry is a no-op when no query has been set', () => {
    const { result } = renderHook(() => useLiveSearch({ scopeParams: '' }));
    act(() => { result.current.retry(); });
    expect(mediaLog.searchIssued).not.toHaveBeenCalled();
    expect(innerSearch).not.toHaveBeenCalled();
  });
});
