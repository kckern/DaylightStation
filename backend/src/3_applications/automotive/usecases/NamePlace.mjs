/**
 * Give a name to a stop the app could not recognise.
 *
 * This is the whole growth mechanism for the place registry. Rather than
 * demanding the household sit down and enter every location it visits, the
 * timeline shows "Unnamed stop" wherever it lacks a match, and one tap turns
 * that into a permanent entry. The registry ends up containing exactly the
 * places actually driven to, in the order they mattered.
 *
 * @module automotive/usecases/NamePlace
 */

import { Place, DEFAULT_RADIUS_M } from '#domains/automotive/value-objects/Place.mjs';
import { GeoFix } from '#domains/automotive/value-objects/GeoFix.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

export class NamePlace {
  #placeRepository;
  #logger;

  constructor({ placeRepository, logger = console }) {
    if (!placeRepository) throw new Error('NamePlace requires placeRepository');
    this.#placeRepository = placeRepository;
    this.#logger = logger;
  }

  /**
   * @param {object} input
   * @param {string} input.label
   * @param {number} input.lat
   * @param {number} input.lon
   * @param {string} [input.id]        defaults to a slug of the label
   * @param {number} [input.radiusM]
   * @param {string} [input.kind]
   * @returns {Promise<Place>}
   */
  async execute({ label, lat, lon, id = null, radiusM = DEFAULT_RADIUS_M, kind = 'other' }) {
    const fix = GeoFix.fromRaw({ lat, lon });
    if (!fix) {
      throw new ValidationError('NamePlace requires a usable coordinate', {
        code: 'PLACE_FIX_INVALID', field: 'lat,lon', value: `${lat},${lon}`,
      });
    }

    const place = new Place({ id: id || slug(label), label, fix, radiusM, kind });
    await this.#placeRepository.savePlace(place);
    this.#logger.info?.('automotive.place.named', { id: place.id, kind: place.kind, radiusM: place.radiusM });
    return place;
  }
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'place';
