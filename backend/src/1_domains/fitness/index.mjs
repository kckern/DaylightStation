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
export { SessionService } from './services/SessionService.mjs';
export { ZoneService } from './services/ZoneService.mjs';

// Ports (re-exported from application layer for backward compatibility)
export { ISessionDatastore } from '#apps/fitness/ports/ISessionDatastore.mjs';
