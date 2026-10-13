# Bug Report: FPS Degradation During Governance Warning State

**Date:** 2026-02-02  
**Severity:** High (Performance)  
**Status:** Fixed - Overlay-only approach implemented  
**Session:** fs_20260202185544  
**Log File:** logs/prod-logs-20260202-185930.txt

---

## Summary

Render FPS drops dramatically (50 → 9-11 FPS, ~80% degradation) when the governance warning state activates. While previous analysis blamed SCSS blur effects, this investigation reveals that **blur is not the root cause**—the same blur effects are used in other overlays (ChallengeOverlay, VoiceMemoOverlay, Menu) without similar FPS degradation.

---

## Evidence From Production Logs

### FPS Timeline Around Warning State

| Time (UTC) | Event | Render FPS | Notes |
|------------|-------|------------|-------|
| 02:57:54 | Mario Kart 64 starts | **50** | Healthy baseline |
| 02:57:59 | Normal playback | **48** | Stable |
| **02:58:01.572** | **governance.warning_started** | — | Warning phase begins |
| 02:58:04 | First reading after warning | **11** | 78% drop! |
| 02:58:09 | Degraded | **10** | Sustained |
| 02:58:15 | Lowest | **9** | |
| 02:58:20 | Slight recovery | **11** | Still 78% below baseline |

### Correlated System Metrics (fitness-profile)

| Time | heapGrowthMB/min | governancePhase | forceUpdateCount | renderCount |
|------|------------------|-----------------|------------------|-------------|
| 02:57:04 | 2.0 | pending | 129 | 129 |
| 02:57:34 | 7.1 | pending | 121 | 122 |
| **02:58:04** | **9.7** | **warning** | **137** | **141** |
| 02:58:09 | 6.8 | warning | 15 | 15 |

**Key observations:**
- Heap growth rate spiked from ~2 MB/min to **9.7 MB/min** at warning start
- `forceUpdateCount` remained high (137) indicating aggressive re-rendering
- Video `droppedFrames` jumped from 3 → 15 → 41

---

## Why Blur Is NOT The Root Cause

### Comparison: Blur Usage Across Components

| Component | Blur | FPS Impact | When Active |
|-----------|------|------------|-------------|
| `GovernanceStateOverlay.__panel` | `blur(12px)` | **HIGH** | Warning/Locked state |
| `ChallengeOverlay` | `blur(16px)` | None observed | During challenges |
| `VoiceMemoOverlay.__panel` | `blur(20px)` | None observed | Recording voice memos |
| `Menu` | `blur(8px)` | None observed | Menu open |
| `FitnessGovernance` (sidebar) | `blur(10px)` | None observed | Always visible |
| `governance-filter-warning::before` | `blur(2px)` | — | Warning state |

**Critical insight:** The ChallengeOverlay uses **heavier blur (16px)** than GovernanceStateOverlay (12px), yet has no FPS impact. The VoiceMemoOverlay uses even heavier blur (20px) without issues.

### What Makes Governance Warning Different?

The `governance-filter-warning` class applies **two separate effects simultaneously**:

```scss
// FitnessPlayer.scss lines 497-520
&.governance-filter-warning {
  // 1. Direct filter on video element (per-frame cost)
  video, dash-video {
    filter: sepia(0.65) brightness(0.8) contrast(1.2);  // ← Applied to video decode
    transition: filter 0.3s ease;
  }

  // 2. ADDITIONAL blur overlay via ::before pseudo-element
  &::before {
    content: '';
    position: absolute;
    inset: 0;
    backdrop-filter: blur(2px);  // ← SECOND blur layer
    z-index: 5;
  }
}
```

**This creates a double-compositing scenario:**
1. Video decode → CSS filter (sepia/brightness/contrast)
2. Filtered video → backdrop-filter blur (::before pseudo-element)
3. Blurred content → GovernanceStateOverlay panel (backdrop-filter: blur(12px))

Other overlays only have **one** blur layer (their panel), not a stacked combination.

---

## Root Cause: Stacked Filter + Backdrop-Filter Combination

### The Actual Problem

When `governance-filter-warning` is active, the GPU must:

1. **Decode video frame** (baseline cost)
2. **Apply CSS filter to video** (`sepia + brightness + contrast`) - forces software compositing path
3. **Composite ::before pseudo-element** with `backdrop-filter: blur(2px)` on top of filtered video
4. **Composite GovernanceStateOverlay panel** with `backdrop-filter: blur(12px)`
5. **Render offender chips** (dynamic content, potentially multiple)

**The critical issue:** CSS `filter` on a video element triggers different compositing behavior than `backdrop-filter` alone. When combined with a `backdrop-filter` pseudo-element, Chrome cannot optimize the GPU layers effectively.

### Evidence: Other Overlays Don't Filter The Video

| Overlay | Video Filter | Backdrop-Filter Layers | FPS Impact |
|---------|--------------|------------------------|------------|
| **Governance Warning** | `sepia + brightness + contrast` | 2 (::before + panel) | **HIGH** |
| Challenge Overlay | None | 1 (panel only) | None |
| Voice Memo Overlay | None | 1 (panel only) | None |
| Menu | None | 1 (menu only) | None |

The **combination of video filter + backdrop-filter** is unique to governance warning state.

---

## Secondary Contributing Factors

### 1. Frequent Re-renders During Warning

The `GovernanceWarningOverlay` component receives props that change frequently:

```jsx
// GovernanceStateOverlay.jsx
const GovernanceWarningOverlay = React.memo(function GovernanceWarningOverlay({ 
  countdown,        // Updates every ~100-500ms
  countdownTotal, 
  offenders         // Can change when HR data updates
}) {
  // ...
}, (prevProps, nextProps) => {
  // Custom memo: skip if countdown delta < 0.3s
  const countdownDelta = Math.abs((prevProps.countdown || 0) - (nextProps.countdown || 0));
  if (countdownDelta < 0.3 && prevProps.offenders === nextProps.offenders) {
    return true;
  }
  return false;
});
```

**The memo comparison is too permissive:**
- 0.3s threshold allows ~3 re-renders per second just from countdown
- `offenders` array reference changes cause additional re-renders

### 2. Offender Chip Rendering

Each offender chip includes:
- Avatar image with `onError` handler
- Progress bar with inline `transform: scaleX()` style
- Dynamic border color based on zone

With multiple offenders, this creates:
- Multiple DOM nodes per chip
- Inline style updates on every progress change
- Image loading/error handling overhead

### 3. Video Dropped Frames Cascade

When render FPS drops:
1. React can't keep up with state updates
2. Video player misses frame presentation deadlines
3. Browser drops video frames
4. `videoDropRate` spikes (3 → 41 dropped frames in 5 seconds)

This creates a feedback loop where poor rendering performance causes more dropped frames, which may trigger more UI updates.

---

## Recommended Fixes

### Fix 1: Remove Video Filter During Warning (High Impact, Low Effort)

The sepia/brightness/contrast filter provides visual feedback but has massive cost when combined with backdrop-filter.

**Option A:** Remove the video filter entirely

```scss
&.governance-filter-warning {
  // REMOVED: filter on video elements
  // Let the ::before blur provide the visual indicator

  &::before {
    // Keep only the blur overlay
    backdrop-filter: blur(3px);  // Slightly increase blur to compensate
  }
}
```

**Option B:** Use opacity instead of color filters

```scss
&.governance-filter-warning {
  video, dash-video {
    opacity: 0.7;  // Much cheaper than color filters
    transition: opacity 0.3s ease;
  }
}
```

### Fix 2: Consolidate to Single Blur Layer (High Impact, Medium Effort)

Remove the ::before pseudo-element and use only the panel blur:

```scss
&.governance-filter-warning {
  // NO video filter, NO ::before pseudo-element
  // Visual indication comes only from the overlay panel
}
```

The GovernanceStateOverlay panel's `backdrop-filter: blur(12px)` already provides visual separation.

### Fix 3: Throttle Re-renders More Aggressively (Medium Impact, Medium Effort)

Update the memo comparison to be more aggressive:

```jsx
const GovernanceWarningOverlay = React.memo(function GovernanceWarningOverlay({...}) {
  // ...
}, (prevProps, nextProps) => {
  // Skip re-render if:
  // 1. Countdown delta < 1 second (was 0.3s)
  // 2. Offenders are shallow-equal, not reference-equal
  const countdownDelta = Math.abs((prevProps.countdown || 0) - (nextProps.countdown || 0));
  if (countdownDelta < 1) {
    // Shallow compare offenders
    const prevKeys = (prevProps.offenders || []).map(o => o.key + o.progressPercent?.toFixed(1)).join(',');
    const nextKeys = (nextProps.offenders || []).map(o => o.key + o.progressPercent?.toFixed(1)).join(',');
    if (prevKeys === nextKeys) return true;
  }
  return false;
});
```

### Fix 4: CSS-Only Progress Animation (Medium Impact, High Effort)

Move countdown progress from React state to CSS animation:

```scss
.governance-progress-overlay__fill {
  // Use CSS animation instead of inline transform
  animation: progress-countdown var(--countdown-duration) linear forwards;
}

@keyframes progress-countdown {
  from { transform: scaleX(1); }
  to { transform: scaleX(0); }
}
```

Set `--countdown-duration` via CSS custom property when warning starts, then let CSS handle the animation without React re-renders.

---

## Testing Plan

1. **Baseline:** Measure FPS during normal playback (no overlays)
2. **Control A:** Trigger ChallengeOverlay, measure FPS (expect no degradation)
3. **Control B:** Open Menu with blur, measure FPS (expect no degradation)
4. **Test 1:** Trigger governance warning (current code), measure FPS
5. **Test 2:** Apply Fix 1 (remove video filter), measure FPS
6. **Test 3:** Apply Fix 2 (remove ::before), measure FPS
7. **Test 4:** Apply both fixes, measure FPS

### Expected Results

| Scenario | Current FPS | Expected After Fix |
|----------|-------------|-------------------|
| Normal playback | 50-60 | 50-60 (unchanged) |
| Governance Warning | 9-11 | 40-50+ |

---

## Files To Modify

1. **Primary:** [FitnessPlayer.scss](../../frontend/src/modules/Fitness/FitnessPlayer.scss#L497-L520)
   - Lines 497-520: `.governance-filter-warning` styles

2. **Secondary:** [GovernanceStateOverlay.jsx](../../frontend/src/modules/Fitness/FitnessPlayerOverlay/GovernanceStateOverlay.jsx#L8-L79)
   - Lines 8-79: `GovernanceWarningOverlay` component and memo comparison

3. **Optional:** [GovernanceStateOverlay.scss](../../frontend/src/modules/Fitness/FitnessPlayerOverlay/GovernanceStateOverlay.scss)
   - Potentially adjust panel backdrop-filter or add containment

---

## Log Commands Used

```bash
# Extract FPS data with timestamps
grep '"playback.render_fps"' prod-logs-20260202-185930.txt | jq -r '[.ts, .data.renderFps, .data.title] | @tsv'

# Find governance phase changes
grep '"governance.phase_change"' prod-logs-20260202-185930.txt | jq -r '[.ts, .data.from, .data.to] | @tsv'

# Get fitness-profile metrics
grep '"fitness-profile"' prod-logs-20260202-185930.txt | jq -r '[.ts, .data.heapGrowthRateMBperMin, .data.governancePhase, .data.forceUpdateCount] | @tsv'

# Find all blur usages in SCSS
grep -r 'backdrop-filter\|blur(' frontend/src/modules/Fitness/**/*.scss
```

---

## Related Documentation

- [Previous Analysis (archived)](../../docs/_archive/2026-01-cleanup/wip-old-plans/2026-01-05-governance-warning-performance-analysis.md)
- [Prior Bug Report (archived)](../../docs/_archive/2026-01-cleanup/wip-old-bugs/2026-01-07-fitness-app-bugbash/03-fps-governance-blur.md)
- [Governance Lock Screen Delay Bug](./2026-02-02-governance-lock-screen-delay.md) (separate issue)

---

## Resolution

**Fix applied:** Removed all CSS filters from video elements in `.governance-filter-warning`. Visual warning effect now achieved entirely via a semi-transparent tinted overlay (`rgba(139, 92, 42, 0.25)`) with `backdrop-filter: blur(2px)`.

**Result:** Video decoding path untouched. GPU composites a single overlay layer instead of filtering + double-compositing.

**Commit:** `1aec09bc` - fix(fitness): remove video filter in governance warning for FPS

---

## Conclusion

The FPS degradation is **not caused by blur alone**, but by the **combination of CSS filter on video + stacked backdrop-filter layers** that is unique to the governance warning state. Other overlays using blur don't experience this because they don't also apply filters to the video element.

The most impactful fix is to remove or simplify the video filter in `.governance-filter-warning`, allowing the single backdrop-filter overlay to provide the visual warning indication without triggering the expensive double-compositing path.
