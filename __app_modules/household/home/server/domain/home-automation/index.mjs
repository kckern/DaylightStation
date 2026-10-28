/**
 * Home Automation Domain
 * @module home-automation
 *
 * Provider-agnostic home automation abstractions.
 */

export { EntityCatalogPolicy, ENTITY_TYPES } from './EntityCatalogPolicy.mjs';
export { HomeEntity, STATE_CLASSES, stateClassOf } from './HomeEntity.mjs';
export { resolveRoom, buildRoomPrefixes } from './resolveRoom.mjs';
export { HouseSummaryPolicy, summarizeHouse } from './HouseSummary.mjs';
