// frontend/src/hooks/useStreamingSearch.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStreamingSearch } from './useStreamingSearch.js';

// Mock EventSource
class MockEventSource {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    MockEventSource.instances.push(this);
  }

  close() {
    this.readyState = 2;
  }

  // Simulate receiving events
  simulateMessage(data) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) });
    }
  }

  simulateError() {
    if (this.onerror) {
      this.onerror(new Error('Connection failed'));
    }
  }
}
MockEventSource.instances = [];

describe('useStreamingSearch', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts with empty state', () => {
    const { result } = renderHook(() => useStreamingSearch('/api/search/stream'));

    expect(result.current.results).toEqual([]);
    expect(result.current.pending).toEqual([]);
    expect(result.current.isSearching).toBe(false);
  });

  it('sets isSearching true when search starts', () => {
    const { result } = renderHook(() => useStreamingSearch('/api/search/stream'));

    act(() => {
      result.current.search('test');
    });

    expect(result.current.isSearching).toBe(true);
  });

  it('updates pending from pending event', () => {
    const { result } = renderHook(() => useStreamingSearch('/api/search/stream'));

    act(() => {
      result.current.search('test');
    });

    const es = MockEventSource.instances[0];
    act(() => {
      es.simulateMessage({ event: 'pending', sources: ['plex', 'immich'] });
    });

    expect(result.current.pending).toEqual(['plex', 'immich']);
  });

  it('accumulates results from results events', () => {
    const { result } = renderHook(() => useStreamingSearch('/api/search/stream'));

    act(() => {
      result.current.search('test');
    });

    const es = MockEventSource.instances[0];
    act(() => {
      es.simulateMessage({ event: 'results', source: 'plex', items: [{ id: '1' }], pending: ['immich'] });
    });

    expect(result.current.results).toEqual([{ id: '1' }]);
    expect(result.current.pending).toEqual(['immich']);

    act(() => {
      es.simulateMessage({ event: 'results', source: 'immich', items: [{ id: '2' }], pending: [] });
    });

    expect(result.current.results).toEqual([{ id: '1' }, { id: '2' }]);
  });

  it('clears pending and isSearching on complete', () => {
    const { result } = renderHook(() => useStreamingSearch('/api/search/stream'));

    act(() => {
      result.current.search('test');
    });

    const es = MockEventSource.instances[0];
    act(() => {
      es.simulateMessage({ event: 'pending', sources: ['plex'] });
      es.simulateMessage({ event: 'complete', totalMs: 100 });
    });

    expect(result.current.pending).toEqual([]);
    expect(result.current.isSearching).toBe(false);
  });

  it('cancels previous search when new search starts', () => {
    const { result } = renderHook(() => useStreamingSearch('/api/search/stream'));

    act(() => {
      result.current.search('first');
    });

    const firstEs = MockEventSource.instances[0];

    act(() => {
      result.current.search('second');
    });

    expect(firstEs.readyState).toBe(2); // Closed
    expect(MockEventSource.instances.length).toBe(2);
  });

  it('ignores short queries', () => {
    const { result } = renderHook(() => useStreamingSearch('/api/search/stream'));

    act(() => {
      result.current.search('a');
    });

    expect(result.current.isSearching).toBe(false);
    expect(MockEventSource.instances.length).toBe(0);
  });

  it('clears state when search cleared', () => {
    const { result } = renderHook(() => useStreamingSearch('/api/search/stream'));

    act(() => {
      result.current.search('test');
    });

    const es = MockEventSource.instances[0];
    act(() => {
      es.simulateMessage({ event: 'results', source: 'plex', items: [{ id: '1' }], pending: [] });
    });

    act(() => {
      result.current.search('');
    });

    expect(result.current.results).toEqual([]);
    expect(result.current.pending).toEqual([]);
    expect(result.current.isSearching).toBe(false);
  });
});
