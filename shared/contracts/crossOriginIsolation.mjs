/**
 * Cross-origin isolation policy — which document paths are served
 * `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy:
 * credentialless`, so the page gets `self.crossOriginIsolated === true` and
 * with it SharedArrayBuffer (TF.js WASM threads for the Fitness pose detector).
 *
 * One definition, two servers: the Express backend (prod) and the Vite dev
 * server both resolve the policy here, so dev and prod cannot drift.
 *
 * Why a path list and not "everything": COEP changes how a page may embed
 * other origins (a cross-origin iframe without its own COEP header is blocked
 * outright in Firefox) and COOP severs `window.opener` across the boundary.
 * Only pages that need threads should pay for that.
 *
 * Why `/sim-panel.html` is in the default list: the Fitness app opens it with
 * `window.open` and the panel drives the app through `window.opener`. A popup
 * keeps its opener only when its COOP **and** COEP match the opener's, so the
 * panel has to be served the same pair as `/fitness`.
 */

export const CROSS_ORIGIN_ISOLATION_HEADERS = Object.freeze({
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
});

export const DEFAULT_ISOLATED_PATHS = Object.freeze(['/fitness', '/sim-panel.html']);

/** Env kill switch, honoured by both servers. Any of these values turns it off. */
export const CROSS_ORIGIN_ISOLATION_ENV = 'DAYLIGHT_CROSS_ORIGIN_ISOLATION';
const OFF_VALUES = new Set(['0', 'off', 'false', 'no', 'disabled']);

function normalizePath(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('/')) return null;
  // '/fitness/' and '/fitness' mean the same prefix; '/' alone would match
  // every path, which is a different decision from the one this flag makes.
  const stripped = trimmed.replace(/\/+$/, '');
  return stripped === '' ? null : stripped;
}

/**
 * Resolve the policy from the fitness household config and the environment.
 *
 * @param {object|null} fitnessConfig  household `fitness` app config (may be null)
 * @param {object} [env]               process.env-shaped object
 * @returns {{ enabled: boolean, paths: string[], source: string }}
 */
export function resolveCrossOriginIsolationPolicy(fitnessConfig, env = {}) {
  const envValue = env?.[CROSS_ORIGIN_ISOLATION_ENV];
  if (typeof envValue === 'string' && OFF_VALUES.has(envValue.trim().toLowerCase())) {
    return { enabled: false, paths: [], source: 'env' };
  }

  const block = fitnessConfig?.cross_origin_isolation;
  // Absent block, or a block without `enabled`, means ON: the default.
  // Only an explicit `enabled: false` turns it off.
  if (block && typeof block === 'object' && block.enabled === false) {
    return { enabled: false, paths: [], source: 'config' };
  }

  if (block && Array.isArray(block.paths)) {
    const paths = [...new Set(block.paths.map(normalizePath).filter(Boolean))];
    // A list that normalizes to nothing is a typo, not a decision to disable:
    // disabling has its own switch. Fall back to the defaults.
    if (paths.length > 0) return { enabled: true, paths, source: 'config' };
  }

  return { enabled: true, paths: [...DEFAULT_ISOLATED_PATHS], source: 'default' };
}

/**
 * True when `requestPath` is one of the isolated paths or sits beneath one.
 * Segment-aware: '/fitness' matches '/fitness' and '/fitness/menu/1', never
 * '/fitnessx' or '/api/v1/fitness'.
 */
export function isCrossOriginIsolatedPath(requestPath, paths = DEFAULT_ISOLATED_PATHS) {
  if (typeof requestPath !== 'string' || !Array.isArray(paths)) return false;
  return paths.some((prefix) => requestPath === prefix || requestPath.startsWith(`${prefix}/`));
}
