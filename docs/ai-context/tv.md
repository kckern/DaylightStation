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
    ├── 14_fitness.yml    # Library ID 14 = "Fitness"
    ├── 1_movies.yml      # Library ID 1 = "Movies"
    ├── 2_tv.yml          # Library ID 2 = "TV Shows"
    ├── _archive/         # Migrated legacy files
    └── _logs/            # Daily validator work logs
```

**Entry Format (YAML):**
```yaml
"673634":                           # Plex ID (ratingKey) as key
  title: "Morning Flow"             # Episode/movie title only
  parent: "30 Days of Yoga"         # Season/Album name
  parentId: 67890                   # Season/Album ratingKey
  grandparent: "Yoga With Adriene"  # Show/Artist name
  grandparentId: 12345              # Show/Artist ratingKey
  libraryId: 14                     # Library section ID
  mediaType: "episode"              # episode | movie | track
  lastPlayed: "2025-01-15T10:30:00Z"
  playCount: 3
  progress: 1800                    # Seconds watched
  duration: 3600                    # Total duration
  oldPlexIds: [606037, 11570]       # Only present if backfilled
```

**Key Files:**
- `backend/lib/mediaMemory.mjs` - Path utilities, filename helpers
- `backend/lib/mediaMemoryValidator.mjs` - Daily cron validator
- `backend/lib/plex.mjs` - Plex API client
- `scripts/migrate-media-memory.mjs` - One-time migration script

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
