/**
 * Health Domain
 *
 * Aggregates health data from multiple sources (weight, Strava, Garmin,
 * FitnessSyncer, nutrition) into unified daily health metrics.
 *
 * @module domains/health
 */

// Entities
export { HealthMetric } from './entities/HealthMetric.mjs';
export { WorkoutEntry } from './entities/WorkoutEntry.mjs';

// Services
export { HealthAggregationService } from './services/HealthAggregationService.mjs';

// Ports
export { IHealthDataStore } from './ports/IHealthDataStore.mjs';
