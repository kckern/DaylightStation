/**
 * GetHomeEntities — every home entity the household's dashboard policy admits,
 * typed, placed in a room and classed by state — plus the house summary the
 * Now and Power views are built from (what is on, open, moving, low or silent,
 * and where the power goes), decided by the household's `now:` / `power:` policy.
 */

import { ConfigurationError } from '#apps/common/errors/SemanticErrors.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';
import {
  EntityCatalogPolicy, HomeEntity, HouseSummaryPolicy, STATE_CLASSES, resolveRoom, buildRoomPrefixes, summarizeHouse,
} from "../../../domain/home-automation/index.mjs";

const NO_ROOMS = Object.freeze({ rooms: [], assignments: {} });

export class GetHomeEntities {
  #configRepository;
  #entityGateway;
  #logger;
  #clock;

  /**
   * @param {Object} deps
   * @param {Object} deps.configRepository
   * @param {Object} deps.entityGateway
   * @param {Object} [deps.logger]
   * @param {() => number} [deps.clock] - the motion window needs a now
   */
  constructor({ configRepository, entityGateway, logger, clock = Date.now }) {
    if (!configRepository) throw new Error('GetHomeEntities: configRepository required');
    if (!entityGateway)    throw new Error('GetHomeEntities: entityGateway required');
    this.#configRepository = configRepository;
    this.#entityGateway = entityGateway;
    this.#logger = logger || console;
    this.#clock = clock;
  }

  /**
   * @returns {Promise<{entities: HomeEntity[], rooms: Array, types: Array, stateClasses: Array, haUrl: string|null,
   *   summary: ReturnType<typeof summarizeHouse>}>}
   */
  async execute() {
    const { policy, summaryPolicy } = await this.#loadPolicy();
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
    const summary = summarizeHouse(entities, summaryPolicy, { now: this.#clock() });

    this.#logger.debug?.('home.entities.listed', {
      readings: readings.length, shown: entities.length, rooms: rooms.length,
      unroomed: entities.filter((e) => !e.room).length,
      on: summary.on.length, open: summary.open.length, motion: summary.motion.length,
      lowBattery: summary.lowBattery.length, unavailable: summary.unavailable.length,
      wholeHouse: summary.power.wholeHouse?.entityId || null,
    });

    return {
      entities,
      rooms,
      types: policy.types.filter((t) => usedTypes.has(t.id)),
      stateClasses: STATE_CLASSES,
      haUrl: policy.haUrl,
      summary,
    };
  }

  async #loadPolicy() {
    const config = await this.#configRepository.load();
    try {
      return {
        policy: EntityCatalogPolicy.fromConfig(config.entities),
        summaryPolicy: HouseSummaryPolicy.fromConfig({ now: config.now, power: config.power }),
      };
    } catch (error) {
      // Only a rejected config is a config problem; anything else is a bug.
      if (!(error instanceof ValidationError)) throw error;
      // HouseSummaryPolicy's fields already carry their section ("now.x").
      const key = error.field?.includes('.') ? error.field : `entities.${error.field}`;
      throw new ConfigurationError(`home dashboard config: ${error.message}`, { key, value: error.value });
    }
  }
}

export default GetHomeEntities;
