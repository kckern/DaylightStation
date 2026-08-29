/**
 * Fitness Application Ports
 *
 * Port interfaces for the fitness application layer.
 * These define contracts for infrastructure adapters.
 */

export { ISessionDatastore } from './ISessionDatastore.mjs';
export { IZoneLedController } from './IZoneLedController.mjs';
export { IActivityGateway, isActivityGateway } from './IActivityGateway.mjs';
export { ITimelapseArtifactStore } from './ITimelapseArtifactStore.mjs';
export { ISessionTrashStore } from './ISessionTrashStore.mjs';
export { IMenuMusicCatalog } from './IMenuMusicCatalog.mjs';
export { IFitnessContentCatalog } from './IFitnessContentCatalog.mjs';
