/**
 * Semantic position extraction from BlazePose keypoints.
 *
 * Converts raw 33-element keypoint arrays into discrete, body-relative states
 * (HIGH / MID / LOW) for hands, knees, elbows, and feet, plus derived booleans
 * such as handsUp, bodyUpright, bodyProne, squatPosition, lungePosition, and
 * armsExtended.
 *
 * This is the first layer of a two-layer pipeline. It is a pure function with
 * no hysteresis -- every call is independent of previous frames.
 */

import { calculateAngle } from './poseGeometry.js';

// BlazePose keypoint indices
const KP = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
};

const MIN_CONFIDENCE = 0.3;

/** Return the keypoint if it has sufficient confidence, else null. */
const confident = (kp) => (kp && kp.score >= MIN_CONFIDENCE ? kp : null);

// ---------------------------------------------------------------------------
// Hand classification: compare wrist Y to shoulder Y and hip Y.
//   y increases downward in normalised coords.
//   Above shoulder → HIGH, between shoulder and hip → MID, below hip → LOW.
// ---------------------------------------------------------------------------
const classifyHand = (wrist, shoulder, hip) => {
  if (!wrist || !shoulder || !hip) return null;
  if (wrist.y <= shoulder.y) return 'HIGH';
  if (wrist.y >= hip.y) return 'LOW';
  return 'MID';
};

// ---------------------------------------------------------------------------
// Angle-based classification helpers
// ---------------------------------------------------------------------------

/** Knee: angle(hip, knee, ankle). >=160 LOW (straight), 90-160 MID, <90 HIGH */
const classifyKnee = (hip, knee, ankle) => {
  if (!hip || !knee || !ankle) return null;
  const angle = calculateAngle(hip, knee, ankle);
  if (angle === 0) return null; // low confidence inside calculateAngle
  if (angle >= 160) return 'LOW';
  if (angle >= 90) return 'MID';
  return 'HIGH';
};

/** Elbow: angle(shoulder, elbow, wrist). >=150 LOW, 80-150 MID, <80 HIGH */
const classifyElbow = (shoulder, elbow, wrist) => {
  if (!shoulder || !elbow || !wrist) return null;
  const angle = calculateAngle(shoulder, elbow, wrist);
  if (angle === 0) return null;
  if (angle >= 150) return 'LOW';
  if (angle >= 80) return 'MID';
  return 'HIGH';
};

/** Foot: compare ankle Y to knee Y and hip Y. */
const classifyFoot = (ankle, knee, hip) => {
  if (!ankle || !knee || !hip) return null;
  if (ankle.y <= knee.y) return 'HIGH';
  if (ankle.y >= hip.y + (hip.y - knee.y)) return 'LOW'; // well below hip
  return 'MID';
};

// ---------------------------------------------------------------------------
// Derived booleans
// ---------------------------------------------------------------------------

/** bodyUpright: shoulder midpoint is above hip midpoint AND more vertical than horizontal. */
const deriveBodyUpright = (kp) => {
  const ls = confident(kp[KP.LEFT_SHOULDER]);
  const rs = confident(kp[KP.RIGHT_SHOULDER]);
  const lh = confident(kp[KP.LEFT_HIP]);
  const rh = confident(kp[KP.RIGHT_HIP]);
  if (!ls || !rs || !lh || !rh) return null;

  const shoulderMidX = (ls.x + rs.x) / 2;
  const shoulderMidY = (ls.y + rs.y) / 2;
  const hipMidX = (lh.x + rh.x) / 2;
  const hipMidY = (lh.y + rh.y) / 2;

  // Shoulders must be above hips (lower Y)
  if (shoulderMidY >= hipMidY) return false;

  const dx = Math.abs(shoulderMidX - hipMidX);
  const dy = Math.abs(shoulderMidY - hipMidY);
  return dy > dx; // more vertical than horizontal
};

/** bodyProne: torso more horizontal than vertical. */
const deriveBodyProne = (kp) => {
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
  return dx > dy; // more horizontal than vertical
};

// ---------------------------------------------------------------------------
// Main extraction function
// ---------------------------------------------------------------------------

/**
 * Extract a semantic position from a 33-element BlazePose keypoint array.
 *
 * @param {Array<{x:number, y:number, z:number, score:number}>} keypoints
 * @returns {object|null} Semantic position object, or null for invalid input.
 */
export const extractSemanticPosition = (keypoints) => {
  if (!keypoints || !Array.isArray(keypoints) || keypoints.length < 33) return null;

  // Confident keypoints (null if below threshold)
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

  // --- individual joint states ---
  const leftHand  = classifyHand(lWrist, lShoulder, lHip);
  const rightHand = classifyHand(rWrist, rShoulder, rHip);

  const leftKnee  = classifyKnee(lHip, lKnee, lAnkle);
  const rightKnee = classifyKnee(rHip, rKnee, rAnkle);

  const leftElbow  = classifyElbow(lShoulder, lElbow, lWrist);
  const rightElbow = classifyElbow(rShoulder, rElbow, rWrist);

  const leftFoot  = classifyFoot(lAnkle, lKnee, lHip);
  const rightFoot = classifyFoot(rAnkle, rKnee, rHip);

  // --- derived booleans ---
  const handsUp = leftHand === 'HIGH' && rightHand === 'HIGH';

  const bodyUpright = deriveBodyUpright(keypoints);
  const bodyProne   = deriveBodyProne(keypoints);

  const kneeBent = (v) => v === 'MID' || v === 'HIGH';
  const squatPosition =
    kneeBent(leftKnee) && kneeBent(rightKnee) && bodyUpright === true;

  const lungePosition =
    (kneeBent(leftKnee) && rightKnee === 'LOW') ||
    (leftKnee === 'LOW' && kneeBent(rightKnee));

  const armsExtended = leftElbow === 'LOW' && rightElbow === 'LOW';

  return {
    // Individual joint states
    leftHand,
    rightHand,
    leftKnee,
    rightKnee,
    leftElbow,
    rightElbow,
    leftFoot,
    rightFoot,

    // Derived booleans
    handsUp,
    bodyUpright,
    bodyProne,
    squatPosition,
    lungePosition,
    armsExtended,
  };
};

// ---------------------------------------------------------------------------
// Hysteresis wrapper
// ---------------------------------------------------------------------------

const DEFAULT_HYSTERESIS = {
  leftHand:   { minHoldMs: 80 },
  rightHand:  { minHoldMs: 80 },
  leftElbow:  { minHoldMs: 80 },
  rightElbow: { minHoldMs: 80 },
  leftKnee:   { minHoldMs: 120 },
  rightKnee:  { minHoldMs: 120 },
  leftFoot:   { minHoldMs: 80 },
  rightFoot:  { minHoldMs: 80 },
};

// The discrete limb properties that get hysteresis applied
const LIMB_KEYS = Object.keys(DEFAULT_HYSTERESIS);

/**
 * Create a stateful semantic extractor that applies per-property hysteresis
 * to prevent thrash when keypoints are near classification boundaries.
 *
 * @param {object} [config] - Per-property hysteresis config (merged with defaults).
 * @returns {(keypoints: Array, timestamp: number) => object} Stabilized extractor.
 */
export const createSemanticExtractor = (config = {}) => {
  const hysteresis = {};
  for (const key of LIMB_KEYS) {
    hysteresis[key] = { ...DEFAULT_HYSTERESIS[key], ...(config[key] || {}) };
  }

  // Per-property state: { stabilized, pendingValue, pendingStartedAt }
  let limbState = null;

  return (keypoints, timestamp) => {
    const raw = extractSemanticPosition(keypoints);
    if (!raw) return null;

    // First call — return raw values directly, initialise state
    if (!limbState) {
      limbState = {};
      for (const key of LIMB_KEYS) {
        limbState[key] = { stabilized: raw[key], pendingValue: null, pendingStartedAt: null };
      }
      return raw;
    }

    // Apply hysteresis per discrete limb property
    const stabilized = {};
    for (const key of LIMB_KEYS) {
      const st = limbState[key];
      const rawVal = raw[key];
      const { minHoldMs } = hysteresis[key];

      if (rawVal === st.stabilized) {
        // Raw matches stabilized — cancel any pending transition
        st.pendingValue = null;
        st.pendingStartedAt = null;
        stabilized[key] = st.stabilized;
      } else if (rawVal === st.pendingValue) {
        // Raw matches pending — check if minHold has elapsed
        if (timestamp - st.pendingStartedAt >= minHoldMs) {
          st.stabilized = rawVal;
          st.pendingValue = null;
          st.pendingStartedAt = null;
        }
        stabilized[key] = st.stabilized;
      } else {
        // New candidate — start pending transition
        st.pendingValue = rawVal;
        st.pendingStartedAt = timestamp;
        stabilized[key] = st.stabilized;
      }
    }

    // Recompute derived booleans from stabilized limb states
    const handsUp = stabilized.leftHand === 'HIGH' && stabilized.rightHand === 'HIGH';

    const kneeBent = (v) => v === 'MID' || v === 'HIGH';
    const squatPosition =
      kneeBent(stabilized.leftKnee) && kneeBent(stabilized.rightKnee) && raw.bodyUpright === true;

    const lungePosition =
      (kneeBent(stabilized.leftKnee) && stabilized.rightKnee === 'LOW') ||
      (stabilized.leftKnee === 'LOW' && kneeBent(stabilized.rightKnee));

    const armsExtended = stabilized.leftElbow === 'LOW' && stabilized.rightElbow === 'LOW';

    return {
      ...stabilized,
      handsUp,
      bodyUpright: raw.bodyUpright,
      bodyProne: raw.bodyProne,
      squatPosition,
      lungePosition,
      armsExtended,
    };
  };
};

export default extractSemanticPosition;
