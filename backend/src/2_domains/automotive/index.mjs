/**
 * Automotive domain barrel export.
 *
 * Level 2 (Features) in the domain hierarchy — see
 * `docs/reference/core/layers-of-abstraction/ddd-reference.md`.
 *
 * @module automotive
 */

// Value Objects
export { GeoFix } from './value-objects/GeoFix.mjs';
export { Place, PLACE_KINDS, DEFAULT_RADIUS_M } from './value-objects/Place.mjs';
export { OdometerReading, ODOMETER_SOURCES } from './value-objects/OdometerReading.mjs';

// Entities
export { Journey } from './entities/Journey.mjs';
export { FuelLog } from './entities/FuelLog.mjs';
export { ServiceRecord, addMonths } from './entities/ServiceRecord.mjs';
export { Document, DOCUMENT_KINDS } from './entities/Document.mjs';
export { DEFAULT_SERVICE_TYPES, resolveServiceTypes, humanize } from './entities/serviceTypes.mjs';

// Services — journeys and places
export {
  stitchJourneys,
  DEFAULT_DWELL_THRESHOLD_S,
  DEFAULT_SHUFFLE_FLOOR_KM,
  DEFAULT_MIN_STOP_S,
} from './services/JourneyStitchService.mjs';
export { resolvePlace, isAtFuelStop } from './services/PlaceResolverService.mjs';

// Services — mileage
export {
  accumulateCounter,
  integrateSpeedKm,
  estimateOdometer,
  COUNTER_MODULUS_KM,
  ROLLOVER_MARGIN_KM,
} from './services/OdometerService.mjs';

// Services — fuel and reminders
export { computeEconomyIntervals, summarizeFuel } from './services/FuelEconomyService.mjs';
export { detectFillUps, unloggedFillUps, DEFAULT_MIN_RISE_PCT } from './services/FuelStopDetectionService.mjs';
export { buildReminders, DEFAULT_DUE_SOON_DAYS } from './services/ReminderService.mjs';
