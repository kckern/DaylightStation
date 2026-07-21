/**
 * `useGovernanceExemptions` — read `governance.exemptions` (usernames) from the
 * fitness config.
 *
 * Consumers are presentation-layer (the coin chart's scale basis), so this is
 * deliberately cheap: the request is de-duplicated at module scope, so N chart
 * mounts share ONE fetch and each mount pays at most a single extra render when
 * it resolves. Do not turn this into a per-render fetch — the chart is already
 * render-sensitive.
 */
import { useEffect, useState } from 'react';
import { DaylightAPI } from '@/lib/api.mjs';
import getLogger from '@/lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'governance-exemptions' });
  return _logger;
}

const EMPTY = Object.freeze([]);

/** Module-scoped so concurrent mounts share one in-flight request. */
let cachedPromise = null;

function fetchExemptions() {
  if (!cachedPromise) {
    cachedPromise = DaylightAPI('/api/v1/fitness')
      .then((config) => {
        const list = config?.governance?.exemptions;
        const exemptions = Array.isArray(list) ? list : EMPTY;
        logger().debug('exemptions.loaded', { count: exemptions.length });
        return exemptions;
      })
      .catch((error) => {
        // Non-fatal: without exemptions the scale simply keeps its old
        // everyone-counts behaviour. Clear the cache so a later mount retries.
        logger().warn('exemptions.load_failed', { error: error?.message });
        cachedPromise = null;
        return EMPTY;
      });
  }
  return cachedPromise;
}

/**
 * @returns {string[]} exempt usernames, or [] until loaded / on failure
 */
export function useGovernanceExemptions() {
  const [exemptions, setExemptions] = useState(EMPTY);

  useEffect(() => {
    let cancelled = false;
    fetchExemptions().then((list) => {
      // Skip the state write when nothing changed, so a chart that mounts after
      // the cache is warm does not pay an extra render.
      if (!cancelled && list.length > 0) setExemptions(list);
    });
    return () => { cancelled = true; };
  }, []);

  return exemptions;
}

/** Test seam — drop the module-level cache. */
export function __resetExemptionsCache() {
  cachedPromise = null;
}

export default useGovernanceExemptions;
