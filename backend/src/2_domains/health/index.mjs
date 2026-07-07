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

// Services (pure)
export { HealthAggregator } from './services/HealthAggregationService.mjs';

// Note: The archive + analytics services (WeightProcessor, HealthAnalyticsService,
// MetricAggregator/Comparator/TrendAnalyzer, Period*, HistoryReflector,
// CalibrationConstants, HealthArchive*) have moved to the application layer
// because they orchestrate I/O (injected stores + fs + fetch). Import from
// '#apps/health/analytics/...' and '#apps/health/archive/...'. (P2.1, audit D-2/D-4)
