/**
 * Persistence for the household's named places — `household/automotive/places.yml`.
 *
 * ```yaml
 * places:
 *   home:
 *     label: Home
 *     lat: 47.00000
 *     lon: -122.00000
 *     radius_m: 120
 *     kind: home
 * ```
 *
 * Keyed by id rather than a list, because this file is meant to be hand-edited
 * as well as written by the app, and a map reads better than an array of
 * objects when a person is scanning for "which one is home".
 *
 * @module adapters/persistence/yaml/YamlPlaceDatastore
 */

import path from 'path';
import { IPlaceRepository } from '#apps/automotive/ports/IPlaceRepository.mjs';
import { Place, DEFAULT_RADIUS_M } from '#domains/automotive/value-objects/Place.mjs';
import { GeoFix } from '#domains/automotive/value-objects/GeoFix.mjs';
import { loadYamlSafe, saveYaml, ensureDir } from '#system/utils/FileIO.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

export class YamlPlaceDatastore extends IPlaceRepository {
  #file;
  #logger;

  /**
   * @param {object} deps
   * @param {string} deps.recordsRoot absolute path to .../household/automotive
   * @param {object} [deps.logger]
   */
  constructor({ recordsRoot, logger = console } = {}) {
    super();
    if (!recordsRoot) {
      throw new InfrastructureError('YamlPlaceDatastore requires recordsRoot', {
        code: 'MISSING_DEPENDENCY', dependency: 'recordsRoot',
      });
    }
    this.#file = path.join(recordsRoot, 'places');
    this.#logger = logger;
  }

  async listPlaces() {
    const data = loadYamlSafe(this.#file);
    const entries = Object.entries(data?.places || {});
    const places = [];
    for (const [id, row] of entries) {
      const fix = GeoFix.fromRaw(row);
      if (!fix) {
        // A place with no usable coordinate cannot match anything, and silently
        // keeping it would make "why didn't my stop get named" unanswerable.
        this.#logger.warn?.('automotive.places.invalid_fix', { id, lat: row?.lat, lon: row?.lon });
        continue;
      }
      try {
        places.push(new Place({
          id,
          label: row.label || id,
          fix,
          radiusM: Number(row.radius_m) || DEFAULT_RADIUS_M,
          kind: row.kind || 'other',
        }));
      } catch (error) {
        this.#logger.warn?.('automotive.places.row_rejected', { id, error: error.message });
      }
    }
    return places;
  }

  async savePlace(place) {
    const data = loadYamlSafe(this.#file) || {};
    const places = data.places || {};
    const { id, ...rest } = place.toJSON();
    places[id] = rest;
    ensureDir(path.dirname(this.#file));
    saveYaml(this.#file, { ...data, places }, { noRefs: true });
    return place;
  }

  async deletePlace(placeId) {
    const data = loadYamlSafe(this.#file);
    if (!data?.places?.[placeId]) return false;
    delete data.places[placeId];
    saveYaml(this.#file, data, { noRefs: true });
    return true;
  }
}
