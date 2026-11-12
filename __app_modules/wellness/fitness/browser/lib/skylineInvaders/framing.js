// Is the shooter inside the camera frame? Pure geometry on one BlazePose pose.

import { KP } from './aim.js';

export const FRAME_PARTS = Object.freeze({
  head: [KP.nose],
  leftWrist: [KP.leftWrist],
  rightWrist: [KP.rightWrist],
  shoulders: [KP.leftShoulder, KP.rightShoulder],
  hips: [KP.leftHip, KP.rightHip],
});

/**
 * A part is in frame when every one of its keypoints scores >= minScore and
 * lies inside the image, `margin` (fraction of each side) away from the edge.
 * @returns {{ head, leftWrist, rightWrist, shoulders, hips: boolean, ok: boolean }}
 *   ok = head and both wrists in frame (what aiming needs).
 */
export function frameCheck(pose, width, height, { minScore = 0.3, margin = 0.02 } = {}) {
  const k = pose?.keypoints || [];
  const inside = (kp) => !!kp && Number.isFinite(kp.x) && Number.isFinite(kp.y)
    && (kp.score ?? 0) >= minScore
    && kp.x >= width * margin && kp.x <= width * (1 - margin)
    && kp.y >= height * margin && kp.y <= height * (1 - margin);
  const out = {};
  Object.entries(FRAME_PARTS).forEach(([part, indices]) => {
    out[part] = width > 0 && height > 0 && indices.every((i) => inside(k[i]));
  });
  out.ok = out.head && out.leftWrist && out.rightWrist;
  return out;
}
