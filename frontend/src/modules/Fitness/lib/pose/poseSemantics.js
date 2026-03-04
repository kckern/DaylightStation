/**
 * Semantic position extraction from BlazePose keypoints.
 *
 * Layer 1: Converts raw 33-element keypoint arrays into discrete, body-relative
 * states (HIGH / MID / LOW) for hands, knees, elbows, hips, shoulders, torso,
 * and stance.
 *
 * Layer 1.5: Derives boolean combo states (upright, prone, squatting, lunging,
 * armsOverhead, armsAtSides, armsExtended, wideStance, narrowStance) from the
 * Layer 1 classifiers.
 *
 * This is a pure function with no hysteresis -- every call is independent of
 * previous frames. The createSemanticExtractor wrapper adds hysteresis.
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

/** Hip flexion: angle(shoulder, hip, knee). >=160 LOW (standing), 90-160 MID, <90 HIGH */
const classifyHip = (shoulder, hip, knee) => {
  if (!shoulder || !hip || !knee) return null;
  const angle = calculateAngle(shoulder, hip, knee);
  if (angle === 0) return null;
  if (angle >= 160) return 'LOW';
  if (angle >= 90) return 'MID';
  return 'HIGH';
};

/** Shoulder elevation: angle(hip, shoulder, elbow). <45 LOW (at side), 45-135 MID, >=135 HIGH (overhead) */
const classifyShoulder = (hip, shoulder, elbow) => {
  if (!hip || !shoulder || !elbow) return null;
  const angle = calculateAngle(hip, shoulder, elbow);
  if (angle === 0) return null;
  if (angle >= 135) return 'HIGH';
  if (angle >= 45) return 'MID';
  return 'LOW';
};

// ---------------------------------------------------------------------------
// Whole-body classifiers
// ---------------------------------------------------------------------------

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

  const angleFromVertical = Math.atan2(dx, dy) * (180 / Math.PI);

  if (angleFromVertical < 30) return 'UPRIGHT';
  if (angleFromVertical < 60) return 'LEANING';
  return 'PRONE';
};

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
  if (hipWidth < 0.01) return null;

  const ankleSpread = Math.abs(lAnkle.x - rAnkle.x);
  const ratio = ankleSpread / hipWidth;

  if (ratio < 0.8) return 'NARROW';
  if (ratio <= 1.3) return 'HIP';
  return 'WIDE';
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
    leftHand, rightHand,
    leftElbow, rightElbow,
    leftKnee, rightKnee,
    leftHip, rightHip,
    leftShoulder, rightShoulder,
    torso, stance,
    upright, prone,
    squatting, lunging,
    armsOverhead, armsAtSides, armsExtended,
    wideStance, narrowStance,
  };
};

// ---------------------------------------------------------------------------
// Hysteresis wrapper
// ---------------------------------------------------------------------------

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
  };
};

export default extractSemanticPosition;
