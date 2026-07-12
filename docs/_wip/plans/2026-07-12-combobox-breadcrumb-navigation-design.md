# Combobox Breadcrumb Navigation — Design

**Status:** Designed (brainstormed 2026-07-11/12), ready for implementation plan.
**Branch:** `feature/combobox-breadcrumb-navigation` (off `fix/combobox-scroll-to-selected-on-open`).

## Problem

When the content picker is opened directly on a deep leaf item (e.g. an episode `plex:642197` = *Elijah the Prophet*, S8 E33), the browse view lands inside its immediate parent (Season 8) with breadcrumbs `[Season 8]`. Pressing the back (←) arrow there calls `goUp`, which hits the `breadcrumbs.length <= 1` guard and dispatches `CLOSE` — so **back behaves exactly like Escape**. There is no way to climb out of Season 8 to browse other seasons, or up to the show's siblings.

`goUp` already climbs correctly when `breadcrumbs.length > 1` (drill-down history). The gap is purely that opening deep never discovers the ancestors *above* the immediate parent, so the stack has only one entry.

## Goal

Let the user climb up the content tree from wherever they open, with a clean, clickable breadcrumb trail, bounded so it never dumps them into an enormous listing.

## Decisions (from brainstorming)

1. **Climb granularity:** back (←) goes up exactly **one container level per press**.
2. **Cap:** climbing stops at the **show's siblings** level. The show's parent is its **smallest containing collection** if it is in one (→ other shows in that collection), otherwise the library listing. Pressing back at the cap dismisses (current behavior).
3. **Breadcrumb trail:** shows the **full ancestor chain** of the current level, root-first (e.g. `Collection › Show › Season 8`). Each crumb is **clickable** — clicking jumps to that level (lists its children, highlights the child you came from) and truncates the trail there. The ← arrow steps up exactly one level.
4. **Trail source — eager:** the siblings API returns the full ancestor chain in one response, so the complete clickable trail is present immediately on open (no per-level round-trips to reveal it).
5. **Crumb hygiene (hard requirement):** the rendered trail must have **no duplicate crumbs** (dedupe by id), **no ghost crumbs** (drop entries missing id or title), and **no junk crumbs** (no synthetic "Library" placeholder when a real collection is the parent — the collection is the top crumb).

## Architecture

### Backend — ancestor chain in the siblings response

`SiblingsResult` gains an optional `ancestors: Crumb[]` field: the chain from the **immediate parent down-to-up capped at the show's-siblings container**, ordered **root-first** (cap … immediate parent). For an episode: `[collection?, show, season]`. Each `Crumb` = `{ id, title, source, localId, type }`.

- **`PlexAdapter.resolveSiblings(compoundId)`** builds `ancestors` from Plex metadata already in hand:
  - episode → `parentRatingKey` (season), `grandparentRatingKey` (show); season → `parentRatingKey` (show); show → smallest collection via the existing `_findSmallestCollection(showKey, libraryId)` (already used for the parent fallback), else library.
  - Walk stops at the collection/library (the cap). Missing links are skipped (hygiene).
- **`SiblingsService.resolveSiblings`** passes `ancestors` through in the normalized DTO (alongside the existing `parent`, `items`, `referenceIndex`, `pagination`).
- **`ISiblingsService` typedef** documents the new field.
- Adapters that cannot produce a chain simply omit `ancestors` (→ frontend falls back to the single-parent crumb; no regression).

### Frontend — trail state, click navigation, hygiene

- **`applyBrowseData` (`useContentCombobox.js`)**: when `data.ancestors` is present, build `breadcrumbs` from the full chain (mapped via a hardened `parentToCrumb`), instead of the single `[parentToCrumb(currentParent)]`. Run the chain through a pure **`sanitizeBreadcrumbs(crumbs)`** helper (dedupe-by-id, drop id/title-less, collapse the junk library crumb). With the full chain populated, the existing `goUp` climbs via its `length > 1` path automatically; the `<= 1` (dismiss) guard now only fires at the cap — which is correct.
- **`sanitizeBreadcrumbs`** lives in a pure module (mirroring `comboboxScroll.js`) with its own unit tests.
- **`goToCrumb(index)` (new hook action)**: lists the crumb-at-index's children (`/api/v1/list/{source}/{localId}`), truncates `breadcrumbs` to `0..index`, highlights the child you came from (`referenceIndex` = index of the next crumb down, else 0). Reuses the `WENT_UP` machine transition (rename/extend to a generic `WENT_TO_LEVEL` carrying the truncated breadcrumbs + referenceIndex).
- **Breadcrumb render (`ContentCombobox.jsx`)**: replace the static `breadcrumbs.map(b => b.title).join(' / ')` text with clickable crumb buttons (last crumb = current, non-interactive/emphasized). `onMouseDown` preventDefault (same blur-guard pattern as the existing back/clear buttons); `onClick` → `goToCrumb(idx)`.
- **Scroll-to-selected reuse:** each level change (climb or crumb jump) sets a `referenceIndex`, so the existing `shouldPositionLevel` positioner (from the scroll fix) brings the reference row into view — no new scroll logic.

## Testing

- **Backend unit:** `PlexAdapter.resolveSiblings` returns the correct capped, root-first `ancestors` for an episode (with a collection and without), a season, and a top-level show; `SiblingsService` passes it through. Fixture-driven, no live Plex.
- **Frontend unit:** `sanitizeBreadcrumbs` — dedupe, drop ghosts, collapse junk library crumb, preserve order.
- **Machine unit:** `WENT_TO_LEVEL` truncates breadcrumbs and sets highlight.
- **Component test:** clicking a crumb calls `goToCrumb`; last crumb is not a button.
- **Live (`.runtime.test.mjs`):** open on row 6 (Elijah, S8 E33) → trail shows `… › Show › Season 8`; ← lists seasons with Season 8 highlighted; ← again lists the show's siblings with the show highlighted; ← at the cap dismisses; clicking an ancestor crumb jumps to that level. Assert no duplicate/empty crumb text.

## Non-goals (YAGNI)

- Climbing above the show's-siblings cap (no library-root browsing).
- Persisting/restoring trail across opens.
- Trail for non-Plex sources beyond the single-parent fallback (adapters opt in by returning `ancestors`).
