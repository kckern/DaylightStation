// frontend/src/hooks/useStreamingSearch.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useStreamingSearch,
  mergeSearchResults,
  scoreSearchResult,
  looksLikeMachineTitle,
} from './useStreamingSearch.js';

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
    vi.useRealTimers();
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

    expect(result.current.results).toMatchObject([{ id: '1' }]);
    expect(result.current.pending).toEqual(['immich']);

    act(() => {
      es.simulateMessage({ event: 'results', source: 'immich', items: [{ id: '2' }], pending: [] });
    });

    expect(result.current.results).toMatchObject([{ id: '1' }, { id: '2' }]);
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

  it('exposes error state on connection error', () => {
    const { result } = renderHook(() => useStreamingSearch('/api/search/stream'));
    act(() => { result.current.search('hello'); });
    act(() => { MockEventSource.instances[0].simulateError(); });
    expect(result.current.error).toMatchObject({ kind: 'connection' });
    expect(result.current.isSearching).toBe(false);
  });

  it('exposes error state on stream error event', () => {
    const { result } = renderHook(() => useStreamingSearch('/api/search/stream'));
    act(() => { result.current.search('hello'); });
    act(() => {
      MockEventSource.instances[0].simulateMessage({ event: 'error', message: 'adapter blew up' });
    });
    expect(result.current.error).toMatchObject({ kind: 'stream', message: 'adapter blew up' });
  });

  it('clears error on a fresh search', () => {
    const { result } = renderHook(() => useStreamingSearch('/api/search/stream'));
    act(() => { result.current.search('hello'); });
    act(() => { MockEventSource.instances[0].simulateError(); });
    expect(result.current.error).not.toBeNull();
    act(() => { result.current.search('world'); });
    expect(result.current.error).toBeNull();
  });

  it('collects per-source errors without aborting the stream', () => {
    const { result } = renderHook(() => useStreamingSearch('/api/search/stream'));
    act(() => { result.current.search('hello'); });
    const es = MockEventSource.instances[0];
    act(() => {
      es.simulateMessage({ event: 'source_error', source: 'abs', error: 'ECONNREFUSED' });
      es.simulateMessage({ event: 'results', source: 'plex', items: [{ id: '1' }], pending: [] });
    });
    expect(result.current.sourceErrors).toEqual([{ source: 'abs', error: 'ECONNREFUSED' }]);
    expect(result.current.results).toMatchObject([{ id: '1' }]); // stream kept going
    expect(result.current.error).toBeNull();               // not a fatal error
  });

  it('source_error removes the failed source from pending', () => {
    const { result } = renderHook(() => useStreamingSearch('/api/search/stream'));
    act(() => { result.current.search('hello'); });
    const es = MockEventSource.instances[0];
    act(() => {
      es.simulateMessage({ event: 'pending', sources: ['plex', 'abs'] });
      es.simulateMessage({ event: 'source_error', source: 'abs', error: 'down', pending: ['plex'] });
    });
    expect(result.current.pending).toEqual(['plex']);
  });

  it('clears source errors on a fresh search', () => {
    const { result } = renderHook(() => useStreamingSearch('/api/search/stream'));
    act(() => { result.current.search('hello'); });
    act(() => {
      MockEventSource.instances[0].simulateMessage({ event: 'source_error', source: 'abs', error: 'x' });
    });
    expect(result.current.sourceErrors).toHaveLength(1);
    act(() => { result.current.search('world'); });
    expect(result.current.sourceErrors).toEqual([]);
  });

  it('ends a stream that never opens at its bounded deadline as a retryable failure', () => {
    // Break caught: removing the client deadline leaves the consumer spinner
    // active forever when the SSE handshake never produces an event.
    vi.useFakeTimers();
    const { result } = renderHook(() => useStreamingSearch('/api/search/stream', '', { streamDeadlineMs: 30 }));

    act(() => { result.current.search('arrival'); });
    const es = MockEventSource.instances[0];
    act(() => { vi.advanceTimersByTime(30); });

    expect(es.readyState).toBe(2);
    expect(result.current.isSearching).toBe(false);
    expect(result.current.error).toMatchObject({ kind: 'timeout' });
    expect(result.current.sourceErrors).toEqual([]);
  });

  it('keeps partial results and identifies only known unanswered sources when the stream expires', () => {
    // Break caught: timeout cleanup that clears results, or guesses adapters
    // before a pending event has named them.
    vi.useFakeTimers();
    const { result } = renderHook(() => useStreamingSearch('/api/search/stream', '', { streamDeadlineMs: 30 }));

    act(() => { result.current.search('arrival'); });
    const es = MockEventSource.instances[0];
    act(() => {
      es.simulateMessage({ event: 'pending', sources: ['plex', 'abs'] });
      es.simulateMessage({ event: 'results', source: 'plex', items: [{ id: 'plex:arrival', title: 'Arrival' }], pending: ['abs'] });
      vi.advanceTimersByTime(30);
    });

    expect(result.current.results.map((item) => item.id)).toEqual(['plex:arrival']);
    expect(result.current.pending).toEqual([]);
    expect(result.current.sourceErrors).toEqual([{ source: 'abs', error: 'Search stream timed out.' }]);
    expect(result.current.error).toMatchObject({ kind: 'timeout' });
  });

  it('consumes the answered-empty service frame so only the still-pending source is blamed', () => {
    // This is the client half of ContentQueryService's results/items:[]
    // protocol: an answered-empty source is removed before its sibling hits
    // the bounded deadline.
    vi.useFakeTimers();
    const { result } = renderHook(() => useStreamingSearch('/api/search/stream', '', { streamDeadlineMs: 30 }));
    act(() => { result.current.search('arrival'); });
    const es = MockEventSource.instances[0];
    act(() => {
      es.simulateMessage({ event: 'pending', sources: ['empty', 'slow'] });
      es.simulateMessage({ event: 'results', source: 'empty', items: [], pending: ['slow'] });
      vi.advanceTimersByTime(30);
    });

    expect(result.current.sourceErrors).toEqual([{ source: 'slow', error: 'Search stream timed out.' }]);
  });

  it('revokes a superseded request timer and ignores its late callbacks', () => {
    // Break caught: an old EventSource or deadline changing the newer query's
    // loading/error/results state after a user types again.
    vi.useFakeTimers();
    const { result } = renderHook(() => useStreamingSearch('/api/search/stream', '', { streamDeadlineMs: 30 }));

    act(() => { result.current.search('first'); });
    const first = MockEventSource.instances[0];
    act(() => {
      vi.advanceTimersByTime(20);
      result.current.search('second');
      vi.advanceTimersByTime(11);
      first.simulateMessage({ event: 'results', source: 'plex', items: [{ id: 'plex:stale' }], pending: [] });
      first.simulateError();
    });

    expect(first.readyState).toBe(2);
    expect(result.current.isSearching).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.results).toEqual([]);
  });

  it('does not let late terminal callbacks revive a completed request', () => {
    // Break caught: retaining the completed EventSource as current lets a late
    // browser error replace the successful terminal state.
    vi.useFakeTimers();
    const { result } = renderHook(() => useStreamingSearch('/api/search/stream', '', { streamDeadlineMs: 30 }));

    act(() => { result.current.search('arrival'); });
    const es = MockEventSource.instances[0];
    act(() => {
      es.simulateMessage({ event: 'complete' });
      es.simulateError();
      vi.advanceTimersByTime(30);
    });

    expect(result.current.isSearching).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('retries only a failed source without discarding successful results', () => {
    // Break caught: a per-source Retry reopening the catalog-wide request and
    // clearing the already-successful source's result set.
    const { result } = renderHook(() => useStreamingSearch('/api/search/stream', 'capability=listable'));

    act(() => { result.current.search('arrival'); });
    const first = MockEventSource.instances[0];
    act(() => {
      first.simulateMessage({ event: 'pending', sources: ['plex', 'abs'] });
      first.simulateMessage({ event: 'results', source: 'plex', items: [{ id: 'plex:arrival', title: 'Arrival' }], pending: ['abs'] });
      first.simulateMessage({ event: 'source_error', source: 'abs', error: 'offline', pending: [] });
      first.simulateMessage({ event: 'complete' });
      result.current.retry('abs');
    });

    const retry = MockEventSource.instances[1];
    expect(retry.url).toContain('text=arrival');
    expect(retry.url).toContain('capability=listable');
    expect(retry.url).toContain('source=abs');
    expect(result.current.results.map((item) => item.id)).toEqual(['plex:arrival']);
    expect(result.current.sourceErrors).toEqual([]);

    act(() => {
      retry.simulateMessage({ event: 'results', source: 'abs', items: [{ id: 'abs:arrival', title: 'Arrival audiobook' }], pending: [] });
      retry.simulateMessage({ event: 'complete' });
    });
    expect(result.current.results.map((item) => item.id)).toEqual(['plex:arrival', 'abs:arrival']);
  });

  it('keeps an ongoing primary source alive while its failed sibling retries', () => {
    // Break caught: implementing source retry by calling search() retires the
    // still-pending primary stream, losing its later valid batch.
    const { result } = renderHook(() => useStreamingSearch('/api/search/stream', 'capability=listable&scope=kids'));

    act(() => { result.current.search('arrival'); });
    const primary = MockEventSource.instances[0];
    act(() => {
      primary.simulateMessage({ event: 'pending', sources: ['plex', 'abs'] });
      primary.simulateMessage({ event: 'source_error', source: 'abs', error: 'offline', pending: ['plex'] });
      result.current.retry('abs');
    });
    const retry = MockEventSource.instances[1];

    expect(primary.readyState).toBe(0);
    expect(retry.url).toContain('scope=kids');
    expect(retry.url).toContain('source=abs');
    expect(result.current.pending).toEqual(expect.arrayContaining(['plex', 'abs']));

    act(() => {
      primary.simulateMessage({ event: 'results', source: 'plex', items: [{ id: 'plex:arrival', title: 'Arrival' }], pending: [] });
      primary.simulateMessage({ event: 'complete' });
      retry.simulateMessage({ event: 'results', source: 'abs', items: [{ id: 'abs:arrival', title: 'Arrival audiobook' }], pending: [] });
      retry.simulateMessage({ event: 'complete' });
    });

    expect(result.current.results.map((item) => item.id)).toEqual(['plex:arrival', 'abs:arrival']);
    expect(result.current.isSearching).toBe(false);
  });

  it('does not open a duplicate source retry or accept its callbacks after a newer search', () => {
    // Break caught: repeated taps create competing retries, and an old retry
    // can still add results after the query has moved on.
    const { result } = renderHook(() => useStreamingSearch('/api/search/stream'));

    act(() => { result.current.search('arrival'); });
    const first = MockEventSource.instances[0];
    act(() => {
      first.simulateMessage({ event: 'source_error', source: 'abs', error: 'offline', pending: [] });
      first.simulateMessage({ event: 'complete' });
      result.current.retry('abs');
      result.current.retry('abs');
    });

    expect(MockEventSource.instances).toHaveLength(2);
    const oldRetry = MockEventSource.instances[1];
    act(() => {
      result.current.search('bluey');
      oldRetry.simulateMessage({ event: 'results', source: 'abs', items: [{ id: 'abs:stale', title: 'Stale' }], pending: [] });
      oldRetry.simulateError();
    });

    expect(oldRetry.readyState).toBe(2);
    expect(result.current.results).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.isSearching).toBe(true);
  });

  it('keeps known unanswered primary sources retryable when the connection ends', () => {
    // Break caught: terminal connection cleanup clears the pending identities
    // before sourceErrors can name the adapters that did not answer.
    const { result } = renderHook(() => useStreamingSearch('/api/search/stream', 'scope=kids'));
    act(() => { result.current.search('arrival'); });
    const primary = MockEventSource.instances[0];
    act(() => {
      primary.simulateMessage({ event: 'pending', sources: ['plex', 'abs'] });
      primary.simulateMessage({ event: 'results', source: 'plex', items: [{ id: 'plex:arrival', title: 'Arrival' }], pending: ['abs'] });
      primary.simulateError();
    });

    expect(result.current.results.map((item) => item.id)).toEqual(['plex:arrival']);
    expect(result.current.sourceErrors).toEqual([{ source: 'abs', error: 'Lost connection to the search service.' }]);
    act(() => { result.current.retry('abs'); });
    expect(MockEventSource.instances[1].url).toContain('scope=kids');
    expect(MockEventSource.instances[1].url).toContain('source=abs');
  });

  it('keeps known unanswered primary sources retryable when an SSE error event ends the stream', () => {
    // Break caught: `{ event: "error" }` used a separate terminal path from
    // onerror and discarded the named pending source before it reached UI.
    const { result } = renderHook(() => useStreamingSearch('/api/search/stream'));
    act(() => { result.current.search('arrival'); });
    const primary = MockEventSource.instances[0];
    act(() => {
      primary.simulateMessage({ event: 'pending', sources: ['abs'] });
      primary.simulateMessage({ event: 'error', message: 'stream closed' });
    });

    expect(result.current.sourceErrors).toEqual([{ source: 'abs', error: 'stream closed' }]);
    expect(result.current.error).toMatchObject({ kind: 'stream', message: 'stream closed' });
  });

  it('restores a targeted retry source as failed when that retry connection ends', () => {
    // Break caught: starting a retry removes its old source error, then an
    // onerror loses that identity and leaves only a misleading global retry.
    const { result } = renderHook(() => useStreamingSearch('/api/search/stream'));
    act(() => { result.current.search('arrival'); });
    const primary = MockEventSource.instances[0];
    act(() => {
      primary.simulateMessage({ event: 'source_error', source: 'abs', error: 'offline', pending: [] });
      primary.simulateMessage({ event: 'complete' });
      result.current.retry('abs');
      MockEventSource.instances[1].simulateError();
    });

    expect(result.current.sourceErrors).toEqual([{ source: 'abs', error: 'Lost connection to the search service.' }]);
    expect(result.current.error).toMatchObject({ kind: 'connection' });
  });

  it('does not blame a retry source that returned results when only completion is missing', () => {
    // Break caught: retry timeout always re-adds its source error even after
    // that source has delivered a valid result batch.
    vi.useFakeTimers();
    const { result } = renderHook(() => useStreamingSearch('/api/search/stream', '', { streamDeadlineMs: 30 }));
    act(() => { result.current.search('arrival'); });
    const primary = MockEventSource.instances[0];
    act(() => {
      primary.simulateMessage({ event: 'source_error', source: 'abs', error: 'offline', pending: [] });
      primary.simulateMessage({ event: 'complete' });
      result.current.retry('abs');
      MockEventSource.instances[1].simulateMessage({ event: 'results', source: 'abs', items: [{ id: 'abs:arrival', title: 'Arrival audiobook' }], pending: [] });
      vi.advanceTimersByTime(30);
    });

    expect(result.current.results.map((item) => item.id)).toEqual(['abs:arrival']);
    expect(result.current.sourceErrors).toEqual([]);
    expect(result.current.error).toMatchObject({ kind: 'timeout' });
  });

  it('keeps the primary unanswered source exactly once when onerror races its deadline', () => {
    // Break caught: backend's 30s close can surface as onerror at the client
    // deadline; either terminal order must retain one truthful source error.
    vi.useFakeTimers();
    const { result } = renderHook(() => useStreamingSearch('/api/search/stream', '', { streamDeadlineMs: 30 }));
    act(() => { result.current.search('arrival'); });
    const primary = MockEventSource.instances[0];
    act(() => {
      primary.simulateMessage({ event: 'pending', sources: ['abs'] });
      vi.advanceTimersByTime(29);
      primary.simulateError();
      vi.advanceTimersByTime(1);
    });

    expect(result.current.sourceErrors).toEqual([{ source: 'abs', error: 'Lost connection to the search service.' }]);
    expect(result.current.error).toMatchObject({ kind: 'connection' });
  });

  it('keeps a targeted retry source exactly once when onerror races its deadline', () => {
    // Break caught: targeted retries had a separate terminal path that could
    // erase the source identity as the server deadline closed the SSE stream.
    vi.useFakeTimers();
    const { result } = renderHook(() => useStreamingSearch('/api/search/stream', '', { streamDeadlineMs: 30 }));
    act(() => { result.current.search('arrival'); });
    const primary = MockEventSource.instances[0];
    act(() => {
      primary.simulateMessage({ event: 'source_error', source: 'abs', error: 'offline', pending: [] });
      primary.simulateMessage({ event: 'complete' });
      result.current.retry('abs');
      const retry = MockEventSource.instances[1];
      retry.simulateMessage({ event: 'pending', sources: ['abs'] });
      vi.advanceTimersByTime(29);
      retry.simulateError();
      vi.advanceTimersByTime(1);
    });

    expect(result.current.sourceErrors).toEqual([{ source: 'abs', error: 'Lost connection to the search service.' }]);
    expect(result.current.error).toMatchObject({ kind: 'connection' });
  });

  describe('relevance ordering', () => {
    it('ranks an exact title match above junk that arrived first', () => {
      const { result } = renderHook(() => useStreamingSearch('/api/search/stream'));
      act(() => { result.current.search('bluey'); });
      const es = MockEventSource.instances[0];
      act(() => {
        es.simulateMessage({
          event: 'results', source: 'files',
          items: [{ id: 'files:a', title: '20240115_garage_workout_recording_take2.mp4' }],
          pending: ['plex'],
        });
        es.simulateMessage({
          event: 'results', source: 'plex',
          items: [{ id: 'plex:1', title: 'Bluey (2018)', type: 'show' }],
          pending: [],
        });
      });
      expect(result.current.results.map((r) => r.id)).toEqual(['plex:1', 'files:a']);
    });

    it('prefers backend-provided score over local fallback', () => {
      const { result } = renderHook(() => useStreamingSearch('/api/search/stream'));
      act(() => { result.current.search('bluey'); });
      const es = MockEventSource.instances[0];
      act(() => {
        es.simulateMessage({
          event: 'results', source: 'plex',
          items: [
            { id: 'plex:low', title: 'Bluey', score: 1 },
            { id: 'plex:high', title: 'Unrelated Thing', score: 500 },
          ],
          pending: [],
        });
      });
      expect(result.current.results.map((r) => r.id)).toEqual(['plex:high', 'plex:low']);
    });

    it('keeps arrival order for equal scores (stable ties)', () => {
      const { result } = renderHook(() => useStreamingSearch('/api/search/stream'));
      act(() => { result.current.search('zz'); });
      const es = MockEventSource.instances[0];
      act(() => {
        es.simulateMessage({
          event: 'results', source: 'plex',
          items: [{ id: 'plex:1', title: 'Alpha One' }, { id: 'plex:2', title: 'Beta Two' }],
          pending: ['files'],
        });
        es.simulateMessage({
          event: 'results', source: 'files',
          items: [{ id: 'files:3', title: 'Gamma Three' }],
          pending: [],
        });
      });
      expect(result.current.results.map((r) => r.id)).toEqual(['plex:1', 'plex:2', 'files:3']);
    });

    it('dedupes repeated item ids — first occurrence wins', () => {
      const { result } = renderHook(() => useStreamingSearch('/api/search/stream'));
      act(() => { result.current.search('test'); });
      const es = MockEventSource.instances[0];
      act(() => {
        es.simulateMessage({
          event: 'results', source: 'files',
          items: [{ id: 'files:dup', title: 'Test Song' }, { id: 'files:dup', title: 'Test Song' }],
          pending: ['files'],
        });
        es.simulateMessage({
          event: 'results', source: 'files',
          items: [{ id: 'files:dup', title: 'Test Song (echo)' }],
          pending: [],
        });
      });
      expect(result.current.results).toHaveLength(1);
      expect(result.current.results[0].title).toBe('Test Song');
    });

    it('collapses plex+abs near-duplicates to the plex item (either arrival order)', () => {
      const { result } = renderHook(() => useStreamingSearch('/api/search/stream'));
      act(() => { result.current.search('holes'); });
      const es = MockEventSource.instances[0];
      act(() => {
        es.simulateMessage({
          event: 'results', source: 'abs',
          items: [{ id: 'abs:9', title: 'Holes', mediaType: 'audio' }],
          pending: ['plex'],
        });
        es.simulateMessage({
          event: 'results', source: 'plex',
          items: [{ id: 'plex:9', title: 'Holes', mediaType: 'audio' }],
          pending: [],
        });
      });
      expect(result.current.results.map((r) => r.id)).toEqual(['plex:9']);

      // Reverse order: plex first, abs dropped on arrival.
      act(() => { result.current.search('holes again'); });
      const es2 = MockEventSource.instances[1];
      act(() => {
        es2.simulateMessage({
          event: 'results', source: 'plex',
          items: [{ id: 'plex:9', title: 'Holes', mediaType: 'audio' }],
          pending: ['abs'],
        });
        es2.simulateMessage({
          event: 'results', source: 'abs',
          items: [{ id: 'abs:9', title: 'Holes', mediaType: 'audio' }],
          pending: [],
        });
      });
      expect(result.current.results.map((r) => r.id)).toEqual(['plex:9']);
    });

    it('does NOT collapse same-source title twins (two episodes named "Pilot")', () => {
      const { result } = renderHook(() => useStreamingSearch('/api/search/stream'));
      act(() => { result.current.search('pilot'); });
      const es = MockEventSource.instances[0];
      act(() => {
        es.simulateMessage({
          event: 'results', source: 'plex',
          items: [
            { id: 'plex:100', title: 'Pilot', mediaType: 'video' },
            { id: 'plex:200', title: 'Pilot', mediaType: 'video' },
          ],
          pending: [],
        });
      });
      expect(result.current.results).toHaveLength(2);
    });
  });
});

describe('scoreSearchResult (local fallback)', () => {
  it('scores exact > starts-with > contains > no match', () => {
    const q = 'bluey';
    const exact = scoreSearchResult({ title: 'Bluey' }, q);
    const starts = scoreSearchResult({ title: 'Bluey (2018)' }, q);
    const contains = scoreSearchResult({ title: 'Best of Bluey Vol 1' }, q);
    const none = scoreSearchResult({ title: 'Something Else' }, q);
    expect(exact).toBeGreaterThan(starts);
    expect(starts).toBeGreaterThan(contains);
    expect(contains).toBeGreaterThan(none);
  });

  it('gives containers (show/artist/album) a bonus over loose files', () => {
    const show = scoreSearchResult({ title: 'Bluey', type: 'show' }, 'bluey');
    const file = scoreSearchResult({ title: 'Bluey', type: 'video' }, 'bluey');
    expect(show).toBeGreaterThan(file);
  });

  it('penalizes machine-filename titles', () => {
    expect(scoreSearchResult({ title: '20240115_workout.mp4' }, 'workout'))
      .toBeLessThan(scoreSearchResult({ title: 'Morning Workout' }, 'workout'));
  });

  it('uses backend score verbatim when present', () => {
    expect(scoreSearchResult({ title: 'anything', score: 42 }, 'anything')).toBe(42);
  });
});

describe('looksLikeMachineTitle', () => {
  it('flags timestamp-prefixed and long space-less names', () => {
    expect(looksLikeMachineTitle('20240115_garage_workout.mp4')).toBe(true);
    expect(looksLikeMachineTitle('a_very_long_machine_generated_name')).toBe(true);
  });
  it('passes human titles', () => {
    expect(looksLikeMachineTitle('Bluey (2018)')).toBe(false);
    expect(looksLikeMachineTitle('Up')).toBe(false);
    expect(looksLikeMachineTitle('')).toBe(false);
  });
});

describe('mergeSearchResults', () => {
  it('inserts new batches in score order without mutating inputs', () => {
    const first = mergeSearchResults([], [{ id: 'a', title: 'Other Thing' }], 'bluey');
    const firstSnapshot = [...first];
    const second = mergeSearchResults(first, [{ id: 'b', title: 'Bluey' }], 'bluey');
    expect(second.map((r) => r.id)).toEqual(['b', 'a']);
    expect(first).toEqual(firstSnapshot); // prev array untouched
  });
});
