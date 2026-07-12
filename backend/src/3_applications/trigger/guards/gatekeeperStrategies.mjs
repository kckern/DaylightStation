/**
 * Resolve a source's authorize policy into an ordered strategy list for the
 * `authorize` guard stage. Default (and 'auto-approve') → [] (approve). The seam
 * exists so future policies (rate-limit, allowlist) attach here.
 * @module applications/trigger/guards/gatekeeperStrategies
 */
export function gatekeeperStrategies(locationConfig = {}) {
  const policy = locationConfig?.authorize?.policy;
  if (!policy || policy === 'auto-approve') return [];
  return []; // unknown policies approve for now; concrete strategies added when needed
}
export default gatekeeperStrategies;
