/**
 * GetHomeEntities — every home entity the household's dashboard policy admits,
 * typed, placed in a room and classed by state, for the type/room/state views.
 */

import { ConfigurationError } from '#apps/common/errors/SemanticErrors.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';
import {
  EntityCatalogPolicy, HomeEntity, STATE_CLASSES, resolveRoom, buildRoomPrefixes,
} from "../../../domain/home-automation/index.mjs";

const NO_ROOMS = Object.freeze({ rooms: [], assignments: {} });

export class GetHomeEntities {
  #configRepository;
  #entityGateway;
  #logger;

  constructor({ configRepository, entityGateway, logger }) {
    if (!configRepository) throw new Error('GetHomeEntities: configRepository required');
    if (!entityGateway)    throw new Error('GetHomeEntities: entityGateway required');
    this.#configRepository = configRepository;
    this.#entityGateway = entityGateway;
    this.#logger = logger || console;
  }

  /**
   * @returns {Promise<{entities: HomeEntity[], rooms: Array, types: Array, stateClasses: Array, haUrl: string|null}>}
   */
  async execute() {
    const policy = await this.#loadPolicy();
    // Readings first: when the platform is down there is no point rendering
    // the (more expensive) room template.
    const readings = await this.#entityGateway.listReadings();
    const roomData = await this.#entityGateway.listRooms().catch((error) => {
      this.#logger.warn?.('home.entities.rooms.failed', { error: error.message });
      return NO_ROOMS;
    });

    const roomNames = new Map(roomData.rooms.map((r) => [r.id, r.name]));
    const roomCtx = {
      roomNames,
      assignments: roomData.assignments,
      overrides: policy.roomOverrides,
      prefixes: policy.inferRooms ? buildRoomPrefixes(roomData.rooms, policy.roomAliases) : null,
    };

    const entities = [];
    for (const reading of readings) {
      const id = reading.entityId;
      const { deviceClass } = reading;
      const hasRoom = Boolean(roomCtx.overrides[id] || roomCtx.assignments[id]);
      if (!policy.admits(id, { deviceClass, hasRoom })) continue;
      entities.push(HomeEntity.fromReading(reading, { policy, room: resolveRoom(id, roomCtx) }));
    }
    entities.sort((a, b) => a.name.localeCompare(b.name));

    // Rooms and types that have nothing in them are not views anyone wants.
    // Rooms read alphabetically: the platform's order is when each was created.
    const roomsById = new Map();
    for (const e of entities) if (e.room && !roomsById.has(e.room.id)) roomsById.set(e.room.id, { id: e.room.id, name: e.room.name });
    const rooms = [...roomsById.values()].sort((a, b) => a.name.localeCompare(b.name));
    const usedTypes = new Set(entities.map((e) => e.type));

    this.#logger.debug?.('home.entities.listed', {
      readings: readings.length, shown: entities.length, rooms: rooms.length,
      unroomed: entities.filter((e) => !e.room).length,
    });

    return {
      entities,
      rooms,
      types: policy.types.filter((t) => usedTypes.has(t.id)),
      stateClasses: STATE_CLASSES,
      haUrl: policy.haUrl,
    };
  }

  async #loadPolicy() {
    const config = await this.#configRepository.load();
    try {
      return EntityCatalogPolicy.fromConfig(config.entities);
    } catch (error) {
      // Only a rejected config is a config problem; anything else is a bug.
      if (!(error instanceof ValidationError)) throw error;
      throw new ConfigurationError(`home dashboard config: ${error.message}`, { key: `entities.${error.field}`, value: error.value });
    }
  }
}

export default GetHomeEntities;
