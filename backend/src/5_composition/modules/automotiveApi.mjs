// backend/src/5_composition/modules/automotiveApi.mjs
//
// Composition wiring for the Automotive API — the vehicle record system that
// reads the obd-relay's history tree and the household's hand-entered service,
// fuel, and glove-box records. Follows the economyApi module pattern.
//
// The vehicles config is passed through rather than re-read here: the relay
// (3_applications/hardware/automotiveRelay.mjs) already loads it to decide
// where trips are persisted, and the two MUST agree about that path or the app
// reads an empty tree while the device writes happily into another one.

import { AutomotiveContainer } from '#apps/automotive/AutomotiveContainer.mjs';
import { AutomotiveQueryService } from '#apps/automotive/AutomotiveQueryService.mjs';
import { AutomotiveCommandService } from '#apps/automotive/AutomotiveCommandService.mjs';
import { createAutomotiveRouter } from '#api/v1/routers/automotive.mjs';
import { summarizeFuel } from '#domains/automotive/services/FuelEconomyService.mjs';
import path from 'node:path';
import { YamlVehicleHistoryDatastore } from '#adapters/persistence/yaml/YamlVehicleHistoryDatastore.mjs';
import { YamlVehicleRecordDatastore } from '#adapters/persistence/yaml/YamlVehicleRecordDatastore.mjs';
import { YamlPlaceDatastore } from '#adapters/persistence/yaml/YamlPlaceDatastore.mjs';

/**
 * Create the automotive container + API router.
 * @param {Object} deps
 * @param {Object} deps.configService
 * @param {Object} [deps.vehiclesConfig] parsed config/vehicles.yml
 * @param {Object} [deps.logger]
 * @returns {{ automotiveContainer: AutomotiveContainer, router: import('express').Router }}
 */
export function createAutomotiveApi({ configService, vehiclesConfig = {}, logger = console }) {
  // Storage locations are resolved HERE, at the wiring seam, and handed down
  // absolute — the container used to build them from literals itself.
  const override = vehiclesConfig?.persistence?.dir;
  const dataDir = configService.getDataDir();
  const historyRoot = override
    ? path.join(dataDir, ...String(override).replace(/^\/+/, '').split('/'))
    : configService.getHouseholdPath('automotive/log');
  const recordsRoot = configService.getHouseholdPath('automotive');
  // Bootstrap constructs the concrete adapters (D1) and resolves where they
  // read from; the container receives ports, not classes.
  const automotiveContainer = new AutomotiveContainer({
    historyRepository: new YamlVehicleHistoryDatastore({ historyRoot, logger }),
    recordRepository: new YamlVehicleRecordDatastore({ recordsRoot, logger }),
    placeRepository: new YamlPlaceDatastore({ recordsRoot, logger }),
    vehiclesConfig,
    logger,
  });
  const automotiveQuery = new AutomotiveQueryService({ container: automotiveContainer, summarizeFuel });
  const automotiveCommands = new AutomotiveCommandService({ container: automotiveContainer });
  return {
    automotiveContainer,
    router: createAutomotiveRouter({ automotiveQuery, automotiveCommands, logger }),
  };
}

export default createAutomotiveApi;
