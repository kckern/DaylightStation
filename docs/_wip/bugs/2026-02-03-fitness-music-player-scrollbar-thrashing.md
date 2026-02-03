# Bug Report: Fitness Music Player Scrollbar Thrashing

**Date:** 2026-02-03  
**Severity:** Medium  
**Status:** Diagnosed  
**Component:** `frontend/src/apps/fitness/session/FitnessMusicPlayer.jsx`

## Summary

The fitness sidebar music player is causing scrollbar thrashing on `fitness-sidebar-container`. The scrollbars flash on and off repeatedly due to layout measurement loops in the marquee text animation, causing width/height instability that propagates to the parent container.

## Symptoms

- Parent container (`fitness-sidebar-container`) displays scrollbars intermittently
- Scrollbars appear and disappear rapidly (thrashing)
- Issue occurs when track changes or during marquee text animation
- Visual jitter in the music player area

## Affected Components

| Component | File | Issue |
|-----------|------|-------|
| `FitnessMusicPlayer` | [frontend/src/apps/fitness/session/FitnessMusicPlayer.jsx](frontend/src/apps/fitness/session/FitnessMusicPlayer.jsx) | Marquee measurement loop |
| CSS: `.fitness-sidebar-container` | [frontend/src/apps/fitness/session/scss/FitnessSession.scss:1119-1250](frontend/src/apps/fitness/session/scss/FitnessSession.scss#L1119-L1250) | Missing layout containment |
| CSS: `.fitness-music-player-container` | [frontend/src/apps/fitness/session/scss/FitnessSession.scss:1608-1660](frontend/src/apps/fitness/session/scss/FitnessSession.scss#L1608-L1660) | Missing size containment |
| CSS: `.music-player-content` | [frontend/src/apps/fitness/session/scss/FitnessSession.scss:1648-1658](frontend/src/apps/fitness/session/scss/FitnessSession.scss#L1648-L1658) | Dynamic sizing |

## Root Cause Analysis

### Primary Cause: Layout Measurement Loop

The marquee text animation uses a `useEffect` hook that creates a layout thrashing cycle:

```jsx
// FitnessMusicPlayer.jsx:110-125
useEffect(() => {
  const measureOverflow = () => {
    if (!titleContainerRef.current || !marqueeTextRef.current) return;
    
    const containerWidth = titleContainerRef.current.offsetWidth;
    const textWidth = marqueeTextRef.current.scrollWidth;  // ⚠️ Forces layout
    const overflow = textWidth - containerWidth;
    
    setScrollDistance(overflow > 0 ? -overflow : 0);  // ⚠️ Triggers re-render
  };
  
  measureOverflow();
  const timeoutId = setTimeout(measureOverflow, 100);  // ⚠️ Measures again after 100ms
  
  return () => clearTimeout(timeoutId);
}, [currentTrack?.title, currentTrack?.label]);
```

**The Problem:**
1. Track changes → `useEffect` runs
2. Queries `scrollWidth` → forces synchronous layout calculation
3. Sets `scrollDistance` state → triggers re-render
4. Runs again after 100ms timeout
5. During measurement, `scrollWidth` can temporarily differ from final rendered size
6. If parent has `overflow: auto`, scrollbar appears/disappears

### Contributing Factors

**1. Missing CSS Containment**
- No `contain: layout` on `.fitness-music-player-container`
- Internal layout changes affect parent container
- Allows dimension changes to propagate upward

**2. Multiple Context-Specific Height Overrides**
Three different heights based on context could cause mid-render switching:
- Default: 80px (line 1648)
- Voice memo container: 40px (line 3200)
- Player mode: 56px (line 3658)

**3. Conditional Rendering**
```jsx
{controlsOpen && (
  <div className="music-player-expanded">
    // ~200px of additional content
  </div>
)}
```
When `controlsOpen` toggles, container height changes significantly.

**4. Async Album Art Loading**
```jsx
<img src={DaylightMediaPath(`api/v1/content/plex/image/${...}`)} />
```
Images load asynchronously; if not properly sized, can cause layout shift.

## Reproduction Steps

1. Open fitness session with music player enabled
2. Play a track with a long title (triggers marquee)
3. Observe `fitness-sidebar-container` scrollbars flashing
4. Switch tracks rapidly to exacerbate the issue

## Technical Details

### Component Hierarchy
```
fitness-sidebar-container (flex column)
├── fitness-sidebar-treasurebox (flex-shrink: 0)
├── fitness-sidebar-devices (flex: 1, overflow: hidden)
└── fitness-sidebar-music (flex-shrink: 0)
    └── fitness-music-player-container (flex column, overflow: hidden)
        ├── music-player-content (flex row, 80px height)
        │   ├── music-player-artwork (80×80px)
        │   ├── music-player-info (flex: 1, min-width: 0)
        │   │   ├── track-details (overflow: hidden)
        │   │   │   ├── track-title (marquee-text)
        │   │   │   └── track-artist
        │   │   └── track-progress
        │   └── music-player-controls (80×80px)
        └── music-player-expanded (conditional)
```

### Current CSS State
```scss
.fitness-sidebar-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  // ⚠️ No overflow rule specified
}

.fitness-music-player-container {
  overflow: hidden;
  width: 100%;
  height: auto;  // ⚠️ Dynamic height
  min-height: 80px;
  // ⚠️ No containment
}

.music-player-content {
  display: flex;
  width: 100%;
  height: 80px;
  min-width: 0;
}
```

## Proposed Solution

### 1. Add CSS Containment (Priority: High)

**File:** `frontend/src/apps/fitness/session/scss/FitnessSession.scss`

```scss
.fitness-music-player-container {
  contain: layout size;  // Isolate internal layout changes
  // ... existing rules
}

.fitness-sidebar-music {
  contain: layout;
  // ... existing rules
}

.track-title,
.track-artist {
  width: 100%;
  contain: inline-size;  // Pre-allocate width for text measurement
}
```

### 2. Fix Overflow Rules (Priority: High)

```scss
.fitness-sidebar-container,
.fitness-sidebar-music,
.music-player-content {
  overflow: hidden;  // Never use 'auto'
}
```

### 3. Debounce Marquee Measurement (Priority: High)

**File:** `frontend/src/apps/fitness/session/FitnessMusicPlayer.jsx`

Replace the current `useEffect` with double-RAF pattern:

```jsx
useEffect(() => {
  const measureOverflow = () => {
    if (!titleContainerRef.current || !marqueeTextRef.current) return;
    
    const containerWidth = titleContainerRef.current.offsetWidth;
    const textWidth = marqueeTextRef.current.scrollWidth;
    const overflow = textWidth - containerWidth;
    
    setScrollDistance(overflow > 0 ? -overflow : 0);
  };
  
  // Double RAF ensures measurement happens after paint
  const rafId = requestAnimationFrame(() => {
    requestAnimationFrame(measureOverflow);
  });
  
  return () => cancelAnimationFrame(rafId);
}, [currentTrack?.title, currentTrack?.label]);
```

**Alternative:** Use `ResizeObserver` for more efficient measurements:

```jsx
useEffect(() => {
  if (!titleContainerRef.current || !marqueeTextRef.current) return;
  
  const observer = new ResizeObserver(() => {
    const containerWidth = titleContainerRef.current.offsetWidth;
    const textWidth = marqueeTextRef.current.scrollWidth;
    const overflow = textWidth - containerWidth;
    setScrollDistance(overflow > 0 ? -overflow : 0);
  });
  
  observer.observe(titleContainerRef.current);
  
  return () => observer.disconnect();
}, [currentTrack?.title, currentTrack?.label]);
```

### 4. Add Explicit Image Dimensions (Priority: Medium)

```jsx
<img
  src={imageSrc}
  width="80"
  height="80"
  alt="Album artwork"
  className="artwork-image"
/>
```

## Testing

### Automated Test
Existing test at:
```
frontend/src/apps/fitness/tests/live/flow/music/music-player-width-stability.runtime.test.mjs
```

Run with:
```bash
npx playwright test tests/live/flow/music/music-player-width-stability.runtime.test.mjs --headed
```

### Manual Testing Checklist
- [ ] Play track with short title (no marquee needed)
- [ ] Play track with long title (marquee activates)
- [ ] Switch between tracks rapidly
- [ ] Toggle `controlsOpen` expanded panel
- [ ] Monitor scrollbar presence on `fitness-sidebar-container`
- [ ] Check for visual jitter during track changes
- [ ] Verify marquee animation still works smoothly

### Success Criteria
1. No scrollbars appear on `fitness-sidebar-container` during normal operation
2. No flickering or thrashing of scrollbars during track changes
3. Marquee animation remains smooth
4. Music player dimensions remain stable

## Related Issues

- Similar containment issue in `device-wrapper` (see 2026-02-03-fitness-device-wrapper-dry-violation.md)
- General CSS containment patterns needed across fitness sidebar components

## Implementation Priority

**Priority Order:**
1. CSS containment + overflow fixes (quick win, low risk)
2. Debounce marquee measurement (requires component testing)
3. Image dimension attributes (minor improvement)

**Estimated Effort:** 2-3 hours
- CSS changes: 30 minutes
- JavaScript refactor: 1 hour
- Testing: 1-1.5 hours

## Notes

- The project already has awareness of this issue (test exists)
- CSS `contain` property has excellent browser support (Chrome 52+, Firefox 69+, Safari 15.4+)
- Consider extending containment strategy to other fitness sidebar components
- May want to audit all marquee/scrolling text implementations for similar issues
