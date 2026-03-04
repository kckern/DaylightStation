import { SemanticMoveDetector } from '../../../../frontend/src/modules/Fitness/domain/pose/SemanticMoveDetector.js';

const SQUAT_PATTERN = {
  id: 'squat',
  name: 'Squat',
  phases: [
    { name: 'down', match: { squatting: true } },
    { name: 'up',   match: { squatting: false, upright: true, narrowStance: true } },
  ],
  timing: { minCycleMs: 800, maxCycleMs: 5000 },
};

// Build a minimal pose with enough keypoints for semantic extraction
// Standing upright, arms at sides (normalized 0-1 coords, y-down)
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
    expect(det.name).toBe('Squat');
    expect(typeof det.onActivate).toBe('function');
    expect(typeof det.processPoses).toBe('function');
  });

  test('processPoses returns null when not active', () => {
    const det = new SemanticMoveDetector(SQUAT_PATTERN);
    const result = det.processPoses([makePose()]);
    expect(result).toBeNull();
  });

  test('after onActivate, processPoses processes poses without error', () => {
    const det = new SemanticMoveDetector(SQUAT_PATTERN);
    det.onActivate();
    // Standing upright with straight knees — should not throw
    const result = det.processPoses([makePose()]);
    // May return null or a state_change event
    expect(result === null || typeof result === 'object').toBe(true);
  });

  test('reset() clears detector state', () => {
    const det = new SemanticMoveDetector(SQUAT_PATTERN);
    det.onActivate();
    det.processPoses([makePose()]);
    det.reset();
    expect(det.repCount).toBe(0);
    expect(det.currentState).toBe('idle');
  });

  test('dispose() deactivates and resets', () => {
    const det = new SemanticMoveDetector(SQUAT_PATTERN);
    det.onActivate();
    det.dispose();
    expect(det.processPoses([makePose()])).toBeNull();
  });

  test('accepts custom detector with detect function', () => {
    const customPattern = {
      id: 'custom-move',
      name: 'Custom',
      detect: (pos, history, ts) => ({ active: true, customResult: 1 }),
    };
    const det = new SemanticMoveDetector(customPattern);
    det.onActivate();
    expect(det.id).toBe('custom-move');
    // Should not throw
    det.processPoses([makePose()]);
  });
});
