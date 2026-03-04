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

  // --- derived: handsUp ---
  test('handsUp true when both hands HIGH', () => {
    const kp = makeKeypoints({
      15: { x: 0.35, y: 0.15, score: 0.9 },
      16: { x: 0.65, y: 0.15, score: 0.9 },
    });
    const result = extractSemanticPosition(kp);
    expect(result.handsUp).toBe(true);
  });

  test('handsUp false when only one hand HIGH', () => {
    const kp = makeKeypoints({
      15: { x: 0.35, y: 0.15, score: 0.9 },  // left HIGH
      16: { x: 0.65, y: 0.6, score: 0.9 },   // right LOW
    });
    const result = extractSemanticPosition(kp);
    expect(result.handsUp).toBe(false);
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

  // --- foot states ---
  test('standing normally → both feet LOW', () => {
    // Default: ankle well below hip → LOW
    const kp = makeKeypoints();
    const result = extractSemanticPosition(kp);
    expect(result.leftFoot).toBe('LOW');
    expect(result.rightFoot).toBe('LOW');
  });

  test('feet raised above knees → both feet HIGH', () => {
    // Ankle above knee in y (foot lifted high, e.g., leg raise)
    const kp = makeKeypoints({
      27: { x: 0.45, y: 0.5, score: 0.9 },   // leftAnkle above knee (0.7)
      28: { x: 0.55, y: 0.5, score: 0.9 },   // rightAnkle above knee (0.7)
    });
    const result = extractSemanticPosition(kp);
    expect(result.leftFoot).toBe('HIGH');
    expect(result.rightFoot).toBe('HIGH');
  });

  test('feet in mid-range → both feet MID', () => {
    // For MID: need hip.y > knee.y (knee above hip), ankle between knee.y and threshold
    // hip(0.5), knee(0.4), ankle(0.5) → threshold = 0.5+(0.5-0.4)=0.6 → 0.4 < 0.5 < 0.6 → MID
    const kp = makeKeypoints({
      25: { x: 0.45, y: 0.4, score: 0.9 },   // leftKnee above hip
      26: { x: 0.55, y: 0.4, score: 0.9 },   // rightKnee above hip
      27: { x: 0.45, y: 0.5, score: 0.9 },   // leftAnkle at hip height
      28: { x: 0.55, y: 0.5, score: 0.9 },   // rightAnkle at hip height
    });
    const result = extractSemanticPosition(kp);
    expect(result.leftFoot).toBe('MID');
    expect(result.rightFoot).toBe('MID');
  });

  // --- derived: armsExtended ---
  test('armsExtended true when both elbows straight (LOW)', () => {
    // Default pose has straight arms → elbows LOW
    const kp = makeKeypoints();
    const result = extractSemanticPosition(kp);
    expect(result.armsExtended).toBe(true);
  });

  test('armsExtended false when elbows bent', () => {
    const kp = makeKeypoints({
      13: { x: 0.35, y: 0.5, score: 0.9 },
      14: { x: 0.65, y: 0.5, score: 0.9 },
      15: { x: 0.2, y: 0.5, score: 0.9 },
      16: { x: 0.8, y: 0.5, score: 0.9 },
    });
    const result = extractSemanticPosition(kp);
    expect(result.armsExtended).toBe(false);
  });

  // --- derived: squatPosition ---
  test('squatPosition true when both knees MID and body upright', () => {
    const kp = makeKeypoints({
      25: { x: 0.55, y: 0.7, score: 0.9 },   // leftKnee bent → MID
      26: { x: 0.45, y: 0.7, score: 0.9 },   // rightKnee bent → MID
      27: { x: 0.45, y: 0.9, score: 0.9 },
      28: { x: 0.55, y: 0.9, score: 0.9 },
    });
    const result = extractSemanticPosition(kp);
    expect(result.leftKnee).toBe('MID');
    expect(result.rightKnee).toBe('MID');
    expect(result.bodyUpright).toBe(true);
    expect(result.squatPosition).toBe(true);
  });

  test('squatPosition false when knees bent but body not upright', () => {
    const kp = makeKeypoints({
      11: { x: 0.2, y: 0.5, score: 0.99 },   // shoulders horizontal (prone)
      12: { x: 0.8, y: 0.5, score: 0.99 },
      23: { x: 0.2, y: 0.5, score: 0.99 },
      24: { x: 0.8, y: 0.5, score: 0.99 },
      25: { x: 0.3, y: 0.7, score: 0.9 },     // knees bent → MID
      26: { x: 0.7, y: 0.7, score: 0.9 },
      27: { x: 0.2, y: 0.9, score: 0.9 },
      28: { x: 0.8, y: 0.9, score: 0.9 },
    });
    const result = extractSemanticPosition(kp);
    expect(result.bodyUpright).toBe(false);
    expect(result.squatPosition).toBe(false);
  });

  // --- derived: lungePosition ---
  test('lungePosition true when one knee MID and other LOW', () => {
    // Left knee bent (MID), right knee straight (LOW)
    const kp = makeKeypoints({
      25: { x: 0.55, y: 0.7, score: 0.9 },   // leftKnee offset → MID
      26: { x: 0.55, y: 0.7, score: 0.9 },   // rightKnee straight → LOW
    });
    const result = extractSemanticPosition(kp);
    expect(result.leftKnee).toBe('MID');
    expect(result.rightKnee).toBe('LOW');
    expect(result.lungePosition).toBe(true);
  });

  test('lungePosition true when right knee MID and left LOW', () => {
    // Left knee straight (LOW), right knee bent (MID)
    const kp = makeKeypoints({
      25: { x: 0.45, y: 0.7, score: 0.9 },   // leftKnee straight → LOW
      26: { x: 0.45, y: 0.7, score: 0.9 },   // rightKnee offset → MID
    });
    const result = extractSemanticPosition(kp);
    expect(result.leftKnee).toBe('LOW');
    expect(result.rightKnee).toBe('MID');
    expect(result.lungePosition).toBe(true);
  });

  test('lungePosition false when both knees same state', () => {
    const kp = makeKeypoints(); // both LOW
    const result = extractSemanticPosition(kp);
    expect(result.lungePosition).toBe(false);
  });

  // --- bodyUpright ---
  test('bodyUpright true when standing', () => {
    const kp = makeKeypoints(); // shoulders above hips, vertical alignment
    const result = extractSemanticPosition(kp);
    expect(result.bodyUpright).toBe(true);
  });

  test('bodyUpright false when prone', () => {
    // Shoulders and hips at same Y = horizontal
    const kp = makeKeypoints({
      11: { x: 0.2, y: 0.5, score: 0.99 },  // leftShoulder
      12: { x: 0.8, y: 0.5, score: 0.99 },  // rightShoulder
      23: { x: 0.2, y: 0.5, score: 0.99 },  // leftHip (same Y as shoulders)
      24: { x: 0.8, y: 0.5, score: 0.99 },  // rightHip
    });
    const result = extractSemanticPosition(kp);
    expect(result.bodyUpright).toBe(false);
  });

  // --- bodyProne ---
  test('bodyProne true when horizontal', () => {
    const kp = makeKeypoints({
      11: { x: 0.2, y: 0.5, score: 0.99 },
      12: { x: 0.3, y: 0.5, score: 0.99 },
      23: { x: 0.7, y: 0.5, score: 0.99 },
      24: { x: 0.8, y: 0.5, score: 0.99 },
    });
    const result = extractSemanticPosition(kp);
    expect(result.bodyProne).toBe(true);
  });

  test('bodyProne false when upright', () => {
    const kp = makeKeypoints();
    const result = extractSemanticPosition(kp);
    expect(result.bodyProne).toBe(false);
  });
});

describe('createSemanticExtractor (hysteresis)', () => {
  test('returns same shape as extractSemanticPosition', () => {
    const extractor = createSemanticExtractor();
    const kp = makeKeypoints();
    const pos = extractor(kp, 1000);
    expect(pos).toHaveProperty('leftHand');
    expect(pos).toHaveProperty('handsUp');
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

  test('derived booleans update based on stabilized limb states', () => {
    const extractor = createSemanticExtractor();
    // Start with hands LOW
    const kpLow = makeKeypoints();
    extractor(kpLow, 1000);

    // Raise both hands HIGH
    const kpHigh = makeKeypoints({
      15: { x: 0.35, y: 0.15, score: 0.9 },
      16: { x: 0.65, y: 0.15, score: 0.9 },
    });

    // During minHold — handsUp should still be false
    const pos1 = extractor(kpHigh, 1030);
    expect(pos1.handsUp).toBe(false);

    // After minHold — handsUp should be true
    const pos2 = extractor(kpHigh, 1200);
    expect(pos2.handsUp).toBe(true);
  });
});
