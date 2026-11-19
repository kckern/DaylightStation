import { daylightApiResponse } from '../../../../../../../frontend/src/lib/api.mjs';
import { useRefreshableRead } from '../../../../../../../frontend/src/lib/hooks/useRefreshableRead.js';
import { useEffect, useState, useCallback } from 'react';

/**
 * SWR-style read for the playback-hub config aggregate.
 *
 * Fetches GET /api/v1/playback-hub/config once on mount and exposes a
 * `revalidate()` function so write paths (updateDevice, saveFire,
 * deleteFire) can refresh after a successful mutation.
 *
 * The returned `config` shape matches `HubConfig.toYaml()` — the raw YAML
 * structure with `devices: [...]` and `scheduled: [...]` arrays.
 *
 * @returns {{
 *   config: object | null,
 *   loading: boolean,
 *   error: string | null,
 *   revalidate: () => Promise<void>,
 * }}
 */
export function useHubConfig() {
  const [state, setState] = useState({
    config: null,
    loading: true,
    error: null,
  });

  const readConfig = useCallback(async (isCurrent, signal) => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const r = await daylightApiResponse('/api/v1/playback-hub/config', { signal });
      const body = await r.json();
      if (!isCurrent()) return;
      if (!r.ok || body?.ok === false) {
        setState({
          config: null,
          loading: false,
          error: body?.error || `HTTP ${r.status}`,
        });
        return;
      }
      setState({ config: body.config, loading: false, error: null });
    } catch (err) {
      if (!isCurrent()) return;
      setState({ config: null, loading: false, error: err.message });
    }
  }, []);

  const { reload: revalidate } = useRefreshableRead(readConfig);
  useEffect(() => { revalidate(); }, [revalidate]);

  return {
    config: state.config,
    loading: state.loading,
    error: state.error,
    revalidate,
  };
}

export default useHubConfig;
