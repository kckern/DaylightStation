# Feed Scroll Architecture

## Layout Structure

```
.feed-app              (height: 100vh, overflow: hidden)
  .feed-tabs           (nav bar — hidden on /feed/scroll routes)
  .feed-content        (flex: 1, overflow-y: auto)  ← SCROLL CONTAINER
    .scroll-layout     (display: flex, min-height: 100vh)
      .scroll-view     (max-width: 540px on mobile, flex: 1 on desktop)
        .scroll-items  (flex column on mobile, position: relative on desktop)
          .scroll-item-wrapper  (container-type: inline-size)
            FeedCard
```

### Critical: Scroll Container

**The scroll container is `.feed-content`, NOT `window`.** The `.feed-app` has `height: 100vh; overflow: hidden`, so the document/window never scrolls. All scrolling happens on `.feed-content` which has `overflow-y: auto`.

This means:
- Use `el.scrollTop` (not `window.scrollY`) to read scroll position
- Use `el.scrollTop = y` (not `window.scrollTo()`) to set scroll position
- Use `el.scrollHeight` (not `document.documentElement.scrollHeight`) for content height
- Attach scroll listeners to `.feed-content` (not `window`)

Helper in `Scroll.jsx`:
```javascript
function getScrollEl() { return document.querySelector('.feed-content'); }
```

The `usePerfMonitor` hook also uses this pattern:
```javascript
const scrollEl = document.querySelector('.feed-content') || window;
```

## Desktop vs Mobile Layout

### Mobile (< 900px)
- Cards in flexbox column (`flex-direction: column; gap: 3px`)
- Card widths: 100% of `.scroll-view` (max 540px)
- `getItemStyle()` returns `{}` — no absolute positioning
- Scroll position depends on card heights (flexbox flow)
- Detail view: scroll-view gets `display: none`, DetailView renders in its place

### Desktop (>= 900px)
- Masonry layout with absolute positioning
- Container has explicit pixel height from column calculations
- `getItemStyle()` returns `{ position: absolute, top, left, width }`
- Scroll position independent of individual card heights
- Detail view: modal overlay, scroll-view stays visible

## Masonry Layout (Desktop)

Managed by `useMasonryLayout.js`. Returns `{ containerStyle, getItemStyle, measureRef }`.

### Measurement Cycle
1. Card renders offscreen at `left: -9999px` with `contentVisibility: 'visible'`
2. `ResizeObserver` fires → height stored in `heightMapRef`
3. Card placed in shortest column → position stored in `posMapRef`
4. Container height set to tallest column

### Key Refs
| Ref | Purpose |
|-----|---------|
| `posMapRef` | `id → { top, left, width }` — card positions |
| `heightMapRef` | `id → measured height` — card heights |
| `colHeightsRef` | Running column height totals |
| `lastPosRef` | Last known positions (survives posMap clears) |
| `cardObserversRef` | `id → ResizeObserver` per card |

### Reset Conditions
- **Hard reset** (items changed or column count changed): clears all maps, re-measures
- **Soft reset** (width drift or height change): repositions only, keeps heights

## Scroll Position Restoration

When navigating card → detail → back:

1. **Save**: `handleCardClick` saves `.feed-content.scrollTop` to `savedScrollRef`
2. **Detail open**: `.feed-content.scrollTop = 0` (scroll to top for detail view)
3. **Back**: Effect fires when `urlSlug` becomes null, restores `scrollTop` with retry

```
save: scrollY=2656, scrollHeight=17207
restore: savedY=2656, actualY=2656 (attempt 1)  ← exact match
```

### Why `display: none` works for hiding
On mobile, the scroll-view gets `display: none` when detail opens. When removed:
- Cards re-layout inside `.feed-content`
- `.feed-content.scrollHeight` is immediately correct (reading it forces reflow)
- `scrollTop = savedY` works on first attempt

## Performance Optimizations

### `content-visibility: auto` (Desktop Only)
Applied to `.scroll-item-wrapper` in the `@media (min-width: 900px)` block. Browser skips layout/paint for off-screen cards.

**Why desktop only:** On mobile, card heights determine `.feed-content.scrollHeight`. If `content-visibility` collapses off-screen cards, the scroll height changes and position restoration breaks. On desktop, the container has explicit pixel height from masonry, so individual card rendering doesn't affect scroll.

**Why measuring cards override it:** Cards at `left: -9999px` (measuring phase) set `contentVisibility: 'visible'` inline to force full rendering for accurate height measurement.

### `will-change` Removed
Previously `.scroll-item-wrapper` had `will-change: transform, opacity`, promoting every card to a GPU compositor layer. With 100+ cards, this consumed excessive GPU memory. The swipe-to-dismiss animation uses `element.animate()` which handles layer promotion automatically during animation.

### Scroll Logger Throttled
Scroll activity logging throttled to ~5/sec (200ms debounce) to reduce main-thread work during scrolling.

## Performance Monitoring

`usePerfMonitor.js` tracks:
- **FPS** via `requestAnimationFrame` delta timing
- **Jank** (>50ms = dropped frame, >100ms = logged individually)
- **Long Tasks** via `PerformanceObserver`
- **Scroll smoothness** (jank-during-scroll correlation)
- **DOM node count**, **heap memory** (Chrome only)

Events emitted at `info` level (not `debug`) so they reach the backend session log:
- `perf.snapshot` — periodic summary (every 5s)
- `perf.jank` — individual jank events (>100ms frames)
- `perf.scroll-session` — per-scroll-gesture smoothness

### Baseline Metrics (50 items loaded)
| Metric | Value | Notes |
|--------|-------|-------|
| DOM nodes | ~1838 | All items rendered |
| Scroll height | ~17000px | Mobile, 50 items |
| FPS (idle) | 120 | Normal |
| FPS (batch load) | 35 | During masonry recalc |
| Worst frame | ~2300ms | During new batch + image decode |
| Heap | 38-49 MB | Chrome desktop |

## Infinite Scroll

Uses `IntersectionObserver` on a sentinel div at the bottom of the card list. Threshold: 0.1. Dependencies: `[hasMore, loadingMore, fetchItems, loading]`.

**Important:** Virtualization attempts that use React state for scroll tracking destabilize the sentinel's IntersectionObserver by triggering effect cleanup/reconnect cycles. The `content-visibility: auto` approach avoids this because it's pure CSS with no React state involvement.

## File Map

| File | Purpose |
|------|---------|
| `Scroll.jsx` | Main component — card list, detail routing, infinite scroll |
| `Scroll.scss` | Layout styles, mobile/desktop media queries |
| `hooks/useMasonryLayout.js` | Desktop masonry positioning + ResizeObserver |
| `hooks/usePerfMonitor.js` | FPS/jank/memory performance tracking |
| `hooks/usePlaybackObserver.js` | Media playback state observation |
| `feedLog.js` | Structured logging facade (debug level) |
| `cards/FeedCard.jsx` | Card rendering with progressive image loading |
| `detail/DetailView.jsx` | Mobile detail page (full-page) |
| `detail/DetailModal.jsx` | Desktop detail modal (overlay) |
| `FeedAssemblyOverlay.jsx` | Debug overlay for feed assembly stats |
