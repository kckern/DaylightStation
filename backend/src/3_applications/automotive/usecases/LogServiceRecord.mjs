/**
 * Record a maintenance entry.
 *
 * Captures an odometer reading whenever one is offered, even though nothing
 * displays a computed mileage yet. It costs one optional field now and is what
 * makes the mileage history usable the day the ECU link works — with no
 * backfill, because the readings were being collected all along.
 *
 * @module automotive/usecases/LogServiceRecord
 */

import { ServiceRecord } from '#domains/automotive/entities/ServiceRecord.mjs';
import { defaultIdGenerator } from './LogFuel.mjs';

export class LogServiceRecord {
  #recordRepository;
  #idGenerator;
  #logger;

  constructor({ recordRepository, idGenerator = defaultIdGenerator, logger = console }) {
    if (!recordRepository) throw new Error('LogServiceRecord requires recordRepository');
    this.#recordRepository = recordRepository;
    this.#idGenerator = idGenerator;
    this.#logger = logger;
  }

  /**
   * @param {object} input
   * @param {string} input.vehicleId
   * @param {string|Date} input.date
   * @param {string} input.type
   * @param {string} [input.vendor]
   * @param {number} [input.cost]
   * @param {number} [input.odometerKm]
   * @param {number} [input.odometerMi]
   * @param {number} [input.intervalMonths]
   * @param {number} [input.intervalKm]
   * @param {string} [input.notes]
   * @param {string[]} [input.attachments]
   * @param {string} [input.id]
   * @returns {Promise<ServiceRecord>}
   */
  async execute({
    vehicleId, date, type, vendor = null, cost = null,
    odometerKm, odometerMi, intervalMonths = null, intervalKm = null,
    notes = '', attachments = [], id = null,
  }) {
    const when = date instanceof Date ? date : new Date(date);
    const km = Number.isFinite(odometerKm) ? odometerKm
      : (Number.isFinite(odometerMi) ? odometerMi * 1.609344 : null);

    const record = new ServiceRecord({
      id: id || this.#idGenerator(when, slug(type)),
      date: when,
      type,
      vendor,
      cost,
      odometerKm: km === null ? null : round(km, 1),
      intervalMonths,
      intervalKm,
      notes,
      attachments,
    });

    await this.#recordRepository.saveServiceRecord(vehicleId, record);
    this.#logger.info?.('automotive.service.logged', {
      vehicleId, id: record.id, type: record.type, recurring: record.isRecurring,
    });
    return record;
  }
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'service';
const round = (n, places) => Number(n.toFixed(places));
