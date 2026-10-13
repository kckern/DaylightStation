export default {
  id: 'pose_demo',
  name: 'Pose Demo',
  version: '1.0.0',
  icon: '🦴',
  description: 'Real-time pose detection with BlazePose skeleton visualization',
  modes: { standalone: true, overlay: true, sidebar: true, mini: false },
  requires: { sessionActive: false, participants: false, heartRate: false, governance: false },
  pauseVideoOnLaunch: false
};
