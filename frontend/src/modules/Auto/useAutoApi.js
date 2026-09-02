// frontend/src/modules/Auto/useAutoApi.js
//
// Data access for the Auto app. One hook per resource, each returning the same
// { data, loading, error, reload } shape so the panels stay uniform.
//
// The fetch primitive itself is the house `useApiResource` (lib/hooks) — this
// module was its donor (same discard-stale-request-on-unmount semantics), so
// promoting to the shared import changes nothing behaviorally; each resource
// hook just passes `logger: autoLog` to keep the app.auto tag on its events.

import { useApiResource } from '@/lib/hooks/useApiResource.js';
import { DaylightAPI } from '../../lib/api.mjs';
import autoLog from './autoLog.js';

export function useVehicles() {
  return useApiResource('api/v1/automotive/vehicles', { label: 'vehicles', logger: autoLog });
}

export function useOverview(vehicleId) {
  return useApiResource(
    vehicleId ? `api/v1/automotive/vehicles/${vehicleId}` : null,
    { enabled: Boolean(vehicleId), label: 'overview', logger: autoLog },
  );
}

export function useJourneys(vehicleId, { includeShuffles = false } = {}) {
  const query = includeShuffles ? '?shuffles=1' : '';
  return useApiResource(
    vehicleId ? `api/v1/automotive/vehicles/${vehicleId}/journeys${query}` : null,
    { enabled: Boolean(vehicleId), deps: [includeShuffles], label: 'journeys', logger: autoLog },
  );
}

export function useFuel(vehicleId) {
  return useApiResource(
    vehicleId ? `api/v1/automotive/vehicles/${vehicleId}/fuel` : null,
    { enabled: Boolean(vehicleId), label: 'fuel', logger: autoLog },
  );
}

export function useService(vehicleId) {
  return useApiResource(
    vehicleId ? `api/v1/automotive/vehicles/${vehicleId}/service` : null,
    { enabled: Boolean(vehicleId), label: 'service', logger: autoLog },
  );
}

/**
 * The maintenance vocabulary. Household-scoped and config-driven, so the form's
 * options can be extended in vehicles.yml without a frontend deploy.
 */
export function useServiceTypes() {
  return useApiResource('api/v1/automotive/service-types', { label: 'service-types', logger: autoLog });
}

export function useDocuments(vehicleId) {
  return useApiResource(
    vehicleId ? `api/v1/automotive/vehicles/${vehicleId}/documents` : null,
    { enabled: Boolean(vehicleId), label: 'documents', logger: autoLog },
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
