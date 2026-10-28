/**
 * GetHomeEntities — every home entity the household's dashboard policy admits,
 * typed, placed in a room and classed by state — plus the house summary the
 * Now and Power views are built from (what is on, open, moving, low or silent,
 * and where the power goes), decided by the household's `now:` / `power:` policy.
 */

import {
  EntityCatalogPolicy, HomeEntity, HouseSummaryPolicy, MosaicPolicy, STATE_CLASSES, resolveRoom, summarizeHouse, arrangeMosaic, mergeShadows,
} from "../../../domain/home-automation/index.mjs";
import { toConfigurationError } from './configErrors.mjs';
import { loadRoomContext } from './roomContext.mjs';

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
   *   summary: ReturnType<typeof summarizeHouse>, mosaic: ReturnType<typeof arrangeMosaic>}>}
   */
  async execute() {
    const { policy, summaryPolicy, mosaicPolicy } = await this.#loadPolicy();
    // Readings first: when the platform is down there is no point rendering
    // the (more expensive) room template.
    const readings = await this.#entityGateway.listReadings();
    const roomCtx = await loadRoomContext(this.#entityGateway, policy, this.#logger);
    // The platform can add a room named like a merge at any time: warn (once
    // per load) and keep the groups apart, never fail the page over it.
    for (const shadow of mergeShadows(mosaicPolicy, roomCtx.roomNames.keys())) {
      this.#logger.warn?.('home.mosaic.merge_shadows_room', shadow);
    }

    const entities = [];
    for (const reading of readings) {
      const id = reading.entityId;
      const { deviceClass } = reading;
      if (!policy.admits(id, { deviceClass, hasRoom: roomCtx.hasRoom(id) })) continue;
      entities.push(HomeEntity.fromReading(reading, { policy, room: resolveRoom(id, roomCtx) }));
    }
    entities.sort((a, b) => a.name.localeCompare(b.name));

    // Rooms and types that have nothing in them are not views anyone wants.
    // Rooms read alphabetically: the platform's order is when each was created.
    const roomsById = new Map();
    for (const e of entities) if (e.room && !roomsById.has(e.room.id)) roomsById.set(e.room.id, { id: e.room.id, name: e.room.name });
    const rooms = [...roomsById.values()].sort((a, b) => a.name.localeCompare(b.name));
    const usedTypes = new Set(entities.map((e) => e.type));
    const types = policy.types.filter((t) => usedTypes.has(t.id));
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
      types,
      stateClasses: STATE_CLASSES,
      haUrl: policy.haUrl,
      summary,
      mosaic: arrangeMosaic(entities, mosaicPolicy, { types }),
    };
  }

  async #loadPolicy() {
    const config = await this.#configRepository.load();
    try {
      return {
        policy: EntityCatalogPolicy.fromConfig(config.entities),
        summaryPolicy: HouseSummaryPolicy.fromConfig({ now: config.now, power: config.power }),
        mosaicPolicy: MosaicPolicy.fromConfig(config.mosaic),
      };
    } catch (error) {
      // EntityCatalogPolicy's fields are bare ("exclude"); the summary and
      // mosaic policies' already carry their section ("now.x", "mosaic.hide").
      toConfigurationError(error, 'entities');
    }
  }
}

export default GetHomeEntities;
