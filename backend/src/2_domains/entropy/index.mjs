/**
 * Entropy Domain
 *
 * Calculates data freshness/staleness for all configured sources.
 * High entropy = stale data, low entropy = fresh data.
 *
 * @module domains/entropy
 */

// Entities
export * from './entities/index.mjs';

// Services — EntropyService is in the application layer (3_applications/entropy/services/)
// See ./services/index.mjs for details.
