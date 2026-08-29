const DEFAULT_TIMEOUT_MS = 120_000;
const SERVICE_TIMEOUTS_MS = Object.freeze({
  fitness: 180_000,
  strava: 180_000,
  health: 180_000,
  budget: 240_000,
  gmail: 180_000,
  shopping: 300_000,
});

export function configuredHarvesterTimeout(serviceId) {
  return SERVICE_TIMEOUTS_MS[serviceId] || DEFAULT_TIMEOUT_MS;
}

export default configuredHarvesterTimeout;
