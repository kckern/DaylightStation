# Lists Architecture

**Related code:** `backend/src/2_adapters/content/folder/FolderAdapter.mjs`

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        lists.yml                                 │
│  (data/households/{hid}/state/lists.yml)                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     FolderAdapter                                │
│  - Parses YAML items                                            │
│  - Resolves action types (Queue/List/Play/Open)                 │
│  - Loads watch state for progress                               │
│  - Applies nomusic overlay detection                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Content API Layer                             │
│  /api/v1/list/folder/{name}         → Menu items                │
│  /api/v1/list/folder/{name}/playable → Flattened queue          │
│  /api/v1/list/plex/{id}             → Plex content              │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌─────────────────────────┐     ┌─────────────────────────┐
│        TVApp            │     │       OfficeApp         │
│  - TVMenu component     │     │  - KeypadMenu component │
│  - Grid navigation      │     │  - Numpad navigation    │
│  - Remote-friendly      │     │  - Keyboard-friendly    │
└─────────────────────────┘     └─────────────────────────┘
              │                               │
              └───────────────┬───────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Player                                   │
│  - useQueueController expands queue references                  │
│  - Handles shuffle/continuous                                   │
│  - Applies shader/volume/playbackrate                           │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

### Menu Loading

1. App requests `/api/v1/list/folder/TVApp`
2. FolderAdapter loads lists.yml
3. Filters items by `folder: TVApp`
4. Transforms `action` field to output property (queue/list/play/open)
5. Includes shuffle/continuous in action object
6. Returns structured menu items

### Queue Expansion

1. Player receives `queue: { queue: "Music Queue" }`
2. useQueueController calls `/api/v1/list/folder/Music Queue/playable`
3. FolderAdapter recursively expands folder references
4. Filters to playable items only (no submenus/apps)
5. Returns flat array for playback

### Action Type Resolution

```
YAML action field → Output property → Frontend handler

Queue            → queue: {...}    → Player (shuffle/continuous)
List             → list: {...}     → PlexMenuRouter or TVMenu
Play (default)   → play: {...}     → Player (direct)
Open             → open: {...}     → AppContainer
```

### Display vs Playback Filtering

FolderAdapter separates concerns between showing menus and building playback queues:

**`getList()`** - For menu/UI display
- Returns ALL items (only filters `active: false`)
- Enriches items with watch state for UI indicators (progress %, "watched" badges)
- Use case: Show "Felix" in FHE menu even if his assigned video was watched

**`resolvePlayables()`** - For automated playback queues
- Filters out: watched (>90%), on hold, past skip_after, wait_until >2 days
- Use case: Skip already-watched videos when building a playlist

```
Filter              │ getList (display) │ resolvePlayables (playback)
────────────────────┼───────────────────┼────────────────────────────
active: false       │ Hide              │ Skip
Watched >90%        │ Show              │ Skip
watched: true       │ Show              │ Skip
hold: true          │ Show              │ Skip
skip_after passed   │ Show              │ Skip
wait_until >2 days  │ Show              │ Skip
```

This design supports use cases like classroom assignments where the label represents a person (student) and the media represents their assigned content. The menu must show all assignments regardless of watch status.

## Integration Points

| Component | Consumes | Produces |
|-----------|----------|----------|
| FolderAdapter | lists.yml, watch state | Menu items with actions |
| TVMenu | Menu items | User selection events |
| KeypadMenu | Menu items | User selection events |
| MenuStack | Selection events | View routing |
| PlexMenuRouter | Plex IDs | Show/Season views |
| useQueueController | Queue references | Expanded playback queue |
