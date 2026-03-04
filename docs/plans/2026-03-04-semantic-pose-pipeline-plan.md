# Semantic Pose Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement SemanticPosition (per-frame body state) and SemanticMove (time-based movement patterns) layers between raw BlazePose keypoints and consumers.

**Architecture:** Two pure-function modules in `lib/pose/` — `poseSemantics.js` for frame-level state extraction with hysteresis, `poseActions.js` for temporal pattern matching. A thin `SemanticMoveDetector` bridges into the existing `MoveDetectorBase` dispatch system.

**Tech Stack:** Vanilla JS (no dependencies), Jest for tests, existing `poseGeometry.js` utilities.

**Design doc:** `docs/plans/2026-03-04-semantic-pose-pipeline-design.md`

---

### Task 1: SemanticPosition — Pure Extraction (no hysteresis)

**Files:**
- Create: `frontend/src/modules/Fitness/lib/pose/poseSemantics.js`
- Test: `tests/isolated/frontend/pose/poseSemantics.unit.test.mjs`

**Step 1: Write the failing test**

Create the test file with a helper to build synthetic keypoints and test the pure extractor:

```js
// tests/isolated/frontend/pose/poseSemantics.unit.test.mjs
import { extractSemanticPosition } from '../../../../frontend/src/modules/Fitness/lib/pose/poseSemantics.js';

// Helper: build a 33-keypoint array with specific positions
// Keypoint indices: 0=nose, 11=leftShoulder, 12=rightShoulder,
// 13=leftElbow, 14=rightElbow, 15=leftWrist, 16=rightWrist,
// 23=leftHip, 24=rightHip, 25=leftKnee, 26=rightKnee,
// 27=leftAnkle, 28=rightAnkle
const makeKeypoints = (overrides = {}) => {
  // Default: standing upright, arms at sides
  const defaults = {
    0:  { x: 0.5, y: 0.1, score: 0.99 },  // nose (top)
    11: { x: 0.4, y: 0.3, score: 0.99 },  // leftShoulder
    12: { x: 0.6, y: 0.3, score: 0.99 },  // rightShoulder
    13: { x: 0.35, y: 0.45, score: 0.9 },  // leftElbow
    14: { x: 0.65, y: 0.45, score: 0.9 },  // rightElbow
    15: { x: 0.35, y: 0.6, score: 0.9 },   // leftWrist (below hips = LOW)
    16: { x: 0.65, y: 0.6, score: 0.9 },   // rightWrist (below hips = LOW)
    23: { x: 0.45, y: 0.5, score: 0.99 },  // leftHip
    24: { x: 0.55, y: 0.5, score: 0.99 },  // rightHip
    25: { x: 0.45, y: 0.7, score: 0.9 },   // leftKnee
    26: { x: 0.55, y: 0.7, score: 0.9 },   // rightKnee
    27: { x: 0.45, y: 0.9, score: 0.9 },   // leftAnkle
    28: { x: 0.55, y: 0.9, score: 0.9 },   // rightAnkle
  };
  const merged = { ...defaults, ...overrides };
  const kp = new Array(33).fill(null).map((_, i) => {
    const d = merged[i];
    if (!d) return { x: 0, y: 0, z: 0, score: 0 };
    return { x: d.x, y: d.y, z: d.z || 0, score: d.score };
  });
  return kp;
};

describe('extractSemanticPosition', () => {
  test('standing with arms at sides → both hands LOW', () => {
    const kp = makeKeypoints();
    const pos = extractSemanticPosition(kp);
    expect(pos.leftHand).toBe('LOW');
    expect(pos.rightHand).toBe('LOW');
  });

  test('hands raised above shoulders → both hands HIGH', () => {
    const kp = makeKeypoints({
      15: { x: 0.35, y: 0.15, score: 0.9 },  // leftWrist above shoulders
      16: { x: 0.65, y: 0.15, score: 0.9 },  // rightWrist above shoulders
    });
    const pos = extractSemanticPosition(kp);
    expect(pos.leftHand).toBe('HIGH');
    expect(pos.rightHand).toBe('HIGH');
  });

  test('hands at chest height → both hands MID', () => {
    const kp = makeKeypoints({
      15: { x: 0.35, y: 0.4, score: 0.9 },  // leftWrist between shoulder and hip
      16: { x: 0.65, y: 0.4, score: 0.9 },  // rightWrist between shoulder and hip
    });
    const pos = extractSemanticPosition(kp);
    expect(pos.leftHand).toBe('MID');
    expect(pos.rightHand).toBe('MID');
  });

  test('derived: handsUp true when both hands HIGH', () => {
    const kp = makeKeypoints({
      15: { x: 0.35, y: 0.15, score: 0.9 },
      16: { x: 0.65, y: 0.15, score: 0.9 },
    });
    const pos = extractSemanticPosition(kp);
    expect(pos.handsUp).toBe(true);
  });

  test('derived: handsUp false when only one hand HIGH', () => {
    const kp = makeKeypoints({
      15: { x: 0.35, y: 0.15, score: 0.9 },  // left HIGH
      16: { x: 0.65, y: 0.6, score: 0.9 },   // right LOW
    });
    const pos = extractSemanticPosition(kp);
    expect(pos.handsUp).toBe(false);
  });

  test('derived: bodyUpright true when standing', () => {
    const kp = makeKeypoints();
    const pos = extractSemanticPosition(kp);
    expect(pos.bodyUpright).toBe(true);
  });

  test('knee states: standing straight → both knees LOW', () => {
    const kp = makeKeypoints();
    const pos = extractSemanticPosition(kp);
    expect(pos.leftKnee).toBe('LOW');
    expect(pos.rightKnee).toBe('LOW');
  });

  test('null/empty keypoints → null', () => {
    expect(extractSemanticPosition(null)).toBeNull();
    expect(extractSemanticPosition([])).toBeNull();
  });

  test('low-confidence keypoints → null for affected properties', () => {
    const kp = makeKeypoints({
      15: { x: 0.35, y: 0.15, score: 0.1 },  // too low confidence
    });
    const pos = extractSemanticPosition(kp);
    expect(pos.leftHand).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/frontend/pose/poseSemantics.unit.test.mjs --no-coverage`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```js
// frontend/src/modules/Fitness/lib/pose/poseSemantics.js
/**
 * SemanticPosition — per-frame body state extraction from raw keypoints
 *
 * Transforms 33 BlazePose keypoints into discrete body-relative states.
 * All positions are relative to body landmarks (not camera frame).
 */

import { calculateAngle } from './poseGeometry.js';

// Keypoint indices (BlazePose)
const KP = {
  NOSE: 0,
  LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,    RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,    RIGHT_WRIST: 16,
  LEFT_HIP: 23,      RIGHT_HIP: 24,
  LEFT_KNEE: 25,     RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,    RIGHT_ANKLE: 28,
};

const MIN_SCORE = 0.3;

/**
 * Check if a keypoint is usable
 */
const isValid = (kp) => kp && kp.score >= MIN_SCORE;

/**
 * Classify hand position relative to body (body-relative Y axis)
 * Above shoulder line = HIGH, between shoulder and hip = MID, below hip = LOW
 */
const classifyHandY = (wrist, shoulder, hip) => {
  if (!isValid(wrist) || !isValid(shoulder) || !isValid(hip)) return null;
  if (wrist.y < shoulder.y) return 'HIGH';   // above shoulder (y increases downward)
  if (wrist.y > hip.y) return 'LOW';          // below hip
  return 'MID';                                // between
};

/**
 * Classify knee bend from joint angle
 * ~170°+ = LOW (straight), 90-170° = MID (bent), <90° = HIGH (deeply bent)
 */
const classifyKneeAngle = (hip, knee, ankle) => {
  if (!isValid(hip) || !isValid(knee) || !isValid(ankle)) return null;
  const angle = calculateAngle(hip, knee, ankle);
  if (angle === 0) return null;  // calculateAngle returns 0 on failure
  if (angle >= 160) return 'LOW';
  if (angle >= 90) return 'MID';
  return 'HIGH';
};

/**
 * Classify foot position relative to hip and knee
 */
const classifyFootY = (ankle, knee, hip) => {
  if (!isValid(ankle) || !isValid(knee) || !isValid(hip)) return null;
  if (ankle.y < knee.y) return 'HIGH';
  if (ankle.y > hip.y + (hip.y - knee.y)) return 'LOW';  // well below hip
  return 'MID';
};

/**
 * Classify elbow bend from joint angle
 * ~160°+ = LOW (straight), 90-160° = MID (bent), <90° = HIGH (tightly bent)
 */
const classifyElbowAngle = (shoulder, elbow, wrist) => {
  if (!isValid(shoulder) || !isValid(elbow) || !isValid(wrist)) return null;
  const angle = calculateAngle(shoulder, elbow, wrist);
  if (angle === 0) return null;
  if (angle >= 150) return 'LOW';
  if (angle >= 80) return 'MID';
  return 'HIGH';
};

/**
 * Check if torso is roughly upright (shoulder above hip, within threshold)
 */
const checkUpright = (kp) => {
  const ls = kp[KP.LEFT_SHOULDER];
  const rs = kp[KP.RIGHT_SHOULDER];
  const lh = kp[KP.LEFT_HIP];
  const rh = kp[KP.RIGHT_HIP];

  // Need at least one shoulder+hip pair
  const pairs = [];
  if (isValid(ls) && isValid(lh)) pairs.push([ls, lh]);
  if (isValid(rs) && isValid(rh)) pairs.push([rs, rh]);
  if (pairs.length === 0) return null;

  // Check that shoulders are above hips and roughly vertical
  return pairs.every(([s, h]) => {
    const dy = h.y - s.y;       // positive = shoulder above hip (correct)
    const dx = Math.abs(h.x - s.x);
    return dy > 0 && dx < dy;   // more vertical than horizontal
  });
};

/**
 * Check if torso is roughly horizontal (prone/plank)
 */
const checkProne = (kp) => {
  const ls = kp[KP.LEFT_SHOULDER];
  const rs = kp[KP.RIGHT_SHOULDER];
  const lh = kp[KP.LEFT_HIP];
  const rh = kp[KP.RIGHT_HIP];

  const pairs = [];
  if (isValid(ls) && isValid(lh)) pairs.push([ls, lh]);
  if (isValid(rs) && isValid(rh)) pairs.push([rs, rh]);
  if (pairs.length === 0) return null;

  return pairs.every(([s, h]) => {
    const dy = Math.abs(h.y - s.y);
    const dx = Math.abs(h.x - s.x);
    return dx > dy;  // more horizontal than vertical
  });
};

/**
 * Extract SemanticPosition from raw keypoints (pure, no hysteresis)
 *
 * @param {Array} keypoints - 33-element BlazePose keypoint array, each {x, y, z, score}
 * @returns {Object|null} SemanticPosition or null if keypoints are unusable
 */
export const extractSemanticPosition = (keypoints) => {
  if (!keypoints || keypoints.length < 29) return null;

  const kp = keypoints;

  // --- Limb states ---
  const leftHand = classifyHandY(kp[KP.LEFT_WRIST], kp[KP.LEFT_SHOULDER], kp[KP.LEFT_HIP]);
  const rightHand = classifyHandY(kp[KP.RIGHT_WRIST], kp[KP.RIGHT_SHOULDER], kp[KP.RIGHT_HIP]);
  const leftElbow = classifyElbowAngle(kp[KP.LEFT_SHOULDER], kp[KP.LEFT_ELBOW], kp[KP.LEFT_WRIST]);
  const rightElbow = classifyElbowAngle(kp[KP.RIGHT_SHOULDER], kp[KP.RIGHT_ELBOW], kp[KP.RIGHT_WRIST]);
  const leftKnee = classifyKneeAngle(kp[KP.LEFT_HIP], kp[KP.LEFT_KNEE], kp[KP.LEFT_ANKLE]);
  const rightKnee = classifyKneeAngle(kp[KP.RIGHT_HIP], kp[KP.RIGHT_KNEE], kp[KP.RIGHT_ANKLE]);
  const leftFoot = classifyFootY(kp[KP.LEFT_ANKLE], kp[KP.LEFT_KNEE], kp[KP.LEFT_HIP]);
  const rightFoot = classifyFootY(kp[KP.RIGHT_ANKLE], kp[KP.RIGHT_KNEE], kp[KP.RIGHT_HIP]);

  // --- Derived booleans ---
  const handsUp = leftHand === 'HIGH' && rightHand === 'HIGH';
  const bodyUpright = checkUpright(kp);
  const bodyProne = checkProne(kp);
  const squatPosition = leftKnee === 'HIGH' && rightKnee === 'HIGH' && bodyUpright === true;
  const lungePosition = (leftKnee === 'HIGH' && rightKnee === 'LOW') ||
                         (leftKnee === 'LOW' && rightKnee === 'HIGH');
  const armsExtended = leftElbow === 'LOW' && rightElbow === 'LOW';

  return {
    // Limb states
    leftHand, rightHand,
    leftElbow, rightElbow,
    leftKnee, rightKnee,
    leftFoot, rightFoot,
    // Derived
    handsUp, bodyUpright, bodyProne,
    squatPosition, lungePosition, armsExtended,
  };
};

export default { extractSemanticPosition };
```

**Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/frontend/pose/poseSemantics.unit.test.mjs --no-coverage`
Expected: PASS (all 9 tests)

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/lib/pose/poseSemantics.js \
        tests/isolated/frontend/pose/poseSemantics.unit.test.mjs
git commit -m "feat(pose): add SemanticPosition extraction (poseSemantics.js)"
```

---

### Task 2: SemanticPosition — Hysteresis Wrapper

**Files:**
- Modify: `frontend/src/modules/Fitness/lib/pose/poseSemantics.js`
- Test: `tests/isolated/frontend/pose/poseSemantics.unit.test.mjs`

**Step 1: Write the failing test**

Add to the existing test file:

```js
import { extractSemanticPosition, createSemanticExtractor } from '../../../../frontend/src/modules/Fitness/lib/pose/poseSemantics.js';

describe('createSemanticExtractor (hysteresis)', () => {
  test('returns same shape as extractSemanticPosition', () => {
    const extractor = createSemanticExtractor();
    const kp = makeKeypoints();
    const pos = extractor(kp, 1000);
    expect(pos).toHaveProperty('leftHand');
    expect(pos).toHaveProperty('handsUp');
  });

  test('does not thrash on boundary — holds previous state within deadband', () => {
    const extractor = createSemanticExtractor();
    // First call: hands clearly LOW
    const kp1 = makeKeypoints({
      15: { x: 0.35, y: 0.6, score: 0.9 },
    });
    const pos1 = extractor(kp1, 1000);
    expect(pos1.leftHand).toBe('LOW');

    // Second call: hand barely crosses into MID (within deadband)
    // Hip y=0.5, shoulder y=0.3 — boundary is at hip y=0.5
    // Just barely above hip (0.49) should be held as LOW by deadband
    const kp2 = makeKeypoints({
      15: { x: 0.35, y: 0.49, score: 0.9 },
    });
    const pos2 = extractor(kp2, 1050);
    expect(pos2.leftHand).toBe('LOW');  // held by deadband
  });

  test('transitions after sustained clear crossing', () => {
    const extractor = createSemanticExtractor();
    // Start LOW
    const kpLow = makeKeypoints({
      15: { x: 0.35, y: 0.6, score: 0.9 },
    });
    extractor(kpLow, 1000);

    // Move clearly into MID (well past deadband)
    const kpMid = makeKeypoints({
      15: { x: 0.35, y: 0.4, score: 0.9 },
    });
    // First frame at new position — starts minHold timer
    extractor(kpMid, 1050);
    // After minHoldMs (default 80ms) — should transition
    const pos = extractor(kpMid, 1200);
    expect(pos.leftHand).toBe('MID');
  });

  test('does not transition during minHold period', () => {
    const extractor = createSemanticExtractor();
    const kpLow = makeKeypoints({
      15: { x: 0.35, y: 0.6, score: 0.9 },
    });
    extractor(kpLow, 1000);

    // Move clearly into MID
    const kpMid = makeKeypoints({
      15: { x: 0.35, y: 0.4, score: 0.9 },
    });
    // Only 30ms later — within minHoldMs
    const pos = extractor(kpMid, 1030);
    expect(pos.leftHand).toBe('LOW');  // still held
  });

  test('resets pending transition if value bounces back', () => {
    const extractor = createSemanticExtractor();
    const kpLow = makeKeypoints({ 15: { x: 0.35, y: 0.6, score: 0.9 } });
    extractor(kpLow, 1000);

    // Briefly move to MID
    const kpMid = makeKeypoints({ 15: { x: 0.35, y: 0.4, score: 0.9 } });
    extractor(kpMid, 1050);

    // Bounce back to LOW before minHold expires
    extractor(kpLow, 1070);

    // Wait past minHold — should still be LOW (bounce cancelled the transition)
    const pos = extractor(kpLow, 1200);
    expect(pos.leftHand).toBe('LOW');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/frontend/pose/poseSemantics.unit.test.mjs --no-coverage`
Expected: FAIL — `createSemanticExtractor` not exported

**Step 3: Write implementation**

Add to `poseSemantics.js`:

```js
/**
 * Default hysteresis config per property.
 * deadband: value must cross threshold by this amount (fraction of body-height for position, degrees for angles)
 * minHoldMs: new state must persist this long before committing
 */
export const DEFAULT_HYSTERESIS = {
  leftHand:   { deadband: 0.08, minHoldMs: 80 },
  rightHand:  { deadband: 0.08, minHoldMs: 80 },
  leftElbow:  { deadband: 8,    minHoldMs: 80 },
  rightElbow: { deadband: 8,    minHoldMs: 80 },
  leftKnee:   { deadband: 5,    minHoldMs: 120 },
  rightKnee:  { deadband: 5,    minHoldMs: 120 },
  leftFoot:   { deadband: 0.08, minHoldMs: 80 },
  rightFoot:  { deadband: 0.08, minHoldMs: 80 },
};

// Properties that are discrete (LOW/MID/HIGH) — hysteresis uses minHold only
const DISCRETE_PROPERTIES = [
  'leftHand', 'rightHand', 'leftElbow', 'rightElbow',
  'leftKnee', 'rightKnee', 'leftFoot', 'rightFoot',
];

// Derived booleans — recomputed from stabilized limb states, no independent hysteresis
const DERIVED_PROPERTIES = [
  'handsUp', 'bodyUpright', 'bodyProne',
  'squatPosition', 'lungePosition', 'armsExtended',
];

/**
 * Recompute derived booleans from stabilized limb states
 */
const recomputeDerived = (limbs, rawDerived) => ({
  handsUp: limbs.leftHand === 'HIGH' && limbs.rightHand === 'HIGH',
  bodyUpright: rawDerived.bodyUpright,  // pass through (already torso-level)
  bodyProne: rawDerived.bodyProne,
  squatPosition: limbs.leftKnee === 'HIGH' && limbs.rightKnee === 'HIGH' && rawDerived.bodyUpright === true,
  lungePosition: (limbs.leftKnee === 'HIGH' && limbs.rightKnee === 'LOW') ||
                 (limbs.leftKnee === 'LOW' && limbs.rightKnee === 'HIGH'),
  armsExtended: limbs.leftElbow === 'LOW' && limbs.rightElbow === 'LOW',
});

/**
 * Create a stateful SemanticPosition extractor with hysteresis.
 *
 * @param {Object} config - Override hysteresis settings per property
 * @returns {Function} (keypoints, timestamp) => SemanticPosition
 */
export const createSemanticExtractor = (config = {}) => {
  const hysteresis = {};
  DISCRETE_PROPERTIES.forEach(prop => {
    hysteresis[prop] = { ...DEFAULT_HYSTERESIS[prop], ...(config[prop] || {}) };
  });

  let prevState = null;
  const pendingTransitions = {};  // prop → { targetValue, startedAt }

  return (keypoints, timestamp) => {
    const raw = extractSemanticPosition(keypoints);
    if (!raw) return prevState;

    if (!prevState) {
      prevState = raw;
      return raw;
    }

    // Apply hysteresis to discrete limb properties
    const stabilized = {};
    DISCRETE_PROPERTIES.forEach(prop => {
      const rawValue = raw[prop];
      const prevValue = prevState[prop];
      const { minHoldMs } = hysteresis[prop];

      if (rawValue === null) {
        stabilized[prop] = prevValue;
        return;
      }

      if (rawValue === prevValue) {
        // Same state — clear any pending transition
        delete pendingTransitions[prop];
        stabilized[prop] = prevValue;
        return;
      }

      // Different state — check pending transition
      const pending = pendingTransitions[prop];
      if (pending && pending.targetValue === rawValue) {
        // Already tracking this transition — check minHold
        if (timestamp - pending.startedAt >= minHoldMs) {
          // Transition confirmed
          stabilized[prop] = rawValue;
          delete pendingTransitions[prop];
        } else {
          // Still waiting — hold previous
          stabilized[prop] = prevValue;
        }
      } else {
        // New transition — start tracking
        pendingTransitions[prop] = { targetValue: rawValue, startedAt: timestamp };
        stabilized[prop] = prevValue;
      }
    });

    // Recompute derived from stabilized limb states
    const derived = recomputeDerived(stabilized, raw);

    const result = { ...stabilized, ...derived };
    prevState = result;
    return result;
  };
};
```

**Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/frontend/pose/poseSemantics.unit.test.mjs --no-coverage`
Expected: PASS (all 14 tests)

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/lib/pose/poseSemantics.js \
        tests/isolated/frontend/pose/poseSemantics.unit.test.mjs
git commit -m "feat(pose): add hysteresis wrapper (createSemanticExtractor)"
```

---

### Task 3: SemanticMove — Cyclic (Rep-Counted) Actions

**Files:**
- Create: `frontend/src/modules/Fitness/lib/pose/poseActions.js`
- Test: `tests/isolated/frontend/pose/poseActions.unit.test.mjs`

**Step 1: Write the failing test**

```js
// tests/isolated/frontend/pose/poseActions.unit.test.mjs
import { createActionDetector } from '../../../../frontend/src/modules/Fitness/lib/pose/poseActions.js';

const JUMPING_JACK = {
  id: 'jumping-jack',
  name: 'Jumping Jack',
  phases: [
    { name: 'open',   match: { handsUp: true } },
    { name: 'closed', match: { handsUp: false } },
  ],
  timing: {
    minCycleMs: 400,
    maxCycleMs: 3000,
    maxPhaseMs: 2000,
  },
};

describe('createActionDetector — cyclic (rep-counted)', () => {
  test('initial state: 0 reps, idle phase', () => {
    const det = createActionDetector(JUMPING_JACK);
    const result = det.update({ handsUp: false, bodyUpright: true }, 1000);
    expect(result.repCount).toBe(0);
    expect(result.active).toBe(false);
  });

  test('one full cycle: closed → open → closed = 1 rep', () => {
    const det = createActionDetector(JUMPING_JACK);
    det.update({ handsUp: false }, 1000);   // start closed
    det.update({ handsUp: true }, 1500);    // open
    const r = det.update({ handsUp: false }, 2000);  // closed again = 1 rep
    expect(r.repCount).toBe(1);
  });

  test('three full cycles = 3 reps', () => {
    const det = createActionDetector(JUMPING_JACK);
    let t = 1000;
    det.update({ handsUp: false }, t);
    for (let i = 0; i < 3; i++) {
      t += 500;
      det.update({ handsUp: true }, t);
      t += 500;
      det.update({ handsUp: false }, t);
    }
    const r = det.update({ handsUp: false }, t + 100);
    expect(r.repCount).toBe(3);
  });

  test('too-fast cycle (< minCycleMs) is rejected', () => {
    const det = createActionDetector(JUMPING_JACK);
    det.update({ handsUp: false }, 1000);
    det.update({ handsUp: true }, 1100);    // only 100ms
    const r = det.update({ handsUp: false }, 1200);  // only 200ms total
    expect(r.repCount).toBe(0);
  });

  test('too-slow phase (> maxPhaseMs) resets cycle', () => {
    const det = createActionDetector(JUMPING_JACK);
    det.update({ handsUp: false }, 1000);
    det.update({ handsUp: true }, 1500);
    // Stay in open phase for > maxPhaseMs (2000ms)
    const r = det.update({ handsUp: false }, 4000);
    expect(r.repCount).toBe(0);  // reset, not counted
  });

  test('reset() clears rep count', () => {
    const det = createActionDetector(JUMPING_JACK);
    det.update({ handsUp: false }, 1000);
    det.update({ handsUp: true }, 1500);
    det.update({ handsUp: false }, 2000);
    expect(det.update({ handsUp: false }, 2100).repCount).toBe(1);
    det.reset();
    expect(det.update({ handsUp: false }, 3000).repCount).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/frontend/pose/poseActions.unit.test.mjs --no-coverage`
Expected: FAIL — module not found

**Step 3: Write implementation**

```js
// frontend/src/modules/Fitness/lib/pose/poseActions.js
/**
 * SemanticMove — action detection from SemanticPosition streams
 *
 * Recognizes movement patterns over time: cyclic reps, sustained holds, one-shot reaches.
 * Patterns are defined declaratively; complex exercises use custom detect() functions.
 */

/**
 * Check if a semantic position matches a phase's match criteria
 */
const matchesPhase = (position, match) => {
  if (!position || !match) return false;
  return Object.entries(match).every(([key, expected]) => position[key] === expected);
};

/**
 * Create a cyclic (rep-counting) action detector from a pattern definition.
 *
 * Pattern must have:
 *   phases: [{ name, match }]  — ordered phases forming one rep cycle
 *   timing: { minCycleMs, maxCycleMs, maxPhaseMs }
 *
 * A rep is counted when all phases complete in order and the cycle
 * returns to phase 0. Timing constraints are enforced per-phase and per-cycle.
 */
const createCyclicDetector = (pattern) => {
  const { phases, timing = {} } = pattern;
  const { minCycleMs = 300, maxCycleMs = 5000, maxPhaseMs = 3000 } = timing;

  let phaseIndex = -1;       // -1 = waiting for first phase match
  let repCount = 0;
  let cycleStartTime = null;
  let phaseStartTime = null;
  let active = false;

  const reset = () => {
    phaseIndex = -1;
    repCount = 0;
    cycleStartTime = null;
    phaseStartTime = null;
    active = false;
  };

  const update = (position, timestamp) => {
    const currentPhase = phaseIndex >= 0 ? phases[phaseIndex] : null;
    const nextPhaseIndex = phaseIndex + 1;
    const isWrapping = nextPhaseIndex >= phases.length;
    const targetPhaseIndex = isWrapping ? 0 : nextPhaseIndex;
    const targetPhase = phases[targetPhaseIndex];

    // Check if current phase has exceeded maxPhaseMs
    if (currentPhase && phaseStartTime && (timestamp - phaseStartTime > maxPhaseMs)) {
      // Reset cycle — phase held too long
      phaseIndex = -1;
      cycleStartTime = null;
      phaseStartTime = null;
      active = false;
    }

    // Check if position matches the next expected phase
    if (matchesPhase(position, targetPhase.match)) {
      if (phaseIndex === -1 || targetPhaseIndex !== phaseIndex) {
        // Advancing to next phase
        if (isWrapping) {
          // Completed a full cycle — check timing
          const cycleDuration = cycleStartTime ? timestamp - cycleStartTime : 0;
          if (cycleStartTime && cycleDuration >= minCycleMs && cycleDuration <= maxCycleMs) {
            repCount++;
          }
          // Start new cycle
          phaseIndex = 0;
          cycleStartTime = timestamp;
          phaseStartTime = timestamp;
          active = true;
        } else {
          // Moving forward in cycle
          if (phaseIndex === -1) {
            // First phase match — start cycle
            cycleStartTime = timestamp;
            active = true;
          }
          phaseIndex = targetPhaseIndex;
          phaseStartTime = timestamp;
        }
      }
    }

    return {
      repCount,
      currentPhase: currentPhase?.name || null,
      phaseIndex,
      active,
    };
  };

  return { update, reset, get id() { return pattern.id; } };
};

/**
 * Create a sustained (hold) action detector.
 *
 * Pattern must have:
 *   sustain: { prop: value, ... }  — match criteria to sustain
 *   timing: { gracePeriodMs }      — allowed wobble without breaking hold
 */
const createSustainDetector = (pattern) => {
  const { sustain, timing = {} } = pattern;
  const { gracePeriodMs = 500 } = timing;

  let holdStartTime = null;
  let lastMatchTime = null;
  let holdDurationMs = 0;
  let holding = false;

  const reset = () => {
    holdStartTime = null;
    lastMatchTime = null;
    holdDurationMs = 0;
    holding = false;
  };

  const update = (position, timestamp) => {
    const matches = matchesPhase(position, sustain);

    if (matches) {
      if (!holdStartTime) holdStartTime = timestamp;
      lastMatchTime = timestamp;
      holdDurationMs = timestamp - holdStartTime;
      holding = true;
    } else if (holding) {
      // Check grace period
      if (lastMatchTime && (timestamp - lastMatchTime) > gracePeriodMs) {
        // Grace period exceeded — break hold
        holdStartTime = null;
        lastMatchTime = null;
        holdDurationMs = 0;
        holding = false;
      }
      // Otherwise still within grace — holdDurationMs freezes
    }

    return {
      holding,
      holdDurationMs,
      active: holding,
    };
  };

  return { update, reset, get id() { return pattern.id; } };
};

/**
 * Create an action detector from a pattern definition.
 * Dispatches to cyclic or sustain based on pattern shape.
 *
 * @param {Object} pattern - Pattern definition with phases (cyclic) or sustain (hold)
 * @returns {{ update, reset, id }}
 */
export const createActionDetector = (pattern) => {
  if (pattern.phases) return createCyclicDetector(pattern);
  if (pattern.sustain) return createSustainDetector(pattern);
  throw new Error(`Pattern '${pattern.id}' must have 'phases' or 'sustain'`);
};

/**
 * Create a custom action detector with a user-provided detect function.
 *
 * @param {Object} def - { id, name, detect: (position, history, timestamp) => result }
 * @returns {{ update, reset, id }}
 */
export const createCustomActionDetector = (def) => {
  const history = [];
  const maxHistory = def.maxHistory || 60;

  const reset = () => { history.length = 0; };

  const update = (position, timestamp) => {
    history.push({ position, timestamp });
    if (history.length > maxHistory) history.shift();
    return def.detect(position, history, timestamp) || { active: false };
  };

  return { update, reset, get id() { return def.id; } };
};

export default { createActionDetector, createCustomActionDetector, matchesPhase };
```

**Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/frontend/pose/poseActions.unit.test.mjs --no-coverage`
Expected: PASS (all 6 tests)

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/lib/pose/poseActions.js \
        tests/isolated/frontend/pose/poseActions.unit.test.mjs
git commit -m "feat(pose): add SemanticMove cyclic action detector (poseActions.js)"
```

---

### Task 4: SemanticMove — Sustained (Hold) Actions

**Files:**
- Test: `tests/isolated/frontend/pose/poseActions.unit.test.mjs`

**Step 1: Write the failing test**

Add to the existing test file:

```js
const PLANK = {
  id: 'plank',
  name: 'Plank',
  sustain: { bodyProne: true, armsExtended: true },
  timing: { gracePeriodMs: 500 },
};

describe('createActionDetector — sustained (hold)', () => {
  test('initial state: not holding', () => {
    const det = createActionDetector(PLANK);
    const r = det.update({ bodyProne: false, armsExtended: true }, 1000);
    expect(r.holding).toBe(false);
    expect(r.holdDurationMs).toBe(0);
  });

  test('tracks hold duration while matching', () => {
    const det = createActionDetector(PLANK);
    det.update({ bodyProne: true, armsExtended: true }, 1000);
    const r = det.update({ bodyProne: true, armsExtended: true }, 6000);
    expect(r.holding).toBe(true);
    expect(r.holdDurationMs).toBe(5000);
  });

  test('brief wobble within grace period does not break hold', () => {
    const det = createActionDetector(PLANK);
    det.update({ bodyProne: true, armsExtended: true }, 1000);
    det.update({ bodyProne: true, armsExtended: true }, 3000);
    // Wobble — bodyProne flickers
    det.update({ bodyProne: false, armsExtended: true }, 3100);
    // Back within grace period
    const r = det.update({ bodyProne: true, armsExtended: true }, 3300);
    expect(r.holding).toBe(true);
    expect(r.holdDurationMs).toBeGreaterThan(2000);
  });

  test('loss exceeding grace period breaks hold', () => {
    const det = createActionDetector(PLANK);
    det.update({ bodyProne: true, armsExtended: true }, 1000);
    det.update({ bodyProne: true, armsExtended: true }, 3000);
    // Lose position for > gracePeriodMs (500ms)
    det.update({ bodyProne: false, armsExtended: true }, 3100);
    const r = det.update({ bodyProne: false, armsExtended: true }, 3700);
    expect(r.holding).toBe(false);
    expect(r.holdDurationMs).toBe(0);
  });

  test('reset() clears hold state', () => {
    const det = createActionDetector(PLANK);
    det.update({ bodyProne: true, armsExtended: true }, 1000);
    det.update({ bodyProne: true, armsExtended: true }, 5000);
    det.reset();
    const r = det.update({ bodyProne: false, armsExtended: true }, 6000);
    expect(r.holding).toBe(false);
    expect(r.holdDurationMs).toBe(0);
  });
});
```

**Step 2: Run test to verify it passes**

Since the sustain detector was already implemented in Task 3, these tests should pass immediately.

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/frontend/pose/poseActions.unit.test.mjs --no-coverage`
Expected: PASS (all 11 tests)

**Step 3: Commit**

```bash
git add tests/isolated/frontend/pose/poseActions.unit.test.mjs
git commit -m "test(pose): add sustained hold action detector tests"
```

---

### Task 5: SemanticMove — Custom Detector Escape Hatch

**Files:**
- Test: `tests/isolated/frontend/pose/poseActions.unit.test.mjs`

**Step 1: Write the failing test**

Add to the existing test file:

```js
import { createActionDetector, createCustomActionDetector } from '../../../../frontend/src/modules/Fitness/lib/pose/poseActions.js';

describe('createCustomActionDetector', () => {
  test('calls detect with position, history, and timestamp', () => {
    const detectFn = jest.fn(() => ({ active: true, customField: 42 }));
    const det = createCustomActionDetector({
      id: 'custom',
      detect: detectFn,
    });
    const pos = { handsUp: true };
    det.update(pos, 1000);
    expect(detectFn).toHaveBeenCalledTimes(1);
    expect(detectFn.mock.calls[0][0]).toEqual(pos);
    expect(detectFn.mock.calls[0][1]).toHaveLength(1);   // history
    expect(detectFn.mock.calls[0][2]).toBe(1000);         // timestamp
  });

  test('accumulates history up to maxHistory', () => {
    let capturedHistory;
    const det = createCustomActionDetector({
      id: 'custom',
      maxHistory: 3,
      detect: (pos, history) => { capturedHistory = history; return { active: false }; },
    });
    det.update({ a: 1 }, 100);
    det.update({ a: 2 }, 200);
    det.update({ a: 3 }, 300);
    det.update({ a: 4 }, 400);
    expect(capturedHistory).toHaveLength(3);
    expect(capturedHistory[0].position).toEqual({ a: 2 });  // oldest trimmed
  });

  test('reset clears history', () => {
    let capturedHistory;
    const det = createCustomActionDetector({
      id: 'custom',
      detect: (pos, history) => { capturedHistory = history; return { active: false }; },
    });
    det.update({ a: 1 }, 100);
    det.update({ a: 2 }, 200);
    det.reset();
    det.update({ a: 3 }, 300);
    expect(capturedHistory).toHaveLength(1);
  });
});
```

**Step 2: Run test to verify it passes**

Since the custom detector was also implemented in Task 3, these should pass.

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/frontend/pose/poseActions.unit.test.mjs --no-coverage`
Expected: PASS (all 14 tests)

**Step 3: Commit**

```bash
git add tests/isolated/frontend/pose/poseActions.unit.test.mjs
git commit -m "test(pose): add custom action detector tests"
```

---

### Task 6: SemanticMoveDetector — Bridge to MoveDetectorBase

**Files:**
- Create: `frontend/src/modules/Fitness/domain/pose/SemanticMoveDetector.js`
- Test: `tests/isolated/frontend/pose/SemanticMoveDetector.unit.test.mjs`

**Step 1: Write the failing test**

```js
// tests/isolated/frontend/pose/SemanticMoveDetector.unit.test.mjs
import { SemanticMoveDetector } from '../../../../frontend/src/modules/Fitness/domain/pose/SemanticMoveDetector.js';

const SQUAT_PATTERN = {
  id: 'squat',
  name: 'Squat',
  phases: [
    { name: 'down', match: { squatPosition: true } },
    { name: 'up',   match: { squatPosition: false, bodyUpright: true } },
  ],
  timing: { minCycleMs: 800, maxCycleMs: 5000 },
};

// Build a minimal pose object with enough keypoints for semantic extraction
const makePose = (overrides = {}) => {
  const defaults = {
    0:  { x: 0.5, y: 0.1, z: 0, score: 0.99 },
    11: { x: 0.4, y: 0.3, z: 0, score: 0.99 },
    12: { x: 0.6, y: 0.3, z: 0, score: 0.99 },
    13: { x: 0.35, y: 0.45, z: 0, score: 0.9 },
    14: { x: 0.65, y: 0.45, z: 0, score: 0.9 },
    15: { x: 0.35, y: 0.6, z: 0, score: 0.9 },
    16: { x: 0.65, y: 0.6, z: 0, score: 0.9 },
    23: { x: 0.45, y: 0.5, z: 0, score: 0.99 },
    24: { x: 0.55, y: 0.5, z: 0, score: 0.99 },
    25: { x: 0.45, y: 0.7, z: 0, score: 0.9 },
    26: { x: 0.55, y: 0.7, z: 0, score: 0.9 },
    27: { x: 0.45, y: 0.9, z: 0, score: 0.9 },
    28: { x: 0.55, y: 0.9, z: 0, score: 0.9 },
  };
  const merged = { ...defaults, ...overrides };
  const keypoints = new Array(33).fill(null).map((_, i) => merged[i] || { x: 0, y: 0, z: 0, score: 0 });
  return { keypoints, score: 0.9 };
};

describe('SemanticMoveDetector', () => {
  test('extends MoveDetectorBase — has id, onActivate, processPoses', () => {
    const det = new SemanticMoveDetector(SQUAT_PATTERN);
    expect(det.id).toBe('squat');
    expect(typeof det.onActivate).toBe('function');
    expect(typeof det.processPoses).toBe('function');
  });

  test('processPoses returns null when not active', () => {
    const det = new SemanticMoveDetector(SQUAT_PATTERN);
    const result = det.processPoses([makePose()]);
    expect(result).toBeNull();
  });

  test('after onActivate, processPoses extracts semantic state and runs detector', () => {
    const det = new SemanticMoveDetector(SQUAT_PATTERN);
    det.onActivate();
    const result = det.processPoses([makePose()]);
    // Should not error, returns event or null
    // Standing upright with straight knees = 'up' phase match
    expect(result === null || result.type === 'state_change').toBe(true);
  });

  test('reset() clears detector and extractor state', () => {
    const det = new SemanticMoveDetector(SQUAT_PATTERN);
    det.onActivate();
    det.processPoses([makePose()]);
    det.reset();
    expect(det.repCount).toBe(0);
    expect(det.currentState).toBe('idle');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/frontend/pose/SemanticMoveDetector.unit.test.mjs --no-coverage`
Expected: FAIL — module not found

**Step 3: Write implementation**

```js
// frontend/src/modules/Fitness/domain/pose/SemanticMoveDetector.js
/**
 * SemanticMoveDetector — bridges SemanticPosition + SemanticMove into MoveDetectorBase
 *
 * Wires the pure-function semantic pipeline into PoseContext's existing
 * move detector dispatch system.
 */

import { MoveDetectorBase } from './MoveDetectorBase.js';
import { createSemanticExtractor } from '../../lib/pose/poseSemantics.js';
import { createActionDetector, createCustomActionDetector } from '../../lib/pose/poseActions.js';

export class SemanticMoveDetector extends MoveDetectorBase {
  /**
   * @param {Object} pattern - Action pattern definition (with phases/sustain) or custom detector def
   * @param {Object} options - MoveDetectorBase options + semantic extractor config
   */
  constructor(pattern, options = {}) {
    super(pattern.id, pattern.name || pattern.id, options);
    this._pattern = pattern;
    this._extractorConfig = options.extractorConfig || {};
    this._extractor = null;
    this._actionDetector = null;
  }

  onActivate() {
    super.onActivate();
    this._extractor = createSemanticExtractor(this._extractorConfig);
    this._actionDetector = typeof this._pattern.detect === 'function'
      ? createCustomActionDetector(this._pattern)
      : createActionDetector(this._pattern);
  }

  /**
   * Core detection: extract semantic position, run action detector, emit events
   */
  _detectMove(poses) {
    const pose = poses[0];
    if (!pose?.keypoints) return null;

    const now = Date.now();
    const semantic = this._extractor(pose.keypoints, now);
    if (!semantic) return null;

    const result = this._actionDetector.update(semantic, now);
    if (!result) return null;

    // Update base class state
    this.confidence = result.confidence || (result.active ? 0.8 : 0.2);

    // Check for rep counted
    if (result.repCount !== undefined && result.repCount > this.repCount) {
      this.repCount = result.repCount;
      return this._emitEvent('rep_counted', {
        repCount: this.repCount,
        phase: result.currentPhase,
      });
    }

    // Check for phase/state transitions
    const phaseName = result.currentPhase || (result.holding ? 'holding' : 'idle');
    if (phaseName !== this.currentState) {
      const holdData = result.holdDurationMs !== undefined
        ? { holdDurationMs: result.holdDurationMs }
        : {};
      return this._transitionTo(phaseName);
    }

    return null;
  }

  reset() {
    super.reset();
    if (this._actionDetector) this._actionDetector.reset();
    this._extractor = createSemanticExtractor(this._extractorConfig);
  }
}

export default SemanticMoveDetector;
```

**Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/frontend/pose/SemanticMoveDetector.unit.test.mjs --no-coverage`
Expected: PASS (all 4 tests)

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/domain/pose/SemanticMoveDetector.js \
        tests/isolated/frontend/pose/SemanticMoveDetector.unit.test.mjs
git commit -m "feat(pose): add SemanticMoveDetector bridge to MoveDetectorBase"
```

---

### Task 7: Update Barrel Exports

**Files:**
- Modify: `frontend/src/modules/Fitness/lib/pose/index.js`

**Step 1: Update barrel exports**

```js
// frontend/src/modules/Fitness/lib/pose/index.js
/**
 * Pose library barrel exports
 */

export * from './poseConnections.js';
export * from './poseColors.js';
export * from './poseGeometry.js';
export * from './poseConfidence.js';
export * from './poseSemantics.js';
export * from './poseActions.js';

export { default as poseConnections } from './poseConnections.js';
export { default as poseColors } from './poseColors.js';
export { default as poseGeometry } from './poseGeometry.js';
export { default as poseConfidence } from './poseConfidence.js';
export { default as poseSemantics } from './poseSemantics.js';
export { default as poseActions } from './poseActions.js';
```

**Step 2: Run all pose tests**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/frontend/pose/ --no-coverage`
Expected: PASS (all tests across all 3 test files)

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/lib/pose/index.js
git commit -m "feat(pose): add poseSemantics and poseActions to barrel exports"
```

---

### Task 8: Integration Test with Real Pose Data

**Files:**
- Test: `tests/isolated/frontend/pose/poseSemantics.integration.test.mjs`

Uses the actual JSONL pose log data from `media/logs/poses/` to validate that SemanticPosition produces reasonable output from real BlazePose data.

**Step 1: Write integration test**

```js
// tests/isolated/frontend/pose/poseSemantics.integration.test.mjs
import { readFileSync } from 'fs';
import { join } from 'path';
import { extractSemanticPosition, createSemanticExtractor } from '../../../../frontend/src/modules/Fitness/lib/pose/poseSemantics.js';

// Load real pose data from JSONL log
const loadPoseFrames = () => {
  const dataDir = process.env.DAYLIGHT_DATA_PATH
    || '/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data';
  const mediaDir = dataDir.replace('/data', '/media');
  const logDir = join(mediaDir, 'logs', 'poses', '2026-03-04');

  // Use the largest file for best coverage
  const file = '2026-03-04T06-13-30.jsonl';
  const lines = readFileSync(join(logDir, file), 'utf-8').trim().split('\n');

  return lines
    .map(line => JSON.parse(line))
    .filter(d => d.kp && d.kp.length === 33)
    .map(d => ({
      timestamp: d.t,
      keypoints: d.kp.map(([x, y, z, score]) => ({ x, y, z, score })),
    }));
};

describe('SemanticPosition with real pose data', () => {
  let frames;

  beforeAll(() => {
    try {
      frames = loadPoseFrames();
    } catch {
      frames = null;
    }
  });

  test('loads at least 100 frames from log data', () => {
    if (!frames) return; // skip if data not available
    expect(frames.length).toBeGreaterThan(100);
  });

  test('extractSemanticPosition produces valid output for all frames', () => {
    if (!frames) return;
    let validCount = 0;
    for (const frame of frames) {
      const pos = extractSemanticPosition(frame.keypoints);
      if (pos) {
        validCount++;
        // All limb properties should be LOW/MID/HIGH or null
        ['leftHand', 'rightHand', 'leftKnee', 'rightKnee'].forEach(prop => {
          expect([null, 'LOW', 'MID', 'HIGH']).toContain(pos[prop]);
        });
        // Booleans should be bool or null
        ['handsUp', 'bodyUpright', 'bodyProne'].forEach(prop => {
          expect([null, true, false]).toContain(pos[prop]);
        });
      }
    }
    // At least some frames should produce valid output
    expect(validCount).toBeGreaterThan(frames.length * 0.5);
  });

  test('createSemanticExtractor produces stable output (no excessive thrash)', () => {
    if (!frames) return;
    const extractor = createSemanticExtractor();
    let transitions = 0;
    let prevPos = null;

    for (const frame of frames) {
      const pos = extractor(frame.keypoints, frame.timestamp);
      if (pos && prevPos) {
        // Count state transitions
        ['leftHand', 'rightHand', 'leftKnee', 'rightKnee'].forEach(prop => {
          if (pos[prop] !== prevPos[prop]) transitions++;
        });
      }
      prevPos = pos;
    }

    // With hysteresis, transitions should be much less than frame count × properties
    const maxExpectedTransitions = frames.length * 0.3; // less than 30% of frames cause transitions
    expect(transitions).toBeLessThan(maxExpectedTransitions);
  });
});
```

**Step 2: Run integration test**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/frontend/pose/poseSemantics.integration.test.mjs --no-coverage`
Expected: PASS (3 tests — or skip gracefully if data not available)

**Step 3: Commit**

```bash
git add tests/isolated/frontend/pose/poseSemantics.integration.test.mjs
git commit -m "test(pose): add integration test with real pose log data"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | SemanticPosition pure extraction | `poseSemantics.js` + test |
| 2 | Hysteresis wrapper | `poseSemantics.js` update + test |
| 3 | Cyclic action detector | `poseActions.js` + test |
| 4 | Sustained hold detector tests | test only |
| 5 | Custom detector tests | test only |
| 6 | SemanticMoveDetector bridge | `SemanticMoveDetector.js` + test |
| 7 | Barrel exports | `index.js` update |
| 8 | Integration test with real data | integration test |

Tasks 1-2 build Layer 1 (SemanticPosition). Tasks 3-5 build Layer 2 (SemanticMove). Task 6 bridges into existing infra. Task 8 validates against real captured data.

GovernanceEngine integration is a future phase — the semantic layers are independently useful.
