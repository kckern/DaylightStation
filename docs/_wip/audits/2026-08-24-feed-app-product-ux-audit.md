# Feed App — Product, UX, Formatting, and Performance Audit

**Date:** 2026-08-24
**Scope:** `frontend/src/Apps/FeedApp.jsx`, the Reader, Headlines, Scroll, detail, and shared-player frontend modules, plus `docs/reference/feed/*` and directly relevant live-flow tests.
**Method:** Read-only documentation and source review, targeted ESLint, and local render inspection at 390px and 1440px. The Reader and Headlines local renders completed. The Scroll API did not return within the render-check window, so Scroll conclusions are based on source, reference documentation, and existing runtime tests.
**Status:** The recommended four-phase product remediation is implemented. The original findings are retained below as the historical baseline; the closure and limits below are authoritative for current behavior.

## Implementation closure — 2026-08-24

The trust, continuity, accessibility, state, search, and long-session foundations identified in this audit have been implemented. Reader, Headlines, Scroll, and Search now share canonical read/save/archive state; mutations have rollback and Undo behavior; failed FreshRSS writes enter a durable server retry queue; browser-network failures enter an ordered client replay queue; mode/filter state is URL-addressable; routed mode snapshots and account checkpoints retain place; Scroll sessions survive browser and server restarts; search supports browsing, filters, pagination, and persisted backfill coverage; and Reader/Scroll rendering is bounded to 60 mounted rows/cards.

The shell now uses three stable primary modes plus an edition selector, lazy route bundles, unread and pending-sync status, account-scoped reading controls, query-preserving navigation, and per-route render recovery. Headline briefing adds deterministic multi-source clustering and chronological coverage/update labels while retaining the outlet matrix. Scroll exposes durable more/less/mute controls. Reader and Scroll provide notes, quoted highlights with text-quote locators, and explicit device-local downloads. Portable JSON export/import covers workspace state and normalized history metadata. Keyboard and focus handling were repaired for the Reader drawer and player sheet, native/ARIA slider controls were added, non-gesture item actions remain visible on phones, and normal sessions no longer pay for deep performance monitoring or per-card layout logs.

| Audit area | Current evidence |
|---|---|
| F-01–F-09 trust and baseline usability | Resolved: mode/session state, query-preserving navigation, valid source controls, overlay focus lifecycle, request guards, reversible mutations, partial-resource errors, and scalable primary navigation |
| F-10 personalization controls | Visible tier/source filters, per-card “Why shown,” and durable top-level `more`/`less`/`mute`/reset controls are implemented. Topic tuning and subscription/follow remain separate future models |
| F-11–F-12 continuity and semantics | Read/save/archive state, unread and pending-sync status, new-since-last-visit markers, explicit Archive, Undo, caught-up state, and history browsing are implemented |
| F-13 Headlines hierarchy | Deterministic briefing clusters, lead hierarchy, timestamps, provenance, coverage comparison, harvested-story chronology, update/correction title labels, and the outlet matrix are implemented. Publisher page-revision tracking is intentionally not claimed |
| F-14–F-15 readability and grid contract | Persistent density plus theme, text-size, line-spacing, and reading-width controls are implemented. Grid placement is validated as zero-based and covered with non-sequential-label tests |
| F-16 styling fragmentation | Partially addressed through shared shell/search/state styles; older source-specific cards and detail sections still contain substantial inline presentation |
| F-17–F-20 long-session costs | Resolved or bounded: measured 60-item windows, debug-gated telemetry/layout logs, and focus/hover-only preview mounting. Masonry still uses per-mounted-card observers, capped by the window |
| F-21–F-23 delivery costs | Top-level modes are lazy, the Feed scroll source is centralized, remote font CSS and synchronous image probing are removed. Further source-plugin chunking remains an optimization |
| Daily-reader workflow | Implemented: unified history search, durable item state, saved/archive/offline views, bulk actions, reload/session recovery, browser and source-sync retry, reading appearance, account checkpoints, visit markers, annotations, portable backup, source tuning, and optional session boundaries |
| Verification | See the final verification record below; historical counts are not reused after the account/offline/source additions |

This closure does not claim a WCAG certification or measured field-performance certification. Deterministic Chromium acceptance covers phone Reader/Scroll and desktop Headlines, but final TV and real-data acceptance still belongs on the target displays. Offline editions deliberately exclude guaranteed third-party media caching; checkpoints are mode positions rather than per-paragraph reading percentages; export is not OPML or a complete publisher-content archive; chronology covers harvested reports rather than silent publisher revisions; and summaries remain source-provided rather than AI-generated. These limits are explicit product boundaries, not undocumented behavior.

### Final verification record

Verified against the current worktree on 2026-08-24:

- **Feed unit/component/application/adapter/domain:** 50 files, 366 tests passed.
- **Feed HTTP integration:** 21 Supertest router tests passed, including workspace, source preference, annotation, export/import, session, search, and state routes.
- **Rendered Chromium acceptance:** 4 deterministic cases passed: 390×844 Reader, 1440×1000 Headlines, a 390×844 Scroll response containing 500 items, and a cold Scroll deep link recovered from user-scoped IndexedDB after its API lookup failed. The Scroll case asserts at most 60 mounted cards, immediate source mute behavior, caught-up reachability, and no page-level horizontal overflow. The Reader case covers the mobile subscription dialog/Escape lifecycle, horizontally scrollable state controls, bounded rows, and no page-level overflow.
- **Static verification:** zero-warning Feed ESLint, backend/service-worker syntax checks, and `git diff --check` passed.
- **Production build:** Vite transformed 12,560 modules and completed. Feed route chunks remain separated (`Reader` 6.94KB gzip, `Headlines` 4.04KB, `Scroll` 21.88KB, `Search` 2.05KB); existing repository-wide Sass, runtime-asset, mixed-import, and large-main-bundle warnings remain outside this Feed change.

The Chromium fixtures mock Feed API responses to avoid mutating household data. They prove the application render and interaction contracts, not upstream FreshRSS availability or production content quality.

---

## Executive summary

The Feed is a strong content platform wrapped in an incomplete reading product. Its combination of a FreshRSS inbox, configurable newspaper matrix, algorithmic discovery stream, personal-life sources, rich detail renderers, and persistent media playback is unusually capable. The backend assembly model is already more sophisticated than most feed readers.

The principal gap is not source breadth. It is continuity and control. A reader cannot reliably leave a mode and return to the same place; important filter state disappears from URLs; async failures are handled inconsistently; Headlines gives every outlet equal visual weight; long sessions grow the DOM without bound; and several essential interactions are inaccessible from keyboard or assistive technology.

### Scorecard

| Area | Assessment | Why |
|---|---|---|
| Content architecture | Strong | Three intentional modes, diverse source model, extensible details, configurable assembly |
| Reader usability | Good foundation | Efficient inbox and grouping, but fragile state and incomplete reading workflow |
| Headlines formatting | Coherent but excessively dense | Strong scan surface, weak hierarchy, hover-dependent previews |
| Scroll/discovery | Ambitious | Excellent source mixture and detail support, insufficient user agency |
| Accessibility | Weak | Non-semantic click targets, incomplete dialogs/drawers, tiny text and controls |
| Reliability | Mixed | Detail race guard is good; list/page/filter requests and mutations are fragile |
| Long-session performance | At risk | Unbounded DOM, per-card observers, continuous telemetry, eager mode imports |
| World-class readiness | Promising, not close | Core engine exists; daily reading and recovery loops do not |

---

## Intended jobs

The reference documentation defines three separate user jobs:

1. **Reader — process subscriptions intentionally.** A Google Reader-style FreshRSS inbox with feed/category filtering, adaptive time grouping, pagination, expansion, and read state (`docs/reference/feed/reader-system.md`).
2. **Headlines — scan the information environment.** Configured outlet pages displayed in a newspaper-like matrix, including multi-page layouts, source refresh, images, and optional paywall routing (`docs/reference/feed/feed-system-architecture.md`).
3. **Scroll — discover timely and personally relevant material.** A mobile-first stream assembled from wire, library, scrapbook, and compass tiers. Wire content decays as the session deepens, shifting the mix from news toward books, memories, health, tasks, and personal media (`docs/reference/feed/feed-assembly-process.md`).

This is a compelling product thesis: **inbox, briefing, and discovery are different reading moods and should not be forced into one ranking model.**

---

## What is already excellent

- The three modes serve distinct intentions rather than presenting three skins on the same list.
- The tiered feed model has explicit diversity, spacing, freshness decay, source caps, isolated resumable sessions, explicit exhaustion, and per-user configuration.
- Persistent playback survives route changes through `FeedPlayerProvider`, `PersistentPlayer`, the mini bar, and player sheet.
- Scroll details are extensible typed sections rather than one large source-specific component.
- Scroll supports URL-addressable details, next/previous navigation, gallery transitions, image fallback, and cold deep links.
- Reader has adaptive grouping for dense and sparse feeds, optimistic read marking, group marking, filtering, and safe DOMPurify rendering.
- The frontend contains thoughtful performance work: lazy player loading, async image decoding, desktop `content-visibility`, masonry measurement, reduced-motion support, and detailed telemetry.
- The local mobile Reader successfully rendered 73 articles without horizontal body overflow and retained a useful single-line scan format.
- The local desktop Headlines surface rendered 20 sources in a consistent five-column matrix with clear source identity and perspective coloring.

These are meaningful assets. A remediation should preserve the three-mode thesis and the source/detail plugin model.

---

## Critical and high-impact findings

### F-01 — Mode changes discard the reader's place

**Severity:** High
**Evidence:** `FeedApp.jsx:159-167`; all Reader and Scroll session data is component-local state.

Navigating between Reader, a headline page, and Scroll unmounts the previous route. Reader loses loaded pages, filters, expanded articles, collapsed groups, and scroll position. Scroll loses its loaded feed and saved in-component scroll position. Only media playback persists above the outlet.

**User effect:** Checking Headlines while reading Reader is expensive; returning means rebuilding context. The top navigation promises quick switching but behaves like leaving the application.

**Required outcome:** Each mode retains a bounded session snapshot. Filter and selection identity belong in the URL; bulk content and scroll anchors can live in a route-level cache/store. Returning to a mode restores the prior anchor, not merely a pixel offset when possible.

### F-02 — Scroll navigation loses query identity and pollutes history

**Severity:** High
**Evidence:** `Scroll.jsx:488-536` constructs bare `/feed/scroll` paths.

Opening a card, closing detail, moving next/previous, or entering a gallery drops `?filter=` and `?debug=`. `handleBack()` navigates to a new list entry rather than traversing history, allowing browser Back to reopen the item the user just closed.

**Required outcome:** Build navigation from the current location, preserve supported query parameters, and use history traversal when the detail was opened in-app. Cold deep links need a deterministic list fallback.

### F-03 — Source refresh is an invalid nested control

**Severity:** High
**Evidence:** `SourcePanel.jsx:44-72` renders a `<button>` inside an `<a>`; refresh stops propagation but does not prevent default.

Clicking refresh can also open the publisher. The DOM is invalid and assistive technology receives conflicting interaction semantics.

**Required outcome:** Make the header a non-interactive container with separate source link and refresh button, or place the refresh control outside the link. Add an explicit accessible label containing the source name.

### F-04 — Accessibility does not meet a production reader baseline

**Severity:** High

Concrete failures include:

- Reader hamburger lacks `aria-label`, `aria-expanded`, and `aria-controls` (`Reader.jsx:313-316`).
- Category arrows, category labels, and group toggles are clickable spans without keyboard semantics (`ReaderSidebar.jsx:77-85`, `Reader.jsx:330-337`).
- Article toggles omit `aria-expanded` and `aria-controls` (`ArticleRow.jsx:63-84`).
- Reader drawer has no dialog/navigation semantics, focus trap, focus restoration, Escape close, or background inertness.
- Desktop detail modal has no `role="dialog"`, `aria-modal`, accessible title relationship, focus trap, or focus restoration (`DetailModal.jsx:4-41`).
- Modal scroll locking targets `document.body`, but the actual scroll container is `.feed-content` (`Scroll.jsx:480-486`).
- Headline previews are hover-only and unavailable to touch and keyboard users (`Headlines.scss:184-223`).
- Mini-player artwork/info and progress rails are clickable divs rather than buttons/sliders (`FeedPlayerMiniBar.jsx:52-68,107`).
- Several controls and metadata labels are approximately 9-11px.

**Required outcome:** WCAG 2.2 AA audit and remediation, including semantic controls, focus lifecycle, 44px touch targets where practical, accessible status announcements, contrast checks, and non-gesture alternatives for every swipe action.

### F-05 — List and page requests can race

**Severity:** High
**Evidence:** `Reader.jsx:170-194`, `Headlines.jsx:10-38`, `Scroll.jsx:196-268`.

Rapid feed-filter or headline-page changes can leave multiple requests in flight. A slower old request can overwrite the latest selection. Scroll detail correctly uses a monotonic generation guard; the list surfaces do not.

**Required outcome:** Abort obsolete requests and retain an identity/generation guard at commit time. Append calls also need an immediate in-flight ref lock rather than relying only on asynchronous React state.

### F-06 — Mutation failures are invisible and irreversible in the UI

**Severity:** High

- Reader marks items read optimistically but never rolls back on failure (`Reader.jsx:245-269`).
- Scroll removes/dismisses items optimistically but never restores them when the API fails (`Scroll.jsx:344-363,539-573`).
- The dismiss queue can be lost if the route unmounts within its 500ms debounce.
- Opening any wire detail automatically queues a dismissal, conflating “opened,” “read,” and “do not show again” (`Scroll.jsx:379-382`).

**Required outcome:** Define distinct domain actions (`read`, `archive/dismiss`, `save`), provide Undo, roll back or retry failures, flush durable queues on lifecycle boundaries, and display synchronization state unobtrusively.

### F-07 — Reader error handling unnecessarily destroys useful partial state

**Severity:** Medium-high
**Evidence:** `Reader.jsx:157-165,187-190,281`.

The feed-list request and article-stream request share one fatal `error`. If the sidebar fails but the stream succeeds, Reader returns only “Could not connect to FreshRSS.” There is no Retry and a later success does not explicitly clear the error.

**Required outcome:** Independent sidebar and inbox resource states, inline degraded-mode banners, Retry controls, and stale-content retention during refresh failures.

### F-08 — Headlines can display the wrong page after an error

**Severity:** Medium-high
**Evidence:** `Headlines.jsx:10-38` retains previous `data` while fetching a new `pageId`; errors are console-only.

A failed page switch can leave the prior page's sources beneath the newly active tab. There is no visible error or stale-data label.

**Required outcome:** Associate data with page identity, abort stale requests, preserve stale data only for the same page, and render a retryable error state.

---

## Usability and information architecture

### F-09 — Top navigation already overflows on mobile

**Severity:** Medium-high
**Evidence:** Local measurement at 390px: four links occupy approximately 405px; `FeedApp.scss:10-34` has no overflow policy.

Two configured headline pages are enough to exceed the viewport. More pages make the problem progressively worse.

**Required outcome:** Use a scalable navigation model: three primary modes with a secondary page selector for headline editions, or a horizontally scrollable tablist with visible overflow affordance and correct focus scrolling.

### F-10 — Backend filtering exists without a product UI

**Severity:** Medium-high
**Evidence:** `Scroll.jsx:144-145` declares an inert `focusSource`; `?filter=` is accepted but no normal UI sets it. Only the debug overlay exposes assembly filtering.

The ranking engine is configurable, but the reader cannot ask for “only Reddit,” “less news,” “more books,” or “why this item?” from the product surface.

**Required outcome:** Source/topic/tier chips, an edition mixer, “why shown,” mute/reduce/follow actions, and persistent preferences. All controls must produce shareable URL state where appropriate.

### F-11 — The three-mode model lacks continuity cues

**Severity:** Medium

There are no unread totals, new-item markers, saved counts, caught-up state, last-visited indicator, or per-mode resume affordance. Navigation communicates location but not status.

**Required outcome:** Make the modes part of one reading system: status badges, “new since last visit,” resume labels, consistent save/read state, and a unified global search.

### F-12 — “Open” and “dismiss” semantics are under-explained

**Severity:** Medium

Mobile wire cards are dismissed by an undiscoverable left swipe; desktop shows explicit dismiss controls. Non-wire cards cannot be dismissed. Opening wire detail auto-dismisses it. These policies are not communicated and have no Undo.

**Required outcome:** A visible overflow/action menu, an Undo snackbar, first-use gesture education only when necessary, and consistent terminology across Reader and Scroll.

---

## Formatting and visual design

### F-13 — Headlines is an outlet monitor, not yet a newspaper

**Severity:** High product gap

The desktop matrix is coherent, but every outlet and story receives equal weight. Titles are one-line ellipses, context is hidden in hover tooltips, and image selection never creates hierarchy. The local desktop render is excellent for comparing outlet agendas but poor for understanding the day's most important stories.

On mobile, each matrix cell becomes full-width. Twenty equally dense source panels form a very long stack with no summary or cross-source clustering.

**Required outcome:**

- Cluster matching coverage into stories while retaining source provenance.
- Establish lead, secondary, brief, and source-monitoring visual roles.
- Use selective imagery rather than hidden images for every tooltip.
- Add edition summary, section headers, story timestamps, and “covered by N sources.”
- Retain an explicit “outlet matrix” view for perspective comparison; do not make it the only Headlines presentation.

### F-14 — Reader density is excellent for scanning but too small for sustained use

**Severity:** Medium-high
**Evidence:** `Reader.scss` uses 0.55-0.88rem extensively; article rows have a 36px minimum height.

The local mobile render is clean, but timestamps, group controls, and tags are small, and the row height is tight for touch. Expanded articles inherit the same compact design rather than shifting into a deliberate reading mode.

**Required outcome:** Comfortable/compact density settings, 14-16px baseline interface text, larger touch targets, a readable article column, font-size/line-height controls, theme selection, and saved typography preferences.

### F-15 — Grid coordinate contract is ambiguous

**Severity:** Medium
**Evidence:** Documentation examples use rows/columns beginning at 1 (`feed-system-architecture.md:244-268`), while `Headlines.jsx:51-56` compares source coordinates against zero-based loop indexes rather than `rows[r]` and `cols[c]`.

The local configuration renders all 20 cells, so deployed data likely follows the implementation rather than the documentation.

**Required outcome:** Define one coordinate contract, validate it when loading configuration, compare against declared row/column values, and add a frontend layout test with non-sequential identifiers.

### F-16 — Styling is fragmented between SCSS and large inline objects

**Severity:** Medium
**Evidence:** `FeedCard.jsx`, detail sections, and player components contain substantial inline visual definitions.

This makes responsive behavior, focus styling, theme variants, and visual consistency harder to audit. Source-specific body modules can drift independently.

**Required outcome:** Introduce feed semantic tokens and shared primitives for source bars, metadata, cards, icon buttons, state banners, and reading typography. Keep data-derived geometry inline; move stable presentation to styles/components.

---

## Performance and resilience

### F-17 — Infinite lists grow the DOM without bound

**Severity:** High
**Evidence:** Reader appends every article (`Reader.jsx:184`); Scroll appends every unique card (`Scroll.jsx:230-241`). Reference baseline: approximately 1,838 DOM nodes at 50 items and a worst frame near 2.3 seconds (`feed-scroll-architecture.md:123-130`).

`content-visibility` saves desktop paint work but does not bound React elements, DOM memory, observer count, or reconciliation cost.

**Required outcome:** A bounded/windowed architecture that preserves variable-height scroll anchoring and detail return position. If full virtualization is too risky, retain a moving set of batches with spacer heights and durable item/anchor caches.

### F-18 — Masonry pays per-card observer and measurement costs

**Severity:** Medium-high
**Evidence:** `useMasonryLayout.js:24-65` creates a callback and `ResizeObserver` per item, logs measurements, and may re-run absolute placement as images/content change.

**Required outcome:** Prefer server-supplied media aspect ratios and bounded card templates; pool observation where possible; batch layout work; move verbose measurement logs behind explicit diagnostics; test 50/200/500-card cases.

### F-19 — Performance telemetry is always doing performance work

**Severity:** Medium-high
**Evidence:** `usePerfMonitor.js` runs a permanent rAF loop, long-task observer, scroll tracker, periodic percentile sorting, full-document node count, heap probe, and log transport every five seconds.

This is valuable during an investigation but should not be the default cost of every reading session.

**Required outcome:** Sample a small percentage of sessions, enable deep monitoring through `?debug=1` or a remote flag, aggregate with low-overhead browser observers, and ensure production info logs exclude per-card masonry events.

### F-20 — Headline tooltip content is instantiated eagerly

**Severity:** Medium-high
**Evidence:** Every headline renders tooltip DOM and optional image immediately (`SourcePanel.jsx:75-103`).

At 20 sources and typical per-source limits, this can create hundreds of hidden tooltip nodes and image candidates.

**Required outcome:** Render a single reusable preview popover only for the focused/hovered story; request or decode its image on demand; provide keyboard and touch activation.

### F-21 — Feed modes are eagerly bundled

**Severity:** Medium
**Evidence:** `FeedApp.jsx:6-13` statically imports Reader, Headlines, Scroll, player sheet, persistent player, and playback observation.

**Required outcome:** Route-level `lazy()`/`Suspense` boundaries for the three modes and heavier detail/card plugins. Preserve the lightweight player context in the shell and lazy-load actual media machinery only when active.

### F-22 — Some scroll telemetry reads the wrong scroll source

**Severity:** Medium
**Evidence:** The architecture correctly identifies `.feed-content` as the scrolling element, but `Scroll.jsx:277,331,335` logs `window.scrollY`.

**Required outcome:** Centralize the scroll-container contract in a ref/context and remove all window-scroll fallbacks where the Feed shell is present.

### F-23 — External font CSS is render-blocking and conflicts with offline ambitions

**Severity:** Low-medium
**Evidence:** `Headlines.scss:1` imports Google Fonts.

**Required outcome:** Self-host the chosen font or use the existing local font infrastructure, provide an intentional fallback metric strategy, and avoid mode-specific remote stylesheet fetches.

---

## Missing world-class reading capabilities

These are product gaps rather than defects:

1. **Unified search** across subscriptions, headline stories, saved items, and personal-feed content.
2. **Durable item states:** unread/read, saved/read-later, starred, archived/dismissed, and mark unread.
3. **Continue reading:** per-item progress, per-mode session checkpoints, cross-device synchronization.
4. **Reading controls:** width, font, size, line height, light/dark/sepia, estimated time, distraction-free view.
5. **Annotation:** highlights, notes, export, and links back to the exact source passage.
6. **Offline editions:** downloaded full text/media metadata and queued mutations with explicit sync state.
7. **Story clustering:** cross-outlet deduplication, provenance, chronology, updates, corrections, and alternate viewpoints.
8. **Transparent personalization:** “why shown,” source balance, topic controls, feedback, and reversible preference tuning.
9. **Healthy completion:** “caught up,” a daily edition, or a user-defined session boundary instead of unconditional cycling/duplication.
10. **Import/export and portability:** OPML, saved-item export, and transparent backup of annotations and state.

---

## Recommended delivery program

### Phase 0 — Trust and correctness

- Fix nested refresh/source controls.
- Preserve Scroll search parameters and repair Back behavior.
- Add request abortion/generation guards to Reader, Headlines, and Scroll list loading.
- Separate `read` from `dismiss`; add Undo and rollback/retry.
- Split resource errors and add retryable stale-content states.
- Add an app-level error boundary.

**Exit criteria:** No user action silently changes meaning, loses location, or fails without recovery.

### Phase 1 — Accessibility and continuity

- Implement semantic tab/page navigation with mobile overflow behavior.
- Make Reader drawer and detail/player overlays accessible dialogs/sheets with complete focus lifecycle.
- Replace clickable spans/divs with buttons, links, or sliders.
- Add Reader and Scroll state persistence plus URL-addressable filters.
- Raise typography and touch targets; add density settings.

**Exit criteria:** Keyboard-only and screen-reader flows can navigate modes, filter, open, read, save/dismiss, close, and resume. Returning to a mode restores the prior session.

### Phase 2 — Performance foundation

- Lazy-load modes and heavy plugins.
- Introduce bounded list retention/windowing.
- Replace per-headline tooltip trees with one on-demand popover.
- Gate detailed telemetry and reduce per-card logging.
- Establish image `srcset`/`sizes`, lazy loading, decode, and memory policies across all modules.

**Exit criteria:** A 500-item session stays within agreed DOM, heap, and interaction budgets with stable return-to-item behavior.

### Phase 3 — Complete the reading workflow

- Add unified item state, saved/read-later, mark unread, archive, and bulk operations.
- Add search and reader typography controls.
- Add session checkpoints and new-since-last-visit markers.
- Add offline edition and mutation synchronization.

**Exit criteria:** Reader can replace a conventional RSS application for daily use without losing state or requiring FreshRSS UI fallback.

### Phase 4 — Make the differentiation visible

- Build clustered Headlines alongside the outlet matrix.
- Expose the Scroll tier/source mixer and “why shown.”
- Add story provenance, coverage comparison, and update chronology.
- Add a deliberate completion experience and configurable session budget.

**Exit criteria:** The personal wire/library/scrapbook/compass model is understandable and controllable by the reader, not only by YAML and diagnostics.

---

## Performance budgets

Budgets should be measured on a representative phone and household display, not only a development laptop.

| Metric | Target |
|---|---|
| Initial mode JS after shell | <= 200KB compressed per selected mode, excluding shared framework |
| First useful Reader/Headlines content | <= 1.5s warm local network; <= 2.5s cold |
| Interaction latency | INP <= 200ms p75 |
| Scroll long tasks | No task >200ms during steady scrolling; <=1 task >50ms per appended batch |
| DOM after deep session | <= 1,000 live nodes attributable to list content |
| Batch append frame | No single frame >100ms on target phone |
| Layout shift | CLS <= 0.1, with aspect-ratio reservations for media |
| Memory | Stable plateau after window limit; no linear growth with session length |
| Background telemetry | <1% sampled sessions for deep monitoring; negligible unsampled overhead |

---

## Test plan and acceptance matrix

Existing live tests cover Reader happy paths, adaptive grouping, YouTube rendering, Scroll pagination, detail playback, mini-player behavior, and player-sheet controls. There are no focused frontend tests for `FeedApp`, Headlines layout, navigation continuity, failure recovery, or accessibility.

### Required automated coverage

| Area | Required cases |
|---|---|
| Shell/navigation | Dynamic page load/error, mobile overflow, mode state restore, query preservation, unknown routes |
| Reader concurrency | Rapid feed changes, stale response rejection, append lock, partial sidebar failure |
| Reader state | Read rollback, mark unread, group bulk action, filter URL round-trip, resume anchor |
| Headlines | Coordinate schema, page race, refresh failure, separate source link/refresh control, keyboard/touch preview |
| Scroll navigation | Filter-preserving open/close/next/prev, browser Back/Forward, expired deep link feedback |
| Scroll mutations | Undo dismiss, failed dismiss rollback, unmount queue flush, read-vs-dismiss distinction |
| Accessibility | axe scan plus manual keyboard focus-order/focus-return assertions for drawer/modal/sheet |
| Performance | 50/200/500 item DOM, heap plateau, append long-task budget, masonry overlap and anchor restoration |
| Reduced motion | No gesture/transition dependency; state changes remain perceivable |

### Manual acceptance journeys

1. Start Reader, select two feeds, open the 40th article, switch to Headlines, return, and continue at the same item with the same filter.
2. Open a filtered Scroll item, traverse next twice, close it, use browser Back/Forward, and verify the filter and list anchor never change unexpectedly.
3. Use every primary workflow with keyboard only at 390px and 1440px.
4. Simulate offline/failing requests while stale content exists; verify content remains readable and every failed mutation is recoverable.
5. Load ten Scroll batches on a target phone; verify DOM/memory plateau and return-to-detail accuracy.
6. Use Headlines on touch: inspect a story, compare sources, refresh one source, and open the publisher without hover.

---

## Recommended first implementation slice

The highest-leverage slice is deliberately small:

1. Introduce a `FeedModeStateProvider` or query/cache layer above `<Outlet>`.
2. Preserve location search in all Scroll navigation helpers and correct Back semantics.
3. Add an abortable request helper and apply it to Reader, Headlines, and Scroll list loads.
4. Refactor `SourcePanel` header interactions and create one accessible story-preview popover.
5. Implement accessible Reader drawer and DetailModal primitives.
6. Add an Undo transaction model for read/dismiss mutations.
7. Route-lazy the three top-level modes.
8. Add shell, Headlines, and navigation-continuity tests before further feature growth.

That slice addresses the largest trust, usability, accessibility, and startup problems without redesigning the feed assembly engine.

---

## Bottom line

The Feed should not add more source adapters yet. It should make the existing system feel like one durable reading environment. The content engine is already differentiated; world-class quality now depends on continuity, legibility, agency, accessibility, and bounded performance.
