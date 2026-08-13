/**
 * Turn a window of device trips into the timeline the app shows.
 *
 * Orchestration only: stitching lives in `JourneyStitchService`, place matching
 * in `PlaceResolverService`. This use case reads, calls them in order, and
 * shapes the result for presentation.
 *
 * @module automotive/usecases/ListJourneys
 */

import { stitchJourneys } from '#domains/automotive/services/JourneyStitchService.mjs';
import { resolvePlace } from '#domains/automotive/services/PlaceResolverService.mjs';

/** How far back the timeline reaches when the caller does not say. */
const DEFAULT_WINDOW_DAYS = 90;

export class ListJourneys {
  #historyRepository;
  #placeRepository;
  #config;
  #logger;

  constructor({ historyRepository, placeRepository, config = {}, logger = console }) {
    if (!historyRepository) throw new Error('ListJourneys requires historyRepository');
    this.#historyRepository = historyRepository;
    this.#placeRepository = placeRepository;
    this.#config = config;
    this.#logger = logger;
  }

  /**
   * @param {object} input
   * @param {string} input.vehicleId
   * @param {Date} [input.from]
   * @param {Date} [input.to]
   * @param {boolean} [input.includeShuffles] surface garage shuffles and ignition blips
   * @param {Date} [input.now]
   * @returns {Promise<{journeys: object[], hidden: number}>}
   */
  async execute({ vehicleId, from = null, to = null, includeShuffles = false, now = new Date() }) {
    const windowFrom = from || daysBefore(now, this.#config.windowDays || DEFAULT_WINDOW_DAYS);

    const [descriptors, places] = await Promise.all([
      this.#historyRepository.listTripDescriptors(vehicleId, { from: windowFrom, to, withFixes: true }),
      this.#placeRepository ? this.#placeRepository.listPlaces() : Promise.resolve([]),
    ]);

    const journeys = stitchJourneys(descriptors, {
      dwellThresholdS: this.#config.dwellThresholdS,
      shuffleFloorKm: this.#config.shuffleFloorKm,
      minStopS: this.#config.minStopS,
    });

    const visible = includeShuffles ? journeys : journeys.filter((j) => !j.isShuffle);
    const hidden = journeys.length - visible.length;

    this.#logger.debug?.('automotive.journeys.listed', {
      vehicleId, trips: descriptors.length, journeys: journeys.length, hidden,
    });

    return { journeys: visible.map((journey) => present(journey, places)), hidden };
  }
}

/**
 * Journey → DTO, with every coordinate resolved against the place registry.
 *
 * Unresolved endpoints keep their raw fix so the app can offer "name this
 * stop" — the interaction that grows the registry — rather than discarding the
 * one piece of information that would make naming possible.
 */
function present(journey, places) {
  const origin = describePoint(journey.originFix, places);
  const destination = describePoint(journey.destinationFix, places);
  const stops = journey.stops.map((stop) => ({
    ...describePoint(stop.fix, places),
    arrived_at: iso(stop.arrivedAt),
    departed_at: iso(stop.departedAt),
    duration_s: stop.durationS,
  }));

  return {
    ...journey.toJSON(),
    title: buildTitle(origin, stops, destination),
    origin,
    destination,
    stops,
    has_fuel_stop: stops.some((s) => s.is_fuel_stop),
    legs: journey.legs.map((leg) => ({
      trip_id: leg.tripId,
      file: leg.file,
      started_at: iso(leg.startedAt),
      ended_at: iso(leg.endedAt),
      time_source: leg.timeSource,
      distance_km: leg.distanceKm,
      duration_s: leg.durationS,
      max_speed_kph: leg.maxSpeedKph,
      ecu: leg.ecu,
      sample_count: leg.sampleCount,
    })),
  };
}

function describePoint(fix, places) {
  const place = resolvePlace(fix, places);
  return {
    place_id: place?.id || null,
    label: place?.label || null,
    kind: place?.kind || null,
    is_fuel_stop: Boolean(place?.isFuelStop),
    fix: fix ? fix.toJSON() : null,
  };
}

/**
 * "Home → Costco Gas → Home".
 *
 * Unnamed points render as "Unnamed stop" rather than coordinates: a lat/lon in
 * a headline is noise to a reader, and the tap target to name it is right
 * there. A journey with no fixes at all gets no title, and the app falls back
 * to distance and time.
 */
function buildTitle(origin, stops, destination) {
  const points = [origin, ...stops, destination]
    .filter((point) => point.fix || point.place_id)
    .map((point) => point.label || 'Unnamed stop');
  if (!points.length) return null;

  // Collapse consecutive repeats: a stop resolving to the same place as the
  // leg before it reads as "Home → Home" otherwise.
  const collapsed = points.filter((label, i) => i === 0 || label !== points[i - 1]);
  return collapsed.join(' → ');
}

const iso = (date) => (date instanceof Date ? date.toISOString() : null);
const daysBefore = (date, days) => new Date(date.getTime() - days * 24 * 60 * 60 * 1000);
