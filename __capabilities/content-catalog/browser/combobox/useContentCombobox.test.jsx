// useContentCombobox.test.jsx — side-effect hook around the pure combobox machine.
// fetch and EventSource are fully stubbed; no test touches the network.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { clearCache, getCacheEntry, loadSiblings, setCacheEntry } from "../lib/siblingsCache.js";
import { isKnownSource, loadKnownSources, resetKnownSources } from "../lib/knownSources.js";

// Hoisted so tests (Task 5: search.settled / search.source_error /
// search.retry_after_source_error) can assert on calls — vi.hoisted runs
// before vi.mock factories, so mockLog is initialized when the factory below
// closes over it.
const { mockLog } = vi.hoisted(() => {
  const mockLog = {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    sampled: vi.fn(), child: () => mockLog,
  };
  return { mockLog };
});

vi.mock("../../../../frontend/src/lib/logging/singleton.js", () => (
  { getChildLogger: () => mockLog, getDaylightLogger: () => mockLog, default: () => mockLog }
));

vi.mock("./notify.js", () => ({
  notifyWarning: vi.fn(),
}));

vi.mock("../../../../frontend/src/lib/appRegistry.js", () => ({
  APP_REGISTRY: { webcam: { label: 'Webcam', icon: 'webcam-icon.svg', param: null } },
  searchApps: (query) => (
    'webcam'.includes(String(query).toLowerCase())
      ? [{ id: 'webcam', label: 'Webcam', param: null }]
      : []
  ),
}));

// Warm the module cache for the mocked appRegistry so the hook's dynamic
// `import()` resolves instantly (keeps the app-results test deterministic).
import "../../../../frontend/src/lib/appRegistry.js";

import { clearTitleCache } from "../lib/useContentTitle.js";
import { useContentCombobox, Modes } from "./useContentCombobox.js";
import { notifyWarning } from "./notify.js";

class MockEventSource {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    MockEventSource.instances.push(this);
  }
  close() { this.readyState = 2; }
  simulateMessage(data) {
    if (this.onmessage) this.onmessage({ data: JSON.stringify(data) });
  }
  simulateError() {
    if (this.onerror) this.onerror(new Error('Connection failed'));
  }
}
MockEventSource.instances = [];

function jsonResponse(body, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(body) });
}

const SIBLINGS_RESPONSE = {
  items: [
    { id: 'plex:9', title: 'Ep 9', source: 'plex', type: 'episode' },
    { id: 'plex:10', title: 'Ep 10', source: 'plex', type: 'episode' },
    { id: 'plex:11', title: 'Show X', source: 'plex', itemType: 'container' },
  ],
  parent: { id: 'plex:100', title: 'Season 1', source: 'plex' },
  pagination: { offset: 40, window: 3, total: 100, hasBefore: true, hasAfter: true },
  referenceIndex: 1,
};

let fetchMock;

function setup(initialProps) {
  return renderHook((props) => useContentCombobox(props), {
    initialProps: { value: '', onChange: vi.fn(), ...initialProps },
  });
}

async function openBrowse(result) {
  await act(async () => { await result.current.openWithSiblings(); });
}

describe('useContentCombobox', () => {
  beforeEach(() => {
    clearCache();
    clearTitleCache();
    MockEventSource.instances = [];
    // Default: no SSE — forces the batch fallback path (supportsSSE() false).
    vi.stubGlobal('EventSource', undefined);
    fetchMock = vi.fn(() => jsonResponse({ items: [] }));
    vi.stubGlobal('fetch', (url, options) => {
      const { pathname, search } = new URL(url, location.origin);
      return fetchMock(pathname + search, options);
    });
    notifyWarning.mockClear();
    mockLog.debug.mockClear(); mockLog.info.mockClear();
    mockLog.warn.mockClear(); mockLog.error.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('value-prop change dispatches VALUE_CHANGED and returns to DISPLAY', () => {
    const onChange = vi.fn();
    const { result, rerender } = setup({ value: 'plex:1', onChange });

    act(() => { result.current.handleInput('typing stuff'); });
    expect(result.current.state.mode).toBe('search');
    expect(result.current.state.search).toBe('typing stuff');

    rerender({ value: 'plex:2', onChange });
    expect(result.current.state.mode).toBe('display');
    expect(result.current.state.value).toBe('plex:2');
    expect(result.current.state.search).toBeNull();
  });

  it('recognizes recovered aliases when the same picker opens after an outage', async () => {
    resetKnownSources();
    let aliasesAvailable = false;
    fetchMock.mockImplementation(path => {
      if (path === '/api/v1/content/sources') return jsonResponse({ sources: ['plex'] });
      if (path === '/api/v1/content/aliases') return Promise.resolve(aliasesAvailable
        ? Response.json({ userDefined: ['family-alias'] })
        : Response.json({ error: 'Service unavailable' }, { status: 503 }));
      return jsonResponse({ items: [] });
    });
    const onChange = vi.fn();
    const { result } = setup({ onChange });
    await act(async () => { await loadKnownSources(); });

    act(() => { result.current.handleInput('family-alias:first'); });
    act(() => { result.current.commit('enter'); });
    expect(onChange).toHaveBeenCalledWith('family-alias:first');
    expect(notifyWarning).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Saved as raw id' }));

    aliasesAvailable = true;
    await openBrowse(result);
    await waitFor(() => expect(isKnownSource('family-alias')).toBe(true));
    expect(fetchMock.mock.calls.filter(([path]) => path === '/api/v1/content/aliases')).toHaveLength(2);

    act(() => { result.current.handleInput('invented:second'); });
    act(() => { result.current.commit('enter'); });
    expect(onChange).toHaveBeenCalledWith('invented:second');
    expect(notifyWarning).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Unknown source “invented”' }));
  });

  it('skips literal validation requests for a selection-only picker', async () => {
    resetKnownSources();
    const { result } = setup({ allowFreeform: false });
    await openBrowse(result);
    expect(fetchMock.mock.calls.filter(([path]) => /^\/api\/v1\/content\/(sources|aliases)$/.test(path))).toEqual([]);
  });

  it("handleClose('outside') with exploratory text calls onChange ZERO times and resets state", async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const { result } = setup({ onChange });

    act(() => { result.current.handleInput('beet'); });
    await act(async () => { vi.advanceTimersByTime(350); }); // debounce fired, batch search resolved

    act(() => { result.current.handleClose('outside'); });
    expect(onChange).toHaveBeenCalledTimes(0);
    expect(result.current.state.mode).toBe('display');
    expect(result.current.state.search).toBeNull();
    expect(result.current.state.browse.items).toEqual([]);
  });

  it("handleClose('outside') with id-like text calls onChange exactly once with that text", () => {
    const onChange = vi.fn();
    const { result } = setup({ onChange });

    act(() => { result.current.handleInput('plex:999'); });
    act(() => { result.current.handleClose('outside'); });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('plex:999');
    expect(result.current.state.mode).toBe('display');
  });

  it("handleClose('escape') never calls onChange, even with id-like text", () => {
    const onChange = vi.fn();
    const { result } = setup({ onChange });

    act(() => { result.current.handleInput('plex:999'); });
    act(() => { result.current.handleClose('escape'); });

    expect(onChange).toHaveBeenCalledTimes(0);
    expect(result.current.state.mode).toBe('display');
  });

  it('select(item) calls onChange(item.id, item) once and closes', () => {
    const onChange = vi.fn();
    const { result } = setup({ onChange });
    const item = { id: 'plex:42', title: 'The Answer' };

    act(() => { result.current.handleInput('answ'); });
    act(() => { result.current.select(item); });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('plex:42', item);
    expect(result.current.state.mode).toBe('display');
    expect(result.current.state.search).toBeNull();
  });

  it('openWithSiblings loads browse mode honoring referenceIndex; drill replaces stale siblings pagination (S1)', async () => {
    fetchMock.mockImplementation((url) => {
      if (url.startsWith('/api/v1/siblings/plex/10')) return jsonResponse(SIBLINGS_RESPONSE);
      if (url.startsWith('/api/v1/list/plex/11')) return jsonResponse({ items: [{ id: 'plex:c1', title: 'Child 1' }] });
      return jsonResponse({ items: [] });
    });
    const { result } = setup({ value: 'plex:10' });

    await openBrowse(result);
    expect(result.current.state.mode).toBe('browse');
    expect(result.current.state.browse.items.map((i) => i.id)).toEqual(['plex:9', 'plex:10', 'plex:11']);
    expect(result.current.state.highlight.idx).toBe(1); // referenceIndex honored
    expect(result.current.state.browse.breadcrumbs).toEqual([
      expect.objectContaining({ id: 'plex:100', title: 'Season 1', source: 'plex', localId: '100' }),
    ]);
    expect(result.current.state.browse.pagination).toMatchObject({ hasAfter: true, offset: 40 });

    // Cache populated on miss, in the shared {browseItems, currentParent, ...} shape
    const cached = getCacheEntry('plex:10');
    expect(cached?.status).toBe('loaded');
    expect(cached.data.browseItems).toHaveLength(3);

    const container = result.current.state.browse.items[2];
    await act(async () => { await result.current.drill(container); });

    // S1 regression pin: the drilled level must NOT inherit the siblings window.
    expect(result.current.state.browse.pagination).toBeNull();
    expect(result.current.state.browse.items.map((i) => i.id)).toEqual(['plex:c1']);
    expect(result.current.state.browse.breadcrumbs).toHaveLength(2);
  });

  it.each(['typing', 'dismissal', 'another expansion', 'a changed value', 'unmount'])(
    'aborts an encoded container GET on %s and ignores its late result', async change => {
      const previous = '/api/v1/list/plex/series%2Fone%3Aseason/expand';
      const next = '/api/v1/list/plex/series%2Ftwo/expand';
      const held = Promise.withResolvers();
      fetchMock.mockImplementation(url => {
        if (url === previous) return held.promise;
        if (url === next) return jsonResponse({ items: [{ id: 'plex:new-child', title: 'New child' }] });
        return jsonResponse({ items: [] });
      });
      const { result, unmount, rerender } = setup({ value: 'plex:10' });
      let opening;
      act(() => {
        opening = result.current.drill({ id: 'plex:series/one:season', title: 'Original container' });
      });
      const [, request] = fetchMock.mock.calls.find(([path]) => path === previous);
      expect(request).toMatchObject({ method: 'GET', signal: expect.any(AbortSignal) });
      expect(request).not.toHaveProperty('body');
      if (change === 'typing') act(() => result.current.handleInput('new search'));
      if (change === 'dismissal') act(() => result.current.handleClose('escape'));
      if (change === 'another expansion') {
        await act(async () => result.current.drill({ id: 'plex:series/two', title: 'Replacement container' }));
      }
      if (change === 'a changed value') rerender({ value: 'plex:20' });
      if (change === 'unmount') unmount();
      expect(request.signal.aborted).toBe(true);
      await act(async () => {
        held.resolve(await jsonResponse({ items: [{ id: 'plex:stale-child', title: 'Retired child' }] }));
        await opening;
      });
      if (change === 'unmount') return;
      const ids = result.current.state.browse.items.map(item => item.id);
      expect(ids).not.toContain('plex:stale-child');
      if (change === 'another expansion') expect(ids).toEqual(['plex:new-child']);
    },
  );

  it('committed value absent from the window highlights nothing (idx -1), not row 0 (F1)', async () => {
    fetchMock.mockImplementation((url) => {
      if (url.startsWith('/api/v1/siblings/plex/999')) {
        return jsonResponse({
          // The committed id (plex:999) is NOT among the returned siblings.
          items: [
            { id: 'plex:9', title: 'Ep 9', source: 'plex', type: 'episode' },
            { id: 'plex:10', title: 'Ep 10', source: 'plex', type: 'episode' },
          ],
          parent: { id: 'plex:100', title: 'Season 1', source: 'plex' },
          pagination: null,
          referenceIndex: -1, // genuine miss: server could not center on the value
        });
      }
      return jsonResponse({ items: [] });
    });
    const { result } = setup({ value: 'plex:999' });

    await openBrowse(result);

    expect(result.current.state.mode).toBe('browse');
    expect(result.current.state.browse.items.map((i) => i.id)).toEqual(['plex:9', 'plex:10']);
    expect(result.current.state.highlight.idx).toBe(-1); // no phantom row-0 highlight
  });

  it('openWithSiblings uses a loaded cache entry without fetching /siblings', async () => {
    setCacheEntry('plex:10', {
      status: 'loaded',
      promise: null,
      data: {
        browseItems: [
          { value: 'plex:9', title: 'Ep 9', source: 'plex' },
          { value: 'plex:10', title: 'Ep 10', source: 'plex' },
        ],
        currentParent: { id: 'plex:100', title: 'Season 1', source: 'plex' },
        pagination: null,
        referenceIndex: 1,
      },
    });
    const { result } = setup({ value: 'plex:10' });

    await openBrowse(result);

    expect(result.current.state.mode).toBe('browse');
    expect(result.current.state.browse.items.map((i) => i.id)).toEqual(['plex:9', 'plex:10']);
    expect(result.current.state.highlight.idx).toBe(1);
    const siblingsCalls = fetchMock.mock.calls.filter(([u]) => u.startsWith('/api/v1/siblings/'));
    expect(siblingsCalls).toHaveLength(0);
  });

  it('openWithSiblings awaits a pending cache entry instead of duplicating the fetch', async () => {
    let resolvePending;
    setCacheEntry('plex:10', {
      status: 'pending',
      data: null,
      promise: new Promise((res) => { resolvePending = res; }),
    });
    const { result } = setup({ value: 'plex:10' });

    await act(async () => {
      const opening = result.current.openWithSiblings();
      resolvePending({
        browseItems: [{ value: 'plex:10', title: 'Ep 10', source: 'plex' }],
        currentParent: null,
        pagination: null,
        referenceIndex: 0,
      });
      await opening;
    });

    expect(result.current.state.mode).toBe('browse');
    expect(result.current.state.browse.items.map((i) => i.id)).toEqual(['plex:10']);
    const siblingsCalls = fetchMock.mock.calls.filter(([u]) => u.startsWith('/api/v1/siblings/'));
    expect(siblingsCalls).toHaveLength(0);
  });

  it("paginate('after') while another paginate is in flight is a no-op (single fetch)", async () => {
    let resolvePage;
    fetchMock.mockImplementation((url) => {
      if (url.includes('offset=')) return new Promise((res) => { resolvePage = res; });
      if (url.startsWith('/api/v1/siblings/plex/10')) return jsonResponse(SIBLINGS_RESPONSE);
      return jsonResponse({ items: [] });
    });
    const { result } = setup({ value: 'plex:10' });
    await openBrowse(result);

    const pageCalls = () => fetchMock.mock.calls.filter(([u]) => u.includes('offset=')).length;
    let first;
    act(() => {
      first = result.current.paginate('after');
      result.current.paginate('after'); // in-flight → must be a no-op
    });
    expect(pageCalls()).toBe(1);
    expect(fetchMock.mock.calls.find(([u]) => u.includes('offset='))[0])
      .toBe('/api/v1/siblings/plex/10?offset=43&limit=21');

    await act(async () => {
      resolvePage({ ok: true, status: 200, json: () => Promise.resolve({ items: [{ id: 'plex:12', title: 'Ep 12' }] }) });
      await first;
    });
    expect(result.current.state.browse.items.map((i) => i.id)).toEqual(['plex:9', 'plex:10', 'plex:11', 'plex:12']);

    // In-flight guard releases after resolution
    act(() => { result.current.paginate('after'); });
    expect(pageCalls()).toBe(2);
  });

  it('S5: searchParams prop change reaches the batch fallback URL', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const { result, rerender } = setup({ onChange, searchParams: 'source=plex' });

    act(() => { result.current.handleInput('beet'); });
    await act(async () => { vi.advanceTimersByTime(350); });
    expect(fetchMock.mock.calls.at(-1)[0])
      .toBe('/api/v1/content/query/search?text=beet&take=20&source=plex');

    rerender({ value: '', onChange, searchParams: 'source=immich' });
    act(() => { result.current.handleInput('chopin'); });
    await act(async () => { vi.advanceTimersByTime(350); });
    expect(fetchMock.mock.calls.at(-1)[0])
      .toBe('/api/v1/content/query/search?text=chopin&take=20&source=immich');
  });

  it('batch fallback results are dispatched into state.results', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((url) => (
      url.startsWith('/api/v1/content/query/search')
        ? jsonResponse({ items: [{ id: 'plex:5', title: 'Beethoven' }] })
        : jsonResponse({ items: [] })
    ));
    const { result } = setup({});

    act(() => { result.current.handleInput('beet'); });
    await act(async () => { vi.advanceTimersByTime(350); });

    expect(result.current.state.results.map((r) => r.id)).toEqual(['plex:5']);
  });

  it('retires the old batch before the replacement debounce and ignores its late response', async () => {
    vi.useFakeTimers();
    const older = Promise.withResolvers();
    const newer = Promise.withResolvers();
    fetchMock.mockImplementation(url => {
      if (url.includes('text=older')) return older.promise;
      if (url.includes('text=newer')) return newer.promise;
      return jsonResponse({ items: [] });
    });
    const searches = () => fetchMock.mock.calls.filter(([url]) => url.startsWith('/api/v1/content/query/search?'));
    const { result } = setup({});

    act(() => result.current.handleInput('older'));
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(searches()).toHaveLength(1);
    act(() => result.current.handleInput('newer'));
    expect(searches()[0][1].signal?.aborted).toBe(true);
    expect(result.current.isSearching).toBe(true);
    await act(async () => { vi.advanceTimersByTime(299); });
    expect(searches()).toHaveLength(1);
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(searches()).toHaveLength(2);

    await act(async () => older.resolve(await jsonResponse({ items: [{ id: 'plex:1', title: 'Older' }] })));
    expect(result.current.state.results).toEqual([]);
    expect(result.current.isSearching).toBe(true);
    await act(async () => newer.resolve(await jsonResponse({ items: [{ id: 'plex:2', title: 'Newer' }] })));
    expect(result.current.state.results.map(item => item.id)).toEqual(['plex:2']);
    expect(result.current.isSearching).toBe(false);
  });

  it('F13: a bare source prefix ("singalong:") dispatches an empty search, not a literal', async () => {
    vi.useFakeTimers();
    const { result } = setup({});

    act(() => { result.current.handleInput('singalong:'); });
    await act(async () => { vi.advanceTimersByTime(350); });

    const searchCalls = fetchMock.mock.calls.filter(([u]) => u.startsWith('/api/v1/content/query/search'));
    // The literal "singalong:" must never reach the backend search.
    expect(searchCalls.every(([u]) => !u.includes(encodeURIComponent('singalong:')))).toBe(true);
    // An empty query short-circuits before any backend search fetch.
    expect(searchCalls).toHaveLength(0);
  });

  it('F13 regression: a scoped "source:term" query still searches for the literal', async () => {
    vi.useFakeTimers();
    const { result } = setup({});

    act(() => { result.current.handleInput('singalong:nearer'); });
    await act(async () => { vi.advanceTimersByTime(350); });

    expect(fetchMock.mock.calls.at(-1)[0])
      .toBe(`/api/v1/content/query/search?text=${encodeURIComponent('singalong:nearer')}&take=20`);
  });

  it('F13 regression: plain no-colon text still searches normally', async () => {
    vi.useFakeTimers();
    const { result } = setup({});

    act(() => { result.current.handleInput('nearer'); });
    await act(async () => { vi.advanceTimersByTime(350); });

    expect(fetchMock.mock.calls.at(-1)[0])
      .toBe('/api/v1/content/query/search?text=nearer&take=20');
  });

  it('SSE path streams results into state.results', async () => {
    vi.stubGlobal('EventSource', MockEventSource);
    vi.useFakeTimers();
    const { result } = setup({});

    act(() => { result.current.handleInput('beet'); });
    await act(async () => { vi.advanceTimersByTime(350); });

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toContain('text=beet');

    act(() => {
      MockEventSource.instances[0].simulateMessage({
        event: 'results', source: 'plex', items: [{ id: 'plex:5', title: 'Beethoven' }], pending: [],
      });
    });
    expect(result.current.state.results.map((r) => r.id)).toEqual(['plex:5']);
    // No batch fetch on the SSE path
    expect(fetchMock.mock.calls.filter(([u]) => u.startsWith('/api/v1/content/query/search'))).toHaveLength(0);
  });

  it('F6: SSE path caps results at 50 and reports truncatedAt when raw count exceeds the cap', () => {
    vi.stubGlobal('EventSource', MockEventSource);
    vi.useFakeTimers();
    const { result } = setup({});

    act(() => { result.current.handleInput('broad'); });
    act(() => { vi.advanceTimersByTime(350); });

    // Stream 51 unique results — one past the render cap.
    const items = Array.from({ length: 51 }, (_, i) => ({ id: `plex:${i}`, title: `Item ${i}` }));
    act(() => {
      MockEventSource.instances[0].simulateMessage({ event: 'results', source: 'plex', items, pending: [] });
    });

    expect(result.current.state.results).toHaveLength(50); // capped in the machine
    expect(result.current.truncatedAt).toBe(50);           // surfaced on the SSE path
  });

  it('F6: SSE path below the cap does not report truncation', () => {
    vi.stubGlobal('EventSource', MockEventSource);
    vi.useFakeTimers();
    const { result } = setup({});

    act(() => { result.current.handleInput('narrow'); });
    act(() => { vi.advanceTimersByTime(350); });

    const items = Array.from({ length: 10 }, (_, i) => ({ id: `plex:${i}`, title: `Item ${i}` }));
    act(() => {
      MockEventSource.instances[0].simulateMessage({ event: 'results', source: 'plex', items, pending: [] });
    });

    expect(result.current.state.results).toHaveLength(10);
    expect(result.current.truncatedAt).toBeNull();
  });

  it('appResults=true merges app registry matches ahead of content results', async () => {
    // Real timers + waitFor: the merge path crosses a debounce timer, a fetch,
    // AND a dynamic import() — fake timers cannot deterministically flush the
    // module-loader microtasks of a first-time dynamic import.
    fetchMock.mockImplementation((url) => (
      url.startsWith('/api/v1/content/query/search')
        ? jsonResponse({ items: [{ id: 'plex:7', title: 'Web of Lies' }] })
        : jsonResponse({ items: [] })
    ));
    const { result } = setup({ appResults: true });

    act(() => { result.current.handleInput('web'); });

    await waitFor(
      () => expect(result.current.state.results.map((r) => r.id)).toEqual(['app:webcam', 'plex:7']),
      { timeout: 2000 }
    );
    expect(result.current.state.results[0]).toMatchObject({
      id: 'app:webcam', title: 'Webcam', source: 'app', type: 'app',
      thumbnail: 'webcam-icon.svg', isApp: true, appId: 'webcam', hasParam: false,
    });
  });

  it('paginate after a drill never fetches /siblings (structural pagination-owner guard)', async () => {
    fetchMock.mockImplementation((url) => {
      if (url.startsWith('/api/v1/siblings/plex/10')) return jsonResponse(SIBLINGS_RESPONSE);
      // The drilled level carries its OWN live pagination — the tempting case.
      if (url.startsWith('/api/v1/list/plex/11')) {
        return jsonResponse({
          items: [{ id: 'plex:c1', title: 'Child 1' }],
          pagination: { offset: 0, window: 1, total: 50, hasBefore: false, hasAfter: true },
        });
      }
      return jsonResponse({ items: [] });
    });
    const { result } = setup({ value: 'plex:10' });
    await openBrowse(result);
    expect(result.current.state.browse.pagination.hasAfter).toBe(true); // siblings level paginable

    await act(async () => { await result.current.drill(result.current.state.browse.items[2]); });
    expect(result.current.state.browse.pagination.hasAfter).toBe(true); // drilled level also paginable

    const siblingsCallsBefore = fetchMock.mock.calls.filter(([u]) => u.startsWith('/api/v1/siblings/')).length;
    await act(async () => { await result.current.paginate('after'); });

    const siblingsCallsAfter = fetchMock.mock.calls.filter(([u]) => u.startsWith('/api/v1/siblings/')).length;
    expect(siblingsCallsAfter - siblingsCallsBefore).toBe(0); // ZERO /siblings fetches after drill
    expect(result.current.state.browse.items.map((i) => i.id)).toEqual(['plex:c1']); // window untouched
  });

  it('late siblings response cannot clobber newer typing (browse-token race)', async () => {
    let resolveSiblings;
    fetchMock.mockImplementation((url) => {
      if (url.startsWith('/api/v1/siblings/plex/10')) {
        return new Promise((res) => { resolveSiblings = res; });
      }
      return jsonResponse({ items: [] });
    });
    const { result } = setup({ value: 'plex:10' });

    let opening;
    act(() => { opening = result.current.openWithSiblings(); });
    act(() => { result.current.handleInput('x'); }); // user typed while siblings in flight

    await act(async () => {
      resolveSiblings({ ok: true, status: 200, json: () => Promise.resolve(SIBLINGS_RESPONSE) });
      await opening;
    });

    expect(result.current.state.mode).toBe('search'); // NOT yanked into browse
    expect(result.current.state.search).toBe('x');
    expect(result.current.state.browse.items).toEqual([]);
  });

  it('resolvedTitle fetches /info once and reuses the module cache on a second mount', async () => {
    fetchMock.mockImplementation((url) => (
      new URL(url, location.origin).pathname === '/api/v1/info/plex/777'
        ? jsonResponse({ title: 'Solo Piano' })
        : jsonResponse({ items: [] })
    ));
    const infoCalls = () => fetchMock.mock.calls.filter(([u]) => new URL(u, location.origin).pathname.startsWith('/api/v1/info/')).length;

    const first = setup({ value: 'plex:777' });
    await waitFor(() => expect(first.result.current.resolvedTitle).toBe('Solo Piano'));
    expect(infoCalls()).toBe(1);
    first.unmount();

    const second = setup({ value: 'plex:777' });
    expect(second.result.current.resolvedTitle).toBe('Solo Piano');
    expect(infoCalls()).toBe(1); // cache hit — no second /info fetch
  });

  it('opening during an Admin preload shares the metadata source request and preserves the full sanitized ancestor trail', async () => {
    const RESPONSE_WITH_ANCESTORS = {
      items: [
        { id: 'plex:642196', title: 'Ep 32', source: 'plex', type: 'episode' },
        { id: 'plex:642197', title: 'Elijah the Prophet', source: 'plex', type: 'episode' },
      ],
      parent: { id: 'plex:700', title: 'Season 8', source: 'plex' },
      pagination: null,
      referenceIndex: 1,
      ancestors: [
        // Includes a junk library placeholder AND a duplicate that sanitize must remove.
        { id: 'library:2', title: 'Library', source: 'plex', localId: '2', type: 'library' },
        { id: 'plex:900', title: 'The Old Testament', source: 'plex', localId: '900', type: 'collection' },
        { id: 'plex:800', title: 'The Prophets', source: 'plex', localId: '800', type: 'show' },
        { id: 'plex:800', title: 'The Prophets DUPE', source: 'plex', localId: '800', type: 'show' },
        { id: 'plex:700', title: 'Season 8', source: 'plex', localId: '700', type: 'season' },
      ],
    };
    let finishPreload;
    const pending = new Promise(resolve => { finishPreload = resolve; });
    fetchMock.mockImplementation(url => url.startsWith('/api/v1/siblings/') ? pending : jsonResponse({}));
    const { result } = setup({ value: 'legacy:642197' });
    const preload = loadSiblings('legacy:642197', 'plex');
    await act(async () => {
      const opening = result.current.openWithSiblings();
      finishPreload(await jsonResponse(RESPONSE_WITH_ANCESTORS));
      await Promise.all([preload, opening]);
    });

    const siblingPaths = fetchMock.mock.calls.map(([url]) => url).filter(url => url.includes('/siblings/'));
    expect(siblingPaths).toEqual(['/api/v1/siblings/plex/642197']);
    expect(result.current.state.mode).toBe('browse');
    // Junk library + duplicate removed; full chain root-first with usable localId/source.
    expect(result.current.state.browse.breadcrumbs).toEqual([
      expect.objectContaining({ id: 'plex:900', title: 'The Old Testament', source: 'plex', localId: '900' }),
      expect.objectContaining({ id: 'plex:800', title: 'The Prophets', source: 'plex', localId: '800' }),
      expect.objectContaining({ id: 'plex:700', title: 'Season 8', source: 'plex', localId: '700' }),
    ]);
    expect(result.current.state.highlight.idx).toBe(1); // referenceIndex unchanged
  });

  it('pages through the same canonical source that supplied a preloaded sibling window', async () => {
    const location = '/api/v1/siblings/plex/10';
    const next = { id: 'plex:12', title: 'Next episode' };
    fetchMock.mockImplementation(url => {
      if (url === location) return jsonResponse(SIBLINGS_RESPONSE);
      if (url === location + '?offset=43&limit=21') return jsonResponse({ items: [next] });
      return jsonResponse({});
    });
    await loadSiblings('legacy:10', 'plex');
    const { result } = setup({ value: 'legacy:10' });
    await openBrowse(result);

    await act(async () => { expect(await result.current.paginate('after')).toBe(true); });

    expect(fetchMock.mock.calls.map(([url]) => url).filter(url => url.startsWith('/api/v1/siblings/')))
      .toEqual([location, location + '?offset=43&limit=21']);
    expect(result.current.state.browse.items.map(item => item.id)).toContain(next.id);
  });

  it('allows the current sibling window to page while a previous window is still pending', async () => {
    const firstWindow = '/api/v1/siblings/plex/10';
    const nextWindow = '/api/v1/siblings/plex/20';
    const pageQuery = '?offset=43&limit=21';
    let finishFirst;
    let finishNext;
    const firstPage = new Promise(resolve => { finishFirst = resolve; });
    const nextPage = new Promise(resolve => { finishNext = resolve; });
    const newItem = { id: 'plex:20', title: 'New reference' };
    fetchMock.mockImplementation(url => {
      if (url === firstWindow) return jsonResponse(SIBLINGS_RESPONSE);
      if (url === nextWindow) return jsonResponse({ ...SIBLINGS_RESPONSE, items: [newItem], referenceIndex: 0 });
      if (url === firstWindow + pageQuery) return firstPage;
      if (url === nextWindow + pageQuery) return nextPage;
      return jsonResponse({});
    });

    const { result, rerender } = setup({ value: 'plex:10' });
    await openBrowse(result);
    let oldPagination;
    act(() => { oldPagination = result.current.paginate('after'); });
    rerender({ value: 'plex:20', onChange: vi.fn() });
    await openBrowse(result);
    let newPagination;
    act(() => { newPagination = result.current.paginate('after'); });
    try {
      expect(fetchMock.mock.calls.map(([url]) => url).filter(url => url.endsWith(pageQuery)))
        .toEqual([firstWindow + pageQuery, nextWindow + pageQuery]);

      await act(async () => {
        finishFirst(await jsonResponse({ items: [{ id: 'plex:12' }] }));
        expect(await oldPagination).toBe(false);
      });
      await act(async () => { expect(await result.current.paginate('after')).toBe(false); });
      await act(async () => {
        finishNext(await jsonResponse({ items: [{ id: 'plex:21' }] }));
        expect(await newPagination).toBe(true);
      });
      expect(result.current.state.browse.items.map(item => item.id)).toEqual(['plex:20', 'plex:21']);
    } finally {
      finishFirst(await jsonResponse({ items: [] }));
      finishNext(await jsonResponse({ items: [] }));
      await act(async () => { await Promise.all([oldPagination, newPagination]); });
    }
  });

  it('applyBrowseData falls back to the single parent crumb when the response has NO ancestors (no regression)', async () => {
    fetchMock.mockImplementation((url) => (
      url.startsWith('/api/v1/siblings/plex/10') ? jsonResponse(SIBLINGS_RESPONSE) : jsonResponse({ items: [] })
    ));
    const { result } = setup({ value: 'plex:10' });

    await openBrowse(result);

    expect(result.current.state.browse.breadcrumbs).toEqual([
      expect.objectContaining({ id: 'plex:100', title: 'Season 1', source: 'plex', localId: '100' }),
    ]);
  });

  it('opening deep with a full ancestor trail lets goUp climb one level per press, dismissing only at the cap', async () => {
    const DEEP_RESPONSE = {
      items: [{ id: 'plex:642197', title: 'Elijah the Prophet', source: 'plex', type: 'episode' }],
      parent: { id: 'plex:700', title: 'Season 8', source: 'plex' },
      pagination: null,
      referenceIndex: 0,
      ancestors: [
        { id: 'plex:900', title: 'The Old Testament', source: 'plex', localId: '900', type: 'collection' },
        { id: 'plex:800', title: 'The Prophets', source: 'plex', localId: '800', type: 'show' },
        { id: 'plex:700', title: 'Season 8', source: 'plex', localId: '700', type: 'season' },
      ],
    };
    fetchMock.mockImplementation((url) => {
      if (url.startsWith('/api/v1/siblings/plex/642197')) return jsonResponse(DEEP_RESPONSE);
      // Listing the show → its seasons (Season 8 among them).
      if (url.startsWith('/api/v1/list/plex/800')) return jsonResponse({ items: [
        { id: 'plex:600', title: 'Season 7', source: 'plex', itemType: 'container' },
        { id: 'plex:700', title: 'Season 8', source: 'plex', itemType: 'container' },
      ] });
      // Listing the collection → its shows (The Prophets among them).
      if (url.startsWith('/api/v1/list/plex/900')) return jsonResponse({ items: [
        { id: 'plex:800', title: 'The Prophets', source: 'plex', itemType: 'container' },
        { id: 'plex:850', title: 'The Kings', source: 'plex', itemType: 'container' },
      ] });
      return jsonResponse({ items: [] });
    });
    const { result } = setup({ value: 'plex:642197' });
    await openBrowse(result);
    expect(result.current.state.browse.breadcrumbs.map((b) => b.id)).toEqual(['plex:900', 'plex:800', 'plex:700']);

    // ← climbs to the show, listing seasons with Season 8 highlighted.
    await act(async () => { await result.current.goUp(); });
    expect(result.current.state.mode).toBe('browse');
    expect(result.current.state.browse.breadcrumbs.map((b) => b.id)).toEqual(['plex:900', 'plex:800']);
    expect(result.current.state.browse.items[result.current.state.highlight.idx].id).toBe('plex:700');

    // ← climbs to the collection, listing shows with The Prophets highlighted.
    await act(async () => { await result.current.goUp(); });
    expect(result.current.state.browse.breadcrumbs.map((b) => b.id)).toEqual(['plex:900']);
    expect(result.current.state.browse.items[result.current.state.highlight.idx].id).toBe('plex:800');

    // ← at the cap (single crumb) dismisses to DISPLAY, preserving the committed value.
    await act(async () => { await result.current.goUp(); });
    expect(result.current.state.mode).toBe(Modes.DISPLAY);
    expect(result.current.state.value).toBe('plex:642197');
  });

  it('goToCrumb lists the clicked crumb\'s children, truncates the trail there, and highlights the child came from', async () => {
    const DEEP_RESPONSE = {
      items: [{ id: 'plex:642197', title: 'Elijah the Prophet', source: 'plex', type: 'episode' }],
      parent: { id: 'plex:700', title: 'Season 8', source: 'plex' },
      pagination: null,
      referenceIndex: 0,
      ancestors: [
        { id: 'plex:900', title: 'The Old Testament', source: 'plex', localId: '900', type: 'collection' },
        { id: 'plex:800', title: 'The Prophets', source: 'plex', localId: '800', type: 'show' },
        { id: 'plex:700', title: 'Season 8', source: 'plex', localId: '700', type: 'season' },
      ],
    };
    fetchMock.mockImplementation((url) => {
      if (url.startsWith('/api/v1/siblings/plex/642197')) return jsonResponse(DEEP_RESPONSE);
      if (url.startsWith('/api/v1/list/plex/900')) return jsonResponse({ items: [
        { id: 'plex:850', title: 'The Kings', source: 'plex', itemType: 'container' },
        { id: 'plex:800', title: 'The Prophets', source: 'plex', itemType: 'container' },
      ] });
      return jsonResponse({ items: [] });
    });
    const { result } = setup({ value: 'plex:642197' });
    await openBrowse(result);
    expect(result.current.state.browse.breadcrumbs.map((b) => b.id)).toEqual(['plex:900', 'plex:800', 'plex:700']);

    // Click the ROOT collection crumb (index 0) — jumps two levels at once.
    await act(async () => { await result.current.goToCrumb(0); });

    expect(result.current.state.mode).toBe('browse');
    expect(result.current.state.browse.breadcrumbs.map((b) => b.id)).toEqual(['plex:900']);
    expect(result.current.state.browse.items.map((i) => i.id)).toEqual(['plex:850', 'plex:800']);
    // Highlights the child we came from (the show, at index 1).
    expect(result.current.state.browse.items[result.current.state.highlight.idx].id).toBe('plex:800');
    // The listed level was fetched via /list of the clicked crumb's localId.
    expect(fetchMock.mock.calls.some(([u]) => u.startsWith('/api/v1/list/plex/900'))).toBe(true);
  });

  it('goToCrumb on the LAST (current) crumb is a no-op — no fetch, trail unchanged', async () => {
    fetchMock.mockImplementation((url) => (
      url.startsWith('/api/v1/siblings/plex/10') ? jsonResponse(SIBLINGS_RESPONSE) : jsonResponse({ items: [] })
    ));
    const { result } = setup({ value: 'plex:10' });
    await openBrowse(result);
    expect(result.current.state.browse.breadcrumbs).toHaveLength(1);
    const listCallsBefore = fetchMock.mock.calls.filter(([u]) => u.startsWith('/api/v1/list/')).length;

    await act(async () => { await result.current.goToCrumb(0); }); // index 0 is also the last crumb

    const listCallsAfter = fetchMock.mock.calls.filter(([u]) => u.startsWith('/api/v1/list/')).length;
    expect(listCallsAfter - listCallsBefore).toBe(0); // clicking the current level fetches nothing
    expect(result.current.state.browse.breadcrumbs).toHaveLength(1);
  });

  it('goUp refetches the parent level and pops the breadcrumb (WENT_UP)', async () => {
    fetchMock.mockImplementation((url) => {
      if (url.startsWith('/api/v1/siblings/plex/10')) return jsonResponse(SIBLINGS_RESPONSE);
      if (url.startsWith('/api/v1/list/plex/11')) return jsonResponse({ items: [{ id: 'plex:c1', title: 'Child 1' }] });
      if (url.startsWith('/api/v1/list/plex/100')) return jsonResponse({ items: SIBLINGS_RESPONSE.items });
      return jsonResponse({ items: [] });
    });
    const { result } = setup({ value: 'plex:10' });
    await openBrowse(result);
    await act(async () => { await result.current.drill(result.current.state.browse.items[2]); });
    expect(result.current.state.browse.breadcrumbs).toHaveLength(2);

    await act(async () => { await result.current.goUp(); });

    expect(result.current.state.mode).toBe('browse');
    expect(result.current.state.browse.breadcrumbs).toHaveLength(1);
    expect(result.current.state.browse.items.map((i) => i.id)).toEqual(['plex:9', 'plex:10', 'plex:11']);
    // Highlight lands on the container we came out of
    expect(result.current.state.browse.items[result.current.state.highlight.idx].id).toBe('plex:11');
  });

  it('F14: activeScope reflects a source prefix in the search text; clearScope rewrites to the bare term', () => {
    const { result } = setup({});

    act(() => { result.current.handleInput('singalong:nearer'); });
    expect(result.current.state.search).toBe('singalong:nearer');
    expect(result.current.activeScope).toBe('singalong');

    act(() => { result.current.clearScope(); });
    expect(result.current.state.search).toBe('nearer'); // scoped prefix stripped
    expect(result.current.activeScope).toBeNull();
  });

  it('F14: activeScope is null when there is no prefix and while not searching', () => {
    const { result } = setup({ value: 'plex:10' });
    expect(result.current.state.search).toBeNull();
    expect(result.current.activeScope).toBeNull(); // DISPLAY mode, not searching

    act(() => { result.current.handleInput('nearer'); });
    expect(result.current.activeScope).toBeNull(); // no source prefix
  });

  it('goUp at siblings root dismisses to DISPLAY keeping the committed value, not a raw-id search (F8)', async () => {
    fetchMock.mockImplementation((url) => (
      url.startsWith('/api/v1/siblings/plex/10') ? jsonResponse(SIBLINGS_RESPONSE) : jsonResponse({ items: [] })
    ));
    const { result } = setup({ value: 'plex:10' });
    await openBrowse(result);
    expect(result.current.state.mode).toBe('browse');
    // OPEN seeded search with the committed id; goUp at root must NOT keyword-search it.
    expect(result.current.state.search).toBe('plex:10');
    expect(result.current.state.browse.breadcrumbs).toHaveLength(1);

    await act(async () => { await result.current.goUp(); });

    expect(result.current.state.mode).toBe(Modes.DISPLAY);
    expect(result.current.state.search).toBeNull(); // DISPLAY resets search — no INPUT of the raw id
    expect(result.current.state.value).toBe('plex:10'); // committed value preserved
    expect(result.current.state.browse.items).toEqual([]);
    expect(result.current.state.browse.pagination).toBeNull();
  });

  // ── R2: searchSettled signal + commit(reason) executor ──

  it('searchSettled is false right after handleInput and true once the batch transport settles', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((url) => (
      url.startsWith('/api/v1/content/query/search')
        ? jsonResponse({ items: [{ id: 'plex:5', title: 'Bluey' }] })
        : jsonResponse({ items: [] })
    ));
    const { result } = setup({});

    act(() => { result.current.handleInput('bluey'); });
    // Debounce has not fired: queryRef.current is still stale ('' !== 'bluey').
    expect(result.current.searchSettled).toBe(false);

    await act(async () => { vi.advanceTimersByTime(350); });
    // Debounce fired, batch fetch resolved, batchLoading cleared.
    expect(result.current.searchSettled).toBe(true);
  });

  it("commit('enter') with a single leaf result selects it (onChange(id,item), DISPLAY)", async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    fetchMock.mockImplementation((url) => (
      url.startsWith('/api/v1/content/query/search')
        ? jsonResponse({ items: [{ id: 'plex:42', title: 'The Answer', type: 'episode' }] })
        : jsonResponse({ items: [] })
    ));
    const { result } = setup({ onChange });

    act(() => { result.current.handleInput('answ'); });
    await act(async () => { vi.advanceTimersByTime(350); });
    expect(result.current.state.results.map((r) => r.id)).toEqual(['plex:42']);

    let decision;
    act(() => { decision = result.current.commit('enter'); });

    expect(decision.action).toBe('select');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('plex:42', expect.objectContaining({ id: 'plex:42' }));
    expect(result.current.state.mode).toBe(Modes.DISPLAY);
    expect(result.current.state.search).toBeNull();
  });

  it("commit('enter') settled with empty results commits the raw text and flags a no-match toast", async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    // Default fetchMock returns items:[] — a settled, empty search.
    const { result } = setup({ onChange });

    act(() => { result.current.handleInput('nomatch'); });
    await act(async () => { vi.advanceTimersByTime(350); });
    expect(result.current.searchSettled).toBe(true);
    expect(result.current.state.results).toEqual([]);

    let decision;
    act(() => { decision = result.current.commit('enter'); });

    expect(decision.action).toBe('literal');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('nomatch');
    expect(notifyWarning).toHaveBeenCalledTimes(1);
    expect(notifyWarning).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('nomatch') })
    );
    expect(result.current.state.mode).toBe(Modes.DISPLAY);
  });

  it("commit('enter') settled with empty results and allowFreeform:false stays OPEN: no onChange, no toast, text intact (task 4)", async () => {
    // 2026-08-21 incident: this used to DISMISS — closing the box AND
    // discarding the typed query, costing the user their whole input on a
    // transient empty result set. Updated for task 4: Enter now keeps the
    // box open instead of dismissing (the raw text still never dispatches —
    // no /play 404 — but the query is no longer destroyed).
    vi.useFakeTimers();
    const onChange = vi.fn();
    // Default fetchMock returns items:[] — a settled, empty search.
    const { result } = setup({ onChange, allowFreeform: false });

    act(() => { result.current.handleInput('Think! How Intelligent Are Animals?'); });
    await act(async () => { vi.advanceTimersByTime(350); });
    expect(result.current.searchSettled).toBe(true);
    expect(result.current.state.results).toEqual([]);

    let decision;
    act(() => { decision = result.current.commit('enter'); });

    expect(decision.action).toBe('open');
    expect(onChange).toHaveBeenCalledTimes(0);   // raw text NEVER dispatched (no /play 404)
    expect(notifyWarning).toHaveBeenCalledTimes(0);
    expect(result.current.state.mode).toBe(Modes.SEARCH);        // box stays open
    expect(result.current.state.search).toBe('Think! How Intelligent Are Animals?'); // text survives
  });

  it("handleClose('outside') with id-like text and allowFreeform:false REVERTS: no onChange (RC4)", () => {
    const onChange = vi.fn();
    const { result } = setup({ onChange, allowFreeform: false });

    act(() => { result.current.handleInput('plex:999'); });
    act(() => { result.current.handleClose('outside'); });

    expect(onChange).toHaveBeenCalledTimes(0);
    expect(result.current.state.mode).toBe(Modes.DISPLAY);
  });

  it("commit('blur') with a changed, unpicked query reverts: no onChange, value preserved, DISPLAY", () => {
    const onChange = vi.fn();
    const { result } = setup({ value: 'plex:10', onChange });

    act(() => { result.current.handleInput('something else'); });
    expect(result.current.state.search).toBe('something else');

    let decision;
    act(() => { decision = result.current.commit('blur'); });

    expect(decision.action).toBe('revert');
    expect(onChange).toHaveBeenCalledTimes(0);
    expect(result.current.state.value).toBe('plex:10'); // committed value preserved
    expect(result.current.state.mode).toBe(Modes.DISPLAY);
    expect(result.current.state.search).toBeNull();
  });

  it("commit('enter') selects an id-lookup leaf ahead of the single-result rule", async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    fetchMock.mockImplementation((url) => (
      url.startsWith('/api/v1/content/query/search')
        ? jsonResponse({ items: [
            { id: 'plex:5', title: 'Exact', type: 'episode', matchReason: 'id-lookup' },
            { id: 'plex:6', title: 'Fuzzy', type: 'episode' },
          ] })
        : jsonResponse({ items: [] })
    ));
    const { result } = setup({ onChange });

    act(() => { result.current.handleInput('plexlike'); });
    await act(async () => { vi.advanceTimersByTime(350); });
    expect(result.current.state.results).toHaveLength(2);

    let decision;
    act(() => { decision = result.current.commit('enter'); });

    expect(decision.action).toBe('select');
    expect(onChange).toHaveBeenCalledWith('plex:5', expect.objectContaining({ id: 'plex:5' }));
    expect(result.current.state.mode).toBe(Modes.DISPLAY);
  });

  // ── Task 5: search settle observability + one-shot retry on source errors ──
  // sourceErrors only ever arrives via the SSE transport (useStreamingSearch);
  // the batch fallback has no equivalent, so these run on the SSE path.

  describe('search settle logging + retry (Task 5)', () => {
    it('search.settled logs once per settled query with result counts and empty sourceErrors', async () => {
      vi.stubGlobal('EventSource', MockEventSource);
      vi.useFakeTimers();
      const { result } = setup({});

      act(() => { result.current.handleInput('beet'); });
      await act(async () => { vi.advanceTimersByTime(350); });

      act(() => {
        MockEventSource.instances[0].simulateMessage({
          event: 'results', source: 'plex', items: [{ id: 'plex:5', title: 'Beethoven' }], pending: [],
        });
      });
      act(() => {
        MockEventSource.instances[0].simulateMessage({ event: 'complete' });
      });

      expect(result.current.searchSettled).toBe(true);
      expect(mockLog.info).toHaveBeenCalledWith('search.settled', {
        textLength: 'beet'.length,
        resultCount: 1,
        rawResultCount: 1,
        sourceErrors: [],
        scopeKey: null,
      });
      // Logged exactly once for this settle — no duplicate on subsequent renders.
      const settledCalls = mockLog.info.mock.calls.filter(([event]) => event === 'search.settled');
      expect(settledCalls).toHaveLength(1);
      expect(mockLog.warn).not.toHaveBeenCalledWith('search.source_error', expect.anything());
    });

    it('search.source_error warns once per errored source when a search settles with a stream error', async () => {
      vi.stubGlobal('EventSource', MockEventSource);
      vi.useFakeTimers();
      const { result } = setup({});

      act(() => { result.current.handleInput('ghost'); });
      await act(async () => { vi.advanceTimersByTime(350); });

      act(() => {
        MockEventSource.instances[0].simulateMessage({
          event: 'source_error', source: 'plex', error: 'adapter timeout', pending: [],
        });
      });
      act(() => {
        MockEventSource.instances[0].simulateMessage({
          event: 'results', source: 'abs', items: [{ id: 'abs:1', title: 'Ghost Story' }], pending: [],
        });
      });
      act(() => {
        MockEventSource.instances[0].simulateMessage({ event: 'complete' });
      });

      expect(result.current.searchSettled).toBe(true);
      expect(mockLog.warn).toHaveBeenCalledWith('search.source_error', { source: 'plex', error: 'adapter timeout' });
      expect(mockLog.info).toHaveBeenCalledWith('search.settled', {
        textLength: 'ghost'.length,
        resultCount: 1,
        rawResultCount: 1,
        sourceErrors: ['plex'],
        scopeKey: null,
      });
      // Non-empty results ⇒ the recovery retry must NOT fire.
      expect(mockLog.info).not.toHaveBeenCalledWith('search.retry_after_source_error', expect.anything());
      expect(MockEventSource.instances).toHaveLength(1);
    });

    it('search.retry_after_source_error re-dispatches exactly once on settled-empty-with-source-errors, and does not loop on the retry\'s own settle', async () => {
      vi.stubGlobal('EventSource', MockEventSource);
      vi.useFakeTimers();
      const { result } = setup({});

      act(() => { result.current.handleInput('ghost'); });
      await act(async () => { vi.advanceTimersByTime(350); });
      expect(MockEventSource.instances).toHaveLength(1);

      // First settle: zero results + one source error → exactly one retry.
      act(() => {
        MockEventSource.instances[0].simulateMessage({
          event: 'source_error', source: 'plex', error: 'adapter timeout', pending: [],
        });
      });
      act(() => {
        MockEventSource.instances[0].simulateMessage({ event: 'complete' });
      });

      expect(MockEventSource.instances).toHaveLength(2); // the retry opened a NEW stream
      expect(MockEventSource.instances[1].url).toContain('text=ghost');
      expect(mockLog.info).toHaveBeenCalledWith('search.retry_after_source_error', {
        textLength: 'ghost'.length,
        sourceErrors: ['plex'],
      });
      const retryCallsAfterFirst = mockLog.info.mock.calls.filter(([event]) => event === 'search.retry_after_source_error');
      expect(retryCallsAfterFirst).toHaveLength(1);

      // Second settle of the SAME text (the retry itself errors again) must NOT retry again.
      act(() => {
        MockEventSource.instances[1].simulateMessage({
          event: 'source_error', source: 'plex', error: 'adapter timeout again', pending: [],
        });
      });
      act(() => {
        MockEventSource.instances[1].simulateMessage({ event: 'complete' });
      });

      expect(MockEventSource.instances).toHaveLength(2); // no third stream opened
      const retryCallsAfterSecond = mockLog.info.mock.calls.filter(([event]) => event === 'search.retry_after_source_error');
      expect(retryCallsAfterSecond).toHaveLength(1); // still just the one retry, ever
    });

    it('retries the failed source under the current scope instead of widening to a whole-query retry', async () => {
      // Break caught: empty failure recovery opens another catalog-wide stream,
      // so a known failed adapter is not the only source queried on retry.
      vi.stubGlobal('EventSource', MockEventSource);
      vi.useFakeTimers();
      const { result } = setup({ searchParams: 'capability=listable&scope=kids' });

      act(() => { result.current.handleInput('arrival'); });
      await act(async () => { vi.advanceTimersByTime(350); });
      act(() => {
        MockEventSource.instances[0].simulateMessage({ event: 'source_error', source: 'abs', error: 'offline', pending: [] });
        MockEventSource.instances[0].simulateMessage({ event: 'complete' });
      });

      expect(MockEventSource.instances).toHaveLength(2);
      expect(MockEventSource.instances[1].url).toContain('capability=listable');
      expect(MockEventSource.instances[1].url).toContain('scope=kids');
      expect(MockEventSource.instances[1].url).toContain('source=abs');
    });
  });

  // ── Task 11: scoped-empty fallback to All (spec D5) ──
  // A search scoped to a narrow library (e.g. Music>Ambient) settling empty
  // used to look identical to "this doesn't exist" — the 2026-08-21 incident
  // this task fixes. Composes with Task 5's effects above: source errors take
  // the same-params retry first; the wider-params fallback only fires on a
  // CLEAN empty settle.

  describe('scoped-empty fallback to All (Task 11)', () => {
    it('re-dispatches the same text with fallbackSearchParams once on a clean empty settle, marks fellBackToAll, and does not loop on the fallback\'s own empty settle', async () => {
      vi.stubGlobal('EventSource', MockEventSource);
      vi.useFakeTimers();
      const { result } = setup({ searchParams: 'source=ambient', fallbackSearchParams: '' });

      act(() => { result.current.handleInput('bluey'); });
      await act(async () => { vi.advanceTimersByTime(350); });
      expect(MockEventSource.instances).toHaveLength(1);
      expect(MockEventSource.instances[0].url).toContain('source=ambient');
      expect(result.current.fellBackToAll).toBe(false);

      // First settle: clean (no source errors), zero results. The fallback
      // fires within this same settle and immediately starts a NEW search —
      // by the time this act() flushes, isSearching is already true again
      // for the fallback dispatch, so searchSettled is not asserted here.
      act(() => { MockEventSource.instances[0].simulateMessage({ event: 'complete' }); });

      expect(MockEventSource.instances).toHaveLength(2); // fallback opened a NEW stream
      expect(MockEventSource.instances[1].url).toContain('text=bluey');
      expect(MockEventSource.instances[1].url).not.toContain('source=ambient'); // widened
      expect(result.current.fellBackToAll).toBe(true);

      // Second (fallback) settle, also empty — must NOT loop into a third stream.
      act(() => { MockEventSource.instances[1].simulateMessage({ event: 'complete' }); });
      expect(MockEventSource.instances).toHaveLength(2);
      expect(result.current.fellBackToAll).toBe(true); // flag persists, no reset
    });

    it('does not fall back when fallbackSearchParams is absent — no-op for consumers that never opt in', async () => {
      vi.stubGlobal('EventSource', MockEventSource);
      vi.useFakeTimers();
      const { result } = setup({ searchParams: 'source=ambient' }); // no fallbackSearchParams

      act(() => { result.current.handleInput('bluey'); });
      await act(async () => { vi.advanceTimersByTime(350); });
      act(() => { MockEventSource.instances[0].simulateMessage({ event: 'complete' }); });

      expect(MockEventSource.instances).toHaveLength(1); // no fallback dispatch
      expect(result.current.fellBackToAll).toBe(false);
    });

    it('does not fall back when searchParams already equals fallbackSearchParams (already catalog-wide)', async () => {
      vi.stubGlobal('EventSource', MockEventSource);
      vi.useFakeTimers();
      const { result } = setup({ searchParams: '', fallbackSearchParams: '' });

      act(() => { result.current.handleInput('bluey'); });
      await act(async () => { vi.advanceTimersByTime(350); });
      act(() => { MockEventSource.instances[0].simulateMessage({ event: 'complete' }); });

      expect(MockEventSource.instances).toHaveLength(1); // would loop the identical search
      expect(result.current.fellBackToAll).toBe(false);
    });

    it('source errors take priority: Task 5\'s same-params retry fires, the wider-params fallback does not', async () => {
      vi.stubGlobal('EventSource', MockEventSource);
      vi.useFakeTimers();
      const { result } = setup({ searchParams: 'source=ambient', fallbackSearchParams: '' });

      act(() => { result.current.handleInput('bluey'); });
      await act(async () => { vi.advanceTimersByTime(350); });
      act(() => {
        MockEventSource.instances[0].simulateMessage({ event: 'source_error', source: 'plex', error: 'timeout', pending: [] });
      });
      act(() => { MockEventSource.instances[0].simulateMessage({ event: 'complete' }); });

      expect(MockEventSource.instances).toHaveLength(2); // Task 5's retry fired
      expect(MockEventSource.instances[1].url).toContain('source=plex'); // failed source only — not widened
      expect(result.current.fellBackToAll).toBe(false); // fallback did not fire this round
    });

    it('a new query resets fellBackToAll even if the previous query had fallen back', async () => {
      vi.stubGlobal('EventSource', MockEventSource);
      vi.useFakeTimers();
      const { result } = setup({ searchParams: 'source=ambient', fallbackSearchParams: '' });

      act(() => { result.current.handleInput('bluey'); });
      await act(async () => { vi.advanceTimersByTime(350); });
      act(() => { MockEventSource.instances[0].simulateMessage({ event: 'complete' }); });
      expect(result.current.fellBackToAll).toBe(true);

      act(() => { result.current.handleInput('another'); });
      expect(result.current.fellBackToAll).toBe(false); // reset immediately on new INPUT
    });

    it('threads scopeKey/scopeLabel into search.dispatch, search.settled, and search.fallback_to_all — an observability gap from the 2026-08-21 incident', async () => {
      vi.stubGlobal('EventSource', MockEventSource);
      vi.useFakeTimers();
      const { result } = setup({
        searchParams: 'source=ambient', fallbackSearchParams: '',
        scopeKey: 'music-ambient', scopeLabel: 'Ambient',
      });

      act(() => { result.current.handleInput('bluey'); });
      await act(async () => { vi.advanceTimersByTime(350); });
      expect(mockLog.info).toHaveBeenCalledWith('search.dispatch', {
        text: 'bluey', mode: 'sse', scopeKey: 'music-ambient',
      });

      act(() => { MockEventSource.instances[0].simulateMessage({ event: 'complete' }); });

      expect(mockLog.info).toHaveBeenCalledWith('search.settled', {
        textLength: 'bluey'.length, resultCount: 0, rawResultCount: 0, sourceErrors: [],
        scopeKey: 'music-ambient',
      });
      expect(mockLog.info).toHaveBeenCalledWith('search.fallback_to_all', {
        textLength: 'bluey'.length, searchParams: 'source=ambient', fallbackSearchParams: null,
        scopeKey: 'music-ambient', scopeLabel: 'Ambient',
      });
    });

    it('scopeKey is absent for callers that never pass it — logs carry scopeKey: null, no behavior change', async () => {
      vi.stubGlobal('EventSource', MockEventSource);
      vi.useFakeTimers();
      const { result } = setup({}); // no scopeKey — Admin/PlaybackHub shape

      act(() => { result.current.handleInput('beet'); });
      await act(async () => { vi.advanceTimersByTime(350); });
      expect(mockLog.info).toHaveBeenCalledWith('search.dispatch', {
        text: 'beet', mode: 'sse', scopeKey: null,
      });
    });
  });

  // ── Final review, Important 3: a scope chip must actually re-run the search ──
  // Nothing watched `searchParams`. useStreamingSearch reads it only inside
  // search(), so tapping "Music" with results on screen changed the chip's
  // pressed state and nothing else — the user believed a filter had applied
  // while the list underneath stayed catalog-wide.
  describe('scope change re-runs the search (Important 3)', () => {
    it('re-dispatches the current text under the new scope params', async () => {
      vi.stubGlobal('EventSource', MockEventSource);
      vi.useFakeTimers();
      const onChange = vi.fn();
      const { result, rerender } = setup({ onChange, searchParams: '' });

      act(() => { result.current.handleInput('bluey'); });
      await act(async () => { vi.advanceTimersByTime(350); });
      expect(MockEventSource.instances).toHaveLength(1);
      expect(MockEventSource.instances[0].url).not.toContain('source=music');

      // Chip tap: the host swaps searchParams while the text stays put.
      rerender({ value: '', onChange, searchParams: 'source=music' });
      await act(async () => { vi.advanceTimersByTime(350); });

      expect(MockEventSource.instances).toHaveLength(2);
      expect(MockEventSource.instances[1].url).toContain('text=bluey');
      expect(MockEventSource.instances[1].url).toContain('source=music');
      expect(mockLog.info).toHaveBeenCalledWith('search.rerun_for_scope', {
        textLength: 'bluey'.length, scopeKey: null,
      });
    });

    it('does not dispatch on mount, nor when the box is empty or too short', async () => {
      vi.stubGlobal('EventSource', MockEventSource);
      vi.useFakeTimers();
      const onChange = vi.fn();
      const { result, rerender } = setup({ onChange, searchParams: '' });
      await act(async () => { vi.advanceTimersByTime(350); });
      expect(MockEventSource.instances).toHaveLength(0); // mount alone searches nothing

      act(() => { result.current.handleInput('b'); }); // below the 2-char floor
      await act(async () => { vi.advanceTimersByTime(350); });
      const beforeScopeChange = MockEventSource.instances.length;

      rerender({ value: '', onChange, searchParams: 'source=music' });
      await act(async () => { vi.advanceTimersByTime(350); });
      expect(MockEventSource.instances).toHaveLength(beforeScopeChange);
    });

    it('coalesces with a pending keystroke instead of racing a second request against it', async () => {
      vi.stubGlobal('EventSource', MockEventSource);
      vi.useFakeTimers();
      const onChange = vi.fn();
      const { result, rerender } = setup({ onChange, searchParams: '' });

      act(() => { result.current.handleInput('bluey'); });
      await act(async () => { vi.advanceTimersByTime(100); }); // still debouncing
      rerender({ value: '', onChange, searchParams: 'source=music' });
      await act(async () => { vi.advanceTimersByTime(350); });

      // ONE dispatch, under the new scope — not one stale + one scoped.
      expect(MockEventSource.instances).toHaveLength(1);
      expect(MockEventSource.instances[0].url).toContain('source=music');
    });

    it('retires the active stream before the replacement text debounce can accept a late callback', async () => {
      // Break caught: the visible query changes immediately but the old SSE
      // remains current for 350ms and can publish results under new intent.
      vi.stubGlobal('EventSource', MockEventSource);
      vi.useFakeTimers();
      const { result } = setup({ searchParams: '' });

      act(() => { result.current.handleInput('bluey'); });
      await act(async () => { vi.advanceTimersByTime(350); });
      const first = MockEventSource.instances[0];

      act(() => { result.current.handleInput('arrival'); });
      expect(first.readyState).toBe(2);
      act(() => {
        first.simulateMessage({ event: 'results', source: 'plex', items: [{ id: 'plex:stale', title: 'Stale' }], pending: [] });
        first.simulateMessage({ event: 'complete' });
        first.simulateError();
      });

      expect(result.current.state.search).toBe('arrival');
      expect(result.current.state.results).toEqual([]);
      expect(result.current.isSearching).toBe(true); // replacement debounce owns visible intent
      expect(result.current.streamError).toBeNull();
    });

    it('retires the active stream immediately when scope changes, before its scoped debounce fires', async () => {
      // Break caught: a scope chip changes while the old EventSource remains
      // owner until the delayed replacement dispatch begins.
      vi.stubGlobal('EventSource', MockEventSource);
      vi.useFakeTimers();
      const onChange = vi.fn();
      const { result, rerender } = setup({ onChange, searchParams: '' });

      act(() => { result.current.handleInput('bluey'); });
      await act(async () => { vi.advanceTimersByTime(350); });
      const first = MockEventSource.instances[0];

      rerender({ value: '', onChange, searchParams: 'source=music' });
      expect(first.readyState).toBe(2);
      act(() => {
        first.simulateMessage({ event: 'results', source: 'plex', items: [{ id: 'plex:stale', title: 'Stale' }], pending: [] });
        first.simulateMessage({ event: 'complete' });
        first.simulateError();
      });

      expect(result.current.state.results).toEqual([]);
      expect(result.current.isSearching).toBe(true); // replacement debounce owns visible intent
      expect(result.current.streamError).toBeNull();
    });

    it('re-arms the once-per-search guards: the same text under a new scope logs its own settle and widens again', async () => {
      vi.stubGlobal('EventSource', MockEventSource);
      vi.useFakeTimers();
      const onChange = vi.fn();
      const { result, rerender } = setup({ onChange, searchParams: 'source=ambient', fallbackSearchParams: '' });

      act(() => { result.current.handleInput('bluey'); });
      await act(async () => { vi.advanceTimersByTime(350); });
      act(() => { MockEventSource.instances[0].simulateMessage({ event: 'complete' }); });
      expect(result.current.fellBackToAll).toBe(true);
      expect(MockEventSource.instances).toHaveLength(2); // scoped + widened
      act(() => { MockEventSource.instances[1].simulateMessage({ event: 'complete' }); });

      // Same words, different chip. Keyed on text alone, every guard below was
      // already spent and this scope could never settle-log or widen.
      rerender({ value: '', onChange, searchParams: 'source=jazz', fallbackSearchParams: '' });
      expect(result.current.fellBackToAll).toBe(false); // stale flag cleared
      await act(async () => { vi.advanceTimersByTime(350); });
      expect(MockEventSource.instances).toHaveLength(3);
      expect(MockEventSource.instances[2].url).toContain('source=jazz');

      act(() => { MockEventSource.instances[2].simulateMessage({ event: 'complete' }); });

      const settles = mockLog.info.mock.calls.filter(([event]) => event === 'search.settled');
      expect(settles).toHaveLength(2); // one per scope, not one per text
      expect(MockEventSource.instances).toHaveLength(4); // the jazz scope widened on its own
      expect(MockEventSource.instances[3].url).not.toContain('source=jazz');
      expect(result.current.fellBackToAll).toBe(true);
    });

    it('ignores the stale settle between a chip tap and its re-dispatch', async () => {
      vi.stubGlobal('EventSource', MockEventSource);
      vi.useFakeTimers();
      const onChange = vi.fn();
      const { result, rerender } = setup({ onChange, searchParams: 'source=ambient', fallbackSearchParams: '' });

      act(() => { result.current.handleInput('bluey'); });
      await act(async () => { vi.advanceTimersByTime(350); });
      act(() => {
        MockEventSource.instances[0].simulateMessage({
          event: 'results', source: 'plex', items: [{ id: 'plex:1', title: 'Bluey' }], pending: [],
        });
      });
      act(() => { MockEventSource.instances[0].simulateMessage({ event: 'complete' }); });
      expect(result.current.searchSettled).toBe(true);

      // The instant the chip flips, the transports are idle and the box text is
      // unchanged, so `searchSettled` is still true — but those results belong
      // to the OLD scope. Nothing may act on that settle.
      const settlesBefore = mockLog.info.mock.calls.filter(([e]) => e === 'search.settled').length;
      rerender({ value: '', onChange, searchParams: 'source=jazz', fallbackSearchParams: '' });
      const settlesAfter = mockLog.info.mock.calls.filter(([e]) => e === 'search.settled').length;
      expect(settlesAfter).toBe(settlesBefore);
      expect(MockEventSource.instances).toHaveLength(1); // nothing widened off a stale settle
    });
  });

  // ── Final review, Important 4: a persistent source error must not veto the
  // widening. `if (sourceErrors.length > 0) return` in the old widening effect
  // meant a genuinely-down Plex left a scoped search with no results AND no
  // explanation — both halves of the 2026-08-21 incident at once. ──
  describe('recovery ladder: retry then widen (Important 4)', () => {
    it('widens after the one-shot retry is spent and the source errors again', async () => {
      vi.stubGlobal('EventSource', MockEventSource);
      vi.useFakeTimers();
      const { result } = setup({ searchParams: 'source=ambient', fallbackSearchParams: '' });

      act(() => { result.current.handleInput('bluey'); });
      await act(async () => { vi.advanceTimersByTime(350); });

      // Settle 1: empty + a source error → rung 1, the failed-source retry.
      act(() => {
        MockEventSource.instances[0].simulateMessage({ event: 'source_error', source: 'plex', error: 'down', pending: [] });
      });
      act(() => { MockEventSource.instances[0].simulateMessage({ event: 'complete' }); });
      expect(MockEventSource.instances).toHaveLength(2);
      expect(MockEventSource.instances[1].url).toContain('source=plex'); // failed source only
      expect(result.current.fellBackToAll).toBe(false); // rung 2 has NOT run yet

      // Settle 2: the retry errors again and is still empty. Pre-fix this was
      // the end of the road. Now rung 2 runs.
      act(() => {
        MockEventSource.instances[1].simulateMessage({ event: 'source_error', source: 'plex', error: 'still down', pending: [] });
      });
      act(() => { MockEventSource.instances[1].simulateMessage({ event: 'complete' }); });

      expect(MockEventSource.instances).toHaveLength(3);
      expect(MockEventSource.instances[2].url).toContain('text=bluey');
      expect(MockEventSource.instances[2].url).not.toContain('source=ambient'); // widened
      expect(result.current.fellBackToAll).toBe(true); // the surface can now explain itself
    });

    it('stops after the widening — a still-empty widened search does not loop', async () => {
      vi.stubGlobal('EventSource', MockEventSource);
      vi.useFakeTimers();
      const { result } = setup({ searchParams: 'source=ambient', fallbackSearchParams: '' });

      act(() => { result.current.handleInput('bluey'); });
      await act(async () => { vi.advanceTimersByTime(350); });
      act(() => {
        MockEventSource.instances[0].simulateMessage({ event: 'source_error', source: 'plex', error: 'down', pending: [] });
      });
      act(() => { MockEventSource.instances[0].simulateMessage({ event: 'complete' }); });
      act(() => {
        MockEventSource.instances[1].simulateMessage({ event: 'source_error', source: 'plex', error: 'down', pending: [] });
      });
      act(() => { MockEventSource.instances[1].simulateMessage({ event: 'complete' }); });
      expect(MockEventSource.instances).toHaveLength(3);

      // The widened search also errors and also finds nothing: both rungs are
      // spent for this (text, scope), so it ends here.
      act(() => {
        MockEventSource.instances[2].simulateMessage({ event: 'source_error', source: 'plex', error: 'down', pending: [] });
      });
      act(() => { MockEventSource.instances[2].simulateMessage({ event: 'complete' }); });
      expect(MockEventSource.instances).toHaveLength(3);
      expect(result.current.fellBackToAll).toBe(true);
    });

    it('never widens when the retry succeeds — results end the ladder', async () => {
      vi.stubGlobal('EventSource', MockEventSource);
      vi.useFakeTimers();
      const { result } = setup({ searchParams: 'source=ambient', fallbackSearchParams: '' });

      act(() => { result.current.handleInput('bluey'); });
      await act(async () => { vi.advanceTimersByTime(350); });
      act(() => {
        MockEventSource.instances[0].simulateMessage({ event: 'source_error', source: 'plex', error: 'blip', pending: [] });
      });
      act(() => { MockEventSource.instances[0].simulateMessage({ event: 'complete' }); });
      expect(MockEventSource.instances).toHaveLength(2);

      act(() => {
        MockEventSource.instances[1].simulateMessage({
          event: 'results', source: 'plex', items: [{ id: 'plex:1', title: 'Bluey' }], pending: [],
        });
      });
      act(() => { MockEventSource.instances[1].simulateMessage({ event: 'complete' }); });

      expect(MockEventSource.instances).toHaveLength(2);
      expect(result.current.fellBackToAll).toBe(false);
    });
  });
});
