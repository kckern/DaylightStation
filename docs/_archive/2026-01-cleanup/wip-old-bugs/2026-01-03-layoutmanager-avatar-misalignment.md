# LayoutManager Avatar Misalignment Diagnosis

**Date:** 2026-01-03  
**Component:** `frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/layout/LayoutManager.js`  
**Related File:** `frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx`  
**Status:** ✅ FIXED  
**Severity:** Medium (visual regression, avatars not aligned to line endpoints)

---

## Executive Summary

Avatars are consistently offset **80px to the left** of their intended line endpoint positions. The root cause is **overly aggressive bounds clamping** in `_clampBasePositions()` that applies a 50px label margin *plus* avatar radius even when there is sufficient space and no collision.

---

## Symptoms

1. **Avatars appear disconnected from line tips** - even when only 2 users present with plenty of vertical room
2. **Consistent 80px X-axis displacement** observed in logs:
   ```json
   {
     "id": "milo",
     "raw": {"x": "846.00", "y": "60.08"},
     "rendered": {"x": "766.00", "y": "60.08"},
     "diff": {"dx": "80.00", "dy": "0.00"}
   }
   ```
3. **No connectors rendered** (because `offsetX = 0` per layout, but base `x` is clamped)

---

## Root Cause Analysis

### Issue #1: Preemptive Base Position Clamping

**Location:** [LayoutManager.js](../../frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/layout/LayoutManager.js#L271-L316)

```javascript
_clampBasePositions(elements, type) {
  // ...
  const labelMargin = type === 'avatar' ? 50 : 0;
  
  // Calculate the safe zone where element centers can be placed
  const minX = (margin.left || 0) + radius;
  const maxX = width - (margin.right || 0) - radius - labelMargin;
  // ...
  return {
    ...el,
    x: clampedX,  // ← BASE POSITION IS MODIFIED, NOT OFFSET
    y: clampedY,
    _originalX: originalX,
    _originalY: originalY,
    // ...
  };
}
```

**Problem:** This method modifies the **base X position** rather than applying an offset. When avatars are near the right edge, their `x` is clamped leftward. The `_originalX` is stored but **never used** to render connectors from the true line tip.

**Math Breakdown:**
- Chart width: ~910px (based on screenshots and container)
- Right margin: 64px (`CHART_MARGIN.right`)
- Avatar radius: 30px (`AVATAR_RADIUS`)
- Label margin: 50px (hardcoded)
- **maxX = 910 - 64 - 30 - 50 = 766px**
- Raw avatar X: 846px (where line actually ends)
- Clamped X: 766px
- **Delta: 80px** ✅ matches observed discrepancy

### Issue #2: Misaligned Collision Detection Reference Frame

**Location:** [LayoutManager.js](../../frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/layout/LayoutManager.js#L75-L85)

```javascript
layout(elements) {
  // Phase 1: Clamp avatar BASE positions to bounds FIRST
  avatars = this._clampBasePositions(avatars, 'avatar');

  // Phase 2: Simple vertical push-apart collision resolution
  let resolvedAvatars = this._resolveCollisionsSimple(avatars);
  // ...
}
```

Collision detection operates on **pre-clamped positions**, which means:
1. Avatars that were originally spread horizontally (at different tick indices) get collapsed to the same X
2. This can trigger unnecessary vertical displacement
3. Even when avatars have different Y values and don't collide, they're both clamped to the same X

### Issue #3: ConnectorGenerator Only Checks offsetX

**Location:** [ConnectorGenerator.js](../../frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/layout/ConnectorGenerator.js#L10-L15)

```javascript
generate(elements) {
  return elements
    .filter(e => {
      if (e.type !== 'avatar') return false;
      const offsetX = e.offsetX || 0;
      return offsetX < -5; // Moved left by more than 5px
    })
    // ...
}
```

**Problem:** Since clamping modifies `x` directly and sets `offsetX: 0`, no connectors are generated even though avatars were moved 80px from their intended positions.

### Issue #4: Label Margin Applied Unconditionally

The 50px `labelMargin` is always reserved, even when:
- The label fits to the right without collision
- The label could be positioned on the left/top/bottom
- There's only one avatar (no collision possible)

---

## Data Flow Diagram

```
computeAvatarPositions()      rawAvatars = [{ x: 846, y: 60 }, ...]
         ↓
LayoutManager.layout()
         ↓
_clampBasePositions()         avatars = [{ x: 766, y: 60 }, ...]  ← 80px shift!
         ↓
_resolveCollisionsSimple()    resolvedAvatars = [{ x: 766, offsetX: 0 }, ...]
         ↓
LabelManager.resolve()        (no-op, positions already clamped)
         ↓
_clampToBounds()              (no-op, already in bounds)
         ↓
useAnimatedLayout()           displayElements = [{ x: 766 }, ...]
         ↓
RaceChartSvg                  <g transform="translate(766, 60)">  ← disconnected!
```

---

## Line Endpoint vs Avatar Position Mismatch

| Component | X Calculation | Value |
|-----------|---------------|-------|
| **Line endpoint** (`createPaths`) | `margin.left + (lastIndex / (ticks-1)) * innerWidth` | 846px |
| **Raw avatar** (`computeAvatarPositions`) | Same formula | 846px |
| **Clamped avatar** (`_clampBasePositions`) | `min(raw.x, width - right - radius - labelMargin)` | 766px |
| **Final render** | `avatar.x + offsetX` | 766px |

The line path is **never clamped**, so it extends to 846px while the avatar sits at 766px.

---

## Why Existing Tests Don't Catch This

The unit tests in [LayoutManager.test.js](../../frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/layout/__tests__/LayoutManager.test.js) don't configure realistic bounds:

```javascript
beforeEach(() => {
  manager = new LayoutManager({
    avatarRadius: 30
    // bounds: NOT PROVIDED → defaults to { width: 0, height: 0 }
  });
});
```

Without bounds, `_clampBasePositions()` has `maxX = 0 - 0 - 30 - 50 = -80`, which clamps everything, but the tests don't verify output positions against input.

---

## Recommended Fixes

### Fix 1: Use Offsets Instead of Modifying Base Position (Preferred)

Change `_clampBasePositions` to compute offsets rather than modifying `x/y`:

```javascript
_clampBasePositions(elements, type) {
  // ... existing calculations ...
  return elements.map(el => {
    const clampedX = Math.max(minX, Math.min(maxX, el.x));
    const clampedY = Math.max(minY, Math.min(maxY, el.y));
    
    return {
      ...el,
      // Keep original x/y for connector generation
      x: el.x,
      y: el.y,
      // Apply clamping as offset
      offsetX: clampedX - el.x,
      offsetY: clampedY - el.y,
      labelPosition: el.x > maxX ? 'left' : undefined
    };
  });
}
```

Then update `ConnectorGenerator` to use `_originalX` or generate connectors when `offsetX !== 0`.

### Fix 2: Conditional Label Margin

Only apply label margin when needed:

```javascript
// In _clampBasePositions:
const labelMargin = type === 'avatar' && this._needsLabelMargin(el, elements) ? 50 : 0;

_needsLabelMargin(el, allElements) {
  // No margin needed if single element
  if (allElements.length <= 1) return false;
  
  // Check if right-side label would collide with another avatar
  const labelRect = this.labelManager.getLabelRect(el.x, el.y, 'right');
  return allElements.some(other => 
    other.id !== el.id && this._rectsCollide(labelRect, this._getAvatarRect(other))
  );
}
```

### Fix 3: Clamp Lines Too (Not Recommended)

Alternatively, apply the same clamping to `createPaths()` so lines and avatars match. This is less desirable as it distorts the data visualization.

### Fix 4: Increase Right Margin in CHART_MARGIN

Quick workaround: increase `CHART_MARGIN.right` from 64 to 114 (64 + 50 labelMargin) so the line's natural endpoint falls within the safe zone.

```javascript
const CHART_MARGIN = { top: 10, right: 114, bottom: 38, left: 4 };
```

This wastes chart real estate but ensures alignment without refactoring LayoutManager.

---

## Impact Assessment

| Scenario | Impact |
|----------|--------|
| All avatars at line tips | ❌ Disconnected by 80px |
| Avatars with wide Y spread | ✅ Positions correct (just offset X) |
| Collision resolution | ⚠️ Works, but from wrong reference point |
| Connectors | ❌ Never rendered (offsetX=0 after clamping) |
| Label positioning | ⚠️ Works, but label collision check uses clamped positions |

---

## Test Cases to Add

```javascript
it('should not shift avatars when no clamping is needed', () => {
  const manager = new LayoutManager({
    bounds: { width: 1000, height: 400, margin: { right: 100 } },
    avatarRadius: 30
  });
  const elements = [
    { id: 'a1', type: 'avatar', x: 800, y: 100 }  // Well within bounds
  ];
  const result = manager.layout(elements);
  
  assert.equal(result.elements[0].x, 800);  // Should NOT be clamped
  assert.equal(result.elements[0].offsetX, 0);
});

it('should use offsetX (not modify x) when clamping is needed', () => {
  const manager = new LayoutManager({
    bounds: { width: 500, height: 400, margin: { right: 50 } },
    avatarRadius: 30
  });
  const elements = [
    { id: 'a1', type: 'avatar', x: 480, y: 100 }  // Near right edge
  ];
  const result = manager.layout(elements);
  
  // Original x should be preserved
  assert.equal(result.elements[0].x, 480);
  // Clamping should be via offset
  assert.ok(result.elements[0].offsetX < 0);
});

it('should generate connectors when avatar is clamped', () => {
  const manager = new LayoutManager({
    bounds: { width: 500, height: 400, margin: { right: 50 } },
    avatarRadius: 30,
    options: { enableConnectors: true }
  });
  const elements = [
    { id: 'a1', type: 'avatar', x: 480, y: 100 }
  ];
  const result = manager.layout(elements);
  
  assert.ok(result.connectors.length > 0);
});
```

---

## Files to Modify

1. **[LayoutManager.js](../../frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/layout/LayoutManager.js)** - Refactor `_clampBasePositions()` to use offsets
2. **[ConnectorGenerator.js](../../frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/layout/ConnectorGenerator.js)** - Check for base position clamping, not just offsetX
3. **[LayoutManager.test.js](../../frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/layout/__tests__/LayoutManager.test.js)** - Add tests with realistic bounds

---

## Quick Verification

To confirm the fix, watch for this log to disappear:
```
fitness.chart.avatar_misalignment
```

Or check that `dx` in discrepancies is `< 5` (within rounding tolerance).

---

## References

- [FitnessChartApp.jsx#L988-L1010](../../frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx) - targetLayout computation
- [FitnessChartApp.jsx#L1017-L1056](../../frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx) - Debug logging for discrepancies
- [FitnessChart.helpers.js#L425-L515](../../frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.helpers.js) - createPaths() line rendering
