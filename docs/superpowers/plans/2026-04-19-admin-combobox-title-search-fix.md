# Admin Combobox Title Search Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an admin user types free text (e.g. "redeemer") into the ContentList combobox while a `singalong:hymn/N` value is already selected, the combobox must return matching hymns from anywhere in the collection — not just hymns within the currently paginated browse window.

**Architecture:** Root cause is a "local-filter-only" gate in the ContentSearchCombobox inside `ListsItemRow.jsx`. When the typed query starts with the current value's source prefix AND browse items are loaded, the search effect early-returns without hitting the backend. The render falls back to filtering the in-memory paginated window (~20 items around the current hymn), so titles outside that window are invisible. Fix: remove the early return so the backend search always runs; in render, prefer backend `searchResults` over the local filter when they have content; keep local filter only as an instant-response fallback while backend is in flight.

**Tech Stack:** React + Mantine Combobox, `useDebouncedValue` (300ms), Fetch against `/api/v1/content/query/search?tier=1|2`, backend `SingalongAdapter.search()` (already supports title `.includes` matching).

**Worktree note:** This plan should execute in a dedicated git worktree off `main`, not on the current `fix/audio-nudge-loop` branch. Create one via superpowers:using-git-worktrees before Task 1.

---

## File Structure

**Modify:**
- `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx` — remove local-filter gate in search effect (lines 825-830); tweak `displayItems` selection logic at line 1481-1488; add new log events.

**Test (new file):**
- `tests/isolated/modules/Admin/contentSearchLogic.test.mjs` — unit tests for pure logic extracted from the render function (canFilterLocally, displayItems resolver).

**Verify (existing):**
- `backend/src/1_adapters/content/singalong/SingalongAdapter.mjs` — confirm `search()` already matches titles. It does (lines 322-361: `item.title?.toLowerCase().includes(searchText)`). No backend change required.

---

## Task 1: Extract `resolveDisplayItems` as pure function

**Files:**
- Create: `frontend/src/modules/Admin/ContentLists/contentSearchLogic.js`
- Test: `tests/isolated/modules/Admin/contentSearchLogic.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/modules/Admin/contentSearchLogic.test.mjs
import { describe, it, expect } from 'vitest';
import { resolveDisplayItems } from '#frontend/modules/Admin/ContentLists/contentSearchLogic.js';

describe('resolveDisplayItems', () => {
  const browseItems = [
    { value: 'singalong:hymn/193', title: 'I Stand All Amazed' },
    { value: 'singalong:hymn/194', title: 'There Is a Green Hill Far Away' },
    { value: 'singalong:hymn/195', title: 'How Great Thou Art' },
  ];
  const searchResults = [
    { value: 'singalong:hymn/136', title: 'I Know That My Redeemer Lives' },
  ];

  it('returns browseItems when not actively searching', () => {
    const out = resolveDisplayItems({
      isActiveSearch: false,
      searchQuery: '',
      sourcePrefix: 'singalong',
      browseItems,
      searchResults: [],
    });
    expect(out.items).toBe(browseItems);
    expect(out.mode).toBe('browse');
  });

  it('prefers backend searchResults when available', () => {
    const out = resolveDisplayItems({
      isActiveSearch: true,
      searchQuery: 'singalong:redeemer',
      sourcePrefix: 'singalong',
      browseItems,
      searchResults,
    });
    expect(out.items).toBe(searchResults);
    expect(out.mode).toBe('backend');
  });

  it('falls back to local filter when backend has no results yet', () => {
    const out = resolveDisplayItems({
      isActiveSearch: true,
      searchQuery: 'singalong:amazed',
      sourcePrefix: 'singalong',
      browseItems,
      searchResults: [],
    });
    expect(out.mode).toBe('local');
    expect(out.items).toHaveLength(1);
    expect(out.items[0].title).toBe('I Stand All Amazed');
  });

  it('returns empty list when neither backend nor local match', () => {
    const out = resolveDisplayItems({
      isActiveSearch: true,
      searchQuery: 'singalong:redeemer',
      sourcePrefix: 'singalong',
      browseItems,
      searchResults: [],
    });
    expect(out.items).toEqual([]);
    expect(out.mode).toBe('local');
  });

  it('returns empty array when no query prefix match and backend empty', () => {
    const out = resolveDisplayItems({
      isActiveSearch: true,
      searchQuery: 'redeemer',
      sourcePrefix: 'singalong',
      browseItems,
      searchResults: [],
    });
    expect(out.items).toEqual([]);
    expect(out.mode).toBe('backend');
  });

  it('filters by item number prefix', () => {
    const out = resolveDisplayItems({
      isActiveSearch: true,
      searchQuery: 'singalong:hymn/19',
      sourcePrefix: 'singalong',
      browseItems,
      searchResults: [],
    });
    expect(out.items.map(i => i.value)).toEqual([
      'singalong:hymn/193', 'singalong:hymn/194', 'singalong:hymn/195'
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/modules/Admin/contentSearchLogic.test.mjs`
Expected: FAIL with `Cannot find module '#frontend/modules/Admin/ContentLists/contentSearchLogic.js'`

- [ ] **Step 3: Write minimal implementation**

```javascript
// frontend/src/modules/Admin/ContentLists/contentSearchLogic.js

/**
 * Resolve which items to show in the combobox dropdown.
 *
 * Decision rules:
 * - Not searching: show browseItems (siblings of current value).
 * - Searching with backend results: prefer backend (covers whole collection).
 * - Searching with no backend results: fall back to local filter over browseItems
 *   so users see instant response while backend is in flight.
 *
 * @param {object} args
 * @param {boolean} args.isActiveSearch - searchQuery has >= 2 chars and != current value
 * @param {string} args.searchQuery - raw search input
 * @param {string} args.sourcePrefix - current value's source (e.g. 'singalong', 'plex')
 * @param {Array}  args.browseItems - paginated siblings currently loaded
 * @param {Array}  args.searchResults - backend tier-1/tier-2 results
 * @returns {{items: Array, mode: 'browse'|'backend'|'local'}}
 */
export function resolveDisplayItems({
  isActiveSearch,
  searchQuery,
  sourcePrefix,
  browseItems,
  searchResults,
}) {
  if (!isActiveSearch) {
    return { items: browseItems, mode: 'browse' };
  }

  if (searchResults && searchResults.length > 0) {
    return { items: searchResults, mode: 'backend' };
  }

  const queryMatchesSource = sourcePrefix && searchQuery.startsWith(sourcePrefix + ':');
  if (!queryMatchesSource) {
    return { items: [], mode: 'backend' };
  }

  const localFilterQuery = searchQuery.split(':').slice(1).join(':').trim().toLowerCase();
  const filtered = browseItems.filter(item => {
    if (!localFilterQuery) return true;
    const num = item.value?.split(':')[1]?.trim();
    return (num && num.startsWith(localFilterQuery))
        || item.title?.toLowerCase().includes(localFilterQuery);
  });
  return { items: filtered, mode: 'local' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/modules/Admin/contentSearchLogic.test.mjs`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/contentSearchLogic.js \
        tests/isolated/modules/Admin/contentSearchLogic.test.mjs
git commit -m "test(admin-combobox): extract resolveDisplayItems with title search coverage"
```

---

## Task 2: Remove the backend-skip gate in the search effect

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx:825-830`

- [ ] **Step 1: Read the current gate**

Read lines 812-895 of `ListsItemRow.jsx`. Confirm lines 825-830 match:

```javascript
    // Don't search backend when user is refining within loaded browse items (e.g. hymn: 113)
    const prefix = value?.split(':')[0];
    if (prefix && debouncedSearch.startsWith(prefix + ':') && browseItems.length > 0) {
      log.debug('search.skip.local_filter', { debouncedSearch, prefix, browseItemCount: browseItems.length });
      return;
    }
```

- [ ] **Step 2: Delete the gate**

Replace the 5-line block (825-830) with a single-line comment marker so the surrounding context stays readable:

```javascript
    // Always dispatch backend search — local filter in render handles instant response while in flight.
```

Leave line 819-824 (the `debouncedSearch === value` skip) intact — that one is correct; it prevents searching for the literal existing value when just opening the dropdown.

- [ ] **Step 3: Verify manually via dev server**

Run the dev server:
```bash
node backend/index.js > /tmp/backend-dev.log 2>&1 &
```

Open the admin app at the app port (`lsof -i :3111` or `:3112` depending on host), navigate to a ContentList with a `singalong:hymn/*` row, click the row's content field, clear the "hymn/195" portion leaving `singalong:`, then type `redeemer`.

Expected: network tab shows `GET /api/v1/content/query/search?text=singalong%3Aredeemer&take=20&tier=1`. Tail `media/logs/admin/*.jsonl` (or docker exec equivalent) for a fresh `search.request` event with `query: "singalong:redeemer"`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "fix(admin-combobox): always dispatch backend search; drop local-only skip gate"
```

---

## Task 3: Wire `resolveDisplayItems` into the render path

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx:1467-1489`

- [ ] **Step 1: Read current displayItems logic**

Read lines 1467-1489 of `ListsItemRow.jsx`. The current block computes `normalizedValue`, `isActiveSearch`, `sourcePrefix`, `queryMatchesSource`, `localFilterQuery`, `canFilterLocally`, and `displayItems`.

- [ ] **Step 2: Add import**

At the top of `ListsItemRow.jsx` (near other local imports from `./` or `../`), add:

```javascript
import { resolveDisplayItems } from './contentSearchLogic.js';
```

- [ ] **Step 3: Replace the displayItems block**

Replace lines 1475-1488 (from `// When browseItems are loaded...` through the end of the `displayItems` ternary) with:

```javascript
  const sourcePrefix = value?.split(':')[0];
  const { items: displayItems, mode: displayMode } = resolveDisplayItems({
    isActiveSearch,
    searchQuery,
    sourcePrefix,
    browseItems,
    searchResults,
  });
  // Kept for downstream checks that reference these locals
  const queryMatchesSource = sourcePrefix && searchQuery.startsWith(sourcePrefix + ':');
  const canFilterLocally = displayMode === 'local';
  const localFilterQuery = queryMatchesSource ? searchQuery.split(':').slice(1).join(':').trim() : '';
```

Keep lines 1467-1473 (the `normalizeValue` helper and `isActiveSearch` calc) unchanged.

- [ ] **Step 4: Search for downstream references**

Run:
```
grep -n "canFilterLocally\|localFilterQuery\|queryMatchesSource" frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
```

Each match must still make sense. `canFilterLocally` is referenced at line ~2015 for the "No results found" empty-state. `localFilterQuery` is not read outside the removed block. `queryMatchesSource` is also only referenced inside the removed block. If the grep shows references outside the block, read them and confirm semantics match the new values.

- [ ] **Step 5: Lint + smoke build**

Run:
```bash
npx vite build --logLevel=warn 2>&1 | tail -30
```

Expected: build succeeds, no type/parse errors from the Admin file.

- [ ] **Step 6: Manual verify**

Restart dev server if needed. In the admin UI with `singalong:hymn/195` selected:

- Type `singalong:redeemer` → expect "I Know That My Redeemer Lives" (hymn 136) to appear within ~400ms.
- Type `singalong:amaz` → expect "I Stand All Amazed" (in the initial sibling window) to appear instantly via local filter, then backend may add more title matches.
- Type `redeemer` (no prefix) → expect results from tier-1 or tier-2 across all sources.
- Clear input and arrow-down through siblings → expect normal sibling browsing, no backend search firing.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "fix(admin-combobox): prefer backend results over local sibling filter"
```

---

## Task 4: Add observability — `search.source` log event

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx` — around the new `displayMode` computation (~line 1482)

- [ ] **Step 1: Add a logging effect**

Below the `resolveDisplayItems` call (inside the component body, after line 1484), add:

```javascript
  const lastDisplayModeRef = useRef(null);
  useEffect(() => {
    if (!isActiveSearch) {
      lastDisplayModeRef.current = null;
      return;
    }
    if (lastDisplayModeRef.current !== displayMode) {
      log.debug('display.mode', {
        query: searchQuery,
        mode: displayMode,
        itemCount: displayItems.length,
        browseItemCount: browseItems.length,
        searchResultCount: searchResults.length,
      });
      lastDisplayModeRef.current = displayMode;
    }
  }, [displayMode, isActiveSearch, searchQuery, displayItems.length, browseItems.length, searchResults.length, log]);
```

`useRef` is already imported at the top of the file. `useEffect` is already imported.

- [ ] **Step 2: Manual verify log emission**

Run the dev server. In the admin UI, open a content row, type a query that currently returns 0 results locally but should return hits from backend. Tail the admin log file and confirm:

- `display.mode` with `mode:"local"` then `mode:"backend"` as backend resolves
- `search.request` event already exists and fires
- `search.results` event already exists and fires

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "feat(admin-combobox): emit display.mode events for search observability"
```

---

## Task 5: Playwright smoke test for hymn title search

**Files:**
- Create: `tests/live/flow/admin/admin-hymn-title-search.runtime.test.mjs`

- [ ] **Step 1: Write the flow test**

```javascript
// tests/live/flow/admin/admin-hymn-title-search.runtime.test.mjs
import { test, expect } from '@playwright/test';
import { getAppUrl } from '../../../_lib/configHelper.mjs';

test('admin combobox finds hymn by title from inside a different hymn value', async ({ page }) => {
  const base = await getAppUrl();
  await page.goto(`${base}/admin`);

  // Navigate to an FHE-like list that contains a singalong:hymn/N row.
  // This assumes the admin home shows lists; adjust selector to match your routes.
  await page.getByRole('link', { name: /menus|lists|fhe/i }).first().click();

  // Click the first row whose current value is a singalong hymn.
  const hymnRow = page.locator('[data-content-value^="singalong:hymn/"]').first();
  await hymnRow.click();

  // Clear the input and type 'redeemer' within the singalong scope.
  const input = page.locator('input[placeholder*="Search"], input[data-combobox]').first();
  await input.fill('singalong:redeemer');

  // Wait for backend results.
  const option = page.getByRole('option', { name: /redeemer lives/i });
  await expect(option).toBeVisible({ timeout: 3000 });
});
```

- [ ] **Step 2: Run the test**

```bash
npx playwright test tests/live/flow/admin/admin-hymn-title-search.runtime.test.mjs --reporter=line
```

Expected: PASS if the fix is in place. If the selectors don't match your actual admin DOM, inspect with `--headed` and update selectors accordingly — then re-run.

- [ ] **Step 3: Commit**

```bash
git add tests/live/flow/admin/admin-hymn-title-search.runtime.test.mjs
git commit -m "test(admin-combobox): add playwright flow for hymn title search"
```

---

## Final Verification

- [ ] All unit tests green: `npx vitest run tests/isolated/modules/Admin/contentSearchLogic.test.mjs`
- [ ] Playwright flow green: `npx playwright test tests/live/flow/admin/admin-hymn-title-search.runtime.test.mjs --reporter=line`
- [ ] Manual QA pass (Task 3 Step 6 checklist)
- [ ] No regressions in sibling browsing (arrow-key navigation, drill-down into containers, go-up, breadcrumb navigation)
- [ ] Log file shows expected events: `search.request`, `search.results`, `display.mode`
