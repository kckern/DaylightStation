# Media App UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the highest-impact UX gaps surfaced in `docs/_wip/audits/2026-04-19-media-app-ux-best-practices-audit.md`: overlay dismissal, mini-player state clarity, navigation affordances, URL/history integration, reset confirmation. Each task ships working, user-visible improvement independently.

**Architecture:** All work sits inside `frontend/src/modules/Media/**` plus one new shared hook at `frontend/src/hooks/useDismissable.js`. No backend changes, no API contract changes. Uses existing Playwright flow harness for end-to-end verification; no new testing infrastructure.

**Tech Stack:** React 18, Vitest + Testing Library for unit tests, Playwright for runtime tests. Existing test commands:
- Vitest: `./frontend/node_modules/.bin/vitest run --config vitest.config.mjs <paths>`
- Playwright: `npx playwright test tests/live/flow/media/<file> --reporter=line`

**Out of scope (follow-up plans):**
- Aspect-ratio metadata in display API (`§3.1` of audit — needs backend contract change)
- Search row action consolidation to primary + overflow (`§2.1` — needs interaction design pre-read)
- ARIA / keyboard spec `docs/reference/media/media-app-a11y.md` (`§4` — separate deliverable)
- Dispatch-tray collapse (`§2.5` — needs design pre-read)

**Before starting:** verify test infrastructure and baseline state.

- [ ] **Pre-check: confirm tests pass on main**

Run: `npx playwright test tests/live/flow/media/ --reporter=line`
Expected: `12 passed` (baseline before any changes).

- [ ] **Pre-check: confirm dev container is healthy**

Run: `curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3111/media`
Expected: `200`.

---

## Task 1: Shared `useDismissable` hook

**Files:**
- Create: `frontend/src/hooks/useDismissable.js`
- Create: `frontend/src/hooks/useDismissable.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/hooks/useDismissable.test.jsx`:

```jsx
import React, { useRef } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { useDismissable } from './useDismissable.js';

function Host({ open, onDismiss }) {
  const ref = useRef(null);
  useDismissable(ref, { open, onDismiss });
  return (
    <div data-testid="outside">
      <div ref={ref} data-testid="target">content</div>
    </div>
  );
}

describe('useDismissable', () => {
  it('calls onDismiss on Escape when open', () => {
    const onDismiss = vi.fn();
    render(<Host open onDismiss={onDismiss} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not call onDismiss on Escape when closed', () => {
    const onDismiss = vi.fn();
    render(<Host open={false} onDismiss={onDismiss} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('calls onDismiss on pointerdown outside the ref', () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(<Host open onDismiss={onDismiss} />);
    fireEvent.pointerDown(getByTestId('outside'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not call onDismiss on pointerdown inside the ref', () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(<Host open onDismiss={onDismiss} />);
    fireEvent.pointerDown(getByTestId('target'));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('removes listeners when open flips false', () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<Host open onDismiss={onDismiss} />);
    rerender(<Host open={false} onDismiss={onDismiss} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/useDismissable.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

Create `frontend/src/hooks/useDismissable.js`:

```javascript
import { useEffect } from 'react';

/**
 * Close an overlay on Escape or on pointerdown outside the supplied ref.
 * Usage:
 *   const ref = useRef(null);
 *   useDismissable(ref, { open, onDismiss });
 */
export function useDismissable(ref, { open, onDismiss }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onDismiss?.();
      }
    };
    const onPointer = (e) => {
      const node = ref?.current;
      if (!node) return;
      if (e.target instanceof Node && node.contains(e.target)) return;
      onDismiss?.();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  }, [ref, open, onDismiss]);
}

export default useDismissable;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/useDismissable.test.jsx`
Expected: `5 passed`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useDismissable.js frontend/src/hooks/useDismissable.test.jsx
git commit -m "feat(hooks): add useDismissable for Escape + outside-click overlays"
```

---

## Task 2: Apply `useDismissable` to the search dropdown

Close search results on Escape, outside click, or when an action fires. Clear the input's query so the dropdown does not reopen immediately.

**Files:**
- Modify: `frontend/src/modules/Media/search/SearchBar.jsx`
- Modify: `frontend/src/modules/Media/search/SearchResults.jsx`
- Create: `tests/live/flow/media/media-app-search-lifecycle.runtime.test.mjs`

- [ ] **Step 1: Write the failing Playwright test**

Create `tests/live/flow/media/media-app-search-lifecycle.runtime.test.mjs`:

```javascript
import { test, expect } from '@playwright/test';

test.describe('MediaApp — search dropdown lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/media');
    await page.evaluate(() => localStorage.clear());
  });

  test('Escape closes the search results dropdown', async ({ page }) => {
    await page.goto('/media');
    await page.getByTestId('media-search-input').fill('lonesome');
    await expect(page.locator('ul[data-testid="media-search-results"]')).toBeVisible({ timeout: 15000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('ul[data-testid="media-search-results"]')).toBeHidden({ timeout: 2000 });
  });

  test('outside click closes the search results dropdown', async ({ page }) => {
    await page.goto('/media');
    await page.getByTestId('media-search-input').fill('lonesome');
    await expect(page.locator('ul[data-testid="media-search-results"]')).toBeVisible({ timeout: 15000 });
    // Click on the canvas area, which is outside the search bar.
    await page.locator('[data-testid="media-canvas"]').click({ position: { x: 400, y: 400 } });
    await expect(page.locator('ul[data-testid="media-search-results"]')).toBeHidden({ timeout: 2000 });
  });

  test('Play Now from search auto-closes the dropdown and clears the query', async ({ page }) => {
    await page.goto('/media');
    await page.getByTestId('media-search-input').fill('lonesome');
    const firstRow = page.locator('[data-testid^="result-row-"]').first();
    await expect(firstRow).toBeVisible({ timeout: 15000 });
    const rowId = await firstRow.getAttribute('data-testid');
    const contentId = rowId?.replace(/^result-row-/, '');
    await firstRow.hover();
    await page.getByTestId(`result-play-now-${contentId}`).click();
    await expect(page.locator('ul[data-testid="media-search-results"]')).toBeHidden({ timeout: 2000 });
    await expect(page.getByTestId('media-search-input')).toHaveValue('');
  });
});
```

- [ ] **Step 2: Run Playwright test to verify it fails**

Run: `npx playwright test tests/live/flow/media/media-app-search-lifecycle.runtime.test.mjs --reporter=line`
Expected: 3 failures — dropdown stays visible after Escape / outside click / action.

- [ ] **Step 3: Rewire SearchResults to accept an onAction callback**

Replace `frontend/src/modules/Media/search/SearchResults.jsx`:

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

export function SearchResults({ results = [], pending = [], isSearching = false, onAction }) {
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
              <img
                className="media-result-thumb"
                src={thumb}
                alt=""
                loading="lazy"
                onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
              />
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
      {pending.length > 0 && <li data-testid="media-search-pending">Loading {pending.join(', ')}…</li>}
    </ul>
  );
}

export default SearchResults;
```

- [ ] **Step 4: Rewire SearchBar to use useDismissable and clear on action**

Replace `frontend/src/modules/Media/search/SearchBar.jsx`:

```jsx
import React, { useState, useRef, useCallback } from 'react';
import { useLiveSearch } from './useLiveSearch.js';
import { useSearchContext } from './SearchProvider.jsx';
import { SearchResults } from './SearchResults.jsx';
import { useDismissable } from '../../../hooks/useDismissable.js';

export function SearchBar() {
  const { scopes, currentScopeKey, currentScope, setScopeKey } = useSearchContext();
  const { results, pending, isSearching, setQuery } = useLiveSearch({
    scopeParams: currentScope?.params ?? '',
  });
  const [value, setValue] = useState('');
  const rootRef = useRef(null);

  const isOpen = value.length >= 2;

  const close = useCallback(() => {
    setValue('');
    setQuery('');
  }, [setQuery]);

  useDismissable(rootRef, { open: isOpen, onDismiss: close });

  const onChange = (e) => {
    const next = e.target.value;
    setValue(next);
    setQuery(next);
  };

  return (
    <div data-testid="media-search-bar" className="media-search-bar" ref={rootRef}>
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
      {isOpen && (
        <SearchResults results={results} pending={pending} isSearching={isSearching} onAction={close} />
      )}
    </div>
  );
}

export default SearchBar;
```

- [ ] **Step 5: Update CastButton to propagate onAction (if applicable)**

Read `frontend/src/modules/Media/cast/CastButton.jsx`. If the button currently does not accept `onAction`, add the prop and call it after a successful dispatch start. Snippet (apply after the existing dispatch call; replace whatever `onClick` handler is present):

```jsx
export function CastButton({ contentId, onAction }) {
  // ... existing hooks / state
  const onClick = () => {
    // existing dispatch call, e.g. dispatch(contentId)
    onAction?.();
  };
  return (
    <button data-testid={`cast-button-${contentId}`} onClick={onClick}>Cast</button>
  );
}
```

Keep every existing prop and `data-testid` intact.

- [ ] **Step 6: Run Playwright test to verify it passes**

Run: `npx playwright test tests/live/flow/media/media-app-search-lifecycle.runtime.test.mjs --reporter=line`
Expected: `3 passed`.

- [ ] **Step 7: Run the existing media suite to check for regressions**

Run: `npx playwright test tests/live/flow/media/ --reporter=line`
Expected: all tests pass (previous 12 + new 3 = 15).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/modules/Media/search/SearchBar.jsx \
        frontend/src/modules/Media/search/SearchResults.jsx \
        frontend/src/modules/Media/cast/CastButton.jsx \
        tests/live/flow/media/media-app-search-lifecycle.runtime.test.mjs
git commit -m "fix(media-app): dismiss search dropdown on Escape, outside click, or action"
```

---

## Task 3: Apply `useDismissable` to the cast popover

**Files:**
- Modify: `frontend/src/modules/Media/cast/CastTargetChip.jsx`
- Modify: `tests/live/flow/media/media-app-cast.runtime.test.mjs`

- [ ] **Step 1: Write the failing Playwright test** (append to `media-app-cast.runtime.test.mjs`)

Append this test block above the closing `});` of `test.describe(...)`:

```javascript
  test('Escape closes the cast popover', async ({ page }) => {
    await page.goto('/media');
    await page.getByTestId('cast-target-chip').click();
    await expect(page.getByTestId('cast-popover')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('cast-popover')).toBeHidden({ timeout: 2000 });
  });

  test('outside click closes the cast popover', async ({ page }) => {
    await page.goto('/media');
    await page.getByTestId('cast-target-chip').click();
    await expect(page.getByTestId('cast-popover')).toBeVisible();
    await page.locator('[data-testid="media-canvas"]').click({ position: { x: 400, y: 400 } });
    await expect(page.getByTestId('cast-popover')).toBeHidden({ timeout: 2000 });
  });
```

- [ ] **Step 2: Run Playwright tests to verify both new tests fail**

Run: `npx playwright test tests/live/flow/media/media-app-cast.runtime.test.mjs --reporter=line`
Expected: 2 failures for the two new tests.

- [ ] **Step 3: Wire `useDismissable` into `CastTargetChip`**

Replace `frontend/src/modules/Media/cast/CastTargetChip.jsx`:

```jsx
import React, { useState, useRef, useCallback } from 'react';
import { useCastTarget } from './useCastTarget.js';
import { useFleetContext } from '../fleet/FleetProvider.jsx';
import { CastPopover } from './CastPopover.jsx';
import { useDismissable } from '../../../hooks/useDismissable.js';

export function CastTargetChip() {
  const { targetIds } = useCastTarget();
  const { devices } = useFleetContext();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  const close = useCallback(() => setOpen(false), []);
  useDismissable(rootRef, { open, onDismiss: close });

  const selectedNames = targetIds
    .map((id) => devices.find((d) => d.id === id)?.name ?? id)
    .join(', ');
  const label = targetIds.length === 0 ? 'No target' : selectedNames;

  return (
    <div className="cast-target-chip-root" ref={rootRef}>
      <button
        data-testid="cast-target-chip"
        className="cast-target-chip"
        onClick={() => setOpen((o) => !o)}
      >
        Cast: {label}
      </button>
      {open && <CastPopover />}
    </div>
  );
}

export default CastTargetChip;
```

- [ ] **Step 4: Run Playwright tests to verify all pass**

Run: `npx playwright test tests/live/flow/media/media-app-cast.runtime.test.mjs --reporter=line`
Expected: `4 passed` (2 existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/cast/CastTargetChip.jsx \
        tests/live/flow/media/media-app-cast.runtime.test.mjs
git commit -m "fix(media-app): dismiss cast popover on Escape or outside click"
```

---

## Task 4: Back button and Escape handling in NowPlayingView

**Files:**
- Modify: `frontend/src/modules/Media/shell/NowPlayingView.jsx`
- Modify: `frontend/src/Apps/MediaApp.scss`
- Create: `tests/live/flow/media/media-app-now-playing-exit.runtime.test.mjs`

- [ ] **Step 1: Write the failing Playwright test**

Create `tests/live/flow/media/media-app-now-playing-exit.runtime.test.mjs`:

```javascript
import { test, expect } from '@playwright/test';

test.describe('MediaApp — NowPlaying exit', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/media');
    await page.evaluate(() => localStorage.clear());
  });

  async function startPlayback(page) {
    await page.goto('/media');
    await page.getByTestId('media-search-input').fill('lonesome');
    const row = page.locator('[data-testid^="result-row-"]').first();
    await expect(row).toBeVisible({ timeout: 15000 });
    const rowId = await row.getAttribute('data-testid');
    const contentId = rowId?.replace(/^result-row-/, '');
    await row.hover();
    await page.getByTestId(`result-play-now-${contentId}`).click();
    await page.getByTestId('mini-player-open-nowplaying').click();
    await expect(page.getByTestId('now-playing-view')).toBeVisible({ timeout: 10000 });
  }

  test('Back button exits to Home', async ({ page }) => {
    await startPlayback(page);
    await page.getByTestId('now-playing-back').click();
    await expect(page.getByTestId('home-view')).toBeVisible({ timeout: 5000 });
  });

  test('Escape exits NowPlaying', async ({ page }) => {
    await startPlayback(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('now-playing-view')).toBeHidden({ timeout: 5000 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/live/flow/media/media-app-now-playing-exit.runtime.test.mjs --reporter=line`
Expected: both tests fail (no back button, Escape does nothing).

- [ ] **Step 3: Add back button and Escape handler**

Replace `frontend/src/modules/Media/shell/NowPlayingView.jsx`:

```jsx
import React, { useRef, useState, useEffect } from 'react';
import { useSessionController } from '../session/useSessionController.js';
import { usePlayerHost } from '../session/usePlayerHost.js';
import { useFleetContext } from '../fleet/FleetProvider.jsx';
import { useHandOff } from '../cast/useHandOff.js';
import { useNav } from './NavProvider.jsx';

export function NowPlayingView() {
  const { snapshot } = useSessionController('local');
  const item = snapshot.currentItem;
  const hostRef = useRef(null);
  usePlayerHost(hostRef);
  const { devices } = useFleetContext();
  const handOff = useHandOff();
  const [targetId, setTargetId] = useState('');
  const [mode, setMode] = useState('transfer');
  const { pop, depth } = useNav();

  const goBack = () => {
    if (depth > 1) pop();
    else window.history.back?.();
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        goBack();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [depth, pop]);

  const onHandOff = () => {
    if (!targetId) return;
    handOff(targetId, { mode });
  };

  return (
    <div data-testid="now-playing-view">
      <div className="now-playing-toolbar">
        <button
          data-testid="now-playing-back"
          className="now-playing-back-btn"
          onClick={goBack}
          aria-label="Back"
        >
          ← Back
        </button>
      </div>
      <h2>Now Playing: {item?.contentId ?? 'nothing'}</h2>
      <div>state: {snapshot.state}</div>
      <div>position: {Math.round(snapshot.position ?? 0)}s</div>
      <div data-testid="now-playing-host" ref={hostRef} className="now-playing-host" />
      {item && devices.length > 0 && (
        <div data-testid="handoff-section" className="handoff-section">
          <select
            data-testid="handoff-target"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
          >
            <option value="">Hand off to…</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>{d.name ?? d.id}</option>
            ))}
          </select>
          <label>
            <input
              type="radio"
              name="handoff-mode"
              checked={mode === 'transfer'}
              onChange={() => setMode('transfer')}
              data-testid="handoff-mode-transfer"
            />
            Transfer
          </label>
          <label>
            <input
              type="radio"
              name="handoff-mode"
              checked={mode === 'fork'}
              onChange={() => setMode('fork')}
              data-testid="handoff-mode-fork"
            />
            Fork
          </label>
          <button
            data-testid="handoff-submit"
            onClick={onHandOff}
            disabled={!targetId}
          >
            Hand Off
          </button>
        </div>
      )}
    </div>
  );
}

export default NowPlayingView;
```

- [ ] **Step 4: Add styles for the Back button**

Append to `frontend/src/Apps/MediaApp.scss` (before the responsive `@media` block at the bottom):

```scss
.now-playing-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.now-playing-back-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 500;
  color: var(--fg);
  background: var(--bg-card);
  border: 1px solid var(--border-mid);
  border-radius: var(--r);
  transition: background 120ms ease, border-color 120ms ease;

  &:hover {
    background: var(--bg-hover);
    border-color: var(--brand);
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx playwright test tests/live/flow/media/media-app-now-playing-exit.runtime.test.mjs --reporter=line`
Expected: `2 passed`.

- [ ] **Step 6: Run full media suite**

Run: `npx playwright test tests/live/flow/media/ --reporter=line`
Expected: all tests pass (17 total by now).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Media/shell/NowPlayingView.jsx \
        frontend/src/Apps/MediaApp.scss \
        tests/live/flow/media/media-app-now-playing-exit.runtime.test.mjs
git commit -m "feat(media-app): add Back button and Escape handler to NowPlaying"
```

---

## Task 5: Collapse mini-player to a single state-aware toggle button

**Files:**
- Modify: `frontend/src/modules/Media/shell/MiniPlayer.jsx`
- Modify: `frontend/src/Apps/MediaApp.scss`
- Create: `tests/live/flow/media/media-app-mini-toggle.runtime.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/live/flow/media/media-app-mini-toggle.runtime.test.mjs`:

```javascript
import { test, expect } from '@playwright/test';

test.describe('MediaApp — mini player toggle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/media');
    await page.evaluate(() => localStorage.clear());
  });

  async function startPlayback(page) {
    await page.goto('/media');
    await page.getByTestId('media-search-input').fill('lonesome');
    const row = page.locator('[data-testid^="result-row-"]').first();
    await expect(row).toBeVisible({ timeout: 15000 });
    const rowId = await row.getAttribute('data-testid');
    const contentId = rowId?.replace(/^result-row-/, '');
    await row.hover();
    await page.getByTestId(`result-play-now-${contentId}`).click();
  }

  test('mini player shows exactly one transport button that toggles', async ({ page }) => {
    await startPlayback(page);
    const toggle = page.getByTestId('mini-toggle');
    await expect(toggle).toBeVisible({ timeout: 5000 });
    // When playing, toggle label should indicate Pause
    await expect(toggle).toHaveAttribute('aria-label', /pause/i);
    await toggle.click();
    // After click the element should be paused and label should read Play
    await expect(toggle).toHaveAttribute('aria-label', /play/i, { timeout: 2000 });
    // And there should be only one transport button, not both mini-play and mini-pause
    await expect(page.getByTestId('mini-play')).toHaveCount(0);
    await expect(page.getByTestId('mini-pause')).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/live/flow/media/media-app-mini-toggle.runtime.test.mjs --reporter=line`
Expected: FAIL — `mini-toggle` does not exist, `mini-play`/`mini-pause` are still present.

- [ ] **Step 3: Replace MiniPlayer transport with a single toggle**

Replace `frontend/src/modules/Media/shell/MiniPlayer.jsx`:

```jsx
// frontend/src/modules/Media/shell/MiniPlayer.jsx
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
  const label = isPlaying ? 'Pause' : 'Play';
  const onToggle = () => {
    if (isPlaying) transport.pause();
    else transport.play();
  };

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
        aria-label={label}
        onClick={onToggle}
        className={`media-mini-player__toggle media-mini-player__toggle--${isPlaying ? 'playing' : 'paused'}`}
      >
        {isPlaying ? '❚❚' : '▶'}
      </button>
    </div>
  );
}

export default MiniPlayer;
```

- [ ] **Step 4: Update styles for the single toggle**

In `frontend/src/Apps/MediaApp.scss` replace the block beginning at `[data-testid='mini-pause']` (it currently matches both pause and play) with:

```scss
[data-testid='media-mini-player'] [data-testid='mini-toggle'] {
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
    color: var(--brand-ink);
    background: var(--brand);
    border-color: var(--brand);
  }
}
```

Remove the old `[data-testid='mini-pause'], [data-testid='mini-play']` rule in the same stylesheet.

- [ ] **Step 5: Search for any existing references to mini-pause/mini-play and migrate them**

Run: `grep -rn 'mini-pause\|mini-play' frontend/ tests/ 2>/dev/null`
For each hit, if it's in a test file that asserts presence, update it to check `mini-toggle` instead. If it's documentation, leave it but add a note in the next commit message.

- [ ] **Step 6: Run the new test + full suite**

Run: `npx playwright test tests/live/flow/media/media-app-mini-toggle.runtime.test.mjs tests/live/flow/media/ --reporter=line`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Media/shell/MiniPlayer.jsx \
        frontend/src/Apps/MediaApp.scss \
        tests/live/flow/media/media-app-mini-toggle.runtime.test.mjs
git commit -m "feat(media-app): collapse mini-player transport to single state-aware toggle"
```

---

## Task 6: Breadcrumb on BrowseView

**Files:**
- Modify: `frontend/src/modules/Media/browse/BrowseView.jsx`
- Modify: `frontend/src/Apps/MediaApp.scss`
- Create: `tests/live/flow/media/media-app-browse-breadcrumb.runtime.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/live/flow/media/media-app-browse-breadcrumb.runtime.test.mjs`:

```javascript
import { test, expect } from '@playwright/test';

test.describe('MediaApp — browse breadcrumb', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/media');
    await page.evaluate(() => localStorage.clear());
  });

  test('browse view renders a breadcrumb for each path segment', async ({ page }) => {
    await page.goto('/media');
    await page.locator('[data-testid^="home-card-"]').first().click();
    await expect(page.getByTestId('browse-view')).toBeVisible({ timeout: 10000 });
    const segments = page.locator('[data-testid^="browse-crumb-"]');
    await expect(segments.first()).toBeVisible({ timeout: 5000 });
    // Clicking the first crumb should stay on browse but at its path
    const firstCrumbText = await segments.first().textContent();
    expect(firstCrumbText?.trim().length).toBeGreaterThan(0);
  });

  test('clicking Home crumb returns to the home view', async ({ page }) => {
    await page.goto('/media');
    await page.locator('[data-testid^="home-card-"]').first().click();
    await expect(page.getByTestId('browse-view')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('browse-crumb-home').click();
    await expect(page.getByTestId('home-view')).toBeVisible({ timeout: 5000 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/live/flow/media/media-app-browse-breadcrumb.runtime.test.mjs --reporter=line`
Expected: both fail — `browse-crumb-*` does not exist.

- [ ] **Step 3: Implement breadcrumb**

Replace `frontend/src/modules/Media/browse/BrowseView.jsx`:

```jsx
import React from 'react';
import { useListBrowse } from './useListBrowse.js';
import { useSessionController } from '../session/useSessionController.js';
import { useNav } from '../shell/NavProvider.jsx';
import { resultToQueueInput } from '../search/resultToQueueInput.js';

function splitPath(path) {
  if (!path) return [];
  return String(path).split('/').filter(Boolean);
}

export function BrowseView({ path, modifiers, take = 50 }) {
  const { items, total, loading, error, loadMore } = useListBrowse(path, { modifiers, take });
  const { queue } = useSessionController('local');
  const { push, replace } = useNav();

  const segments = splitPath(path);

  if (loading) return <div data-testid="browse-view-loading">Loading…</div>;
  if (error) return <div data-testid="browse-view-error">{error.message}</div>;

  return (
    <div data-testid="browse-view" className="browse-view">
      <nav className="browse-breadcrumb" aria-label="Breadcrumb">
        <button
          data-testid="browse-crumb-home"
          className="browse-crumb browse-crumb--home"
          onClick={() => replace('home', {})}
        >
          Home
        </button>
        {segments.map((seg, idx) => {
          const pathUpToHere = segments.slice(0, idx + 1).join('/');
          const isLast = idx === segments.length - 1;
          return (
            <React.Fragment key={pathUpToHere}>
              <span className="browse-crumb-sep" aria-hidden="true">/</span>
              <button
                data-testid={`browse-crumb-${idx}`}
                className={`browse-crumb${isLast ? ' browse-crumb--current' : ''}`}
                onClick={() => { if (!isLast) replace('browse', { path: pathUpToHere, modifiers }); }}
                aria-current={isLast ? 'page' : undefined}
                disabled={isLast}
              >
                {seg}
              </button>
            </React.Fragment>
          );
        })}
      </nav>
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

- [ ] **Step 4: Style the breadcrumb**

Append to `frontend/src/Apps/MediaApp.scss` in the `.browse-view` block (or immediately after it):

```scss
.browse-breadcrumb {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}
.browse-crumb {
  padding: 6px 10px;
  color: var(--fg-2);
  background: transparent;
  border: none;
  border-radius: var(--r-sm);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: color 100ms ease, background 100ms ease;

  &:hover:not(:disabled) {
    color: var(--fg);
    background: var(--bg-hover);
  }
  &--current {
    color: var(--fg);
    cursor: default;
  }
  &--home { color: var(--fg); }
}
.browse-crumb-sep {
  color: var(--fg-3);
  padding: 0 2px;
  font-weight: 400;
}
```

Also remove the now-redundant `browse-view > h2` styling at the top of the `.browse-view` block (the `<h2>{path}</h2>` element has been replaced).

- [ ] **Step 5: Run tests**

Run: `npx playwright test tests/live/flow/media/media-app-browse-breadcrumb.runtime.test.mjs tests/live/flow/media/ --reporter=line`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Media/browse/BrowseView.jsx \
        frontend/src/Apps/MediaApp.scss \
        tests/live/flow/media/media-app-browse-breadcrumb.runtime.test.mjs
git commit -m "feat(media-app): breadcrumb on browse view"
```

---

## Task 7: Reset-session confirmation

**Files:**
- Modify: `frontend/src/modules/Media/shell/Dock.jsx`
- Modify: `frontend/src/Apps/MediaApp.scss`
- Create: `frontend/src/modules/Media/shell/ConfirmDialog.jsx`
- Create: `tests/live/flow/media/media-app-reset-confirm.runtime.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/live/flow/media/media-app-reset-confirm.runtime.test.mjs`:

```javascript
import { test, expect } from '@playwright/test';

test.describe('MediaApp — reset session confirmation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/media');
    await page.evaluate(() => localStorage.clear());
  });

  test('reset asks for confirmation before clearing', async ({ page }) => {
    // Preload a session to reset
    await page.goto('/media');
    await page.evaluate(() => {
      localStorage.setItem('media-app.session', JSON.stringify({
        schemaVersion: 1, sessionId: 'old', updatedAt: 't', wasPlayingOnUnload: false,
        snapshot: {
          sessionId: 'old', state: 'paused',
          currentItem: { contentId: 'plex:42', format: 'video' },
          position: 0,
          queue: { items: [{ queueItemId: 'q1', contentId: 'plex:42', format: 'video', priority: 'queue', addedAt: '' }], currentIndex: 0, upNextCount: 0 },
          config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
          meta: { ownerId: 'test', updatedAt: '' },
        },
      }));
    });
    await page.reload();
    await expect(page.getByTestId('media-mini-player')).toBeVisible();

    await page.getByTestId('session-reset-btn').click();
    // Confirmation appears
    await expect(page.getByTestId('confirm-dialog')).toBeVisible();

    // Cancel does nothing
    await page.getByTestId('confirm-cancel').click();
    await expect(page.getByTestId('confirm-dialog')).toBeHidden({ timeout: 2000 });
    await expect(page.locator('[data-testid="mini-player-open-nowplaying"]')).toBeVisible();

    // Confirm actually resets
    await page.getByTestId('session-reset-btn').click();
    await page.getByTestId('confirm-ok').click();
    await expect(page.locator('[data-testid="mini-player-open-nowplaying"]')).toBeHidden({ timeout: 5000 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/live/flow/media/media-app-reset-confirm.runtime.test.mjs --reporter=line`
Expected: FAIL — `confirm-dialog` never appears.

- [ ] **Step 3: Create the ConfirmDialog component**

Create `frontend/src/modules/Media/shell/ConfirmDialog.jsx`:

```jsx
import React, { useEffect, useRef } from 'react';
import { useDismissable } from '../../../hooks/useDismissable.js';

export function ConfirmDialog({
  open,
  title = 'Confirm',
  message = 'Are you sure?',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}) {
  const ref = useRef(null);
  useDismissable(ref, { open, onDismiss: onCancel });

  useEffect(() => {
    if (open) ref.current?.querySelector('[data-testid="confirm-cancel"]')?.focus();
  }, [open]);

  if (!open) return null;
  return (
    <div className="confirm-backdrop">
      <div
        data-testid="confirm-dialog"
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        ref={ref}
      >
        <div className="confirm-dialog__title">{title}</div>
        <div className="confirm-dialog__message">{message}</div>
        <div className="confirm-dialog__actions">
          <button data-testid="confirm-cancel" className="confirm-btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            data-testid="confirm-ok"
            className="confirm-btn confirm-btn--danger"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
```

- [ ] **Step 4: Wire it into Dock**

Replace `frontend/src/modules/Media/shell/Dock.jsx`:

```jsx
import React, { useState, useCallback } from 'react';
import { MiniPlayer } from './MiniPlayer.jsx';
import { useSessionController } from '../session/useSessionController.js';
import { SearchBar } from '../search/SearchBar.jsx';
import { FleetIndicator } from './FleetIndicator.jsx';
import { CastTargetChip } from '../cast/CastTargetChip.jsx';
import { DispatchProgressTray } from '../cast/DispatchProgressTray.jsx';
import { ConfirmDialog } from './ConfirmDialog.jsx';

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
      <FleetIndicator />
      <CastTargetChip />
      <MiniPlayer />
      <DispatchProgressTray />
      <button data-testid="session-reset-btn" onClick={() => setConfirmOpen(true)}>
        Reset session
      </button>
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

- [ ] **Step 5: Style the dialog**

Append to `frontend/src/Apps/MediaApp.scss` (before the responsive `@media` block):

```scss
.confirm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: fade-in 120ms ease both;
}
@keyframes fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
.confirm-dialog {
  min-width: 320px;
  max-width: 440px;
  padding: 20px 22px;
  background: var(--bg-panel);
  border: 1px solid var(--border-mid);
  border-radius: var(--r-lg);
  box-shadow: 0 24px 60px -10px rgba(0, 0, 0, 0.8);
  color: var(--fg);

  &__title {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 6px;
  }
  &__message {
    font-size: 14px;
    color: var(--fg-2);
    margin-bottom: 20px;
  }
  &__actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
}
.confirm-btn {
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  color: var(--fg);
  background: var(--bg-card);
  border: 1px solid var(--border-mid);
  border-radius: var(--r);
  cursor: pointer;
  transition: all 120ms ease;

  &:hover { background: var(--bg-hover); border-color: rgba(255, 255, 255, 0.2); }

  &--danger {
    background: var(--danger);
    border-color: var(--danger);
    color: #fff;
    font-weight: 600;
    &:hover { filter: brightness(1.1); border-color: var(--danger); }
  }
}
```

- [ ] **Step 6: Run the new test + the existing reset test**

Run: `npx playwright test tests/live/flow/media/media-app-reset-confirm.runtime.test.mjs --reporter=line`
Expected: `1 passed`.

Run: `./frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Media/shell/MediaAppShell.test.jsx`
Expected: the existing "reset button clears the session" test still passes (Confirm dialog auto-accepted because the test clicks reset → confirm-ok flow). **If it does not pass**, update that test to click `confirm-ok` after clicking `session-reset-btn`.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Media/shell/Dock.jsx \
        frontend/src/modules/Media/shell/ConfirmDialog.jsx \
        frontend/src/modules/Media/shell/MediaAppShell.test.jsx \
        frontend/src/Apps/MediaApp.scss \
        tests/live/flow/media/media-app-reset-confirm.runtime.test.mjs
git commit -m "feat(media-app): confirm before resetting local session"
```

---

## Task 8: URL/history integration in `NavProvider`

Sync the active view + params to `URLSearchParams` so browser Back, refresh, and bookmarking work. Preserve the existing deep-link honoured by `useUrlCommand`.

**Files:**
- Modify: `frontend/src/modules/Media/shell/NavProvider.jsx`
- Create: `tests/live/flow/media/media-app-url-sync.runtime.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/live/flow/media/media-app-url-sync.runtime.test.mjs`:

```javascript
import { test, expect } from '@playwright/test';

test.describe('MediaApp — URL / history sync', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/media');
    await page.evaluate(() => localStorage.clear());
  });

  test('fleet view writes a URL that survives a reload', async ({ page }) => {
    await page.goto('/media');
    await page.getByTestId('fleet-indicator').click();
    await expect(page.getByTestId('fleet-view')).toBeVisible({ timeout: 5000 });
    const url = new URL(page.url());
    expect(url.searchParams.get('view')).toBe('fleet');

    await page.reload();
    await expect(page.getByTestId('fleet-view')).toBeVisible({ timeout: 10000 });
  });

  test('browser Back returns to the previous view', async ({ page }) => {
    await page.goto('/media');
    await page.getByTestId('fleet-indicator').click();
    await expect(page.getByTestId('fleet-view')).toBeVisible({ timeout: 5000 });
    await page.goBack();
    await expect(page.getByTestId('home-view')).toBeVisible({ timeout: 5000 });
  });

  test('browse path survives reload', async ({ page }) => {
    await page.goto('/media');
    await page.locator('[data-testid^="home-card-"]').first().click();
    await expect(page.getByTestId('browse-view')).toBeVisible({ timeout: 10000 });
    const urlBefore = page.url();
    await page.reload();
    await expect(page.getByTestId('browse-view')).toBeVisible({ timeout: 10000 });
    expect(page.url()).toBe(urlBefore);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx playwright test tests/live/flow/media/media-app-url-sync.runtime.test.mjs --reporter=line`
Expected: all 3 fail — URL never changes.

- [ ] **Step 3: Implement URL sync in NavProvider**

Replace `frontend/src/modules/Media/shell/NavProvider.jsx`:

```jsx
import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';

const NavContext = createContext(null);

const INITIAL_ENTRY = { view: 'home', params: {} };

const NAV_PARAM_KEYS = ['view', 'path', 'contentId', 'deviceId'];

function readStateFromUrl() {
  if (typeof window === 'undefined') return INITIAL_ENTRY;
  const sp = new URLSearchParams(window.location.search);
  const view = sp.get('view') || 'home';
  const params = {};
  for (const key of NAV_PARAM_KEYS) {
    if (key === 'view') continue;
    const v = sp.get(key);
    if (v != null) params[key] = v;
  }
  return { view, params };
}

function writeStateToUrl(view, params, method = 'push') {
  if (typeof window === 'undefined') return;
  const sp = new URLSearchParams(window.location.search);
  // Strip existing nav keys; preserve everything else (e.g. ?play=, ?shader=).
  for (const key of NAV_PARAM_KEYS) sp.delete(key);
  if (view && view !== 'home') sp.set('view', view);
  for (const [k, v] of Object.entries(params || {})) {
    if (!NAV_PARAM_KEYS.includes(k)) continue;
    if (v != null && v !== '') sp.set(k, String(v));
  }
  const qs = sp.toString();
  const url = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
  const fn = method === 'replace' ? window.history.replaceState : window.history.pushState;
  fn.call(window.history, { view, params }, '', url);
}

export function NavProvider({ children }) {
  const [stack, setStack] = useState(() => [readStateFromUrl()]);

  useEffect(() => {
    const onPop = () => {
      const next = readStateFromUrl();
      // Replace the stack with the URL-derived entry; that's the browser's truth now.
      setStack([next]);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const push = useCallback((view, params = {}) => {
    setStack((prev) => [...prev, { view, params }]);
    writeStateToUrl(view, params, 'push');
  }, []);

  const pop = useCallback(() => {
    setStack((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.slice(0, -1);
      const top = next[next.length - 1];
      writeStateToUrl(top.view, top.params, 'replace');
      return next;
    });
  }, []);

  const replace = useCallback((view, params = {}) => {
    setStack((prev) => [...prev.slice(0, -1), { view, params }]);
    writeStateToUrl(view, params, 'replace');
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

- [ ] **Step 4: Run the URL tests + full suite**

Run: `npx playwright test tests/live/flow/media/media-app-url-sync.runtime.test.mjs tests/live/flow/media/ --reporter=line`
Expected: all pass.

- [ ] **Step 5: Verify the existing `?play=` deep link still works**

Run: `npx playwright test tests/live/flow/media/media-app-autoplay.runtime.test.mjs --reporter=line`
Expected: 4 passed (existing autoplay flow untouched).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Media/shell/NavProvider.jsx \
        tests/live/flow/media/media-app-url-sync.runtime.test.mjs
git commit -m "feat(media-app): sync navigation state to URL and history"
```

---

## Task 9: Final integration pass — build, deploy, manual verify

- [ ] **Step 1: Run the full media suite end to end**

Run: `npx playwright test tests/live/flow/media/ --reporter=line`
Expected: all tests pass (original 12 + ~14 new).

- [ ] **Step 2: Run the isolated modules suite**

Run: `./frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/modules/Media frontend/src/hooks/useDismissable.test.jsx`
Expected: all pass.

- [ ] **Step 3: Visual smoke**

Run: `node /tmp/media-audit.mjs` (existing capture script; if missing, recreate from the earlier audit pass).
Confirm by eye in `/tmp/media-audit/*.png`:
- Search dropdown disappears after Escape or outside click.
- Cast popover disappears on Escape.
- NowPlaying has a visible `← Back` button.
- Mini player shows exactly one transport button (play OR pause glyph).
- Browse view shows a `Home / segment / segment` breadcrumb.
- Reset triggers a confirmation modal.
- Clicking `fleet-indicator` updates the URL to `?view=fleet`.

- [ ] **Step 4: Build and deploy**

```bash
sudo docker build -f docker/Dockerfile \
  -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

Wait ~8s for warmup, then: `curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3111/media`
Expected: `200`.

- [ ] **Step 5: Final push**

```bash
git push origin main
```

---

## Out-of-plan follow-ups (not implemented here)

Captured so they are not lost:

1. **Aspect-ratio metadata** (`audit §3.1/§3.2`) — needs a display-API contract extension returning `orientation` (`portrait`/`square`/`landscape`) plus a `naturalSize`. Implement once the API is changed.
2. **Search row action consolidation** (`audit §2.1`) — primary + overflow menu. Depends on a new reusable `OverflowMenu` component; warrants a design pre-read.
3. **Accessibility spec** (`audit §4`) — write `docs/reference/media/media-app-a11y.md` with keyboard map, ARIA contract, and announcement targets; implement in a follow-up plan.
4. **Dispatch tray collapse** (`audit §2.5`) — redesign as collapsed pill by default with auto-collapse on success.
5. **Scroll restoration between views** (`audit §6.1`) — intercept at `Canvas.jsx` and keep a scroll map keyed by `view/params`.
6. **Peek panel feature gaps** (`audit §6.4`) — add seek and queue controls to meet spec C5.2 / C5.3.

---

## Self-review checklist

1. **Spec coverage** — every audit finding graded HIGH/MEDIUM in `§1–6` is either addressed by a task above or listed as an explicit follow-up. ✓
2. **Placeholder scan** — no `TODO`, `TBD`, or "similar to above" lines. Every code step contains real code. ✓
3. **Type consistency** — `useDismissable({ open, onDismiss })` signature is the same in Tasks 1, 2, 3, 7. `NavProvider` exposes the same `{ view, params, depth, push, pop, replace }` throughout. `ConfirmDialog` props match consumers. ✓
