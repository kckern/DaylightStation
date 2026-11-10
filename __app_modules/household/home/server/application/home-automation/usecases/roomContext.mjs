/**
 * loadRoomContext — the rooms the platform knows and the household's room
 * policy, as the one context every home use case places entities with.
 *
 * Room data is best-effort: when the platform refuses it, entities are listed
 * without provider rooms rather than not at all.
 */

import { buildRoomPrefixes } from '../../../domain/home-automation/index.mjs';

const NO_ROOMS = Object.freeze({ rooms: [], assignments: {} });

/**
 * @param {Object} entityGateway - IHomeEntityGateway
 * @param {import('../../../domain/home-automation/EntityCatalogPolicy.mjs').EntityCatalogPolicy} policy
 * @param {Object} logger
 * @returns {Promise<{roomNames: Map<string,string>, assignments: Object, overrides: Object,
 *   prefixes: Array|null, hasRoom: (entityId: string) => boolean}>}
 */
export async function loadRoomContext(entityGateway, policy, logger) {
  const roomData = await entityGateway.listRooms().catch((error) => {
    logger.warn?.('home.entities.rooms.failed', { error: error.message });
    return NO_ROOMS;
  });
  const assignments = roomData.assignments || {};
  const overrides = policy.roomOverrides;
  return {
    roomNames: new Map(roomData.rooms.map((r) => [r.id, r.name])),
    assignments,
    overrides,
    prefixes: policy.inferRooms ? buildRoomPrefixes(roomData.rooms, policy.roomAliases) : null,
    // Placed by the household or the platform; an inferred room does not count.
    hasRoom: (entityId) => Boolean(overrides[entityId] || assignments[entityId]),
  };
}

export default loadRoomContext;
