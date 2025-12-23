export default {
  id: 'camera_view',
  name: 'Camera View',
  version: '1.0.0',
  icon: '📷',
  description: 'Webcam view with session snapshots',
  modes: { standalone: true, overlay: false, sidebar: true, mini: true },
  requires: { sessionActive: true, participants: false, heartRate: false, governance: false },
  pauseVideoOnLaunch: false
};
