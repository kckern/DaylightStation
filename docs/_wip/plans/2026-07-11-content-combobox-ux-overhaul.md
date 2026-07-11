# ContentCombobox Best-in-Class UX Overhaul — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Each task is TDD (write failing test → verify red → implement → verify green → commit).

**Goal:** Close every actionable UX risk from `docs/_wip/audits/2026-07-11-content-combobox-ux-risk-audit.md` so the unified `ContentCombobox` is orientation-clear, jump-free during progressive loading, correct for hierarchical selection, and honest about search scope — without reopening the (correct) state machine.

**Architecture:** The control is already split into a pure reducer (`comboboxMachine.js`), a side-effect hook (`useContentCombobox.js`), and a presentation component (`ContentCombobox.jsx`). We keep that split. Logic-only fixes get **Vitest** unit tests against the reducer / pure helpers; presentation/orientation fixes get **React Testing Library** component tests (the existing `ContentCombobox.test.jsx` harness) and, for the two P0 spatial findings, a **runtime diagnosis task first** (Task 1) so we fix the real mechanism, not the audit's hypothesis.

**Tech Stack:** React 18, Mantine v7 (`@mantine/core` Combobox), Vitest + React Testing Library, existing structured logger (`getChildLogger`), Playwright for the live admin surface.

**Working location:** worktree `DaylightStation-combobox-ux`, branch `feat/combobox-ux-overhaul` (based on `origin/main`).

**Test commands (this repo):**
- Single Vitest file: `npx vitest run <path> -t "<name>"`
- Watch one file: `npx vitest <path>`
- Component tests live beside source (`*.test.jsx`) and run under the same Vitest config.
- Live admin surface (for Task 1 diagnosis & Task 12 verification): dev server per `CLAUDE.md` (check `lsof -i :3111` first; `npm run dev` if absent). Combobox test harness route: `/admin/test/combobox`. Primary surface: any list row at `/admin/content/lists/menus`.

**Global rules for every task:**
- Import the shared logger; add a structured log event at each new decision point (`CLAUDE.md` Logging rule). No raw `console.*`.
- Never touch `comboboxMachine.js` transitions that the audit marked correct (dedupe, `userNavigated` Enter gate, pagination-owner guard, browse-token invalidation) except where a task explicitly adds a **new** event/field.
- Commit after each task with a `feat:`/`fix:`/`test:` message. Do NOT push; the merge/push decision is Task 13 and is gated on a human decision (homeserver divergence — see Task 13).

---

## Design decisions (made up-front; flag in review if you disagree)

Because the request is "best in class," each fork is resolved toward the thorough option:

| Finding | Decision | Rationale |
|---|---|---|
| F1 (orientation) | **Persistent "current item" header chip** in the dropdown (always correct, transport-independent) **+** fix highlight/current-marker salience. Do NOT add server-side anchoring — the backend already centers the window (`SiblingsService.mjs:127`), so the gap is *marker visibility*, confirmed by Task 1. | Robust regardless of whether the reference row is loaded; no backend change. |
| F6 (uncapped list) | **Render cap with "showing first N — refine" affordance**, not virtualization. | Virtualization risks the index↔DOM-order invariant the highlight depends on; a cap is best-in-class UX (fast, guides refinement) at a fraction of the risk. |
| F11 (auto-resolve) | **Visible-pending + toast with Undo**, not silent swap and not a blocking confirm. | Keeps the fast path but makes the value mutation legible and reversible (`showUndoToast` already exists in `shared/feedback.js`). |
| F14 (search scope) | **Removable scope chip** ("Searching within **singalong** ✕"). | Turns an invisible backend feature into a legible, reversible one. |
| F7 (containers) | Enable `selectContainers` on **menu/watchlist** row + empty-row surfaces via the already-built dual affordance. | Lets users pick a playlist/album/show without typing raw ids. |

---

## Task 1: Runtime diagnosis of F1 (orientation) and F4 (scroll rug-pull) — characterization, not fix

**Goal:** Replace the audit's *hypotheses* with observed mechanisms so Tasks 2 & 5 fix the real bug. No production code changes; output is a short findings note + one or two characterization tests that encode the true current behavior.

**Files:**
- Create: `docs/_wip/bugs/2026-07-11-combobox-orientation-and-scroll-diagnosis.md`
- (Maybe) Create: `frontend/src/modules/Admin/ContentLists/combobox/ContentCombobox.orientation.test.jsx`

**Step 1: Reproduce F1 live.** Start dev server (check `lsof -i :3111` first). Open `/admin/content/lists/menus`, find a row whose value is a deep-in-collection item (e.g. a `singalong:hymn/1008` row, or add one). Click the row's content card to open the combobox in browse mode. Record, with screenshots:
- Is the committed value's row present in the loaded window? (It should be — backend centers.)
- Does that row carry the `.highlighted` (blue) class? The `.current` (gray border-left) class? Check the DOM: `data-highlighted`, `data-current` attributes on `.content-combobox-option`.
- Is the row scrolled into view (~1.5 rows from top) or below the fold?

**Step 2: Pin the F1 mechanism.** Cross-reference against code. Candidate mechanisms to confirm/reject:
- (a) `referenceIndex` returns `-1` from the API for this id → client falls back to `idx 0` (`useContentCombobox.js:278`) → wrong row highlighted. Check the actual `/api/v1/siblings/singalong/hymn%2F1008` response `referenceIndex` with: `curl -s "http://localhost:3111/api/v1/siblings/singalong/hymn%2F1008" | python3 -c "import sys,json;d=json.load(sys.stdin);print('refIdx',d.get('referenceIndex'),'n',len(d.get('items',[])),'ids',[i['id'] for i in d['items'][:3]])"`.
- (b) The `.current` gray border-left is simply too subtle to read as "you are here."
- (c) The level-key scroll effect (`ContentCombobox.jsx:299-315`) puts the row above the visible fold or the header covers it.

Write the confirmed mechanism into the diagnosis doc. **This determines Task 2's exact fix.**

**Step 3: Reproduce F4 live.** On the same open browse level with `pagination.hasBefore === true`, scroll to the top edge to trigger a `before` load-more. Watch for a viewport jump. Throttle CPU (DevTools 4×) to expose the single-rAF race (`ContentCombobox.jsx:271-273`). Record whether the jump reproduces and its magnitude.

**Step 4: Write the diagnosis note.** Document both mechanisms with evidence (curl output, DOM attributes, screenshots). If F1 turns out to be "backend returns `referenceIndex: -1`", note that Task 2 must also address the API/client contract, not just the chip.

**Step 5: Commit.**
```bash
git add docs/_wip/bugs/2026-07-11-combobox-orientation-and-scroll-diagnosis.md
git commit -m "docs(combobox): runtime diagnosis of orientation + scroll-restore mechanisms"
```

---

## Task 2: F1 — persistent "current item" orientation header in the dropdown

**Depends on:** Task 1 findings.

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/combobox/ContentCombobox.jsx` (dropdown header region, near `:539-558`)
- Test: `frontend/src/modules/Admin/ContentLists/combobox/ContentCombobox.test.jsx`

**Step 1: Write the failing test.** In the component test file, render `ContentCombobox` with `value="singalong:hymn/1008"` and a mocked hook state in BROWSE mode whose `browse.items` do NOT include `singalong:hymn/1008` (simulate the value being out of the loaded page). Assert an orientation header is shown:
```jsx
it('shows a persistent current-item header when the committed value is not in the loaded browse window', async () => {
  renderCombobox({ value: 'singalong:hymn/1008', mode: 'browse', items: OTHER_HYMNS, resolvedTitle: 'Nearer, My God, to Thee' });
  const header = await screen.findByTestId('combobox-current-anchor');
  expect(header).toHaveTextContent('Nearer, My God, to Thee');
  expect(header).toHaveTextContent(/not in this list|current/i);
});
```
(Follow the existing test's render helper / hook-mock pattern — read `ContentCombobox.test.jsx` first for how it stubs `useContentCombobox`.)

**Step 2: Run to verify it fails.** `npx vitest run frontend/src/modules/Admin/ContentLists/combobox/ContentCombobox.test.jsx -t "current-item header"` → FAIL (`combobox-current-anchor` not found).

**Step 3: Implement.** In the dropdown header (BROWSE mode), when no rendered item's id matches `normalizedValue`, render a compact anchor row:
```jsx
{isBrowse && value && !items.some((it) => normalizeValue(it.id) === normalizedValue) && (
  <Box p="xs" data-testid="combobox-current-anchor" style={{ borderBottom: '1px solid var(--mantine-color-dark-4)' }}>
    <Group gap="xs" wrap="nowrap">
      <Text size="xs" c="dimmed">Current:</Text>
      <Text size="xs" fw={600} truncate>{resolvedTitle || value}</Text>
      <Text size="xs" c="dimmed">— not in this list</Text>
    </Group>
  </Box>
)}
```
Add a `log.debug('orientation.anchor_shown', { value })` guard. If Task 1 found `referenceIndex: -1` is the deeper cause, ALSO ensure `applyBrowseData` highlights `idx: -1` (no phantom row) instead of `0` when the value isn't found (`useContentCombobox.js:278`) — change the fallback and add a matching machine/hook test.

**Step 4: Run to verify green.** Same command → PASS. Run the whole file to ensure no regression: `npx vitest run frontend/src/modules/Admin/ContentLists/combobox/ContentCombobox.test.jsx`.

**Step 5: Commit.** `git commit -am "fix(combobox): persistent current-item orientation header in browse mode (F1)"`

---

## Task 3: F1b — strengthen the "current" row marker salience

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/combobox/ContentCombobox.scss` (`.current` rule, `:83-86`)
- Test: `ContentCombobox.test.jsx` (assert marker attributes exist; visual weight is verified in Task 12 live check)

**Step 1: Write the failing test.** Assert that when a rendered item's id equals `value`, the option gets `data-current="true"` AND a visible label affordance (a "Current" badge):
```jsx
it('marks the committed value row with a Current badge', () => {
  renderCombobox({ value: 'singalong:hymn/1008', mode: 'browse', items: HYMNS_INCLUDING_1008 });
  const row = screen.getByTestId('combobox-option-singalong:hymn/1008'); // add this test id in renderOption
  expect(row).toHaveAttribute('data-current', 'true');
  expect(within(row).getByText(/current/i)).toBeInTheDocument();
});
```

**Step 2: Verify red.** Run the test → FAIL.

**Step 3: Implement.** In `renderOption` (`ContentCombobox.jsx:418-475`), add `data-testid={`combobox-option-${item.id}`}` and, when `isCurrent`, render a small "Current" `Badge` in the right-side group. In SCSS, raise `.current` contrast (e.g. a left accent bar in `var(--ds-accent)` at reduced opacity + subtle background) so it reads without relying on the muted border alone — keep it visually distinct from `.highlighted` (blue).

**Step 4: Verify green.** Run the file → PASS.

**Step 5: Commit.** `git commit -am "fix(combobox): salient Current marker on the committed row (F1b)"`

---

## Task 4: F8 — Back / ArrowLeft at the siblings root closes instead of re-searching the raw id

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/combobox/useContentCombobox.js` (`goUp`, `:374-382`)
- Test: `frontend/src/modules/Admin/ContentLists/combobox/useContentCombobox.test.jsx`

**Step 1: Write the failing test.** Drive the hook into BROWSE at the root (single breadcrumb), call `goUp`, and assert it dismisses to DISPLAY (via `handleClose('dismiss')`-equivalent) rather than dispatching an `INPUT` with the raw content id as search text:
```js
it('goUp at the siblings root dismisses rather than searching the raw id', async () => {
  const { result } = renderHook(...); // value = 'singalong:hymn/1008', opened, siblings loaded (1 crumb)
  act(() => result.current.goUp());
  expect(result.current.state.mode).toBe(Modes.DISPLAY);
  expect(result.current.state.search).toBeNull();
});
```
(Read `useContentCombobox.test.jsx` for the existing renderHook + fetch-mock setup.)

**Step 2: Verify red.** Run → FAIL (mode is SEARCH, search is the id).

**Step 3: Implement.** In `goUp`, replace the root branch that dispatches `INPUT` with the current search text by calling `handleClose('dismiss')` (which resets to DISPLAY keeping `value`, per `comboboxMachine.js:93-94`). Keep `invalidateBrowseLoads()`. Update the log event to `go_back.dismiss_from_root`.

**Step 4: Verify green.** Run → PASS. Run the full hook test file for regressions.

**Step 5: Commit.** `git commit -am "fix(combobox): Back at siblings root dismisses, not re-search raw id (F8)"`

---

## Task 5: F4 — before-pagination scroll restore runs after layout commit (no rug-pull)

**Depends on:** Task 1 F4 findings (magnitude / repro conditions).

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/combobox/ContentCombobox.jsx` (`runPaginate`, `:258-284`)
- Test: `frontend/src/modules/Admin/ContentLists/combobox/comboboxScroll.js` + a new pure helper test, OR a component test asserting the restore uses a post-commit hook.

**Step 1: Extract the restore math into a pure helper (testable).** Create `computeScrollRestore({ prevScrollHeight, newScrollHeight, prevScrollTop })` in `comboboxScroll.js` returning the target `scrollTop`. Write a failing unit test in `comboboxScroll.test.js` (create if absent):
```js
it('preserves the anchored offset when height grows from a prepend', () => {
  expect(computeScrollRestore({ prevScrollHeight: 300, newScrollHeight: 500, prevScrollTop: 40 }))
    .toBe(240); // 40 + (500 - 300)
});
```

**Step 2: Verify red.** `npx vitest run frontend/src/modules/Admin/ContentLists/comboboxScroll.test.js` → FAIL.

**Step 3: Implement the helper + move the write into a layout-committed callback.** Add `computeScrollRestore`. In `runPaginate`, replace the single `requestAnimationFrame` (`:271-273`) with a **double** rAF (mirror the cooldown at `:280-282`) OR — preferred — a `flushSync`-free approach using a ref + `useLayoutEffect` keyed on a "prepend token" so the write happens after React commit but before paint. Simplest correct version that keeps the current structure: double rAF, reading `viewport.scrollHeight` in the inner frame and calling `computeScrollRestore`. Keep the cooldown guard.

**Step 4: Verify green.** Helper test PASS. Then re-run the Task 1 F4 live repro (CPU throttled) and confirm the jump is gone; note the result in the diagnosis doc.

**Step 5: Commit.** `git commit -am "fix(combobox): restore scroll after prepend post-commit, no upward rug-pull (F4)"`

---

## Task 6: F6 — cap the rendered option count on the uncapped SSE path

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/combobox/useContentCombobox.js` (expose a `renderCap`/`truncatedAt` that also applies to SSE, `:535-538`) and/or `ContentCombobox.jsx` (`:617,629-633`)
- Test: `useContentCombobox.test.jsx` and/or `ContentCombobox.test.jsx`

**Step 1: Write the failing test.** With SSE supported and a results array of 200 items, assert the component renders at most `RENDER_CAP` (e.g. 50) options and shows the `results-truncated` affordance:
```jsx
it('caps rendered options and shows the refine hint even on the uncapped SSE path', () => {
  renderCombobox({ mode: 'search', search: 'the', items: makeResults(200) });
  expect(screen.getAllByTestId(/combobox-option-/).length).toBeLessThanOrEqual(50);
  expect(screen.getByTestId('results-truncated')).toBeInTheDocument();
});
```

**Step 2: Verify red.** Run → FAIL (200 rendered, no hint).

**Step 3: Implement.** Introduce `const RENDER_CAP = 50;`. In the component, slice `items.slice(0, RENDER_CAP)` for `renderOption` (keep the full `items` for keyboard math? NO — the index-owned highlight requires DOM order === items order; so cap the machine-visible items instead: dispatch capped results, or clamp `ARROW` `itemCount` to the rendered length). Cleanest: cap at the hook when dispatching `RESULTS` for the SSE path so `items.length` already reflects the cap and highlight math stays consistent. Update `truncatedAt` to fire when `rawResults.length > RENDER_CAP` regardless of transport. Show the existing `results-truncated` hint (`ContentCombobox.jsx:629`) gated on the new condition.

**Step 4: Verify green.** Run → PASS. Add a machine/hook test that `ARROW` down from the last rendered row wraps to 0 within the capped set (no phantom indices).

**Step 5: Commit.** `git commit -am "feat(combobox): cap rendered results + refine hint on SSE path (F6)"`

---

## Task 7: F14 — removable search-scope chip when a source prefix is active

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/combobox/useContentCombobox.js` (derive `activeScope` from the search text prefix; expose a `clearScope()` that rewrites the input to just the term)
- Modify: `ContentCombobox.jsx` (render the chip in the dropdown header, search mode)
- Test: `useContentCombobox.test.jsx` + `ContentCombobox.test.jsx`

**Step 1: Write the failing hook test.** Typing `singalong:nearer` yields `activeScope === 'singalong'`; calling `clearScope()` sets the input/search to `nearer` and re-dispatches search:
```js
it('derives an active source scope from a prefixed query and clears it to the bare term', () => {
  // handleInput('singalong:nearer') → activeScope 'singalong'
  // clearScope() → search 'nearer', activeScope null
});
```
Use the SAME parse rule as the backend to avoid drift: reuse a shared helper (see Task 9) — prefix = `text.match(/^([\w-]+):(.+)$/)`.

**Step 2: Verify red.** Run → FAIL.

**Step 3: Implement.** In the hook, compute `activeScope` from `state.search` and add `clearScope()` that calls `handleInput(term)`. In the component's search-mode header (near the pending-sources strip, `:561`), render:
```jsx
{activeScope && !isBrowse && (
  <Box p="xs" data-testid="combobox-scope-chip">
    <Badge size="sm" variant="light" rightSection={<IconX size={12} onClick={clearScope} />}>
      Searching within {activeScope}
    </Badge>
  </Box>
)}
```
Add `log.debug('search.scope_active', { scope: activeScope })`.

**Step 4: Verify green.** Both tests PASS.

**Step 5: Commit.** `git commit -am "feat(combobox): removable source-scope chip for prefixed search (F14)"`

---

## Task 8: F11 — make freeform auto-resolve visible-pending + undoable (no silent swap)

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/combobox/useAutoResolve.js` (`:99-101` success path)
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx` + `EmptyItemRow.jsx` (surface a pending state on the value card)
- Test: `useAutoResolve.test.jsx`

**Step 1: Write the failing test.** On successful resolve, assert `showUndoToast` is called (not `notifySuccess`) with an `onUndo` that restores the original freeform text:
```jsx
it('offers an undo when auto-resolve swaps a freeform value', async () => {
  // mock fetch → one result; value stays freeform; run maybeResolve
  expect(showUndoToast).toHaveBeenCalledWith(expect.objectContaining({
    onUndo: expect.any(Function),
  }));
  // invoking onUndo calls onChange(originalFreeformText)
});
```

**Step 2: Verify red.** Run `npx vitest run .../useAutoResolve.test.jsx -t "undo"` → FAIL.

**Step 3: Implement.** Import `showUndoToast` from `shared/feedback.js`. Replace the `notifySuccess` call (`useAutoResolve.js:100`) with `showUndoToast({ id: `resolve-${resolved}`, title: 'Auto-resolved', message: `“${freeformText}” → ${items[0].title}`, onUndo: () => onChangeRef.current?.(freeformText) })`. Keep the staleness guard. Log `search.auto_resolve.undone` in the undo handler. (Optional, if Task 1/scope allows: add a `resolving` visual state to `ContentValueCard` — a spinner + the freeform text — driven by a new hook flag; keep this minimal.)

**Step 4: Verify green.** Run → PASS. Run the full `useAutoResolve.test.jsx` for regressions.

**Step 5: Commit.** `git commit -am "fix(combobox): auto-resolve is undoable, not a silent value swap (F11)"`

---

## Task 9: F12 — single source of truth for the content-id / prefix regex (client ↔ server parity)

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/contentSearchLogic.js` (already the client SSOT, `:6`)
- Modify: `backend/src/3_applications/content/ContentQueryService.mjs` (`#parseContentQuery`, `:61`) to accept `[\w-]+`
- Test: `frontend/src/modules/Admin/ContentLists/contentSearchLogic.test.js` + a backend unit test for `#parseContentQuery`

**Step 1: Write failing tests.** Client: `isContentIdLike('some-source:foo') === true` (already passes — assert it). Backend: add a test that `#parseContentQuery('some-source:foo')` returns `{ prefix: 'some-source', term: 'foo' }` (currently returns `{ prefix: null, term: 'some-source:foo' }`).

**Step 2: Verify red.** Backend test → FAIL.

**Step 3: Implement.** Change the server regex `/^(\w+):(.+)$/` → `/^([\w-]+):(.+)$/`. Add a code comment cross-referencing `contentSearchLogic.js` as the client twin so the two stay aligned.

**Step 4: Verify green.** Both PASS.

**Step 5: Commit.** `git commit -am "fix(content): align client/server source-prefix regex to [\\w-]+ (F12)"`

---

## Task 10: F13 — a trailing-colon query resolves to an empty search, not a literal-string search

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/combobox/useContentCombobox.js` (`handleInput` / debounced dispatch, `:208-220`)
- Test: `useContentCombobox.test.jsx`

**Step 1: Write the failing test.** `handleInput('singalong:')` must NOT dispatch a backend search for the literal `"singalong:"`; instead treat it as "term empty" (show the "Type to search…" empty state, or the scope chip with no query):
```js
it('does not search the literal "source:" when the term after the colon is empty', () => {
  // spy on streamSearch/doBatchSearch; handleInput('singalong:')
  expect(streamSearch).not.toHaveBeenCalledWith('singalong:');
});
```

**Step 2: Verify red.** Run → FAIL.

**Step 3: Implement.** In the debounced dispatcher, if the text matches `^[\w-]+:\s*$` (prefix with empty term), dispatch an empty/cleared search (and let Task 7's scope chip show the active source). Reuse the shared prefix parse.

**Step 4: Verify green.** Run → PASS.

**Step 5: Commit.** `git commit -am "fix(combobox): trailing-colon query is empty search, not literal (F13)"`

---

## Task 11: F7 — allow selecting containers on menu/watchlist surfaces (dual affordance)

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx` (`:549` ContentCombobox usage)
- Modify: `frontend/src/modules/Admin/ContentLists/EmptyItemRow.jsx` (`:150`)
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemEditor.jsx` (`:119`)
- Test: `ContentCombobox.test.jsx` (dual-affordance behavior already testable) + a row-level test that clicking a container row with `selectContainers` selects it

**Step 1: Write the failing test.** With `selectContainers`, clicking a container row calls `onChange(containerId)` (select), while the chevron `ActionIcon` (`browse-into-${id}`) drills:
```jsx
it('selects a container on row click and drills via the chevron when selectContainers is set', () => {
  renderCombobox({ selectContainers: true, mode: 'search', items: [PLAYLIST_ITEM] });
  fireEvent.click(screen.getByTestId('combobox-option-plex:playlist-1'));
  expect(onChange).toHaveBeenCalledWith('plex:playlist-1', expect.anything());
});
```

**Step 2: Verify red.** Run → FAIL (row click drills because `selectContainers` unset by default; ensure the test passes the prop and reveals the wiring gap at the row).

**Step 3: Implement.** Pass `selectContainers` on the three ContentLists usages (menus/watchlists/programs are the container-referencing surfaces). Verify the existing dual affordance (`ContentCombobox.jsx:459-472`) renders the chevron `ActionIcon` and that Enter/click select rather than drill. Do NOT change PlaybackHub/FitnessConfig unless their intent is container-as-value.

**Step 4: Verify green.** Run → PASS.

**Step 5: Commit.** `git commit -am "feat(combobox): container-as-value on list surfaces via dual affordance (F7)"`

---

## Task 12: Live verification pass (RTL green ≠ done)

> REQUIRED SUB-SKILL: use superpowers:verification-before-completion.

**Goal:** Drive the real admin surface and confirm each fix behaves, per `feedback_dont_ask_check_yourself` (verify with screenshots/agents, don't ask KC to look).

**Files:** none (verification only); append results to the Task 1 diagnosis doc.

**Steps:**
1. Ensure dev server up (`lsof -i :3111`; else `npm run dev`).
2. For each of F1, F4, F6, F7, F8, F11, F13, F14: exercise the flow on `/admin/content/lists/menus` (and `/admin/test/combobox` where relevant) and capture a screenshot proving the new behavior. Use a Playwright script under `tests/live/flow/admin/` if practical, else scripted browser + screenshot.
3. Run the existing combobox Playwright suites to confirm no regression: `npx playwright test tests/live/flow/admin/content-search-combobox/ --reporter=line`.
4. Run all combobox unit/component tests: `npx vitest run frontend/src/modules/Admin/ContentLists/`.
5. Record PASS/FAIL with evidence in the diagnosis doc. Any FAIL loops back to the owning task.

**Commit:** `git commit -am "test(combobox): live verification evidence for UX overhaul"`

---

## Task 13: Docs + finishing (merge decision is human-gated)

> REQUIRED SUB-SKILL: use superpowers:finishing-a-development-branch.

**Files:**
- Modify: `docs/_wip/audits/2026-07-11-content-combobox-ux-risk-audit.md` — mark each finding Resolved with the commit that closed it, and correct the F1 mechanism per Task 1.
- Modify: any combobox reference docs if present (`grep -rn combobox docs/reference`).

**Steps:**
1. Update the audit's §7 table to "Resolved (commit …)" per finding; rewrite F1's mechanism to the Task-1-confirmed truth.
2. Run the full local gate the repo uses for JS units: `npx vitest run frontend/src/modules/Admin/ContentLists/` and `npm run test:refactor` (layer/architecture guard) — both green.
3. **STOP for the merge decision — do NOT auto-push.** Present to the human:
   - Local `main` == `origin/main`, but the **homeserver deploy tree has ~10 unpushed piano commits on its `main`** (disjoint files). Pushing this branch's merge to `origin/main` will make `origin/main` diverge from the homeserver's local `main`.
   - Options: (a) fast-forward/merge `feat/combobox-ux-overhaul` into local `main`, then **integrate the homeserver's piano commits before pushing** so `origin/main` is one source of truth; (b) merge + push combobox now and reconcile the piano commits separately on the homeserver; (c) keep the branch unpushed and let KC drive the merge.
4. On the chosen path, execute the merge (per `CLAUDE.md` Branch Management: merge to main, then record + delete the feature branch in `docs/_archive/deleted-branches.md`). Push only if the human authorizes it.
5. Remove the worktree when merged: `git worktree remove ../DaylightStation-combobox-ux`.

**Commit (docs):** `git commit -am "docs(combobox): mark UX audit findings resolved; correct F1 mechanism"`

---

## Execution order & dependency notes

- Task 1 (diagnosis) gates Tasks 2 & 5.
- Task 9 (shared regex) should land before/with Task 7 (scope) and Task 10 (trailing-colon) so all three use one parse rule — if convenient, do Task 9 first, then 7/10 reuse it.
- Tasks 3, 4, 6, 8, 11 are independent and can be done in any order.
- Task 12 (live verify) after all fixes; Task 13 last.
- Every task: red → green → commit. No pushes until Task 13's human gate.
