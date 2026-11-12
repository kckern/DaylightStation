// Renders the real SkylineInvaders shell (lobby, calibration, round, result)
// against stubbed edges: fitness context, pose bridge, identity, and a level
// API answered by the harness server. Driven by tests/_scratch/shoot-skyline-invaders-shell.mjs.
//   /shell.html?pose=detecting&shooter=none&mat=none&partner=1&zone=hot&levels=none|fail
import React from 'react';
import { createRoot } from 'react-dom/client';
import SkylineInvaders from '../../../__app_modules/wellness/fitness/browser/widgets/SkylineInvaders/SkylineInvaders.jsx';
import { VolumeProvider } from '../../../__app_modules/wellness/fitness/browser/nav/VolumeProvider.jsx';
import { KP } from '../../../__app_modules/wellness/fitness/browser/lib/skylineInvaders/aim.js';

// A BlazePose pose for the shoot script: shoulders 120 px apart, both wrists
// `wristDx` px from their own shoulder (negative = screen right).
window.__si = window.__si || {};
window.__si.pose = (wristDx = 0, wristY = 200) => {
  const keypoints = Array.from({ length: 33 }, () => ({ x: 0, y: 0, score: 0 }));
  keypoints[KP.nose] = { x: 320, y: 120, score: 0.9 };
  keypoints[KP.leftShoulder] = { x: 380, y: 200, score: 0.9 };
  keypoints[KP.rightShoulder] = { x: 260, y: 200, score: 0.9 };
  keypoints[KP.leftWrist] = { x: 380 + wristDx, y: wristY, score: 0.9 };
  keypoints[KP.rightWrist] = { x: 260 + wristDx, y: wristY, score: 0.9 };
  return { keypoints };
};
window.__si.feed = (wristDx, wristY) => window.__si.tracker.processPoses([window.__si.pose(wristDx, wristY)]);

// The game's own volume lives in the fitness volume store, as in FitnessApp.
createRoot(document.getElementById('root')).render(<VolumeProvider><SkylineInvaders /></VolumeProvider>);
document.body.dataset.harnessReady = 'true';
