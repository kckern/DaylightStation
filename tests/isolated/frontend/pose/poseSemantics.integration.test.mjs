// tests/isolated/frontend/pose/poseSemantics.integration.test.mjs
import { readFileSync } from 'fs';
import { join } from 'path';
import { extractSemanticPosition, createSemanticExtractor } from '../../../../frontend/src/modules/Fitness/lib/pose/poseSemantics.js';

const POSE_LOG_DIR = '/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/media/logs/poses/2026-03-04';
const POSE_LOG_FILE = '2026-03-04T06-13-30.jsonl';

const loadPoseFrames = () => {
  const lines = readFileSync(join(POSE_LOG_DIR, POSE_LOG_FILE), 'utf-8').trim().split('\n');
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
    } catch (e) {
      // Data not available (e.g. CI environment)
      frames = null;
    }
  });

  test('loads at least 100 frames from log data', () => {
    if (!frames) return;
    expect(frames.length).toBeGreaterThan(100);
  });

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
    // At least some frames should produce valid output
    expect(validCount).toBeGreaterThan(frames.length * 0.5);
  });

  test('createSemanticExtractor produces stable output (hysteresis reduces thrash)', () => {
    if (!frames) return;
    const extractor = createSemanticExtractor();
    let transitions = 0;
    let prevPos = null;

    for (const frame of frames) {
      const pos = extractor(frame.keypoints, frame.timestamp);
      if (pos && prevPos) {
        for (const prop of ['leftHand', 'rightHand', 'leftKnee', 'rightKnee',
                             'leftHip', 'rightHip', 'leftShoulder', 'rightShoulder']) {
          if (pos[prop] !== prevPos[prop]) transitions++;
        }
      }
      prevPos = pos;
    }

    // With hysteresis, transitions should be much less than frame count * properties
    // Threshold scaled for 8 tracked properties (was 0.3 for 4 properties)
    const maxExpectedTransitions = frames.length * 0.6;
    expect(transitions).toBeLessThan(maxExpectedTransitions);
  });

  test('hysteresis produces fewer transitions than raw extraction', () => {
    if (!frames) return;

    // Count transitions with raw extraction
    let rawTransitions = 0;
    let prevRaw = null;
    for (const frame of frames) {
      const pos = extractSemanticPosition(frame.keypoints);
      if (pos && prevRaw) {
        for (const prop of ['leftHand', 'rightHand', 'leftKnee', 'rightKnee',
                             'leftHip', 'rightHip', 'leftShoulder', 'rightShoulder']) {
          if (pos[prop] !== prevRaw[prop]) rawTransitions++;
        }
      }
      prevRaw = pos;
    }

    // Count transitions with hysteresis
    const extractor = createSemanticExtractor();
    let smoothTransitions = 0;
    let prevSmooth = null;
    for (const frame of frames) {
      const pos = extractor(frame.keypoints, frame.timestamp);
      if (pos && prevSmooth) {
        for (const prop of ['leftHand', 'rightHand', 'leftKnee', 'rightKnee',
                             'leftHip', 'rightHip', 'leftShoulder', 'rightShoulder']) {
          if (pos[prop] !== prevSmooth[prop]) smoothTransitions++;
        }
      }
      prevSmooth = pos;
    }

    // Hysteresis should reduce transitions
    expect(smoothTransitions).toBeLessThanOrEqual(rawTransitions);
  });
});
