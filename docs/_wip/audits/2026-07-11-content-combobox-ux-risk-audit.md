# ContentCombobox UX Risk Audit — Positioning, Progressive Loading, Hierarchy, ID Resolution & Search

**Date:** 2026-07-11
**Scope:** `frontend/src/modules/Admin/ContentLists/combobox/` — the unified `ContentCombobox` and its state machine / hook / scroll helper. Consumers: `ListsItemRow`, `EmptyItemRow`, `ListsItemEditor`, `FitnessConfig`, `PlaybackHub/LabeledContentPicker`, `TestHarness/ComboboxTestPage`.
**Prior art:** `2026-07-09-admin-ux-user-journey-and-combobox-audit.md` (twin-fork history + unification decision), `2026-02-06-content-search-combobox-behavior-audit.md`, `2026-06-09-media-content-lookup-and-ux-audit.md` §3.
**Focus:** the five UX risk classes named in the request — (1) selected item initializing out of view, (2) progressive-loading scroll behavior, (3) hierarchical drill/up, (4) content-string resolution & generation in contextual sequence, (5) keyword search vs. item results & string generation.

**Method note:** Client behavior below is read directly from source (cited by `file:line`). Backend claims are verified against `ContentQueryService.mjs` / `siblings.mjs` / `content.mjs` and labeled **[verified]**; anything I did not exercise at runtime is labeled **[inferred]**.

---

## Executive Summary

The unification (single component + `comboboxMachine.js` + `useContentCombobox.js`) is a real structural win: highlight, pagination-window math, and commit policy are now illegal-state-proof in one reducer, and the twin-fork drift that caused five months of one-sided fixes is gone. The machinery around **keyboard highlight, dedupe, and commit-on-close is sound.**

The residual risk has moved from *state corruption* to **spatial/orientation UX** — where the highlighted row is, whether the committed value is even visible, and whether progressive loading preserves the user's place. The screenshot that prompted this audit is a textbook instance: the input holds `singalong:hymn/1008`, the dropdown is browsing the **Hymns** container, and 1008 is **nowhere in the visible window and carries no "current" marker.** The user is looking at their own selection's neighborhood with no anchor to their selection.

| # | Risk class | Worst finding | Severity |
|---|---|---|---|
| 1 | Selected item initializes out of view | Committed value absent from the loaded siblings window → highlight silently falls to sibling #0, no "current" marker, no "your item is elsewhere" cue (F1) | **High** |
| 2 | Progressive-loading scroll | `before`-pagination scroll-restore runs in a **single** rAF against a possibly-uncommitted DOM → upward rug-pull; no result virtualization on the uncapped SSE path (F4, F6) | **Med-High** |
| 3 | Drill / up hierarchy | Containers are **never selectable** in any production surface (`selectContainers` unset) → you cannot pick a playlist/album/show by clicking it; only by typing its raw id (F7). Back-at-root re-runs a *search* for the raw id string (F8) | **Med** |
| 4 | Content-string resolution & generation | Freeform Enter commits **unresolved search text as the value**, then background auto-resolve may swap it out seconds later with only a toast — value churn the user didn't initiate (F9). Client `[\w-]+` vs server `\w+` prefix mismatch (F11) | **Med** |
| 5 | Keyword search interplay | Select-after-colon keeps the `source:` prefix, so keyword typing silently **scopes the search to that source** — correct backend behavior [verified] but undiscoverable; clearing to `source:` searches the literal string (F12, F13) | **Med** |

None of these is a state-machine defect; they are presentation/affordance gaps sitting on top of correct state. That makes them cheap to fix relative to the twin-fork era.

---

## 1. Selected item initializes out of view (Category 1)

### F1 — Committed value absent from the loaded window → silent fallback to sibling #0 · **High**

`applyBrowseData` (`useContentCombobox.js:266-287`) computes the highlight index for the opened browse level:

```js
const foundIndex = (data.referenceIndex >= 0) ? data.referenceIndex
                 : items.findIndex((i) => i.id === normalizedVal);
// "When the committed value isn't in the loaded window, highlight the first
//  sibling (ListsItemRow parity) rather than nothing."
const referenceIndex = foundIndex >= 0 ? foundIndex : (items.length > 0 ? 0 : -1);
```

When the backend's `referenceIndex` is `-1` **and** the value's id isn't in the first window, the highlight lands on **index 0 — an unrelated sibling.** The initial-positioning effect (`ContentCombobox.jsx:299-315`) then scrolls *that* row ~1.5 rows from the top. Net effect: the dropdown opens parked at the **top of the container**, the user's actual selection is off-screen, and because no item's id matches `value`, the `.current` class (`ContentCombobox.jsx:404,416`) never applies — there is **no visual "this is your current pick" anywhere.**

This is exactly the audited screenshot: `singalong:hymn/1008` in the box, the Hymns list scrolled to Star-Spangled Banner / God Save the King, 1008 invisible, nothing marked current.

**Why it happens:** the siblings API returns a bounded window. If it doesn't center on the reference item (or reports `referenceIndex: -1` because the item fell outside the returned page), the client has no recovery — it can't scroll to a row it didn't receive.

**Repro:** open the inline combobox on any list row whose value is a deep-in-container item (`singalong:hymn/1008`, a late episode, a track far down an album). Observe: dropdown opens at container top; no highlighted/current row corresponds to the committed value.

**Recommendations (pick per effort budget):**
- **Cheap:** when `foundIndex < 0`, render a persistent header chip in the dropdown — "Current: {resolvedTitle or value} — not in this page" — so orientation survives even when the row isn't loaded. Reuse the breadcrumb `Box` slot (`ContentCombobox.jsx:541`).
- **Correct:** make the siblings request that opens a browse level *anchor* on the value — request the page containing the reference id (offset derived from the item's index server-side) rather than page 0. Confirm whether `/siblings` already supports an anchor mode; `SiblingsService.resolveSiblings` takes `{offset, limit}` only today (`siblings.mjs:40-46`), so `referenceIndex` is only meaningful when the default page happens to contain the item.
- Either way, **never highlight sibling #0 as if it were the selection.** Use `idx: -1` + the header chip instead, so an accidental Enter can't select the wrong neighbor (note: `Enter` is already guarded by `userNavigated`, `ContentCombobox.jsx:233`, so this is orientation-only, not a mis-commit — but the phantom highlight still misleads).

### F2 — Two scroll writers coordinate correctly, but only for the value that *is* present · Info

The level-key effect (`ContentCombobox.jsx:299-315`) and the highlight effect (`:319-392`) are deliberately sequenced (reset `prevIdxRef=-1` so the second effect hits its `initial-render` guard, `:304-306`). This is correct and the comment is accurate — no double-scroll race. The limitation is upstream: both writers can only position a row that exists in `items`. F1 is the gap, not the scroll coordination.

---

## 2. Progressive-loading scroll behavior (Category 2)

### F3 — Highlight index is correctly re-based on prepend · Info (positive)

`PAGINATED` before-direction adjusts the highlight so it tracks the same item after prepending (`comboboxMachine.js:78`): `idx = ... state.highlight.idx + event.items.length`. Good — no detached-index bug on load-before. The window math (`offset`, `hasBefore/hasAfter`) is also self-consistent (`:70-79`).

### F4 — `before`-pagination scroll-restore uses a single rAF against a possibly-uncommitted DOM → upward rug-pull · **Med-High**

`runPaginate('before')` (`ContentCombobox.jsx:258-284`) restores scroll position after prepend:

```js
const prevScrollHeight = viewport.scrollHeight;         // measured BEFORE await
const dispatched = await paginate(direction);           // React state updated here
if (dispatched && direction === 'before') {
  requestAnimationFrame(() => {                          // SINGLE rAF
    viewport.scrollTop += viewport.scrollHeight - prevScrollHeight;
  });
}
```

The scroll compensation reads `viewport.scrollHeight` inside **one** `requestAnimationFrame`. A single rAF is not guaranteed to run *after* React has committed the prepended rows and the browser has laid them out — React's commit is async relative to the awaited fetch resolution. If the rAF fires before layout reflects the new rows, `scrollHeight` is stale and the delta is wrong → the viewport jumps (classic upward rug-pull).

Contrast the `after`-path cooldown right below it (`:280-282`), which deliberately uses a **double** rAF to wait out layout. The restore path should use the same double-rAF (or a `ResizeObserver`/layout-effect) discipline. `overflowAnchor: 'none'` is set on the viewport (`:593`), which **disables the browser's native scroll-anchoring** — so this manual restore is the *only* thing preventing the jump. If it mis-fires, there is no fallback.

**Repro:** open a browse level with `hasBefore: true` (deep-in-container value), scroll to the top edge to trigger `before` load, watch for a scroll jump on slower renders / large avatars.

**Fix:** move the compensation into a double rAF (mirror the cooldown), or better, capture `scrollHeight` and set `scrollTop` in a `useLayoutEffect` keyed on the prepend, which runs after commit but before paint.

### F5 — Cooldown vs. restore ordering is fragile but currently safe · Low

The restore rAF is scheduled inside `try` (before `finally`), and the cooldown double-rAF is scheduled in `finally` (`:280`). Restore fires first; `loadCooldownRef` is true throughout, so the scroll event the restore triggers is ignored by `handleScrollPosition` (`:287`). This works today but couples two independent timers by scheduling order — folding both into one layout-effect (F4 fix) removes the coupling.

### F6 — No result virtualization; the SSE path is uncapped · **Med**

`truncatedAt` only exists for the **batch** fallback (`useContentCombobox.js:538`): `(!supportsSSE() && batchResults.length >= 20)`. The SSE stream path — the default in every real browser (`supportsSSE()` true) — is **explicitly uncapped** (comment `:20-22`, `:535-538`) and every result is rendered via `items.map(renderOption)` (`ContentCombobox.jsx:617`) with no windowing. Each option mounts a Mantine `Avatar` (with a network thumbnail), two `Text` rows, and 1-2 `Badge`s (`:418-475`).

A broad keyword (`"the"`, `"a "`) against a large Plex/Immich library can stream **hundreds** of options into the DOM at once. Consequences: (a) mount/layout jank; (b) `ArrowDown` pac-man-wraps over the entire list (`comboboxMachine.js:84`), so "next" from the bottom silently teleports to the top of a 300-row list; (c) the scroll-to-highlight animation (`:376-385`) runs against a very tall viewport.

**Fix:** cap the *rendered* set even when the transport is uncapped (e.g. render first N with a "showing first N — refine" affordance that already exists for batch at `:629-633`, just gate it on rendered-count rather than `!supportsSSE()`), and/or virtualize the option list. Virtualization interacts with the index-owned-highlight invariant (DOM order must equal `items` order — see the machine's dedupe rationale, `comboboxMachine.js:12-16`), so a windowing lib that preserves index mapping is required.

---

## 3. Drill down / up for hierarchical content (Category 3)

### F7 — Containers are never selectable in any production surface · **Med**

`selectContainers` defaults to `false` (`ContentCombobox.jsx:104`) and is passed truthy **only** in `TestHarness/ComboboxTestPage.jsx` and `FitnessConfig.jsx:278`. In `ListsItemRow`, `EmptyItemRow`, `ListsItemEditor`, and `PlaybackHub` it is unset. With `selectContainers=false`:

- Mouse click on a container row → `handleOptionSubmit` → `drill(item)` (`:200`) — you enter it, you cannot pick it.
- `Enter` on a highlighted container → `drill` (`:236`).
- `ArrowRight` on a container → `drill` (`:213-216`).

So in the primary editing surface **there is no gesture that commits a container id from the results list.** A menu that wants to reference a playlist, album, show, or conference as its value can only get there by **typing the raw id** (`plex:12345`) and letting freeform commit fire — which then works, because freeform Enter bypasses the container check (`:238`). The result is an inconsistent mental model: "clicking the show browses into it, but pasting its id selects it."

`isContainer` (`:66-71`) treats `playlist`, `channel`, `album`, `artist`, `show`, `series`, `conference` as containers — several of which are legitimately *playable values* (a playlist is a queue; a show can be a shuffle target). Menus in this codebase routinely reference exactly these.

**Fix options:**
- Pass `selectContainers` where container-as-value is valid (menus/watchlists), and rely on the existing dual affordance (chevron `ActionIcon` browses, row selects — already implemented at `:462-472`).
- Or add an explicit "Use this {type}" action on container rows so both intents are reachable without a prop flag per call site.

### F8 — Back / ArrowLeft at the siblings root re-runs a search for the raw content id · **Med (confusing)**

`goUp` at `breadcrumbs.length <= 1` exits browse by dispatching `INPUT` with the current search text (`useContentCombobox.js:377-382`). After `openWithSiblings`, `OPEN` set `search = state.value` (`comboboxMachine.js:48`) — i.e. the full content id (`singalong:hymn/1008`). So pressing **Back from the top of the sibling list issues a keyword search for the literal id string.**

Backend **[verified]** parses `prefix:term` and scopes to the source (`ContentQueryService.mjs:56-64,88-109`), so `singalong:hymn/1008` becomes an in-`singalong` search for `hymn/1008` — likely an id-lookup hit rather than garbage, so it's not *broken*. But the interaction reads as "I went up a level and my browse turned into a text search of my own id," which is disorienting and asymmetric with drilling (drill → browse; up-at-root → search).

**Fix:** at the siblings root, Back should **close the dropdown back to DISPLAY** (or to an empty search box), not re-search the committed id. Reserve the search transition for an explicit clear.

### F9 — Drill/up highlight & pagination ownership is correct · Info (positive)

`DRILL_LOADED` appends the crumb and resets `highlight.idx = 0` (`comboboxMachine.js:62-65`); `WENT_UP` restores `referenceIndex = indexOf(popped)` (`useContentCombobox.js:398,406`). The S1 pagination-owner guard (`:426-429`, `paginationOwnerRef`) structurally prevents a drilled level from paginating against the value's `/siblings` — a real prior bug, now closed. The monotonic `browseTokenRef` (`:145-155`, bumped on every drill/up/paginate/input) correctly invalidates late responses. This layer is solid.

---

## 4. Content-string resolution & generation in contextual sequence (Category 4)

### F10 — ID parsing is consistent and slash-tolerant · Info (positive)

`splitContentId` splits on the **first** colon and trims legacy `source: id` spacing (`useContentCombobox.js:38-46`); `normalizeValue` collapses `: ` → `:` for current-item comparison (`:48`, `ContentCombobox.jsx:79`). Slash-bearing local ids (`singalong:hymn/1008`) survive because the siblings/list/info routes use `splatPath` wildcards **[verified]** (`siblings.mjs:15`, `content.mjs:86,119,136`) and the client sends the local id via `encodeURIComponent` as one segment. The audited screenshot confirms browse resolution works end-to-end for a slash id. **No slash-encoding bug.**

### F11 — Freeform Enter commits unresolved text, then auto-resolve swaps it under the user · **Med**

Sequence in a list row:
1. User types `star wars` (no arrow-nav), presses Enter. `handleKeyDown` Enter → `search.length >= 2 && search !== value` → `commitFreeform()` (`ContentCombobox.jsx:238-241`) → `onChange('star wars')`.
2. `handleRowInputChange` sees non-id-like text → `maybeResolve('star wars', 'row-commit')` **and** `commitInput('star wars')` (`ListsItemRow.jsx:293-297`). The raw string is **persisted as the value now.**
3. 0-15 s later, `useAutoResolve` (`useAutoResolve.js:78-108`) searches `take=1&tier=1`, and if the committed value is *still* `star wars`, calls `onChange(resolvedId)` + a success toast, **replacing the value the user is looking at.**

The staleness guard (`:89`) correctly avoids clobbering a *newer manual* edit, and the toast is honest. But the UX is: **the value you committed silently changes to a different string seconds later.** For an opaque id swap (`star wars` → `plex:634921`) with only a transient toast, the user can't tell what happened or undo it. This is the same shape as the historical `tvapp.yml` junk-entry chain the prior audits chased (`2026-07-09` §1.3) — now bounded by the id-like gate and the staleness guard, but the *surprise value mutation* remains.

**Fix:** make resolution **confirmable, not automatic**, or make it visibly *pending* — render the row in a "resolving `star wars`…" state (the infra exists: `setContentInfo` seeding at `ListsItemRow.jsx:290`) and only commit the resolved id on user acceptance, or at minimum keep the freeform string as a subtitle so the swap is legible. At the very least, the auto-resolve toast should offer "keep original."

### F12 — Client `[\w-]+` vs server `\w+` prefix regex mismatch · Low

`isContentIdLike` accepts hyphenated sources: `/^[\w-]+:\s?\S+/` (`contentSearchLogic.js:6`). The backend query parser accepts only `\w+`: `/^(\w+):(.+)$/` (`ContentQueryService.mjs:61`). A hyphenated source prefix (e.g. `some-source:foo`) is treated by the **client** as an intentional id (commit-on-close, no auto-resolve) but by the **server** as a prefixless full-text query (`prefix: null, term: 'some-source:foo'`). No such source exists today, but the two SSOTs disagree; align them (import one regex, or widen the server to `[\w-]+`) before a hyphenated source is added.

### F13 — Empty term after a retained prefix searches the literal `source:` string · Low

If the user clears the local id but leaves the prefix (`singalong:`), the search text is `singalong:` → server regex `(.+)` requires ≥1 char after the colon → **no match** → `{prefix: null, term: 'singalong:'}` **[verified]** — a full-text search for the literal `"singalong:"` across all sources, not an in-singalong listing. Low frequency, but the select-after-colon affordance (F14) makes "prefix retained, term emptied" a reachable state. Trim a trailing-colon query to an empty search (show "Type to search…") rather than querying the literal.

---

## 5. Keyword searching vs. item results & string generation (Category 5)

### F14 — Select-after-colon silently scopes keyword search to the source — correct but undiscoverable · **Med**

On edit start, `startEditing` selects the text **after** the colon (`ContentCombobox.jsx:169-175`) so typing replaces the local id while keeping `source:`. If the user then types a keyword (`nearer`), the input becomes `singalong:nearer` and the search dispatches that whole string. The backend **[verified]** parses this as `{prefix: 'singalong', term: 'nearer'}` and **scopes the search to the singalong source** (`ContentQueryService.mjs:88-109`). That is genuinely useful — you get an in-source keyword search for free.

The problem is **discoverability and reversibility**: nothing in the UI tells the user their keyword is being filtered to one source. If they meant to search *all* sources for `nearer` (maybe it's a Plex clip named "Nearer"), they get zero cross-source results and no indication why. The pending-sources strip (`:561-573`) shows only the source(s) actually queried, which is a subtle tell at best.

**Fix:** surface the active scope. When a `prefix:` is present in the query, render a removable scope chip in the dropdown header — "Searching within **singalong** ✕" — where ✕ drops the prefix and re-runs across all sources. This turns an invisible power-feature into a legible one and gives F13 a natural exit.

### F15 — Enter's "auto-highlight never selects" invariant is correctly enforced · Info (positive)

`Enter` selects `items[highlightIdx]` **only** when `state.highlight.userNavigated` is true (`ContentCombobox.jsx:231-241`; machine sets `userNavigated` only on `ARROW`, `comboboxMachine.js:87`). An auto-seeded highlight (e.g. `referenceIndex` on browse open, F1) can never be Enter-selected, so typed text always wins over a passive highlight. This is the correct resolution of the Mar-01 invariant and closes the "typed text loses to a row I never touched" bug. Keep it.

### F16 — Duplicate-id dedupe protects the index↔DOM invariant · Info (positive)

`RESULTS` dedupes by id, first-wins (`comboboxMachine.js:17-26`), because keyboard highlight is index-owned and requires DOM order to equal `items` order. Without it, a source emitting the same id twice (directory matched by name *and* path) would corrupt React reconciliation and desync the highlight. Correct and necessary — note the audited screenshot shows **two identical "The Star-Spangled Banner" rows**: those survive dedupe only if their `id`s differ (distinct hymn numbers for two arrangements). Worth a spot-check that near-duplicate titles carry distinct ids so dedupe isn't hiding a real collision — but the mechanism is right.

---

## 6. Cross-cutting

- **No loading skeleton on browse-open when uncached.** `openWithSiblings` dispatches `BROWSE_LOADING` (`useContentCombobox.js:321`), and the dropdown shows a centered loader only when `items.length === 0` (`ContentCombobox.jsx:601-607`). On a *reopen* with stale `results` still in state, the first paint can flash previous search results before browse items load. Verify `OPEN`/`INPUT` clear `results` adequately (they reset `browse`, `comboboxMachine.js:48-50`, but keep `results` on `VALUE_CHANGED`, `:92`).
- **`selectContainers` dual-affordance is fully built but unused** (F7). The chevron `ActionIcon` path (`:462-472`) and `browse-into-{id}` test id already exist — enabling it per call site is low-cost.
- **Accessibility:** highlight is a `data-highlighted` class, not `aria-activedescendant`; Mantine keyboard nav is disabled (`withKeyboardNavigation={false}`, `:490`). Screen-reader users get no announced active option. Out of scope for the five categories but worth a follow-up.

---

## 7. Prioritized recommendations

| Pri | Finding | Action | Status (2026-07-11, branch `feat/combobox-ux-overhaul`) |
|---|---|---|---|
| **P0** | F1 | **Mechanism corrected** (see below): backend already centers the window, so the fix is orientation + salience, not anchoring. Persistent "Current: … — not in this list" header + `idx:-1` no-phantom-highlight fallback. | ✅ Resolved — `d18d4a5fa` (F1) + `a854b0347` (F1b salient Current badge/marker) |
| **P0** | F4 | Move `before`-pagination scroll-restore to a post-commit write (double-rAF) via a pure `computeScrollRestore` helper. | ✅ Resolved — `230e8d702` (live jump-repro confirmation deferred to a dev-env pass) |
| **P1** | F11 | Auto-resolve made **undoable** (`showUndoToast` with restore) rather than a silent swap. | ✅ Resolved — `82159c301` |
| **P1** | F6 | Cap the machine `results` at `RENDER_CAP=50` (after dedupe, preserving the index↔DOM invariant) + transport-agnostic "showing first N" hint. | ✅ Resolved — `161e9c0b9` |
| **P1** | F14 | Removable "Searching within {source}" scope chip; `clearScope()` rewrites to the bare term. Shared `parseSourcePrefix` SSOT helper. | ✅ Resolved — `ffd36f192` |
| **P2** | F7 | `selectContainers` enabled on the three ContentLists picker surfaces (dual affordance: chevron drills, row/Enter selects). | ✅ Resolved — `280ec0a35` |
| **P2** | F8 | Back-at-siblings-root dismisses to DISPLAY (keeps value), no raw-id re-search. | ✅ Resolved — `dac84c5c1` |
| **P3** | F13 | Bare `source:` (empty term) routes an empty search, not a literal-string search. | ✅ Resolved — `c0891d3b3` |
| **P3** | F12 | Align client/server source-prefix regex. | ⏸️ **Deferred (deliberate).** Widening the backend to `[\w-]+` would regress real queries — e.g. `spider-man: no way home` would parse as source `spider-man`, term `no way home`, scoping the search to a nonexistent source. Today `\w+` correctly stops at the hyphen (full-text). No hyphenated source exists, so the client(`[\w-]+`, commit-detection)/server(`\w+`, search-parsing) divergence is theoretical and harmless. Revisit only if a hyphenated source id is ever introduced. |

### Correction to §1 / F1 (mechanism)
The original F1 write-up hypothesized the committed value falls *outside* the loaded siblings window. **Refuted:** `SiblingsService.#applyWindow` (`:158-205`) centers a 21-item window on the reference and returns a correct `referenceIndex` whenever the id is in the adapter list (singalong ids `singalong:hymn/N` match the committed value). The genuine gaps were (a) marker *salience* (fixed by F1b's Current badge) and (b) the rare `refIdx === -1` true-miss path (fixed by F1's orientation header + `idx:-1` fallback). Full derivation: `docs/_wip/bugs/2026-07-11-combobox-orientation-and-scroll-diagnosis.md`. Incidental: `SiblingsService.mjs:162`'s second `findIndex` clause is a dead no-op (`replace(/^[^:]+:/, m => m)` → identity) — separate low-priority cleanup, not part of this overhaul.

**What was NOT touched (correct as-is):** the state machine's highlight model, dedupe, commit-on-close policy, pagination-owner guard, and browse-token invalidation (F3, F9, F15, F16). Every fix above is presentation/affordance (plus one hook-fallback line and one reducer cap) layered on the existing machine — the reducer's transition set was not reopened.

### Verification status
All fixes carry unit/component tests (Vitest): **95 passing** across `frontend/src/modules/Admin/ContentLists/` (machine, hook, component, scroll-helper, content-logic). **Live/visual verification** (F1 orientation header on-screen, F4 jump-repro under CPU throttle, the scope chip and Current badge appearance, plus the existing combobox Playwright regression suites) is **pending a working dev environment** — deferred because the shared checkout is in use by a parallel piano agent with its backend down.
