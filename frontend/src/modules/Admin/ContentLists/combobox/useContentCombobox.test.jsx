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

vi.mock('../../shared/feedback.js', () => ({
  notifyWarning: vi.fn(),
}));

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
import { notifyWarning } from '../../shared/feedback.js';

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
    notifyWarning.mockClear();
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

  it('applyBrowseData builds the FULL sanitized ancestor trail when the siblings response carries ancestors', async () => {
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
    fetchMock.mockImplementation((url) => (
      url.startsWith('/api/v1/siblings/plex/642197') ? jsonResponse(RESPONSE_WITH_ANCESTORS) : jsonResponse({ items: [] })
    ));
    const { result } = setup({ value: 'plex:642197' });

    await openBrowse(result);

    expect(result.current.state.mode).toBe('browse');
    // Junk library + duplicate removed; full chain root-first with usable localId/source.
    expect(result.current.state.browse.breadcrumbs).toEqual([
      expect.objectContaining({ id: 'plex:900', title: 'The Old Testament', source: 'plex', localId: '900' }),
      expect.objectContaining({ id: 'plex:800', title: 'The Prophets', source: 'plex', localId: '800' }),
      expect.objectContaining({ id: 'plex:700', title: 'Season 8', source: 'plex', localId: '700' }),
    ]);
    expect(result.current.state.highlight.idx).toBe(1); // referenceIndex unchanged
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
});
