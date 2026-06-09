# Media Content Lookup & Selection UX — Full-Scale Audit

**Date:** 2026-06-09
**Scope:**
- `backend/src/3_applications/content/ContentQueryService.mjs` (consolidated search orchestrator)
- `backend/src/2_domains/media/IMediaSearchable.mjs` (search contract)
- `frontend/src/modules/Admin/ContentLists/ContentSearchCombobox.jsx` (admin media-selection combobox, in the context of `AdminApp.jsx`)
- `frontend/src/Apps/MediaApp.jsx` + `frontend/src/modules/Media/**` (the Media App: search / browse / play / cast / fleet)
- Reference model: `docs/reference/media/` (requirements, technical contracts, search scopes)

**Method:** full wiring trace (code-read of every file in the chain), four parallel exploration passes (Media module, backend adapters, combobox history, prior-audit reconciliation), visual review of the canonical 2026-05-23 screenshots in `docs/_wip/audits/media-app-screens/`, and verification of every load-bearing claim against source. A live Playwright smoke script was prepared (`tests/_tmp_media_smoke.mjs`) but could not be executed during this session due to a tool-platform outage — see Appendix C.

**Headline:** The backend fundamentals are solid — a clean registry/adapter orchestration with streaming, relevance scoring, ID fast-paths, and alias resolution. The damage is almost entirely on the frontend: **two divergent search-selection UIs** (Admin combobox vs Media App search), each violating core combobox/search UX standards in different ways, and a Media App whose rebuilt skeleton is architecturally complete but whose interaction surface is unfinished — unstyled portals, a debug-stub Now Playing screen, an invisible queue, a search overlay that closes itself after one action, no debounce, and a results state machine that hijacks any query containing a colon.

---

## 1. Wiring Trace

### 1.1 Backend (shared by both UIs)

```
GET /api/v1/content/query/search          (batch JSON)
GET /api/v1/content/query/search/stream   (SSE: pending → results×N → complete | error)
        │  backend/src/4_api/v1/routers/content.mjs:254-382
        │  param normalization: text/source/mediaType/capability/take/skip,
        │  aliases (shuffle→sort=random, photos→gallery), dot-keys (plex.libraryId)
        ▼
ContentQueryService.search() / searchStream()      3_applications/content/ContentQueryService.mjs
        │  • #parseContentQuery: "prefix:term" → aliasResolver (gatekeeper + source narrowing)
        │  • #parseIdFromText: "plex:123" / all-digits→plex / UUID→immich  (ID fast-path, runs in parallel)
        │  • #canHandle / #translateQuery per adapter (caps = {canonical, specific})
        │  • merge → RelevanceScoringService (containers first, exact-title bonus, ID match score 1000)
        │  • capability filter, include/excludeMediaTypes, weighted rank, skip/take
        ▼
ContentSourceRegistry  (0_system/bootstrap.mjs:472-737, createContentRegistry)
        │  registered searchables: plex, immich, abs, komga, singalong, readalong,
        │  files, local-content, list, query (+ app, retroarch, freshvideo; youtube is NOT searchable)
        ▼
Adapter.search(translated) → items: ListableItem | PlayableItem
        media classes: plex {show,season,episode,movie,artist,album,track,collection,playlist,clip}
                       immich {person,tag,album,camera, asset(video|image)}
                       abs {author, audiobook, ebook, library} · singalong {hymn,…} · files {by extension}
```

Browse/selection support endpoints used by the UIs:

| Endpoint | Router | Used by |
|---|---|---|
| `GET /api/v1/list/:source/*` | `4_api/v1/routers/list.mjs:320-536` | combobox drill-in, MediaApp BrowseView |
| `GET /api/v1/siblings/:source/:localId` | `4_api/v1/routers/siblings.mjs:25-69` → `SiblingsService` (21-item window centered on reference, `referenceIndex`, `pagination`) | combobox open-with-value |
| `GET /api/v1/media/config` | media router | MediaApp scopes (`searchScopes`) + Home cards (`browse`) |
| `GET /api/v1/play/:source/*` | play router | Player (`SinglePlayer.fetchMediaInfo`) |
| `GET /api/v1/device/:id/load`, `/session/*` | device routers | cast / peek / takeover |

### 1.2 Consumer A — Admin combobox

`ContentSearchCombobox.jsx` → keystroke → 300 ms debounce → `useStreamingSearch` (SSE) or batch fallback → flat dropdown. Click container → `GET /list` drill-in with breadcrumbs; open-with-value → `GET /siblings` centered window with infinite scroll. Commit → `onChange('source:localId', item)`; consumers (`ListsItemEditor`, PlaybackHub `LabeledContentPicker`, `FitnessConfig`) store the raw compound-ID string.

**Critical wiring fact:** there are **two parallel implementations** of this combobox. The standalone (this file) and an inline rebuild inside `ListsItemRow.jsx` (~lines 732+) that received the Feb/Mar 2026 fixes (pac-man arrow wrapping, `userNavigatedRef` freeform guard, centered scroll, Escape/Tab handling, two-phase search). **The standalone never got those fixes** and is still live in ListsItemEditor / PlaybackHub / FitnessConfig.

### 1.3 Consumer B — Media App

```
MediaApp.jsx providers: ClientIdentity → LocalSession → Fleet → Peek → CastTarget → Dispatch → Search
MediaAppShell: Dock(SearchBar+FleetIndicator+CastTargetChip+MiniPlayer+Settings+DispatchTray)
             + AppNav(Home/Devices/Browse) + Canvas(home|browse|detail|nowPlaying|fleet|peek)
Search: SearchBar → useLiveSearch (NO debounce) → useStreamingSearch SSE → deriveSearchState
      → SearchResults → ResultRow [Play Now|Play Next|Up Next|Add|Cast]
Play:   ResultRow → resultToQueueInput → LocalSessionAdapter.queue.* → sessionReducer LOAD_ITEM
      → HiddenPlayerMount (play prop = {contentId, format, title, duration, thumbnail})
      → Player → SinglePlayer → fetchMediaInfo(/api/v1/play/…) → renderer registry
Cast:   CastButton → portal → DispatchTargetPicker → GET /device/:id/load (+ homeline:* WS progress)
Fleet:  /device/config + device-state:* WS → FleetView → PeekPanel (transport+volume)
      → /device/:id/session/transport|queue/*|claim (takeover)
```

A note on a claim that did **not** survive verification: an exploration pass flagged `resultToQueueInput()`'s `format: null` (for anything that isn't `mediaType video|audio`) as "100% playback-fatal." It is not — `SinglePlayer.jsx:220-260` only direct-plays when `mediaUrl && format` are present and otherwise resolves the contentId through `/api/v1/play/*` (with a collection-expansion fallback at `:270`). The playback chain is wired end-to-end. The unusability has different root causes (§4).

---

## Resolution Status — `feature/media-ux-overhaul` (2026-06-09)

Implemented per `docs/plans/2026-06-09-media-ux-overhaul.md` (TDD, branch not yet merged),
then hardened per the three-reviewer code review via
`docs/plans/2026-06-09-media-ux-review-fixes.md` (10 fix commits, `204c58f`…`ebd7478`).

**Review-fix pass (same day):** canvas adapter capabilities shape (regression fix,
`204c58f`); combobox Enter gate single-commit (`2376e22`); debounce cancel on close
(`118fe0a`); seek-tick suppression while seeking (`df2e2a0`); portal-aware overlay
dismiss completing M1 (`c0289bc`); M14 grid pins + search-bar shrink (`e10c8cf`,
`ebd7478`); batch ID-lookup timeout completing B3 (`7474ba6`); pending-badge/minis
(`63a1167`); Playwright suite repairs (`3222b83`); **commit-on-close** replacing the
blur-commit race — a pre-existing main bug where Mantine's outside-pointerdown close
reset state before blur, silently dropping id-like input (`e83bddf`).

**Live gate (worktree UI on :3115 → running backend):** combobox suites 01/03/05/12
fully green (21/21); suites 02/04/06/07/08/13–17 green in the full-folder run; ~270
live tests passed total, zero branch-attributable failures. Two pre-existing failures
confirmed identical on main: the blur-commit race (now FIXED on this branch — branch
beats main's baseline) and suite 10:467's fragile first-badge locator (grabs the
childCount badge; harness issue, filed below). Visual evidence:
`media-app-screens/2026-06-09-post-fix-mobile-390.png` (M14: cog row 1, status row 2,
nothing clipped) and `2026-06-09-post-fix-cast-picker.png` (M1: styled picker, device
toggled by a click that did NOT dismiss the search overlay).

**Known non-branch issues observed during the gate:** abs/singalong adapters
intermittently never complete on the old backend (the B3 symptom — fixed by this
branch's 8s timeout once deployed); cast-picker device rows render empty name labels
(data/name resolution, predates branch); suite 10:467 locator fragility; Mantine
option click double-fires `handleItemClick` (pre-existing, follow-up filed in the
review-fixes plan's deferred list).

| Finding | Status | Commit |
|---|---|---|
| B1 (stale contract + docs + logger) | FIXED | `88355bf` |
| B2 (digits/colon ID hijack labeling) | DEFERRED (out of scope per plan §Deferred) | — |
| B3 (no per-adapter timeout) | FIXED — 8s `withTimeout` | `b3fa059` |
| B4 (per-source failures invisible) | FIXED — `source_error` SSE; both UIs show failed sources | `b3fa059` |
| B5 (item-shape inconsistency) | DEFERRED | — |
| M1 (cast picker unstyled) | FIXED — portal inherits tokens | `4c3d618` |
| M2 (colon-title queries hidden) | FIXED — search normally; deep-link pinned row | `9f71d04` |
| M3 (no debounce) | FIXED — 250ms debounce | `2e01e12` |
| M4 (browse drill-down paths) | FIXED — address by id; titled breadcrumb | `c933e3f` |
| M5 (NowPlaying debug stub) | FIXED — real player (transport/seek/volume/queue) | `a693664` (+ticks `37da53b`) |
| M6 (queue invisible) | FIXED — QueuePanel | `f062bf8` |
| M7 (action destroys search) | FIXED — queue ops keep search open + flash | `4d0866a` |
| M8 (rows lack context) | FIXED — context subtitle line | `4d0866a` |
| M9 (no keyboard model) | DEFERRED (needs a11y design) | — |
| M10 (scope `<select>` + fiction doc) | FIXED — optgroups, child scopes, visible config error, doc rewritten | `51da467` |
| M11 (fleet status lies) | FIXED — real-state dots; guarded Take Over | `0c9fdf8` |
| M12 (peek transport-only) | FIXED — seek, remote queue, device names | `7f4507c` |
| M13 (dispatch retry stale params) | DEFERRED | — |
| M14 (mobile layout rough) | FIXED — dock stacks search above status | `9467ef3` |
| §3.1-1/2/10 (combobox open: committed value, no stale results) | FIXED | `f730ba5` |
| §3.1-5/6 (non-destructive blur; explicit freeform) | FIXED | `13a5286` |
| §3.1-7 (container dual affordance) | FIXED — browse chevron when rows select | `b363133` |
| §3.1-9 (clear button + resolved human title) | FIXED | `cb658c1` |
| §3.2 (combobox/twin unification) | DEFERRED (its own plan) | — |

## 2. The Backend: Solid, With Five UX-Relevant Landmines

The orchestration layer is in good shape: parallel ID-lookup + text search, per-adapter perf accounting, streaming with race-yield, alias gatekeepers, generic media-type filters and weighted ranking. These are not in question. What follows is the short list of backend behaviors that *surface as frontend UX problems*.

| # | Landmine | Where | UX symptom |
|---|---|---|---|
| B1 | **Stale domain contract.** `IMediaSearchable.mjs:115` documents `getSearchCapabilities(): string[]`; every adapter and `ContentQueryService.#canHandle` (line 605) actually use `{canonical: [], specific: []}`. `validateSearchQuery`/`isMediaSearchable` are effectively dead code — nothing enforces the interface at registration. | `2_domains/media/IMediaSearchable.mjs` | None today (all 8 adapters happen to agree), but the "contract" is a fiction; the next adapter author who follows the docs gets silently skipped by `#canHandle`. |
| B2 | **All-digits / colon hijack in `#parseIdFromText`.** `"1989"` → Plex ID lookup; any `word:rest` text → treated as `source:id`. | `ContentQueryService.mjs:337-373` | Searching an album called *1989* or a title like *Frozen II* by year pins an unrelated Plex item (rating key 1989) at rank 1. Acknowledged in code comments as a tradeoff — but neither UI labels the ID-match row as such. |
| B3 | **No per-adapter timeout.** `searchStream` awaits each adapter promise indefinitely; abs/immich have no circuit breaker (YouTube does). | `ContentQueryService.mjs:244-301`; `AudiobookshelfAdapter.mjs:318` | One slow/offline source holds the SSE `complete` event → spinner and "Searching: abs…" badge forever; in the batch path, the whole response hangs. |
| B4 | **Per-source failures are invisible downstream.** Stream path: erroring adapter → `warnings` array → only emitted in the final `complete` event; the `results` event for that source simply never arrives. Batch path returns `warnings` but neither UI reads it. | `ContentQueryService.mjs:253-272`; both consumers | "Plex is down" is indistinguishable from "no Plex matches." Violates the spirit of N3.2/C9 and the Feb-audit lesson that silent failure is the worst failure. |
| B5 | **Item-shape inconsistency across adapters.** `type` vs `metadata.type` vs `mediaType`; `childCount` sometimes absent; immich people/tags ship `thumbnail: null`; min-text-length 2 enforced by `files` adapter and by the stream route but not the batch route or other adapters. | per-adapter (see §1.1 classes) | Frontend icon/subtitle/container heuristics (`ContentSearchCombobox.jsx:50-60`) misclassify; rows render with missing imagery and wrong affordances. |

Also worth a cleanup pass: raw `console.debug` calls inside `#enrichWithWatchState` / `enrichWithWatchState` (`ContentQueryService.mjs:741,745,802,805`) — the project logging rule applies backend-side too.

---

## 3. ContentSearchCombobox (Admin) — UX Standards Audit

This component conflates **three different jobs** in one text input — (a) live search box, (b) committed-value display/editor, (c) browse navigator — and every major defect below falls out of that conflation.

### 3.1 Keystroke/state walkthrough (as implemented)

State: `search` (`null` = "not editing"; string = live input), `value` (committed `source:localId` from parent), `breadcrumbs[]` + `browseResults` (browse mode), `streamResults`/`fallbackResults` (search mode). Display value: `search !== null ? search : value` (line 406).

| Step | User action | What happens | Standard violated |
|---|---|---|---|
| 1 | Click/focus input | Dropdown opens; `search` set to `''` → **input text vanishes** (committed value no longer visible anywhere); rAF `select()`s an empty string (lines 153-168) | A combobox must keep the current selection visible (as text, chip, or label) while editing. The user now edits blind. |
| 2 | (same open) | If `value && !initialLoadDone && results.length === 0` → siblings load. But `streamResults` from a *previous* search session persist after close (nothing clears them on close), so condition fails and **stale results from the last query render under an empty input** (lines 137-141, 161-163) | Stale-suggestion display; open-state should derive from current input, not residue. |
| 3 | Type 1 char | Browse mode (if active) is destroyed silently: breadcrumbs + browseResults wiped (lines 559-564). A user 3 levels deep loses all navigation context with no undo | Destructive mode-switch without affordance or back path. |
| 4 | Type ≥2 chars | 300 ms debounce → SSE search; pending-source badges animate (good). No per-source error surfacing (see B4) | — |
| 5 | `Enter` | If Mantine has auto-highlighted an option, Enter selects it; the freeform commit only fires when `idx === -1 \|\| results.length === 0` (lines 591-606). The **`userNavigatedRef` fix from the 2026-03-01 bug was applied only to the inline ListsItemRow clone, never here** — typing an exact value while results exist and pressing Enter can select the highlighted row instead of committing what the user typed | Regression risk of the exact bug documented in `docs/_wip/bugs/2026-03-01-admin-freeform-commit-must-always-save.md`. |
| 6 | Click away (blur) | **Any non-empty `search ≠ value` is committed as the new value** (lines 578-589). Typing "beet" to *look for* Beethoven and clicking elsewhere replaces a working `plex:456724` with the literal string `beet` | The deepest violation: a search box must never commit its transient query on blur. The 2026-03-01 invariant ("always save freeform") was written for intentional ID entry; applied to a field that is *also* the search box, it makes exploration destructive. The two intents need separate affordances (e.g., an explicit "Use ‘beet’ as raw value" row in the dropdown), not a blur heuristic. |
| 7 | Click a container row | Drills in via `/list` (good); but when `selectContainers=false` there is **no way to select a container**, and when `true` there is **no way to browse into one** (lines 391-400). The chevron is decorative, not a separate hit target | Split-affordance standard (Plex/Spotify pattern: row navigates, trailing button selects/plays) ignored. |
| 8 | Click subtitle "parent" text | Mouse-only, underlined 12px text inside the option navigates to the parent — works only for path-style localIds (`localId.includes('/')`, lines 414-418), so it appears for `files:` items and never for Plex episodes, whose `parentTitle` is present but whose localId is numeric | Inconsistent affordance across sources; tiny target; not keyboard-reachable. |
| 9 | Select a leaf | `onChange(id, item)` and input now displays… `plex:456724` | Raw IDs as display values. Every consumer that cares (PlaybackHub `LabeledContentPicker`) has built its own title-cache workaround; ListsItemEditor/FitnessConfig users just see IDs. Title resolution belongs in the component (one `/info` lookup or the `item` it already receives). |
| 10 | Reopen later | `onDropdownClose` resets only `search`; breadcrumbs/browseResults persist → reopen can show the *previous* browse listing against a new value | State residue across sessions of the widget. |

### 3.2 Additional defects

- **No clear (×) affordance** — emptying the field is itself interpreted as… nothing (empty string fails `if (search && …)`), so you *cannot* clear a value via the input at all.
- **No Escape-to-revert semantics distinct from close**; no ArrowRight-to-drill (inline clone has it); no `aria-label`; result count not announced.
- `doBatchSearch` `useCallback` deps `[]` omit `searchParams` (line 123) — stale-closure: scope params changes don't reach the non-SSE fallback path.
- `renderOption` derives `source` as `item.source || item.id?.split(':')[0]` then calls `source.toUpperCase()` (lines 448, 505) — throws on any item with neither (e.g., bare-name list items).
- Infinite scroll exists only in siblings mode; `/list` drill-in renders unbounded folders with no pagination (line 327).
- Loading is a single spinner in `rightSection`; in browse mode there is no skeleton/empty distinction between "loading folder" and "empty folder."
- **Two-implementation drift** is itself a UX defect-generator: 12 issues fixed in the inline clone (per `2026-02-06-content-search-combobox-behavior-audit.md`, all marked fixed) are still live here. Either the standalone adopts the inline behavior wholesale and the inline delegates to it, or one of them dies.

What works and should be preserved: `useStreamingSearch` is genuinely solid (race-cancel via identity check, min-length guard, state cleared on new/short query, both error kinds surfaced, 10 unit tests) — `frontend/src/hooks/useStreamingSearch.js:38-115`. The freeform-commit *test suite* (`tests/live/flow/admin/content-search-combobox/12-freeform-commit.runtime.test.mjs`) pins the invariant; any fix to §3.1-6 must rework the invariant deliberately (explicit-affordance commit still satisfies "user input is never lost," which is the bug report's real point), not silently break the tests.

---

## 4. Media App — Why It Reads as "Completely Unusable"

The May 15-16 overhaul (28 commits) fixed real P0s (Stop control, search state machine, inline cast picker, Home resume/recents). But the canonical screenshots taken **after** that overhaul (2026-05-23, `media-app-screens/`) plus the current code show the app still fails its primary loops. Verified causes, ordered by blast radius:

### 4.1 Critical — broken primary flows

| # | Defect | Evidence | Effect |
|---|---|---|---|
| M1 | **Cast picker renders unstyled garbage from result rows.** `CastButton` portals the picker to `document.body` (`CastButton.jsx:55-65`), but all picker styles are scoped under `.media-app` (`MediaApp.scss:1343` `.media-app .dispatch-target-picker`). The portal escapes the scope → zero styling. The SCSS comment at `:1429` shows the author knew the portal escapes scope but only unprefixed the *wrapper* class. | Screenshot `04-cast-picker-open.png`: transparent picker, "Target device" floating over the peek panel, checkboxes overlapping the title text, no panel background. | **Casting from search — the primary cast entry point — is visually broken.** Users cannot parse the device list. |
| M2 | **Colon-in-title queries never show results.** `deriveSearchState` returns IDLE (deep-link suggestion) whenever the query matches `^[a-z][a-z0-9-]*:.+` — including `frozen: part 2`, `star wars: andor`, any `Title: Subtitle` pattern (`searchStates.js:10,17`). The SSE search still runs and returns items; the UI refuses to show them. | Code; backend handles colon text fine (prefix resolution falls through). | **Discovery broken for a huge class of real titles.** User sees "Looks like a content ID: `frozen: part 2`" + a Play button that will 404. |
| M3 | **No debounce on search.** `SearchBar.onChange` → `useLiveSearch.setQuery` → `inner.search()` **on every keystroke** (`SearchBar.jsx:32-36`, `useLiveSearch.js:11-15`). Each keystroke tears down the EventSource and starts a full multi-adapter backend search; a 12-char query = 12 searches, 11 cancelled. Also logs `search.issued` per keystroke (violates C10.5 sampling). | Code. Contrast: admin combobox debounces 300 ms. | Results flicker and churn; slow adapters never complete before cancellation; pending badges thrash; backend hammered. N1.2's "incremental within 200ms of *debounce resolving*" presumes a debounce that doesn't exist. |
| M4 | **Browse drill-down builds malformed paths.** Clicking a container pushes `path: \`${path}/${id}\`` where `id` is a **compound** id → `/api/v1/list/plex/video/plex:12345`, and a second drill yields `plex/video/plex:12345/plex:67890` (`BrowseView.jsx:61`). Breadcrumbs then render raw `plex:12345` as a crumb label; `modifiers` are dropped on push. | Code; pending live confirm (Appendix C). | **Hierarchical browse (C1.2) is broken or absurd one level past the library root** — the Home cards ("Browse Music/Video/…") lead into a dead end. |
| M5 | **Now Playing is a debug stub.** Heading is `Now Playing: {item?.contentId ?? 'nothing'}` — the raw content ID, not the title; below it, literal `state: playing` / `position: 84s` chips; **no transport bar (no pause, no seek, no skip, no volume), no queue display** — just the player host and an always-expanded hand-off picker (`NowPlayingView.jsx:42-54`). | Code + styles (`MediaApp.scss:1012-1051` styles the debug chips rather than replacing them). | The "full-screen player" can't control playback. The only local transport in the entire app is the 36px dock MiniPlayer (pause/stop). **There is no seek control and no local volume control anywhere in the UI** (volume is settable only via `?volume=` URL param). |
| M6 | **The queue is invisible.** `LocalSessionAdapter` implements the full Plex-MP model (playNow/playNext/addUpNext/add/remove/reorder/jump/clear/shuffle/repeat — `session/queueOps.js`), and remote queue APIs exist — but **no component renders a queue anywhere**, local or peek. C3.2/C3.3 have zero UI. | File inventory of `shell/`+`browse/`+`search/`: no Queue component exists. | "Play Next/Up Next/Add" buttons mutate an invisible structure with **zero feedback** (no toast, no badge, no count). Users click Add, nothing observable happens — the Mar-05 audit's #7 ("zero feedback on queue actions"), still open 3 months later. Shuffle/repeat are unreachable. |
| M7 | **One action destroys the search session.** Every ResultRow action calls `onAction` → `SearchBar.close()` → clears query *and* results (`ResultRow.jsx:31`, `SearchBar.jsx:24-28,84`). Queueing five tracks from one search = type the query five times. | Code + requirement C1.1a/J2 ("keep browsing, adding, reorganizing while content plays"). | Multi-add, the core queue-building gesture, is punitive. |

### 4.2 High — degraded flows

| # | Defect | Evidence |
|---|---|---|
| M8 | **Search rows give no context.** Row = thumb + title + 5 buttons; no type/source/year/parent until you toggle the peek. Screenshot `02-search-results.png`: a movie, a 1968 home video, and seven scanned `.jpg`s render identically; filenames (`2026-05-12 14.56.32.jpg`) pass for titles. Apr-19's "crowded buttons collapsed to primary + overflow" claim does **not** match current code — `ResultRow.jsx:48-54` still renders all five peer buttons on every row, at `opacity: .7`, 11px text. | Screenshots + code |
| M9 | **No keyboard model in search results.** No arrow-key navigation, no Enter-to-play, no focus management in the overlay; the requirements call the search surface a "combobox/dropdown pattern" (C1.1). Tab-walking five buttons per row is the only path. NowPlaying registers a document-level Escape that fights the search overlay's `useDismissable` Escape. | Code (`SearchBar.jsx`, `NowPlayingView.jsx:19-28`) |
| M10 | **Scope system regressed to a bare `<select>`, and the reference doc is fiction.** `search-scopes.md` documents `ScopeDropdown.jsx`, `ScopeChips.jsx`, `useScopePrefs.js` (favorites, recents, result-count chips, source-badge re-scoping) — **none of these files exist**. The implementation is a flat `<select>` that renders only top-level scopes; `children` in `media.yml` are never rendered, so leaf scopes defined per the doc are unreachable. Config-load failure is swallowed (`SearchProvider.jsx:21` `.catch(() => {})`) → silently empty dropdown. | Verified: files absent; `SearchBar.jsx:58-66`; `SearchProvider.jsx` |
| M11 | **Fleet status lies.** `.fleet-indicator::before` and `.fleet-card-state::before` are hardcoded `var(--success)` green (`MediaApp.scss:304-311, 865-880`) — screenshot shows a green dot beside "Fleet 0/2". FleetView offers **Take Over on idle and offline devices** (nothing to claim), shows raw `d.type`/device ids, no progress, no queue, no thumbnail (C4.2 partial). | Screenshots `01`, code `FleetView.jsx:46-53` |
| M12 | **Peek panel is transport-only.** No seek (C5.2 requires it; `seekAbs/seekRel` exist on `RemoteSessionAdapter` but no UI), no queue ops (C5.3 — required, zero UI), no shuffle/repeat/shader (C5.4 partial: volume only). Heading is `Peek: {deviceId}` — raw id again. | `PeekPanel.jsx:71-131` |
| M13 | **Dispatch retry replays stale params** without revalidating target health/selection (`DispatchProgressTray` → `retryLast()`), and transfer-mode success stops local with no "local stopped" feedback. | `cast/DispatchProvider.jsx`, `DispatchProgressTray.jsx` |
| M14 | **Mobile layout is rough**: at narrow widths the dock wraps with the settings cog orphaned on its own row and the canvas squeezed half-width (screenshot `07-home-mobile.png`); only one 780px breakpoint exists. | Screenshot + `MediaApp.scss:1191-1197,1609-1619` |

### 4.3 Structural notes

- **First-run Home is four unlabeled gradient cards** ("Browse Music/Video/Hymns/Books") — Resume/Recents render `null` when empty, so the C1.3 landing surface for a new user is two dead ends (cards → M4 broken browse) and a search box (→ M2/M3/M7).
- **History/back is fragile**: `NavProvider` collapses the stack to a single entry on `popstate` (`NavProvider.jsx:41-49`), so browser-back after a refresh exits the app from NowPlaying (`goBack` falls through to `window.history.back()`).
- **DetailView** exists and is decent (poster grid, primary Play Now) but is only reachable from BrowseView leaf items — search results never link to it (the peek shows meta with **no actions inside it** and no "open detail" link).
- What *is* healthy: provider architecture, session persistence/restore (`persistence.js`, schema-versioned), URL `?play=/?queue=` dedup tokens, stall detection (10s auto-advance), dispatch dedup window, optimistic peek overlay, 1600+ unit tests. The skeleton is right; the skin and the hands are missing.

---

## 5. Why Did Six Audits Not Fix This? (Reconciliation)

Seven prior audits (Feb 17 → May 15) hit this surface. Pattern across them:

1. **Fixes land in one of the two twins.** The combobox fixes (Feb 6, Mar 1) went to the inline `ListsItemRow` clone; the standalone — used by three other consumers — kept the old behavior. The Media App was rebuilt (P1-P7) parallel to, not on top of, the audited player, resetting UX maturity to zero while inheriting requirement checkmarks ("C1 ✅") that described *plumbing*, not *experience*.
2. **"Capability exists" was scored as "requirement met."** The Apr-18 coverage audit scored 97% by verifying adapters, reducers and endpoints. C3 is "✅ Client" — yet no queue UI exists. The requirement-coverage methodology never opened the app.
3. **Some claimed fixes aren't in the tree.** Apr-19's "crowded buttons → primary + overflow (`38636158e`)" and "result context" do not match current `ResultRow.jsx`. Either reverted in the May rebuild of the search overlay or never merged here.
4. **Chronic issues recurring in ≥3 audits and still open today:** queue-action feedback (Feb-17, Mar-05, this), seek affordance (Feb-17, Mar-05, this — now *absent* rather than bad), accessibility/keyboard (Mar-05, Apr-19, this), silent per-source search failure (Apr-15, this), raw IDs shown to humans (Apr-15, May-15, this).

---

## 6. Prioritized Fix List

### P0 — restore the primary loops (each is small and surgical)

1. **Style the portaled cast picker** — either stop portaling (`CastButton` overlay can be absolutely positioned inside `.media-app`) or add the `media-app` class to the portal root / unscope `.dispatch-target-picker` styles. (`CastButton.jsx:55`, `MediaApp.scss:1343`) → fixes M1.
2. **Fix `deriveSearchState` colon hijack** — show results when results exist; render the deep-link affordance as a pinned first row only when the parsed `source` matches a *registered* source prefix. (`searchStates.js:17`) → M2.
3. **Debounce `useLiveSearch`** (250-300 ms, mirroring the admin combobox) and sample `search.issued`. → M3.
4. **Fix BrowseView container navigation** — push the container's own compound id as the new path root (`push('browse', { path: id, modifiers })`), or strip the source prefix when appending; render crumb labels from titles. (`BrowseView.jsx:61`) → M4.
5. **Don't close search on action** — replace `onAction={close}` with a transient "Added ✓ (queue: N)" affordance; close only on Play Now/escape/outside. (`SearchBar.jsx:84`) → M7.
6. **Queue panel** — render `snapshot.queue` (NowPlaying sidebar + dock count badge) with remove/jump/clear, then reorder/shuffle/repeat. The adapter API is already complete. → M6.
7. **Make NowPlaying a player screen** — title (resolve via item/`/info`), transport row (play/pause/stop/skip), a real seek bar, volume slider (`config.setVolume` exists), collapse hand-off behind a button. → M5.

### P1 — admin combobox

8. **Kill blur-commit of search text.** Commit freeform only via explicit gesture: Enter with the (always-present) "Use ‘…’ as raw value" row highlighted, or a dedicated row click. Update the 12-freeform tests to pin the new gesture — the underlying invariant ("typed input is never silently discarded") is preserved by the affordance.
9. **Port the inline fixes** (`userNavigatedRef`, arrow-key model, Escape/Tab, centered scroll) into the standalone, then make `ListsItemRow` consume the standalone. One combobox, one behavior.
10. **Show the committed selection while editing** (chip or subtitle under the input) + add a clear (×) button + resolve titles for committed IDs in-component (drop the per-consumer title caches).
11. **Split container affordances**: row click navigates; trailing button selects ("Choose this folder") when `selectContainers`, chevron browses when not.

### P2 — honesty & polish

12. Surface per-source search warnings in both UIs (the SSE `complete` event already carries them); add a per-adapter timeout (~8s) in `searchStream` (B3/B4).
13. Fleet truthfulness: state-colored dots, hide/disable Take Over for idle/offline, human device names in Peek/Fleet headings (M11/M12); add seek + queue ops to PeekPanel (C5.2/C5.3).
14. Result-row context line (type • parent • year • source badge) and a primary-action + overflow-menu layout (M8); peek panel gets actions + "open detail."
15. Rewrite or delete `docs/reference/media/search-scopes.md` (describes deleted components); either rebuild scope children/favorites/recents or trim the config schema to what the `<select>` supports (M10).
16. Update `IMediaSearchable.mjs` to the real `{canonical, specific}` contract and enforce it at registry registration (B1); remove the raw `console.debug`s from `ContentQueryService` (logging rule).
17. Keyboard model for the Media search overlay (roving highlight, Enter=primary, aria roles) — fold into the deferred a11y spec, but arrow-keys+Enter shouldn't wait for it (M9).

---

## Appendix A — Standards Violated (summary)

| Standard | Combobox | Media App |
|---|---|---|
| Search text ≠ committed value (no destructive blur-commit) | ✗ (§3.1-6) | n/a (separate, ✓) |
| Current selection visible while editing | ✗ (§3.1-1) | n/a |
| No stale suggestions on open | ✗ (§3.1-2) | ✓ (hook clears) |
| Debounced remote search | ✓ (300ms) | ✗ (M3) |
| Keyboard: arrows/Enter/Escape complete model | partial (inline only) | ✗ (M9) |
| Results actionable without losing search context | ✓ | ✗ (M7) |
| Container dual affordance (navigate vs select) | ✗ (§3.1-7) | ✗ (browse broken, M4) |
| Human-readable labels (never raw IDs) | ✗ (§3.1-9) | ✗ (M5, M11, M12) |
| Action feedback (toast/badge) | partial | ✗ (M6) |
| Honest status (errors, offline, per-source failure) | ✗ (B4) | ✗ (B4, M11) |
| Loading/empty/error differentiated | partial | ✓ (search) / ✗ (browse) |

## Appendix B — File Reference Index

Backend: `ContentQueryService.mjs` (search:63, stream:204, idParse:337, canHandle:604, merge:441), `content.mjs:254-382`, `siblings.mjs:25-69`, `bootstrap.mjs:472-813`, adapters per §1.1.
Combobox: `ContentSearchCombobox.jsx` (open:153, siblings:173, browse:316, click:382, blur:578, enter:591), `useStreamingSearch.js`, inline twin `ListsItemRow.jsx:732+`.
Media App: `SearchBar.jsx:22-90`, `searchStates.js:17`, `useLiveSearch.js:11`, `ResultRow.jsx:23-54`, `resultToQueueInput.js:8`, `BrowseView.jsx:61`, `NowPlayingView.jsx:42-54`, `MiniPlayer.jsx`, `FleetView.jsx:46-53`, `PeekPanel.jsx:71-131`, `CastButton.jsx:55-65`, `MediaApp.scss:304,1343,1429`, `NavProvider.jsx:41-49`, `HiddenPlayerMount.jsx:151-183`, `SinglePlayer.jsx:220-330`.
Screenshots: `docs/_wip/audits/media-app-screens/*.png` (2026-05-23).

## Appendix C — Live Verification (pending)

A Playwright smoke script is staged at `tests/_tmp_media_smoke.mjs` (initial load, "christmas" search, result click, Play Now, Devices nav, `?play=` deep link; screenshots + console/network capture to `/tmp/media-audit/`). The dev server was confirmed running on :3111, but a session-long tool-platform outage (Bash safety classifier unavailable) prevented execution. Run manually:

```bash
node tests/_tmp_media_smoke.mjs
```

Findings M4 (browse path) and the deep-link flow are the two items where live confirmation would upgrade "high-confidence code-level" to "observed." Everything else in §4 is verified by code + the 2026-05-23 screenshots.
