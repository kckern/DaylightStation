# Combobox Scroll-To-Selected On Open — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When the content combobox opens on a list row that already has a committed value, scroll the browse list so the currently-selected item is visible (~1.5 rows from the top) instead of leaving the list pinned at the top of the centered window.

**Architecture:** The backend already centers a 21-item window (10 above + reference + 10 below) on the committed item and returns the correct `referenceIndex` — verified in `SiblingsService.#applyWindow`. The frontend's browse-level positioner effect in `ContentCombobox.jsx` receives that reference (`state.highlight.idx`) but fails to scroll to it on open, because it fires on a single `requestAnimationFrame` keyed only on `levelKey` — and on the dropdown-open sequence the `ScrollArea` viewport / target option node is not yet laid out on that frame (or the browse items populate in a later commit). The effect bails and the viewport stays at `scrollTop 0`. Fix: extract a pure `shouldPositionLevel` decision (unit-tested), then rework the effect to (a) also re-run when items populate and the reference index settles, (b) position exactly once per browse level via a ref guard so pagination and user navigation never yank the viewport, and (c) retry across a few animation frames until the option is actually laid out.

**Tech Stack:** React (hooks), Mantine `Combobox` + `ScrollArea.Autosize`, Vitest (frontend unit), Playwright (`.runtime.test.mjs` live flow).

---

## Root-Cause Evidence (already gathered — do not re-investigate)

- Reproduction (row 6 of `/admin/content/lists/menus/fhe`, label "Alan", bound to **Elijah the Prophet — S8 E33**, `plex:642197`): on open the dropdown shows the browse level "Season 8" scrolled to the **top of the window** (episodes 23–28 visible). The selected item (E33) is highlighted but off-screen ~5 rows below. Answer to "is the selected item in view on open?": **No.**
- Backend `backend/src/3_applications/content/services/SiblingsService.mjs:158-202` (`#applyWindow`, initial mode): centers a 21-item window on the reference. For E33 → window = episodes 23–43, `referenceIndex = 10`. This exactly matches the observed window start (E23), confirming the **data is correct**.
- Frontend `frontend/src/modules/Admin/ContentLists/combobox/useContentCombobox.js:305-319` (`applyBrowseData`) dispatches `BROWSE_LOADED` with that `referenceIndex`; the machine (`comboboxMachine.js:117-120`) sets `highlight.idx = referenceIndex`. So on open `highlightIdx` is a valid in-window index (10), NOT -1.
- The failing writer is the browse-level positioner effect at `frontend/src/modules/Admin/ContentLists/combobox/ContentCombobox.jsx:287-307` (single `requestAnimationFrame`, deps `[levelKey]`). The separate scroll-to-highlighted effect (`ContentCombobox.jsx:311-384`) deliberately defers on open via `shouldRunScrollToHighlighted` returning `initial-render` when `prevIdx === -1` (`comboboxScroll.js`). So the positioner is solely responsible for open positioning — and it is the bug.

**Relevant constants for the fix/test:**
- Option row class: `OPTION_CLASS = 'content-combobox-option'` (`ContentCombobox.jsx:62`).
- Selected row also gets class `current`; highlighted row gets `highlighted` (`ContentCombobox.jsx` renderOption).
- Scroll viewport element: `ScrollArea.Autosize` with `viewportRef={viewportRef}` (`ContentCombobox.jsx:626-628`).
- `optionTopIn(viewport, option)` helper (`ContentCombobox.jsx:73-75`).
- List page rows: `.item-row`; the picker cell inside a row: `.col-input .content-display` (see existing `tests/live/flow/admin/combobox-scroll-behavior.runtime.test.mjs`).

---

## Pre-flight (do this before Task 1)

**A clean dev server for the MAIN checkout is required.** A stray Vite from a different worktree may already hold the app port — it will 404 the admin route and confuse the live test.

**Step: verify the app port serves THIS tree's admin route**

Run:
```bash
# App port from system config (kckern-macbook default 3111)
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3111/admin/content/lists/menus/fhe
ps aux | grep -E 'vite' | grep -v grep
```
Expected: `200`, and the `vite` process path is under the main repo (NOT under `.worktrees/...`). If it is `404` or the vite path points at another worktree, stop that server and start a clean one:
```bash
pkill -f 'node backend/index.js'; pkill -f vite
npm run dev      # tees to dev.log; wait for "ready" then re-run the curl above
```

---

## Task 1: Failing live regression — selected item must be in view on open

**Files:**
- Create: `tests/live/flow/admin/combobox-open-scroll-to-selected.runtime.test.mjs`

**Step 1: Write the failing test**

```javascript
import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';

// Row 6 of the FHE menu ("Alan") is bound to a Plex episode deep in a season
// (Elijah the Prophet — S8 E33). On open the browse window is centered on that
// episode (E23..E43), so the selected row sits ~10 rows down. It must be
// scrolled into view on open, not left at the top of the window.
const PAGE_URL = `${FRONTEND_URL}/admin/content/lists/menus/fhe`;
const REFERENCE_INPUT_TEXT = /Elijah the Prophet/i;

test.describe.serial('Combobox — selected item visible on open', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    page = await context.newPage();
  });

  test.afterAll(async () => { if (page) await page.close(); });

  test('opens the picker centered on the committed selection', async () => {
    await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.items-container', { timeout: 15000 });

    // Find the row whose committed input is the reference episode, open its picker.
    const row = page.locator('.item-row', { hasText: REFERENCE_INPUT_TEXT }).first();
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.scrollIntoViewIfNeeded();
    const picker = row.locator('.col-input .content-display');
    await expect(picker).toBeVisible({ timeout: 5000 });
    await picker.click();

    // Wait for the browse window to render enough options.
    await page.waitForFunction(
      () => document.querySelectorAll('.content-combobox-option[data-value]').length > 5,
      { timeout: 10000 },
    );
    // Allow the open-positioning to settle.
    await page.waitForTimeout(500);

    const result = await page.evaluate(() => {
      const current = document.querySelector('.content-combobox-option.current')
        || document.querySelector('.content-combobox-option.highlighted');
      if (!current) return { found: false };
      // Nearest scrollable ancestor (the ScrollArea viewport).
      let vp = current.parentElement;
      while (vp && !(vp.scrollHeight > vp.clientHeight && vp.clientHeight > 0)) vp = vp.parentElement;
      if (!vp) return { found: true, hasViewport: false };
      const c = current.getBoundingClientRect();
      const v = vp.getBoundingClientRect();
      return {
        found: true,
        hasViewport: true,
        text: current.textContent.trim().slice(0, 60),
        scrollTop: Math.round(vp.scrollTop),
        isFullyVisible: c.top >= v.top - 1 && c.bottom <= v.bottom + 1,
      };
    });

    console.log('   open-position result:', JSON.stringify(result));
    expect(result.found, 'a current/highlighted option should exist on open').toBe(true);
    expect(result.hasViewport, 'a scrollable viewport should wrap the options').toBe(true);
    expect(result.isFullyVisible, 'the selected item must be fully in view on open').toBe(true);
  });
});
```

**Step 2: Run the test to verify it FAILS**

Run:
```bash
npx playwright test tests/live/flow/admin/combobox-open-scroll-to-selected.runtime.test.mjs --reporter=line
```
Expected: FAIL on `isFullyVisible` — the log shows `scrollTop: 0` and `isFullyVisible: false` (the bug). If it fails earlier (row/picker not found) fix selectors before proceeding — do NOT weaken the visibility assertion.

**Step 3: Commit the red test**

```bash
git add tests/live/flow/admin/combobox-open-scroll-to-selected.runtime.test.mjs
git commit -m "test(admin): failing regression — combobox must scroll selected item into view on open"
```

---

## Task 2: Pure `shouldPositionLevel` decision + unit tests

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/comboboxScroll.js` (append new export)
- Modify: `frontend/src/modules/Admin/ContentLists/comboboxScroll.test.js` (append describe block)

**Step 1: Write the failing unit test**

Append to `comboboxScroll.test.js`:
```javascript
import { shouldPositionLevel } from './comboboxScroll.js';

describe('shouldPositionLevel', () => {
  const base = { levelKey: 'b:s8', positionedLevel: null, highlightIdx: 10, itemsLength: 21 };

  it('positions the first time a browse level presents its reference with items', () => {
    expect(shouldPositionLevel(base)).toEqual({ run: true, reason: 'position' });
  });

  it('does not run when not browsing', () => {
    expect(shouldPositionLevel({ ...base, levelKey: null }).run).toBe(false);
  });

  it('does not re-run for a level already positioned (no viewport yank)', () => {
    expect(shouldPositionLevel({ ...base, positionedLevel: 'b:s8' }))
      .toEqual({ run: false, reason: 'already-positioned' });
  });

  it('waits when there is no reference row (idx -1)', () => {
    expect(shouldPositionLevel({ ...base, highlightIdx: -1 }))
      .toEqual({ run: false, reason: 'no-reference' });
  });

  it('waits until browse items have populated', () => {
    expect(shouldPositionLevel({ ...base, itemsLength: 0 }))
      .toEqual({ run: false, reason: 'no-items' });
  });
});
```

**Step 2: Run the unit test to verify it FAILS**

Run:
```bash
npx vitest run frontend/src/modules/Admin/ContentLists/comboboxScroll.test.js
```
Expected: FAIL — `shouldPositionLevel is not a function`.

**Step 3: Implement the pure helper**

Append to `comboboxScroll.js`:
```javascript
/**
 * Decide whether the browse-level positioner should place the reference row.
 * Runs ONCE per browse level: the first render where the level presents a
 * reference highlight (idx >= 0) with items rendered. Re-entry for the same
 * level (pagination load-more, user arrow navigation) is suppressed so the
 * viewport is never yanked back to the reference.
 *
 * @param {object} a
 * @param {string|null} a.levelKey        - current browse level key (null when not browsing)
 * @param {string|null} a.positionedLevel - level key already positioned (from a ref)
 * @param {number} a.highlightIdx         - reference highlight index (-1 = none)
 * @param {number} a.itemsLength          - rendered browse item count
 * @returns {{ run: boolean, reason: string }}
 */
export function shouldPositionLevel({ levelKey, positionedLevel, highlightIdx, itemsLength }) {
  if (levelKey == null) return { run: false, reason: 'not-browsing' };
  if (positionedLevel === levelKey) return { run: false, reason: 'already-positioned' };
  if (highlightIdx < 0) return { run: false, reason: 'no-reference' };
  if (itemsLength <= 0) return { run: false, reason: 'no-items' };
  return { run: true, reason: 'position' };
}
```

**Step 4: Run the unit test to verify it PASSES**

Run:
```bash
npx vitest run frontend/src/modules/Admin/ContentLists/comboboxScroll.test.js
```
Expected: PASS (all `shouldPositionLevel` + existing `computeScrollRestore` cases green).

**Step 5: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/comboboxScroll.js frontend/src/modules/Admin/ContentLists/comboboxScroll.test.js
git commit -m "feat(admin): add shouldPositionLevel decision for combobox open positioning"
```

---

## Task 3: Rework the positioner effect to use the decision + rAF retry + once-per-level guard

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/combobox/ContentCombobox.jsx:29` (import) and `:287-307` (effect)

**Step 1: Add the import**

At `ContentCombobox.jsx:29`, extend the existing import:
```javascript
import { shouldRunScrollToHighlighted, computeScrollRestore, shouldPositionLevel } from '../comboboxScroll.js';
```

**Step 2: Replace the positioner effect (lines 287-307)**

Replace the entire existing block:
```javascript
  // ── Initial browse positioning: when a browse level loads, place the
  // reference item ~1.5 rows from the top (twin behavior). Keyed on the
  // breadcrumb path so pagination (same level) never re-positions.
  const levelKey = isBrowse ? `b:${breadcrumbs.map((b) => b.id).join('>')}` : null;
  useEffect(() => {
    if (levelKey == null) return;
    // Single scroll writer per level: reset prevIdx so the navigation effect
    // hits its 'initial-render' guard on cross-level transitions — otherwise
    // both writers race and a drill can misread as a pac-man wrap (bogus
    // wrap-flash + jump).
    prevIdxRef.current = -1;
    const idx = state.highlight.idx;
    if (idx < 0) return;
    requestAnimationFrame(() => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const option = viewport.querySelectorAll(`.${OPTION_CLASS}`)[idx];
      if (!option) return;
      viewport.scrollTop = Math.max(0, optionTopIn(viewport, option) - option.offsetHeight * 1.5);
    });
  }, [levelKey]); // eslint-disable-line react-hooks/exhaustive-deps -- fires once per browse level
```

with:
```javascript
  // ── Initial browse positioning: the FIRST render where a browse level
  // presents its reference row (highlight idx >= 0) with items rendered,
  // place that row ~1.5 rows from the top. Positions ONCE per level
  // (positionedLevelRef) so pagination load-more and user arrow-nav never
  // yank the viewport back. Retries across a few frames because on the
  // dropdown-open sequence the ScrollArea viewport / target option node may
  // not be laid out on the first frame (that timing gap left the list pinned
  // at scrollTop 0, hiding the selected item).
  const levelKey = isBrowse ? `b:${breadcrumbs.map((b) => b.id).join('>')}` : null;
  const positionedLevelRef = useRef(null);
  useEffect(() => {
    if (levelKey == null) { positionedLevelRef.current = null; return undefined; }

    const decision = shouldPositionLevel({
      levelKey,
      positionedLevel: positionedLevelRef.current,
      highlightIdx,
      itemsLength: items.length,
    });
    if (!decision.run) return undefined;

    // Reset the navigation writer's prev-index so it hits its 'initial-render'
    // guard and defers to us for this level's first placement (prevents a
    // cross-level drill misreading as a pac-man wrap).
    prevIdxRef.current = -1;

    let rafId;
    let tries = 0;
    const attempt = () => {
      const viewport = viewportRef.current;
      const option = viewport?.querySelectorAll(`.${OPTION_CLASS}`)[highlightIdx];
      if (viewport && option && option.offsetHeight > 0) {
        viewport.scrollTop = Math.max(0, optionTopIn(viewport, option) - option.offsetHeight * 1.5);
        positionedLevelRef.current = levelKey;
        return;
      }
      if (tries++ < 6) rafId = requestAnimationFrame(attempt);
    };
    rafId = requestAnimationFrame(attempt);
    return () => { if (rafId) cancelAnimationFrame(rafId); };
  }, [levelKey, highlightIdx, items.length]); // eslint-disable-line react-hooks/exhaustive-deps -- once per level via positionedLevelRef
```

**Step 3: Sanity-check the existing unit + component test suites still pass**

Run:
```bash
npx vitest run frontend/src/modules/Admin/ContentLists/combobox/ContentCombobox.test.jsx frontend/src/modules/Admin/ContentLists/comboboxScroll.test.js
```
Expected: PASS. (jsdom has no layout, so these assert wiring/behavior, not pixel scroll — the scroll itself is covered by the live test in Task 4.)

**Step 4: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/combobox/ContentCombobox.jsx
git commit -m "fix(admin): scroll combobox to committed selection on open

Position the reference row once per browse level, re-running as the open
sequence commits and retrying across frames until the ScrollArea viewport
and option node are laid out. Fixes the picker opening pinned to the top
of the centered window with the selected item off-screen."
```

---

## Task 4: Verify the live regression is now GREEN

**Step 1: Run the Task 1 test**

Run:
```bash
npx playwright test tests/live/flow/admin/combobox-open-scroll-to-selected.runtime.test.mjs --reporter=line
```
Expected: PASS — log shows `scrollTop` > 0 and `isFullyVisible: true`.

**Step 2: Run the pre-existing scroll behavior suite (guard against regressions in arrow-nav / pagination)**

Run:
```bash
npx playwright test tests/live/flow/admin/combobox-scroll-behavior.runtime.test.mjs --reporter=line
```
Expected: PASS — arrow-nav still tracks the highlight, pagination does not re-yank.

**Step 3 (visual confirm — required, do not ask the user to eyeball):** capture a screenshot of the open picker and confirm the selected item ("Elijah the Prophet") is centered near the top of the dropdown. Use a fresh throwaway script under `_deleteme/` (open row 6, screenshot, then `mv` it into `_deleteme/`). Inspect the PNG yourself.

---

## Task 5: Docs + final commit

**Files:**
- Modify: this plan → move to `docs/_archive/` if fully done, OR leave in `_wip/plans/` until merged.
- Consider: a one-line note in any combobox reference doc if one exists (`grep -ril combobox docs/reference`).

**Step 1: Update the docs freshness marker**

Run:
```bash
git rev-parse HEAD > docs/docs-last-updated.txt
git add docs/docs-last-updated.txt
git commit -m "docs: mark combobox open-scroll fix reviewed"
```

**Step 2: Finish the branch** — REQUIRED SUB-SKILL: use superpowers:finishing-a-development-branch to merge to `main` and clean up (per project policy: merge directly, delete the branch, record it in `docs/_archive/deleted-branches.md`).

---

## Notes / Guardrails

- **DRY:** the open-positioning decision lives in one pure function (`shouldPositionLevel`), mirroring the existing `shouldRunScrollToHighlighted` / `computeScrollRestore` pattern — do not inline the branching back into the effect.
- **Do not touch** the scroll-to-highlighted navigation effect (`ContentCombobox.jsx:311-384`) or `shouldRunScrollToHighlighted`; its `initial-render` deferral is what hands open-positioning to the positioner. Changing both writers at once reintroduces the pac-man-wrap race the comments warn about.
- **Do not "fix" the backend window** — `referenceIndex` is already correct (verified). This is purely a frontend scroll-timing fix.
- **YAGNI:** 6 retry frames is a deliberate cap; do not add a polling loop or `MutationObserver`.
