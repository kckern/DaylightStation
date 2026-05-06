// Re-export the HealthHub component from the HealthHub/ directory.
// This shim exists so that bare imports of 'HealthHub.jsx' continue to
// resolve correctly while the implementation lives in HealthHub/index.jsx.
export { default } from './HealthHub/index.jsx';
