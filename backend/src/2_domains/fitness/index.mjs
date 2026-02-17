/**
 * Fitness Domain
 */

// Value Objects
export * from './value-objects/index.mjs';

// Entities
export { Session } from './entities/Session.mjs';
export { Participant } from './entities/Participant.mjs';
export {
  Zone,
  ZONE_NAMES,
  ZONE_PRIORITY,
  resolveZone,
  getHigherZone,
  createDefaultZones
} from './entities/Zone.mjs';

// Services
export { ZoneService } from './services/ZoneService.mjs';
export { FitnessProgressClassifier } from './services/FitnessProgressClassifier.mjs';
