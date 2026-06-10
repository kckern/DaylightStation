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
- The scope selector lives **in the search bar** — a native select where a
  parent with children renders as a group (with an "All {label}" option when
  the parent itself carries `params`) and leaves render as plain options.
- Selecting any scope (parent-with-params or leaf) applies its `params` to
  every subsequent search request.
- The last-used scope persists per browser and is restored on the next visit
  (validated against the current scope tree; a vanished key falls back to the
  default).
- If the scope config fails to load, search still works catalog-wide; the
  search bar shows a small error indicator next to the selector.

### Persistence (localStorage)

| Key | Value |
|-----|-------|
| `media-scope-last` | Key of the last-used scope. |

## Code Pointers

- Scope loading & state: `frontend/src/modules/Media/search/SearchProvider.jsx`
- Scope selector UI: `frontend/src/modules/Media/search/SearchBar.jsx`
- Search endpoint: `GET /api/v1/content/query/search/stream` (see
  [`media-app-technical.md` §2.2](./media-app-technical.md))
