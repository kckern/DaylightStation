# TV Context

## Purpose

Media browsing and playback interface. Integrates with Plex for library access, manages playlists/stories, and provides TV-optimized navigation.

## Key Concepts

| Term | Definition |
|------|------------|
| **Plex** | Media server providing library, metadata, streaming |
| **Story** | Curated playlist/sequence of media items |
| **Season View** | Episode grid for TV series |
| **Menu** | Hierarchical navigation system |

## Exports

| Export | Location | Used By |
|--------|----------|---------|
| Menu module | `modules/Menu/` | TVApp, other apps |

## Imports

| Import | From | Purpose |
|--------|------|---------|
| Player | foundations | Video playback |
| ContentScroller | foundations | Content browsing |
| Plex lib | backend | Media library access |

## File Locations

### Frontend
- `frontend/src/Apps/TVApp.jsx` - Main TV interface (~5KB)
- `frontend/src/modules/Menu/` - Navigation menus
- `frontend/src/modules/Player/` - Media playback

### Backend
- `backend/routers/media.mjs` - Media API (~39KB)
- `backend/routers/plexProxy.mjs` - Plex stream proxy
- `backend/lib/plex.mjs` - Plex API integration (~36KB)
- `backend/story/` - Story/playlist management

### Config
- `data/households/{hid}/apps/tv/config.yml`

## Plex Integration

**Backend:** `lib/plex.mjs`

**Key Operations:**
- Library browsing (movies, shows, music)
- Metadata retrieval
- Stream URL generation
- Watch status tracking

**Pattern:**
```javascript
import { Plex } from './lib/plex.mjs';

const libraries = await Plex.getLibraries();
const items = await Plex.getLibraryItems(libraryId);
const streamUrl = Plex.getStreamUrl(itemKey);
```

### Plex ID Lifecycle

**IMPORTANT:** Plex IDs (`ratingKey`) are NOT stable. They change when:
- Plex library is rebuilt/rescanned
- Media files are moved/renamed
- Server database is reset

This means stored Plex IDs in media_memory can become orphaned.

**Backfill pattern:** When IDs break:
1. Use `cli/plex.cli.mjs verify <id>` to check if ID exists
2. Use `cli/plex.cli.mjs search "<title>" --deep` to find new ID
3. Run `scripts/backfill-plex-ids.mjs` to auto-match orphans

## Media Memory

**Location:** `data/households/{hid}/history/media_memory/plex/`

**Purpose:** Tracks watch history, progress, play counts per Plex library.

**Directory Structure:**
```
media_memory/
└── plex/
    ├── fitness.yml      # Fitness video library history
    ├── movies.yml       # Movie library history
    ├── tv.yml           # TV shows history
    └── music.yml        # Music library history
```

**Entry Format (YAML):**
```yaml
"673634":                    # Plex ID (ratingKey) as key
  title: "Episode Title (Show Name - Season)"
  media_key: "673634"        # Same as key
  last_played: "2025-01-15T10:30:00Z"
  play_count: 3
  progress: 1800             # Seconds watched
  duration: 3600             # Total duration
```

**Key Files:**
- `backend/lib/mediaMemory.mjs` - Path utilities (`getMediaMemoryDir()`, `getMediaMemoryPath()`)
- `backend/lib/plex.mjs` - Plex API client (uses media memory for history)

## Menu Navigation

**Location:** `modules/Menu/`

**Features:**
- Keyboard navigation (arrow keys, enter, back)
- Nested menu support
- Selection persistence
- Focus management

**Related Docs:**
- `docs/design/tv-menu-navigation-refactor.md`
- `docs/bugs/nested-menu-keyboard-handler.md`

## Common Tasks

- **Add media source:** Update Plex library config, verify lib/plex.mjs connection
- **Debug playback:** Check Player component, verify stream URL, check plexProxy
- **Menu navigation issues:** Check Menu module keyboard handlers
- **Story/playlist:** Work in `backend/story/` directory
