# FitnessChartApp Rendering Audit

**Date:** 2026-01-03
**Scope:** `FitnessChartApp.jsx` and `layout/LayoutManager.js`
**Reported Issues:** Avatars and dropout badges rarely appear at line endpoints; collision avoidance is ineffective

---

## Executive Summary

**Critical Finding:** The elaborate LayoutManager system (344 lines) with its cluster detection, strategy selection, connector generation, and label management is **completely unused**. FitnessChartApp.jsx implements its own primitive collision resolution that suffers from fundamental algorithmic flaws.

The codebase exhibits a classic case of "dead architecture" - a well-designed layout system was built but never integrated, while the actual rendering relies on ad-hoc inline functions with significant bugs.

---

## Part 1: Architecture Overview

### 1.1 What Was Built (LayoutManager System)

The `layout/` directory contains a sophisticated multi-phase layout engine:

```
layout/
├── LayoutManager.js          # Orchestrator (344 lines)
├── ClusterDetector.js        # Groups nearby elements
├── StrategySelector.js       # Picks layout strategy by cluster size
├── ConnectorGenerator.js     # Creates lines from data points to displaced avatars
├── LabelManager.js           # Resolves label collisions (4-position fallback)
├── strategies/
│   ├── StraddleLayout.js     # 2-avatar collision (horizontal displacement)
│   ├── StackLayout.js        # 3-4 avatars (vertical stack)
│   ├── FanLayout.js          # 5-6 avatars (radial arc)
│   ├── GridLayout.js         # 7+ avatars (multi-column grid)
│   └── BadgeStackLayout.js   # Badge stacking
└── utils/
    └── sort.js               # Deterministic comparator
```

**Design Intent:**
1. Detect element clusters based on proximity
2. Select appropriate layout strategy per cluster
3. Apply collision resolution preserving data line connections
4. Generate connectors for displaced elements
5. Resolve label collisions with 4-position fallback
6. Clamp to viewport bounds

### 1.2 What Is Actually Used (Inline Functions)

FitnessChartApp.jsx defines three local functions that bypass the entire layout system:

| Function | Lines | Purpose |
|----------|-------|---------|
| `computeAvatarPositions` | 461-485 | Maps entries to screen coordinates |
| `resolveAvatarOffsets` | 487-513 | Simple vertical push-apart |
| `computeBadgePositions` | 515-530 | Maps dropout markers to screen coordinates |

**Integration Point (lines 879-890):**
```javascript
const avatars = useMemo(() => {
    const base = computeAvatarPositions(presentEntries, scaleY, ...);
    return resolveAvatarOffsets(base);  // Uses local function, NOT LayoutManager
}, [...]);

const badges = useMemo(() => {
    return computeBadgePositions(dropoutMarkers, ...);  // No collision resolution at all
}, [...]);
```

---

## Part 2: Problem Statements

### Problem 1: LayoutManager Is Never Integrated

**Evidence:**
- `grep 'layout/' FitnessChartApp.jsx` returns no matches
- `grep 'LayoutManager' FitnessChartApp.jsx` returns no matches
- The only import from helpers is `createPaths` from `FitnessChart.helpers.js`

**Impact:** All the sophisticated collision avoidance logic (cluster detection, strategy selection, connectors, label management) is completely dead code.

---

### Problem 2: Inadequate Collision Resolution in `resolveAvatarOffsets`

**Current Algorithm (lines 487-513):**
```javascript
const resolveAvatarOffsets = (avatars) => {
    const sorted = [...avatars].sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
    const placed = [];
    const step = AVATAR_RADIUS * 2 + 6;  // 66px

    const collides = (candidate, offset) => {
        const cy = candidate.y + offset;
        return placed.some((p) => {
            const dy = cy - (p.y + p.offsetY);
            const dx = candidate.x - p.x;
            const distance = Math.hypot(dx, dy);
            return distance < AVATAR_OVERLAP_THRESHOLD;  // 60px
        });
    };
    // ... push apart only in Y direction
};
```

**Flaws:**

| Issue | Description | Severity |
|-------|-------------|----------|
| **Y-only displacement** | Algorithm can only push avatars downward, never sideways. When avatars cluster at the same X (line endpoints), they stack vertically off the bottom of the chart. | Critical |
| **No bounds checking** | Displaced avatars can render below `chartHeight - CHART_MARGIN.bottom`, becoming invisible. | Critical |
| **Fixed step size** | Uses constant 66px step regardless of actual overlap amount, causing excessive displacement. | High |
| **Iteration limit** | `iterations < 10` caps displacement at 660px, but doesn't handle the "all positions occupied" case. | Medium |
| **No connector generation** | When avatars are displaced, there's no visual connection to their data line endpoint. | High |

---

### Problem 3: Badges Have Zero Collision Resolution

**Current Implementation (lines 515-530):**
```javascript
const computeBadgePositions = (dropoutMarkers, scaleY, ...) => {
    return dropoutMarkers.map((marker) => {
        // ... just computes position, no collision handling
        return { id: marker.id, x, y, initial };
    }).filter(Boolean);
};
```

**Impact:** Dropout badges render exactly at their data coordinates. When multiple users drop out at similar values, badges overlap completely and become unreadable.

---

### Problem 4: Avatar-Badge Collision Blind Spot

The current code processes avatars and badges independently:
- Avatars: `computeAvatarPositions` -> `resolveAvatarOffsets`
- Badges: `computeBadgePositions` (no resolution)

Neither system knows about the other. The LayoutManager was designed to handle both in a unified pipeline:

```javascript
// LayoutManager.layout() - lines 52-133
layout(elements) {
    let avatars = elements.filter(e => e.type === 'avatar');
    let badges = elements.filter(e => e.type === 'badge');
    // ... processes both together
    resolvedBadges = this._resolveBadgeAvatarCollisions(resolvedBadges, resolvedAvatars);
}
```

---

### Problem 5: Cluster Detection Ignores X-Axis Spread

`ClusterDetector.js` uses 1D clustering on Y only:

```javascript
detectClusters(elements) {
    const sorted = [...elements].sort((a, b) => a.y - b.y);
    // ... only compares yDiff
    if (yDiff <= this.clusterThreshold) {
        currentCluster.push(current);
    }
}
```

**Design Flaw:** In a race chart, avatars at the same value but different times have identical Y but different X. The clustering should consider 2D distance, not just vertical proximity.

---

### Problem 6: StraddleLayout Direction Assumption

`StraddleLayout.js` always displaces the bottom avatar **leftward**:

```javascript
if (verticalDistance < overlapThreshold) {
    const horizontalOffset = -(this.avatarRadius * 3);  // Always left
    return [
        { ...topAvatar, ... },
        { ...bottomAvatar, finalX: bottomAvatar.x + horizontalOffset, ... }
    ];
}
```

**Problem:** In a chart where time flows left-to-right, displacing avatars leftward moves them backward in time - visually confusing. The displacement should account for available space on either side.

---

## Part 3: Data Flow Analysis

### 3.1 Intended Flow (With LayoutManager)

```
useRaceChartWithHistory
        |
        v
Compute base positions
        |
        v
LayoutManager.layout()
        |
        +---> ClusterDetector.detectClusters()
        |           |
        |           v
        +---> StrategySelector.selectAndApply()
        |           |
        |           v
        +---> LabelManager.resolve()
        |           |
        |           v
        +---> ConnectorGenerator.generate()
                    |
                    v
            RaceChartSvg
              - elements with finalX/Y + offsets
              - connectors linking to line endpoints
```

### 3.2 Actual Flow (Current Implementation)

```
useRaceChartWithHistory
        |
        +---> computeAvatarPositions()
        |           |
        |           v
        |    resolveAvatarOffsets()  [Y-only push, no bounds check]
        |           |
        |           v
        |    avatars[] (may be off-screen)
        |
        +---> computeBadgePositions()  [NO collision resolution]
        |           |
        |           v
        |    badges[] (overlapping)
        |
        v
RaceChartSvg
  - avatars: may be off-screen
  - badges: overlapping
  - NO connectors
```

---

## Part 4: Code Quality Assessment

### 4.1 Technical Debt Indicators

| Indicator | Location | Notes |
|-----------|----------|-------|
| Dead code | `layout/` directory | 8 JS files, ~600 lines unused |
| Duplicate logic | `_resolveCollisionsSimple` vs `resolveAvatarOffsets` | LayoutManager has more sophisticated version |
| Magic numbers | `step = AVATAR_RADIUS * 2 + 6` | Why 6? Not documented |
| Commented design notes | Lines 204-206 | Reference to "Phase 3 transition" never completed |
| Debug logging | Lines 873-875 | Production code logs gap paths |

### 4.2 Cyclomatic Complexity Hotspots

| Function | Lines | Branches | Assessment |
|----------|-------|----------|------------|
| `useRaceChartData` | 60-201 | 25+ | Very high - should be decomposed |
| `useRaceChartWithHistory` | 232-459 | 20+ | High - state management complex |
| `scaleY` | 806-851 | 8 | Moderate but hard to test |

### 4.3 Missing Test Coverage

The layout system has unit tests:
- `layout/__tests__/ClusterDetector.test.js`
- `layout/__tests__/StrategySelector.test.js`
- `layout/__tests__/LayoutManager.test.js`

But FitnessChartApp.jsx's inline functions (`computeAvatarPositions`, `resolveAvatarOffsets`, `computeBadgePositions`) have **no tests**.

---

## Part 5: Recommendations

### Immediate (P0) - Fix Critical Rendering Bugs

1. **Integrate LayoutManager into FitnessChartApp.jsx**
   ```javascript
   import { LayoutManager } from './layout';

   const layoutManager = useMemo(() => new LayoutManager({
       bounds: { width: chartWidth, height: chartHeight, margin: CHART_MARGIN },
       avatarRadius: AVATAR_RADIUS,
       badgeRadius: ABSENT_BADGE_RADIUS,
       options: { enableConnectors: true }
   }), [chartWidth, chartHeight]);

   const { elements, connectors } = useMemo(() => {
       const avatarElements = presentEntries.map(e => ({
           ...computeBasePosition(e), type: 'avatar'
       }));
       const badgeElements = dropoutMarkers.map(m => ({
           ...computeBasePosition(m), type: 'badge'
       }));
       return layoutManager.layout([...avatarElements, ...badgeElements]);
   }, [presentEntries, dropoutMarkers, layoutManager, scaleY]);
   ```

2. **Add bounds clamping to current inline functions** (quick fix if integration is delayed)
   ```javascript
   const resolveAvatarOffsets = (avatars) => {
       // ... existing logic ...
       const maxY = chartHeight - CHART_MARGIN.bottom - AVATAR_RADIUS;
       placed.push({ ...item, offsetY: Math.min(offset, maxY - item.y) });
   };
   ```

### Short-Term (P1) - Improve Layout Quality

3. **Fix ClusterDetector to use 2D distance**
   ```javascript
   const distance = Math.hypot(current.x - prev.x, current.y - prev.y);
   if (distance <= this.clusterThreshold) { ... }
   ```

4. **Make StraddleLayout direction-aware**
   ```javascript
   const horizontalOffset = (bottomAvatar.x > chartWidth / 2)
       ? -(this.avatarRadius * 3)   // Near right edge: move left
       : (this.avatarRadius * 3);   // Near left edge: move right
   ```

5. **Add connector rendering to RaceChartSvg**
   ```jsx
   <g className="race-chart__connectors">
       {connectors.map(c => (
           <line key={c.id} x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2}
                 stroke={c.color} strokeDasharray="4 2" />
       ))}
   </g>
   ```

### Medium-Term (P2) - Clean Up Technical Debt

6. **Delete unused inline functions** once LayoutManager is integrated
   - `computeAvatarPositions`
   - `resolveAvatarOffsets`
   - `computeBadgePositions`

7. **Extract hooks** from FitnessChartApp.jsx
   - `useRaceChartData` -> separate file
   - `useRaceChartWithHistory` -> separate file

8. **Add integration tests** for the full rendering pipeline

### Long-Term (P3) - Architecture Improvements

9. **Consider canvas/WebGL rendering** if participant count grows beyond 20 (SVG performance degrades)

10. **Implement animation interpolation** using `useAnimatedLayout.js` (currently stubbed)

---

## Appendix A: File Reference

| File | Lines | Status |
|------|-------|--------|
| `FitnessChartApp.jsx` | 969 | Active (buggy) |
| `layout/LayoutManager.js` | 345 | Unused |
| `layout/ClusterDetector.js` | 33 | Unused |
| `layout/StrategySelector.js` | 37 | Unused |
| `layout/LabelManager.js` | 96 | Unused |
| `layout/ConnectorGenerator.js` | 44 | Unused |
| `FitnessChart.helpers.js` | 515 | Active |

## Appendix B: Constant Values

| Constant | Value | Used In |
|----------|-------|---------|
| `AVATAR_RADIUS` | 30 | FitnessChartApp.jsx |
| `AVATAR_OVERLAP_THRESHOLD` | 60 | FitnessChartApp.jsx |
| `ABSENT_BADGE_RADIUS` | 10 | FitnessChartApp.jsx |
| `CHART_MARGIN` | `{top:10, right:64, bottom:38, left:4}` | FitnessChartApp.jsx |
| `clusterThreshold` (avatars) | 120 (4x radius) | LayoutManager.js |
| `clusterThreshold` (badges) | 25 (2.5x radius) | LayoutManager.js |

---

*End of audit*
