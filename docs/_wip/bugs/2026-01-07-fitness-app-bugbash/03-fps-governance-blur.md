# Bug 03: FPS Degradation During Governance Warning

**Severity:** High
**Area:** Performance
**Status:** Open

## Summary

Performance tanks specifically when the governance warning overlay is active, particularly when the blur filter overlay is applied.

## Context

- Occurs when the "Blur Filter" overlay is applied
- Verified unrelated to log spam (which was previously fixed)
- Performance analysis documented in `docs/_wip/designs/governance-warning-performance-analysis.md`

## Relevant Code

### Governance Warning Overlay
**File:** `frontend/src/modules/Fitness/FitnessPlayerOverlay/GovernanceStateOverlay.jsx`

| Component | Lines | Purpose |
|-----------|-------|---------|
| `GovernanceWarningOverlay` | 7-85 | Progress countdown and offender chips |
| `GovernancePanelOverlay` | 102-251 | Locked/pending status panel |
| `GovernanceStateOverlay` | 308-386 | Main orchestrator |

### Blur Filter CSS
**File:** `frontend/src/modules/Fitness/FitnessPlayerOverlay/GovernanceStateOverlay.scss`

**Current blur usage:**
- Line 20: `.governance-overlay__panel` - `backdrop-filter: blur(12px)` (kept)
- Line 22: `.governance-progress-overlay__chip` - removed (was causing GPU overhead)
- Line 509: `.fitness-player-overlay__panel` - removed (increased opacity to 0.92 instead)

### Optimizations Already Implemented

Per `governance-warning-performance-analysis.md`:

1. Reduced `backdrop-filter` instances from 3 to 1
2. Progress bars use `transform: scaleX()` instead of `width` (GPU-accelerated)
3. React.memo with custom comparison on overlay sub-components
4. CSS containment (`contain: layout style`) on progress overlays
5. Lightweight audio player replaces Player component
6. Stabilized callback references with `useCallback`
7. State caching with 200ms throttle in GovernanceEngine

### CSS Performance Techniques
**File:** `GovernanceStateOverlay.scss`

```scss
// Transform-based animations (Lines 222, 409, 495)
transform: scaleX(0);
will-change: transform;
transition: transform 0.25s ease;

// CSS Containment (Lines 10, 381)
contain: layout style;
```

### Governance Engine State
**File:** `frontend/src/hooks/fitness/GovernanceEngine.js`

| Function | Lines | Purpose |
|----------|-------|---------|
| `evaluate()` | 766 | Main governance evaluation loop |
| `_getCachedState()` | 595 | State caching with 200ms throttle |
| `_composeState()` | 639 | Builds governance state for rendering |

## Outstanding Performance Issues

Despite optimizations, blur may still cause issues:

1. **Remaining `backdrop-filter: blur(12px)`** on `.governance-overlay__panel`
   - This single blur still triggers GPU compositing
   - May be problematic on lower-end devices

2. **Re-render frequency:**
   - Warning countdown updates frequently
   - Custom memo comparison may not be aggressive enough

3. **Offender chip rendering:**
   - Dynamic list of offender chips may cause layout thrashing

## Fix Direction

1. **Profile current performance:**
   - Use Chrome DevTools Performance tab during warning state
   - Identify paint/composite bottlenecks
   - Measure frame times with governance active vs inactive

2. **Consider blur alternatives:**
   - Semi-transparent solid background instead of blur
   - Pre-rendered blurred background image
   - Only blur when GPU permits (feature detection)

3. **Reduce re-render scope:**
   - Isolate countdown timer in separate component
   - Use CSS animations for countdown instead of React state updates

4. **Hardware acceleration hints:**
   - Add `will-change: backdrop-filter` (use sparingly)
   - Ensure blur container has `transform: translateZ(0)`

## Related Documentation

- `docs/_wip/designs/governance-warning-performance-analysis.md`
- `docs/_wip/designs/governance-performance-test-plan.md`

## Testing Approach

Runtime tests should:
1. Measure FPS during normal playback
2. Trigger warning state, measure FPS
3. Compare with blur disabled vs enabled
4. Test on various device performance tiers
5. Use `tests/runtime/governance/governance-performance.runtime.test.mjs`

## Key Question: Is the blur effect truly responsible for the FPS drop, or are there other rendering inefficiencies at play?