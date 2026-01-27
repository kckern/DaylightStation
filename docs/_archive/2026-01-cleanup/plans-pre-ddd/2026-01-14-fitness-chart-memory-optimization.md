# Fitness Chart Memory Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix memory leaks causing browser crashes during extended fitness sessions by eliminating render loops, adding safety caps, and optimizing object creation.

**Architecture:** The fix addresses three layers: (1) roster caching in FitnessSession.js for stable React references, (2) safety limits on series data accumulation, (3) optimized useMemo to avoid unnecessary object creation.

**Tech Stack:** React hooks (useMemo, useCallback, useRef), JavaScript ES6

---

## Background

Production sessions crashed after ~47 minutes with 692K+ data points accumulated (expected: ~4,400). Root cause: unstable `roster` reference caused 60fps useMemo recalculations, amplified by:
- `validatedEntries` creating new objects unconditionally
- Console.warn in hot path (16,623 warnings logged)
- No safety caps on series data

## Current State

**Already implemented (uncommitted in FitnessChartApp.jsx):**
- `MAX_SERIES_POINTS = 1000` safety cap
- Series trimming in `useRaceChartData`
- `throttledWarn` callback (5s cooldown)
- `validatedEntries` optimization (return original if unchanged)

**Already committed:**
- `clone: true` removal from FitnessChart.helpers.js
- `intervalMs` inlining in xTicks useMemo

**Separate file (user implementing):**
- Roster caching in FitnessSession.js

---

### Task 1: Review and Test Current Changes

**Files:**
- Review: `frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx`

**Step 1: Verify current diff is correct**

Run:
```bash
git diff frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx | head -100
```

Expected: Shows safety limits, throttledWarn, and validatedEntries optimization.

**Step 2: Run lint check**

Run:
```bash
cd frontend && npm run lint -- --quiet src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx
```

Expected: No errors (warnings acceptable).

**Step 3: Run type check (if applicable)**

Run:
```bash
cd frontend && npm run build -- --mode development 2>&1 | head -30
```

Expected: Build succeeds without errors.

---

### Task 2: Add Global Safety Cap Check

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx:73-82`

**Step 1: Add global cap check after series trimming**

In `useRaceChartData`, after the `debugItems.map()` block, add global cap enforcement:

```javascript
// After line ~125 (after debugItems is built, before shaped filter)

// Global safety cap - if total points exceed limit, log warning
const totalPoints = debugItems.reduce((sum, e) => sum + (e.beats?.length || 0), 0);
if (totalPoints > MAX_TOTAL_POINTS) {
	console.warn(`[FitnessChart] Global cap warning: ${totalPoints} total points across ${debugItems.length} entries`);
}
```

**Step 2: Verify the change**

Run:
```bash
grep -A2 "Global safety cap" frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx
```

Expected: Shows the new global cap check code.

---

### Task 3: Commit Memory Optimization Changes

**Files:**
- Stage: `frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx`

**Step 1: Stage the changes**

Run:
```bash
git add frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx
```

**Step 2: Commit with descriptive message**

Run:
```bash
git commit -m "$(cat <<'EOF'
fix: prevent memory leak in FitnessChart render loop

- Add MAX_SERIES_POINTS (1000) safety cap per series
- Add MAX_TOTAL_POINTS (50000) global safety cap
- Throttle console warnings to 5s cooldown per key
- Optimize validatedEntries to return original object when status unchanged
- Prevents 692K+ data point accumulation bug

Fixes: render loop caused by unstable references creating 60fps recalculations

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

**Step 3: Verify commit**

Run:
```bash
git log --oneline -1 && git show --stat HEAD
```

Expected: Shows commit with FitnessChartApp.jsx changes.

---

### Task 4: Update Design Document

**Files:**
- Modify: `docs/_wip/2026-01-14-fitness-chart-memory-leak-fix.md`

**Step 1: Update status and add new fixes**

Add the following to the "Solution" section:

```markdown
### Fix 4: Series Point Safety Caps

Added hard limits to prevent unbounded data accumulation:

```javascript
const MAX_SERIES_POINTS = 1000;  // ~83 minutes at 5s intervals
const MAX_TOTAL_POINTS = 50000;  // Global cap across all series

// In useRaceChartData - trim per series
if (beats.length > MAX_SERIES_POINTS) {
  beats = beats.slice(-MAX_SERIES_POINTS);
  zones = zones.slice(-MAX_SERIES_POINTS);
  active = active.slice(-MAX_SERIES_POINTS);
}
```

### Fix 5: Throttled Warnings

Prevent hot path console.warn penalty:

```javascript
const throttledWarn = useCallback((key, message) => {
  const now = Date.now();
  if (!warnThrottleRef.current[key] || now - warnThrottleRef.current[key] > 5000) {
    console.warn(message);
    warnThrottleRef.current[key] = now;
  }
}, []);
```

### Fix 6: Object Creation Optimization

Only create new objects when status actually differs:

```javascript
if (entry.status === correctStatus) {
  return entry; // Same reference - no re-render triggered
}
return { ...entry, status: correctStatus };
```
```

**Step 2: Stage and commit docs**

Run:
```bash
git add docs/_wip/2026-01-14-fitness-chart-memory-leak-fix.md
git commit -m "docs: update memory leak fix documentation with safety caps"
```

---

### Task 5: Manual Testing Checklist

**Step 1: Start dev server**

Run:
```bash
npm run dev
```

**Step 2: Test scenarios (manual)**

| Scenario | Expected Result |
|----------|-----------------|
| Start fitness session with 2+ users | Chart renders, heap stays under 100MB |
| Run session for 10+ minutes | No console warning spam |
| End session | Memory drops within 30 seconds |
| Status flicker (device disconnect/reconnect) | No render loop, throttled warnings only |

**Step 3: Check browser DevTools**

- Open Performance tab
- Record 60 seconds of active session
- Verify: No sawtooth memory pattern, heap stable

---

## Verification Criteria

- [ ] Build passes without errors
- [ ] Lint passes without errors
- [ ] No console warning spam during session
- [ ] Heap stays under 150MB for 30+ minute session
- [ ] Memory drops after session ends (< 30 seconds)
- [ ] All changes committed with descriptive messages
