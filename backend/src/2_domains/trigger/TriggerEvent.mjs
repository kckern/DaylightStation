/**
 * TriggerEvent — canonical, transport-agnostic value object produced by every
 * ingress adapter and consumed by the one dispatch core.
 *
 * Layer: DOMAIN value object (2_domains/trigger). No I/O, no clock.
 *
 * @module domains/trigger/TriggerEvent
 */
import { ValidationError } from '#domains/core/errors/ValidationError.mjs';

export class TriggerEvent {
  #source; #location; #value; #meta;

  constructor({ source, location, value, meta }) {
    this.#source = source;
    this.#location = location;
    this.#value = value;
    this.#meta = Object.freeze({ ...(meta || {}) });
    Object.freeze(this);
  }

  /**
   * @param {Object} args
   * @param {string} args.source   modality / source id (e.g. 'nfc', 'barcode')
   * @param {string} args.location origin id (reader/scanner/endpoint)
   * @param {string} args.value    raw payload; preserved as-is (case-sensitive
   *                               content ids like barcodes must not be
   *                               lowercased here — each resolver normalizes
   *                               as it needs, e.g. NfcResolver lowercases
   *                               internally for case-insensitive UID matching)
   * @param {Object} [args.meta]   transport-specific extras (device, timestamp, token, transport)
   * @returns {TriggerEvent}
   * @throws {ValidationError} if source or location is missing
   */
  static create({ source, location, value, meta } = {}) {
    if (!source) throw new ValidationError('TriggerEvent.source required', { code: 'TRIGGER_EVENT_SOURCE' });
    if (!location) throw new ValidationError('TriggerEvent.location required', { code: 'TRIGGER_EVENT_LOCATION' });
    return new TriggerEvent({ source, location, value: String(value ?? ''), meta });
  }

  get source() { return this.#source; }
  get location() { return this.#location; }
  get value() { return this.#value; }
  get meta() { return this.#meta; }
}

export default TriggerEvent;
