import { daylightApiResponse } from '../../../../../../../frontend/src/lib/api.mjs';
import { useEffect, useState, useCallback, useRef } from 'react';

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

  const pending = useRef(null);
  const mounted = useRef(false);
  const revalidate = useCallback(async () => {
    if (!mounted.current) return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setState((s) => ({ ...s, loading: true }));
    try {
      const r = await daylightApiResponse('/api/v1/playback-hub/config', { signal: controller.signal });
      const body = await r.json();
      if (controller.signal.aborted) return;
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
      if (controller.signal.aborted) return;
      setState({ config: null, loading: false, error: err.message });
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    revalidate();
    return () => {
      mounted.current = false;
      pending.current?.abort();
    };
  }, [revalidate]);

  return {
    config: state.config,
    loading: state.loading,
    error: state.error,
    revalidate,
  };
}

export default useHubConfig;
