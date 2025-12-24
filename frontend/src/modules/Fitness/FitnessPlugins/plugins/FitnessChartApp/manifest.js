export default {
  id: 'fitness_chart',
  name: 'Fitness Chart',
  version: '1.0.0',
  icon: '📊',
  description: 'Real-time heart rate race chart showing participant progress',
  modes: {
    standalone: true,
    overlay: true,
    sidebar: true,
    mini: true
  },
  dimensions: {
    standalone: { minWidth: 400, minHeight: 300, preferredAspect: '4:3' },
    overlay: { width: 320, height: 240, position: 'bottom-right' },
    sidebar: { width: '100%', height: 400 },
    mini: { width: 200, height: 150 }
  },
  requires: {
    sessionActive: false,
    participants: true,
    heartRate: true,
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
