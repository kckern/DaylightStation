//
// The house { data, loading, error, reload } fetch hook — promoted from
// modules/Auto/useAutoApi.js (same semantics: a request whose component
// unmounted mid-flight is discarded rather than written to state).
import { useCallback, useEffect, useState } from 'react';
import { DaylightAPI } from '../api.mjs';
import { createAppLogger } from '../ui/createAppLogger.js';

const defaultLogger = createAppLogger('ds');

export function useApiResource(path, { deps = [], enabled = true, label, logger = defaultLogger } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(Boolean(enabled && path));
  const [error, setError] = useState(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!enabled || !path) { setLoading(false); return undefined; }
    let live = true;
    setLoading(true);
    setError(null);

    const startedAt = performance.now();
    DaylightAPI(path)
      .then((result) => {
        if (!live) return;
        setData(result);
        setLoading(false);
        logger.debug('api.loaded', { resource: label || path, ms: Math.round(performance.now() - startedAt) });
      })
      .catch((err) => {
        if (!live) return;
        setError(err);
        setLoading(false);
        logger.warn('api.failed', { resource: label || path, error: err?.message });
      });

    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, enabled, nonce, ...deps]);

  return { data, loading, error, reload };
}

export default useApiResource;
