# Semantic Pose Pipeline Reference

Three abstraction layers that convert raw BlazePose keypoints into meaningful body states and movement patterns.

## Related code:

- frontend/src/modules/Fitness/lib/pose/poseSemantics.js
- frontend/src/modules/Fitness/lib/pose/poseActions.js
- frontend/src/modules/Fitness/lib/pose/exercisePatterns.js
- frontend/src/modules/Fitness/domain/pose/SemanticMoveDetector.js
- frontend/src/modules/Fitness/domain/pose/PoseDetectorService.js (upstream)
- frontend/src/modules/Fitness/context/PoseContext.jsx (upstream)

---

## Architecture

```
Raw Keypoints (33 x [x, y, z, score])   <- PoseDetectorService (BlazePose)
        |
        v
+------------------------------+
|  Layer 1: Joint States       |  poseSemantics.js
|  12 discrete classifiers     |
|  extractSemanticPosition()   |  <- pure function (no state)
|  createSemanticExtractor()   |  <- stateful wrapper (hysteresis)
+-------------+----------------+
              |  { leftHand: 'HIGH', torso: 'UPRIGHT', stance: 'WIDE', ... }
              v
+------------------------------+
|  Layer 1.5: Combo Booleans   |  poseSemantics.js (same file)
|  9 derived multi-joint flags |
|  Computed from Layer 1 state |  <- pure derivation, no additional state
+-------------+----------------+
              |  { squatting: true, armsOverhead: true, wideStance: true, ... }
              v
+------------------------------+
|  Layer 2: SemanticMove       |  poseActions.js
|  Temporal pattern matching   |
|  createActionDetector()      |  <- cyclic reps / sustained holds
|  createCustomActionDetector()|  <- escape hatch for complex moves
+-------------+----------------+
              |  { repCount: 5 } or { holding: true, holdDurationMs: 12000 }
              v
+------------------------------+
|  SemanticMoveDetector        |  SemanticMoveDetector.js
|  Bridge to MoveDetectorBase  |  Emits rep_counted / state_change events
|  Registered via PoseContext  |  into existing move detector dispatch
+-------------+----------------+
              |
              v
        Consumers (GovernanceEngine, UI overlay)
```

---

## Layer 1: Joint States

**File:** `frontend/src/modules/Fitness/lib/pose/poseSemantics.js`

Transforms 33 BlazePose keypoints into 12 discrete body-relative states. All positions are relative to the person's own body landmarks (not camera frame), so classification is stable regardless of distance or camera angle.

Keypoints with confidence score < 0.3 produce `null` for affected properties.

### Joint Classifiers (12 total)

| Property | Classification Method | LOW | MID | HIGH |
|----------|----------------------|-----|-----|------|
| `leftHand` / `rightHand` | Wrist Y vs shoulder/hip Y | Below hip | Between shoulder and hip | Above shoulder |
| `leftElbow` / `rightElbow` | Angle: shoulder->elbow->wrist | >=150 (straight) | 80-150 (bent) | <80 (tightly bent) |
| `leftKnee` / `rightKnee` | Angle: hip->knee->ankle | >=160 (straight) | 90-160 (bent) | <90 (deeply bent) |
| `leftHip` / `rightHip` | Angle: shoulder->hip->knee | >=160 (standing) | 90-160 (flexed) | <90 (deeply flexed) |
| `leftShoulder` / `rightShoulder` | Angle: hip->shoulder->elbow | <45 (at side) | 45-135 (raised) | >=135 (overhead) |

### Whole-Body Classifiers (2 total)

| Property | Classification Method | Values |
|----------|----------------------|--------|
| `torso` | Angle from vertical (shoulder midpoint vs hip midpoint) | `UPRIGHT` (<30), `LEANING` (30-60), `PRONE` (>60) |
| `stance` | Ankle spread / hip width ratio | `NARROW` (<0.8), `HIP` (0.8-1.3), `WIDE` (>1.3) |

### Removed Properties

The following properties from the previous version are no longer in Layer 1:

- `leftFoot` / `rightFoot` -- replaced by hip and stance classifiers
- `handsUp` -- replaced by `armsOverhead` in Layer 1.5
- `bodyUpright` / `bodyProne` -- replaced by `torso` tri-state + `upright`/`prone` combos in Layer 1.5
- `squatPosition` / `lungePosition` -- replaced by `squatting`/`lunging` in Layer 1.5 with richer conditions
- `armsExtended` -- moved to Layer 1.5 combo (derived from both elbows)

---

## Layer 1.5: Combo Booleans

**File:** `frontend/src/modules/Fitness/lib/pose/poseSemantics.js` (same file as Layer 1)

Nine boolean flags derived from combinations of Layer 1 joint states. These provide exercise-level semantic meaning without temporal tracking.

| Property | Derivation |
|----------|-----------|
| `upright` | `torso === 'UPRIGHT'` |
| `prone` | `torso === 'PRONE'` |
| `squatting` | Both hips MID or HIGH, both knees MID or HIGH, `upright`, stance HIP or WIDE |
| `lunging` | One hip MID+/other LOW, matching knee asymmetry (bent side + straight side), `upright` |
| `armsOverhead` | Both shoulders HIGH |
| `armsAtSides` | Both shoulders LOW |
| `armsExtended` | Both elbows LOW (straight arms) |
| `wideStance` | `stance === 'WIDE'` |
| `narrowStance` | `stance === 'NARROW'` or `stance === 'HIP'` |

### Combo Details

**squatting** requires all of:
- `leftHip` is MID or HIGH
- `rightHip` is MID or HIGH
- `leftKnee` is MID or HIGH
- `rightKnee` is MID or HIGH
- `upright` is true (torso is UPRIGHT)
- `stance` is HIP or WIDE

**lunging** requires `upright` and one of:
- Left side bent: `leftHip` MID+, `rightHip` LOW, `leftKnee` MID+, `rightKnee` LOW
- Right side bent: `leftHip` LOW, `rightHip` MID+, `leftKnee` LOW, `rightKnee` MID+

### API

```js
import { extractSemanticPosition, createSemanticExtractor } from '../lib/pose/poseSemantics.js';

// Pure function -- no state, no hysteresis
// Returns both Layer 1 and Layer 1.5 properties
const position = extractSemanticPosition(keypoints);
// -> {
//   leftHand: 'LOW', rightHand: 'HIGH',
//   leftElbow: 'LOW', rightElbow: 'MID',
//   leftKnee: 'LOW', rightKnee: 'LOW',
//   leftHip: 'LOW', rightHip: 'LOW',
//   leftShoulder: 'MID', rightShoulder: 'HIGH',
//   torso: 'UPRIGHT', stance: 'HIP',
//   upright: true, prone: false,
//   squatting: false, lunging: false,
//   armsOverhead: false, armsAtSides: false, armsExtended: true,
//   wideStance: false, narrowStance: true,
// }

// Stateful extractor -- applies hysteresis to prevent thrash
const extractor = createSemanticExtractor(config);
const position = extractor(keypoints, timestamp);
```

---

## Hysteresis

`createSemanticExtractor()` wraps the pure extractor with per-property state stabilization:

- **minHoldMs:** A new state must persist for this duration before committing. Prevents momentary flickers from causing state transitions.
- **Pending transitions:** When a raw value differs from the stabilized value, a pending transition starts. If the raw value bounces back before `minHoldMs` elapses, the transition is cancelled.
- **Combo booleans** (Layer 1.5) are recomputed from stabilized Layer 1 states (not raw), so they inherit the stability.

### Default Thresholds

| Property | minHoldMs |
|----------|-----------|
| Hands (`leftHand`, `rightHand`) | 80ms |
| Elbows (`leftElbow`, `rightElbow`) | 80ms |
| Shoulders (`leftShoulder`, `rightShoulder`) | 80ms |
| Knees (`leftKnee`, `rightKnee`) | 120ms |
| Hips (`leftHip`, `rightHip`) | 120ms |
| Torso (`torso`) | 150ms |
| Stance (`stance`) | 100ms |

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
    { name: 'open',   match: { armsOverhead: true, wideStance: true } },
    { name: 'closed', match: { armsAtSides: true, narrowStance: true, upright: true } },
  ],
  timing: {
    minCycleMs: 400,      // reject too-fast reps
    maxCycleMs: 3000,     // reject too-slow reps
    maxPhaseMs: 2000,     // reset if stuck in one phase
  },
};

const detector = createActionDetector(JUMPING_JACK);
const result = detector.update(semanticPosition, timestamp);
// -> { repCount: 3, currentPhase: 'open', phaseIndex: 0, active: true, activityDurationMs: 8500 }
```

A rep is counted when all phases complete in order. Timing constraints prevent false positives from noise.

#### Cyclic Output

| Field | Type | Description |
|-------|------|-------------|
| `repCount` | number | Total completed reps |
| `currentPhase` | string\|null | Name of current phase, or null if waiting |
| `phaseIndex` | number | Index into phases array (-1 if waiting) |
| `active` | boolean | True if mid-cycle (past phase 0) |
| `activityDurationMs` | number | Milliseconds since the first phase match in the current activity window |

#### Activity Duration Tracking

`activityDurationMs` tracks how long the person has been doing the exercise. It starts from the first phase match and accumulates continuously. Combined with `inactivityTimeoutMs` in the timing config, it handles pauses:

- **No timeout (default):** Duration accumulates indefinitely from first match.
- **With timeout:** If no phase matches for longer than `inactivityTimeoutMs`, the duration resets. The next phase match starts a new activity window.

This enables both rep-based and time-based challenges:
- "Do 15 jumping jacks" → `result.repCount >= 15`
- "Do jumping jacks for 60 seconds" → `result.activityDurationMs >= 60000`

#### Timing Config

| Property | Default | Description |
|----------|---------|-------------|
| `minCycleMs` | 0 | Minimum time for a full cycle (rejects too-fast reps) |
| `maxCycleMs` | Infinity | Maximum time for a full cycle (rejects too-slow reps) |
| `maxPhaseMs` | Infinity | Maximum time in one phase before resetting |
| `inactivityTimeoutMs` | Infinity | Gap before activity duration resets |

### Sustain Detector (holds)

For exercises that require maintaining a position (plank, wall sit).

```js
const PLANK = {
  id: 'plank',
  name: 'Plank',
  sustain: { prone: true, armsExtended: true },
  timing: { gracePeriodMs: 500 },   // wobble tolerance
};

const detector = createActionDetector(PLANK);
const result = detector.update(semanticPosition, timestamp);
// -> { holding: true, holdDurationMs: 12000, active: true }
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
    // Custom logic -- full access to position history
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

## Exercise Definitions

All patterns are expressed in terms of SemanticPosition properties -- the shared vocabulary from Layers 1 and 1.5.

### Jumping Jack (cyclic)

```js
const JUMPING_JACK = {
  id: 'jumping-jack',
  name: 'Jumping Jack',
  phases: [
    { name: 'open',   match: { armsOverhead: true, wideStance: true } },
    { name: 'closed', match: { armsAtSides: true, narrowStance: true, upright: true } },
  ],
  timing: { minCycleMs: 400, maxCycleMs: 3000, maxPhaseMs: 2000 },
};
```

### Squat (cyclic)

```js
const SQUAT = {
  id: 'squat',
  name: 'Squat',
  phases: [
    { name: 'down', match: { squatting: true } },
    { name: 'up',   match: { squatting: false, upright: true, narrowStance: true } },
  ],
  timing: { minCycleMs: 800, maxCycleMs: 5000 },
};
```

### Lunge (cyclic)

```js
const LUNGE = {
  id: 'lunge',
  name: 'Lunge',
  phases: [
    { name: 'down', match: { lunging: true } },
    { name: 'up',   match: { lunging: false, upright: true } },
  ],
  timing: { minCycleMs: 800, maxCycleMs: 5000 },
};
```

### Push-up (cyclic)

```js
const PUSHUP = {
  id: 'push-up',
  name: 'Push-up',
  phases: [
    { name: 'down', match: { prone: true, leftElbow: 'MID' } },
    { name: 'up',   match: { prone: true, armsExtended: true } },
  ],
  timing: { minCycleMs: 500, maxCycleMs: 4000 },
};
```

### Plank (sustain)

```js
const PLANK = {
  id: 'plank',
  name: 'Plank',
  sustain: { prone: true, armsExtended: true },
  timing: { gracePeriodMs: 500 },
};
```

### Burpee (custom)

```js
const BURPEE = {
  id: 'burpee',
  name: 'Burpee',
  detect: (position, history, timestamp) => {
    // Multi-phase sequence: standing -> squat -> prone -> squat -> standing
    // Requires custom logic due to non-repeating phase order
  },
};
```

---

## Defining New Exercises

To add a new exercise detector:

1. **Simple cyclic exercise:** Define a pattern with `phases` array and `timing` constraints. Each phase has a `match` object tested against SemanticPosition properties.
2. **Simple hold exercise:** Define a pattern with `sustain` match criteria and `gracePeriodMs`.
3. **Complex exercise:** Use `createCustomActionDetector` with a custom `detect` function.

All match criteria use Layer 1 joint states (tri-state strings) and Layer 1.5 combo booleans interchangeably -- they are all properties on the same SemanticPosition object.

---

## GovernanceEngine Integration

The semantic pipeline integrates with GovernanceEngine as a challenge type alongside heart rate zones and vibration challenges. The interface is simple — GovernanceEngine asks "are you doing this exercise?" and the detector answers yes/no with duration and reps.

### Challenge Types

| Challenge | Completion Criteria | Example |
|-----------|-------------------|---------|
| Rep-based | `result.repCount >= target` | "Do 15 jumping jacks" |
| Time-based | `result.activityDurationMs >= targetMs` | "60 seconds of jumping jacks" |
| Hold-based | `result.holdDurationMs >= targetMs` | "Hold plank for 30 seconds" |

### Lifecycle

1. Challenge activates → register a `SemanticMoveDetector` for the target exercise
2. Each frame → detector returns `{ active, repCount, activityDurationMs }` (cyclic) or `{ holding, holdDurationMs }` (sustain)
3. GovernanceEngine evaluates completion criteria
4. Challenge ends → unregister the detector

See `governance-engine.md` for the existing challenge system.
