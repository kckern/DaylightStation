/**
 * Fill-ups the car recorded but nobody logged.
 *
 * The detector is the fuel gauge, not the map: a tank cannot refill itself, so
 * a rise between trips IS a purchase. That needs no place registry, no naming,
 * and works at a station you will never visit again — where the place-based
 * approach needs the station named in advance and can only say "you stopped
 * near a pump", which is not the same claim.
 *
 * Where a place IS known, it labels the fill rather than detecting it. The two
 * signals are complementary in exactly that order.
 *
 * @module automotive/usecases/GetFuelStops
 */

import { detectFillUps, unloggedFillUps } from '#domains/automotive/services/FuelStopDetectionService.mjs';
import { resolvePlace } from '#domains/automotive/services/PlaceResolverService.mjs';

export class GetFuelStops {
  #historyRepository;
  #recordRepository;
  #placeRepository;
  #config;
  #logger;

  constructor({ historyRepository, recordRepository, placeRepository, config = {}, logger = console }) {
    if (!historyRepository) throw new Error('GetFuelStops requires historyRepository');
    if (!recordRepository) throw new Error('GetFuelStops requires recordRepository');
    this.#historyRepository = historyRepository;
    this.#recordRepository = recordRepository;
    this.#placeRepository = placeRepository;
    this.#config = config;
    this.#logger = logger;
  }

  /**
   * @param {object} input
   * @param {string} input.vehicleId
   * @param {number} [input.tankCapacityL] enables the volume estimate
   * @returns {Promise<{detected: object[], unlogged: object[]}>}
   */
  async execute({ vehicleId, tankCapacityL = null }) {
    const [descriptors, fuelLogs, places] = await Promise.all([
      this.#historyRepository.listTripDescriptors(vehicleId, { withFixes: true }),
      this.#recordRepository.listFuelLogs(vehicleId),
      this.#placeRepository ? this.#placeRepository.listPlaces() : Promise.resolve([]),
    ]);

    const readings = descriptors.flatMap((d) => d.fuelReadings || []);
    const detected = detectFillUps(readings, {
      minRisePct: this.#config.minRisePct,
      tankCapacityL,
    });
    const unlogged = unloggedFillUps(detected, fuelLogs);

    // Where did it happen? The trip that FIRST saw the higher level began at the
    // station (or near it), so its start fix is the best available guess. This
    // only labels — it never gates whether the fill was detected.
    const startFixByTrip = new Map(descriptors.map((d) => [d.tripId, d.startFix]));

    this.#logger.debug?.('automotive.fuel.detected', {
      vehicleId, readings: readings.length, detected: detected.length, unlogged: unlogged.length,
    });

    const present = (fill) => {
      const place = resolvePlace(startFixByTrip.get(fill.afterTripId) || null, places);
      return {
        at: fill.at.toISOString(),
        not_before: fill.notBefore.toISOString(),
        date: fill.at.toISOString().slice(0, 10),
        from_pct: fill.fromPct,
        to_pct: fill.toPct,
        rise_pct: fill.risePct,
        estimated_volume_l: fill.estimatedVolumeL,
        filled_to_full: fill.filledToFull,
        place_id: place?.id || null,
        place_label: place?.label || null,
      };
    };

    return { detected: detected.map(present), unlogged: unlogged.map(present) };
  }
}
