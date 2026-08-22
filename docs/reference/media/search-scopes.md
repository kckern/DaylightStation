# Media Search Scopes

## Purpose

Search in the Media App is catalog-wide by default, but a user can narrow it
to a **scope** — a named slice of the catalog ("Movies", "Music", "Books") —
directly from the search affordance. Scopes are household configuration, not
code: adding or reshaping them is a config edit.

Scopes are defined in `data/household/apps/media/config.yml` under
`searchScopes` and served via `GET /api/v1/media/config`.

## Config Structure

```yaml
searchScopes:
  - label: Movies          # Display name in the scope selector
    key: video-movies      # Unique key (used for persistence)
    params: "source=plex&plex.libraryId=6,12"  # Query params appended to search
    children:              # Optional sub-items (two-level hierarchy)
      - label: ...
        key: ...
        params: ...
```

### Hierarchy

- **Top-level scopes** (All, Video, Music, Books) appear as group headers or
  standalone items.
- **Children** appear nested under their parent.
- A parent with `children` may also carry its own `params`, making the whole
  category searchable ("All Video") in addition to its leaves.

### Params

The `params` string is appended directly to the streaming search endpoint URL
(`GET /api/v1/content/query/search/stream`). Valid params:

| Param | Description | Example |
|-------|-------------|---------|
| `source` | Content source adapter name | `plex`, `immich`, `abs`, `singalong`, `youtube` |
| `mediaType` | Media type filter | `video`, `audio`, `image` |
| `capability` | Content capability | `playable`, `displayable`, `readable` |
| `take` | Max results | `50` |
| `plex.libraryId` | Plex library section ID(s), comma-separated | `6,12` |

## Plex Library IDs

The `plex.libraryId` adapter-specific parameter filters Plex hub search to
specific library sections. Multiple IDs can be comma-separated — each runs a
separate hub search and results are merged.

To discover library IDs:

```bash
curl -s "http://localhost:{port}/api/v1/proxy/plex/library/sections" | \
  grep -oP 'key="\K[^"]+|title="\K[^"]+' | paste - -
```

### Capability Note

Plex hub search returns unhydrated items (containers like shows, or movies
without streaming URLs). These items lack `mediaUrl`, so `capability=playable`
filters them out. For Plex scopes, omit `capability=playable` and rely on
`source` + `plex.libraryId` filtering instead.

## App Behavior

- On load, the app fetches the scope config, flattens parents and children
  into one lookup tree, and tracks a single current scope key.
- The scope selector lives **in the search bar** as tappable chips
  (`ScopeChips.jsx`): top-level scopes render as a chip row, and tapping a
  parent with children expands a second row of its children inline. A parent
  chip is itself selectable (in addition to expanding) only when it carries
  its own `params`; a grouping-only parent just reveals its children.
- Selecting any scope (parent-with-params or leaf) applies its `params` to
  every subsequent search request.
- Scope is **session-only**: every provider mount starts catalog-wide, at the
  first scope in the config (`all`). Nothing is persisted to localStorage, so
  a scope chosen earlier — in this tab or a previous one — never silently
  narrows a later search. `resetScope()` returns to that same catalog-wide
  default on demand (e.g. every time the mobile search surface opens).
- If the scope config fails to load, search still works catalog-wide; the
  search bar shows a small error indicator next to the selector.

### Persistence (localStorage)

Scope selection is not persisted. There is no localStorage key for it —
the legacy `media-scope-last` key has been retired and, if present from an
older session, is ignored.

## Code Pointers

- Scope loading & state: `frontend/src/modules/Media/search/SearchProvider.jsx`
- Scope selector UI: `frontend/src/modules/Media/search/ScopeChips.jsx`, mounted
  from `frontend/src/modules/Media/search/MediaContentSearch.jsx`
- Search endpoint: `GET /api/v1/content/query/search/stream` (see
  [`media-app-technical.md` §2.2](./media-app-technical.md))
