export default {
  id: 'component_showcase',
  name: 'UX Showcase',
  version: '1.0.0',
  icon: 'palette',
  description: 'Interactive demo of all shared Fitness UX components and patterns',
  modes: { standalone: true, overlay: false, sidebar: false, mini: false },
  dimensions: {
    standalone: { minWidth: 960, minHeight: 600, preferredAspect: '16:9' }
  },
  requires: {
    sessionActive: false,
    participants: false,
    heartRate: false,
    governance: false
  },
  category: 'developer',
  pauseVideoOnLaunch: false,
  exitOnVideoEnd: false
};
