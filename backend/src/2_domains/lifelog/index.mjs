/**
 * Lifelog Domain
 *
 * Foundational time-series personal data layer.
 * Provides extraction and summarization of harvested data from various sources.
 *
 * Consumers: health, fitness, journalist, entropy domains
 *
 * Note: LifelogAggregator has moved to the application layer (3_applications/lifelog)
 * because it orchestrates I/O. Import from '#apps/lifelog/LifelogAggregator.mjs'.
 *
 * @module domains/lifelog
 */

// Entities
export * from './entities/index.mjs';

// Extractors
export * from './extractors/index.mjs';
