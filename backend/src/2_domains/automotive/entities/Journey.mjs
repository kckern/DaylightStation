// backend/src/2_domains/automotive/entities/Journey.mjs

/**
 * One outing — the unit the timeline presents.
 *
 * ## Why this exists instead of showing trips
 *
 * A **trip** is what the device uploads, and its boundaries are ignition
 * cycles, not intentions. Switching the engine off to run into a shop ends a
 * trip. So does the device's own standby cycle. The result is that a single
 * errand arrives as three or four trips, and a literal trip list reads as noise
 * rather than as "we went to Costco".
 *
 * A **journey** merges consecutive trips across a short dwell and presents the
 * outing: where it started, where it stopped along the way, where it ended.
 * Trips survive underneath as `legs` — nothing is discarded, and the raw
 * recording is always one tap away.
 *
 * ## Classification is presentational, never destructive
 *
 * `shuffle` marks an outing too small to be an outing — the car moved a few
 * metres in the garage, or an ignition blip produced a recording of nothing.
 * These are hidden by default in the timeline and revealed by a toggle. They
 * are never deleted: the history tree is append-only and relay-owned, and a
 * view classification has no business editing it.
 *
 * ## Size and clock state are orthogonal
 *
 * `clockRecoverable` is false for a journey whose trips carry no wall clock
 * (`time_source: boot-relative`). Such trips cannot be ordered against anything
 * else, so they are never merged with neighbours — a journey built from a guess
 * about ordering would be a fabrication wearing a timeline's clothes.
 *
 * That is deliberately a SEPARATE field from `classification`, because the two
 * questions are independent: an undateable trip can still be a real 20 km
 * outing, and a perfectly timestamped one can still be the car rolling three
 * metres in the garage. Folding them into one enum meant unclocked journeys
 * skipped the size check, which surfaced 50 zero-distance ignition blips as
 * though they were outings.
 *
 * @module automotive/entities/Journey
 */

import { ValidationError } from '#domains/core/errors/index.mjs';

/** @typedef {'journey'|'shuffle'} JourneyClassification */

export class Journey {
  #id;
  #legs;
  #stops;
  #classification;

  /**
   * @param {object} props
   * @param {string} props.id
   * @param {Array<object>} props.legs   trip descriptors, chronological
   * @param {Array<object>} [props.stops]
   * @param {JourneyClassification} [props.classification]
   */
  constructor({ id, legs, stops = [], classification = 'journey' }) {
    if (!id || typeof id !== 'string') {
      throw new ValidationError('Journey requires an id', {
        code: 'JOURNEY_ID_REQUIRED', field: 'id', value: id,
      });
    }
    if (!Array.isArray(legs) || legs.length === 0) {
      throw new ValidationError('Journey requires at least one leg', {
        code: 'JOURNEY_LEGS_REQUIRED', field: 'legs', value: legs,
      });
    }
    this.#id = id;
    this.#legs = [...legs];
    this.#stops = [...stops];
    this.#classification = classification;
  }

  get id() { return this.#id; }
  get legs() { return [...this.#legs]; }
  get stops() { return [...this.#stops]; }
  get classification() { return this.#classification; }

  get startedAt() { return this.#legs[0]?.startedAt ?? null; }
  get endedAt() { return this.#legs[this.#legs.length - 1]?.endedAt ?? null; }

  /** Wall-clock span including time spent stopped, or null when unclocked. */
  get elapsedS() {
    const start = this.startedAt;
    const end = this.endedAt;
    if (!(start instanceof Date) || !(end instanceof Date)) return null;
    return Math.round((end - start) / 1000);
  }

  /** Time with the engine actually running — the sum of the legs. */
  get drivingS() {
    return this.#legs.reduce((sum, leg) => sum + (Number(leg.durationS) || 0), 0);
  }

  get distanceKm() {
    return round(this.#legs.reduce((sum, leg) => sum + (Number(leg.distanceKm) || 0), 0), 3);
  }

  get maxSpeedKph() {
    const speeds = this.#legs.map((l) => l.maxSpeedKph).filter((s) => Number.isFinite(s));
    return speeds.length ? Math.max(...speeds) : null;
  }

  /** Did the engine bus answer on ANY leg? Drives the "no engine data" note. */
  get hasEcu() { return this.#legs.some((leg) => leg.ecu === true); }

  get originFix() { return this.#legs[0]?.startFix ?? null; }
  get destinationFix() { return this.#legs[this.#legs.length - 1]?.endFix ?? null; }

  /** Hidden from the default timeline, but never deleted. */
  get isShuffle() { return this.#classification === 'shuffle'; }

  /**
   * Does this journey have a real position on a timeline?
   *
   * False when its trips uploaded with boot-relative clocks that could not be
   * rebased. Such a journey is still shown — it happened — but dated only by
   * when it arrived, and never merged with a neighbour.
   */
  get clockRecoverable() { return this.startedAt instanceof Date; }

  toJSON() {
    return {
      id: this.#id,
      classification: this.#classification,
      clock_recoverable: this.clockRecoverable,
      started_at: this.startedAt ? this.startedAt.toISOString() : null,
      ended_at: this.endedAt ? this.endedAt.toISOString() : null,
      elapsed_s: this.elapsedS,
      driving_s: this.drivingS,
      distance_km: this.distanceKm,
      max_speed_kph: this.maxSpeedKph,
      has_ecu: this.hasEcu,
      leg_count: this.#legs.length,
      stop_count: this.#stops.length,
    };
  }
}

const round = (n, places) => Number(n.toFixed(places));
