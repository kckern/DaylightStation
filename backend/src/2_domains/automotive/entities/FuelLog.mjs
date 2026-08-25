// backend/src/2_domains/automotive/entities/FuelLog.mjs

/**
 * One fill-up.
 *
 * Fuel logs carry more weight in this domain than their size suggests: a
 * fill-up is the moment you are standing at a stopped car with the odometer in
 * front of you, which makes it the natural **anchor** for mileage accumulation
 * (see `OdometerService`). Logging fuel is worth doing for its own sake, and it
 * pays for the odometer as a side effect.
 *
 * ## Why `partial` matters
 *
 * Fuel economy can only be computed between two **full** tanks — that is the
 * only pair of moments where the amount burned is known, because the tank state
 * is identical at both ends. A partial fill leaves an unknown quantity in the
 * tank, so it cannot close an interval. It is still recorded and still counts
 * toward spend; its volume carries forward into the next interval instead.
 *
 * Litres are the storage unit, matching the km-at-rest convention. Conversion
 * to gallons happens once, at the presentation edge.
 *
 * @module automotive/entities/FuelLog
 */

import { ValidationError } from '#domains/core/errors/index.mjs';

export class FuelLog {
  #id; #date; #odometerKm; #volumeL; #priceTotal; #placeId; #partial; #notes;

  constructor({
    id, date, odometerKm = null, volumeL, priceTotal = null,
    placeId = null, partial = false, notes = '',
  }) {
    if (!id || typeof id !== 'string') {
      throw new ValidationError('FuelLog requires an id', { code: 'FUEL_ID_REQUIRED', field: 'id', value: id });
    }
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      throw new ValidationError('FuelLog requires a valid date', { code: 'FUEL_DATE_INVALID', field: 'date', value: date });
    }
    if (!Number.isFinite(volumeL) || volumeL <= 0) {
      throw new ValidationError('FuelLog volume must be a positive number of litres', {
        code: 'FUEL_VOLUME_INVALID', field: 'volumeL', value: volumeL,
      });
    }
    if (odometerKm !== null && (!Number.isFinite(odometerKm) || odometerKm < 0)) {
      throw new ValidationError('FuelLog odometer must be a non-negative number or null', {
        code: 'FUEL_ODOMETER_INVALID', field: 'odometerKm', value: odometerKm,
      });
    }
    this.#id = id;
    this.#date = new Date(date.getTime());
    this.#odometerKm = odometerKm;
    this.#volumeL = volumeL;
    this.#priceTotal = Number.isFinite(priceTotal) ? priceTotal : null;
    this.#placeId = placeId;
    this.#partial = Boolean(partial);
    this.#notes = notes || '';
  }

  get id() { return this.#id; }
  get date() { return new Date(this.#date.getTime()); }
  get odometerKm() { return this.#odometerKm; }
  get volumeL() { return this.#volumeL; }
  get priceTotal() { return this.#priceTotal; }
  get placeId() { return this.#placeId; }
  get partial() { return this.#partial; }
  get notes() { return this.#notes; }

  /** Price per litre, derived rather than stored — the pump shows both. */
  get pricePerLitre() {
    if (this.#priceTotal === null) return null;
    return round(this.#priceTotal / this.#volumeL, 4);
  }

  /**
   * Can this fill-up close a fuel-economy interval?
   *
   * Needs a full tank (known end state) AND an odometer reading (known
   * distance). Either missing and the interval has an unknown on one side.
   */
  get canCloseInterval() {
    return !this.#partial && this.#odometerKm !== null;
  }

}

const round = (n, places) => Number(n.toFixed(places));
