/**
 * One trip's full recording — the raw evidence behind a journey.
 *
 * Returns the GPS track separately from the sample rows because they answer
 * different questions: the track draws a map, the samples draw the speed and
 * battery traces. Splitting them here keeps the client from filtering hundreds
 * of rows twice.
 *
 * @module automotive/usecases/GetTripDetail
 */

import { GeoFix } from '#domains/automotive/value-objects/GeoFix.mjs';
import { integrateSpeedKm } from '#domains/automotive/services/OdometerService.mjs';
import { EntityNotFoundError } from '#domains/core/errors/index.mjs';

export class GetTripDetail {
  #historyRepository;
  #logger;

  constructor({ historyRepository, logger = console }) {
    if (!historyRepository) throw new Error('GetTripDetail requires historyRepository');
    this.#historyRepository = historyRepository;
    this.#logger = logger;
  }

  /**
   * @param {object} input
   * @param {string} input.vehicleId
   * @param {string} input.file  path relative to the vehicle's trips/ dir
   * @returns {Promise<object>}
   */
  async execute({ vehicleId, file }) {
    const trip = await this.#historyRepository.readTrip(vehicleId, file);
    if (!trip) throw new EntityNotFoundError('Trip', file);

    const samples = Array.isArray(trip.samples) ? trip.samples : [];
    const track = [];
    for (const sample of samples) {
      const fix = GeoFix.fromRaw(sample);
      if (fix) track.push({ t: sample.t, lat: fix.lat, lon: fix.lon, speed_kph: sample.speed_kph ?? null });
    }

    // Speed-integrated distance is reported ALONGSIDE the stored haversine
    // figure rather than replacing it. They measure different things — wheels
    // versus satellites — and where they disagree, the disagreement is the
    // interesting signal, not something to resolve behind the reader's back.
    const integratedKm = integrateSpeedKm(samples);

    this.#logger.debug?.('automotive.trip.detail', {
      vehicleId, file, samples: samples.length, trackPoints: track.length,
    });

    return {
      meta: trip.meta || {},
      units: trip.units || {},
      track,
      samples,
      derived: {
        gps_distance_km: trip.meta?.distance_km ?? null,
        integrated_distance_km: integratedKm > 0 ? round(integratedKm, 3) : null,
        track_points: track.length,
        sample_count: samples.length,
      },
    };
  }
}

const round = (n, places) => Number(n.toFixed(places));
