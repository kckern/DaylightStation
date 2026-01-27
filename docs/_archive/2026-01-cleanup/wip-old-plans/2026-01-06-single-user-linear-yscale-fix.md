# Single-User Linear Y-Scale Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix gridline distribution in single-user mode so gridlines span the full chart height evenly (from 0 to maxValue), with the avatar appearing near the top.

**Architecture:** The `yTicks` computation in `FitnessChartApp.jsx` currently uses `lowestAvatarValue` as the start point for all cases. For single-user mode, gridlines should start from 0 and be evenly distributed to the X-axis, placing the user's line near the top of the chart.

**Tech Stack:** React, SVG chart rendering

---

## Bug Analysis

**Current behavior (line 958):**
```javascript
const start = Math.max(0, Math.min(paddedMaxValue, lowestAvatarValue));
```

This anchors the lowest gridline to where the avatar is - correct for multi-user (show relative positions), but wrong for single-user (should show absolute progress from 0).

**Expected single-user behavior:**
- Gridlines evenly distributed from 0 to paddedMaxValue
- User's line appears near the TOP (they have coins, 0 is at bottom)
- Gap between each gridline equals gap to X-axis

---

## Task 1: Update yTicks to Use Full Range for Single User

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx:956-973`
- Test: `tests/runtime/chart/chart-yscale-linear.runtime.test.mjs`

**Step 1: Run existing test to confirm it fails**

```bash
npx playwright test tests/runtime/chart/chart-yscale-linear.runtime.test.mjs --headed
```

Expected: FAIL at HURDLE 6 with "Spacing varies by 50.1px (33.3%) - not linear"

**Step 2: Modify yTicks computation**

In `FitnessChartApp.jsx`, find the `yTicks` useMemo (around line 956) and update it:

**Before:**
```javascript
const yTicks = useMemo(() => {
    if (!(paddedMaxValue > 0)) return [];
    const start = Math.max(0, Math.min(paddedMaxValue, lowestAvatarValue));
    // Use MIN_GRID_LINES to ensure consistent grid distribution
    const tickCount = MIN_GRID_LINES;
    const span = Math.max(1, paddedMaxValue - start);
    const values = Array.from({ length: tickCount }, (_, idx) => {
        const t = idx / Math.max(1, tickCount - 1);
        return start + span * t;
    });
    return values.map((value) => ({
        value,
        label: value.toFixed(0),
        y: scaleY(value),
        x1: 0,
        x2: chartWidth
    }));
}, [paddedMaxValue, lowestAvatarValue, chartWidth, scaleY]);
```

**After:**
```javascript
const yTicks = useMemo(() => {
    if (!(paddedMaxValue > 0)) return [];

    // Single user: gridlines span full range from 0 to max (linear distribution)
    // Multi-user: gridlines span from lowest avatar to max (focus on relative positions)
    const isSingleUser = allEntries.length === 1;
    const start = isSingleUser ? 0 : Math.max(0, Math.min(paddedMaxValue, lowestAvatarValue));

    // Use MIN_GRID_LINES to ensure consistent grid distribution
    const tickCount = MIN_GRID_LINES;
    const span = Math.max(1, paddedMaxValue - start);
    const values = Array.from({ length: tickCount }, (_, idx) => {
        const t = idx / Math.max(1, tickCount - 1);
        return start + span * t;
    });
    return values.map((value) => ({
        value,
        label: value.toFixed(0),
        y: scaleY(value),
        x1: 0,
        x2: chartWidth
    }));
}, [paddedMaxValue, lowestAvatarValue, chartWidth, scaleY, allEntries.length]);
```

**Step 3: Run test to verify it passes**

```bash
npx playwright test tests/runtime/chart/chart-yscale-linear.runtime.test.mjs --headed
```

Expected: PASS - all 7 hurdles pass, gridlines evenly spaced

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx
git commit -m "fix(chart): use full Y-range for single-user linear scale

Single-user sessions now display gridlines from 0 to maxValue,
evenly distributed across the full chart height. This places
the user's line near the top (showing absolute progress) rather
than anchoring gridlines to the avatar position (multi-user behavior)."
```

---

## Task 2: Update Documentation

**Files:**
- Modify: `docs/reference/fitness/features/fitness-chart.md`

**Step 1: Update Y-Scale Behavior section**

Find the Y-Scale Behavior section and add clarification about gridline distribution:

Add after the "Key behaviors" list:

```markdown
**Gridline distribution:**

| Mode | Gridline Range | User Position |
|------|----------------|---------------|
| Single user | 0 to maxValue (full chart) | Near top (absolute progress) |
| Multi-user | lowestAvatar to maxValue | Distributed by relative rank |

In single-user mode, gridlines span the full chart height from 0 (X-axis) to the maximum value, with equal spacing between all gridlines including the gap to the X-axis. The user's line appears near the top of the chart, showing their absolute coin progress.
```

**Step 2: Commit**

```bash
git add docs/reference/fitness/features/fitness-chart.md
git commit -m "docs(chart): clarify single-user gridline distribution"
```

---

## Task 3: Verify Multi-User Mode Still Works

**Files:**
- Test: Manual verification or create new test

**Step 1: Manually verify multi-user behavior**

Start dev server and simulate 2+ users to confirm:
- Gridlines still anchor to lowest avatar position
- Relative ranking is still visible
- No regression in multi-user display

**Step 2: (Optional) Add multi-user test**

If time permits, create `tests/runtime/chart/chart-yscale-multiuser.runtime.test.mjs` to verify multi-user log scale persists correctly.

---

## Summary

| Task | Description | Est. Time |
|------|-------------|-----------|
| 1 | Fix yTicks to use full range for single user | 5 min |
| 2 | Update documentation | 3 min |
| 3 | Verify multi-user mode | 5 min |

**Total: ~15 minutes**
