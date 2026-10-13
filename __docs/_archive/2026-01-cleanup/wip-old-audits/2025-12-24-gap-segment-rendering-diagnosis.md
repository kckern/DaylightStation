# Gap Segment Rendering Diagnosis

**Date:** December 24, 2025  
**Issue:** Grey dotted line not appearing on rejoin - colored line renders instead

---

## Current Symptoms

1. User drops out → colored line stops at dropout point ✅
2. Dropout badge ("M") appears at dropout point ✅  
3. User rejoins → line continues as COLORED (yellow), NOT grey dotted ❌
4. The horizontal + vertical connection should be grey dotted

---

## Data Flow Analysis

### 1. Gap Segment Creation (FitnessChart.helpers.js)

```javascript
// When user rejoins (inGap && gapStartPoint):
const gapSegment = {
  zone: null,
  color: getZoneColor(null),  // Should return grey
  status: ParticipantStatus.IDLE,
  isGap: true,                // This should trigger dotted rendering
  points: [
    { ...gapStartPoint },           // Dropout point
    { i, v: gapStartPoint.v },      // Horizontal to rejoin tick
    { i, v: value }                 // Vertical to rejoin value
  ]
};
segments.push(gapSegment);
```

**Questions:**
- Is `gapSegment` actually being pushed to `segments`?
- Is `getZoneColor(null)` returning the right grey color?
- Is `isGap: true` being preserved?

### 2. Path Creation (createPaths function)

```javascript
// FitnessChart.helpers.js line ~375
const segIsGap = Boolean(seg.isGap) || isDropout(seg.status);
return {
  zone: seg.zone,
  color: seg.color,
  status: seg.status || (segIsGap ? ParticipantStatus.IDLE : ParticipantStatus.ACTIVE),
  opacity: segIsGap ? 0.5 : (seg.color === defaultColor ? 0.1 : 1),
  isGap: segIsGap,
  d: path  // SVG path string
};
```

**Questions:**
- Is `seg.isGap` true when this runs?
- Is `segIsGap` being set correctly?
- Is `opacity: 0.5` being applied?

### 3. SVG Rendering (FitnessChartApp.jsx)

```jsx
// Line ~485-495
{paths.map((path, idx) => (
  <path
    key={`${path.zone || 'seg'}-${idx}`}
    d={path.d}
    stroke={path.isGap ? ZONE_COLOR_MAP.default : path.color}
    fill="none"
    strokeWidth={PATH_STROKE_WIDTH}
    opacity={path.opacity ?? 1}
    strokeLinecap={path.isGap ? 'butt' : 'round'}
    strokeLinejoin="round"
    strokeDasharray={path.isGap ? '4 4' : undefined}
  />
))}
```

**Questions:**
- Is `path.isGap` true when rendering?
- Is `ZONE_COLOR_MAP.default` the correct grey color?
- Is `strokeDasharray="4 4"` being applied?

---

## Hypothesis 1: Gap Segment Not Being Created

The gap segment creation depends on:
1. `inGap === true`
2. `gapStartPoint` exists

`inGap` is set when `isDropout(tickStatus)` returns true:
```javascript
if (isDropout(tickStatus)) {
  if (!gapStartPoint && lastPoint) {
    gapStartPoint = { ...lastPoint };
  }
  inGap = true;
  continue;  // Skip this point
}
```

**Potential Issue:** If the user's `active` array doesn't have `false` values during the dropout period, `tickStatus` won't be `IDLE`, so `isDropout(tickStatus)` returns false, and we never enter the gap state.

Let me check what `active` array looks like for the user.

---

## Hypothesis 2: Segments Array Order

The segments are built in order. If the gap segment is added AFTER processing continues, it might be in the wrong position in the array, causing rendering issues.

Current flow:
1. Loop through beats
2. When `isActiveAtTick` is false (dropout), set `inGap = true`, `continue`
3. When `isActiveAtTick` becomes true again (rejoin), create gap segment
4. Then continue to add current point to new colored segment

The gap segment SHOULD be added before the new colored segment.

---

## Hypothesis 3: createPaths Not Receiving Gap Segments

`createPaths` is called with `entry.segments`. Let me trace where this comes from:

```javascript
// useRaceChartData:
const segments = buildSegments(beats, zones, active);
// ...
return { segments, ... };

// useRaceChartWithHistory:
next[id] = {
  ...entry,
  segments: entry.segments,  // Pass through
  // ...
};

// Rendering:
const paths = useMemo(() => {
  return allEntries.flatMap((entry) => 
    createPaths(entry.segments, scaleX, scaleY)
  );
}, [...]);
```

**Potential Issue:** Are `entry.segments` being correctly passed through all the hooks?

---

## Hypothesis 4: isGap Being Lost

The `isGap` property might be lost somewhere in the data flow:

1. Created in `buildSegments` ✓
2. Returned from `buildBeatsSeries`... wait, NO!

**FOUND IT!**

`buildBeatsSeries` returns `{ beats, zones, active }` - it does NOT return segments!

```javascript
// FitnessChart.helpers.js
export const buildBeatsSeries = (rosterEntry, getSeries, timebase, options = {}) => {
  // ...
  return { beats, zones, active };  // No segments!
};
```

Then in `useRaceChartData`:
```javascript
const { beats, zones, active } = buildBeatsSeries(entry, getSeries, timebase, { activityMonitor });
const segments = buildSegments(beats, zones, active);  // Segments built here
```

So segments ARE being built in the right place. Let me check if they're being passed to `createPaths`.

---

## Hypothesis 5: createPaths Called With Wrong Data

Let me find where `createPaths` is actually called:

```javascript
// FitnessChartApp.jsx
const paths = useMemo(() => {
  if (!allEntries.length || !scaleX || !scaleY) return [];
  return allEntries.flatMap((entry) => {
    if (!entry.segments?.length) return [];
    return createPaths(entry.segments, scaleX, scaleY);
  });
}, [allEntries, scaleX, scaleY]);
```

So `createPaths` receives `entry.segments` from `allEntries`.

Where does `allEntries` come from?
```javascript
const { allEntries, presentEntries, ... } = useRaceChartWithHistory(...);
```

And in `useRaceChartWithHistory`:
```javascript
const allEntries = useMemo(() => 
  Object.values(participantCache).filter((e) => e && (e.segments?.length || 0) > 0), 
  [participantCache]
);
```

So entries come from `participantCache`, which is set by:
```javascript
next[id] = {
  ...prevEntry,
  ...entry,
  segments: entry.segments,
  // ...
};
```

**The segments should be correct here.** Let me check if `createPaths` is handling them right.

---

## Hypothesis 6: createPaths Implementation Bug

```javascript
export const createPaths = (segments, scaleX, scaleY) => {
  if (!Array.isArray(segments) || segments.length === 0) return [];
  return segments.map((seg) => {
    const points = seg.points || [];
    if (points.length === 0) return null;
    const path = points.reduce((acc, { i, v }, idx) => {
      const x = scaleX(i).toFixed(2);
      const y = scaleY(v).toFixed(2);
      return acc + `${idx === 0 ? 'M' : 'L'}${x},${y} `;
    }, '').trim();
    const segIsGap = Boolean(seg.isGap) || isDropout(seg.status);
    // ...
  }).filter(Boolean);
};
```

This looks correct. The `segIsGap` should be true if `seg.isGap` is true.

---

## Hypothesis 7: buildSegments Not Creating Gap

Let me trace through what happens when user rejoins:

1. User at tick 5, value 10, active
2. User at tick 6, value 10, INACTIVE (dropout starts)
   - `isDropout(tickStatus)` → true
   - `gapStartPoint = { i: 5, v: 10 }`
   - `inGap = true`
   - `continue` (skip tick 6)
3. User at tick 7, value 10, INACTIVE
   - `isDropout(tickStatus)` → true
   - `inGap` already true
   - `continue` (skip tick 7)
4. User at tick 8, value 12, ACTIVE (rejoin!)
   - `isDropout(tickStatus)` → false
   - Check: `if (inGap && gapStartPoint)`... YES!
   - Create gap segment with points:
     - `{ i: 5, v: 10 }` (dropout)
     - `{ i: 8, v: 10 }` (horizontal to rejoin tick)
     - `{ i: 8, v: 12 }` (vertical to rejoin value)
   - Push gap segment
   - Set `lastPoint = { i: 8, v: 12 }`
   - Continue to add tick 8 to new colored segment

**Wait!** After pushing the gap segment, we continue in the same iteration:
```javascript
if (inGap && gapStartPoint) {
  // ... create and push gap segment
  lastPoint = { i, v: value };
  gapStartPoint = null;
  inGap = false;
}
// Then falls through to:
const zone = zoneRaw || lastZone || null;
const color = getZoneColor(zone);
// Creates new colored segment and adds current point
```

So the current point (tick 8, value 12) is ALSO added to a new colored segment. That's correct.

But wait - `lastPoint` is set to the rejoin point. Then when creating the new segment:
```javascript
if (lastPoint) {
  current.points.push({ ...lastPoint });  // Adds { i: 8, v: 12 }
}
// ...
current.points.push({ i, v: value });  // Also adds { i: 8, v: 12 }
```

This adds the same point TWICE! That's not a rendering issue though.

---

## Hypothesis 8: Active Array Issue

The `active` array is built from either ActivityMonitor or heart_rate nulls.

For the user who dropped out:
- During dropout ticks, `active[i]` should be `false`
- On rejoin tick, `active[i]` should be `true`

If `active[i]` is ALWAYS `true`, then:
- `isActiveAtTick = true` for all ticks
- `tickStatus = ParticipantStatus.ACTIVE` for all ticks
- `isDropout(tickStatus)` = false
- Gap segment is NEVER created!

**This is likely the issue!**

Let me check how `active` is built:

```javascript
// In buildBeatsSeries:
if (options.activityMonitor && targetId) {
  const mask = options.activityMonitor.getActivityMask(targetId, maxLen - 1) || [];
  for (let i = 0; i < maxLen; i++) {
    active[i] = mask[i] === true;
  }
} else {
  // Fallback: derive activity from heart_rate nulls
  for (let i = 0; i < maxLen; i++) {
    const hr = heartRate[i];
    active[i] = hr != null && Number.isFinite(hr) && hr > 0;
  }
}
```

**If ActivityMonitor isn't returning the right mask, OR if heart_rate doesn't have nulls during dropout, the `active` array will be wrong!**

---

## Root Cause: ActivityMonitor Mask vs DeviceManager.inactiveSince

We implemented `roster.isActive` from DeviceManager.inactiveSince for avatar visibility.

But the `active` array in `buildBeatsSeries` comes from ActivityMonitor OR heart_rate nulls.

**These are TWO DIFFERENT SYSTEMS!**

- `roster.isActive` = DeviceManager (60s timeout)
- `active` array = ActivityMonitor (10s timeout) or heart_rate nulls

The chart uses `active` array for segment building (gap detection).
The chart uses `roster.isActive` for avatar visibility (present/absent).

**If heart_rate has values during the dropout period (forward-filled?), the `active` array will be all `true`, and no gap segment will be created!**

---

## The Fix

Option A: Use `roster.isActive` to override the `active` array
- When `roster.isActive === false`, mark recent ticks in `active` as `false`

Option B: Ensure heart_rate has nulls during dropout
- Already implemented in FitnessSession, but may not be working

Option C: Pass `roster.isActive` into buildSegments and use it
- Simpler: if the whole entry is inactive, the gap should extend to current tick

---

## Recommended Fix

In `buildBeatsSeries` or `buildSegments`, check `roster.isActive`:
- If `roster.isActive === false`, the user is currently in dropout
- Mark all ticks after `lastActiveTick` as inactive in the `active` array
- This ensures the gap segment logic triggers correctly

```javascript
// In buildBeatsSeries, after building active array:
if (rosterEntry.isActive === false) {
  // User is currently inactive - mark ticks after last active as false
  let lastActiveIdx = -1;
  for (let i = active.length - 1; i >= 0; i--) {
    if (active[i] === true) {
      lastActiveIdx = i;
      break;
    }
  }
  // If we found an active tick, mark everything after it as false
  // (This may already be the case, but enforce it)
  for (let i = lastActiveIdx + 1; i < active.length; i++) {
    active[i] = false;
  }
}
```

This ensures the `active` array aligns with `roster.isActive` for current dropout detection.
