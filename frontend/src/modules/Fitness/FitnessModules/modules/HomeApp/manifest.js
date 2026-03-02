export default {
  id: 'home',
  name: 'Home',
  version: '1.0.0',
  icon: null,
  description: 'Fitness Health Dashboard',
  modes: {
    standalone: true,
    overlay: false,
    sidebar: false,
    mini: false,
  },
  requires: {
    sessionActive: false,
    participants: false,
    heartRate: false,
    governance: false,
  },
  pauseVideoOnLaunch: false,
  exitOnVideoEnd: false,
};
