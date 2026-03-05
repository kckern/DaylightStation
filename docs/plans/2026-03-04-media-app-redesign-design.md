# MediaApp Redesign — Three-Panel Responsive Layout

## Overview

Rebuild the MediaApp frontend around a three-panel responsive layout that unifies search, content browsing, and playback into a cohesive experience across all viewport sizes and content types.

**Core concept:** Three fixed-role panels — Search/Home, Content Browser, Player — that display as 1, 2, or 3 columns based on viewport width. On mobile, panels stack and navigate via routes. On desktop, all three are simultaneously visible.

---

## Responsive Layout

### Global Breakpoints

New shared file: `frontend/src/styles/_breakpoints.scss`

```scss
$bp-md: 768px;   // 2-column threshold
$bp-lg: 1200px;  // 3-column threshold

@mixin mobile-only  { @media (max-width: #{$bp-md - 1}) { @content; } }
@mixin tablet-up    { @media (min-width: $bp-md) { @content; } }
@mixin desktop-up   { @media (min-width: $bp-lg) { @content; } }
@mixin tablet-only  { @media (min-width: $bp-md) and (max-width: #{$bp-lg - 1}) { @content; } }
```

These are project-wide breakpoints available to all apps.

### Column Layout by Tier

| Viewport | Columns | Panel Visibility |
|----------|---------|-----------------|
| < 768px (mobile) | 1 | Active panel only. Navigate forward/back via routes. Mini player at bottom. |
| 768–1199px (tablet) | 2 | Search/Home + Content Browser side-by-side. Player collapses to mini player. |
| >= 1200px (desktop) | 3 | All three panels visible simultaneously. No mini player needed. |

### Panel CSS Layout

Desktop (3-col): `grid-template-columns: 320px 1fr 360px`
Tablet (2-col): `grid-template-columns: 320px 1fr` (player is mini player)
Mobile (1-col): `flex-direction: column`, one panel visible at a time

---

## Routing

```
/media                          -> Search/Home panel (default)
/media/search/:query?scope=x   -> Search results in left panel
/media/view/:contentId          -> Content detail in center panel
/media/play                     -> Player panel (mobile: fullscreen player)
```

- Route determines which panel is "active" (controls visibility on mobile)
- On tablet/desktop, panels render regardless of route — route indicates focus
- Browser back works naturally
- Content IDs in URLs pass through the existing 5-layer resolution chain

---

## Panel 1: Search/Home (Left)

### Search Bar

- Scope dropdown on left (existing `ScopeDropdown` component)
- Search input fills remaining width
- Instant streaming results (SSE, debounced 300ms via existing `useStreamingSearch`)
- Route updates to `/media/search/:query?scope=x` on search

### Home Screen (No Active Search)

Three sections, vertically stacked:

1. **Continue** — items with partial progress
   - Video: `resumePosition > 0`
   - Readable: `resumeCfi` exists
   - Readalong/singalong: partial playback
   - Shows thumbnail, title, progress bar, resume button

2. **Recently Played** — completed items
   - Thumbnails, tappable to replay
   - Source badge, format badge

3. **Recent Searches** — curated query history
   - Only saves when: user searches AND selects/plays a result
   - Tappable to re-execute search
   - Max ~10 entries, most recent first

### Search Results

- Results render as scrollable list with thumbnails, source badges, format badges
- Each result has action buttons: Play, Play Next, Add to Queue
- Tapping result title/thumbnail navigates to `/media/view/:contentId` (center panel)
- Scope chips above results for filtering by source
- "Queue All" / "Shuffle All" actions on the full result set

### Search as Virtual Container

Search results behave like any `listable` content — same item rendering, same queue actions. Conceptually a transient query container, aligning with the existing `query` driver pattern.

---

## Panel 2: Content Browser (Center)

### Core Component

Renders `ContentDetailView` for the current `/media/view/:contentId` route.

### Content Display

- Hero image + title + metadata (source, format, type, duration)
- Subtitle (artist, album artist, etc.)
- Summary/tagline when available
- Action buttons: Play, Play All, Shuffle, Play Next, Add to Queue
- Children list for containers (albums, episodes, tracks, chapters)

### Navigation

- Drill-down: clicking a child navigates to `/media/view/:childContentId`
- Breadcrumb trail derived from route navigation history
- Back button pops route history
- Browser back works naturally

### Empty State

- Desktop (2-3 col): subtle prompt "Select something to browse"
- Mobile: panel not shown — user sees Search/Home or Player

---

## Panel 3: Player (Right)

### Format-Adaptive Layout

The player panel adapts its internal layout based on the content format of the current queue item:

| Format | Player Area | Queue Area |
|--------|------------|------------|
| `audio` | Large album art + transport controls (prev/play/next) + progress bar + volume | Scrollable queue list below |
| `video` | Video element + transport controls + progress bar | Scrollable queue list below |
| `singalong` | SingalongScroller (full width) | Queue collapsible |
| `readalong` | ReadalongScroller (full width) | Queue collapsible |
| `readable_paged` | PagedReader (full panel height, queue toggle) | Hidden, accessible via toggle |
| `readable_flow` | FlowReader (full panel height, queue toggle) | Hidden, accessible via toggle |
| `image` | ImageDisplay | Queue below |
| `app` | PlayableAppShell | Hidden |

All renderers implement the existing Playable Contract — no changes to renderer interfaces.

### Queue

**Desktop (3-col):** Persistent scrollable list below media area
- Current item highlighted
- Drag-to-reorder
- Remove button per item
- Play Now on tap

**Mobile (1-col):** "Up Next" preview bar showing next track
- Expands to full queue bottom sheet on tap
- Same interactions as desktop queue

**Queue actions from search/browse:**
- "Play Next" — inserts at top of queue (after current)
- "Add to Queue" — appends to bottom of queue

### Fullscreen

- Video: existing fullscreen behavior (position: fixed, inset: 0)
- Readable: analogous fullscreen — reader takes over viewport, dismiss button returns to player panel
- Both are "expand from player panel" — same conceptual action

### Mini Player (Collapsed State)

Shows when the player panel is not visible (mobile browsing, tablet mode):

**Audio:** Bottom bar (56px)
- Thumbnail, title, play/pause button
- Thin progress line at top
- Tap anywhere (except controls) expands to full player

**Video:** Floating PiP thumbnail
- Small video preview in corner
- Tap expands to full player

**Visibility rules:**
- Mobile: always visible at bottom when something is playing and user is on Search/Home or Content Browser
- Tablet (2-col): always visible at bottom (player panel hidden)
- Desktop (3-col): not needed — player panel always visible

---

## Component Reuse & Migration

### Keep As-Is

| Component/Hook | Role |
|---------------|------|
| `useStreamingSearch` | SSE streaming search — drives search results |
| `useMediaQueue` | Server-side queue + WebSocket sync |
| `useContentDetail` | Fetches item metadata + children for Content Browser |
| `useScopePrefs` | Scope dropdown persistence (localStorage) |
| `ScopeDropdown` | Scope selector in search bar |
| `ScopeChips` | Result filtering chips |
| `MediaAppPlayer` | Format-dispatching renderer |
| `QueueItem` | Individual queue row |
| `CastButton` | Cast-to-device action |
| `MediaAppContext` | Queue + playerRef provider |

### Refactor

| Component | Change |
|-----------|--------|
| `ContentBrowser` | Split into Search/Home panel. Keep search + scope logic. Replace browse categories with Continue/Recently Played/Recent Searches sections. |
| `ContentDetailView` | Becomes Content Browser panel body. Add breadcrumb bar. |
| `NowPlaying` | Refactor into Player panel media area. Keep transport controls, playback state reporting. |
| `MiniPlayer` | Add PiP variant for video content. |
| `QueueDrawer` | Becomes inline queue in player panel (desktop) + bottom sheet (mobile). |

### Remove

| Component | Reason |
|-----------|--------|
| `PlayerSwipeContainer` | Replaced by responsive panel layout |
| `DevicePanel` | Deferred — reintroduce later as cast/device feature |
| `DeviceCard` | Deferred with DevicePanel |
| `DevicePicker` | Deferred with DevicePanel |

### Replace

| Hook | Change |
|------|--------|
| `useContentBrowse` | Replace with route-based navigation. Breadcrumbs derived from history stack. |

---

## New Infrastructure

### Recent Searches Store

- localStorage key: `media-recent-searches`
- Max 10 entries
- Entry format: `{ query: string, scope: string, timestamp: number }`
- Only recorded when user searches AND interacts with a result (play, queue, or navigate to view)

### Continue Watching/Reading

- API endpoint: `GET /api/v1/media/continue` (or derive from existing progress/watch state)
- Returns items with partial progress across all content types
- Frontend sorts by most recently accessed

### Recently Played

- API endpoint: `GET /api/v1/media/recent` (or derive from session/play history)
- Returns recently completed items
- Frontend shows thumbnails in horizontal scroll or grid

### Breadcrumb History

- In-memory stack maintained by a `useNavigationBreadcrumbs` hook
- Listens to route changes, builds breadcrumb trail
- Each entry: `{ contentId, title, route }`
- Reset when user starts a new search or returns to home

---

## Data Flow

```
Search/Home                    Content Browser              Player
---                            ---                          ---
searchText -> useStreamingSearch
  -> results[]
    -> tap result ------------> navigate(/media/view/:id)
                                 -> useContentDetail(id)
                                   -> data, children
                                     -> tap Play ----------> queue.playNow()
                                     -> tap child ---------> navigate(/media/view/:childId)
                                     -> tap Queue ---------> queue.addItems()
                                                              -> Player renders currentItem
                                                              -> Playable Contract callbacks
                                                              -> onItemEnd -> queue.advance()
```

---

## Migration Strategy

This is a UI-only redesign. No backend API changes required. The existing content model, Play API, search streaming, queue WebSocket sync, and Playable Contract all remain unchanged.

The migration replaces:
- `MediaApp.jsx` layout and mode switching logic
- `MediaApp.scss` layout styles (component styles mostly preserved)
- `ContentBrowser.jsx` home screen content
- Navigation model (mode-based -> route-based)

It preserves:
- All content renderers (VideoPlayer, AudioPlayer, SingalongScroller, etc.)
- Queue management (useMediaQueue, server-side state)
- Search infrastructure (useStreamingSearch, scope system)
- Content resolution (ContentIdResolver, 5-layer chain)
- Playback broadcasting (usePlaybackBroadcast)
