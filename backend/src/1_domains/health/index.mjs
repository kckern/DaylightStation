/**
 * Health Domain
 *
 * Aggregates health data from multiple sources (weight, Strava,
 * FitnessSyncer, nutrition) into unified daily health metrics.
 *
 * @module domains/health
 */

// Entities
export { HealthMetric } from './entities/HealthMetric.mjs';
export { WorkoutEntry } from './entities/WorkoutEntry.mjs';

// Services
export { HealthAggregationService } from './services/HealthAggregationService.mjs';

// Ports moved to application layer - re-export for backward compatibility
export { IHealthDataDatastore } from '../../3_applications/health/ports/IHealthDataDatastore.mjs';
