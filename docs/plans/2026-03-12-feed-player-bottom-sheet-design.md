# Feed Player Bottom Sheet — Design

**Goal:** Replace the tap-to-open behavior on the feed mini bar with an industry-standard expandable bottom sheet player (Spotify/Apple Music pattern), and fix the broken speed button.

---

## Current State

- `FeedPlayerMiniBar` — fixed bottom bar with play/pause, speed cycle, seek bar, time, close
- `PersistentPlayer` — hidden div with lazy-loaded Player component, keeps audio alive
- `FeedPlayerContext` — manages activeMedia, pausedMedia, volume, speed, muted
- `usePlaybackObserver` — polls playerRef for playback state, drives progress bar via rAF
- Speed button calls `cycleSpeed()` which updates context state + localStorage but **never sets `el.playbackRate`** on the media element (broken)

## Architecture

The bottom sheet is a new UI component rendered as a sibling of the mini bar in `FeedApp.jsx`. It reads from the same `useFeedPlayer()` context and `usePlaybackObserver()` hook. No new context or state management needed — just a local `sheetOpen` boolean in `FeedApp`.

- Mini bar hides when sheet is open
- Sheet closes → mini bar reappears with continuous progress
- PersistentPlayer is unaffected (always rendered, always playing)

## Components

### FeedPlayerSheet.jsx

Bottom sheet overlay with full player controls.

**Layout (top to bottom):**

1. **Drag handle** — centered pill (40×4px, rounded, `#555`) at top of sheet. Swipe target for dismiss gesture.
2. **Cover art** — large thumbnail (~200×200px, rounded 12px). Uses same `proxyImage()` logic as mini bar thumb. Fallback: source icon or generic audio wave SVG.
3. **Title + source** — title (white, 1.1rem, bold, 2-line clamp), source name below (gray, 0.8rem).
4. **Seek scrubber** — full-width track with draggable thumb. Time labels: elapsed left, remaining right. While dragging, time updates live to show seek target.
5. **Transport row** — centered: skip-back 15s button, large play/pause button (48px circle), skip-forward 15s button.
6. **Settings row** — speed selector (5 pill buttons: 1x, 1.25x, 1.5x, 1.75x, 2x, active one highlighted), volume slider.
7. **Resume button** — shown only when `pausedMedia` exists. "↩ Resume: {title}" full-width button at bottom.

**Styling:**
- `user-select: none` on entire sheet and mini bar
- Background: `#1a1b1e` (matches existing dark theme)
- Border-radius: `16px 16px 0 0` on sheet
- Scrim: `rgba(0,0,0,0.5)` overlay behind sheet, tapping scrim closes sheet
- Sheet height: auto-sized by content (~60% viewport)

### Interactions

**Opening:**
- Tap mini bar thumbnail or title (existing `onOpen` prop)
- Swipe up on mini bar (touchstart/touchmove/touchend, vertical delta < -60px triggers open)

**Closing:**
- Tap scrim overlay
- Tap chevron/collapse button at top of sheet
- Swipe down on sheet (vertical delta > 80px triggers close)

**Animations:**
- Open: sheet slides up from bottom with CSS `transform: translateY(0)` + `transition: transform 300ms cubic-bezier(0.32, 0.72, 0, 1)` (iOS spring curve)
- Close: sheet slides down with same easing
- Scrim fades in/out with `transition: opacity 300ms ease`
- Mini bar fades out/in with `transition: opacity 150ms ease`

### Seek Scrubber

- Track: full-width, 4px height, `#333` background
- Fill: `#228be6` (matches existing progress bar)
- Thumb: 16px circle, `#fff`, appears on touch/hover
- On drag: update time label live, don't actually seek until touchend/mouseup (prevents audio stutter)
- Uses same `playerRef.current.seek(t)` as existing seek

### Speed Selector

- 5 pill buttons in a row, evenly spaced
- Active speed: `#228be6` background, white text
- Inactive: transparent background, gray text, border
- On tap: calls unified speed setter that updates context state AND `el.playbackRate`

### Skip Buttons

- Skip back: `playerRef.current.seek(currentTime - 15)`
- Skip forward: `playerRef.current.seek(currentTime + 15)`
- SVG icons: circular arrow with "15" text inside

## Speed Bug Fix

The root cause: `FeedPlayerContext.cycleSpeed()` updates `state.speed` and localStorage, but never touches the actual media element. `usePlaybackObserver.setSpeed()` does touch `el.playbackRate` but is never called.

**Fix:** Add an effect in `FeedApp` (or `usePlaybackObserver`) that syncs `context.speed` → `el.playbackRate` whenever `context.speed` changes. This fixes:
- Existing mini bar speed button
- New sheet speed selector
- Speed persisted across sessions (localStorage → applied on mount)

```
useEffect(() => {
  const el = playerRef.current?.getMediaElement?.();
  if (el && speed) el.playbackRate = speed;
}, [speed, playerRef, activeMedia]);
```

Remove the duplicate `speed` state from `usePlaybackObserver` — context is the single source of truth.

## Files

| Action | File |
|--------|------|
| Create | `frontend/src/modules/Feed/players/FeedPlayerSheet.jsx` |
| Create | `frontend/src/modules/Feed/players/FeedPlayerSheet.scss` |
| Modify | `frontend/src/Apps/FeedApp.jsx` — add sheetOpen state, render sheet, hide mini bar |
| Modify | `frontend/src/modules/Feed/players/FeedPlayerMiniBar.jsx` — add swipe-up gesture, user-select: none |
| Modify | `frontend/src/modules/Feed/players/FeedPlayerContext.jsx` — no change needed (speed fix lives in effect) |
| Modify | `frontend/src/modules/Feed/Scroll/hooks/usePlaybackObserver.js` — remove duplicate speed state, add speed sync effect |
| Modify | `frontend/src/modules/Feed/Scroll/Scroll.scss` — add user-select: none to mini bar |
| Test | `tests/live/flow/feed/feed-detail-playback.runtime.test.mjs` — extend or new test for sheet |

## Non-Goals

- Queue/playlist management (no queue concept in feed player)
- Lyrics or waveform visualization
- Picture-in-picture
- Landscape/tablet layout
