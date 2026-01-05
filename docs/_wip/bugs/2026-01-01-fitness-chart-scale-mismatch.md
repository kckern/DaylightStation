# Bug Report: Fitness Chart Scale Function Mismatch

**Date Discovered:** January 1, 2026  
**Severity:** High  
**Status:** Partially Remediated  
**Component:** FitnessChartApp / FitnessChart.helpers.js

---

## Summary

Avatar positions and chart line paths were rendered using **different Y-scale functions**, causing visual misalignment where avatars appeared detached from the tips of their corresponding data lines.

---

## Root Cause

### The Problem

`FitnessChartApp.jsx` implements an **adaptive Y-scale** that changes behavior based on the number of participants:

| Users | Scale Strategy |
|-------|----------------|
| 1 | Linear |
| 2 | Standard logarithmic (`yScaleBase = 20`) |
| 3+ | Power curve that clamps lowest user to 25% height |

However, `createPaths()` in `FitnessChart.helpers.js` used a **hardcoded logarithmic scale** that ignored:
- The adaptive logic for 3+ users
- The `lowestValue` clamping calculation
- Any external `scaleY` function passed to it

This meant:
- **Avatars**: Used the adaptive scale (correct)
- **Lines**: Used the hardcoded log scale (incorrect)

When 3+ users were present, the power curve diverged significantly from the standard log curve, causing visible misalignment.

### Code Evidence

**FitnessChartApp.jsx** (adaptive scale):
```javascript
const scaleY = useMemo(() => {
  // ...
  if (userCount === 1) {
    mapped = norm; // Linear
  } else if (userCount === 2) {
    // Standard log
    mapped = 1 - Math.log(1 + (1 - norm) * (logBase - 1)) / Math.log(logBase);
  } else {
    // 3+ users: Power curve to clamp bottom user
    const k = Math.log(0.25) / Math.log(normLow);
    mapped = Math.pow(norm, k);
  }
  // ...
}, [/* deps including allEntries.length, lowestValue */]);
```

**FitnessChart.helpers.js** (hardcoded scale - BEFORE FIX):
```javascript
const scaleY = (v) => {
  // Always used standard log, ignored userCount entirely
  if (yScaleBase > 1) {
    mapped = 1 - Math.log(1 + (1 - norm) * (yScaleBase - 1)) / Math.log(yScaleBase);
  }
  // ...
};
```

---

## Immediate Fix Applied

Modified `createPaths()` to accept an optional `scaleY` function:

```javascript
// FitnessChart.helpers.js
const defaultScaleY = (v) => { /* old hardcoded logic */ };
const scaleY = options.scaleY || defaultScaleY;
```

```javascript
// FitnessChartApp.jsx
const created = createPaths(entry.segments, {
  // ... other options
  scaleY // Pass the exact same scale function used for avatars
});
```

---

## Remaining Remediation Required

### 1. Audit All Scale Function Consumers

The following components/functions may have similar issues:

| Location | Risk | Status |
|----------|------|--------|
| `FitnessChart.jsx` (sidebar) | Medium | **NEEDS AUDIT** |
| `FitnessChartApp.jsx` (TV view) | Fixed | ✅ |
| `computeBadgePositions()` | Low | Uses passed `scaleY` |
| `computeAvatarPositions()` | Low | Uses passed `scaleY` |
| `yTicks` generation | Medium | **NEEDS AUDIT** - may use different scale |
| Connector generation | Low | Uses avatar positions |

### 2. Consolidate Scale Function

**Problem:** The adaptive scale logic is duplicated:
- Once in `FitnessChartApp.jsx` 
- Will need to exist in `FitnessChart.jsx` (sidebar) too
- Any future chart views will need it

**Recommendation:** Extract to a shared utility:

```javascript
// Proposed: frontend/src/modules/Fitness/FitnessSidebar/scaleUtils.js

export const createAdaptiveScaleY = ({
  minValue,
  maxValue,
  userCount,
  lowestValue,
  chartHeight,
  margin,
  yScaleBase = 20
}) => {
  // Consolidated adaptive logic here
  return (value) => { /* ... */ };
};
```

### 3. Add Integration Tests

**Missing Coverage:**
- No tests verify that line endpoints match avatar positions
- No visual regression tests for multi-user scenarios

**Recommended Tests:**
```javascript
describe('FitnessChart Scale Consistency', () => {
  it('should have avatars positioned at line endpoints for 1 user', () => {});
  it('should have avatars positioned at line endpoints for 2 users', () => {});
  it('should have avatars positioned at line endpoints for 3+ users', () => {});
  it('should maintain alignment during value changes', () => {});
});
```

### 4. Remove Debug Logging

The following debug logging should be removed after verification:

```javascript
// FitnessChartApp.jsx - line ~960
console.log('[FitnessChart] Positions:', positions);
```

### 5. Verify Y-Tick Grid Lines

The `yTicks` calculation uses the same `scaleY` function, but the grid lines may not align with the adaptive curve in all scenarios. Visual inspection needed for:
- 3+ user scenarios
- Users with widely varying values
- Edge cases (all users at same value)

---

## How This Bug Escaped Detection

1. **Visual similarity**: At 2 users, both scales were identical (standard log)
2. **Testing gaps**: Unit tests focused on layout strategies, not scale consistency
3. **Gradual divergence**: The power curve only diverges significantly when values spread out
4. **Animation masking**: The animation smoothing could hide small misalignments

---

## Verification Steps

After full remediation:

1. Run simulation with 1 user - verify alignment
2. Run simulation with 2 users - verify alignment  
3. Run simulation with 3+ users - verify alignment
4. Check dev.log for `[FitnessChart] Avatar/Line misalignment detected` warnings
5. Visually inspect during rapid value changes
6. Run automated tests

---

## Lessons Learned

1. **Single Source of Truth**: Scale functions should be defined once and passed everywhere
2. **Integration Testing**: Unit tests on isolated components missed this cross-component bug
3. **Visual QA**: Automated visual regression tests would have caught this immediately
4. **Code Duplication**: Helper functions that duplicate logic from main components are risky

---

## Related Files

- [FitnessChartApp.jsx](../../frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx)
- [FitnessChart.helpers.js](../../frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.helpers.js)
- [Layout Manager Design Doc](../design/fitness-chart-layout-manager.md)
