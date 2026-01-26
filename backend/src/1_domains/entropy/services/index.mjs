/**
 * Entropy Services
 * @module entropy/services
 *
 * NOTE: EntropyService has been moved to the application layer
 * (backend/src/3_applications/entropy/services/) because it uses
 * infrastructure services (configService, logging).
 *
 * This index re-exports from the application layer for backward compatibility.
 */

export { EntropyService, createWithLegacyDependencies } from '../../../3_applications/entropy/services/EntropyService.mjs';
