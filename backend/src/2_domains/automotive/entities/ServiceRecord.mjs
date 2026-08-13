// backend/src/2_domains/automotive/entities/ServiceRecord.mjs

/**
 * One maintenance entry, and optionally the recurrence it belongs to.
 *
 * ## Date intervals now, distance intervals later
 *
 * `intervalMonths` and `intervalKm` both exist from the start, but only the
 * month interval is currently used to compute due dates. That is a consequence
 * of the odometer being unavailable until the ECU link works — not a judgement
 * that mileage intervals matter less. Storing both means the day mileage lands,
 * a record entered today already carries what the mileage-based rule needs, and
 * no backfill is required.
 *
 * Several of the most useful recurrences — registration, insurance, emissions —
 * are date-driven by nature and need no odometer at all. Those work fully today.
 *
 * @module automotive/entities/ServiceRecord
 */

import { ValidationError } from '#domains/core/errors/index.mjs';

export class ServiceRecord {
  #id; #date; #type; #vendor; #cost; #odometerKm; #intervalMonths; #intervalKm; #notes; #attachments;

  constructor({
    id, date, type, vendor = null, cost = null, odometerKm = null,
    intervalMonths = null, intervalKm = null, notes = '', attachments = [],
  }) {
    if (!id || typeof id !== 'string') {
      throw new ValidationError('ServiceRecord requires an id', { code: 'SERVICE_ID_REQUIRED', field: 'id', value: id });
    }
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      throw new ValidationError('ServiceRecord requires a valid date', { code: 'SERVICE_DATE_INVALID', field: 'date', value: date });
    }
    if (!type || typeof type !== 'string') {
      throw new ValidationError('ServiceRecord requires a type', { code: 'SERVICE_TYPE_REQUIRED', field: 'type', value: type });
    }
    this.#id = id;
    this.#date = new Date(date.getTime());
    this.#type = type;
    this.#vendor = vendor;
    this.#cost = Number.isFinite(cost) ? cost : null;
    this.#odometerKm = Number.isFinite(odometerKm) ? odometerKm : null;
    this.#intervalMonths = Number.isFinite(intervalMonths) && intervalMonths > 0 ? intervalMonths : null;
    this.#intervalKm = Number.isFinite(intervalKm) && intervalKm > 0 ? intervalKm : null;
    this.#notes = notes || '';
    this.#attachments = [...attachments];
  }

  get id() { return this.#id; }
  get date() { return new Date(this.#date.getTime()); }
  get type() { return this.#type; }
  get vendor() { return this.#vendor; }
  get cost() { return this.#cost; }
  get odometerKm() { return this.#odometerKm; }
  get intervalMonths() { return this.#intervalMonths; }
  get intervalKm() { return this.#intervalKm; }
  get notes() { return this.#notes; }
  get attachments() { return [...this.#attachments]; }

  /** Does this record establish a recurrence, or is it a one-off? */
  get isRecurring() { return this.#intervalMonths !== null || this.#intervalKm !== null; }

  /** When this service is next due by date, or null if it has no month interval. */
  get nextDueDate() {
    if (this.#intervalMonths === null) return null;
    return addMonths(this.#date, this.#intervalMonths);
  }

  /** Odometer at which this service is next due, or null. */
  get nextDueKm() {
    if (this.#intervalKm === null || this.#odometerKm === null) return null;
    return this.#odometerKm + this.#intervalKm;
  }

  toJSON() {
    return {
      id: this.#id,
      date: this.#date.toISOString().slice(0, 10),
      type: this.#type,
      vendor: this.#vendor,
      cost: this.#cost,
      odometer_km: this.#odometerKm,
      interval_months: this.#intervalMonths,
      interval_km: this.#intervalKm,
      notes: this.#notes,
      attachments: this.attachments,
    };
  }
}

/**
 * Add whole months, clamping the day rather than rolling into the next month.
 *
 * The naive `setMonth(m + n)` overflows: 31 January plus one month becomes 3
 * March, because February has no 31st. For a maintenance due date that is a
 * silent two-day error every time it happens, so the day is clamped to the last
 * valid day of the target month instead.
 *
 * @param {Date} date
 * @param {number} months
 * @returns {Date}
 */
export function addMonths(date, months) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  const targetMonthLastDay = new Date(year, month + months + 1, 0).getDate();
  return new Date(year, month + months, Math.min(day, targetMonthLastDay),
    date.getHours(), date.getMinutes(), date.getSeconds());
}
