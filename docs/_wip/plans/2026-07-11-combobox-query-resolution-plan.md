# ContentCombobox Query-to-ID Resolution — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: superpowers:executing-plans. Each task is TDD: write failing test → verify red → implement → verify green → commit. Work in the isolated worktree; never `git checkout`/push.

**Goal:** Make the combobox render human input into a content id on commit — pick the resolved match, let the human own the lineage level, and only ever fall back to the raw literal when nothing resolves. Implements `2026-07-11-combobox-query-resolution-design.md`.

**Architecture:** A single **pure decision function** `decideCommit(...)` encodes the entire resolution order (design §"Commit resolution order"). The hook (`useContentCombobox.js`) executes the decision and owns the one async signal it needs (`searchSettled`). The component routes every close gesture (Enter / blur / Escape / Tab / freeform-row click) through the hook's `commit(reason)`. Frontend-only — the backend already does scoped-search + parallel id-lookup + prefix aliases.

**Tech Stack:** React 18, Mantine v7 Combobox, Vitest + RTL. Worktree: `/Users/kckern/Documents/GitHub/DS-combobox-resolve`, branch `feat/combobox-query-resolution` (node_modules symlinked; DEFAULT vitest reporter — `--reporter=line` unsupported).

**Invariants that MUST survive (do not regress):**
- **Mar-01:** an auto-highlighted row is NEVER committed — only `highlight.userNavigated` rows count as an explicit pick.
- The 95 existing combobox tests stay green.
- F7 dual affordance (chevron drills, row/Enter selects a container), F8/F11/F13/F14 behavior unchanged except where a rule below supersedes them.
- No junk-on-blur (the 2026-03-01 junk-entries family): a non-Enter close never auto-commits an unpicked query.

**Global rules:** structured logger only (no `console.*`); YAGNI; commit per task with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; do NOT push (merge is human-gated).

---

## Task 1: Pure `decideCommit` decision function

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/combobox/comboboxMachine.js` (add `decideCommit`; keep `closeDecision` for now — Task 2 stops using its commit branch)
- Test: `frontend/src/modules/Admin/ContentLists/combobox/comboboxMachine.test.js`

**The function (spec — implement exactly this decision order):**
```js
/**
 * Decide what a close gesture commits. Pure: no React/fetch.
 * @param reason 'enter'|'blur'|'outside'|'tab'|'escape'
 * @param isContainer (item) => boolean   // injected (ContentCombobox.isContainer)
 * @returns one of:
 *   { action:'select', item }   commit item.id
 *   { action:'drill',  item }   navigate into a container (Enter on container, no selectContainers)
 *   { action:'open' }           keep dropdown open, commit nothing (ambiguous / still loading)
 *   { action:'literal', value } commit raw text + flag (Enter, settled, no match)
 *   { action:'revert' }         close, keep prior value (unpicked query on a non-Enter close)
 *   { action:'dismiss' }        close, keep prior value (Enter with <2-char query)
 *   { action:'none' }           nothing changed
 */
export function decideCommit({ reason, search, value, results, highlightIdx, userNavigated, selectContainers, searchSettled, isContainer }) {
  // 1. Explicit pick — any reason (Mar-01: only user-navigated rows)
  if (userNavigated && highlightIdx >= 0 && results[highlightIdx]) {
    const item = results[highlightIdx];
    return (isContainer(item) && !selectContainers) ? { action: 'drill', item } : { action: 'select', item };
  }
  if (search === null || search === value) return { action: 'none' };
  // 2. Non-Enter closes never auto-render or literal-commit an unpicked query (no junk-on-blur)
  if (reason !== 'enter') return { action: 'revert' };
  // 3. Enter, no explicit pick:
  if (search.trim().length < 2) return { action: 'dismiss' };
  if (results.length === 0) {
    return searchSettled ? { action: 'literal', value: search } : { action: 'open' };
  }
  // 4. Unambiguous leaf renders; containers/ambiguous stay open for the human
  const idLookupLeaf = results.find((r) => r.matchReason === 'id-lookup' && !isContainer(r));
  if (idLookupLeaf) return { action: 'select', item: idLookupLeaf };
  if (results.length === 1 && !isContainer(results[0])) return { action: 'select', item: results[0] };
  return { action: 'open' };
}
```

**Steps:**
1. Read `comboboxMachine.js` + its test file for style/harness.
2. Write FAILING tests covering every branch, one assert-block each (use a simple `isContainer = (i) => i.type === 'show' || i.itemType === 'container'` in tests):
   - explicit pick leaf → `select`; explicit pick container w/o selectContainers → `drill`; with selectContainers → `select`.
   - `search === value` → `none`; `search === null` → `none`.
   - reason `blur`/`outside`/`escape`/`tab` with a changed query → `revert`.
   - Enter, `<2` chars → `dismiss`.
   - Enter, `results:[]`, `searchSettled:false` → `open`; `searchSettled:true` → `literal` (value === the query).
   - Enter, one leaf result → `select` that item; one container result → `open`; multiple results → `open`.
   - Enter, an `id-lookup` leaf present among results → `select` the id-lookup item (covers `plex:642197`).
3. Red → implement → green. Run whole file.
4. Commit: `fix(combobox): decideCommit — pure query-to-id resolution decision (design rules 1-6)`

---

## Task 2: Hook — `searchSettled` signal + `commit(reason)` executor + no-match flag

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/combobox/useContentCombobox.js`
- Test: `frontend/src/modules/Admin/ContentLists/combobox/useContentCombobox.test.jsx`

**2a — `searchSettled`:** derive a boolean that is true when a search has been dispatched for the current text AND the transport is no longer searching (results are final for this query), false while a query is in flight or debouncing. Sources already in the hook: `isSearching` (`streamSearching || batchLoading`), `queryRef.current`, `state.search`. A minimal correct signal: `searchSettled = !isSearching && queryRef.current === (state.search ?? '') && (state.search ?? '').trim().length >= 2`. Confirm against the debounce: right after `handleInput`, `queryRef` is stale until the 300 ms `debouncedSearch` fires — so `searchSettled` is false until the query is actually dispatched and returns. Add a test that it's false immediately after `handleInput` and true after the mocked transport resolves.

**2b — `commit(reason)`:** new callback that:
1. builds `isContainer` — import the SAME predicate the component uses. **Refactor:** move `isContainer` out of `ContentCombobox.jsx` into a shared module (e.g. add to `comboboxMachine.js` or a small `combobox/itemShape.js`) and import it in both places, so the hook and component agree. (Do this move as the first step of 2b; keep the component importing it.)
2. calls `decideCommit({ reason, search: state.search, value, results: state.results, highlightIdx: state.highlight.idx, userNavigated: state.highlight.userNavigated, selectContainers, searchSettled, isContainer })`. NOTE: `selectContainers` must be threaded into the hook — add it to the hook's args (default false) and pass from the component.
3. executes:
   - `select` → `select(decision.item)` (existing helper: onChange(id,item)+close).
   - `drill` → `drill(decision.item)` (stay open; do NOT close).
   - `open` → do nothing (leave dropdown open).
   - `literal` → `onChangeRef.current?.(decision.value)`; fire a warn flag toast (`import { notify... }` — use the existing warn toast helper in `shared/feedback.js`; message `Couldn't resolve “${decision.value}” — saved as raw id`); then close via `dispatch({type:'CLOSE'})` + `cancelPendingSearch()`. Log `commit.literal_fallback`.
   - `revert` → close keeping value: `invalidateBrowseLoads(); dispatch({type:'CLOSE'}); cancelPendingSearch();` Log `commit.revert`.
   - `dismiss` → same close-keeping-value. Log `commit.dismiss`.
   - `none` → close. 
   Return the decision (so the component knows whether it stayed open).
4. Expose `commit` from the hook. Keep `select`, `drill`, `handleClose` (Escape/Tab still call handleClose for the pure-close path — or route through commit; see Task 3).

**2c — stop `handleClose` from id-committing:** `handleClose` currently calls `closeDecision` which commits id-like text. Once the component routes commits through `commit(reason)`, `handleClose` should only ever close/revert (never commit). Simplest: make `handleClose` delegate to `commit(reason)` OR strip its commit branch. Decide during impl; ensure no double-commit (existing `freeform.commit_on_close` path must not fire alongside `commit`).

**Steps:** read the hook; write failing tests: (i) `searchSettled` timing; (ii) `commit('enter')` with a single leaf result → `onChange(item.id, item)` called + mode DISPLAY; (iii) `commit('enter')` with settled-empty results → `onChange(rawText)` + warn toast + DISPLAY; (iv) `commit('blur')` with a changed unpicked query → NO onChange, value preserved (revert); (v) `commit('enter')` with an id-lookup leaf → selects it. Red → implement → green (whole combobox dir). Commit: `feat(combobox): hook commit(reason) executes decideCommit + no-match flag`.

---

## Task 3: Component — route every close gesture through `commit`

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/combobox/ContentCombobox.jsx`
- Test: `frontend/src/modules/Admin/ContentLists/combobox/ContentCombobox.test.jsx`

**Changes (read lines 114, 148, 184-190, 193-202, 205-253, 512, 676 first):**
1. Destructure `commit` from the hook; pass `selectContainers` INTO the hook call (so the hook can thread it to `decideCommit`).
2. `handleKeyDown` Enter (lines 229-244): replace the whole body with `e.preventDefault(); const d = commit('enter'); ...`. If `commit` returns `{action:'drill'}` the dropdown stays open (drill handles it); otherwise it closed. Delete the local `commitFreeform`-based branch and the `userNavigated ? items[highlightIdx] : null` logic — that now lives in `decideCommit`.
3. `onDropdownClose` (line 148): when Mantine initiates the close and mode !== DISPLAY, call `commit('outside')` instead of `handleClose('outside')`.
4. Escape (line 249) → `commit('escape')`; Tab (line 253) → `commit('tab')`. (Both map to `revert` in decideCommit — preserves "Escape reverts".)
5. Freeform row (`showFreeform`, lines 512/676): keep it as the EXPLICIT raw-commit affordance. Its `handleOptionSubmit('__freeform__')` path should commit the literal WITHOUT the warn flag (the user explicitly chose raw) — call a dedicated `onChange(search)` + close, or `commit('freeform-explicit')` mapping to `{action:'literal'}` sans toast. Keep it simple: leave the existing `commitFreeform` for THIS explicit path only (rename to `commitExplicitRaw`), and stop using it for Enter.
6. `handleOptionSubmit` for a real row (mouse click): unchanged (drill container w/o selectContainers, else select) — that's already the explicit-pick path.

**Steps:** read the file; write failing/component tests: (i) Enter on a typed query with one leaf result → hook `select` invoked (mock hook) with that item; (ii) Enter with multiple results → dropdown stays open, no commit; (iii) Escape → revert (value preserved, no onChange); (iv) the freeform row still commits raw explicitly. Because the component tests mock the hook, assert that `commit` is called with the right reason and that the component honors an `{action:'open'}` return by keeping the dropdown open. Red → implement → green (whole dir). Commit: `feat(combobox): route Enter/blur/Escape/Tab/freeform through commit(reason)`.

---

## Task 4: Full-suite regression + docs + finishing

**Files:** design doc + audit note; `docs/_archive/deleted-branches.md` at merge.

**Steps:**
1. `npx vitest run frontend/src/modules/Admin/ContentLists/` — ALL green (95 prior + new). Investigate any regression; a prior test that asserted the OLD literal-commit-on-idlike behavior must be updated to the new contract with a noted justification (expected: the F13/F14 tests still pass; any test asserting `singalong:...` commits literally on Enter is now wrong and must flip to assert resolution/open).
2. Manually re-read the diff for the Mar-01 invariant and the no-junk-on-blur invariant.
3. Update `2026-07-11-combobox-query-resolution-design.md` status → Implemented (commit SHAs); add a short "resolved" note to the UX audit if useful.
4. **Live/visual verification:** deferred (shared dev env in use by the piano agent) — record the manual test script (the 8-row edge table) for a later pass.
5. **Finish (human-gated):** `git fetch origin`; merge `feat/combobox-query-resolution` → local `main` (integrate any parallel piano work; disjoint expected); run the combobox suite on merged main; **PAUSE for KC's push OK**; on approval push, then remove worktree + record the branch in `docs/_archive/deleted-branches.md`.

---

## Dependency order
Task 1 → Task 2 → Task 3 → Task 4 (strictly serial; each builds on the prior). All four touch overlapping files, so no parallelism.
