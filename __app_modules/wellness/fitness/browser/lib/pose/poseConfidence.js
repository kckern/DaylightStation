/**
 * Pose confidence utilities for calculating detection quality
 * 
 * Provides functions to assess overall pose detection confidence,
 * identify missing keypoints, and determine if a pose meets quality thresholds.
 */

/**
 * Essential keypoints for fitness tracking (excludes detailed face/hand points)
 * These are the keypoints that matter most for body pose visualization
 */
export const ESSENTIAL_KEYPOINT_INDICES = [
  0,        // nose
  11, 12,   // shoulders
  13, 14,   // elbows
  15, 16,   // wrists
  23, 24,   // hips
  25, 26,   // knees
  27, 28,   // ankles
];

/**
 * Keypoint importance weights for weighted confidence calculation
 * Higher weights = more important for overall confidence
 */
export const KEYPOINT_WEIGHTS = {
  0: 0.5,    // nose - less critical
  11: 1.3,   // left shoulder
  12: 1.3,   // right shoulder
  13: 1.0,   // left elbow
  14: 1.0,   // right elbow
  15: 1.0,   // left wrist
  16: 1.0,   // right wrist
  23: 1.5,   // left hip - core anchor
  24: 1.5,   // right hip - core anchor
  25: 1.2,   // left knee
  26: 1.2,   // right knee
  27: 1.2,   // left ankle
  28: 1.2,   // right ankle
};

/**
 * Default options for confidence calculation
 */
const DEFAULT_OPTIONS = {
  minDetectionScore: 0.3,      // Minimum score to consider a keypoint "detected"
  presenceWeight: 0.4,         // Weight for presence score (0-1)
  avgScoreWeight: 0.6,         // Weight for average keypoint score (0-1)
  useWeightedKeypoints: true,  // Use importance weights
  essentialOnly: true,         // Only consider essential keypoints
};

/**
 * Calculate overall pose confidence score
 * 
 * @param {Object} pose - Pose object with keypoints array
 * @param {Object} options - Configuration options
 * @returns {Object} Confidence result with overall, presence, avgScore, and details
 */
export const calculatePoseConfidence = (pose, options = {}) => {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  // Handle null/undefined pose
  if (!pose?.keypoints || pose.keypoints.length === 0) {
    return {
      overall: 0,
      presence: 0,
      avgScore: 0,
      detectedCount: 0,
      totalCount: ESSENTIAL_KEYPOINT_INDICES.length,
      missingKeypoints: [...ESSENTIAL_KEYPOINT_INDICES],
      lowConfidenceKeypoints: [],
    };
  }
  
  const keypoints = pose.keypoints;
  const targetIndices = opts.essentialOnly 
    ? ESSENTIAL_KEYPOINT_INDICES 
    : keypoints.map((_, i) => i);
  
  let detectedCount = 0;
  let totalWeight = 0;
  let weightedScoreSum = 0;
  const missingKeypoints = [];
  const lowConfidenceKeypoints = [];
  
  targetIndices.forEach(idx => {
    const kp = keypoints[idx];
    const weight = opts.useWeightedKeypoints ? (KEYPOINT_WEIGHTS[idx] || 1.0) : 1.0;
    totalWeight += weight;
    
    if (!kp || kp.score === undefined || kp.score < opts.minDetectionScore) {
      missingKeypoints.push(idx);
    } else {
      detectedCount++;
      weightedScoreSum += kp.score * weight;
      
      // Track low confidence (detected but not great)
      if (kp.score < 0.6) {
        lowConfidenceKeypoints.push({ index: idx, score: kp.score });
      }
    }
  });
  
  // Calculate presence score (percentage of keypoints detected)
  const presence = (detectedCount / targetIndices.length) * 100;
  
  // Calculate average score of detected keypoints (weighted)
  const avgScore = detectedCount > 0 
    ? (weightedScoreSum / (detectedCount * (totalWeight / targetIndices.length))) * 100
    : 0;
  
  // Combine for overall confidence
  const overall = (presence * opts.presenceWeight) + (avgScore * opts.avgScoreWeight);
  
  return {
    overall: Math.round(overall * 10) / 10,      // Round to 1 decimal
    presence: Math.round(presence * 10) / 10,
    avgScore: Math.round(avgScore * 10) / 10,
    detectedCount,
    totalCount: targetIndices.length,
    missingKeypoints,
    lowConfidenceKeypoints,
  };
};

/**
 * Quick check if pose meets a confidence threshold
 * 
 * @param {Object} pose - Pose object with keypoints array
 * @param {number} threshold - Minimum confidence (0-100), default 50
 * @returns {boolean} True if pose confidence >= threshold
 */
export const isPoseConfident = (pose, threshold = 50) => {
  const result = calculatePoseConfidence(pose);
  return result.overall >= threshold;
};

/**
 * Get list of missing keypoint indices
 * 
 * @param {Object} pose - Pose object with keypoints array
 * @param {number} minScore - Minimum score to consider detected (default 0.3)
 * @returns {number[]} Array of missing keypoint indices
 */
export const getMissingKeypoints = (pose, minScore = 0.3) => {
  if (!pose?.keypoints) return [...ESSENTIAL_KEYPOINT_INDICES];
  
  return ESSENTIAL_KEYPOINT_INDICES.filter(idx => {
    const kp = pose.keypoints[idx];
    return !kp || kp.score === undefined || kp.score < minScore;
  });
};

/**
 * Get confidence level label
 * 
 * @param {number} confidence - Confidence score (0-100)
 * @returns {string} Human-readable label
 */
export const getConfidenceLabel = (confidence) => {
  if (confidence >= 80) return 'Excellent';
  if (confidence >= 60) return 'Good';
  if (confidence >= 40) return 'Fair';
  return 'Poor';
};

/**
 * Get confidence color (CSS color string)
 * 
 * @param {number} confidence - Confidence score (0-100)
 * @returns {string} CSS color value
 */
export const getConfidenceColor = (confidence) => {
  if (confidence >= 80) return '#22c55e'; // green
  if (confidence >= 60) return '#eab308'; // yellow
  if (confidence >= 40) return '#f97316'; // orange
  return '#ef4444'; // red
};

/**
 * Apply exponential moving average smoothing to confidence
 * Use this to prevent jittery meter movement
 * 
 * @param {number} current - Current confidence value
 * @param {number} previous - Previous smoothed value
 * @param {number} alpha - Smoothing factor (0-1), lower = more smoothing
 * @returns {number} Smoothed confidence value
 */
export const smoothConfidence = (current, previous, alpha = 0.3) => {
  if (previous === null || previous === undefined) return current;
  return previous * (1 - alpha) + current * alpha;
};

/**
 * Create a confidence smoother function with internal state
 * 
 * @param {number} alpha - Smoothing factor (0-1)
 * @returns {Function} Smoother function that takes current value and returns smoothed
 */
export const createConfidenceSmoother = (alpha = 0.3) => {
  let previousValue = null;
  
  return (currentValue) => {
    const smoothed = smoothConfidence(currentValue, previousValue, alpha);
    previousValue = smoothed;
    return smoothed;
  };
};

export default {
  ESSENTIAL_KEYPOINT_INDICES,
  KEYPOINT_WEIGHTS,
  calculatePoseConfidence,
  isPoseConfident,
  getMissingKeypoints,
  getConfidenceLabel,
  getConfidenceColor,
  smoothConfidence,
  createConfidenceSmoother,
};
