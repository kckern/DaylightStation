import { describe, it, expect } from 'vitest';
import { frameCheck } from './framing.js';
import { KP } from './aim.js';

const pose = (overrides = {}) => {
  const keypoints = Array.from({ length: 33 }, () => ({ x: 320, y: 240, score: 0.9 }));
  Object.entries(overrides).forEach(([index, kp]) => { keypoints[index] = { ...keypoints[index], ...kp }; });
  return { keypoints };
};

describe('frameCheck', () => {
  it('passes a centered pose', () => {
    expect(frameCheck(pose(), 640, 480)).toEqual({ head: true, leftWrist: true, rightWrist: true, shoulders: true, hips: true, ok: true });
  });

  it('flags a wrist past the edge or inside the margin without failing framing', () => {
    expect(frameCheck(pose({ [KP.leftWrist]: { x: 700 } }), 640, 480)).toMatchObject({ leftWrist: false, rightWrist: true, ok: true });
    expect(frameCheck(pose({ [KP.rightWrist]: { y: 4 } }), 640, 480).rightWrist).toBe(false);
  });

  it('fails framing when a shoulder leaves the picture', () => {
    expect(frameCheck(pose({ [KP.leftShoulder]: { x: 700 } }), 640, 480)).toMatchObject({ shoulders: false, ok: false });
  });

  it('treats a low-score keypoint as out of frame', () => {
    expect(frameCheck(pose({ [KP.nose]: { score: 0.1 } }), 640, 480)).toMatchObject({ head: false, ok: false });
  });

  it('is all false without a pose or video size', () => {
    expect(frameCheck(null, 640, 480).ok).toBe(false);
    expect(frameCheck(pose(), 0, 0).ok).toBe(false);
  });
});
