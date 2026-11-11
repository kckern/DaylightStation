// Harness-only stand-in for frontend/src/lib/logging/Logger.js. The real one
// opens a WebSocket transport to the backend; this one drops every event.
const noop = () => {};
const make = () => ({
  debug: noop, info: noop, warn: noop, error: noop, sampled: noop,
  child: () => make(),
});
const singleton = make();
export default function getLogger() { return singleton; }
export const configure = noop;
