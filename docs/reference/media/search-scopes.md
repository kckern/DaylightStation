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

## Frontend Components

| Component | File | Purpose |
|-----------|------|---------|
| `ScopeDropdown` | `frontend/src/modules/Media/ScopeDropdown.jsx` | Two-level dropdown with favorites and recents |
| `ScopeChips` | `frontend/src/modules/Media/ScopeChips.jsx` | Result-count chips for re-scoping from results |
| `useScopePrefs` | `frontend/src/hooks/media/useScopePrefs.js` | localStorage persistence (last scope, recents, favorites) |

## Persistence (localStorage)

| Key | Value |
|-----|-------|
| `media-scope-last` | Key of last-used scope (restored on mount) |
| `media-scope-recents` | Array of last 5 scope keys that produced results |
| `media-scope-favorites` | Array of starred scope keys |

Recents are only recorded when a search with that scope actually produces results (not on selection alone).

## Re-scoping from Results

- **Scope chips**: When search results arrive under a broad scope (All or parent), chips appear above results showing counts per leaf scope (e.g., `Movies (12) | TV Shows (5)`). Clicking narrows the scope.
- **Source badges**: Each result displays its source as a clickable badge. Clicking finds the narrowest matching scope and re-scopes to it.
