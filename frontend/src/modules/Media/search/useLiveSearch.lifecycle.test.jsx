import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useLiveSearch } from './useLiveSearch.js';

class MockEventSource {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    MockEventSource.instances.push(this);
  }

  close() { this.readyState = 2; }
  message(data) { this.onmessage?.({ data: JSON.stringify(data) }); }
}

describe('useLiveSearch query generation lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('revokes query A synchronously when B is typed and never presents a late A result under B', () => {
    // Break caught: changing the wrapper's displayed query while its old SSE
    // generation remains live lets a late A callback appear as a result for B.
    const { result } = renderHook(() => useLiveSearch());
    act(() => { result.current.setQuery('alpha'); });
    act(() => { vi.advanceTimersByTime(300); });
    const alpha = MockEventSource.instances[0];
    expect(alpha).toBeDefined();

    act(() => { result.current.setQuery('beta'); });
    expect(alpha.readyState).toBe(2);
    act(() => {
      alpha.message({
        event: 'results', source: 'plex', pending: [],
        items: [{ id: 'plex:alpha', title: 'Alpha' }],
      });
    });
    expect(result.current.results).toEqual([]);
    expect(result.current.state.results).toEqual([]);

    act(() => { vi.advanceTimersByTime(300); });
    const beta = MockEventSource.instances[1];
    act(() => {
      beta.message({
        event: 'results', source: 'plex', pending: [],
        items: [{ id: 'plex:beta', title: 'Beta' }],
      });
      beta.message({ event: 'complete' });
    });
    expect(result.current.state.query).toBe('beta');
    expect(result.current.state.results.map((item) => item.id)).toEqual(['plex:beta']);
  });
});
