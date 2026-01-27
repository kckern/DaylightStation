# TV Season View Enhancement

## Problem Statement

When navigating to a TV show season in the TV menu, episodes are displayed using the generic `Menu.jsx` component with limited information. The current implementation:

1. **Always applies `recent_on_top` sorting** - Episodes appear in watch-history order instead of episode order
2. **Uses a data-poor API endpoint** - `data/list/:plex_key` returns minimal episode data
3. **Lacks season-specific metadata** - No episode descriptions, watch progress, duration, or episode numbers displayed
4. **Uses generic menu styling** - Episodes look identical to any other menu item (movies, shows, playlists)

---

## Current Data Flow

### API Endpoint Used: `/data/list/:plex_key/+recent_on_top`

```json
{
  "media_key": "665603",
  "plex": "665603",
  "type": "season",
  "title": "Season 4",
  "image": "/plex_proxy/library/metadata/665603/thumb/...",
  "items": [
    {
      "label": "Promises",
      "image": "/plex_proxy/library/metadata/665604/thumb/...",
      "type": "episode",
      "play": { "plex": "665604" }
    }
    // ... more episodes (sorted by recent watch activity, NOT episode order)
  ]
}
```

**Problems:**
- No episode descriptions
- No episode numbers
- No watch progress (percentage, seconds watched)
- No duration
- Items sorted by `recent_on_top` (last-watched first) instead of episode order
- No season summary

---

### Rich API Endpoint Available: `/media/plex/list/:plex_key`

```json
{
  "plex": "665603",
  "title": "Season 4",
  "image": "/plex_proxy/library/metadata/665603/thumb/...",
  "info": {
    "key": "665603",
    "type": "season",
    "title": "Season 4",
    "summary": "After preaching to a crowd of more than 5,000 people...",
    "labels": [],
    "collections": []
  },
  "seasons": {
    "665603": {
      "num": 4,
      "title": "Season 4",
      "img": "/plex_proxy/...",
      "summary": "After preaching to a crowd..."
    }
  },
  "items": [
    {
      "label": "Promises",
      "title": "Promises",
      "type": "episode",
      "plex": "665604",
      "image": "/plex_proxy/...",
      "thumb_id": 729244,
      "duration": 3369,
      "episodeDescription": "An intoxicating dance leads Herod to put an end to John...",
      "episodeNumber": 1,
      "seasonId": "665603"
    },
    {
      "label": "Calm Before",
      "title": "Calm Before",
      "type": "episode",
      "plex": "665607",
      "watchProgress": 0.6,
      "watchSeconds": 22,
      "watchedDate": "2026-01-02 07:43:36pm",
      "watchDurationSecondsLastSession": 11.156,
      "watchDurationSecondsLifetime": 11.156,
      "duration": 3949,
      "episodeDescription": "Beginning with a funeral procession...",
      "episodeNumber": 4,
      "seasonId": "665603"
    }
    // ... episodes in correct order (1, 2, 3, 4, ...)
  ]
}
```

**Benefits:**
- Episode descriptions (`episodeDescription`)
- Episode numbers (`episodeNumber`)
- Watch progress (`watchProgress`, `watchSeconds`, `watchedDate`)
- Duration in seconds (`duration`)
- Items in episode order
- Season summary (`info.summary`)
- Season number available (`seasons[id].num`)

---

## Code Analysis

### Frontend: `Menu.jsx` - `useFetchMenuData` Hook

**Location:** [frontend/src/modules/Menu/Menu.jsx](../frontend/src/modules/Menu/Menu.jsx) (lines 234-323)

```javascript
async function fetchData(target, config) {
  config = `${config || ""}+recent_on_top`;  // ❌ Always adds recent_on_top
  // ...
  const data = await DaylightAPI(
    `data/list/${target}${config ? `/${config}` : ""}`  // ❌ Uses limited API
  );
}
```

**Issues:**
1. Hardcoded `+recent_on_top` is appropriate for top-level menus but wrong for seasons
2. Uses `/data/list/` which returns minimal episode data
3. No awareness of content type (season vs. playlist vs. folder)

### Backend: `/data/list/*` Endpoint

**Location:** [backend/routers/fetch.mjs](../backend/routers/fetch.mjs) (lines 793-806)

```javascript
apiRouter.get('/list/*', async (req, res, next) => {
  const [media_key, config] = req.params[0].split('/');
  const {meta, items} = await getChildrenFromMediaKey({media_key, config, req});
  // Returns basic item structure
});
```

### Backend: `/media/plex/list/:plex_key` Endpoint

**Location:** [backend/routers/media.mjs](../backend/routers/media.mjs) (lines 393-620)

This endpoint already returns rich data including:
- Episode descriptions from Plex metadata
- Watch progress from viewing history
- Duration
- Episode numbers
- Season information

---

## Proposed Solution

### Option A: Detect Season Type and Use Rich API

1. **Frontend Detection**: When `type === "season"` is detected, use `/media/plex/list/` instead of `/data/list/`
2. **Skip `recent_on_top`**: For seasons, episodes should always be in order
3. **Custom Component**: Create `SeasonView.jsx` component with:
   - Episode thumbnails with progress bars
   - Episode numbers and titles
   - Episode descriptions (truncated)
   - Duration display
   - "Continue Watching" indicator for partially-watched episodes

### Option B: Enhance `/data/list/` to Return Rich Data for Seasons

1. Modify `getChildrenFromMediaKey` to detect season type
2. When type is season, call the Plex loader with enriched data
3. Maintain backward compatibility for other types

### Recommended: Option A (Separation of Concerns)

- Keeps the generic menu fast and simple
- Creates a purpose-built component for seasons
- Allows for season-specific UI (episode list layout, progress tracking, etc.)
- Easier to maintain and extend

---

## Technical Requirements

### 1. New Component: `SeasonView.jsx`

```
frontend/src/modules/Menu/
├── Menu.jsx           # Generic menu (existing)
├── MenuStack.jsx      # Stack renderer (existing)
├── SeasonView.jsx     # NEW: Season-specific view
└── Menu.scss          # Styles (extend for season view)
```

**Props:**
- `seasonId` - Plex key for the season
- `depth` - Navigation depth (for context)
- `onSelect` - Selection handler
- `onEscape` - Back navigation handler

**Features:**
- Fetches from `/media/plex/list/:seasonId` (no `recent_on_top`)
- Displays season summary at top
- Shows episodes in order with:
  - Episode number badge
  - Thumbnail with watch progress overlay
  - Title and truncated description
  - Duration (formatted as "56m" or "1h 23m")
  - Visual indicator for partially-watched episodes
- Keyboard navigation (same as Menu)

### 2. Update `MenuStack.jsx`

Detect when navigating to a season and render `SeasonView` instead of `TVMenu`:

```javascript
// In handleSelect or render logic
if (selection.list?.type === 'season' || menuMeta?.type === 'season') {
  return <SeasonView seasonId={...} depth={depth} onSelect={handleSelect} onEscape={clear} />;
}
```

### 3. Update Data Flow

```
User selects show → TVMenu (shows seasons)
                      ↓
User selects season → SeasonView (episodes with rich data)
                      ↓
User selects episode → Player
```

---

## UI Mockup (Text-Based)

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Season 4                                    8 episodes       │
├─────────────────────────────────────────────────────────────────┤
│  After preaching to a crowd of more than 5,000 people in        │
│  Galilee and performing a miracle by walking on water...        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────┐  1. Promises                           56m        │
│  │  [img]   │  An intoxicating dance leads Herod to put an      │
│  │          │  end to John the Baptizer...                      │
│  └──────────┘                                                   │
│                                                                 │
│  ┌──────────┐  2. Confessions                    1h 20m         │
│  │  [img]   │  Jesus founds his church on unholy ground...      │
│  │          │                                                   │
│  └──────────┘                                                   │
│                                                                 │
│  ┌──────────┐  4. Calm Before                ▓▓▓▓░░ 60%        │
│  │  [img]   │  Beginning with a funeral procession...           │
│  │ ▓▓▓▓░░░░ │  CONTINUE WATCHING                                │
│  └──────────┘                                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `frontend/src/modules/Menu/SeasonView.jsx` | Create | New season-specific component |
| `frontend/src/modules/Menu/SeasonView.scss` | Create | Styles for season view |
| `frontend/src/modules/Menu/MenuStack.jsx` | Modify | Route to SeasonView for season type |
| `frontend/src/hooks/useFetchSeasonData.js` | Create | Hook to fetch rich season data |
| `frontend/src/modules/Menu/Menu.jsx` | Minor | Export type detection helper |

---

## Success Criteria

1. ✅ Selecting a season shows episodes in order (not recent-on-top)
2. ✅ Episode descriptions visible
3. ✅ Episode numbers displayed
4. ✅ Watch progress shown visually
5. ✅ Duration displayed for each episode
6. ✅ Season summary displayed
7. ✅ Keyboard navigation works (arrows, Enter, Escape)
8. ✅ Partially-watched episodes highlighted
9. ✅ Performance: Data loads quickly (single API call)

---

## Estimated Effort

| Task | Estimate |
|------|----------|
| Create `SeasonView.jsx` component | 2-3 hours |
| Create `useFetchSeasonData.js` hook | 30 min |
| Update `MenuStack.jsx` routing | 30 min |
| Styling (`SeasonView.scss`) | 1-2 hours |
| Testing and polish | 1 hour |
| **Total** | **5-7 hours** |

---

## Future Enhancements

1. **Music Albums**: Album view with track list, duration, artist info
2. **Collections**: Collection view with item count, recently added
3. **Audiobooks**: Chapter list with resume position (Audiobookshelf provider)
4. **Photos**: Photo album view with EXIF, faces (Immich provider)

---

## Implementation: Plex Show & Season Views

### Detection Strategy

When a user navigates to a Plex item, we need to detect if it's a show or season to render the appropriate view.

**Key insight:** The `/data/list/` response includes `type` in the response metadata.

```json
// /data/list/598748 (show)
{ "type": "show", "title": "The Chosen", "items": [...seasons] }

// /data/list/665603 (season)
{ "type": "season", "title": "Season 4", "items": [...episodes] }
```

**Detection flow in MenuStack.jsx:**

```javascript
// When handling a list selection
const handleSelect = useCallback((selection) => {
  if (!selection) return;

  // For plex items, we need to check the type AFTER fetching
  // But the selection itself may have type from the parent menu's item
  if (selection.list?.plex) {
    const itemType = selection.type; // 'season', 'show', 'movie', etc.
    
    if (itemType === 'season') {
      push({ type: 'season-view', props: selection });
      return;
    }
    if (itemType === 'show') {
      push({ type: 'show-view', props: selection });
      return;
    }
  }
  
  // Default: generic menu
  if (selection.list || selection.menu) {
    push({ type: 'menu', props: selection });
  }
  // ... player, app handlers
}, [push]);
```

### API Usage

| View | Endpoint | Why |
|------|----------|-----|
| **ShowView** | `/media/plex/list/:showId` | Need season summaries, episode counts, show description |
| **SeasonView** | `/media/plex/list/:seasonId` | Need episode descriptions, watch progress, duration |
| **Generic Menu** | `/data/list/:key` | Fast, minimal data for navigation |

### Data Comparison

#### Show-Level Data

| Field | `/data/list/` | `/media/plex/list/` |
|-------|--------------|---------------------|
| Title | ✅ | ✅ |
| Image | ✅ | ✅ |
| Type | ✅ `"show"` | ✅ `"show"` |
| Description | ❌ | ✅ `info.summary` |
| Year | ❌ | ✅ `info.year` |
| Studio | ❌ | ✅ `info.studio` |
| Collections | ❌ | ✅ `info.collections` |
| Season items | ✅ (label, image, type) | ✅ (same) |

#### Season-Level Data

| Field | `/data/list/` | `/media/plex/list/` |
|-------|--------------|---------------------|
| Episode label | ✅ | ✅ |
| Episode image | ✅ | ✅ |
| Episode description | ❌ | ✅ `episodeDescription` |
| Episode number | ❌ | ✅ `episodeNumber` |
| Duration | ❌ | ✅ `duration` (seconds) |
| Watch progress | ❌ | ✅ `watchProgress`, `watchSeconds` |
| Season summary | ❌ | ✅ `info.summary` |

### Component Architecture

```
frontend/src/modules/Menu/
├── Menu.jsx              # Generic menu (existing)
├── MenuStack.jsx         # Router - detects type, renders appropriate view
├── ShowView.jsx          # NEW: Show with seasons
├── SeasonView.jsx        # NEW: Season with episodes  
├── hooks/
│   ├── useFetchMenuData.js    # Existing (uses /data/list/)
│   └── useFetchPlexData.js    # NEW: Shared hook for /media/plex/list/
└── Menu.scss             # Styles (extend for show/season)
```

### Component Specifications

#### 1. MenuStack.jsx Updates

```javascript
// Add new content types to switch statement
switch (type) {
  case 'menu':
    return <TVMenu list={...} depth={depth} onSelect={handleSelect} onEscape={clear} />;
    
  case 'show-view':
    return <ShowView showId={props.list.plex} depth={depth} onSelect={handleSelect} onEscape={clear} />;
    
  case 'season-view':
    return <SeasonView seasonId={props.list.plex} depth={depth} onSelect={handleSelect} onEscape={clear} />;
    
  case 'player':
    return <Player {...props} clear={clear} />;
    
  case 'app':
    return <AppContainer {...props} clear={clear} />;
}
```

#### 2. ShowView.jsx

**Purpose:** Display a TV show with its seasons in a rich layout

**Props:**
- `showId` - Plex rating key for the show
- `depth` - Navigation depth
- `onSelect` - Handler when user selects a season
- `onEscape` - Handler for back navigation

**Layout:**
```
┌─────────────────────────────────────────────────────────────────┐
│  ┌──────────┐  The Chosen                                       │
│  │  [show   │  Drama • 2017 • 4 Seasons                         │
│  │  poster] │  ─────────────────────────────────────────────    │
│  │          │  See Jesus through the eyes of those who          │
│  │          │  knew him best...                                 │
│  └──────────┘                                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │ Season 1 │  │ Season 2 │  │ Season 3 │  │ Season 4 │        │
│  │ [thumb]  │  │ [thumb]  │  │ [thumb]  │  │ [thumb]  │        │
│  │ 8 eps    │  │ 8 eps    │  │ 8 eps    │  │ 8 eps    │        │
│  │ ▓▓▓▓▓▓░░ │  │ ▓▓▓▓▓▓▓▓ │  │ ░░░░░░░░ │  │ ▓▓░░░░░░ │        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
│     [ACTIVE]                                                    │
└─────────────────────────────────────────────────────────────────┘
```

**Data fetching:**
```javascript
const { data, loading } = useFetchPlexData(showId);
// data = { info, items: seasons[] }
```

**Keyboard navigation:** Same as Menu.jsx (arrows navigate seasons, Enter selects, Escape goes back)

#### 3. SeasonView.jsx

**Purpose:** Display a season with its episodes in a list layout

**Props:**
- `seasonId` - Plex rating key for the season
- `depth` - Navigation depth
- `onSelect` - Handler when user selects an episode
- `onEscape` - Handler for back navigation

**Layout:**
```
┌─────────────────────────────────────────────────────────────────┐
│  ← Season 4                                    8 episodes       │
├─────────────────────────────────────────────────────────────────┤
│  After preaching to a crowd of more than 5,000 people in        │
│  Galilee and performing a miracle by walking on water...        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────┐  1. Promises                           56m        │
│  │  [thumb] │  An intoxicating dance leads Herod...             │
│  └──────────┘                                                   │
│                                                                 │
│  ┌──────────┐  2. Confessions                    1h 20m         │
│  │  [thumb] │  Jesus founds his church on unholy ground...      │
│  └──────────┘                                                   │
│                                                                 │
│  ┌──────────┐  4. Calm Before                ▓▓▓▓░░ 60%  ←     │
│  │  [thumb] │  Beginning with a funeral procession...           │
│  │ ▓▓▓▓░░░░ │  CONTINUE WATCHING              [ACTIVE]          │
│  └──────────┘                                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Data fetching:**
```javascript
const { data, loading } = useFetchPlexData(seasonId);
// data = { info, items: episodes[], seasons: { [id]: seasonMeta } }
```

**Episode item structure (from API):**
```javascript
{
  "label": "Calm Before",
  "title": "Calm Before",
  "type": "episode",
  "plex": "665607",
  "image": "/plex_proxy/...",
  "duration": 3949,                    // seconds
  "episodeDescription": "Beginning with a funeral...",
  "episodeNumber": 4,
  "seasonId": "665603",
  "watchProgress": 0.6,                // 0-1
  "watchSeconds": 2369,
  "watchedDate": "2026-01-02 07:43:36pm"
}
```

**Selection output:** When user selects an episode:
```javascript
onSelect({ play: { plex: "665607" }, type: "episode" });
// This triggers MenuStack to push a player
```

#### 4. useFetchPlexData.js (Shared Hook)

```javascript
/**
 * Fetches rich Plex data from /media/plex/list/:id
 * Used by ShowView and SeasonView for detailed metadata.
 */
export function useFetchPlexData(plexId) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!plexId) {
      setLoading(false);
      return;
    }

    let canceled = false;
    
    async function fetchData() {
      try {
        const response = await DaylightAPI(`media/plex/list/${plexId}`);
        if (!canceled) {
          setData(response);
          setLoading(false);
        }
      } catch (err) {
        if (!canceled) {
          setError(err);
          setLoading(false);
        }
      }
    }

    fetchData();
    return () => { canceled = true; };
  }, [plexId]);

  return { data, loading, error };
}
```

### UX Coherence

To maintain visual consistency with Menu.jsx:

| Element | Menu.jsx | ShowView | SeasonView |
|---------|----------|----------|------------|
| Header | Title + count + time | Show title + metadata | Season title + count |
| Item layout | Grid (5 columns) | Grid (5 columns) | List (1 column) |
| Item image | Square with blur-bg | Square with blur-bg | Landscape thumbnail |
| Selection | Blue border/glow | Blue border/glow | Blue border/glow |
| Keyboard | ↑↓←→ Enter Esc | ↑↓←→ Enter Esc | ↑↓ Enter Esc |
| Progress bar | ❌ | Per-season | Per-episode + text |

**Shared styles (Menu.scss additions):**
```scss
// Reuse existing menu-item styles
.show-view, .season-view {
  .menu-item { /* inherit from Menu.scss */ }
  .menu-item.active { /* inherit selection styles */ }
}

// Show-specific
.show-view {
  .show-header { /* poster + metadata layout */ }
  .seasons-grid { /* 5-column grid like menu */ }
}

// Season-specific  
.season-view {
  .season-header { /* title + summary */ }
  .episodes-list { /* single column list */ }
  .episode-item {
    .episode-thumb { /* 16:9 aspect */ }
    .episode-info { /* title, description, duration */ }
    .episode-progress { /* progress bar + percentage */ }
  }
}
```

### Navigation Flow Example

```
TVApp Root Menu
    │
    ├─► "TV Shows" (list: { plex: "2" })
    │       │
    │       └─► [Generic Menu] shows library
    │               │
    │               └─► "The Chosen" (list: { plex: "598748" }, type: "show")
    │                       │
    │                       └─► [ShowView] seasons grid
    │                               │
    │                               └─► "Season 4" (list: { plex: "665603" }, type: "season")
    │                                       │
    │                                       └─► [SeasonView] episodes list
    │                                               │
    │                                               └─► "Calm Before" (play: { plex: "665607" })
    │                                                       │
    │                                                       └─► [Player]
```

### Files to Create/Modify

| File | Action | Lines (est.) |
|------|--------|--------------|
| `frontend/src/modules/Menu/ShowView.jsx` | Create | ~150 |
| `frontend/src/modules/Menu/SeasonView.jsx` | Create | ~200 |
| `frontend/src/modules/Menu/hooks/useFetchPlexData.js` | Create | ~40 |
| `frontend/src/modules/Menu/MenuStack.jsx` | Modify | +30 |
| `frontend/src/modules/Menu/Menu.scss` | Extend | +150 |

### Implementation Order

1. **Create `useFetchPlexData.js`** - Shared data hook
2. **Create `SeasonView.jsx`** - Higher value (episode details, progress)
3. **Update `MenuStack.jsx`** - Route `season` type to SeasonView
4. **Test season flow** - Navigate show → season → verify rich data
5. **Create `ShowView.jsx`** - Season grid with metadata
6. **Update `MenuStack.jsx`** - Route `show` type to ShowView
7. **Polish styles** - Ensure visual consistency

### Success Metrics

- [ ] Selecting a season shows episodes in order (not recent-on-top)
- [ ] Episode descriptions visible in SeasonView
- [ ] Episode numbers displayed
- [ ] Watch progress shown per-episode
- [ ] Duration displayed (formatted: "56m" or "1h 20m")
- [ ] Show description visible in ShowView
- [ ] Season thumbnails in ShowView
- [ ] Keyboard navigation identical feel to Menu.jsx
- [ ] Back button (Escape) works at all levels
- [ ] No performance regression (single API call per view)

### Deep Dive: `/data/list/` vs `/media/plex/list/`

Both endpoints serve similar purposes but have evolved independently, leading to redundancy and confusion.

#### Endpoint Comparison

| Aspect | `/data/list/:key/:config` | `/media/plex/list/:key/:config` |
|--------|--------------------------|--------------------------------|
| **Router** | `fetch.mjs` | `media.mjs` |
| **Primary Use** | Generic menu navigation | Plex-specific media lists |
| **Data Sources** | YAML lists, Plex, filesystem | Plex only (+ watchlists) |
| **Plex Handling** | Thin wrapper (label/image/type/action) | Rich metadata + watch history |
| **Watch Progress** | ❌ Not included | ✅ Full progress data |
| **Episode Details** | ❌ No description/number | ✅ Description, episode #, duration |
| **Season Info** | ❌ None | ✅ Season summary, season map |
| **Sorting** | `recent_on_top` via config | Episode order (no sorting) |
| **Multi-key Support** | Single key only | Comma-separated keys |
| **Lines of Code** | ~100 | ~230 |

#### Current Usage (Frontend)

```
/data/list/ (5 usages):
├── Menu.jsx           → Generic menu fetching
├── TVApp.jsx          → Root menu loading
├── useQueueController → Queue expansion
└── api.js (Player)    → Queue item resolution

/media/plex/list/ (5 usages):
├── FitnessMenu.jsx    → Workout video collections
├── FitnessMusicPlayer → Playlist loading
├── FitnessShow.jsx    → Show playback
├── api.js (Player)    → Plex queue expansion
└── useQueueController → Plex queue items
```

#### The Core Problem

Both endpoints call the same underlying function:

```javascript
// fetch.mjs - getChildrenFromMediaKey
const plexResponse = await PLEX.loadChildrenFromKey(media_key, mustBePlayable);
const plexList = plexResponse?.list.map(({ plex, title, type, image }) => {
  return { label: title, image, type, [action]: { plex } };  // ← MINIMAL DATA
});

// media.mjs - /plex/list
const result = await (new Plex()).loadChildrenFromKey(plex_key, playable, shuffle);
// Then enriches with ~100 lines of watch history, episode details, season info
```

Both call `Plex.loadChildrenFromKey()` but:
- `/data/list/` discards most of the rich data returned by Plex
- `/media/plex/list/` preserves and enriches it with watch history

#### Consolidation Options

##### Option 1: Merge into Single Endpoint ❌ NOT RECOMMENDED

**Pros:**
- Single source of truth
- No duplicate code

**Cons:**
- `/data/list/` serves non-Plex sources (YAML lists, filesystem)
- Performance: enrichment adds ~50-100ms for watch history lookup
- Breaking change for all consumers
- Different response schemas expected

##### Option 2: Make `/data/list/` Aware of Type ⚠️ PARTIAL

Add a `?rich=true` query param or detect type and redirect:

```javascript
// In fetch.mjs
if (isPlex && /season|episode/.test(type)) {
  // Redirect to /media/plex/list/ internally
  return await fetchRichPlexList(media_key, config, req);
}
```

**Pros:**
- Backward compatible
- Frontend doesn't change

**Cons:**
- Increased coupling between routers
- Still maintaining two code paths

##### Option 3: Keep Separate, Clarify Purpose ✅ RECOMMENDED

Accept that they serve different purposes:

| Endpoint | Purpose | When to Use |
|----------|---------|-------------|
| `/data/list/` | **Fast menu navigation** | Top-level menus, folder navigation, quick browsing |
| `/media/plex/list/` | **Rich media details** | Season views, album views, any UI needing watch progress |

**Changes Needed:**
1. **Document the distinction** clearly in code comments
2. **Export a helper** from Menu.jsx to choose the right endpoint
3. **Frontend routing** in MenuStack to detect type and use appropriate component

#### Recommendation

**Keep both endpoints** with clear separation of concerns:

```
/data/list/           → MENU endpoint (fast, simple, any source)
/media/plex/list/     → DETAIL endpoint (rich, Plex-only, watch-aware)
```

**Frontend Strategy:**
```javascript
// MenuStack.jsx
if (selection.type === 'season') {
  // Use SeasonView which fetches from /media/plex/list/
  push({ type: 'season', props: selection });
} else {
  // Use generic TVMenu which fetches from /data/list/
  push({ type: 'menu', props: selection });
}
```

This gives us:
- **Performance**: Menu navigation stays fast (no watch history lookup)
- **Richness**: Season/album views get full metadata
- **Clarity**: Each endpoint has a clear purpose
- **Flexibility**: Can add more rich views (albums, shows) without touching menu code

#### Code Quality Improvements

Regardless of consolidation decision, these improvements should be made:

1. **Extract shared Plex item mapping** into `plex.mjs`:
   ```javascript
   // plex.mjs
   export function mapPlexItemForMenu(item) { ... }
   export function mapPlexItemWithDetails(item, viewingHistory) { ... }
   ```

2. **Add JSDoc to both endpoints** explaining their purpose and when to use each

3. **Consider caching** for `/media/plex/list/` since watch history lookup is expensive

4. **Remove hardcoded `+recent_on_top`** from Menu.jsx's `useFetchMenuData` - let caller decide

---

## Appendix B: Multi-Provider Expansion Strategy

### Current Landscape

DaylightStation currently has one external media provider (Plex), but the architecture should anticipate:

| Provider | Content Type | Status |
|----------|--------------|--------|
| **Plex** | Movies, TV, Music | ✅ Implemented |
| **Audiobookshelf** | Audiobooks, Podcasts | 🔜 Planned |
| **Immich** | Photos, Videos | 🔜 Planned |
| **Jellyfin** | Movies, TV, Music | 💭 Possible |
| **Local NAS** | Any media files | ✅ Partial |
| **YouTube** | Videos, Playlists | 💭 Possible |
| **Spotify** | Music | 💭 Possible |

### The Fundamental Question

> Should we have `/media/plex/list`, `/media/audiobooks/list`, `/media/photos/list`... or a unified `/media/list` that abstracts providers?

### Proposed Information Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ENDPOINT TAXONOMY                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  /data/                    Native DaylightStation Data              │
│  ├── /list/:key            Menu configs, YAML lists, app routes     │
│  ├── /state/:key           Runtime state (keyboard, sessions)       │
│  └── /config/:key          User preferences, household config       │
│                                                                     │
│  /media/                   External Media Providers                 │
│  ├── /plex/list/:key       Plex libraries, seasons, episodes        │
│  ├── /audiobooks/list/:key Audiobookshelf shelves, books, chapters  │
│  ├── /photos/list/:key     Immich albums, photos, videos            │
│  └── /unified/list/:key    Cross-provider unified view (future)     │
│                                                                     │
│  /api/                     Actions & Mutations                      │
│  ├── /play/:key            Start playback                           │
│  ├── /queue                Manage playback queue                    │
│  └── /log                  Analytics, watch history                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Role Clarification

#### `/data/list/` - The Composition Layer

**Purpose:** Menu navigation, routing, item composition

**Responsibilities:**
- Load YAML-defined menu structures
- Resolve mixed-provider references into a unified menu schema
- Handle DaylightStation-native content (scripture, hymns, poems, etc.)
- Apply user preferences (recent_on_top, shuffle, filtering)
- Return **minimal, fast** data for menu rendering

**Example YAML list:**
```yaml
# data/content/TVApp.yaml
title: "TV & Movies"
items:
  - label: "Continue Watching"
    list: "watchlist:resume"        # Native resolver
  - label: "Movies"
    list: "plex:1"                  # Plex library ID
  - label: "TV Shows"
    list: "plex:2"
  - label: "Audiobooks"
    list: "audiobooks:library"      # Audiobookshelf
  - label: "Family Photos"
    list: "photos:family-album"     # Immich
```

**Response Schema (Universal):**
```json
{
  "title": "TV & Movies",
  "items": [
    { "label": "Die Hard", "type": "movie", "play": { "plex": "12345" } },
    { "label": "Breaking Bad", "type": "show", "list": { "plex": "67890" } },
    { "label": "Dune (Audiobook)", "type": "audiobook", "play": { "audiobooks": "abc123" } },
    { "label": "Summer 2025", "type": "album", "list": { "photos": "xyz789" } }
  ]
}
```

#### `/media/{provider}/list/` - The Detail Layer

**Purpose:** Provider-specific rich data for detail views

**Responsibilities:**
- Fetch native metadata from the provider API
- Include provider-specific fields (watch progress, chapters, EXIF, etc.)
- No abstraction - expose what the provider gives us
- Support provider-specific features (Plex labels, Audiobookshelf progress, etc.)

**When to Use:**
- Season view (episode descriptions, watch progress)
- Album view (track details, chapter markers)
- Photo album view (EXIF data, faces, locations)
- Any UI that needs rich, provider-specific metadata

### Provider Adapter Pattern

Each provider should implement a common interface:

```javascript
// backend/lib/providers/ProviderInterface.mjs

/**
 * Interface that all media providers must implement
 */
export class MediaProvider {
  /**
   * Get children items for a parent key
   * @returns {Promise<{ items: MenuItem[], meta: object }>}
   */
  async getChildren(key, options = {}) { throw new Error('Not implemented'); }
  
  /**
   * Get rich metadata for a specific item
   * @returns {Promise<object>}
   */
  async getMetadata(key) { throw new Error('Not implemented'); }
  
  /**
   * Get playback URL for an item
   * @returns {Promise<string>}
   */
  async getPlaybackUrl(key, options = {}) { throw new Error('Not implemented'); }
  
  /**
   * Search across this provider
   * @returns {Promise<MenuItem[]>}
   */
  async search(query) { throw new Error('Not implemented'); }
}
```

**Implementations:**
```
backend/lib/providers/
├── ProviderInterface.mjs    # Abstract interface
├── PlexProvider.mjs         # Wraps existing plex.mjs
├── AudiobooksProvider.mjs   # Audiobookshelf API
├── PhotosProvider.mjs       # Immich API
└── index.mjs                # Registry & factory
```

### Unified Endpoint (Future)

Once multiple providers exist, consider a unified endpoint:

```
GET /media/unified/list/recent
GET /media/unified/search?q=star+wars
```

This would:
1. Query all configured providers in parallel
2. Merge results into a unified schema
3. Apply cross-provider sorting/filtering

**Not recommended initially** - adds complexity before it's needed. Let individual provider endpoints mature first.

### Frontend Routing Strategy

```javascript
// MenuStack.jsx or a dedicated router

function routeToComponent(selection) {
  const { type, provider } = detectContentType(selection);
  
  switch (type) {
    case 'season':
      return <SeasonView {...selection} />;        // Uses /media/plex/list/
    case 'audiobook':
      return <AudiobookView {...selection} />;     // Uses /media/audiobooks/list/
    case 'photo-album':
      return <PhotoAlbumView {...selection} />;    // Uses /media/photos/list/
    case 'menu':
    default:
      return <TVMenu {...selection} />;            // Uses /data/list/
  }
}

function detectContentType(selection) {
  // From the selection's list/play key, detect provider and type
  if (selection.list?.plex && selection.type === 'season') {
    return { type: 'season', provider: 'plex' };
  }
  if (selection.list?.audiobooks) {
    return { type: 'audiobook', provider: 'audiobooks' };
  }
  if (selection.list?.photos) {
    return { type: 'photo-album', provider: 'photos' };
  }
  return { type: 'menu', provider: null };
}
```

### Key Principles

1. **Provider-specific endpoints are correct** - Don't force a lowest-common-denominator abstraction

2. **`/data/list/` is the glue** - It composes items from any source into a navigable menu

3. **Rich views need rich data** - Season views, audiobook chapter lists, and photo albums each need provider-specific detail endpoints

4. **Playback keys identify provider** - `{ play: { plex: "123" } }` vs `{ play: { audiobooks: "abc" } }` makes the player provider-aware

5. **Add providers incrementally** - Don't build the abstraction until you have 2+ providers

### Migration Path

| Phase | Action |
|-------|--------|
| **Now** | Keep `/data/list/` and `/media/plex/list/` separate with clear purposes |
| **+Audiobooks** | Add `/media/audiobooks/list/`, create `AudiobooksProvider.mjs` |
| **+Photos** | Add `/media/photos/list/`, create `PhotosProvider.mjs` |
| **+2 providers** | Consider extracting common patterns into `ProviderInterface.mjs` |
| **+3 providers** | Evaluate if `/media/unified/` is needed for cross-provider features |

### Summary

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   /data/list/    │     │ /media/plex/list │     │ Frontend Router  │
│                  │     │ /media/abs/list  │     │                  │
│  • Menu schemas  │────▶│ /media/photo/list│────▶│  • TVMenu        │
│  • Composition   │     │                  │     │  • SeasonView    │
│  • Fast/minimal  │     │  • Rich metadata │     │  • AudiobookView │
│  • Any source    │     │  • Watch progress│     │  • PhotoAlbumView│
│                  │     │  • Provider-native│    │                  │
└──────────────────┘     └──────────────────┘     └──────────────────┘
     ROUTING                  DETAILS                 RENDERING
```

**Bottom line:** Yes, have `/media/{provider}/list` for each provider. Keep `/data/list` as the composition/routing layer that references items from any provider but returns a unified, minimal menu schema.


---

## Addendum: OfficeApp Compatibility (Single-Button Navigation)

The `OfficeApp` operates on a different interaction model than `TVApp`. While `TVApp` uses a standard directional remote (Up/Down/Left/Right/Enter), `OfficeApp` often relies on a single-button input (or limited keypad) that uses a **"Cycle & Timeout"** paradigm:
1.  **Cycle**: Pressing the button advances the selection to the next item (looping back to start).
2.  **Timeout**: Stopping on an item for a set duration (e.g., 3 seconds) confirms the selection automatically.

To ensure `ShowView.jsx` and `SeasonView.jsx` work seamlessly in `OfficeApp`, the following enhancements are required:

### 1. Support `MENU_TIMEOUT` Prop
-   Accept an optional `MENU_TIMEOUT` prop (default: 0).
-   If `MENU_TIMEOUT > 0`, activate the timeout logic.

### 2. Implement Timeout Logic
-   Use a timer (similar to `useProgressTimeout` in `Menu.jsx`) that triggers `onSelect(selectedItem)` when it expires.
-   **Reset** the timer whenever the selection changes (user navigates).
-   **Visual Feedback**: Render a progress bar on the currently selected item (similar to `KeypadMenu`) to indicate time remaining.

### 3. "Cycle" Navigation Support
-   The `OfficeApp` keypad handler may dispatch alphanumeric keys (or `Tab`) for the single button.
-   **Requirement**: In addition to Arrow keys, listen for **any alphanumeric key** (a-z, 0-9) and treat it as a "Next" command.
-   **Behavior**:
    -   Increment `selectedIndex` by 1.
    -   Loop back to 0 if at the end of the list.
    -   This ensures that a single button can traverse the entire grid/list.

### 4. Local State Fallback
-   `OfficeApp` does not currently provide `MenuNavigationContext`.
-   **Requirement**: `ShowView` and `SeasonView` must check if `navContext` exists.
    -   If `navContext` is present (TVApp), use it for selection state.
    -   If `navContext` is missing (OfficeApp), fall back to local `useState` for `selectedIndex`.

### Implementation Checklist for Views

#### `SeasonView.jsx` & `ShowView.jsx` Updates:

```javascript
// 1. Add Prop
export function SeasonView({ ..., MENU_TIMEOUT = 0 }) {
  
  // 2. Local State Fallback
  const [localIndex, setLocalIndex] = useState(0);
  const selectedIndex = navContext ? navContext.getSelection(depth).index : localIndex;
  
  const setIndex = (i) => {
    if (navContext) navContext.setSelection(depth, i);
    else setLocalIndex(i);
  };

  // 3. Timeout Logic
  const { timeLeft, resetTime } = useProgressTimeout(MENU_TIMEOUT, () => {
    handleSelect(items[selectedIndex]);
  });

  useEffect(() => {
    if (MENU_TIMEOUT > 0) resetTime();
  }, [selectedIndex, resetTime]);

  // 4. Cycle Navigation in handleKeyDown
  const handleKeyDown = (e) => {
    // ... existing arrow logic ...
    
    // Add alphanumeric cycle support
    if (/^[a-z0-9]$/i.test(e.key)) {
      e.preventDefault();
      const next = (selectedIndex + 1) % items.length;
      setIndex(next);
    }
  };
  
  // 5. Render Progress Bar
  // Inside render loop/grid:
  // {isActive && MENU_TIMEOUT > 0 && <ProgressBar timeLeft={timeLeft} total={MENU_TIMEOUT} />}
}
```
