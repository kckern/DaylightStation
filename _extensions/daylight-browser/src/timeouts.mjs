export const DAYLIGHT_BROWSER_TIMEOUTS = Object.freeze({
  navigationMs: 25_000,
  captureMs: 30_000,
  captureObservationMs: 20_000,
  cleanupMs: 1_000,
  operationMs: 65_000,
  httpRequestMs: 70_000,
});

export function validateTimeoutHierarchy(value) {
  const values = Object.values(value || {});
  if (values.length !== 6 || values.some(item => !Number.isSafeInteger(item) || item <= 0 || item > 90_000)
    || value.captureObservationMs > value.captureMs
    || value.operationMs <= value.navigationMs + value.captureMs + value.cleanupMs
    || value.httpRequestMs <= value.operationMs) {
    throw new Error('Invalid DaylightBrowser timeout hierarchy');
  }
  return value;
}

validateTimeoutHierarchy(DAYLIGHT_BROWSER_TIMEOUTS);
