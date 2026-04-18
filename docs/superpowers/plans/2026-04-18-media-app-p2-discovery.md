# Media App P2 (Discovery) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Discovery surface — live SSE search, hierarchical browse, detail view, and a curated home — on top of the P1 foundation. Refactor the Canvas to support multiple views and keep the Player alive across navigation via a React portal.

**Architecture:** P2 adds one new provider (`SearchProvider` at app mount) and one navigation context (`NavProvider`) inside the shell. Search/browse UIs call `useSessionController('local').queue.*` directly — no navigation required to enqueue content. Player is always mounted inside `LocalSessionProvider`, and `NowPlayingView` claims its host element via `usePlayerHost(ref)` when visible; on unmount the Player falls back to a hidden default container so audio keeps playing while the user browses.

**Tech Stack:** React 18 + React Router 6 · Vite · Vitest + @testing-library/react + happy-dom · Playwright · existing singletons (`DaylightAPI`, `wsService`, `getChildLogger`) · existing `useStreamingSearch` hook (SSE consumer) · shared contracts at `@shared-contracts/media/*`.

---

## Pre-flight

- **Parent branch state:** main at HEAD (post-P1 deploy). P1 commits present: ClientIdentityProvider, LocalSessionProvider, LocalSessionAdapter, sessionReducer, queueOps, advancement, persistence, HiddenPlayerMount (inline), useSessionController, mediaLog, useUrlCommand, usePlaybackStateBroadcast, minimal shell, MediaApp entry, /media route.
- **Work isolation:** create a worktree via `superpowers:using-git-worktrees` (branch `feature/media-app-p2`) before starting Task 1. Install deps (`npm install` at root + in `frontend/`) and confirm baseline: `cd frontend && npx vitest run src/modules/Media` passes ~80 tests.
- **APIs in use (verified on prod container at :3111):**
  - `GET /api/v1/content/query/search/stream` — SSE, events `pending` / `results` / `complete` (payloads at top level, `data.event` discriminator)
  - `GET /api/v1/content/query/search` — sync JSON `{query, items, total, sources}`
  - `GET /api/v1/media/config` — `{browse: [...], searchScopes: [...]}`
  - `GET /api/v1/list/*` — paginated catalog (wrapped in a reusable hook)
  - `GET /api/v1/info/:source/*` — content detail
- **Existing hook to reuse:** `frontend/src/hooks/useStreamingSearch.js` — already wraps EventSource with pending/results/isSearching and 300ms debounce. P2's `useLiveSearch` thinly wraps it with media-app-specific scope params and `mediaLog` events.
- **Response shape reality check:** actual search items have `id`, `itemId`, `source`, `localId`, `title`, `thumbnail`, `metadata`, `mediaType`, `itemType` — NOT the strict `SearchResult` shape from §9.6 of the technical contract. P2 consumes the actual shape and maps through a small adapter; strict contract validation is a backend concern.

---

## File map

| Path | Responsibility |
|---|---|
| `frontend/src/modules/Media/search/SearchProvider.jsx` | Loads `/api/v1/media/config` scopes; holds current scope + recents/favorites |
| `frontend/src/modules/Media/search/useLiveSearch.js` | Debounced SSE search wrapping `useStreamingSearch` |
| `frontend/src/modules/Media/search/SearchBar.jsx` | Dock input + dropdown of inline results (C1.1) |
| `frontend/src/modules/Media/search/SearchResults.jsx` | Result list with inline actions (C1.1a) |
| `frontend/src/modules/Media/search/resultToQueueInput.js` | Maps a search-result row to `{contentId, format, title, thumbnail, duration}` for `queue.*` calls |
| `frontend/src/modules/Media/browse/useListBrowse.js` | Paginated list fetch |
| `frontend/src/modules/Media/browse/useContentInfo.js` | `/api/v1/info/:source/*` fetch |
| `frontend/src/modules/Media/browse/BrowseView.jsx` | Hierarchical browse canvas view |
| `frontend/src/modules/Media/browse/DetailView.jsx` | Content detail canvas view |
| `frontend/src/modules/Media/browse/HomeView.jsx` | Curated home; composes `BrowseView` slices from `searchScopes` |
| `frontend/src/modules/Media/shell/NavProvider.jsx` | Client-side canvas-view state `{view, params, push, pop}` |
| `frontend/src/modules/Media/shell/Canvas.jsx` | **modify** — view registry dispatching on `useNav().view` |
| `frontend/src/modules/Media/shell/Dock.jsx` | **modify** — add `<SearchBar />` |
| `frontend/src/modules/Media/shell/NowPlayingView.jsx` | **modify** — claims Player host via `usePlayerHost(ref)` on mount |
| `frontend/src/modules/Media/shell/MediaAppShell.jsx` | **modify** — wrap children in `<NavProvider>` |
| `frontend/src/modules/Media/session/LocalSessionProvider.jsx` | **modify** — export `PlayerHostContext`, render `HiddenPlayerMount` portaled into `playerHostEl` or a hidden default |
| `frontend/src/modules/Media/session/HiddenPlayerMount.jsx` | **modify** — read `playerHostEl` from context, `createPortal` into it (falling back to an owned hidden div) |
| `frontend/src/modules/Media/session/usePlayerHost.js` | Hook for views to register their host ref |
| `frontend/src/Apps/MediaApp.jsx` | **modify** — add `<SearchProvider>` to the stack |
| `tests/live/flow/media/media-app-discovery.runtime.test.mjs` | End-to-end Playwright for search → result → play |

---

## Task 1: `useLiveSearch` hook

**Files:**
- Create: `frontend/src/modules/Media/search/useLiveSearch.js`
- Test: `frontend/src/modules/Media/search/useLiveSearch.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Media/search/useLiveSearch.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const innerSearch = vi.fn();
let innerState = { results: [], pending: [], isSearching: false, search: innerSearch };
vi.mock('../../../hooks/useStreamingSearch.js', () => ({
  useStreamingSearch: vi.fn(() => innerState),
}));

import { useLiveSearch } from './useLiveSearch.js';

beforeEach(() => {
  innerSearch.mockClear();
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
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/modules/Media/search/useLiveSearch.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// frontend/src/modules/Media/search/useLiveSearch.js
import { useCallback } from 'react';
import { useStreamingSearch } from '../../../hooks/useStreamingSearch.js';
import mediaLog from '../logging/mediaLog.js';

const SEARCH_ENDPOINT = '/api/v1/content/query/search/stream';

export function useLiveSearch({ scopeParams = '' } = {}) {
  const inner = useStreamingSearch(SEARCH_ENDPOINT, scopeParams);

  const setQuery = useCallback((query) => {
    mediaLog.searchIssued({ text: query, scopeParams });
    inner.search(query, scopeParams);
  }, [inner, scopeParams]);

  return {
    results: inner.results,
    pending: inner.pending,
    isSearching: inner.isSearching,
    setQuery,
  };
}

export default useLiveSearch;
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/modules/Media/search/useLiveSearch.test.jsx`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/search/useLiveSearch.js frontend/src/modules/Media/search/useLiveSearch.test.jsx
git commit -m "feat(media): add useLiveSearch wrapping useStreamingSearch"
```

---

## Task 2: `SearchProvider`

**Files:**
- Create: `frontend/src/modules/Media/search/SearchProvider.jsx`
- Test: `frontend/src/modules/Media/search/SearchProvider.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Media/search/SearchProvider.test.jsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(async (path) => {
    if (path === 'api/v1/media/config') {
      return {
        searchScopes: [
          { label: 'All', key: 'all', params: 'take=50' },
          { label: 'Video', key: 'video', params: 'source=plex&mediaType=video' },
        ],
      };
    }
    return {};
  }),
}));

import { SearchProvider, useSearchContext, SCOPE_KEY_LAST } from './SearchProvider.jsx';

function Probe() {
  const { scopes, currentScopeKey, setScopeKey } = useSearchContext();
  return (
    <div>
      <span data-testid="scopes">{scopes.map((s) => s.key).join(',')}</span>
      <span data-testid="current">{currentScopeKey}</span>
      <button onClick={() => setScopeKey('video')} data-testid="pick-video">video</button>
    </div>
  );
}

describe('SearchProvider', () => {
  beforeEach(() => { localStorage.clear(); });

  it('loads scopes from /api/v1/media/config on mount', async () => {
    render(<SearchProvider><Probe /></SearchProvider>);
    await waitFor(() => expect(screen.getByTestId('scopes')).toHaveTextContent('all,video'));
  });

  it('defaults currentScopeKey to the first scope', async () => {
    render(<SearchProvider><Probe /></SearchProvider>);
    await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('all'));
  });

  it('persists current scope to localStorage and restores on next mount', async () => {
    const { unmount } = render(<SearchProvider><Probe /></SearchProvider>);
    await waitFor(() => screen.getByTestId('pick-video'));
    act(() => { screen.getByTestId('pick-video').click(); });
    await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('video'));
    expect(localStorage.getItem(SCOPE_KEY_LAST)).toBe('video');
    unmount();

    render(<SearchProvider><Probe /></SearchProvider>);
    await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('video'));
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd frontend && npx vitest run src/modules/Media/search/SearchProvider.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```jsx
// frontend/src/modules/Media/search/SearchProvider.jsx
import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';

export const SCOPE_KEY_LAST = 'media-scope-last';

const SearchContext = createContext(null);

export function SearchProvider({ children }) {
  const [scopes, setScopes] = useState([]);
  const [currentScopeKey, setCurrentScopeKey] = useState(null);

  useEffect(() => {
    let cancelled = false;
    DaylightAPI('api/v1/media/config').then((cfg) => {
      if (cancelled) return;
      const loaded = Array.isArray(cfg?.searchScopes) ? cfg.searchScopes : [];
      setScopes(loaded);
      const stored = localStorage.getItem(SCOPE_KEY_LAST);
      const storedValid = stored && loaded.find((s) => s.key === stored);
      setCurrentScopeKey(storedValid ? stored : loaded[0]?.key ?? null);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const setScopeKey = useCallback((key) => {
    setCurrentScopeKey(key);
    try { localStorage.setItem(SCOPE_KEY_LAST, key); } catch { /* ignore */ }
  }, []);

  const currentScope = useMemo(
    () => scopes.find((s) => s.key === currentScopeKey) ?? null,
    [scopes, currentScopeKey]
  );

  const value = useMemo(
    () => ({ scopes, currentScopeKey, currentScope, setScopeKey }),
    [scopes, currentScopeKey, currentScope, setScopeKey]
  );

  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>;
}

export function useSearchContext() {
  const ctx = useContext(SearchContext);
  if (!ctx) throw new Error('useSearchContext must be used inside SearchProvider');
  return ctx;
}

export default SearchProvider;
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/modules/Media/search/SearchProvider.test.jsx`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/search/SearchProvider.jsx frontend/src/modules/Media/search/SearchProvider.test.jsx
git commit -m "feat(media): SearchProvider loads scopes, persists current scope"
```

---

## Task 3: `resultToQueueInput` adapter

**Files:**
- Create: `frontend/src/modules/Media/search/resultToQueueInput.js`
- Test: `frontend/src/modules/Media/search/resultToQueueInput.test.js`

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/modules/Media/search/resultToQueueInput.test.js
import { describe, it, expect } from 'vitest';
import { resultToQueueInput } from './resultToQueueInput.js';

describe('resultToQueueInput', () => {
  it('maps id to contentId, preserving title/thumbnail/duration when present', () => {
    const row = { id: 'plex:660761', title: 'Lonesome Ghosts', thumbnail: '/t.jpg', duration: 600, mediaType: 'video' };
    expect(resultToQueueInput(row)).toEqual({
      contentId: 'plex:660761', title: 'Lonesome Ghosts', thumbnail: '/t.jpg', duration: 600, format: 'video',
    });
  });

  it('falls back to itemId when id is missing', () => {
    const row = { itemId: 'abs:abc' };
    expect(resultToQueueInput(row).contentId).toBe('abs:abc');
  });

  it('falls back to "<source>:<localId>" if id/itemId both missing', () => {
    expect(resultToQueueInput({ source: 'plex', localId: 'xyz' }).contentId).toBe('plex:xyz');
  });

  it('returns null for rows with no identifier', () => {
    expect(resultToQueueInput({})).toBeNull();
    expect(resultToQueueInput(null)).toBeNull();
  });

  it('treats mediaType "video" and "audio" as format; leaves everything else null', () => {
    expect(resultToQueueInput({ id: 'a:b', mediaType: 'audio' }).format).toBe('audio');
    expect(resultToQueueInput({ id: 'a:b', mediaType: 'video' }).format).toBe('video');
    expect(resultToQueueInput({ id: 'a:b', mediaType: 'image' }).format).toBe(null);
    expect(resultToQueueInput({ id: 'a:b' }).format).toBe(null);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd frontend && npx vitest run src/modules/Media/search/resultToQueueInput.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// frontend/src/modules/Media/search/resultToQueueInput.js
export function resultToQueueInput(row) {
  if (!row || typeof row !== 'object') return null;
  const contentId = row.id
    ?? row.itemId
    ?? (row.source && row.localId ? `${row.source}:${row.localId}` : null);
  if (!contentId) return null;
  const mediaType = row.mediaType;
  const format = mediaType === 'video' || mediaType === 'audio' ? mediaType : null;
  return {
    contentId,
    title: row.title ?? null,
    thumbnail: row.thumbnail ?? null,
    duration: typeof row.duration === 'number' ? row.duration : null,
    format,
  };
}

export default resultToQueueInput;
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/modules/Media/search/resultToQueueInput.test.js`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/search/resultToQueueInput.js frontend/src/modules/Media/search/resultToQueueInput.test.js
git commit -m "feat(media): add resultToQueueInput adapter (search row → queue input)"
```

---

## Task 4: `useListBrowse` hook

**Files:**
- Create: `frontend/src/modules/Media/browse/useListBrowse.js`
- Test: `frontend/src/modules/Media/browse/useListBrowse.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Media/browse/useListBrowse.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: (...args) => apiMock(...args),
}));

import { useListBrowse } from './useListBrowse.js';

beforeEach(() => { apiMock.mockReset(); });

describe('useListBrowse', () => {
  it('fetches on mount with take param and exposes items', async () => {
    apiMock.mockResolvedValueOnce({ items: [{ id: 'a' }, { id: 'b' }], total: 10 });
    const { result } = renderHook(() => useListBrowse('watchlist/TVApp', { take: 25 }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(apiMock).toHaveBeenCalledWith('api/v1/list/watchlist/TVApp?take=25');
    expect(result.current.items).toHaveLength(2);
    expect(result.current.total).toBe(10);
  });

  it('applies modifiers (playable + shuffle) as path segments', async () => {
    apiMock.mockResolvedValueOnce({ items: [], total: 0 });
    renderHook(() => useListBrowse('music/recent', { modifiers: { playable: true, shuffle: true }, take: 5 }));
    await waitFor(() => expect(apiMock).toHaveBeenCalled());
    expect(apiMock).toHaveBeenCalledWith('api/v1/list/music/recent/playable/shuffle?take=5');
  });

  it('loadMore appends the next page with skip', async () => {
    apiMock
      .mockResolvedValueOnce({ items: [{ id: '1' }], total: 2 })
      .mockResolvedValueOnce({ items: [{ id: '2' }], total: 2 });
    const { result } = renderHook(() => useListBrowse('x', { take: 1 }));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => { await result.current.loadMore(); });
    expect(apiMock).toHaveBeenLastCalledWith('api/v1/list/x?take=1&skip=1');
    expect(result.current.items).toEqual([{ id: '1' }, { id: '2' }]);
  });

  it('captures error and sets loading=false', async () => {
    apiMock.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useListBrowse('x'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.message).toBe('boom');
    expect(result.current.items).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd frontend && npx vitest run src/modules/Media/browse/useListBrowse.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// frontend/src/modules/Media/browse/useListBrowse.js
import { useState, useEffect, useCallback, useRef } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';

function buildPath(path, { modifiers = {} }) {
  const clean = String(path).replace(/^\/|\/$/g, '');
  const segs = [clean];
  if (modifiers.playable) segs.push('playable');
  if (modifiers.shuffle) segs.push('shuffle');
  if (modifiers.recent_on_top) segs.push('recent_on_top');
  return `api/v1/list/${segs.join('/')}`;
}

export function useListBrowse(path, { modifiers = {}, take = 50 } = {}) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const skipRef = useRef(0);
  const baseRef = useRef('');

  useEffect(() => {
    const base = buildPath(path, { modifiers });
    baseRef.current = base;
    skipRef.current = 0;
    setItems([]);
    setLoading(true);
    setError(null);

    let cancelled = false;
    DaylightAPI(`${base}?take=${take}`)
      .then((res) => {
        if (cancelled) return;
        setItems(Array.isArray(res?.items) ? res.items : []);
        setTotal(typeof res?.total === 'number' ? res.total : 0);
        skipRef.current = Array.isArray(res?.items) ? res.items.length : 0;
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err);
        setLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, take, modifiers.playable, modifiers.shuffle, modifiers.recent_on_top]);

  const loadMore = useCallback(async () => {
    const url = `${baseRef.current}?take=${take}&skip=${skipRef.current}`;
    try {
      const res = await DaylightAPI(url);
      setItems((prev) => prev.concat(Array.isArray(res?.items) ? res.items : []));
      skipRef.current += Array.isArray(res?.items) ? res.items.length : 0;
    } catch (err) {
      setError(err);
    }
  }, [take]);

  return { items, total, loading, error, loadMore };
}

export default useListBrowse;
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/modules/Media/browse/useListBrowse.test.jsx`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/browse/useListBrowse.js frontend/src/modules/Media/browse/useListBrowse.test.jsx
git commit -m "feat(media): add useListBrowse for paginated /api/v1/list/*"
```

---

## Task 5: `useContentInfo` hook

**Files:**
- Create: `frontend/src/modules/Media/browse/useContentInfo.js`
- Test: `frontend/src/modules/Media/browse/useContentInfo.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Media/browse/useContentInfo.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: (...args) => apiMock(...args),
}));

import { useContentInfo } from './useContentInfo.js';

beforeEach(() => { apiMock.mockReset(); });

describe('useContentInfo', () => {
  it('fetches /api/v1/info/:source/:localId and exposes info', async () => {
    apiMock.mockResolvedValueOnce({ title: 'The Lonesome Kicker', duration: 355 });
    const { result } = renderHook(() => useContentInfo('plex:587484'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(apiMock).toHaveBeenCalledWith('api/v1/info/plex/587484');
    expect(result.current.info?.title).toBe('The Lonesome Kicker');
    expect(result.current.error).toBeNull();
  });

  it('preserves slashes in localId', async () => {
    apiMock.mockResolvedValueOnce({});
    renderHook(() => useContentInfo('hymn-library:198/second'));
    await waitFor(() => expect(apiMock).toHaveBeenCalled());
    expect(apiMock).toHaveBeenCalledWith('api/v1/info/hymn-library/198/second');
  });

  it('no-op for null/invalid contentId', async () => {
    const { result } = renderHook(() => useContentInfo(null));
    expect(apiMock).not.toHaveBeenCalled();
    expect(result.current.info).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('captures error', async () => {
    apiMock.mockRejectedValueOnce(new Error('not found'));
    const { result } = renderHook(() => useContentInfo('plex:bad'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.message).toBe('not found');
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd frontend && npx vitest run src/modules/Media/browse/useContentInfo.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// frontend/src/modules/Media/browse/useContentInfo.js
import { useState, useEffect } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';

export function useContentInfo(contentId) {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(typeof contentId === 'string' && contentId.includes(':'));
  const [error, setError] = useState(null);

  useEffect(() => {
    if (typeof contentId !== 'string' || !contentId.includes(':')) {
      setInfo(null);
      setLoading(false);
      setError(null);
      return;
    }
    const idx = contentId.indexOf(':');
    const source = contentId.slice(0, idx);
    const localId = contentId.slice(idx + 1);
    const url = `api/v1/info/${source}/${localId}`;
    setLoading(true);
    setError(null);
    let cancelled = false;
    DaylightAPI(url)
      .then((res) => {
        if (cancelled) return;
        setInfo(res ?? null);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [contentId]);

  return { info, loading, error };
}

export default useContentInfo;
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/modules/Media/browse/useContentInfo.test.jsx`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/browse/useContentInfo.js frontend/src/modules/Media/browse/useContentInfo.test.jsx
git commit -m "feat(media): add useContentInfo for /api/v1/info/:source/*"
```

---

## Task 6: `NavProvider` (client-side canvas navigation)

**Files:**
- Create: `frontend/src/modules/Media/shell/NavProvider.jsx`
- Test: `frontend/src/modules/Media/shell/NavProvider.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Media/shell/NavProvider.test.jsx
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { NavProvider, useNav } from './NavProvider.jsx';

function Probe() {
  const { view, params, push, pop } = useNav();
  return (
    <div>
      <span data-testid="view">{view}</span>
      <span data-testid="params">{JSON.stringify(params)}</span>
      <button data-testid="to-detail" onClick={() => push('detail', { contentId: 'plex:1' })}>detail</button>
      <button data-testid="back" onClick={pop}>back</button>
    </div>
  );
}

describe('NavProvider', () => {
  it('defaults to view="home" with empty params', () => {
    render(<NavProvider><Probe /></NavProvider>);
    expect(screen.getByTestId('view')).toHaveTextContent('home');
    expect(screen.getByTestId('params')).toHaveTextContent('{}');
  });

  it('push changes view + params', () => {
    render(<NavProvider><Probe /></NavProvider>);
    act(() => { screen.getByTestId('to-detail').click(); });
    expect(screen.getByTestId('view')).toHaveTextContent('detail');
    expect(screen.getByTestId('params')).toHaveTextContent('{"contentId":"plex:1"}');
  });

  it('pop returns to the previous view', () => {
    render(<NavProvider><Probe /></NavProvider>);
    act(() => { screen.getByTestId('to-detail').click(); });
    act(() => { screen.getByTestId('back').click(); });
    expect(screen.getByTestId('view')).toHaveTextContent('home');
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd frontend && npx vitest run src/modules/Media/shell/NavProvider.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```jsx
// frontend/src/modules/Media/shell/NavProvider.jsx
import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

const NavContext = createContext(null);

const INITIAL_ENTRY = { view: 'home', params: {} };

export function NavProvider({ children }) {
  const [stack, setStack] = useState([INITIAL_ENTRY]);

  const push = useCallback((view, params = {}) => {
    setStack((prev) => [...prev, { view, params }]);
  }, []);

  const pop = useCallback(() => {
    setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  const replace = useCallback((view, params = {}) => {
    setStack((prev) => [...prev.slice(0, -1), { view, params }]);
  }, []);

  const current = stack[stack.length - 1];
  const value = useMemo(
    () => ({ view: current.view, params: current.params, depth: stack.length, push, pop, replace }),
    [current, stack.length, push, pop, replace]
  );

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNav() {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error('useNav must be used inside NavProvider');
  return ctx;
}

export default NavProvider;
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/modules/Media/shell/NavProvider.test.jsx`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/shell/NavProvider.jsx frontend/src/modules/Media/shell/NavProvider.test.jsx
git commit -m "feat(media): NavProvider for client-side canvas navigation stack"
```

---

## Task 7: Portal — `usePlayerHost` + provider changes

**Files:**
- Create: `frontend/src/modules/Media/session/usePlayerHost.js`
- Modify: `frontend/src/modules/Media/session/LocalSessionProvider.jsx`
- Modify: `frontend/src/modules/Media/session/HiddenPlayerMount.jsx`
- Modify: `frontend/src/modules/Media/session/HiddenPlayerMount.test.jsx`

> Plan: `LocalSessionProvider` owns a `playerHostEl` state (ref to a DOM node) exposed via a new context. `HiddenPlayerMount` reads it and, when non-null, `createPortal`s the `<Player>` into it; when null, renders inline in its default hidden container.

- [ ] **Step 1: Extend HiddenPlayerMount test to assert portal behavior**

Append to `HiddenPlayerMount.test.jsx`:

```jsx
import { PlayerHostContext } from './LocalSessionProvider.jsx';

describe('HiddenPlayerMount — portal host', () => {
  it('renders into the provided host element when context supplies one', () => {
    playerPropsLog.length = 0;
    const adapter = mockAdapter({
      currentItem: { contentId: 'plex:1', format: 'video' },
      state: 'loading',
    });
    const host = document.createElement('div');
    host.setAttribute('data-testid', 'custom-host');
    document.body.appendChild(host);

    render(
      <LocalSessionContext.Provider value={{ adapter }}>
        <PlayerHostContext.Provider value={host}>
          <HiddenPlayerMount />
        </PlayerHostContext.Provider>
      </LocalSessionContext.Provider>
    );
    // Player stub should render inside the host div
    expect(host.querySelector('[data-testid="player-stub"]')).not.toBeNull();
    document.body.removeChild(host);
  });

  it('renders inline when host is null', () => {
    playerPropsLog.length = 0;
    const adapter = mockAdapter({
      currentItem: { contentId: 'plex:1', format: 'video' },
      state: 'loading',
    });
    const { container } = render(
      <LocalSessionContext.Provider value={{ adapter }}>
        <PlayerHostContext.Provider value={null}>
          <HiddenPlayerMount />
        </PlayerHostContext.Provider>
      </LocalSessionContext.Provider>
    );
    expect(container.querySelector('[data-testid="player-stub"]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd frontend && npx vitest run src/modules/Media/session/HiddenPlayerMount.test.jsx`
Expected: FAIL — `PlayerHostContext` not exported.

- [ ] **Step 3: Modify `LocalSessionProvider.jsx` to export `PlayerHostContext` and expose a setter**

Add these near the top of `LocalSessionProvider.jsx` (after existing imports):

```jsx
import { createContext, useState } from 'react';

export const PlayerHostContext = createContext(null);
const PlayerHostSetterContext = createContext(() => {});

export function usePlayerHostSetter() {
  return useContext(PlayerHostSetterContext);
}
```

(Ensure `useContext` is imported.)

Replace the body of the `LocalSessionProvider` function's returned JSX wrapping the children:

```jsx
  const [playerHostEl, setPlayerHostEl] = useState(null);

  return (
    <LocalSessionContext.Provider value={value}>
      <PlayerHostContext.Provider value={playerHostEl}>
        <PlayerHostSetterContext.Provider value={setPlayerHostEl}>
          <UrlAndBroadcastMount />
          {children}
          <HiddenPlayerMount />
        </PlayerHostSetterContext.Provider>
      </PlayerHostContext.Provider>
    </LocalSessionContext.Provider>
  );
```

- [ ] **Step 4: Rewrite `HiddenPlayerMount.jsx` to portal when host is set**

Replace the return block of `HiddenPlayerMount.jsx` with:

```jsx
import { createPortal } from 'react-dom';
import { PlayerHostContext } from './LocalSessionProvider.jsx';

// ... inside HiddenPlayerMount function, replace the final return:
  const hostEl = useContext(PlayerHostContext);

  if (!playProp) return null;

  const tree = (
    <div className="media-player-host">
      <Player play={playProp} clear={onClear} onProgress={onProgress} />
    </div>
  );

  if (hostEl) return createPortal(tree, hostEl);
  return tree;
}
```

(Add `useContext` to the import list on line 1 if not already present.)

- [ ] **Step 5: Add `usePlayerHost` helper**

```js
// frontend/src/modules/Media/session/usePlayerHost.js
import { useEffect } from 'react';
import { usePlayerHostSetter } from './LocalSessionProvider.jsx';

/**
 * Claim the Player host for the lifetime of the mounted view.
 * When the view unmounts, the host reverts to null so HiddenPlayerMount
 * renders inline (the default hidden container).
 */
export function usePlayerHost(ref) {
  const setHost = usePlayerHostSetter();
  useEffect(() => {
    setHost(ref.current ?? null);
    return () => setHost(null);
  }, [ref, setHost]);
}

export default usePlayerHost;
```

- [ ] **Step 6: Run all related tests**

Run:
```
cd frontend && npx vitest run \
  src/modules/Media/session/HiddenPlayerMount.test.jsx \
  src/modules/Media/session/LocalSessionProvider.test.jsx
```
Expected: all pass (adapter/persistence/URL/broadcast tests from P1 keep working; 2 new portal tests pass).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Media/session/LocalSessionProvider.jsx \
         frontend/src/modules/Media/session/HiddenPlayerMount.jsx \
         frontend/src/modules/Media/session/HiddenPlayerMount.test.jsx \
         frontend/src/modules/Media/session/usePlayerHost.js
git commit -m "feat(media): portal Player into a host element from LocalSessionProvider

HiddenPlayerMount now portals the Player tree into whatever DOM node
the view has claimed via usePlayerHost(ref). Falls back to an inline
hidden container when no host is set, so Player audio keeps playing
across canvas-view navigation without remounting."
```

---

## Task 8: `SearchBar`

**Files:**
- Create: `frontend/src/modules/Media/search/SearchBar.jsx`
- Test: `frontend/src/modules/Media/search/SearchBar.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Media/search/SearchBar.test.jsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const setQueryFn = vi.fn();
let mockSearch = { results: [], pending: [], isSearching: false, setQuery: setQueryFn };
vi.mock('./useLiveSearch.js', () => ({
  useLiveSearch: vi.fn(() => mockSearch),
}));

const scopeCtx = {
  scopes: [{ label: 'All', key: 'all', params: 'take=50' }, { label: 'Video', key: 'video', params: 'source=plex' }],
  currentScopeKey: 'all',
  currentScope: { label: 'All', key: 'all', params: 'take=50' },
  setScopeKey: vi.fn(),
};
vi.mock('./SearchProvider.jsx', () => ({
  useSearchContext: vi.fn(() => scopeCtx),
}));

import { SearchBar } from './SearchBar.jsx';

beforeEach(() => {
  setQueryFn.mockClear();
  scopeCtx.setScopeKey.mockClear();
  mockSearch = { results: [], pending: [], isSearching: false, setQuery: setQueryFn };
});

describe('SearchBar', () => {
  it('renders the input with placeholder', () => {
    render(<SearchBar />);
    expect(screen.getByTestId('media-search-input')).toBeInTheDocument();
  });

  it('typing calls useLiveSearch.setQuery', () => {
    render(<SearchBar />);
    fireEvent.change(screen.getByTestId('media-search-input'), { target: { value: 'lonesome' } });
    expect(setQueryFn).toHaveBeenCalledWith('lonesome');
  });

  it('switching scope calls setScopeKey', () => {
    render(<SearchBar />);
    fireEvent.change(screen.getByTestId('media-search-scope'), { target: { value: 'video' } });
    expect(scopeCtx.setScopeKey).toHaveBeenCalledWith('video');
  });

  it('shows results dropdown when results are present', () => {
    mockSearch = {
      results: [{ id: 'plex:1', title: 'Lonesome Ghosts' }],
      pending: [], isSearching: false, setQuery: setQueryFn,
    };
    render(<SearchBar />);
    expect(screen.getByText('Lonesome Ghosts')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd frontend && npx vitest run src/modules/Media/search/SearchBar.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```jsx
// frontend/src/modules/Media/search/SearchBar.jsx
import React, { useState } from 'react';
import { useLiveSearch } from './useLiveSearch.js';
import { useSearchContext } from './SearchProvider.jsx';
import { SearchResults } from './SearchResults.jsx';

export function SearchBar() {
  const { scopes, currentScopeKey, currentScope, setScopeKey } = useSearchContext();
  const { results, pending, isSearching, setQuery } = useLiveSearch({
    scopeParams: currentScope?.params ?? '',
  });
  const [value, setValue] = useState('');

  const onChange = (e) => {
    const next = e.target.value;
    setValue(next);
    setQuery(next);
  };

  return (
    <div data-testid="media-search-bar" className="media-search-bar">
      <select
        data-testid="media-search-scope"
        value={currentScopeKey ?? ''}
        onChange={(e) => setScopeKey(e.target.value)}
      >
        {scopes.map((s) => (
          <option key={s.key} value={s.key}>{s.label}</option>
        ))}
      </select>
      <input
        data-testid="media-search-input"
        value={value}
        onChange={onChange}
        placeholder="Search"
      />
      {value.length >= 2 && (
        <SearchResults results={results} pending={pending} isSearching={isSearching} />
      )}
    </div>
  );
}

export default SearchBar;
```

Note: this file imports `SearchResults` which is built in the next task. Create an empty stub for now so the test passes:

```jsx
// frontend/src/modules/Media/search/SearchResults.jsx (stub — replaced in Task 9)
import React from 'react';
export function SearchResults({ results = [] }) {
  return (
    <ul data-testid="media-search-results">
      {results.map((r) => <li key={r.id ?? r.itemId}>{r.title}</li>)}
    </ul>
  );
}
export default SearchResults;
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/modules/Media/search/SearchBar.test.jsx`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/search/SearchBar.jsx \
         frontend/src/modules/Media/search/SearchBar.test.jsx \
         frontend/src/modules/Media/search/SearchResults.jsx
git commit -m "feat(media): SearchBar dock component with scope selector and inline dropdown"
```

---

## Task 9: `SearchResults` with inline actions

**Files:**
- Modify: `frontend/src/modules/Media/search/SearchResults.jsx`
- Test: `frontend/src/modules/Media/search/SearchResults.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Media/search/SearchResults.test.jsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const controller = {
  queue: {
    playNow: vi.fn(),
    add: vi.fn(),
    playNext: vi.fn(),
    addUpNext: vi.fn(),
  },
};
vi.mock('../session/useSessionController.js', () => ({
  useSessionController: vi.fn(() => controller),
}));

const navCtx = { push: vi.fn() };
vi.mock('../shell/NavProvider.jsx', () => ({
  useNav: vi.fn(() => navCtx),
}));

import { SearchResults } from './SearchResults.jsx';

beforeEach(() => {
  controller.queue.playNow.mockClear();
  controller.queue.add.mockClear();
  controller.queue.playNext.mockClear();
  controller.queue.addUpNext.mockClear();
  navCtx.push.mockClear();
});

describe('SearchResults', () => {
  const row = { id: 'plex:660761', title: 'Lonesome Ghosts', thumbnail: '/t.jpg', mediaType: 'video' };

  it('renders nothing while still searching with no results yet', () => {
    const { container } = render(<SearchResults results={[]} pending={['plex']} isSearching={true} />);
    expect(container.textContent).toMatch(/searching/i);
  });

  it('renders results', () => {
    render(<SearchResults results={[row]} pending={[]} isSearching={false} />);
    expect(screen.getByText('Lonesome Ghosts')).toBeInTheDocument();
  });

  it('Play Now calls controller.queue.playNow with mapped input', () => {
    render(<SearchResults results={[row]} pending={[]} isSearching={false} />);
    fireEvent.click(screen.getByTestId('result-play-now-plex:660761'));
    expect(controller.queue.playNow).toHaveBeenCalledWith(
      expect.objectContaining({ contentId: 'plex:660761', title: 'Lonesome Ghosts', format: 'video' }),
      { clearRest: true }
    );
  });

  it('Add to Queue calls controller.queue.add', () => {
    render(<SearchResults results={[row]} pending={[]} isSearching={false} />);
    fireEvent.click(screen.getByTestId('result-add-plex:660761'));
    expect(controller.queue.add).toHaveBeenCalled();
  });

  it('clicking title navigates to detail', () => {
    render(<SearchResults results={[row]} pending={[]} isSearching={false} />);
    fireEvent.click(screen.getByTestId('result-open-plex:660761'));
    expect(navCtx.push).toHaveBeenCalledWith('detail', { contentId: 'plex:660761' });
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd frontend && npx vitest run src/modules/Media/search/SearchResults.test.jsx`
Expected: FAIL — the stub from Task 8 doesn't implement actions yet.

- [ ] **Step 3: Replace the stub with the real implementation**

```jsx
// frontend/src/modules/Media/search/SearchResults.jsx
import React from 'react';
import { useSessionController } from '../session/useSessionController.js';
import { useNav } from '../shell/NavProvider.jsx';
import { resultToQueueInput } from './resultToQueueInput.js';

export function SearchResults({ results = [], pending = [], isSearching = false }) {
  const { queue } = useSessionController('local');
  const { push } = useNav();

  if (isSearching && results.length === 0) {
    return <div data-testid="media-search-results" className="media-search-results">Searching…</div>;
  }
  if (!results.length) return null;

  const handle = (row, action) => (e) => {
    e.stopPropagation();
    const input = resultToQueueInput(row);
    if (!input) return;
    if (action === 'playNow') queue.playNow(input, { clearRest: true });
    else if (action === 'add') queue.add(input);
    else if (action === 'playNext') queue.playNext(input);
    else if (action === 'addUpNext') queue.addUpNext(input);
  };

  return (
    <ul data-testid="media-search-results" className="media-search-results">
      {results.map((row) => {
        const id = row.id ?? row.itemId;
        if (!id) return null;
        return (
          <li key={id} data-testid={`result-row-${id}`}>
            <button
              data-testid={`result-open-${id}`}
              onClick={() => push('detail', { contentId: id })}
              className="media-result-title"
            >
              {row.title ?? id}
            </button>
            <span className="media-result-actions">
              <button data-testid={`result-play-now-${id}`} onClick={handle(row, 'playNow')}>Play Now</button>
              <button data-testid={`result-play-next-${id}`} onClick={handle(row, 'playNext')}>Play Next</button>
              <button data-testid={`result-upnext-${id}`} onClick={handle(row, 'addUpNext')}>Up Next</button>
              <button data-testid={`result-add-${id}`} onClick={handle(row, 'add')}>Add</button>
            </span>
          </li>
        );
      })}
      {pending.length > 0 && <li data-testid="media-search-pending">Loading {pending.join(', ')}…</li>}
    </ul>
  );
}

export default SearchResults;
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/modules/Media/search/`
Expected: all pass (SearchBar + SearchResults + useLiveSearch + SearchProvider + resultToQueueInput).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/search/SearchResults.jsx frontend/src/modules/Media/search/SearchResults.test.jsx
git commit -m "feat(media): SearchResults with inline Plex MP actions + open-detail"
```

---

## Task 10: `BrowseView`

**Files:**
- Create: `frontend/src/modules/Media/browse/BrowseView.jsx`
- Test: `frontend/src/modules/Media/browse/BrowseView.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Media/browse/BrowseView.test.jsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

let browseState = { items: [], total: 0, loading: false, error: null, loadMore: vi.fn() };
vi.mock('./useListBrowse.js', () => ({
  useListBrowse: vi.fn(() => browseState),
}));

const controller = { queue: { playNow: vi.fn(), add: vi.fn() } };
vi.mock('../session/useSessionController.js', () => ({
  useSessionController: vi.fn(() => controller),
}));

const navCtx = { push: vi.fn() };
vi.mock('../shell/NavProvider.jsx', () => ({
  useNav: vi.fn(() => navCtx),
}));

import { BrowseView } from './BrowseView.jsx';

beforeEach(() => {
  controller.queue.playNow.mockClear();
  controller.queue.add.mockClear();
  navCtx.push.mockClear();
  browseState = { items: [], total: 0, loading: false, error: null, loadMore: vi.fn() };
});

describe('BrowseView', () => {
  it('shows loading state', () => {
    browseState = { items: [], total: 0, loading: true, error: null, loadMore: vi.fn() };
    render(<BrowseView path="music/recent" />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders a leaf item with actions', () => {
    browseState = {
      items: [{ id: 'plex:1', title: 'Song A', itemType: 'leaf' }],
      total: 1, loading: false, error: null, loadMore: vi.fn(),
    };
    render(<BrowseView path="music/recent" />);
    expect(screen.getByText('Song A')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('result-play-now-plex:1'));
    expect(controller.queue.playNow).toHaveBeenCalled();
  });

  it('clicking a container navigates to a deeper browse view', () => {
    browseState = {
      items: [{ id: 'plex:folder', title: 'Folder', itemType: 'container' }],
      total: 1, loading: false, error: null, loadMore: vi.fn(),
    };
    render(<BrowseView path="music" />);
    fireEvent.click(screen.getByTestId('browse-open-plex:folder'));
    expect(navCtx.push).toHaveBeenCalledWith('browse', expect.objectContaining({ path: expect.stringContaining('plex:folder') }));
  });

  it('renders an error message', () => {
    browseState = { items: [], total: 0, loading: false, error: new Error('boom'), loadMore: vi.fn() };
    render(<BrowseView path="x" />);
    expect(screen.getByText(/boom/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd frontend && npx vitest run src/modules/Media/browse/BrowseView.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```jsx
// frontend/src/modules/Media/browse/BrowseView.jsx
import React from 'react';
import { useListBrowse } from './useListBrowse.js';
import { useSessionController } from '../session/useSessionController.js';
import { useNav } from '../shell/NavProvider.jsx';
import { resultToQueueInput } from '../search/resultToQueueInput.js';

export function BrowseView({ path, modifiers, take = 50 }) {
  const { items, total, loading, error, loadMore } = useListBrowse(path, { modifiers, take });
  const { queue } = useSessionController('local');
  const { push } = useNav();

  if (loading) return <div data-testid="browse-view-loading">Loading…</div>;
  if (error) return <div data-testid="browse-view-error">{error.message}</div>;

  return (
    <div data-testid="browse-view" className="browse-view">
      <h2>{path}</h2>
      <ul>
        {items.map((row) => {
          const id = row.id ?? row.itemId;
          if (!id) return null;
          const isContainer = row.itemType === 'container';
          return (
            <li key={id} data-testid={`browse-row-${id}`}>
              {isContainer ? (
                <button
                  data-testid={`browse-open-${id}`}
                  onClick={() => push('browse', { path: `${path}/${id}` })}
                >
                  {row.title ?? id} →
                </button>
              ) : (
                <>
                  <button
                    data-testid={`browse-detail-${id}`}
                    onClick={() => push('detail', { contentId: id })}
                  >
                    {row.title ?? id}
                  </button>
                  <button
                    data-testid={`result-play-now-${id}`}
                    onClick={() => { const input = resultToQueueInput(row); if (input) queue.playNow(input, { clearRest: true }); }}
                  >
                    Play Now
                  </button>
                  <button
                    data-testid={`result-add-${id}`}
                    onClick={() => { const input = resultToQueueInput(row); if (input) queue.add(input); }}
                  >
                    Add
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {items.length < total && (
        <button data-testid="browse-load-more" onClick={loadMore}>Load more ({total - items.length} remaining)</button>
      )}
    </div>
  );
}

export default BrowseView;
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/modules/Media/browse/BrowseView.test.jsx`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/browse/BrowseView.jsx frontend/src/modules/Media/browse/BrowseView.test.jsx
git commit -m "feat(media): BrowseView lists hierarchy nodes with navigation + actions"
```

---

## Task 11: `DetailView`

**Files:**
- Create: `frontend/src/modules/Media/browse/DetailView.jsx`
- Test: `frontend/src/modules/Media/browse/DetailView.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Media/browse/DetailView.test.jsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

let infoState = { info: null, loading: true, error: null };
vi.mock('./useContentInfo.js', () => ({
  useContentInfo: vi.fn(() => infoState),
}));

const controller = { queue: { playNow: vi.fn(), add: vi.fn(), playNext: vi.fn(), addUpNext: vi.fn() } };
vi.mock('../session/useSessionController.js', () => ({
  useSessionController: vi.fn(() => controller),
}));

import { DetailView } from './DetailView.jsx';

beforeEach(() => {
  Object.values(controller.queue).forEach((f) => f.mockClear());
  infoState = { info: null, loading: true, error: null };
});

describe('DetailView', () => {
  it('renders loading state', () => {
    render(<DetailView contentId="plex:1" />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders title + thumbnail when info loaded', () => {
    infoState = { info: { title: 'Lonesome Ghosts', thumbnail: '/t.jpg' }, loading: false, error: null };
    render(<DetailView contentId="plex:1" />);
    expect(screen.getByText('Lonesome Ghosts')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('src', '/t.jpg');
  });

  it('Play Now dispatches queue.playNow with contentId', () => {
    infoState = { info: { title: 'X', mediaType: 'video' }, loading: false, error: null };
    render(<DetailView contentId="plex:5" />);
    fireEvent.click(screen.getByTestId('detail-play-now'));
    expect(controller.queue.playNow).toHaveBeenCalledWith(
      expect.objectContaining({ contentId: 'plex:5' }),
      { clearRest: true }
    );
  });

  it('renders error', () => {
    infoState = { info: null, loading: false, error: new Error('nope') };
    render(<DetailView contentId="plex:1" />);
    expect(screen.getByText(/nope/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd frontend && npx vitest run src/modules/Media/browse/DetailView.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```jsx
// frontend/src/modules/Media/browse/DetailView.jsx
import React from 'react';
import { useContentInfo } from './useContentInfo.js';
import { useSessionController } from '../session/useSessionController.js';
import { resultToQueueInput } from '../search/resultToQueueInput.js';

export function DetailView({ contentId }) {
  const { info, loading, error } = useContentInfo(contentId);
  const { queue } = useSessionController('local');

  if (loading) return <div data-testid="detail-loading">Loading…</div>;
  if (error) return <div data-testid="detail-error">{error.message}</div>;
  if (!info) return null;

  const input = resultToQueueInput({ id: contentId, ...info }) ?? { contentId };

  return (
    <div data-testid="detail-view" className="detail-view">
      {info.thumbnail && <img src={info.thumbnail} alt={info.title ?? contentId} />}
      <h1>{info.title ?? contentId}</h1>
      {info.description && <p>{info.description}</p>}
      <div className="detail-actions">
        <button data-testid="detail-play-now" onClick={() => queue.playNow(input, { clearRest: true })}>
          Play Now
        </button>
        <button data-testid="detail-play-next" onClick={() => queue.playNext(input)}>Play Next</button>
        <button data-testid="detail-up-next" onClick={() => queue.addUpNext(input)}>Up Next</button>
        <button data-testid="detail-add" onClick={() => queue.add(input)}>Add to Queue</button>
      </div>
    </div>
  );
}

export default DetailView;
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/modules/Media/browse/DetailView.test.jsx`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/browse/DetailView.jsx frontend/src/modules/Media/browse/DetailView.test.jsx
git commit -m "feat(media): DetailView shows content info + Plex MP actions"
```

---

## Task 12: `HomeView`

**Files:**
- Create: `frontend/src/modules/Media/browse/HomeView.jsx`
- Test: `frontend/src/modules/Media/browse/HomeView.test.jsx`

> HomeView v1: reads `browse` entries from `/api/v1/media/config` (each has a `source`, `label`, `searchFilter`, etc.) and offers a simple curated landing with links to canvas views. No `BrowseView` instances mounted inline — each card just navigates.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Media/browse/HomeView.test.jsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: (...args) => apiMock(...args),
}));

const navCtx = { push: vi.fn() };
vi.mock('../shell/NavProvider.jsx', () => ({
  useNav: vi.fn(() => navCtx),
}));

import { HomeView } from './HomeView.jsx';

beforeEach(() => {
  apiMock.mockReset();
  navCtx.push.mockClear();
});

describe('HomeView', () => {
  it('renders cards for each browse entry from /api/v1/media/config', async () => {
    apiMock.mockResolvedValueOnce({
      browse: [
        { source: 'plex', mediaType: 'audio', label: 'Browse Music' },
        { source: 'plex', mediaType: 'video', label: 'Browse Video' },
      ],
    });
    render(<HomeView />);
    await waitFor(() => expect(screen.getByText('Browse Music')).toBeInTheDocument());
    expect(screen.getByText('Browse Video')).toBeInTheDocument();
  });

  it('clicking a card navigates to browse with a path derived from source/mediaType', async () => {
    apiMock.mockResolvedValueOnce({
      browse: [{ source: 'plex', mediaType: 'audio', label: 'Browse Music' }],
    });
    render(<HomeView />);
    await waitFor(() => screen.getByText('Browse Music'));
    fireEvent.click(screen.getByTestId('home-card-plex-audio'));
    expect(navCtx.push).toHaveBeenCalledWith('browse', expect.objectContaining({ path: expect.any(String) }));
  });

  it('renders a placeholder on API failure', async () => {
    apiMock.mockRejectedValueOnce(new Error('fail'));
    render(<HomeView />);
    await waitFor(() => expect(screen.getByTestId('home-error')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd frontend && npx vitest run src/modules/Media/browse/HomeView.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```jsx
// frontend/src/modules/Media/browse/HomeView.jsx
import React, { useState, useEffect } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { useNav } from '../shell/NavProvider.jsx';

function cardPath(entry) {
  const segs = [entry.source];
  if (entry.mediaType) segs.push(entry.mediaType);
  return segs.filter(Boolean).join('/');
}

function cardKey(entry) {
  return `${entry.source}-${entry.mediaType ?? 'all'}`;
}

export function HomeView() {
  const [browse, setBrowse] = useState(null);
  const [error, setError] = useState(null);
  const { push } = useNav();

  useEffect(() => {
    let cancelled = false;
    DaylightAPI('api/v1/media/config')
      .then((cfg) => {
        if (cancelled) return;
        setBrowse(Array.isArray(cfg?.browse) ? cfg.browse : []);
      })
      .catch((err) => { if (!cancelled) setError(err); });
    return () => { cancelled = true; };
  }, []);

  if (error) return <div data-testid="home-error">{error.message}</div>;
  if (!browse) return <div data-testid="home-loading">Loading…</div>;

  return (
    <div data-testid="home-view" className="home-view">
      <h1>Media</h1>
      <div className="home-cards">
        {browse.map((entry) => (
          <button
            key={cardKey(entry)}
            data-testid={`home-card-${cardKey(entry)}`}
            onClick={() => push('browse', { path: cardPath(entry) })}
            className="home-card"
          >
            {entry.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default HomeView;
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/modules/Media/browse/HomeView.test.jsx`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/browse/HomeView.jsx frontend/src/modules/Media/browse/HomeView.test.jsx
git commit -m "feat(media): HomeView shows curated browse cards from media config"
```

---

## Task 13: Refactor `Canvas` to view registry + update `NowPlayingView` for portal

**Files:**
- Modify: `frontend/src/modules/Media/shell/Canvas.jsx`
- Modify: `frontend/src/modules/Media/shell/NowPlayingView.jsx`
- Modify: `frontend/src/modules/Media/shell/MediaAppShell.jsx`

- [ ] **Step 1: Update `MediaAppShell` to wrap children in `<NavProvider>`**

```jsx
// frontend/src/modules/Media/shell/MediaAppShell.jsx
import React from 'react';
import { Dock } from './Dock.jsx';
import { Canvas } from './Canvas.jsx';
import { NavProvider } from './NavProvider.jsx';

export function MediaAppShell() {
  return (
    <NavProvider>
      <div className="media-app-shell">
        <Dock />
        <Canvas />
      </div>
    </NavProvider>
  );
}

export default MediaAppShell;
```

- [ ] **Step 2: Rewrite `Canvas` as a view registry**

```jsx
// frontend/src/modules/Media/shell/Canvas.jsx
import React from 'react';
import { useNav } from './NavProvider.jsx';
import { NowPlayingView } from './NowPlayingView.jsx';
import { HomeView } from '../browse/HomeView.jsx';
import { BrowseView } from '../browse/BrowseView.jsx';
import { DetailView } from '../browse/DetailView.jsx';

function renderView(view, params) {
  switch (view) {
    case 'home': return <HomeView />;
    case 'browse': return <BrowseView path={params.path ?? ''} modifiers={params.modifiers} />;
    case 'detail': return <DetailView contentId={params.contentId} />;
    case 'nowPlaying': return <NowPlayingView />;
    default: return <HomeView />;
  }
}

export function Canvas() {
  const { view, params } = useNav();
  return (
    <div data-testid="media-canvas" className="media-canvas">
      {renderView(view, params)}
    </div>
  );
}

export default Canvas;
```

- [ ] **Step 3: Update `NowPlayingView` to claim the Player host via portal**

```jsx
// frontend/src/modules/Media/shell/NowPlayingView.jsx
import React, { useRef } from 'react';
import { useSessionController } from '../session/useSessionController.js';
import { usePlayerHost } from '../session/usePlayerHost.js';

export function NowPlayingView() {
  const { snapshot } = useSessionController('local');
  const item = snapshot.currentItem;
  const hostRef = useRef(null);
  usePlayerHost(hostRef);

  return (
    <div data-testid="now-playing-view">
      <h2>Now Playing: {item?.contentId ?? 'nothing'}</h2>
      <div>state: {snapshot.state}</div>
      <div>position: {Math.round(snapshot.position ?? 0)}s</div>
      <div data-testid="now-playing-host" ref={hostRef} className="now-playing-host" />
    </div>
  );
}

export default NowPlayingView;
```

- [ ] **Step 4: Run existing tests + shell tests**

Run: `cd frontend && npx vitest run src/modules/Media/shell src/modules/Media/session`

Expected: all previously-passing tests still pass. The existing `MediaAppShell.test.jsx` reset-button test still works because `HomeView` is the default view (pre-existing tests didn't assert a specific default view text — they check test-ids and reset behavior).

Note: if `MediaAppShell.test.jsx`'s second test (preload session → reset) fails because the Canvas now shows `HomeView` instead of NowPlayingView, navigate to NowPlaying first:

Modify that test's setup to include a nav click before the reset assertion. Edit `MediaAppShell.test.jsx`:

Find:
```js
    expect(screen.getByText(/now playing.*plex:42/i)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('session-reset-btn'));
    expect(screen.queryByText(/now playing.*plex:42/i)).not.toBeInTheDocument();
```

Replace with:
```js
    // Home view is default now; navigate to NowPlaying via the MiniPlayer
    fireEvent.click(screen.getByTestId('mini-player-open-nowplaying'));
    expect(screen.getByText(/now playing.*plex:42/i)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('session-reset-btn'));
    expect(screen.queryByText(/now playing.*plex:42/i)).not.toBeInTheDocument();
```

Then update `MiniPlayer.jsx` to add a test-id'd button that navigates to `nowPlaying`:

```jsx
// frontend/src/modules/Media/shell/MiniPlayer.jsx
import React from 'react';
import { useSessionController } from '../session/useSessionController.js';
import { useNav } from './NavProvider.jsx';

export function MiniPlayer() {
  const { snapshot, transport } = useSessionController('local');
  const { push } = useNav();
  const item = snapshot.currentItem;
  if (!item) return <div data-testid="media-mini-player">Idle</div>;
  return (
    <div data-testid="media-mini-player">
      <button
        data-testid="mini-player-open-nowplaying"
        onClick={() => push('nowPlaying', {})}
      >
        {item.title ?? item.contentId}
      </button>
      <button onClick={transport.pause} data-testid="mini-pause">Pause</button>
      <button onClick={transport.play} data-testid="mini-play">Play</button>
    </div>
  );
}

export default MiniPlayer;
```

- [ ] **Step 5: Re-run full Media suite**

Run: `cd frontend && npx vitest run src/modules/Media src/Apps/MediaApp.test.jsx`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Media/shell/
git commit -m "feat(media): Canvas becomes view registry; NowPlayingView claims Player host

- Canvas dispatches on useNav().view to Home | Browse | Detail | NowPlaying
- NowPlayingView declares a ref that Player is portaled into (via
  usePlayerHost), so audio keeps playing when the canvas is on another
  view
- MiniPlayer title click navigates to NowPlayingView
- MediaAppShell wraps the tree in NavProvider"
```

---

## Task 14: Wire `<SearchBar />` into Dock + `<SearchProvider>` into MediaApp

**Files:**
- Modify: `frontend/src/modules/Media/shell/Dock.jsx`
- Modify: `frontend/src/Apps/MediaApp.jsx`
- Modify: `frontend/src/Apps/MediaApp.test.jsx`

- [ ] **Step 1: Update Dock to render SearchBar**

```jsx
// frontend/src/modules/Media/shell/Dock.jsx
import React from 'react';
import { MiniPlayer } from './MiniPlayer.jsx';
import { useSessionController } from '../session/useSessionController.js';
import { SearchBar } from '../search/SearchBar.jsx';

export function Dock() {
  const { lifecycle } = useSessionController('local');
  return (
    <div data-testid="media-dock">
      <SearchBar />
      <MiniPlayer />
      <button data-testid="session-reset-btn" onClick={lifecycle.reset}>Reset session</button>
    </div>
  );
}

export default Dock;
```

- [ ] **Step 2: Update MediaApp entry to add SearchProvider**

```jsx
// frontend/src/Apps/MediaApp.jsx
import React from 'react';
import { ClientIdentityProvider } from '../modules/Media/session/ClientIdentityProvider.jsx';
import { LocalSessionProvider } from '../modules/Media/session/LocalSessionProvider.jsx';
import { SearchProvider } from '../modules/Media/search/SearchProvider.jsx';
import { MediaAppShell } from '../modules/Media/shell/MediaAppShell.jsx';

export default function MediaApp() {
  return (
    <ClientIdentityProvider>
      <LocalSessionProvider>
        <SearchProvider>
          <MediaAppShell />
        </SearchProvider>
      </LocalSessionProvider>
    </ClientIdentityProvider>
  );
}
```

- [ ] **Step 3: Update MediaApp.test.jsx to mock the media-config API**

Add a DaylightAPI mock returning an empty config inside the existing test setup so `SearchProvider` and `HomeView` don't hit a real API.

Edit the top of `frontend/src/Apps/MediaApp.test.jsx` — add after existing mocks:

```jsx
vi.mock('../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(async (path) => {
    if (path === 'api/v1/media/config') return { browse: [], searchScopes: [{ label: 'All', key: 'all', params: 'take=50' }] };
    return {};
  }),
}));
```

- [ ] **Step 4: Run**

Run: `cd frontend && npx vitest run src/Apps/MediaApp.test.jsx src/modules/Media/shell/MediaAppShell.test.jsx`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/Apps/MediaApp.jsx frontend/src/Apps/MediaApp.test.jsx frontend/src/modules/Media/shell/Dock.jsx
git commit -m "feat(media): add SearchBar to Dock + wrap MediaApp in SearchProvider"
```

---

## Task 15: End-to-end Playwright — search → open detail → play

**Files:**
- Create: `tests/live/flow/media/media-app-discovery.runtime.test.mjs`

- [ ] **Step 1: Write the test**

```javascript
// tests/live/flow/media/media-app-discovery.runtime.test.mjs
import { test, expect } from '@playwright/test';

test.describe('MediaApp — P2 discovery', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/media');
    await page.evaluate(() => {
      localStorage.clear();
    });
  });

  test('renders Home view with browse cards', async ({ page }) => {
    await page.goto('/media');
    await expect(page.getByTestId('home-view')).toBeVisible({ timeout: 10000 });
  });

  test('search returns results and Play Now starts playback', async ({ page }) => {
    await page.goto('/media');
    await expect(page.getByTestId('media-search-input')).toBeVisible();

    await page.getByTestId('media-search-input').fill('lonesome');
    // Results panel (at least one row) should appear within SSE completion
    const firstRow = page.locator('[data-testid^="result-row-"]').first();
    await expect(firstRow).toBeVisible({ timeout: 15000 });

    // Grab the id of the first row for a targeted click
    const firstRowId = await firstRow.getAttribute('data-testid');
    const contentId = firstRowId?.replace(/^result-row-/, '');
    expect(contentId).toBeTruthy();

    // Click Play Now on that row
    await page.getByTestId(`result-play-now-${contentId}`).click();

    // Navigate to NowPlaying via MiniPlayer title click
    await page.getByTestId('mini-player-open-nowplaying').click();
    await expect(page.getByRole('heading', { name: new RegExp(`Now Playing: ${contentId}`, 'i') })).toBeVisible({ timeout: 10000 });
  });

  test('clicking a search result title opens the Detail view', async ({ page }) => {
    await page.goto('/media');
    await page.getByTestId('media-search-input').fill('lonesome');
    const firstRow = page.locator('[data-testid^="result-open-"]').first();
    await expect(firstRow).toBeVisible({ timeout: 15000 });
    await firstRow.click();
    await expect(page.getByTestId('detail-view')).toBeVisible({ timeout: 10000 });
  });
});
```

- [ ] **Step 2: Verify syntax**

Run: `node --check tests/live/flow/media/media-app-discovery.runtime.test.mjs`
Expected: no output (valid syntax).

- [ ] **Step 3: Verify dev server is up and run**

Confirm backend on port 3113 (or whichever the worktree uses) + Vite on 3112. If not, start: `nohup node backend/index.js > dev.log 2>&1 &` and `cd frontend && npm run dev` in the worktree's dir.

Run from repo root:
```
BASE_URL=http://localhost:3112 npx playwright test tests/live/flow/media/media-app-discovery.runtime.test.mjs --reporter=line --workers=1
```
Expected: 3 passed.

If the search test fails with a strict-mode selector conflict, use `.first()` or a more precise selector.

- [ ] **Step 4: Commit**

```bash
git add tests/live/flow/media/media-app-discovery.runtime.test.mjs
git commit -m "test(media): e2e discovery — search, open detail, play from result"
```

---

## Task 16: Final validation

- [ ] **Step 1: Run full Media vitest suite**

Run: `cd frontend && npx vitest run src/modules/Media src/Apps/MediaApp.test.jsx`
Expected: all pass. Target: ~100+ tests across both P1 and P2 files.

- [ ] **Step 2: Grep for raw console.* in new code**

Run: `grep -RE "console\.(log|debug|warn|error)" frontend/src/modules/Media/search frontend/src/modules/Media/browse frontend/src/modules/Media/shell/NavProvider.jsx frontend/src/modules/Media/session/usePlayerHost.js`
Expected: no matches.

- [ ] **Step 3: Re-run Playwright P1 autoplay + P2 discovery**

Run:
```
BASE_URL=http://localhost:3112 npx playwright test tests/live/flow/media/ --reporter=line --workers=1
```
Expected: all pass (P1's 4 + P2's 3 = 7).

- [ ] **Step 4: Smoke check the user journey in a browser**

Visit `http://localhost:3112/media`:
1. Home view with browse cards visible
2. Type "lonesome" in the search bar — results panel populates within 15s
3. Click Play Now on a result — MiniPlayer shows it
4. Click the MiniPlayer title → navigate to NowPlaying → Player visible and audio/video starts
5. Navigate back to Home (via a back button or reload), verify audio continues through the portal

- [ ] **Step 5: Update the spec's Section 13 (open questions) to mark the HomeView config source resolved**

Edit `docs/superpowers/specs/2026-04-18-media-app-skeleton-design.md` §13 and mark the HomeView open question resolved ("Uses existing `/api/v1/media/config` `browse` entries; no extended endpoint needed").

- [ ] **Step 6: Commit doc update if any**

```bash
git add docs/superpowers/specs/2026-04-18-media-app-skeleton-design.md
git commit -m "docs(media): mark HomeView config-source question resolved in P2"
```

---

## Requirements traceability for P2

| Spec requirement | Covered by task |
|---|---|
| C1.1 live/incremental search | Tasks 1, 8 (SearchBar uses SSE via useLiveSearch) |
| C1.1a inline actionability | Task 9 (SearchResults Plex MP action buttons) |
| C1.1b scope selection from search affordance | Task 8 (scope selector in SearchBar) |
| C1.2 hierarchical browse with list modifiers | Task 4 (useListBrowse), Task 10 (BrowseView) |
| C1.3 home surface with config-driven content | Task 12 (HomeView) |
| C1.4 detail view with actions | Task 11 (DetailView) |
| C2.4 format-agnostic rendering | Unchanged — Player still delegates to Playable Format Registry |
| C3 Plex MP queue ops from UI | Tasks 9, 10, 11 (every content row calls `useSessionController('local').queue.*`) |
| C10.1 structured logging | Task 1 (mediaLog.searchIssued); Tasks 9–11 add event emissions where they fit |
| N1.2 search begins rendering within 200ms | Inherited via `useStreamingSearch`'s 300ms debounce + SSE chunked responses |
| N5.1 new content formats require zero app changes | Preserved (DetailView + SearchResults forward format as-is; Player handles) |

---

## Open questions (if any arise during implementation)

- **Deep-link URL routing** (e.g. `/media/detail/:source/:localId`) — intentionally out of scope for P2. Canvas routing is client-side only. Revisit as a standalone follow-up after P7.
- **Recents / favorites for search scopes** — SearchProvider has the hook shape ready but P2 doesn't populate `media-scope-recents` or `media-scope-favorites`. Add in a follow-up if UX demands.
- **Placeholder thumbnails** — SearchResults/BrowseView/DetailView use whatever the backend returns (often `/api/v1/display/...` or `/api/v1/proxy/...` URLs). Styling is out of scope for this plan.

---

## Self-review notes

- **Spec coverage:** all C1 sub-requirements map to numbered tasks. C3 is satisfied by the fact that every content row in the new views calls into the P1 controller's `queue.*` methods.
- **Types consistency:** `useSessionController('local')` is used everywhere (matches P1 interface). Search/browse action handlers all convert rows to queue input via a single `resultToQueueInput` helper (Task 3) — no divergent shapes.
- **No placeholders:** every task has runnable code, exact paths, expected outputs. No "TBD" or "implement later".
- **Boundary clarity:**
  - `SearchProvider` owns scope state (config-driven)
  - `NavProvider` owns canvas-view state (session-scoped)
  - `LocalSessionProvider` owns the Player host (portal target)
  - No provider owns two concerns.
- **Known simplification:** HomeView in v1 is link-only cards. A richer home (continue-where-you-left-off, recents) lands in a future follow-up. Task 12's traceability note covers this.
