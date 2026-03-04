# Semantic Position Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the sloppy semantic position system with a proper joint-centric Layer 1, boolean multi-joint combos (Layer 1.5), and updated exercise patterns in Layer 2.

**Architecture:** Layer 1 extracts per-joint discrete states (HIGH/MID/LOW) including new hip flexion, shoulder elevation, torso angle, and stance width classifiers. Layer 1.5 derives boolean combo states (squatting, lunging, armsOverhead, etc.) from stabilized joint states. Layer 2 exercise patterns match against both layers.

**Tech Stack:** Pure JS (ES modules), Jest for testing.

**Design doc:** `docs/plans/2026-03-04-semantic-position-redesign-design.md`

---

### Task 1: Write failing tests for new Layer 1 joint classifiers

**Files:**
- Modify: `tests/isolated/frontend/pose/poseSemantics.unit.test.mjs`

**Step 1: Write failing tests for `classifyHip` (hip flexion)**

Add tests after the existing elbow/knee tests. Hip flexion = angle(shoulder, hip, knee).

```js
// --- hip states (NEW) ---
test('standing straight → both hips LOW (open hip angle)', () => {
  // Default: shoulder(0.3) -> hip(0.5) -> knee(0.7) = ~180° straight line
  const kp = makeKeypoints();
  const result = extractSemanticPosition(kp);
  expect(result.leftHip).toBe('LOW');
  expect(result.rightHip).toBe('LOW');
});

test('partial hip flexion → both hips MID', () => {
  // Move knees forward to create ~120° hip angle (between 90-160)
  const kp = makeKeypoints({
    25: { x: 0.6, y: 0.6, score: 0.9 },   // leftKnee forward and up
    26: { x: 0.4, y: 0.6, score: 0.9 },   // rightKnee forward and up
  });
  const result = extractSemanticPosition(kp);
  expect(result.leftHip).toBe('MID');
  expect(result.rightHip).toBe('MID');
});

test('deep hip flexion → both hips HIGH', () => {
  // Knees brought up near chest → acute hip angle (<90°)
  const kp = makeKeypoints({
    25: { x: 0.6, y: 0.45, score: 0.9 },  // leftKnee at hip height, forward
    26: { x: 0.4, y: 0.45, score: 0.9 },  // rightKnee at hip height, forward
    27: { x: 0.55, y: 0.5, score: 0.9 },  // leftAnkle near hip
    28: { x: 0.45, y: 0.5, score: 0.9 },  // rightAnkle near hip
  });
  const result = extractSemanticPosition(kp);
  expect(result.leftHip).toBe('HIGH');
  expect(result.rightHip).toBe('HIGH');
});
```

**Step 2: Write failing tests for `classifyShoulder` (arm elevation)**

```js
// --- shoulder states (NEW) ---
test('arms at sides → both shoulders LOW', () => {
  // Default: elbow straight below shoulder → small angle (<45°)
  const kp = makeKeypoints();
  const result = extractSemanticPosition(kp);
  expect(result.leftShoulder).toBe('LOW');
  expect(result.rightShoulder).toBe('LOW');
});

test('arms raised laterally → both shoulders MID', () => {
  // Elbows out to sides at shoulder height → ~90° angle (45-135)
  const kp = makeKeypoints({
    13: { x: 0.2, y: 0.3, score: 0.9 },   // leftElbow out to left at shoulder height
    14: { x: 0.8, y: 0.3, score: 0.9 },   // rightElbow out to right
    15: { x: 0.1, y: 0.3, score: 0.9 },   // leftWrist further out
    16: { x: 0.9, y: 0.3, score: 0.9 },   // rightWrist further out
  });
  const result = extractSemanticPosition(kp);
  expect(result.leftShoulder).toBe('MID');
  expect(result.rightShoulder).toBe('MID');
});

test('arms overhead → both shoulders HIGH', () => {
  // Elbows above head → large angle (>=135°)
  const kp = makeKeypoints({
    13: { x: 0.4, y: 0.1, score: 0.9 },   // leftElbow above head
    14: { x: 0.6, y: 0.1, score: 0.9 },   // rightElbow above head
    15: { x: 0.4, y: 0.05, score: 0.9 },  // leftWrist above elbow
    16: { x: 0.6, y: 0.05, score: 0.9 },  // rightWrist above elbow
  });
  const result = extractSemanticPosition(kp);
  expect(result.leftShoulder).toBe('HIGH');
  expect(result.rightShoulder).toBe('HIGH');
});
```

**Step 3: Write failing tests for `classifyTorso`**

```js
// --- torso state (NEW — replaces bodyUpright/bodyProne) ---
test('standing straight → torso UPRIGHT', () => {
  const kp = makeKeypoints();
  const result = extractSemanticPosition(kp);
  expect(result.torso).toBe('UPRIGHT');
});

test('leaning forward ~45° → torso LEANING', () => {
  // Shoulders forward of hips but not horizontal
  const kp = makeKeypoints({
    11: { x: 0.3, y: 0.35, score: 0.99 },  // leftShoulder forward and slightly above hip
    12: { x: 0.5, y: 0.35, score: 0.99 },  // rightShoulder forward
    23: { x: 0.45, y: 0.5, score: 0.99 },
    24: { x: 0.55, y: 0.5, score: 0.99 },
  });
  const result = extractSemanticPosition(kp);
  expect(result.torso).toBe('LEANING');
});

test('horizontal body → torso PRONE', () => {
  const kp = makeKeypoints({
    11: { x: 0.2, y: 0.5, score: 0.99 },
    12: { x: 0.3, y: 0.5, score: 0.99 },
    23: { x: 0.7, y: 0.5, score: 0.99 },
    24: { x: 0.8, y: 0.5, score: 0.99 },
  });
  const result = extractSemanticPosition(kp);
  expect(result.torso).toBe('PRONE');
});
```

**Step 4: Write failing tests for `classifyStance`**

```js
// --- stance state (NEW) ---
test('feet at hip width → stance HIP', () => {
  // Default: ankles at x=[0.45, 0.55], hips at x=[0.45, 0.55] → ratio ~1.0
  const kp = makeKeypoints();
  const result = extractSemanticPosition(kp);
  expect(result.stance).toBe('HIP');
});

test('feet together → stance NARROW', () => {
  const kp = makeKeypoints({
    27: { x: 0.49, y: 0.9, score: 0.9 },  // ankles very close together
    28: { x: 0.51, y: 0.9, score: 0.9 },
  });
  const result = extractSemanticPosition(kp);
  expect(result.stance).toBe('NARROW');
});

test('feet wide apart → stance WIDE', () => {
  const kp = makeKeypoints({
    27: { x: 0.2, y: 0.9, score: 0.9 },   // ankles spread wide
    28: { x: 0.8, y: 0.9, score: 0.9 },
  });
  const result = extractSemanticPosition(kp);
  expect(result.stance).toBe('WIDE');
});
```

**Step 5: Write tests confirming old derived booleans are removed**

```js
// --- removed properties ---
test('does not include old derived booleans', () => {
  const kp = makeKeypoints();
  const result = extractSemanticPosition(kp);
  expect(result).not.toHaveProperty('handsUp');
  expect(result).not.toHaveProperty('bodyUpright');
  expect(result).not.toHaveProperty('bodyProne');
  expect(result).not.toHaveProperty('squatPosition');
  expect(result).not.toHaveProperty('lungePosition');
  expect(result).not.toHaveProperty('leftFoot');
  expect(result).not.toHaveProperty('rightFoot');
});
```

**Step 6: Run tests to verify they fail**

Run: `npx jest tests/isolated/frontend/pose/poseSemantics.unit.test.mjs --no-coverage`
Expected: FAIL — `leftHip`, `rightHip`, `leftShoulder`, `rightShoulder`, `torso`, `stance` properties don't exist yet. Old properties still present.

**Step 7: Commit**

```bash
git add tests/isolated/frontend/pose/poseSemantics.unit.test.mjs
git commit -m "test(pose): add failing tests for new Layer 1 joint classifiers

Hip flexion, shoulder elevation, torso angle, stance width classifiers.
Tests for removal of old derived booleans."
```

---

### Task 2: Write failing tests for Layer 1.5 combo states

**Files:**
- Modify: `tests/isolated/frontend/pose/poseSemantics.unit.test.mjs`

**Step 1: Write failing tests for combo booleans**

Add a new `describe` block for combo states:

```js
describe('Layer 1.5 combo states', () => {
  test('upright combo true when torso UPRIGHT', () => {
    const kp = makeKeypoints();
    const result = extractSemanticPosition(kp);
    expect(result.upright).toBe(true);
  });

  test('prone combo true when torso PRONE', () => {
    const kp = makeKeypoints({
      11: { x: 0.2, y: 0.5, score: 0.99 },
      12: { x: 0.3, y: 0.5, score: 0.99 },
      23: { x: 0.7, y: 0.5, score: 0.99 },
      24: { x: 0.8, y: 0.5, score: 0.99 },
    });
    const result = extractSemanticPosition(kp);
    expect(result.prone).toBe(true);
    expect(result.upright).toBe(false);
  });

  test('squatting true when both hips MID+, both knees MID+, upright, not narrow stance', () => {
    // Deep squat position: knees forward, hips flexed, upright torso, feet at hip width
    const kp = makeKeypoints({
      25: { x: 0.6, y: 0.6, score: 0.9 },   // leftKnee forward (MID angle)
      26: { x: 0.4, y: 0.6, score: 0.9 },   // rightKnee forward (MID angle)
      27: { x: 0.45, y: 0.75, score: 0.9 },  // leftAnkle
      28: { x: 0.55, y: 0.75, score: 0.9 },  // rightAnkle
    });
    const result = extractSemanticPosition(kp);
    expect(result.squatting).toBe(true);
  });

  test('squatting false when sitting (not upright)', () => {
    const kp = makeKeypoints({
      11: { x: 0.2, y: 0.5, score: 0.99 },  // horizontal torso
      12: { x: 0.3, y: 0.5, score: 0.99 },
      23: { x: 0.7, y: 0.5, score: 0.99 },
      24: { x: 0.8, y: 0.5, score: 0.99 },
      25: { x: 0.6, y: 0.6, score: 0.9 },
      26: { x: 0.4, y: 0.6, score: 0.9 },
    });
    const result = extractSemanticPosition(kp);
    expect(result.squatting).toBe(false);
  });

  test('lunging true when one hip MID+ / other LOW with matching knee asymmetry', () => {
    // Left leg forward and bent, right leg straight back
    const kp = makeKeypoints({
      25: { x: 0.6, y: 0.6, score: 0.9 },   // leftKnee forward → MID
      26: { x: 0.55, y: 0.7, score: 0.9 },  // rightKnee straight → LOW
    });
    const result = extractSemanticPosition(kp);
    expect(result.lunging).toBe(true);
  });

  test('lunging false when both knees same state', () => {
    const kp = makeKeypoints();
    const result = extractSemanticPosition(kp);
    expect(result.lunging).toBe(false);
  });

  test('armsOverhead true when both shoulders HIGH', () => {
    const kp = makeKeypoints({
      13: { x: 0.4, y: 0.1, score: 0.9 },
      14: { x: 0.6, y: 0.1, score: 0.9 },
      15: { x: 0.4, y: 0.05, score: 0.9 },
      16: { x: 0.6, y: 0.05, score: 0.9 },
    });
    const result = extractSemanticPosition(kp);
    expect(result.armsOverhead).toBe(true);
  });

  test('armsAtSides true when both shoulders LOW', () => {
    const kp = makeKeypoints();
    const result = extractSemanticPosition(kp);
    expect(result.armsAtSides).toBe(true);
  });

  test('armsExtended true when both elbows LOW (straight)', () => {
    const kp = makeKeypoints();
    const result = extractSemanticPosition(kp);
    expect(result.armsExtended).toBe(true);
  });

  test('wideStance true when stance WIDE', () => {
    const kp = makeKeypoints({
      27: { x: 0.2, y: 0.9, score: 0.9 },
      28: { x: 0.8, y: 0.9, score: 0.9 },
    });
    const result = extractSemanticPosition(kp);
    expect(result.wideStance).toBe(true);
    expect(result.narrowStance).toBe(false);
  });

  test('narrowStance true when stance NARROW or HIP', () => {
    const kp = makeKeypoints();
    const result = extractSemanticPosition(kp);
    expect(result.narrowStance).toBe(true);
    expect(result.wideStance).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx jest tests/isolated/frontend/pose/poseSemantics.unit.test.mjs --no-coverage`
Expected: FAIL — combo properties don't exist yet.

**Step 3: Commit**

```bash
git add tests/isolated/frontend/pose/poseSemantics.unit.test.mjs
git commit -m "test(pose): add failing tests for Layer 1.5 combo states"
```

---

### Task 3: Implement new Layer 1 classifiers in poseSemantics.js

**Files:**
- Modify: `frontend/src/modules/Fitness/lib/pose/poseSemantics.js`

**Step 1: Add `classifyHip` function**

Add after the existing `classifyFoot` function (line ~79):

```js
/** Hip flexion: angle(shoulder, hip, knee). >=160 LOW (standing), 90-160 MID, <90 HIGH */
const classifyHip = (shoulder, hip, knee) => {
  if (!shoulder || !hip || !knee) return null;
  const angle = calculateAngle(shoulder, hip, knee);
  if (angle === 0) return null;
  if (angle >= 160) return 'LOW';
  if (angle >= 90) return 'MID';
  return 'HIGH';
};
```

**Step 2: Add `classifyShoulder` function**

```js
/** Shoulder elevation: angle(hip, shoulder, elbow). <45 LOW (at side), 45-135 MID, >=135 HIGH (overhead) */
const classifyShoulder = (hip, shoulder, elbow) => {
  if (!hip || !shoulder || !elbow) return null;
  const angle = calculateAngle(hip, shoulder, elbow);
  if (angle === 0) return null;
  if (angle >= 135) return 'HIGH';
  if (angle >= 45) return 'MID';
  return 'LOW';
};
```

**Step 3: Replace `deriveBodyUpright` and `deriveBodyProne` with `classifyTorso`**

Remove `deriveBodyUpright` (lines ~86-104) and `deriveBodyProne` (lines ~107-122). Replace with:

```js
/**
 * Torso angle from vertical.
 * Uses shoulder midpoint vs hip midpoint.
 * <30° → UPRIGHT, 30-60° → LEANING, >60° → PRONE.
 */
const classifyTorso = (kp) => {
  const ls = confident(kp[KP.LEFT_SHOULDER]);
  const rs = confident(kp[KP.RIGHT_SHOULDER]);
  const lh = confident(kp[KP.LEFT_HIP]);
  const rh = confident(kp[KP.RIGHT_HIP]);
  if (!ls || !rs || !lh || !rh) return null;

  const shoulderMidX = (ls.x + rs.x) / 2;
  const shoulderMidY = (ls.y + rs.y) / 2;
  const hipMidX = (lh.x + rh.x) / 2;
  const hipMidY = (lh.y + rh.y) / 2;

  const dx = Math.abs(shoulderMidX - hipMidX);
  const dy = Math.abs(shoulderMidY - hipMidY);

  // atan2 gives angle from horizontal; convert to angle from vertical
  const angleFromVertical = Math.atan2(dx, dy) * (180 / Math.PI);

  if (angleFromVertical < 30) return 'UPRIGHT';
  if (angleFromVertical < 60) return 'LEANING';
  return 'PRONE';
};
```

**Step 4: Add `classifyStance` function**

```js
/**
 * Stance width: ankle spread / hip width ratio.
 * <0.8 → NARROW, 0.8-1.3 → HIP, >1.3 → WIDE.
 */
const classifyStance = (kp) => {
  const lAnkle = confident(kp[KP.LEFT_ANKLE]);
  const rAnkle = confident(kp[KP.RIGHT_ANKLE]);
  const lHip = confident(kp[KP.LEFT_HIP]);
  const rHip = confident(kp[KP.RIGHT_HIP]);
  if (!lAnkle || !rAnkle || !lHip || !rHip) return null;

  const hipWidth = Math.abs(lHip.x - rHip.x);
  if (hipWidth < 0.01) return null; // hips too close to measure reliably

  const ankleSpread = Math.abs(lAnkle.x - rAnkle.x);
  const ratio = ankleSpread / hipWidth;

  if (ratio < 0.8) return 'NARROW';
  if (ratio <= 1.3) return 'HIP';
  return 'WIDE';
};
```

**Step 5: Update `extractSemanticPosition` to use new classifiers**

Replace the body of `extractSemanticPosition` starting at the individual joint states section (line ~151). The full function becomes:

```js
export const extractSemanticPosition = (keypoints) => {
  if (!keypoints || !Array.isArray(keypoints) || keypoints.length < 33) return null;

  const lShoulder = confident(keypoints[KP.LEFT_SHOULDER]);
  const rShoulder = confident(keypoints[KP.RIGHT_SHOULDER]);
  const lElbow    = confident(keypoints[KP.LEFT_ELBOW]);
  const rElbow    = confident(keypoints[KP.RIGHT_ELBOW]);
  const lWrist    = confident(keypoints[KP.LEFT_WRIST]);
  const rWrist    = confident(keypoints[KP.RIGHT_WRIST]);
  const lHip      = confident(keypoints[KP.LEFT_HIP]);
  const rHip      = confident(keypoints[KP.RIGHT_HIP]);
  const lKnee     = confident(keypoints[KP.LEFT_KNEE]);
  const rKnee     = confident(keypoints[KP.RIGHT_KNEE]);
  const lAnkle    = confident(keypoints[KP.LEFT_ANKLE]);
  const rAnkle    = confident(keypoints[KP.RIGHT_ANKLE]);

  // --- Layer 1: Individual joint states ---
  const leftHand  = classifyHand(lWrist, lShoulder, lHip);
  const rightHand = classifyHand(rWrist, rShoulder, rHip);
  const leftKnee  = classifyKnee(lHip, lKnee, lAnkle);
  const rightKnee = classifyKnee(rHip, rKnee, rAnkle);
  const leftElbow  = classifyElbow(lShoulder, lElbow, lWrist);
  const rightElbow = classifyElbow(rShoulder, rElbow, rWrist);
  const leftHip    = classifyHip(lShoulder, lHip, lKnee);
  const rightHip   = classifyHip(rShoulder, rHip, rKnee);
  const leftShoulder  = classifyShoulder(lHip, lShoulder, lElbow);
  const rightShoulder = classifyShoulder(rHip, rShoulder, rElbow);
  const torso = classifyTorso(keypoints);
  const stance = classifyStance(keypoints);

  // --- Layer 1.5: Multi-joint combo states ---
  const upright = torso === 'UPRIGHT';
  const prone   = torso === 'PRONE';

  const bentOrDeep = (v) => v === 'MID' || v === 'HIGH';
  const squatting =
    bentOrDeep(leftHip) && bentOrDeep(rightHip) &&
    bentOrDeep(leftKnee) && bentOrDeep(rightKnee) &&
    upright && (stance === 'HIP' || stance === 'WIDE');

  const lunging =
    upright && (
      (bentOrDeep(leftHip) && rightHip === 'LOW' && bentOrDeep(leftKnee) && rightKnee === 'LOW') ||
      (leftHip === 'LOW' && bentOrDeep(rightHip) && leftKnee === 'LOW' && bentOrDeep(rightKnee))
    );

  const armsOverhead = leftShoulder === 'HIGH' && rightShoulder === 'HIGH';
  const armsAtSides  = leftShoulder === 'LOW' && rightShoulder === 'LOW';
  const armsExtended = leftElbow === 'LOW' && rightElbow === 'LOW';
  const wideStance   = stance === 'WIDE';
  const narrowStance = stance === 'NARROW' || stance === 'HIP';

  return {
    // Layer 1: Joint states
    leftHand, rightHand,
    leftElbow, rightElbow,
    leftKnee, rightKnee,
    leftHip, rightHip,
    leftShoulder, rightShoulder,
    torso,
    stance,
    // Layer 1.5: Combo states
    upright, prone,
    squatting, lunging,
    armsOverhead, armsAtSides, armsExtended,
    wideStance, narrowStance,
  };
};
```

**Step 6: Run new Layer 1 and Layer 1.5 tests**

Run: `npx jest tests/isolated/frontend/pose/poseSemantics.unit.test.mjs --no-coverage`
Expected: New tests PASS. Some old tests that reference `handsUp`, `bodyUpright`, `bodyProne`, `squatPosition`, `lungePosition`, `leftFoot`, `rightFoot` will FAIL — that's expected and fixed in the next task.

**Step 7: Commit**

```bash
git add frontend/src/modules/Fitness/lib/pose/poseSemantics.js
git commit -m "feat(pose): implement new Layer 1 classifiers and Layer 1.5 combos

Add classifyHip, classifyShoulder, classifyTorso, classifyStance.
Remove old derived booleans (handsUp, bodyUpright, bodyProne, etc.).
Add combo states: upright, prone, squatting, lunging, armsOverhead,
armsAtSides, armsExtended, wideStance, narrowStance."
```

---

### Task 4: Update old tests to match new API

**Files:**
- Modify: `tests/isolated/frontend/pose/poseSemantics.unit.test.mjs`

**Step 1: Remove tests for deleted properties**

Delete these test blocks:
- `handsUp true when both hands HIGH` and `handsUp false when only one hand HIGH`
- `armsExtended true/false` (moved to Layer 1.5 combo tests which already cover this)
- `squatPosition true/false` tests
- `lungePosition true/false` tests
- `bodyUpright true/false` tests
- `bodyProne true/false` tests
- All `leftFoot`/`rightFoot` tests

**Step 2: Update hysteresis tests**

In the `createSemanticExtractor (hysteresis)` describe block:

- Update `returns same shape as extractSemanticPosition` to check for new properties:

```js
test('returns same shape as extractSemanticPosition', () => {
  const extractor = createSemanticExtractor();
  const kp = makeKeypoints();
  const pos = extractor(kp, 1000);
  expect(pos).toHaveProperty('leftHand');
  expect(pos).toHaveProperty('leftHip');
  expect(pos).toHaveProperty('leftShoulder');
  expect(pos).toHaveProperty('torso');
  expect(pos).toHaveProperty('stance');
  expect(pos).toHaveProperty('upright');
  expect(pos).toHaveProperty('squatting');
});
```

- Update `derived booleans update based on stabilized limb states` — replace `handsUp` with `armsOverhead`:

```js
test('combo states update based on stabilized limb states', () => {
  const extractor = createSemanticExtractor();
  const kpDown = makeKeypoints();
  extractor(kpDown, 1000);

  // Raise arms overhead
  const kpUp = makeKeypoints({
    13: { x: 0.4, y: 0.1, score: 0.9 },
    14: { x: 0.6, y: 0.1, score: 0.9 },
    15: { x: 0.4, y: 0.05, score: 0.9 },
    16: { x: 0.6, y: 0.05, score: 0.9 },
  });

  // During minHold — armsOverhead should still be false
  const pos1 = extractor(kpUp, 1030);
  expect(pos1.armsOverhead).toBe(false);

  // After minHold — armsOverhead should be true
  const pos2 = extractor(kpUp, 1200);
  expect(pos2.armsOverhead).toBe(true);
});
```

**Step 3: Run all poseSemantics tests**

Run: `npx jest tests/isolated/frontend/pose/poseSemantics.unit.test.mjs --no-coverage`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add tests/isolated/frontend/pose/poseSemantics.unit.test.mjs
git commit -m "test(pose): update poseSemantics tests for new API

Remove tests for deleted properties (handsUp, bodyUpright, etc.).
Update hysteresis tests to use new combo states."
```

---

### Task 5: Update hysteresis wrapper for new properties

**Files:**
- Modify: `frontend/src/modules/Fitness/lib/pose/poseSemantics.js`

**Step 1: Update `DEFAULT_HYSTERESIS` and `LIMB_KEYS`**

Replace the existing `DEFAULT_HYSTERESIS` block (lines ~205-214):

```js
const DEFAULT_HYSTERESIS = {
  leftHand:      { minHoldMs: 80 },
  rightHand:     { minHoldMs: 80 },
  leftElbow:     { minHoldMs: 80 },
  rightElbow:    { minHoldMs: 80 },
  leftKnee:      { minHoldMs: 120 },
  rightKnee:     { minHoldMs: 120 },
  leftHip:       { minHoldMs: 120 },
  rightHip:      { minHoldMs: 120 },
  leftShoulder:  { minHoldMs: 80 },
  rightShoulder: { minHoldMs: 80 },
  torso:         { minHoldMs: 150 },
  stance:        { minHoldMs: 100 },
};
```

**Step 2: Update the `createSemanticExtractor` combo recomputation**

In the `createSemanticExtractor` function, replace the section that recomputes derived booleans from stabilized states (lines ~277-297). The new code recomputes combos from stabilized values:

```js
    // Recompute combo booleans from stabilized joint states
    const upright = stabilized.torso === 'UPRIGHT';
    const prone   = stabilized.torso === 'PRONE';

    const bentOrDeep = (v) => v === 'MID' || v === 'HIGH';
    const squatting =
      bentOrDeep(stabilized.leftHip) && bentOrDeep(stabilized.rightHip) &&
      bentOrDeep(stabilized.leftKnee) && bentOrDeep(stabilized.rightKnee) &&
      upright && (stabilized.stance === 'HIP' || stabilized.stance === 'WIDE');

    const lunging =
      upright && (
        (bentOrDeep(stabilized.leftHip) && stabilized.rightHip === 'LOW' &&
         bentOrDeep(stabilized.leftKnee) && stabilized.rightKnee === 'LOW') ||
        (stabilized.leftHip === 'LOW' && bentOrDeep(stabilized.rightHip) &&
         stabilized.leftKnee === 'LOW' && bentOrDeep(stabilized.rightKnee))
      );

    const armsOverhead = stabilized.leftShoulder === 'HIGH' && stabilized.rightShoulder === 'HIGH';
    const armsAtSides  = stabilized.leftShoulder === 'LOW' && stabilized.rightShoulder === 'LOW';
    const armsExtended = stabilized.leftElbow === 'LOW' && stabilized.rightElbow === 'LOW';
    const wideStance   = stabilized.stance === 'WIDE';
    const narrowStance = stabilized.stance === 'NARROW' || stabilized.stance === 'HIP';

    return {
      ...stabilized,
      upright, prone,
      squatting, lunging,
      armsOverhead, armsAtSides, armsExtended,
      wideStance, narrowStance,
    };
```

**Step 3: Run all poseSemantics tests**

Run: `npx jest tests/isolated/frontend/pose/poseSemantics.unit.test.mjs --no-coverage`
Expected: ALL PASS (including hysteresis tests)

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/lib/pose/poseSemantics.js
git commit -m "feat(pose): update hysteresis wrapper for new joint and combo properties"
```

---

### Task 6: Update poseActions tests with new pattern shapes

**Files:**
- Modify: `tests/isolated/frontend/pose/poseActions.unit.test.mjs`

**Step 1: Update exercise pattern definitions and test data**

Replace the `JUMPING_JACK` and `PLANK` constants at the top:

```js
const JUMPING_JACK = {
  id: 'jumping-jack',
  name: 'Jumping Jack',
  phases: [
    { name: 'open',   match: { armsOverhead: true, wideStance: true } },
    { name: 'closed', match: { armsAtSides: true, narrowStance: true, upright: true } },
  ],
  timing: {
    minCycleMs: 400,
    maxCycleMs: 3000,
    maxPhaseMs: 2000,
  },
};

const PLANK = {
  id: 'plank',
  name: 'Plank',
  sustain: { prone: true, armsExtended: true },
  timing: { gracePeriodMs: 500 },
};
```

**Step 2: Update test position data to use new property names**

Go through each test and replace old property references:
- `{ handsUp: true }` → `{ armsOverhead: true, wideStance: true }` (for jack open)
- `{ handsUp: false }` → `{ armsAtSides: true, narrowStance: true, upright: true }` (for jack closed)
- `{ bodyProne: true, armsExtended: true }` → `{ prone: true, armsExtended: true }` (for plank)
- `{ bodyProne: false, armsExtended: true }` → `{ prone: false, armsExtended: true }` (not in plank)

**Step 3: Run poseActions tests**

Run: `npx jest tests/isolated/frontend/pose/poseActions.unit.test.mjs --no-coverage`
Expected: ALL PASS (poseActions.js itself doesn't change — only the test data changes)

**Step 4: Commit**

```bash
git add tests/isolated/frontend/pose/poseActions.unit.test.mjs
git commit -m "test(pose): update poseActions tests with new exercise pattern shapes"
```

---

### Task 7: Update SemanticMoveDetector tests

**Files:**
- Modify: `tests/isolated/frontend/pose/SemanticMoveDetector.unit.test.mjs`

**Step 1: Update SQUAT_PATTERN**

Replace the `SQUAT_PATTERN` constant:

```js
const SQUAT_PATTERN = {
  id: 'squat',
  name: 'Squat',
  phases: [
    { name: 'down', match: { squatting: true } },
    { name: 'up',   match: { squatting: false, upright: true, narrowStance: true } },
  ],
  timing: { minCycleMs: 800, maxCycleMs: 5000 },
};
```

**Step 2: Run SemanticMoveDetector tests**

Run: `npx jest tests/isolated/frontend/pose/SemanticMoveDetector.unit.test.mjs --no-coverage`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add tests/isolated/frontend/pose/SemanticMoveDetector.unit.test.mjs
git commit -m "test(pose): update SemanticMoveDetector tests with new squat pattern"
```

---

### Task 8: Update integration test

**Files:**
- Modify: `tests/isolated/frontend/pose/poseSemantics.integration.test.mjs`

**Step 1: Update property validation**

Replace the old property checks in the integration test:

```js
test('extractSemanticPosition produces valid output for all frames', () => {
  if (!frames) return;
  let validCount = 0;
  for (const frame of frames) {
    const pos = extractSemanticPosition(frame.keypoints);
    if (pos) {
      validCount++;
      // Layer 1: limb properties should be LOW/MID/HIGH or null
      for (const prop of ['leftHand', 'rightHand', 'leftKnee', 'rightKnee',
                           'leftHip', 'rightHip', 'leftElbow', 'rightElbow',
                           'leftShoulder', 'rightShoulder']) {
        expect([null, 'LOW', 'MID', 'HIGH']).toContain(pos[prop]);
      }
      // Torso should be UPRIGHT/LEANING/PRONE or null
      expect([null, 'UPRIGHT', 'LEANING', 'PRONE']).toContain(pos.torso);
      // Stance should be NARROW/HIP/WIDE or null
      expect([null, 'NARROW', 'HIP', 'WIDE']).toContain(pos.stance);
      // Combos should be booleans
      for (const prop of ['upright', 'prone', 'squatting', 'lunging',
                           'armsOverhead', 'armsAtSides', 'armsExtended',
                           'wideStance', 'narrowStance']) {
        expect(typeof pos[prop]).toBe('boolean');
      }
    }
  }
  expect(validCount).toBeGreaterThan(frames.length * 0.5);
});
```

**Step 2: Update hysteresis transition tracking**

Replace the `leftKnee` in the hysteresis tests with new properties that include the new joints:

```js
for (const prop of ['leftHand', 'rightHand', 'leftKnee', 'rightKnee',
                     'leftHip', 'rightHip', 'leftShoulder', 'rightShoulder']) {
  if (pos[prop] !== prevPos[prop]) transitions++;
}
```

Use the same expanded property list in both `createSemanticExtractor produces stable output` and `hysteresis produces fewer transitions than raw extraction` tests.

**Step 3: Run integration test**

Run: `npx jest tests/isolated/frontend/pose/poseSemantics.integration.test.mjs --no-coverage`
Expected: PASS (or skip gracefully if pose log data isn't available)

**Step 4: Commit**

```bash
git add tests/isolated/frontend/pose/poseSemantics.integration.test.mjs
git commit -m "test(pose): update integration test for new semantic position API"
```

---

### Task 9: Run all pose tests together

**Files:** None (verification only)

**Step 1: Run all four test files**

Run: `npx jest tests/isolated/frontend/pose/ --no-coverage`
Expected: ALL PASS

**Step 2: Verify no other tests break**

Run: `npx jest --no-coverage`
Expected: ALL PASS (no other code imports the removed properties — the barrel export at `frontend/src/modules/Fitness/lib/pose/index.js` doesn't change since it re-exports everything from poseSemantics.js)

---

### Task 10: Update reference documentation

**Files:**
- Modify: `docs/reference/fitness/semantic-pose-pipeline.md`

**Step 1: Rewrite the reference doc**

Update the Layer 1 section to reflect the new joint states (leftHip/rightHip, leftShoulder/rightShoulder, torso, stance). Remove the old Derived Booleans section. Add a new Layer 1.5 section documenting all 9 combo states. Update the Layer 2 exercise examples (jumping jack, squat, lunge, push-up, plank, burpee) to use the new pattern shapes. Update the output shape example. Update the hysteresis table with new properties and their minHoldMs values.

**Step 2: Commit**

```bash
git add docs/reference/fitness/semantic-pose-pipeline.md
git commit -m "docs(pose): update semantic pose pipeline reference for redesign"
```
