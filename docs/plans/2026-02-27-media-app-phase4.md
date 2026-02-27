# MediaApp Phase 4 Implementation Plan — Content Format Handling & Fullscreen Polish

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete format-aware fullscreen behavior, transport overlay, expandable scrollers, and format metadata display so MediaApp handles all content types with appropriate UI affordances.

**Architecture:** Fullscreen state is lifted from `MediaAppPlayer` to `NowPlaying`, which owns the state and drives behavior via a `useEffect` on `currentItem.format`. When fullscreen, `NowPlaying` renders a fixed-position overlay for transport controls — no DOM remount, CSS-only. Auto-hide applies only to video; singalong/readalong always show controls.

**Tech Stack:** React hooks, CSS class toggling (`position: fixed; inset: 0`), `setTimeout` for auto-hide, existing `MediaAppPlayer`/`NowPlaying` component tree.

**Design Doc:** `docs/plans/2026-02-27-media-app-phase3-design.md` (same architecture reference)
**Requirements Doc:** `docs/roadmap/2026-02-26-media-app-requirements.md` (section 8)

---

## Current State

`MediaAppPlayer.jsx` already has a partial implementation:
- `isFullscreen` state (internal, not lifted)
- CSS class toggling on wrapper ✓
- Exit button ✓
- **Bug:** auto-fullscreen trigger uses `progressData.currentTime === 0` — fires on first progress event but misses format changes mid-queue

`NowPlaying.jsx` renders transport controls outside `MediaAppPlayer` — they disappear when the player goes fullscreen.

`QueueItem.jsx` already has `{item.format && <span className="queue-item-badge">{item.format}</span>}` ✓

---

## Task 1: Lift Fullscreen State to NowPlaying

**Reqs:** 8.2.1, 8.2.2, 8.1.11, 8.1.12

**Files:**
- Modify: `frontend/src/modules/Media/MediaAppPlayer.jsx`
- Modify: `frontend/src/modules/Media/NowPlaying.jsx`
- Create: `tests/isolated/modules/Media/MediaAppPlayer.test.mjs`

**What it does:** Moves `isFullscreen` state from `MediaAppPlayer` (where it was internal) to `NowPlaying` (which owns `currentItem` and `format`). `MediaAppPlayer` becomes a controlled component. `NowPlaying` drives fullscreen via `useEffect` on format.

**Step 1: Write the test**

```javascript
// tests/isolated/modules/Media/MediaAppPlayer.test.mjs
import { describe, it, expect, vi } from 'vitest';

vi.mock('#frontend/modules/Player/Player.jsx', () => ({
  default: vi.fn(({ play }) => play ? <div data-testid="player">{play.contentId}</div> : null),
}));

describe('MediaAppPlayer', () => {
  it('applies fullscreen class when isFullscreen=true', async () => {
    const { render } = await import('@testing-library/react');
    const { default: MediaAppPlayer } = await import('#frontend/modules/Media/MediaAppPlayer.jsx');
    const { container } = render(
      <MediaAppPlayer contentId="plex:1" format="video" isFullscreen={true} onExitFullscreen={() => {}} />
    );
    expect(container.querySelector('.media-player-wrapper.fullscreen')).toBeTruthy();
  });

  it('does not apply fullscreen class when isFullscreen=false', async () => {
    const { render } = await import('@testing-library/react');
    const { default: MediaAppPlayer } = await import('#frontend/modules/Media/MediaAppPlayer.jsx');
    const { container } = render(
      <MediaAppPlayer contentId="plex:1" format="audio" isFullscreen={false} onExitFullscreen={() => {}} />
    );
    expect(container.querySelector('.media-player-wrapper.fullscreen')).toBeNull();
  });

  it('calls onExitFullscreen when exit button clicked', async () => {
    const { render, screen, fireEvent } = await import('@testing-library/react');
    const { default: MediaAppPlayer } = await import('#frontend/modules/Media/MediaAppPlayer.jsx');
    const onExit = vi.fn();
    render(
      <MediaAppPlayer contentId="plex:1" format="video" isFullscreen={true} onExitFullscreen={onExit} />
    );
    fireEvent.click(screen.getByLabelText('Exit fullscreen'));
    expect(onExit).toHaveBeenCalled();
  });
});
```

**Step 2: Run test — expect FAIL**

```bash
npx vitest run tests/isolated/modules/Media/MediaAppPlayer.test.mjs
```

**Step 3: Refactor MediaAppPlayer to be controlled**

```javascript
// frontend/src/modules/Media/MediaAppPlayer.jsx
import React, { useMemo, forwardRef } from 'react';
import Player from '../Player/Player.jsx';

/**
 * Thin wrapper around Player.jsx for MediaApp.
 * - Single-play mode only (play= prop, never queue=)
 * - Controlled fullscreen: isFullscreen + onExitFullscreen props (state lives in NowPlaying)
 * - Forwards playerRef for external transport controls
 * - Optionally renders renderOverlay() inside fullscreen wrapper (8.1.8)
 *
 * Req: 1.2.3, 8.2.1, 8.2.2
 */
const MediaAppPlayer = forwardRef(function MediaAppPlayer(
  { contentId, format, onItemEnd, onProgress, config, isFullscreen, onExitFullscreen, renderOverlay },
  ref
) {
  const playObject = useMemo(() => {
    if (!contentId) return null;
    return { contentId, ...config };
  }, [contentId, config]);

  if (!playObject) return null;

  return (
    <div className={`media-player-wrapper${isFullscreen ? ' fullscreen' : ''}`}>
      <Player
        ref={ref}
        play={playObject}
        clear={onItemEnd}
        onProgress={onProgress}
        playerType="media"
      />
      {isFullscreen && (
        <>
          <button
            className="media-fullscreen-exit"
            onClick={onExitFullscreen}
            aria-label="Exit fullscreen"
          >
            &times;
          </button>
          {renderOverlay?.()}
        </>
      )}
    </div>
  );
});

export default MediaAppPlayer;
```

**Step 4: Update NowPlaying to own fullscreen state**

In `NowPlaying.jsx`, add `isFullscreen` state and a `useEffect` that drives it from `currentItem.format`. Replace the `MediaAppPlayer` props accordingly.

Add near the top of `NowPlaying` (after existing state declarations):

```javascript
// Fullscreen state — owned here, driven by content format (8.2.1, 8.2.2)
const [isFullscreen, setIsFullscreen] = useState(false);

// Auto-fullscreen for video; reset on format change (8.2.2, 8.1.11)
useEffect(() => {
  if (!currentItem) {
    setIsFullscreen(false);
    return;
  }
  setIsFullscreen(currentItem.format === 'video');
}, [currentItem?.contentId, currentItem?.format]);
```

Update the `MediaAppPlayer` JSX call in NowPlaying to use controlled props:

```jsx
<MediaAppPlayer
  ref={playerRef}
  contentId={currentItem.contentId}
  format={currentItem.format}
  config={currentItem.config}
  onItemEnd={onItemEnd}
  onProgress={handleProgress}
  isFullscreen={isFullscreen}
  onExitFullscreen={() => setIsFullscreen(false)}
/>
```

**Step 5: Run test — expect PASS**

```bash
npx vitest run tests/isolated/modules/Media/MediaAppPlayer.test.mjs
```

**Step 6: Commit**

```bash
git add frontend/src/modules/Media/MediaAppPlayer.jsx frontend/src/modules/Media/NowPlaying.jsx tests/isolated/modules/Media/MediaAppPlayer.test.mjs
git commit -m "refactor(media): 8.2.1, 8.2.2, 8.1.11 lift fullscreen state to NowPlaying, MediaAppPlayer is now controlled"
```

---

## Task 2: Transport Overlay in Fullscreen + Auto-Hide for Video

**Reqs:** 8.1.8, 8.2.4

**Files:**
- Modify: `frontend/src/modules/Media/NowPlaying.jsx`
- Modify: `frontend/src/modules/Media/MediaAppPlayer.jsx` (renderOverlay already wired in Task 1)

**What it does:** When fullscreen, NowPlaying passes its progress + transport controls as a `renderOverlay` prop to `MediaAppPlayer`, which renders them inside the fullscreen wrapper. For video, controls auto-hide after 3s and reappear on tap. For singalong/readalong, they're always visible.

**Step 1: Add overlay state to NowPlaying**

Add after the `isFullscreen` state declaration:

```javascript
// Overlay visibility for video fullscreen auto-hide (8.2.4)
const [overlayVisible, setOverlayVisible] = useState(true);
const overlayTimerRef = useRef(null);

const showOverlay = useCallback(() => {
  setOverlayVisible(true);
  if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
  if (currentItem?.format === 'video') {
    overlayTimerRef.current = setTimeout(() => setOverlayVisible(false), 3000);
  }
}, [currentItem?.format]);

// Reset overlay timer when entering fullscreen
useEffect(() => {
  if (isFullscreen) showOverlay();
  else {
    setOverlayVisible(true);
    if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
  }
  return () => {
    if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
  };
}, [isFullscreen]); // eslint-disable-line react-hooks/exhaustive-deps
```

**Step 2: Extract transport JSX into a renderOverlay function**

In NowPlaying, create a `renderTransportOverlay` function that returns the progress bar + transport controls as a React fragment. This replaces the inline JSX below the player when fullscreen — in fullscreen, it's injected via `renderOverlay`; when embedded, it's rendered normally.

```javascript
const renderTransportOverlay = useCallback(() => (
  <div
    className={`media-fullscreen-controls${!overlayVisible ? ' media-fullscreen-controls--hidden' : ''}`}
    onClick={showOverlay}
  >
    <div className="media-progress" onClick={(e) => { e.stopPropagation(); handleSeek(e); }}>
      <div className="media-progress-bar">
        <div className="media-progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="media-progress-times">
        <span>{formatTime(playbackState.currentTime)}</span>
        <span>{formatTime(playbackState.duration)}</span>
      </div>
    </div>
    <div className="media-transport">
      <button className="media-transport-btn" onClick={onPrev} aria-label="Previous">&#9198;</button>
      <button
        className="media-transport-btn media-transport-btn--primary"
        onClick={handleToggle}
        aria-label={playbackState.paused ? 'Play' : 'Pause'}
      >
        {playbackState.paused ? '\u25B6' : '\u23F8'}
      </button>
      <button className="media-transport-btn" onClick={onNext} aria-label="Next">&#9197;</button>
    </div>
  </div>
), [overlayVisible, showOverlay, handleSeek, progress, playbackState, formatTime, onPrev, handleToggle, onNext]);
```

**Step 3: Pass renderOverlay to MediaAppPlayer and wrap player with tap handler**

Update the `MediaAppPlayer` JSX in NowPlaying:

```jsx
<MediaAppPlayer
  ref={playerRef}
  contentId={currentItem.contentId}
  format={currentItem.format}
  config={currentItem.config}
  onItemEnd={onItemEnd}
  onProgress={handleProgress}
  isFullscreen={isFullscreen}
  onExitFullscreen={() => setIsFullscreen(false)}
  renderOverlay={isFullscreen ? renderTransportOverlay : undefined}
  onPlayerClick={isFullscreen ? showOverlay : undefined}
/>
```

In `MediaAppPlayer.jsx`, add `onPlayerClick` prop wired to the wrapper div:

```jsx
<div
  className={`media-player-wrapper${isFullscreen ? ' fullscreen' : ''}`}
  onClick={onPlayerClick}
>
```

**Step 4: Keep inline progress + transport when NOT fullscreen**

In NowPlaying's return, the existing progress bar and transport div should remain for the non-fullscreen case. They should NOT render when fullscreen (since they're in the overlay). Wrap them:

```jsx
{!isFullscreen && (
  <>
    {/* Progress Bar */}
    <div className="media-progress" onClick={handleSeek}>
      ...
    </div>
    {/* Transport Controls */}
    <div className="media-transport">
      ...
    </div>
  </>
)}
```

**Step 5: Verify build**

```bash
cd frontend && npx vite build --mode development 2>&1 | tail -5
```

**Step 6: Commit**

```bash
git add frontend/src/modules/Media/NowPlaying.jsx frontend/src/modules/Media/MediaAppPlayer.jsx
git commit -m "feat(media): 8.1.8, 8.2.4 add fullscreen transport overlay with auto-hide for video"
```

---

## Task 3: Expandable Fullscreen for Singalong / Readalong

**Reqs:** 8.1.4, 8.1.5, 8.1.6, 8.1.7

**Files:**
- Modify: `frontend/src/modules/Media/NowPlaying.jsx`

**What it does:** For `singalong` and `readalong` formats, shows an expand button in the track-info area. Tapping it sets `isFullscreen = true`. Since fullscreen state already lives in NowPlaying (Task 1), this is a small addition.

**Step 1: Add expand button**

In NowPlaying's track-info section (after the title/source), add:

```jsx
{/* Expand to fullscreen for scrollers (8.1.5, 8.1.7) */}
{!isFullscreen && (currentItem.format === 'singalong' || currentItem.format === 'readalong') && (
  <button
    className="media-expand-btn"
    onClick={() => setIsFullscreen(true)}
    aria-label="Expand to fullscreen"
  >
    &#x26F6;
  </button>
)}
```

**Step 2: Verify build**

```bash
cd frontend && npx vite build --mode development 2>&1 | tail -5
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Media/NowPlaying.jsx
git commit -m "feat(media): 8.1.4-8.1.7 add expand-to-fullscreen button for singalong and readalong formats"
```

---

## Task 4: Format-Appropriate Metadata in Track Info

**Reqs:** 8.1.9

**Files:**
- Modify: `frontend/src/modules/Media/NowPlaying.jsx`

**What it does:** Below the track title, renders format-specific secondary metadata. Uses fields that are actually available on `currentItem` from the queue. Falls back gracefully when fields are absent.

**Format → metadata mapping:**
- `video` — duration from `playbackState.duration` (formatted)
- `audio` — `currentItem.subtitle` (artist/album) if present; falls back to `currentItem.source`
- `singalong` / `hymn` — label "Singalong" with `currentItem.source` if present
- `readalong` / `audiobook` — `currentItem.subtitle` (chapter/episode) if present

**Step 1: Add FormatMetadata component inside NowPlaying.jsx**

Add above the `NowPlaying` component definition:

```javascript
const FormatMetadata = ({ item, duration }) => {
  const { format, subtitle, source } = item;

  if (format === 'video') {
    if (!duration || !isFinite(duration)) return null;
    const m = Math.floor(duration / 60);
    const s = Math.floor(duration % 60);
    return <div className="media-track-meta">{m}:{s.toString().padStart(2, '0')}</div>;
  }

  if (format === 'audio') {
    const meta = subtitle || source;
    return meta ? <div className="media-track-meta">{meta}</div> : null;
  }

  if (format === 'singalong' || format === 'hymn') {
    const meta = subtitle || source;
    return (
      <div className="media-track-meta">
        {meta ? `${meta} · Singalong` : 'Singalong'}
      </div>
    );
  }

  if (format === 'readalong' || format === 'audiobook') {
    const meta = subtitle || source;
    return meta ? <div className="media-track-meta">{meta}</div> : null;
  }

  // Default: show source if available
  return source ? <div className="media-track-meta">{source}</div> : null;
};
```

**Step 2: Use FormatMetadata in NowPlaying track-info section**

Replace the existing `currentItem.source` display with `FormatMetadata`. In NowPlaying's track-details div:

```jsx
<div className="media-track-details">
  <div className="media-track-title">{currentItem.title || currentItem.contentId}</div>
  <FormatMetadata item={currentItem} duration={playbackState.duration} />
</div>
```

**Step 3: Verify build**

```bash
cd frontend && npx vite build --mode development 2>&1 | tail -5
```

**Step 4: Commit**

```bash
git add frontend/src/modules/Media/NowPlaying.jsx
git commit -m "feat(media): 8.1.9 add FormatMetadata for format-appropriate secondary info in track info"
```

---

## Task 5: Format Badge in ContentBrowser Search Results

**Reqs:** 8.1.10

**Files:**
- Modify: `frontend/src/modules/Media/ContentBrowser.jsx`

**What it does:** Adds a format badge to search result items alongside the existing `source-badge`. `QueueItem` already has this (line 40 of QueueItem.jsx) — this brings parity to ContentBrowser.

**Step 1: Add format badge to search-result-meta**

In `ContentBrowser.jsx`, in the `search-result-meta` div (line 114), add after the duration span:

```jsx
{item.format && <span className="format-badge format-badge--{item.format}">{item.format}</span>}
```

The actual JSX (since template literals don't work in JSX className):

```jsx
{item.format && (
  <span className={`format-badge format-badge--${item.format}`}>{item.format}</span>
)}
```

**Step 2: Verify build**

```bash
cd frontend && npx vite build --mode development 2>&1 | tail -5
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Media/ContentBrowser.jsx
git commit -m "feat(media): 8.1.10 add format badge to ContentBrowser search results"
```

---

## Task 6: SCSS — Overlay, Auto-Hide, Format Badges, Expand Button

**Reqs:** 8.2.3 (update), styling for 8.1.8, 8.2.4, 8.1.10, 8.1.5

**Files:**
- Modify: `frontend/src/Apps/MediaApp.scss`

**What it does:** Adds styles for the fullscreen transport overlay (with auto-hide transition), format badges with color coding, expand button, and secondary track metadata.

**Step 1: Append to end of MediaApp.scss**

```scss
// ─── Fullscreen Transport Overlay (8.1.8, 8.2.4) ───────────────────────────

.media-fullscreen-controls {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 1001;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.85));
  padding: 32px 16px 16px;
  transition: opacity 0.3s ease;

  &--hidden {
    opacity: 0;
    pointer-events: none;
  }

  .media-progress {
    margin-bottom: 8px;
  }

  .media-transport {
    justify-content: center;
  }

  .media-transport-btn {
    color: #fff;
    font-size: 24px;
  }

  .media-progress-bar {
    background: rgba(255, 255, 255, 0.3);
  }

  .media-progress-fill {
    background: #1db954;
  }

  .media-progress-times {
    color: rgba(255, 255, 255, 0.8);
  }
}

// ─── Format Badges (8.1.10) ─────────────────────────────────────────────────

.format-badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;

  &--audio    { background: #1a3a5c; color: #5ba3e0; }
  &--video    { background: #3a1a5c; color: #a05be0; }
  &--singalong,
  &--hymn     { background: #1a3a22; color: #1db954; }
  &--readalong,
  &--audiobook { background: #3a2a1a; color: #e0945b; }
}

// QueueItem badge reuses same colors via queue-item-badge
.queue-item-badge {
  @extend .format-badge;
  // format class added dynamically via JS — set defaults here
  background: #2a2a2a;
  color: #888;
  align-self: center;
  flex-shrink: 0;
}

// ─── Expand Button for Scrollers (8.1.5, 8.1.7) ─────────────────────────────

.media-expand-btn {
  background: none;
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #aaa;
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 14px;
  cursor: pointer;
  margin-top: 6px;
  align-self: flex-start;

  &:hover {
    border-color: #1db954;
    color: #1db954;
  }
}

// ─── Format-Appropriate Track Metadata (8.1.9) ───────────────────────────────

.media-track-meta {
  font-size: 12px;
  color: #888;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

**Step 2: Verify build**

```bash
cd frontend && npx vite build --mode development 2>&1 | tail -5
```

**Step 3: Commit**

```bash
git add frontend/src/Apps/MediaApp.scss
git commit -m "style(media): 8.1.8, 8.1.9, 8.1.10, 8.2.4 add fullscreen overlay, format badges, expand button SCSS"
```

---

## Task 7: Docs — Mark Phase 4 Complete in Requirements

**Reqs:** 8.1.1–8.1.12, 8.2.1–8.2.4

**Files:**
- Modify: `docs/roadmap/2026-02-26-media-app-requirements.md`

**What it does:** Update status to "Phase 4 Implemented." Add Phase 4 commit traceability table.

**Step 1: Update status line**

Change:
```
**Status:** Phase 3 Implemented
```
To:
```
**Status:** Phase 4 Implemented
```

**Step 2: Add Phase 4 commits table** after the Phase 3 table

```markdown
### Phase 4 Commits

| Req IDs | Commit | Description |
|---------|--------|-------------|
| 8.2.1, 8.2.2, 8.1.11, 8.1.12 | (hash) | Lift fullscreen state to NowPlaying, controlled MediaAppPlayer |
| 8.1.8, 8.2.4 | (hash) | Fullscreen transport overlay with auto-hide for video |
| 8.1.4–8.1.7 | (hash) | Expand-to-fullscreen for singalong/readalong |
| 8.1.9 | (hash) | FormatMetadata component for format-specific track info |
| 8.1.10 | (hash) | Format badge in ContentBrowser search results |
| styling | (hash) | SCSS for overlay, format badges, expand button |
```

**Step 3: Commit**

```bash
git add docs/roadmap/2026-02-26-media-app-requirements.md
git commit -m "docs(media): update requirements doc with Phase 4 traceability"
```

---

## Parallelism Map

```
Tasks 1, 5     →  independent (run in parallel — different files)
Task 2         →  depends on Task 1 (needs fullscreen state lifted)
Task 3         →  depends on Task 1 (needs isFullscreen in NowPlaying)
Task 4         →  depends on Task 1 (modifies NowPlaying)
Task 6         →  depends on Tasks 2, 3, 4, 5 (styles for new elements)
Task 7         →  last (after all commits)
```

---

## Summary

| Task | Component | Reqs | Dependencies |
|------|-----------|------|-------------|
| 1 | Lift fullscreen state + fix trigger | 8.2.1, 8.2.2, 8.1.11, 8.1.12 | — |
| 2 | Fullscreen transport overlay + auto-hide | 8.1.8, 8.2.4 | 1 |
| 3 | Expand button for singalong/readalong | 8.1.4–8.1.7 | 1 |
| 4 | FormatMetadata component | 8.1.9 | 1 |
| 5 | Format badge in ContentBrowser | 8.1.10 | — |
| 6 | SCSS | styling | 2, 3, 4, 5 |
| 7 | Docs update | all | all |
