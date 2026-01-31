/**
 * Lifelog Domain
 *
 * Foundational time-series personal data layer.
 * Provides extraction and summarization of harvested data from various sources.
 *
 * Consumers: health, fitness, journalist, entropy domains
 *
 * @module domains/lifelog
 */

// Entities
export * from './entities/index.mjs';

// Extractors
export * from './extractors/index.mjs';

// Services
export { LifelogAggregator } from './services/LifelogAggregator.mjs';
