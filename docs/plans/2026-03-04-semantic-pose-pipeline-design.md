# Semantic Pose Pipeline Design

**Date:** 2026-03-04
**Status:** Approved

## Overview

Two new abstraction layers between raw BlazePose keypoints and consumers (GovernanceEngine, UI overlay):

1. **SemanticPosition** — per-frame snapshot of body state derived from keypoints
2. **SemanticMove** — time-based movement patterns derived from SemanticPosition streams

```
Raw Keypoints (33 x [x, y, z, score])
        ↓
SemanticPosition (snapshot)     "What pose is the body in right now?"
        ↓
SemanticMove (over time)        "What exercise is the body doing?"
        ↓
Consumers (GovernanceEngine, UI overlay, logging)
```

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Reference frame | Body-relative | Positions relative to body landmarks (hand above shoulder = HIGH). Works regardless of camera angle/distance. Uses existing hip-centering from poseGeometry.js |
| Action model | Hybrid (declarative + custom) | Simple exercises defined as config patterns; complex ones via custom detect() functions |
| Primary consumer | Real-time UI overlay | Processing runs in browser, results displayed live during workout |
| Hysteresis | Per-property thresholds | Each semantic property has its own deadband zone and transition delay |
| Taxonomy | SemanticPosition + SemanticMove | Position = stateless snapshot; Move = stateful time-based pattern |

## Layer 1: SemanticPosition

**File:** `frontend/src/modules/Fitness/lib/pose/poseSemantics.js`

Transforms 33 raw keypoints into a flat semantic state object. All positions are body-relative using hip-centering from `poseGeometry.js`.

### Limb Position States

Per-limb discrete states computed relative to body landmarks:

```js
{
  rightHand: 'LOW',     // LOW | MID | HIGH
  leftHand: 'HIGH',
  rightElbow: 'MID',
  leftElbow: 'MID',
  rightKnee: 'LOW',    // LOW = near full extension, MID = bent, HIGH = deeply bent
  leftKnee: 'LOW',
  rightFoot: 'LOW',
  leftFoot: 'LOW',
}
```

**Classification rules (body-relative):**
- **Hands:** Compare wrist Y to shoulder Y and hip Y. Above shoulders = HIGH, between shoulders and hips = MID, below hips = LOW.
- **Knees:** Derived from knee angle (via `calculateAngle`). Straight (~170°+) = LOW, bent (~90-170°) = MID, deeply bent (<90°) = HIGH.
- **Feet:** Compare ankle Y to knee Y and hip Y, similar thresholds to hands.

### Derived Boolean States

Composite states derived from limb positions:

```js
{
  handsUp: true,          // both hands HIGH
  handsForward: false,    // both hands MID + in front of torso (z-axis)
  bodyProne: false,       // torso horizontal (uses existing isHorizontal())
  bodyUpright: true,      // torso vertical (uses existing isUpright())
  squatPosition: false,   // both knees HIGH + upright
  lungePosition: false,   // one knee HIGH, other LOW
  armsExtended: true,     // both elbows nearly straight
}
```

### Hysteresis Configuration

Each property has its own deadband and minimum hold time to prevent thrash:

```js
const PROPERTY_CONFIG = {
  rightHand: { deadband: 0.08, minHoldMs: 80 },   // 8% of body height deadband
  leftHand:  { deadband: 0.08, minHoldMs: 80 },
  rightKnee: { deadband: 5,    minHoldMs: 120 },   // 5° angle deadband
  leftKnee:  { deadband: 5,    minHoldMs: 120 },
  // ... per property
};
```

- **deadband:** The value must cross the threshold by this amount before a state change is registered. Prevents oscillation at boundaries.
- **minHoldMs:** The new state must persist for this duration before it's committed. Prevents momentary flickers.

### API

```js
// Pure function — no hysteresis, no state
const position = extractSemanticPosition(keypoints);

// Stateful extractor — applies hysteresis and minHold
const extractor = createSemanticExtractor(config);
const position = extractor(keypoints, timestamp);
```

`createSemanticExtractor()` returns a closure that holds:
- Previous position state
- Transition timestamps per property
- Pending transitions waiting to clear minHold

## Layer 2: SemanticMove

**File:** `frontend/src/modules/Fitness/lib/pose/poseActions.js`

Matches SemanticPosition transitions over time to recognize exercises. The action type is polymorphic — not all moves are rep-counted.

### Action Types

Moves are not restricted to a fixed set of types. The result shape is determined by the pattern definition. Common patterns include:

- **Cyclic (rep counting):** SemanticPosition oscillates between phases. Output includes `repCount`.
- **Sustained (hold):** SemanticPosition stays in a target state. Output includes `holdDurationMs`.
- **One-shot (reach):** SemanticPosition achieves a target state. Output includes `achieved`.

But these are conventions, not a rigid type enum. Custom detectors can return any result shape.

### Declarative Pattern Definitions

Simple exercises defined as state transition patterns:

```js
const JUMPING_JACK = {
  id: 'jumping-jack',
  name: 'Jumping Jack',
  phases: [
    { name: 'open',  match: { handsUp: true, feetWide: true } },
    { name: 'closed', match: { handsUp: false, feetWide: false } },
  ],
  timing: {
    minCycleMs: 400,      // fastest valid rep
    maxCycleMs: 3000,     // slowest valid rep
    maxPhaseMs: 2000,     // max time in any single phase
  },
  confidence: {
    minKeypointScore: 0.5,
    requiredProperties: ['rightHand', 'leftHand'],
  },
};

const PLANK = {
  id: 'plank',
  name: 'Plank',
  sustain: { bodyProne: true, armsExtended: true },  // hold, not cycle
  timing: {
    gracePeriodMs: 500,   // allowed wobble without breaking hold
  },
};

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

### Custom Detector Escape Hatch

For complex exercises (burpees, dance moves, etc.) that can't be expressed declaratively:

```js
const burpeeDetector = createCustomActionDetector({
  id: 'burpee',
  name: 'Burpee',
  detect: (semanticPosition, history, timestamp) => {
    // Custom logic using full semantic position history
    // Return arbitrary result shape
  },
});
```

### Thrash Prevention (Action Layer)

- Phase transitions require the match to hold for the phase's timing bounds
- Out-of-order phase transitions reset the cycle (no partial credit)
- Cooldown after each rep prevents double-counting (leverages MoveDetectorBase)
- Sustained holds use `gracePeriodMs` — brief loss of position doesn't break the hold

### API

```js
// Declarative
const detector = createActionDetector(JUMPING_JACK);
const result = detector.update(semanticPosition, timestamp);
// result = { repCount: 3, currentPhase: 'open', confidence: 0.85, active: true }

// Sustained hold
const plankDetector = createActionDetector(PLANK);
const result = plankDetector.update(semanticPosition, timestamp);
// result = { holding: true, holdDurationMs: 4500, confidence: 0.9, active: true }

// Custom
const burpee = createCustomActionDetector({ ... });
const result = burpee.update(semanticPosition, timestamp);
```

## Bridge: SemanticMoveDetector

**File:** `frontend/src/modules/Fitness/domain/pose/SemanticMoveDetector.js`

Thin adapter that wires the SemanticPosition + SemanticMove pipeline into PoseContext's existing MoveDetectorBase dispatch system.

```js
class SemanticMoveDetector extends MoveDetectorBase {
  constructor(patternOrDetector, config) {
    super(patternOrDetector.id, config);
    this.extractor = createSemanticExtractor(config);
    this.actionDetector = typeof patternOrDetector.detect === 'function'
      ? patternOrDetector
      : createActionDetector(patternOrDetector);
  }

  _detectMove(poses, history) {
    const semantic = this.extractor(poses[0]?.keypoints, Date.now());
    const result = this.actionDetector.update(semantic, Date.now());
    // Emit events based on result shape (rep counted, hold milestone, etc.)
  }
}
```

Registers/unregisters via `PoseContext.registerMoveDetector()` — no changes needed to existing infrastructure.

## GovernanceEngine Integration (Future)

GovernanceEngine already supports challenge types: `zone` (heart rate) and `vibration` (device interaction). Exercise challenges would be a third type using the same config/selection/timing infrastructure.

**Challenge config:**
```yaml
challenges:
  - id: exercise-challenge
    selections:
      - id: jumping-jacks-30
        label: "30 Jumping Jacks"
        exercise: jumping-jack
        requiredCount: 30
        timeAllowedSeconds: 60
      - id: plank-30s
        label: "30 Second Plank"
        exercise: plank
        targetMs: 30000
        timeAllowedSeconds: 45
```

**Evaluation:** `buildChallengeSummary()` dispatches on `challenge.exercise`, gets the result from the active SemanticMoveDetector, and evaluates based on the result shape (repCount vs holdDurationMs vs achieved).

**Lifecycle:** GovernanceEngine registers the SemanticMoveDetector when a challenge activates and unregisters when it ends. This is deferred to a future phase — the semantic layers are useful independently.

## File Structure

```
frontend/src/modules/Fitness/lib/pose/
├── index.js                  (update barrel exports)
├── poseSemantics.js          ← NEW: SemanticPosition extraction + hysteresis
├── poseActions.js            ← NEW: SemanticMove detection (declarative + custom)
├── poseConnections.js        (existing)
├── poseGeometry.js           (existing)
├── poseConfidence.js         (existing)
└── poseColors.js             (existing)

frontend/src/modules/Fitness/domain/pose/
├── SemanticMoveDetector.js   ← NEW: bridge to MoveDetectorBase
├── MoveDetectorBase.js       (existing)
├── MoveDetectorRegistry.js   (existing)
└── PoseDetectorService.js    (existing)
```

## Testing Strategy

Both new modules are pure-function / stateful-closure based — fully testable without React, TensorFlow, or a browser:

- **poseSemantics.js:** Feed synthetic keypoint arrays, assert SemanticPosition output. Test hysteresis by feeding sequences with timestamps.
- **poseActions.js:** Feed SemanticPosition sequences, assert rep counts, hold durations, phase transitions. Test timing bounds, thrash prevention, grace periods.
- **SemanticMoveDetector:** Integration test wiring the pipeline through MoveDetectorBase event emission.

Test data can be derived from the existing JSONL pose logs in `media/logs/poses/`.
