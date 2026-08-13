// frontend/src/modules/Auto/useAutoApi.js
//
// Data access for the Auto app. One hook per resource, each returning the same
// { data, loading, error, reload } shape so the panels stay uniform.

import { useCallback, useEffect, useState } from 'react';
import { DaylightAPI } from '../../lib/api.mjs';
import autoLog from './autoLog.js';

/**
 * Fetch a path, re-fetching when `deps` change.
 *
 * A request whose component unmounted mid-flight is DISCARDED rather than
 * written to state — on a phone, tab switches while a request is in the air are
 * the normal case, not an edge case, and a late response landing in a stale
 * panel shows the previous vehicle's numbers under the current one's heading.
 */
function useApiResource(path, { deps = [], enabled = true, label } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(Boolean(enabled));
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
        autoLog.debug('api.loaded', {
          resource: label || path, ms: Math.round(performance.now() - startedAt),
        });
      })
      .catch((err) => {
        if (!live) return;
        setError(err);
        setLoading(false);
        autoLog.warn('api.failed', { resource: label || path, error: err?.message });
      });

    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, enabled, nonce, ...deps]);

  return { data, loading, error, reload };
}

export function useVehicles() {
  return useApiResource('api/v1/automotive/vehicles', { label: 'vehicles' });
}

export function useOverview(vehicleId) {
  return useApiResource(
    vehicleId ? `api/v1/automotive/vehicles/${vehicleId}` : null,
    { enabled: Boolean(vehicleId), label: 'overview' },
  );
}

export function useJourneys(vehicleId, { includeShuffles = false } = {}) {
  const query = includeShuffles ? '?shuffles=1' : '';
  return useApiResource(
    vehicleId ? `api/v1/automotive/vehicles/${vehicleId}/journeys${query}` : null,
    { enabled: Boolean(vehicleId), deps: [includeShuffles], label: 'journeys' },
  );
}

export function useFuel(vehicleId) {
  return useApiResource(
    vehicleId ? `api/v1/automotive/vehicles/${vehicleId}/fuel` : null,
    { enabled: Boolean(vehicleId), label: 'fuel' },
  );
}

export function useService(vehicleId) {
  return useApiResource(
    vehicleId ? `api/v1/automotive/vehicles/${vehicleId}/service` : null,
    { enabled: Boolean(vehicleId), label: 'service' },
  );
}

/**
 * The maintenance vocabulary. Household-scoped and config-driven, so the form's
 * options can be extended in vehicles.yml without a frontend deploy.
 */
export function useServiceTypes() {
  return useApiResource('api/v1/automotive/service-types', { label: 'service-types' });
}

export function useDocuments(vehicleId) {
  return useApiResource(
    vehicleId ? `api/v1/automotive/vehicles/${vehicleId}/documents` : null,
    { enabled: Boolean(vehicleId), label: 'documents' },
  );
}

/** Write helpers. Each resolves to the saved record so a panel can reload after. */
export const autoApi = {
  logFuel: (vehicleId, body) =>
    DaylightAPI(`api/v1/automotive/vehicles/${vehicleId}/fuel`, body, 'POST'),
  logService: (vehicleId, body) =>
    DaylightAPI(`api/v1/automotive/vehicles/${vehicleId}/service`, body, 'POST'),
  namePlace: (body) => DaylightAPI('api/v1/automotive/places', body, 'POST'),
  deleteFuel: (vehicleId, logId) =>
    DaylightAPI(`api/v1/automotive/vehicles/${vehicleId}/fuel/${logId}`, {}, 'DELETE'),
  deleteService: (vehicleId, recordId) =>
    DaylightAPI(`api/v1/automotive/vehicles/${vehicleId}/service/${recordId}`, {}, 'DELETE'),
};
