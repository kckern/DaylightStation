# Lists Data Model

**Related code:** `backend/src/2_adapters/content/folder/FolderAdapter.mjs`, `backend/_legacy/jobs/nav.mjs`

## Overview

`lists.yml` defines menu items for TV and Office apps. Items are organized into folders and can reference Plex content, local media, apps, or other folders. The file lives at `data/households/{hid}/state/lists.yml`.

## Item Schema

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `uid` | string | Unique identifier (UUID) |
| `folder` | string | Parent folder name (e.g., `TVApp`, `FHE`) |
| `label` | string | Display name shown in menu |
| `input` | string | Content source specification (see Input Sources) |

### Action Field

The `action` field determines which output property the item uses and how the frontend handles selection:

| YAML Value | Output Property | Frontend Behavior |
|------------|-----------------|-------------------|
| `Queue` | `queue: {...}` | Player with shuffle/continuous support |
| `List` | `list: {...}` | Opens submenu or show/season view |
| `Play` | `play: {...}` | Direct playback (default if omitted) |
| `Open` | `open: {...}` | Launches an app |

**Examples:**
```yaml
# Queue action - shuffled playlist
- label: Sunday
  action: Queue
  input: 'plex: 642120'
  shuffle: true

# List action - opens season picker
- label: Chosen
  action: List
  input: 'plex: 408886'

# Play action (default) - direct playback
- label: General Conference
  input: 'talk: ldsgc202510'

# Open action - launches app
- label: Wrap Up
  action: Open
  input: 'app: wrapup'
```

## Input Sources

The `input` field specifies content source using `source: value` syntax:

| Source | Format | Description | Example |
|--------|--------|-------------|---------|
| `plex` | `plex: {id}` | Plex library item (show, movie, playlist) | `plex: 408886` |
| `scripture` | `scripture: {ref}` | Scripture content | `scripture: nt`, `scripture: bom` |
| `talk` | `talk: {id}` | General Conference talks | `talk: ldsgc202510` |
| `hymn` | `hymn: {number}` | Hymn by number | `hymn: 1004` |
| `primary` | `primary: {id}` | Primary songs | `primary: 2` |
| `media` | `media: {path}` | Local filesystem media | `media: news/cnn` |
| `poem` | `poem: {id}` | Poetry content | `poem: remedy` |
| `list` | `list: {folder}` | Reference to another folder (submenu) | `list: FHE` |
| `queue` | `queue: {name}` | Reference to a named queue | `queue: Music Queue` |
| `app` | `app: {name}` | App launcher | `app: wrapup` |

### Input Modifiers

Additional parameters can be appended with semicolons:

| Modifier | Format | Description |
|----------|--------|-------------|
| `overlay` | `overlay: {plex_id}` | Music overlay playlist for nomusic videos |
| `version` | `version: {name}` | Scripture version (nrsv, kjv, etc.) |

**Examples:**
```yaml
# Plex with music overlay
input: 'plex: 663035; overlay: 461309'

# Scripture with version
input: 'scripture: gen 1; version nrsv'

# Media with pipe-separated alternatives
input: 'media: news/world_az|news/cnn'
```

### Folder Reference Syntax

Special syntax for referencing folders as queues (no colon):

```yaml
# Expands Morning Program folder into a queue
input: morning+program
action: Queue
```

## Playback Options

These fields control playback behavior and are included in the action object:

| Field | Type | Aliases | Description |
|-------|------|---------|-------------|
| `shuffle` | boolean | - | Randomize playback order |
| `continuous` | boolean | `loop` | Auto-advance to next item |
| `playbackrate` | number | `playbackRate`, `rate` | Speed multiplier (0.5-2.0) |
| `volume` | number | - | Volume level (0-100) |

**Example:**
```yaml
- label: Sunday
  action: Queue
  input: 'plex: 642120'
  shuffle: true
  continuous: true
  playbackrate: 1.5
  volume: 80
```

## Visual Options

| Field | Values | Aliases | Description |
|-------|--------|---------|-------------|
| `shader` | `default`, `focused`, `night`, `blackout` | `dark`→`blackout`, `minimal`→`focused`, `regular`→`default`, `screensaver`→`focused` | Visual overlay mode for player |

## List Behavior Options

| Field | Type | Description |
|-------|------|-------------|
| `playable` | boolean | When true, flattens list to only playable items (excludes submenus, apps). Used for multi-dimensional lists. |
| `first` | boolean | Marks item as first in sequence |

## Scheduling Options

| Field | Type | Description |
|-------|------|-------------|
| `days` | string | Day restrictions for when item appears |
| `active` | boolean | Enable/disable item without removing |

### Days Values

| Value | Description |
|-------|-------------|
| `Weekdays` | Monday-Friday |
| `Weekend` | Saturday-Sunday |
| `Sunday` | Sunday only |
| `Saturday` | Saturday only |
| `M•W•F` | Monday, Wednesday, Friday |
| `T•Th` | Tuesday, Thursday |

**Example:**
```yaml
- label: Inspirational
  action: Queue
  input: 'plex: 321211'
  days: Sunday
  active: false  # Currently disabled
```

## Display Options

| Field | Type | Description |
|-------|------|-------------|
| `image` | string | Custom thumbnail path (e.g., `/media/img/lists/{uid}`) |
| `folder_color` | string | Accent color for folder items (hex, e.g., `#9FA5C2`) |

## Folder Organization

Items are organized into folders. The `folder` field determines which menu the item appears in.

### Root Folders (Entry Points)

| Folder | Consumer App | Description |
|--------|--------------|-------------|
| `TVApp` | TVApp | Main TV menu |
| `Office Program` | OfficeApp | Office keypad menu |

### Content Folders

| Folder | Description |
|--------|-------------|
| `FHE` | Family Home Evening submenu |
| `Kids` | Children's content |
| `Scripture` | Scripture study content |
| `LDS` | Church-related content |
| `Music` | Music playlists |
| `Talks` | Conference talks |
| `Education` | Educational content |
| `Health` | Health/fitness content |
| `Ambient` | Background/ambient content |
| `TV` | TV shows |
| `Books` | Audiobooks/reading |

### Queue Folders (Expandable)

| Folder | Description |
|--------|-------------|
| `Music Queue` | Background music rotation (day-based scheduling) |
| `Morning Program` | Scheduled morning content sequence |
| `Evening Program` | Scheduled evening content sequence |
| `Cartoons` | Children's cartoon queue |

### Nested Folders

Folders can be nested via `list: {folder}` input:

```yaml
# In TVApp folder - links to FHE submenu
- label: FHE
  action: List
  input: 'list: FHE'
  folder: TVApp

# Items in FHE folder
- label: Opening Hymn
  input: 'hymn: 304'
  folder: FHE
  folder_color: '#9FA5C2'
```

## Queue Expansion

When a queue-type item is selected, the Player expands it by fetching all playable items from the referenced folder.

### Expansion Flow

1. User selects item with `queue: { queue: "Music Queue" }` or `queue: { plex: "642120" }`
2. Frontend calls `/api/v1/list/folder/{name}/playable` or `/api/v1/list/plex/{id}/playable`
3. API returns flattened list of playable items only
4. Player loads items into queue with shuffle/continuous options

### Playable Modifier

The `/playable` modifier:
- Recursively expands nested folder references
- Filters out non-playable items (apps, submenus)
- Can combine with `,shuffle` for randomization

**API Examples:**
```
GET /api/v1/list/folder/Music Queue/playable
GET /api/v1/list/folder/Morning Program/playable,shuffle
GET /api/v1/list/plex/642120/playable
```

## Consuming Apps

| App | Menu Component | API Endpoint | Description |
|-----|----------------|--------------|-------------|
| TVApp | `TVMenu` | `/api/v1/list/folder/TVApp` | Grid layout, remote-friendly |
| OfficeApp | `KeypadMenu` | `/api/v1/list/folder/Office Program` | Keypad layout, numpad-friendly |
| Player | - | `/api/v1/list/folder/{name}/playable` | Queue expansion |

**Note:** FitnessApp has its own configuration at `/api/v1/fitness` and does not use lists.yml.

## Action → Content Handler Mapping

| Action | Source | Backend Handler | Frontend View |
|--------|--------|-----------------|---------------|
| `Queue` | `plex` | PlexAdapter | Player (shuffle/continuous) |
| `Queue` | `queue` | FolderAdapter → expansion | Player (named queue) |
| `List` | `plex` | PlexAdapter | ShowView / SeasonView |
| `List` | `list` | FolderAdapter | TVMenu (submenu) |
| `Play` | `plex` | PlexAdapter | Player (direct) |
| `Play` | `scripture` | LocalContentAdapter | Player |
| `Play` | `talk` | LocalContentAdapter | Player |
| `Play` | `hymn` | LocalContentAdapter | Player |
| `Play` | `media` | FilesystemAdapter | Player |
| `Open` | `app` | - | App launcher |

## Complete Example

```yaml
# Music queue item with scheduling
- label: Classical
  action: Queue
  input: 'plex: 622894'
  shuffle: true
  continuous: true
  days: M•W•F
  active: false
  uid: a1731190-2d7e-47a1-a567-0379dfaabce0
  folder: Music Queue

# TV show with season navigation
- label: Chosen
  action: List
  input: 'plex: 408886'
  uid: 019b81e0-b7a6-7992-bdf3-e91dfc2dc029
  folder: TVApp

# Scripture with version
- label: Gen 1
  input: 'scripture: gen 1; version nrsv'
  uid: bb74ab0d-5311-45b3-97c4-b4f828af73eb
  folder: Genesis

# Plex with music overlay for nomusic content
- label: Christmas
  action: Queue
  input: 'plex: 663035; overlay: 461309'
  shuffle: true
  continuous: true
  active: false
  uid: 2511aaef-ed6a-4e34-b51c-1f77ceef407e
  folder: TVApp

# FHE submenu link
- label: FHE
  action: List
  input: 'list: FHE'
  uid: 9856b419-fe2e-44c6-b835-b9093a7b85fb
  folder: TVApp
  image: /media/img/lists/9856b419-fe2e-44c6-b835-b9093a7b85fb

# App launcher
- label: Wrap Up
  action: Open
  input: 'app: wrapup'
  uid: 88c881cb-5de2-47e2-abf4-0d016cd7b995
  folder: Morning Program
```
