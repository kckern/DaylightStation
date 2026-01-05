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
