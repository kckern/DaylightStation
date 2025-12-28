# Confidence Meter Design Document

## Overview

Add a visual confidence meter (0-100%) to PoseDemo that reflects the overall quality of pose detection. When confidence drops below a configurable threshold, skeleton rendering is disabled to avoid displaying misshapen or incomplete figures.

---

## Goals

1. **Visual Feedback**: Show users a real-time meter bar indicating detection quality
2. **Quality Gate**: Suppress skeleton rendering when confidence is too low
3. **User Guidance**: Help users understand when they need to reposition (e.g., moved off-screen)
4. **Configurable**: Allow threshold adjustment for different use cases

---

## Confidence Score Calculation

### Algorithm

The confidence score is a weighted average of keypoint visibility and individual keypoint scores.

```
overallConfidence = (presenceScore * 0.4) + (avgKeypointScore * 0.6)
```

#### 1. Presence Score (40% weight)
Measures what percentage of expected keypoints are detected above minimum threshold.

```javascript
const ESSENTIAL_KEYPOINTS = [
  0,  // nose
  11, 12, // shoulders
  13, 14, // elbows
  15, 16, // wrists
  23, 24, // hips
  25, 26, // knees
  27, 28, // ankles
];

const MIN_DETECTION_SCORE = 0.3;

presenceScore = (detectedEssentialKeypoints / totalEssentialKeypoints) * 100
```

#### 2. Average Keypoint Score (60% weight)
Average confidence of all detected essential keypoints.

```javascript
avgKeypointScore = sum(essentialKeypoint.score) / detectedEssentialKeypoints * 100
```

### Weighted Keypoints (Optional Enhancement)

Different keypoints can have different importance weights:

| Body Part | Weight | Rationale |
|-----------|--------|-----------|
| Hips (23, 24) | 1.5x | Core anchor points |
| Shoulders (11, 12) | 1.3x | Upper body reference |
| Knees/Ankles | 1.2x | Lower body movement |
| Wrists/Elbows | 1.0x | Arm tracking |
| Face points | 0.5x | Less critical for fitness |

---

## UI Component Design

### ConfidenceMeter Component

```
┌─────────────────────────────────────┐
│ ████████████████░░░░░░░░░  72%     │
└─────────────────────────────────────┘
```

#### Visual States

| Confidence | Color | Label |
|------------|-------|-------|
| 80-100% | Green (`#22c55e`) | Excellent |
| 60-79% | Yellow (`#eab308`) | Good |
| 40-59% | Orange (`#f97316`) | Fair |
| 0-39% | Red (`#ef4444`) | Poor |

#### Positioning

- **Location**: Top-right corner of skeleton canvas area
- **Size**: 150px wide × 24px tall
- **Opacity**: 0.85 (semi-transparent)
- **Z-index**: Above skeleton canvas

### Component Props

```typescript
interface ConfidenceMeterProps {
  confidence: number;        // 0-100
  threshold: number;         // Minimum acceptable (e.g., 50)
  showLabel?: boolean;       // Show "72%" text
  showStatus?: boolean;      // Show "Good" text
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
  animated?: boolean;        // Smooth transitions
}
```

---

## Integration Points

### 1. New File: `lib/pose/poseConfidence.js`

Utility functions for confidence calculation:

```javascript
export const ESSENTIAL_KEYPOINT_INDICES = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

export const calculatePoseConfidence = (pose, options = {}) => {
  // Returns { overall, presence, avgScore, missingKeypoints }
};

export const isPoseConfident = (pose, threshold = 50) => {
  // Returns boolean
};
```

### 2. New Component: `components/ConfidenceMeter.jsx`

Standalone meter bar component:

```jsx
<ConfidenceMeter 
  confidence={poseConfidence} 
  threshold={renderThreshold}
  showLabel
/>
```

### 3. Modifications to `SkeletonCanvas.jsx`

Add early return when confidence is below threshold:

```javascript
// In drawPose callback
const confidence = calculatePoseConfidence(pose);
if (confidence.overall < opts.renderThreshold) {
  return; // Skip rendering this pose
}
```

### 4. Modifications to `PoseDemo.jsx`

Add state and UI:

```javascript
const [poseConfidence, setPoseConfidence] = useState(0);

// In render
<ConfidenceMeter 
  confidence={poseConfidence}
  threshold={displayOptions.renderThreshold}
/>

<SkeletonCanvas
  renderThreshold={displayOptions.renderThreshold}
  onConfidenceUpdate={setPoseConfidence}
/>
```

### 5. Modifications to `DEFAULT_OPTIONS` in SkeletonCanvas

```javascript
const DEFAULT_OPTIONS = {
  // ... existing options
  renderThreshold: 40,        // Don't render below 40% confidence
  showConfidenceMeter: true,  // Show the meter UI
};
```

---

## Configuration Options

Add to `PoseSettings.jsx`:

| Setting | Type | Default | Range | Description |
|---------|------|---------|-------|-------------|
| `renderThreshold` | number | 40 | 0-100 | Min confidence to render skeleton |
| `showConfidenceMeter` | boolean | true | - | Display the meter bar |
| `confidenceMeterPosition` | string | 'top-right' | 4 positions | Meter placement |

---

## File Structure

```
PoseDemo/
├── components/
│   ├── ConfidenceMeter.jsx      # NEW
│   ├── ConfidenceMeter.scss     # NEW
│   └── SkeletonCanvas.jsx       # MODIFY
├── PoseDemo.jsx                 # MODIFY
├── PoseDemo.scss                # MODIFY (add meter positioning)
└── ...

lib/pose/
├── poseConfidence.js            # NEW
└── ...
```

---

## Implementation Steps

### Phase 1: Core Confidence Calculation
1. Create `lib/pose/poseConfidence.js` with calculation utilities
2. Add unit tests for confidence calculations
3. Export from pose lib index

### Phase 2: Confidence Meter UI
1. Create `ConfidenceMeter.jsx` component
2. Create `ConfidenceMeter.scss` styles
3. Add color transitions and animations

### Phase 3: Integration
1. Modify `SkeletonCanvas.jsx` to:
   - Calculate confidence per frame
   - Skip rendering below threshold
   - Emit confidence updates
2. Modify `PoseDemo.jsx` to:
   - Include ConfidenceMeter in overlay
   - Pass threshold to SkeletonCanvas
3. Add settings to `PoseSettings.jsx`

### Phase 4: Polish
1. Add smooth transitions when confidence changes
2. Add "No pose detected" state when confidence is 0
3. Add visual indicator when rendering is suppressed

---

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| No pose detected | Meter shows 0%, red, skeleton hidden |
| Partial body (torso only) | Calculate based on visible essential points |
| Multiple poses | Use highest confidence pose for meter |
| Confidence flickering | Apply smoothing (EMA) to confidence value |
| Threshold = 0 | Always render (disabled threshold) |
| Threshold = 100 | Only render with perfect detection |

---

## Confidence Smoothing

To prevent jittery meter movement, apply exponential moving average:

```javascript
smoothedConfidence = previousConfidence * 0.7 + currentConfidence * 0.3;
```

This provides ~300ms of smoothing at 30fps.

---

## Visual Mockup

```
┌──────────────────────────────────────────────────────┐
│                                    ┌───────────────┐ │
│                                    │ ████████░░ 78%│ │
│                                    └───────────────┘ │
│                                                      │
│                      O                               │
│                     /|\                              │
│                     / \                              │
│                                                      │
│                                                      │
│  [Start] [Settings]                    30 FPS       │
└──────────────────────────────────────────────────────┘
```

When confidence drops below threshold:

```
┌──────────────────────────────────────────────────────┐
│                                    ┌───────────────┐ │
│                                    │ ██░░░░░░░ 28% │ │
│                                    │ ⚠ Low         │ │
│                                    └───────────────┘ │
│                                                      │
│              (skeleton not rendered)                 │
│                                                      │
│                                                      │
│  [Start] [Settings]                    30 FPS       │
└──────────────────────────────────────────────────────┘
```

---

## API Summary

### poseConfidence.js exports

```javascript
// Calculate overall pose confidence
calculatePoseConfidence(pose, options?) → ConfidenceResult

// Quick check if pose meets threshold
isPoseConfident(pose, threshold?) → boolean

// Get list of missing/low-confidence keypoints  
getMissingKeypoints(pose, minScore?) → number[]

// Constants
ESSENTIAL_KEYPOINT_INDICES: number[]
```

### ConfidenceMeter.jsx exports

```javascript
// Component
<ConfidenceMeter confidence threshold showLabel position animated />

// Utility (for custom styling)
getConfidenceColor(confidence) → string
getConfidenceLabel(confidence) → string
```

---

## Testing Scenarios

1. **Full visibility**: All keypoints detected → ~95-100%
2. **Arm raised off screen**: Missing wrist/elbow → ~70-80%
3. **Lower body cut off**: Missing legs → ~50-60%
4. **Only head visible**: Most keypoints missing → ~10-20%
5. **No detection**: Empty pose → 0%
6. **Rapid movement**: Confidence fluctuates → Smooth transitions

---

## Future Enhancements

1. **Per-limb confidence**: Show which body parts are poorly tracked
2. **Confidence history**: Graph of confidence over time
3. **Auto-adjust threshold**: ML-based threshold based on exercise type
4. **Audio feedback**: Beep when confidence drops (accessibility)
