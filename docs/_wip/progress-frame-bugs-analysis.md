# ProgressFrame SVG Path & Animation Bugs Analysis

**Date:** 2026-01-09  
**Updated:** 2026-01-10 (logging validation complete)  
**Component:** `frontend/src/modules/Fitness/FitnessPlayerFooter/ProgressFrame.jsx`  
**Status:** 🟡 Fixes applied, calculations verified correct

## Executive Summary

Two bugs were identified and fixed:

1. **BUG-A: Reversed Progress Direction** — ✅ FIXED - Changed from dashoffset to dasharray pattern
2. **BUG-B: Unclosed Path** — ✅ FIXED - Added closing segment and Z command

**Logging validation** (2026-01-10) confirmed:
- Spark position calculations are **mathematically correct**
- PERIMETER value (389.13) matches SVG path total length
- Progress → endpoint mapping is accurate at all tested values (0%, 93%, 99%)

## Post-Fix Validation Results

### Test Run Output
```
ProgressFrame state: {
  "overlayCount": 1,
  "fillCount": 1,
  "sparkCount": 1,
  "trackCount": 1,
  "fillStyles": ["stroke-dasharray: 363.668, 389.133; stroke-dashoffset: 0;"]
}
```

### Logged Spark Positions (verified correct)
| Progress | visibleLength | endpoint (x, y) | Expected Location |
|----------|---------------|-----------------|-------------------|
| 0.0% | 0.0 | (1.50, 1.50) | ✅ Origin (top-left) |
| 93.4% | 363.5 | (1.50, 20.96) | ✅ Left edge, ~21% from top |
| 99.0% | 385.1 | (5.49, 1.50) | ✅ Closing segment, near origin |
| 99.9% | 388.9 | (1.78, 1.50) | ✅ Almost back to origin |

---

## Bug A: Reversed Progress Direction (CRITICAL)

### Symptom
At low progress values (e.g., 1%), the visible stroke appears on the **left side near the top** instead of at the **top-left origin going right**.

### Root Cause
The `stroke-dashoffset` calculation is inverted. The current formula:

```javascript
const dashOffset = PERIMETER * (1 - cappedPerc);
```

This reveals the path from the **END backwards** rather than from the **START forwards**.

### Proof

| Progress | dashOffset | Visible Path Segment | Expected Segment |
|----------|------------|---------------------|------------------|
| 0% | 385.1 | `path[385-385]` (nothing) | `path[0-0]` ✅ |
| 1% | 381.3 | `path[381-385]` (END of path) | `path[0-4]` ❌ |
| 10% | 346.6 | `path[347-385]` (last 10%) | `path[0-39]` ❌ |
| 50% | 192.6 | `path[193-385]` (second half) | `path[0-193]` ❌ |
| 100% | 0.0 | `path[0-385]` (all) | `path[0-385]` ✅ |

At 1% progress, path positions 381-385 correspond to **segment 8** — the top-left arc that ends at `(5.5, 1.5)`. This is exactly what the user observed: stroke appearing on the left side near the top.

### Visual Explanation

```
Path direction (clockwise from top-left):
    
    START (1.5, 1.5)
         ↓
    ┌────────────────┐
    │                │ ← Seg 1: Top edge (0-93)
    │                │ ← Seg 2: Top-right arc (93-99)
    │                │ ← Seg 3: Right edge (99-188)
    │                │ ← Seg 4: Bottom-right arc (188-195)
    │                │ ← Seg 5: Bottom edge (195-284)
    │                │ ← Seg 6: Bottom-left arc (284-290)
    │                │ ← Seg 7: Left edge (290-379)
    └────────────────┘ ← Seg 8: Top-left arc (379-385) ← LOW PROGRESS SHOWS HERE!
         ↑
    END (5.5, 1.5)

Current behavior at 1% progress: Shows segment 8 (wrong!)
Expected behavior at 1% progress: Shows start of segment 1 (top edge)
```

### Fix Required

Change from dashoffset-based reveal to dasharray-based reveal:

```javascript
// BEFORE (wrong):
style={{
  strokeDasharray: PERIMETER,
  strokeDashoffset: PERIMETER * (1 - cappedPerc)  // Shows END of path first!
}}

// AFTER (correct):
const visibleLength = cappedPerc * PERIMETER;
style={{
  strokeDasharray: `${visibleLength} ${PERIMETER - visibleLength}`,
  strokeDashoffset: 0  // Always start from beginning
}}
```

---

## Bug B: Unclosed Path (Gap at Completion)

### Symptom
At high progress values (near 100%), there's visible "drift" — the progress line doesn't quite connect back to the origin.

### Root Cause
The SVG path is **not closed**. It starts at `(1.5, 1.5)` but ends at `(5.5, 1.5)`, leaving a **4-unit gap**.

### Geometry Analysis

```
Path Start:  M 1.5 1.5   (top-left corner)
Path End:    A ... 5.5 1.5 (after top-left arc)

Gap: From (5.5, 1.5) back to (1.5, 1.5) = 4 units (not included!)

Actual path length:   385.13 units (PERIMETER constant)
Missing segment:      4.0 units
True closed perimeter: 389.13 units
```

### Segment Trace

| Segment | Type | From | To | Length |
|---------|------|------|-----|--------|
| 1 | line | (1.5, 1.5) | (94.5, 1.5) | 93.0 |
| 2 | arc | (94.5, 1.5) | (98.5, 5.5) | 6.28 |
| 3 | line | (98.5, 5.5) | (98.5, 94.5) | 89.0 |
| 4 | arc | (98.5, 94.5) | (94.5, 98.5) | 6.28 |
| 5 | line | (94.5, 98.5) | (5.5, 98.5) | 89.0 |
| 6 | arc | (5.5, 98.5) | (1.5, 94.5) | 6.28 |
| 7 | line | (1.5, 94.5) | (1.5, 5.5) | 89.0 |
| 8 | arc | (1.5, 5.5) | (5.5, 1.5) | 6.28 |
| **MISSING** | **line** | **(5.5, 1.5)** | **(1.5, 1.5)** | **4.0** |

### Fix Required

Option A: Add closing segment to SEGMENTS array and path:
```javascript
// Add 9th segment:
{ type: 'line', from: [INSET + RADIUS, INSET], to: [INSET, INSET], length: RADIUS }

// Add to TRACK_PATH:
parts.push(`L ${INSET} ${INSET}`);  // Close the path
```

Option B: Use SVG `Z` command to auto-close:
```javascript
// In TRACK_PATH builder:
return parts.join(' ') + ' Z';
```

---

## Combined Fix Strategy

### Recommended Approach

1. **Close the path** by adding the missing segment
2. **Fix the dasharray** to reveal from start instead of end
3. **Update PERIMETER** to include closing segment length

### Code Changes

```javascript
// 1. Add closing segment
const SEGMENTS = [
  // ... existing 8 segments ...
  { type: 'line', from: [INSET + RADIUS, INSET], to: [INSET, INSET], length: RADIUS }  // NEW: closing segment
];

// 2. Update PERIMETER (will auto-calculate correctly now)
const PERIMETER = SEGMENTS.reduce((sum, s) => sum + s.length, 0);  // Now includes closing

// 3. Close the SVG path
const TRACK_PATH = (() => {
  const parts = [`M ${INSET} ${INSET}`];
  for (const seg of SEGMENTS) {
    if (seg.type === 'line') {
      parts.push(`L ${seg.to[0]} ${seg.to[1]}`);
    } else {
      const endX = seg.center[0] + RADIUS * Math.cos(seg.endAngle);
      const endY = seg.center[1] + RADIUS * Math.sin(seg.endAngle);
      parts.push(`A ${RADIUS} ${RADIUS} 0 0 1 ${endX} ${endY}`);
    }
  }
  parts.push('Z');  // NEW: Explicitly close path
  return parts.join(' ');
})();

// 4. Fix dasharray to reveal from start
// In the render:
const visibleLength = cappedPerc * PERIMETER;
style={{
  strokeDasharray: `${visibleLength} ${PERIMETER}`,
  strokeDashoffset: 0
}}
```

---

## Impact Assessment

| Bug | Severity | User Impact |
|-----|----------|-------------|
| Bug A (reversed direction) | **Critical** | Progress appears in wrong location, confusing UX |
| Bug B (unclosed path) | **High** | Visual drift at completion, feels "incomplete" |

---

## Testing Checklist

After fix, verify:

- [ ] At 0% progress: No stroke visible, spark at origin `(1.5, 1.5)`
- [ ] At 1% progress: Small stroke on TOP edge going RIGHT from origin
- [ ] At 25% progress: Stroke covers top edge + top-right arc + partial right edge
- [ ] At 50% progress: Stroke covers exactly half the perimeter (top + right + partial bottom)
- [ ] At 99% progress: Almost complete loop, small gap near origin
- [ ] At 100% progress: Complete closed loop with no gap

---

## Related Files

- `ProgressFrame.jsx` — Main component with bug
- `ProgressFrame.scss` — CSS transitions (may need adjustment for new dasharray approach)

## History

- **Commit `fbb22a45`** (2026-01-07): Introduced dashoffset approach, replacing previous dasharray implementation
- **Previous implementation** used `strokeDasharray: \`${dashLength} ${PATH_PERIMETER}\`` which was correct but path closure bug existed

---

## Appendix: Full Path Visualization

```
VIEWBOX: 100x100
STROKE: 3 (creates 1.5 inset from edges)
RADIUS: 4 (corner radius)

Coordinate system:
  (0,0) ─────────────────────────── (100,0)
    │                                  │
    │   (1.5,1.5)═══════════(94.5,1.5) │  ← Seg 1
    │       ║                 ╔═══╗    │  ← Seg 2 (arc)
    │       ║                 ║   ║    │
    │       ║                 ║   ║    │  ← Seg 3
    │       ║                 ║   ║    │
    │       ║                 ╚═══╝    │  ← Seg 4 (arc)
    │   (5.5,98.5)══════════(94.5,98.5)│  ← Seg 5
    │       ╚═══╗                      │  ← Seg 6 (arc)
    │           ║                      │
    │           ║                      │  ← Seg 7
    │       ╔═══╝                      │  ← Seg 8 (arc)
    │   (5.5,1.5)    GAP → (1.5,1.5)   │  ← MISSING!
    │                                  │
  (0,100) ─────────────────────────(100,100)
```
