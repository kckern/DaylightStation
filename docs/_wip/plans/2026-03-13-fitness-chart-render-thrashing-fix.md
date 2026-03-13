# FitnessChart Render Thrashing Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate the 15 renders/sec FitnessChart thrashing that has persisted through every session since the chart was introduced, plus fix the negative FPS diagnostic metric.

**Architecture:** Three targeted interventions at different levels of the render cascade: (1) stabilize the participantCache state updater to return `prev` when data hasn't meaningfully changed, (2) eliminate the removed→idle status contradiction that creates unnecessary object allocations, (3) guard the FPS profiler against video element lifecycle resets. No architectural changes to the roster/session tick system.

**Tech Stack:** React (useMemo, useEffect, useState), existing FitnessChart widget, FitnessApp profiler

**Audit Reference:** `docs/_wip/audits/2026-03-13-fitness-chart-render-thrashing-and-midstream-stall.md`

---

## Background: Why This Keeps Happening

The render cascade has been a known issue since at least Feb 16 (ghost participant oscillation audit). Multiple plans tried to address symptoms (telemetry gaps, data quality fixes, session history chart refactor), but none targeted the core problem: **the participantCache `useEffect` creates new objects on every `presentEntries` change, even when the visual output is identical.**

The existing mitigations:
- `rosterCacheRef` with JSON signature in FitnessContext (line 1434-1462) — **helps** but heartRate/zoneColor change on every tick during exercise, so signature changes ~4/sec
- `batchedForceUpdate` with 250ms throttle — caps context renders at 4/sec, but chart re-renders independently via participantCache state changes
- `validatedEntries` returns same reference if status matches (line 450-451) — **correct** but undermined by cache always producing new objects

The fix targets the **chart-internal** cascade, not the context/roster layer. The context layer is already well-optimized.

---

## Task 1: Stabilize participantCache State Updater

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx:356-425`
- Test: Manual verification via prod logs (render_thrashing events should stop)

**Why this is P0:** This single useEffect is the root of the cascade. Every time `presentEntries` changes reference (which happens on every roster tick ~4/sec), it calls `setParticipantCache` which creates new entry objects. Even if every field value is identical, `{ ...prevEntry, ...entry }` creates a new reference. New reference → new `allEntries` → new `validatedEntries` → new `present`/`absent` → full SVG re-render.

**Step 1: Add shallow comparison helper above useRaceChartWithHistory**

Add this at the top of the file (after imports, before `useRaceChartData`):

```javascript
/**
 * Shallow-compare two participant cache entries.
 * Returns true if all chart-relevant fields are identical.
 * Skips beats/zones/segments arrays — those are compared by length + last value.
 */
function cacheEntryEqual(a, b) {
	if (a === b) return true;
	if (!a || !b) return false;
	// Identity
	if (a.id !== b.id || a.profileId !== b.profileId) return false;
	// Status (drives avatar vs badge rendering)
	if (a.status !== b.status || a.isActive !== b.isActive) return false;
	// Visual data (drives line rendering)
	if (a.lastSeenTick !== b.lastSeenTick || a.lastValue !== b.lastValue) return false;
	// Series lengths (if series grew, need new render)
	if ((a.beats?.length || 0) !== (b.beats?.length || 0)) return false;
	if ((a.segments?.length || 0) !== (b.segments?.length || 0)) return false;
	// Zone color (drives line color)
	if (a.color !== b.color) return false;
	// Dropout markers (drives badge rendering)
	if ((a.dropoutMarkers?.length || 0) !== (b.dropoutMarkers?.length || 0)) return false;
	return true;
}
```

**Step 2: Modify the participantCache useEffect to bail early when nothing changed**

Replace the `useEffect` at line 356-425 with a version that compares before creating new state:

```javascript
useEffect(() => {
	setParticipantCache((prev) => {
		const next = { ...prev };
		const presentIds = new Set();
		let changed = false;

		presentEntries.forEach((entry) => {
			const id = entry.profileId || entry.id;
			presentIds.add(id);
			const lastValue = getLastFiniteValue(entry.beats || []);
			const lastSeenTick = entry.lastIndex;
			const prevEntry = prev[id];

			// Preserve existing dropout markers (IMMUTABLE) for badge rendering
			// CRITICAL: Create a NEW array to avoid mutating previous state
			let dropoutMarkers = prevEntry?.dropoutMarkers || [];

			// Create dropout marker ONLY when returning from dropout (was inactive, now active again)
			const wasInactive = prevEntry && (prevEntry.isActive === false || !isBroadcasting(prevEntry.status));
			const nowActive = entry.isActive !== false;
			const isRejoining = wasInactive && nowActive;

			if (isRejoining && prevEntry.lastValue != null && (prevEntry.lastSeenTick ?? -1) >= 0) {
				const firstNewIdx = findFirstFiniteAfter(entry.beats || [], prevEntry.lastSeenTick ?? -1);
				if (firstNewIdx != null) {
					const newMarker = {
						tick: prevEntry.lastSeenTick,
						value: prevEntry.lastValue,
						timestamp: Date.now()
					};
					const isDuplicate = dropoutMarkers.some(m => m.tick === newMarker.tick);
					if (!isDuplicate) {
						dropoutMarkers = [...dropoutMarkers, newMarker];
					}
				}
			}

			const candidate = {
				...prevEntry,
				...entry,
				segments: entry.segments,
				beats: entry.beats,
				zones: entry.zones,
				lastSeenTick,
				lastValue,
				status: entry.status,
				isActive: entry.isActive,
				dropoutMarkers,
				absentSinceTick: entry.status === ParticipantStatus.IDLE ? (prevEntry?.absentSinceTick ?? lastSeenTick) : null
			};

			// Only create new entry if something chart-relevant changed
			if (cacheEntryEqual(prevEntry, candidate)) {
				// Keep previous reference — prevents downstream invalidation
				next[id] = prevEntry;
			} else {
				next[id] = candidate;
				changed = true;
			}
		});

		Object.keys(next).forEach((id) => {
			if (!presentIds.has(id)) {
				const ent = next[id];
				if (ent && (ent.status !== ParticipantStatus.REMOVED || ent.isActive !== false)) {
					next[id] = {
						...ent,
						status: ParticipantStatus.REMOVED,
						isActive: false,
						absentSinceTick: ent.absentSinceTick ?? ent.lastSeenTick ?? 0
					};
					changed = true;
				}
			}
		});

		// Return previous state if nothing meaningful changed — prevents re-render
		return changed ? next : prev;
	});
}, [presentEntries]);
```

**Key changes:**
1. `cacheEntryEqual()` comparison before writing new entry
2. Track `changed` flag — if no entries changed, return `prev` (React skips re-render)
3. For REMOVED path: only create new object if not already REMOVED

**Step 3: Verify the fix**

Run: Deploy to prod (or dev with simulated HR data), check logs for:
- `fitness.render_thrashing` events should **stop appearing**
- `fitness-profile-excessive-renders` should show `forceUpdateCount` < 20 per 30s window (down from 115+)
- `[FitnessChart] Status corrected:` should stop appearing

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx
git commit -m "fix(fitness): stabilize FitnessChart participantCache to prevent render thrashing

The participantCache useEffect created new entry objects on every presentEntries
change (~4/sec during exercise), even when chart-relevant data was identical.
This cascaded through allEntries → validatedEntries → present/absent → SVG,
causing 15 renders/sec sustained for the entire session.

Add shallow cacheEntryEqual() comparison to skip state updates when nothing
meaningful changed. Return prev state from the updater when no entries differ,
which React treats as a no-op (no re-render).

Also fix the REMOVED status path to avoid creating new objects for entries
already in REMOVED state.

Addresses: docs/_wip/audits/2026-03-13-fitness-chart-render-thrashing-and-midstream-stall.md"
```

---

## Task 2: Eliminate the removed→idle Status Contradiction

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx:408-422` and `442-459`

**Why this matters:** The code at line 416 sets `status: REMOVED` for absent users, then `validatedEntries` at line 447 immediately "corrects" REMOVED to IDLE. This is a contradiction within the same component. After Task 1, this path should fire much less often, but the contradiction should be eliminated to prevent confusion and unnecessary object creation.

**Step 1: Fix the REMOVED path to use isActive-aware status directly**

In the `Object.keys(next).forEach` block (around line 408), change the REMOVED assignment:

Replace:
```javascript
next[id] = {
	...ent,
	status: ParticipantStatus.REMOVED,
	isActive: false,
	absentSinceTick: ent.absentSinceTick ?? ent.lastSeenTick ?? 0
};
```

With:
```javascript
next[id] = {
	...ent,
	status: ParticipantStatus.IDLE,
	isActive: false,
	absentSinceTick: ent.absentSinceTick ?? ent.lastSeenTick ?? 0
};
```

**Step 2: Remove the redundant validatedEntries correction for REMOVED→IDLE**

The `validatedEntries` useMemo (line 442-459) now only needs to handle genuine mismatches (ACTIVE when should be IDLE or vice versa), not the REMOVED→IDLE case that was the most frequent trigger.

No code change needed — the existing logic at line 447 (`isActiveFromRoster ? ACTIVE : IDLE`) will now match the cache status, so the `entry.status === correctStatus` check at line 450 will return true, returning the same reference. The throttled warning log will stop firing.

**Step 3: Verify**

Check logs:
- `[FitnessChart] Status corrected: kckern (removed → idle)` should **never appear**
- If any status correction logs appear, they indicate a real bug (not the oscillation)

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx
git commit -m "fix(fitness): set IDLE status directly for absent participants instead of REMOVED

The code set status=REMOVED for absent users, then validatedEntries immediately
corrected it to IDLE, creating a new object and logging 'Status corrected:
(removed → idle)' every 5 seconds. Set IDLE directly since that's the correct
status for inactive-but-not-purged participants."
```

---

## Task 3: Guard FPS Profiler Against Video Element Resets

**Files:**
- Modify: `frontend/src/Apps/FitnessApp.jsx:145-182`

**Why this matters:** When video recovery strategies reset the video element, `totalVideoFrames` resets to 0 but `lastFpsCheck.totalFrames` retains the old value (e.g., 658,000). This produces impossible values like `fps: -658.9` which pollute diagnostics and trigger false `video_fps_degraded` warnings.

**Step 1: Add counter-reset guard in getVideoFps()**

In the `getVideoFps` function (around line 146), after the `quality` check, add a guard:

Replace the fps calculation block (lines 155-165):
```javascript
const now = performance.now();
const elapsed = (now - lastFpsCheck.timestamp) / 1000;
const framesDelta = quality.totalVideoFrames - lastFpsCheck.totalFrames;
const droppedDelta = quality.droppedVideoFrames - lastFpsCheck.droppedFrames;

// Calculate FPS only if we have a previous sample
let fps = null;
let dropRate = null;
if (lastFpsCheck.timestamp > 0 && elapsed > 0) {
    fps = Math.round(framesDelta / elapsed * 10) / 10;
    dropRate = framesDelta > 0 ? Math.round(droppedDelta / framesDelta * 1000) / 10 : 0;
}
```

With:
```javascript
const now = performance.now();
const elapsed = (now - lastFpsCheck.timestamp) / 1000;
const framesDelta = quality.totalVideoFrames - lastFpsCheck.totalFrames;
const droppedDelta = quality.droppedVideoFrames - lastFpsCheck.droppedFrames;

// Guard: video element was reloaded/reset — frame counter went backwards
// Reset tracking and skip this sample
if (framesDelta < 0) {
    lastFpsCheck = {
        timestamp: now,
        totalFrames: quality.totalVideoFrames,
        droppedFrames: quality.droppedVideoFrames
    };
    return null;
}

// Calculate FPS only if we have a previous sample
let fps = null;
let dropRate = null;
if (lastFpsCheck.timestamp > 0 && elapsed > 0) {
    fps = Math.round(framesDelta / elapsed * 10) / 10;
    dropRate = framesDelta > 0 ? Math.round(droppedDelta / framesDelta * 1000) / 10 : 0;
}
```

**Step 2: Verify**

After a video recovery event (seek, stall recovery), the `fitness.video_fps_degraded` warning should NOT fire with negative fps values. The next sample after recovery will return null (skipped), and subsequent samples will calculate correctly from the reset baseline.

**Step 3: Commit**

```bash
git add frontend/src/Apps/FitnessApp.jsx
git commit -m "fix(fitness): guard FPS profiler against negative values after video element reset

When video recovery strategies reload the element, totalVideoFrames resets
to 0 but lastFpsCheck retains the old count, producing impossible values
like fps: -658.9. Detect counter going backwards and reset the baseline
instead of computing garbage."
```

---

## Task 4: Verify All Fixes Together

**Step 1: Build and deploy**

```bash
npm run build  # or dev server
```

**Step 2: Run a fitness session with HR data**

Either use the simulate endpoint or physical devices:
```bash
curl -X POST http://localhost:3111/api/v1/fitness/simulate -H 'Content-Type: application/json' -d '{"users":2,"durationMs":120000}'
```

**Step 3: Check metrics after 2 minutes**

In prod logs, verify:
1. **No render thrashing:** `grep render_thrashing` should return nothing
2. **Low forceUpdateCount:** `fitness-profile` samples should show `forceUpdateCount < 30` per 30s
3. **No status correction spam:** `grep "Status corrected"` should return nothing
4. **No negative FPS:** `grep video_fps_degraded` should not show negative values
5. **Chart still renders correctly:** Visual inspection — avatars move, lines update, dropout badges appear on disconnect

**Step 4: Commit verification result**

No code change — just verify. If tests exist for FitnessChart, run them:
```bash
npx playwright test tests/live/flow/fitness/ --reporter=line
```

---

## What This Does NOT Fix

These are documented in the audit but intentionally out of scope:

1. **Mid-stream DASH stalls (65s freeze)** — This is a Plex transcoding latency issue, not a frontend bug. The player recovery pipeline handled it correctly. A loading spinner during extended stalls would be a separate UX improvement.

2. **Roster object creation in ParticipantRoster.getRoster()** — Creating new entry objects on every call is wasteful, but the FitnessContext `rosterCacheRef` already mitigates this with JSON signature comparison. The chart-internal fix (Task 1) makes the roster layer's object churn irrelevant to rendering.

3. **Context render frequency (4/sec)** — The 250ms throttle in `batchedForceUpdate` is already a reasonable cap. The problem was never the context render rate — it was the chart creating new objects in response to each render.
