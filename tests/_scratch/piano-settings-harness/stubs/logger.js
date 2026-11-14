// Harness-only stand-in for frontend/src/lib/logging/Logger.js (no WebSocket).
const noop = () => {};
const make = () => ({ debug: noop, info: noop, warn: noop, error: noop, sampled: noop, child: () => make() });
const singleton = make();
export default function getLogger() { return singleton; }
export const getLoggerNamed = getLogger;
export const configure = noop;
