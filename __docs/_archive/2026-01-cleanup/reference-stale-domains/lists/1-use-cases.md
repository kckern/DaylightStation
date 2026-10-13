# Lists Use Cases

**Related code:** `frontend/src/Apps/TVApp.jsx`, `frontend/src/Apps/OfficeApp.jsx`

## Problem Statement

DaylightStation needs a unified way to:
1. Define menu items for TV and Office displays
2. Reference content from multiple sources (Plex, local media, scripture, apps)
3. Support scheduling (day-of-week restrictions)
4. Enable queue-based playback with shuffle/continuous options
5. Organize content into navigable folder hierarchies

## Primary Users

- **Family members** - Navigate TV menus with remote
- **Office user** - Control office display via numpad
- **System** - Automated morning/evening program playback

## UX Flows

### TV Menu Navigation

1. User opens TVApp
2. System loads items from `folder: TVApp`
3. User navigates grid with arrow keys
4. Selecting `List` item → opens submenu or show view
5. Selecting `Queue` item → starts shuffled playback
6. Selecting `Play` item → direct playback

### Queue Expansion

1. User selects "Music" (queue item)
2. System fetches `/api/v1/list/folder/Music Queue/playable`
3. All items in Music Queue folder are flattened
4. Player starts with shuffle enabled

### Scheduled Content

1. Morning Program item has `days: Weekdays`
2. System triggers playback at scheduled time
3. Items filtered by current day
4. Queue plays through Morning Program folder
