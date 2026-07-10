# Admin UX Remediation (Combobox Unification + Consistency Pass) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate the Admin content-combobox twin fork and its data-corrupting commit behavior, then bring Admin-wide save/feedback/confirmation UX to one consistent model, per `docs/_wip/audits/2026-07-09-admin-ux-user-journey-and-combobox-audit.md`.

**Architecture:** Four phases. Phase 0 surgically fixes the inline twin's destructive blur-commit/auto-resolve and two standalone state/scroll bugs. Phase 1 replaces both implementations with ONE component built around a pure, unit-tested state machine (`DISPLAY / SEARCH / BROWSE` modes), consumed by all six call sites. Phase 2 is the Admin-wide consistency pass (unsaved-changes guard, feedback, confirmation, dedupe). Phase 3 is small backend truthfulness work that unblocks polish.

**Tech Stack:** React 18, Mantine 7 (`Combobox`/`useCombobox`), react-router-dom 6.24 (**BrowserRouter, NOT a data router — `useBlocker` is unavailable**), vitest + @testing-library (colocated `*.test.jsx`), Playwright live suites under `tests/live/flow/admin/content-search-combobox/`.

---

## Context primer (read before Task 1)

**The twins.** Two implementations of the same control exist:
- **Standalone:** `frontend/src/modules/Admin/ContentLists/ContentSearchCombobox.jsx` (814 lines). SSE streaming search via `frontend/src/hooks/useStreamingSearch.js`, commit-on-close policy (id-like text commits, exploratory text reverts), clear ×, resolved-title line, `selectContainers`/`searchParams` props, `onChange(id, item)`. Consumers: `ContentLists/ListsItemEditor.jsx:119`, `PlaybackHub/components/LabeledContentPicker.jsx:17`, `Apps/FitnessConfig.jsx:274`, `TestHarness/ComboboxTestPage.jsx:51`.
- **Inline twin:** function `ContentSearchCombobox` inside `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx:732` (file is 3,030 lines). Batch tier-1/tier-2 search, custom keyboard model, siblings cache, `ContentDisplay` cards, app-registry results — and **blur-commits ANY typed text** (`:1467-1478`) then auto-resolves it to the top search hit (`:1524-1560`). `onChange(val)` only. Consumers: every list row (`:2861`) and `EmptyItemRow` (`:2993`), which **auto-adds an item whenever `input` changes** (`:2955-2959`).

**The trap:** all 17 Playwright suites in `tests/live/flow/admin/content-search-combobox/` drive `/admin/test/combobox`, which mounts the **standalone**. The inline twin has zero isolated coverage. Suite semantics are the behavior contract — read `tests/live/flow/admin/content-search-combobox/README.md` first.

**Invariants you must not break:**
1. *Typed input is never lost without the user seeing it.* Id-like text (`plex:123`, `canvas:foo/bar.jpg`) always commits. Exploratory text may revert on close but must commit via explicit gestures (Enter with no option highlighted, the "Use ‘…’ as raw value" row). See `docs/_wip/bugs/2026-03-01-admin-freeform-commit-must-always-save.md` and suite `12-freeform-commit`.
2. *Enter selects a result only when the user arrow-navigated to it* (`userNavigatedRef` pattern), never an auto-highlighted row.
3. *Test discipline:* no vacuously-true tests, no conditional assertion skipping (CLAUDE.md Testing section).

**Environment:**
- Dev server: check `lsof -i :3111` first; if not running, `npm run dev` from repo root (Vite :3111 proxying to backend :3112 on this machine). Logs tee to `dev.log`.
- Playwright: `npx playwright test tests/live/flow/admin/content-search-combobox/ --reporter=line` (needs dev server; config reuses it).
- Frontend unit tests: `npx vitest run <path>` (colocated `*.test.jsx`, see `PlaybackHub/components/LabeledContentPicker.test.jsx` for the house style). Repo-wide vitest gate: `node scripts/gate-vitest.mjs`.
- Structured logging only — no raw `console.*`. Pattern: `adminLog('Component')` in ContentLists, `getChildLogger` elsewhere (see CLAUDE.md Logging).

---

## Task 0: Worktree + branch

**Step 1:** Confirm clean tree and sync per CLAUDE.local.md: `git fetch origin && git log --oneline origin/main..HEAD`, and check the homeserver deploy tree for unpushed work (`ssh homeserver.local 'cd /opt/Code/DaylightStation && git log --oneline origin/main..HEAD | head'`). Integrate first if ahead.

**Step 2:** Create worktree: `git worktree add .worktrees/admin-ux-remediation -b feat/admin-ux-remediation` and work there. Per-task commits are authorized on this feature branch.

**Step 3:** `npm install` is NOT needed in the worktree if `node_modules` is symlinked/hoisted — verify `npx vitest --version` works from the worktree; if not, run `npm install` in it.

---

# Phase 0 — Stop the bleeding (inline twin + standalone hotfixes)

## Task 1: Shared id-like predicate in `contentSearchLogic.js`

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/contentSearchLogic.js`
- Test: `frontend/src/modules/Admin/ContentLists/contentSearchLogic.test.js` (create)

**Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { isContentIdLike, shouldAutoAdd } from './contentSearchLogic.js';

describe('isContentIdLike', () => {
  it.each([
    ['plex:456724', true],
    ['canvas:religious/stars.jpg', true],
    ['hymn: 147', true],            // space after colon is legal in list YAML
    ['app:webcam', true],
    ['star wars', false],           // exploratory text
    ['beet', false],
    ['plex:', false],               // no local id
    ['', false],
    [null, false],
  ])('%s → %s', (input, expected) => {
    expect(isContentIdLike(input)).toBe(expected);
  });
});

describe('shouldAutoAdd', () => {
  it('adds for id-like input (dropdown picks produce these)', () => {
    expect(shouldAutoAdd('plex:123')).toBe(true);
  });
  it('does NOT add for freeform text (junk-entries guard)', () => {
    expect(shouldAutoAdd('star wars')).toBe(false);
  });
});
```

**Step 2:** `npx vitest run frontend/src/modules/Admin/ContentLists/contentSearchLogic.test.js` — expect FAIL (`isContentIdLike` not exported).

**Step 3: Implement** (append to `contentSearchLogic.js`):

```js
// Content-id-like text (`plex:456724`, `hymn: 147`, `canvas:a/b.jpg`) is an
// intentional commit; exploratory search text is not. Space after the colon
// is tolerated because list YAML historically stores `hymn: 147`.
// Single source of truth — ContentSearchCombobox.jsx and ListsItemRow.jsx
// must import this, not re-declare it.
export const CONTENT_ID_LIKE = /^[\w-]+:\s?\S+/;

export function isContentIdLike(text) {
  return typeof text === 'string' && CONTENT_ID_LIKE.test(text);
}

// EmptyItemRow auto-add gate: only auto-persist values that came from a
// dropdown selection or a pasted content id. Freeform text must be added
// explicitly (Enter on the row). Root cause of the 2026-03-01 tvapp.yml
// junk-entries bug: blur-commit → setInput → auto-add POST of raw text.
export function shouldAutoAdd(input) {
  return isContentIdLike(input);
}
```

**Step 4:** Re-run vitest — expect PASS.

**Step 5:** In `ContentSearchCombobox.jsx`, delete the local `CONTENT_ID_LIKE` at `:68` and the duplicated inline regex at `:106`, importing instead:
`import { CONTENT_ID_LIKE, isContentIdLike } from './contentSearchLogic.js';` — use `isContentIdLike(value)` at `:106` and keep `CONTENT_ID_LIKE.test(search)` at `:193`. Run `npx vitest run frontend/src/modules/Admin/ContentLists/` and `cd frontend && npm run lint`.

**Step 6: Commit** — `git commit -m "feat(admin): shared isContentIdLike/shouldAutoAdd predicates in contentSearchLogic"`

## Task 2: Playwright regression spec for the REAL list-row surface (write it failing)

**Files:**
- Create: `tests/live/flow/admin/content-search-combobox/18-inline-row-commit-policy.runtime.test.mjs`

This is the first test ever pointed at the inline twin. It drives `/admin/content/lists/menus`, opens the first list card, and exercises the first row's input cell and the EmptyItemRow. Use existing harness helpers (`tests/_lib/comboboxTestHarness.mjs`) for log tailing; locators here are row-scoped (`.item-row .col-input input`, `.empty-row .col-input input`).

**Step 1: Write the failing tests** (three cases):

```js
// Case A — blur must NOT commit exploratory text (audit I1)
// type "zzqx exploratory" into an existing row's input cell, click elsewhere,
// reload the page → assert the row's input still shows its ORIGINAL value
// (read it before typing) and no PUT /api/v1/... fired (intercept network).

// Case B — blur MUST still commit id-like text (Mar-01 invariant)
// type "plex:999999999" into the row input, click elsewhere →
// assert exactly one PUT fired with input === "plex:999999999".
// Cleanup: restore the original value via the same PUT before test ends.

// Case C — EmptyItemRow must not auto-add freeform text (audit I2 chain)
// type "zzqx junk" into the empty row's combobox, press Escape, click away →
// assert no POST (addItem) fired and the list length is unchanged after reload.
```

Write them with real assertions (no conditional skips). Intercept with `page.route('**/api/v1/**', ...)` recording method+URL+body; assert on the recorded array.

**Step 2:** Run: `npx playwright test tests/live/flow/admin/content-search-combobox/18-inline-row-commit-policy.runtime.test.mjs --reporter=line`
Expected: **Case A and C FAIL** (blur currently commits; auto-add currently fires), Case B passes. This failure is the proof the bug exists — keep the output in the commit message.

**Step 3: Commit** the red tests — `git commit -m "test(admin): failing specs pinning inline-row commit policy (blur-revert, id-like commit, no junk auto-add)"`

## Task 3: Inline twin — blur commits only id-like text

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx:1467-1478` (`handleBlur`)

**Step 1: Implement.** Import `isContentIdLike` at the top of the file. Replace `handleBlur`:

```js
const handleBlur = () => {
  // Delay to allow click events on dropdown to fire first
  blurTimeoutRef.current = setTimeout(() => {
    if (searchQuery && searchQuery !== value && isContentIdLike(searchQuery)) {
      // Intentional direct-id entry — always saved (2026-03-01 invariant).
      commitFreeformText('blur');
    } else if (searchQuery && searchQuery !== value) {
      // Exploratory search text — revert, never commit on blur (audit I1).
      // Explicit gestures (Enter/Tab) still commit freeform via handleKeyDown.
      log.info('blur.revert_exploratory', { discarded: searchQuery, kept: value });
      resetComboboxState();
    } else {
      log.debug('blur.no_change', { searchQuery, value });
      resetComboboxState();
    }
  }, 150);
};
```

Enter/Tab paths in `handleKeyDown` (`:1568-1596`) stay unchanged — they are the explicit freeform gestures.

**Step 2:** Run Task 2's spec — Case A now PASSES, Case B still PASSES. Case C still fails (next task).

**Step 3: Commit** — `git commit -m "fix(admin): inline combobox blur reverts exploratory text; only id-like input commits (audit I1)"`

## Task 4: EmptyItemRow — gate auto-add

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx:2954-2959`

**Step 1: Implement:**

```js
// Auto-save only when the input is a real content id (dropdown pick or
// pasted id). Freeform text stays staged; Enter adds it explicitly.
useEffect(() => {
  if (input && shouldAutoAdd(input)) {
    doAdd(input, label, action);
  }
}, [input]);
```

(`handleKeyDown` at `:2948-2952` already provides the explicit Enter path for freeform.)

**Step 2:** Run Task 2's spec — all three cases PASS.

**Step 3:** Update the bug doc `docs/_wip/bugs/2026-03-01-admin-menu-editor-junk-entries.md`: set Status to **Fixed**, add a Resolution section naming the root cause (blur-commit → `setInput` → auto-add) and the two commits.

**Step 4: Commit** — `git commit -m "fix(admin): EmptyItemRow auto-adds only id-like input — closes 2026-03-01 junk-entries bug"`

## Task 5: Inline twin — auto-resolve becomes visible, never a background swap

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx:1519-1560` (`commitFreeformText`)

After Tasks 3–4, auto-resolve can only be reached via explicit Enter/Tab freeform commits (blur no longer commits non-id text). Two remaining hazards: the value can be swapped up to 15s later with nothing shown, and it can clobber a newer manual edit.

**Step 1: Implement.** Add a `valueRef` kept current each render (`const valueRef = useRef(value); valueRef.current = value;` near the other refs). In the auto-resolve `.then`:

```js
.then(data => {
  if (!autoResolveRef.current || autoResolveRef.current.query !== searchQuery) return;
  const items = data?.items || [];
  if (items.length > 0 && valueRef.current === searchQuery) {
    // Only replace if the committed value is still the freeform text —
    // never clobber a newer manual edit (audit I2).
    const resolved = items[0].id || `${items[0].source}:${items[0].localId}`;
    log.info('search.auto_resolve.success', { query: searchQuery, resolvedTo: resolved, title: items[0].title });
    onChange(resolved);
    notifySuccess('auto_resolve', `Resolved “${searchQuery}” → ${items[0].title}`);
    fetchContentMetadata(resolved).then(info => { if (info) setContentInfo(resolved, info); });
  } else if (items.length > 0) {
    log.info('search.auto_resolve.skipped_stale_value', { query: searchQuery, currentValue: valueRef.current });
  } else {
    log.info('search.auto_resolve.no_results', { query: searchQuery });
  }
  autoResolveRef.current = null;
})
```

Import `notifySuccess` from `../shared/feedback.js` (check its exact signature in `frontend/src/modules/Admin/shared/feedback.js` before use — it takes an event key + message; mirror an existing call site such as `Household/DeviceEditor.jsx`).

**Step 2:** Manual verify (dev server): in a list row, type `frozen` + Enter → row shows the freeform text, then a green toast announces the resolution when it lands. Type `frozen` + Enter then immediately pick a different item → no late swap (check `search.auto_resolve.skipped_stale_value` in browser console with `window.DAYLIGHT_LOG_LEVEL='debug'`).

**Step 3:** Run suites 12 + 18: `npx playwright test tests/live/flow/admin/content-search-combobox/12-freeform-commit.runtime.test.mjs tests/live/flow/admin/content-search-combobox/18-inline-row-commit-policy.runtime.test.mjs --reporter=line` — all green.

**Step 4: Commit** — `git commit -m "fix(admin): auto-resolve is toast-visible and never clobbers a newer value (audit I2)"`

## Task 6: Standalone — pagination reset on browse transitions (audit S1)

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ContentSearchCombobox.jsx` (`browseContainer` `:381-407`, `goBack` `:410-444`)
- Test: extend `tests/live/flow/admin/content-search-combobox/03-browse-mode.runtime.test.mjs`

**Step 1: Write the failing test.** In suite 03, add: open combobox with a committed value that has paginated siblings (use `dynamicFixtureLoader` to find a large container), drill into any container row, then scroll the dropdown viewport to the bottom. Intercept network: assert **no request to `/api/v1/siblings/`** fires after the drill (the bug symptom — sibling pages of the old value appended into the drilled folder).

**Step 2:** Run it — expect FAIL (a `/siblings/` request fires on scroll).

**Step 3: Implement.** In `browseContainer`, alongside `setBrowseResults(data.items || [])` add `setPagination(null);`. Same in `goBack` (both the `<=1` early-return branch and the parent-fetch branch).

**Step 4:** Re-run suite 03 — PASS. Run the full folder to catch regressions: `npx playwright test tests/live/flow/admin/content-search-combobox/ --reporter=line`.

**Step 5: Commit** — `git commit -m "fix(admin): reset siblings pagination when drilling/backing in browse mode (audit S1)"`

## Task 7: Standalone — no page-load from the initial reference scroll (audit S2)

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ContentSearchCombobox.jsx` (`loadSiblings` `:277-289`, prepend compensation `:331-343`)

**Step 1: Implement two changes:**
1. In `loadSiblings`, wrap the reference `scrollIntoView` with the existing cooldown so the programmatic scroll can't trip the `y < 50` before-loader:

```js
if (data.referenceIndex != null && data.referenceIndex >= 0) {
  loadCooldownRef.current = true;
  requestAnimationFrame(() => {
    const viewport = scrollViewportRef.current;
    if (viewport) {
      const options = viewport.querySelectorAll('[data-combobox-option]');
      options[data.referenceIndex]?.scrollIntoView({ block: 'center' });
    }
    // Release only after the scroll event from scrollIntoView has flushed.
    requestAnimationFrame(() => { requestAnimationFrame(() => { loadCooldownRef.current = false; }); });
  });
}
```

2. Add `style={{ overflowAnchor: 'none' }}` to the ScrollArea viewport (via `viewportProps={{ style: { overflowAnchor: 'none' } }}` on `ScrollArea.Autosize`) so the browser's scroll anchoring stops fighting the manual prepend compensation at `:337-342`.

**Step 2:** Manual verify: open a combobox whose committed value sits deep in a large folder (siblings window has `hasBefore`) — the dropdown must open centered with **no visible jump** and no immediate 'before' fetch (network tab). Then scroll up deliberately → 'before' page loads and the viewport does not jump.

**Step 3:** Full folder run: `npx playwright test tests/live/flow/admin/content-search-combobox/ --reporter=line` — green.

**Step 4: Commit** — `git commit -m "fix(admin): initial reference scroll cannot trigger page-load; disable scroll anchoring in dropdown (audit S2)"`

**Phase 0 checkpoint:** run the entire combobox folder + `npx vitest run frontend/src/modules/Admin/` + `cd frontend && npm run lint`. All green before Phase 1.

---

# Phase 1 — Unify the twins (one component, one behavior)

Design decisions (locked by the audit — do not relitigate during execution):
- **Contract:** `<ContentCombobox value onChange(id, item?) placeholder selectContainers searchParams renderValue resolveContentInfo appResults />`. `renderValue` (optional) renders the committed-value display (ListsItemRow passes its card components); default is the standalone's TextInput + resolved-title line. `appResults` (bool) merges app-registry matches (only ListsItemRow surfaces want this).
- **Transport:** SSE (`useStreamingSearch`) is the only search path. Tier-1/tier-2 batch dies; the "Search all sources…" affordance is unnecessary since SSE already fans out to all sources. Keep the non-SSE batch fallback exactly as the standalone has it.
- **Commit policy:** the standalone's (commit-on-close for id-like, revert exploratory, explicit freeform row, Escape reverts, Enter commits freeform only when nothing is user-highlighted).
- **Keyboard:** the inline twin's model (wrap-around arrows with `userNavigated` tracking, ArrowRight drills containers, ArrowLeft goes up when cursor at 0 or browsing, select-after-colon on open).
- **State:** a pure reducer, not boolean soup.

## Task 8: The state machine — `comboboxMachine.js` (pure, fully unit-tested)

**Files:**
- Create: `frontend/src/modules/Admin/ContentLists/combobox/comboboxMachine.js`
- Test: `frontend/src/modules/Admin/ContentLists/combobox/comboboxMachine.test.js`

**Step 1: Write the failing tests first.** Each historical bug becomes a named test. Minimum set:

```js
import { describe, it, expect } from 'vitest';
import { reducer, initialState, Modes, closeDecision } from './comboboxMachine.js';

const open = (s) => reducer(s, { type: 'OPEN' });
const type_ = (s, text) => reducer(s, { type: 'INPUT', text });

describe('comboboxMachine', () => {
  it('open seeds search with committed value and enters SEARCH mode', () => {
    let s = open(initialState('plex:123'));
    expect(s.mode).toBe(Modes.SEARCH);
    expect(s.search).toBe('plex:123');
  });

  it('§3.1-2/10: CLOSE clears results, breadcrumbs, and pagination', () => {
    let s = open(initialState('plex:123'));
    s = reducer(s, { type: 'BROWSE_LOADED', items: [{ id: 'plex:1' }], breadcrumbs: [{ id: 'plex:0' }], pagination: { hasAfter: true } });
    s = reducer(s, { type: 'CLOSE', reason: 'outside' });
    expect(s.mode).toBe(Modes.DISPLAY);
    expect(s.browse.items).toEqual([]);
    expect(s.browse.pagination).toBeNull();
    expect(s.search).toBeNull();
  });

  it('S1: DRILL_LOADED replaces pagination (never inherits siblings window)', () => {
    let s = open(initialState('plex:123'));
    s = reducer(s, { type: 'BROWSE_LOADED', items: [], breadcrumbs: [], pagination: { hasAfter: true, offset: 40 } });
    s = reducer(s, { type: 'DRILL_LOADED', crumb: { id: 'plex:9' }, items: [{ id: 'plex:c1' }], pagination: null });
    expect(s.browse.pagination).toBeNull();
  });

  it('typing exits BROWSE, wipes browse state, enters SEARCH', () => {
    let s = open(initialState('plex:123'));
    s = reducer(s, { type: 'BROWSE_LOADED', items: [{ id: 'x' }], breadcrumbs: [{ id: 'p' }], pagination: {} });
    s = type_(s, 'be');
    expect(s.mode).toBe(Modes.SEARCH);
    expect(s.browse.items).toEqual([]);
    expect(s.browse.pagination).toBeNull();
  });

  it('Mar-01 invariant: Enter selects only when userNavigated', () => {
    let s = open(initialState(''));
    s = type_(s, 'beet');
    s = reducer(s, { type: 'RESULTS', items: [{ id: 'plex:5' }] });
    expect(s.highlight.userNavigated).toBe(false);         // auto state
    s = reducer(s, { type: 'HIGHLIGHT', idx: 0, userNavigated: true });
    expect(s.highlight.userNavigated).toBe(true);
  });

  it('closeDecision: escape reverts, id-like commits, exploratory reverts', () => {
    expect(closeDecision({ search: 'plex:9', value: 'plex:1' }, 'escape')).toEqual({ action: 'revert' });
    expect(closeDecision({ search: 'plex:9', value: 'plex:1' }, 'outside')).toEqual({ action: 'commit', value: 'plex:9' });
    expect(closeDecision({ search: 'beet', value: 'plex:1' }, 'outside')).toEqual({ action: 'revert' });
    expect(closeDecision({ search: 'plex:1', value: 'plex:1' }, 'outside')).toEqual({ action: 'none' });
    expect(closeDecision({ search: null, value: 'plex:1' }, 'outside')).toEqual({ action: 'none' });
  });

  it('VALUE_CHANGED (prop) returns to DISPLAY and clears editing state', () => {
    let s = type_(open(initialState('plex:1')), 'beet');
    s = reducer(s, { type: 'VALUE_CHANGED', value: 'plex:2' });
    expect(s.mode).toBe(Modes.DISPLAY);
    expect(s.search).toBeNull();
    expect(s.value).toBe('plex:2');
  });

  it('arrow wrap-around with userNavigated', () => {
    let s = type_(open(initialState('')), 'be');
    s = reducer(s, { type: 'RESULTS', items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
    s = reducer(s, { type: 'ARROW', dir: 1, itemCount: 3 });   // -1 → 0
    s = reducer(s, { type: 'ARROW', dir: -1, itemCount: 3 });  // 0 → 2 (wrap)
    expect(s.highlight.idx).toBe(2);
    expect(s.highlight.userNavigated).toBe(true);
  });

  it('PAGINATED after appends items and extends the window without touching highlight', () => {
    let s = open(initialState('plex:1'));
    s = reducer(s, { type: 'BROWSE_LOADED', items: [{ id: 'a' }], breadcrumbs: [], pagination: { offset: 0, window: 1, total: 3, hasAfter: true, hasBefore: false } });
    s = reducer(s, { type: 'HIGHLIGHT', idx: 0, userNavigated: true });
    s = reducer(s, { type: 'PAGINATED', direction: 'after', items: [{ id: 'b' }, { id: 'c' }] });
    expect(s.browse.items.map(i => i.id)).toEqual(['a', 'b', 'c']);
    expect(s.browse.pagination.hasAfter).toBe(false);
    expect(s.highlight.idx).toBe(0);
  });
});
```

**Step 2:** `npx vitest run frontend/src/modules/Admin/ContentLists/combobox/comboboxMachine.test.js` — FAIL (module missing).

**Step 3: Implement the machine:**

```js
// comboboxMachine.js — pure state machine for the unified content combobox.
// Every historical combobox bug (stale results on reopen, pagination bleeding
// across browse levels, blur-vs-close commit races, auto-highlight Enter
// selection) is an illegal transition here. Keep this file free of React,
// fetch, and timers — the hook owns side effects.
import { isContentIdLike } from '../contentSearchLogic.js';

export const Modes = { DISPLAY: 'display', SEARCH: 'search', BROWSE: 'browse' };

const emptyBrowse = () => ({ items: [], breadcrumbs: [], pagination: null, loading: false });

export const initialState = (value = '') => ({
  mode: Modes.DISPLAY,
  value,
  search: null,                       // null = not editing
  results: [],
  browse: emptyBrowse(),
  highlight: { idx: -1, userNavigated: false },
});

// Commit policy on dropdown close. reason: 'escape'|'outside'|'select'|'tab'
export function closeDecision({ search, value }, reason) {
  if (reason === 'escape' || reason === 'select') return { action: reason === 'select' ? 'none' : 'revert' };
  if (search === null || search === value) return { action: 'none' };
  if (search && isContentIdLike(search)) return { action: 'commit', value: search };
  return { action: 'revert' };
}

export function reducer(state, event) {
  switch (event.type) {
    case 'OPEN':
      return { ...state, mode: Modes.SEARCH, search: state.value || '', highlight: { idx: -1, userNavigated: false } };
    case 'INPUT':
      return { ...state, mode: Modes.SEARCH, search: event.text, browse: emptyBrowse(), highlight: { idx: -1, userNavigated: false } };
    case 'RESULTS':
      return { ...state, results: event.items };
    case 'BROWSE_LOADED':
      return { ...state, mode: Modes.BROWSE,
        browse: { items: event.items, breadcrumbs: event.breadcrumbs, pagination: event.pagination ?? null, loading: false },
        highlight: { idx: event.referenceIndex ?? -1, userNavigated: false } };
    case 'DRILL_LOADED':
      return { ...state, mode: Modes.BROWSE,
        browse: { items: event.items, breadcrumbs: [...state.browse.breadcrumbs, event.crumb], pagination: event.pagination ?? null, loading: false },
        highlight: { idx: 0, userNavigated: false } };
    case 'WENT_UP':
      return { ...state, mode: Modes.BROWSE,
        browse: { items: event.items, breadcrumbs: event.breadcrumbs, pagination: event.pagination ?? null, loading: false },
        highlight: { idx: event.referenceIndex ?? 0, userNavigated: false } };
    case 'PAGINATED': {
      const items = event.direction === 'after'
        ? [...state.browse.items, ...event.items]
        : [...event.items, ...state.browse.items];
      const p = state.browse.pagination || {};
      const offset = event.direction === 'before' ? Math.max(0, (p.offset ?? 0) - event.items.length) : (p.offset ?? 0);
      const window_ = (p.window ?? state.browse.items.length) + event.items.length;
      const pagination = { ...p, offset, window: window_, hasBefore: offset > 0, hasAfter: offset + window_ < (p.total ?? Infinity) };
      const idx = event.direction === 'before' && state.highlight.idx >= 0 ? state.highlight.idx + event.items.length : state.highlight.idx;
      return { ...state, browse: { ...state.browse, items, pagination }, highlight: { ...state.highlight, idx } };
    }
    case 'ARROW': {
      const n = event.itemCount;
      if (n === 0) return state;
      const idx = event.dir > 0
        ? (state.highlight.idx + 1) % n
        : state.highlight.idx <= 0 ? n - 1 : state.highlight.idx - 1;
      return { ...state, highlight: { idx, userNavigated: true } };
    }
    case 'HIGHLIGHT':
      return { ...state, highlight: { idx: event.idx, userNavigated: !!event.userNavigated } };
    case 'VALUE_CHANGED':
      return { ...initialState(event.value), results: state.results };
    case 'CLOSE':
      return { ...initialState(state.value) };
    default:
      return state;
  }
}
```

Note: `PAGINATED.hasAfter` uses `total ?? Infinity` — if the fixture pagination lacks `total`, adjust the test or the reducer consciously; the test above passes `total: 3`.

**Step 4:** Re-run vitest — PASS. Iterate until every test above is green.

**Step 5: Commit** — `git commit -m "feat(admin): pure combobox state machine with tests pinning every historical bug class"`

## Task 9: The hook — `useContentCombobox.js` (side effects)

**Files:**
- Create: `frontend/src/modules/Admin/ContentLists/combobox/useContentCombobox.js`
- Test: `frontend/src/modules/Admin/ContentLists/combobox/useContentCombobox.test.jsx` (renderHook + mocked fetch, house style per `LabeledContentPicker.test.jsx`)

Responsibilities (each is a small function around `dispatch`):
- `useReducer(reducer, value, initialState)` + a `useEffect` dispatching `VALUE_CHANGED` when the `value` prop changes.
- Search: 300ms `useDebouncedCallback` → `useStreamingSearch(endpoint, searchParams)` (SSE) with the batch fallback copied from the standalone `:137-158` — **fix the stale-closure bug: include `searchParams` in the `useCallback` deps** (audit S5). Merge app-registry matches (dynamic import of `appRegistry.js`, port from `ListsItemRow.jsx:860-871`) when `appResults` prop is true. Dispatch `RESULTS`.
- Browse: `loadSiblings(value)` (port standalone `:238-296`, but consult `siblingsCache.js` first — port the cache-hit/pending/miss flow from `ListsItemRow.jsx:1402-1464`), `drill(item)`, `goUp()`, `paginate(direction)` — each fetches then dispatches `BROWSE_LOADED` / `DRILL_LOADED` / `WENT_UP` / `PAGINATED`. Pagination requests derive offset/limit from `state.browse.pagination` (port math from standalone `:299-371`).
- Commit: `handleClose(reason)` → `closeDecision(state, reason)` → `onChange` or nothing → `dispatch CLOSE`.
- Title resolution: port the standalone's `resolvedTitle` effect + module `titleCache` (`:72`, `:103-121`) — cap the cache at 500 entries (simple `if (titleCache.size > 500) titleCache.clear()`).

**Test cases (write first, mock `fetch` and `EventSource`):** value-prop change resets to DISPLAY; close with exploratory text calls `onChange` zero times; close with id-like text calls `onChange` once; drill then paginate issues a `/list`-window request, never `/siblings/` of the old value; `searchParams` reaches the batch-fallback URL after a prop change.

Run, implement, re-run, then commit: `git commit -m "feat(admin): useContentCombobox hook — SSE search, cached siblings browse, close-commit policy"`

## Task 10: The component — `ContentCombobox.jsx`

**Files:**
- Create: `frontend/src/modules/Admin/ContentLists/combobox/ContentCombobox.jsx`
- Create: `frontend/src/modules/Admin/ContentLists/combobox/ContentCombobox.scss` (start from `ContentSearchCombobox.scss`)

Assemble from the two twins — this is a port, not new design:
- **Target/input:** from the standalone (`:633-700`): committed-value display when closed, clear ×, resolved-title line (suppressed when `renderValue` slot is provided), pending-source and source-error strips, freeform "Use ‘…’ as raw value" row (require `search.length >= 2`), loading/empty states. Keyboard `onKeyDown` replaced by the machine: ArrowUp/Down → `ARROW`, ArrowRight → drill if `isContainerItem(items[highlight.idx])` (else let the cursor move), ArrowLeft → `goUp()` only when `selectionStart === 0` or mode is BROWSE, Enter → select `items[highlight.idx]` only when `highlight.userNavigated`, else freeform commit; Escape → `handleClose('escape')`.
- **Open behavior:** from the inline twin — seed with committed value and **select after the colon** (`ListsItemRow.jsx:1387-1400`), not select-all.
- **Rows:** standalone's `renderOption` (`:513-587`) plus the twin's `isCurrent` bolding (compare against normalized `value`) and dual container affordance (row selects when `selectContainers`, trailing chevron ActionIcon browses).
- **Scroll:** one writer. Keep `shouldRunScrollToHighlighted` from `comboboxScroll.js` (already unit-tested); port the twin's eased scroll + wrap-flash (`ListsItemRow.jsx:1635-1725`); keep Task 7's cooldown-on-initial-scroll and `overflow-anchor: none`.

Verify by mounting in the TestHarness (next task) — no unit test for the JSX layer; the Playwright suites are its tests.

Commit: `git commit -m "feat(admin): unified ContentCombobox component (machine + hook + merged twin behaviors)"`

## Task 11: Point the TestHarness at the unified component; make all 17 suites green

**Files:**
- Modify: `frontend/src/modules/Admin/TestHarness/ComboboxTestPage.jsx:16` → import `../ContentLists/combobox/ContentCombobox.jsx`

**Step 1:** Swap the import. **Step 2:** `npx playwright test tests/live/flow/admin/content-search-combobox/ --reporter=line`. **Step 3:** Fix regressions until green — the suites are the contract; when a suite conflicts with a locked design decision above (e.g. select-after-colon vs select-all), update the suite deliberately and say so in the commit message. **Step 4:** Commit — `git commit -m "test(admin): harness mounts unified ContentCombobox; all suites green"`

## Task 12: Adopt in ListsItemEditor, FitnessConfig; delete LabeledContentPicker's duplication

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemEditor.jsx:18` (import swap — props are compatible)
- Modify: `frontend/src/modules/Admin/Apps/FitnessConfig.jsx:30` (import swap; verify `selectContainers` + `searchParams="capability=listable"` still work by manually adding a playlist)
- Modify: `frontend/src/modules/Admin/PlaybackHub/components/LabeledContentPicker.jsx` — the component becomes a passthrough: delete `useContentTitle`/`titleCache`/`localTitle` (the combobox renders the resolved title itself; this removes the double title line, audit C6). Keep the file as a one-line re-export for its call sites, or inline-replace its usages — choose the smaller diff.
- Modify: `frontend/src/modules/Admin/PlaybackHub/components/LabeledContentPicker.test.jsx` — update to assert a single title render.

Run `npx vitest run frontend/src/modules/Admin/PlaybackHub/` + manual smoke of PlaybackHub content pickers. Commit.

## Task 13: Adopt in ListsItemRow rows + EmptyItemRow; delete the inline twin

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx`

**Steps:**
1. Row cell (`:2861`): `<ContentCombobox value={item.input} onChange={handleInputChange} appResults renderValue={({ onClick }) => ...existing ContentDisplay/Unresolved/Resolving cards...} />`. The cards and `fetchContentMetadata`/`contentInfoMap` integration stay in ListsItemRow — passed in via `renderValue` and a `resolveContentInfo` prop, keeping the combobox context-free (audit I7).
2. Port the app-param picker (`pendingApp`/`paramOptions`, `:794-796` and its render block) — it triggers from `onChange(id, item)` when `item?.isApp && item.hasParam`; it is ListsItemRow furniture, not combobox furniture.
3. Keep Phase 0's auto-resolve (it lives in the row's commit handling now: when `onChange` receives non-id-like freeform text, run the auto-resolve+toast flow — extract it to a small `useAutoResolve` hook in `combobox/` so EmptyItemRow shares it).
4. EmptyItemRow (`:2993`): swap component; keep `shouldAutoAdd` gate.
5. **Delete the inline twin** — the `ContentSearchCombobox` function (`:732` through its render end ~`:2100`) and now-unused locals. Expect roughly −1,300 lines.

Run suites 03/12/18 + `npx vitest run frontend/src/modules/Admin/` + lint. Manual smoke: edit a row input, add via empty row, drill, DnD still works. Commit — `git commit -m "refactor(admin): list rows consume unified ContentCombobox; inline twin deleted"`

## Task 14: Split what remains of ListsItemRow.jsx

**Files:**
- Create: `ContentLists/ShimmerAvatar.jsx`, `ContentLists/ContentDisplays.jsx` (ContentDisplay/UnresolvedContentDisplay/ResolvingDisplay + `fetchContentMetadata`), `ContentLists/ItemDetailsDrawer.jsx`, `ContentLists/EmptyItemRow.jsx`
- Modify: `ListsItemRow.jsx` (imports; keeps the row + InsertRowButton), `ContentLists/index.js`, any importer of `ShimmerAvatar`/`EmptyItemRow` (grep first)

Mechanical moves, no behavior change. After each move: lint + `npx vitest run frontend/src/modules/Admin/ContentLists/`. One commit per file move.

## Task 15: Phase 1 gate

Run, in order, and fix anything red:
1. `npx playwright test tests/live/flow/admin/content-search-combobox/ --reporter=line` (all 18 suites)
2. `npx vitest run frontend/src/modules/Admin/` and `node scripts/gate-vitest.mjs`
3. `cd frontend && npm run lint`
4. Manual journey (dev server): lists row edit → drill → select; modal editor; FitnessConfig add playlist; PlaybackHub picker; clear button; Escape revert; junk-entry attempt.

Then delete dead code: grep for remaining references to the old `ContentSearchCombobox.jsx`; when zero remain, `git rm frontend/src/modules/Admin/ContentLists/ContentSearchCombobox.jsx ContentSearchCombobox.scss` (history preserves them). Commit — `git commit -m "chore(admin): remove superseded standalone combobox; unified component is sole implementation"`. Update the audit doc's R1/R2 rows with resolution + commits, and the memory of record if present.

---

# Phase 2 — Admin-wide consistency (independent of Phase 1; can interleave)

## Task 16: `useUnsavedGuard` (audit C1)

**Files:**
- Create: `frontend/src/modules/Admin/shared/useUnsavedGuard.js`, `frontend/src/modules/Admin/shared/UnsavedGuardContext.jsx`
- Test: `frontend/src/modules/Admin/shared/useUnsavedGuard.test.jsx`
- Modify: `AdminLayout.jsx` (provider), `AdminNav.jsx` (link interception), `shared/ConfigFormWrapper.jsx` (consume), `shared/index.js`

**Design (BrowserRouter — no `useBlocker`):** a context holding a `dirtyRef` registry. `useUnsavedGuard(dirty)` registers/unregisters the flag and adds a `beforeunload` listener while dirty. `AdminNav` link `onClick`: if any registered guard is dirty, `event.preventDefault()` and show `ConfirmModal` ("Discard unsaved changes?" / confirm → `navigate(to)`).

**TDD:** test the hook + context with testing-library (render provider + a dirty consumer + a probe that calls `guard.check()`); assert `beforeunload` is registered only while dirty (spy on `window.addEventListener`). Then wire `ConfigFormWrapper` (it already tracks `dirty` via `useAdminConfig`) — every wrapper-based page gets the guard for free. Commit.

## Task 17: Migrate hand-rolled save chrome to ConfigFormWrapper (audit C5)

Three sub-tasks, one commit each, smallest first:
1. `Apps/AppConfigEditor.jsx` `YamlFallbackEditor` (`:87-108`)
2. `Config/ConfigFileEditor.jsx` (`:70-91`)
3. `Household/MemberEditor.jsx` (`:175-191`; replace its `JSON.stringify` dirty check with the wrapper's mechanism)

Each: read `ConfigFormWrapper.jsx` first; preserve each page's extra header actions via the wrapper's existing slots (add a `headerExtra` prop if none exists — check before adding). Verify per page in the browser (edit → dirty badge → Save → toast/persist → Revert). These pages inherit Task 16's guard automatically.

## Task 18: Surface ContentLists mutation failures (audit C3)

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsFolder.jsx` (DnD swap failure `:202-203`, add/update/delete call sites), possibly `frontend/src/hooks/admin/useAdminLists.js`

Wrap the optimistic mutations: on failure, `notifyFailure('lists.save', 'Could not save — the list may be out of sync. Reloading.')` and re-fetch the list (revert the optimistic state). Use `runWithFeedback` from `shared/feedback.js` where a spinner-less wrap fits; plain `notifyFailure` elsewhere. Manual verify by killing the backend mid-edit. Commit.

## Task 19: One confirmation model (audit C4)

**Files:**
- Modify: `ListsFolder.jsx:308` — replace `window.confirm` with `shared/ConfirmModal` (pattern: `Household/MembersIndex.jsx:326`).
- Modify: row delete (`ListsItemRow.jsx` delete menu action `:~2897`) — **undo toast**, not a modal (curation flow): delete immediately, then `notifications.show` with an Undo button that re-adds the captured item payload at its old index via the existing `addItem`/`moveItem` APIs. Extract `showUndoToast({ message, onUndo })` into `shared/feedback.js` with a vitest test.

Commit per surface.

## Task 20: Dedupe formatters + save-model policy doc

- Replace local re-implementations with imports from `Admin/utils/formatters.js`: `SchedulerIndex.jsx:13-70` (`cronToHuman` etc.), `ConfigIndex.jsx:10-24` (`formatSize`), `AppConfigEditor.jsx:37-40` (`capitalize`). Diff behavior first — if a local variant differs deliberately, keep the difference as a parameter, not a fork.
- Add a "Admin save models" section to `docs/reference/core/coding-standards.md`: *curation surfaces (lists, art, playback) autosave with toast + undo; configuration surfaces (config forms, members/devices) stage with Save/Revert + unsaved-guard.* Reference the audit.
- Update `docs/docs-last-updated.txt` per CLAUDE.md freshness rule. Commit.

---

# Phase 3 — Backend truthfulness (small, ordered by value)

## Task 21: Label ID-match rows (audit C8/B2)

**Files:**
- Modify: `backend/src/3_applications/content/ContentQueryService.mjs` (`#parseIdFromText` result path, around `:337-373` — verify current line numbers first)
- Modify: `frontend/.../combobox/ContentCombobox.jsx` (row badge)
- Test: add a unit test beside the existing ContentQueryService tests (grep `tests/` for existing coverage first)

Tag items produced by the ID-lookup path with `matchReason: 'id-lookup'`; the row renders a small gray "ID" badge so `1989`-style hijacks are self-explaining. TDD on the service; visual check on the frontend. Commit.

## Task 22: Truncation affordance (audit S6)

Backend: search responses include `total`/`truncated` where the adapter knows it (many won't — only add where cheap; do NOT fake totals). Frontend: when the stream completes and `results.length >= take`, render a final non-option row "Showing first 20 — refine your search" (no fake pagination). This is deliberately modest — full search pagination is out of scope (YAGNI until someone asks). Commit.

## Task 23: Browse-mode pagination for `/list` drill-ins (audit S7) — STRETCH

Only if Phase 1's machine made this cheap: reuse the `PAGINATED` event with a windowed `/api/v1/list/...?offset=&limit=` (backend already supports it for siblings — check `4_api` list route before assuming). If the route lacks windowing, file it in the audit's deferred list instead of building it here.

---

## Final gate (before merge)

1. Full combobox folder + `npm run test:live:flow` admin subset green.
2. `node scripts/gate-vitest.mjs`, `npm run test:unit`, `cd frontend && npm run lint` green.
3. Manual journey pass across: Lists (row edit/add/delete/undo/DnD), item modal, FitnessConfig, PlaybackHub picker, Config editor (dirty guard: try to nav away), MemberEditor, Scheduler.
4. Update `docs/_wip/audits/2026-07-09-admin-ux-user-journey-and-combobox-audit.md` issue tables with per-issue resolution status + commit hashes (follow the house style of the 2026-06-09 audit's resolution table).
5. Merge to main per repo policy (direct merge, no PR; delete branch; record in `docs/_archive/deleted-branches.md` if deleting an unmerged exploration branch). Do not deploy without explicit authorization.

## Explicitly deferred (do not build)

- Media App findings (M1–M14) — separate surface, separate plan (`docs/plans/2026-06-09-media-ux-overhaul.md` lineage).
- Full a11y/keyboard spec beyond what the machine provides (audit S12 aria labels can ride along in Task 10 cheaply: `aria-label={placeholder}` on the input; anything more waits for the a11y design).
- Nav/route manifest (audit C7) — low severity; file as follow-up.
- Search-result virtualization — list sizes don't justify it.
