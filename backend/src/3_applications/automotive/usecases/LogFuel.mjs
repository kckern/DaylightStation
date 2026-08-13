/**
 * Record a fill-up.
 *
 * Small use case, outsized consequences: a fill-up carries the dash odometer,
 * which is the only thing that can anchor mileage accumulation, and it is one
 * half of a fuel-economy interval. Everything the app can say about mileage and
 * cost traces back to this form being filled in.
 *
 * @module automotive/usecases/LogFuel
 */

import { FuelLog } from '#domains/automotive/entities/FuelLog.mjs';

const LITRES_PER_GALLON = 3.785411784;

export class LogFuel {
  #recordRepository;
  #idGenerator;
  #logger;

  constructor({ recordRepository, idGenerator = defaultIdGenerator, logger = console }) {
    if (!recordRepository) throw new Error('LogFuel requires recordRepository');
    this.#recordRepository = recordRepository;
    this.#idGenerator = idGenerator;
    this.#logger = logger;
  }

  /**
   * @param {object} input
   * @param {string} input.vehicleId
   * @param {string|Date} input.date
   * @param {number} [input.volumeL]     litres — provide this OR volumeGal
   * @param {number} [input.volumeGal]   gallons, converted on the way in
   * @param {number} [input.odometerKm]
   * @param {number} [input.odometerMi]  miles, converted on the way in
   * @param {number} [input.priceTotal]
   * @param {string} [input.placeId]
   * @param {boolean} [input.partial]
   * @param {string} [input.notes]
   * @param {string} [input.id]          supply to edit an existing entry
   * @returns {Promise<FuelLog>}
   */
  async execute({
    vehicleId, date, volumeL, volumeGal, odometerKm, odometerMi,
    priceTotal = null, placeId = null, partial = false, notes = '', id = null,
  }) {
    const when = date instanceof Date ? date : new Date(date);

    // Units convert once, here at the application edge. Litres and kilometres
    // are what the domain and the files use; the pump is in gallons and the
    // dash is in miles, and neither of those conventions gets to leak inward.
    const litres = Number.isFinite(volumeL) ? volumeL
      : (Number.isFinite(volumeGal) ? volumeGal * LITRES_PER_GALLON : NaN);
    const km = Number.isFinite(odometerKm) ? odometerKm
      : (Number.isFinite(odometerMi) ? odometerMi * 1.609344 : null);

    const log = new FuelLog({
      id: id || this.#idGenerator(when, 'fuel'),
      date: when,
      odometerKm: km === null ? null : round(km, 1),
      volumeL: round(litres, 3),
      priceTotal,
      placeId,
      partial,
      notes,
    });

    await this.#recordRepository.saveFuelLog(vehicleId, log);
    this.#logger.info?.('automotive.fuel.logged', {
      vehicleId, id: log.id, volumeL: log.volumeL, odometerKm: log.odometerKm, partial: log.partial,
    });
    return log;
  }
}

/**
 * `2026-08-11-fuel-3f2a`.
 *
 * Date-led so the file sorts readably when someone opens the YAML, with a
 * random tail because two fill-ups on one day is ordinary (a road trip) and a
 * date alone would collide.
 */
export function defaultIdGenerator(date, kind) {
  const day = date.toISOString().slice(0, 10);
  const tail = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  return `${day}-${kind}-${tail}`;
}

const round = (n, places) => Number(n.toFixed(places));
