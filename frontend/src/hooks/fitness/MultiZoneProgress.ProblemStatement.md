# Multi-Zone Progress Visualization - Problem Statement

## Overview

When a user's current zone is multiple steps away from the target zone (e.g., COOL → HOT), the progress bar and gradient visualization assume a single linear transition. This fails to represent the intermediate zones the user must pass through and creates a misleading visual representation of their progress.

## Current Behavior

### Zone Hierarchy
The system defines 5 heart rate zones in ascending intensity:

| Zone   | Threshold (BPM) | Color   |
|--------|-----------------|---------|
| COOL   | 60              | Blue    |
| ACTIVE | 100             | Green   |
| WARM   | 120             | Yellow  |
| HOT    | 140             | Orange  |
| FIRE   | 160             | Red     |

### Progress Calculation (`types.js:400-479`)

The `calculateZoneProgressTowardsTarget` function computes progress as a simple linear percentage:

```javascript
// Current implementation (simplified)
rangeMin = currentZoneThreshold;   // e.g., 60 for COOL
rangeMax = targetZoneThreshold;    // e.g., 140 for HOT
progress = (heartRate - rangeMin) / (rangeMax - rangeMin);
```

**Example: User in COOL zone, target is HOT**
- Current HR: 85 BPM (in COOL zone)
- Range: 60 → 140 (80 BPM span)
- Progress: `(85 - 60) / 80 = 31%`

This treats the 80 BPM journey as one continuous stretch, ignoring that the user must pass through ACTIVE (100) and WARM (120) zones.

### Gradient Rendering (`FitnessPlayerOverlay.jsx:556-560`)

The `buildProgressGradient` function creates a two-color gradient:

```javascript
const buildProgressGradient = (currentZone, targetZone) => {
  const start = currentZone?.color || 'rgba(148, 163, 184, 0.6)';
  const end = targetZone?.color || 'rgba(34, 197, 94, 0.85)';
  return `linear-gradient(90deg, ${start}, ${end})`;
};
```

**Result for COOL → HOT:**
```css
linear-gradient(90deg, #6ab8ff, #ff922b)  /* blue → orange */
```

This skips the intermediate green (ACTIVE) and yellow (WARM) colors entirely.

## The Problem

### Visual Issues

1. **Missing intermediate colors**: A COOL → HOT gradient shows blue-to-orange, but should show blue → green → yellow → orange to represent all zones.

2. **No milestone markers**: Users have no visual indication when they've crossed into a new zone. At 100 BPM they've achieved ACTIVE, but the progress bar shows only ~50% with no acknowledgment.

3. **Misleading progress perception**: 31% progress at 85 BPM suggests the user is "almost a third of the way there," but they haven't even reached the first intermediate zone (ACTIVE at 100 BPM).

### UX Impact

- Users don't understand how many zones they need to traverse
- No sense of accomplishment when crossing intermediate zone thresholds
- The single gradient blends colors that don't accurately represent position in the zone hierarchy

## Desired Behavior

### Multi-Zone Gradient

For COOL → HOT, the gradient should include all intermediate zones:

```css
linear-gradient(90deg,
  #6ab8ff 0%,      /* COOL at start */
  #51cf66 50%,     /* ACTIVE at 100 BPM - midpoint of 60-140 range */
  #ffd43b 75%,     /* WARM at 120 BPM - 75% of range */
  #ff922b 100%     /* HOT at 140 BPM - end */
)
```

Color stop positions should be calculated based on threshold proportions within the range.

### Segmented Progress Visualization

Option A: **Proportional color stops**
- Calculate each intermediate zone's position as a percentage of the total range
- Place gradient color stops at those positions
- Progress fill reveals colors as user advances

Option B: **Discrete segments with markers**
- Divide progress bar into segments (one per zone transition)
- Add visual markers/ticks at zone boundaries
- Each segment could have its own color

### Progress Calculation Enhancement

The progress calculation could optionally report:
- Overall percentage (current behavior)
- Current segment (e.g., "in ACTIVE zone, 2 of 4 zones complete")
- Zones remaining (e.g., ["WARM", "HOT"])

## Affected Files

| File | Location | What to Change |
|------|----------|----------------|
| `types.js` | `frontend/src/hooks/fitness/types.js:400-479` | `calculateZoneProgressTowardsTarget` - add intermediate zone data |
| `FitnessPlayerOverlay.jsx` | `frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx:556-560` | `buildProgressGradient` - generate multi-stop gradient |
| `GovernanceStateOverlay.jsx` | `frontend/src/modules/Fitness/FitnessPlayerOverlay/GovernanceStateOverlay.jsx:110-140` | `renderProgressBlock` - optionally add zone markers |

## Implementation Approach

### Step 1: Enhance `calculateZoneProgressTowardsTarget`

Return additional data about intermediate zones:

```javascript
return {
  progress: 0.31,           // overall progress (existing)
  rangeMin: 60,             // existing
  rangeMax: 140,            // existing
  targetIndex: 3,           // existing
  // NEW fields:
  intermediateZones: [
    { id: 'active', threshold: 100, position: 0.50, color: '#51cf66' },
    { id: 'warm', threshold: 120, position: 0.75, color: '#ffd43b' }
  ],
  currentSegment: 0,        // index of current segment (0 = still in first zone)
  segmentsTotal: 3          // total zone transitions needed
};
```

### Step 2: Update `buildProgressGradient`

Accept zone sequence and build multi-stop gradient:

```javascript
const buildProgressGradient = (currentZone, targetZone, intermediateZones = []) => {
  const stops = [
    `${currentZone?.color || '#94a3b8'} 0%`
  ];

  intermediateZones.forEach(zone => {
    stops.push(`${zone.color} ${Math.round(zone.position * 100)}%`);
  });

  stops.push(`${targetZone?.color || '#22c55e'} 100%`);

  return `linear-gradient(90deg, ${stops.join(', ')})`;
};
```

### Step 3: Optional - Add Zone Markers

In `GovernanceStateOverlay.jsx`, render tick marks at zone boundaries:

```jsx
{intermediateZones.map(zone => (
  <div
    key={zone.id}
    className="governance-lock__zone-marker"
    style={{ left: `${zone.position * 100}%` }}
    title={zone.id}
  />
))}
```

## Testing Scenarios

1. **Single zone transition** (ACTIVE → WARM): Should work as before with two colors
2. **Two zone transition** (COOL → WARM): Blue → green → yellow gradient
3. **Three zone transition** (COOL → HOT): Blue → green → yellow → orange
4. **Four zone transition** (COOL → FIRE): All five colors represented
5. **Already at target**: 100% progress, single color

## Notes

- Zone colors are defined in `types.js:182-188` and CSS variables in SCSS files
- The `COOL_ZONE_PROGRESS_MARGIN` (40 BPM) extends the progress range below COOL threshold for users starting very low
- Challenge failures use the same progress visualization via `lockRows` in `GovernanceStateOverlay`
