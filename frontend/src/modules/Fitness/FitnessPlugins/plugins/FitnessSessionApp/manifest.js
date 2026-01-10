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
  // sidebar: false - FitnessSessionApp renders its own FitnessSidebar internally.
  // Setting sidebar config here would cause FitnessPluginContainer to add ANOTHER
  // FitnessSidebar wrapper, resulting in duplicate sidebars.
  sidebar: false,
  dimensions: {
    standalone: { minWidth: 800, minHeight: 600, preferredAspect: '16:9' }
  }
};
