/**
 * Unit tests for poseConfidence utilities
 */

import {
  ESSENTIAL_KEYPOINT_INDICES,
  KEYPOINT_WEIGHTS,
  calculatePoseConfidence,
  isPoseConfident,
  getMissingKeypoints,
  getConfidenceLabel,
  getConfidenceColor,
  smoothConfidence,
  createConfidenceSmoother,
} from '../poseConfidence.js';

// Helper to create a mock pose with specified keypoints
const createMockPose = (keypointScores = {}) => {
  const keypoints = Array(33).fill(null).map((_, idx) => ({
    x: 100 + idx * 10,
    y: 200 + idx * 5,
    score: keypointScores[idx] ?? 0,
  }));
  return { keypoints };
};

// Helper to create a fully detected pose
const createFullPose = (score = 0.9) => {
  const scores = {};
  ESSENTIAL_KEYPOINT_INDICES.forEach(idx => {
    scores[idx] = score;
  });
  return createMockPose(scores);
};

// Helper to create a partial pose (missing some keypoints)
const createPartialPose = (presentIndices, score = 0.8) => {
  const scores = {};
  presentIndices.forEach(idx => {
    scores[idx] = score;
  });
  return createMockPose(scores);
};

describe('poseConfidence', () => {
  describe('ESSENTIAL_KEYPOINT_INDICES', () => {
    it('should contain expected body keypoints', () => {
      expect(ESSENTIAL_KEYPOINT_INDICES).toContain(0);  // nose
      expect(ESSENTIAL_KEYPOINT_INDICES).toContain(11); // left shoulder
      expect(ESSENTIAL_KEYPOINT_INDICES).toContain(12); // right shoulder
      expect(ESSENTIAL_KEYPOINT_INDICES).toContain(23); // left hip
      expect(ESSENTIAL_KEYPOINT_INDICES).toContain(24); // right hip
      expect(ESSENTIAL_KEYPOINT_INDICES).toContain(27); // left ankle
      expect(ESSENTIAL_KEYPOINT_INDICES).toContain(28); // right ankle
    });

    it('should have 13 essential keypoints', () => {
      expect(ESSENTIAL_KEYPOINT_INDICES.length).toBe(13);
    });
  });

  describe('KEYPOINT_WEIGHTS', () => {
    it('should have higher weights for hips (anchor points)', () => {
      expect(KEYPOINT_WEIGHTS[23]).toBe(1.5);
      expect(KEYPOINT_WEIGHTS[24]).toBe(1.5);
    });

    it('should have lower weight for nose', () => {
      expect(KEYPOINT_WEIGHTS[0]).toBe(0.5);
    });
  });

  describe('calculatePoseConfidence', () => {
    it('should return 0 confidence for null pose', () => {
      const result = calculatePoseConfidence(null);
      expect(result.overall).toBe(0);
      expect(result.presence).toBe(0);
      expect(result.avgScore).toBe(0);
      expect(result.missingKeypoints).toEqual(ESSENTIAL_KEYPOINT_INDICES);
    });

    it('should return 0 confidence for pose with no keypoints', () => {
      const result = calculatePoseConfidence({ keypoints: [] });
      expect(result.overall).toBe(0);
      expect(result.detectedCount).toBe(0);
    });

    it('should return high confidence for fully detected pose', () => {
      const pose = createFullPose(0.95);
      const result = calculatePoseConfidence(pose);
      
      expect(result.overall).toBeGreaterThan(90);
      expect(result.presence).toBe(100);
      expect(result.detectedCount).toBe(13);
      expect(result.missingKeypoints).toHaveLength(0);
    });

    it('should return lower confidence for partial pose', () => {
      // Only upper body detected (shoulders, elbows, wrists, nose)
      const pose = createPartialPose([0, 11, 12, 13, 14, 15, 16], 0.8);
      const result = calculatePoseConfidence(pose);
      
      expect(result.overall).toBeLessThan(70);
      expect(result.detectedCount).toBe(7);
      expect(result.missingKeypoints).toContain(23); // missing hip
      expect(result.missingKeypoints).toContain(27); // missing ankle
    });

    it('should return lower confidence for low-score keypoints', () => {
      // All keypoints present but with low scores
      const pose = createFullPose(0.35);
      const result = calculatePoseConfidence(pose);
      
      expect(result.overall).toBeLessThan(80);
      expect(result.presence).toBe(100); // All present
      expect(result.avgScore).toBeLessThan(50); // But low scores
    });

    it('should not count keypoints below minDetectionScore', () => {
      const pose = createFullPose(0.2); // Below default 0.3 threshold
      const result = calculatePoseConfidence(pose);
      
      expect(result.detectedCount).toBe(0);
      expect(result.presence).toBe(0);
    });

    it('should track low confidence keypoints', () => {
      // Mix of high and low confidence
      const scores = {};
      ESSENTIAL_KEYPOINT_INDICES.forEach((idx, i) => {
        scores[idx] = i < 5 ? 0.9 : 0.45; // First 5 high, rest low
      });
      const pose = createMockPose(scores);
      const result = calculatePoseConfidence(pose);
      
      expect(result.lowConfidenceKeypoints.length).toBeGreaterThan(0);
      result.lowConfidenceKeypoints.forEach(kp => {
        expect(kp.score).toBeLessThan(0.6);
      });
    });

    it('should respect custom minDetectionScore option', () => {
      const pose = createFullPose(0.25);
      
      const defaultResult = calculatePoseConfidence(pose);
      expect(defaultResult.detectedCount).toBe(0);
      
      const customResult = calculatePoseConfidence(pose, { minDetectionScore: 0.2 });
      expect(customResult.detectedCount).toBe(13);
    });
  });

  describe('isPoseConfident', () => {
    it('should return true for high confidence pose', () => {
      const pose = createFullPose(0.9);
      expect(isPoseConfident(pose, 50)).toBe(true);
      expect(isPoseConfident(pose, 80)).toBe(true);
    });

    it('should return false for low confidence pose', () => {
      const pose = createPartialPose([0, 11, 12], 0.5); // Only 3 keypoints
      expect(isPoseConfident(pose, 50)).toBe(false);
    });

    it('should return false for null pose', () => {
      expect(isPoseConfident(null, 50)).toBe(false);
    });

    it('should use default threshold of 50', () => {
      const mediumPose = createPartialPose([0, 11, 12, 13, 14, 15, 16, 23, 24], 0.7);
      const result = calculatePoseConfidence(mediumPose);
      
      if (result.overall >= 50) {
        expect(isPoseConfident(mediumPose)).toBe(true);
      } else {
        expect(isPoseConfident(mediumPose)).toBe(false);
      }
    });
  });

  describe('getMissingKeypoints', () => {
    it('should return all essential keypoints for null pose', () => {
      const missing = getMissingKeypoints(null);
      expect(missing).toEqual(ESSENTIAL_KEYPOINT_INDICES);
    });

    it('should return empty array for full pose', () => {
      const pose = createFullPose(0.9);
      const missing = getMissingKeypoints(pose);
      expect(missing).toHaveLength(0);
    });

    it('should return missing keypoint indices', () => {
      // Missing lower body
      const pose = createPartialPose([0, 11, 12, 13, 14, 15, 16], 0.8);
      const missing = getMissingKeypoints(pose);
      
      expect(missing).toContain(23); // left hip
      expect(missing).toContain(24); // right hip
      expect(missing).toContain(25); // left knee
      expect(missing).toContain(26); // right knee
      expect(missing).toContain(27); // left ankle
      expect(missing).toContain(28); // right ankle
    });

    it('should respect custom minScore', () => {
      const pose = createFullPose(0.25);
      
      expect(getMissingKeypoints(pose, 0.3)).toHaveLength(13); // All "missing"
      expect(getMissingKeypoints(pose, 0.2)).toHaveLength(0);  // None missing
    });
  });

  describe('getConfidenceLabel', () => {
    it('should return Excellent for 80+', () => {
      expect(getConfidenceLabel(80)).toBe('Excellent');
      expect(getConfidenceLabel(95)).toBe('Excellent');
      expect(getConfidenceLabel(100)).toBe('Excellent');
    });

    it('should return Good for 60-79', () => {
      expect(getConfidenceLabel(60)).toBe('Good');
      expect(getConfidenceLabel(75)).toBe('Good');
      expect(getConfidenceLabel(79)).toBe('Good');
    });

    it('should return Fair for 40-59', () => {
      expect(getConfidenceLabel(40)).toBe('Fair');
      expect(getConfidenceLabel(55)).toBe('Fair');
      expect(getConfidenceLabel(59)).toBe('Fair');
    });

    it('should return Poor for below 40', () => {
      expect(getConfidenceLabel(39)).toBe('Poor');
      expect(getConfidenceLabel(20)).toBe('Poor');
      expect(getConfidenceLabel(0)).toBe('Poor');
    });
  });

  describe('getConfidenceColor', () => {
    it('should return green for 80+', () => {
      expect(getConfidenceColor(85)).toBe('#22c55e');
    });

    it('should return yellow for 60-79', () => {
      expect(getConfidenceColor(70)).toBe('#eab308');
    });

    it('should return orange for 40-59', () => {
      expect(getConfidenceColor(50)).toBe('#f97316');
    });

    it('should return red for below 40', () => {
      expect(getConfidenceColor(30)).toBe('#ef4444');
    });
  });

  describe('smoothConfidence', () => {
    it('should return current value when previous is null', () => {
      expect(smoothConfidence(75, null)).toBe(75);
      expect(smoothConfidence(50, undefined)).toBe(50);
    });

    it('should smooth values with default alpha', () => {
      const smoothed = smoothConfidence(100, 0, 0.3);
      // With alpha 0.3: 0 * 0.7 + 100 * 0.3 = 30
      expect(smoothed).toBe(30);
    });

    it('should smooth values over time', () => {
      let value = 0;
      // Simulate ramping up from 0 to 100
      value = smoothConfidence(100, value, 0.3); // 30
      value = smoothConfidence(100, value, 0.3); // 51
      value = smoothConfidence(100, value, 0.3); // ~66
      
      expect(value).toBeGreaterThan(60);
      expect(value).toBeLessThan(70);
    });

    it('should handle rapid changes', () => {
      // Sudden drop
      const smoothed = smoothConfidence(20, 80, 0.3);
      // 80 * 0.7 + 20 * 0.3 = 56 + 6 = 62
      expect(smoothed).toBe(62);
    });
  });

  describe('createConfidenceSmoother', () => {
    it('should create a stateful smoother', () => {
      const smoother = createConfidenceSmoother(0.3);
      
      // First call - no previous value
      expect(smoother(100)).toBe(100);
      
      // Second call - smoothed
      const second = smoother(0);
      expect(second).toBeLessThan(100);
      expect(second).toBeGreaterThan(0);
    });

    it('should maintain state across calls', () => {
      const smoother = createConfidenceSmoother(0.5);
      
      let prev = smoother(100); // 100
      prev = smoother(100);      // Still 100
      prev = smoother(0);        // 50
      prev = smoother(0);        // 25
      
      expect(prev).toBe(25);
    });

    it('should respect custom alpha', () => {
      const fastSmoother = createConfidenceSmoother(0.9);
      const slowSmoother = createConfidenceSmoother(0.1);
      
      fastSmoother(0);
      slowSmoother(0);
      
      const fast = fastSmoother(100); // Responds quickly
      const slow = slowSmoother(100); // Responds slowly
      
      expect(fast).toBeGreaterThan(slow);
    });
  });
});

describe('Integration scenarios', () => {
  it('should handle full visibility scenario', () => {
    const pose = createFullPose(0.95);
    const result = calculatePoseConfidence(pose);
    
    expect(result.overall).toBeGreaterThanOrEqual(90);
    expect(getConfidenceLabel(result.overall)).toBe('Excellent');
    expect(isPoseConfident(pose, 80)).toBe(true);
  });

  it('should handle arm raised off screen scenario', () => {
    // Missing one wrist and elbow
    const presentIndices = ESSENTIAL_KEYPOINT_INDICES.filter(
      idx => idx !== 15 && idx !== 13 // Missing left wrist and elbow
    );
    const pose = createPartialPose(presentIndices, 0.85);
    const result = calculatePoseConfidence(pose);
    
    expect(result.overall).toBeLessThan(90);
    expect(result.overall).toBeGreaterThan(70);
    expect(result.missingKeypoints).toContain(15);
    expect(result.missingKeypoints).toContain(13);
  });

  it('should handle lower body cut off scenario', () => {
    // Only upper body visible
    const upperBody = [0, 11, 12, 13, 14, 15, 16];
    const pose = createPartialPose(upperBody, 0.9);
    const result = calculatePoseConfidence(pose);
    
    expect(result.overall).toBeLessThan(70);
    expect(result.overall).toBeGreaterThan(40);
    expect(result.detectedCount).toBe(7);
  });

  it('should handle only head visible scenario', () => {
    const pose = createPartialPose([0], 0.9); // Only nose
    const result = calculatePoseConfidence(pose);
    
    expect(result.overall).toBeLessThan(30);
    expect(isPoseConfident(pose, 40)).toBe(false);
  });

  it('should handle rapid movement with confidence flickering', () => {
    const smoother = createConfidenceSmoother(0.3);
    
    // Simulate flickering detection
    const values = [90, 40, 85, 30, 88, 45, 82];
    const smoothed = values.map(v => smoother(v));
    
    // Smoothed values should be less volatile
    const rawRange = Math.max(...values) - Math.min(...values); // 60
    const smoothedRange = Math.max(...smoothed) - Math.min(...smoothed);
    
    expect(smoothedRange).toBeLessThan(rawRange);
  });
});
