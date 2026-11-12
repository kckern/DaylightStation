export default {
  id: 'skyline_invaders_spike',
  name: 'Skyline Invaders Spike',
  version: '0.1.0',
  icon: '📐',
  description: 'Phase 0 hardware spike: pose speed, arm aiming and pressure-mat firing measurements',
  // Covers the whole viewport, nav included: it is read from across the garage.
  fullscreen: true,
  modes: { standalone: true, overlay: false, sidebar: false, mini: false },
  requires: { sessionActive: false, participants: false, heartRate: false, governance: false },
  pauseVideoOnLaunch: false,
};
