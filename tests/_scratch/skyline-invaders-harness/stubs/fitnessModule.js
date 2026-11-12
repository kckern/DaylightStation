export const useFitnessModule = () => ({ registerLifecycle: (callbacks) => { window.__si = window.__si || {}; window.__si.lifecycle = callbacks; } });
export default useFitnessModule;
