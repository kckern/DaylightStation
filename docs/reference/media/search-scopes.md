# Media Search Scopes

## Overview

The ContentBrowser uses a config-driven scope dropdown to filter search results by content type and source. Scopes are defined in `data/household/config/media.yml` under `searchScopes` and served via `GET /api/v1/media/config`.

## Config Structure

```yaml
searchScopes:
  - label: Movies          # Display name in dropdown
    key: video-movies      # Unique key (used for localStorage persistence)
    params: "source=plex&plex.libraryId=6,12"  # Query params appended to search
    children:              # Optional sub-items (two-level hierarchy)
      - label: ...
        key: ...
        params: ...
```

### Hierarchy

- **Top-level scopes** (All, Video, Music, Books) appear as group headers or standalone items
- **Children** appear indented under their parent
- Parents with `children` can also have their own `params` for searching the whole category

### Params

The `params` string is appended directly to the SSE search endpoint URL. Valid params:

| Param | Description | Example |
|-------|-------------|---------|
| `source` | Content source adapter name | `plex`, `immich`, `abs`, `singalong`, `youtube` |
| `mediaType` | Media type filter | `video`, `audio`, `image` |
| `capability` | Content capability | `playable`, `displayable`, `readable` |
| `take` | Max results | `50` |
| `plex.libraryId` | Plex library section ID(s), comma-separated | `6,12` |

## Plex Library IDs

The `plex.libraryId` adapter-specific parameter filters Plex hub search to specific library sections. Multiple IDs can be comma-separated — each runs a separate hub search and results are merged.

To discover library IDs:

```bash
curl -s "http://localhost:{port}/api/v1/proxy/plex/library/sections" | \
  grep -oP 'key="\K[^"]+|title="\K[^"]+' | paste - -
```

### Capability Note

Plex hub search returns unhydrated items (containers like shows, or movies without streaming URLs). These items lack `mediaUrl`, so `capability=playable` will filter them out. For Plex scopes, omit `capability=playable` and rely on `source` + `plex.libraryId` filtering instead.

## Frontend Surface

The Media App's search scope UI is intentionally minimal (rebuilt in the P1–P7
overhaul). There is **no** `ScopeDropdown`, `ScopeChips`, or `useScopePrefs` — earlier
revisions of this doc described components that were never shipped in the current app.

| Piece | File | Purpose |
|-------|------|---------|
| `SearchProvider` | `frontend/src/modules/Media/search/SearchProvider.jsx` | Loads `searchScopes` from `/api/v1/media/config`, flattens parent + children, tracks `currentScopeKey`, persists last scope, exposes `scopeError` on config-load failure |
| Scope `<select>` | `frontend/src/modules/Media/search/SearchBar.jsx` | Native `<select>`; parents with `children` render as an `<optgroup>` (with an optional "All {label}" option when the parent itself has `params`); leaf scopes render as plain `<option>` |

Selecting any option (parent-with-params or a child leaf) sets `currentScopeKey`; the
resolved scope's `params` string is forwarded to the SSE search endpoint. A child key
resolves correctly because `SearchProvider` searches the flattened scope tree, not just
the top level.

If the config fetch fails, `SearchProvider` sets `scopeError` and `SearchBar` renders a
small ⚠ indicator (testid `scope-error`) next to the dropdown.

## Persistence (localStorage)

| Key | Value |
|-----|-------|
| `media-scope-last` (`SCOPE_KEY_LAST`) | Key of the last-used scope (validated against the flattened scope tree, restored on mount) |

> Favorites, recents, and result-count re-scoping chips are **not currently implemented**
> (the `media-scope-recents` / `media-scope-favorites` keys and the chip/source-badge
> re-scoping flows were removed in the P1–P7 rebuild). Only `media-scope-last` persists.
