# MediaApp Frontend Overhaul — Content-First UX

> Restructure MediaApp from an empty-state dead end into a content-first media player
> with Spotify-style navigation.

**Date:** 2026-02-27
**Status:** Design
**Builds on:** `docs/roadmap/2026-02-26-media-app-design.md`
**API surface:** `backend/src/4_api/v1/routers/media.mjs` (unchanged)

---

## Problem

Opening `/media` with nothing playing shows "Nothing playing — Use ?play=hymn:198
to start playback" with no buttons, no search, no way to discover or play content.
The ContentBrowser, QueueDrawer, and DevicePanel all exist but are hidden behind
toggle buttons that only appear when something is already playing.

## Solution

Two-mode navigation with a MiniPlayer bridge:

1. **Browse Mode** (default) — ContentBrowser is the full-screen main view
2. **Player Mode** (expanded) — three swipeable pages: Queue | NowPlaying | Devices
3. **MiniPlayer** — bottom bar connecting the two modes

---

## Navigation Model

### States

```
                    ┌──────────────┐
                    │  Browse Mode │  ← default, always accessible
                    │              │
                    │ ContentBrow. │
                    │ + MiniPlayer │
                    └──────┬───────┘
                           │ tap MiniPlayer
                           ▼
                    ┌──────────────┐
                    │ Player Mode  │
                    │              │
                    │ ←Queue│NP│Dev→ │  ← swipe between pages
                    │              │
                    └──────┬───────┘
                           │ pull down / tap chevron
                           ▼
                    ┌──────────────┐
                    │  Browse Mode │
                    └──────────────┘
```

### Transitions

| Action | From | To |
|--------|------|----|
| Open `/media`, nothing playing | — | Browse Mode (no MiniPlayer) |
| Tap play on a search result | Browse Mode | Browse Mode + MiniPlayer appears |
| Tap MiniPlayer | Browse Mode | Player Mode (NowPlaying centered) |
| Swipe left in Player Mode | NowPlaying page | Queue page |
| Swipe right in Player Mode | NowPlaying page | Devices page |
| Pull down / tap chevron | Player Mode | Browse Mode + MiniPlayer |
| Current item ends, queue empty | Any | Browse Mode (no MiniPlayer) |

### State Shape

```js
// Replaces current: view ('now-playing' | 'mini') + 3 drawer booleans
const [mode, setMode] = useState('browse');  // 'browse' | 'player'
// playerPage tracked via scroll-snap position, not React state
```

---

## Browse Mode (Home Screen)

The primary view. Always mounted, scrollable, with search and browsable content.

### Layout

```
┌─────────────────────────────┐
│  🔍 Search media...          │  ← sticky header
│  [filter] [chips] [here]    │  ← from config
├─────────────────────────────┤
│                             │
│  ▶ Recently Played          │  ← horizontal scroll row
│  ┌─────┐ ┌─────┐ ┌─────┐   │
│  │thumb│ │thumb│ │thumb│ →  │
│  │title│ │title│ │title│    │
│  └─────┘ └─────┘ └─────┘   │
│                             │
│  (when typing: streaming    │
│   search results replace    │
│   sections below)           │
│                             │
│  🎵 Category Label  →       │  ← config-driven browse rows
│  🎥 Category Label  →       │     tap to drill in
│  🎶 Category Label  →       │
│                             │
├─────────────────────────────┤
│ 🎨 Song Title    ▶  ═══     │  ← MiniPlayer (when playing)
└─────────────────────────────┘
```

### Config-Driven Categories

Browse rows and search filter chips come from backend config, not hardcoded:

```yaml
# data/household/apps/media/config.yml
browse:
  - source: plex
    mediaType: audio
    label: Browse Music
    icon: music
    searchFilter: true     # shows as filter chip
  - source: plex
    mediaType: video
    label: Browse Video
    icon: video
    searchFilter: true
  - source: singalong
    label: Browse Hymns
    icon: hymn
    searchFilter: true
  - source: readable
    label: Browse Books
    icon: book
    searchFilter: true
```

**Endpoint:** `GET /api/v1/media/config` returns this config (or extend
existing config endpoint). Frontend renders whatever categories are configured.

**Filter chips:** "All" is always first. Additional chips derived from entries
with `searchFilter: true`. Each chip injects `source` and `mediaType` params
into `useStreamingSearch`.

### Behavior

- Typing in search replaces browse sections with streaming results
- Clearing search restores browse sections
- "Recently Played" sourced from queue history (last N distinct contentIds)
- Browse rows tap-to-drill using existing `useContentBrowse`
- Each result shows: thumbnail, title, source badge, action buttons
- Bottom padding accounts for MiniPlayer height when playing

---

## Player Mode (Swipe Pages)

Full-screen player with three horizontally swipeable pages.

### Layout

```
┌─────────────────────────────────────────────┐
│              ▼ (collapse handle)             │
├─────────┬───────────────────┬───────────────┤
│  QUEUE  │    NOW PLAYING    │    DEVICES    │
│         │                   │               │
│ 1. Song │  ┌─────────────┐  │  📺 TV        │
│ 2. Song │  │             │  │   Playing...  │
│ 3. Song │  │  album art  │  │               │
│ 4. Song │  │             │  │  🖥 Office    │
│ 5. Song │  └─────────────┘  │   Idle        │
│         │                   │               │
│ ♻ 🔀 🗑  │  Song Title      │  📱 Phone     │
│         │  Artist           │   Playing...  │
│         │  ━━━━●─────────   │               │
│         │  ⏮   ▶   ⏭       │               │
│         │                   │               │
│         │     ○  ●  ○       │               │
└─────────┴───────────────────┴───────────────┘
```

### Swipe Implementation

CSS `scroll-snap-type: x mandatory` on a horizontal scroll container with three
`scroll-snap-align: start` children, each `width: 100%`. Native scroll-snap
provides physics-based swiping with snap points. No external library needed.

```css
.player-swipe-container {
  display: flex;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.player-swipe-container::-webkit-scrollbar { display: none; }

.player-swipe-page {
  flex: 0 0 100%;
  scroll-snap-align: start;
  overflow-y: auto;
}
```

### Dot Indicators

Three dots below NowPlaying content. Active page tracked via
`IntersectionObserver` on each page element (threshold 0.5). Tapping a dot
scrolls to that page via `scrollIntoView({ behavior: 'smooth' })`.

### Collapse Gesture

- Chevron/handle at top of Player Mode — tap to collapse
- Short downward swipe (>80px threshold) triggers collapse on mobile
- Collapses to Browse Mode + MiniPlayer

### Page Contents

Each page renders the **existing component content** without overlay wrappers:

| Page | Source Component | Changes |
|------|-----------------|---------|
| Queue | `QueueDrawer.jsx` | Remove overlay/drawer wrapper. Render queue list + controls as inline scrollable content. Drop `open`/`onClose` props. |
| NowPlaying | `NowPlaying.jsx` | Remove search/queue/device toggle buttons (those panels are swipe-adjacent now). Keep all transport controls, progress bar, fullscreen behavior. |
| Devices | `DevicePanel.jsx` | Remove side-drawer wrapper. Render device list + browser clients as inline scrollable content. Drop `open`/`onClose` props. |

---

## MiniPlayer

Bottom bar in Browse Mode when something is playing.

### Layout

```
┌─────────────────────────────────────┐
│ ┌─────┐                            │
│ │thumb│  Song Title        ▶  ───  │
│ └─────┘  Artist / Source           │
└─────────────────────────────────────┘
  ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
  thin progress bar (full width)
```

### Interactions

- Tap anywhere except play/pause → expand to Player Mode
- Play/pause button → toggle playback, stay in Browse Mode
- Progress bar is display-only (not seekable)

### Transition Animation

Expand: thumbnail + title cross-fade/scale into NowPlaying layout.
Container animates from `height: 64px` at bottom to `height: 100vh`.
Collapse: inverse animation.

---

## Component Changes Summary

| Component | Current Role | New Role | Change Size |
|-----------|-------------|----------|-------------|
| `MediaApp.jsx` | 3 drawer states + view toggle | 2-mode state (`browse`/`player`) | Medium — simplifies |
| `ContentBrowser.jsx` | Overlay drawer | Main view, always mounted | Medium — add browse rows, remove overlay |
| `QueueDrawer.jsx` | Overlay drawer | Inline swipe page | Small — remove overlay wrapper |
| `DevicePanel.jsx` | Overlay drawer | Inline swipe page | Small — remove overlay wrapper |
| `NowPlaying.jsx` | Conditional render with toggles | Center swipe page | Small — remove toggle buttons |
| `MiniPlayer.jsx` | Shows when `view !== 'now-playing'` | Shows in browse mode when playing | Small — update show condition |
| `MediaApp.scss` | Drawer overlay styles | Scroll-snap, browse layout, transitions | Large — new layout system |

### New Components

| Component | Purpose | Size |
|-----------|---------|------|
| `PlayerSwipeContainer.jsx` | Horizontal scroll-snap wrapper, dot indicators, collapse handle | ~100-120 lines |

### New Backend

| Artifact | Purpose | Size |
|----------|---------|------|
| `GET /api/v1/media/config` | Return browse categories from `config.yml` | ~20 lines in router |
| `data/household/apps/media/config.yml` | Browse category definitions | ~20 lines YAML |

### Unchanged

- All hooks: `useMediaQueue`, `usePlaybackBroadcast`, `useDeviceMonitor`,
  `useContentBrowse`, `useMediaUrlParams`, `useMediaClientId`, `useDeviceIdentity`
- `MediaAppPlayer.jsx`, `MediaAppContext.jsx`
- `QueueItem.jsx`, `DeviceCard.jsx`, `CastButton.jsx`, `DevicePicker.jsx`
- Backend queue API (`media.mjs` router)
- All backend services and domain entities

---

## Implementation Order

1. **Config endpoint + YAML** — browse categories config, `GET /api/v1/media/config`
2. **ContentBrowser restructure** — promote to main view, add browse rows from config, remove overlay wrapper
3. **MediaApp state refactor** — replace 3 drawer booleans + view with `mode` state
4. **PlayerSwipeContainer** — new scroll-snap wrapper with dot indicators and collapse
5. **QueueDrawer + DevicePanel** — remove overlay wrappers, render as swipe pages
6. **NowPlaying** — remove toggle buttons, adapt to swipe page context
7. **MiniPlayer** — update show logic, wire expand to Player Mode
8. **SCSS overhaul** — scroll-snap layout, browse styles, mode transitions
9. **Polish** — transition animations, edge cases, empty states
