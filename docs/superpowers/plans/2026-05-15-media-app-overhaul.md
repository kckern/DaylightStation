# Media App Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the MediaApp's shell + view layer so the primary user flow (search → preview → play locally OR cast to a specific device) works in one screen with no mode-switching, and so the secondary capabilities (browse / fleet / peek / hand-off) are reachable but demoted. Preserve all working infrastructure (providers, streaming search, dispatch pipeline, fleet enumeration, peek/hand-off machinery).

**Architecture:** Keep the existing 7-provider tree (`ClientIdentity` → `LocalSession` → `Fleet` → `Peek` → `CastTarget` → `Dispatch` → `Search`). Restructure the shell so Search is the front door, every result row offers inline actions (Play Here, Play Next, Up Next, Add, Cast → unified target picker), MiniPlayer has visible Stop, and Home/Fleet/Browse/Peek/Detail become secondary surfaces reached through a small overflow nav rather than peer routes. Introduce a single `DispatchTargetPicker` component used by both cast-from-result and hand-off-from-NowPlaying.

**Tech Stack:** React 18, Vite, SCSS, Playwright. Use the project logging framework (`frontend/src/lib/logging/`) for all diagnostic output — no raw `console.*` per CLAUDE.md.

**Reference docs:**
- Spec / audit: `docs/_wip/audits/2026-05-15-media-app-usability-audit.md`
- Requirements: `docs/reference/media/media-app-requirements.md`
- Technical contracts: `docs/reference/media/media-app-technical.md`
- Search scopes: `docs/reference/media/search-scopes.md`

**Hard constraints from the user:**
1. **End-to-end Playwright tests** for every user-visible flow shipped. The harness is in `tests/live/flow/media/` and uses `npx playwright test`.
2. **Design-review loop with screenshots.** After the build is functional, capture screenshots, dispatch a frontend-design critique, apply the critique, repeat until quality is acceptable. This is not optional.
3. **Read-only.** The app discovers/plays/casts. It does not organize, edit, or author content.
4. **No fire-and-forget.** Each task is TDD where applicable; visual changes get screenshot verification.

---

## File Structure

**Files to be created:**

| Path | Responsibility |
|---|---|
| `frontend/src/modules/Media/search/searchStates.js` | Pure helpers — derive the four search UI states (`idle` / `searching` / `error` / `empty`) from `(query, isSearching, results, error)`. |
| `frontend/src/modules/Media/search/SearchEmptyState.jsx` | Renders the empty-results message with the echoed query. |
| `frontend/src/modules/Media/search/SearchErrorState.jsx` | Renders the search error message with a retry button. |
| `frontend/src/modules/Media/search/SearchIdleState.jsx` | Renders the "start typing" prompt and the deep-link affordance when input matches `<source>:<localId>`. |
| `frontend/src/modules/Media/search/contentIdParser.js` | Pure parser — recognises content-ID shapes (`source:localId`) and returns a normalized id or null. |
| `frontend/src/modules/Media/search/ResultRow.jsx` | Single result row component, supports inline expand for preview and an inline DispatchTargetPicker for Cast. Extracted from `SearchResults`. |
| `frontend/src/modules/Media/cast/DispatchTargetPicker.jsx` | Unified inline picker — device checkboxes + transfer/fork mode + Cast button. Used by both ResultRow and NowPlayingView. |
| `frontend/src/modules/Media/cast/useDispatchTargetPicker.js` | Hook that owns local picker state (selected device ids, mode) per-open instance. |
| `frontend/src/modules/Media/browse/ResumeCard.jsx` | Renders a single "Resume <title>" card from persisted session. |
| `frontend/src/modules/Media/browse/RecentsRow.jsx` | Renders horizontal scroller of recently-played items. |
| `frontend/src/modules/Media/session/recents.js` | localStorage helper for last-N recently-played content IDs and a `recordRecent(item)` API. |
| `frontend/src/modules/Media/shell/AppNav.jsx` | Small left-side nav strip (Home / Devices / Browse) — accessible from any view, never the entry point. |
| `frontend/src/modules/Media/shell/SettingsMenu.jsx` | Overflow menu in the dock (gear icon) — hosts Reset Session and future settings. |
| `tests/live/flow/media/media-app-stop-flow.runtime.test.mjs` | Playwright: play something, click Stop, confirm idle. |
| `tests/live/flow/media/media-app-inline-cast.runtime.test.mjs` | Playwright: search → result row → inline target picker → dispatch fires. |
| `tests/live/flow/media/media-app-search-states.runtime.test.mjs` | Playwright: idle / searching / empty / error states all render distinctly. |
| `tests/live/flow/media/media-app-deep-link-input.runtime.test.mjs` | Playwright: typing a `source:id` shows the deep-link affordance. |
| `tests/live/flow/media/media-app-resume.runtime.test.mjs` | Playwright: home view shows Resume + Recents from prior session. |
| `tests/live/flow/media/media-app-handoff-picker.runtime.test.mjs` | Playwright: NowPlaying hand-off uses the same DispatchTargetPicker. |
| `tests/live/flow/media/media-app-design-screens.runtime.test.mjs` | Captures screenshots at canonical states for design review. |

**Files to be modified:**

| Path | Change |
|---|---|
| `frontend/src/hooks/useStreamingSearch.js` | Return `error` state so the UI can surface it. |
| `frontend/src/modules/Media/search/useLiveSearch.js` | Forward `error` from underlying hook. |
| `frontend/src/modules/Media/search/SearchBar.jsx` | Don't auto-dismiss on outside click for result interactions; route to the four-state UI. |
| `frontend/src/modules/Media/search/SearchResults.jsx` | Delegate to ResultRow; route through `searchStates.js`. |
| `frontend/src/modules/Media/cast/CastButton.jsx` | Opens `DispatchTargetPicker` inline instead of relying on pre-selected Dock targets. |
| `frontend/src/modules/Media/cast/CastTargetChip.jsx` | Reframe label as "Default targets" or remove from Dock (decision in Task 7.1). |
| `frontend/src/modules/Media/shell/Dock.jsx` | Search dominant; Reset moves to SettingsMenu; AppNav added; status cluster (FleetIndicator, CastTargetChip, MiniPlayer, DispatchProgressTray) is right-aligned. |
| `frontend/src/modules/Media/shell/MiniPlayer.jsx` | Add Stop button; tidy idle state. |
| `frontend/src/modules/Media/shell/Canvas.jsx` | Wire AppNav; no other behavioral change. |
| `frontend/src/modules/Media/shell/NowPlayingView.jsx` | Hand-off uses `DispatchTargetPicker`. |
| `frontend/src/modules/Media/browse/HomeView.jsx` | Restructure into Resume → Recents → Curated browse. |
| `frontend/src/modules/Media/session/LocalSessionAdapter.js` | On `transport.stop()` and on item-end, push to recents. |
| `frontend/src/Apps/MediaApp.scss` | Hierarchy tweaks (search width, AppNav rail, ResultRow expand styles, DispatchTargetPicker styles). |

**Files to be deleted:**

| Path | Reason |
|---|---|
| `frontend/src/modules/Media/LiveStream/` (entire folder) | Zero imports outside the folder. Requirements explicitly excludes LiveStream admin from this app. |

---

## Test Strategy

| Layer | Tool | What it covers |
|---|---|---|
| Pure logic (state derivation, parsers, persistence helpers) | Jest (existing harness) | `searchStates.js`, `contentIdParser.js`, `recents.js`. Fast, no DOM. |
| Component behavior | React Testing Library via `*.test.jsx` (existing harness) | `DispatchTargetPicker`, `ResultRow`, `MiniPlayer` with Stop, `HomeView` with recents. |
| End-to-end flows | Playwright in `tests/live/flow/media/` | Each user-visible flow shipped. Real backend, real APIs. |
| Visual design | Playwright screenshot capture + manual + frontend-design subagent critique | A dedicated screenshots test produces baseline images; review applies critique iteratively (Phase 10). |

All Playwright tests use the dev server on the port from `tests/_lib/configHelper.mjs`. Run all with `npx playwright test tests/live/flow/media/ --reporter=line` from the project root.

**No "vacuously true" passes.** Per CLAUDE.md test discipline: every test must either pass or fail. If a precondition (e.g., Plex API down) fails, the test fails with a clear message — it does not silently skip.

---

## Phase 1 — Foundation and cleanup (low risk)

Removes dead code and the debug button cluttering the dock. Establishes a clean baseline.

### Task 1.1 — Delete LiveStream/ module

**Why:** Zero imports outside the folder; requirements `Out of Scope` explicitly excludes livestream admin from MediaApp.

**Files:**
- Delete: `frontend/src/modules/Media/LiveStream/` (recursive)

- [ ] **Step 1: Verify no external imports**

Run:
```bash
grep -rn "modules/Media/LiveStream\|from '../LiveStream\|from './LiveStream" \
  /opt/Code/DaylightStation/frontend/src/ \
  --include='*.jsx' --include='*.js'
```
Expected: no output. If anything matches, STOP and report — investigate the dependency before deleting.

- [ ] **Step 2: Delete the folder**

Run:
```bash
rm -rf /opt/Code/DaylightStation/frontend/src/modules/Media/LiveStream
```

- [ ] **Step 3: Verify build still passes**

Run:
```bash
cd /opt/Code/DaylightStation && npm run dev > /tmp/dev-build.log 2>&1 &
sleep 8
grep -i "error\|fail" /tmp/dev-build.log | head -20
```
Expected: no compilation errors related to LiveStream. Kill the dev server (`pkill -f 'node backend/index.js'`) once verified.

- [ ] **Step 4: Commit**

```bash
cd /opt/Code/DaylightStation && git add -A frontend/src/modules/Media/LiveStream && \
  git commit -m "chore(media): remove dead LiveStream module

Zero imports outside the folder. Requirements explicitly excludes
livestream channel admin from MediaApp."
```

---

### Task 1.2 — Create SettingsMenu and move Reset Session out of the Dock

**Why:** Reset Session is a debug-grade action sitting front-and-centre in production UI. It belongs behind an overflow.

**Files:**
- Create: `frontend/src/modules/Media/shell/SettingsMenu.jsx`
- Create: `frontend/src/modules/Media/shell/SettingsMenu.test.jsx`
- Modify: `frontend/src/modules/Media/shell/Dock.jsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Media/shell/SettingsMenu.test.jsx`:

```jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsMenu } from './SettingsMenu.jsx';

const onResetSession = jest.fn();

describe('SettingsMenu', () => {
  beforeEach(() => { onResetSession.mockClear(); });

  test('renders the trigger button', () => {
    render(<SettingsMenu onResetSession={onResetSession} />);
    expect(screen.getByTestId('settings-menu-trigger')).toBeInTheDocument();
  });

  test('opens the menu when trigger clicked', () => {
    render(<SettingsMenu onResetSession={onResetSession} />);
    fireEvent.click(screen.getByTestId('settings-menu-trigger'));
    expect(screen.getByTestId('settings-menu-panel')).toBeInTheDocument();
    expect(screen.getByTestId('settings-reset-session')).toBeInTheDocument();
  });

  test('calls onResetSession when the reset item is clicked', () => {
    render(<SettingsMenu onResetSession={onResetSession} />);
    fireEvent.click(screen.getByTestId('settings-menu-trigger'));
    fireEvent.click(screen.getByTestId('settings-reset-session'));
    expect(onResetSession).toHaveBeenCalledTimes(1);
  });

  test('closes the menu after an item is clicked', () => {
    render(<SettingsMenu onResetSession={onResetSession} />);
    fireEvent.click(screen.getByTestId('settings-menu-trigger'));
    fireEvent.click(screen.getByTestId('settings-reset-session'));
    expect(screen.queryByTestId('settings-menu-panel')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from project root:
```bash
npx jest frontend/src/modules/Media/shell/SettingsMenu.test.jsx
```
Expected: FAIL with "Cannot find module './SettingsMenu.jsx'".

- [ ] **Step 3: Write the implementation**

Create `frontend/src/modules/Media/shell/SettingsMenu.jsx`:

```jsx
import React, { useState, useCallback, useRef } from 'react';
import { useDismissable } from '../../../hooks/useDismissable.js';

export function SettingsMenu({ onResetSession }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  const close = useCallback(() => setOpen(false), []);
  useDismissable(rootRef, { open, onDismiss: close });

  const onReset = () => {
    close();
    onResetSession?.();
  };

  return (
    <div data-testid="settings-menu-root" ref={rootRef} className="settings-menu-root">
      <button
        data-testid="settings-menu-trigger"
        className="settings-menu-trigger"
        aria-label="Settings"
        onClick={() => setOpen((v) => !v)}
      >
        ⚙
      </button>
      {open && (
        <div data-testid="settings-menu-panel" className="settings-menu-panel">
          <button
            data-testid="settings-reset-session"
            className="settings-menu-item"
            onClick={onReset}
          >
            Reset session
          </button>
        </div>
      )}
    </div>
  );
}

export default SettingsMenu;
```

- [ ] **Step 4: Verify the test passes**

Run:
```bash
npx jest frontend/src/modules/Media/shell/SettingsMenu.test.jsx
```
Expected: PASS, 4 tests.

- [ ] **Step 5: Wire SettingsMenu into the Dock and remove the inline Reset button**

Replace `frontend/src/modules/Media/shell/Dock.jsx` with:

```jsx
import React, { useState, useCallback } from 'react';
import { MiniPlayer } from './MiniPlayer.jsx';
import { useSessionController } from '../session/useSessionController.js';
import { SearchBar } from '../search/SearchBar.jsx';
import { FleetIndicator } from './FleetIndicator.jsx';
import { CastTargetChip } from '../cast/CastTargetChip.jsx';
import { DispatchProgressTray } from '../cast/DispatchProgressTray.jsx';
import { ConfirmDialog } from './ConfirmDialog.jsx';
import { SettingsMenu } from './SettingsMenu.jsx';

export function Dock() {
  const { lifecycle } = useSessionController('local');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const doReset = useCallback(() => {
    setConfirmOpen(false);
    lifecycle.reset();
  }, [lifecycle]);

  return (
    <div data-testid="media-dock">
      <SearchBar />
      <div className="dock-status-cluster">
        <FleetIndicator />
        <CastTargetChip />
        <MiniPlayer />
      </div>
      <SettingsMenu onResetSession={() => setConfirmOpen(true)} />
      <DispatchProgressTray />
      <ConfirmDialog
        open={confirmOpen}
        title="Reset local session?"
        message="This clears the current queue and playback position. This cannot be undone."
        confirmLabel="Reset"
        cancelLabel="Cancel"
        onConfirm={doReset}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

export default Dock;
```

- [ ] **Step 6: Add minimal styles for SettingsMenu and dock cluster**

Append to `frontend/src/Apps/MediaApp.scss` (anywhere after the existing `[data-testid="media-dock"]` block):

```scss
.media-app .dock-status-cluster {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.media-app .settings-menu-root {
  position: relative;
  display: inline-flex;
}
.media-app .settings-menu-trigger {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  color: var(--fg-2);
  background: var(--bg-card);
  border: 1px solid var(--border-mid);
  border-radius: var(--r);
  transition: all 120ms ease;

  &:hover { color: var(--fg); background: var(--bg-hover); border-color: rgba(255, 255, 255, 0.2); }
}
.media-app .settings-menu-panel {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 50;
  min-width: 200px;
  padding: 6px;
  background: var(--bg-panel);
  border: 1px solid var(--border-mid);
  border-radius: var(--r);
  box-shadow: 0 12px 32px -10px rgba(0, 0, 0, 0.7);
}
.media-app .settings-menu-item {
  display: block;
  width: 100%;
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  color: var(--fg);
  background: transparent;
  border: none;
  border-radius: var(--r-sm);
  transition: background 100ms ease, color 100ms ease;

  &:hover { background: var(--bg-hover); color: var(--brand); }
}

/* Remove the now-defunct inline Reset button selector (kept until verified) */
.media-app [data-testid="session-reset-btn"] { display: none; }
```

Note: the `display: none` for `session-reset-btn` is a safety belt in case any test still selects it; we'll fully remove the rule in Phase 7 after all tests are migrated.

- [ ] **Step 7: Update tests that reference the old Reset button**

Run:
```bash
grep -rn 'session-reset-btn' /opt/Code/DaylightStation --include='*.jsx' --include='*.mjs' --include='*.js' | grep -v node_modules
```
For each match: update the selector to `[data-testid="settings-menu-trigger"]` then `[data-testid="settings-reset-session"]`. Example for `tests/live/flow/media/media-app-reset-confirm.runtime.test.mjs`:

```js
// Before:
await page.getByTestId('session-reset-btn').click();
// After:
await page.getByTestId('settings-menu-trigger').click();
await page.getByTestId('settings-reset-session').click();
```

- [ ] **Step 8: Run the existing Dock test to verify it still passes**

Run:
```bash
npx jest frontend/src/modules/Media/shell/MediaAppShell.test.jsx
```
Expected: PASS. If any expectation references `session-reset-btn`, update it the same way as Step 7.

- [ ] **Step 9: Commit**

```bash
cd /opt/Code/DaylightStation && \
  git add frontend/src/modules/Media/shell/SettingsMenu.jsx \
          frontend/src/modules/Media/shell/SettingsMenu.test.jsx \
          frontend/src/modules/Media/shell/Dock.jsx \
          frontend/src/Apps/MediaApp.scss \
          tests/live/flow/media/media-app-reset-confirm.runtime.test.mjs && \
  git commit -m "feat(media): move Reset Session into overflow SettingsMenu

The dock should not feature a destructive debug action as a peer of
search. Reset moves behind a gear icon."
```

---

## Phase 2 — Search resilience (states + deep-link)

Today search has one visible state ("Searching…") and silent failure for everything else. This phase splits four states cleanly and adds deep-link content-ID input recognition.

### Task 2.1 — Add `error` to `useStreamingSearch` return

**Files:**
- Modify: `frontend/src/hooks/useStreamingSearch.js`
- Modify: `frontend/src/hooks/useStreamingSearch.test.js` (if exists) — verify; otherwise create

- [ ] **Step 1: Locate existing tests**

Run:
```bash
ls /opt/Code/DaylightStation/frontend/src/hooks/useStreamingSearch.test* 2>/dev/null
```
If a test file exists, open it and check current behavior. If not, write a new one.

- [ ] **Step 2: Write the failing test**

Append to (or create) `frontend/src/hooks/useStreamingSearch.test.js`:

```js
import { renderHook, act } from '@testing-library/react';
import { useStreamingSearch } from './useStreamingSearch.js';

class MockEventSource {
  static last = null;
  constructor(url) {
    this.url = url;
    this.readyState = 1;
    MockEventSource.last = this;
  }
  close() { this.readyState = 2; }
  triggerError() { this.onerror?.(); }
  triggerMessage(data) { this.onmessage?.({ data: JSON.stringify(data) }); }
}

beforeEach(() => {
  global.EventSource = MockEventSource;
  MockEventSource.last = null;
});

test('exposes error state on connection error', () => {
  const { result } = renderHook(() => useStreamingSearch('/api/v1/content/query/search/stream'));
  act(() => { result.current.search('hello'); });
  act(() => { MockEventSource.last.triggerError(); });
  expect(result.current.error).toMatchObject({ kind: 'connection' });
  expect(result.current.isSearching).toBe(false);
});

test('exposes error state on stream error event', () => {
  const { result } = renderHook(() => useStreamingSearch('/api/v1/content/query/search/stream'));
  act(() => { result.current.search('hello'); });
  act(() => {
    MockEventSource.last.triggerMessage({ event: 'error', message: 'adapter blew up' });
  });
  expect(result.current.error).toMatchObject({ kind: 'stream', message: 'adapter blew up' });
});

test('clears error on a fresh search', () => {
  const { result } = renderHook(() => useStreamingSearch('/api/v1/content/query/search/stream'));
  act(() => { result.current.search('hello'); });
  act(() => { MockEventSource.last.triggerError(); });
  expect(result.current.error).not.toBeNull();
  act(() => { result.current.search('world'); });
  expect(result.current.error).toBeNull();
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run:
```bash
npx jest frontend/src/hooks/useStreamingSearch.test.js
```
Expected: FAIL — `result.current.error` is undefined.

- [ ] **Step 4: Implement the change**

Edit `frontend/src/hooks/useStreamingSearch.js`:

1. Add `error` state at the top of the hook:

```js
const [error, setError] = useState(null);
```

2. Inside `search`, reset error at the start:

```js
setError(null);
```

3. In the `onmessage` handler, when `data.event === 'error'`:

```js
} else if (data.event === 'error') {
  logger().warn('search.error', { query, error: data.message });
  setError({ kind: 'stream', message: data.message ?? 'Search adapter reported an error.' });
  setIsSearching(false);
  setPending([]);
  eventSource.close();
}
```

4. In `onerror`:

```js
eventSource.onerror = () => {
  logger().warn('search.connection-error', { endpoint });
  if (eventSourceRef.current === eventSource) {
    setError({ kind: 'connection', message: 'Lost connection to the search service.' });
    setIsSearching(false);
    setPending([]);
  }
  eventSource.close();
};
```

5. Return `error` in the result object:

```js
return { results, pending, isSearching, error, search };
```

- [ ] **Step 5: Verify the test passes**

```bash
npx jest frontend/src/hooks/useStreamingSearch.test.js
```
Expected: PASS, all error tests + any pre-existing tests still green.

- [ ] **Step 6: Forward `error` through `useLiveSearch`**

Edit `frontend/src/modules/Media/search/useLiveSearch.js`:

```js
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
    error: inner.error,
    setQuery,
    retry: inner.search,
  };
}

export default useLiveSearch;
```

- [ ] **Step 7: Verify any existing useLiveSearch tests**

```bash
npx jest frontend/src/modules/Media/search/useLiveSearch.test.jsx
```
Expected: PASS. If a test asserts the returned object shape, ensure the new keys (`error`, `retry`) don't break it.

- [ ] **Step 8: Commit**

```bash
cd /opt/Code/DaylightStation && \
  git add frontend/src/hooks/useStreamingSearch.js \
          frontend/src/hooks/useStreamingSearch.test.js \
          frontend/src/modules/Media/search/useLiveSearch.js && \
  git commit -m "feat(media): surface search errors from streaming hook

Streaming search now exposes \`error\` for both connection failures
and stream-error events, so the UI can render distinct empty / error
states instead of silently going blank."
```

---

### Task 2.2 — Pure helpers: `searchStates.js` and `contentIdParser.js`

**Files:**
- Create: `frontend/src/modules/Media/search/searchStates.js`
- Create: `frontend/src/modules/Media/search/searchStates.test.js`
- Create: `frontend/src/modules/Media/search/contentIdParser.js`
- Create: `frontend/src/modules/Media/search/contentIdParser.test.js`

- [ ] **Step 1: Write `searchStates` tests**

Create `frontend/src/modules/Media/search/searchStates.test.js`:

```js
import { deriveSearchState } from './searchStates.js';

test('idle when query is empty', () => {
  expect(deriveSearchState({ query: '', isSearching: false, results: [], error: null }))
    .toEqual({ kind: 'idle' });
});

test('idle when query is shorter than 2 chars', () => {
  expect(deriveSearchState({ query: 'a', isSearching: false, results: [], error: null }))
    .toEqual({ kind: 'idle' });
});

test('searching when isSearching and no results yet', () => {
  expect(deriveSearchState({ query: 'hi', isSearching: true, results: [], error: null }))
    .toEqual({ kind: 'searching' });
});

test('results when results are present, even if still searching', () => {
  const results = [{ id: 'plex:1', title: 'X' }];
  expect(deriveSearchState({ query: 'hi', isSearching: true, results, error: null }))
    .toEqual({ kind: 'results', results });
});

test('error overrides empty', () => {
  const error = { kind: 'connection', message: 'down' };
  expect(deriveSearchState({ query: 'hi', isSearching: false, results: [], error }))
    .toEqual({ kind: 'error', error });
});

test('empty when finished, no results, no error', () => {
  expect(deriveSearchState({ query: 'no-match', isSearching: false, results: [], error: null }))
    .toEqual({ kind: 'empty', query: 'no-match' });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
npx jest frontend/src/modules/Media/search/searchStates.test.js
```
Expected: FAIL (`Cannot find module './searchStates.js'`).

- [ ] **Step 3: Implement `searchStates.js`**

Create `frontend/src/modules/Media/search/searchStates.js`:

```js
export const SEARCH_STATE = Object.freeze({
  IDLE: 'idle',
  SEARCHING: 'searching',
  RESULTS: 'results',
  EMPTY: 'empty',
  ERROR: 'error',
});

export function deriveSearchState({ query, isSearching, results, error }) {
  const q = (query ?? '').trim();
  if (q.length < 2) return { kind: SEARCH_STATE.IDLE };
  if (Array.isArray(results) && results.length > 0) return { kind: SEARCH_STATE.RESULTS, results };
  if (error) return { kind: SEARCH_STATE.ERROR, error };
  if (isSearching) return { kind: SEARCH_STATE.SEARCHING };
  return { kind: SEARCH_STATE.EMPTY, query: q };
}
```

- [ ] **Step 4: Verify**

```bash
npx jest frontend/src/modules/Media/search/searchStates.test.js
```
Expected: PASS, 6 tests.

- [ ] **Step 5: Write `contentIdParser` tests**

Create `frontend/src/modules/Media/search/contentIdParser.test.js`:

```js
import { parseContentId } from './contentIdParser.js';

test('parses plex-main:12345', () => {
  expect(parseContentId('plex-main:12345')).toEqual({ source: 'plex-main', localId: '12345' });
});

test('parses singalong:198', () => {
  expect(parseContentId('singalong:198')).toEqual({ source: 'singalong', localId: '198' });
});

test('parses sources with sub-paths', () => {
  expect(parseContentId('app:webcam/front-door')).toEqual({
    source: 'app',
    localId: 'webcam/front-door',
  });
});

test('trims whitespace around the input', () => {
  expect(parseContentId('  plex:1  ')).toEqual({ source: 'plex', localId: '1' });
});

test('returns null for free-text', () => {
  expect(parseContentId('lonesome')).toBeNull();
});

test('returns null when the source token is empty', () => {
  expect(parseContentId(':12345')).toBeNull();
});

test('returns null when the localId is empty', () => {
  expect(parseContentId('plex:')).toBeNull();
});

test('returns null for non-string input', () => {
  expect(parseContentId(null)).toBeNull();
  expect(parseContentId(undefined)).toBeNull();
  expect(parseContentId(123)).toBeNull();
});
```

- [ ] **Step 6: Implement `contentIdParser.js`**

Create `frontend/src/modules/Media/search/contentIdParser.js`:

```js
const CONTENT_ID_RE = /^([a-z][a-z0-9-]*):(.+)$/i;

export function parseContentId(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  const match = trimmed.match(CONTENT_ID_RE);
  if (!match) return null;
  const [, source, localId] = match;
  if (!source || !localId) return null;
  return { source, localId };
}

export default parseContentId;
```

- [ ] **Step 7: Verify**

```bash
npx jest frontend/src/modules/Media/search/contentIdParser.test.js
```
Expected: PASS, 8 tests.

- [ ] **Step 8: Commit**

```bash
cd /opt/Code/DaylightStation && \
  git add frontend/src/modules/Media/search/searchStates.js \
          frontend/src/modules/Media/search/searchStates.test.js \
          frontend/src/modules/Media/search/contentIdParser.js \
          frontend/src/modules/Media/search/contentIdParser.test.js && \
  git commit -m "feat(media): pure helpers for search-state derivation and content-ID parsing"
```

---

### Task 2.3 — State components: Idle / Empty / Error

**Files:**
- Create: `frontend/src/modules/Media/search/SearchIdleState.jsx`
- Create: `frontend/src/modules/Media/search/SearchEmptyState.jsx`
- Create: `frontend/src/modules/Media/search/SearchErrorState.jsx`
- Create: `frontend/src/modules/Media/search/SearchStates.test.jsx` (covers all three)

- [ ] **Step 1: Write tests**

Create `frontend/src/modules/Media/search/SearchStates.test.jsx`:

```jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SearchIdleState } from './SearchIdleState.jsx';
import { SearchEmptyState } from './SearchEmptyState.jsx';
import { SearchErrorState } from './SearchErrorState.jsx';

describe('SearchIdleState', () => {
  test('shows the start-typing prompt when no input', () => {
    render(<SearchIdleState input="" />);
    expect(screen.getByTestId('search-idle-prompt')).toBeInTheDocument();
  });
  test('shows deep-link affordance when input looks like a content ID', () => {
    const onAction = jest.fn();
    render(<SearchIdleState input="plex-main:42" onDeepLink={onAction} />);
    const btn = screen.getByTestId('search-deeplink-play');
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onAction).toHaveBeenCalledWith({ source: 'plex-main', localId: '42' });
  });
  test('does not show deep-link when input is free-text', () => {
    render(<SearchIdleState input="hello world" />);
    expect(screen.queryByTestId('search-deeplink-play')).not.toBeInTheDocument();
  });
});

describe('SearchEmptyState', () => {
  test('echoes the query and shows zero-results message', () => {
    render(<SearchEmptyState query="nonsense" />);
    expect(screen.getByTestId('search-empty')).toHaveTextContent('nonsense');
  });
});

describe('SearchErrorState', () => {
  test('renders the error message and a retry button', () => {
    const onRetry = jest.fn();
    render(<SearchErrorState error={{ kind: 'connection', message: 'lost it' }} onRetry={onRetry} />);
    expect(screen.getByTestId('search-error')).toHaveTextContent('lost it');
    fireEvent.click(screen.getByTestId('search-retry'));
    expect(onRetry).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Verify failing**

```bash
npx jest frontend/src/modules/Media/search/SearchStates.test.jsx
```
Expected: FAIL (missing modules).

- [ ] **Step 3: Implement `SearchIdleState.jsx`**

```jsx
import React from 'react';
import { parseContentId } from './contentIdParser.js';

export function SearchIdleState({ input, onDeepLink }) {
  const parsed = parseContentId(input);
  return (
    <div data-testid="search-idle" className="search-state search-state--idle">
      {parsed ? (
        <>
          <div data-testid="search-deeplink-suggestion" className="search-deeplink-suggestion">
            Looks like a content ID: <code>{parsed.source}:{parsed.localId}</code>
          </div>
          <button
            data-testid="search-deeplink-play"
            className="search-deeplink-btn"
            onClick={() => onDeepLink?.(parsed)}
          >
            Play this ID
          </button>
        </>
      ) : (
        <div data-testid="search-idle-prompt" className="search-idle-prompt">
          Start typing to search the catalog.
        </div>
      )}
    </div>
  );
}

export default SearchIdleState;
```

- [ ] **Step 4: Implement `SearchEmptyState.jsx`**

```jsx
import React from 'react';

export function SearchEmptyState({ query }) {
  return (
    <div data-testid="search-empty" className="search-state search-state--empty">
      No results for "{query}". Try a different word or change the scope.
    </div>
  );
}

export default SearchEmptyState;
```

- [ ] **Step 5: Implement `SearchErrorState.jsx`**

```jsx
import React from 'react';

export function SearchErrorState({ error, onRetry }) {
  const message = error?.message ?? 'Search failed.';
  return (
    <div data-testid="search-error" className="search-state search-state--error">
      <span className="search-error-message">{message}</span>
      <button data-testid="search-retry" className="search-retry-btn" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

export default SearchErrorState;
```

- [ ] **Step 6: Verify all tests pass**

```bash
npx jest frontend/src/modules/Media/search/SearchStates.test.jsx
```
Expected: PASS, 5 tests.

- [ ] **Step 7: Add styles**

Append to `frontend/src/Apps/MediaApp.scss`:

```scss
.media-app .search-state {
  padding: 14px 16px;
  font-size: 13px;
  color: var(--fg-2);
}
.media-app .search-state--idle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}
.media-app .search-idle-prompt { color: var(--fg-3); }
.media-app .search-deeplink-suggestion {
  color: var(--fg-2);
  code {
    color: var(--brand);
    font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
  }
}
.media-app .search-deeplink-btn,
.media-app .search-retry-btn {
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 600;
  color: var(--brand-ink);
  background: var(--brand);
  border: 1px solid var(--brand);
  border-radius: var(--r-sm);

  &:hover { background: var(--brand-hot); border-color: var(--brand-hot); }
}
.media-app .search-state--empty {
  color: var(--fg-3);
}
.media-app .search-state--error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  color: var(--danger);
  background: rgba(227, 93, 93, 0.06);
  border-left: 3px solid var(--danger);
}
```

- [ ] **Step 8: Commit**

```bash
cd /opt/Code/DaylightStation && \
  git add frontend/src/modules/Media/search/SearchIdleState.jsx \
          frontend/src/modules/Media/search/SearchEmptyState.jsx \
          frontend/src/modules/Media/search/SearchErrorState.jsx \
          frontend/src/modules/Media/search/SearchStates.test.jsx \
          frontend/src/Apps/MediaApp.scss && \
  git commit -m "feat(media): explicit Idle/Empty/Error states for search

Each state has its own component with a clear message, and the idle
state offers a Play This ID affordance when the input parses as a
content ID."
```

---

### Task 2.4 — Wire the four states into `SearchBar` / `SearchResults`

**Files:**
- Modify: `frontend/src/modules/Media/search/SearchBar.jsx`
- Modify: `frontend/src/modules/Media/search/SearchResults.jsx`
- Modify: `frontend/src/modules/Media/search/SearchResults.test.jsx` (or extend)

- [ ] **Step 1: Update SearchBar to pass through new state**

Replace `frontend/src/modules/Media/search/SearchBar.jsx`:

```jsx
import React, { useState, useRef, useCallback } from 'react';
import { useLiveSearch } from './useLiveSearch.js';
import { useSearchContext } from './SearchProvider.jsx';
import { SearchResults } from './SearchResults.jsx';
import { SearchIdleState } from './SearchIdleState.jsx';
import { SearchEmptyState } from './SearchEmptyState.jsx';
import { SearchErrorState } from './SearchErrorState.jsx';
import { deriveSearchState, SEARCH_STATE } from './searchStates.js';
import { useDismissable } from '../../../hooks/useDismissable.js';
import { useSessionController } from '../session/useSessionController.js';

export function SearchBar() {
  const { scopes, currentScopeKey, currentScope, setScopeKey } = useSearchContext();
  const { results, pending, isSearching, error, setQuery, retry } = useLiveSearch({
    scopeParams: currentScope?.params ?? '',
  });
  const { queue } = useSessionController('local');
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const rootRef = useRef(null);

  const isOpen = focused || value.length >= 1;

  const close = useCallback(() => {
    setValue('');
    setFocused(false);
    setQuery('');
  }, [setQuery]);

  useDismissable(rootRef, { open: isOpen, onDismiss: close });

  const onChange = (e) => {
    const next = e.target.value;
    setValue(next);
    setQuery(next);
  };

  const onDeepLink = ({ source, localId }) => {
    const contentId = `${source}:${localId}`;
    queue.playNow({ contentId }, { clearRest: true });
    close();
  };

  const state = deriveSearchState({
    query: value,
    isSearching,
    results,
    error,
  });

  return (
    <div
      data-testid="media-search-bar"
      className="media-search-bar"
      ref={rootRef}
      onFocus={() => setFocused(true)}
    >
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
        placeholder="Search media — title, artist, or paste a content ID (plex-main:12345)"
      />
      {isOpen && (
        <div data-testid="search-overlay" className="media-search-overlay">
          {state.kind === SEARCH_STATE.IDLE && (
            <SearchIdleState input={value} onDeepLink={onDeepLink} />
          )}
          {state.kind === SEARCH_STATE.SEARCHING && (
            <div data-testid="search-loading" className="search-state search-state--loading">
              Searching{pending.length > 0 ? ` (${pending.join(', ')})` : ''}…
            </div>
          )}
          {state.kind === SEARCH_STATE.RESULTS && (
            <SearchResults results={state.results} pending={pending} onAction={close} />
          )}
          {state.kind === SEARCH_STATE.EMPTY && <SearchEmptyState query={state.query} />}
          {state.kind === SEARCH_STATE.ERROR && (
            <SearchErrorState error={state.error} onRetry={() => retry(value)} />
          )}
        </div>
      )}
    </div>
  );
}

export default SearchBar;
```

- [ ] **Step 2: Update SearchResults — remove the empty-state branches, since the parent handles them**

Replace `frontend/src/modules/Media/search/SearchResults.jsx` body (keep imports, replace from `export function SearchResults` onward) — note: `ResultRow` import is from a file created in Phase 3. For now, inline the row JSX from existing `SearchResults.jsx` and we'll refactor in Phase 3:

```jsx
import React from 'react';
import { useSessionController } from '../session/useSessionController.js';
import { useNav } from '../shell/NavProvider.jsx';
import { resultToQueueInput } from './resultToQueueInput.js';
import { CastButton } from '../cast/CastButton.jsx';

function thumbnailSrc(row) {
  if (row.thumbnail && typeof row.thumbnail === 'string' && row.thumbnail.length > 0) return row.thumbnail;
  const id = row.id ?? row.itemId;
  if (!id) return null;
  const [source, ...rest] = String(id).split(':');
  if (!source || rest.length === 0) return null;
  const localId = rest.join(':');
  return `/api/v1/display/${encodeURIComponent(source)}/${localId}`;
}

export function SearchResults({ results = [], pending = [], onAction }) {
  const { queue } = useSessionController('local');
  const { push } = useNav();

  const handle = (row, action) => (e) => {
    e.stopPropagation();
    const input = resultToQueueInput(row);
    if (!input) return;
    if (action === 'playNow') queue.playNow(input, { clearRest: true });
    else if (action === 'add') queue.add(input);
    else if (action === 'playNext') queue.playNext(input);
    else if (action === 'addUpNext') queue.addUpNext(input);
    onAction?.();
  };

  return (
    <ul data-testid="media-search-results" className="media-search-results">
      {results.map((row) => {
        const id = row.id ?? row.itemId;
        if (!id) return null;
        const thumb = thumbnailSrc(row);
        return (
          <li key={id} data-testid={`result-row-${id}`}>
            {thumb && (
              <img className="media-result-thumb" src={thumb} alt="" loading="lazy"
                   onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
            )}
            <button
              data-testid={`result-open-${id}`}
              onClick={() => { onAction?.(); push('detail', { contentId: id }); }}
              className="media-result-title"
            >
              {row.title ?? id}
            </button>
            <span className="media-result-actions">
              <button data-testid={`result-play-now-${id}`} onClick={handle(row, 'playNow')}>Play Now</button>
              <button data-testid={`result-play-next-${id}`} onClick={handle(row, 'playNext')}>Play Next</button>
              <button data-testid={`result-upnext-${id}`} onClick={handle(row, 'addUpNext')}>Up Next</button>
              <button data-testid={`result-add-${id}`} onClick={handle(row, 'add')}>Add</button>
              <CastButton contentId={id} onAction={onAction} />
            </span>
          </li>
        );
      })}
      {pending.length > 0 && (
        <li data-testid="media-search-pending">Loading {pending.join(', ')}…</li>
      )}
    </ul>
  );
}

export default SearchResults;
```

- [ ] **Step 3: Run the search-related component tests**

```bash
npx jest frontend/src/modules/Media/search/
```
Expected: PASS. Update any test that asserted on the old "Searching…" `div` text by switching to `getByTestId('search-loading')`.

- [ ] **Step 4: Add style for the new overlay container**

Append to `frontend/src/Apps/MediaApp.scss`:

```scss
.media-app .media-search-overlay {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 50;
  max-height: 60vh;
  overflow-y: auto;
  background: var(--bg-panel);
  border: 1px solid var(--border-mid);
  border-radius: var(--r);
  box-shadow: 0 16px 40px -12px rgba(0, 0, 0, 0.7);
}
.media-app .search-state--loading {
  color: var(--fg-3);
}
```

- [ ] **Step 5: Manual smoke check**

Run the dev server (`npm run dev` or background `node backend/index.js`). Open the app. Type `a` → idle prompt should still be there or transition to searching (depending on backend response time). Type `xyznonsense12345` → after the stream completes, the empty state should appear. Disconnect the backend (kill it) and type something → error state should appear.

If anything is unexpected, fix before committing.

- [ ] **Step 6: Commit**

```bash
cd /opt/Code/DaylightStation && \
  git add frontend/src/modules/Media/search/SearchBar.jsx \
          frontend/src/modules/Media/search/SearchResults.jsx \
          frontend/src/Apps/MediaApp.scss && \
  git commit -m "feat(media): wire idle/searching/empty/error states into SearchBar

Search overlay now distinguishes the four states. Idle state shows a
deep-link affordance when input parses as a content ID. Errors offer
retry."
```

---

## Phase 3 — Stop + idle polish + Result row peek

### Task 3.1 — Stop button in MiniPlayer

**Files:**
- Modify: `frontend/src/modules/Media/shell/MiniPlayer.jsx`
- Modify: `frontend/src/modules/Media/shell/MiniPlayer.test.jsx` (or create)

- [ ] **Step 1: Write the failing test**

Create or extend `frontend/src/modules/Media/shell/MiniPlayer.test.jsx`:

```jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MiniPlayer } from './MiniPlayer.jsx';
import { LocalSessionContext } from '../session/LocalSessionContext.js';
import { NavProvider } from './NavProvider.jsx';

function makeAdapter(state, item) {
  const stopMock = jest.fn();
  const playMock = jest.fn();
  const pauseMock = jest.fn();
  return {
    stopMock, playMock, pauseMock,
    adapter: {
      getSnapshot: () => ({
        state,
        currentItem: item,
        position: 0,
        queue: { items: [], currentIndex: -1, upNextCount: 0 },
        config: {},
        meta: { updatedAt: '', ownerId: 'test' },
      }),
      subscribe: () => () => {},
      transport: { play: playMock, pause: pauseMock, stop: stopMock, skipNext: () => {}, skipPrev: () => {} },
      queue: {}, config: {}, lifecycle: {}, portability: {},
    },
  };
}

function renderMiniPlayer({ state, item }) {
  const harness = makeAdapter(state, item);
  render(
    <LocalSessionContext.Provider value={{ adapter: harness.adapter }}>
      <NavProvider><MiniPlayer /></NavProvider>
    </LocalSessionContext.Provider>,
  );
  return harness;
}

describe('MiniPlayer', () => {
  test('idle when no current item', () => {
    renderMiniPlayer({ state: 'idle', item: null });
    expect(screen.getByTestId('media-mini-player')).toHaveTextContent(/idle/i);
    expect(screen.queryByTestId('mini-stop')).not.toBeInTheDocument();
  });

  test('shows title, pause toggle, and stop when playing', () => {
    const item = { contentId: 'plex:1', title: 'Cosmos' };
    renderMiniPlayer({ state: 'playing', item });
    expect(screen.getByTestId('mini-player-open-nowplaying')).toHaveTextContent('Cosmos');
    expect(screen.getByTestId('mini-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('mini-stop')).toBeInTheDocument();
  });

  test('Stop calls transport.stop()', () => {
    const item = { contentId: 'plex:1', title: 'Cosmos' };
    const { stopMock } = renderMiniPlayer({ state: 'playing', item });
    fireEvent.click(screen.getByTestId('mini-stop'));
    expect(stopMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Verify failing**

```bash
npx jest frontend/src/modules/Media/shell/MiniPlayer.test.jsx
```
Expected: FAIL — `mini-stop` not found.

- [ ] **Step 3: Update `MiniPlayer.jsx`**

Replace `frontend/src/modules/Media/shell/MiniPlayer.jsx`:

```jsx
import React from 'react';
import { useSessionController } from '../session/useSessionController.js';
import { useNav } from './NavProvider.jsx';

const PLAYING_STATES = new Set(['playing', 'buffering']);

export function MiniPlayer() {
  const { snapshot, transport } = useSessionController('local');
  const { push } = useNav();
  const item = snapshot.currentItem;
  if (!item) return <div data-testid="media-mini-player">Idle</div>;

  const isPlaying = PLAYING_STATES.has(snapshot.state);
  const toggleLabel = isPlaying ? 'Pause' : 'Play';
  const onToggle = () => {
    if (isPlaying) transport.pause();
    else transport.play();
  };
  const onStop = () => transport.stop();

  return (
    <div data-testid="media-mini-player">
      <button
        data-testid="mini-player-open-nowplaying"
        onClick={() => push('nowPlaying', {})}
      >
        {item.title ?? item.contentId}
      </button>
      <button
        data-testid="mini-toggle"
        aria-label={toggleLabel}
        onClick={onToggle}
        className={`media-mini-player__toggle media-mini-player__toggle--${isPlaying ? 'playing' : 'paused'}`}
      >
        {isPlaying ? '❚❚' : '▶'}
      </button>
      <button
        data-testid="mini-stop"
        aria-label="Stop"
        onClick={onStop}
        className="media-mini-player__stop"
        title="Stop and clear current item"
      >
        ■
      </button>
    </div>
  );
}

export default MiniPlayer;
```

- [ ] **Step 4: Verify all MiniPlayer tests pass**

```bash
npx jest frontend/src/modules/Media/shell/MiniPlayer.test.jsx
```
Expected: PASS, 3 tests.

- [ ] **Step 5: Add styling**

Append to `frontend/src/Apps/MediaApp.scss` (inside the existing `[data-testid='media-mini-player']` block, or just add a new sibling rule):

```scss
.media-app [data-testid='media-mini-player'] .media-mini-player__stop {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-card);
  border: 1px solid var(--border-mid);
  border-radius: var(--r);
  color: var(--fg);
  font-size: 12px;
  transition: all 100ms ease;

  &:hover {
    color: #fff;
    background: var(--danger);
    border-color: var(--danger);
  }
}
```

- [ ] **Step 6: Commit**

```bash
cd /opt/Code/DaylightStation && \
  git add frontend/src/modules/Media/shell/MiniPlayer.jsx \
          frontend/src/modules/Media/shell/MiniPlayer.test.jsx \
          frontend/src/Apps/MediaApp.scss && \
  git commit -m "feat(media): add Stop control to MiniPlayer

Stop calls transport.stop() (which resets the session and halts the
hidden player). Closes the "Bluey playing in background, can't kill
it" failure mode."
```

---

## Phase 4 — Unified `DispatchTargetPicker`

This phase introduces the picker component used both by per-result Cast buttons (Task 4.2) and by NowPlayingView hand-off (Task 4.3).

### Task 4.0 — Prep: export `FleetContext` and `DispatchContext` as named exports

The new tests in this phase wrap components in raw context Providers. The two files below currently keep their Context private. Export them so tests can supply mock values without standing up the full providers.

**Files:**
- Modify: `frontend/src/modules/Media/fleet/FleetProvider.jsx`
- Modify: `frontend/src/modules/Media/cast/DispatchProvider.jsx`

- [ ] **Step 1: Inspect each file**

```bash
grep -n "createContext" /opt/Code/DaylightStation/frontend/src/modules/Media/fleet/FleetProvider.jsx
grep -n "createContext" /opt/Code/DaylightStation/frontend/src/modules/Media/cast/DispatchProvider.jsx
```
Each file has a `const FleetContext = createContext(...)` (or equivalent) at top scope.

- [ ] **Step 2: Add `export` to each declaration**

In `frontend/src/modules/Media/fleet/FleetProvider.jsx`, change:
```js
const FleetContext = createContext(null);
```
to:
```js
export const FleetContext = createContext(null);
```

In `frontend/src/modules/Media/cast/DispatchProvider.jsx`, change:
```js
const DispatchContext = createContext(null);
```
to:
```js
export const DispatchContext = createContext(null);
```

- [ ] **Step 3: Verify**

```bash
grep -n "export const FleetContext\|export const DispatchContext" \
  /opt/Code/DaylightStation/frontend/src/modules/Media/fleet/FleetProvider.jsx \
  /opt/Code/DaylightStation/frontend/src/modules/Media/cast/DispatchProvider.jsx
```
Expected: one match in each file.

- [ ] **Step 4: Run any existing tests for these files to confirm no regression**

```bash
npx jest frontend/src/modules/Media/fleet/FleetProvider.test.jsx \
         frontend/src/modules/Media/cast/DispatchProvider.test.jsx 2>/dev/null
```
Expected: PASS (or the same status they had before). The change is purely additive.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation && \
  git add frontend/src/modules/Media/fleet/FleetProvider.jsx \
          frontend/src/modules/Media/cast/DispatchProvider.jsx && \
  git commit -m "refactor(media): export FleetContext and DispatchContext

Enables component tests to inject mock context values without
constructing the full providers."
```

---

### Task 4.1 — Build `DispatchTargetPicker` and its hook

**Files:**
- Create: `frontend/src/modules/Media/cast/useDispatchTargetPicker.js`
- Create: `frontend/src/modules/Media/cast/DispatchTargetPicker.jsx`
- Create: `frontend/src/modules/Media/cast/DispatchTargetPicker.test.jsx`

- [ ] **Step 1: Write the test**

Create `frontend/src/modules/Media/cast/DispatchTargetPicker.test.jsx`:

```jsx
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { DispatchTargetPicker } from './DispatchTargetPicker.jsx';
import { FleetContext } from '../fleet/FleetProvider.jsx';
import { DispatchContext } from './DispatchProvider.jsx';
import { CastTargetContext } from './CastTargetProvider.jsx';

const devices = {
  'living-tv': { id: 'living-tv', name: 'Living Room TV', location: 'living_room' },
  'office-tv': { id: 'office-tv', name: 'Office TV', location: 'office' },
};

function renderPicker({ source = { play: 'plex:42' }, defaults = { targetIds: [], mode: 'transfer' }, dispatchMock = jest.fn() } = {}) {
  return {
    dispatchMock,
    ...render(
      <FleetContext.Provider value={{ devices, byDevice: new Map(), loading: false, error: null, refresh: () => {} }}>
        <CastTargetContext.Provider value={{ ...defaults, setMode: () => {}, toggleTarget: () => {}, clearTargets: () => {} }}>
          <DispatchContext.Provider value={{ dispatches: {}, dispatchToTarget: dispatchMock, retryLast: () => {} }}>
            <DispatchTargetPicker source={source} onComplete={() => {}} />
          </DispatchContext.Provider>
        </CastTargetContext.Provider>
      </FleetContext.Provider>,
    ),
  };
}

describe('DispatchTargetPicker', () => {
  test('lists every device from the fleet', () => {
    renderPicker();
    expect(screen.getByTestId('picker-device-living-tv')).toBeInTheDocument();
    expect(screen.getByTestId('picker-device-office-tv')).toBeInTheDocument();
  });

  test('cast is disabled until a device is selected', () => {
    renderPicker();
    expect(screen.getByTestId('picker-submit')).toBeDisabled();
    fireEvent.click(screen.getByTestId('picker-device-living-tv'));
    expect(screen.getByTestId('picker-submit')).not.toBeDisabled();
  });

  test('submits dispatch with selected target ids and chosen mode', () => {
    const { dispatchMock } = renderPicker({ source: { play: 'plex:42' } });
    fireEvent.click(screen.getByTestId('picker-device-living-tv'));
    fireEvent.click(screen.getByTestId('picker-mode-fork'));
    fireEvent.click(screen.getByTestId('picker-submit'));
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      targetIds: ['living-tv'],
      mode: 'fork',
      play: 'plex:42',
    }));
  });

  test('default mode is transfer', () => {
    const { dispatchMock } = renderPicker();
    fireEvent.click(screen.getByTestId('picker-device-living-tv'));
    fireEvent.click(screen.getByTestId('picker-submit'));
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({ mode: 'transfer' }));
  });

  test('respects defaults from CastTargetContext as initial selection', () => {
    renderPicker({ defaults: { targetIds: ['office-tv'], mode: 'fork' } });
    const officeCheckbox = within(screen.getByTestId('picker-device-office-tv')).getByRole('checkbox');
    expect(officeCheckbox).toBeChecked();
    const forkRadio = screen.getByTestId('picker-mode-fork').querySelector('input');
    expect(forkRadio).toBeChecked();
  });

  test('supports a queue source (handoff snapshot)', () => {
    const snapshot = { sessionId: 'abc', currentItem: { contentId: 'plex:7' }, position: 12, queue: {}, config: {}, state: 'paused', meta: {} };
    const { dispatchMock } = renderPicker({ source: { snapshot } });
    fireEvent.click(screen.getByTestId('picker-device-living-tv'));
    fireEvent.click(screen.getByTestId('picker-submit'));
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      snapshot,
      targetIds: ['living-tv'],
    }));
  });
});
```

- [ ] **Step 2: Verify failing**

```bash
npx jest frontend/src/modules/Media/cast/DispatchTargetPicker.test.jsx
```
Expected: FAIL — missing module.

- [ ] **Step 3: Implement `useDispatchTargetPicker.js`**

Create `frontend/src/modules/Media/cast/useDispatchTargetPicker.js`:

```js
import { useCallback, useState } from 'react';
import { useFleetContext } from '../fleet/FleetProvider.jsx';
import { useDispatch } from './DispatchProvider.jsx';
import { useCastTarget } from './useCastTarget.js';

export function useDispatchTargetPicker({ source, onComplete } = {}) {
  const fleet = useFleetContext();
  const { dispatchToTarget } = useDispatch();
  const { targetIds: defaultTargets, mode: defaultMode } = useCastTarget();
  const [selected, setSelected] = useState(() => new Set(defaultTargets));
  const [mode, setMode] = useState(defaultMode);

  const devices = Object.values(fleet.devices ?? {});

  const toggle = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const canSubmit = selected.size > 0;

  const submit = useCallback(() => {
    if (!canSubmit) return;
    const targetIds = Array.from(selected);
    const params = { targetIds, mode };
    if (source?.play) params.play = source.play;
    if (source?.queue) params.queue = source.queue;
    if (source?.snapshot) params.snapshot = source.snapshot;
    dispatchToTarget(params);
    onComplete?.({ targetIds, mode });
  }, [canSubmit, selected, mode, source, dispatchToTarget, onComplete]);

  return {
    devices,
    selected,
    mode,
    canSubmit,
    toggle,
    setMode,
    submit,
  };
}

export default useDispatchTargetPicker;
```

- [ ] **Step 4: Implement `DispatchTargetPicker.jsx`**

Create `frontend/src/modules/Media/cast/DispatchTargetPicker.jsx`:

```jsx
import React from 'react';
import { useDispatchTargetPicker } from './useDispatchTargetPicker.js';

export function DispatchTargetPicker({ source, onComplete, autoFocus = true, submitLabel = 'Cast' }) {
  const { devices, selected, mode, canSubmit, toggle, setMode, submit } = useDispatchTargetPicker({ source, onComplete });

  return (
    <div data-testid="dispatch-target-picker" className="dispatch-target-picker">
      <div className="picker-section picker-section--devices">
        <div className="picker-section-label">Target device</div>
        {devices.length === 0 && (
          <div data-testid="picker-no-devices" className="picker-empty">No devices configured.</div>
        )}
        {devices.map((d) => (
          <label
            key={d.id}
            data-testid={`picker-device-${d.id}`}
            className={`picker-device ${selected.has(d.id) ? 'picker-device--selected' : ''}`}
            onClick={(e) => { e.preventDefault(); toggle(d.id); }}
          >
            <input
              type="checkbox"
              readOnly
              checked={selected.has(d.id)}
            />
            <span className="picker-device-name">{d.name}</span>
            <span className="picker-device-location">{d.location ?? ''}</span>
          </label>
        ))}
      </div>
      <div className="picker-section picker-section--mode">
        <div className="picker-section-label">Mode</div>
        <label data-testid="picker-mode-transfer" className="picker-mode">
          <input type="radio" name="dispatch-mode" checked={mode === 'transfer'} onChange={() => setMode('transfer')} />
          <span>Transfer (local stops)</span>
        </label>
        <label data-testid="picker-mode-fork" className="picker-mode">
          <input type="radio" name="dispatch-mode" checked={mode === 'fork'} onChange={() => setMode('fork')} />
          <span>Fork (local keeps playing)</span>
        </label>
      </div>
      <button
        data-testid="picker-submit"
        className="picker-submit"
        autoFocus={autoFocus}
        disabled={!canSubmit}
        onClick={submit}
      >
        {submitLabel}
      </button>
    </div>
  );
}

export default DispatchTargetPicker;
```

- [ ] **Step 5: Verify the test passes**

```bash
npx jest frontend/src/modules/Media/cast/DispatchTargetPicker.test.jsx
```
Expected: PASS, 6 tests.

- [ ] **Step 6: Add styles**

Append to `frontend/src/Apps/MediaApp.scss`:

```scss
.media-app .dispatch-target-picker {
  min-width: 260px;
  padding: 12px;
  background: var(--bg-panel);
  border: 1px solid var(--border-mid);
  border-radius: var(--r);
  box-shadow: 0 12px 32px -10px rgba(0, 0, 0, 0.7);
  font-size: 13px;

  .picker-section { padding: 6px 0; }
  .picker-section + .picker-section { border-top: 1px solid var(--border); margin-top: 8px; padding-top: 12px; }
  .picker-section-label {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-3);
    margin-bottom: 8px;
  }
  .picker-device,
  .picker-mode {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    margin-bottom: 2px;
    border-radius: var(--r-sm);
    cursor: pointer;
    transition: background 100ms ease, color 100ms ease;
    color: var(--fg);

    input { accent-color: var(--brand); }

    &:hover { background: var(--bg-hover); }
  }
  .picker-device--selected { background: rgba(229, 160, 13, 0.12); }
  .picker-device-name { font-weight: 500; }
  .picker-device-location {
    margin-left: auto;
    font-size: 11px;
    color: var(--fg-3);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .picker-empty { color: var(--fg-3); padding: 6px 10px; }
  .picker-submit {
    margin-top: 12px;
    width: 100%;
    padding: 9px 14px;
    background: var(--brand);
    color: var(--brand-ink);
    border: 1px solid var(--brand);
    border-radius: var(--r);
    font-weight: 600;
    font-size: 13px;
    transition: background 120ms ease;

    &:hover:not(:disabled) { background: var(--brand-hot); }
    &:disabled { background: var(--bg-active); border-color: var(--bg-active); color: var(--fg-dim); cursor: not-allowed; }
  }
}
```

- [ ] **Step 7: Commit**

```bash
cd /opt/Code/DaylightStation && \
  git add frontend/src/modules/Media/cast/useDispatchTargetPicker.js \
          frontend/src/modules/Media/cast/DispatchTargetPicker.jsx \
          frontend/src/modules/Media/cast/DispatchTargetPicker.test.jsx \
          frontend/src/Apps/MediaApp.scss && \
  git commit -m "feat(media): unified DispatchTargetPicker component

A single inline picker (device checkboxes + transfer/fork mode + Cast
button) used by both result-row cast and NowPlaying hand-off. Reads
defaults from CastTargetContext, dispatches via DispatchProvider."
```

---

### Task 4.2 — Refactor `CastButton` to open `DispatchTargetPicker` inline

**Files:**
- Modify: `frontend/src/modules/Media/cast/CastButton.jsx`
- Modify: existing `CastButton.test.jsx` if present

- [ ] **Step 1: Write the failing test**

Create or extend `frontend/src/modules/Media/cast/CastButton.test.jsx`:

```jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CastButton } from './CastButton.jsx';
import { FleetContext } from '../fleet/FleetProvider.jsx';
import { DispatchContext } from './DispatchProvider.jsx';
import { CastTargetContext } from './CastTargetProvider.jsx';

const devices = { 'living-tv': { id: 'living-tv', name: 'Living Room TV', location: 'living' } };

function harness({ dispatchMock = jest.fn() } = {}) {
  return {
    dispatchMock,
    ...render(
      <FleetContext.Provider value={{ devices, byDevice: new Map(), loading: false, error: null, refresh: () => {} }}>
        <CastTargetContext.Provider value={{ targetIds: [], mode: 'transfer', setMode: () => {}, toggleTarget: () => {}, clearTargets: () => {} }}>
          <DispatchContext.Provider value={{ dispatches: {}, dispatchToTarget: dispatchMock, retryLast: () => {} }}>
            <CastButton contentId="plex:42" />
          </DispatchContext.Provider>
        </CastTargetContext.Provider>
      </FleetContext.Provider>,
    ),
  };
}

describe('CastButton', () => {
  test('is enabled even when CastTargetContext has no targets', () => {
    harness();
    expect(screen.getByTestId('cast-button-plex:42')).not.toBeDisabled();
  });

  test('opens the DispatchTargetPicker on click', () => {
    harness();
    fireEvent.click(screen.getByTestId('cast-button-plex:42'));
    expect(screen.getByTestId('dispatch-target-picker')).toBeInTheDocument();
  });

  test('closes the picker after submit', () => {
    const { dispatchMock } = harness();
    fireEvent.click(screen.getByTestId('cast-button-plex:42'));
    fireEvent.click(screen.getByTestId('picker-device-living-tv'));
    fireEvent.click(screen.getByTestId('picker-submit'));
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({ play: 'plex:42', targetIds: ['living-tv'] }));
    expect(screen.queryByTestId('dispatch-target-picker')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Verify failing**

```bash
npx jest frontend/src/modules/Media/cast/CastButton.test.jsx
```
Expected: FAIL (existing CastButton is disabled w/o targets).

- [ ] **Step 3: Reimplement `CastButton.jsx`**

Replace `frontend/src/modules/Media/cast/CastButton.jsx`:

```jsx
import React, { useState, useRef, useCallback } from 'react';
import { DispatchTargetPicker } from './DispatchTargetPicker.jsx';
import { useDismissable } from '../../../hooks/useDismissable.js';

export function CastButton({ contentId, queue, onAction }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  useDismissable(rootRef, { open, onDismiss: close });

  const id = contentId ?? queue;
  const source = contentId ? { play: contentId } : { queue };

  const onComplete = () => {
    setOpen(false);
    onAction?.();
  };

  return (
    <span data-testid={`cast-button-root-${id}`} className="cast-button-root" ref={rootRef}>
      <button
        data-testid={`cast-button-${id}`}
        className="cast-button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
      >
        Cast
      </button>
      {open && (
        <div className="cast-button-popover">
          <DispatchTargetPicker source={source} onComplete={onComplete} />
        </div>
      )}
    </span>
  );
}

export default CastButton;
```

- [ ] **Step 4: Verify tests pass**

```bash
npx jest frontend/src/modules/Media/cast/CastButton.test.jsx
```
Expected: PASS, 3 tests.

- [ ] **Step 5: Add styles**

Append to `frontend/src/Apps/MediaApp.scss`:

```scss
.media-app .cast-button-root {
  position: relative;
  display: inline-flex;
}
.media-app .cast-button-popover {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 80;
}
```

- [ ] **Step 6: Commit**

```bash
cd /opt/Code/DaylightStation && \
  git add frontend/src/modules/Media/cast/CastButton.jsx \
          frontend/src/modules/Media/cast/CastButton.test.jsx \
          frontend/src/Apps/MediaApp.scss && \
  git commit -m "feat(media): CastButton opens inline DispatchTargetPicker

Removes the pre-select-targets-in-Dock ritual. Each result's Cast
button now opens a popover with device + mode controls and submits
on its own."
```

---

### Task 4.3 — Use `DispatchTargetPicker` in `NowPlayingView` hand-off

**Files:**
- Modify: `frontend/src/modules/Media/shell/NowPlayingView.jsx`

- [ ] **Step 1: Read current `NowPlayingView`**

```bash
sed -n '1,120p' /opt/Code/DaylightStation/frontend/src/modules/Media/shell/NowPlayingView.jsx
```
Identify the hand-off section (it imports `useHandOff` and renders a device-select + transfer/fork radios). Note the current `data-testid` attributes (`handoff-submit`, etc.) so the migration preserves Playwright selectors.

- [ ] **Step 2: Locate the hand-off hook**

```bash
grep -rn "useHandOff\b" /opt/Code/DaylightStation/frontend/src/modules/Media --include='*.js' --include='*.jsx'
```
The hook should accept the local session snapshot and a target. We'll continue using it underneath the picker.

- [ ] **Step 3: Replace the hand-off UI block**

At the top of `NowPlayingView.jsx`, add the import (alongside existing imports):

```jsx
import { DispatchTargetPicker } from '../cast/DispatchTargetPicker.jsx';
```

Locate the existing destructure of the local session — it should already look like:

```jsx
const { snapshot, transport } = useSessionController('local');
```

If `snapshot` isn't already destructured, add it.

Then find the existing hand-off block (the `<select>` device list + transfer/fork `<input type="radio">` controls + the `[data-testid="handoff-submit"]` button) and replace the entire block — including its surrounding container — with:

```jsx
<div className="handoff-section" data-testid="handoff-section">
  <DispatchTargetPicker
    source={{ snapshot }}
    submitLabel="Hand off"
    onComplete={() => { /* non-blocking; let the user navigate naturally */ }}
  />
</div>
```

Remove any now-unused imports (e.g., `useHandOff`) and the local state for `selectedDevice` / `mode` if they are no longer referenced anywhere else in the file. Verify by running `grep -n "useHandOff\|selectedDevice\|handoff-submit" frontend/src/modules/Media/shell/NowPlayingView.jsx` — every match must be a deletion candidate.

- [ ] **Step 4: Update any tests that asserted on the old hand-off radios**

```bash
grep -rn 'handoff-' /opt/Code/DaylightStation/tests --include='*.mjs' --include='*.js' --include='*.jsx'
grep -rn 'handoff-' /opt/Code/DaylightStation/frontend/src/modules/Media --include='*.test.jsx'
```
For each test that selects `handoff-submit` or the radios: update to use the picker's testids — `picker-mode-transfer`, `picker-mode-fork`, `picker-submit`.

- [ ] **Step 5: Run NowPlaying tests**

```bash
npx jest frontend/src/modules/Media/shell/NowPlayingView.test.jsx
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /opt/Code/DaylightStation && \
  git add frontend/src/modules/Media/shell/NowPlayingView.jsx \
          frontend/src/modules/Media/shell/NowPlayingView.test.jsx \
  && git commit -m "refactor(media): NowPlaying uses unified DispatchTargetPicker for hand-off

Removes the duplicate device-select + mode-radios UI in favor of the
component shared with per-result Cast."
```

---

## Phase 5 — Result row peek (inline preview, not a route)

### Task 5.1 — Create `ResultRow.jsx`

**Files:**
- Create: `frontend/src/modules/Media/search/ResultRow.jsx`
- Create: `frontend/src/modules/Media/search/ResultRow.test.jsx`
- Modify: `frontend/src/modules/Media/search/SearchResults.jsx`

- [ ] **Step 1: Write the test**

```jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ResultRow } from './ResultRow.jsx';
import { LocalSessionContext } from '../session/LocalSessionContext.js';
import { NavProvider } from '../shell/NavProvider.jsx';
import { FleetContext } from '../fleet/FleetProvider.jsx';
import { DispatchContext } from '../cast/DispatchProvider.jsx';
import { CastTargetContext } from '../cast/CastTargetProvider.jsx';

const queueMock = {
  playNow: jest.fn(), playNext: jest.fn(), addUpNext: jest.fn(), add: jest.fn(),
};
const adapter = {
  getSnapshot: () => ({ state: 'idle', currentItem: null, position: 0, queue: { items: [], currentIndex: -1, upNextCount: 0 }, config: {}, meta: { updatedAt: '', ownerId: 't' } }),
  subscribe: () => () => {},
  transport: {}, queue: queueMock, config: {}, lifecycle: {}, portability: {},
};
const devices = { 'living-tv': { id: 'living-tv', name: 'Living Room TV', location: 'living' } };

function wrap(children) {
  return (
    <LocalSessionContext.Provider value={{ adapter }}>
      <NavProvider>
        <FleetContext.Provider value={{ devices, byDevice: new Map(), loading: false, error: null, refresh: () => {} }}>
          <CastTargetContext.Provider value={{ targetIds: [], mode: 'transfer', setMode: () => {}, toggleTarget: () => {}, clearTargets: () => {} }}>
            <DispatchContext.Provider value={{ dispatches: {}, dispatchToTarget: jest.fn(), retryLast: () => {} }}>
              {children}
            </DispatchContext.Provider>
          </CastTargetContext.Provider>
        </FleetContext.Provider>
      </NavProvider>
    </LocalSessionContext.Provider>
  );
}

const row = { id: 'plex:7', title: 'Test Show', thumbnail: null };

beforeEach(() => { Object.values(queueMock).forEach((m) => m.mockClear()); });

test('renders title, thumbnail, and primary actions', () => {
  render(wrap(<ResultRow row={row} />));
  expect(screen.getByText('Test Show')).toBeInTheDocument();
  expect(screen.getByTestId('result-play-now-plex:7')).toBeInTheDocument();
  expect(screen.getByTestId('result-add-plex:7')).toBeInTheDocument();
});

test('Play Now calls queue.playNow with clearRest', () => {
  render(wrap(<ResultRow row={row} />));
  fireEvent.click(screen.getByTestId('result-play-now-plex:7'));
  expect(queueMock.playNow).toHaveBeenCalledWith(expect.objectContaining({ contentId: 'plex:7' }), { clearRest: true });
});

test('clicking the title toggles inline peek (does not navigate)', () => {
  render(wrap(<ResultRow row={row} />));
  fireEvent.click(screen.getByTestId('result-open-plex:7'));
  expect(screen.getByTestId('result-peek-plex:7')).toBeInTheDocument();
  // Toggling closes it
  fireEvent.click(screen.getByTestId('result-open-plex:7'));
  expect(screen.queryByTestId('result-peek-plex:7')).not.toBeInTheDocument();
});

test('peek contains the Cast trigger that opens the DispatchTargetPicker', () => {
  render(wrap(<ResultRow row={row} />));
  fireEvent.click(screen.getByTestId('result-open-plex:7'));
  fireEvent.click(screen.getByTestId('cast-button-plex:7'));
  expect(screen.getByTestId('dispatch-target-picker')).toBeInTheDocument();
});
```

- [ ] **Step 2: Verify failing**

```bash
npx jest frontend/src/modules/Media/search/ResultRow.test.jsx
```
Expected: FAIL — missing module.

- [ ] **Step 3: Implement `ResultRow.jsx`**

Create `frontend/src/modules/Media/search/ResultRow.jsx`:

```jsx
import React, { useState } from 'react';
import { useSessionController } from '../session/useSessionController.js';
import { resultToQueueInput } from './resultToQueueInput.js';
import { CastButton } from '../cast/CastButton.jsx';

function thumbnailSrc(row) {
  if (row.thumbnail && typeof row.thumbnail === 'string' && row.thumbnail.length > 0) return row.thumbnail;
  const id = row.id ?? row.itemId;
  if (!id) return null;
  const [source, ...rest] = String(id).split(':');
  if (!source || rest.length === 0) return null;
  const localId = rest.join(':');
  return `/api/v1/display/${encodeURIComponent(source)}/${localId}`;
}

export function ResultRow({ row, onAction }) {
  const { queue } = useSessionController('local');
  const [peekOpen, setPeekOpen] = useState(false);
  const id = row.id ?? row.itemId;
  if (!id) return null;
  const thumb = thumbnailSrc(row);

  const fire = (op) => (e) => {
    e.stopPropagation();
    const input = resultToQueueInput(row);
    if (!input) return;
    if (op === 'playNow') queue.playNow(input, { clearRest: true });
    else if (op === 'playNext') queue.playNext(input);
    else if (op === 'addUpNext') queue.addUpNext(input);
    else if (op === 'add') queue.add(input);
    onAction?.();
  };

  return (
    <li data-testid={`result-row-${id}`} className={`result-row ${peekOpen ? 'result-row--open' : ''}`}>
      <div className="result-row-main">
        {thumb && (
          <img className="media-result-thumb" src={thumb} alt="" loading="lazy"
               onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
        )}
        <button
          data-testid={`result-open-${id}`}
          className="media-result-title"
          onClick={() => setPeekOpen((v) => !v)}
        >
          {row.title ?? id}
        </button>
        <span className="media-result-actions">
          <button data-testid={`result-play-now-${id}`} onClick={fire('playNow')}>Play Now</button>
          <button data-testid={`result-play-next-${id}`} onClick={fire('playNext')}>Play Next</button>
          <button data-testid={`result-upnext-${id}`} onClick={fire('addUpNext')}>Up Next</button>
          <button data-testid={`result-add-${id}`} onClick={fire('add')}>Add</button>
          <CastButton contentId={id} onAction={onAction} />
        </span>
      </div>
      {peekOpen && (
        <div data-testid={`result-peek-${id}`} className="result-peek">
          {thumb && <img className="result-peek-thumb" src={thumb} alt="" />}
          <div className="result-peek-meta">
            <div className="result-peek-title">{row.title ?? id}</div>
            <div className="result-peek-id"><code>{id}</code></div>
            {row.source && <div className="result-peek-source">Source: {row.source}</div>}
            {row.mediaType && <div className="result-peek-mediatype">{row.mediaType}</div>}
            {typeof row.duration === 'number' && (
              <div className="result-peek-duration">{Math.round(row.duration / 60)} min</div>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

export default ResultRow;
```

- [ ] **Step 4: Update `SearchResults.jsx` to delegate to `ResultRow`**

Replace `SearchResults.jsx` body with:

```jsx
import React from 'react';
import { ResultRow } from './ResultRow.jsx';

export function SearchResults({ results = [], pending = [], onAction }) {
  return (
    <ul data-testid="media-search-results" className="media-search-results">
      {results.map((row) => {
        const id = row.id ?? row.itemId;
        if (!id) return null;
        return <ResultRow key={id} row={row} onAction={onAction} />;
      })}
      {pending.length > 0 && (
        <li data-testid="media-search-pending">Loading {pending.join(', ')}…</li>
      )}
    </ul>
  );
}

export default SearchResults;
```

- [ ] **Step 5: Adjust SCSS for the peek panel**

Append to `frontend/src/Apps/MediaApp.scss`:

```scss
.media-app ul.media-search-results > li.result-row {
  display: block;
  padding: 0;
  border-bottom: 1px solid var(--border);

  &:last-child { border-bottom: none; }
}
.media-app .result-row-main {
  display: grid;
  grid-template-columns: 42px 1fr auto;
  align-items: center;
  column-gap: 12px;
  padding: 6px 10px;
  border-radius: var(--r-sm);
  cursor: default;

  &:hover { background: var(--bg-hover); }
}
.media-app .result-row--open .result-row-main { background: var(--bg-hover); }
.media-app .result-peek {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 16px;
  padding: 12px 14px;
  background: rgba(229, 160, 13, 0.04);
  border-top: 1px solid var(--border);
}
.media-app .result-peek-thumb {
  width: 96px;
  aspect-ratio: 2 / 3;
  object-fit: cover;
  border-radius: var(--r-sm);
}
.media-app .result-peek-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--fg-2);

  .result-peek-title { font-size: 16px; font-weight: 600; color: var(--fg); }
  code { color: var(--brand); font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 12px; }
}
```

- [ ] **Step 6: Run all search tests**

```bash
npx jest frontend/src/modules/Media/search/
```
Expected: PASS. If `SearchResults.test.jsx` asserted on the old inline thumbnail/title structure, the test now sees the same testids via `ResultRow` and should still pass.

- [ ] **Step 7: Commit**

```bash
cd /opt/Code/DaylightStation && \
  git add frontend/src/modules/Media/search/ResultRow.jsx \
          frontend/src/modules/Media/search/ResultRow.test.jsx \
          frontend/src/modules/Media/search/SearchResults.jsx \
          frontend/src/Apps/MediaApp.scss && \
  git commit -m "feat(media): result row with inline peek expansion

Clicking a title now toggles an inline preview in place rather than
navigating away from search. Cast button inside a result opens the
unified target picker."
```

---

## Phase 6 — Home: Resume + Recents + Curated

### Task 6.1 — `recents.js` persistence helper

**Files:**
- Create: `frontend/src/modules/Media/session/recents.js`
- Create: `frontend/src/modules/Media/session/recents.test.js`

- [ ] **Step 1: Write the test**

```js
import { recordRecent, readRecents, RECENTS_KEY, MAX_RECENTS } from './recents.js';

beforeEach(() => { localStorage.clear(); });

test('readRecents returns empty array initially', () => {
  expect(readRecents()).toEqual([]);
});

test('recordRecent stores at the front', () => {
  recordRecent({ contentId: 'plex:1', title: 'A', thumbnail: null });
  recordRecent({ contentId: 'plex:2', title: 'B', thumbnail: null });
  expect(readRecents().map((r) => r.contentId)).toEqual(['plex:2', 'plex:1']);
});

test('re-recording an existing item moves it to the front, no duplicates', () => {
  recordRecent({ contentId: 'plex:1', title: 'A', thumbnail: null });
  recordRecent({ contentId: 'plex:2', title: 'B', thumbnail: null });
  recordRecent({ contentId: 'plex:1', title: 'A', thumbnail: null });
  expect(readRecents().map((r) => r.contentId)).toEqual(['plex:1', 'plex:2']);
});

test('caps at MAX_RECENTS', () => {
  for (let i = 0; i < MAX_RECENTS + 5; i += 1) {
    recordRecent({ contentId: `plex:${i}`, title: String(i), thumbnail: null });
  }
  expect(readRecents()).toHaveLength(MAX_RECENTS);
});

test('ignores items without a contentId', () => {
  recordRecent({ title: 'no id' });
  expect(readRecents()).toEqual([]);
});

test('survives corrupted storage', () => {
  localStorage.setItem(RECENTS_KEY, 'not-json');
  expect(readRecents()).toEqual([]);
});
```

- [ ] **Step 2: Verify failing**

```bash
npx jest frontend/src/modules/Media/session/recents.test.js
```
Expected: FAIL (missing module).

- [ ] **Step 3: Implement**

Create `frontend/src/modules/Media/session/recents.js`:

```js
export const RECENTS_KEY = 'media-app.recents';
export const MAX_RECENTS = 20;

function safeRead() {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeWrite(items) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(items));
  } catch { /* quota: drop silently */ }
}

export function readRecents() {
  return safeRead();
}

export function recordRecent(item) {
  if (!item || typeof item.contentId !== 'string' || item.contentId.length === 0) return;
  const next = [{
    contentId: item.contentId,
    title: item.title ?? null,
    thumbnail: item.thumbnail ?? null,
    format: item.format ?? null,
    recordedAt: new Date().toISOString(),
  }];
  for (const r of safeRead()) {
    if (r.contentId !== item.contentId) next.push(r);
    if (next.length >= MAX_RECENTS) break;
  }
  safeWrite(next);
}
```

- [ ] **Step 4: Verify**

```bash
npx jest frontend/src/modules/Media/session/recents.test.js
```
Expected: PASS, 6 tests.

- [ ] **Step 5: Wire `recordRecent` into `LocalSessionAdapter`**

Open `frontend/src/modules/Media/session/LocalSessionAdapter.js` and find the `_dispatch` method (line ~91). After a state change to `playing`, record the current item to recents. Add at the top:

```js
import { recordRecent } from './recents.js';
```

Inside `_dispatch`, after the existing line `this._snapshot = next;`:

```js
if (next.state === 'playing' && prev.state !== 'playing' && next.currentItem) {
  recordRecent({
    contentId: next.currentItem.contentId,
    title: next.currentItem.title,
    thumbnail: next.currentItem.thumbnail,
    format: next.currentItem.format,
  });
}
```

- [ ] **Step 6: Run the adapter tests**

```bash
npx jest frontend/src/modules/Media/session/LocalSessionAdapter.test.js
```
Expected: PASS. If a test breaks because `recordRecent` writes to localStorage, ensure tests clear localStorage in `beforeEach`.

- [ ] **Step 7: Commit**

```bash
cd /opt/Code/DaylightStation && \
  git add frontend/src/modules/Media/session/recents.js \
          frontend/src/modules/Media/session/recents.test.js \
          frontend/src/modules/Media/session/LocalSessionAdapter.js && \
  git commit -m "feat(media): persist last 20 played items as recents

Recents are stored in localStorage and updated by LocalSessionAdapter
on every play transition. Feeds the new Home view."
```

---

### Task 6.2 — `ResumeCard` and `RecentsRow`

**Files:**
- Create: `frontend/src/modules/Media/browse/ResumeCard.jsx`
- Create: `frontend/src/modules/Media/browse/RecentsRow.jsx`
- Create: `frontend/src/modules/Media/browse/HomeWidgets.test.jsx`

- [ ] **Step 1: Write the test**

```jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ResumeCard } from './ResumeCard.jsx';
import { RecentsRow } from './RecentsRow.jsx';
import { LocalSessionContext } from '../session/LocalSessionContext.js';
import { recordRecent } from '../session/recents.js';
import { NavProvider } from '../shell/NavProvider.jsx';

const queueMock = { playNow: jest.fn(), playNext: jest.fn(), add: jest.fn(), addUpNext: jest.fn() };
const transportMock = { play: jest.fn(), pause: jest.fn(), stop: jest.fn(), seekAbs: jest.fn(), seekRel: jest.fn(), skipNext: jest.fn(), skipPrev: jest.fn() };

function wrap(children, snapshot) {
  const adapter = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    transport: transportMock, queue: queueMock, config: {}, lifecycle: {}, portability: {},
  };
  return (
    <LocalSessionContext.Provider value={{ adapter }}>
      <NavProvider>{children}</NavProvider>
    </LocalSessionContext.Provider>
  );
}

const pausedSnapshot = {
  state: 'paused',
  position: 320,
  currentItem: { contentId: 'plex:42', title: 'Cosmos', thumbnail: null, duration: 3600 },
  queue: { items: [], currentIndex: -1, upNextCount: 0 },
  config: {},
  meta: { updatedAt: '', ownerId: 't' },
};

beforeEach(() => {
  Object.values(queueMock).forEach((m) => m.mockClear());
  Object.values(transportMock).forEach((m) => m.mockClear());
  localStorage.clear();
});

test('ResumeCard is rendered only when a current item exists in non-idle state', () => {
  const { rerender } = render(wrap(<ResumeCard />, { ...pausedSnapshot, currentItem: null, state: 'idle' }));
  expect(screen.queryByTestId('resume-card')).not.toBeInTheDocument();
  rerender(wrap(<ResumeCard />, pausedSnapshot));
  expect(screen.getByTestId('resume-card')).toHaveTextContent('Cosmos');
});

test('ResumeCard resume button calls transport.play', () => {
  render(wrap(<ResumeCard />, pausedSnapshot));
  fireEvent.click(screen.getByTestId('resume-play'));
  expect(transportMock.play).toHaveBeenCalledTimes(1);
});

test('RecentsRow renders recorded items', () => {
  recordRecent({ contentId: 'plex:1', title: 'A', thumbnail: null });
  recordRecent({ contentId: 'plex:2', title: 'B', thumbnail: null });
  render(wrap(<RecentsRow />, { ...pausedSnapshot, currentItem: null, state: 'idle' }));
  expect(screen.getByTestId('recents-row')).toBeInTheDocument();
  expect(screen.getByTestId('recent-plex:1')).toHaveTextContent('A');
  expect(screen.getByTestId('recent-plex:2')).toHaveTextContent('B');
});

test('RecentsRow clicking a recent calls queue.playNow', () => {
  recordRecent({ contentId: 'plex:1', title: 'A', thumbnail: null });
  render(wrap(<RecentsRow />, { ...pausedSnapshot, currentItem: null, state: 'idle' }));
  fireEvent.click(screen.getByTestId('recent-plex:1'));
  expect(queueMock.playNow).toHaveBeenCalledWith(expect.objectContaining({ contentId: 'plex:1' }), { clearRest: true });
});

test('RecentsRow is hidden when there are no recents', () => {
  render(wrap(<RecentsRow />, { ...pausedSnapshot, currentItem: null, state: 'idle' }));
  expect(screen.queryByTestId('recents-row')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Verify failing**

```bash
npx jest frontend/src/modules/Media/browse/HomeWidgets.test.jsx
```
Expected: FAIL.

- [ ] **Step 3: Implement `ResumeCard.jsx`**

```jsx
import React from 'react';
import { useSessionController } from '../session/useSessionController.js';

function formatTime(seconds) {
  const m = Math.floor((seconds ?? 0) / 60);
  const s = Math.floor((seconds ?? 0) % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function ResumeCard() {
  const { snapshot, transport } = useSessionController('local');
  const item = snapshot?.currentItem;
  if (!item) return null;
  if (snapshot.state === 'idle') return null;

  return (
    <div data-testid="resume-card" className="resume-card">
      <div className="resume-card-label">Resume</div>
      <div className="resume-card-title">{item.title ?? item.contentId}</div>
      <div className="resume-card-position">at {formatTime(snapshot.position)}</div>
      <button
        data-testid="resume-play"
        className="resume-card-btn"
        onClick={() => transport.play?.()}
      >
        ▶ Resume
      </button>
    </div>
  );
}

export default ResumeCard;
```

- [ ] **Step 4: Implement `RecentsRow.jsx`**

```jsx
import React, { useEffect, useState } from 'react';
import { useSessionController } from '../session/useSessionController.js';
import { readRecents } from '../session/recents.js';

export function RecentsRow() {
  const { queue } = useSessionController('local');
  const [items, setItems] = useState(() => readRecents());

  useEffect(() => {
    function onStorage(e) {
      if (e.key === 'media-app.recents') setItems(readRecents());
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  if (items.length === 0) return null;

  return (
    <section data-testid="recents-row" className="recents-row">
      <h2 className="recents-row-title">Recently played</h2>
      <div className="recents-row-items">
        {items.map((it) => (
          <button
            key={it.contentId}
            data-testid={`recent-${it.contentId}`}
            className="recent-card"
            onClick={() => queue.playNow({ contentId: it.contentId, title: it.title, thumbnail: it.thumbnail, format: it.format }, { clearRest: true })}
            title={it.title ?? it.contentId}
          >
            {it.thumbnail && <img src={it.thumbnail} alt="" loading="lazy" className="recent-card-thumb" />}
            <span className="recent-card-title">{it.title ?? it.contentId}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export default RecentsRow;
```

- [ ] **Step 5: Verify tests pass**

```bash
npx jest frontend/src/modules/Media/browse/HomeWidgets.test.jsx
```
Expected: PASS, 5 tests.

- [ ] **Step 6: Add styles**

Append to `frontend/src/Apps/MediaApp.scss`:

```scss
.media-app .resume-card {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-areas: 'label   btn' 'title   btn' 'position btn';
  column-gap: 16px;
  align-items: center;
  padding: 18px 22px;
  background: linear-gradient(135deg, rgba(229, 160, 13, 0.16), rgba(229, 160, 13, 0.04));
  border: 1px solid rgba(229, 160, 13, 0.32);
  border-radius: var(--r);
  margin-bottom: 24px;
}
.media-app .resume-card-label { grid-area: label; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--brand); }
.media-app .resume-card-title { grid-area: title; font-size: 20px; font-weight: 600; color: var(--fg); }
.media-app .resume-card-position { grid-area: position; font-size: 12px; color: var(--fg-2); }
.media-app .resume-card-btn {
  grid-area: btn;
  padding: 12px 26px;
  background: var(--brand);
  color: var(--brand-ink);
  font-weight: 600;
  font-size: 14px;
  border: none;
  border-radius: var(--r);
  &:hover { background: var(--brand-hot); }
}

.media-app .recents-row {
  margin-bottom: 32px;

  .recents-row-title {
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-3);
    margin-bottom: 12px;
  }
  .recents-row-items {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 160px;
    gap: 10px;
    overflow-x: auto;
    padding-bottom: 6px;
  }
  .recent-card {
    display: flex;
    flex-direction: column;
    background: var(--bg-card);
    border: 1px solid var(--border-mid);
    border-radius: var(--r);
    overflow: hidden;
    text-align: left;
    transition: border-color 120ms ease, transform 120ms ease;

    &:hover { border-color: var(--brand); transform: translateY(-2px); }
  }
  .recent-card-thumb {
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    background: var(--bg-active);
  }
  .recent-card-title {
    padding: 8px 10px;
    font-size: 13px;
    font-weight: 500;
    color: var(--fg);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}
```

- [ ] **Step 7: Commit**

```bash
cd /opt/Code/DaylightStation && \
  git add frontend/src/modules/Media/browse/ResumeCard.jsx \
          frontend/src/modules/Media/browse/RecentsRow.jsx \
          frontend/src/modules/Media/browse/HomeWidgets.test.jsx \
          frontend/src/Apps/MediaApp.scss && \
  git commit -m "feat(media): ResumeCard and RecentsRow for Home view"
```

---

### Task 6.3 — Restructure `HomeView.jsx`

**Files:**
- Modify: `frontend/src/modules/Media/browse/HomeView.jsx`
- Modify: `frontend/src/modules/Media/browse/HomeView.test.jsx`

- [ ] **Step 1: Update the test**

Open `frontend/src/modules/Media/browse/HomeView.test.jsx` and add (in addition to any existing tests):

```jsx
test('renders ResumeCard, RecentsRow, and curated browse cards in order', async () => {
  // Mock fetch for /api/v1/media/config — provide a couple of browse entries
  global.fetch = jest.fn().mockResolvedValue({
    json: async () => ({ browse: [{ label: 'Movies', source: 'plex', mediaType: 'video' }] }),
    ok: true,
  });

  render(<HomeView />);

  expect(await screen.findByTestId('home-view')).toBeInTheDocument();
  // Order: resume (may be hidden), recents (may be hidden), then browse
  expect(screen.queryByTestId('resume-card')).toBeFalsy(); // no active session in test
  expect(screen.queryByTestId('recents-row')).toBeFalsy(); // no recents stored
  expect(screen.getByTestId('home-card-plex-video')).toBeInTheDocument();
});
```

- [ ] **Step 2: Replace `HomeView.jsx`**

```jsx
import React, { useState, useEffect } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { useNav } from '../shell/NavProvider.jsx';
import { ResumeCard } from './ResumeCard.jsx';
import { RecentsRow } from './RecentsRow.jsx';

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
      <ResumeCard />
      <RecentsRow />
      <section className="home-curated">
        <h2 className="home-curated-title">Browse the catalog</h2>
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
      </section>
    </div>
  );
}

export default HomeView;
```

- [ ] **Step 3: Run tests**

```bash
npx jest frontend/src/modules/Media/browse/HomeView.test.jsx
```
Expected: PASS.

- [ ] **Step 4: Style the curated section heading**

Append to `frontend/src/Apps/MediaApp.scss`:

```scss
.media-app .home-curated-title {
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--fg-3);
  margin-bottom: 12px;
}
```

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation && \
  git add frontend/src/modules/Media/browse/HomeView.jsx \
          frontend/src/modules/Media/browse/HomeView.test.jsx \
          frontend/src/Apps/MediaApp.scss && \
  git commit -m "feat(media): Home view shows Resume + Recents + curated browse

Curated source-browse cards are demoted below resume and recents.
Curated section gets its own subhead."
```

---

## Phase 7 — Dock hierarchy and minor app nav

### Task 7.1 — Adjust dock layout for hierarchy

**Files:**
- Modify: `frontend/src/Apps/MediaApp.scss`

- [ ] **Step 1: Update the dock styles to make Search prominent**

In `MediaApp.scss`, find the existing `[data-testid="media-dock"]` block and replace its body with:

```scss
.media-app [data-testid="media-dock"] {
  position: sticky;
  top: 0;
  z-index: 40;
  display: grid;
  grid-template-columns: minmax(280px, 640px) 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 10px 20px;
  background: rgba(10, 11, 13, 0.92);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border-mid);
}

.media-app .media-search-bar { max-width: none; width: 100%; }
.media-app .dock-status-cluster {
  justify-self: end;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
```

- [ ] **Step 2: Manual visual check**

`npm run dev`, open the app. Search should occupy the visual centre and span most of the dock width. The status cluster (Fleet indicator + Cast chip + MiniPlayer) and the gear should be right-aligned and tight.

- [ ] **Step 3: Commit**

```bash
cd /opt/Code/DaylightStation && git add frontend/src/Apps/MediaApp.scss && \
  git commit -m "style(media): dock grid layout — search dominant, status right-aligned"
```

---

### Task 7.2 — Lightweight `AppNav` rail

A small left-aligned vertical rail that lets users reach Home / Devices / Browse from any view. Avoids burying these in the dock.

**Files:**
- Create: `frontend/src/modules/Media/shell/AppNav.jsx`
- Modify: `frontend/src/modules/Media/shell/MediaAppShell.jsx`

- [ ] **Step 1: Implement `AppNav.jsx`**

```jsx
import React from 'react';
import { useNav } from './NavProvider.jsx';

const ITEMS = [
  { view: 'home', label: 'Home', icon: '⌂' },
  { view: 'fleet', label: 'Devices', icon: '◧' },
  { view: 'browse', label: 'Browse', icon: '☷', params: { path: '' } },
];

export function AppNav() {
  const { view, push } = useNav();
  return (
    <nav data-testid="app-nav" className="app-nav" aria-label="Primary">
      {ITEMS.map((it) => (
        <button
          key={it.view}
          data-testid={`app-nav-${it.view}`}
          className={`app-nav-item ${view === it.view ? 'app-nav-item--active' : ''}`}
          onClick={() => push(it.view, it.params ?? {})}
          aria-current={view === it.view ? 'page' : undefined}
        >
          <span className="app-nav-icon" aria-hidden="true">{it.icon}</span>
          <span className="app-nav-label">{it.label}</span>
        </button>
      ))}
    </nav>
  );
}

export default AppNav;
```

- [ ] **Step 2: Wire `AppNav` into the shell**

Replace `frontend/src/modules/Media/shell/MediaAppShell.jsx`:

```jsx
import React from 'react';
import { Dock } from './Dock.jsx';
import { Canvas } from './Canvas.jsx';
import { AppNav } from './AppNav.jsx';
import { NavProvider } from './NavProvider.jsx';

export function MediaAppShell() {
  return (
    <NavProvider>
      <div className="media-app-shell">
        <Dock />
        <div className="media-app-body">
          <AppNav />
          <Canvas />
        </div>
      </div>
    </NavProvider>
  );
}

export default MediaAppShell;
```

- [ ] **Step 3: Add styles**

Append to `frontend/src/Apps/MediaApp.scss`:

```scss
.media-app .media-app-body {
  display: grid;
  grid-template-columns: 64px 1fr;
  gap: 0;
  min-height: 100vh;
}
.media-app .app-nav {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  padding: 14px 6px;
  background: rgba(10, 11, 13, 0.7);
  border-right: 1px solid var(--border);
}
.media-app .app-nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 6px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--fg-3);
  background: transparent;
  border: none;
  border-radius: var(--r);
  transition: background 120ms ease, color 120ms ease;

  &:hover { background: var(--bg-hover); color: var(--fg); }

  .app-nav-icon { font-size: 18px; color: inherit; }
}
.media-app .app-nav-item--active {
  background: rgba(229, 160, 13, 0.12);
  color: var(--brand);
  .app-nav-icon { color: var(--brand); }
}

@media (max-width: 780px) {
  .media-app .media-app-body { grid-template-columns: 1fr; }
  .media-app .app-nav {
    flex-direction: row;
    justify-content: center;
    border-right: none;
    border-bottom: 1px solid var(--border);
    padding: 8px;
  }
  .media-app .app-nav-item { flex-direction: row; gap: 6px; padding: 8px 12px; }
}
```

- [ ] **Step 4: Update tests for `MediaAppShell`**

```bash
npx jest frontend/src/modules/Media/shell/MediaAppShell.test.jsx
```
Update any assertion that expected a flat `<div>` directly under shell — the new layout has `.media-app-body` between Dock and Canvas.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation && \
  git add frontend/src/modules/Media/shell/AppNav.jsx \
          frontend/src/modules/Media/shell/MediaAppShell.jsx \
          frontend/src/modules/Media/shell/MediaAppShell.test.jsx \
          frontend/src/Apps/MediaApp.scss && \
  git commit -m "feat(media): left-rail AppNav for Home / Devices / Browse"
```

---

## Phase 8 — End-to-end Playwright tests

Add new flow tests for every user-visible behavior the audit identified. Existing tests (`media-app-discovery`, `media-app-cast`, etc.) should still pass — we'll update them as needed when running them.

### Task 8.1 — Stop flow

**Files:**
- Create: `tests/live/flow/media/media-app-stop-flow.runtime.test.mjs`

- [ ] **Step 1: Write the test**

```js
import { test, expect } from '@playwright/test';

test.describe('MediaApp — Stop flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/media');
    await page.evaluate(() => localStorage.clear());
  });

  test('Stop returns the session to idle', async ({ page }) => {
    await page.goto('/media');
    await page.getByTestId('media-search-input').fill('lonesome');
    const firstRow = page.locator('[data-testid^="result-row-"]').first();
    await expect(firstRow).toBeVisible({ timeout: 15000 });
    const id = (await firstRow.getAttribute('data-testid')).replace(/^result-row-/, '');
    await page.getByTestId(`result-play-now-${id}`).click();
    await expect(page.getByTestId('mini-toggle')).toBeVisible({ timeout: 8000 });

    // Stop
    await page.getByTestId('mini-stop').click();

    // MiniPlayer back to idle
    await expect(page.getByTestId('media-mini-player')).toHaveText(/idle/i);
  });
});
```

- [ ] **Step 2: Run**

```bash
npx playwright test tests/live/flow/media/media-app-stop-flow.runtime.test.mjs --reporter=line
```
Expected: PASS. If `lonesome` returns no Plex results in your environment, swap to a query you know returns results (check `data/household/config/media.yml` scopes).

- [ ] **Step 3: Commit**

```bash
cd /opt/Code/DaylightStation && \
  git add tests/live/flow/media/media-app-stop-flow.runtime.test.mjs && \
  git commit -m "test(media): e2e Stop flow"
```

---

### Task 8.2 — Inline cast flow

**Files:**
- Create: `tests/live/flow/media/media-app-inline-cast.runtime.test.mjs`

- [ ] **Step 1: Write the test**

```js
import { test, expect } from '@playwright/test';

test.describe('MediaApp — inline cast from a result row', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/media');
    await page.evaluate(() => localStorage.clear());
  });

  test('opens DispatchTargetPicker inline and dispatches with selected target', async ({ page }) => {
    // Stub the dispatch endpoint so the test does not actually wake a TV.
    await page.route('**/api/v1/device/*/load*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, dispatchId: 'test-disp-1', steps: [], totalElapsedMs: 12 }),
      });
    });

    await page.goto('/media');
    await page.getByTestId('media-search-input').fill('lonesome');
    const firstRow = page.locator('[data-testid^="result-row-"]').first();
    await expect(firstRow).toBeVisible({ timeout: 15000 });
    const id = (await firstRow.getAttribute('data-testid')).replace(/^result-row-/, '');

    // Open inline picker via the per-row Cast button
    await page.getByTestId(`cast-button-${id}`).click();
    await expect(page.getByTestId('dispatch-target-picker')).toBeVisible();

    // Select first device + submit
    const firstDevice = page.locator('[data-testid^="picker-device-"]').first();
    await expect(firstDevice).toBeVisible();
    await firstDevice.click();
    await page.getByTestId('picker-submit').click();

    // Picker closes after submit
    await expect(page.getByTestId('dispatch-target-picker')).not.toBeVisible();
  });
});
```

- [ ] **Step 2: Run and commit**

```bash
npx playwright test tests/live/flow/media/media-app-inline-cast.runtime.test.mjs --reporter=line
git add tests/live/flow/media/media-app-inline-cast.runtime.test.mjs
git commit -m "test(media): e2e inline cast from a result row"
```

---

### Task 8.3 — Search states

**Files:**
- Create: `tests/live/flow/media/media-app-search-states.runtime.test.mjs`

- [ ] **Step 1: Write the test**

```js
import { test, expect } from '@playwright/test';

test.describe('MediaApp — search states', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/media');
    await page.evaluate(() => localStorage.clear());
  });

  test('idle prompt appears on focus', async ({ page }) => {
    await page.getByTestId('media-search-input').focus();
    await expect(page.getByTestId('search-idle-prompt')).toBeVisible();
  });

  test('empty state for a no-match query', async ({ page }) => {
    await page.getByTestId('media-search-input').fill('zzzqqq-nonsense-1234');
    await expect(page.getByTestId('search-empty')).toBeVisible({ timeout: 15000 });
  });

  test('error state when the search endpoint fails', async ({ page }) => {
    await page.route('**/api/v1/content/query/search/stream**', (route) => route.abort('failed'));
    await page.getByTestId('media-search-input').fill('hello');
    await expect(page.getByTestId('search-error')).toBeVisible({ timeout: 8000 });
    // Retry button is present
    await expect(page.getByTestId('search-retry')).toBeVisible();
  });
});
```

- [ ] **Step 2: Run and commit**

```bash
npx playwright test tests/live/flow/media/media-app-search-states.runtime.test.mjs --reporter=line
git add tests/live/flow/media/media-app-search-states.runtime.test.mjs
git commit -m "test(media): e2e idle/empty/error search states"
```

---

### Task 8.4 — Deep-link content ID input

**Files:**
- Create: `tests/live/flow/media/media-app-deep-link-input.runtime.test.mjs`

- [ ] **Step 1: Write the test**

```js
import { test, expect } from '@playwright/test';

test.describe('MediaApp — deep-link content-ID input', () => {
  test('typing source:id shows the Play This ID affordance', async ({ page }) => {
    await page.goto('/media');
    await page.evaluate(() => localStorage.clear());
    await page.getByTestId('media-search-input').fill('plex-main:12345');
    await expect(page.getByTestId('search-deeplink-suggestion')).toBeVisible();
    await expect(page.getByTestId('search-deeplink-play')).toBeVisible();
  });
});
```

- [ ] **Step 2: Run and commit**

```bash
npx playwright test tests/live/flow/media/media-app-deep-link-input.runtime.test.mjs --reporter=line
git add tests/live/flow/media/media-app-deep-link-input.runtime.test.mjs
git commit -m "test(media): e2e deep-link content-ID input affordance"
```

---

### Task 8.5 — Resume + Recents

**Files:**
- Create: `tests/live/flow/media/media-app-resume.runtime.test.mjs`

- [ ] **Step 1: Write the test**

```js
import { test, expect } from '@playwright/test';

test.describe('MediaApp — Resume and Recents on Home', () => {
  test('home shows the resume card when a session has been paused', async ({ page }) => {
    await page.goto('/media');
    await page.evaluate(() => localStorage.clear());

    // Play, then pause, to leave a paused session
    await page.getByTestId('media-search-input').fill('lonesome');
    const firstRow = page.locator('[data-testid^="result-row-"]').first();
    await expect(firstRow).toBeVisible({ timeout: 15000 });
    const id = (await firstRow.getAttribute('data-testid')).replace(/^result-row-/, '');
    await page.getByTestId(`result-play-now-${id}`).click();
    await expect(page.getByTestId('mini-toggle')).toBeVisible({ timeout: 8000 });
    await page.getByTestId('mini-toggle').click(); // pause

    // Navigate home
    await page.getByTestId('app-nav-home').click();
    await expect(page.getByTestId('resume-card')).toBeVisible();
    await expect(page.getByTestId('recents-row')).toBeVisible();
  });
});
```

- [ ] **Step 2: Run and commit**

```bash
npx playwright test tests/live/flow/media/media-app-resume.runtime.test.mjs --reporter=line
git add tests/live/flow/media/media-app-resume.runtime.test.mjs
git commit -m "test(media): e2e Resume + Recents on Home"
```

---

### Task 8.6 — Unified hand-off via the picker

**Files:**
- Create: `tests/live/flow/media/media-app-handoff-picker.runtime.test.mjs`

- [ ] **Step 1: Write the test**

```js
import { test, expect } from '@playwright/test';

test('NowPlaying hand-off uses DispatchTargetPicker', async ({ page }) => {
  await page.route('**/api/v1/device/*/load*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, dispatchId: 'handoff-1', steps: [], totalElapsedMs: 8 }),
  }));
  await page.goto('/media');
  await page.evaluate(() => localStorage.clear());

  await page.getByTestId('media-search-input').fill('lonesome');
  const firstRow = page.locator('[data-testid^="result-row-"]').first();
  await expect(firstRow).toBeVisible({ timeout: 15000 });
  const id = (await firstRow.getAttribute('data-testid')).replace(/^result-row-/, '');
  await page.getByTestId(`result-play-now-${id}`).click();
  await page.getByTestId('mini-player-open-nowplaying').click();

  // NowPlaying view contains a DispatchTargetPicker for hand-off
  await expect(page.locator('[data-testid="handoff-section"] [data-testid="dispatch-target-picker"]')).toBeVisible();
  const firstDevice = page.locator('[data-testid="handoff-section"] [data-testid^="picker-device-"]').first();
  await firstDevice.click();
  await page.locator('[data-testid="handoff-section"] [data-testid="picker-submit"]').click();
});
```

- [ ] **Step 2: Run and commit**

```bash
npx playwright test tests/live/flow/media/media-app-handoff-picker.runtime.test.mjs --reporter=line
git add tests/live/flow/media/media-app-handoff-picker.runtime.test.mjs
git commit -m "test(media): e2e NowPlaying hand-off via DispatchTargetPicker"
```

---

### Task 8.7 — Re-run all media flow tests and fix regressions

- [ ] **Step 1: Run the full suite**

```bash
npx playwright test tests/live/flow/media/ --reporter=line
```

- [ ] **Step 2: For each failing test, root-cause:**

- Old selectors? Update to new testids (`settings-menu-trigger`, `mini-stop`, `picker-*`, `search-overlay`, etc.).
- Behavioral changes (e.g., result-open no longer navigates)? Update test expectations to match the new behavior (peek toggle), or split the test to assert specifically what's expected.
- Don't downgrade asserts to silent passes — fix the test or fix the regression.

- [ ] **Step 3: Commit fixes**

```bash
git add tests/live/flow/media/
git commit -m "test(media): align existing flow tests with new shell"
```

---

## Phase 9 — Design-review loop (screenshots)

Capture screenshots at canonical states. Dispatch a design critique. Apply the fixes. Repeat until the visual quality is acceptable.

### Task 9.1 — Screenshot capture test

**Files:**
- Create: `tests/live/flow/media/media-app-design-screens.runtime.test.mjs`
- Create: `docs/_wip/audits/media-app-screens/` (folder for screenshots)

- [ ] **Step 1: Write the test**

```js
import { test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.join(process.cwd(), 'docs/_wip/audits/media-app-screens');
fs.mkdirSync(OUT_DIR, { recursive: true });

async function snap(page, name) {
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: true });
}

test.describe('MediaApp — design screenshots', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/media');
    await page.evaluate(() => localStorage.clear());
  });

  test('canonical states', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    // 01 home idle
    await page.goto('/media');
    await page.waitForSelector('[data-testid="home-view"]');
    await snap(page, '01-home-idle');

    // 02 search results
    await page.getByTestId('media-search-input').fill('lonesome');
    await page.waitForSelector('[data-testid^="result-row-"]', { timeout: 15000 });
    await snap(page, '02-search-results');

    // 03 result peek
    const firstOpen = page.locator('[data-testid^="result-open-"]').first();
    await firstOpen.click();
    await page.waitForSelector('[data-testid^="result-peek-"]');
    await snap(page, '03-result-peek');

    // 04 cast picker open
    await page.locator('[data-testid^="cast-button-"]').first().click();
    await page.waitForSelector('[data-testid="dispatch-target-picker"]');
    await snap(page, '04-cast-picker-open');

    // 05 search empty state
    await page.getByTestId('media-search-input').fill('');
    await page.getByTestId('media-search-input').fill('zzzqqq-nonsense-1234');
    await page.waitForSelector('[data-testid="search-empty"]', { timeout: 15000 });
    await snap(page, '05-search-empty');

    // 06 search error state (stub the endpoint)
    await page.route('**/api/v1/content/query/search/stream**', (route) => route.abort('failed'));
    await page.getByTestId('media-search-input').fill('');
    await page.getByTestId('media-search-input').fill('hello');
    await page.waitForSelector('[data-testid="search-error"]');
    await snap(page, '06-search-error');
    await page.unroute('**/api/v1/content/query/search/stream**');

    // 07 mobile dock (narrow viewport)
    await page.setViewportSize({ width: 420, height: 800 });
    await page.goto('/media');
    await page.waitForSelector('[data-testid="home-view"]');
    await snap(page, '07-home-mobile');
  });
});
```

- [ ] **Step 2: Run the screenshot test**

```bash
npx playwright test tests/live/flow/media/media-app-design-screens.runtime.test.mjs --reporter=line
```
Expected: PASS. Screenshots appear in `docs/_wip/audits/media-app-screens/`.

- [ ] **Step 3: List the screenshots and confirm presence**

```bash
ls -la /opt/Code/DaylightStation/docs/_wip/audits/media-app-screens/
```
Expect 7 PNGs (01–07).

- [ ] **Step 4: Commit screenshots so the critique agent can reference them**

```bash
cd /opt/Code/DaylightStation && \
  git add tests/live/flow/media/media-app-design-screens.runtime.test.mjs \
          docs/_wip/audits/media-app-screens/ && \
  git commit -m "test(media): canonical-state screenshots for design review"
```

---

### Task 9.2 — Design critique pass

**Files:**
- Read: every PNG in `docs/_wip/audits/media-app-screens/`
- Modify: `frontend/src/Apps/MediaApp.scss` and any component touched by the critique

- [ ] **Step 1: Read every captured screenshot via the Read tool**

For each PNG, use the Read tool with the file path. Note any visual issues:
- Cramped spacing
- Inconsistent border radii
- Weak hierarchy
- Misaligned items
- Hover states absent at rest

- [ ] **Step 2: Dispatch a frontend-design critique**

Invoke:

```
Agent({
  description: "Media app design critique",
  subagent_type: "frontend-design",
  prompt: "Review the 7 PNGs at /opt/Code/DaylightStation/docs/_wip/audits/media-app-screens/ (01-home-idle.png through 07-home-mobile.png). The app is the DaylightStation Media App — a media discovery / playback / casting tool inspired by Plex/Jellyfin. Visual tokens are in frontend/src/Apps/MediaApp.scss (dark neutrals, single amber accent #e5a00d, Inter font). Give a critique focused on: (1) Visual hierarchy — is search clearly the front door, is the resume card prominent enough, are secondary controls demoted? (2) Spacing rhythm — consistent gutters, no cramped clusters? (3) Result row peek — does it feel like a coherent expand rather than a layout glitch? (4) DispatchTargetPicker readability and density. (5) Empty/error states — are they information-rich without being noisy? (6) Mobile (420px) — usable or compromised? Be specific: name a screenshot, name the issue, propose a CSS-level fix. No platitudes."
})
```

- [ ] **Step 3: Apply the highest-impact fixes from the critique**

Make the SCSS / component changes the critique recommends. Examples of likely fixes:
- Add tighter spacing rhythm between Dock and Canvas.
- Increase weight contrast between section subheads ("Recently played", "Browse the catalog").
- Tighten the cast popover border-radius / inner spacing for density.
- Re-evaluate the deep-link affordance — should it be more or less prominent?

Do not apply every nit — apply changes that move the design quality forward. Defer minor polish to a follow-up if time pressed.

- [ ] **Step 4: Re-capture and visually verify**

```bash
npx playwright test tests/live/flow/media/media-app-design-screens.runtime.test.mjs --reporter=line
```
Re-read the screenshots and confirm the critique items are addressed.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation && \
  git add frontend/src/Apps/MediaApp.scss frontend/src/modules/Media/ \
          docs/_wip/audits/media-app-screens/ && \
  git commit -m "style(media): design critique pass — hierarchy, spacing, density"
```

- [ ] **Step 6: Repeat if needed**

If the critique result still shows fundamental issues (not nits), repeat Steps 2–5 once more. Do not run more than 3 critique passes — diminishing returns; if the design is still failing after pass 3, escalate to the user with the critique notes for direction.

---

## Phase 10 — Final verification

### Task 10.1 — Full media test suite green

- [ ] **Step 1: Run every media-related test**

```bash
cd /opt/Code/DaylightStation && \
  npx jest frontend/src/modules/Media/ frontend/src/hooks/useStreamingSearch.test.js 2>&1 | tail -40
npx playwright test tests/live/flow/media/ --reporter=line 2>&1 | tail -40
```

- [ ] **Step 2: For any failing test, root-cause and fix the regression (not the test)**

Per CLAUDE.md: no `if (precondition) return { success: true }` short-circuits. If the dev server isn't running, start it. If a Plex query returns nothing in this env, change the query but ensure the test still asserts the behavior it claims to.

- [ ] **Step 3: Commit any final fixes**

```bash
git add -A
git commit -m "fix(media): test-suite cleanup after overhaul"
```

### Task 10.2 — Update the audit doc with a closing note

**Files:**
- Modify: `docs/_wip/audits/2026-05-15-media-app-usability-audit.md`

- [ ] **Step 1: Append a "Resolved" section**

At the end of the audit doc, append:

```markdown
---

## Resolved 2026-MM-DD

This audit drove `docs/superpowers/plans/2026-05-15-media-app-overhaul.md`.
All P0 and P1 findings are addressed in the resulting commits between
`<first-commit-sha>` and `<final-commit-sha>`. P2 dead code (LiveStream)
was removed in `<commit-sha>`. Design critique screenshots live under
`docs/_wip/audits/media-app-screens/`.

Outstanding follow-ups (out of scope for this overhaul):
- Accessibility deep dive (requirements N6 — punted).
- Visual regression baseline for CI (current screenshots are reference-only).
```

Fill in the commit SHAs by running `git log --oneline main..HEAD` once the plan is fully executed.

- [ ] **Step 2: Commit**

```bash
git add docs/_wip/audits/2026-05-15-media-app-usability-audit.md
git commit -m "docs: close out media app usability audit"
```

---

## Spec Coverage Matrix

| Audit finding | Addressed by |
|---|---|
| P0-1 No Stop control | Task 3.1 |
| P0-2 Cast requires pre-set targets | Tasks 4.1–4.2 |
| P0-3 Search has no empty/error state | Tasks 2.1–2.4 |
| P0-4 No quick preview | Task 5.1 |
| P1-5 Dock is six peer components | Task 7.1 (grid layout) |
| P1-6 Reset Session in production UI | Task 1.2 |
| P1-7 Two cast flows | Tasks 4.1, 4.3 |
| P1-8 Browse buttons compete with Search | Task 6.3 (curated demoted under Resume + Recents) |
| P2-9 LiveStream/ dead | Task 1.1 |
| P2-10 Pasting Plex ID does nothing | Task 2.3 (deep-link affordance) |
| User requirement: Playwright validation | Tasks 8.1–8.7 |
| User requirement: screenshot/design review | Tasks 9.1–9.2 |
| User requirement: read-only | No write APIs touched; preserved |

## Type / Identifier Consistency

- `transport.stop()` — exists on `LocalSessionAdapter`; called from `MiniPlayer` (Task 3.1).
- `dispatchToTarget({ targetIds, mode, play | queue | snapshot, … })` — DispatchProvider signature; used uniformly by `useDispatchTargetPicker` (Task 4.1) and by `CastButton` (Task 4.2).
- `SearchResults` props — `(results, pending, onAction)`; provided by `SearchBar` (Task 2.4) after state derivation.
- `parseContentId(input)` — returns `{ source, localId } | null`; consumed by `SearchIdleState` (Task 2.3) and by the deep-link onClick in `SearchBar`.
- `readRecents()` / `recordRecent(item)` — Task 6.1 module; consumed by `RecentsRow` and `LocalSessionAdapter`.
- `useDispatchTargetPicker({ source, onComplete })` — `source` is `{ play, queue, snapshot }`; props verified against all callers.

## Execution Notes

- All Jest tests assume `jest` is the runner the project uses for `frontend/src/`; if the project uses Vitest in some files, adjust the import (`import { test, expect } from 'vitest';`). The example commands target `npx jest` because the existing test files under `frontend/src/modules/Media/` use Jest conventions.
- All Playwright commands assume the dev server is reachable on the port from `tests/_lib/configHelper.mjs` (Vite's webServer config handles startup if not).
- Before each Playwright run, the prior `localStorage.clear()` and any route-stub teardown is the test's own responsibility. Tests follow the existing convention in `media-app-discovery.runtime.test.mjs`.
- Do not deploy until the user reviews the screenshots in `docs/_wip/audits/media-app-screens/` and signs off.
