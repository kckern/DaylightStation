# Search Scope Dropdown — Design

**Date:** 2026-03-04
**Status:** Approved

## Problem

The ContentBrowser's flat filter buttons (All | Music | Video | Hymns) are too coarse — a "star wars" search returns 250 Immich photos when the user wanted movies. No way to narrow scope without re-typing. Buttons waste vertical space and don't scale to more content types.

## Solution

Replace filter chip buttons with a **scope dropdown** attached to the left of the search input. Config-driven, two-level hierarchy, localStorage persistence, and result-based re-scoping.

## 1. Scope Registry (Backend Config)

New `searchScopes` section in `data/household/config/media.yml`:

```yaml
searchScopes:
  - label: All
    key: all
    params: "capability=playable&take=25"
  - label: Video
    key: video
    icon: video
    children:
      - label: Movies
        key: video-movies
        params: "capability=playable&source=plex&mediaType=video&libraryType=movie"
      - label: TV Shows
        key: video-tv
        params: "capability=playable&source=plex&mediaType=video&libraryType=show"
      - label: Home Video
        key: video-home
        params: "capability=playable&source=immich&mediaType=video"
      - label: YouTube
        key: video-youtube
        params: "capability=playable&source=youtube&mediaType=video"
  - label: Music
    key: music
    icon: music
    children:
      - label: Albums
        key: music-albums
        params: "capability=playable&source=plex&mediaType=audio"
      - label: Playlists
        key: music-playlists
        params: "capability=playable&source=plex&mediaType=audio&libraryType=playlist"
      - label: Hymns
        key: music-hymns
        params: "capability=playable&source=singalong"
  - label: Books
    key: books
    icon: book
    children:
      - label: Audiobooks
        key: books-audio
        params: "capability=playable&source=abs"
      - label: Comics
        key: books-comics
        params: "capability=readable&source=komga"
```

- Each scope has a unique `key` for localStorage references
- Parent scopes (Video, Music, Books) are selectable — search across all children's sources
- Parents without explicit `params` derive params from union of children's sources
- Served via existing `/api/v1/media/config` endpoint (add `searchScopes` to response)

## 2. ScopeDropdown Component

New component: `frontend/src/modules/Media/ScopeDropdown.jsx`

**Collapsed state:** Compact button showing selected scope's leaf label (e.g., "Movies") with a chevron. Sits to the left of the search input in a flex row.

**Expanded state:** Two-level grouped dropdown menu:
- "All" at top
- Parent labels as section headers (non-selectable section dividers OR selectable to search all children)
- Children as selectable items
- Divider line
- "Favorites" section (starred scopes)
- "Recent" section (last 3-5 used scopes)

**Star toggle:** Each item has a small star icon to toggle favorite status.

**Dismissal:** Clicking outside, pressing Escape, or selecting an item closes the dropdown.

## 3. Result Scope Chips

When search results return, compute scope counts client-side by matching each result's `source` + `mediaType` against the scope registry.

Display as clickable chips above results:
```
Movies (12) | TV Shows (5) | Home Video (3)
```

Only show chips for scopes with > 0 results and only when the current scope is broader than needed (i.e., "All" or a parent scope).

Clicking a chip:
1. Sets the dropdown to that scope
2. Re-executes search with the narrower params

## 4. Source Badges (Clickable)

Existing `source-badge` elements on each result become clickable. Clicking a badge:
1. Finds the narrowest scope matching that source
2. Sets the dropdown to that scope
3. Re-executes search

## 5. Persistence (localStorage)

Three localStorage keys:
- `media-scope-last` — key of last-used scope (restored on mount, default: "all")
- `media-scope-recents` — array of last 5 unique scope keys
- `media-scope-favorites` — array of starred scope keys

## 6. Removals

- Delete the `content-browser-filters` div (All/Music/Video/Hymns chip bar)
- Remove `filters` useMemo, `activeFilter` state, filter click handlers
- `searchFilter` property on browse config entries becomes unused (can remain for backwards compat)

## 7. Search Flow

Current: `search(text)` with `filterParams` from active filter chip index.
New: `search(text)` with `params` string from selected scope object.

The `useStreamingSearch` hook's extra query parameter already supports this — the scope's `params` string feeds directly into it. No hook changes needed.

## 8. Layout

```
┌──────────────────────────────────────────┐
│ [Movies ▾] [Search media...            ] │  ← header row
├──────────────────────────────────────────┤
│ Movies (12) | TV (5) | Home Video (3)    │  ← scope chips (contextual)
├──────────────────────────────────────────┤
│ result 1  [plex] 2h13m video  ▶ ⤵ +     │
│ result 2  [plex] 1h45m video  ▶ ⤵ +     │
│ ...                                      │
└──────────────────────────────────────────┘
```

Dropdown expanded:
```
┌─────────────┐
│ ✦ All       │
│─────────────│
│ VIDEO       │
│  Movies   ☆ │
│  TV Shows ☆ │
│  Home Vid ☆ │
│  YouTube  ☆ │
│ MUSIC       │
│  Albums   ☆ │
│  Playlists☆ │
│  Hymns    ★ │
│ BOOKS       │
│  Audiobook☆ │
│  Comics   ☆ │
│─────────────│
│ RECENT      │
│  Movies     │
│  Albums     │
│─────────────│
│ FAVORITES   │
│  Hymns      │
└─────────────┘
```
