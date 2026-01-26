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

// Ports moved to application layer - re-export for backward compatibility
export * from '../../3_applications/entropy/ports/index.mjs';

// Services
export * from './services/index.mjs';
