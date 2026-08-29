/**
 * Composition for the automotive application.
 *
 * Resolves the two roots this bounded context reads from — the relay-owned
 * history tree and the app-owned records tree — and wires the use cases against
 * YAML adapters.
 *
 * @module automotive/AutomotiveContainer
 */

import { ListJourneys } from './usecases/ListJourneys.mjs';
import { GetVehicleOverview } from './usecases/GetVehicleOverview.mjs';
import { GetTripDetail } from './usecases/GetTripDetail.mjs';
import { LogFuel } from './usecases/LogFuel.mjs';
import { LogServiceRecord } from './usecases/LogServiceRecord.mjs';
import { NamePlace } from './usecases/NamePlace.mjs';
import { GetFuelStops } from './usecases/GetFuelStops.mjs';
import { resolveServiceTypes } from '#domains/automotive/entities/serviceTypes.mjs';


export class AutomotiveContainer {
  #historyRepository;
  #recordRepository;
  #placeRepository;
  #useCases;
  #vehicleDefs;
  #serviceTypes;

  /**
   * @param {object} deps
   * @param {object} [deps.vehiclesConfig] resolved vehicle policy projection
   * @param {object} [deps.logger]
   */
/**
 * Repositories are INJECTED, not constructed here.
 *
 * This container used to import three concrete Yaml datastores and build
 * their paths from `household/<domain>` literals. Both are ruled out:
 * Decision D1 says a Container never imports a concrete adapter — no
 * exceptions — and application-layer-guidelines.md says the application layer
 * never builds file paths. Bootstrap constructs the adapters, resolves their
 * locations, and passes them in.
 */
  constructor({
    historyRepository, recordRepository, placeRepository,
    vehiclesConfig = {}, logger = console,
  }) {
    if (!historyRepository || !recordRepository || !placeRepository) {
      throw new Error('AutomotiveContainer requires historyRepository, recordRepository and placeRepository');
    }

    this.#historyRepository = historyRepository;
    this.#recordRepository = recordRepository;
    this.#placeRepository = placeRepository;

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
