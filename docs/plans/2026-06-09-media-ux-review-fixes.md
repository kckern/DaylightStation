# Media UX Overhaul — Review-Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (or superpowers:executing-plans) to implement this plan task-by-task.

**Goal:** Close the 2 regressions, 5 intent gaps, and 3 test bugs found by the three-reviewer code review of `feature/media-ux-overhaul`, then run the live verification gate the original plan deferred.

**Architecture:** All work happens in the existing worktree `/Users/kckern/Documents/GitHub/DaylightStation-media-ux` on branch `feature/media-ux-overhaul`. Each task is a surgical TDD fix to code landed by `docs/plans/2026-06-09-media-ux-overhaul.md`. The final task runs the live Playwright gate by serving the worktree frontend on a spare port (`npx vite --port 3115`), proxying `/api` to the already-running main-checkout backend on 3112.

**Tech Stack:** React 18, Mantine 7.11 (Admin), Vitest 4 (`npx vitest run <path>` from worktree root), Jest for `tests/unit/**` (`npx jest <path>`), Playwright (`BASE_URL` env override honored by `playwright.config.mjs:11`).

**Review provenance:** Findings come from three code-review agents (Media frontend / backend search / Admin combobox), 2026-06-09. Cross-refs: original plan `docs/plans/2026-06-09-media-ux-overhaul.md` (main checkout); audit `docs/_wip/audits/2026-06-09-media-content-lookup-and-ux-audit.md` (main checkout).

---

## Conventions for the executor

- **Worktree root:** `/Users/kckern/Documents/GitHub/DaylightStation-media-ux` — run everything there.
- Vitest from worktree root: `npx vitest run <path>`. Jest for `tests/unit/**` and `tests/isolated/**` that import `@jest/globals`; vitest for files importing `vitest`. **Check the file's own import line before picking a runner.**
- Commit after every task with the message given. Never push, never merge (user merges manually).
- The user's dev server (main checkout) owns ports 3111/3112 — **do not kill it, do not start anything on those ports.** Task 10 uses port 3115.

---

## Task 1: FilesystemCanvasAdapter returns the real capabilities shape (review Important — regression)

The tightened `isMediaSearchable` (Task 18 of the original plan) now excludes the canvas adapter — the only shipping adapter still returning the legacy bare array. Fixing the shape also restores canvas text search on the unified path, where `['text'].canonical === undefined` already made `#canHandle` skip it.

**Files:**
- Modify: `backend/src/1_adapters/content/canvas/filesystem/FilesystemCanvasAdapter.mjs:58-60`
- Test: `tests/isolated/adapter/content/canvas/FilesystemCanvasAdapter.test.mjs` (exists — extend; check its import line for jest vs vitest)

**Step 1: Write the failing test** (append, matching the file's existing style/runner):

```js
describe('getSearchCapabilities contract', () => {
  test('returns the {canonical, specific} shape required by IMediaSearchable', () => {
    const adapter = makeAdapter(); // reuse the file's existing construction helper; adjust name to match
    const caps = adapter.getSearchCapabilities();
    expect(Array.isArray(caps.canonical)).toBe(true);
    expect(caps.canonical).toContain('text');
    expect(Array.isArray(caps.specific)).toBe(true);
  });
});
```

If the file has no construction helper, instantiate the adapter the way its first test does.

**Step 2: Run it — expect FAIL** (caps is `['text']`, so `caps.canonical` is undefined).

**Step 3: Implement** in `FilesystemCanvasAdapter.mjs`:

```js
  getSearchCapabilities() {
    return { canonical: ['text'], specific: [] };
  }
```

**Step 4: Run the test file — PASS.** Also run, to catch collateral:
- `npx jest tests/unit/content/ContentQueryService.searchStream.test.mjs`
- `npx jest tests/isolated/domain/media/IMediaSearchable.test.mjs`
- the canvas service/flow suites: `npx vitest run tests/isolated/flow/canvas/ tests/isolated/adapter/content/canvas/` (or jest if those files import @jest/globals)

**Step 5: Commit** — `fix(canvas): getSearchCapabilities returns {canonical, specific}; adapter no longer excluded by the tightened IMediaSearchable check`

---

## Task 2: Combobox Enter gate — kill the freeform double-commit (review Important #1)

Mantine's target keydown runs after ours, ignores `defaultPrevented`, and clicks the selected option. So when an option IS selected (real or `__freeform__`), Mantine routes it through `onOptionSubmit` — our Enter handler must only commit when **nothing** is selected. The `userNavigatedRef` becomes dead and must be removed.

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ContentSearchCombobox.jsx`
- Test: `tests/live/flow/admin/content-search-combobox/12-freeform-commit.runtime.test.mjs` (extend; executed live in Task 10)

**Step 1: Implement** (Playwright assertion comes in Step 2; no unit harness exists for this component):

1. Delete the `userNavigatedRef` declaration (the `const userNavigatedRef = useRef(false);` block and its comment, ~line 91-93).
2. Delete `userNavigatedRef.current = false;` from the input `onChange`.
3. Replace the `onKeyDown` handler body:

```js
          onKeyDown={(e) => {
            if (e.key === 'Enter' && search && search !== value) {
              const idx = combobox.getSelectedOptionIndex();
              log.debug('input.enter', { search, value, selectedOptionIndex: idx, resultCount: results.length });
              // Commit freeform ONLY when no option is selected. When an option IS
              // selected (a result row or the __freeform__ row), Mantine's own target
              // keydown clicks it and routes through onOptionSubmit — committing here
              // too would double-fire onChange. (Review 2026-06-09, Important #1)
              if (idx === -1) {
                log.info('freeform.commit_on_enter', { freeformValue: search, prevValue: value });
                e.preventDefault();
                onChange(search);
                combobox.closeDropdown();
              }
            }
          }}
```

4. **Back-button blur hardening** (review Important #6): on the breadcrumb back `ActionIcon` (~line 690), add `onMouseDown={(e) => e.preventDefault()}` so mousedown on it no longer blurs the input (the same mechanism Mantine options use).

**Step 2: Extend suite 12.** Add after the existing freeform-row test:

```js
  test('Enter on the arrow-selected freeform row commits exactly once', async ({ page }) => {
    await ComboboxActions.open(page);
    const input = ComboboxLocators.input(page);
    await input.fill('zz-no-results-zz');
    await ComboboxActions.waitForAllAdaptersComplete(page, 60000);
    await page.keyboard.press('ArrowDown');   // selects the __freeform__ row (only option)
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await expect(page.getByTestId('current-value')).toContainText('zz-no-results-zz');
    // Exactly ONE change-log entry — the double-commit regression fired two.
    const entries = page.locator('[data-testid="change-log"] code:has-text("zz-no-results-zz")');
    expect(await entries.count()).toBe(1);
  });
```

Note: the change-log renders `from`/`to` in separate `<code>` elements; one commit from `(empty)` produces exactly one `<code>` containing the text. If a second commit fired it would be `zz… → zz…` = two more matches.

Also update the suite-12 file header comment (lines 2-9) — it still describes the old "always save on blur" invariant. Rewrite to: Enter (no selection) and id-like blur commit; plain-text blur reverts; the freeform row is the explicit affordance.

**Step 3: Static check:** `cd frontend && npx eslint src/modules/Admin/ContentLists/ContentSearchCombobox.jsx` — no NEW errors (9 pre-existing `log`-dep warnings are acceptable). Run `npx vitest run frontend/src/modules/Admin/ 2>/dev/null || true` (no unit suite exists; just confirm nothing imports the removed ref).

**Step 4: Commit** — `fix(admin): Enter commits freeform only when no option is selected (kills Mantine double-commit); back button no longer blurs the input`

---

## Task 3: Cancel the search debounce on dropdown close (review Important #2 — §3.1-2 timing hole)

`useDebouncedCallback` from @mantine/hooks has no `.cancel`, but invoking it again clears the prior timer. Calling it with `''` both cancels the pending dispatch and (if the timer fires) resolves to the harmless short-query clear.

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ContentSearchCombobox.jsx` (`onDropdownClose`)
- Test: `tests/live/flow/admin/content-search-combobox/01-basic-interactions.runtime.test.mjs` (extend)

**Step 1: Implement.** In `onDropdownClose`, before `streamSearch('')`:

```js
      // Cancel any pending debounced dispatch — a timer surviving close would
      // repopulate stream results while closed (§3.1-2 through a timing hole).
      debouncedSearch('');
      streamSearch(''); // hook clears results/pending for short queries
```

**Step 2: Extend suite 01** with the fast-close race:

```js
  test('closing within the debounce window does not leak a late search into the next open', async ({ page }) => {
    await page.goto(TEST_URL);
    const input = ComboboxLocators.input(page);
    await input.click();
    await input.fill('christmas');
    await page.keyboard.press('Escape');      // close BEFORE the 300ms debounce fires
    await page.waitForTimeout(700);            // let any leaked timer fire + stream
    await input.click();                       // reopen
    await expect(page.getByText('Type to search...')).toBeVisible();
  });
```

**Step 3: Commit** — `fix(admin): cancel pending search debounce on dropdown close — no stale results leak into the next open`

---

## Task 4: Seek-bar snap-back — ignore position ticks while seeking (review Important #2, frontend)

`Player` progress payloads carry `isSeeking`; pre-seek ticks >0.5s from the committed target were overwriting the seek position until the media element caught up.

**Files:**
- Modify: `frontend/src/modules/Media/session/HiddenPlayerMount.jsx` (the tick call)
- Test: `frontend/src/modules/Media/session/HiddenPlayerMount.test.jsx` (extend)

**Step 1: Write the failing test.** Follow the file's existing `mockAdapter` + render pattern (see the existing onProgress tests around line 80):

```jsx
  it('suppresses position ticks while the player reports isSeeking', () => {
    const adapter = mockAdapter({
      currentItem: { contentId: 'plex:1', format: 'video' },
      state: 'playing',
    });
    renderMount(adapter); // use the file's existing render helper / pattern
    const onProgress = getPlayerProp('onProgress'); // however the file extracts Player props
    act(() => { onProgress({ currentTime: 42, paused: false, isSeeking: true }); });
    expect(adapter.onPlayerPositionTick).not.toHaveBeenCalled();
    act(() => { onProgress({ currentTime: 43, paused: false, isSeeking: false }); });
    expect(adapter.onPlayerPositionTick).toHaveBeenCalledWith(43);
  });
```

Adapt the harness calls to the file's actual helpers (it mocks `../../Player/Player.jsx` and captures props — mirror the existing onProgress tests exactly).

**Step 2: Run — FAIL** (tick called with 42).

**Step 3: Implement.** Replace the tick call:

```js
    // Fine-grained (≥0.5s) live position update for the seek bar — does NOT
    // persist; the ≥5s onPlayerProgress path below remains the durable write.
    // Suppressed while seeking: pre-seek ticks would overwrite the committed
    // seek target and visibly snap the bar back.
    const isSeeking = typeof payload === 'object' && payload !== null ? !!payload.isSeeking : false;
    if (!isSeeking) adapter.onPlayerPositionTick(positionSeconds);
```

**Step 4: Run** `npx vitest run frontend/src/modules/Media/session/` — all pass.

**Step 5: Commit** — `fix(media): suppress live position ticks while seeking — seek bar no longer snaps back`

---

## Task 5: Search overlay must survive clicks inside body-portaled UI (review Important #3 — M1 completion)

`useDismissable`'s pointerdown handler treats the body-portaled cast picker as "outside" and closes the search overlay, unmounting the picker mid-interaction.

**Files:**
- Modify: `frontend/src/hooks/useDismissable.js`
- Modify: `frontend/src/modules/Media/search/SearchBar.jsx` (hook options)
- Test: create `frontend/src/hooks/useDismissable.test.jsx` if absent (check `ls frontend/src/hooks/useDismissable.test*` first; if one exists, extend it)

**Step 1: Write the failing test:**

```jsx
import React, { useRef } from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { useDismissable } from './useDismissable.js';

function Harness({ onDismiss, ignore }) {
  const ref = useRef(null);
  useDismissable(ref, { open: true, onDismiss, ignore });
  return <div ref={ref} data-testid="inside">overlay</div>;
}

function pointerDown(target) {
  // happy-dom may lack PointerEvent; a bubbling Event with the right type
  // reaches the document-level listener identically.
  const Ev = typeof PointerEvent !== 'undefined' ? PointerEvent : Event;
  target.dispatchEvent(new Ev('pointerdown', { bubbles: true }));
}

describe('useDismissable ignore selector', () => {
  it('does not dismiss for pointerdown inside an ignored container', () => {
    const onDismiss = vi.fn();
    render(
      <>
        <Harness onDismiss={onDismiss} ignore=".media-app-portal" />
        <div className="media-app-portal"><button data-testid="in-portal">x</button></div>
      </>
    );
    pointerDown(screen.getByTestId('in-portal'));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('still dismisses for pointerdown elsewhere', () => {
    const onDismiss = vi.fn();
    render(<Harness onDismiss={onDismiss} ignore=".media-app-portal" />);
    pointerDown(document.body);
    expect(onDismiss).toHaveBeenCalled();
  });
});
```

**Step 2: Run — FAIL** (first test: onDismiss called).

**Step 3: Implement.** In `useDismissable.js`:

```js
export function useDismissable(ref, { open, onDismiss, ignore = null }) {
```

and in `onPointer`, after the `node.contains` check:

```js
      if (ignore && e.target instanceof Element && e.target.closest(ignore)) return;
```

Add `ignore` to the effect dependency array. Update the doc comment: `ignore` is a CSS selector for body-portaled descendants (e.g. `.media-app-portal`) that logically belong to the overlay.

In `SearchBar.jsx`:

```js
  useDismissable(rootRef, { open: isOpen, onDismiss: close, ignore: '.media-app-portal' });
```

**Step 4: Run** `npx vitest run frontend/src/hooks/ frontend/src/modules/Media/search/ frontend/src/modules/Media/cast/` — all pass.

**Step 5: Commit** — `fix(media): search overlay ignores pointerdown inside body-portaled pickers — casting from search survives the first click (M1)`

---

## Task 6: M14 for real — pin the settings cog to row 1 (review Important #1, frontend)

`Dock.jsx` order is SearchBar → `.dock-status-cluster` → `SettingsMenu` (`.settings-menu-root`). Grid auto-placement can't backfill, so the cog landed alone on row 3. Pin placements explicitly.

**Files:**
- Modify: `frontend/src/Apps/MediaApp.scss` (the 780px dock block, ~line 1193)

**Step 1: Implement** — replace the 780px block's dock rules:

```scss
@media (max-width: 780px) {
  .media-app [data-testid="media-dock"] {
    grid-template-columns: 1fr auto;   /* row 1: search + settings */
    grid-auto-rows: auto;
    row-gap: 8px;
    padding: 8px 12px;
  }
  /* Explicit placement: source order is search → cluster → settings, and grid
     auto-placement cannot backfill — without these pins the cog lands alone on
     row 3 (the original M14 symptom, rearranged). */
  .media-app .settings-menu-root { grid-row: 1; grid-column: 2; }
  .media-app .dock-status-cluster {
    grid-row: 2;
    grid-column: 1 / -1;               /* row 2: full-width status */
    justify-self: stretch;
    justify-content: space-between;
  }
  .media-app .media-canvas { padding: 16px 12px 40px; }
}
```

**Step 2: Verify SCSS compiles:** `cd frontend && npx sass --no-source-map src/Apps/MediaApp.scss /tmp/c.css && echo OK`

**Step 3:** Visual proof comes from Task 10's 390px screenshot. **Commit** — `fix(media): pin settings cog to dock row 1 on mobile — auto-placement was orphaning it on row 3 (M14)`

---

## Task 7: Timeout the batch ID-lookup leg (review Important #2, backend — B3 completion)

`#lookupById`'s `getItem`/`getMetadata` awaits have no timeout, so ID-like queries (`plex:123`) still hang the batch `/query/search` on a dead adapter. The existing try/catch already feeds `warnings`, so a timeout rejection lands there naturally.

**Files:**
- Modify: `backend/src/3_applications/content/ContentQueryService.mjs` (`#lookupById`, ~lines 412-456)
- Test: `tests/unit/content/ContentQueryService.searchStream.test.mjs` (extend — jest)

**Step 1: Write the failing test:**

```js
  it('batch search() times out a hung ID lookup instead of hanging the response', async () => {
    const hungLookup = {
      source: 'plex',
      getItem: () => new Promise(() => {}),                      // hangs forever
      search: jest.fn().mockResolvedValue({ items: [] }),
      getSearchCapabilities: () => ({ canonical: ['text'], specific: [] }),
      getQueryMappings: () => ({}),
    };
    const registry = { resolveSource: () => [hungLookup], get: () => hungLookup };
    const svc = new ContentQueryService({ registry, adapterTimeoutMs: 50, logger: { info: () => {}, warn: () => {}, debug: () => {} } });
    const result = await svc.search({ text: 'plex:123' });       // ID-like → triggers #lookupById
    expect(result.warnings?.some(w => /timeout/i.test(w.error))).toBe(true);
  }, 5000);
```

Note the silent logger (review Minor #8 — avoid console noise). If `result.warnings` isn't the surfaced field name, inspect `search()`'s return shape (~lines 165-200) and assert on the actual field; the essential assertions are (a) the promise resolves within the 5s jest timeout, (b) a timeout warning is recorded.

**Step 2: Run — expect TIMEOUT/FAIL** (the promise never resolves → jest 5s timeout).

**Step 3: Implement.** In `#lookupById`, wrap both awaits:

```js
        const item = await withTimeout(adapter.getItem(id), this.#adapterTimeoutMs, `${source} id-lookup`);
```

```js
        const metadata = await withTimeout(adapter.getMetadata(id), this.#adapterTimeoutMs, `${source} id-lookup`);
```

(The surrounding try/catch already converts rejections to `warnings.push({source, error: 'ID lookup failed: …'})`.)

**Step 4: Run** `npx jest tests/unit/content/ContentQueryService.searchStream.test.mjs` — all pass. Also `npx vitest run tests/isolated/application/content/`.

**Step 5: Commit** — `fix(search): batch ID-lookup respects the adapter timeout — id-like queries no longer hang on a dead adapter (B3)`

---

## Task 8: Small truths — pending badge on source_error, MiniPlayer badge guard, doc path (review Minors #3/#6/#7)

**Files:**
- Modify: `frontend/src/hooks/useStreamingSearch.js` + `frontend/src/hooks/useStreamingSearch.test.jsx`
- Modify: `frontend/src/modules/Media/shell/MiniPlayer.jsx` + `MiniPlayer.test.jsx`
- Modify: `docs/reference/media/search-scopes.md:5`

**Step 1: Failing tests.**

useStreamingSearch (extend the existing source_error test or add):

```js
  it('source_error removes the failed source from pending', () => {
    const { result } = renderHook(() => useStreamingSearch('/api/search/stream'));
    act(() => { result.current.search('hello'); });
    const es = MockEventSource.instances[0];
    act(() => {
      es.simulateMessage({ event: 'pending', sources: ['plex', 'abs'] });
      es.simulateMessage({ event: 'source_error', source: 'abs', error: 'down', pending: ['plex'] });
    });
    expect(result.current.pending).toEqual(['plex']);
  });
```

MiniPlayer (extend):

```js
  test('no queue badge when currentIndex is -1 (nothing current)', () => {
    const item = { contentId: 'plex:2', title: 'Cosmos' };
    const queue = { items: [{ queueItemId: 'a' }, { queueItemId: 'b' }, { queueItemId: 'c' }], currentIndex: -1, upNextCount: 0 };
    renderMiniPlayer({ state: 'playing', item, queue });
    expect(screen.queryByTestId('mini-queue-count')).not.toBeInTheDocument();
  });
```

**Step 2: Run both — FAIL.**

**Step 3: Implement.**

`useStreamingSearch.js` source_error branch:

```js
        } else if (data.event === 'source_error') {
          logger().warn('search.source-error', { query, source: data.source, error: data.error });
          setSourceErrors(prev => [...prev, { source: data.source, error: data.error }]);
          if (Array.isArray(data.pending)) setPending(data.pending);
        }
```

`MiniPlayer.jsx` badge condition:

```jsx
        {snapshot.queue?.items?.length > 1 && snapshot.queue.currentIndex >= 0 && (
```

`search-scopes.md` line 5: change `data/household/config/media.yml` → `data/household/apps/media/config.yml` (matches `ConfigService.getHouseholdAppConfig(hid, 'media')`).

**Step 4: Run** `npx vitest run frontend/src/hooks/useStreamingSearch.test.jsx frontend/src/modules/Media/shell/MiniPlayer.test.jsx` — pass.

**Step 5: Commit** — `fix(media): source_error clears the failed source from the pending badge; mini-player badge hidden when nothing is current; scopes doc path corrected`

---

## Task 9: Repair the two broken Playwright tests (review Important #4/#5)

Both new tests click `options.first()`, which may be a container/leaf mismatch; both use mid-test `test.skip`, violating the repo's "skipping is NOT passing" discipline.

**Files:**
- Modify: `tests/live/flow/admin/content-search-combobox/03-browse-mode.runtime.test.mjs` (the dual-affordance test)
- Modify: `tests/live/flow/admin/content-search-combobox/05-display-validation.runtime.test.mjs` (the resolved-title test)

**Step 1: Rewrite the suite-03 dual-affordance test** — target the row that actually contains the chevron, and fail (not skip) when the environment can't exercise it:

```js
  test('with selectContainers, a chevron browses in while row-click commits the container id', async ({ page }) => {
    await page.goto(`${TEST_URL}?selectContainers=1`);
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForStreamComplete(page, 30000);

    const containerRow = page.locator('[data-combobox-option]:has([data-testid^="browse-into-"])').first();
    await expect(containerRow, 'search must return at least one container to exercise dual affordance').toBeVisible();
    const chevron = containerRow.locator('[data-testid^="browse-into-"]');
    const id = (await chevron.getAttribute('data-testid')).replace('browse-into-', '');

    // The chevron drills into the container (breadcrumb back button appears).
    await chevron.click();
    await page.waitForTimeout(500);
    await expect(ComboboxLocators.backButton(page)).toBeVisible();

    // Reset; row-click (on the row that has a chevron) commits the container id.
    await page.goto(`${TEST_URL}?selectContainers=1`);
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForStreamComplete(page, 30000);
    await page.locator('[data-combobox-option]:has([data-testid^="browse-into-"])').first().click();
    await page.waitForTimeout(300);
    await expect(page.getByTestId('current-value')).toContainText(id);
  });
```

(Caveat noted for the live run: a pre-existing Mantine quirk fires `handleItemClick` twice per option click — current-value is still correct, so `toContainText` holds.)

**Step 2: Rewrite the suite-05 resolved-title test** — search a leaf (`Pilot`, the suite's own leaf fixture) so the click selects instead of drilling, and fail rather than skip:

```js
  test('selecting a known item shows a human resolved title under the input', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Pilot');   // episodes are leaves — click selects
    await ComboboxActions.waitForStreamComplete(page, 30000);

    const options = ComboboxLocators.options(page);
    expect(await options.count(), 'search must return results').toBeGreaterThan(0);
    await options.first().click();

    const resolved = page.getByTestId('combobox-resolved-title');
    await expect(resolved).toBeVisible({ timeout: 10000 });   // /info fetch is async
    const resolvedText = (await resolved.textContent())?.trim();
    expect(resolvedText && resolvedText.length).toBeTruthy();
    expect(resolvedText).not.toMatch(/^[\w-]+:\S+$/);          // human title, not the raw id
  });
```

**Step 3: Sanity-parse:** `npx playwright test tests/live/flow/admin/content-search-combobox/03-browse-mode.runtime.test.mjs tests/live/flow/admin/content-search-combobox/05-display-validation.runtime.test.mjs --list` (lists tests without running — catches syntax errors; full run happens in Task 10).

**Step 4: Commit** — `test(admin): dual-affordance and resolved-title Playwright tests target the right rows and fail instead of skipping`

---

## Task 10: Live verification gate (deferred Phase 6 of the original plan)

The worktree can serve the branch UI: data lives outside the repo (`DAYLIGHT_BASE_PATH` in `.env` points to Dropbox), and Vite proxies `/api`+`/ws` to `localhost:3112` — the user's running main-checkout backend. **UI suites therefore exercise the branch frontend against the production-equivalent backend.** Backend changes (Tasks 1, 7 here; 11, 18 originally) are covered by their jest suites — the live gate validates frontend behavior. The `source_error` UI strip won't trigger live (old backend) — that's expected; do not chase it.

**Step 1: One-time worktree setup:**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation-media-ux
git check-ignore .env || echo "WARNING: .env not ignored — do NOT commit it"
cp /Users/kckern/Documents/GitHub/DaylightStation/.env .env
cp /Users/kckern/Documents/GitHub/DaylightStation/.env frontend/.env 2>/dev/null || true
```

**Step 2: Start the branch frontend on the spare port** (background):

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation-media-ux/frontend
nohup npx vite --port 3115 --strictPort > /tmp/vite-worktree.log 2>&1 &
sleep 4 && curl -sf http://localhost:3115/ > /dev/null && echo "UP" || (cat /tmp/vite-worktree.log; exit 1)
```

If 3115 is taken, pick the next free port and use it consistently below.

**Step 3: Combobox suites** (the four modified first, then the full folder):

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation-media-ux
BASE_URL=http://localhost:3115 npx playwright test \
  tests/live/flow/admin/content-search-combobox/01-basic-interactions.runtime.test.mjs \
  tests/live/flow/admin/content-search-combobox/03-browse-mode.runtime.test.mjs \
  tests/live/flow/admin/content-search-combobox/05-display-validation.runtime.test.mjs \
  tests/live/flow/admin/content-search-combobox/12-freeform-commit.runtime.test.mjs \
  --reporter=line
# then the full net:
BASE_URL=http://localhost:3115 npx playwright test tests/live/flow/admin/content-search-combobox/ --reporter=line
```

Triage failures honestly: a failure in a modified test means Tasks 2/3/9 need rework (return to that task); a failure in an untouched suite means the combobox changes regressed something — investigate before proceeding. Playwright's `webServer` block may try to probe port 3111; it reuses the existing server, which is fine — `BASE_URL` controls where tests point.

**Step 4: Media App visual evidence** (M14 + M1). Write `/tmp/media-visual-check.mjs`:

```js
import { chromium } from '@playwright/test';
const BASE = 'http://localhost:3115';
const browser = await chromium.launch();

// (a) 390px mobile dock — M14
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
await mobile.goto(`${BASE}/media`);
await mobile.waitForTimeout(2500);
await mobile.screenshot({ path: '/tmp/media-mobile-390.png', fullPage: false });
const rects = await mobile.evaluate(() => {
  const g = (sel) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
  return { search: g('.media-search-bar'), cluster: g('.dock-status-cluster'), settings: g('.settings-menu-root') };
});
console.log(JSON.stringify(rects, null, 2));
// PASS criteria: settings.top ≈ search.top (same row), cluster.top > search.bottom (row 2).

// (b) cast picker survives a click inside it — M1
const desk = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await desk.goto(`${BASE}/media`);
await desk.waitForTimeout(2000);
await desk.fill('[data-testid="media-search-input"]', 'pilot');
await desk.waitForTimeout(2500);
const cast = desk.locator('[data-testid^="cast-button-"]').first();
await cast.click();
await desk.waitForTimeout(500);
await desk.screenshot({ path: '/tmp/cast-picker-open.png' });
const picker = desk.locator('.dispatch-target-picker');
const before = await picker.isVisible();
await desk.locator('.dispatch-target-picker [data-testid^="picker-device-"]').first().click().catch(() => {});
await desk.waitForTimeout(300);
const overlayAlive = await desk.locator('[data-testid="search-overlay"]').isVisible();
console.log({ pickerVisibleBeforeClick: before, overlayAliveAfterClickInsidePicker: overlayAlive });
// PASS criteria: both true.
await desk.screenshot({ path: '/tmp/cast-picker-after-click.png' });
await browser.close();
```

Run: `cd /Users/kckern/Documents/GitHub/DaylightStation-media-ux && node /tmp/media-visual-check.mjs`. **Read the printed rects/flags AND the screenshots** (use the Read tool on the PNGs) — per repo discipline, verify with your own eyes, don't ask the user to look. If the M14 rows or the M1 overlay-survival check fail, return to Task 6/5 respectively.

**Step 5: Full unit re-sweep** (regression net across all 9 fix tasks):

```bash
npx vitest run frontend/src/modules/Media frontend/src/hooks
npx jest tests/unit/content/ tests/isolated/domain/media/IMediaSearchable.test.mjs
npx vitest run tests/isolated/application/content/
```

All green (the pre-existing `frontend/src/modules/Agent/runtime.test.js` failures are known-broken on main — out of scope).

**Step 6: Teardown + bookkeeping:**

```bash
pkill -f "vite --port 3115" || true
rm -f /tmp/media-visual-check.mjs
```

Update the audit's Resolution Status table (main checkout: `docs/_wip/audits/2026-06-09-media-content-lookup-and-ux-audit.md`): append a `Review fixes (2026-06-09)` line noting the canvas-adapter regression fix, Enter double-commit fix, debounce-close fix, seek-tick guard, portal-aware dismiss, M14 re-fix, ID-lookup timeout — with this branch's new commit hashes. Copy the final screenshots beside the audit's screens dir as `2026-06-09-post-fix-*.png` if the visual checks passed.

**Step 7: Final commit** — `test(media): live verification gate — combobox suites green on branch UI; M14/M1 visually confirmed` (include the audit-annotation edit if made in the worktree; the audit file lives in the MAIN checkout — edit it there, do not commit main-checkout changes).

---

## Explicitly deferred (file as follow-ups, do not do here)

- **Mantine option double-fire** (`handleItemClick` runs twice per mouse click — pre-existing; remove the custom `onClick` and let `onOptionSubmit` route everything). Its own change + Playwright pass.
- **2Hz re-render fan-out** from position ticks to all local-session subscribers (selector-based subscription or separate position channel).
- **M2 residual:** gate the pinned deep-link row on registered source prefixes (or EMPTY state only) so `frozen: part 2` doesn't offer a 404 "Play this ID".
- Batch-fallback `warnings` surfacing (non-SSE browsers), `titleCache` bound, keyboard path to browse-into, `comboboxTestHarness.backButton` locator tightening, the `#canHandle`-outside-try hardening, deprecated-route timeout.
