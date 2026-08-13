// backend/src/2_domains/automotive/services/JourneyStitchService.mjs

/**
 * Merge device trips into journeys.
 *
 * The device's trip boundaries are ignition cycles. A person's are intentions.
 * This is the translation between them: consecutive trips separated by less
 * than a dwell threshold are one outing, with the gaps between them recorded as
 * stops.
 *
 * ## Trips with no clock are never merged
 *
 * When a trip starts away from home, its timestamps are boot-relative and can
 * only be rebased if the upload happens in the same power session. Otherwise
 * `time_source` stays `boot-relative` and the trip has no position on a
 * timeline at all. Such trips are emitted as standalone journeys with
 * `clockRecoverable` false.
 *
 * Merging them on arrival order would be worse than useless: arrival order is
 * the order the car reached home WiFi, which for a backlog of buffered trips is
 * roughly arbitrary. A journey assembled that way would state, with a
 * timeline's full confidence, a sequence of events that never happened.
 *
 * ## Not every leg boundary is a stop
 *
 * The recorder rotates its trip file for its own reasons, so a journey can
 * arrive pre-fragmented with sub-second gaps. Merging is right; reporting those
 * gaps as stops is not. See `DEFAULT_MIN_STOP_S`.
 *
 * ## The thresholds are config, not constants
 *
 * There was barely a dozen trips of real data when these were written — no
 * empirical basis for any of the numbers. They are parameters so they can be
 * tuned against a month of driving without a code change.
 *
 * @module automotive/services/JourneyStitchService
 */

import { Journey } from '../entities/Journey.mjs';

/**
 * Below this gap between trips, the car was stopped mid-outing rather than home.
 *
 * 20 minutes, chosen 2026-08-12 so a whole errand run — bank, store, school —
 * reads as ONE journey with several stops rather than four separate outings.
 * The cost of the looser setting is that a genuinely long visit somewhere gets
 * absorbed into the surrounding trip; the benefit is a timeline that matches how
 * a person describes their day.
 *
 * Still not empirically grounded: there were about four usable trips on disk
 * when this was set. It is config for exactly that reason — revisit once the
 * deep-sleep clock fix means journeys can actually be ordered against each other.
 */
export const DEFAULT_DWELL_THRESHOLD_S = 20 * 60;

/** Below this total distance, an outing is a garage shuffle or an ignition blip. */
export const DEFAULT_SHUFFLE_FLOOR_KM = 0.2;

/**
 * Below this gap, consecutive legs are joined with NO stop recorded.
 *
 * The device rotates its trip file for reasons that have nothing to do with the
 * car stopping — arriving on home WiFi triggers a close/open, and a reconnect
 * can do it again. Observed 2026-08-12: one 25-minute drive arrived as four
 * legs separated by 1s, 2s and 2s, with `driving_s` within six seconds of
 * `elapsed_s`. Nobody stopped; the recorder hiccuped.
 *
 * Merging those legs is right, but emitting them as stops is not — the row
 * would read "3 stops" for a drive that had none, and each artifact would offer
 * to be named as a place. So gaps under a minute join seamlessly.
 *
 * A real stop is never this short: even dropping someone at a kerb takes longer
 * than a minute of engine-off, which is what a trip boundary requires.
 */
export const DEFAULT_MIN_STOP_S = 60;

/**
 * @typedef {object} TripDescriptor
 * @property {string} tripId
 * @property {Date|null} startedAt
 * @property {Date|null} endedAt
 * @property {string} timeSource        'device' | 'rebased' | 'boot-relative'
 * @property {number} distanceKm
 * @property {number|null} maxSpeedKph
 * @property {number} durationS
 * @property {boolean} ecu
 * @property {import('../value-objects/GeoFix.mjs').GeoFix|null} [startFix]
 * @property {import('../value-objects/GeoFix.mjs').GeoFix|null} [endFix]
 * @property {string} [file]
 */

/**
 * @param {TripDescriptor[]} trips
 * @param {object} [options]
 * @param {number} [options.dwellThresholdS]
 * @param {number} [options.shuffleFloorKm]
 * @param {number} [options.minStopS]
 * @returns {Journey[]} newest first
 */
export function stitchJourneys(trips, {
  dwellThresholdS = DEFAULT_DWELL_THRESHOLD_S,
  shuffleFloorKm = DEFAULT_SHUFFLE_FLOOR_KM,
  minStopS = DEFAULT_MIN_STOP_S,
} = {}) {
  const all = Array.isArray(trips) ? trips : [];

  const clocked = all
    .filter((t) => t?.startedAt instanceof Date && t?.endedAt instanceof Date)
    .sort((a, b) => a.startedAt - b.startedAt);
  const unclocked = all.filter((t) => !(t?.startedAt instanceof Date) || !(t?.endedAt instanceof Date));

  const journeys = [];
  let group = [];

  const flush = () => {
    if (!group.length) return;
    journeys.push(buildJourney(group, shuffleFloorKm, minStopS));
    group = [];
  };

  for (const trip of clocked) {
    if (!group.length) {
      group.push(trip);
      continue;
    }
    const previous = group[group.length - 1];
    const gapS = (trip.startedAt - previous.endedAt) / 1000;
    // A negative gap means the trips overlap — the device's clock jumped, or a
    // rebased trip landed on top of a device-timed one. Treat it as continuous
    // rather than as a 'stop' of negative duration.
    if (gapS <= dwellThresholdS) {
      group.push(trip);
    } else {
      flush();
      group.push(trip);
    }
  }
  flush();

  // Each undateable trip stands alone — but still faces the size check, so a
  // zero-distance ignition blip is classified a shuffle whether or not anyone
  // knows when it happened.
  for (const trip of unclocked) {
    journeys.push(buildJourney([trip], shuffleFloorKm, minStopS));
  }

  return journeys.sort(byNewestFirst);
}

/**
 * Build one journey from an ordered group of trips, deriving the stops between
 * them.
 *
 * A stop's position prefers the *arriving* leg's final fix over the departing
 * leg's first fix: the car was parked in the same spot for both, but the
 * arriving fix has had the whole approach to settle, whereas the departing one
 * is often the first sample after a cold GNSS start.
 */
function buildJourney(group, shuffleFloorKm, minStopS) {
  const stops = [];
  for (let i = 1; i < group.length; i += 1) {
    const arriving = group[i - 1];
    const departing = group[i];
    const durationS = Math.max(0, Math.round((departing.startedAt - arriving.endedAt) / 1000));
    // Sub-minute gaps are the recorder rotating its file, not the car stopping.
    // The legs still merge; they just join without a stop between them.
    if (durationS < minStopS) continue;
    stops.push({
      fix: arriving.endFix ?? departing.startFix ?? null,
      arrivedAt: arriving.endedAt,
      departedAt: departing.startedAt,
      durationS,
    });
  }

  const first = group[0];
  const journey = new Journey({
    id: `journey-${first.tripId}`,
    legs: group,
    stops,
    classification: 'journey',
  });

  // Classification needs the assembled totals, so it happens after construction.
  if (journey.distanceKm < shuffleFloorKm) {
    return new Journey({ id: journey.id, legs: group, stops, classification: 'shuffle' });
  }
  return journey;
}

/**
 * Newest first, with undateable journeys last.
 *
 * A journey with no recoverable clock has no date to sort by, and inventing one
 * from its arrival time would interleave it with real timestamps as though it
 * were equally trustworthy — the same mistake the trip filenames avoid with
 * their `unknown_` prefix.
 */
function byNewestFirst(a, b) {
  const aTime = a.startedAt instanceof Date ? a.startedAt.getTime() : null;
  const bTime = b.startedAt instanceof Date ? b.startedAt.getTime() : null;
  if (aTime === null && bTime === null) return 0;
  if (aTime === null) return 1;
  if (bTime === null) return -1;
  return bTime - aTime;
}
