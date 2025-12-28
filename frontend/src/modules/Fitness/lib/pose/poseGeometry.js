/**
 * Pose geometry utilities for calculating angles, distances, and body positions
 */

/**
 * Calculate angle between three keypoints (in degrees)
 * @param {Keypoint} a - First point
 * @param {Keypoint} b - Middle point (vertex)
 * @param {Keypoint} c - Third point
 * @returns {number} Angle in degrees
 */
export const calculateAngle = (a, b, c) => {
  if (!a || !b || !c) return 0;
  if (a.score < 0.3 || b.score < 0.3 || c.score < 0.3) return 0;
  
  const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let angle = Math.abs(radians * 180 / Math.PI);
  
  if (angle > 180) angle = 360 - angle;
  return angle;
};

/**
 * Calculate distance between two keypoints
 * @param {Keypoint} a - First point
 * @param {Keypoint} b - Second point
 * @returns {number} Euclidean distance
 */
export const getKeypointDistance = (a, b) => {
  if (!a || !b) return 0;
  return Math.sqrt(Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2));
};

/**
 * Calculate 3D distance if z coordinates are available
 */
export const getKeypointDistance3D = (a, b) => {
  if (!a || !b) return 0;
  const dz = (a.z !== undefined && b.z !== undefined) ? Math.pow(b.z - a.z, 2) : 0;
  return Math.sqrt(Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2) + dz);
};

/**
 * Get midpoint between two keypoints
 * @param {Keypoint} a - First point
 * @param {Keypoint} b - Second point
 * @returns {Keypoint} Midpoint
 */
export const getMidpoint = (a, b) => {
  if (!a || !b) return null;
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z !== undefined && b.z !== undefined) ? (a.z + b.z) / 2 : undefined,
    score: Math.min(a.score || 0, b.score || 0),
  };
};

/**
 * Calculate body center of mass (simplified - midpoint of hips and shoulders)
 * @param {Pose} pose - Pose object with keypoints array
 * @returns {Keypoint} Body center point
 */
export const getBodyCenter = (pose) => {
  if (!pose?.keypoints) return null;
  
  const leftHip = pose.keypoints[23];
  const rightHip = pose.keypoints[24];
  const leftShoulder = pose.keypoints[11];
  const rightShoulder = pose.keypoints[12];
  
  const hipCenter = getMidpoint(leftHip, rightHip);
  const shoulderCenter = getMidpoint(leftShoulder, rightShoulder);
  
  return getMidpoint(hipCenter, shoulderCenter);
};

/**
 * Check if body is in roughly upright position
 * @param {Pose} pose - Pose object
 * @param {number} threshold - Angle threshold in degrees (default 30)
 * @returns {boolean}
 */
export const isUpright = (pose, threshold = 30) => {
  if (!pose?.keypoints) return false;
  
  const leftShoulder = pose.keypoints[11];
  const leftHip = pose.keypoints[23];
  
  if (!leftShoulder || !leftHip) return false;
  if (leftShoulder.score < 0.3 || leftHip.score < 0.3) return false;
  
  const angle = Math.abs(Math.atan2(
    leftShoulder.y - leftHip.y,
    leftShoulder.x - leftHip.x
  ) * 180 / Math.PI);
  
  return Math.abs(angle + 90) < threshold || Math.abs(angle - 90) < threshold;
};

/**
 * Check if in plank/horizontal position
 * @param {Pose} pose - Pose object
 * @param {number} threshold - Angle threshold in degrees
 * @returns {boolean}
 */
export const isHorizontal = (pose, threshold = 30) => {
  if (!pose?.keypoints) return false;
  
  const shoulder = pose.keypoints[11];
  const hip = pose.keypoints[23];
  const ankle = pose.keypoints[27];
  
  if (!shoulder || !hip || !ankle) return false;
  
  const bodyAngle = calculateAngle(shoulder, hip, ankle);
  return Math.abs(bodyAngle - 180) < threshold;
};

/**
 * Calculate the bounding box of a pose
 * @param {Pose} pose - Pose object
 * @param {number} minConfidence - Minimum keypoint confidence to include
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
export const getPoseBoundingBox = (pose, minConfidence = 0.3) => {
  if (!pose?.keypoints) return null;
  
  const validPoints = pose.keypoints.filter(kp => kp && kp.score >= minConfidence);
  if (validPoints.length === 0) return null;
  
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  
  validPoints.forEach(kp => {
    minX = Math.min(minX, kp.x);
    minY = Math.min(minY, kp.y);
    maxX = Math.max(maxX, kp.x);
    maxY = Math.max(maxY, kp.y);
  });
  
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
};

/**
 * Normalize keypoints to 0-1 range based on image dimensions
 * @param {Keypoint[]} keypoints - Array of keypoints
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @returns {Keypoint[]} Normalized keypoints
 */
export const normalizeKeypoints = (keypoints, width, height) => {
  if (!keypoints || !width || !height) return keypoints;
  
  return keypoints.map(kp => ({
    ...kp,
    x: kp.x / width,
    y: kp.y / height,
  }));
};

/**
 * Denormalize keypoints from 0-1 range to pixel coordinates
 * @param {Keypoint[]} keypoints - Array of normalized keypoints
 * @param {number} width - Target width
 * @param {number} height - Target height
 * @returns {Keypoint[]} Denormalized keypoints
 */
export const denormalizeKeypoints = (keypoints, width, height) => {
  if (!keypoints || !width || !height) return keypoints;
  
  return keypoints.map(kp => ({
    ...kp,
    x: kp.x * width,
    y: kp.y * height,
  }));
};

/**
 * Mirror keypoints horizontally (for webcam mirroring)
 * @param {Keypoint[]} keypoints - Array of keypoints
 * @param {number} width - Image width
 * @returns {Keypoint[]} Mirrored keypoints
 */
export const mirrorKeypoints = (keypoints, width) => {
  if (!keypoints || !width) return keypoints;
  
  return keypoints.map(kp => ({
    ...kp,
    x: width - kp.x,
  }));
};

/**
 * Smooth keypoints over time using exponential moving average
 * @param {Keypoint[]} current - Current frame keypoints
 * @param {Keypoint[]} previous - Previous frame keypoints
 * @param {number} smoothingFactor - 0-1, higher = more smoothing
 * @returns {Keypoint[]} Smoothed keypoints
 */
export const smoothKeypoints = (current, previous, smoothingFactor = 0.5) => {
  if (!current) return current;
  if (!previous) return current;
  
  return current.map((kp, i) => {
    const prev = previous[i];
    if (!prev || !kp) return kp;
    
    return {
      ...kp,
      x: prev.x + (kp.x - prev.x) * (1 - smoothingFactor),
      y: prev.y + (kp.y - prev.y) * (1 - smoothingFactor),
      z: kp.z !== undefined && prev.z !== undefined
        ? prev.z + (kp.z - prev.z) * (1 - smoothingFactor)
        : kp.z,
    };
  });
};

export default {
  calculateAngle,
  getKeypointDistance,
  getKeypointDistance3D,
  getMidpoint,
  getBodyCenter,
  isUpright,
  isHorizontal,
  getPoseBoundingBox,
  normalizeKeypoints,
  denormalizeKeypoints,
  mirrorKeypoints,
  smoothKeypoints,
};
