// Harness-only stand-in for frontend/src/lib/logging/Logger.js and
// singleton.js. The real ones open a WebSocket transport to the backend; this
// one drops every event. Exports cover every name the overlays import.
const noop = () => {};
const make = () => ({
  log: noop, debug: noop, info: noop, warn: noop, error: noop, sampled: noop,
  child: () => make(),
});
const singleton = make();
export function getLogger() { return singleton; }
export const getDaylightLogger = getLogger;
export const getChildLogger = () => singleton;
export const configure = noop;
export const configureDaylightLogger = noop;
export const resetSamplingState = noop;
export const getRecentEvents = () => [];
export const flushLogs = async () => {};
export const getConfig = () => ({});
export const startDiagnostics = noop;
export const stopDiagnostics = noop;
export const perfSnapshot = () => ({});
export const getStatus = () => ({});
export default getLogger;
