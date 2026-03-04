# Semantic Pose Pipeline Reference

Two abstraction layers that convert raw BlazePose keypoints into meaningful body states and movement patterns.

## Related code:

- frontend/src/modules/Fitness/lib/pose/poseSemantics.js
- frontend/src/modules/Fitness/lib/pose/poseActions.js
- frontend/src/modules/Fitness/domain/pose/SemanticMoveDetector.js
- frontend/src/modules/Fitness/domain/pose/PoseDetectorService.js (upstream)
- frontend/src/modules/Fitness/context/PoseContext.jsx (upstream)

---

## Architecture

```
Raw Keypoints (33 × [x, y, z, score])   ← PoseDetectorService (BlazePose)
        │
        ▼
┌──────────────────────────────┐
│  SemanticPosition (Layer 1)  │  poseSemantics.js
│  Per-frame body state        │
│  extractSemanticPosition()   │  ← pure function (no state)
│  createSemanticExtractor()   │  ← stateful wrapper (hysteresis)
└──────────────┬───────────────┘
               │  { leftHand: 'HIGH', bodyUpright: true, ... }
               ▼
┌──────────────────────────────┐
│  SemanticMove (Layer 2)      │  poseActions.js
│  Temporal pattern matching   │
│  createActionDetector()      │  ← cyclic reps / sustained holds
│  createCustomActionDetector()│  ← escape hatch for complex moves
└──────────────┬───────────────┘
               │  { repCount: 5 } or { holding: true, holdDurationMs: 12000 }
               ▼
┌──────────────────────────────┐
│  SemanticMoveDetector        │  SemanticMoveDetector.js
│  Bridge to MoveDetectorBase  │  Emits rep_counted / state_change events
│  Registered via PoseContext   │  into existing move detector dispatch
└──────────────┬───────────────┘
               │
               ▼
        Consumers (GovernanceEngine, UI overlay)
```

---

## Layer 1: SemanticPosition

**File:** `frontend/src/modules/Fitness/lib/pose/poseSemantics.js`

Transforms 33 BlazePose keypoints into discrete body-relative states. All positions are relative to the person's own body landmarks (not camera frame), so classification is stable regardless of distance or camera angle.

### Limb States

Each limb is classified as `LOW`, `MID`, `HIGH`, or `null` (insufficient confidence):

| Property | Classification Method | LOW | MID | HIGH |
|----------|----------------------|-----|-----|------|
| `leftHand` / `rightHand` | Wrist Y vs shoulder/hip Y | Below hip | Between shoulder and hip | Above shoulder |
| `leftElbow` / `rightElbow` | Angle: shoulder→elbow→wrist | ≥150° (straight) | 80–150° (bent) | <80° (tightly bent) |
| `leftKnee` / `rightKnee` | Angle: hip→knee→ankle | ≥160° (straight) | 90–160° (bent) | <90° (deeply bent) |
| `leftFoot` / `rightFoot` | Ankle Y vs knee/hip Y | Well below hip | Between knee and hip | Above knee |

Keypoints with confidence score < 0.3 produce `null` for affected properties.

### Derived Booleans

| Property | Condition |
|----------|-----------|
| `handsUp` | Both hands `HIGH` |
| `bodyUpright` | Shoulder above hip, torso more vertical than horizontal |
| `bodyProne` | Torso more horizontal than vertical |
| `squatPosition` | Both knees bent (`MID` or `HIGH`) and `bodyUpright` |
| `lungePosition` | One knee bent, other `LOW` |
| `armsExtended` | Both elbows `LOW` (straight arms) |

### API

```js
import { extractSemanticPosition, createSemanticExtractor } from '../lib/pose/poseSemantics.js';

// Pure function — no state, no hysteresis
const position = extractSemanticPosition(keypoints);
// → { leftHand: 'LOW', rightHand: 'HIGH', handsUp: false, bodyUpright: true, ... }

// Stateful extractor — applies hysteresis to prevent thrash
const extractor = createSemanticExtractor(config);
const position = extractor(keypoints, timestamp);
```

### Hysteresis

`createSemanticExtractor()` wraps the pure extractor with per-property state stabilization:

- **minHoldMs:** A new state must persist for this duration before committing. Prevents momentary flickers from causing state transitions.
- **Pending transitions:** When a raw value differs from the stabilized value, a pending transition starts. If the raw value bounces back before `minHoldMs` elapses, the transition is cancelled.
- **Derived booleans** are recomputed from stabilized limb states (not raw), so they inherit the stability.

Default thresholds:

| Property | minHoldMs |
|----------|-----------|
| Hands, elbows, feet | 80ms |
| Knees | 120ms |

Override per-property: `createSemanticExtractor({ leftKnee: { minHoldMs: 200 } })`.

---

## Layer 2: SemanticMove

**File:** `frontend/src/modules/Fitness/lib/pose/poseActions.js`

Recognizes movement patterns from SemanticPosition streams over time. Three detector types:

### Cyclic Detector (rep counting)

For exercises with repeating phase cycles (jumping jacks, squats).

```js
import { createActionDetector } from '../lib/pose/poseActions.js';

const JUMPING_JACK = {
  id: 'jumping-jack',
  name: 'Jumping Jack',
  phases: [
    { name: 'open',   match: { handsUp: true } },
    { name: 'closed', match: { handsUp: false } },
  ],
  timing: {
    minCycleMs: 400,      // reject too-fast reps
    maxCycleMs: 3000,     // reject too-slow reps
    maxPhaseMs: 2000,     // reset if stuck in one phase
  },
};

const detector = createActionDetector(JUMPING_JACK);
const result = detector.update(semanticPosition, timestamp);
// → { repCount: 3, currentPhase: 'open', phaseIndex: 0, active: true }
```

A rep is counted when all phases complete in order. Timing constraints prevent false positives from noise.

### Sustain Detector (holds)

For exercises that require maintaining a position (plank, wall sit).

```js
const PLANK = {
  id: 'plank',
  name: 'Plank',
  sustain: { bodyProne: true, armsExtended: true },
  timing: { gracePeriodMs: 500 },   // wobble tolerance
};

const detector = createActionDetector(PLANK);
const result = detector.update(semanticPosition, timestamp);
// → { holding: true, holdDurationMs: 12000, active: true }
```

Brief loss of position within `gracePeriodMs` does not break the hold.

### Custom Detector

Escape hatch for complex exercises that don't fit cyclic/sustain patterns.

```js
import { createCustomActionDetector } from '../lib/pose/poseActions.js';

const detector = createCustomActionDetector({
  id: 'burpee',
  name: 'Burpee',
  maxHistory: 90,  // frames of history to keep (default 60)
  detect: (position, history, timestamp) => {
    // Custom logic — full access to position history
    return { repCount: 2, active: true };
  },
});
```

### Detector Interface

All detectors expose: `{ update(position, timestamp), reset(), id }`.

---

## SemanticMoveDetector (Bridge)

**File:** `frontend/src/modules/Fitness/domain/pose/SemanticMoveDetector.js`

Extends `MoveDetectorBase` to wire the semantic pipeline into PoseContext's move detector dispatch system. Handles:

- Creating the semantic extractor and action detector on `onActivate()`
- Extracting SemanticPosition from raw keypoints each frame
- Running the action detector and emitting `rep_counted` or `state_change` events
- Resetting both layers on `reset()`

```js
import { SemanticMoveDetector } from '../domain/pose/SemanticMoveDetector.js';

const detector = new SemanticMoveDetector(JUMPING_JACK, {
  extractorConfig: { leftKnee: { minHoldMs: 150 } },  // optional hysteresis overrides
});

// Register with PoseContext (standard MoveDetectorBase lifecycle)
poseContext.registerMoveDetector(detector);

// Events arrive via poseContext.moveEvents
```

---

## Defining New Exercises

To add a new exercise detector:

1. **Simple cyclic exercise:** Define a pattern with `phases` array and `timing` constraints.
2. **Simple hold exercise:** Define a pattern with `sustain` match criteria and `gracePeriodMs`.
3. **Complex exercise:** Use `createCustomActionDetector` with a custom `detect` function.

All patterns are expressed in terms of SemanticPosition properties — the shared vocabulary from Layer 1.

```js
const SQUAT = {
  id: 'squat',
  name: 'Squat',
  phases: [
    { name: 'down', match: { squatPosition: true } },
    { name: 'up',   match: { squatPosition: false, bodyUpright: true } },
  ],
  timing: { minCycleMs: 800, maxCycleMs: 5000 },
};
```

---

## Future: GovernanceEngine Integration

The semantic pipeline is designed to integrate with GovernanceEngine as a third challenge type alongside heart rate zones and vibration challenges. An exercise challenge would:

1. Register a `SemanticMoveDetector` for the target exercise when a challenge activates
2. Evaluate rep count or hold duration against challenge requirements
3. Unregister the detector when the challenge ends

See `governance-engine.md` for the existing challenge system.
