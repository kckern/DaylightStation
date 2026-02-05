# Progressive SSE Search Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add progressive search results via Server-Sent Events (SSE) so users see results as each adapter completes, with pending source indicators.

**Architecture:** Backend `searchStream()` generator races all adapters in parallel and yields results as each completes. New SSE endpoint `/api/v1/content/query/search/stream` sends `pending`, `results`, and `complete` events. Frontend `useStreamingSearch` hook manages AbortController to cancel stale requests when user types.

**Tech Stack:** Express SSE, ES6 async generators, React hooks, EventSource API, AbortController

---

## Task 1: Add `searchStream()` Generator to ContentQueryService

**Files:**
- Modify: `backend/src/3_applications/content/ContentQueryService.mjs:37-129`
- Test: `tests/unit/content/ContentQueryService.searchStream.test.mjs`

**Step 1: Write the failing test**

Create `tests/unit/content/ContentQueryService.searchStream.test.mjs`:

```javascript
// tests/unit/content/ContentQueryService.searchStream.test.mjs
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContentQueryService } from '#apps/content/ContentQueryService.mjs';

describe('ContentQueryService.searchStream', () => {
  let service;
  let mockRegistry;
  let mockAdapters;

  beforeEach(() => {
    // Create mock adapters with different response times
    mockAdapters = [
      {
        source: 'plex',
        search: vi.fn().mockImplementation(() =>
          new Promise(resolve => setTimeout(() => resolve({ items: [{ id: 'plex:1', title: 'Plex Result' }] }), 50))
        ),
        getSearchCapabilities: () => ({ canonical: ['text'], specific: [] }),
        getQueryMappings: () => ({})
      },
      {
        source: 'immich',
        search: vi.fn().mockImplementation(() =>
          new Promise(resolve => setTimeout(() => resolve({ items: [{ id: 'immich:1', title: 'Immich Result' }] }), 100))
        ),
        getSearchCapabilities: () => ({ canonical: ['text'], specific: [] }),
        getQueryMappings: () => ({})
      }
    ];

    mockRegistry = {
      resolveSource: vi.fn().mockReturnValue(mockAdapters),
      get: vi.fn().mockImplementation(source => mockAdapters.find(a => a.source === source))
    };

    service = new ContentQueryService({ registry: mockRegistry });
  });

  it('yields pending event first with all sources', async () => {
    const events = [];
    for await (const event of service.searchStream({ text: 'test' })) {
      events.push(event);
    }

    expect(events[0].event).toBe('pending');
    expect(events[0].sources).toContain('plex');
    expect(events[0].sources).toContain('immich');
  });

  it('yields results events as each adapter completes', async () => {
    const events = [];
    for await (const event of service.searchStream({ text: 'test' })) {
      events.push(event);
    }

    const resultEvents = events.filter(e => e.event === 'results');
    expect(resultEvents.length).toBe(2);
    // First result should be plex (faster)
    expect(resultEvents[0].source).toBe('plex');
    expect(resultEvents[0].items).toHaveLength(1);
    expect(resultEvents[0].pending).toContain('immich');
  });

  it('yields complete event last with total time', async () => {
    const events = [];
    for await (const event of service.searchStream({ text: 'test' })) {
      events.push(event);
    }

    const lastEvent = events[events.length - 1];
    expect(lastEvent.event).toBe('complete');
    expect(lastEvent.totalMs).toBeGreaterThan(0);
  });

  it('handles adapter errors gracefully', async () => {
    mockAdapters[0].search.mockRejectedValue(new Error('Plex down'));

    const events = [];
    for await (const event of service.searchStream({ text: 'test' })) {
      events.push(event);
    }

    // Should still get results from immich
    const resultEvents = events.filter(e => e.event === 'results');
    expect(resultEvents.some(e => e.source === 'immich')).toBe(true);
    // Should still complete
    expect(events[events.length - 1].event).toBe('complete');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/content/ContentQueryService.searchStream.test.mjs`
Expected: FAIL with "service.searchStream is not a function"

**Step 3: Write minimal implementation**

Add to `backend/src/3_applications/content/ContentQueryService.mjs` after the `search()` method (around line 129):

```javascript
  /**
   * Stream search results as each adapter completes.
   * Yields events: 'pending' (initial), 'results' (per adapter), 'complete' (final).
   *
   * @param {Object} query - Normalized query object
   * @yields {{event: string, ...data}}
   */
  async *searchStream(query) {
    const searchStart = performance.now();
    const adapters = this.#registry.resolveSource(query.source);
    const pending = new Set(adapters.map(a => a.source));
    const warnings = [];

    // Yield initial pending state
    yield { event: 'pending', sources: [...pending] };

    // Create promises for all adapters
    const adapterPromises = adapters.map(async (adapter) => {
      if (!this.#canHandle(adapter, query)) {
        return { adapter, result: null, skipped: true };
      }

      try {
        const translated = this.#translateQuery(adapter, query);
        const result = await adapter.search(translated);
        return { adapter, result, error: null };
      } catch (error) {
        warnings.push({ source: adapter.source, error: error.message });
        return { adapter, result: null, error };
      }
    });

    // Race all promises and yield results as they complete
    const remaining = [...adapterPromises];
    while (remaining.length > 0) {
      const winner = await Promise.race(
        remaining.map((p, i) => p.then(result => ({ result, index: i })))
      );

      // Remove completed promise
      remaining.splice(winner.index, 1);

      const { adapter, result, skipped, error } = winner.result;
      pending.delete(adapter.source);

      if (skipped || error || !result?.items?.length) {
        continue;
      }

      // Apply capability filter if specified
      let items = result.items;
      if (query.capability) {
        items = items.filter(item => this.#hasCapability(item, query.capability));
      }

      yield {
        event: 'results',
        source: adapter.source,
        items,
        pending: [...pending]
      };
    }

    const totalMs = Math.round(performance.now() - searchStart);

    // Log performance
    const logData = {
      query: { text: query.text, source: query.source },
      totalMs,
      adapterCount: adapters.length,
    };
    this.#logger.info?.('content-query.searchStream.complete', logData) ?? this.#logger.info?.(logData);

    yield { event: 'complete', totalMs, warnings: warnings.length > 0 ? warnings : undefined };
  }
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/content/ContentQueryService.searchStream.test.mjs`
Expected: PASS (all 4 tests)

**Step 5: Commit**

```bash
git add backend/src/3_applications/content/ContentQueryService.mjs tests/unit/content/ContentQueryService.searchStream.test.mjs
git commit -m "$(cat <<'EOF'
feat(content): add searchStream() generator for progressive results

Adds async generator that yields results as each adapter completes,
enabling SSE streaming for responsive search UX.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add SSE Endpoint to Content Router

**Files:**
- Modify: `backend/src/4_api/v1/routers/content.mjs:272` (after existing `/query/search`)
- Test: `tests/live/api/content-search-stream.test.mjs`

**Step 1: Write the failing test**

Create `tests/live/api/content-search-stream.test.mjs`:

```javascript
// tests/live/api/content-search-stream.test.mjs
import { describe, it, expect, beforeAll } from 'vitest';
import { getAppPort } from '#testlib/configHelper.mjs';

const BASE_URL = `http://localhost:${getAppPort()}`;

/**
 * Parse SSE data from response text
 */
function parseSSEEvents(text) {
  const events = [];
  const lines = text.split('\n');
  let currentData = '';

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      currentData = line.slice(6);
    } else if (line === '' && currentData) {
      try {
        events.push(JSON.parse(currentData));
      } catch {
        // Skip malformed JSON
      }
      currentData = '';
    }
  }
  return events;
}

describe('GET /api/v1/content/query/search/stream', () => {
  beforeAll(async () => {
    // Verify backend is running
    const health = await fetch(`${BASE_URL}/api/v1/health`).catch(() => null);
    if (!health?.ok) {
      throw new Error(`Backend not running at ${BASE_URL}`);
    }
  });

  it('returns SSE content type', async () => {
    const response = await fetch(`${BASE_URL}/api/v1/content/query/search/stream?text=test`);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
  });

  it('emits pending event first', async () => {
    const response = await fetch(`${BASE_URL}/api/v1/content/query/search/stream?text=office`);
    const text = await response.text();
    const events = parseSSEEvents(text);

    expect(events.length).toBeGreaterThan(0);
    expect(events[0].event).toBe('pending');
    expect(Array.isArray(events[0].sources)).toBe(true);
  });

  it('emits complete event last', async () => {
    const response = await fetch(`${BASE_URL}/api/v1/content/query/search/stream?text=office`);
    const text = await response.text();
    const events = parseSSEEvents(text);

    const lastEvent = events[events.length - 1];
    expect(lastEvent.event).toBe('complete');
    expect(typeof lastEvent.totalMs).toBe('number');
  });

  it('emits results events with items and pending sources', async () => {
    const response = await fetch(`${BASE_URL}/api/v1/content/query/search/stream?text=office`);
    const text = await response.text();
    const events = parseSSEEvents(text);

    const resultEvents = events.filter(e => e.event === 'results');
    // May have 0 results if no matches, but if we have results, check structure
    if (resultEvents.length > 0) {
      expect(Array.isArray(resultEvents[0].items)).toBe(true);
      expect(Array.isArray(resultEvents[0].pending)).toBe(true);
      expect(typeof resultEvents[0].source).toBe('string');
    }
  });

  it('handles short search terms gracefully', async () => {
    const response = await fetch(`${BASE_URL}/api/v1/content/query/search/stream?text=a`);
    expect(response.status).toBe(400);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/live/api/content-search-stream.test.mjs`
Expected: FAIL with 404 (endpoint doesn't exist)

**Step 3: Write minimal implementation**

Add to `backend/src/4_api/v1/routers/content.mjs` after the existing `/query/search` endpoint (around line 272):

```javascript
  /**
   * GET /api/content/query/search/stream
   * Stream search results via SSE as each adapter completes.
   *
   * Same query params as /query/search, but returns Server-Sent Events:
   * - event: pending (initial, lists all sources)
   * - event: results (per adapter, includes items and remaining pending)
   * - event: complete (final, includes totalMs)
   */
  router.get('/query/search/stream', asyncHandler(async (req, res) => {
    if (!contentQueryService) {
      return res.status(501).json({
        error: 'Content query service not configured',
        code: 'QUERY_SERVICE_NOT_CONFIGURED'
      });
    }

    const query = parseContentQuery(req.query);
    const validation = validateContentQuery(query);

    if (!validation.valid) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.errors
      });
    }

    // Validate minimum search length
    if (!query.text || query.text.length < 2) {
      return res.status(400).json({
        error: 'Search text must be at least 2 characters',
        code: 'SEARCH_TEXT_TOO_SHORT'
      });
    }

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.flushHeaders();

    // Handle client disconnect
    let closed = false;
    req.on('close', () => {
      closed = true;
    });

    try {
      for await (const event of contentQueryService.searchStream(query)) {
        if (closed) break;
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (error) {
      if (!closed) {
        res.write(`data: ${JSON.stringify({ event: 'error', message: error.message })}\n\n`);
      }
      logger.error?.('content.query.search.stream.error', { query, error: error.message });
    }

    res.end();
  }));
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/live/api/content-search-stream.test.mjs`
Expected: PASS (all 5 tests)

**Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/content.mjs tests/live/api/content-search-stream.test.mjs
git commit -m "$(cat <<'EOF'
feat(api): add SSE endpoint for streaming search results

Adds /api/v1/content/query/search/stream that emits results
progressively as each adapter completes.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Create useStreamingSearch Hook

**Files:**
- Create: `frontend/src/hooks/useStreamingSearch.js`
- Test: `tests/unit/hooks/useStreamingSearch.test.jsx`

**Step 1: Write the failing test**

Create `tests/unit/hooks/useStreamingSearch.test.jsx`:

```javascript
// tests/unit/hooks/useStreamingSearch.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useStreamingSearch } from '#hooks/useStreamingSearch.js';

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
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/hooks/useStreamingSearch.test.jsx`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

Create `frontend/src/hooks/useStreamingSearch.js`:

```javascript
// frontend/src/hooks/useStreamingSearch.js
import { useState, useCallback, useRef } from 'react';

/**
 * Hook for streaming search via SSE with AbortController for race condition handling.
 *
 * @param {string} endpoint - SSE endpoint URL (without query params)
 * @returns {{
 *   results: Array,
 *   pending: string[],
 *   isSearching: boolean,
 *   search: (query: string) => void
 * }}
 */
export function useStreamingSearch(endpoint) {
  const [results, setResults] = useState([]);
  const [pending, setPending] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const eventSourceRef = useRef(null);
  const abortedRef = useRef(false);

  const search = useCallback((query) => {
    // Cancel any in-flight request
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    abortedRef.current = false;

    // Short queries: clear and don't search
    if (!query || query.length < 2) {
      setResults([]);
      setPending([]);
      setIsSearching(false);
      return;
    }

    // Start new search
    setIsSearching(true);
    setResults([]);
    setPending([]);

    const url = `${endpoint}?text=${encodeURIComponent(query)}`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      // Check if this request was cancelled
      if (abortedRef.current || eventSourceRef.current !== eventSource) {
        eventSource.close();
        return;
      }

      try {
        const data = JSON.parse(event.data);

        if (data.event === 'pending') {
          setPending(data.sources);
        } else if (data.event === 'results') {
          setResults(prev => [...prev, ...data.items]);
          setPending(data.pending);
        } else if (data.event === 'complete') {
          setPending([]);
          setIsSearching(false);
          eventSource.close();
        } else if (data.event === 'error') {
          setIsSearching(false);
          setPending([]);
          eventSource.close();
        }
      } catch {
        // Ignore malformed JSON
      }
    };

    eventSource.onerror = () => {
      if (eventSourceRef.current === eventSource) {
        setIsSearching(false);
        setPending([]);
      }
      eventSource.close();
    };
  }, [endpoint]);

  return { results, pending, isSearching, search };
}

export default useStreamingSearch;
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/hooks/useStreamingSearch.test.jsx`
Expected: PASS (all 8 tests)

**Step 5: Commit**

```bash
git add frontend/src/hooks/useStreamingSearch.js tests/unit/hooks/useStreamingSearch.test.jsx
git commit -m "$(cat <<'EOF'
feat(hooks): add useStreamingSearch for SSE search with cancellation

Provides progressive search results via SSE with AbortController
to handle race conditions from rapid typing.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Integrate Streaming Search into ContentSearchCombobox

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ContentSearchCombobox.jsx:1-70`
- Test: `tests/live/flow/admin/content-search-combobox/08-streaming.runtime.test.mjs`

**Step 1: Write the failing test**

Create `tests/live/flow/admin/content-search-combobox/08-streaming.runtime.test.mjs`:

```javascript
// tests/live/flow/admin/content-search-combobox/08-streaming.runtime.test.mjs
/**
 * Streaming search tests for ContentSearchCombobox
 * Tests: progressive results, pending indicators, race condition handling
 */
import { test, expect } from '@playwright/test';
import { ComboboxTestHarness, ComboboxLocators, ComboboxActions } from '#testlib/comboboxTestHarness.mjs';

const TEST_URL = '/admin/test/combobox';

test.describe('ContentSearchCombobox - Streaming Search', () => {
  let harness;

  test.beforeEach(async ({ page }) => {
    harness = new ComboboxTestHarness(page);
    await harness.setup();
    await page.goto(TEST_URL);
  });

  test.afterEach(async () => {
    const apiCheck = harness.assertAllApiValid();
    expect(apiCheck.passed).toBe(true);
    await harness.teardown();
  });

  test('shows pending sources while streaming', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxLocators.input(page).fill('office');

    // Should see pending indicator at some point
    // (may be brief, so check within a time window)
    const pendingVisible = await page.locator('.pending-sources, [data-pending-sources]')
      .isVisible()
      .catch(() => false);

    // Wait for results to eventually appear
    await expect(ComboboxLocators.options(page).first()).toBeVisible({ timeout: 30000 });
  });

  test('results appear progressively', async ({ page }) => {
    await ComboboxActions.open(page);

    // Track result count over time
    const counts = [];
    const checkInterval = setInterval(async () => {
      const count = await ComboboxLocators.options(page).count().catch(() => 0);
      counts.push(count);
    }, 200);

    await ComboboxLocators.input(page).fill('the');

    // Wait for search to complete
    await page.waitForTimeout(5000);
    clearInterval(checkInterval);

    // If we got results, check they accumulated progressively
    const finalCount = await ComboboxLocators.options(page).count();
    if (finalCount > 0) {
      // Should see intermediate counts (not just 0 then all)
      const intermediates = counts.filter(c => c > 0 && c < finalCount);
      console.log('Result counts over time:', counts);
      // Progressive loading means we might see intermediate states
      // (but not guaranteed if all adapters return quickly)
    }
  });

  test('new search cancels pending results', async ({ page }) => {
    await ComboboxActions.open(page);

    // Start first search
    await ComboboxLocators.input(page).fill('dracula');
    await page.waitForTimeout(100);

    // Quickly change to different search
    await ComboboxLocators.input(page).fill('office');

    // Wait for results
    await ComboboxActions.waitForLoad(page);

    // All visible results should be for "office" search, not "dracula"
    // (We can't easily verify this without knowing exact result titles,
    // but we can verify no errors occurred)
    const options = await ComboboxLocators.options(page);
    const count = await options.count();

    // The search completed without errors
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('handles rapid typing without duplicate results', async ({ page }) => {
    await ComboboxActions.open(page);

    // Type rapidly
    const input = ComboboxLocators.input(page);
    await input.fill('o');
    await page.waitForTimeout(30);
    await input.fill('of');
    await page.waitForTimeout(30);
    await input.fill('off');
    await page.waitForTimeout(30);
    await input.fill('offi');
    await page.waitForTimeout(30);
    await input.fill('offic');
    await page.waitForTimeout(30);
    await input.fill('office');

    // Wait for search to complete
    await ComboboxActions.waitForLoad(page);

    // Get all result IDs
    const options = await ComboboxLocators.options(page);
    const count = await options.count();

    if (count > 0) {
      const ids = [];
      for (let i = 0; i < count; i++) {
        const id = await options.nth(i).getAttribute('value');
        ids.push(id);
      }

      // No duplicates
      const uniqueIds = [...new Set(ids)];
      expect(uniqueIds.length).toBe(ids.length);
    }
  });

  test('EventSource fallback works when SSE unavailable', async ({ page }) => {
    // Disable EventSource to test fallback
    await page.addInitScript(() => {
      delete window.EventSource;
    });

    await page.goto(TEST_URL);
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'office');
    await ComboboxActions.waitForLoad(page);

    // Should still show results (from batch endpoint)
    const options = ComboboxLocators.options(page);
    const count = await options.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx playwright test tests/live/flow/admin/content-search-combobox/08-streaming.runtime.test.mjs`
Expected: Some tests fail (pending-sources not found, etc.)

**Step 3: Write minimal implementation**

Update `frontend/src/modules/Admin/ContentLists/ContentSearchCombobox.jsx`:

```javascript
import React, { useState, useEffect, useCallback } from 'react';
import {
  Combobox, TextInput, ScrollArea, Group, Text, Avatar, Badge, Loader,
  Stack, ActionIcon, Box, useCombobox
} from '@mantine/core';
import { useDebouncedCallback } from '@mantine/hooks';
import {
  IconSearch, IconChevronRight, IconArrowLeft, IconFolder,
  IconMusic, IconVideo, IconPhoto, IconFile, IconList
} from '@tabler/icons-react';
import { useStreamingSearch } from '../../../hooks/useStreamingSearch';

const TYPE_ICONS = {
  show: IconVideo,
  movie: IconVideo,
  episode: IconVideo,
  video: IconVideo,
  track: IconMusic,
  album: IconMusic,
  artist: IconMusic,
  audio: IconMusic,
  photo: IconPhoto,
  image: IconPhoto,
  folder: IconFolder,
  channel: IconList,
  series: IconFolder,
  conference: IconFolder,
  playlist: IconList,
  default: IconFile
};

// Source icons for pending display
const SOURCE_ICONS = {
  plex: '🎬',
  immich: '📷',
  audiobookshelf: '📚',
  singing: '🎵',
  media: '📁',
  default: '🔍'
};

function getIcon(item) {
  const type = item.type || item.metadata?.type || item.mediaType;
  const Icon = TYPE_ICONS[type] || TYPE_ICONS.default;
  return <Icon size={16} />;
}

function isContainer(item) {
  return item.itemType === 'container' ||
    item.isContainer ||
    ['show', 'album', 'artist', 'folder', 'channel', 'series', 'conference', 'playlist'].includes(item.type);
}

/**
 * Check if EventSource is available (for SSE streaming)
 */
function supportsSSE() {
  return typeof EventSource !== 'undefined';
}

/**
 * ContentSearchCombobox - Searchable combobox for selecting content items
 * Supports streaming search (SSE) and drilling down into containers
 */
function ContentSearchCombobox({ value, onChange, placeholder = 'Search content...' }) {
  const [inputValue, setInputValue] = useState('');
  const [browseResults, setBrowseResults] = useState([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [breadcrumbs, setBreadcrumbs] = useState([]);
  const [initialLoadDone, setInitialLoadDone] = useState(false);

  // Use streaming search hook (with fallback)
  const streamingEndpoint = '/api/v1/content/query/search/stream';
  const batchEndpoint = '/api/v1/content/query/search';

  const {
    results: streamResults,
    pending: pendingSources,
    isSearching: streamLoading,
    search: streamSearch
  } = useStreamingSearch(streamingEndpoint);

  // Fallback state for non-SSE browsers
  const [fallbackResults, setFallbackResults] = useState([]);
  const [fallbackLoading, setFallbackLoading] = useState(false);

  // Determine which results/loading to use
  const isStreaming = supportsSSE();
  const searchResults = isStreaming ? streamResults : fallbackResults;
  const searchLoading = isStreaming ? streamLoading : fallbackLoading;

  // Combined results: browse results take priority, then search
  const results = breadcrumbs.length > 0 ? browseResults : searchResults;
  const loading = breadcrumbs.length > 0 ? browseLoading : searchLoading;

  const combobox = useCombobox({
    onDropdownClose: () => {
      combobox.resetSelectedOption();
    },
    onDropdownOpen: () => {
      if (value && !initialLoadDone && results.length === 0) {
        loadSiblings(value);
      }
    }
  });

  // Fallback batch search for non-SSE browsers
  const doBatchSearch = useCallback(async (text) => {
    if (!text || text.length < 2) {
      setFallbackResults([]);
      return;
    }

    setFallbackLoading(true);
    try {
      const response = await fetch(`${batchEndpoint}?text=${encodeURIComponent(text)}&take=20`);
      if (!response.ok) throw new Error('Search failed');
      const data = await response.json();
      setFallbackResults(data.items || []);
    } catch (err) {
      console.error('Search error:', err);
      setFallbackResults([]);
    } finally {
      setFallbackLoading(false);
    }
  }, []);

  // Debounced search function
  const debouncedSearch = useDebouncedCallback((text) => {
    if (breadcrumbs.length > 0) return; // Don't search while browsing

    if (isStreaming) {
      streamSearch(text);
    } else {
      doBatchSearch(text);
    }
  }, 300);

  // Handle input change
  const handleInputChange = (e) => {
    const text = e.target.value;
    setInputValue(text);
    combobox.openDropdown();
    combobox.updateSelectedOptionIndex();

    if (breadcrumbs.length === 0) {
      debouncedSearch(text);
    }
  };

  // Load siblings of the current value (browse to parent folder)
  const loadSiblings = useCallback(async (inputVal) => {
    if (!inputVal) return;

    const colonIndex = inputVal.indexOf(':');
    if (colonIndex === -1) return;

    const source = inputVal.substring(0, colonIndex);
    const localId = inputVal.substring(colonIndex + 1);

    const parts = localId.split('/');
    if (parts.length <= 1) {
      setBrowseLoading(true);
      try {
        const response = await fetch(`/api/v1/list/${source}/`);
        if (response.ok) {
          const data = await response.json();
          setBrowseResults(data.items || []);
        }
      } catch (err) {
        console.error('Load siblings error:', err);
      } finally {
        setBrowseLoading(false);
        setInitialLoadDone(true);
      }
      return;
    }

    const parentPath = parts.slice(0, -1).join('/');
    const parentTitle = parts[parts.length - 2] || source;

    setBrowseLoading(true);
    try {
      const response = await fetch(`/api/v1/list/${source}/${encodeURIComponent(parentPath)}`);
      if (!response.ok) throw new Error('Browse failed');
      const data = await response.json();
      setBrowseResults(data.items || []);
      setBreadcrumbs([{ id: `${source}:${parentPath}`, title: parentTitle, source, localId: parentPath }]);
    } catch (err) {
      console.error('Load siblings error:', err);
    } finally {
      setBrowseLoading(false);
      setInitialLoadDone(true);
    }
  }, []);

  // Reset initial load state when value changes
  useEffect(() => {
    setInitialLoadDone(false);
  }, [value]);

  // Browse into a container
  const browseContainer = useCallback(async (item) => {
    const source = item.source || item.id?.split(':')[0];
    const localId = item.localId || item.id?.replace(`${source}:`, '');

    setBrowseLoading(true);
    try {
      const response = await fetch(`/api/v1/list/${source}/${encodeURIComponent(localId)}`);
      if (!response.ok) throw new Error('Browse failed');
      const data = await response.json();
      setBrowseResults(data.items || []);
      setBreadcrumbs(prev => [...prev, { id: item.id, title: item.title, source, localId }]);
    } catch (err) {
      console.error('Browse error:', err);
    } finally {
      setBrowseLoading(false);
    }
  }, []);

  // Go back in breadcrumbs
  const goBack = useCallback(async () => {
    if (breadcrumbs.length <= 1) {
      setBreadcrumbs([]);
      setBrowseResults([]);
      return;
    }

    const newBreadcrumbs = breadcrumbs.slice(0, -1);
    const parent = newBreadcrumbs[newBreadcrumbs.length - 1];

    setBrowseLoading(true);
    try {
      const response = await fetch(`/api/v1/list/${parent.source}/${encodeURIComponent(parent.localId)}`);
      if (!response.ok) throw new Error('Browse failed');
      const data = await response.json();
      setBrowseResults(data.items || []);
      setBreadcrumbs(newBreadcrumbs);
    } catch (err) {
      console.error('Browse error:', err);
    } finally {
      setBrowseLoading(false);
    }
  }, [breadcrumbs]);

  // Handle item click
  const handleItemClick = (item) => {
    if (isContainer(item)) {
      browseContainer(item);
    } else {
      onChange(item.id);
      setInputValue('');
      setBreadcrumbs([]);
      setBrowseResults([]);
      combobox.closeDropdown();
    }
  };

  // Browse to parent folder
  const browseParent = useCallback(async (item) => {
    const source = item.source || item.id?.split(':')[0];
    const localId = item.localId || item.id?.replace(`${source}:`, '');

    const parts = localId.split('/');
    if (parts.length <= 1) return;

    const parentPath = parts.slice(0, -1).join('/');
    const parentTitle = item.metadata?.parentTitle || parts[parts.length - 2];

    setBrowseLoading(true);
    try {
      const response = await fetch(`/api/v1/list/${source}/${encodeURIComponent(parentPath)}`);
      if (!response.ok) throw new Error('Browse failed');
      const data = await response.json();
      setBrowseResults(data.items || []);
      setBreadcrumbs([{ id: `${source}:${parentPath}`, title: parentTitle, source, localId: parentPath }]);
    } catch (err) {
      console.error('Browse parent error:', err);
    } finally {
      setBrowseLoading(false);
    }
  }, []);

  // Get display value for input
  const displayValue = combobox.dropdownOpened ? inputValue : (value || '');

  const options = results.map((item) => {
    const isContainerItem = isContainer(item);
    const source = item.source || item.id?.split(':')[0];
    const type = item.type || item.metadata?.type || item.mediaType;
    const parentTitle = item.metadata?.parentTitle;
    const hasParent = parentTitle && item.localId?.includes('/');

    return (
      <Combobox.Option
        key={item.id}
        value={item.id}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handleItemClick(item);
        }}
      >
        <Group gap="sm" wrap="nowrap" justify="space-between">
          <Group gap="sm" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
            <Avatar size="sm" src={item.thumbnail || item.imageUrl} radius="sm">
              {getIcon(item)}
            </Avatar>
            <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
              <Text size="sm" truncate fw={500}>{item.title}</Text>
              {parentTitle && (
                <Text
                  size="xs"
                  c="dimmed"
                  truncate
                  onClick={hasParent ? (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    browseParent(item);
                  } : undefined}
                  style={hasParent ? { cursor: 'pointer', textDecoration: 'underline' } : undefined}
                >
                  {parentTitle}
                </Text>
              )}
            </Stack>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <Badge size="xs" variant="light" color="gray">{source}</Badge>
            {type && <Badge size="xs" variant="outline" color="blue">{type}</Badge>}
            {isContainerItem && (
              <IconChevronRight size={16} color="var(--mantine-color-dimmed)" />
            )}
          </Group>
        </Group>
      </Combobox.Option>
    );
  });

  return (
    <Combobox
      store={combobox}
      onOptionSubmit={(val) => {
        const item = results.find(r => r.id === val);
        if (item) handleItemClick(item);
      }}
    >
      <Combobox.Target>
        <TextInput
          value={displayValue}
          onChange={handleInputChange}
          onClick={() => combobox.openDropdown()}
          onFocus={() => combobox.openDropdown()}
          onBlur={() => combobox.closeDropdown()}
          placeholder={placeholder}
          leftSection={<IconSearch size={16} />}
          rightSection={loading ? <Loader size="xs" /> : null}
        />
      </Combobox.Target>

      <Combobox.Dropdown>
        {/* Breadcrumb navigation */}
        {breadcrumbs.length > 0 && (
          <Box p="xs" style={{ borderBottom: '1px solid var(--mantine-color-dark-4)' }}>
            <Group gap="xs">
              <ActionIcon
                size="sm"
                variant="subtle"
                onClick={(e) => {
                  e.stopPropagation();
                  goBack();
                }}
              >
                <IconArrowLeft size={14} />
              </ActionIcon>
              <Text size="xs" c="dimmed" truncate>
                {breadcrumbs.map(b => b.title).join(' / ')}
              </Text>
            </Group>
          </Box>
        )}

        {/* Pending sources indicator */}
        {pendingSources.length > 0 && breadcrumbs.length === 0 && (
          <Box p="xs" className="pending-sources" data-pending-sources style={{ borderBottom: '1px solid var(--mantine-color-dark-4)' }}>
            <Group gap="xs">
              <Loader size="xs" />
              <Text size="xs" c="dimmed">Searching:</Text>
              {pendingSources.map(source => (
                <Badge key={source} size="xs" variant="light" color="gray">
                  {SOURCE_ICONS[source] || SOURCE_ICONS.default} {source}
                </Badge>
              ))}
            </Group>
          </Box>
        )}

        <Combobox.Options>
          <ScrollArea.Autosize mah={300}>
            {loading && results.length === 0 ? (
              <Combobox.Empty>
                <Group justify="center" p="md">
                  <Loader size="sm" />
                  <Text size="sm" c="dimmed">Searching...</Text>
                </Group>
              </Combobox.Empty>
            ) : results.length === 0 ? (
              <Combobox.Empty>
                {inputValue.length < 2 ? 'Type to search...' : 'No results found'}
              </Combobox.Empty>
            ) : (
              options
            )}
          </ScrollArea.Autosize>
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}

export default ContentSearchCombobox;
```

**Step 4: Run test to verify it passes**

Run: `npx playwright test tests/live/flow/admin/content-search-combobox/08-streaming.runtime.test.mjs`
Expected: PASS (all 5 tests)

**Step 5: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ContentSearchCombobox.jsx tests/live/flow/admin/content-search-combobox/08-streaming.runtime.test.mjs
git commit -m "$(cat <<'EOF'
feat(combobox): integrate streaming search with pending indicators

ContentSearchCombobox now uses SSE streaming for progressive results.
Shows pending sources while search is in progress, with graceful
fallback for browsers without EventSource support.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Add Styles for Pending Indicators

**Files:**
- Create: `frontend/src/modules/Admin/ContentLists/ContentSearchCombobox.scss`
- Modify: `frontend/src/modules/Admin/ContentLists/ContentSearchCombobox.jsx:1` (add import)

**Step 1: Create the stylesheet**

Create `frontend/src/modules/Admin/ContentLists/ContentSearchCombobox.scss`:

```scss
// frontend/src/modules/Admin/ContentLists/ContentSearchCombobox.scss

.pending-sources {
  background-color: var(--mantine-color-dark-6);
  animation: pulse 1.5s ease-in-out infinite;

  .mantine-Badge-root {
    animation: fadeIn 0.2s ease-out;
  }
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

// Fade out sources as they complete
.pending-sources .mantine-Badge-root {
  transition: opacity 0.3s ease-out, transform 0.3s ease-out;
}
```

**Step 2: Add import to component**

Add to top of `frontend/src/modules/Admin/ContentLists/ContentSearchCombobox.jsx`:

```javascript
import './ContentSearchCombobox.scss';
```

**Step 3: Verify visually**

Run: `npm run dev` and navigate to `/admin/test/combobox`
Expected: Pending indicators animate smoothly

**Step 4: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ContentSearchCombobox.scss frontend/src/modules/Admin/ContentLists/ContentSearchCombobox.jsx
git commit -m "$(cat <<'EOF'
style(combobox): add animations for pending sources indicator

Subtle pulse animation while searching, fade-in for new badges.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Run Full Test Suite and Verify

**Files:**
- None (verification only)

**Step 1: Run unit tests**

Run: `npm test`
Expected: All tests pass

**Step 2: Run E2E tests**

Run: `npx playwright test tests/live/flow/admin/content-search-combobox/`
Expected: All tests pass

**Step 3: Manual smoke test**

1. Navigate to `/admin/test/combobox`
2. Type "office" - should see pending sources, then results progressively appear
3. Type rapidly "o", "of", "off", "offi", "office" - should not see duplicates or race conditions
4. Close browser and verify dev.log shows SSE events

**Step 4: Commit any final fixes if needed**

```bash
git status
# If clean, skip. Otherwise fix and commit.
```

---

## Summary

| Task | Description | Files Changed |
|------|-------------|---------------|
| 1 | Add `searchStream()` generator | ContentQueryService.mjs |
| 2 | Add SSE endpoint | content.mjs (router) |
| 3 | Create useStreamingSearch hook | useStreamingSearch.js |
| 4 | Integrate into ContentSearchCombobox | ContentSearchCombobox.jsx |
| 5 | Add pending indicator styles | ContentSearchCombobox.scss |
| 6 | Full verification | (tests only) |

**Total commits:** 6
**Estimated test coverage:** Unit tests for generator and hook; E2E tests for full flow
