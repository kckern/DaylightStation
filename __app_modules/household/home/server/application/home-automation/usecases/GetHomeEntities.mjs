/**
 * GetHomeEntities — every home entity the household's dashboard policy admits,
 * typed, placed in a room and classed by state, for the type/room/state views.
 */

import { ConfigurationError } from '#apps/common/errors/SemanticErrors.mjs';
import {
  EntityCatalogPolicy, HomeEntity, STATE_CLASSES, resolveRoom, buildRoomPrefixes,
} from "../../../domain/home-automation/index.mjs";

const NO_ROOMS = Object.freeze({ rooms: [], assignments: {} });

export class GetHomeEntities {
  #configRepository;
  #entityCatalog;
  #logger;

  constructor({ configRepository, entityCatalog, logger }) {
    if (!configRepository) throw new Error('GetHomeEntities: configRepository required');
    if (!entityCatalog)    throw new Error('GetHomeEntities: entityCatalog required');
    this.#configRepository = configRepository;
    this.#entityCatalog = entityCatalog;
    this.#logger = logger || console;
  }

  /**
   * @returns {Promise<{entities: HomeEntity[], rooms: Array, types: Array, stateClasses: Array, haUrl: string|null}>}
   */
  async execute() {
    const policy = await this.#loadPolicy();
    const [readings, roomData] = await Promise.all([
      this.#entityCatalog.listReadings(),
      this.#entityCatalog.listRooms().catch((error) => {
        this.#logger.warn?.('home.entities.rooms.failed', { error: error.message });
        return NO_ROOMS;
      }),
    ]);

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
      const deviceClass = reading.attributes?.device_class || null;
      const hasRoom = Boolean(roomCtx.overrides[id] || roomCtx.assignments[id]);
      if (!policy.admits(id, { deviceClass, hasRoom })) continue;
      entities.push(HomeEntity.fromReading(reading, { policy, room: resolveRoom(id, roomCtx) }));
    }
    entities.sort((a, b) => a.name.localeCompare(b.name));

    // Rooms and types that have nothing in them are not views anyone wants.
    const usedRooms = new Set(entities.map((e) => e.room?.id).filter(Boolean));
    const rooms = [
      ...roomData.rooms.filter((r) => usedRooms.has(r.id)),
      ...[...usedRooms].filter((id) => !roomNames.has(id))
        .map((id) => entities.find((e) => e.room?.id === id).room)
        .map(({ id, name }) => ({ id, name })),
    ];
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
      throw new ConfigurationError(`home dashboard config: ${error.message}`, { key: `entities.${error.field}`, value: error.value });
    }
  }
}

export default GetHomeEntities;
