# Persistent Media Player Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move the Player component to Scroll level so playback persists across navigation, enable direct play from feed cards, and upgrade the mini bar to a real player control surface.

**Architecture:** Single persistent `<Player>` at Scroll level, controlled via ref. Two consumer views (mini bar + detail controller) render controls and read playback state. Video viewport relocates between mini bar and detail view via DOM reparenting.

**Tech Stack:** React (ref + imperative handle), requestAnimationFrame for progress, DOM reparenting for video relocation.

---

## 1. Persistent Player Architecture

Move `<Player>` from `PlayerSection` (inside DetailView, unmounts on close) up to `Scroll.jsx`.

```
Scroll.jsx
├── <div className="scroll-view">        (card list)
├── <DetailView> or <DetailModal>        (when urlSlug set)
│   └── <PlayerController>              (controls-only UI, no <Player>)
├── <PersistentPlayer>                   (owns <Player>, always mounted when activeMedia set)
│   └── <Player ref={playerRef}>         (actual audio/video element)
└── <FeedPlayerMiniBar>                  (thumbnail, play/pause, progress)
```

- `PersistentPlayer`: thin wrapper. Visually hidden for audio; for video, renders inside mini bar's expanded area.
- `playerRef`: shared ref. Mini bar and detail controller both call `playerRef.current.play()`, `.pause()`, `.getCurrentTime()`, etc.
- `activeMedia` state expands from `{ item }` to `{ item, contentId }`.
- Playback observables (`playing`, `currentTime`, `duration`) derived from polling the ref — not stored as activeMedia fields.

## 2. Card-Level Play

Add a direct play action on the hero image play overlay in FeedCard.

- `renderFeedCard` gets a new `onPlay` prop from Scroll.
- The play triangle overlay gets its own `onClick` with `e.stopPropagation()` — starts playback without navigating to detail.
- Tapping anywhere else on the card still opens detail view.
- When `onPlay` fires: Scroll sets `activeMedia`, persistent player mounts, mini bar appears.
- No visual change to the card — same play triangle. Behavioral change only.

## 3. Enhanced Mini Bar

Transform from text-only bookmark to real control surface.

**Audio mode** (compact):
```
┌──────────────────────────────────────────┐
│ [thumb] Source · Title          ▶/⏸  ✕  │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░ │
└──────────────────────────────────────────┘
```
- 40x40 thumbnail (`item.image`)
- Source + title (truncated)
- Play/pause toggle
- Close button
- Thin progress bar along bottom edge

**Video mode** (expands upward):
```
┌──────────────────────────────────────────┐
│            [video viewport]              │
├──────────────────────────────────────────┤
│ [thumb] Source · Title          ▶/⏸  ✕  │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░ │
└──────────────────────────────────────────┘
```
- `<video>` element from PersistentPlayer renders in expanded area above controls
- Same control row underneath
- Tapping video area opens detail view for larger viewport

Progress bar updates via `requestAnimationFrame` with direct DOM manipulation (no React re-renders).

## 4. Detail View Controller

When detail is open for the playing item, PlayerSection renders controls-only UI (no `<Player>` instance).

**Audio:** Large hero/album art, title, seekable scrubber bar, play/pause + skip, time labels.

**Video:** The `<video>` element relocates from mini bar into detail view (larger viewport) via DOM reparenting (`detailViewportRef.current.appendChild(playerRef.current.getMediaElement())`). Same scrubber + controls underneath. On detail close, video moves back to mini bar.

**Non-playing item's detail:** Shows existing play button. Pressing it starts playback on persistent player (replaces current media).

## 5. State Flow

```
Scroll.jsx
├── activeMedia: { item, contentId }           ← what to play
├── playerRef: ref to <Player>                 ← imperative control
├── playbackState: { playing, currentTime, duration }  ← derived from player
```

1. **Start**: `setActiveMedia({ item, contentId })` → PersistentPlayer mounts → player starts.
2. **Poll**: `requestAnimationFrame` loop reads `getCurrentTime()` / `getDuration()`, writes directly to DOM (progress bar). Coarser `setInterval` (~1s) updates React state for play/pause icon + time labels.
3. **Play/pause**: Consumer calls `playerRef.current.toggle()`. 1s interval picks up new state.
4. **Seek**: Detail scrubber calls `playerRef.current.seek(t)`.
5. **Stop**: Close button → `setActiveMedia(null)` → PersistentPlayer unmounts.
6. **Track ends**: Player's `onEnd` → `setActiveMedia(null)`.

No new context/provider needed. `playerRef` and `playbackState` passed as props to mini bar and detail controller.
