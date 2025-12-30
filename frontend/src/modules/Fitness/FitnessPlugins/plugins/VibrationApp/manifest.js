export default {
  id: 'vibration_monitor',
  name: 'Vibration Monitor',
  version: '1.0.0',
  icon: '💥',
  description: 'Live vibration feedback for fitness equipment.',
  modes: {
    standalone: true,
    overlay: true,
    sidebar: true,
    mini: false
  },
  dimensions: {
    standalone: { minWidth: 320, minHeight: 260, preferredAspect: '4:3' },
    overlay: { width: 320, height: 220, position: 'bottom-right' },
    sidebar: { width: '100%', height: 400 }
  },
  requires: {
    sessionActive: false,
    participants: false,
    heartRate: false,
    governance: false
  },
  pauseVideoOnLaunch: false,
  exitOnVideoEnd: false,
  overlay: {
    dismissible: true,
    timeout: null,
    backdrop: 'none',
    position: 'bottom-right'
  }
};
