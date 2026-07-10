# Admin UX Audit — User Journeys & ContentSearchCombobox

**Date:** 2026-07-09
**Scope:** `frontend/src/modules/Admin/` (all sections), with deep focus on `ContentLists/ContentSearchCombobox.jsx` and its inline twin in `ListsItemRow.jsx`
**Prior art:** `2026-02-06-content-search-combobox-behavior-audit.md`, `docs/_wip/bugs/2026-03-01-admin-freeform-commit-must-always-save.md`, `docs/_wip/bugs/2026-03-01-admin-menu-editor-junk-entries.md`, `2026-06-09-media-content-lookup-and-ux-audit.md` (§3)

---

## Executive Summary

The Admin module is functionally rich but built from **three coexisting interaction dialects** (autosave, explicit-save, staged-modal-save) with no unsaved-changes guard anywhere, inconsistent error/confirmation patterns, and — at the center of the "plagued" combobox — **two divergent implementations of the same control** that have each received separate fix waves for five months while the other regressed.

The combobox's chronic state/scroll/input problems all trace back to three root causes:

1. **The twin fork.** `ContentSearchCombobox.jsx` (standalone, 814 lines) and the inline clone inside `ListsItemRow.jsx` (component at `:732`, file is 3,030 lines) implement the same UX with different search transports, different commit policies, different keyboard models, and different prop contracts. Four documented fix waves each landed on exactly one twin:
   - **Feb 6, 2026** audit → 12 fixes → **inline only**
   - **Mar 1, 2026** freeform bug → `userNavigatedRef` → **inline only**
   - **Apr 19, 2026** scroll-stickiness + display-mode fixes → **inline only**
   - **Jun 9, 2026** audit §3.1 → commit-on-close, freeform row, clear button, resolved titles, dual affordance → **standalone only**
   - Unification (Jun-09 P1-9 / §3.2) was explicitly **deferred and never picked up**.
2. **The test suite pins the wrong twin.** All 17 Playwright suites (`tests/live/flow/admin/content-search-combobox/`) drive `/admin/test/combobox`, which mounts the **standalone** (`TestHarness/ComboboxTestPage.jsx:16`). The primary production surface — every list row — runs the **inline twin**, which has zero isolated coverage. Fixes get "verified" against a component the user mostly doesn't touch.
3. **One input, three jobs, ad-hoc state.** Both twins make a single text input serve as (a) live search box, (b) committed-value display/editor, and (c) browse navigator, with mode inferred from a pile of booleans and refs (`search === null`, `initialLoadDone`, `skipCloseCommitRef`, `loadCooldownRef`, `userNavigatedRef`, `paginationInFlightRef`, `isEditing`, blur timeouts). Most recorded bugs are illegal-state bugs: residue from one mode leaking into another.

**Recommended path (detail in §6):** stop-the-bleeding fixes on the inline twin's destructive blur-commit/auto-resolve (days), then execute the deferred unification as an explicit state machine with a single component consumed by all six call sites (the real fix), then a shorter Admin-wide consistency pass (save model, guards, feedback, confirmation).

---

## 1. Admin Surface Map & Journey Intents

### 1.1 Shell

- **Entry:** `Apps/AdminApp.jsx` — `AuthGate` → dark `MantineProvider`, global toasts (bottom-right, 3s autoclose). Index and catch-all redirect to `content/lists/menus`.
- **`AdminLayout.jsx`** — AppShell, 260px nav, burger on mobile. **`AdminHeader.jsx`** — breadcrumbs auto-derived by title-casing path segments (raw slugs like list names show verbatim; no page actions in header).
- **`AdminNav.jsx`** — hardcoded array (CONTENT: Menus/Watchlists/Programs/Games/Art · APPS: Fitness/Finance/Gratitude/Shopping · AGENTS · PLAYBACK HUB · HOUSEHOLD: Members/Devices · SYSTEM: Integrations/Scheduler/Config); active state is `pathname.startsWith` prefix match. Nav is decoupled from the route table (drift risk; Config's placement already differs).

### 1.2 Sections by dominant user intent

| Intent class | Sections | Interaction model |
|---|---|---|
| **Configure** (edit settings, review before commit) | Config (YAML files), Apps (Fitness/Finance/Gratitude/Shopping forms), Agents ConfigTab, Household Members/Devices, List/Section settings modals | Staged edits + explicit Save/Revert (four hand-rolled variants of the same chrome) |
| **Curate** (arrange content, high-frequency small edits) | ContentLists (rows, DnD reorder/swap), Art (crop/tag with undo stack), Games schedule | Autosave per action, optimistic UI |
| **Operate / Monitor** (act on live systems) | PlaybackHub (transport/volume/schedules), Scheduler (run job), Integrations (test connection) | Immediate mutation + toast feedback (`runWithFeedback`) |
| **Diagnose** (dev/debug) | TestHarness combobox page, Agents dashboards | Read-only / instrumented |

The pain: **Configure and Curate intents are interleaved on the same screens.** In ContentLists, inline row edits autosave instantly while the modal editor for the *same item* stages until Save. A user cannot form one mental model of "when is my change real."

### 1.3 The ContentLists journey (primary Admin journey)

```
ListsIndex (cards by group)
  └─ click list → ListsFolder/:type/:name        ← THE editing surface
       ├─ sections (SectionHeader, settings modal — staged save)
       ├─ ListsItemRow × N
       │    ├─ label: inline edit → autosave on blur
       │    ├─ input: INLINE COMBOBOX TWIN → autosave on change
       │    ├─ action menu, preview (AdminPreviewPlayer), move, delete (NO confirm)
       │    └─ config indicator → ListsItemEditor modal (STANDALONE combobox, staged save)
       ├─ EmptyItemRow → inline twin; auto-ADDS the item the moment `input` changes
       └─ DnD: row reorder + cross-item content swap (optimistic; failures logged, not surfaced)
```

Journey verdict: the highest-traffic path (edit an item's content id inline) runs the least-tested component with the most dangerous commit policy (§3), and the add-row auto-add effect turns any stray commit into a **persisted junk item** — the documented, still-"Investigating" `tvapp.yml` junk-entries bug (`star wars`, `star` rows with no uid) is exactly this chain: typed text → blur-commit → `setInput` → auto-add POST.

### 1.4 Combobox user intents (what the control must serve)

| # | Intent | Affordance today (standalone / inline) |
|---|---|---|
| U1 | Find & pick a known item by title | Type ≥2 chars → SSE stream w/ pending badges / batch tier-1 w/ hidden tier-2 row |
| U2 | Enter a known content id directly | Commit-on-close if id-like, freeform row, Enter / blur-commits anything + auto-resolve |
| U3 | Explore the neighborhood of the current value | Siblings-on-open + drill + breadcrumbs (both, differently) |
| U4 | Pick a *container* vs enter it | Dual affordance (chevron) / ignored (`selectContainers` unsupported) |
| U5 | Verify what the committed opaque id is | Resolved-title line under input / `ContentDisplay` card w/ thumbnail |
| U6 | Clear the value | × button / none |
| U7 | Abandon / revert exploration | Escape + exploratory-text revert / Escape (but blur commits) |
| U8 | Add a new item (empty-value contexts) | FitnessConfig add-row (standalone) / EmptyItemRow auto-add (inline) |

No single implementation serves all eight. Each twin serves a different subset well.

---

## 2. Issue Inventory — Root Causes (class R)

| # | Issue | Evidence | Severity |
|---|---|---|---|
| R1 | **Twin fork.** Two implementations, different transports (SSE stream vs batch tier-1/2), commit policies (§3/§4), keyboard models, prop contracts (`onChange(id, item)` + `selectContainers`/`searchParams` vs `onChange(val)` only). Fix waves land on one side; the other regresses. | `ContentSearchCombobox.jsx` vs `ListsItemRow.jsx:732`; git log both files | **Critical (defect generator)** |
| R2 | **Tests pin the untraveled twin.** 17 Playwright suites → `/admin/test/combobox` → standalone. Inline twin (all list rows) has no isolated coverage; Mar-01's regression suite (12-freeform) tests the standalone while that bug's fix went to the inline. | `ComboboxTestPage.jsx:16`; suite README | **Critical (process)** |
| R3 | **One input, three jobs, boolean-soup state.** Mode is inferred from ~8 flags/refs across both twins; every recorded state/scroll bug is residue leaking between modes (stale streamResults on reopen, stale pagination in drill, stale highlight after fetch fail, etc.). | both components | High |
| R4 | **Same field, opposite behavior on one screen.** Row inline edit (twin: blur commits anything) vs item modal (standalone: exploratory text reverts). | `ListsItemRow.jsx:2861` vs `ListsItemEditor.jsx:119` | High |

## 3. Inline twin defects (`ListsItemRow.jsx:732–2100`) — class I

| # | Issue | Evidence | Severity |
|---|---|---|---|
| I1 | **Blur commits ANY exploratory text.** `handleBlur` → `commitFreeformText('blur')` whenever `searchQuery !== value`. Typing "beet" to search and clicking away replaces a working `plex:456724` with `beet`. This is §3.1-6, fixed in the standalone (commit-on-close + id-like gate, `e83bddfd6`), still live on the highest-traffic surface. | `:1467-1478` | **Critical** |
| I2 | **Auto-resolve swaps the value behind the user's back.** After a freeform commit, a background search (15s window) replaces the field with the **top search hit** — no confirmation, wrong-item risk (`onChange(resolved)` at `:1546`). Combined with EmptyItemRow's auto-add-on-input-change (`:2955-2959`), stray text becomes persisted junk rows → the 2026-03-01 `tvapp.yml` junk-entries bug (still "Investigating"; this is the root cause). | `:1524-1560` | **Critical (data corruption)** |
| I3 | **150ms blur-timeout ordering hack** survives (cancelable now, but still a race-by-timer; standalone replaced this class of bug with commit-on-close). | `:1467-1478` | Medium |
| I4 | **No streaming, no per-source status.** Batch tier-1 only; tier-2 hides behind a "Search all sources…" row users must notice; no pending badges, no source-error surfacing — the B4 invisible-failure class reintroduced on this surface (an offline Plex looks like "no results"). | `:854`, `:916`, `:1737-1760` | High |
| I5 | **Ignores `selectContainers`/`searchParams`, no `item` arg on `onChange`** — can't serve U4 or the standalone's consumers; entrenches the fork. | `:732` signature | Medium |
| I6 | **3,030-line file** contains the combobox, display components, a second combobox (drawer browser, `:2105`), EmptyItemRow, app-param pickers, drag/drop zones. Unreviewable; unhostable in the test harness. | file | High (maintainability) |
| I7 | Coupled to `useListsContext` (`contentInfoMap`) — the twin can't render outside ListsFolder even if you wanted to test it. | `:735` | Medium |

What the twin does **better** than the standalone (must survive unification): pac-man wrap + ArrowRight-drill/ArrowLeft-up keyboard model, select-after-colon on open (`:1387-1400`), `isCurrent` bolding, siblings pre-cache (`siblingsCache.js`) + prepopulate-current-item-while-loading, rich committed-value display (`ContentDisplay`/`Unresolved`/`Resolving`), app-registry results with param pickers, tier-2 escalation concept, extracted+unit-tested scroll/display helpers (`comboboxScroll.js`, `contentSearchLogic.js`), wrap-flash animation, VS Code-style top-offset scroll positioning.

## 4. Standalone defects (`ContentSearchCombobox.jsx`) — class S

| # | Issue | Evidence | Severity |
|---|---|---|---|
| S1 | **Pagination state bleeds across browse levels.** `browseContainer`/`goBack` never reset `pagination`; the scroll handler is active whenever breadcrumbs exist, so after drilling into a folder, near-bottom scroll calls `loadMoreSiblings` — which fetches siblings **of the committed value** and appends them to the *drilled folder's* listing (mixed lists; possible duplicate keys). | `:381-407`, `:410-444` vs `:299-371`, `:763-776` | **High (state+scroll)** |
| S2 | **Initial center-scroll can immediately fire a 'before' page-load.** `scrollIntoView({block:'center'})` on open can land y<50 → prepend → rAF `scrollTop` compensation after paint → visible jump. Cooldown exists only *after* loads. This is the classic "scroll jumps on open" report. | `:277-289`, `:764-775`, `:331-343` | High |
| S3 | **No current-item indicator** in rows (inline bolds `isCurrent`); after open you can't see which sibling is selected — only implied by scroll position. | `renderOption` `:513-587` | Medium |
| S4 | **Keyboard model never ported** (Jun-09 P1-9 deferred): no wrap-around, no ArrowRight drill / ArrowLeft up, no select-after-colon; Mantine defaults only. | whole component | Medium |
| S5 | `doBatchSearch` `useCallback` deps `[]` still omit `searchParams` (stale closure; non-SSE fallback only). Flagged in Jun-09 §3.2, unfixed. | `:137-158` | Low |
| S6 | **Search capped at `take=20`** with no "more results" affordance and no pagination in search mode (inline at least offers tier-2). No indication of truncation. | `:147` | Medium |
| S7 | `/list` drill-in unbounded — large folders render all items, no pagination (siblings mode has it; browse mode doesn't). §3.2 leftover. | `:392` | Medium |
| S8 | `options` `useMemo` deps `[results, selectContainers]` cache rendered rows over stale closures (`handleItemClick`, `breadcrumbs`, `value`). Works today because `results` identity changes in the paths that matter; fragile. | `:590-614` | Low |
| S9 | Freeform "Use as raw value" row appears for 1-char text; `CONTENT_ID_LIKE` regex duplicated (`:68`, `:106`); module `titleCache` unbounded. | `:797`, `:68/:106`, `:72` | Low |
| S10 | `debouncedSearch('')` used as pseudo-cancel on close re-arms a 300ms timer instead of canceling it (benign today; trap tomorrow). | `:212` | Low |
| S11 | Browse mode has no skeleton; "loading folder" vs "empty folder" vs "no results" not fully distinguished (spinner only in `rightSection` + one empty state). | `:783-796` | Low |
| S12 | A11y: no `aria-label` on input, result counts/pending sources not announced, resolved-title line not programmatically associated with the input. | `:634-700` | Medium |

What the standalone does **better** (must survive unification): commit-on-close invariant with id-like gate + Escape-revert + explicit freeform row (the correct U2/U7 policy), SSE streaming with pending-source badges and per-source error chips, clear (×) button, resolved-title line with process cache, `selectContainers` dual affordance (row selects, chevron browses), `searchParams` scoping, exit-browse-on-type with full state reset, structured logging throughout, the whole Playwright harness.

## 5. Cross-cutting Admin UX — class C

| # | Issue | Evidence | Severity |
|---|---|---|---|
| C1 | **No unsaved-changes guard anywhere.** No `beforeunload`/blocker in the module; every staged editor (ConfigFormWrapper pages, ConfigFileEditor, MemberEditor, DeviceEditor, Agents ConfigTab, ListsItemEditor modal via outside-click?) discards edits on nav-away with no warning. | grep; agent report §2 | **High** |
| C2 | **Three save models, mixed within one screen** (see §1.2/§1.3). No policy doc says which model a new section should use. | — | High |
| C3 | **Error feedback split three ways:** inline `Alert` (index/editors) vs toast (`shared/feedback.js` — good pattern: sticky red failures, `runWithFeedback` logging) vs **log-only, nothing shown to the user** (ContentLists optimistic mutations, e.g. DnD swap failure `ListsFolder.jsx:202-203`). Sibling editors differ: MemberEditor inline vs DeviceEditor toast. | agent report §2 | High |
| C4 | **Confirmation inconsistency:** styled `ConfirmModal` (Devices/Members) vs `window.confirm` (delete whole list, `ListsFolder.jsx:308`) vs **no confirm** (delete list item, `ListsItemRow.jsx:2897`) vs two-click inline (CrudTable). Deleting an item is *less* guarded than deleting nothing else. | agent report §2 | Medium |
| C5 | **Chrome & util duplication:** ConfigFileEditor / YamlFallbackEditor / MemberEditor re-implement ConfigFormWrapper's save bar; `cronToHuman`/`formatSize`/`formatDuration`/`capitalize` re-implemented locally instead of imported from `utils/formatters.js`; dirty computed three ways (`originalRef` diff vs `JSON.stringify` vs per-subsection flags). | agent report §2 | Medium |
| C6 | **Duplicate title resolution:** `LabeledContentPicker` renders its own resolved title above the combobox, which now renders its *own* resolved-title line beneath the input → two dimmed title lines and two separate module caches (`PlaybackHub/utils/titleCache.js` + combobox `titleCache`). The wrapper predates the Jun-09 §3.1-9 fix and is now redundant. | `LabeledContentPicker.jsx:10-16` + `ContentSearchCombobox.jsx:702-704` | Medium |
| C7 | Nav hardcoded + `startsWith` matching; header breadcrumbs from raw path slugs (list names/`plex` shown verbatim, title-cased). | `AdminNav.jsx:95`, `AdminHeader.jsx:9-52` | Low |
| C8 | Backend leftovers that surface as combobox UX (from Jun-09, still open): B2 all-digits/colon ID hijack unlabeled in results; B5 item-shape inconsistency across adapters drives the frontend's fragile `type` heuristics (`TYPE_ICONS`, `isContainer` string list). | `ContentSearchCombobox.jsx:15-60` | Medium |

---

## 6. Path Forward

### Phase 0 — Stop the bleeding (days; no architecture)

1. **Kill the inline twin's destructive commit path** (I1/I2): adopt the standalone's policy in place — commit on close only when text is id-like (`CONTENT_ID_LIKE`); exploratory text reverts; add the explicit "Use ‘…’ as raw value" row. **Remove or gate auto-resolve**: never replace a committed value after the fact without the user seeing it — if kept, make it a visible suggestion ("Did you mean *Beethoven's 9th*? [Apply]") on the unresolved-display card instead of an `onChange` from a timer.
2. **Gate EmptyItemRow auto-add** on id-like input or explicit selection (junk-entries root cause; closes the 2026-03-01 bug for real).
3. **Standalone S1**: `setPagination(null)` in `browseContainer` and `goBack` (and set it from `/list` responses if pagination is added later).
4. **Standalone S2**: set `loadCooldownRef` around the initial reference-scroll (or suppress load-more until first user scroll intent), and do prepend scroll-compensation in `useLayoutEffect`-before-paint rather than post-paint rAF.
5. Update/extend suite 12 (freeform) so it pins the *policy*, and add one Playwright spec that drives the **list row** (real surface), not just the harness page.

### Phase 1 — The real fix: unify the twins (the deferred §3.2 plan)

One component, one behavior, six call sites. Shape:

- **Explicit state machine** instead of boolean soup. Named modes: `DISPLAY` (committed value + resolved title), `EDIT_SEARCH` (typing; stream results), `BROWSE` (siblings/drill; breadcrumbs + pagination), with legal transitions and a single `commit(value, {reason})` / `revert()` pair. Every prior bug class (stale results on reopen, pagination bleed, highlight-after-fetch-fail, close-vs-blur races) becomes an illegal transition the reducer can't express. Keep `skipCloseCommitRef` semantics inside the machine (`closeReason: 'escape' | 'select' | 'outside'`).
- **Merge the best of both** (explicit checklist):
  - From standalone: commit-on-close policy, SSE + pending/source-error chips, clear button, resolved title, `selectContainers`/`searchParams`, dual container affordance.
  - From inline: keyboard model (wrap, ArrowRight/ArrowLeft with cursor-position guards), select-after-colon, `isCurrent` marking, siblings cache + optimistic current-item prepopulation, committed-value display card (as an optional `renderValue` slot), app-registry results + param picker (as a pluggable result source), scroll helpers (`comboboxScroll.js` — keep the unit-tested decision function).
- **Context decoupling:** accept `resolveContentInfo`/`onItemResolved` props; ListsFolder passes its `contentInfoMap` adapter — the component itself stays context-free (fixes I7, dissolves C6's duplicate caches — delete `LabeledContentPicker`'s title logic).
- **Then delete the twin** from `ListsItemRow.jsx` (≈1,300 lines removed from a 3,030-line file) and split what remains (display components, EmptyItemRow, drawer) into files.
- **Tests:** harness page mounts the unified component; add a second harness route that mounts it in a row-like autosave context; run the 17 suites against both. Suites now pin the only implementation.
- Scroll approach: keep windowed pagination (no virtualization needed at these sizes) but centralize *all* scroll writes in one module — one writer, measured prepend compensation before paint, cooldown owned by the machine, `overflow-anchor: none` on the viewport to stop the browser fighting the manual anchoring.

### Phase 2 — Admin-wide consistency pass (independent of Phase 1)

6. **Unsaved-changes guard** (C1): a `useUnsavedGuard(dirty)` hook (React Router blocker + `beforeunload`) wired into `ConfigFormWrapper` — the hand-rolled editors get it free once they adopt the wrapper (C5).
7. **Publish a save-model policy** (C2) in `docs/reference/core/coding-standards.md`: *curation surfaces autosave with toast + undo; configuration surfaces stage with Save/Revert + guard.* ContentLists already follows the first half — add failure toasts to its optimistic mutations (C3) via the existing `runWithFeedback`.
8. **One confirmation mechanism** (C4): `ConfirmModal` everywhere destructive; give row-delete either an undo-toast (preferred for curation flow) or the modal.
9. Dedupe chrome/utils (C5), collapse `LabeledContentPicker` (C6), derive nav/breadcrumb labels from a route manifest (C7).

### Phase 3 — Backend truthfulness (small, unblocks polish)

10. Label ID-match rows as such (B2) and normalize adapter item shape (B5) so the frontend's `isContainer`/type heuristics stop guessing; add "N more…" affordance past `take=20` (S6) and pagination on `/list` browse (S7).

### Sequencing note

Phase 0 is safe immediately. Phase 1 is the only durable fix for the combobox complaint history — every previous round patched one twin and the complaint returned from the other; do not accept another single-twin patch round. Phases 2–3 are parallelizable with Phase 1.

---

## Appendix — Fix-wave history (why it stayed broken)

| Date | Trigger | Where fixes landed | Where they didn't |
|---|---|---|---|
| 2026-02-06 | Behavior audit (12 issues) | Inline twin | Standalone (3 consumers) |
| 2026-02-25 | Tiered search | Inline twin | Standalone |
| 2026-03-01 | Freeform-commit bug + junk entries | Inline (`userNavigatedRef`) | Standalone; junk-entries root cause (blur-commit + auto-add) never fixed |
| 2026-04-19 | Scroll stickiness / display mode | Inline twin (+ extracted helpers) | Standalone |
| 2026-06-09 | Media/content UX mega-audit §3 | Standalone (commit-on-close, freeform row, clear, titles, dual affordance) | Inline twin; unification deferred |
| 2026-07-09 | This audit | — | — |

Test coverage has pointed at the standalone throughout (harness page, 17 suites), while the Feb–Apr fix waves landed on the inline twin: **the tested component and the fixed component were never the same component.**
