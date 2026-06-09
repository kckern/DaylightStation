# Media UX Overhaul Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the Admin content-selection combobox best-in-class and overhaul the Media App into a usable, honest experience for lookup, playback, casting, and fleet monitoring.

**Architecture:** Surgical frontend fixes driven by the 2026-06-09 audit (`docs/_wip/audits/2026-06-09-media-content-lookup-and-ux-audit.md`). The backend search orchestration stays as-is except for two additive changes (per-adapter timeout + per-source error SSE event). The Media App keeps its provider architecture; we fix seven verified P0 breakages, add the missing queue/transport UI, then harden the Admin combobox's input model.

**Tech Stack:** React 18, Mantine 7 (Admin only — Media App is plain JSX + SCSS), Vitest 4 (run from repo root), Playwright (`tests/live/flow/`), SSE via `useStreamingSearch`.

---

## Conventions for the executor

- **Run Vitest from repo root:** `npx vitest run <path>` (e.g. `npx vitest run frontend/src/modules/Media/search/searchStates.test.js`)
- **Playwright needs the dev server.** `playwright.config.mjs` reuses an existing server on the configured port (3111 on kckern-macbook). Check `lsof -i :3111` first; if missing, `npm run dev` in background.
- **Commits go to a feature branch/worktree, never pushed or merged automatically** (CLAUDE.md: user merges manually). Create the worktree first if not already in one:
  ```bash
  git -C /Users/kckern/Documents/GitHub/DaylightStation worktree add ../DaylightStation-media-ux -b feature/media-ux-overhaul
  ```
- Every file referenced below was read during the audit; line numbers are from that snapshot. If a file drifted, re-read it before editing.
- **Audit cross-refs** (M1–M14, B1–B5, §3.1) refer to `docs/_wip/audits/2026-06-09-media-content-lookup-and-ux-audit.md`.
- Frontend logging must use the structured logger (CLAUDE.md Logging section). The Media module facade is `frontend/src/modules/Media/logging/mediaLog.js`.

---

# Phase 1 — Media App search & discovery (P0)

## Task 1: Debounce `useLiveSearch` (audit M3)

**Files:**
- Modify: `frontend/src/modules/Media/search/useLiveSearch.js`
- Test: `frontend/src/modules/Media/search/useLiveSearch.test.jsx` (exists — extend)

**Step 1: Write the failing tests** (append to existing test file; follow its existing mock pattern for `useStreamingSearch` — it mocks `../../../hooks/useStreamingSearch.js`):

```jsx
describe('debounce', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('coalesces rapid keystrokes into one search dispatch', () => {
    const { result } = renderHook(() => useLiveSearch({ scopeParams: '' }));
    act(() => {
      result.current.setQuery('c');
      result.current.setQuery('ch');
      result.current.setQuery('chr');
      result.current.setQuery('chris');
    });
    expect(mockSearch).not.toHaveBeenCalledWith('chris', '');
    act(() => { vi.advanceTimersByTime(300); });
    // Only the final query dispatched, exactly once
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
    expect(result.current.isSearching).toBe(true); // waiting counts as searching
  });
});
```

**Step 2:** Run: `npx vitest run frontend/src/modules/Media/search/useLiveSearch.test.jsx` — expect the 3 new tests FAIL (search called 4×, isSearching false).

**Step 3: Implement** — replace `useLiveSearch.js` body:

```js
import { useCallback, useEffect, useRef, useState } from 'react';
import { useStreamingSearch } from '../../../hooks/useStreamingSearch.js';
import mediaLog from '../logging/mediaLog.js';

const SEARCH_ENDPOINT = '/api/v1/content/query/search/stream';
const DEBOUNCE_MS = 250;

export function useLiveSearch({ scopeParams = '' } = {}) {
  const inner = useStreamingSearch(SEARCH_ENDPOINT, scopeParams);
  const lastQueryRef = useRef('');
  const timerRef = useRef(null);
  // True between first keystroke and debounce firing, so the UI shows
  // "Searching…" instead of flashing the EMPTY state during the gap.
  const [waiting, setWaiting] = useState(false);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const setQuery = useCallback((query) => {
    lastQueryRef.current = query;
    clearTimeout(timerRef.current);
    if (!query || query.length < 2) {
      // Short/empty queries clear hook state instantly — no debounce.
      setWaiting(false);
      inner.search(query, scopeParams);
      return;
    }
    setWaiting(true);
    timerRef.current = setTimeout(() => {
      setWaiting(false);
      mediaLog.searchIssued({ text: query, scopeParams });
      inner.search(query, scopeParams);
    }, DEBOUNCE_MS);
  }, [inner, scopeParams]);

  const retry = useCallback(() => {
    const q = lastQueryRef.current;
    if (q) setQuery(q);
  }, [setQuery]);

  return {
    results: inner.results,
    pending: inner.pending,
    isSearching: waiting || inner.isSearching,
    error: inner.error,
    setQuery,
    retry,
  };
}

export default useLiveSearch;
```

Note: `mediaLog.searchIssued` now fires once per dispatched search (was once per keystroke — C10.5 fix comes free).

**Step 4:** Run the test file again — all pass. Also run `npx vitest run frontend/src/modules/Media/search/` to catch collateral.

**Step 5: Commit** — `fix(media): debounce live search; one backend dispatch per settled query (M3)`

---

## Task 2: Remove the colon-query hijack from `deriveSearchState` (audit M2)

Any query matching `word:rest` (e.g. `frozen: part 2`) currently forces the IDLE deep-link state and hides real results.

**Files:**
- Modify: `frontend/src/modules/Media/search/searchStates.js`
- Modify: `frontend/src/modules/Media/search/SearchBar.jsx`
- Test: `frontend/src/modules/Media/search/searchStates.test.js` (exists — update), `frontend/src/modules/Media/search/SearchStates.test.jsx` (exists — update)

**Step 1: Update/extend tests.** In `searchStates.test.js`, find the case asserting content-ID queries return IDLE — replace with:

```js
it('shows results even when the query looks like a content ID', () => {
  const state = deriveSearchState({
    query: 'frozen: part 2', isSearching: false,
    results: [{ id: 'plex:1' }], error: null,
  });
  expect(state.kind).toBe(SEARCH_STATE.RESULTS);
});

it('falls through to EMPTY for content-id-like query with no results', () => {
  const state = deriveSearchState({
    query: 'plex-main:12345', isSearching: false, results: [], error: null,
  });
  expect(state.kind).toBe(SEARCH_STATE.EMPTY);
});
```

**Step 2:** Run: `npx vitest run frontend/src/modules/Media/search/searchStates.test.js` — new tests FAIL (both return IDLE).

**Step 3: Implement.** In `searchStates.js`, delete the `CONTENT_ID_RE` constant and the early-return at line 17 (`if (CONTENT_ID_RE.test(q)) return { kind: SEARCH_STATE.IDLE };`). Nothing else changes.

**Step 4: Keep the deep-link affordance — as a pinned row, not a hijack.** In `SearchBar.jsx`:

```jsx
import { parseContentId } from './contentIdParser.js';
// inside SearchBar(), after `const state = deriveSearchState(...)`:
const parsedId = parseContentId(value);
```

and inside the overlay, render the deep-link row *above* the state block whenever the input parses, in non-IDLE states:

```jsx
{isOpen && (
  <div data-testid="search-overlay" className="media-search-overlay">
    {parsedId && state.kind !== SEARCH_STATE.IDLE && (
      <SearchIdleState input={value} onDeepLink={onDeepLink} />
    )}
    {/* existing state.kind blocks unchanged */}
```

(`SearchIdleState` already renders the "Looks like a content ID … Play this ID" affordance when its input parses — reuse it verbatim.)

**Step 5:** Run: `npx vitest run frontend/src/modules/Media/search/` — all pass (update any `SearchStates.test.jsx` snapshot of the old behavior: the expectation is now "deep-link row AND results coexist").

**Step 6: Commit** — `fix(media): colon-bearing titles search normally; deep-link affordance becomes a pinned row (M2)`

---

## Task 3: Search survives queue actions + visible feedback (audit M7, M6-feedback)

**Files:**
- Modify: `frontend/src/modules/Media/search/ResultRow.jsx`
- Modify: `frontend/src/modules/Media/search/SearchBar.jsx` (no change needed — `close` stays wired to `onAction`; ResultRow stops calling it for non-terminal ops)
- Modify: `frontend/src/Apps/MediaApp.scss`
- Test: `frontend/src/modules/Media/search/ResultRow.test.jsx` (exists — extend)

**Step 1: Failing tests** (follow the file's existing mock of `useSessionController`):

```jsx
it('does NOT call onAction for Add — search stays open', () => {
  const onAction = vi.fn();
  render(<ResultRow row={row} onAction={onAction} />);
  fireEvent.click(screen.getByTestId(`result-add-${row.id}`));
  expect(mockQueue.add).toHaveBeenCalled();
  expect(onAction).not.toHaveBeenCalled();
});

it('flashes confirmation text on the clicked button', () => {
  render(<ResultRow row={row} onAction={vi.fn()} />);
  fireEvent.click(screen.getByTestId(`result-add-${row.id}`));
  expect(screen.getByTestId(`result-add-${row.id}`)).toHaveTextContent('✓ Added');
});

it('still calls onAction for Play Now (playback starts, overlay closes)', () => {
  const onAction = vi.fn();
  render(<ResultRow row={row} onAction={onAction} />);
  fireEvent.click(screen.getByTestId(`result-play-now-${row.id}`));
  expect(onAction).toHaveBeenCalled();
});
```

**Step 2:** Run: `npx vitest run frontend/src/modules/Media/search/ResultRow.test.jsx` — FAIL.

**Step 3: Implement.** In `ResultRow.jsx` replace the `fire` helper and buttons:

```jsx
import React, { useState, useRef, useEffect } from 'react';
// ... existing imports unchanged

export function ResultRow({ row, onAction }) {
  const { queue } = useSessionController('local');
  const [peekOpen, setPeekOpen] = useState(false);
  const [flash, setFlash] = useState(null); // op key that just succeeded
  const flashTimer = useRef(null);
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const id = row.id ?? row.itemId;
  if (!id) return null;
  const thumb = thumbnailSrc(row);

  const fire = (op, { closes = false } = {}) => (e) => {
    e.stopPropagation();
    const input = resultToQueueInput(row);
    if (!input) return;
    if (op === 'playNow') queue.playNow(input, { clearRest: true });
    else if (op === 'playNext') queue.playNext(input);
    else if (op === 'addUpNext') queue.addUpNext(input);
    else if (op === 'add') queue.add(input);
    if (closes) { onAction?.(); return; }
    setFlash(op);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 1200);
  };
```

Buttons (Play Now closes; the three queue ops flash in place; Cast unchanged):

```jsx
<span className="media-result-actions">
  <button data-testid={`result-play-now-${id}`} onClick={fire('playNow', { closes: true })}>Play Now</button>
  <button data-testid={`result-play-next-${id}`} onClick={fire('playNext')} className={flash === 'playNext' ? 'action-flash' : ''}>
    {flash === 'playNext' ? '✓ Next' : 'Play Next'}
  </button>
  <button data-testid={`result-upnext-${id}`} onClick={fire('addUpNext')} className={flash === 'addUpNext' ? 'action-flash' : ''}>
    {flash === 'addUpNext' ? '✓ Queued' : 'Up Next'}
  </button>
  <button data-testid={`result-add-${id}`} onClick={fire('add')} className={flash === 'add' ? 'action-flash' : ''}>
    {flash === 'add' ? '✓ Added' : 'Add'}
  </button>
  <CastButton contentId={id} onAction={onAction} />
</span>
```

**Step 4: Context subtitle (audit M8, cheap here).** Under the title button, add:

```jsx
const type = row.type ?? row.metadata?.type ?? row.mediaType;
const subtitle = [
  type, row.source,
  typeof row.duration === 'number' ? `${Math.round(row.duration / 60)} min` : null,
].filter(Boolean).join(' • ');
```

```jsx
<span className="media-result-text">
  <button data-testid={`result-open-${id}`} className="media-result-title" onClick={() => setPeekOpen((v) => !v)}>
    {row.title ?? id}
  </button>
  {subtitle && <span className="media-result-subtitle">{subtitle}</span>}
</span>
```

**Step 5: SCSS.** In `MediaApp.scss` append:

```scss
.media-app .media-result-text {
  grid-column: 2;
  display: flex;
  flex-direction: column;
  min-width: 0;
  .media-result-title { grid-column: unset; }
}
.media-app .media-result-subtitle {
  font-size: 11px;
  color: var(--fg-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.media-app .media-result-actions button.action-flash {
  color: var(--brand-ink);
  background: var(--success);
  border-color: var(--success);
}
```

**Step 6:** Run: `npx vitest run frontend/src/modules/Media/search/` — pass.

**Step 7: Commit** — `feat(media): queue actions keep search open with in-button confirmation; result rows get context line (M7, M8)`

---

## Task 4: Fix browse drill-down paths (audit M4)

Clicking a container currently pushes `path: ${path}/${id}` with a compound id (`plex/video/plex:12345`). Fix: the container's own id becomes the new path root (`plex/12345`), with the title carried in nav params for the crumb.

**Files:**
- Modify: `frontend/src/modules/Media/browse/BrowseView.jsx`
- Test: `frontend/src/modules/Media/browse/BrowseView.test.jsx` (exists — extend)

**Step 1: Failing test** (mirror the file's existing `useNav`/`useListBrowse` mocks):

```jsx
it('drilling into a container uses the container id as the new path root', () => {
  mockItems([{ id: 'plex:12345', title: 'Bluey', itemType: 'container' }]);
  render(<BrowseView path="plex/video" />);
  fireEvent.click(screen.getByTestId('browse-open-plex:12345'));
  expect(mockPush).toHaveBeenCalledWith('browse', expect.objectContaining({
    path: 'plex/12345', label: 'Bluey',
  }));
});
```

**Step 2:** Run: `npx vitest run frontend/src/modules/Media/browse/BrowseView.test.jsx` — FAIL (receives `plex/video/plex:12345`).

**Step 3: Implement.** In `BrowseView.jsx`:

1. Container click (line 61):
```jsx
<button
  data-testid={`browse-open-${id}`}
  onClick={() => push('browse', {
    path: String(id).replace(':', '/'),
    label: row.title ?? id,
    modifiers,
  })}
>
  {row.title ?? id} →
</button>
```
(`modifiers` was previously dropped — keep passing it.)

2. Replace the segment-derived breadcrumb. List-API containers are addressed by id, not by accumulated path, so segments past the first drill are meaningless. Render: Home / [Back when deep] / current label:

```jsx
export function BrowseView({ path, label, modifiers, take = 50 }) {
  const { items, total, loading, error, loadMore } = useListBrowse(path, { modifiers, take });
  const { queue } = useSessionController('local');
  const { push, replace, pop, depth } = useNav();

  if (loading) return <div data-testid="browse-view-loading">Loading…</div>;
  if (error) return <div data-testid="browse-view-error">{error.message}</div>;

  const crumbLabel = label ?? splitPath(path).join(' / ');
  return (
    <div data-testid="browse-view" className="browse-view">
      <nav className="browse-breadcrumb" aria-label="Breadcrumb">
        <button data-testid="browse-crumb-home" className="browse-crumb browse-crumb--home"
                onClick={() => replace('home', {})}>Home</button>
        {depth > 1 && (
          <button data-testid="browse-crumb-back" className="browse-crumb" onClick={() => pop()}>← Back</button>
        )}
        <span className="browse-crumb-sep" aria-hidden="true">/</span>
        <span className="browse-crumb browse-crumb--current" aria-current="page">{crumbLabel}</span>
      </nav>
      {/* item list unchanged apart from the container onClick above */}
```

3. `Canvas.jsx` passes the param through: `case 'browse': return <BrowseView path={params.path ?? ''} label={params.label} modifiers={params.modifiers} />;`

Note: `label` is stack-state only (NavProvider's URL writer whitelists `view/path/contentId/deviceId`), so a hard reload shows the segment fallback — acceptable.

**Step 4:** Run: `npx vitest run frontend/src/modules/Media/browse/` — pass (update any breadcrumb-segment assertions in the existing suite to the new Home/Back/label shape).

**Step 5: Live verify** (server on :3111): load `/media`, click a Home card, drill into a container, confirm the list loads and the network tab shows `/api/v1/list/plex/<id>` (no embedded colon). If the list API rejects `plex/<id>` for some source, capture the response — that's a backend bug to file, not to hack around here.

**Step 6: Commit** — `fix(media): browse drill-down addresses containers by id; breadcrumb shows titles with back nav (M4)`

---

## Task 5: Style the portaled cast picker (audit M1)

The picker portals to `document.body`, escaping the `.media-app` scope that defines both the CSS custom properties and the `.dispatch-target-picker` rules → renders unstyled (screenshot `04-cast-picker-open.png`).

**Files:**
- Modify: `frontend/src/Apps/MediaApp.scss` (lines ~9-80 token block, ~1343 picker block)
- Modify: `frontend/src/modules/Media/cast/CastButton.jsx:55-65`
- Test: `frontend/src/modules/Media/cast/CastButton.test.jsx` (exists — extend)

**Step 1: Failing test:**

```jsx
it('portal root carries the media-app-portal class so scoped styles apply', () => {
  render(<CastButton contentId="plex:1" />);
  fireEvent.click(screen.getByTestId('cast-button-plex:1'));
  const portal = document.querySelector('.cast-button-popover-portal');
  expect(portal).not.toBeNull();
  expect(portal.classList.contains('media-app-portal')).toBe(true);
});
```

**Step 2:** Run: `npx vitest run frontend/src/modules/Media/cast/CastButton.test.jsx` — FAIL.

**Step 3: Implement.**

1. `CastButton.jsx` portal div:
```jsx
className="media-app-portal cast-button-popover-portal"
```

2. `MediaApp.scss` — split the token declarations out of the `.media-app` surface block. The custom-property declarations currently at the top of `.media-app { … }` (the `--bg` through `--r-lg` lines) move into a new shared rule placed immediately above it:

```scss
.media-app,
.media-app-portal {
  --bg:         #101113;
  --bg-panel:   #17181b;
  --bg-card:    #1c1d20;
  --bg-hover:   #24252a;
  --bg-active:  #2d2e33;
  --border:     rgba(255, 255, 255, 0.07);
  --border-mid: rgba(255, 255, 255, 0.12);
  --fg:         #e9ebef;
  --fg-2:       #a9acb3;
  --fg-3:       #70747c;
  --fg-dim:     #4a4d54;
  --brand:      #e5a00d;
  --brand-hot:  #f2b431;
  --brand-dim:  #a67407;
  --brand-ink:  #1a1200;
  --success:    #5cbf5c;
  --danger:     #e35d5d;
  --info:       #4ea1d3;
  --font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --r-sm: 2px;
  --r:    4px;
  --r-lg: 6px;
}
```

`.media-app { … }` keeps everything else (surface styles, resets). **Do not** put `min-height: 100vh`/`background` on the portal class.

3. Re-scope the picker rule (line ~1343): `.media-app .dispatch-target-picker` → `:is(.media-app, .media-app-portal) .dispatch-target-picker`. Also give the portal the base font: append

```scss
.media-app-portal {
  font-family: var(--font);
  font-size: 14px;
  line-height: 1.5;
  color: var(--fg);
  *, *::before, *::after { box-sizing: border-box; }
}
```

**Step 4:** Run the CastButton tests — pass. Run `npx vitest run frontend/src/modules/Media/cast/`.

**Step 5: Live verify:** `/media` → search anything → click `Cast` on a result row → picker must render as a dark panel with section labels, device checkboxes, mode radios, amber submit. Screenshot for the record.

**Step 6: Commit** — `fix(media): cast picker portal inherits design tokens; no more unstyled popover (M1)`

---

# Phase 2 — Playback surface (P0)

## Task 6: Fine-grained position ticks without persistence spam

Snapshot position currently updates every ≥5s (`HiddenPlayerMount` gate), too coarse for a seek bar. Add a non-persisting tick path.

**Files:**
- Modify: `frontend/src/modules/Media/session/LocalSessionAdapter.js`
- Modify: `frontend/src/modules/Media/session/HiddenPlayerMount.jsx:109-145`
- Test: `frontend/src/modules/Media/session/LocalSessionAdapter.test.js` (exists — extend)

**Step 1: Failing test:**

```js
it('onPlayerPositionTick updates subscribers without writing persistence', () => {
  const persistence = { read: () => null, write: vi.fn(() => ({ ok: true })), clear: vi.fn() };
  const adapter = new LocalSessionAdapter({ clientId: 'c1', persistence });
  const writesBefore = persistence.write.mock.calls.length;
  const seen = [];
  adapter.subscribe((s) => seen.push(s.position));
  adapter.onPlayerPositionTick(12.4);
  expect(seen).toEqual([12.4]);
  expect(persistence.write.mock.calls.length).toBe(writesBefore); // no new write
});
```

**Step 2:** Run: `npx vitest run frontend/src/modules/Media/session/LocalSessionAdapter.test.js` — FAIL (method undefined).

**Step 3: Implement.** Add to `LocalSessionAdapter` (next to `onPlayerProgress`):

```js
/**
 * High-frequency position update for live UI (seek bar). Mutates the
 * in-memory snapshot and notifies subscribers but deliberately skips
 * persistence — the 5s onPlayerProgress path remains the durable write.
 */
onPlayerPositionTick(positionSeconds) {
  if (typeof positionSeconds !== 'number' || !Number.isFinite(positionSeconds)) return;
  const prev = this._snapshot;
  if (Math.abs((prev.position ?? 0) - positionSeconds) < 0.5) return;
  this._snapshot = { ...prev, position: positionSeconds };
  for (const sub of this._subscribers) sub(this._snapshot);
}
```

In `HiddenPlayerMount.jsx` `onProgress` (after the stall block, before the 5s gate):

```js
adapter.onPlayerPositionTick(positionSeconds);
```

**Step 4:** Run the session test file — pass. Also `npx vitest run frontend/src/modules/Media/session/HiddenPlayerMount.test.jsx` (existing suite must stay green; its progress-throttle assertions concern `onPlayerProgress`, which is unchanged).

**Step 5: Commit** — `feat(media): 0.5s-granularity position ticks for UI without extra persistence writes`

---

## Task 7: QueuePanel component (audit M6)

The Plex-MP queue API exists (`adapter.queue.{jump,remove,clear,…}`, `config.{setShuffle,setRepeat}`) with zero UI. Build the panel once; local and peek both use it (`useSessionController` accepts `'local'` or `{deviceId}`).

**Files:**
- Create: `frontend/src/modules/Media/shell/QueuePanel.jsx`
- Create: `frontend/src/modules/Media/shell/QueuePanel.test.jsx`
- Modify: `frontend/src/Apps/MediaApp.scss` (append styles)

**Step 0: Verify queue item shape** — read `frontend/src/modules/Media/session/queueOps.js`; confirm items carry `queueItemId`, `contentId`, `title`, `priority` (`'upNext' | 'queue'`). Adjust field names below if reality differs.

**Step 1: Write the test** (`QueuePanel.test.jsx`):

```jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { QueuePanel } from './QueuePanel.jsx';

const mockQueue = { jump: vi.fn(), remove: vi.fn(), clear: vi.fn() };
const mockConfig = { setShuffle: vi.fn(), setRepeat: vi.fn() };
let mockSnapshot;

vi.mock('../session/useSessionController.js', () => ({
  useSessionController: () => ({ snapshot: mockSnapshot, queue: mockQueue, config: mockConfig }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockSnapshot = {
    state: 'playing',
    config: { shuffle: false, repeat: 'off' },
    queue: {
      currentIndex: 0,
      upNextCount: 0,
      items: [
        { queueItemId: 'q1', contentId: 'plex:1', title: 'First', priority: 'queue' },
        { queueItemId: 'q2', contentId: 'plex:2', title: 'Second', priority: 'upNext' },
      ],
    },
  };
});

describe('QueuePanel', () => {
  it('renders one row per queue item with the current item marked', () => {
    render(<QueuePanel target="local" />);
    expect(screen.getByTestId('queue-item-q1').className).toContain('queue-item--current');
    expect(screen.getByTestId('queue-item-q2').className).toContain('queue-item--upnext');
  });

  it('jump / remove / clear call through to the controller', () => {
    render(<QueuePanel target="local" />);
    fireEvent.click(screen.getByTestId('queue-jump-q2'));
    expect(mockQueue.jump).toHaveBeenCalledWith('q2');
    fireEvent.click(screen.getByTestId('queue-remove-q2'));
    expect(mockQueue.remove).toHaveBeenCalledWith('q2');
    fireEvent.click(screen.getByTestId('queue-clear'));
    expect(mockQueue.clear).toHaveBeenCalled();
  });

  it('shuffle toggles and repeat cycles off→all→one→off', () => {
    render(<QueuePanel target="local" />);
    fireEvent.click(screen.getByTestId('queue-shuffle'));
    expect(mockConfig.setShuffle).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByTestId('queue-repeat'));
    expect(mockConfig.setRepeat).toHaveBeenCalledWith('all');
  });

  it('renders an empty state when the queue has no items', () => {
    mockSnapshot = { ...mockSnapshot, queue: { items: [], currentIndex: -1, upNextCount: 0 } };
    render(<QueuePanel target="local" />);
    expect(screen.getByTestId('queue-empty')).toBeTruthy();
  });
});
```

**Step 2:** Run: `npx vitest run frontend/src/modules/Media/shell/QueuePanel.test.jsx` — FAIL (module missing).

**Step 3: Implement** (`QueuePanel.jsx`):

```jsx
import React from 'react';
import { useSessionController } from '../session/useSessionController.js';

const REPEAT_NEXT = { off: 'all', all: 'one', one: 'off' };

export function QueuePanel({ target = 'local' }) {
  const { snapshot, queue, config } = useSessionController(target);
  const q = snapshot?.queue;
  if (!q || !Array.isArray(q.items) || q.items.length === 0) {
    return <div data-testid="queue-empty" className="queue-empty">Queue is empty</div>;
  }
  const shuffle = !!snapshot.config?.shuffle;
  const repeat = snapshot.config?.repeat ?? 'off';

  return (
    <div data-testid="queue-panel" className="queue-panel">
      <div className="queue-toolbar">
        <span className="queue-count">{q.items.length} item{q.items.length === 1 ? '' : 's'}</span>
        <button data-testid="queue-shuffle" aria-pressed={shuffle}
                onClick={() => config.setShuffle?.(!shuffle)}>
          Shuffle{shuffle ? ' ✓' : ''}
        </button>
        <button data-testid="queue-repeat" onClick={() => config.setRepeat?.(REPEAT_NEXT[repeat])}>
          Repeat: {repeat}
        </button>
        <button data-testid="queue-clear" className="queue-clear" onClick={() => queue.clear?.()}>Clear</button>
      </div>
      <ul className="queue-items">
        {q.items.map((it, idx) => {
          const isCurrent = idx === q.currentIndex;
          const cls = [
            'queue-item',
            isCurrent ? 'queue-item--current' : '',
            it.priority === 'upNext' ? 'queue-item--upnext' : '',
          ].filter(Boolean).join(' ');
          return (
            <li key={it.queueItemId} data-testid={`queue-item-${it.queueItemId}`} className={cls}>
              <button className="queue-item-title" data-testid={`queue-jump-${it.queueItemId}`}
                      onClick={() => queue.jump?.(it.queueItemId)} disabled={isCurrent}>
                {it.title ?? it.contentId}
              </button>
              {it.priority === 'upNext' && <span className="queue-badge">up next</span>}
              <button className="queue-item-remove" aria-label="Remove from queue"
                      data-testid={`queue-remove-${it.queueItemId}`}
                      onClick={() => queue.remove?.(it.queueItemId)}>×</button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default QueuePanel;
```

SCSS (append to `MediaApp.scss`):

```scss
:is(.media-app, .media-app-portal) .queue-panel {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--r);
  padding: 10px;
  .queue-toolbar {
    display: flex; align-items: center; gap: 8px;
    padding-bottom: 8px; margin-bottom: 6px;
    border-bottom: 1px solid var(--border);
    font-size: 12px; color: var(--fg-2);
    .queue-count { margin-right: auto; }
    button {
      padding: 4px 10px; font-size: 11px; font-weight: 500;
      color: var(--fg-2); background: var(--bg-card);
      border: 1px solid var(--border-mid); border-radius: var(--r-sm);
      &:hover { color: var(--fg); background: var(--bg-hover); }
      &[aria-pressed='true'] { color: var(--brand); border-color: var(--brand); }
    }
    .queue-clear:hover { color: #fff; background: var(--danger); border-color: var(--danger); }
  }
  .queue-items { display: flex; flex-direction: column; gap: 1px; }
  .queue-item {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 8px; border-radius: var(--r-sm);
    &:hover { background: var(--bg-hover); }
    &--current { background: rgba(229, 160, 13, 0.10); .queue-item-title { color: var(--brand); } }
    &--upnext .queue-badge {
      font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em;
      color: var(--info); border: 1px solid var(--info); border-radius: var(--r-sm); padding: 1px 5px;
    }
  }
  .queue-item-title {
    flex: 1; text-align: left; font-size: 13px; color: var(--fg);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    &:disabled { cursor: default; }
    &:hover:not(:disabled) { color: var(--brand); }
  }
  .queue-item-remove {
    width: 22px; height: 22px; border-radius: var(--r-sm);
    color: var(--fg-3); font-size: 14px;
    &:hover { color: #fff; background: var(--danger); }
  }
}
.media-app .queue-empty { padding: 14px; font-size: 13px; color: var(--fg-3); }
```

**Step 4:** Run the test file — pass.

**Step 5: Commit** — `feat(media): QueuePanel — visible queue with jump/remove/clear/shuffle/repeat (M6, C3.2/C3.3)`

---

## Task 8: NowPlayingView becomes a real player screen (audit M5)

**Files:**
- Modify: `frontend/src/modules/Media/shell/NowPlayingView.jsx` (full rewrite below)
- Modify: `frontend/src/modules/Media/shell/MiniPlayer.jsx` (queue count badge)
- Modify: `frontend/src/Apps/MediaApp.scss`
- Test: create `frontend/src/modules/Media/shell/NowPlayingView.test.jsx`; extend `MiniPlayer.test.jsx`

**Step 1: Tests** (`NowPlayingView.test.jsx`, mock `useSessionController` like QueuePanel's test; also mock `usePlayerHost` to a no-op and `useNav` to `{ pop: vi.fn(), depth: 2 }`; stub `DispatchTargetPicker` and `QueuePanel` with `vi.mock` returning simple divs):

```jsx
it('shows the item title, not the raw contentId', () => {
  render(<NowPlayingView />);
  expect(screen.getByRole('heading').textContent).toContain('Bluey S1E1');
  expect(screen.getByRole('heading').textContent).not.toContain('plex:660761');
});

it('seek bar commits transport.seekAbs on release', () => {
  render(<NowPlayingView />);
  const bar = screen.getByTestId('np-seek');
  fireEvent.change(bar, { target: { value: '90' } });
  fireEvent.pointerUp(bar);
  expect(mockTransport.seekAbs).toHaveBeenCalledWith(90);
});

it('volume slider calls config.setVolume', () => {
  render(<NowPlayingView />);
  fireEvent.change(screen.getByTestId('np-volume'), { target: { value: '40' } });
  expect(mockConfig.setVolume).toHaveBeenCalledWith(40);
});

it('hand-off picker is collapsed behind a toggle', () => {
  render(<NowPlayingView />);
  expect(screen.queryByTestId('dispatch-target-picker-stub')).toBeNull();
  fireEvent.click(screen.getByTestId('np-handoff-toggle'));
  expect(screen.getByTestId('dispatch-target-picker-stub')).toBeTruthy();
});
```

Snapshot fixture: `{ state: 'playing', position: 30, currentItem: { contentId: 'plex:660761', title: 'Bluey S1E1', duration: 420 }, config: { volume: 80, shuffle: false, repeat: 'off' }, queue: { items: [...], currentIndex: 0 } }`.

**Step 2:** Run — FAIL.

**Step 3: Implement** — full replacement of `NowPlayingView.jsx`:

```jsx
import React, { useRef, useEffect, useState } from 'react';
import { useSessionController } from '../session/useSessionController.js';
import { usePlayerHost } from '../session/usePlayerHost.js';
import { DispatchTargetPicker } from '../cast/DispatchTargetPicker.jsx';
import { QueuePanel } from './QueuePanel.jsx';
import { useNav } from './NavProvider.jsx';

const PLAYING_STATES = new Set(['playing', 'buffering']);

function fmt(s) {
  const t = Math.max(0, Math.floor(s ?? 0));
  const m = Math.floor(t / 60);
  return `${m}:${String(t % 60).padStart(2, '0')}`;
}

export function NowPlayingView() {
  const { snapshot, transport, config } = useSessionController('local');
  const item = snapshot.currentItem;
  const hostRef = useRef(null);
  usePlayerHost(hostRef);
  const { pop, depth } = useNav();
  const [scrub, setScrub] = useState(null);       // local value while dragging
  const [handoffOpen, setHandoffOpen] = useState(false);

  const goBack = () => { if (depth > 1) pop(); else window.history.back?.(); };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); goBack(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [depth, pop]);

  const isPlaying = PLAYING_STATES.has(snapshot.state);
  const duration = item?.duration ?? 0;
  const position = scrub ?? snapshot.position ?? 0;
  const commitSeek = () => {
    if (scrub != null) { transport.seekAbs?.(scrub); setScrub(null); }
  };

  return (
    <div data-testid="now-playing-view">
      <div className="now-playing-toolbar">
        <button data-testid="now-playing-back" className="now-playing-back-btn"
                onClick={goBack} aria-label="Back">← Back</button>
        <span className="now-playing-state" data-testid="np-state">{snapshot.state}</span>
      </div>

      <h2 className="now-playing-title">{item ? (item.title ?? item.contentId) : 'Nothing playing'}</h2>

      <div data-testid="now-playing-host" ref={hostRef} className="now-playing-host" />

      {item && (
        <div className="np-transport" data-testid="np-transport">
          <div className="np-seek-row">
            <span className="np-time">{fmt(position)}</span>
            <input
              data-testid="np-seek" className="np-seek" type="range"
              min="0" max={duration || 0} step="1"
              value={Math.min(position, duration || 0)}
              disabled={!duration}
              aria-label="Seek"
              onChange={(e) => setScrub(Number(e.target.value))}
              onPointerUp={commitSeek}
              onKeyUp={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') commitSeek(); }}
            />
            <span className="np-time">{duration ? fmt(duration) : '–:––'}</span>
          </div>
          <div className="np-buttons">
            <button data-testid="np-prev" aria-label="Previous" onClick={() => transport.skipPrev?.()}>⏮</button>
            <button data-testid="np-toggle" aria-label={isPlaying ? 'Pause' : 'Play'}
                    onClick={() => (isPlaying ? transport.pause?.() : transport.play?.())}>
              {isPlaying ? '❚❚' : '▶'}
            </button>
            <button data-testid="np-next" aria-label="Next" onClick={() => transport.skipNext?.()}>⏭</button>
            <button data-testid="np-stop" aria-label="Stop" onClick={() => transport.stop?.()}>■</button>
            <label className="np-volume-label">
              🔊
              <input data-testid="np-volume" type="range" min="0" max="100" step="1"
                     value={snapshot.config?.volume ?? 100}
                     aria-label="Volume"
                     onChange={(e) => config.setVolume?.(Number(e.target.value))} />
            </label>
          </div>
        </div>
      )}

      <QueuePanel target="local" />

      {item && (
        <div className="handoff-section" data-testid="handoff-section">
          <button data-testid="np-handoff-toggle" className="np-handoff-toggle"
                  onClick={() => setHandoffOpen((v) => !v)}>
            {handoffOpen ? 'Hide hand-off' : 'Hand off to device…'}
          </button>
          {handoffOpen && (
            <DispatchTargetPicker
              source={{ snapshot }}
              submitLabel="Hand off"
              autoFocus={false}
              onComplete={() => setHandoffOpen(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default NowPlayingView;
```

SCSS (append; also delete the old `> div:not(.handoff-section):not(.now-playing-host)` debug-chip rule from the `[data-testid='now-playing-view']` block):

```scss
.media-app .now-playing-title { font-size: 22px; font-weight: 600; color: var(--fg); }
.media-app .now-playing-state {
  font-size: 11px; text-transform: uppercase; letter-spacing: .05em;
  color: var(--fg-3); padding: 3px 8px;
  border: 1px solid var(--border); border-radius: var(--r-sm);
}
.media-app .np-transport {
  display: flex; flex-direction: column; gap: 10px;
  padding: 12px 14px; background: var(--bg-card);
  border: 1px solid var(--border); border-radius: var(--r);
}
.media-app .np-seek-row {
  display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 10px;
  .np-time { font-size: 11px; color: var(--fg-3); font-variant-numeric: tabular-nums; }
}
.media-app .np-seek {
  appearance: none; height: 6px; border-radius: 3px; background: var(--bg-active);
  &::-webkit-slider-thumb { appearance: none; width: 16px; height: 16px; border-radius: 50%; background: var(--brand); cursor: grab; }
  &::-moz-range-thumb { width: 16px; height: 16px; border: none; border-radius: 50%; background: var(--brand); cursor: grab; }
  &:disabled { opacity: .4; }
}
.media-app .np-buttons {
  display: flex; align-items: center; gap: 8px;
  button {
    width: 40px; height: 40px; display: inline-flex; align-items: center; justify-content: center;
    background: var(--bg-panel); border: 1px solid var(--border-mid); border-radius: var(--r);
    color: var(--fg); font-size: 14px;
    &:hover { background: var(--brand); color: var(--brand-ink); border-color: var(--brand); }
  }
  [data-testid='np-stop']:hover { background: var(--danger); color: #fff; border-color: var(--danger); }
  .np-volume-label { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; color: var(--fg-2);
    input { width: 120px; } }
}
.media-app .np-handoff-toggle {
  padding: 8px 14px; font-size: 13px; color: var(--fg);
  background: var(--bg-card); border: 1px solid var(--border-mid); border-radius: var(--r);
  &:hover { border-color: var(--brand); }
}
```

**Step 4: MiniPlayer queue badge.** In `MiniPlayer.jsx`, inside the title button after the text, add:

```jsx
{snapshot.queue?.items?.length > 1 && (
  <span className="mini-queue-count" data-testid="mini-queue-count">
    {snapshot.queue.currentIndex + 1}/{snapshot.queue.items.length}
  </span>
)}
```

SCSS: `.media-app .mini-queue-count { font-size: 10px; color: var(--fg-3); }`
Test (extend `MiniPlayer.test.jsx`): with a 3-item queue at index 1, badge shows `2/3`.

**Step 5:** Run: `npx vitest run frontend/src/modules/Media/shell/` — pass.

**Step 6: Live verify:** play something from search; open MiniPlayer title → NowPlaying shows title, ticking seek bar (1s granularity from Task 6), working pause/seek/volume/skip, queue listed below, hand-off collapsed.

**Step 7: Commit** — `feat(media): NowPlaying is a real player — title, transport, seek, volume, queue; hand-off collapsed (M5)`

---

# Phase 3 — Fleet, peek, and honest errors

## Task 9: Truthful fleet status + guarded Take Over (audit M11)

**Files:**
- Modify: `frontend/src/modules/Media/shell/FleetView.jsx`
- Modify: `frontend/src/modules/Media/shell/FleetIndicator.jsx`
- Modify: `frontend/src/Apps/MediaApp.scss` (lines ~304-311, ~865-880)
- Test: extend `FleetView.test.jsx`, `FleetIndicator.test.jsx`

**Step 1: Failing tests:**

```jsx
// FleetView.test.jsx
it('hides Take Over for offline/idle devices', () => {
  setEntry('tv1', { offline: true, snapshot: { state: 'playing' } });
  setEntry('tv2', { offline: false, snapshot: { state: 'idle' } });
  render(<FleetView />);
  expect(screen.queryByTestId('fleet-takeover-tv1')).toBeNull();
  expect(screen.queryByTestId('fleet-takeover-tv2')).toBeNull();
});
it('shows Take Over for an active session', () => {
  setEntry('tv1', { offline: false, snapshot: { state: 'playing' } });
  render(<FleetView />);
  expect(screen.getByTestId('fleet-takeover-tv1')).toBeTruthy();
});
it('state dot reflects offline', () => {
  setEntry('tv1', { offline: true, snapshot: { state: 'playing' } });
  render(<FleetView />);
  expect(screen.getByTestId('fleet-card-tv1').querySelector('.fleet-card-state').className)
    .toContain('fleet-card-state--offline');
});

// FleetIndicator.test.jsx
it('carries an offline modifier when nothing is online', () => {
  mockSummary({ total: 2, online: 0 });
  render(<FleetIndicator />);
  expect(screen.getByTestId('fleet-indicator').className).toContain('fleet-indicator--offline');
});
```

**Step 2:** Run both files — FAIL.

**Step 3: Implement.**

`FleetView.jsx`:
```jsx
const ACTIVE_STATES = new Set(['playing', 'paused', 'buffering', 'stalled']);
// in the card map:
const offline = !!entry?.offline;
const devState = entry?.snapshot?.state ?? 'unknown';
const stateClass = `fleet-card-state fleet-card-state--${offline ? 'offline' : devState}`;
const canTakeOver = !offline && ACTIVE_STATES.has(devState);
// ...
<div className={stateClass}>{stateLabel(entry)}</div>
// ...
{canTakeOver && (
  <button data-testid={`fleet-takeover-${d.id}`} onClick={() => takeOver(d.id)} className="fleet-takeover-btn">
    Take Over
  </button>
)}
```

`FleetIndicator.jsx`:
```jsx
className={`fleet-indicator ${online > 0 ? 'fleet-indicator--online' : 'fleet-indicator--offline'}`}
```

SCSS — replace the unconditional green dots:
```scss
.fleet-indicator::before { /* keep size/shape rules */ background: var(--fg-dim); }
.fleet-indicator--online::before { background: var(--success); }
.fleet-indicator--offline::before { background: var(--danger); }

.fleet-card-state::before { background: var(--fg-dim); } /* default: unknown/idle */
.fleet-card-state--playing::before,
.fleet-card-state--buffering::before { background: var(--success); }
.fleet-card-state--paused::before,
.fleet-card-state--stalled::before { background: var(--brand); }
.fleet-card-state--offline::before { background: var(--danger); }
```

**Step 4:** Run — pass. **Step 5: Commit** — `fix(media): fleet dots reflect real state; Take Over only offered for active sessions (M11)`

## Task 10: Peek gains seek, queue ops, and a human name (audit M12)

**Files:**
- Modify: `frontend/src/modules/Media/shell/PeekPanel.jsx`
- Modify: `frontend/src/modules/Media/shell/PeekPanel.scss`
- Test: extend `PeekPanel.test.jsx`

**Step 1: Failing tests:** heading shows device *name* (mock `useFleetContext` → `devices: [{id:'tv1', name:'Living Room TV'}]`); a `peek-seek` range exists and `pointerUp` calls `ctl.transport.seekAbs`; `queue-panel` (or `queue-empty`) renders inside the peek panel.

**Step 2:** Run: `npx vitest run frontend/src/modules/Media/shell/PeekPanel.test.jsx` — FAIL.

**Step 3: Implement.** In `PeekPanel.jsx`:

```jsx
import { useFleetContext } from '../fleet/FleetProvider.jsx';
import { QueuePanel } from './QueuePanel.jsx';
// inside component:
const { devices } = useFleetContext();
const deviceName = devices?.find((d) => d.id === deviceId)?.name ?? deviceId;
const [scrub, setScrub] = useState(null);
const duration = snap?.currentItem?.duration ?? 0;
const position = scrub ?? snap?.position ?? 0;
```

Heading: `<h2>Peek: {deviceName}</h2>`. After the transport row add:

```jsx
<div className="peek-seek-row">
  <input data-testid="peek-seek" type="range" min="0" max={duration || 0} step="1"
         value={Math.min(position, duration || 0)} disabled={!duration} aria-label="Seek"
         onChange={(e) => setScrub(Number(e.target.value))}
         onPointerUp={() => { if (scrub != null) { ctl.transport.seekAbs?.(scrub); setScrub(null); } }} />
</div>
```

After `.peek-config` add `<QueuePanel target={{ deviceId }} />` (QueuePanel already tolerates `snapshot === null` via its empty/null guard — verify; if `useSessionController({deviceId})` returns `snapshot: null`, the guard `if (!q …)` catches it).

**Step 4:** Run — pass. **Step 5: Commit** — `feat(media): peek panel gets seek bar, remote queue panel, and device names (M12, C5.2/C5.3)`

## Task 11: Per-source search errors + adapter timeout (audit B3/B4)

Backend-additive: erroring adapters yield a `source_error` SSE event; every adapter search is raced against an 8s timeout. Frontend: both UIs show which sources failed.

**Files:**
- Modify: `backend/src/3_applications/content/ContentQueryService.mjs` (`searchStream` lines ~244-301; `search` lines ~116-147)
- Modify: `backend/src/4_api/v1/routers/content.mjs` (stream route ~330-382 — read first; forward the new event)
- Modify: `frontend/src/hooks/useStreamingSearch.js`
- Modify: `frontend/src/modules/Media/search/SearchBar.jsx`, `frontend/src/modules/Admin/ContentLists/ContentSearchCombobox.jsx`
- Test: locate the existing ContentQueryService unit tests (`grep -rl "ContentQueryService" backend/tests/ tests/` — they exist per the technical doc's Verified-by pattern); extend. Frontend: `frontend/src/hooks/useStreamingSearch.test.jsx`.

**Step 1: Backend failing test** (in the located ContentQueryService test file, following its registry-stub pattern):

```js
it('searchStream yields source_error for a failing adapter and still completes', async () => {
  const good = stubAdapter('plex', { items: [{ id: 'plex:1', title: 'A' }] });
  const bad = { source: 'abs', getSearchCapabilities: () => ({ canonical: ['text'], specific: [] }),
                search: async () => { throw new Error('connect ECONNREFUSED'); } };
  const svc = new ContentQueryService({ registry: stubRegistry([good, bad]) });
  const events = [];
  for await (const e of svc.searchStream({ text: 'aa' })) events.push(e);
  expect(events.some((e) => e.event === 'source_error' && e.source === 'abs')).toBe(true);
  expect(events.at(-1).event).toBe('complete');
});

it('searchStream times out a hung adapter', async () => {
  const hung = { source: 'slow', getSearchCapabilities: () => ({ canonical: ['text'], specific: [] }),
                 search: () => new Promise(() => {}) };
  const svc = new ContentQueryService({ registry: stubRegistry([hung]), adapterTimeoutMs: 50 });
  const events = [];
  for await (const e of svc.searchStream({ text: 'aa' })) events.push(e);
  expect(events.some((e) => e.event === 'source_error' && /timeout/.test(e.error))).toBe(true);
});
```

**Step 2:** Run the backend unit harness for that file (`npm run test:unit` filtered, or `npx vitest run <path>` if the suite is vitest-based — check how sibling tests in that directory are invoked). Expect FAIL.

**Step 3: Implement in `ContentQueryService.mjs`.**

Constructor: accept `adapterTimeoutMs = 8000`, store in `#adapterTimeoutMs`.

Module-level helper:
```js
function withTimeout(promise, ms, label) {
  if (!ms || ms <= 0) return promise;
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}
```

In `searchStream` adapterPromises: `const result = await withTimeout(adapter.search(translated), this.#adapterTimeoutMs, adapter.source);`
In the race loop, change the skip line:
```js
if (error) {
  yield { event: 'source_error', source: adapter.source, error: error.message, pending: [...pending] };
  continue;
}
if (skipped || !result?.items?.length) continue;
```
Apply the same `withTimeout` wrap in `search()`'s adapter map (the batch path already pushes warnings — timeouts now feed it too).

**Step 4: Route.** Read `content.mjs:330-382`; ensure the stream loop forwards events generically (if it switches on event names, add a `source_error` case writing `event: source_error\ndata: {source, error}`).

**Step 5: Frontend hook.** In `useStreamingSearch.js`, add state `const [sourceErrors, setSourceErrors] = useState([])`; clear it where results are cleared; in `onmessage` add:

```js
} else if (data.event === 'source_error') {
  setSourceErrors((prev) => [...prev, { source: data.source, error: data.error }]);
}
```
Expose `sourceErrors` in the return. Extend `useStreamingSearch.test.jsx` with a `source_error` message case.

**Step 6: Surface it.** Media `SearchBar.jsx` — under the results/pending blocks:
```jsx
{sourceErrors.length > 0 && (
  <div data-testid="search-source-errors" className="search-source-errors">
    {sourceErrors.map((e) => <span key={e.source}>⚠ {e.source} unavailable</span>)}
  </div>
)}
```
(SCSS: small, `color: var(--danger)`, 11px, padded.) Admin combobox — same idea as a `<Box>` strip mirroring the existing pending-sources strip (`ContentSearchCombobox.jsx:637-649`), using the hook's new field.

**Step 7:** Run backend + frontend test files — pass. **Step 8: Commit** — `feat(search): per-source error events + 8s adapter timeout; both UIs show failed sources (B3, B4)`

---

# Phase 4 — Admin ContentSearchCombobox

> All tasks touch `frontend/src/modules/Admin/ContentLists/ContentSearchCombobox.jsx`. The Playwright suite `tests/live/flow/admin/content-search-combobox/` (17 files) is the safety net — run `01-basic-interactions`, `04-keyboard-navigation`, and `12-freeform-commit` after each task, full suite at phase end. These need the dev server (see Conventions).

## Task 12: Open shows the committed value; no stale results (audit §3.1-1/2/10)

**Step 1: Behavior to implement** (Playwright assertions come in Step 3):
- `onDropdownOpen`: `if (search === null) setSearch(value || '')` (was `''`) — the rAF `select()` then highlights the actual value so typing replaces it, but the user *sees* what's committed.
- `onDropdownClose`: in addition to `setSearch(null)`, reset browse state and stale stream results:
  ```js
  setBreadcrumbs([]); setBrowseResults([]); setPagination(null); setInitialLoadDone(false);
  streamSearch(''); // hook clears results/pending for short queries
  ```
- Sibling-load gate on open: drop the `results.length === 0` condition (stale stream results blocked it): `if (value && !initialLoadDone)`.

**Step 2: Implement** the three edits above.

**Step 3: Playwright check.** Extend `tests/live/flow/admin/content-search-combobox/01-basic-interactions.runtime.test.mjs` (follow its harness conventions and use the ComboboxTestPage URL pattern `?value=...`):

```js
test('opening with a committed value shows that value selected in the input', async ({ page }) => {
  await page.goto(`${BASE}/admin/test/combobox?value=${encodeURIComponent('plex:456724')}`);
  const input = page.getByPlaceholder('Search content...');
  await input.click();
  await expect(input).toHaveValue('plex:456724');   // not blanked
  const selection = await input.evaluate((el) => el.value.slice(el.selectionStart, el.selectionEnd));
  expect(selection).toBe('plex:456724');            // select-all, type-to-replace
});

test('reopening after a search does not show stale results under an untouched input', async ({ page }) => {
  await page.goto(`${BASE}/admin/test/combobox`);
  const input = page.getByPlaceholder('Search content...');
  await input.fill('christmas');
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  await input.click();                               // reopen
  await expect(page.getByText('Type to search...')).toBeVisible();
});
```

Run: `npx playwright test tests/live/flow/admin/content-search-combobox/01-basic-interactions.runtime.test.mjs --reporter=line` — pass.

**Step 4: Commit** — `fix(admin): combobox opens showing committed value (select-all); state fully resets on close`

## Task 13: Non-destructive blur + explicit freeform affordance (audit §3.1-5/6)

**Policy** (preserves the 2026-03-01 invariant's intent — *intentional* input is never lost — while making exploration non-destructive):
- **Blur:** commit only if the text is content-id-like (`/^[\w-]+:\S+/` — covers `plex:456724`, `canvas:religious/stars.jpg`). Otherwise revert to the committed value and log `freeform.revert_on_blur`.
- **Enter:** commit freeform whenever the user has not explicitly arrow-navigated to an option (`userNavigatedRef`, ported from the inline ListsItemRow fix per `docs/_wip/bugs/2026-03-01-admin-freeform-commit-must-always-save.md:33-38`).
- **Always-visible escape hatch:** when `search && search !== value`, the dropdown's last row is `Use “{search}” as raw value`.

**Step 1: Update the regression suite FIRST** (`tests/live/flow/admin/content-search-combobox/12-freeform-commit.runtime.test.mjs`). Read its 5 scenarios; for each, classify the typed fixture:
- Fixtures containing `:` (id-like) → keep blur-commit expectations as-is.
- Fixtures without `:` → change expectation: blur reverts; commit happens via Enter or the freeform row instead. Add two new tests:

```js
test('blur reverts plain search text instead of committing it', async ({ page }) => {
  await page.goto(`${BASE}/admin/test/combobox?value=${encodeURIComponent('plex:456724')}`);
  const input = page.getByPlaceholder('Search content...');
  await input.click();
  await input.fill('beet');                 // exploratory search text
  await page.locator('body').click({ position: { x: 5, y: 5 } });  // blur
  await expect(page.getByTestId('current-value')).toHaveText('plex:456724'); // unchanged
});

test('the freeform row commits arbitrary text explicitly', async ({ page }) => {
  await page.goto(`${BASE}/admin/test/combobox`);
  const input = page.getByPlaceholder('Search content...');
  await input.click();
  await input.fill('my custom value');
  await page.getByTestId('freeform-commit-option').click();
  await expect(page.getByTestId('current-value')).toHaveText('my custom value');
});
```
(Confirm the ComboboxTestPage testid for the committed-value display — the audit noted it at `ComboboxTestPage.jsx:56`; adjust selector to match.)

**Step 2:** Run suite 12 — the updated/new tests FAIL against current behavior.

**Step 3: Implement** in `ContentSearchCombobox.jsx`:

```js
const CONTENT_ID_LIKE = /^[\w-]+:\S+/;
const userNavigatedRef = useRef(false);
```

- Input `onChange`: add `userNavigatedRef.current = false;`
- Input `onKeyDown`: before the Enter block, add
  ```js
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') userNavigatedRef.current = true;
  ```
  Enter block becomes:
  ```js
  if (e.key === 'Enter' && search && search !== value) {
    const idx = combobox.getSelectedOptionIndex();
    if (!userNavigatedRef.current || idx === -1 || results.length === 0) {
      log.info('freeform.commit_on_enter', { freeformValue: search, prevValue: value });
      e.preventDefault();
      onChange(search);
      combobox.closeDropdown();
    }
  }
  ```
- `onBlur` block becomes:
  ```js
  if (search !== null && search !== value) {
    if (search && CONTENT_ID_LIKE.test(search)) {
      log.info('freeform.commit_on_blur', { freeformValue: search, prevValue: value });
      onChange(search);
    } else {
      log.info('freeform.revert_on_blur', { discarded: search, kept: value });
    }
  }
  combobox.closeDropdown();
  ```
  Update the INVARIANT comment to describe the new policy and reference this plan + the bug doc.
- Freeform row — append after `{options}` inside `<Combobox.Options>`’s scroll area (search mode only):
  ```jsx
  {search && search !== value && breadcrumbs.length === 0 && (
    <Combobox.Option value="__freeform__" key="__freeform__" data-testid="freeform-commit-option">
      <Group gap="xs"><IconPencil size={14} /><Text size="sm">Use “{search}” as raw value</Text></Group>
    </Combobox.Option>
  )}
  ```
  (import `IconPencil` from tabler) and in `onOptionSubmit`:
  ```js
  if (val === '__freeform__') {
    log.info('freeform.commit_via_option', { freeformValue: search });
    onChange(search);
    setSearch(null); setBreadcrumbs([]); setBrowseResults([]);
    combobox.closeDropdown();
    return;
  }
  ```
  Also update the empty-state hint (line ~684): `'No results — select “Use as raw value” or press Enter'`.

**Step 4:** Run suites 12, 04, 01 — pass. **Step 5: Commit** — `feat(admin): combobox blur is non-destructive; freeform commit is explicit (Enter, or visible raw-value row)`

## Task 14: Clear button + resolved-title display (audit §3.1-9, no-clear)

**Step 1: Implement.**

- Clear: `rightSection` becomes
  ```jsx
  rightSection={isLoading ? <Loader size="xs" /> : (value ? (
    <ActionIcon size="sm" variant="subtle" aria-label="Clear selection" data-testid="combobox-clear"
      onClick={(e) => { e.stopPropagation(); log.info('value.cleared', { prevValue: value }); onChange(''); setSearch(null); }}>
      <IconX size={14} />
    </ActionIcon>
  ) : null)}
  ```
  (import `IconX`.)
- Title resolution: module-level `const titleCache = new Map();` In `handleItemClick`'s select branch, `if (item.title) titleCache.set(item.id, item.title);` Add:
  ```jsx
  const [resolvedTitle, setResolvedTitle] = useState(null);
  useEffect(() => {
    setResolvedTitle(null);
    if (!value || !/^[\w-]+:\S+/.test(value)) return;
    if (titleCache.has(value)) { setResolvedTitle(titleCache.get(value)); return; }
    const colonIndex = value.indexOf(':');
    const source = normalizeListSource(value.slice(0, colonIndex));
    const localId = value.slice(colonIndex + 1);
    let cancelled = false;
    fetch(`/api/v1/info/${source}/${encodeURIComponent(localId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((info) => {
        if (cancelled || !info?.title) return;
        titleCache.set(value, info.title);
        setResolvedTitle(info.title);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [value]);
  ```
  Render under the input (only while not editing):
  ```jsx
  {search === null && resolvedTitle && (
    <Text size="xs" c="dimmed" mt={2} truncate data-testid="combobox-resolved-title">{resolvedTitle}</Text>
  )}
  ```
  (Wrap `TextInput` + this line in a `<Box>` if Combobox.Target requires a single child — it does; use `<Combobox.Target><TextInput …/></Combobox.Target>` unchanged and place the Text *after* `</Combobox.Target>` inside the root `<Combobox>`.)

**Step 2: Playwright** (extend `05-display-validation` or `01`): select a known item → `combobox-resolved-title` appears with a non-ID string; click `combobox-clear` → committed value empties.

**Step 3:** Run those suites — pass. **Step 4: Commit** — `feat(admin): combobox clear button + human-readable resolved title under committed IDs`

## Task 15: Container dual affordance (audit §3.1-7)

When `selectContainers` is true, row-click selects (unchanged) but a chevron button now browses in. (When false, row-click already browses — unchanged.)

**Step 1: Implement** in `renderOption` (`ContentSearchCombobox.jsx:504-509`):

```jsx
<Group gap="xs" wrap="nowrap">
  <Badge size="xs" variant="light" color="gray">{(source ?? '?').toUpperCase()}</Badge>
  {isContainerItem && !selectContainers && (
    <IconChevronRight size={16} color="var(--mantine-color-dimmed)" />
  )}
  {isContainerItem && selectContainers && (
    <ActionIcon size="sm" variant="subtle" aria-label={`Browse into ${item.title}`}
      data-testid={`browse-into-${item.id}`}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); browseContainer(item); }}>
      <IconChevronRight size={16} />
    </ActionIcon>
  )}
</Group>
```

Note this also fixes the `source.toUpperCase()` crash path (`(source ?? '?')`).

**Step 2: Playwright** (extend `03-browse-mode`): with the test page configured for `selectContainers` (check ComboboxTestPage URL params; add a `selectContainers=1` param to the page if absent — it reads URL params at `ComboboxTestPage.jsx:18-19`), assert clicking `browse-into-*` drills (breadcrumb appears) while row-click commits the container id.

**Step 3:** Run suite 03 — pass. **Step 4: Commit** — `feat(admin): containers get explicit browse chevron when rows select (dual affordance)`

---

# Phase 5 — Scopes, mobile, contract hygiene

## Task 16: Scope dropdown renders children; config failures visible (audit M10)

**Files:** `frontend/src/modules/Media/search/SearchProvider.jsx`, `frontend/src/modules/Media/search/SearchBar.jsx`
**Test:** extend `SearchProvider.test.jsx`, `SearchBar.test.jsx`

**Step 1: Failing tests:** (a) `currentScope` resolves a *child* key (provider must search children); (b) SearchBar renders an `<optgroup>` for a parent with children; (c) config fetch rejection sets an error the bar can render (assert a `scope-error` testid).

**Step 2: Implement.**

`SearchProvider.jsx`:
```js
const [scopeError, setScopeError] = useState(null);
// in the effect: .catch((err) => { if (!cancelled) setScopeError(err); });
const flatScopes = useMemo(
  () => scopes.flatMap((s) => [s, ...(Array.isArray(s.children) ? s.children : [])]),
  [scopes],
);
const currentScope = useMemo(
  () => flatScopes.find((s) => s.key === currentScopeKey) ?? null,
  [flatScopes, currentScopeKey],
);
// validate stored key against flatScopes (not just top level) on load; expose scopeError in context value
```

`SearchBar.jsx` select body:
```jsx
{scopes.map((s) => (
  Array.isArray(s.children) && s.children.length > 0 ? (
    <optgroup key={s.key} label={s.label}>
      {s.params != null && <option value={s.key}>All {s.label}</option>}
      {s.children.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
    </optgroup>
  ) : (
    <option key={s.key} value={s.key}>{s.label}</option>
  )
))}
```
And after the select: `{scopeError && <span data-testid="scope-error" className="scope-error" title={scopeError.message}>⚠</span>}` (SCSS: danger color, 12px).

**Step 3:** Run: `npx vitest run frontend/src/modules/Media/search/` — pass. **Step 4: Commit** — `fix(media): scope dropdown renders child scopes via optgroup; config load failure is visible (M10)`

## Task 17: Mobile dock layout (audit M14)

**Files:** `frontend/src/Apps/MediaApp.scss` (~1191-1197)

**Step 1: Implement** — replace the 780px dock block:

```scss
@media (max-width: 780px) {
  .media-app [data-testid="media-dock"] {
    grid-template-columns: 1fr auto;   /* row 1: search + settings */
    grid-auto-rows: auto;
    row-gap: 8px;
    padding: 8px 12px;
  }
  .media-app .dock-status-cluster {
    grid-column: 1 / -1;               /* row 2: full-width status */
    justify-self: stretch;
    justify-content: space-between;
  }
  .media-app .media-canvas { padding: 16px 12px 40px; }
}
```

**Step 2: Verify** with Playwright viewport `{ width: 390, height: 844 }` screenshot (or the smoke script) — search full width, status row beneath, no orphaned cog. **Step 3: Commit** — `fix(media): mobile dock stacks search above status cluster (M14)`

## Task 18: Contract + docs hygiene (audit B1, M10-doc, logging)

**Step 1:** `backend/src/2_domains/media/IMediaSearchable.mjs` — update the typedef/docs: `getSearchCapabilities(): {canonical: string[], specific: string[]}`; tighten `isMediaSearchable` to also check the returned shape (`caps && Array.isArray(caps.canonical) && Array.isArray(caps.specific)` — call it defensively in a try/catch). Run any existing tests touching it.

**Step 2:** Remove the four raw `console.debug` calls in `ContentQueryService.mjs` (lines ~741, 745, 802, 805) — replace with `this.#logger.debug?.('content-query.watch-state', {...})`.

**Step 3:** Rewrite `docs/reference/media/search-scopes.md`: delete the Frontend Components table (ScopeDropdown/ScopeChips/useScopePrefs don't exist), document the actual surface (SearchProvider + `<select>` with optgroups, `media-scope-last` persistence), and mark favorites/recents/chips as "not currently implemented (removed in the P1-P7 rebuild)".

**Step 4:** Update `docs/docs-last-updated.txt` per CLAUDE.md (`git rev-parse HEAD > docs/docs-last-updated.txt`) at the end of the phase.

**Step 5: Commit** — `docs+chore: IMediaSearchable contract matches reality; search-scopes doc rewritten; logger hygiene (B1)`

---

# Phase 6 — Verification gate (run after every phase; mandatory at the end)

1. **Unit:** `npx vitest run frontend/src/modules/Media frontend/src/hooks/useStreamingSearch.test.jsx` → all green. Backend: run the unit harness for `3_applications/content`.
2. **Lint:** `cd frontend && npm run lint` (zero warnings policy).
3. **Live smoke:** dev server on :3111, then `node tests/_tmp_media_smoke.mjs` — review `/tmp/media-audit/*.png` + console/network output. Expected deltas vs the audit baseline: styled cast picker, search persists across Add, colon-query shows results, browse drill works, NowPlaying shows title + transport.
4. **Playwright:** `npx playwright test tests/live/flow/admin/content-search-combobox/ --reporter=line` → all 17 suites green (12-freeform updated by Task 13).
5. **Visual pass (use a vision check, not the user):** screenshot `/media` home, search-results, NowPlaying, fleet, peek, cast-picker-open, and 390px mobile; compare against `docs/_wip/audits/media-app-screens/` and confirm each audit P0 visibly resolved. Save new screenshots beside the old ones as `2026-06-XX-post-fix-*`.
6. Update the audit doc's findings table with `FIXED (commit …)` annotations.
7. **Do not merge to main** — leave the branch for the user's review (CLAUDE.md rule).

---

## Deferred (explicitly out of scope for this plan)

- **Combobox twin unification** (audit §3.2): make `ListsItemRow.jsx` consume the standalone component. Large, regression-prone; do as its own plan with the 17-suite Playwright net after this plan lands.
- Keyboard roving-highlight model for the Media search overlay + full a11y spec (`media-app-a11y.md`) — audit M9; needs design.
- Search-result deep links into `DetailView` and peek-row actions.
- Live-content (`isLive`) semantics; remote history (C4.3); reorder drag-and-drop in QueuePanel (jump/remove/clear ship first).
- Backend cross-source dedup and labeled ID-match rows (audit B2).
