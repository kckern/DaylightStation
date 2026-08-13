/**
 * Composition for the automotive application.
 *
 * Resolves the two roots this bounded context reads from — the relay-owned
 * history tree and the app-owned records tree — and wires the use cases against
 * YAML adapters.
 *
 * The history root is taken from `config/vehicles.yml` (`persistence.dir`)
 * rather than hardcoded, because the relay reads the same key and the two must
 * never disagree about where trips live.
 *
 * @module automotive/AutomotiveContainer
 */

import path from 'path';
import { YamlVehicleHistoryDatastore } from '#adapters/persistence/yaml/YamlVehicleHistoryDatastore.mjs';
import { YamlVehicleRecordDatastore } from '#adapters/persistence/yaml/YamlVehicleRecordDatastore.mjs';
import { YamlPlaceDatastore } from '#adapters/persistence/yaml/YamlPlaceDatastore.mjs';
import { ListJourneys } from './usecases/ListJourneys.mjs';
import { GetVehicleOverview } from './usecases/GetVehicleOverview.mjs';
import { GetTripDetail } from './usecases/GetTripDetail.mjs';
import { LogFuel } from './usecases/LogFuel.mjs';
import { LogServiceRecord } from './usecases/LogServiceRecord.mjs';
import { NamePlace } from './usecases/NamePlace.mjs';
import { GetFuelStops } from './usecases/GetFuelStops.mjs';
import { resolveServiceTypes } from '#domains/automotive/entities/serviceTypes.mjs';

const DEFAULT_HISTORY_DIR = 'household/history/automotive';
const DEFAULT_RECORDS_DIR = 'household/automotive';

export class AutomotiveContainer {
  #historyRepository;
  #recordRepository;
  #placeRepository;
  #useCases;
  #vehicleDefs;
  #serviceTypes;

  /**
   * @param {object} deps
   * @param {object} deps.configService
   * @param {object} [deps.vehiclesConfig] parsed config/vehicles.yml
   * @param {object} [deps.logger]
   */
  constructor({ configService, vehiclesConfig = {}, logger = console }) {
    if (!configService) throw new Error('AutomotiveContainer requires configService');

    const dataDir = configService.getDataDir();
    const historyDir = (vehiclesConfig?.persistence?.dir || DEFAULT_HISTORY_DIR).replace(/^\/+/, '');
    const historyRoot = path.join(dataDir, ...historyDir.split('/'));
    const recordsRoot = path.join(dataDir, ...DEFAULT_RECORDS_DIR.split('/'));

    this.#historyRepository = new YamlVehicleHistoryDatastore({ historyRoot, logger });
    this.#recordRepository = new YamlVehicleRecordDatastore({ recordsRoot, logger });
    this.#placeRepository = new YamlPlaceDatastore({ recordsRoot, logger });

    this.#vehicleDefs = vehiclesConfig?.vehicles || {};
    // Household-extensible without a deploy — `service_types:` in vehicles.yml.
    this.#serviceTypes = resolveServiceTypes(vehiclesConfig?.service_types);
    const journeyConfig = vehiclesConfig?.journeys || {};

    this.#useCases = {
      listJourneys: new ListJourneys({
        historyRepository: this.#historyRepository,
        placeRepository: this.#placeRepository,
        config: {
          dwellThresholdS: journeyConfig.dwell_threshold_s,
          shuffleFloorKm: journeyConfig.shuffle_floor_km,
          minStopS: journeyConfig.min_stop_s,
          windowDays: journeyConfig.window_days,
        },
        logger,
      }),
      getVehicleOverview: new GetVehicleOverview({
        historyRepository: this.#historyRepository,
        recordRepository: this.#recordRepository,
        logger,
      }),
      getTripDetail: new GetTripDetail({ historyRepository: this.#historyRepository, logger }),
      logFuel: new LogFuel({ recordRepository: this.#recordRepository, logger }),
      logServiceRecord: new LogServiceRecord({ recordRepository: this.#recordRepository, logger }),
      namePlace: new NamePlace({ placeRepository: this.#placeRepository, logger }),
      getFuelStops: new GetFuelStops({
        historyRepository: this.#historyRepository,
        recordRepository: this.#recordRepository,
        placeRepository: this.#placeRepository,
        config: { minRisePct: vehiclesConfig?.fuel?.min_rise_pct },
        logger,
      }),
    };
  }

  /**
   * The human name for a vehicle.
   *
   * `vehicles.yml` already carries a `label` for each car (the relay reads the
   * same file), so the app should use it rather than showing the directory id.
   * A vehicle known only to the records tree has no entry there, hence the
   * fallback chain ending at the id itself.
   */
  vehicleLabel(vehicleId, record = null) {
    return this.#vehicleDefs[vehicleId]?.label || record?.label || vehicleId;
  }

  /**
   * Tank size, for turning a gauge rise into gallons.
   *
   * Per-vehicle config (`tank_capacity_l`) rather than a looked-up spec: this
   * is a number that must be RIGHT, and a wrong one produces confident, wrong
   * volume estimates on every detected fill. Absent, the estimate is omitted —
   * see `feedback_dont_assert_unverified_device_facts`.
   */
  tankCapacityL(vehicleId) {
    const value = Number(this.#vehicleDefs[vehicleId]?.tank_capacity_l);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  /** The maintenance vocabulary the service form offers. */
  get serviceTypes() { return this.#serviceTypes; }

  get historyRepository() { return this.#historyRepository; }
  get recordRepository() { return this.#recordRepository; }
  get placeRepository() { return this.#placeRepository; }
  get useCases() { return this.#useCases; }

  /**
   * Every vehicle known to either tree.
   *
   * A vehicle can exist in one and not the other, and both cases are ordinary:
   * a car with an OBD device but no paperwork entered yet appears only in
   * history, and a second car with no device appears only in records. The
   * garage list is the union, so neither is invisible.
   *
   * @returns {Promise<string[]>}
   */
  async listVehicleIds() {
    const [fromHistory, fromRecords] = await Promise.all([
      this.#historyRepository.listVehicleIds(),
      this.#recordRepository.listVehicleIds(),
    ]);
    return [...new Set([...fromHistory, ...fromRecords])].sort();
  }
}
