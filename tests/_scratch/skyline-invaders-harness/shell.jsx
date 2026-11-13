// Renders the real SkylineInvaders shell (lobby, calibration, round, result)
// against stubbed edges: fitness context, pose bridge, identity, and a level
// API answered by the harness server. Driven by tests/_scratch/shoot-skyline-invaders-shell.mjs.
//   /shell.html?pose=detecting&shooter=none&mat=none&partner=1&controls=none|twist&levels=none|fail
import React from 'react';
import { createRoot } from 'react-dom/client';
import SkylineInvaders from '../../../__app_modules/wellness/fitness/browser/widgets/SkylineInvaders/SkylineInvaders.jsx';
import { VolumeProvider } from '../../../__app_modules/wellness/fitness/browser/nav/VolumeProvider.jsx';
import { KP } from '../../../__app_modules/wellness/fitness/browser/lib/skylineInvaders/aim.js';

// A BlazePose pose for the shoot script: shoulders 120 px apart, elbows hanging
// below them, both forearms tilted `deg` from upright (+ = screen right). That
// is the wiper gesture: 50 degrees is the screen edge.
window.__si = window.__si || {};
window.__si.pose = (deg = 0) => {
  const keypoints = Array.from({ length: 33 }, () => ({ x: 0, y: 0, score: 0 }));
  const put = (index, x, y) => { keypoints[index] = { x, y, score: 0.9 }; };
  put(KP.nose, 320, 120);
  put(KP.leftShoulder, 380, 200);
  put(KP.rightShoulder, 260, 200);
  put(KP.leftElbow, 390, 300);
  put(KP.rightElbow, 250, 300);
  put(KP.leftHip, 350, 420);
  put(KP.rightHip, 290, 420);
  const rad = (deg * Math.PI) / 180;
  put(KP.leftWrist, 390 - 80 * Math.sin(rad), 300 - 80 * Math.cos(rad));
  put(KP.rightWrist, 250 - 80 * Math.sin(rad), 300 - 80 * Math.cos(rad));
  return { keypoints };
};
window.__si.feed = (deg) => window.__si.tracker.processPoses([window.__si.pose(deg)]);
// The aim (0..1) as a wiper tilt.
window.__si.feedAim = (aim) => window.__si.feed((aim - 0.5) * 100);

createRoot(document.getElementById('root')).render(<VolumeProvider><SkylineInvaders onClose={() => { document.body.dataset.closed = 'true'; }} /></VolumeProvider>);
document.body.dataset.harnessReady = 'true';
