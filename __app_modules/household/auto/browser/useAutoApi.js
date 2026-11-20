// frontend/src/modules/Auto/useAutoApi.js
//
// Auto's endpoint keys and write invalidation. The shared resource owns request
// lifetime. A stable key keeps the accepted same-vehicle result on a tab revisit.

import { invalidateApiResources, useApiResource } from '@/lib/hooks/useApiResource.js';
import { DaylightAPI } from "../../../../frontend/src/lib/api.mjs";
import autoLog from "./autoLog.js";

const vehiclesPath = 'api/v1/automotive/vehicles';
const vehiclePath = vehicleId => `${vehiclesPath}/${encodeURIComponent(vehicleId)}`;

export function useVehicles() {
  return useApiResource(vehiclesPath, { label: 'vehicles', logger: autoLog });
}

export function useOverview(vehicleId) {
  return useApiResource(
    vehicleId ? vehiclePath(vehicleId) : null,
    { enabled: Boolean(vehicleId), label: 'overview', logger: autoLog },
  );
}

export function useJourneys(vehicleId, { includeShuffles = false, enabled = true } = {}) {
  const query = includeShuffles ? '?shuffles=1' : '';
  return useApiResource(
    vehicleId ? `${vehiclePath(vehicleId)}/journeys${query}` : null,
    { enabled: enabled && Boolean(vehicleId), label: 'journeys', logger: autoLog },
  );
}

export function useFuel(vehicleId, { enabled = true } = {}) {
  return useApiResource(
    vehicleId ? `${vehiclePath(vehicleId)}/fuel` : null,
    { enabled: enabled && Boolean(vehicleId), label: 'fuel', logger: autoLog },
  );
}

export function useService(vehicleId, { enabled = true } = {}) {
  return useApiResource(
    vehicleId ? `${vehiclePath(vehicleId)}/service` : null,
    { enabled: enabled && Boolean(vehicleId), label: 'service', logger: autoLog },
  );
}

/**
 * The maintenance vocabulary. Household-scoped and config-driven, so the form's
 * options can be extended in vehicles.yml without a frontend deploy.
 */
export function useServiceTypes({ enabled = true } = {}) {
  return useApiResource('api/v1/automotive/service-types', { enabled, label: 'service-types', logger: autoLog });
}

export function useDocuments(vehicleId, { enabled = true } = {}) {
  return useApiResource(
    vehicleId ? `${vehiclePath(vehicleId)}/documents` : null,
    { enabled: enabled && Boolean(vehicleId), label: 'documents', logger: autoLog },
  );
}

// Fuel and service records also feed the originating car's overview (odometer,
// economy and reminders). Vehicle selection may change while the POST is pending.
async function logRecord(vehicleId, collection, body) {
  const overview = vehiclePath(vehicleId);
  const record = `${overview}/${collection}`;
  const saved = await DaylightAPI(record, body, 'POST');
  invalidateApiResources(path => path === overview || path === record);
  return saved;
}

export const autoApi = {
  logFuel: (vehicleId, body) => logRecord(vehicleId, 'fuel', body),
  logService: (vehicleId, body) => logRecord(vehicleId, 'service', body),
  async namePlace(body) {
    const saved = await DaylightAPI('api/v1/automotive/places', body, 'POST');
    // A household place labels journey points and detected fuel stops for every car.
    invalidateApiResources(path => /^api\/v1\/automotive\/vehicles\/[^/]+\/(?:fuel|journeys)(?:\?|$)/.test(path));
    return saved;
  },
  deleteFuel: (vehicleId, logId) =>
    DaylightAPI(`${vehiclePath(vehicleId)}/fuel/${logId}`, {}, 'DELETE'),
  deleteService: (vehicleId, recordId) =>
    DaylightAPI(`${vehiclePath(vehicleId)}/service/${recordId}`, {}, 'DELETE'),
};
