import { useCallback, useEffect, useMemo } from 'react';
import { useSchoolApi } from '../runtime/useSchoolApi.js';
import { useSchoolSurface } from '../portal/SchoolSurface.jsx';
import { createSchoolResourceStore } from '../runtime/schoolResources.js';

const FILTERS = Object.freeze({ gateId: 'fitness.weekly-rings', periodKind: 'interval' });

/** Board and personal rewards share the surface's authoritative ring projection. */
export function useSchoolRingGates({ enabled = true } = {}) {
  const api = useSchoolApi(); const { surfaceId, deviceId, resourceStore } = useSchoolSurface();
  const privateStore = useMemo(createSchoolResourceStore, []); const store = resourceStore ?? privateStore;
  const key = useMemo(() => [surfaceId, deviceId, null, 'state-gates', FILTERS], [surfaceId, deviceId]);
  // The last consumer leaving aborts its read; the store lives with its surface.
  useEffect(() => enabled ? store.subscribe(key, () => {}) : undefined, [enabled, store, key]);
  return useCallback(async ({ fresh = false } = {}) => {
    const snapshot = await store.read(key, async (options) => {
      const result = typeof api.request === 'function'
        ? await api.request(`/api/v1/state-gates?${new URLSearchParams(FILTERS)}`, options)
        : await api.stateGates(FILTERS);
      return result?.ok && !Array.isArray(result.data?.items)
        ? { ok: false, status: result.status, data: null, error: { kind: 'invalid-data' } } : result;
    }, { fresh });
    return { ok: !snapshot.error && snapshot.lastSuccessAt !== null, status: snapshot.error?.status ?? 200, data: snapshot.data, stale: snapshot.stale, error: snapshot.error, lastSuccessAt: snapshot.lastSuccessAt };
  }, [store, key, api]);
}
export default useSchoolRingGates;
