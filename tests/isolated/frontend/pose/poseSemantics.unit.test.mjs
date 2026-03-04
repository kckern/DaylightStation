import { extractSemanticPosition, createSemanticExtractor } from '../../../../frontend/src/modules/Fitness/lib/pose/poseSemantics.js';

/**
 * Build synthetic BlazePose keypoints (normalized 0-1 coords, y increases downward).
 * Only specify the indices you want to override; everything else gets sensible defaults.
 */
const makeKeypoints = (overrides = {}) => {
  const defaults = {
    0:  { x: 0.5, y: 0.1, score: 0.99 },   // nose (top)
    11: { x: 0.4, y: 0.3, score: 0.99 },   // leftShoulder
    12: { x: 0.6, y: 0.3, score: 0.99 },   // rightShoulder
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

  // --- null / invalid input ---
  test('null keypoints returns null', () => {
    expect(extractSemanticPosition(null)).toBeNull();
  });

  test('empty array returns null', () => {
    expect(extractSemanticPosition([])).toBeNull();
  });

  test('too-short array returns null', () => {
    expect(extractSemanticPosition(new Array(10).fill({ x: 0, y: 0, z: 0, score: 0 }))).toBeNull();
  });

  // --- low confidence ---
  test('low-confidence keypoints produce null for affected properties', () => {
    const kp = makeKeypoints({
      15: { x: 0.35, y: 0.6, score: 0.1 },  // leftWrist below threshold
      16: { x: 0.65, y: 0.6, score: 0.1 },  // rightWrist below threshold
    });
    const result = extractSemanticPosition(kp);
    expect(result).not.toBeNull();
    expect(result.leftHand).toBeNull();
    expect(result.rightHand).toBeNull();
  });

  // --- hand positions ---
  test('standing with arms at sides → both hands LOW', () => {
    const kp = makeKeypoints(); // default: wrists at y=0.6, hips at y=0.5
    const result = extractSemanticPosition(kp);
    expect(result.leftHand).toBe('LOW');
    expect(result.rightHand).toBe('LOW');
  });

  test('hands raised above shoulders → both hands HIGH', () => {
    const kp = makeKeypoints({
      15: { x: 0.35, y: 0.15, score: 0.9 },  // leftWrist above shoulders (y=0.3)
      16: { x: 0.65, y: 0.15, score: 0.9 },  // rightWrist above shoulders
    });
    const result = extractSemanticPosition(kp);
    expect(result.leftHand).toBe('HIGH');
    expect(result.rightHand).toBe('HIGH');
  });

  test('hands at chest height → both hands MID', () => {
    const kp = makeKeypoints({
      15: { x: 0.35, y: 0.4, score: 0.9 },   // leftWrist between shoulder (0.3) and hip (0.5)
      16: { x: 0.65, y: 0.4, score: 0.9 },   // rightWrist between shoulder and hip
    });
    const result = extractSemanticPosition(kp);
    expect(result.leftHand).toBe('MID');
    expect(result.rightHand).toBe('MID');
  });

  // --- knee states ---
  test('standing straight → both knees LOW (straight leg)', () => {
    // Default keypoints: hip(0.5) -> knee(0.7) -> ankle(0.9) forms ~180 degree angle
    const kp = makeKeypoints();
    const result = extractSemanticPosition(kp);
    expect(result.leftKnee).toBe('LOW');
    expect(result.rightKnee).toBe('LOW');
  });

  test('partially bent knees → both knees MID', () => {
    // Offset knee x to create ~127° angle (between 90-160)
    const kp = makeKeypoints({
      25: { x: 0.55, y: 0.7, score: 0.9 },   // leftKnee shifted right
      26: { x: 0.45, y: 0.7, score: 0.9 },   // rightKnee shifted left
      27: { x: 0.45, y: 0.9, score: 0.9 },   // leftAnkle
      28: { x: 0.55, y: 0.9, score: 0.9 },   // rightAnkle
    });
    const result = extractSemanticPosition(kp);
    expect(result.leftKnee).toBe('MID');
    expect(result.rightKnee).toBe('MID');
  });

  test('deeply bent knees → both knees HIGH', () => {
    // Knee far forward, ankle near hip height → very acute angle (<90°)
    const kp = makeKeypoints({
      25: { x: 0.65, y: 0.65, score: 0.9 },  // leftKnee far forward
      26: { x: 0.35, y: 0.65, score: 0.9 },  // rightKnee far forward
      27: { x: 0.45, y: 0.6, score: 0.9 },   // leftAnkle near hip height
      28: { x: 0.55, y: 0.6, score: 0.9 },   // rightAnkle near hip height
    });
    const result = extractSemanticPosition(kp);
    expect(result.leftKnee).toBe('HIGH');
    expect(result.rightKnee).toBe('HIGH');
  });

  // --- elbow states ---
  test('arms straight at sides → both elbows LOW', () => {
    // Default pose: shoulder->elbow->wrist nearly collinear (~162°)
    const kp = makeKeypoints();
    const result = extractSemanticPosition(kp);
    expect(result.leftElbow).toBe('LOW');
    expect(result.rightElbow).toBe('LOW');
  });

  test('arms bent at ~90° → both elbows MID', () => {
    // Elbow below shoulder, wrist out to the side (~104°, between 80-150)
    const kp = makeKeypoints({
      13: { x: 0.35, y: 0.5, score: 0.9 },   // leftElbow lower
      14: { x: 0.65, y: 0.5, score: 0.9 },   // rightElbow lower
      15: { x: 0.2, y: 0.5, score: 0.9 },    // leftWrist out to side
      16: { x: 0.8, y: 0.5, score: 0.9 },    // rightWrist out to side
    });
    const result = extractSemanticPosition(kp);
    expect(result.leftElbow).toBe('MID');
    expect(result.rightElbow).toBe('MID');
  });

  test('arms tightly folded → both elbows HIGH', () => {
    // Bicep-curl top position: wrist back near shoulder (~56°, <80)
    const kp = makeKeypoints({
      13: { x: 0.4, y: 0.5, score: 0.9 },    // leftElbow straight below shoulder
      14: { x: 0.6, y: 0.5, score: 0.9 },    // rightElbow straight below shoulder
      15: { x: 0.55, y: 0.4, score: 0.9 },   // leftWrist folded back inward
      16: { x: 0.45, y: 0.4, score: 0.9 },   // rightWrist folded back inward
    });
    const result = extractSemanticPosition(kp);
    expect(result.leftElbow).toBe('HIGH');
    expect(result.rightElbow).toBe('HIGH');
  });

  // =========================================================================
  // Layer 1 new joint classifiers (TDD — these should FAIL until implemented)
  // =========================================================================

  // --- hip flexion: angle(shoulder, hip, knee) ---
  // LOW >= 160°, MID 90-160°, HIGH < 90°
  describe('hip flexion (leftHip / rightHip)', () => {
    test('standing straight (default) → both hips LOW (angle ~166°, ≥160°)', () => {
      // Default: shoulder(0.4,0.3) hip(0.45,0.5) knee(0.45,0.7) → ~166°
      const kp = makeKeypoints();
      const result = extractSemanticPosition(kp);
      expect(result.leftHip).toBe('LOW');
      expect(result.rightHip).toBe('LOW');
    });

    test('partial hip flexion (knees forward) → both hips MID (angle ~121°, 90-160°)', () => {
      // Knee pushed forward: angle(shoulder, hip, knee) drops to ~121°
      const kp = makeKeypoints({
        25: { x: 0.3, y: 0.65, score: 0.9 },   // leftKnee forward
        26: { x: 0.7, y: 0.65, score: 0.9 },   // rightKnee forward (mirrored)
        27: { x: 0.3, y: 0.9, score: 0.9 },    // leftAnkle
        28: { x: 0.7, y: 0.9, score: 0.9 },    // rightAnkle
      });
      const result = extractSemanticPosition(kp);
      expect(result.leftHip).toBe('MID');
      expect(result.rightHip).toBe('MID');
    });

    test('deep hip flexion (knees at chest) → both hips HIGH (angle ~70°, <90°)', () => {
      // Knee raised near chest: angle(shoulder, hip, knee) drops to ~70°
      const kp = makeKeypoints({
        25: { x: 0.6, y: 0.4, score: 0.9 },    // leftKnee up near chest
        26: { x: 0.4, y: 0.4, score: 0.9 },    // rightKnee up near chest (mirrored)
        27: { x: 0.6, y: 0.6, score: 0.9 },    // leftAnkle
        28: { x: 0.4, y: 0.6, score: 0.9 },    // rightAnkle
      });
      const result = extractSemanticPosition(kp);
      expect(result.leftHip).toBe('HIGH');
      expect(result.rightHip).toBe('HIGH');
    });
  });

  // --- shoulder elevation: angle(hip, shoulder, elbow) ---
  // LOW < 45°, MID 45-135°, HIGH >= 135°
  describe('shoulder elevation (leftShoulder / rightShoulder)', () => {
    test('arms at sides (default) → both shoulders LOW (angle ~32°, <45°)', () => {
      // Default: hip(0.45,0.5) shoulder(0.4,0.3) elbow(0.35,0.45) → ~32°
      const kp = makeKeypoints();
      const result = extractSemanticPosition(kp);
      expect(result.leftShoulder).toBe('LOW');
      expect(result.rightShoulder).toBe('LOW');
    });

    test('arms raised laterally → both shoulders MID (angle ~104°, 45-135°)', () => {
      // Elbow extended laterally at shoulder height
      const kp = makeKeypoints({
        13: { x: 0.15, y: 0.3, score: 0.9 },   // leftElbow out to side
        14: { x: 0.85, y: 0.3, score: 0.9 },   // rightElbow out to side
        15: { x: 0.0, y: 0.3, score: 0.9 },    // leftWrist extended
        16: { x: 1.0, y: 0.3, score: 0.9 },    // rightWrist extended
      });
      const result = extractSemanticPosition(kp);
      expect(result.leftShoulder).toBe('MID');
      expect(result.rightShoulder).toBe('MID');
    });

    test('arms overhead → both shoulders HIGH (angle ~166°, ≥135°)', () => {
      // Elbow above head
      const kp = makeKeypoints({
        13: { x: 0.4, y: 0.1, score: 0.9 },    // leftElbow overhead
        14: { x: 0.6, y: 0.1, score: 0.9 },    // rightElbow overhead
        15: { x: 0.4, y: 0.0, score: 0.9 },    // leftWrist above head
        16: { x: 0.6, y: 0.0, score: 0.9 },    // rightWrist above head
      });
      const result = extractSemanticPosition(kp);
      expect(result.leftShoulder).toBe('HIGH');
      expect(result.rightShoulder).toBe('HIGH');
    });
  });

  // --- torso: angle from vertical using shoulder/hip midpoints ---
  // UPRIGHT < 30°, LEANING 30-60°, PRONE > 60°
  describe('torso classification', () => {
    test('standing straight → torso UPRIGHT (<30° from vertical)', () => {
      // Default: shoulderMid(0.5,0.3) hipMid(0.5,0.5) → 0° from vertical
      const kp = makeKeypoints();
      const result = extractSemanticPosition(kp);
      expect(result.torso).toBe('UPRIGHT');
    });

    test('leaning forward ~45° → torso LEANING (30-60°)', () => {
      // Shift shoulders forward: shoulderMid(0.7,0.3) hipMid(0.5,0.5)
      // dx=0.2, dy=0.2 → atan2(0.2,0.2) = 45°
      const kp = makeKeypoints({
        11: { x: 0.6, y: 0.3, score: 0.99 },   // leftShoulder shifted right
        12: { x: 0.8, y: 0.3, score: 0.99 },   // rightShoulder shifted right
      });
      const result = extractSemanticPosition(kp);
      expect(result.torso).toBe('LEANING');
    });

    test('horizontal (plank/lying) → torso PRONE (>60°)', () => {
      // Shoulders and hips at nearly same Y, spread horizontally
      // shoulderMid(0.25,0.48) hipMid(0.75,0.5) → dx=0.5, dy=0.02 → ~88°
      const kp = makeKeypoints({
        11: { x: 0.2, y: 0.48, score: 0.99 },  // leftShoulder far left
        12: { x: 0.3, y: 0.48, score: 0.99 },  // rightShoulder
        23: { x: 0.7, y: 0.5, score: 0.99 },   // leftHip far right
        24: { x: 0.8, y: 0.5, score: 0.99 },   // rightHip
      });
      const result = extractSemanticPosition(kp);
      expect(result.torso).toBe('PRONE');
    });
  });

  // --- stance: ankle spread / hip width ratio ---
  // NARROW < 0.8, HIP 0.8-1.3, WIDE > 1.3
  describe('stance classification', () => {
    test('feet at hip width (default) → stance HIP (ratio 1.0, 0.8-1.3)', () => {
      // Default: ankles(0.45,0.55) spread=0.1, hips(0.45,0.55) width=0.1 → ratio=1.0
      const kp = makeKeypoints();
      const result = extractSemanticPosition(kp);
      expect(result.stance).toBe('HIP');
    });

    test('feet together → stance NARROW (ratio ~0.2, <0.8)', () => {
      // Ankles very close together
      const kp = makeKeypoints({
        27: { x: 0.49, y: 0.9, score: 0.9 },   // leftAnkle near center
        28: { x: 0.51, y: 0.9, score: 0.9 },   // rightAnkle near center
      });
      const result = extractSemanticPosition(kp);
      expect(result.stance).toBe('NARROW');
    });

    test('feet wide apart → stance WIDE (ratio 3.0, >1.3)', () => {
      // Ankles spread far apart
      const kp = makeKeypoints({
        27: { x: 0.35, y: 0.9, score: 0.9 },   // leftAnkle far left
        28: { x: 0.65, y: 0.9, score: 0.9 },   // rightAnkle far right
      });
      const result = extractSemanticPosition(kp);
      expect(result.stance).toBe('WIDE');
    });
  });

  // --- removed properties: confirm these are gone ---
  describe('removed properties', () => {
    test('handsUp, bodyUpright, bodyProne, squatPosition, lungePosition, leftFoot, rightFoot are absent', () => {
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
  });
});

describe('createSemanticExtractor (hysteresis)', () => {
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

  test('does not thrash on boundary — holds previous state within minHold', () => {
    const extractor = createSemanticExtractor();
    // First call: hands clearly LOW (wrist y=0.6, below hip y=0.5)
    const kp1 = makeKeypoints({
      15: { x: 0.35, y: 0.6, score: 0.9 },
    });
    const pos1 = extractor(kp1, 1000);
    expect(pos1.leftHand).toBe('LOW');

    // Second call: hand moves to MID (y=0.4, between shoulder 0.3 and hip 0.5)
    // But only 30ms later — within minHoldMs (80ms default)
    const kp2 = makeKeypoints({
      15: { x: 0.35, y: 0.4, score: 0.9 },
    });
    const pos2 = extractor(kp2, 1030);
    expect(pos2.leftHand).toBe('LOW');  // held by minHold
  });

  test('transitions after sustained clear crossing beyond minHold', () => {
    const extractor = createSemanticExtractor();
    // Start LOW
    const kpLow = makeKeypoints({
      15: { x: 0.35, y: 0.6, score: 0.9 },
    });
    extractor(kpLow, 1000);

    // Move clearly into MID
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

    // Wait past minHold — should still be LOW (bounce cancelled)
    const pos = extractor(kpLow, 1200);
    expect(pos.leftHand).toBe('LOW');
  });

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

    const pos1 = extractor(kpUp, 1030);
    expect(pos1.armsOverhead).toBe(false);

    const pos2 = extractor(kpUp, 1200);
    expect(pos2.armsOverhead).toBe(true);
  });
});

// ===========================================================================
// Layer 1.5 combo states (TDD — these should FAIL until implemented)
// ===========================================================================
// These are boolean combos derived from Layer 1 classifiers, returned as
// properties of the extractSemanticPosition result object.
// ===========================================================================

describe('Layer 1.5 combo states', () => {

  // --- upright / prone ---
  test('upright is true when torso === UPRIGHT', () => {
    // Default standing pose → torso UPRIGHT
    const kp = makeKeypoints();
    const result = extractSemanticPosition(kp);
    expect(result.upright).toBe(true);
  });

  test('upright is false when torso !== UPRIGHT', () => {
    // Prone pose: shoulders and hips nearly same Y, spread horizontally
    const kp = makeKeypoints({
      11: { x: 0.2, y: 0.48, score: 0.99 },
      12: { x: 0.3, y: 0.48, score: 0.99 },
      23: { x: 0.7, y: 0.5, score: 0.99 },
      24: { x: 0.8, y: 0.5, score: 0.99 },
    });
    const result = extractSemanticPosition(kp);
    expect(result.upright).toBe(false);
  });

  test('prone is true when torso === PRONE', () => {
    const kp = makeKeypoints({
      11: { x: 0.2, y: 0.48, score: 0.99 },
      12: { x: 0.3, y: 0.48, score: 0.99 },
      23: { x: 0.7, y: 0.5, score: 0.99 },
      24: { x: 0.8, y: 0.5, score: 0.99 },
    });
    const result = extractSemanticPosition(kp);
    expect(result.prone).toBe(true);
  });

  test('prone is false when torso === UPRIGHT', () => {
    const kp = makeKeypoints();
    const result = extractSemanticPosition(kp);
    expect(result.prone).toBe(false);
  });

  // --- squatting ---
  test('squatting is true when both hips MID+, both knees MID+, upright, stance HIP or WIDE', () => {
    // Squat pose: knees forward, hips flexed, torso upright, feet at hip width
    // Hip angles ~132° (MID), knee angles ~125° (MID), torso upright (0°), stance ratio 1.0 (HIP)
    const kp = makeKeypoints({
      25: { x: 0.35, y: 0.65, score: 0.9 },   // leftKnee forward
      26: { x: 0.65, y: 0.65, score: 0.9 },   // rightKnee forward
    });
    const result = extractSemanticPosition(kp);
    expect(result.squatting).toBe(true);
  });

  test('squatting is false when not upright (sitting with forward lean)', () => {
    // Same knee/hip flexion but torso leaning forward (>30° from vertical)
    // Shift shoulders forward: shoulderMid(0.7,0.3) vs hipMid(0.5,0.5) → 45° lean
    const kp = makeKeypoints({
      11: { x: 0.6, y: 0.3, score: 0.99 },   // shoulders shifted forward
      12: { x: 0.8, y: 0.3, score: 0.99 },
      25: { x: 0.35, y: 0.65, score: 0.9 },   // knees forward (MID)
      26: { x: 0.65, y: 0.65, score: 0.9 },
    });
    const result = extractSemanticPosition(kp);
    expect(result.squatting).toBe(false);
  });

  // --- lunging ---
  test('lunging is true when one hip MID/other LOW with matching knee asymmetry, upright', () => {
    // Left leg forward (hip MID ~121°, knee MID ~104°), right leg back (hip LOW ~166°, knee LOW 180°)
    const kp = makeKeypoints({
      25: { x: 0.3, y: 0.65, score: 0.9 },    // leftKnee forward → MID
      26: { x: 0.55, y: 0.7, score: 0.9 },    // rightKnee straight → LOW
    });
    const result = extractSemanticPosition(kp);
    expect(result.lunging).toBe(true);
  });

  test('lunging is false when both knees same state', () => {
    // Default standing: both knees LOW, both hips LOW
    const kp = makeKeypoints();
    const result = extractSemanticPosition(kp);
    expect(result.lunging).toBe(false);
  });

  // --- armsOverhead ---
  test('armsOverhead is true when both shoulders HIGH', () => {
    // Elbows overhead: shoulder elevation angle ~166° (>=135°)
    const kp = makeKeypoints({
      13: { x: 0.4, y: 0.1, score: 0.9 },    // leftElbow overhead
      14: { x: 0.6, y: 0.1, score: 0.9 },    // rightElbow overhead
      15: { x: 0.4, y: 0.0, score: 0.9 },    // leftWrist above head
      16: { x: 0.6, y: 0.0, score: 0.9 },    // rightWrist above head
    });
    const result = extractSemanticPosition(kp);
    expect(result.armsOverhead).toBe(true);
  });

  test('armsOverhead is false when shoulders not both HIGH', () => {
    // Default arms at sides: shoulder elevation ~32° (LOW)
    const kp = makeKeypoints();
    const result = extractSemanticPosition(kp);
    expect(result.armsOverhead).toBe(false);
  });

  // --- armsAtSides ---
  test('armsAtSides is true when both shoulders LOW', () => {
    // Default pose: shoulder elevation ~32° (<45°) → LOW
    const kp = makeKeypoints();
    const result = extractSemanticPosition(kp);
    expect(result.armsAtSides).toBe(true);
  });

  test('armsAtSides is false when shoulders not both LOW', () => {
    // Arms raised laterally: shoulder elevation ~104° (MID)
    const kp = makeKeypoints({
      13: { x: 0.15, y: 0.3, score: 0.9 },
      14: { x: 0.85, y: 0.3, score: 0.9 },
      15: { x: 0.0, y: 0.3, score: 0.9 },
      16: { x: 1.0, y: 0.3, score: 0.9 },
    });
    const result = extractSemanticPosition(kp);
    expect(result.armsAtSides).toBe(false);
  });

  // --- armsExtended ---
  test('armsExtended is true when both elbows LOW (straight arms)', () => {
    // Default pose: elbow angle ~162° (>=150°) → LOW
    const kp = makeKeypoints();
    const result = extractSemanticPosition(kp);
    expect(result.armsExtended).toBe(true);
  });

  test('armsExtended is false when elbows bent', () => {
    // Elbows at ~104° (MID)
    const kp = makeKeypoints({
      13: { x: 0.35, y: 0.5, score: 0.9 },
      14: { x: 0.65, y: 0.5, score: 0.9 },
      15: { x: 0.2, y: 0.5, score: 0.9 },
      16: { x: 0.8, y: 0.5, score: 0.9 },
    });
    const result = extractSemanticPosition(kp);
    expect(result.armsExtended).toBe(false);
  });

  // --- wideStance ---
  test('wideStance is true when stance WIDE', () => {
    const kp = makeKeypoints({
      27: { x: 0.35, y: 0.9, score: 0.9 },   // ankles spread wide (ratio 3.0)
      28: { x: 0.65, y: 0.9, score: 0.9 },
    });
    const result = extractSemanticPosition(kp);
    expect(result.wideStance).toBe(true);
  });

  test('wideStance is false when stance HIP', () => {
    const kp = makeKeypoints();
    const result = extractSemanticPosition(kp);
    expect(result.wideStance).toBe(false);
  });

  // --- narrowStance ---
  test('narrowStance is true when stance NARROW', () => {
    const kp = makeKeypoints({
      27: { x: 0.49, y: 0.9, score: 0.9 },   // feet together (ratio ~0.2)
      28: { x: 0.51, y: 0.9, score: 0.9 },
    });
    const result = extractSemanticPosition(kp);
    expect(result.narrowStance).toBe(true);
  });

  test('narrowStance is true when stance HIP', () => {
    // HIP width is considered narrow (not wide)
    const kp = makeKeypoints();
    const result = extractSemanticPosition(kp);
    expect(result.narrowStance).toBe(true);
  });

  test('narrowStance is false when stance WIDE', () => {
    const kp = makeKeypoints({
      27: { x: 0.35, y: 0.9, score: 0.9 },
      28: { x: 0.65, y: 0.9, score: 0.9 },
    });
    const result = extractSemanticPosition(kp);
    expect(result.narrowStance).toBe(false);
  });
});
