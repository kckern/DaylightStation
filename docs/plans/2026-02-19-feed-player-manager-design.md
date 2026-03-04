# Feed Player Manager — Design

**Date:** 2026-02-19
**Status:** Approved

## Problem

- FeedPlayer has no volume control and no persistence for volume/speed preferences
- Scroll and Reader have independent playback — multiple videos can play simultaneously
- No sticky mini-player in Reader; Scroll's mini-bar is tightly coupled to Scroll state
- FeedPlayerMiniBar lives in Scroll/ but is needed across views

## Design Decisions

- **Cross-view player manager** at FeedApp level (not per-view)
- **Pause previous** when a new video starts (one level deep, not a queue)
- **Volume slider** in FeedPlayer control bar
- **Bottom bar** sticky mini-player (same pattern as existing FeedPlayerMiniBar)

## Architecture

### FeedPlayerContext (new)

Provider wraps FeedApp's `<Outlet />`. Owns all playback state:

```
FeedPlayerContext
├── activeMedia: { item, contentId, sourceRef } | null
├── pausedMedia: { item, contentId, position } | null
├── volume: number (0–1, localStorage-backed)
├── speed: number (1/1.25/1.5/1.75/2, localStorage-backed)
├── isPlayerVisible: boolean (IntersectionObserver)
│
├── play(item) → pauses current, sets new active
├── pause() → pauses current
├── resume() → resumes current
├── stop() → clears active
├── resumePaused() → swaps paused↔active
├── setVolume(v) → updates + persists
├── setSpeed(s) → updates + persists
└── registerPlayerRef(ref) → for visibility tracking
```

**localStorage keys:**
- `feedPlayer:volume` — float 0–1, default 1.0
- `feedPlayer:speed` — float, default 1.0

### Preemption Flow

```
play(newItem) called:
  1. activeMedia playing? → pause it, store as pausedMedia (with currentTime)
  2. pausedMedia already existed? → discard it (one level only)
  3. Set newItem as activeMedia, start playback

resumePaused() called:
  1. Pause activeMedia, store as pausedMedia
  2. Restore old pausedMedia as activeMedia at saved position
```

### Sticky Mini-Bar Visibility

Each FeedPlayer calls `registerPlayerRef(domElement)` on mount. Context uses IntersectionObserver on the active player's element. Mini-bar shows when:
- `activeMedia` exists AND
- Player element is not in viewport (or no element registered — e.g., navigated away from view)

Mini-bar hides when player element scrolls back into view.

### FeedPlayer Enhancements

Control bar layout (left to right):
```
[progress bar — full width]
[play/pause] [time / duration] ---- [volume icon + slider] [speed button]
```

- Volume icon: click toggles mute (stores pre-mute volume, restores on unmute)
- Volume slider: `input[type=range]`, styled to match dark overlay
- Speed: same cycle behavior, initial value from context
- Both read/write via `useFeedPlayer()` hook

### Migration — What Moves

| Component/State | From | To |
|----------------|------|----|
| `activeMedia` state | Scroll.jsx local | FeedPlayerContext |
| `PersistentPlayer` render | Scroll.jsx | FeedApp.jsx (inside provider) |
| `FeedPlayerMiniBar.jsx` | `Scroll/` | `players/` (rendered by FeedApp) |
| `usePlaybackObserver` | Scroll hook | Stays in Scroll, reads from context |
| Card `onPlay` | `setActiveMedia(item)` | `context.play(item)` |
| ReaderYouTubePlayer | Independent FeedPlayer | Calls `context.play(item)` |

### File Changes

| File | Action |
|------|--------|
| `Feed/players/FeedPlayerContext.jsx` | **New** — context, provider, useFeedPlayer hook |
| `Feed/players/FeedPlayer.jsx` | **Edit** — volume slider, read volume/speed from context |
| `Feed/players/FeedPlayerMiniBar.jsx` | **Move** from Scroll/, wire to context |
| `Feed/Scroll/Scroll.jsx` | **Edit** — remove local activeMedia, consume context |
| `Feed/Scroll/hooks/usePlaybackObserver.js` | **Edit** — read speed from context |
| `Feed/Reader/ArticleRow.jsx` | **Edit** — call context.play() on YouTube expand |
| `Apps/FeedApp.jsx` | **Edit** — wrap with FeedPlayerProvider, render mini-bar |

### Component Tree (after)

```
FeedApp
├── FeedPlayerProvider          ← new context wrapper
│   ├── PersistentPlayer        ← moved from Scroll (hidden, fixed)
│   ├── FeedLayout
│   │   ├── nav tabs
│   │   └── Outlet
│   │       ├── Scroll → useFeedPlayer()
│   │       ├── Reader → useFeedPlayer()
│   │       └── Headlines
│   └── FeedPlayerMiniBar       ← moved from Scroll, contextual visibility
```

### Constraints

- Only one active + one paused media at a time (not a queue)
- Volume/speed are global preferences, not per-video
- Mini-bar and inline player are mutually exclusive visibility (same as current Scroll behavior)
- IntersectionObserver threshold: 0 (any pixel visible = "in view")
