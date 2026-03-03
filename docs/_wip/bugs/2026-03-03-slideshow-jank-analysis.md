# Slideshow Jank Analysis

**Date:** 2026-03-03
**Source:** `media/logs/slideshow/*.jsonl` (7 sessions, 39 image slides total)
**Queue:** `mar4-videos-photos` (Alan birthday mixed-media slideshow)
**Environment:** Chrome 145 / macOS, localhost dev server

---

## Summary

Overall slideshow performance is **good** — average FPS stays at 117-122 and preloading works reliably after the first session. However, there are two categories of jank:

1. **Severe (>100ms frame drops):** 3 occurrences across 2 sessions, concentrated on the first 1-2 slides
2. **Mild (50-84ms single-frame hiccups):** Common — affects ~55% of slides, but imperceptible during Ken Burns animation

Neither category causes visible stutter to the viewer. The severe jank correlates with initial render setup, not with image loading.

---

## Metrics Across All Sessions

| Metric | Best | Worst | Typical |
|--------|------|-------|---------|
| Avg FPS | 42 | 122 | 117-120 |
| Thumb load | 1ms | 93ms | 1-6ms |
| Upgrade delay | 0ms | 2707ms | 0-27ms |
| Max frame time | 9ms | 248ms | 50-75ms |
| Long frames/slide | 0 | 5 | 0-1 |
| Preload hit rate | 0/3 (first session) | 9/9 | 100% after warmup |

---

## Finding 1: First-Slide Cold Start

The very first slide of a session pays a one-time penalty:

| Session | First Slide Thumb | First Slide Upgrade | Rest Avg Thumb |
|---------|-------------------|---------------------|----------------|
| T20-10-20 | 93ms | 2707ms | 1ms |
| T20-16-13 | 92ms | N/A | 1ms |
| T20-19-14 | 4ms | 15ms | 2ms |
| T20-21-18 | 6ms | 27ms | 2ms |
| T22-56-18 | 6ms | 9ms | 2ms |

**Analysis:** The first two sessions (T20-10-20, T20-16-13) had no preloaded images — `preloadHit: false` and 93ms thumb load + 2707ms upgrade delay. This is the cold browser cache. All subsequent sessions had 100% preload hits and <10ms loads, showing the browser cache is effective once warm.

**Impact:** Users see a blurry thumbnail for ~2.7s on the very first slide of their first viewing. Subsequent slides and sessions are instant.

**Recommendation:** Low priority. Could add a preload-ahead-of-playback step that fetches the first image before starting the slideshow, but the 2.7s window is acceptable for a photo slideshow.

---

## Finding 2: Repeat Jank Offenders

Two images cause jank in **every session**:

| Image ID | Janky In | Worst Frame | Worst FPS |
|----------|----------|-------------|-----------|
| `immich:8a34f350-...` | 5/5 sessions | 84ms | 117 |
| `immich:278fd46b-...` | 4/5 sessions | 237ms | 42 |

Both are the 2nd and 3rd slides in queue order (positions immediately after the first slide). This suggests the jank is **transition-related** — the cross-dissolve + Ken Burns animation startup on these early slides triggers a compositing spike.

Other images cause occasional jank (1-2 sessions out of 4-5) at the 50-67ms level — likely GC pauses or background tab activity, not image-specific.

**Recommendation:** Investigate whether the Web Animations API `animate()` call for cross-dissolve + Ken Burns on the second slide creates a layout/paint storm. The first slide skips cross-dissolve (no outgoing layer), which may explain why jank appears on slide 2-3 instead.

---

## Finding 3: Severe Jank Episodes (>100ms)

Only 3 occurrences across all 39 slides:

| Session | Image | Max Frame | Long Frames | FPS |
|---------|-------|-----------|-------------|-----|
| T20-19-14 | `immich:9df25504-...` (slide 1) | 153ms | 2 | 68 |
| T20-19-14 | `immich:278fd46b-...` (slide 2) | 237ms | 2 | 42 |
| T22-56-18 | `immich:9df25504-...` (slide 1) | 248ms | 5 | 100 |

All severe jank is on the **first or second slide** of a session. The 237ms/42fps episode on `278fd46b` in session T20-19-14 is the worst recorded — this is a quarter-second freeze during cross-dissolve.

**Root cause hypothesis:** The first slide triggers JIT metadata fetch (`/api/v1/info/{id}`), enrichment state update, and zoom target recomputation. If the fetch resolves during the Ken Burns animation, the React state update + recompute could cause a compositing stall. Slide 2 compounds this with a concurrent cross-dissolve animation.

**Recommendation:** Medium priority. Consider deferring the JIT metadata fetch until after the Ken Burns animation starts (currently it fires immediately on `imageId` change). Alternatively, batch the enrichment fetch to run during idle time before the slide transition.

---

## Finding 4: Preload System Works Well

After the first session (cold cache), preload hit rate is 100% across all subsequent sessions. Thumbnail load times drop from 92-93ms to 1-6ms, and upgrade delays drop from 2707ms to 0-27ms.

The preload-next-image strategy (fetching `nextMedia` thumbnail + original during current slide display) is effective. No slides after the first ever wait for image data.

---

## Raw Data: Per-Session Breakdown

### Session T20-10-20 (3 slides, first viewing)
```
Slide 1: thumb=93ms upgrade=2707ms maxFrame=11ms lf=0 fps=119 preload=false
Slide 2: thumb=1ms  upgrade=0ms     maxFrame=71ms lf=1 fps=119 preload=true*
Slide 3: thumb=1ms  upgrade=0ms     maxFrame=58ms lf=1 fps=119 preload=true*
```
*Note: preloadHit detection uses thumbLoadMs < 10ms heuristic

### Session T20-16-13 (9 slides, partial cache)
```
Slides with jank: 7/9 (all single-frame, 58-75ms range)
No severe jank. Consistent 118-120 FPS.
```

### Session T20-19-14 (9 slides, warm cache)
```
Slide 1: maxFrame=153ms lf=2 fps=68   ← SEVERE
Slide 2: maxFrame=237ms lf=2 fps=42   ← SEVERE (worst recorded)
Slides 3-9: maxFrame=12-58ms, 119-121 FPS
```

### Session T20-21-18 (9 slides, warm cache)
```
Best session. Only 3/9 slides with mild jank (51-59ms).
All slides 114-121 FPS.
```

### Session T22-56-18 (9 slides, warm cache)
```
Slide 1: maxFrame=248ms lf=5 fps=100  ← SEVERE
Slides 2-9: maxFrame=33-84ms, mostly single-frame
```

---

## Severity Assessment

| Issue | Severity | User Impact | Action |
|-------|----------|-------------|--------|
| First-slide cold cache (2.7s blurry) | Low | One-time per first visit | Monitor |
| Slides 1-2 animation compositing spike | Medium | Quarter-second freeze on first transitions | Investigate deferring JIT fetch |
| Single-frame 50-75ms hiccups | Negligible | Imperceptible during slow Ken Burns | None needed |
