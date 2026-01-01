export default {
  id: 'fitness_session',
  name: 'Fitness Session',
  version: '1.0.0',
  icon: '💪',
  description: 'Full session view with chart, sidebar, camera, and fullscreen vitals overlay',
  modes: { standalone: true, overlay: false, sidebar: false, mini: false },
  requires: { sessionActive: false, participants: false, heartRate: false, governance: false },
  pauseVideoOnLaunch: false,
  exitOnVideoEnd: false,
  sidebar: {
    collapseOnFullscreen: true,
    allowToggle: true,
    defaultVisible: true
  },
  dimensions: {
    standalone: { minWidth: 800, minHeight: 600, preferredAspect: '16:9' }
  }
};
