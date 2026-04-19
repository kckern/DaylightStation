# Admin Combobox Scroll Stickiness Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the admin ContentSearchCombobox dropdown is open and the user scrolls down far enough to trigger pagination (load-more), the dropdown must keep the user's current scroll position — not yank the view back up to the currently-selected item. Appending new items at the bottom should feel like a natural infinite scroll; prepending items at the top should also preserve visual position (this half already works).

**Architecture:** Root cause is the scroll-to-highlighted-option `useEffect` at `ListsItemRow.jsx:1606-1684`, whose dependency array is `[highlightedIdx, displayItems.length]`. When pagination appends 21 new items to `browseItems`, `displayItems.length` changes, the effect re-runs, reads the unchanged `highlightedIdx` (pointing to the originally-selected item near the top of the list), sees the highlighted option is now "off-screen" (because the user scrolled down past it), and ease-snaps the viewport back up to that option. Fix: introduce a `paginationInFlightRef` that the onScroll handler sets before calling `setBrowseItems`, and have the scroll-to-highlighted effect consume-and-clear that flag, early-returning without scrolling on the very next fire triggered by the pagination-induced length change.

**Tech Stack:** React (`useEffect`, `useRef`, `useCallback`), `requestAnimationFrame` for scroll animation, Mantine `Combobox.Options` rendered inside a scrollable `<div>` via `ref={optionsRef}`.

**Worktree note:** This plan should execute in a dedicated git worktree off `main`. Create one via superpowers:using-git-worktrees before Task 1.

---

## File Structure

**Modify:**
- `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx` — add `paginationInFlightRef` (~near other refs at line 742-747); set it in the onScroll handler before `setBrowseItems` (lines 1968, 1988); consume-and-clear it at the top of the scroll-to-highlighted effect (line 1606).

**Test (new file):**
- `tests/isolated/modules/Admin/paginationScrollGuard.test.mjs` — unit tests for the extracted guard logic.

---

## Task 1: Extract the scroll-decision logic as a pure function

**Files:**
- Create: `frontend/src/modules/Admin/ContentLists/comboboxScroll.js`
- Test: `tests/isolated/modules/Admin/paginationScrollGuard.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/modules/Admin/paginationScrollGuard.test.mjs
import { describe, it, expect } from 'vitest';
import { shouldRunScrollToHighlighted } from '#frontend/modules/Admin/ContentLists/comboboxScroll.js';

describe('shouldRunScrollToHighlighted', () => {
  it('returns false when highlightedIdx is negative', () => {
    expect(shouldRunScrollToHighlighted({
      highlightedIdx: -1, prevIdx: 5, paginationInFlight: false
    })).toEqual({ run: false, reason: 'no-highlight' });
  });

  it('returns false on initial render (prevIdx === -1)', () => {
    expect(shouldRunScrollToHighlighted({
      highlightedIdx: 3, prevIdx: -1, paginationInFlight: false
    })).toEqual({ run: false, reason: 'initial-render' });
  });

  it('returns false when pagination is in flight (append)', () => {
    expect(shouldRunScrollToHighlighted({
      highlightedIdx: 3, prevIdx: 3, paginationInFlight: true
    })).toEqual({ run: false, reason: 'pagination' });
  });

  it('returns true when highlightedIdx actually changed', () => {
    expect(shouldRunScrollToHighlighted({
      highlightedIdx: 4, prevIdx: 3, paginationInFlight: false
    })).toEqual({ run: true, reason: 'navigation' });
  });

  it('returns false when highlightedIdx did not change and no pagination', () => {
    // This covers benign re-runs from unrelated state changes.
    expect(shouldRunScrollToHighlighted({
      highlightedIdx: 3, prevIdx: 3, paginationInFlight: false
    })).toEqual({ run: false, reason: 'no-change' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/modules/Admin/paginationScrollGuard.test.mjs`
Expected: FAIL with `Cannot find module '#frontend/modules/Admin/ContentLists/comboboxScroll.js'`

- [ ] **Step 3: Write minimal implementation**

```javascript
// frontend/src/modules/Admin/ContentLists/comboboxScroll.js

/**
 * Decide whether the scroll-to-highlighted-option effect should run.
 *
 * The effect re-fires when either highlightedIdx changes OR when displayItems.length
 * changes. The length-change case covers pagination load-more. We must NOT scroll
 * on pagination re-fires — that yanks the user's viewport back to the selected item.
 *
 * @param {object} args
 * @param {number} args.highlightedIdx - current highlighted option index
 * @param {number} args.prevIdx - previous highlighted index (ref.current)
 * @param {boolean} args.paginationInFlight - true if onScroll just dispatched a load-more
 * @returns {{ run: boolean, reason: string }}
 */
export function shouldRunScrollToHighlighted({ highlightedIdx, prevIdx, paginationInFlight }) {
  if (highlightedIdx < 0) return { run: false, reason: 'no-highlight' };
  if (prevIdx === -1) return { run: false, reason: 'initial-render' };
  if (paginationInFlight) return { run: false, reason: 'pagination' };
  if (highlightedIdx === prevIdx) return { run: false, reason: 'no-change' };
  return { run: true, reason: 'navigation' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/modules/Admin/paginationScrollGuard.test.mjs`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/comboboxScroll.js \
        tests/isolated/modules/Admin/paginationScrollGuard.test.mjs
git commit -m "test(admin-combobox): extract pagination-aware scroll decision"
```

---

## Task 2: Add `paginationInFlightRef` and wire it in the onScroll handler

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx`

- [ ] **Step 1: Add the ref near other refs**

Read lines 742-747 of `ListsItemRow.jsx` to find the existing ref declarations (`optionsRef`, `blurTimeoutRef`, `prevIdxRef`, `scrollAnimRef`, `autoResolveRef`, `userNavigatedRef`). Add one more line right after them:

```javascript
  const paginationInFlightRef = useRef(false);
```

- [ ] **Step 2: Set the flag in the onScroll "load more after" branch**

Read lines 1962-1980 (the "Load more after" section inside `onScroll`). Modify the setter so the flag is raised BEFORE updating state:

```javascript
            if (pagination.hasAfter && scrollHeight - scrollTop - clientHeight < 50) {
              // Load more after
              const offset = pagination.offset + pagination.window;
              setLoadingMore(true);
              paginationInFlightRef.current = true;
              log.debug('pagination.load_more.after', { offset, window: pagination.window });
              fetchSiblingsPage(value, contentInfo, offset, 21).then(result => {
                if (result) {
                  setBrowseItems(prev => [...prev, ...result.items]);
                  setPagination(prev => {
                    if (!prev) return result.pagination;
                    const newWindow = prev.window + result.items.length;
                    return { ...prev, window: newWindow, hasAfter: prev.offset + newWindow < prev.total };
                  });
                }
                setLoadingMore(false);
              });
            }
```

- [ ] **Step 3: Set the flag in the onScroll "load more before" branch**

Read lines 1981-2006. Modify the setter similarly, raising the flag before `setBrowseItems`. The prepend path already handles scroll preservation explicitly (the `requestAnimationFrame` block that adjusts `scrollTop` by the height delta), so the flag just prevents the scroll-to-highlighted effect from running concurrently.

```javascript
            if (pagination.hasBefore && scrollTop < 50) {
              // Load more before
              const newOffset = Math.max(0, pagination.offset - 21);
              const limit = Math.min(21, pagination.offset);
              if (limit <= 0) return;
              setLoadingMore(true);
              paginationInFlightRef.current = true;
              log.debug('pagination.load_more.before', { newOffset, limit });
              const prevScrollHeight = e.currentTarget.scrollHeight;
              fetchSiblingsPage(value, contentInfo, newOffset, limit).then(result => {
                if (result) {
                  setBrowseItems(prev => [...result.items, ...prev]);
                  setPagination(prev => {
                    if (!prev) return result.pagination;
                    const newWindow = prev.window + result.items.length;
                    return { ...prev, offset: newOffset, window: newWindow, hasBefore: newOffset > 0 };
                  });
                  // Maintain scroll position after prepending
                  requestAnimationFrame(() => {
                    if (optionsRef.current) {
                      const newScrollHeight = optionsRef.current.scrollHeight;
                      optionsRef.current.scrollTop += (newScrollHeight - prevScrollHeight);
                    }
                  });
                }
                setLoadingMore(false);
              });
            }
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "feat(admin-combobox): track pagination-in-flight for scroll guard"
```

---

## Task 3: Consume the flag at the top of the scroll-to-highlighted effect

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx:1606-1684`

- [ ] **Step 1: Add import**

Near the other imports from `./` in `ListsItemRow.jsx`, add:

```javascript
import { shouldRunScrollToHighlighted } from './comboboxScroll.js';
```

- [ ] **Step 2: Insert the guard check at the top of the effect**

Read lines 1606-1684. Replace the first block (lines 1606-1630) with the guard-first version:

```javascript
  // Minimal scroll behavior: only nudge when a navigation option changes,
  // not when the list grows due to pagination.
  useEffect(() => {
    if (scrollAnimRef.current) cancelAnimationFrame(scrollAnimRef.current);

    const decision = shouldRunScrollToHighlighted({
      highlightedIdx,
      prevIdx: prevIdxRef.current,
      paginationInFlight: paginationInFlightRef.current,
    });

    if (decision.reason === 'pagination') {
      log.debug('scroll.skip.pagination', { highlightedIdx, prevIdx: prevIdxRef.current });
      paginationInFlightRef.current = false;
      prevIdxRef.current = highlightedIdx;
      return;
    }

    if (!decision.run) {
      // Skip for no-highlight, initial-render, or no-change cases.
      prevIdxRef.current = highlightedIdx;
      return;
    }

    if (!optionsRef.current) {
      prevIdxRef.current = highlightedIdx;
      return;
    }

    const container = optionsRef.current;
    const opts = container.querySelectorAll('[data-value]');
    const option = opts[highlightedIdx];
    if (!option) {
      prevIdxRef.current = highlightedIdx;
      return;
    }

    const prevIdx = prevIdxRef.current;
    const itemCount = opts.length;
```

- [ ] **Step 3: Keep the rest of the effect unchanged**

Lines 1632-1684 (pac-man wrap detection, ease-snap animation, `prevIdxRef.current = highlightedIdx;` at the bottom, cleanup return) remain as-is. The dependency array at line 1684 stays `[highlightedIdx, displayItems.length]` — we still need the effect to re-fire on length change so the guard can clear the flag.

- [ ] **Step 4: Smoke build**

Run:
```bash
npx vite build --logLevel=warn 2>&1 | tail -30
```

Expected: build succeeds.

- [ ] **Step 5: Manual verify**

Start dev server. In the admin UI:

1. Open a ContentList, click a row with a `singalong:hymn/*` or `plex:*` value that has many siblings.
2. Watch initial scroll land on the current item (this still works via `scrollOptionIntoView` called in `fetchSiblings`).
3. Scroll down manually with the mouse wheel or trackpad. Near the bottom, pagination fires.
4. **Expected:** new items appear below, user's scroll position stays put (continues where they were). No snap back to the selected item.
5. Scroll up to the top. Pagination fires (prepend). **Expected:** new items appear above, visible item stays visually stable.
6. Use arrow keys to navigate. The ease-snap to keep the highlighted option in view should still work.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "fix(admin-combobox): skip scroll-to-highlighted when pagination is in flight"
```

---

## Task 4: Instrument scroll telemetry for regression detection

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx` — inside the `onScroll` handler on the dropdown

- [ ] **Step 1: Add a throttled scroll event**

Read lines 1958-2007 (the `onScroll` block). Before the `if (!pagination || ...)` guard, add a lightweight sampled log. `log.sampled` is already exposed on the logger (see CLAUDE.md Logging section).

```javascript
        <Combobox.Options
          mah={280}
          style={{ overflowY: 'auto' }}
          ref={optionsRef}
          onScroll={(e) => {
            const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
            log.sampled?.('scroll.position', {
              scrollTop: Math.round(scrollTop),
              scrollHeight,
              clientHeight,
              itemCount: displayItems.length,
            }, { maxPerMinute: 12, aggregate: true });

            if (!pagination || loadingMore || isActiveSearch) return;
            // ... existing logic
```

If `log.sampled` is not present on the current admin logger (check with `grep 'sampled' frontend/src/lib/logging/`), fall back to `log.debug` inside a throttle ref. The optional-chaining `?.` means the log is simply no-op'd if unavailable — don't add new infrastructure if it doesn't exist.

- [ ] **Step 2: Manual verify log emission**

Scroll the combobox dropdown in the admin UI. Tail the admin log file — expect up to 12 `scroll.position` events per minute while scrolling, with itemCount growing as pagination fires.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "feat(admin-combobox): emit sampled scroll.position events"
```

---

## Task 5: Playwright smoke test for scroll stickiness

**Files:**
- Create: `tests/live/flow/admin/admin-combobox-scroll-sticky.runtime.test.mjs`

- [ ] **Step 1: Write the flow test**

```javascript
// tests/live/flow/admin/admin-combobox-scroll-sticky.runtime.test.mjs
import { test, expect } from '@playwright/test';
import { getAppUrl } from '../../../_lib/configHelper.mjs';

test('combobox keeps user scroll position after pagination load-more', async ({ page }) => {
  const base = await getAppUrl();
  await page.goto(`${base}/admin`);

  // Navigate to a list with a row whose value has many siblings (hymns, plex albums, etc.)
  // Adjust selector to your admin's actual navigation.
  await page.getByRole('link', { name: /menus|lists|fhe/i }).first().click();

  // Click a row that will trigger sibling pagination.
  const paginatedRow = page.locator('[data-content-value^="singalong:hymn/"], [data-content-value^="plex:"]').first();
  await paginatedRow.click();

  const dropdown = page.locator('[role="listbox"]').first();
  await expect(dropdown).toBeVisible();

  // Wait for sibling items to render.
  await page.waitForTimeout(300);

  // Capture initial scroll state.
  const initialScroll = await dropdown.evaluate(el => ({ top: el.scrollTop, items: el.querySelectorAll('[data-value]').length }));

  // Scroll to bottom to trigger pagination.
  await dropdown.evaluate(el => { el.scrollTop = el.scrollHeight; });

  // Wait for pagination to fire and new items to append.
  await page.waitForFunction(
    (initialCount) => {
      const el = document.querySelector('[role="listbox"]');
      return el && el.querySelectorAll('[data-value]').length > initialCount;
    },
    initialScroll.items,
    { timeout: 3000 }
  );

  // Verify the scroll position did NOT snap back to the top / selected item.
  const afterScroll = await dropdown.evaluate(el => el.scrollTop);

  // Allow some tolerance (browser may scroll a few px when new content arrives), but
  // assert we're still clearly below the initial position of the selected item.
  expect(afterScroll).toBeGreaterThan(initialScroll.top + 100);
});
```

- [ ] **Step 2: Run the test**

```bash
npx playwright test tests/live/flow/admin/admin-combobox-scroll-sticky.runtime.test.mjs --reporter=line
```

If selectors don't match actual DOM, run with `--headed` and adjust. Re-run until PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/live/flow/admin/admin-combobox-scroll-sticky.runtime.test.mjs
git commit -m "test(admin-combobox): add playwright flow for scroll stickiness"
```

---

## Final Verification

- [ ] Unit tests green: `npx vitest run tests/isolated/modules/Admin/paginationScrollGuard.test.mjs`
- [ ] Playwright flow green: `npx playwright test tests/live/flow/admin/admin-combobox-scroll-sticky.runtime.test.mjs --reporter=line`
- [ ] Manual QA checklist (Task 3 Step 5):
  - [ ] Initial scroll lands on selected item
  - [ ] Scroll down → pagination appends → position stays put
  - [ ] Scroll up → pagination prepends → position stays visually stable
  - [ ] Arrow-key navigation still ease-snaps the highlighted option into view
  - [ ] Pac-man wrap (arrow past first/last) still jumps instantly
- [ ] No regressions in: drill-down, go-up, breadcrumb navigation (each should still scroll-to-reference-item via `scrollOptionIntoView`)
- [ ] Log events: `pagination.load_more.after/before`, `scroll.skip.pagination`, `scroll.position` (sampled) all visible in `media/logs/admin/*.jsonl` during a real session
