/**
 * Gratitude Domain
 * @module domains/gratitude
 *
 * Domain for managing gratitude and hopes items.
 * Supports user selections, print tracking, and snapshots.
 */

// Entities
export { GratitudeItem } from './entities/GratitudeItem.mjs';
export { Selection } from './entities/Selection.mjs';

// Ports moved to application layer - re-export for backward compatibility
export { IGratitudeStore, isGratitudeStore } from '../../3_applications/gratitude/ports/IGratitudeStore.mjs';

// Services
export { GratitudeService } from './services/GratitudeService.mjs';
