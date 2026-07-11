// useContentCombobox.test.jsx — side-effect hook around the pure combobox machine.
// fetch and EventSource are fully stubbed; no test touches the network.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { clearCache, getCacheEntry, setCacheEntry } from '../siblingsCache.js';

vi.mock('../../../../lib/logging/singleton.js', () => {
  const logger = {
    debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
    sampled: () => {}, child: () => logger,
  };
  return { getChildLogger: () => logger, getDaylightLogger: () => logger, default: () => logger };
});

vi.mock('../../../../lib/appRegistry.js', () => ({
  APP_REGISTRY: { webcam: { label: 'Webcam', icon: 'webcam-icon.svg', param: null } },
  searchApps: (query) => (
    'webcam'.includes(String(query).toLowerCase())
      ? [{ id: 'webcam', label: 'Webcam', param: null }]
      : []
  ),
}));

// Warm the module cache for the mocked appRegistry so the hook's dynamic
// `import()` resolves instantly (keeps the app-results test deterministic).
import '../../../../lib/appRegistry.js';

import { useContentCombobox, titleCache, Modes } from './useContentCombobox.js';

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
    titleCache.clear();
    MockEventSource.instances = [];
    // Default: no SSE — forces the batch fallback path (supportsSSE() false).
    vi.stubGlobal('EventSource', undefined);
    fetchMock = vi.fn(() => jsonResponse({ items: [] }));
    vi.stubGlobal('fetch', fetchMock);
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
      url.startsWith('/api/v1/info/plex/777')
        ? jsonResponse({ title: 'Solo Piano' })
        : jsonResponse({ items: [] })
    ));
    const infoCalls = () => fetchMock.mock.calls.filter(([u]) => u.startsWith('/api/v1/info/')).length;

    const first = setup({ value: 'plex:777' });
    await waitFor(() => expect(first.result.current.resolvedTitle).toBe('Solo Piano'));
    expect(infoCalls()).toBe(1);
    first.unmount();

    const second = setup({ value: 'plex:777' });
    expect(second.result.current.resolvedTitle).toBe('Solo Piano');
    expect(infoCalls()).toBe(1); // cache hit — no second /info fetch
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
});
