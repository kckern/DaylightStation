/**
 * Fitness Application Ports
 *
 * Port interfaces for the fitness application layer.
 * These define contracts for infrastructure adapters.
 */

export { ISessionStore } from './ISessionStore.mjs';
export {
  IFitnessSyncerGateway,
  isFitnessSyncerGateway,
  assertFitnessSyncerGateway
} from './IFitnessSyncerGateway.mjs';
export { IZoneLedController } from './IZoneLedController.mjs';
